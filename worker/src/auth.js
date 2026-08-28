// Identity.
//
// Two ways in, one player row:
//
//   guest   — the client generates a UUID once and keeps it. No personal data
//             at all. Lets someone play and hold a score before deciding to
//             sign in, which is the difference between a leaderboard people
//             join and one they bounce off.
//
//   google  — the client obtains a Google ID token (Play Games / Google Sign-In
//             on Android, Google Identity Services on web) and posts it here.
//             We verify the signature ourselves and issue our own session.
//
// We store the Google subject identifier and nothing else. Not the email
// address: we do not need it, and every field we decline to hold is one fewer
// on the Data Safety form and one fewer in any future breach.

import { b64urlEncode, b64urlDecode, enc, dec, HttpError } from './http.js';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISS = ['https://accounts.google.com', 'accounts.google.com'];
const SESSION_TTL_S = 60 * 60 * 24 * 90; // 90 days; a game is not a bank

// Per-isolate JWKS cache. Isolates are short-lived, so this is a courtesy to
// Google rather than a correctness mechanism.
let jwksCache = { keys: null, expires: 0 };

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Session token: v1.<payload>.<sig>. Compact, stateless, and revocable by rotating the secret. */
export async function issueSession(playerId, env, nowS = Math.floor(Date.now() / 1000)) {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ p: playerId, e: nowS + SESSION_TTL_S })));
  const key = await hmacKey(env.SESSION_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `v1.${payload}.${b64urlEncode(sig)}`;
}

/**
 * Verify and decode a session token. Uses crypto.subtle.verify rather than
 * comparing strings, so the comparison is constant-time.
 */
export async function readSession(token, env, nowS = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, payload, sig] = parts;

  let ok = false;
  try {
    const key = await hmacKey(env.SESSION_SECRET);
    ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const body = JSON.parse(dec.decode(b64urlDecode(payload)));
    if (!body || typeof body.p !== 'string' || typeof body.e !== 'number') return null;
    if (body.e <= nowS) return null;
    return { playerId: body.p, expires: body.e };
  } catch {
    return null;
  }
}

/** Pull the bearer token off a request. */
export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

async function fetchJwks() {
  const now = Date.now();
  if (jwksCache.keys && jwksCache.expires > now) return jwksCache.keys;

  const res = await fetch(GOOGLE_JWKS);
  if (!res.ok) throw new HttpError(503, 'jwks_unavailable', 'Could not reach the identity provider.');
  const body = await res.json();

  // Respect Google's own cache lifetime; fall back to an hour.
  const cc = res.headers.get('cache-control') || '';
  const maxAge = Number((cc.match(/max-age=(\d+)/) || [])[1]) || 3600;
  jwksCache = { keys: body.keys, expires: now + maxAge * 1000 };
  return body.keys;
}

/**
 * Verify a Google ID token and return its subject.
 *
 * Checks the signature against Google's published keys, then issuer, audience
 * and expiry. An unverified `sub` is just a string a caller chose, so all four
 * checks are mandatory.
 */
export async function verifyGoogleIdToken(idToken, env) {
  if (typeof idToken !== 'string' || idToken.split('.').length !== 3) {
    throw new HttpError(400, 'bad_id_token', 'Malformed identity token.');
  }
  const [headerB64, payloadB64, sigB64] = idToken.split('.');

  let header;
  let claims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(headerB64)));
    claims = JSON.parse(dec.decode(b64urlDecode(payloadB64)));
  } catch {
    throw new HttpError(400, 'bad_id_token', 'Malformed identity token.');
  }
  if (header.alg !== 'RS256') {
    throw new HttpError(400, 'bad_id_token', 'Unexpected token algorithm.');
  }

  const keys = await fetchJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'unknown_key', 'Identity token was not signed by a known key.');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(sigB64),
    enc.encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) throw new HttpError(401, 'bad_signature', 'Identity token signature did not verify.');

  if (!GOOGLE_ISS.includes(claims.iss)) {
    throw new HttpError(401, 'bad_issuer', 'Identity token came from the wrong issuer.');
  }

  // Android and web use different OAuth client IDs; both are legitimate.
  const audiences = (env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (audiences.length === 0) {
    throw new HttpError(500, 'not_configured', 'Sign-in is not configured on this server.');
  }
  if (!audiences.includes(claims.aud)) {
    throw new HttpError(401, 'bad_audience', 'Identity token was issued for a different application.');
  }

  const nowS = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowS) {
    throw new HttpError(401, 'expired', 'Identity token has expired.');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new HttpError(401, 'bad_subject', 'Identity token carried no subject.');
  }

  // `name` is used only as a default display name and is sanitised downstream.
  return { sub: claims.sub, name: typeof claims.name === 'string' ? claims.name : null };
}

/** Display names are shown to other players, so they are bounded and stripped. */
export function cleanName(raw, fallback = 'Dove') {
  if (typeof raw !== 'string') return fallback;
  const s = raw.replace(/[\p{C}]/gu, '').trim().slice(0, 24);
  return s.length >= 1 ? s : fallback;
}
