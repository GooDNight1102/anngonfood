'use strict';
// Đường dẫn: foodapp/services/order/index.js
// ORDER SERVICE — đặt món giao tận nơi, theo dõi trạng thái, xử lý đơn (admin),
//                 mã giảm giá, thống kê và xuất báo cáo doanh thu
// Quyền: STAFF + ADMIN xem & xử lý đơn; chỉ ADMIN xem doanh thu, xuất báo cáo, quản lý mã giảm giá
const { serve, openDb, tx, call, requireUser, requireAdmin, requireStaff, isStaffRole, requireInternal, isInternal, verifyToken, HttpError, toInt, money } = require('../../shared/lib');
const crypto = require('node:crypto');

const db = openDb(__dirname, 'order');
// Mã đổi điểm gắn với 1 khách: thêm cột owner_user_id cho DB cũ (schema.sql không ALTER được khi cột đã có)
if (!db.prepare('PRAGMA table_info(coupons)').all().some((c) => c.name === 'owner_user_id')) {
  db.exec('ALTER TABLE coupons ADD COLUMN owner_user_id INTEGER');
}
const PENDING_TTL_MIN = 15; // đơn chưa thanh toán quá 15 phút sẽ tự huỷ và trả lại hàng vào kho

const STATUS_TEXT = {
  PENDING: 'Chờ thanh toán', CONFIRMED: 'Đã xác nhận', PREPARING: 'Đang chuẩn bị',
  DELIVERING: 'Đang giao', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã huỷ',
};
const METHOD_TEXT = { CARD: 'Thẻ ngân hàng', WALLET: 'Ví điện tử', COD: 'Tiền mặt' };
// Các bước admin được phép chuyển tiếp
const FLOW = {
  PENDING: ['CANCELLED'], CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['DELIVERING', 'CANCELLED'], DELIVERING: ['COMPLETED', 'CANCELLED'],
};
const CUSTOMER_MSG = {
  PREPARING: 'Nhà hàng đang chuẩn bị món của bạn.',
  DELIVERING: 'Shipper đang trên đường giao món tới bạn.',
  COMPLETED: 'Chúc bạn ngon miệng! Hãy dành chút thời gian đánh giá món ăn nhé.',
};

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD theo giờ máy chủ
const shiftDate = (ymd, n) => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const validDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : null);
const localTime = (s) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('vi-VN');

function loadOrder(id) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return null;
  return {
    id: o.id, userId: o.user_id, customerName: o.customer_name, phone: o.phone,
    address: o.address,
    status: o.status, statusText: STATUS_TEXT[o.status], next: FLOW[o.status] || [],
    paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    subtotal: o.subtotal, discount: o.discount, total: o.total, couponCode: o.coupon_code, note: o.note,
    createdAt: o.created_at, updatedAt: o.updated_at,
    items: db.prepare('SELECT food_id AS foodId, name, price, quantity FROM order_items WHERE order_id = ?').all(id),
    events: db.prepare('SELECT status, note, created_at AS createdAt FROM order_events WHERE order_id = ? ORDER BY id').all(id),
  };
}
// ponytail: N+1 query khi tải danh sách; gộp thành JOIN nếu một trang cần hàng nghìn đơn
const loadMany = (rows) => rows.map((r) => loadOrder(r.id));

// Chuyển trạng thái nguyên tử: chỉ thành công nếu đơn đang ở một trong các trạng thái `from`
// -> chống race giữa khách huỷ / thanh toán / admin xử lý cùng lúc
function setStatus(id, from, to, note, fields = {}) {
  return tx(db, () => {
    const sets = Object.keys(fields).map((k) => `, ${k} = ?`).join('');
    const { changes } = db.prepare(`UPDATE orders SET status = ?${sets}, updated_at = datetime('now')
      WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`).run(to, ...Object.values(fields), id, ...from);
    if (!changes) throw new HttpError(409, 'Trạng thái đơn hàng vừa thay đổi, vui lòng tải lại');
    db.prepare('INSERT INTO order_events (order_id, status, note) VALUES (?, ?, ?)').run(id, to, note ?? null);
    if (to === 'COMPLETED') awardPoints(id);
    if (to === 'CANCELLED') {
      db.prepare('UPDATE coupons SET used_count = MAX(used_count - 1, 0) WHERE code = (SELECT coupon_code FROM orders WHERE id = ?)').run(id);
    }
    return loadOrder(id);
  });
}

