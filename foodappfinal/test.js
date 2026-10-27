'use strict';
// Đường dẫn: foodapp/test.js
// Kiểm thử end-to-end các luồng chính qua API Gateway.
// npm test -> tự bật hệ thống với CSDL tạm (không đụng dữ liệu thật), chạy, rồi tắt.
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'anngon-test-'));
const BASE = 'http://localhost:3000/api';
const sys = spawn(process.execPath, [path.join(__dirname, 'start.js')], { stdio: 'ignore', env: { ...process.env, DATA_DIR, NO_SEED: '1' } });

async function api(p, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(BASE + p, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}
const post = (p, body, token) => api(p, { method: 'POST', body, token });

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { if ((await api('/health')).status === 200) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Hệ thống không khởi động được');
}

let step = 0;
const ok = (name) => console.log(`  ✔ ${++step}. ${name}`);

async function main() {
  await waitUp();
  const email = `khach${Date.now()}@mail.com`;

  // ---- 1. Đăng ký, đăng nhập, phân quyền ----
  const reg = await post('/users/register', { name: 'Nguyễn Văn A', email, password: '123456', phone: '0912345678' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'GUEST', 'tự đăng ký luôn là khách hàng');
  assert.equal((await post('/users/register', { name: 'Hack', email: `h${email}`, password: '123456', role: 'ADMIN' })).data.user.role, 'GUEST', 'không tự chọn được vai trò');
  const token = reg.data.token;
  assert.equal((await post('/users/register', { name: 'Bb', email, password: '123456' })).status, 409);
  assert.equal((await post('/users/login', { email, password: 'sai' })).status, 401);
  const admin = (await post('/users/login', { email: 'admin@anngon.vn', password: 'admin123' })).data;
  assert.equal(admin.user.role, 'ADMIN');
  const A = admin.token;
  assert.equal((await api('/users', { token })).status, 403, 'khách không vào được API quản trị');
  assert.equal((await api('/orders/admin/stats', { token })).status, 403);
  assert.equal((await post('/foods', { name: 'Hack' }, token)).status, 403);
  assert.ok((await api('/users', { token: A })).data.length >= 2);
  ok('Đăng ký, đăng nhập, phân quyền khách / admin');


  // ---- 2. Tìm kiếm, lọc ----
  const search = (qs) => api(`/foods?${qs}`).then((r) => r.data.map((f) => f.name));
  assert.deepEqual(await search('q=pho%20bo'), ['Phở bò tái chín', 'Combo Gia đình'], 'tìm không dấu (combo có phở bò cũng ra)');
  assert.ok((await search('q=pho')).includes('Gỏi cuốn tôm thịt'), 'tìm cả trong mô tả ("đậu phộng")');
  assert.deepEqual(await search('q=BÚN BÒ'), ['Bún bò Huế', 'Combo Bạn bè']);
  assert.equal((await api('/foods?category=5')).data.length, 5, 'danh mục Combo có 5 combo');
  assert.ok((await api('/foods')).data.length >= 110, 'thực đơn đủ 110 món, không bị cắt ở 100');
  assert.ok((await search('q=%25')).length === 0, 'ký tự đặc biệt không phá câu truy vấn');
  assert.ok((await api('/foods?category=4')).data.every((f) => f.categoryId === 4));
  assert.ok((await api('/foods?maxPrice=29999')).data.every((f) => f.price < 30000));
  assert.ok((await api('/foods?inStock=1')).data.every((f) => f.stock > 0));
  const byPrice = (await api('/foods?sort=price_desc')).data.map((f) => f.price);
  assert.deepEqual(byPrice, [...byPrice].sort((a, b) => b - a));
  ok('Tìm kiếm không dấu, lọc danh mục / giá / còn hàng, sắp xếp');

  // ---- 3. Quản trị món ăn + tồn kho ----
  const food = (await post('/foods', { name: 'Món thử nghiệm', categoryId: 1, price: 40000, stock: 3, image: '🍱' }, A)).data;
  assert.equal(food.stock, 3);
  assert.equal((await post('/foods', { name: 'X', categoryId: 1, price: 40000, stock: 1 }, A)).status, 400, 'validate tên');
  const edited = (await api(`/foods/${food.id}`, { method: 'PUT', token: A, body: { ...food, price: 50000 } })).data;
  assert.equal(edited.price, 50000);
  // Tải ảnh món (PNG 1x1)
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  assert.equal((await post(`/foods/${food.id}/image`, { data: png }, token)).status, 403, 'khách không đổi ảnh được');
  assert.equal((await post(`/foods/${food.id}/image`, { data: 'data:text/html;base64,PGgxPg==' }, A)).status, 400, 'chỉ nhận ảnh');
  const withImg = (await post(`/foods/${food.id}/image`, { data: png }, A)).data;
  assert.match(withImg.image, /^\/images\/food-\d+-\d+\.png$/);
  const imgRes = await fetch(`http://localhost:3000${withImg.image}`);
  assert.equal(imgRes.status, 200);
  assert.equal(imgRes.headers.get('content-type').split(';')[0], 'image/png');
  fs.rmSync(path.join(__dirname, 'public', withImg.image), { force: true }); // dọn file thử
  ok('Admin thêm / sửa món, tải ảnh món, kiểm tra dữ liệu đầu vào');

  // ---- 4. Đặt món + mã giảm giá + lưu đơn ----
  const addr = { address: '144 Xuân Thủy, Cầu Giấy', phone: '0912345678' };
  assert.equal((await post('/coupons/check', { code: 'GIAM10', subtotal: 50000 })).status, 400, 'chưa đủ đơn tối thiểu');
  assert.equal((await post('/coupons/check', { code: 'GIAM10', subtotal: 500000 })).data.discount, 30000, 'trần giảm tối đa');
  // 2 × 50k (món thử) + 1 × 60k (phở) = 160k; GIAM10 = 16k
  const o1 = await post('/orders', { ...addr, couponCode: 'giam10', items: [{ foodId: food.id, quantity: 1, price: 1 }, { foodId: food.id, quantity: 1 }, { foodId: 4, quantity: 1 }] }, token);
  assert.equal(o1.status, 201, JSON.stringify(o1.data));
  assert.deepEqual([o1.data.subtotal, o1.data.discount, o1.data.total], [160000, 16000, 144000], 'giá client gửi bị bỏ qua');
  assert.equal(o1.data.status, 'PENDING');
  assert.equal((await api(`/foods/${food.id}`)).data.stock, 1, 'trừ kho khi đặt');
  assert.equal((await post('/orders', { ...addr, items: [{ foodId: food.id, quantity: 2 }] }, token)).status, 409, 'vượt tồn kho');
  assert.equal((await post('/orders', { ...addr, items: [{ foodId: 9, quantity: 1 }] }, token)).status, 409, 'món hết hàng');
  assert.equal((await post('/orders', { address: 'abc', items: [{ foodId: 1, quantity: 1 }] }, token)).status, 400);
  assert.equal((await post('/orders', { ...addr, items: [{ foodId: 1, quantity: 1 }] })).status, 401);
  ok('Đặt món, mã giảm giá, trừ tồn kho, chặn vượt kho');

  // ---- 5. Thanh toán thẻ (giả lập) ----
  const pay = (orderId, method, extra = {}, t = token) => post('/payments', { orderId, method, ...extra }, t);
  assert.equal((await pay(o1.data.id, 'CARD', { cardNumber: '1234 5678' })).status, 400);
  assert.equal((await pay(o1.data.id, 'CARD', { cardNumber: '4000 0000 0000 0002' })).status, 402);
  const p1 = await pay(o1.data.id, 'CARD', { cardNumber: '4111 1111 1111 1111' });
  assert.equal(p1.status, 201);
  assert.equal(p1.data.amount, 144000);
  const paid = (await api(`/orders/${o1.data.id}`, { token })).data;
  assert.deepEqual([paid.status, paid.paymentStatus], ['CONFIRMED', 'PAID']);
  assert.equal((await pay(o1.data.id, 'WALLET')).status, 409, 'không trả 2 lần');
  ok('Thanh toán thẻ: thẻ sai, bị từ chối, thành công, chặn trả 2 lần');

  // ---- 6. Ví điện tử mô phỏng ----
  assert.equal((await api('/payments/wallet', { token })).data.balance, 200000);
  const big = await post('/orders', { ...addr, items: [{ foodId: 4, quantity: 4 }] }, token); // 240k > 200k
  assert.equal((await pay(big.data.id, 'WALLET')).status, 402, 'thiếu số dư');
  assert.equal((await api('/payments/wallet', { token })).data.balance, 200000, 'không bị trừ khi thất bại');
  assert.equal((await post('/payments/wallet/topup', { amount: 100000 }, token)).data.balance, 300000);
  assert.equal((await pay(big.data.id, 'WALLET')).status, 201);
  assert.equal((await api('/payments/wallet', { token })).data.balance, 60000);
  ok('Ví điện tử: thiếu số dư, nạp tiền, thanh toán trừ số dư');

  // ---- 7. Huỷ đơn -> hoàn kho, hoàn tiền ví, trả lượt mã giảm giá ----
  const stockBefore = (await api('/foods/4')).data.stock;
  const c = await post(`/orders/${big.data.id}/cancel`, {}, token);
  assert.deepEqual([c.data.status, c.data.paymentStatus], ['CANCELLED', 'REFUNDED']);
  assert.equal((await api('/payments/wallet', { token })).data.balance, 300000, 'hoàn tiền về ví');
  assert.equal((await api('/foods/4')).data.stock, stockBefore + 4, 'hoàn kho');
  ok('Huỷ đơn: hoàn tiền ví, hoàn tồn kho');

  // ---- 8. Thanh toán đồng thời ----
  const o2 = await post('/orders', { ...addr, items: [{ foodId: 10, quantity: 2 }] }, token);
  const both = await Promise.all([1, 2].map(() => pay(o2.data.id, 'WALLET')));
  assert.deepEqual(both.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await api('/payments/wallet', { token })).data.balance, 250000, 'chỉ trừ tiền 1 lần');
  ok('Bấm thanh toán 2 lần cùng lúc -> chỉ 1 giao dịch');

  // ---- 9. Tiền mặt khi nhận hàng (COD) ----
  const cod1 = await post('/orders', { ...addr, items: [{ foodId: 7, quantity: 2 }] }, token);
  assert.equal(cod1.status, 201);
  assert.equal((await post('/orders', { address: '144 Xuân Thủy', items: [{ foodId: 7, quantity: 1 }] }, token)).status, 400, 'thiếu số điện thoại');
  assert.equal((await post('/orders', { ...addr, phone: '123', items: [{ foodId: 7, quantity: 1 }] }, token)).status, 400, 'SĐT sai định dạng');
  assert.equal((await pay(cod1.data.id, 'COD')).status, 201);
  const cod = (await api(`/orders/${cod1.data.id}`, { token })).data;
  assert.deepEqual([cod.status, cod.paymentStatus, cod.paymentMethod], ['CONFIRMED', 'UNPAID', 'COD']);
  ok('Đặt món giao hàng, thanh toán tiền mặt khi nhận');

  // ---- 10. Admin xử lý đơn, theo dõi trạng thái ----
  const setStatus = (id, status, t = A) => api(`/orders/${id}/status`, { method: 'PATCH', token: t, body: { status } });
  assert.equal((await setStatus(cod1.data.id, 'DELIVERING')).status, 400, 'không nhảy cóc');
  assert.equal((await setStatus(cod1.data.id, 'PREPARING', token)).status, 403, 'khách không xử lý được đơn');
  assert.equal((await setStatus(cod1.data.id, 'PREPARING')).status, 200);
  assert.equal((await post(`/orders/${cod1.data.id}/cancel`, {}, token)).status, 409, 'khách không huỷ được khi đang chuẩn bị');
  assert.equal((await setStatus(cod1.data.id, 'COMPLETED')).status, 400, 'phải giao hàng trước khi hoàn thành');
  assert.equal((await setStatus(cod1.data.id, 'DELIVERING')).status, 200);
  const done = (await setStatus(cod1.data.id, 'COMPLETED')).data;
  assert.deepEqual([done.status, done.paymentStatus], ['COMPLETED', 'PAID'], 'thu tiền mặt khi hoàn thành');
  assert.deepEqual(done.events.map((e) => e.status), ['PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'COMPLETED']);
  for (const s of ['PREPARING', 'DELIVERING', 'COMPLETED']) assert.equal((await setStatus(o1.data.id, s)).status, 200);
  assert.equal((await setStatus(o1.data.id, 'CANCELLED')).status, 400, 'đơn hoàn thành không huỷ được');
  ok('Admin xử lý đơn theo đúng luồng, dòng thời gian trạng thái');

  // ---- 11. Lịch sử đặt món ----
  const history = (await api('/orders', { token })).data;
  assert.equal(history.length, 4);
  assert.deepEqual((await api('/orders?status=COMPLETED', { token })).data.map((o) => o.id).sort(), [o1.data.id, cod1.data.id].sort());
  ok('Lịch sử đặt món, lọc theo trạng thái');

  // ---- 12. Thông báo ----
  const n = (await api('/notifications', { token })).data;
  assert.ok(n.unread >= 5);
  assert.ok(n.items.some((i) => i.orderId === cod1.data.id && /Hoàn thành/.test(i.title)));
  assert.ok((await api('/notifications', { token: A })).data.items.some((i) => i.audience === 'ADMIN' && /Đơn mới/.test(i.title)));
  await post('/notifications/read-all', {}, token);
  assert.equal((await api('/notifications', { token })).data.unread, 0);
  ok('Thông báo cho khách và admin, đánh dấu đã đọc');

  // ---- 13. Đánh giá món ----
  const other = (await post('/users/register', { name: 'Người Khác', email: `x${email}`, password: '123456' })).data.token;
  assert.equal((await post('/foods/10/reviews', { rating: 5 }, token)).status, 403, 'đơn chưa hoàn thành -> chưa được đánh giá');
  assert.equal((await post('/foods/7/reviews', { rating: 9 }, token)).status, 400);
  assert.equal((await post('/foods/7/reviews', { rating: 4, comment: 'Ngon' }, token)).status, 201);
  const rated = (await post('/foods/7/reviews', { rating: 5, comment: 'Rất ngon' }, token)).data;
  assert.deepEqual([rated.rating, rated.reviewCount], [5, 1], 'đánh giá lại = cập nhật');
  assert.equal((await post('/foods/7/reviews', { rating: 1 }, other)).status, 403);
  assert.equal((await api('/foods/7/reviews')).data[0].comment, 'Rất ngon');
  ok('Đánh giá: chỉ sau khi nhận món, 1 người 1 đánh giá');

  // ---- 14. Mã giảm giá: quản trị + giới hạn lượt ----
  assert.equal((await post('/coupons', { code: 'TEST1', type: 'FIXED', value: 10000, usageLimit: 1 }, A)).status, 201);
  assert.equal((await post('/coupons', { code: 'TEST1', type: 'FIXED', value: 10000 }, A)).status, 409);
  assert.equal((await post('/coupons', { code: 'BAD', type: 'PERCENT', value: 150 }, A)).status, 400);
  const u1 = await post('/orders', { ...addr, couponCode: 'TEST1', items: [{ foodId: 12, quantity: 1 }] }, token);
  assert.equal(u1.data.total, 5000);
  assert.equal((await post('/orders', { ...addr, couponCode: 'TEST1', items: [{ foodId: 12, quantity: 1 }] }, token)).status, 400, 'hết lượt');
  await post(`/orders/${u1.data.id}/cancel`, {}, token);
  assert.equal((await post('/coupons/check', { code: 'TEST1', subtotal: 20000 })).status, 200, 'huỷ đơn trả lại lượt dùng');
  await api('/coupons/TEST1', { method: 'PATCH', token: A, body: { active: false } });
  assert.equal((await post('/coupons/check', { code: 'TEST1', subtotal: 20000 })).status, 400, 'tắt mã');
  ok('Mã giảm giá: tạo, trùng mã, giới hạn lượt, trả lượt khi huỷ, tắt mã');

  // ---- 15. Dashboard + xuất báo cáo ----
  const st = (await api('/orders/admin/stats?days=7', { token: A })).data;
  assert.equal(st.byDay.length, 7);
  // Đơn hợp lệ: o1 (144k) + o2 (50k) + cod1 (50k)
  assert.equal(st.kpis.revenue, 244000);
  assert.equal(st.kpis.orders, 3);
  assert.equal(st.byDay.at(-1).revenue, 244000);
  assert.equal(st.byStatus.CANCELLED, 2);
  assert.equal(st.topFoods.find((f) => f.name === 'Bánh mì thịt').quantity, 2);
  assert.ok(!st.topFoods.some((f) => f.name === 'Nước mía'), 'món trong đơn đã huỷ không tính');
  const rep = await api('/orders/admin/report', { token: A });
  assert.equal(rep.status, 200);
  assert.match(rep.headers.get('content-type'), /text\/csv/);
  assert.match(rep.headers.get('content-disposition'), /bao-cao-doanh-thu_/);
  const bytes = new Uint8Array(await (await fetch(`${BASE}/orders/admin/report`, { headers: { Authorization: `Bearer ${A}` } })).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'có BOM để Excel đọc đúng tiếng Việt');
  assert.match(rep.data, /"Doanh thu",244000/);
  assert.equal((await api('/orders/admin/report', { token })).status, 403);
  ok('Dashboard doanh thu, xuất báo cáo CSV');

  // ---- 16. Bảo mật ----
  assert.equal((await api(`/orders/${o1.data.id}`, { token: other })).status, 404, 'không xem đơn người khác');
  assert.equal((await api(`/orders/${o1.data.id}`, { token: A })).status, 200, 'admin xem được');
  assert.equal((await pay(o2.data.id, 'WALLET', {}, other)).status, 404);
  const { secret } = require('./config.json');
  assert.equal((await api(`/orders/${big.data.id}/payment`, { method: 'PATCH', headers: { 'X-Internal-Key': secret }, body: { method: 'CARD' } })).status, 403, 'gateway chặn header nội bộ');
  assert.equal((await api('/orders', { token: token + 'x' })).status, 401, 'token giả');
  assert.equal((await api('/foods?all=1', { token })).status, 403);
  // Ẩn món -> không còn trên thực đơn, admin vẫn thấy
  await api(`/foods/${food.id}`, { method: 'DELETE', token: A });
  assert.ok(!(await api('/foods')).data.some((f) => f.id === food.id));
  assert.ok((await api('/foods?all=1', { token: A })).data.some((f) => f.id === food.id));
  ok('Bảo mật: quyền xem đơn, header nội bộ, token giả, món bị ẩn');

  // ---- 17. Phân quyền nhân viên (STAFF) ----
  const staff = (await post('/users/login', { email: 'nhanvien@anngon.vn', password: 'staff123' })).data;
  assert.equal(staff.user.role, 'STAFF');
  const S = staff.token;
  // Được: xem & xử lý đơn, cập nhật tồn kho, xem cả món ẩn, nhận thông báo cửa hàng
  assert.equal((await api('/orders/admin/all', { token: S })).status, 200);
  assert.equal((await api(`/orders/${o1.data.id}`, { token: S })).status, 200);
  const o5 = await post('/orders', { ...addr, items: [{ foodId: 11, quantity: 1 }] }, token);
  await pay(o5.data.id, 'COD');
  assert.equal((await setStatus(o5.data.id, 'PREPARING', S)).status, 200, 'nhân viên xử lý đơn');
  assert.equal((await api('/foods/11/stock', { method: 'PATCH', token: S, body: { stock: 77 } })).data.stock, 77, 'nhân viên cập nhật tồn kho');
  assert.equal((await api('/foods/11/stock', { method: 'PATCH', token: S, body: { stock: -1 } })).status, 400);
  assert.equal((await api('/foods/11/stock', { method: 'PATCH', token, body: { stock: 1 } })).status, 403, 'khách không sửa tồn kho');
  assert.equal((await api('/foods?all=1', { token: S })).status, 200);
  assert.ok((await api('/notifications', { token: S })).data.items.some((i) => i.audience === 'ADMIN'), 'nhân viên nhận thông báo đơn mới');
  // Không được: doanh thu, báo cáo, mã giảm giá, sửa món / giá / ảnh, quản lý tài khoản
  for (const [p, m, b] of [
    ['/orders/admin/stats', 'GET'], ['/orders/admin/report', 'GET'], ['/coupons', 'GET'], ['/coupons', 'POST', { code: 'NV1', type: 'FIXED', value: 1000 }],
    ['/foods/11', 'PUT', { name: 'Đổi giá', categoryId: 4, price: 1000, stock: 1 }], ['/foods', 'POST', { name: 'Món mới', categoryId: 1, price: 10000, stock: 1 }],
    ['/foods/11', 'DELETE'], ['/foods/11/image', 'POST', { data: 'x' }], ['/users', 'GET'], [`/users/${reg.data.user.id}/role`, 'PATCH', { role: 'ADMIN' }],
  ]) assert.equal((await api(p, { method: m, token: S, body: b })).status, 403, `nhân viên bị chặn ${m} ${p}`);
  // Admin tạo tài khoản nhân viên mới, đổi vai trò
  const nv2 = await api('/users', { method: 'POST', token: A, body: { name: 'Nhân viên 2', email: `nv2${email}`, password: '123456', role: 'STAFF' } });
  assert.equal(nv2.status, 201);
  assert.equal((await post('/users/login', { email: `nv2${email}`, password: '123456' })).data.user.role, 'STAFF');
  assert.equal((await api('/users', { method: 'POST', token: A, body: { name: 'X', email: `x2${email}`, password: '123456', role: 'BOSS' } })).status, 400);
  assert.equal((await api(`/users/${nv2.data.id}/role`, { method: 'PATCH', token: A, body: { role: 'GUEST' } })).data.role, 'GUEST');
  ok('Phân quyền 3 vai trò: nhân viên xử lý đơn & tồn kho, bị chặn doanh thu / sửa món / tài khoản');

  // Khách tự sửa hồ sơ, đổi mật khẩu, nạp ví
  const me = await api('/users/me', { method: 'PATCH', token, body: { name: 'Tên Mới', phone: '0911222333' } });
  assert.equal(me.data.user.name, 'Tên Mới');
  assert.equal(me.data.user.role, 'GUEST', 'không tự đổi vai trò');
  assert.equal((await api('/users/me', { method: 'PATCH', token, body: { name: 'A', phone: '1' } })).status, 400);
  assert.equal((await api('/users/me/password', { method: 'POST', token, body: { oldPassword: 'sai', newPassword: '654321' } })).status, 400);
  assert.equal((await api('/users/me/password', { method: 'POST', token, body: { oldPassword: '123456', newPassword: '654321' } })).status, 200);
  assert.equal((await post('/users/login', { email, password: '654321' })).status, 200);
  const w0 = (await api('/payments/wallet', { token })).data.balance;
  assert.equal((await api('/payments/wallet/topup', { method: 'POST', token, body: { amount: 150000 } })).data.balance, w0 + 150000);
  assert.equal((await api('/payments/wallet/topup', { method: 'POST', token, body: { amount: 5 } })).status, 400);
  ok('Khách sửa hồ sơ, đổi mật khẩu, nạp ví');

  // ---- 19. Điểm thưởng & đổi voucher ----
  const nu = (await post('/users/register', { name: 'Điểm Thưởng', email: `d${email}`, password: '123456' })).data.token;
  const nu2 = (await post('/users/register', { name: 'Người Khác', email: `e${email}`, password: '123456' })).data.token;
  assert.equal((await api('/points')).status, 401);
  assert.equal((await api('/points', { token: nu })).data.balance, 0);
  const po = await post('/orders', { ...addr, items: [{ foodId: 4, quantity: 3 }] }, nu); // 180k => 180 điểm
  assert.equal(po.status, 201, JSON.stringify(po.data));
  assert.equal((await pay(po.data.id, 'COD', {}, nu)).status, 201);
  assert.equal((await api('/points', { token: nu })).data.balance, 0, 'chưa hoàn thành thì chưa có điểm');
  for (const st of ['PREPARING', 'DELIVERING', 'COMPLETED']) assert.equal((await setStatus(po.data.id, st)).status, 200, st);
  const pts = (await api('/points', { token: nu })).data;
  assert.deepEqual([pts.balance, pts.tier], [po.data.total / 1000, 'Đồng']);
  assert.equal((await post('/points/redeem', { rewardId: 'R30' }, nu)).status, 400, 'không đủ điểm');
  assert.equal((await post('/points/redeem', { rewardId: 'XXX' }, nu)).status, 400);
  const rd = await post('/points/redeem', { rewardId: 'R10' }, nu);
  assert.equal(rd.status, 200, JSON.stringify(rd.data));
  assert.equal(rd.data.balance, pts.balance - 100);
  assert.equal((await post('/coupons/check', { code: rd.data.code, subtotal: 100000 }, nu)).data.discount, 10000);
  assert.equal((await post('/coupons/check', { code: rd.data.code, subtotal: 100000 }, nu2)).status, 400, 'voucher của người khác');
  assert.equal((await post('/coupons/check', { code: rd.data.code, subtotal: 100000 })).status, 400, 'chưa đăng nhập');
  assert.ok(!(await api('/coupons/public')).data.some((c) => c.code === rd.data.code), 'voucher riêng không hiện ở banner');
  const uo = await post('/orders', { ...addr, couponCode: rd.data.code, items: [{ foodId: 4, quantity: 2 }] }, nu);
  assert.equal(uo.data.discount, 10000);
  assert.equal((await post('/orders', { ...addr, couponCode: rd.data.code, items: [{ foodId: 4, quantity: 2 }] }, nu)).status, 400, 'dùng 1 lần');
  ok('Điểm thưởng: tích khi hoàn thành, đổi voucher riêng, chỉ chủ dùng, 1 lần');

  // ---- 20. Đăng nhập mạng xã hội ----
  assert.deepEqual((await api('/users/social-config')).data, { google: null, facebook: null }, 'chưa cấu hình thì không bật');
  assert.equal((await post('/users/social', { provider: 'google', token: 'x' })).status, 501);
  assert.equal((await post('/users/social', { provider: 'zalo', token: 'x' })).status, 400);
  assert.equal((await post('/users/social', { provider: 'google' })).status, 400);
  ok('Đăng nhập Google / Facebook: tắt khi chưa cấu hình, chặn token thiếu / sai nhà cung cấp');

  console.log(`\n✅ Tất cả ${step} nhóm kiểm thử đều đạt`);
}

const cleanup = () => { sys.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); };
main().then(() => { cleanup(); process.exit(0); })
  .catch((e) => { console.error('\n❌', e); cleanup(); process.exit(1); });
