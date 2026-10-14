/* =========================================================
   Тесты API. Запуск: npm test
   База — встроенная Postgres (PGlite), ничего ставить не нужно.
   ========================================================= */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.PGLITE_DIR = "false";
process.env.JWT_SECRET = "test-secret-key";
process.env.ADMIN_USER = "admin";
process.env.ADMIN_PASSWORD = "testpass123";
delete process.env.DATABASE_URL;
delete process.env.ALLOW_ORIGIN;
// Настройки Telegram должны браться из базы (панели), а не из окружения.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.resolve(__dirname, "..", "uploads");

const { app, init, closeDb } = await import("../src/server.js");
// server.js подгружает server/.env — обнуляем, чтобы в тестах не было реальных получателей
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

let server;
let base = "";
let token = "";
const createdFiles = [];

/* ---- локальная заглушка Telegram API (вместо api.telegram.org) ---- */
let tgServer;
const tgCalls = [];
let tgGetMe = { ok: true, result: { id: 1, username: "test_report_bot", first_name: "Test" } };
let tgUpdates = { ok: true, result: [] };

test.before(async () => {
  await new Promise((resolve) => {
    tgServer = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let payload = {};
        try { payload = JSON.parse(raw || "{}"); } catch (e) {}
        const method = (req.url || "").split("?")[0].split("/").pop();
        tgCalls.push({ method, payload, url: req.url });
        let out = { ok: true, result: { message_id: tgCalls.length } };
        if (method === "getMe") out = tgGetMe;
        else if (method === "getUpdates") out = tgUpdates;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(out));
      });
    });
    tgServer.listen(0, () => {
      process.env.TELEGRAM_API_BASE = "http://127.0.0.1:" + tgServer.address().port;
      resolve();
    });
  });

  await init();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = "http://127.0.0.1:" + server.address().port;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (tgServer) await new Promise((resolve) => tgServer.close(resolve));
  for (const f of createdFiles) { try { fs.unlinkSync(path.join(UPLOADS, f)); } catch (e) {} }
  await closeDb();
});

const j = (r) => r.json();
const auth = () => ({ Authorization: "Bearer " + token });

test("health отдаёт ok", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.equal(d.ok, true);
});

test("публичные данные содержат профиль и списки", async () => {
  const r = await fetch(base + "/api/data");
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.ok(d.profile && typeof d.profile === "object");
  assert.ok(d.profile.brand, "есть название");
  assert.ok(Array.isArray(d.prices) && d.prices.length > 0);
  assert.ok(Array.isArray(d.works));
  assert.ok(Array.isArray(d.news));
});

test("вход с неверным паролем отклоняется", async () => {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "nope" }),
  });
  assert.equal(r.status, 401);
});

test("вход с верным паролем выдаёт токен", async () => {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123" }),
  });
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.ok(d.token, "есть токен");
  token = d.token;

  const me = await fetch(base + "/api/auth/me", { headers: auth() });
  assert.equal(me.status, 200);
  const md = await j(me);
  assert.equal(md.user.username, "admin");
});

test("сохранение данных без входа запрещено", async () => {
  const r = await fetch(base + "/api/admin/data", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: {} }),
  });
  assert.equal(r.status, 401);
});

test("мастер может сохранить и прочитать данные", async () => {
  const before = await j(await fetch(base + "/api/data"));
  const payload = {
    profile: Object.assign({}, before.profile, { brand: "Тестовая Студия" }),
    prices: [{ id: "px1", category: "Маникюр", name: "Тест", price: "100 ₽", note: "" }],
    works: [{ id: "wx1", title: "Работа", category: "Дизайн", image: "assets/img/work1.svg", description: "", date: "2026-01-01" }],
    news: [{ id: "nx1", title: "Новость", date: "2026-01-02", image: "", text: "Текст" }],
  };
  const put = await fetch(base + "/api/admin/data", {
    method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, auth()),
    body: JSON.stringify(payload),
  });
  assert.equal(put.status, 200);

  const after = await j(await fetch(base + "/api/data"));
  assert.equal(after.profile.brand, "Тестовая Студия");
  assert.equal(after.prices.length, 1);
  assert.equal(after.prices[0].name, "Тест");
  assert.equal(after.works[0].title, "Работа");
  assert.equal(after.news[0].title, "Новость");
});

test("загрузка фото без входа запрещена", async () => {
  const fd = new FormData();
  fd.append("image", new Blob([Buffer.from([1, 2, 3])], { type: "image/png" }), "x.png");
  const r = await fetch(base + "/api/admin/upload", { method: "POST", body: fd });
  assert.equal(r.status, 401);
});

