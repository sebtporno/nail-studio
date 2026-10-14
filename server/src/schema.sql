-- Схема базы данных сайта студии маникюра

CREATE TABLE IF NOT EXISTS admin_users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Настройки одним JSON-объектом (профиль мастера, контакты и т.п.)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS prices (
  id       TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT '',
  name     TEXT NOT NULL DEFAULT '',
  price    TEXT NOT NULL DEFAULT '',
  note     TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS works (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  image       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS news (
  id    TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  date  TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  text  TEXT NOT NULL DEFAULT '',
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  service    TEXT NOT NULL DEFAULT '',
  date_text  TEXT NOT NULL DEFAULT '',
  comment    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Фото работ и профиля хранятся прямо в базе, чтобы не терялись при
-- перезапуске/передеплое (важно для бесплатных хостингов с временным диском).
CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  bytes      BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
