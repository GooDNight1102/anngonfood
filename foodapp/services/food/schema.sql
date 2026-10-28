-- Food Service database: danh mục, món ăn (tồn kho), đánh giá
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL UNIQUE,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS foods (
  id          INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name        TEXT    NOT NULL,
  description TEXT,
  price       INTEGER NOT NULL CHECK (price > 0),             -- VNĐ
  image       TEXT,                                           -- emoji hoặc URL ảnh
  stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),  -- số phần còn lại
  sold        INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0),   -- đã bán (xếp hạng "bán chạy")
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), -- 0 = ẩn khỏi thực đơn
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_foods_category ON foods(category_id);

-- Mỗi người chỉ có 1 đánh giá cho 1 món (đánh giá lại = cập nhật)
CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  food_id    INTEGER NOT NULL REFERENCES foods(id),
  user_id    INTEGER NOT NULL,
  user_name  TEXT    NOT NULL,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (food_id, user_id)
);

-- Dữ liệu mẫu (chạy lại không bị trùng nhờ OR IGNORE)
INSERT OR IGNORE INTO categories (id, name, icon) VALUES
  (1, 'Món chính', '🍚'),
  (2, 'Món nước',  '🍜'),
  (3, 'Ăn vặt',    '🥟'),
  (4, 'Đồ uống',   '🧋');

INSERT OR IGNORE INTO foods (id, category_id, name, description, price, image, stock, sold) VALUES
  (1,  1, 'Cơm tấm sườn bì chả', 'Sườn nướng than hoa, bì, chả trứng, nước mắm chua ngọt', 55000, '🍛', 40, 128),
  (2,  1, 'Cơm gà xối mỡ',       'Gà giòn da, cơm chiên nghệ, dưa leo',                    50000, '🍗', 30,  86),
  (3,  1, 'Bún chả Hà Nội',      'Chả viên, chả miếng nướng, bún, rau sống',               50000, '🥢', 25,  64),
  (4,  2, 'Phở bò tái chín',     'Nước dùng hầm xương 12 tiếng, bò tái và chín',           60000, '🍜', 50, 152),
  (5,  2, 'Bún bò Huế',          'Giò heo, chả cua, sả ớt cay nồng',                       55000, '🌶️', 20,  71),
  (6,  2, 'Hủ tiếu Nam Vang',    'Tôm, mực, thịt bằm, trứng cút',                          50000, '🍲', 20,  33),
  (7,  3, 'Bánh mì thịt',        'Pate, thịt nguội, chả lụa, rau thơm',                    25000, '🥖', 60,  97),
  (8,  3, 'Gỏi cuốn tôm thịt',   '2 cuốn, kèm tương đậu phộng',                            30000, '🌯', 15,  45),
  (9,  3, 'Chả giò rế',          '5 cuốn, kèm rau và nước mắm',                            35000, '🥟',  0,  58),
  (10, 4, 'Cà phê sữa đá',       'Robusta pha phin, sữa đặc',                              25000, '☕', 80, 140),
  (11, 4, 'Trà sữa trân châu',   'Trà đen, sữa tươi, trân châu đường đen',                 35000, '🧋', 50, 110),
  (12, 4, 'Nước mía',            'Mía ép tươi, tắc',                                       15000, '🥤', 40,  52);
