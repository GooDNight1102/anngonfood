-- Đường dẫn: foodapp/services/notification/schema.sql
-- Notification Service database
-- audience = USER: gửi cho 1 khách (user_id) | ADMIN: gửi cho cửa hàng (mọi nhân viên + quản trị viên)
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  audience   TEXT    NOT NULL CHECK (audience IN ('USER', 'ADMIN')),
  user_id    INTEGER,
  order_id   INTEGER,
  title      TEXT    NOT NULL,
  body       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (audience = 'ADMIN' OR user_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_notifications ON notifications(audience, user_id, id DESC);
