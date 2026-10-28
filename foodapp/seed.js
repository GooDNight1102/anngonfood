'use strict';
// Đường dẫn: foodapp/seed.js
// DỮ LIỆU DEMO: 6 khách hàng, ~45 đơn hàng trong 14 ngày qua, đánh giá món.
// - Tạo qua API như người dùng thật -> tồn kho, ví, mã giảm giá, thông báo đều khớp nhau.
// - Sau đó lùi ngày tạo đơn về quá khứ để Dashboard có biểu đồ doanh thu theo ngày.
// - Chỉ chạy 1 lần: nếu đã có khách demo (khach1@anngon.vn) thì bỏ qua.
// Tự chạy khi `npm start` (tắt bằng biến môi trường NO_SEED=1), hoặc chạy tay: `npm run seed` (khi hệ thống đang chạy).
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config.json');

const BASE = `http://localhost:${config.services.gateway}/api`;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PASSWORD = '123456';

const CUSTOMERS = [
  ['Nguyễn Minh Anh', 'khach1@anngon.vn', '0912000001'],
  ['Trần Bảo Ngọc', 'khach2@anngon.vn', '0912000002'],
  ['Lê Hoàng Nam', 'khach3@anngon.vn', '0912000003'],
  ['Phạm Thu Hà', 'khach4@anngon.vn', '0912000004'],
  ['Võ Quốc Huy', 'khach5@anngon.vn', '0912000005'],
];
const ADDRESSES = [
  '144 Xuân Thủy, Cầu Giấy, Hà Nội', '25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội', '88 Nguyễn Trãi, Thanh Xuân, Hà Nội',
  '12 Trần Duy Hưng, Cầu Giấy, Hà Nội', '201 Kim Mã, Ba Đình, Hà Nội', '56 Láng Hạ, Đống Đa, Hà Nội',
];
const NOTES = [null, null, null, 'Ít cay', 'Không hành', 'Gọi trước khi giao', 'Thêm đũa thìa'];
const COMMENTS = {
  5: ['Rất ngon, sẽ đặt lại!', 'Đồ ăn nóng hổi, giao nhanh.', 'Đậm đà, đúng vị.', 'Tuyệt vời, 10 điểm!'],
  4: ['Ngon, phần ăn hơi ít.', 'Ổn áp, giá hợp lý.', 'Khá ngon, giao hơi lâu chút.'],
  3: ['Tạm được.', 'Hơi nhạt so với mình.'],
};

// Random có hạt giống cố định -> lần nào chạy cũng ra cùng một bộ dữ liệu
let seed = 20261019;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];

