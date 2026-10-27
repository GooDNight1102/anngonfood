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
  (4, 'Đồ uống',   '🧋'),
  (5, 'Combo',     '🍱'),
  (6, 'Lẩu & Nướng', '🔥'),
  (7, 'Tráng miệng', '🍨'),
  (8, 'Món chay',  '🥗');

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

-- Combo cho nhiều người: là món bình thường (danh mục Combo) nên đặt hàng, tồn kho, thanh toán dùng chung luồng cũ.
-- Dòng "👥 N người" trong mô tả được giao diện dùng để hiện nhãn số người.
INSERT OR IGNORE INTO foods (id, category_id, name, description, price, image, stock, sold) VALUES
  (13, 5, 'Combo Cặp đôi',   '👥 2 người · 2 Cơm tấm sườn bì chả + 2 Trà sữa trân châu · Tiết kiệm 25.000đ',                                        155000, '💑', 25, 42),
  (14, 5, 'Combo Bạn bè',    '👥 3–4 người · 2 Bún bò Huế + 2 Bánh mì thịt + 1 Chả giò rế + 4 Cà phê sữa đá · Tiết kiệm 36.000đ',                   259000, '🍻', 20, 31),
  (15, 5, 'Combo Gia đình',  '👥 4–5 người · 2 Phở bò tái chín + 2 Cơm gà xối mỡ + 2 Gỏi cuốn tôm thịt + 4 Nước mía · Tiết kiệm 41.000đ',            299000, '👨‍👩‍👧‍👦', 15, 36),
  (16, 5, 'Combo Văn phòng', '👥 5–6 người · 5 Cơm gà xối mỡ + 5 Cà phê sữa đá · Tiết kiệm 46.000đ',                                                 329000, '🏢', 15, 24),
  (17, 5, 'Combo Tiệc nhẹ',  '👥 6–8 người · 2 Gỏi cuốn tôm thịt + 2 Chả giò rế + 4 Bánh mì thịt + 6 Nước mía · Tiết kiệm 41.000đ',                  279000, '🎉', 12, 18);

