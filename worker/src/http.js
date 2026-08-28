// Small HTTP helpers. No framework — the router in index.js is thirty lines and
// a dependency here would be larger than the thing it replaces.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * CORS. The web build is served from Pages on a different origin to the Worker,
 * so this is load-bearing rather than decorative. Origins are an allow-list from
 * config, never `*` — the API carries a session token and `*` with credentials
 * is both refused by browsers and wrong in principle.
 */
export function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  const h = {
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
  // Native builds (Android) send no Origin header; browsers always do.
  if (origin && allowed.includes(origin)) h['access-control-allow-origin'] = origin;
  return h;
}

export function json(data, { status = 200, request, env, headers = {} } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...(request ? corsHeaders(request, env) : {}),
      ...headers,
    },
  });
}

export function fail(status, code, message, ctx) {
  return json({ error: code, message }, { ...ctx, status });
}

export async function readJson(request, maxBytes = 16 * 1024) {
  const raw = await request.text();
  if (raw.length > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large.');
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw new HttpError(400, 'bad_json', 'Expected a JSON object.');
    }
    return v;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad_json', 'Body was not valid JSON.');
  }
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function b64urlEncode(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();