test("мастер может загрузить фото и получить его по ссылке", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
  );
  const fd = new FormData();
  fd.append("image", new Blob([png], { type: "image/png" }), "photo.png");
  const r = await fetch(base + "/api/admin/upload", { method: "POST", headers: auth(), body: fd });
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.match(d.url, /^\/api\/media\/m_.+\.png$/);

  const img = await fetch(base + d.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  const got = Buffer.from(await img.arrayBuffer());
  assert.deepEqual(got, png, "фото отдаётся байт-в-байт");
});

test("несуществующее фото отдаёт 404", async () => {
  const r = await fetch(base + "/api/media/m_nope.png");
  assert.equal(r.status, 404);
});

test("заявка сохраняется и видна мастеру", async () => {
  const r = await fetch(base + "/api/bookings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Мария", phone: "+79990000000", service: "Маникюр", date: "суббота", comment: "тест" }),
  });
  assert.equal(r.status, 201);
  const { id } = await j(r);

  const list = await j(await fetch(base + "/api/admin/bookings", { headers: auth() }));
  assert.ok(list.bookings.some((b) => b.id === id && b.name === "Мария" && b.phone === "+79990000000"));

  const del = await fetch(base + "/api/admin/bookings/" + id, { method: "DELETE", headers: auth() });
  assert.equal(del.status, 200);
  const list2 = await j(await fetch(base + "/api/admin/bookings", { headers: auth() }));
  assert.ok(!list2.bookings.some((b) => b.id === id));
});

test("заявка без имени отклоняется", async () => {
  const r = await fetch(base + "/api/bookings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "  " }),
  });
  assert.equal(r.status, 400);
});

test("смена пароля работает и защищена", async () => {
  const bad = await fetch(base + "/api/admin/password", {
    method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth()),
    body: JSON.stringify({ password: "123" }),
  });
  assert.equal(bad.status, 400);

  const ok = await fetch(base + "/api/admin/password", {
    method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth()),
    body: JSON.stringify({ password: "newpass456" }),
  });
  assert.equal(ok.status, 200);

  const oldLogin = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "testpass123" }),
  });
  assert.equal(oldLogin.status, 401);

  const newLogin = await fetch(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "newpass456" }),
  });
  assert.equal(newLogin.status, 200);
  token = (await j(newLogin)).token;
});

test("сайт и его файлы отдаются", async () => {
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);

  const admin = await fetch(base + "/admin.html");
  assert.equal(admin.status, 200);

  const css = await fetch(base + "/assets/css/styles.css");
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") || "", /text\/css/);

  const data = await fetch(base + "/data/data.js");
  assert.equal(data.status, 200);
});

test("служебные файлы сервера наружу не отдаются", async () => {
  for (const p of ["/server/.env", "/server/package.json", "/server/src/server.js", "/.pgdata", "/server/.pgdata"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p + " должен быть недоступен");
  }
});

/* =======================  Уведомления в Telegram  ======================= */

const connect = (tokenValue) => fetch(base + "/api/admin/notify/connect", {
  method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth()),
  body: JSON.stringify({ token: tokenValue }),
});

test("уведомления: подключение бота находит чат мастера", async () => {
  tgUpdates = { ok: true, result: [{ update_id: 1, message: { message_id: 1, chat: { id: 777001, first_name: "Анна", type: "private" }, text: "привет" } }] };
  const r = await connect("123456:TEST-TOKEN");
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.equal(d.ok, true);
  assert.equal(d.chatId, "777001");
  assert.match(d.chatName, /Анна/);

  const status = await j(await fetch(base + "/api/admin/notify", { headers: auth() }));
  assert.equal(status.telegram.configured, true);
  assert.equal(status.telegram.enabled, true);
  assert.equal(status.telegram.chatId, "777001");
  assert.deepEqual(status.telegram.chatIds, ["777001"]);
  assert.ok(status.telegram.token.includes("•"), "токен маскируется");
  assert.ok(!status.telegram.token.includes("TEST-TOKEN"), "токен не отдаётся целиком");
});

test("уведомления: подключение недоступно без входа", async () => {
  const r = await fetch(base + "/api/admin/notify/connect", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "123456:TEST-TOKEN" }),
  });
  assert.equal(r.status, 401);
});

test("уведомления: пока мастер не написал боту — чат не находится", async () => {
  tgUpdates = { ok: true, result: [] };
  const r = await connect("123456:TEST-TOKEN");
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.equal(d.ok, false);
  assert.match(d.message, /напишите/i);
});

