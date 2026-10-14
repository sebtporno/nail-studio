/* =========================================================
   seed.js — чтение/запись данных сайта.
   Демо-данные берутся из data/data.js (единый источник правды).
   ========================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, withTx } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, "..", "..", "data", "data.js");

function readDefaults() {
  let src;
  try { src = fs.readFileSync(DATA_FILE, "utf8"); }
  catch (e) { return { profile: {}, prices: [], works: [], news: [] }; }
  const m = src.match(/window\.DEFAULT_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!m) return { profile: {}, prices: [], works: [], news: [] };
  try { return JSON.parse(m[1]); }
  catch (e) { return { profile: {}, prices: [], works: [], news: [] }; }
}

async function insertData(c, d) {
  await c.query(
    "INSERT INTO settings(key, value) VALUES('profile', $1) " +
    "ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(d.profile || {})]
  );

  await c.query("DELETE FROM prices");
  await c.query("DELETE FROM works");
  await c.query("DELETE FROM news");

  let i = 0;
  for (const p of (d.prices || [])) {
    i++;
    await c.query(
      "INSERT INTO prices(id, category, name, price, note, sort) VALUES($1,$2,$3,$4,$5,$6)",
      [String(p.id || "p" + i), p.category || "", p.name || "", p.price || "", p.note || "", i]
    );
  }

  i = 0;
  for (const w of (d.works || [])) {
    i++;
    await c.query(
      "INSERT INTO works(id, title, category, image, description, date, sort) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [String(w.id || "w" + i), w.title || "", w.category || "", w.image || "", w.description || "", w.date || "", i]
    );
  }

  i = 0;
  for (const n of (d.news || [])) {
    i++;
    await c.query(
      "INSERT INTO news(id, title, date, image, text, sort) VALUES($1,$2,$3,$4,$5,$6)",
      [String(n.id || "n" + i), n.title || "", n.date || "", n.image || "", n.text || "", i]
    );
  }
}

export async function seedIfEmpty() {
  const { rows } = await query("SELECT count(*)::int AS n FROM settings WHERE key = 'profile'");
  if (rows[0].n > 0) return false;
  const d = readDefaults();
  await withTx((c) => insertData(c, d));
  return true;
}

export async function replaceData(d) {
  await withTx((c) => insertData(c, {
    profile: d.profile || {},
    prices: Array.isArray(d.prices) ? d.prices : [],
    works: Array.isArray(d.works) ? d.works : [],
    news: Array.isArray(d.news) ? d.news : [],
  }));
}

function parseJson(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return {}; } }
  return v;
}

export async function loadData() {
  const profileRes = await query("SELECT value FROM settings WHERE key = 'profile'");
  const pricesRes = await query("SELECT id, category, name, price, note FROM prices ORDER BY sort");
  const worksRes = await query("SELECT id, title, category, image, description, date FROM works ORDER BY sort");
  const newsRes = await query("SELECT id, title, date, image, text FROM news ORDER BY sort");
  return {
    version: 1,
    profile: profileRes.rows[0] ? parseJson(profileRes.rows[0].value) : {},
    prices: pricesRes.rows,
    works: worksRes.rows,
    news: newsRes.rows,
  };
}
