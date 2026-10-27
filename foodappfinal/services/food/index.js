'use strict';
// Đường dẫn: foodapp/services/food/index.js
// FOOD SERVICE — thực đơn, tìm kiếm/lọc, tồn kho, đánh giá, quản trị món ăn
// Quyền: STAFF + ADMIN xem cả món ẩn & cập nhật số lượng còn; chỉ ADMIN thêm / sửa / ẩn món, đổi giá, đổi ảnh
const fs = require('node:fs');
const path = require('node:path');
const { serve, openDb, tx, call, requireUser, requireAdmin, requireStaff, requireInternal, HttpError, toInt } = require('../../shared/lib');

const db = openDb(__dirname, 'food');
// Ảnh món tải lên được lưu vào public/images (Gateway phục vụ tại /images/...)
// ponytail: lưu trên đĩa máy chủ; triển khai nhiều máy thì chuyển sang kho ảnh chung (S3, Cloudinary...)
const IMAGE_DIR = path.join(__dirname, '..', '..', 'public', 'images');
const IMAGE_MAX_BYTES = 700_000;

// Bỏ dấu tiếng Việt để tìm "pho" ra "Phở", "bun bo" ra "Bún bò"
const unaccent = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
db.function('unaccent', unaccent);

const SELECT = `
  SELECT f.*, c.name AS category, IFNULL(r.avg, 0) AS rating, IFNULL(r.cnt, 0) AS review_count
  FROM foods f
  JOIN categories c ON c.id = f.category_id
  LEFT JOIN (SELECT food_id, ROUND(AVG(rating), 1) AS avg, COUNT(*) AS cnt FROM reviews GROUP BY food_id) r ON r.food_id = f.id`;

const toFood = (f) => ({
  id: f.id, name: f.name, description: f.description, price: f.price, image: f.image,
  stock: f.stock, sold: f.sold, active: !!f.active, available: !!f.active && f.stock > 0,
  categoryId: f.category_id, category: f.category, rating: f.rating, reviewCount: f.review_count, createdAt: f.created_at,
});
const getFood = (id) => {
  const f = db.prepare(`${SELECT} WHERE f.id = ?`).get(id);
  if (!f) throw new HttpError(404, 'Không tìm thấy món ăn');
  return toFood(f);
};

const SORTS = {
  popular: 'f.sold DESC', rating: 'rating DESC, review_count DESC', newest: 'f.id DESC',
  price_asc: 'f.price ASC', price_desc: 'f.price DESC',
};

function foodInput(b) {
  const f = {
    name: String(b.name || '').trim(),
    description: String(b.description || '').trim().slice(0, 300),
    price: toInt(b.price), stock: toInt(b.stock), categoryId: toInt(b.categoryId),
    image: String(b.image || '').trim().slice(0, 500) || '🍽️',
    active: b.active === false ? 0 : 1,
  };
  if (f.name.length < 2 || f.name.length > 80) throw new HttpError(400, 'Tên món từ 2–80 ký tự');
  if (!(f.price >= 1000 && f.price <= 10_000_000)) throw new HttpError(400, 'Giá phải từ 1.000đ đến 10.000.000đ');
  if (!(f.stock >= 0 && f.stock <= 100_000)) throw new HttpError(400, 'Số lượng còn không hợp lệ');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(f.categoryId)) throw new HttpError(400, 'Danh mục không tồn tại');
  return f;
}