const logErr = (what) => (e) => console.error(`[order] ${what} lỗi:`, e.message);
const notify = (n) => call('notification', 'POST', '/notifications', { internal: true, body: n }).catch(logErr('gửi thông báo'));
const notifyCustomer = (o, body) => notify({ audience: 'USER', userId: o.userId, orderId: o.id, title: `Đơn #${o.id}: ${o.statusText}`, body });
const notifyAdmin = (o, title, body) => notify({ audience: 'ADMIN', orderId: o.id, title, body });

// ponytail: hoàn kho / hoàn tiền là best-effort (ghi log nếu service kia đang tắt); cần chắc chắn thì dùng outbox + retry
async function cancelOrder(id, from, note) {
  const o = setStatus(id, from, 'CANCELLED', note);
  await call('food', 'POST', '/foods/release', { internal: true, body: { items: o.items } }).catch(logErr('hoàn kho'));
  if (o.paymentStatus === 'PAID') {
    try {
      await call('payment', 'POST', '/payments/refund', { internal: true, body: { orderId: id } });
      db.prepare(`UPDATE orders SET payment_status = 'REFUNDED' WHERE id = ?`).run(id);
    } catch (e) { logErr('hoàn tiền')(e); }
  }
  return loadOrder(id);
}

function parseItems(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, 'Giỏ hàng trống');
  const qty = new Map();
  for (const it of raw) {
    const id = toInt(it?.foodId), q = toInt(it?.quantity);
    if (!(id > 0) || !(q > 0)) throw new HttpError(400, 'Món hoặc số lượng không hợp lệ');
    qty.set(id, (qty.get(id) || 0) + q);
  }
  if (qty.size > 30) throw new HttpError(400, 'Tối đa 30 món khác nhau mỗi đơn');
  if ([...qty.values()].some((q) => q > 50)) throw new HttpError(400, 'Mỗi món tối đa 50 phần');
  return [...qty].map(([foodId, quantity]) => ({ foodId, quantity }));
}

// ---------- Mã giảm giá ----------
function couponDiscount(code, subtotal, userId = null) {
  const c = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code);
  if (c?.owner_user_id && c.owner_user_id !== userId) throw new HttpError(400, 'Mã giảm giá không tồn tại'); // voucher đổi điểm chỉ chủ sở hữu dùng được
  if (!c || !c.active) throw new HttpError(400, 'Mã giảm giá không tồn tại');
  if (c.expires_at && c.expires_at < today()) throw new HttpError(400, 'Mã giảm giá đã hết hạn');
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) throw new HttpError(400, 'Mã giảm giá đã hết lượt sử dụng');
  if (subtotal < c.min_order) throw new HttpError(400, `Mã ${c.code} áp dụng cho đơn từ ${money(c.min_order)}`);
  let d = c.type === 'PERCENT' ? Math.floor((subtotal * c.value) / 100) : c.value;
  if (c.max_discount) d = Math.min(d, c.max_discount);
  return { code: c.code, description: c.description, discount: Math.min(d, subtotal) };
}

const toCoupon = (c) => ({
  code: c.code, description: c.description, type: c.type, value: c.value, minOrder: c.min_order,
  maxDiscount: c.max_discount, usageLimit: c.usage_limit, usedCount: c.used_count, expiresAt: c.expires_at, active: !!c.active,
});

