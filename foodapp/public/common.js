'use strict';
// Đường dẫn: foodapp/public/common.js
// Dùng chung cho trang khách (app.js) và trang quản trị (admin.js).
// Frontend chỉ nói chuyện với API Gateway (/api/*), không biết đến từng service.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = (n) => `${Number(n || 0).toLocaleString('vi-VN')} ₫`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => new Date(`${String(s).replace(' ', 'T')}Z`).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const STATUS = {
  PENDING: 'Chờ thanh toán', CONFIRMED: 'Đã xác nhận', PREPARING: 'Đang chuẩn bị',
  DELIVERING: 'Đang giao', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã huỷ',
};
const METHOD = { CARD: 'Thẻ ngân hàng', WALLET: 'Ví điện tử', COD: 'Tiền mặt' };
const PAY_STATUS = { UNPAID: 'Chưa thanh toán', PAID: 'Đã thanh toán', REFUNDED: 'Đã hoàn tiền' };
const badge = (status) => `<span class="badge ${status}">${STATUS[status]}</span>`;
const stars = (r) => `<span class="stars" aria-label="${r} trên 5 sao">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}</span>`;
// Ảnh món: link http(s) hoặc ảnh trong máy chủ (/images/...) -> <img>, còn lại coi là emoji
const isImageUrl = (img) => /^(https?:\/\/|\/(?!\/))/i.test(img || '');
const foodImg = (img) => (isImageUrl(img)
  ? `<img src="${esc(img)}" alt="" loading="lazy">`
  : `<span aria-hidden="true">${esc(img || '🍽️')}</span>`);

