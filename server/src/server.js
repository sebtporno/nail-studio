/* =========================================================
   server.js — сайт студии маникюра + API.
   Node.js + Express + PostgreSQL.
   ========================================================= */
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import multer from "multer";

import { initDb, closeDb, query } from "./db.js";
import { ensureAdminUser, requireAuth, hashPassword, verifyPassword, signToken } from "./auth.js";
import { seedIfEmpty, loadData, replaceData } from "./seed.js";
import {
  getNotifySettings, setNotifySettings, maskToken,
  notifyNewBooking, sendTelegramMessage, findTelegramChat, telegramCall,
} from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");      // папка всего сайта
const UPLOADS = path.resolve(__dirname, "..", "uploads"); // куда кладём фото работ
fs.mkdirSync(UPLOADS, { recursive: true });

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));

/* ---------- необязательный CORS (если админка на другом домене) ---------- */
app.use((req, res, next) => {
  const origin = process.env.ALLOW_ORIGIN;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* =======================  API  ======================= */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "nail-atelier", time: new Date().toISOString() });
});

// Публичные данные сайта
app.get("/api/data", async (req, res, next) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(await loadData()); }
  catch (e) { next(e); }
});

// Вход
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Введите логин и пароль" });
    const { rows } = await query("SELECT * FROM admin_users WHERE username = $1", [String(username)]);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Неверный логин или пароль" });
    }
    res.json({ token: signToken(user), user: { id: user.id, username: user.username } });
  } catch (e) { next(e); }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.user.sub, username: req.user.username } });
});

// Данные для панели (те же, что публичные) + сохранение целиком
app.get("/api/admin/data", requireAuth, async (req, res, next) => {
  try { res.json(await loadData()); } catch (e) { next(e); }
});

app.put("/api/admin/data", requireAuth, async (req, res, next) => {
  try {
    const d = req.body || {};
    await replaceData(d);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Смена пароля
app.post("/api/admin/password", requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: "Пароль должен быть не короче 6 символов" });
    }
    await query("UPDATE admin_users SET password_hash = $1 WHERE id = $2", [hashPassword(password), req.user.sub]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Загрузка фото
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

function extFromMime(mime) {
  mime = String(mime || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return null;
}

app.post("/api/admin/upload", requireAuth, upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не получен" });
    const mime = String(req.file.mimetype || "").toLowerCase();
    const ext = extFromMime(mime);
    if (!ext) return res.status(400).json({ error: "Поддерживаются JPG, PNG и WEBP" });
    const id = "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8) + "." + ext;
    // Храним фото в базе — так оно не исчезнет при перезапуске сервера.
    await query("INSERT INTO media(id, mime, bytes) VALUES($1, $2, $3)", [id, mime, req.file.buffer]);
    res.json({ url: "/api/media/" + id });
  } catch (e) { next(e); }
});

// Отдача фото из базы (публично, с длинным кэшем).
function toBuffer(v) {
  if (v == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  if (typeof v === "string") return Buffer.from(v.replace(/^\\x/, ""), "hex");
  return Buffer.from(v);
}

app.get("/api/media/:id", async (req, res, next) => {
  try {
    const { rows } = await query("SELECT mime, bytes FROM media WHERE id = $1", [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "Не найдено" });
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(toBuffer(row.bytes));
  } catch (e) { next(e); }
});

// Заявки
app.post("/api/bookings", async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "Укажите имя" });
    const booking = {
      id: "b_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      phone: String(b.phone || "").trim(),
      service: String(b.service || "").trim(),
      date_text: String(b.date || "").trim(),
      comment: String(b.comment || "").trim(),
    };
    await query(
      "INSERT INTO bookings(id, name, phone, service, date_text, comment) VALUES($1,$2,$3,$4,$5,$6)",
      [booking.id, booking.name, booking.phone, booking.service, booking.date_text, booking.comment]
    );
    res.status(201).json({ ok: true, id: booking.id });
    // Уведомляем мастера в Telegram (не блокирует ответ клиенту).
    notifyNewBooking(booking).catch(() => {});
  } catch (e) { next(e); }
});

app.get("/api/admin/bookings", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT id, name, phone, service, date_text, comment, status, created_at FROM bookings ORDER BY created_at DESC");
    res.json({ bookings: rows });
  } catch (e) { next(e); }
});

