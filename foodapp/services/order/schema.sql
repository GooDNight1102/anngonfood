-- Order Service database: đơn hàng, lịch sử trạng thái, mã giảm giá
-- user_id / food_id là tham chiếu logic sang service khác (không có FOREIGN KEY xuyên DB)
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  customer_name  TEXT    NOT NULL,
  phone          TEXT    NOT NULL,
  address        TEXT    NOT NULL,                         -- địa chỉ giao hàng
  status         TEXT    NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'COMPLETED', 'CANCELLED')),
  payment_method TEXT    CHECK (payment_method IN ('CARD', 'WALLET', 'COD')),
  payment_status TEXT    NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED')),
  subtotal       INTEGER NOT NULL CHECK (subtotal >= 0),
  discount       INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total          INTEGER NOT NULL CHECK (total >= 0),
  coupon_code    TEXT,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

-- Lưu snapshot tên + giá tại thời điểm đặt, đơn cũ không đổi khi thực đơn đổi giá
CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  food_id  INTEGER NOT NULL,
  name     TEXT    NOT NULL,
  price    INTEGER NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 50),
  PRIMARY KEY (order_id, food_id)
);

-- Lịch sử trạng thái -> dòng thời gian "theo dõi đơn hàng"
CREATE TABLE IF NOT EXISTS order_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);

CREATE TABLE IF NOT EXISTS coupons (
  code         TEXT    PRIMARY KEY COLLATE NOCASE,
  description  TEXT,
  type         TEXT    NOT NULL CHECK (type IN ('PERCENT', 'FIXED')),
  value        INTEGER NOT NULL CHECK (value > 0),
  min_order    INTEGER NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  max_discount INTEGER CHECK (max_discount > 0),       -- trần giảm cho loại PERCENT
  usage_limit  INTEGER CHECK (usage_limit > 0),        -- NULL = không giới hạn
  used_count   INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  expires_at   TEXT,                                   -- 'YYYY-MM-DD', hết hạn sau ngày này
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (type <> 'PERCENT' OR value <= 100)
);

INSERT OR IGNORE INTO coupons (code, description, type, value, min_order, max_discount, usage_limit) VALUES
  ('GIAM10',    'Giảm 10% tối đa 30.000đ cho đơn từ 100.000đ', 'PERCENT', 10, 100000, 30000, NULL),
  ('CHAOBAN30', 'Giảm 30.000đ cho đơn từ 150.000đ',             'FIXED',   30000, 150000, NULL, 200),
  ('TRASUA15',  'Giảm 15.000đ cho đơn từ 60.000đ',              'FIXED',   15000, 60000,  NULL, 100);