// ---------- Phiên đăng nhập ----------
// "Ghi nhớ 7 ngày" bật -> lưu localStorage (hết hạn sau 7 ngày); tắt -> sessionStorage (mất khi đóng tab)
const WEEK_MS = 7 * 864e5;
const tab = { // sessionStorage, cùng giao diện với store
  get(k, d) { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let saved = store.get('auth', null);
if (saved && Date.now() - saved.at > WEEK_MS) { saved = null; store.set('auth', null); }
const keep = saved || tab.get('auth', null) || (store.get('token', null) && { token: store.get('token'), user: store.get('user', null) });
const session = { token: keep?.token ?? null, user: keep?.user ?? null, remember: !tab.get('auth', null) };
function setSession(s, remember = session.remember) {
  session.token = s?.token ?? null;
  session.user = s?.user ?? null;
  session.remember = remember;
  const v = s && { token: s.token, user: s.user, at: Date.now() };
  store.set('auth', remember ? v : null);
  tab.set('auth', remember ? null : v);
  store.set('token', null); store.set('user', null); // khoá cũ
  document.dispatchEvent(new Event('session'));
}
// ---------- Phân quyền: ADMIN (quản trị viên) · STAFF (nhân viên) · GUEST (khách hàng) ----------
// Giao diện chỉ ẩn/hiện cho gọn; quyền thật sự do từng service kiểm tra ở server.
const ROLE_NAME = { ADMIN: 'Quản trị viên', STAFF: 'Nhân viên', GUEST: 'Khách hàng' };
const isAdmin = () => session.user?.role === 'ADMIN';
const isStaff = () => ['ADMIN', 'STAFF'].includes(session.user?.role);
const roleBadge = (role) => `<span class="role-badge ${role}">${ROLE_NAME[role] || role}</span>`;
// Trang đích sau khi đăng nhập theo vai trò
const homeOf = (role) => ({ ADMIN: '/admin.html#dashboard', STAFF: '/admin.html#orders' }[role] || '/');

// Khối "Tài khoản mẫu" trên form đăng nhập: bấm để điền nhanh. Xoá DEMO_ACCOUNTS trước khi đưa web lên mạng thật.
const DEMO_ACCOUNTS = [
  { role: 'ADMIN', email: 'admin@anngon.vn', password: 'admin123', icon: '👑', can: 'Toàn quyền: doanh thu, món ăn, mã giảm giá, tài khoản' },
  { role: 'STAFF', email: 'nhanvien@anngon.vn', password: 'staff123', icon: '🧑‍🍳', can: 'Xử lý đơn hàng, cập nhật số lượng món' },
  { role: 'GUEST', email: 'demo@anngon.vn', password: 'demo123', icon: '🙂', can: 'Xem thực đơn, đặt món, thanh toán, đánh giá' },
];
function renderDemoAccounts(box) {
  const label = { ADMIN: 'Admin', STAFF: 'NV', GUEST: 'KH' };
  box.innerHTML = `<div class="demo-chips">${DEMO_ACCOUNTS.map((a) => `
    <button type="button" data-demo-email="${a.email}" data-demo-password="${a.password}" title="${a.can}">${a.icon} ${label[a.role]}</button>`).join('')}</div>
    <p class="small">Bấm để điền nhanh tài khoản mẫu.</p>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-demo-email]');
  if (b) {
    const form = b.closest('form');
    form.email.value = b.dataset.demoEmail;
    form.password.value = b.dataset.demoPassword;
    form.querySelector('[type=submit]').focus();
  }
  const eye = e.target.closest('[data-eye]');
  if (eye) { const i = eye.closest('.field').querySelector('input'); i.type = i.type === 'password' ? 'text' : 'password'; eye.textContent = i.type === 'password' ? '👁' : '🙈'; }
  if (e.target.closest('[data-forgot]')) toast('Vui lòng liên hệ hotro@anngon.vn để được đặt lại mật khẩu');
});

// Nền động cho màn hình đăng nhập: các món ăn bay lên (CSS lo phần màu loang)
document.querySelectorAll('.auth-bg').forEach((bg) => {
  bg.innerHTML = '<i class="blob b1"></i><i class="blob b2"></i><i class="blob b3"></i>';
});

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session.token && { Authorization: `Bearer ${session.token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token) setSession(null);
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra, vui lòng thử lại');
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Chống bấm 2 lần: khoá nút trong lúc chờ
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Đang xử lý...';
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}

// ---------- Chuông thông báo ----------
// Hỏi Notification Service mỗi 10 giây; có thông báo mới -> toast + gọi onNew() để trang tự làm mới.
// ponytail: polling 10s; chuyển sang Server-Sent Events nếu cần tức thời / nhiều người dùng
function initBell(onNew) {
  const box = $('#bell');
  let lastId = null, timer = null;

  async function poll() {
    if (!session.token) { box.hidden = true; return; }
    box.hidden = false;
    try {
      const { unread, items } = await api('/notifications');
      $('.bell-count', box).textContent = unread;
      $('.bell-count', box).hidden = !unread;
      $('.bell-panel', box).innerHTML = `
        <div class="row bell-head"><strong>Thông báo</strong>
          ${unread ? '<button class="link small" data-bell="read">Đánh dấu đã đọc</button>' : ''}</div>
        ${items.map((n) => `<div class="notice ${n.isRead ? '' : 'unread'}">
          <b>${esc(n.title)}</b>${n.body ? `<p>${esc(n.body)}</p>` : ''}<small>${fmtTime(n.createdAt)}</small></div>`).join('')
        || '<p class="empty small">Chưa có thông báo</p>'}`;
      const newest = items[0]?.id ?? 0;
      if (lastId !== null && newest > lastId) {
        toast(`🔔 ${items[0].title}`);
        onNew?.();
      }
      lastId = newest;
    } catch {}
  }

  box.addEventListener('click', async (e) => {
    if (e.target.closest('[data-bell="toggle"]')) {
      const panel = $('.bell-panel', box);
      panel.hidden = !panel.hidden;
    } else if (e.target.closest('[data-bell="read"]')) {
      await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
      poll();
    }
  });
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) $('.bell-panel', box).hidden = true; });
  document.addEventListener('session', () => { lastId = null; poll(); });

  poll();
  clearInterval(timer);
  timer = setInterval(poll, 10_000);
  return poll;
}

// ---------- Nút đổi nền sáng / tối (mọi trang) ----------
(() => {
  const root = document.documentElement;
  const btn = Object.assign(document.createElement('button'), { className: 'theme-switch', id: 'themeBtn', type: 'button' });
  const paint = () => {
    const dark = root.dataset.theme === 'dark';
    btn.innerHTML = `<span class="knob">${dark ? '🌙' : '☀️'}</span><span class="tlabel">${dark ? 'Tối' : 'Sáng'}</span>`;
    btn.setAttribute('aria-pressed', dark);
    btn.title = btn.ariaLabel = dark ? 'Chuyển sang nền sáng' : 'Chuyển sang nền tối';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#17120e' : '#e2552d');
  };
  btn.onclick = () => { root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; store.set('theme', root.dataset.theme); paint(); };
  document.querySelector('.tools')?.prepend(btn);
  paint();
})();
