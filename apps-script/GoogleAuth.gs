const GOOGLE_REDIRECT = 'https://madnash00.github.io/home-finance/';
const GOOGLE_SESSION_SECONDS = 30 * 24 * 60 * 60;

function googleConfig_(properties) {
  return {
    clientId: properties.getProperty('HF_GOOGLE_CLIENT_ID'),
    clientSecret: properties.getProperty('HF_GOOGLE_CLIENT_SECRET'),
    email: properties.getProperty('HF_GOOGLE_OWNER'),
  };
}

function equalText_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function googleSessionSignature_(payload, config) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(
    'home-finance/google-session/v1:' + config.clientId + ':' + config.email + ':' + payload,
    config.clientSecret
  )).replace(/=+$/, '');
}

function validGoogleSession_(value, config) {
  if (!config.clientId || !config.clientSecret || !config.email ||
      typeof value !== 'string' || !/^\d{10}\.[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const [expires, id, signature] = value.split('.');
  const now = Math.floor(Date.now() / 1000);
  return +expires > now && +expires <= now + GOOGLE_SESSION_SECONDS &&
    equalText_(signature, googleSessionSignature_(expires + '.' + id, config));
}

function googleLogin_(request, properties, config) {
  if (!config.clientId || !config.clientSecret || !config.email) {
    return reply_({ ok: false, error: 'google_unavailable' });
  }
  if (typeof request.code !== 'string' || request.code.length > 2048 ||
      typeof request.verifier !== 'string' || !/^[a-f0-9]{64}$/.test(request.verifier) ||
      typeof request.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(request.nonce)) {
    return reply_({ ok: false, error: 'invalid_request' });
  }
  let claims;
  try {
    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      followRedirects: false,
      muteHttpExceptions: true,
      payload: {
        code: request.code, code_verifier: request.verifier, client_id: config.clientId,
        client_secret: config.clientSecret, redirect_uri: GOOGLE_REDIRECT, grant_type: 'authorization_code',
      },
    });
    if (response.getResponseCode() !== 200) return reply_({ ok: false, error: 'google_signin_failed' });
    // The ID token comes directly from Google's token endpoint over TLS.
    const encoded = JSON.parse(response.getContentText()).id_token.split('.')[1];
    claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8'));
  } catch (_) {
    return reply_({ ok: false, error: 'google_signin_failed' });
  }
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      claims.aud !== config.clientId || (claims.azp && claims.azp !== config.clientId) ||
      !(Number(claims.exp) > Date.now() / 1000) || claims.nonce !== request.nonce ||
      claims.email_verified !== true || claims.email !== config.email || typeof claims.sub !== 'string' || !claims.sub) {
    return reply_({ ok: false, error: 'google_account_denied' });
  }
  const owner = properties.getProperty('HF_GOOGLE_OWNER_SUB');
  if (owner && owner !== claims.sub) return reply_({ ok: false, error: 'google_account_denied' });
  let archiveKey = properties.getProperty('HF_GOOGLE_ARCHIVE_KEY');
  if (!archiveKey) {
    const candidate = request.archiveKey;
    if (typeof candidate !== 'string' || !/^[a-f0-9]{64}$/.test(candidate) ||
        !authorized_(sha256_('home-finance authorization v1:' + candidate), properties.getProperty('HF_AUTH_SHA256'))) {
      return reply_({ ok: false, error: 'google_archive_setup' });
    }
    archiveKey = candidate;
    properties.setProperties({ HF_GOOGLE_ARCHIVE_KEY: archiveKey, HF_GOOGLE_OWNER_SUB: claims.sub });
  }
  const expires = Math.floor(Date.now() / 1000) + GOOGLE_SESSION_SECONDS;
  const session = expires + '.' + Utilities.getUuid();
  return reply_({ ok: true, session: session + '.' + googleSessionSignature_(session, config), expires, archiveKey });
}
