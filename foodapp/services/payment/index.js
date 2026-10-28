'use strict';
// Đường dẫn: foodapp/services/payment/index.js
// PAYMENT SERVICE — thanh toán giả lập
//   CARD   : số thẻ hợp lệ (Luhn) -> thành công; thẻ đuôi 0002 -> bị từ chối
//   WALLET : ví điện tử mô phỏng có số dư thật trong DB (tặng 200.000đ, nạp thêm được); thiếu tiền -> từ chối
//   COD    : tiền mặt khi nhận hàng -> đơn chuyển CONFIRMED, chưa thu tiền
const crypto = require('node:crypto');
const { serve, openDb, tx, call, requireUser, requireInternal, HttpError, isUniqueError, toInt } = require('../../shared/lib');

const db = openDb(__dirname, 'payment');
const METHODS = ['CARD', 'WALLET', 'COD'];
const WELCOME_BALANCE = 200_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newRef = () => `TXN${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function wallet(userId) {
  db.prepare('INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, ?)').run(userId, WELCOME_BALANCE);
  return db.prepare('SELECT balance FROM wallets WHERE user_id = ?').get(userId);
}
const credit = (userId, amount) =>
  db.prepare(`UPDATE wallets SET balance = balance + ?, updated_at = datetime('now') WHERE user_id = ?`).run(amount, userId);

// Hoàn tiền nguyên tử: chỉ hoàn 1 lần; ví được cộng lại tiền
function refund(paymentId, message) {
  return tx(db, () => {
    const p = db.prepare(`SELECT * FROM payments WHERE id = ? AND status IN ('SUCCESS', 'COD')`).get(paymentId);
    if (!p) return null;
    db.prepare('UPDATE payments SET status = ?, message = ? WHERE id = ?').run(p.status === 'COD' ? 'VOID' : 'REFUNDED', message, p.id);
    if (p.status === 'SUCCESS' && p.method === 'WALLET') credit(p.user_id, p.amount);
    return p;
  });
}

const insertPayment = db.prepare(`INSERT INTO payments (order_id, user_id, amount, method, status, card_last4, transaction_ref, message)
                                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
const toPayment = (p) => ({
  id: p.id, orderId: p.order_id, amount: p.amount, method: p.method, status: p.status,
  cardLast4: p.card_last4, transactionRef: p.transaction_ref, message: p.message, createdAt: p.created_at,
});

serve('payment', [
  ['POST', '/payments', async (ctx) => {
    const user = requireUser(ctx.req);
    const method = String(ctx.body.method || '').toUpperCase();
    if (!METHODS.includes(method)) throw new HttpError(400, 'Phương thức thanh toán không hợp lệ');

    let last4 = null;
    if (method === 'CARD') {
      const digits = String(ctx.body.cardNumber || '').replace(/[\s-]/g, '');
      if (!/^\d{12,19}$/.test(digits) || !luhn(digits)) throw new HttpError(400, 'Số thẻ không hợp lệ');
      last4 = digits.slice(-4);
    }

    // Lấy số tiền từ Order Service — không tin số tiền client gửi
    const order = await call('order', 'GET', `/orders/${toInt(ctx.body.orderId)}`, { internal: true });
    if (order.userId !== user.sub) throw new HttpError(404, 'Không tìm thấy đơn hàng');
    if (order.status !== 'PENDING') throw new HttpError(409, 'Đơn hàng không còn chờ thanh toán');

    await sleep(300); // giả lập độ trễ cổng thanh toán
    const fail = (status, msg) => {
      insertPayment.run(order.id, user.sub, order.total, method, 'FAILED', last4, newRef(), msg);
      return new HttpError(status, msg);
    };
    if (method === 'CARD' && last4 === '0002') throw fail(402, 'Thẻ bị ngân hàng từ chối. Vui lòng thử thẻ khác.');

    let paymentId;
    try {
      paymentId = tx(db, () => {
        const id = insertPayment.run(order.id, user.sub, order.total, method, method === 'COD' ? 'COD' : 'SUCCESS', last4, newRef(), null).lastInsertRowid;
        if (method === 'WALLET') {
          wallet(user.sub);
          const { changes } = db.prepare(`UPDATE wallets SET balance = balance - ?, updated_at = datetime('now') WHERE user_id = ? AND balance >= ?`)
            .run(order.total, user.sub, order.total);
          if (!changes) throw new HttpError(402, 'WALLET_LOW');
        }
        return id;
      });
    } catch (e) {
      if (isUniqueError(e)) throw new HttpError(409, 'Đơn hàng đã được thanh toán');
      if (e.message === 'WALLET_LOW') throw fail(402, 'Số dư ví không đủ. Vui lòng nạp thêm tiền.');
      throw e;
    }

    // Báo Order Service. Nếu thất bại (vd. đơn vừa bị huỷ) -> hoàn tiền để không mất tiền khách.
    try {
      await call('order', 'PATCH', `/orders/${order.id}/payment`, { internal: true, body: { method } });
    } catch (e) {
      refund(paymentId, `Hoàn tiền: ${e.message}`);
      throw new HttpError(409, 'Không thể cập nhật đơn hàng, giao dịch đã được hoàn tiền');
    }

    ctx.status = 201;
    return toPayment(db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId));
  }],

  // Order Service gọi khi đơn bị huỷ
  ['POST', '/payments/refund', (ctx) => {
    requireInternal(ctx.req);
    const p = db.prepare(`SELECT id FROM payments WHERE order_id = ? AND status IN ('SUCCESS', 'COD')`).get(toInt(ctx.body.orderId));
    return { refunded: !!(p && refund(p.id, 'Hoàn tiền do đơn bị huỷ')) };
  }],

  ['GET', '/payments/wallet', (ctx) => wallet(requireUser(ctx.req).sub)],

  // Nạp tiền mô phỏng (không có tiền thật)
  ['POST', '/payments/wallet/topup', (ctx) => {
    const user = requireUser(ctx.req);
    const amount = toInt(ctx.body.amount);
    if (!(amount >= 10_000 && amount <= 5_000_000)) throw new HttpError(400, 'Số tiền nạp từ 10.000đ đến 5.000.000đ');
    wallet(user.sub);
    credit(user.sub, amount);
    return wallet(user.sub);
  }],

  // ?orderId=  lọc theo đơn
  ['GET', '/payments', (ctx) => {
    const user = requireUser(ctx.req);
    const orderId = toInt(ctx.query.get('orderId'));
    const rows = orderId > 0
      ? db.prepare('SELECT * FROM payments WHERE user_id = ? AND order_id = ? ORDER BY id DESC').all(user.sub, orderId)
      : db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.sub);
    return rows.map(toPayment);
  }],
]);
