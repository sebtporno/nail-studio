/* =========================================================
   notify.js — уведомления мастеру о новых заявках в Telegram.
   Настройки (токен бота и chat_id) хранятся в таблице settings
   под ключом 'notify'. Если их там нет — берутся из переменных
   окружения TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.
   ========================================================= */
import { query } from "./db.js";

const apiBase = () => process.env.TELEGRAM_API_BASE || "https://api.telegram.org";
const envToken = () => process.env.TELEGRAM_BOT_TOKEN || "";
const envChat = () => process.env.TELEGRAM_CHAT_ID || "";

function parseValue(v) {
  if (v == null) return {};
  if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return {}; } }
  return v;
}

/* ---------- настройки ---------- */

export async function getNotifySettings() {
  let value = {};
  try {
    const { rows } = await query("SELECT value FROM settings WHERE key = 'notify'");
    value = rows[0] ? parseValue(rows[0].value) : {};
  } catch (e) { value = {}; }
  const tg = (value && value.telegram) || {};
  return {
    telegram: {
      token: tg.token || envToken(),
      chatId: tg.chatId || envChat(),
      enabled: tg.enabled !== false,
    },
  };
}

function looksMasked(t) { return typeof t === "string" && (t === "" || t.includes("•") || t.includes("*")); }

export async function setNotifySettings(patch = {}) {
  const cur = await getNotifySettings();
  const next = {
    telegram: {
      // Пустое или «замаскированное» значение не затирает сохранённый токен.
      token: looksMasked(patch.token) ? cur.telegram.token : String(patch.token).trim(),
      chatId: patch.chatId == null ? cur.telegram.chatId : String(patch.chatId).trim(),
      enabled: patch.enabled == null ? cur.telegram.enabled : !!patch.enabled,
    },
  };
  await query(
    "INSERT INTO settings(key, value) VALUES('notify', $1) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify(next)]
  );
  return next;
}

export function maskToken(token) {
  if (!token) return "";
  return "••••••" + String(token).slice(-4);
}

/* ---------- HTTP к Telegram ---------- */

async function postJson(url, body, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok && (!data || data.ok !== false), status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function telegramCall(method, payload, token) {
  if (!token) token = (await getNotifySettings()).telegram.token;
  if (!token) throw new Error("Не задан токен бота");
  return postJson(`${apiBase()}/bot${token}/${method}`, payload || {});
}

/* ---------- текст сообщения ---------- */

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function formatBooking(b) {
  b = b || {};
  const lines = ["💅 <b>Новая заявка с сайта</b>", ""];
  lines.push("<b>Имя:</b> " + escapeHtml(b.name || "—"));
  if (b.phone) lines.push("<b>Телефон:</b> " + escapeHtml(b.phone));
  if (b.service) lines.push("<b>Услуга:</b> " + escapeHtml(b.service));
  if (b.date_text) lines.push("<b>Удобное время:</b> " + escapeHtml(b.date_text));
  if (b.comment) lines.push("<b>Комментарий:</b> " + escapeHtml(b.comment));
  return lines.join("\n");
}

/* ---------- отправка ---------- */

export async function sendTelegramMessage(text, opts = {}) {
  const cfg = opts.token ? null : await getNotifySettings();
  const token = opts.token || cfg.telegram.token;
  const chatId = opts.chatId || cfg.telegram.chatId;
  if (!token || !chatId) return { ok: false, reason: "not-configured" };
  return postJson(`${apiBase()}/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

// Уведомление мастеру о новой заявке. Никогда не бросает исключение.
export async function notifyNewBooking(b) {
  try {
    const cfg = await getNotifySettings();
    if (!cfg.telegram.enabled || !cfg.telegram.token || !cfg.telegram.chatId) {
      return { ok: false, reason: "off" };
    }
    const r = await sendTelegramMessage(formatBooking(b));
    if (!r.ok) console.warn("[notify] Telegram ответил:", r.status, r.data && r.data.description);
    return r;
  } catch (e) {
    console.warn("[notify] не удалось отправить уведомление:", e.message);
    return { ok: false, error: e.message };
  }
}

// Находит chat_id по последнему сообщению боту (мастер должен написать боту).
export async function findTelegramChat(token) {
  const r = await telegramCall("getUpdates", {}, token);
  if (!r.ok) {
    const desc = (r.data && r.data.description) || "Не удалось получить сообщения от бота";
    const err = new Error(desc);
    err.status = r.status;
    err.telegram = r.data;
    throw err;
  }
  const updates = (r.data && r.data.result) || [];
  let chat = null;
  for (const u of updates) {
    const m = u.message || u.edited_message || u.channel_post || u.my_chat_member;
    if (m && m.chat && m.chat.id != null) chat = m.chat;
  }
  return chat;
}