app.delete("/api/admin/bookings/:id", requireAuth, async (req, res, next) => {
  try {
    await query("DELETE FROM bookings WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* =======================  Уведомления (Telegram)  ======================= */

async function notifyStatus() {
  const cfg = await getNotifySettings();
  const { token, chatId, enabled } = cfg.telegram;
  return {
    configured: Boolean(token && chatId),
    enabled,
    token: token ? maskToken(token) : "",
    chatId: chatId || "",
  };
}

app.get("/api/admin/notify", requireAuth, async (req, res, next) => {
  try { res.json({ telegram: await notifyStatus() }); } catch (e) { next(e); }
});

// Сохранить настройки (включить/выключить, задать chat_id)
app.put("/api/admin/notify", requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    await setNotifySettings({ token: b.token, chatId: b.chatId, enabled: b.enabled });
    res.json({ ok: true, telegram: await notifyStatus() });
  } catch (e) { next(e); }
});

// Подключить бота: проверить токен и найти chat_id по сообщению мастеру
app.post("/api/admin/notify/connect", requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    const given = b.token != null ? String(b.token).trim() : "";
    const saved = (await getNotifySettings()).telegram.token;
    const token = given && !given.includes("•") ? given : saved;
    if (!token) return res.status(400).json({ error: "Сначала вставьте токен бота" });

    // 1) Проверяем токен
    const me = await telegramCall("getMe", {}, token).catch(() => ({ ok: false }));
    if (!me.ok) {
      return res.json({ ok: false, message: "Токен не подошёл. Скопируйте его из @BotFather целиком." });
    }

    // 2) Ищем чат, куда писать (мастер должен был написать боту)
    let chat = null;
    try { chat = await findTelegramChat(token); }
    catch (e) { return res.json({ ok: false, message: e.message || "Не удалось получить сообщения бота" }); }

    if (!chat || chat.id == null) {
      // Токен верный — сохраним его, чтобы не вводить заново.
      await setNotifySettings({ token, enabled: true });
      return res.json({ ok: false, message: "Бот пока не получал сообщений. Откройте @" + (me.data.result.username || "бота") + " в Telegram, нажмите Start, напишите ему «привет» — и нажмите «Подключить» снова." });
    }

    await setNotifySettings({ token, chatId: String(chat.id), enabled: true });
    const chatName = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "чат";
    res.json({ ok: true, chatName, chatId: String(chat.id) });
  } catch (e) { next(e); }
});

// Тестовое сообщение
app.post("/api/admin/notify/test", requireAuth, async (req, res, next) => {
  try {
    const cfg = await getNotifySettings();
    if (!cfg.telegram.token || !cfg.telegram.chatId) {
      return res.json({ ok: false, message: "Сначала подключите бота." });
    }
    const r = await sendTelegramMessage("✅ Проверка связи: уведомления о заявках работают.");
    if (r.ok) return res.json({ ok: true });
    res.json({ ok: false, message: (r.data && r.data.description) || "Telegram не принял сообщение." });
  } catch (e) { next(e); }
});

/* =======================  Файлы сайта  ======================= */
// Отдаём только нужные папки — служебные файлы сервера наружу не попадают.
app.use("/assets", express.static(path.join(ROOT, "assets")));
app.use("/data", express.static(path.join(ROOT, "data")));
app.use("/uploads", express.static(UPLOADS));

app.get(["/", "/index.html"], (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/admin.html", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));

app.use("/api", (req, res) => res.status(404).json({ error: "Не найдено" }));

app.use((err, req, res, next) => {
  console.error(err);
  const code = err && err.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  res.status(code).json({ error: code === 413 ? "Файл слишком большой (макс. 12 МБ)" : "Ошибка сервера" });
});

/* =======================  Запуск  ======================= */
export async function init() {
  const kind = await initDb();
  await ensureAdminUser();
  const seeded = await seedIfEmpty();
  return { kind, seeded };
}

export async function start(port = process.env.PORT || 3000) {
  const { kind, seeded } = await init();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const url = "http://localhost:" + server.address().port;
      console.log("\n  Сайт студии запущен:");
      console.log("    " + url + "         — сам сайт");
      console.log("    " + url + "/admin.html  — панель мастера");
      console.log("  База данных: " + (kind === "postgres" ? "PostgreSQL" : "встроенная (Postgres)") + (seeded ? ", загружены демо-данные" : ""));
      console.log("");
      console.log("  Это окно не закрывайте, пока пользуетесь сайтом.");
      console.log("");
      resolve(server);
    });
  });
}

export { app, closeDb };

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  start().catch((e) => { console.error(e); process.exit(1); });
}
