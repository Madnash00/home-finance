/** Home Finance private Drive storage. Configuration lives in Script Properties. */
const DATA_FILE_NAME = 'home-finance-database.encrypted.json';
const MAX_BODY = 9000000;

function reply_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

const HOME_FINANCE_URL = 'https://madnash00.github.io/home-finance/';
const HOME_FINANCE_ORIGIN = 'https://madnash00.github.io';
const OWNER_TOKEN = /^[a-f0-9]{64}$/;

function doGet(event) {
  const properties = PropertiesService.getScriptProperties();
  const attempt = event && event.parameter && event.parameter.owner_signin;
  if (attempt === undefined) {
    return reply_({ service: 'home-finance-drive', version: 3,
      ownerGate: properties.getProperty('HF_OWNER_GATE_URL') || null });
  }
  const active = Session.getActiveUser().getEmail();
  const owner = Session.getEffectiveUser().getEmail();
  if (!active || active.toLowerCase() !== owner.toLowerCase() || !OWNER_TOKEN.test(attempt)) {
    return HtmlService.createHtmlOutput('<p>Accesso riservato al proprietario di Home Finance.</p>');
  }
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('owner-login:' + sha256_(token), attempt, 120);
  const fragment = '#owner=' + attempt + '.' + token;
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><title>Accesso Home Finance</title>' +
    '<p>Accesso confermato.</p><a target="_top" href="' + HOME_FINANCE_URL + fragment + '">Torna a Home Finance</a>' +
    '<script>try{if(top.opener){top.opener.postMessage(' + JSON.stringify(fragment) + ',' +
    JSON.stringify(HOME_FINANCE_ORIGIN) + ');}}catch(e){}</script>'
  );
}

function finishOwnerSignin_(request, properties) {
  if (typeof request.token !== 'string' || !OWNER_TOKEN.test(request.token) ||
      typeof request.attempt !== 'string' || !OWNER_TOKEN.test(request.attempt)) {
    return reply_({ ok: false, error: 'invalid_request' });
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_({ ok: false, error: 'busy' });
  try {
    const cache = CacheService.getScriptCache();
    const key = 'owner-login:' + sha256_(request.token);
    if (cache.get(key) !== request.attempt) return reply_({ ok: false, error: 'owner_login_expired' });
    cache.remove(key);
    let secret = properties.getProperty('HF_OWNER_ARCHIVE_KEY');
    if (!secret) {
      const candidate = request.archiveKey;
      const valid = typeof candidate === 'string' && OWNER_TOKEN.test(candidate) &&
        authorized_(sha256_('home-finance authorization v1:' + candidate), properties.getProperty('HF_AUTH_SHA256'));
      if (!valid) return reply_({ ok: false, error: 'owner_archive_setup' });
      secret = candidate;
      properties.setProperty('HF_OWNER_ARCHIVE_KEY', secret);
    }
    return reply_({ ok: true, archiveKey: secret });
  } finally {
    lock.releaseLock();
  }
}

function sha256_(input) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input, Utilities.Charset.UTF_8)
    .map(byte => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function authorized_(auth, expected) {
  if (typeof auth !== 'string' || !/^[a-f0-9]{64}$/.test(auth) ||
      typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = sha256_(auth);
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) mismatch |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function validEnvelope_(snapshot) {
  return snapshot && typeof snapshot.iv === 'string' && /^[A-Za-z0-9+/]{16}$/.test(snapshot.iv) &&
    typeof snapshot.ciphertext === 'string' && snapshot.ciphertext.length >= 24 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(snapshot.ciphertext);
}

function openDatabase_(properties) {
  const folder = DriveApp.getFolderById(properties.getProperty('HF_FOLDER_ID'));
  const files = folder.getFilesByName(DATA_FILE_NAME);
  const file = files.hasNext() ? files.next() : null;
  if (files.hasNext()) throw Error('Duplicate database filename');
  const current = file ? JSON.parse(file.getBlob().getDataAsString('UTF-8')) : null;
  if (file && (!current || typeof current.revision !== 'string' || !validEnvelope_(current.snapshot))) {
    throw Error('Invalid remote database');
  }
  return { folder, file, current };
}

// Run in the editor to check the folder and authorize Drive access without creating a data file.
function checkDatabaseFolder() {
  const properties = PropertiesService.getScriptProperties();
  const { folder, current } = openDatabase_(properties);
  return { folder: folder.getName(), initialized: !!current };
}

function pairingRequest_(request) {
  if (typeof request.ticket !== 'string' || !/^[a-f0-9]{64}$/.test(request.ticket)) {
    return reply_({ ok: false, error: 'invalid_request' });
  }
  const cache = CacheService.getScriptCache();
  const key = 'device-pair:' + sha256_(request.ticket);
  if (request.action === 'pair_create') {
    if (!validEnvelope_(request.snapshot) || request.snapshot.ciphertext.length > 256) {
      return reply_({ ok: false, error: 'invalid_request' });
    }
    cache.put(key, JSON.stringify(request.snapshot), 300);
    return reply_({ ok: true });
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_({ ok: false, error: 'busy' });
  try {
    const snapshot = cache.get(key);
    if (!snapshot) return reply_({ ok: false, error: 'pair_expired' });
    cache.remove(key);
    return reply_({ ok: true, snapshot: JSON.parse(snapshot) });
  } finally {
    lock.releaseLock();
  }
}

function doPost(event) {
  const body = event && event.postData && event.postData.contents;
  if (typeof body !== 'string' || body.length > MAX_BODY) return reply_({ ok: false, error: 'invalid_request' });
  let request;
  try { request = JSON.parse(body); } catch (_) { return reply_({ ok: false, error: 'invalid_request' }); }
  if (request && request.action === 'pair_claim') return pairingRequest_(request);
  const properties = PropertiesService.getScriptProperties();
  if (request && request.action === 'owner_signin') return finishOwnerSignin_(request, properties);
  if (!authorized_(request && request.auth, properties.getProperty('HF_AUTH_SHA256'))) {
    return reply_({ ok: false, error: 'unauthorized' });
  }
  if (request.action === 'owner_enable') {
    const secret = request.archiveKey;
    if (typeof secret !== 'string' || !OWNER_TOKEN.test(secret) ||
        sha256_('home-finance authorization v1:' + secret) !== request.auth) {
      return reply_({ ok: false, error: 'unauthorized' });
    }
    properties.setProperty('HF_OWNER_ARCHIVE_KEY', secret);
    return reply_({ ok: true });
  }
  if (request.action === 'pair_create') return pairingRequest_(request);
  if (request.action !== 'load' && request.action !== 'save') return reply_({ ok: false, error: 'invalid_request' });
  if (request.action === 'save' && !validEnvelope_(request.snapshot)) return reply_({ ok: false, error: 'invalid_request' });
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply_({ ok: false, error: 'busy' });
  try {
    const { folder, file, current } = openDatabase_(properties);
    if (request.action === 'load') return reply_({ ok: true, database: current });
    if (request.expectedRevision !== (current && current.revision)) {
      return reply_({ ok: false, error: 'conflict' });
    }
    const next = { revision: Utilities.getUuid(), savedAt: new Date().toISOString(), snapshot: request.snapshot };
    const contents = JSON.stringify(next);
    if (file) file.setContent(contents);
    else folder.createFile(DATA_FILE_NAME, contents, 'application/json');
    return reply_({ ok: true, revision: next.revision });
  } catch (_) {
    return reply_({ ok: false, error: 'storage_error' });
  } finally {
    lock.releaseLock();
  }
}