-- Thực đơn mở rộng: 93 món (ids 18–110)
INSERT OR IGNORE INTO foods (id, category_id, name, description, price, image, stock, sold) VALUES
  (18, 1, 'Cơm sườn nướng mật ong', 'Sườn nướng mật ong, cơm trắng, đồ chua', 58000, '🍖', 50, 86),
  (19, 1, 'Cơm chiên dương châu', 'Trứng, lạp xưởng, tôm, đậu Hà Lan', 45000, '🍚', 30, 30),
  (20, 1, 'Cơm chiên hải sản', 'Tôm, mực, nghêu, cơm chiên giòn hạt', 60000, '🦐', 50, 10),
  (21, 1, 'Cơm bò lúc lắc', 'Bò Úc xào tiêu đen, khoai tây chiên', 65000, '🥩', 50, 13),
  (22, 1, 'Cơm gà teriyaki', 'Gà nướng sốt teriyaki, rong biển, cơm trắng', 55000, '🍗', 15, 7),
  (23, 1, 'Cơm thịt kho trứng', 'Thịt ba chỉ kho nước dừa, trứng, dưa cải', 48000, '🥚', 30, 68),
  (24, 1, 'Cơm cá kho tộ', 'Cá basa kho tộ đậm đà, canh rau', 55000, '🐟', 20, 11),
  (25, 1, 'Cơm sườn cốt lết', 'Cốt lết heo chiên giòn, trứng ốp la', 52000, '🍖', 1, 57),
  (26, 1, 'Mì xào bò', 'Mì trứng xào bò, cải ngọt, hành tây', 55000, '🍝', 60, 31),
  (27, 1, 'Mì xào hải sản', 'Tôm, mực, cải thìa, sốt hào', 62000, '🍤', 60, 30),
  (28, 1, 'Hủ tiếu xào', 'Hủ tiếu dai xào trứng, giá, hẹ', 48000, '🍜', 15, 9),
  (29, 1, 'Bún thịt nướng', 'Thịt heo nướng sả, nem, rau sống, nước mắm', 50000, '🥢', 0, 23),
  (30, 1, 'Bún chả giò thịt nướng', 'Chả giò giòn, thịt nướng, đồ chua', 55000, '🥢', 12, 37),
  (31, 1, 'Cơm gà Hải Nam', 'Gà luộc mềm, cơm nấu nước gà, sốt gừng', 55000, '🍗', 50, 55),
  (32, 1, 'Cơm lam gà xé', 'Cơm lam nướng, gà xé phay, muối vừng', 45000, '🍙', 25, 29),
  (33, 1, 'Bánh mì chảo', 'Trứng ốp la, pate, xúc xích, bánh mì nóng', 40000, '🍳', 50, 94),
  (34, 2, 'Bún riêu cua', 'Riêu cua đồng, đậu hũ, cà chua, rau sống', 52000, '🦀', 12, 43),
  (35, 2, 'Phở gà', 'Nước dùng gà ta, thịt gà xé, hành lá', 50000, '🍜', 20, 14),
  (36, 2, 'Mì Quảng', 'Mì vàng, tôm, thịt, đậu phộng rang, bánh tráng', 52000, '🍜', 8, 67),
  (37, 2, 'Bánh canh cua', 'Sợi bánh canh dai, thịt cua, chả cua', 58000, '🦀', 20, 61),
  (38, 2, 'Cháo sườn', 'Cháo hầm nhuyễn, sườn non, quẩy', 35000, '🥣', 20, 62),
  (39, 2, 'Cháo lòng', 'Cháo nóng, lòng heo, huyết, hành phi', 38000, '🥣', 30, 24),
  (40, 2, 'Miến gà', 'Miến dong, gà ta, nấm hương', 45000, '🍲', 25, 75),
  (41, 2, 'Canh chua cá lóc', 'Cá lóc, thơm, cà chua, đậu bắp, bạc hà', 60000, '🐠', 15, 14),
  (42, 2, 'Mì vịt tiềm', 'Vịt tiềm thuốc bắc, mì trứng, rau cải', 62000, '🦆', 8, 49),
  (43, 2, 'Bún mắm', 'Nước mắm cá linh, tôm, mực, thịt quay', 55000, '🍲', 12, 27),
  (44, 2, 'Súp cua', 'Súp cua trứng bắc thảo, nấm tuyết', 30000, '🥣', 2, 53),
  (45, 2, 'Hoành thánh mì', 'Hoành thánh tôm thịt, mì sợi nhỏ, xá xíu', 45000, '🥟', 8, 73),
  (46, 2, 'Mì cay hải sản', 'Mì cay 7 cấp độ, tôm, mực, viên cá', 60000, '🌶️', 40, 72),
  (47, 3, 'Bánh xèo', 'Vỏ giòn vàng, tôm, thịt, giá, ăn kèm rau', 45000, '🥞', 60, 54),
  (48, 3, 'Bánh bèo', 'Bánh bèo chén, tôm cháy, hành phi, nước mắm', 30000, '🥣', 15, 89),
  (49, 3, 'Bánh cuốn nóng', 'Bánh cuốn nhân thịt, chả lụa, nước chấm', 35000, '🥟', 15, 54),
  (50, 3, 'Bánh tráng trộn', 'Bánh tráng, xoài, trứng cút, khô bò', 25000, '🥗', 40, 29),
  (51, 3, 'Nem nướng Nha Trang', 'Nem nướng, bánh tráng, rau, nước chấm đậu', 45000, '🍢', 15, 39),
  (52, 3, 'Khoai tây chiên', 'Khoai chiên vàng giòn, sốt cà chua', 30000, '🍟', 0, 48),
  (53, 3, 'Gà rán giòn (3 miếng)', 'Gà tẩm bột chiên giòn, sốt mayonnaise', 55000, '🍗', 50, 56),
  (54, 3, 'Xúc xích nướng', 'Xúc xích Đức nướng than, sốt tương ớt', 20000, '🌭', 50, 59),
  (55, 3, 'Cá viên chiên', 'Cá viên chiên vàng, tương ớt, tắc', 25000, '🍢', 20, 30),
  (56, 3, 'Bắp xào bơ', 'Bắp ngọt xào bơ, hành phi, khô bò', 25000, '🌽', 8, 5),
  (57, 3, 'Phô mai que', 'Phô mai kéo sợi, chiên giòn, sốt cà', 30000, '🧀', 60, 28),
  (58, 3, 'Há cảo chiên', 'Há cảo nhân tôm thịt, chiên vàng', 35000, '🥟', 12, 95),
  (59, 3, 'Bánh bao nhân thịt', 'Bánh bao nóng, thịt heo, trứng cút', 20000, '🥟', 60, 73),
  (60, 3, 'Nem chua rán', 'Nem chua rán giòn, tương ớt, rau thơm', 35000, '🍘', 15, 47),
  (61, 3, 'Bò bía', 'Củ sắn, tôm khô, trứng, bánh tráng mỏng', 20000, '🌯', 15, 9),
  (62, 3, 'Bánh khọt', 'Bánh khọt tôm, nước cốt dừa, rau sống', 40000, '🥮', 12, 84),
  (63, 4, 'Trà đào cam sả', 'Trà đen, đào miếng, cam, sả thơm', 38000, '🍑', 4, 62),
  (64, 4, 'Trà vải', 'Trà hoa nhài, vải thiều, đá viên', 35000, '🍹', 15, 39),
  (65, 4, 'Trà chanh', 'Chanh tươi, trà xanh, mật ong', 20000, '🍋', 8, 92),
  (66, 4, 'Sinh tố bơ', 'Bơ sáp xay sữa đặc, đá bào', 40000, '🥑', 30, 38),
  (67, 4, 'Sinh tố xoài', 'Xoài cát chín, sữa chua, đá', 38000, '🥭', 25, 88),
  (68, 4, 'Nước cam ép', 'Cam vàng ép tươi, không đường', 35000, '🍊', 50, 89),
  (69, 4, 'Cà phê đen đá', 'Robusta nguyên chất, đậm vị', 20000, '☕', 50, 72),
  (70, 4, 'Bạc xỉu', 'Cà phê pha sữa nhiều, béo nhẹ', 28000, '🥛', 20, 51),
  (71, 4, 'Cacao đá xay', 'Cacao Đắk Lắk, kem tươi, sô cô la', 40000, '🍫', 50, 45),
  (72, 4, 'Matcha latte', 'Bột matcha Nhật, sữa tươi, đá', 45000, '🍵', 20, 59),
  (73, 4, 'Sữa đậu nành', 'Đậu nành xay nóng, ít đường', 15000, '🥛', 12, 37),
  (74, 4, 'Soda chanh dây', 'Chanh dây, soda, mật ong', 30000, '🥤', 50, 65),
  (75, 4, 'Nước dừa tươi', 'Dừa xiêm nguyên trái, mát lạnh', 25000, '🥥', 0, 88),
  (76, 4, 'Yaourt dâu', 'Sữa chua dâu tây xay, đá bào', 32000, '🍓', 12, 51),
  (77, 4, 'Trà sữa matcha', 'Trà sữa matcha, trân châu trắng', 40000, '🧋', 60, 95),
  (78, 4, 'Trà sữa khoai môn', 'Khoai môn dẻo, sữa tươi, thạch', 38000, '🧋', 40, 77),
  (79, 6, 'Lẩu thái hải sản (2 người)', 'Nước lẩu chua cay, tôm, mực, nghêu, rau', 249000, '🍲', 40, 6),
  (80, 6, 'Lẩu gà lá é (2 người)', 'Gà ta, lá é, nấm, nước lẩu cay nhẹ', 229000, '🍲', 20, 60),
  (81, 6, 'Lẩu bò nhúng dấm (2 người)', 'Bò tươi nhúng dấm, rau sống, bún', 259000, '🍲', 15, 82),
  (82, 6, 'Bò nướng lá lốt', 'Bò cuốn lá lốt nướng, chấm mắm nêm', 69000, '🥩', 3, 58),
  (83, 6, 'Gà nướng mật ong', 'Nửa con gà ta, da giòn, mật ong sả', 119000, '🍗', 50, 86),
  (84, 6, 'Sườn nướng BBQ', 'Sườn non tẩm BBQ, nướng than hoa', 99000, '🍖', 50, 52),
  (85, 6, 'Tôm nướng muối ớt', 'Tôm sú nướng, muối ớt xanh', 89000, '🦐', 8, 55),
  (86, 6, 'Mực nướng sa tế', 'Mực ống nướng, sa tế cay thơm', 85000, '🦑', 30, 9),
  (87, 6, 'Cá nướng giấy bạc', 'Cá diêu hồng, nướng giấy bạc, rau thơm', 95000, '🐟', 60, 39),
  (88, 6, 'Ba chỉ nướng', 'Ba chỉ heo nướng, cuốn rau, kim chi', 79000, '🥓', 40, 67),
  (89, 6, 'Nấm nướng mỡ hành', 'Nấm đùi gà nướng, mỡ hành, đậu phộng', 45000, '🍄', 50, 80),
  (90, 6, 'Lẩu nấm (2 người)', 'Nấm các loại, rau củ, nước hầm xương', 199000, '🍲', 15, 11),
  (91, 7, 'Chè khúc bạch', 'Khúc bạch mềm, nhãn, hạnh nhân', 30000, '🍮', 20, 83),
  (92, 7, 'Chè thái', 'Sầu riêng, mít, thạch, nước cốt dừa', 28000, '🍨', 8, 27),
  (93, 7, 'Kem flan', 'Bánh flan mềm mịn, kem lạnh, caramel', 25000, '🍮', 20, 43),
  (94, 7, 'Bánh flan', 'Flan trứng sữa, caramel đắng nhẹ', 20000, '🍮', 30, 72),
  (95, 7, 'Sữa chua nếp cẩm', 'Sữa chua dẻo, nếp cẩm dẻo, nước cốt dừa', 25000, '🍚', 20, 9),
  (96, 7, 'Rau câu dừa', 'Rau câu trái dừa, nước cốt dừa béo', 20000, '🥥', 60, 93),
  (97, 7, 'Bánh tiramisu', 'Tiramisu Ý, cà phê, bột cacao', 45000, '🍰', 30, 94),
  (98, 7, 'Kem dừa', 'Kem dừa, dừa non, đậu phộng rang', 35000, '🍨', 0, 16),
  (99, 7, 'Chè bưởi', 'Cùi bưởi giòn, đậu xanh, nước cốt dừa', 28000, '🍧', 15, 72),
  (100, 7, 'Bánh su kem', 'Bánh su kem vani, nhân mịn', 25000, '🧁', 25, 15),
  (101, 8, 'Cơm chay thập cẩm', 'Đậu hũ, nấm, rau củ xào, canh chay', 40000, '🥗', 4, 40),
  (102, 8, 'Bún chay nấm', 'Bún tươi, nấm rơm, đậu hũ chiên', 38000, '🍜', 15, 46),
  (103, 8, 'Phở chay', 'Nước dùng rau củ, nấm, đậu hũ', 40000, '🍜', 50, 89),
  (104, 8, 'Gỏi cuốn chay', 'Bún, rau, đậu hũ, nước chấm tương', 28000, '🌯', 30, 7),
  (105, 8, 'Đậu hũ sốt cà', 'Đậu hũ chiên, sốt cà chua, hành lá', 35000, '🍅', 20, 88),
  (106, 8, 'Lẩu nấm chay (2 người)', 'Nấm, rau củ, đậu hũ, nước dùng ngọt thanh', 189000, '🍲', 50, 56),
  (107, 8, 'Mì xào rau củ', 'Mì xào nấm, cải, cà rốt, nấm đông cô', 38000, '🍝', 20, 14),
  (108, 8, 'Chả giò chay', 'Chả giò rau củ, nấm, miến, chiên giòn', 30000, '🥟', 50, 38),
  (109, 8, 'Cháo nấm chay', 'Cháo hạt sen, nấm, tàu hũ ky', 32000, '🥣', 40, 47),
  (110, 8, 'Nấm kho tộ chay', 'Nấm kho tộ, tiêu xanh, ăn với cơm', 42000, '🍄', 50, 7);
