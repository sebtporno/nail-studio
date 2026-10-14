/* =========================================================
   db.js — подключение к базе данных.
   Продакшен: PostgreSQL (DATABASE_URL).
   Локально без Postgres: встроенная PGlite (та же Postgres, WASM).
   ========================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

let impl = null;

async function initPostgres(url) {
  const pg = await import("pg");
  const pool = new pg.default.Pool({
    connectionString: url,
    ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  return {
    kind: "postgres",
    query: (text, params) => pool.query(text, params),
    exec: (sql) => pool.query(sql),
    async getClient() {
      const c = await pool.connect();
      return { query: (text, params) => c.query(text, params), release: () => c.release() };
    },
    close: () => pool.end(),
  };
}

async function initPglite() {
  let PGlite;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch (e) {
    throw new Error(
      "PostgreSQL не настроен (нет DATABASE_URL), а встроенная база не установлена.\n" +
      "Выполните в папке server:  npm install"
    );
  }
  const dir = process.env.PGLITE_DIR === "false" ? null : path.join(__dirname, "..", ".pgdata");
  const pg = dir ? new PGlite(dir) : new PGlite();
  await pg.waitReady;
  return {
    kind: "pglite",
    query: (text, params) => pg.query(text, params),
    exec: (sql) => pg.exec(sql),
    async getClient() {
      return { query: (text, params) => pg.query(text, params), release() {} };
    },
    close: () => pg.close(),
  };
}

export async function initDb() {
  const url = process.env.DATABASE_URL;
  impl = url ? await initPostgres(url) : await initPglite();
  await impl.exec(SCHEMA);
  return impl.kind;
}

export function db() {
  if (!impl) throw new Error("База данных ещё не инициализирована: вызовите initDb()");
  return impl;
}

export function query(text, params) {
  return db().query(text, params);
}

export async function withTx(fn) {
  const client = await db().getClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (impl) { await impl.close(); impl = null; }
}
