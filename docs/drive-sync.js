(() => {
  'use strict';

  const storageKey = 'home-finance-drive-v1';
  const initialPairLink = location.hash.startsWith('#pair=') ? location.href : null;
  if (initialPairLink) history.replaceState(history.state, '', location.pathname + location.search);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const endpointPattern = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const keyPattern = /^[a-f0-9]{64}$/;
  const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const digest = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  const toBase64 = bytes => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
  };
  const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

  async function encryptionKey(secret) {
    const raw = await crypto.subtle.digest('SHA-256', encoder.encode('home-finance encryption v1:' + secret));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async function encrypt(text, secret, allowCompression = true) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = encoder.encode(text);
    const compressed = allowCompression && typeof CompressionStream === 'function';
    const payload = compressed
      ? await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
      : bytes;
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), payload);
    return { iv: toBase64(iv), compression: compressed ? 'gzip' : null, ciphertext: toBase64(new Uint8Array(ciphertext)) };
  }

  async function decrypt(snapshot, secret) {
    const result = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(snapshot.iv) },
      await encryptionKey(secret), fromBase64(snapshot.ciphertext)
    );
    if (snapshot.compression === 'gzip') {
      if (typeof DecompressionStream !== 'function') throw Error('Aggiorna il browser per leggere l’archivio Drive.');
      return new Response(new Blob([result]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    return decoder.decode(result);
  }

  async function remoteRequest(connection, action, fields = {}) {
    const auth = action === 'pair_claim' ? undefined : await digest('home-finance authorization v1:' + connection.secret);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(connection.endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ action, auth, ...fields }),
        signal: controller.signal,
      });
      if (!response.ok) throw Error('Endpoint non raggiungibile.');
      const result = await response.json();
      if (!result.ok) {
        const messages = {
          unauthorized: 'Chiave non riconosciuta dal backend.',
          busy: 'Drive occupato. La sincronizzazione riproverà.',
          conflict: 'Drive è cambiato durante il salvataggio. La sincronizzazione riproverà.',
          storage_error: 'Apps Script non riesce ad accedere all’archivio Drive.',
          invalid_request: 'Il backend ha respinto la richiesta.',
          pair_expired: 'Il codice è scaduto o è già stato usato. Generane uno nuovo.',
        };
        throw Error(messages[result.error] || 'Risposta inattesa da Apps Script.');
      }
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  function pairingDetails(link) {
    const url = new URL(link);
    if (url.origin !== location.origin || url.pathname !== new URL('./', location.href).pathname) {
      throw Error('Il link non appartiene a Home Finance.');
    }
    const [id, ticket, key] = new URLSearchParams(url.hash.slice(1)).get('pair')?.split('.') ?? [];
    const endpoint = 'https://script.google.com/macros/s/' + id + '/exec';
    if (!id || !endpointPattern.test(endpoint) || !keyPattern.test(ticket) || !keyPattern.test(key)) {
      throw Error('Codice di collegamento non valido.');
    }
    return { endpoint, ticket, key };
  }

  function loadConnection() {
    try {
      const config = JSON.parse(localStorage.getItem(storageKey));
      return endpointPattern.test(config?.endpoint) && keyPattern.test(config?.secret) ? config : null;
    } catch {
      return null;
    }
  }

  window.createHomeFinanceDriveSync = archive => {
    let state = loadConnection();
    let timer, running = false, conflict = false;
    let status = state ? 'Connessione in attesa.' : 'Drive non collegato.';

    function updateStatus(message, showConflict = false) {
      status = message;
      conflict = showConflict;
      const output = document.querySelector('#drive-status');
      if (output) output.textContent = status;
      const choices = document.querySelector('#drive-conflict');
      if (choices) {
        choices.hidden = !conflict;
        choices.querySelector('#drive-use-local').hidden = Boolean(state?.pendingPair);
      }
      const send = document.querySelector('#drive-pair-send');
      const receive = document.querySelector('#drive-pair-receive');
      if (send && receive) {
        send.hidden = !state || Boolean(state.pendingPair);
        receive.hidden = Boolean(state && !state.pendingPair);
      }
    }

    function remember(connection, progress) {
      const next = { ...connection, ...progress };
      const text = JSON.stringify(next);
      if (localStorage.getItem(storageKey) !== text) localStorage.setItem(storageKey, text);
      state = next;
    }

    async function sync(preference) {
      if (!state || running) return;
      if (!navigator.onLine) {
        updateStatus('Offline. Le modifiche restano su questo dispositivo.', conflict);
        return;
      }
      running = true;
      const connection = state;
      updateStatus('Sincronizzazione in corso…', conflict);
      try {
        const records = await archive.read();
        const local = JSON.stringify(records);
        const localHash = await digest(local);
        const { database } = await remoteRequest(connection, 'load');
        const revision = database?.revision ?? null;
        if (!database && connection.pendingPair) {
          updateStatus('Archivio Drive non disponibile. Riprova dal dispositivo già collegato.');
          return;
        }
        if (!database && connection.revision && preference !== 'local') {
          updateStatus('Archivio Drive assente. Scegli se ripubblicare la copia locale.', true);
          return;
        }
        const remote = database ? await decrypt(database.snapshot, connection.secret) : null;
        const remoteHash = remote === null ? null : await digest(remote);
        const sameData = localHash === remoteHash;
        const localChanged = localHash !== connection.localHash;
        const remoteChanged = revision !== connection.revision;
        let direction = preference;

        if (!direction && !sameData && connection.pendingPair && archive.isStarter(records)) direction = 'remote';
        if (!direction && !sameData) {
          if (!database) direction = 'local';
          else if (connection.revision && !localChanged && remoteChanged) direction = 'remote';
          else if (connection.revision && localChanged && !remoteChanged) direction = 'local';
          else if ((!connection.revision || remoteChanged) && localChanged) {
            updateStatus('Drive e questo dispositivo hanno archivi diversi. Scegli quale conservare.', true);
            return;
          }
        }

        let savedRevision = revision;
        let syncedHash = localHash;
        if (direction === 'local' && !sameData) {
          const snapshot = await encrypt(local, connection.secret);
          if (snapshot.ciphertext.length > 8_900_000) throw Error('Archivio oltre la dimensione supportata.');
          const result = await remoteRequest(connection, 'save', { expectedRevision: revision, snapshot });
          savedRevision = result.revision;
        } else if (direction === 'remote' && !sameData) {
          if (remote === null) {
            updateStatus('Su Drive non c’è un archivio da scaricare.', true);
            return;
          }
          await archive.replace(JSON.parse(remote), local);
          syncedHash = remoteHash;
        }
        const current = loadConnection();
        if (current?.endpoint !== connection.endpoint || current.secret !== connection.secret) {
          state = current;
          updateStatus('Collegamento modificato su un’altra scheda.');
          return;
        }
        remember(connection, { revision: savedRevision, localHash: syncedHash, pendingPair: false });
        updateStatus('Archivio sincronizzato con Drive.');
        if (direction === 'remote' && !sameData) await archive.refresh();
      } catch (error) {
        updateStatus(navigator.onLine ? 'Sincronizzazione sospesa. ' + error.message : 'Offline. Le modifiche restano su questo dispositivo.', conflict);
      } finally {
        running = false;
      }
    }

    function schedule() {
      clearTimeout(timer);
      if (state && !conflict) timer = setTimeout(() => void sync(), 2500);
    }

    window.addEventListener('online', schedule);
    window.addEventListener('storage', event => {
      if (event.key === storageKey && !running) {
        state = loadConnection();
        updateStatus(state ? 'Connessione in attesa.' : 'Drive non collegato.');
        schedule();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule();
    });
    setInterval(() => { if (!document.hidden && !conflict) void sync(); }, 60000);
    schedule();

    return {
      schedule,
      initialPairLink,
      async createPairLink() {
        if (!state || state.pendingPair) throw Error('Collega prima il dispositivo all’archivio Drive.');
        const connection = state;
        const ticket = hex(crypto.getRandomValues(new Uint8Array(32)));
        const key = hex(crypto.getRandomValues(new Uint8Array(32)));
        const snapshot = await encrypt(connection.secret, key, false);
        await remoteRequest(connection, 'pair_create', { ticket, snapshot });
        const id = new URL(connection.endpoint).pathname.split('/')[3];
        const link = new URL('./', location.href);
        link.hash = 'pair=' + [id, ticket, key].join('.');
        return link.href;
      },
      async acceptPairLink(link) {
        if (running) throw Error('Aspetta la fine della sincronizzazione e riprova.');
        const { endpoint, ticket, key } = pairingDetails(link);
        if (state && state.endpoint !== endpoint) throw Error('Questo dispositivo è già collegato a un altro archivio.');
        running = true;
        try {
          const { snapshot } = await remoteRequest({ endpoint }, 'pair_claim', { ticket });
          const secret = await decrypt(snapshot, key);
          if (!keyPattern.test(secret)) throw Error('Chiave di collegamento non valida.');
          if (state && state.secret !== secret) throw Error('Questo dispositivo è già collegato a un altro archivio.');
          if (!state) remember({ endpoint, secret }, { pendingPair: true });
        } finally {
          running = false;
        }
        await sync();
        return { status, conflict, connected: Boolean(state && !state.pendingPair) };
      },
      mount(form) {
        const endpoint = form.elements.endpoint;
        const secret = form.elements.secret;
        endpoint.value = state?.endpoint || '';
        secret.value = state?.secret || '';
        const showKey = form.querySelector('#drive-show-key');
        showKey.onclick = () => {
          const showing = secret.type === 'password';
          secret.type = showing ? 'text' : 'password';
          showKey.textContent = showing ? 'Nascondi chiave' : 'Mostra chiave';
          showKey.setAttribute('aria-pressed', String(showing));
        };
        const verifier = form.querySelector('#drive-verifier');
        form.querySelector('#drive-new-key').onclick = () => {
          secret.value = hex(crypto.getRandomValues(new Uint8Array(32)));
          verifier.hidden = true;
        };
        form.querySelector('#drive-hash').onclick = async () => {
          if (!keyPattern.test(secret.value.trim())) {
            updateStatus('Genera una chiave o inserisci quella del tuo archivio.');
            return;
          }
          verifier.value = await digest(await digest('home-finance authorization v1:' + secret.value.trim()));
          verifier.hidden = false;
          verifier.select();
        };
        form.onsubmit = async event => {
          event.preventDefault();
          if (running) return;
          const connection = { endpoint: endpoint.value.trim(), secret: secret.value.trim() };
          if (!endpointPattern.test(connection.endpoint) || !keyPattern.test(connection.secret)) {
            updateStatus('Inserisci l’indirizzo Apps Script /exec e una chiave valida.');
            return;
          }
          try {
            if (connection.endpoint !== state?.endpoint || connection.secret !== state?.secret) remember(connection, {});
            await sync();
          } catch (error) {
            updateStatus(error.message);
          }
        };
        document.querySelector('#drive-use-local').onclick = async () => {
          if (await archive.confirm('Sostituire l’archivio su Drive con la copia di questo dispositivo?')) await sync('local');
        };
        document.querySelector('#drive-use-remote').onclick = async () => {
          if (await archive.confirm('Sostituire l’archivio di questo dispositivo con la copia su Drive?')) await sync('remote');
        };
        form.querySelector('#drive-disconnect').onclick = () => {
          if (running) return;
          localStorage.removeItem(storageKey);
          state = null;
          endpoint.value = secret.value = '';
          verifier.hidden = true;
          updateStatus('Drive scollegato da questo dispositivo.');
        };
        updateStatus(status, conflict);
      },
    };
  };
})();
