// The migrations wrangler will apply are the migrations the tests exercise.
//
// They were not, once. The SQL lived in worker/schema/, wrangler defaults to
// worker/migrations/, and nothing connected the two — so `d1 migrations apply`
// exited with "No migrations present" while `wrangler deploy` succeeded, and
// the API went live against an empty database. Both commands behaved
// correctly; nobody had told them about each other.
//
// No test could have caught it by running SQL, because the tests read the
// files directly. It needed a test that reads the CONFIG.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('wrangler is pointed at the directory that actually holds the schema', () => {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const m = /^\s*migrations_dir\s*=\s*"([^"]+)"/m.exec(toml);
  assert.ok(m, 'wrangler.toml must set migrations_dir, or `d1 migrations apply` finds nothing');

  const dir = join(ROOT, m[1]);
  assert.ok(existsSync(dir), `migrations_dir points at ${m[1]}, which does not exist`);

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.length > 0, `${m[1]} contains no .sql files`);
  for (const f of files) {
    assert.match(f, /^\d{4}_[a-z0-9_]+\.sql$/, `${f} is not a numbered migration`);
  }

  // Numbered without gaps, so wrangler applies them in the intended order.
  files.forEach((f, i) => {
    assert.equal(Number(f.slice(0, 4)), i + 1, `${f} is out of sequence`);
  });
});

test('the schema creates every table the Worker reads', () => {
  const toml = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');
  const dir = join(ROOT, /^\s*migrations_dir\s*=\s*"([^"]+)"/m.exec(toml)[1]);
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');

  for (const table of ['players', 'bests', 'daily', 'saves', 'rejects', 'payments', 'devices', 'ops']) {
    assert.match(sql, new RegExp(`CREATE TABLE (IF NOT EXISTS )?${table}\\b`), `no CREATE TABLE for ${table}`);
  }
});