serve('food', [
  ['GET', '/categories', () => db.prepare('SELECT * FROM categories ORDER BY id').all()],

  // Tìm kiếm & lọc: ?q= &category= &minPrice= &maxPrice= &inStock=1 &sort=popular|rating|newest|price_asc|price_desc &limit=
  // ?all=1 (nhân viên / admin) hiển thị cả món đã ẩn
  ['GET', '/foods', (ctx) => {
    const q = ctx.query;
    const where = [], args = [];
    if (q.get('all') === '1') requireStaff(ctx.req); else where.push('f.active = 1');
    const text = unaccent(q.get('q')).trim();
    if (text) {
      where.push(`unaccent(f.name || ' ' || IFNULL(f.description, '') || ' ' || c.name) LIKE ? ESCAPE '\\'`);
      args.push(`%${text.replace(/[\\%_]/g, '\\$&')}%`);
    }
    const cat = toInt(q.get('category'));
    if (cat > 0) { where.push('f.category_id = ?'); args.push(cat); }
    const min = toInt(q.get('minPrice')), max = toInt(q.get('maxPrice'));
    if (min >= 0) { where.push('f.price >= ?'); args.push(min); }
    if (max >= 0) { where.push('f.price <= ?'); args.push(max); }
    if (q.get('inStock') === '1') where.push('f.stock > 0');
    const limit = Math.min(toInt(q.get('limit')) || 500, 500);
    return db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${SORTS[q.get('sort')] || 'f.category_id, f.id'} LIMIT ${limit}`).all(...args).map(toFood);
  }],

  // ----- Tồn kho (Order Service gọi) -----
  // Giữ hàng nguyên tử: thiếu 1 món là huỷ cả lần giữ. Trả về tên + giá thật để Order tính tiền.
  ['POST', '/foods/reserve', (ctx) => {
    requireInternal(ctx.req);
    return tx(db, () => ctx.body.items.map(({ foodId, quantity }) => {
      const f = db.prepare('SELECT id, name, price, stock, active FROM foods WHERE id = ?').get(foodId);
      if (!f || !f.active) throw new HttpError(400, `Món #${foodId} không tồn tại`);
      if (f.stock < quantity) throw new HttpError(409, f.stock ? `Món "${f.name}" chỉ còn ${f.stock} phần` : `Món "${f.name}" đã hết`);
      db.prepare('UPDATE foods SET stock = stock - ?, sold = sold + ? WHERE id = ?').run(quantity, quantity, foodId);
      return { foodId, name: f.name, price: f.price, quantity };
    }));
  }],

  ['POST', '/foods/release', (ctx) => {
    requireInternal(ctx.req);
    tx(db, () => {
      for (const { foodId, quantity } of ctx.body.items) {
        db.prepare('UPDATE foods SET stock = stock + ?, sold = MAX(sold - ?, 0) WHERE id = ?').run(quantity, quantity, foodId);
      }
    });
    return { ok: true };
  }],

  ['GET', '/foods/:id', (ctx) => getFood(toInt(ctx.params.id))],

  // ----- Đánh giá -----
  ['GET', '/foods/:id/reviews', (ctx) => db.prepare(
    'SELECT id, user_name AS userName, rating, comment, created_at AS createdAt FROM reviews WHERE food_id = ? ORDER BY id DESC LIMIT 50',
  ).all(toInt(ctx.params.id))],

  ['POST', '/foods/:id/reviews', async (ctx) => {
    const user = requireUser(ctx.req);
    const foodId = toInt(ctx.params.id);
    const rating = toInt(ctx.body.rating);
    const comment = String(ctx.body.comment || '').trim().slice(0, 500) || null;
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Vui lòng chọn từ 1 đến 5 sao');
    getFood(foodId);
    const { purchased } = await call('order', 'GET', `/orders/internal/purchased?userId=${user.sub}&foodId=${foodId}`, { internal: true });
    if (!purchased) throw new HttpError(403, 'Bạn chỉ đánh giá được món đã nhận (đơn đã hoàn thành)');
    db.prepare(`INSERT INTO reviews (food_id, user_id, user_name, rating, comment) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (food_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, created_at = datetime('now')`)
      .run(foodId, user.sub, user.name, rating, comment);
    ctx.status = 201;
    return getFood(foodId);
  }],

  // ----- Quản trị món ăn -----
  ['POST', '/foods', (ctx) => {
    requireAdmin(ctx.req);
    const f = foodInput(ctx.body);
    const { lastInsertRowid } = db.prepare('INSERT INTO foods (category_id, name, description, price, image, stock, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(f.categoryId, f.name, f.description, f.price, f.image, f.stock, f.active);
    ctx.status = 201;
    return getFood(lastInsertRowid);
  }],

  ['PUT', '/foods/:id', (ctx) => {
    requireAdmin(ctx.req);
    const id = toInt(ctx.params.id);
    const f = foodInput(ctx.body);
    const { changes } = db.prepare('UPDATE foods SET category_id = ?, name = ?, description = ?, price = ?, image = ?, stock = ?, active = ? WHERE id = ?')
      .run(f.categoryId, f.name, f.description, f.price, f.image, f.stock, f.active, id);
    if (!changes) throw new HttpError(404, 'Không tìm thấy món ăn');
    return getFood(id);
  }],

  // Nhân viên cập nhật số lượng còn (không đổi được giá, tên, ảnh): { stock }
  ['PATCH', '/foods/:id/stock', (ctx) => {
    requireStaff(ctx.req);
    const id = toInt(ctx.params.id);
    const stock = toInt(ctx.body.stock);
    if (!(stock >= 0 && stock <= 100_000)) throw new HttpError(400, 'Số lượng còn không hợp lệ');
    if (!db.prepare('UPDATE foods SET stock = ? WHERE id = ?').run(stock, id).changes) throw new HttpError(404, 'Không tìm thấy món ăn');
    return getFood(id);
  }],

  // Tải ảnh món: { data: "data:image/jpeg;base64,..." } (trình duyệt đã thu nhỏ ảnh trước khi gửi)
  ['POST', '/foods/:id/image', (ctx) => {
    requireAdmin(ctx.req);
    const food = getFood(toInt(ctx.params.id));
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.data || ''));
    if (!m) throw new HttpError(400, 'Chỉ nhận ảnh JPG, PNG hoặc WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > IMAGE_MAX_BYTES) throw new HttpError(413, 'Ảnh quá lớn (tối đa 700KB)');
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
    const name = `food-${food.id}-${Date.now()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`; // tên do server đặt, không dùng tên file của người gửi
    fs.writeFileSync(path.join(IMAGE_DIR, name), buf);
    db.prepare('UPDATE foods SET image = ? WHERE id = ?').run(`/images/${name}`, food.id);
    // Xoá ảnh tải lên trước đó của món này cho đỡ rác
    if (/^\/images\/food-\d+-\d+\.(jpg|png|webp)$/.test(food.image || '')) fs.rm(path.join(IMAGE_DIR, path.basename(food.image)), () => {});
    return getFood(food.id);
  }],

  // Xoá mềm (ẩn) để giữ lịch sử đơn hàng và đánh giá
  ['DELETE', '/foods/:id', (ctx) => {
    requireAdmin(ctx.req);
    const id = toInt(ctx.params.id);
    if (!db.prepare('UPDATE foods SET active = 0 WHERE id = ?').run(id).changes) throw new HttpError(404, 'Không tìm thấy món ăn');
    return getFood(id);
  }],
]);
