import { generateQR, readQR } from './vendor/qr-tools.js';

export function openPairing(sync, { mode, initialLink, onConnected }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'pair-dialog';
  dialog.setAttribute('aria-labelledby', 'pair-title');
  dialog.innerHTML = `
    <div class="section-head"><h2 id="pair-title">Collega un dispositivo</h2>
    <button type="button" data-pair-close>Chiudi</button></div>
    <p class="muted" data-pair-instructions></p>
    <canvas width="320" height="320" data-pair-qr role="img" aria-label="Codice QR di collegamento" hidden></canvas>
    <video data-pair-camera playsinline muted hidden></video>
    <form data-pair-form hidden>
      <label>Link di collegamento<input type="text" name="link" autocomplete="off" spellcheck="false" required></label>
      <button type="submit" class="primary">Collega</button>
    </form>
    <div class="toolbar">
      <button type="button" data-pair-copy hidden>Copia link</button>
      <button type="button" data-pair-scan hidden>Scansiona QR</button>
      <button type="button" data-pair-paste hidden>Incolla link</button>
    </div>
    <p role="status" data-pair-status></p>`;
  const find = name => dialog.querySelector('[data-pair-' + name + ']');
  const status = find('status');
  const video = find('camera');
  const form = find('form');
  const input = form.elements.link;
  let stream, frame, busy = false, expires;
  function stopCamera() {
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop());
    stream = undefined;
    video.srcObject = null;
    video.hidden = true;
  }
  dialog.addEventListener('close', () => {
    stopCamera();
    clearTimeout(expires);
    dialog.remove();
  });
  find('close').onclick = () => dialog.close();
  document.body.append(dialog);
  dialog.showModal();

  if (mode === 'send') {
    dialog.querySelector('h2').textContent = 'Collega un altro dispositivo';
    find('instructions').textContent = 'Apri Home Finance sull’altro dispositivo e scegli Collega questo dispositivo, poi Scansiona QR.';
    status.textContent = 'Generazione del codice…';
    void (async () => {
      try {
        const link = await sync.createPairLink();
        if (!dialog.open) return;
        const qr = generateQR(0, 'M');
        qr.addData(link);
        qr.make();
        const canvas = find('qr');
        const count = qr.getModuleCount();
        const scale = Math.floor(canvas.width / (count + 8));
        const margin = Math.floor((canvas.width - count * scale) / 2);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#10253f';
        for (let row = 0; row < count; row++) {
          for (let col = 0; col < count; col++) {
            if (qr.isDark(row, col)) context.fillRect(margin + col * scale, margin + row * scale, scale, scale);
          }
        }
        canvas.hidden = false;
        find('copy').hidden = false;
        status.textContent = 'Il codice vale per un solo collegamento e scade entro cinque minuti.';
        find('copy').onclick = async () => {
          try {
            await navigator.clipboard.writeText(link);
            status.textContent = 'Link copiato. Aprilo solo sul dispositivo che vuoi collegare.';
          } catch {
            status.textContent = 'Copia non disponibile. Puoi ancora usare il QR.';
          }
        };
        expires = setTimeout(() => {
          canvas.hidden = true;
          find('copy').hidden = true;
          status.textContent = 'Codice scaduto. Chiudi e riapri per generarne uno nuovo.';
        }, 300000);
      } catch (error) {
        status.textContent = error.message;
      }
    })();
    return;
  }

  find('instructions').textContent = 'Inquadra il QR mostrato dal dispositivo già collegato.';
  find('scan').hidden = false;
  find('paste').hidden = false;
  find('paste').onclick = () => {
    stopCamera();
    form.hidden = false;
    input.focus();
  };

  async function connect(link) {
    if (busy) return;
    busy = true;
    stopCamera();
    find('scan').disabled = find('paste').disabled = true;
    status.textContent = 'Collegamento e recupero dell’archivio…';
    try {
      const result = await sync.acceptPairLink(link);
      if (result.connected || result.conflict) {
        if (dialog.open) dialog.close();
        onConnected(result);
      } else {
        status.textContent = result.status;
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      if (dialog.open) {
        busy = false;
        find('scan').disabled = find('paste').disabled = false;
      }
    }
  }

  form.onsubmit = event => {
    event.preventDefault();
    const link = input.value.trim();
    input.value = '';
    void connect(link);
  };
  find('scan').onclick = async () => {
    if (stream || busy) return;
    const scan = find('scan');
    scan.disabled = true;
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!dialog.open) {
        camera.getTracks().forEach(track => track.stop());
        return;
      }
      stream = camera;
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      let last = 0;
      const scanFrame = time => {
        if (video.readyState >= 2 && time - last >= 160) {
          last = time;
          canvas.width = Math.min(video.videoWidth, 640);
          canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = readQR(data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (code) {
            void connect(code.data);
            return;
          }
        }
        frame = requestAnimationFrame(scanFrame);
      };
      frame = requestAnimationFrame(scanFrame);
    } catch {
      stopCamera();
      status.textContent = 'Fotocamera non disponibile. Puoi incollare il link di collegamento.';
      form.hidden = false;
    } finally {
      scan.disabled = false;
    }
  };
  if (initialLink) void connect(initialLink);
}
