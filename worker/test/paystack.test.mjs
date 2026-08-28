// Paid respawns. Nothing the client says about payment is believed — the
// webhook, signed by Paystack, is the only path to a balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/index.js';
import { makeEnv, call } from './harness.mjs';
import { normalisePayCode, mintPayCode, judgeCharge, extractPayCode } from '../src/paystack.js';

const DEVICE = '11111111-1111-1111-1111-111111111111';
const SECRET = 'sk_test_not_a_real_key';

function envWithPay() {
  return makeEnv({ PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_LINK: 'https://paystack.shop/pay/dovefall' });
}

async function guest(env) {
  const r = await call(worker, env, 'POST', '/v1/auth/guest', { body: { device_id: DEVICE, name: 'Payer' } });
  return r.json;
}

/** POST to the webhook exactly as Paystack does: raw body, HMAC-SHA512 hex header. */
async function webhook(env, payload, { badSig = false } = {}) {
  const raw = JSON.stringify(payload);
  const sig = badSig
    ? 'ab'.repeat(64)
    : createHmac('sha512', SECRET).update(raw).digest('hex');
  const res = await worker.fetch(
    new Request('https://api.test/v1/paystack/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': sig },
      body: raw,
    }),
    env,
    {},
  );
  return { status: res.status, json: JSON.parse(await res.text()) };
}

function charge({ reference = 'ref_1', amount = 5000, currency = 'KES', code = null, fieldName = 'player_code' } = {}) {
  return {
    event: 'charge.success',
    data: {
      reference,
      amount,
      currency,
      metadata: code === null ? {} : {
        custom_fields: [{ display_name: 'Player code', variable_name: fieldName, value: code }],
      },
    },
  };
}

async function payCodeFor(env, token) {
  const r = await call(worker, env, 'GET', '/v1/respawns', { token });
  assert.equal(r.status, 200, r.text);
  return r.json.pay_code;
}

// ------------------------------------------------------------------ codes

test('the respawn endpoint mints a stable pay code and names the link', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const first = await call(worker, env, 'GET', '/v1/respawns', { token });
  assert.equal(first.status, 200);
  assert.match(first.json.pay_code, /^[0-9A-HJKMNP-TV-Z]{8}$/);
  assert.equal(first.json.balance, 0);
  assert.equal(first.json.pay_link, 'https://paystack.shop/pay/dovefall');
  assert.equal(first.json.per_payment, 3);
  assert.equal(first.json.min_kes, 50);

  const second = await call(worker, env, 'GET', '/v1/respawns', { token });
  assert.equal(second.json.pay_code, first.json.pay_code, 'the code must not churn between reads');
});

test('pay codes forgive the same transcription slips as recovery codes', () => {
  assert.equal(normalisePayCode('abcd-2345'), 'ABCD2345');
  assert.equal(normalisePayCode('ABCD 23 45'), 'ABCD2345');
  assert.equal(normalisePayCode('0OIL2345'), '00112345');
  assert.equal(normalisePayCode('short'), null);
  assert.equal(normalisePayCode(null), null);
  for (let i = 0; i < 200; i++) {
    const c = mintPayCode();
    assert.equal(normalisePayCode(c), c, `minted code failed its own normalisation: ${c}`);
  }
});

// ------------------------------------------------------------------ webhook

test('a signed qualifying payment credits three respawns', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);

  const r = await webhook(env, charge({ code, amount: 5000 }));
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'credited');

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.player.respawns, 3);
});

test('a replayed webhook does not credit twice', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);

  await webhook(env, charge({ code, reference: 'ref_dup' }));
  const again = await webhook(env, charge({ code, reference: 'ref_dup' }));
  assert.equal(again.json.duplicate, true);

  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.player.respawns, 3, 'the retry must not double-credit');
});

test('two payments stack to six', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);
  await webhook(env, charge({ code, reference: 'ref_a' }));
  await webhook(env, charge({ code, reference: 'ref_b', amount: 12000 }));
  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.player.respawns, 6);
});