function couponInput(b) {
  const opt = (v) => (v === '' || v === null || v === undefined ? null : toInt(v));
  const c = {
    code: String(b.code || '').trim().toUpperCase(), description: String(b.description || '').trim().slice(0, 200) || null,
    type: b.type, value: toInt(b.value), minOrder: opt(b.minOrder) ?? 0, maxDiscount: opt(b.maxDiscount),
    usageLimit: opt(b.usageLimit), expiresAt: b.expiresAt || null,
  };
  if (!/^[A-Z0-9]{3,20}$/.test(c.code)) throw new HttpError(400, 'Mã gồm 3–20 chữ cái hoặc số, không dấu');
  if (!['PERCENT', 'FIXED'].includes(c.type)) throw new HttpError(400, 'Loại giảm giá không hợp lệ');
  if (!(c.value > 0) || (c.type === 'PERCENT' && c.value > 100)) throw new HttpError(400, 'Giá trị giảm không hợp lệ');
  if (!(c.minOrder >= 0)) throw new HttpError(400, 'Giá trị đơn tối thiểu không hợp lệ');
  if (c.maxDiscount !== null && !(c.maxDiscount > 0)) throw new HttpError(400, 'Mức giảm tối đa không hợp lệ');
  if (c.usageLimit !== null && !(c.usageLimit > 0)) throw new HttpError(400, 'Số lượt dùng không hợp lệ');
  if (c.expiresAt && !validDate(c.expiresAt)) throw new HttpError(400, 'Ngày hết hạn không hợp lệ');
  return c;
}

// ---------- CSV (mở được bằng Excel) ----------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // chặn CSV/formula injection từ dữ liệu khách nhập
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------- Tự huỷ đơn quá hạn thanh toán ----------
// ponytail: quét theo chu kỳ trong tiến trình; chạy nhiều bản Order Service thì chuyển sang job queue
setInterval(() => {
  const rows = db.prepare(`SELECT id FROM orders WHERE status = 'PENDING' AND created_at < datetime('now', ?)`).all(`-${PENDING_TTL_MIN} minutes`);
  for (const { id } of rows) {
    cancelOrder(id, ['PENDING'], 'Tự huỷ do quá hạn thanh toán')
      .then((o) => notifyCustomer(o, `Đơn đã tự huỷ vì chưa thanh toán sau ${PENDING_TTL_MIN} phút.`))
      .catch(() => {}); // đơn vừa được thanh toán/huỷ ở nơi khác -> bỏ qua
  }
}, 60_000).unref();

// ---------- Điểm thưởng ----------
// 1 điểm / 1.000đ của đơn HOÀN THÀNH (đơn huỷ không có điểm). Hạng theo tổng điểm đã tích: Bạc +10%, Vàng +20%.
const TIERS = [{ name: 'Đồng', from: 0, bonus: 0 }, { name: 'Bạc', from: 500, bonus: 10 }, { name: 'Vàng', from: 1500, bonus: 20 }];
const tierOf = (lifetime) => [...TIERS].reverse().find((t) => lifetime >= t.from);
const REWARDS = [
  { id: 'R10', points: 100, title: 'Giảm 10.000đ', type: 'FIXED', value: 10000, minOrder: 50000 },
  { id: 'R30', points: 250, title: 'Giảm 30.000đ', type: 'FIXED', value: 30000, minOrder: 120000 },
  { id: 'R20', points: 500, title: 'Giảm 20% (tối đa 80.000đ)', type: 'PERCENT', value: 20, minOrder: 200000, maxDiscount: 80000 },
];
const VOUCHER_DAYS = 30;
const lifetimePoints = (uid) => db.prepare(`SELECT IFNULL(SUM(delta), 0) AS n FROM point_ledger WHERE user_id = ? AND reason = 'EARN'`).get(uid).n;
const pointBalance = (uid) => db.prepare('SELECT IFNULL(SUM(delta), 0) AS n FROM point_ledger WHERE user_id = ?').get(uid).n;

// Gọi trong cùng giao dịch với việc chuyển đơn sang COMPLETED; chạy lại không cộng trùng
function awardPoints(orderId) {
  const o = db.prepare('SELECT user_id, total FROM orders WHERE id = ?').get(orderId);
  const base = o ? Math.floor(o.total / 1000) : 0;
  if (base < 1) return 0;
  const pts = Math.floor((base * (100 + tierOf(lifetimePoints(o.user_id)).bonus)) / 100);
  const { changes } = db.prepare(`INSERT OR IGNORE INTO point_ledger (user_id, delta, reason, order_id, note) VALUES (?, ?, 'EARN', ?, ?)`)
    .run(o.user_id, pts, orderId, `Đơn #${orderId} hoàn thành`);
  return changes ? pts : 0;
}
// Đơn đã hoàn thành từ trước khi có tính năng điểm: cộng bù khi khởi động (idempotent)
for (const { id } of db.prepare(`SELECT id FROM orders WHERE status = 'COMPLETED' ORDER BY id`).all()) awardPoints(id);

