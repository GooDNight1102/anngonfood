'use strict';
// Đường dẫn: foodapp/services/notification/index.js
// NOTIFICATION SERVICE — thông báo đơn hàng cho khách và quản trị viên (trình duyệt hỏi định kỳ)
const { serve, openDb, requireUser, requireInternal, isStaffRole, HttpError, toInt } = require('../../shared/lib');

const db = openDb(__dirname, 'notification');

// Khách thấy thông báo của mình; nhân viên & admin thấy thêm thông báo chung của cửa hàng (đơn mới, khách huỷ).
// ponytail: trạng thái "đã đọc" của thông báo cửa hàng dùng chung cho mọi nhân viên/admin; tách bảng đã-đọc theo người khi có nhiều admin
const scope = (u) => ({
  sql: `(audience = 'USER' AND user_id = ?)${isStaffRole(u.role) ? ` OR audience = 'ADMIN'` : ''}`,
  args: [u.sub],
});

serve('notification', [
  ['POST', '/notifications', (ctx) => {
    requireInternal(ctx.req);
    const b = ctx.body;
    if (!['USER', 'ADMIN'].includes(b.audience) || !b.title) throw new HttpError(400, 'Thông báo không hợp lệ');
    const { lastInsertRowid } = db.prepare('INSERT INTO notifications (audience, user_id, order_id, title, body) VALUES (?, ?, ?, ?, ?)')
      .run(b.audience, b.audience === 'USER' ? toInt(b.userId) : null, toInt(b.orderId) || null, String(b.title).slice(0, 200), b.body ? String(b.body).slice(0, 500) : null);
    ctx.status = 201;
    return { id: lastInsertRowid };
  }],

  ['GET', '/notifications', (ctx) => {
    const s = scope(requireUser(ctx.req));
    return {
      unread: db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE (${s.sql}) AND is_read = 0`).get(...s.args).n,
      items: db.prepare(`SELECT id, audience, order_id AS orderId, title, body, is_read AS isRead, created_at AS createdAt
        FROM notifications WHERE ${s.sql} ORDER BY id DESC LIMIT 30`).all(...s.args),
    };
  }],

  ['POST', '/notifications/read-all', (ctx) => {
    const s = scope(requireUser(ctx.req));
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE (${s.sql}) AND is_read = 0`).run(...s.args);
    return { ok: true };
  }],
]);
