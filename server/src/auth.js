/* =========================================================
   auth.js — вход мастера в панель (JWT + bcrypt).
   ========================================================= */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "./db.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_TTL = "30d";

export function hashPassword(password) {
  return bcrypt.hashSync(String(password), 10);
}

export function verifyPassword(password, hash) {
  try { return bcrypt.compareSync(String(password), String(hash)); }
  catch (e) { return false; }
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch (e) { return null; }
}

// Создаёт администратора из переменных окружения при первом запуске.
export async function ensureAdminUser() {
  const username = process.env.ADMIN_USER || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const { rows } = await query("SELECT count(*)::int AS n FROM admin_users");
  if (rows[0].n === 0) {
    await query("INSERT INTO admin_users(username, password_hash) VALUES($1, $2)", [username, hashPassword(password)]);
    console.log(`\n  Создан вход для мастера: «${username}»`);
    if (!process.env.ADMIN_PASSWORD) console.log("  ВНИМАНИЕ: пароль по умолчанию admin123 — смените его в панели или через переменную ADMIN_PASSWORD.\n");
  }
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: "Требуется вход в панель" });
  req.user = payload;
  next();
}