const newVoucherCode = () => `DIEM${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

serve('order', [
  // ===== Điểm thưởng =====
  ['GET', '/points', (ctx) => {
    const { sub: uid } = requireUser(ctx.req);
    const lifetime = lifetimePoints(uid), tier = tierOf(lifetime), next = TIERS.find((t) => t.from > lifetime) || null;
    return {
      balance: pointBalance(uid), lifetime, tier: tier.name, bonus: tier.bonus,
      next: next && { name: next.name, need: next.from - lifetime },
      rewards: REWARDS.map((r) => ({ id: r.id, points: r.points, title: r.title, minOrder: r.minOrder })),
      history: db.prepare('SELECT delta, reason, note, created_at AS createdAt FROM point_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(uid),
      vouchers: db.prepare(`SELECT code, description, expires_at AS expiresAt FROM coupons WHERE owner_user_id = ? AND active = 1
        AND used_count < IFNULL(usage_limit, 1) AND (expires_at IS NULL OR expires_at >= ?) ORDER BY created_at DESC`).all(uid, today()),
    };
  }],

  // Đổi điểm lấy voucher riêng: { rewardId }
  ['POST', '/points/redeem', (ctx) => {
    const { sub: uid } = requireUser(ctx.req);
    const r = REWARDS.find((x) => x.id === ctx.body.rewardId);
    if (!r) throw new HttpError(400, 'Phần quà không tồn tại');
    return tx(db, () => {
      if (pointBalance(uid) < r.points) throw new HttpError(400, `Bạn cần ${r.points} điểm để đổi quà này`);
      const code = newVoucherCode();
      const expires = shiftDate(today(), VOUCHER_DAYS);
      db.prepare(`INSERT INTO coupons (code, description, type, value, min_order, max_discount, usage_limit, expires_at, owner_user_id)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(code, `${r.title} cho đơn từ ${money(r.minOrder)} (đổi từ ${r.points} điểm)`, r.type, r.value, r.minOrder, r.maxDiscount ?? null, expires, uid);
      db.prepare(`INSERT INTO point_ledger (user_id, delta, reason, note) VALUES (?, ?, 'REDEEM', ?)`).run(uid, -r.points, `Đổi voucher ${code}`);
      return { code, title: r.title, expiresAt: expires, balance: pointBalance(uid) };
    });
  }],

  // ===== Mã giảm giá =====
  ['GET', '/coupons/public', () => db.prepare(`SELECT code, description FROM coupons WHERE active = 1 AND owner_user_id IS NULL
      AND (expires_at IS NULL OR expires_at >= ?) AND (usage_limit IS NULL OR used_count < usage_limit) ORDER BY min_order`).all(today())],

  ['POST', '/coupons/check', (ctx) => {
    const subtotal = toInt(ctx.body.subtotal);
    if (!(subtotal >= 0)) throw new HttpError(400, 'Giá trị đơn không hợp lệ');
    const uid = verifyToken((ctx.req.headers.authorization || '').replace(/^Bearer\s+/i, ''))?.sub ?? null;
    return couponDiscount(String(ctx.body.code || '').trim(), subtotal, uid);
  }],

  ['GET', '/coupons', (ctx) => {
    requireAdmin(ctx.req);
    return db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all().map(toCoupon);
  }],

  ['POST', '/coupons', (ctx) => {
    requireAdmin(ctx.req);
    const c = couponInput(ctx.body);
    try {
      db.prepare(`INSERT INTO coupons (code, description, type, value, min_order, max_discount, usage_limit, expires_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(c.code, c.description, c.type, c.value, c.minOrder, c.maxDiscount, c.usageLimit, c.expiresAt);
    } catch (e) {
      if (/UNIQUE|PRIMARY KEY/.test(e.message)) throw new HttpError(409, 'Mã giảm giá đã tồn tại');
      throw e;
    }
    ctx.status = 201;
    return toCoupon(db.prepare('SELECT * FROM coupons WHERE code = ?').get(c.code));
  }],

  ['PATCH', '/coupons/:code', (ctx) => {
    requireAdmin(ctx.req);
    if (!db.prepare('UPDATE coupons SET active = ? WHERE code = ?').run(ctx.body.active ? 1 : 0, ctx.params.code).changes) {
      throw new HttpError(404, 'Không tìm thấy mã giảm giá');
    }
    return toCoupon(db.prepare('SELECT * FROM coupons WHERE code = ?').get(ctx.params.code));
  }],

  // ===== Đặt món =====
  ['POST', '/orders', async (ctx) => {
    const user = requireUser(ctx.req);
    const b = ctx.body;
    const phone = String(b.phone || '').trim();
    const address = String(b.address || '').trim().slice(0, 200);
    const note = String(b.note || '').trim().slice(0, 300) || null;
    if (address.length < 5) throw new HttpError(400, 'Vui lòng nhập địa chỉ giao hàng');
    if (!phone) throw new HttpError(400, 'Vui lòng nhập số điện thoại để shipper liên hệ');
    if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Số điện thoại phải gồm 10 số, bắt đầu bằng 0');
    const items = parseItems(b.items);
    const code = String(b.couponCode || '').trim() || null;

    // Giữ hàng ở Food Service (trả về giá thật — giá client gửi bị bỏ qua)
    const lines = await call('food', 'POST', '/foods/reserve', { internal: true, body: { items } });
    let orderId;
    try {
      orderId = tx(db, () => {
        const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
        const coupon = code ? couponDiscount(code, subtotal, user.sub) : null;
        if (coupon) db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').run(coupon.code);
        const discount = coupon?.discount || 0;
        const { lastInsertRowid: id } = db.prepare(`INSERT INTO orders
          (user_id, customer_name, phone, address, subtotal, discount, total, coupon_code, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(user.sub, user.name, phone, address, subtotal, discount, subtotal - discount, coupon?.code ?? null, note);
        const ins = db.prepare('INSERT INTO order_items (order_id, food_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');
        for (const l of lines) ins.run(id, l.foodId, l.name, l.price, l.quantity);
        db.prepare(`INSERT INTO order_events (order_id, status, note) VALUES (?, 'PENDING', 'Đã tạo đơn')`).run(id);
        return id;
      });
    } catch (e) {
      await call('food', 'POST', '/foods/release', { internal: true, body: { items } }).catch(logErr('hoàn kho'));
      throw e;
    }
    ctx.status = 201;
    return loadOrder(orderId);
  }],

  // Lịch sử đặt món của tôi: ?status=
  ['GET', '/orders', (ctx) => {
    const user = requireUser(ctx.req);
    const status = ctx.query.get('status');
    return loadMany(STATUS_TEXT[status]
      ? db.prepare('SELECT id FROM orders WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 50').all(user.sub, status)
      : db.prepare('SELECT id FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.sub));
  }],

  // ===== Quản trị =====
  // ?status=PENDING|...|ACTIVE (đang xử lý)  &q= (mã đơn, tên, SĐT)
  ['GET', '/orders/admin/all', (ctx) => {
    requireStaff(ctx.req);
    const where = [], args = [];
    const status = ctx.query.get('status');
    if (status === 'ACTIVE') where.push(`status IN ('CONFIRMED', 'PREPARING', 'DELIVERING')`);
    else if (STATUS_TEXT[status]) { where.push('status = ?'); args.push(status); }
    const q = String(ctx.query.get('q') || '').trim();
    if (q) { where.push('(id = ? OR customer_name LIKE ? OR phone LIKE ?)'); args.push(toInt(q.replace('#', '')) || 0, `%${q}%`, `%${q}%`); }
    return loadMany(db.prepare(`SELECT id FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).all(...args));
  }],

  // Dashboard: ?days=7|30|90
  ['GET', '/orders/admin/stats', (ctx) => {
    requireAdmin(ctx.req);
    const days = [7, 30, 90].includes(toInt(ctx.query.get('days'))) ? toInt(ctx.query.get('days')) : 7;
    const from = shiftDate(today(), -(days - 1));
    const valid = `o.status NOT IN ('PENDING', 'CANCELLED') AND date(o.created_at, 'localtime') >= ?`;
    const k = db.prepare(`SELECT IFNULL(SUM(total), 0) AS revenue, COUNT(*) AS orders, COUNT(DISTINCT user_id) AS customers,
      IFNULL(SUM(discount), 0) AS discount FROM orders o WHERE ${valid}`).get(from);
    const daily = new Map(db.prepare(`SELECT date(created_at, 'localtime') AS day, SUM(total) AS revenue, COUNT(*) AS orders
      FROM orders o WHERE ${valid} GROUP BY day`).all(from).map((r) => [r.day, r]));
    return {
      days, from, to: today(),
      kpis: { ...k, avgOrder: k.orders ? Math.round(k.revenue / k.orders) : 0 },
      byDay: Array.from({ length: days }, (_, i) => {
        const date = shiftDate(from, i);
        return { date, revenue: daily.get(date)?.revenue || 0, orders: daily.get(date)?.orders || 0 };
      }),
      byStatus: Object.fromEntries(db.prepare(`SELECT status, COUNT(*) AS n FROM orders o
        WHERE date(o.created_at, 'localtime') >= ? GROUP BY status`).all(from).map((r) => [r.status, r.n])),
      byMethod: db.prepare(`SELECT payment_method AS method, COUNT(*) AS orders, SUM(total) AS revenue FROM orders o
        WHERE ${valid} GROUP BY payment_method ORDER BY revenue DESC`).all(from),
      topFoods: db.prepare(`SELECT i.food_id AS foodId, i.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.price) AS revenue
        FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${valid}
        GROUP BY i.food_id ORDER BY quantity DESC LIMIT 5`).all(from),
    };
  }],

  // Xuất báo cáo CSV: ?from=YYYY-MM-DD&to=YYYY-MM-DD (mặc định 30 ngày gần nhất)
  ['GET', '/orders/admin/report', (ctx) => {
    requireAdmin(ctx.req);
    const to = validDate(ctx.query.get('to')) || today();
    const from = validDate(ctx.query.get('from')) || shiftDate(to, -29);
    if (from > to) throw new HttpError(400, 'Ngày bắt đầu phải trước ngày kết thúc');
    const inRange = `date(created_at, 'localtime') BETWEEN ? AND ?`;
    const orders = db.prepare(`SELECT * FROM orders WHERE ${inRange} ORDER BY id`).all(from, to);
    const valid = orders.filter((o) => !['PENDING', 'CANCELLED'].includes(o.status));
    const sum = (list, k) => list.reduce((s, o) => s + o[k], 0);
    const rows = [
      ['BÁO CÁO DOANH THU', `Từ ${from} đến ${to}`],
      [],
      ['Mã đơn', 'Thời gian', 'Khách hàng', 'SĐT', 'Địa chỉ giao hàng', 'Trạng thái', 'Phương thức TT', 'Trạng thái TT', 'Tạm tính', 'Giảm giá', 'Mã giảm giá', 'Thành tiền'],
      ...orders.map((o) => [
        o.id, localTime(o.created_at), o.customer_name, o.phone,
        o.address, STATUS_TEXT[o.status], METHOD_TEXT[o.payment_method] || '',
        { UNPAID: 'Chưa thu', PAID: 'Đã thu', REFUNDED: 'Đã hoàn tiền' }[o.payment_status], o.subtotal, o.discount, o.coupon_code, o.total,
      ]),
      [],
      ['TỔNG HỢP (không tính đơn chờ thanh toán / đã huỷ)'],
      ['Số đơn hợp lệ', valid.length],
      ['Doanh thu', sum(valid, 'total')],
      ['Tổng giảm giá', sum(valid, 'discount')],
      ['Số đơn đã huỷ', orders.filter((o) => o.status === 'CANCELLED').length],
      [],
      ['DOANH THU THEO NGÀY'],
      ['Ngày', 'Số đơn', 'Doanh thu'],
      ...db.prepare(`SELECT date(created_at, 'localtime') AS day, COUNT(*) AS n, SUM(total) AS revenue FROM orders
        WHERE status NOT IN ('PENDING', 'CANCELLED') AND ${inRange} GROUP BY day ORDER BY day`).all(from, to).map((r) => [r.day, r.n, r.revenue]),
    ];
    ctx.headers = {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bao-cao-doanh-thu_${from}_${to}.csv"`,
    };
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }],

  // ===== Nội bộ =====
  // Food Service hỏi: người này đã nhận (đơn hoàn thành) món này chưa? -> mới cho đánh giá
  ['GET', '/orders/internal/purchased', (ctx) => {
    requireInternal(ctx.req);
    const row = db.prepare(`SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.user_id = ? AND i.food_id = ? AND o.status = 'COMPLETED' LIMIT 1`)
      .get(toInt(ctx.query.get('userId')), toInt(ctx.query.get('foodId')));
    return { purchased: !!row };
  }],

  // Chủ đơn, nhân viên / admin hoặc service nội bộ (Payment) xem chi tiết
  ['GET', '/orders/:id', (ctx) => {
    const user = isInternal(ctx.req) ? null : requireUser(ctx.req);
    const order = loadOrder(toInt(ctx.params.id));
    if (!order || (user && !isStaffRole(user.role) && order.userId !== user.sub)) throw new HttpError(404, 'Không tìm thấy đơn hàng');
    return order;
  }],

  // Khách huỷ: chỉ khi nhà hàng chưa bắt đầu chuẩn bị
  ['POST', '/orders/:id/cancel', async (ctx) => {
    const user = requireUser(ctx.req);
    const order = loadOrder(toInt(ctx.params.id));
    if (!order || order.userId !== user.sub) throw new HttpError(404, 'Không tìm thấy đơn hàng');
    if (!['PENDING', 'CONFIRMED'].includes(order.status)) throw new HttpError(409, 'Nhà hàng đã bắt đầu chuẩn bị, không thể huỷ đơn');
    const o = await cancelOrder(order.id, ['PENDING', 'CONFIRMED'], 'Khách hàng huỷ đơn');
    if (order.status === 'CONFIRMED') await notifyAdmin(o, `Đơn #${o.id} đã bị khách huỷ`, `${o.customerName} · ${money(o.total)}`);
    return o;
  }],

  // Nhân viên / admin xử lý đơn: { status, note? }
  ['PATCH', '/orders/:id/status', async (ctx) => {
    requireStaff(ctx.req);
    const order = loadOrder(toInt(ctx.params.id));
    if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng');
    const to = ctx.body.status;
    if (!order.next.includes(to)) {
      throw new HttpError(400, `Không thể chuyển từ "${order.statusText}" sang "${STATUS_TEXT[to] || to}"`);
    }
    const note = String(ctx.body.note || '').trim().slice(0, 200) || null;
    const o = to === 'CANCELLED'
      ? await cancelOrder(order.id, [order.status], note || 'Nhà hàng huỷ đơn')
      : setStatus(order.id, [order.status], to, note, to === 'COMPLETED' ? { payment_status: 'PAID' } : {});
    await notifyCustomer(o, to === 'CANCELLED'
      ? `Rất tiếc, nhà hàng đã huỷ đơn${note ? `: ${note}` : ''}.${o.paymentStatus === 'REFUNDED' ? ' Tiền đã được hoàn lại.' : ''}`
      : CUSTOMER_MSG[to] + (to === 'COMPLETED' ? ` Bạn được +${db.prepare(`SELECT IFNULL(SUM(delta), 0) AS n FROM point_ledger WHERE order_id = ? AND reason = 'EARN'`).get(o.id).n} điểm thưởng.` : ''));
    return o;
  }],

  // Payment Service báo kết quả thanh toán: { method }
  ['PATCH', '/orders/:id/payment', async (ctx) => {
    requireInternal(ctx.req);
    const method = ctx.body.method;
    if (!METHOD_TEXT[method]) throw new HttpError(400, 'Phương thức thanh toán không hợp lệ');
    const o = setStatus(toInt(ctx.params.id), ['PENDING'], 'CONFIRMED',
      method === 'COD' ? 'Thanh toán tiền mặt khi nhận' : `Đã thanh toán qua ${METHOD_TEXT[method]}`,
      { payment_method: method, payment_status: method === 'COD' ? 'UNPAID' : 'PAID' });
    await notifyCustomer(o, method === 'COD'
      ? 'Đơn đã được xác nhận. Vui lòng chuẩn bị tiền mặt khi nhận món.'
      : 'Thanh toán thành công! Nhà hàng sẽ sớm chuẩn bị món cho bạn.');
    await notifyAdmin(o, `Đơn mới #${o.id} — ${money(o.total)}`,
      `${o.address} · ${o.customerName} · ${METHOD_TEXT[method]}`);
    return o;
  }],
]);
