-- Đường dẫn: foodapp/services/user/schema.sql
-- User Service database
-- Vai trò: ADMIN (quản trị viên) · STAFF (nhân viên) · GUEST (khách hàng — đăng ký trên web)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  password_hash TEXT    NOT NULL,           -- scrypt: "salt:hash"
  role          TEXT    NOT NULL DEFAULT 'GUEST' CHECK (role IN ('ADMIN', 'STAFF', 'GUEST')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
