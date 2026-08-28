// A faithful-enough D1 binding backed by node:sqlite.
//
// D1 *is* SQLite, so this exercises the real schema, the real SQL (numbered
// ?N parameters and ON CONFLICT ... WHERE clauses included) and the real Worker
// entry point. It is not a mock of our own code — only of Cloudflare's
// transport — which is the difference between testing the API and testing the
// test.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    // SQLite binds ?N by index, so passing values in order is correct even
    // where a statement reuses ?5 or mentions ?1 after ?2.
    this.args = args.map((v) => (v === undefined ? null : v));
    return this;
  }

  #prepared() {
    return this.db.prepare(this.sql);
  }

  async first() {
    const row = this.#prepared().get(...this.args);
    return row === undefined ? null : row;
  }

  async all() {
    return { results: this.#prepared().all(...this.args) };
  }

  async run() {
    const r = this.#prepared().run(...this.args);
    return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of ['0001_init.sql', '0002_identity.sql', '0003_respawns.sql']) {
    db.exec(readFileSync(join(here, '..', 'schema', f), 'utf8'));
  }
  return {
    prepare: (sql) => new Stmt(db, sql),
    // D1 runs a batch as one transaction; node:sqlite gives us the real thing.
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const st of statements) out.push(await st.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    _raw: db,
  };
}

export function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    SESSION_SECRET: 'integration-test-secret-0123456789',
    GOOGLE_CLIENT_IDS: 'test-client-id.apps.googleusercontent.com',
    ALLOWED_ORIGINS: 'https://dovefall.pages.dev',
    ...overrides,
  };
}

/** Call the Worker exactly as Cloudflare would. */
export async function call(worker, env, method, path, { body, token, origin } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (origin) headers.origin = origin;

  const res = await worker.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    {},
  );

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON responses are reported as raw text below */
  }
  return { status: res.status, headers: res.headers, json, text };
}
