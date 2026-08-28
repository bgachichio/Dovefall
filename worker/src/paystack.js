// Paystack webhook handling.
//
// The player pays on the hosted page (PAYSTACK_LINK — a static link, no API
// call from the game). Paystack then POSTs charge.success here. Everything
// that grants a respawn happens in this file, server-side, off the webhook:
// nothing the client says about payment is ever believed.
//
// Signature: Paystack signs the raw body with HMAC-SHA512 under the account's
// secret key and sends the hex in x-paystack-signature. We verify with
// crypto.subtle.verify, which is constant-time.

import { enc } from './http.js';

/** KES uses cents at Paystack: KES 50.00 = 5000 subunits. */
export const DEFAULT_MIN_SUBUNITS = 5000;
export const RESPAWNS_PER_PAYMENT = 3;
export const CURRENCY = 'KES';

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function verifyPaystackSignature(rawBody, signatureHex, secretKey) {
  const sig = hexToBytes(signatureHex);
  if (!sig || sig.length !== 64) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(rawBody));
}

/**
 * Pay codes are 8 Crockford base32 characters, same alphabet and the same
 * forgiveness as recovery codes: O reads as 0, I and L as 1, because the code
 * is typed into a checkout field on a phone.
 */
export function normalisePayCode(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(s) ? s : null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function mintPayCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < 8; i++) s += CROCKFORD[bytes[i] & 31];
  return s;
}

/**
 * Find the player code in a charge.success payload.
 *
 * A hosted payment page delivers custom fields as
 * data.metadata.custom_fields: [{display_name, variable_name, value}]. We
 * prefer a field named player_code but accept any custom field whose value
 * normalises to a valid code — the page's field name is configured by hand in
 * the Paystack dashboard, and this survives it being named something else.
 */
export function extractPayCode(data) {
  const meta = data?.metadata;
  const candidates = [];
  if (meta && typeof meta === 'object') {
    if (typeof meta.player_code === 'string') candidates.push(meta.player_code);
    if (Array.isArray(meta.custom_fields)) {
      for (const f of meta.custom_fields) {
        if (f && f.variable_name === 'player_code' && typeof f.value === 'string') {
          candidates.unshift(f.value);
        } else if (f && typeof f.value === 'string') {
          candidates.push(f.value);
        }
      }
    }
  }
  for (const c of candidates) {
    const code = normalisePayCode(c);
    if (code) return { code, raw: c };
  }
  return { code: null, raw: candidates[0] ?? null };
}

/**
 * Judge a charge.success payload. Pure — no I/O — so it is exhaustively
 * testable. Returns { status, code, raw, amount, currency, reference }.
 */
export function judgeCharge(data, minSubunits = DEFAULT_MIN_SUBUNITS) {
  const reference = typeof data?.reference === 'string' ? data.reference : null;
  const amount = Number(data?.amount);
  const currency = typeof data?.currency === 'string' ? data.currency.toUpperCase() : '';
  const { code, raw } = extractPayCode(data);

  let status = 'credited';
  if (currency !== CURRENCY) status = 'wrong_currency';
  else if (!Number.isFinite(amount) || amount < minSubunits) status = 'below_min';
  else if (!code) status = 'no_player';

  return { status, code, raw, amount: Number.isFinite(amount) ? amount : null, currency, reference };
}