async function api(p, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + p, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${method} ${p}: ${data.error}`), { status: res.status });
  return data;
}
const login = (email, password) => api('/users/login', { method: 'POST', body: { email, password } });

// "YYYY-MM-DD HH:MM:SS" (UTC, đúng định dạng datetime('now') của SQLite) của ngày cách đây `daysAgo`, lúc h:m giờ máy
function stamp(daysAgo, h, m) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
const addMin = (s, min) => new Date(new Date(`${s.replace(' ', 'T')}Z`).getTime() + min * 60_000).toISOString().slice(0, 19).replace('T', ' ');

async function run() {
  try { await login(CUSTOMERS[0][1], PASSWORD); console.log('[seed] Đã có dữ liệu demo — bỏ qua.'); return; } catch {}
  console.log('[seed] Đang tạo dữ liệu demo (khoảng 20 giây)...');

  const admin = (await login(process.env.ADMIN_EMAIL || 'admin@anngon.vn', process.env.ADMIN_PASSWORD || 'admin123')).token;
  const users = [];
  for (const [name, email, phone] of CUSTOMERS) {
    const s = await api('/users/register', { method: 'POST', body: { name, email, phone, password: PASSWORD } });
    users.push({ ...s.user, token: s.token });
  }
  try { const d = await login('demo@anngon.vn', 'demo123'); users.push({ ...d.user, token: d.token }); } catch {}
  for (const u of users) await api('/payments/wallet/topup', { method: 'POST', token: u.token, body: { amount: 1_000_000 } });

  const foods = (await api('/foods?inStock=1')).filter((f) => f.stock >= 10);
  const stock = new Map(foods.map((f) => [f.id, f.stock - 5])); // chừa lại vài phần để thực đơn không bị hết
  const created = []; // { id, daysAgo, steps, user, items }

  for (let i = 0; i < 45; i++) {
    const daysAgo = Math.floor(rnd() * 14);
    const user = pick(users);
    const items = [];
    for (const f of [...foods].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3))) {
      const q = 1 + Math.floor(rnd() * 2);
      if (stock.get(f.id) >= q) { stock.set(f.id, stock.get(f.id) - q); items.push({ foodId: f.id, quantity: q }); }
    }
    if (!items.length) continue;
    const subtotal = items.reduce((s, it) => s + foods.find((f) => f.id === it.foodId).price * it.quantity, 0);
    const order = await api('/orders', {
      method: 'POST', token: user.token,
      body: { address: pick(ADDRESSES), phone: user.phone, note: pick(NOTES), items, couponCode: subtotal >= 100000 && rnd() < 0.3 ? 'GIAM10' : undefined },
    });
    const r = rnd();
    const method = r < 0.35 ? 'CARD' : r < 0.65 ? 'WALLET' : 'COD';
    await api('/payments', { method: 'POST', token: user.token, body: { orderId: order.id, method, cardNumber: '4111 1111 1111 1111' } });

    // Trạng thái đích: đơn cũ phần lớn đã hoàn thành; đơn hôm nay đang ở các bước khác nhau
    const target = daysAgo > 0
      ? (rnd() < 0.88 ? 'COMPLETED' : 'CANCELLED')
      : pick(['CONFIRMED', 'PREPARING', 'DELIVERING', 'COMPLETED', 'COMPLETED']);
    const steps = ['CONFIRMED'];
    if (target === 'CANCELLED') {
      if (rnd() < 0.5) await api(`/orders/${order.id}/cancel`, { method: 'POST', token: user.token });
      else await api(`/orders/${order.id}/status`, { method: 'PATCH', token: admin, body: { status: 'CANCELLED', note: 'Hết nguyên liệu' } });
      steps.push('CANCELLED');
    } else {
      for (const s of ['PREPARING', 'DELIVERING', 'COMPLETED']) {
        if (steps.at(-1) === target) break;
        await api(`/orders/${order.id}/status`, { method: 'PATCH', token: admin, body: { status: s } });
        steps.push(s);
      }
    }
    if (target === 'COMPLETED') {
      for (const it of items) {
        if (rnd() < 0.5) continue;
        const rating = pick([5, 5, 5, 4, 4, 3]);
        await api(`/foods/${it.foodId}/reviews`, { method: 'POST', token: user.token, body: { rating, comment: pick(COMMENTS[rating]) } })
          .catch(() => {}); // đánh giá lại cùng món thì chỉ cập nhật
      }
    }
    created.push({ id: order.id, daysAgo, user, items });
    process.stdout.write('.');
  }

  // Lùi ngày: mỗi đơn đặt trong khung 10h–21h của ngày tương ứng, các bước cách nhau ~12 phút
  const orderDb = new DatabaseSync(path.join(DATA_DIR, 'order.db'));
  const foodDb = new DatabaseSync(path.join(DATA_DIR, 'food.db'));
  for (const o of created) {
    const t0 = stamp(o.daysAgo, 10 + Math.floor(rnd() * 11), Math.floor(rnd() * 60));
    const events = orderDb.prepare('SELECT id FROM order_events WHERE order_id = ? ORDER BY id').all(o.id);
    events.forEach((e, k) => orderDb.prepare('UPDATE order_events SET created_at = ? WHERE id = ?').run(addMin(t0, k * 12), e.id));
    orderDb.prepare('UPDATE orders SET created_at = ?, updated_at = ? WHERE id = ?').run(t0, addMin(t0, (events.length - 1) * 12), o.id);
    for (const it of o.items) {
      foodDb.prepare('UPDATE reviews SET created_at = ? WHERE food_id = ? AND user_id = ?').run(addMin(t0, 90), it.foodId, o.user.id);
    }
  }
  orderDb.close();
  foodDb.close();

  // Thông báo cũ của dữ liệu demo -> đánh dấu đã đọc cho gọn chuông
  for (const t of [admin, ...users.map((u) => u.token)]) await api('/notifications/read-all', { method: 'POST', token: t });

  console.log(`\n[seed] Xong: ${users.length} khách hàng, ${created.length} đơn hàng trong 14 ngày, kèm đánh giá.`);
  console.log(`[seed] Tài khoản khách demo: khach1@anngon.vn … khach5@anngon.vn / ${PASSWORD}`);
}

module.exports = { run };
if (require.main === module) run().catch((e) => { console.error('\n[seed] Lỗi:', e.message, '\n(Hệ thống phải đang chạy: npm start)'); process.exit(1); });