test("уведомления: неверный токен не подключается", async () => {
  const saved = tgGetMe;
  tgGetMe = { ok: false, error_code: 401, description: "Unauthorized" };
  const r = await connect("bad-token");
  tgGetMe = saved;
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.equal(d.ok, false);
  assert.match(d.message, /Токен/i);
});

test("уведомления: тестовое сообщение уходит в Telegram", async () => {
  tgUpdates = { ok: true, result: [{ update_id: 2, message: { message_id: 2, chat: { id: 777001, first_name: "Анна", type: "private" }, text: "привет" } }] };
  await connect("123456:TEST-TOKEN");
  tgCalls.length = 0;

  const r = await fetch(base + "/api/admin/notify/test", { method: "POST", headers: auth() });
  assert.equal(r.status, 200);
  assert.equal((await j(r)).ok, true);
  const sent = tgCalls.find((c) => c.method === "sendMessage");
  assert.ok(sent, "sendMessage вызван");
  assert.equal(String(sent.payload.chat_id), "777001");
  assert.match(sent.payload.text, /Проверка/);
});

test("уведомления: новая заявка приходит сообщением в Telegram", async () => {
  tgCalls.length = 0;
  const r = await fetch(base + "/api/bookings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Ольга", phone: "+79991112233", service: "Педикюр", date: "пятница, 18:00", comment: "первый раз" }),
  });
  assert.equal(r.status, 201);
  const { id } = await j(r);

  let sent = null;
  for (let i = 0; i < 60 && !sent; i++) {
    await new Promise((res) => setTimeout(res, 50));
    sent = tgCalls.find((c) => c.method === "sendMessage");
  }
  assert.ok(sent, "мастеру ушло сообщение о заявке");
  assert.equal(String(sent.payload.chat_id), "777001");
  assert.match(sent.payload.text, /Новая заявка/);
  assert.match(sent.payload.text, /Ольга/);
  assert.match(sent.payload.text, /\+79991112233/);
  assert.match(sent.payload.text, /Педикюр/);

  await fetch(base + "/api/admin/bookings/" + id, { method: "DELETE", headers: auth() });
});

test("уведомления: выключенные уведомления не отправляются", async () => {
  const off = await fetch(base + "/api/admin/notify", {
    method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, auth()),
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(off.status, 200);
  assert.equal((await j(off)).telegram.enabled, false);

  tgCalls.length = 0;
  const r = await fetch(base + "/api/bookings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Тихая", phone: "+70000000000" }),
  });
  assert.equal(r.status, 201);
  const { id } = await j(r);
  await new Promise((res) => setTimeout(res, 250));
  assert.ok(!tgCalls.find((c) => c.method === "sendMessage"), "сообщение не отправлено");
  await fetch(base + "/api/admin/bookings/" + id, { method: "DELETE", headers: auth() });

  // вернём обратно, чтобы не мешать другим проверкам
  await fetch(base + "/api/admin/notify", {
    method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, auth()),
    body: JSON.stringify({ enabled: true }),
  });

  // токен не должен «портиться» от выключения и включения
  tgCalls.length = 0;
  await fetch(base + "/api/admin/notify/test", { method: "POST", headers: auth() });
  const after = tgCalls.find((c) => c.method === "sendMessage");
  assert.ok(after && after.url.includes("TEST-TOKEN"), "токен сохранился после выключения и включения");
});

test("уведомления: можно добавить второго получателя и слать обоим", async () => {
  tgUpdates = { ok: true, result: [{ update_id: 3, message: { message_id: 3, chat: { id: 777002, first_name: "Валентина", type: "private" }, text: "привет" } }] };
  const r = await connect("");
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.equal(d.ok, true);
  assert.deepEqual(d.chatIds.slice().sort(), ["777001", "777002"]);

  const status = await j(await fetch(base + "/api/admin/notify", { headers: auth() }));
  assert.deepEqual(status.telegram.chatIds.slice().sort(), ["777001", "777002"]);
  assert.equal(status.telegram.configured, true);

  tgCalls.length = 0;
  const t = await fetch(base + "/api/admin/notify/test", { method: "POST", headers: auth() });
  assert.equal((await j(t)).ok, true);
  const sent = tgCalls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.chat_id));
  assert.ok(sent.includes("777001") && sent.includes("777002"), "сообщение ушло обоим получателям");
});

test("уведомления: получателя можно убрать", async () => {
  const r = await fetch(base + "/api/admin/notify/chats/777002", { method: "DELETE", headers: auth() });
  assert.equal(r.status, 200);
  const d = await j(r);
  assert.deepEqual(d.telegram.chatIds, ["777001"]);
  assert.equal(d.telegram.chatId, "777001");
});