test('a bad signature is refused before anything is read', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);
  const r = await webhook(env, charge({ code }), { badSig: true });
  assert.equal(r.status, 401);
  const me = await call(worker, env, 'GET', '/v1/me', { token });
  assert.equal(me.json.player.respawns, 0);
});

test('below the KES 50 floor: recorded, not credited', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);
  const r = await webhook(env, charge({ code, amount: 4999, reference: 'ref_low' }));
  assert.equal(r.json.status, 'below_min');
  const row = env.DB._raw.prepare('SELECT status, amount FROM payments WHERE reference = ?').get('ref_low');
  assert.equal(row.status, 'below_min');
  assert.equal(row.amount, 4999);
});

test('a non-KES charge is recorded, not credited', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);
  const r = await webhook(env, charge({ code, currency: 'USD', reference: 'ref_usd' }));
  assert.equal(r.json.status, 'wrong_currency');
});

test('an unknown or missing code is recorded for manual rescue', async () => {
  const env = envWithPay();
  await guest(env);
  const r = await webhook(env, charge({ code: 'ZZZZZZZZ', reference: 'ref_lost' }));
  assert.equal(r.json.status, 'no_player');
  const row = env.DB._raw.prepare('SELECT raw_code, player_id FROM payments WHERE reference = ?').get('ref_lost');
  assert.equal(row.raw_code, 'ZZZZZZZZ');
  assert.equal(row.player_id, null);

  const none = await webhook(env, charge({ reference: 'ref_nocode' }));
  assert.equal(none.json.status, 'no_player');
});

test('the code survives being typed into a differently named field', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);
  const r = await webhook(env, charge({ code: code.toLowerCase(), fieldName: 'gamer_id', reference: 'ref_field' }));
  assert.equal(r.json.status, 'credited');
});

test('other events are acknowledged and ignored', async () => {
  const env = envWithPay();
  const r = await webhook(env, { event: 'transfer.success', data: {} });
  assert.equal(r.status, 200);
  assert.equal(r.json.ignored, true);
});

test('with no secret configured the webhook refuses rather than trusting', async () => {
  const env = makeEnv();
  const res = await worker.fetch(
    new Request('https://api.test/v1/paystack/webhook', { method: 'POST', body: '{}' }),
    env,
    {},
  );
  assert.equal(res.status, 503);
});

// ------------------------------------------------------------------ spending

test('spending walks the balance down and then refuses', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const code = await payCodeFor(env, token);
  await webhook(env, charge({ code }));

  for (const expect of [2, 1, 0]) {
    const r = await call(worker, env, 'POST', '/v1/respawns/spend', { token });
    assert.equal(r.status, 200);
    assert.equal(r.json.balance, expect);
  }
  const broke = await call(worker, env, 'POST', '/v1/respawns/spend', { token });
  assert.equal(broke.status, 409);
});

test('a run continued with a respawn is not ranked', async () => {
  const env = envWithPay();
  const { token } = await guest(env);
  const r = await call(worker, env, 'POST', '/v1/runs', {
    token,
    body: { mode: 'normal', score: 40, duration_ms: 80_000, seed: 'D0FE', respawn_used: true },
  });
  assert.equal(r.status, 422);
  assert.equal(r.json.reason, 'continued');
});

// ------------------------------------------------------------------ pure judge

test('judgeCharge decides in the right order and reports what it saw', () => {
  assert.equal(judgeCharge({ reference: 'r', amount: 5000, currency: 'KES' }).status, 'no_player');
  assert.equal(judgeCharge({ reference: 'r', amount: 100, currency: 'USD' }).status, 'wrong_currency');
  assert.equal(judgeCharge({ reference: 'r', amount: 10, currency: 'KES' }).status, 'below_min');
  assert.equal(judgeCharge({}).reference, null);
  const { code } = extractPayCode({ metadata: { player_code: 'abcd2345' } });
  assert.equal(code, 'ABCD2345');
});
