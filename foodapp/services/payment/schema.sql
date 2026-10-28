-- Payment Service database (thanh toán GIẢ LẬP — không lưu số thẻ đầy đủ)
CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount >= 0),
  method          TEXT    NOT NULL CHECK (method IN ('CARD', 'WALLET', 'COD')),
  -- SUCCESS: đã trừ tiền | COD: thu tiền mặt khi nhận | FAILED | REFUNDED: đã hoàn | VOID: đơn COD bị huỷ
  status          TEXT    NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'COD', 'REFUNDED', 'VOID')),
  card_last4      TEXT,
  transaction_ref TEXT    NOT NULL UNIQUE,
  message         TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, id DESC);

-- Mỗi đơn chỉ có tối đa 1 giao dịch hiệu lực -> chống thanh toán 2 lần kể cả khi bấm đồng thời
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_order_ok ON payments(order_id) WHERE status IN ('SUCCESS', 'COD');

-- Ví điện tử mô phỏng: mỗi tài khoản được tặng sẵn số dư để thử
CREATE TABLE IF NOT EXISTS wallets (
  user_id    INTEGER PRIMARY KEY,
  balance    INTEGER NOT NULL CHECK (balance >= 0),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
