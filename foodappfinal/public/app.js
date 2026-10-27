'use strict';
// Đường dẫn: foodapp/public/app.js
// Trang khách hàng: trang chủ & thực đơn, tìm kiếm/lọc, giỏ hàng + mã giảm giá, đặt món giao tận nơi,
// thanh toán (thẻ, ví mô phỏng, tiền mặt khi nhận hàng), theo dõi trạng thái & lịch sử đơn, đánh giá món.

const STEPS = ['PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'COMPLETED'];
const STEP_LABEL = { PENDING: 'Đặt đơn', CONFIRMED: 'Xác nhận', PREPARING: 'Chuẩn bị', DELIVERING: 'Đang giao', COMPLETED: 'Hoàn thành' };

const state = {
  all: [],          // toàn bộ thực đơn (giỏ hàng, bán chạy)
  foods: [],        // kết quả tìm kiếm / lọc
  categories: [],
  filters: { q: '', category: 0, price: '', sort: '', inStock: false },
  cart: store.get('cart', {}),   // { foodId: quantity }
  coupon: null,                  // { code, discount, description }
  orders: [], orderFilter: '',
  payOrder: null,                // đơn đang thanh toán (null = đơn mới từ giỏ)
  resumeCheckout: false, authMode: 'login', wallet: null,
};

// ---------- Người dùng ----------
async function renderUser() {
  $('#adminLink').hidden = !isStaff();
  $('#adminLink').textContent = isAdmin() ? 'Quản trị' : 'Quầy nhân viên';
  if (!session.user) {
    $('#userArea').innerHTML = '<button class="link" data-action="login">Đăng nhập</button>';
    return;
  }
  $('#userArea').innerHTML = `<span class="hi">Xin chào, <button class="plain" data-action="view" data-view="account"><b>${esc(session.user.name)}</b></button> ${roleBadge(session.user.role)}</span>
    <span class="wallet" title="Số dư ví ĂnNgon Pay (mô phỏng)">👛 <span id="walletTop">…</span></span>
    <button class="link" data-action="logout">Đăng xuất</button>`;
  refreshWallet();
}
async function refreshWallet() {
  if (!session.token) return;
  try {
    state.wallet = (await api('/payments/wallet')).balance;
    $('#walletTop') && ($('#walletTop').textContent = money(state.wallet));
    $('#walletBig').textContent = money(state.wallet);
    $('#walletBalance').textContent = `(số dư ${money(state.wallet)})`;
  } catch {}
}
function openAuth(mode = 'login') {
  state.authMode = mode;
  const login = mode === 'login';
  $$('.reg-only').forEach((el) => { el.hidden = login; });
  $('#demoBox').closest('details').hidden = !login;
  $('#authTitle').textContent = login ? 'Chào mừng trở lại' : 'Tạo tài khoản mới';
  $('#authSub').textContent = login ? 'Đăng nhập để tiếp tục đặt món tại ĂnNgon' : 'Đăng ký nhanh để đặt món và nhận ưu đãi';
  $('#authSubmit').textContent = login ? 'Đăng nhập' : 'Tạo tài khoản';
  $('#authSwitchText').textContent = login ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
  $('#authSwitchBtn').textContent = login ? 'Đăng ký ngay' : 'Đăng nhập';
  $('#authForm').password.autocomplete = login ? 'current-password' : 'new-password';
  $('#authError').textContent = '';
  if (!$('#authDialog').open) $('#authDialog').showModal();
}

// ---------- Trang chủ & thực đơn ----------
const stockText = (f) => (!f.available ? 'Hết hàng' : f.stock <= 5 ? `Chỉ còn ${f.stock} phần` : `Còn ${f.stock} phần`);
const foodCard = (f, tag = '') => `
  <article class="food ${f.available ? '' : 'sold-out'} ${f.category === 'Combo' ? 'combo' : ''}">${tag ? `<span class="ribbon">${tag}</span>` : ''}
    <button class="food-img" data-action="detail" data-id="${f.id}" aria-label="Xem chi tiết ${esc(f.name)}">${foodImg(f.image)}</button>
    <div class="food-body">
      <h3><button class="plain" data-action="detail" data-id="${f.id}">${esc(f.name)}</button></h3>
      <div class="meta">${f.reviewCount ? `${stars(f.rating)} <small>${f.rating} (${f.reviewCount})</small>` : '<small class="muted">Chưa có đánh giá</small>'}</div>
      ${f.category === 'Combo' ? comboInfo(f) : `<p>${esc(f.description)}</p>`}
      <div class="row"><span class="price">${money(f.price)}</span><small class="stock ${f.available && f.stock <= 5 ? 'low' : ''}">${stockText(f)}</small></div>
      <button class="primary block" data-action="add" data-id="${f.id}" ${f.available ? '' : 'disabled'}>${f.available ? '+ Thêm vào giỏ' : 'Hết hàng'}</button>
    </div>
  </article>`;

// Combo: mô tả dạng "👥 N người · món + món · Tiết kiệm X" -> nhãn số người, danh sách món, mức tiết kiệm
function comboInfo(f) {
  const [who, items, save] = String(f.description).split(' · ');
  return `<p class="combo-who">${esc(who)}</p><p>${esc(items)}</p>${save ? `<p class="combo-save">💰 ${esc(save)}</p>` : ''}`;
}
// Xáo trộn cố định theo ngày: cùng ngày ai vào cũng thấy cùng danh sách, sang ngày khác thì đổi
function dailyPick(list, n) {
  let h = 0;
  for (const c of new Date().toLocaleDateString('sv')) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  const rnd = () => ((h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) | 0) >>> 0) / 4294967296;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [a[i], a[k]] = [a[k], a[i]]; }
  return a.slice(0, n);
}
function renderCategories() {
  const all = [{ id: 0, name: 'Tất cả', icon: '🍽️' }, ...state.categories];
  $('#categories').innerHTML = all.map((c) =>
    `<button data-action="category" data-id="${c.id}" class="${c.id === state.filters.category ? 'active' : ''}">${esc(c.icon)} ${esc(c.name)}</button>`).join('');
}
function renderHighlights() {
  const f = state.filters;
  const filtering = f.q || f.category || f.price || f.sort || f.inStock;
  $('#highlights').hidden = !!filtering;
  const single = state.all.filter((x) => x.available && x.category !== 'Combo');
  $('#daily').innerHTML = dailyPick(single, 4).map((x) => foodCard(x, '🔥 Hot hôm nay')).join('');
  $('#combos').innerHTML = state.all.filter((x) => x.available && x.category === 'Combo').map((x) => foodCard(x, '👥 Combo')).join('')
    || '<p class="empty">Hôm nay tạm hết combo.</p>';
  $('#bestsellers').innerHTML = [...single].sort((a, b) => b.sold - a.sold).slice(0, 4).map((x) => foodCard(x)).join('');
}

let menuReq = 0;
async function loadMenu() {
  const f = state.filters;
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q);
  if (f.category) qs.set('category', f.category);
  if (f.sort) qs.set('sort', f.sort);
  if (f.inStock) qs.set('inStock', '1');
  if (f.price) {
    const [min, max] = f.price.split('-');
    if (min) qs.set('minPrice', min);
    if (max) qs.set('maxPrice', max);
  }
  const id = ++menuReq;
  try {
    const foods = await api(`/foods?${qs}`);
    if (id !== menuReq) return; // bỏ kết quả cũ khi người dùng gõ nhanh
    state.foods = foods;
    $('#menu').innerHTML = foods.map((x) => foodCard(x)).join('') || '<p class="empty">Không tìm thấy món phù hợp. Thử từ khoá khác nhé!</p>';
    $('#resultInfo').textContent = f.q ? `${foods.length} kết quả cho “${f.q}”` : '';
  } catch (e) {
    $('#menu').innerHTML = `<p class="empty">Không tải được thực đơn: ${esc(e.message)}</p>`;
  }
  renderHighlights();
}
async function loadAll() {
  state.all = await api('/foods');
  renderCart();
  renderHighlights();
}

async function loadPromos() {
  const msgs = ['🚚 Giao hàng trong 30 phút', '🎁 Ví ĂnNgon Pay tặng 200.000 ₫ cho lần đầu', '⭐ Đánh giá món ăn sau khi nhận hàng'];
  let list = [];
  try { list = await api('/coupons/public'); } catch {}
  const items = list.flatMap((c, i) => [
    `<button class="ticker-item voucher" data-action="use-coupon" data-code="${esc(c.code)}">🎟️ <b>${esc(c.code)}</b> ${esc(c.description)} <u>Dùng ngay</u></button>`,
    `<span class="ticker-item">${msgs[i % msgs.length]}</span>`,
  ]);
  if (!items.length) items.push(...msgs.map((m) => `<span class="ticker-item">${m}</span>`));
  const once = items.join('');
  // nhân đôi để vòng lặp liền mạch; tốc độ theo độ dài
  $('#tickerTrack').innerHTML = once + once;
  $('#ticker').style.setProperty('--dur', `${Math.max(20, items.length * 7)}s`);
}

// ---------- Giỏ hàng & mã giảm giá ----------
const foodById = (id) => state.all.find((f) => f.id === Number(id));
const cartLines = () => Object.entries(state.cart).map(([id, q]) => ({ food: foodById(id), q })).filter((l) => l.food);
const subtotal = () => cartLines().reduce((s, l) => s + l.food.price * l.q, 0);
const discount = () => Math.min(state.coupon?.discount || 0, subtotal());

function setQty(id, q) {
  const f = foodById(id);
  if (!f) return;
  if (q > f.stock) { toast(`Món "${f.name}" chỉ còn ${f.stock} phần`); q = f.stock; }
  if (q <= 0) delete state.cart[id]; else state.cart[id] = Math.min(q, 50);
  store.set('cart', state.cart);
  renderCart();
  if (state.coupon) applyCoupon(state.coupon.code, true);
}

function renderCart() {
  const lines = cartLines();
  const cnt = lines.reduce((s, l) => s + l.q, 0), cc = $('#cartCount');
  if (cc.textContent !== String(cnt)) { cc.classList.remove('bump'); void cc.offsetWidth; cc.classList.add('bump'); }
  cc.textContent = cnt;
  $('#cartItems').innerHTML = lines.map(({ food, q }) => `
    <div class="cart-line">
      <span class="thumb">${foodImg(food.image)}</span>
      <div class="name">${esc(food.name)}<small>${money(food.price)}</small></div>
      <div class="qty">
        <button data-action="qty" data-id="${food.id}" data-d="-1" aria-label="Giảm">−</button>
        <span>${q}</span>
        <button data-action="qty" data-id="${food.id}" data-d="1" aria-label="Tăng">+</button>
      </div>
    </div>`).join('') || '<p class="empty">Giỏ hàng đang trống<br><small>Chọn vài món ngon nhé!</small></p>';
  $('#cartSubtotal').textContent = money(subtotal());
  $('#cartDiscountRow').hidden = !state.coupon;
  $('#cartCoupon').textContent = state.coupon?.code || '';
  $('#cartDiscount').textContent = `−${money(discount())}`;
  $('#cartTotal').textContent = money(subtotal() - discount());
  $('#checkoutBtn').disabled = !lines.length;
}

async function applyCoupon(code, silent = false) {
  const msg = $('#couponMsg');
  try {
    state.coupon = await api('/coupons/check', { method: 'POST', body: { code, subtotal: subtotal() } });
    msg.className = 'small ok';
    msg.textContent = `✓ ${state.coupon.description || 'Đã áp dụng mã'}`;
  } catch (e) {
    if (state.coupon || !silent) { msg.className = 'small error'; msg.textContent = e.message; }
    state.coupon = null;
  }
  renderCart();
  loadVouchers();
}

// Kho voucher: mã chung + voucher đổi từ điểm thưởng; bấm "Dùng" là áp dụng luôn
async function loadVouchers() {
  const row = (c, mine) => `<div class="vrow${state.coupon?.code === c.code ? ' on' : ''}"><span>${mine ? '⭐' : '🎟️'} <b>${esc(c.code)}</b> ${esc(c.description)}${c.expiresAt ? ` <small>HSD ${esc(c.expiresAt)}</small>` : ''}</span>
    <button class="link small" data-action="use-coupon" data-code="${esc(c.code)}">${state.coupon?.code === c.code ? 'Đang dùng' : 'Dùng'}</button></div>`;
  const [pub, pts] = await Promise.all([api('/coupons/public').catch(() => []), session.token ? api('/points').catch(() => null) : null]);
  const mine = pts?.vouchers || [];
  $('#voucherList').innerHTML = (mine.length ? `<b>Đổi từ điểm</b>${mine.map((c) => row(c, true)).join('')}` : '')
    + (pub.length ? `<b>Mã chung</b>${pub.map((c) => row(c)).join('')}` : '') || 'Chưa có voucher nào.';
}
function toggleCart(open) {
  $('#cart').classList.toggle('open', open);
  $('#cart').setAttribute('aria-hidden', String(!open));
  $('#backdrop').hidden = !open;
  if (open) loadVouchers();
}

// ---------- Đặt món & thanh toán ----------
function openPay(order = null) {
  toggleCart(false);
  if (!session.token) { state.resumeCheckout = true; return openAuth('login'); }
  state.payOrder = order;
  const f = $('#payForm');
  $('#payTitle').textContent = order ? `Thanh toán đơn #${order.id}` : 'Xác nhận đơn hàng';
  $('.new-only').hidden = !!order;
  f.address.required = f.phone.required = !order;
  if (!f.phone.value) f.phone.value = session.user?.phone || '';
  const sub = order ? order.subtotal : subtotal();
  const disc = order ? order.discount : discount();
  $('#paySubtotal').textContent = money(sub);
  $('#payDiscountRow').hidden = !disc;
  $('#payDiscount').textContent = `−${money(disc)}`;
  $('#payTotal').textContent = money(sub - disc);
  $('#payError').textContent = '';
  updateMethod();
  refreshWallet();
  $('#payDialog').showModal();
}
function updateMethod() {
  const m = $('#payForm').method.value;
  $('#cardField').hidden = m !== 'CARD';
  $('#walletField').hidden = m !== 'WALLET';
  $('#payForm').cardNumber.required = m === 'CARD';
  $('#paySubmit').textContent = m === 'COD' ? 'Xác nhận đặt món' : 'Thanh toán';
}

async function submitPay(form) {
  $('#payError').textContent = '';
  await busy($('#paySubmit'), async () => {
    try {
      let order = state.payOrder;
      if (!order) {
        order = await api('/orders', {
          method: 'POST',
          body: {
            address: form.address.value,
            phone: form.phone.value,
            note: form.note.value,
            couponCode: state.coupon?.code,
            items: cartLines().map((l) => ({ foodId: l.food.id, quantity: l.q })),
          },
        });
        // Đơn đã tạo: nếu thanh toán lỗi, lần thử sau thanh toán tiếp đơn này (không tạo trùng)
        state.payOrder = order;
        state.cart = {}; state.coupon = null; store.set('cart', {});
        $('#couponMsg').textContent = '';
        $('.new-only').hidden = true;
        form.address.required = form.phone.required = false;
        $('#payTitle').textContent = `Thanh toán đơn #${order.id}`;
        loadAll();
      }
      const method = form.method.value;
      await api('/payments', { method: 'POST', body: { orderId: order.id, method, cardNumber: form.cardNumber.value } });
      $('#payDialog').close();
      form.reset();
      toast(method === 'COD' ? '🎉 Đặt món thành công!' : '🎉 Thanh toán thành công!');
      refreshWallet();
      showView('orders');
    } catch (e) {
      $('#payError').textContent = e.message;
      refreshWallet();
    }
  });
  $('#paySubmit').textContent = form.method.value === 'COD' ? 'Xác nhận đặt món' : 'Thanh toán';
}

// ---------- Đơn hàng: theo dõi trạng thái & lịch sử ----------
function timeline(o) {
  if (o.status === 'CANCELLED') {
    const note = o.events.at(-1)?.note;
    return `<p class="cancel-note">✕ Đơn đã huỷ${note ? ` — ${esc(note)}` : ''}${o.paymentStatus === 'REFUNDED' ? ' · Đã hoàn tiền' : ''}</p>`;
  }
  const cur = STEPS.indexOf(o.status);
  const at = Object.fromEntries(o.events.map((e) => [e.status, e.createdAt]));
  return `<ol class="timeline" aria-label="Tiến trình đơn hàng">${STEPS.map((s, i) => `
    <li class="${i < cur || o.status === 'COMPLETED' ? 'done' : i === cur ? 'current' : ''}">
      <span class="dot" aria-hidden="true"></span><span>${STEP_LABEL[s]}</span>
      ${at[s] ? `<small>${fmtTime(at[s]).slice(0, 5)}</small>` : ''}
    </li>`).join('')}</ol>`;
}

function orderCard(o) {
  const done = o.status === 'COMPLETED';
  return `<article class="order">
    <div class="row"><strong>Đơn #${o.id}</strong>${badge(o.status)}</div>
    <small class="muted">${fmtTime(o.createdAt)} · 🛵 ${esc(o.address)}</small>
    ${timeline(o)}
    <ul class="items">${o.items.map((i) => `<li>
      <span>${i.quantity} × ${esc(i.name)}</span>
      <span>${done ? `<button class="link small" data-action="review" data-id="${i.foodId}">★ Đánh giá</button>` : ''} ${money(i.price * i.quantity)}</span>
    </li>`).join('')}</ul>
    ${o.note ? `<small class="muted">Ghi chú: ${esc(o.note)}</small>` : ''}
    ${o.discount ? `<div class="row small discount"><span>Giảm giá (${esc(o.couponCode)})</span><span>−${money(o.discount)}</span></div>` : ''}
    <div class="row"><span class="small muted">${o.paymentMethod ? `${METHOD[o.paymentMethod]} · ` : ''}${PAY_STATUS[o.paymentStatus]}</span><strong class="price">${money(o.total)}</strong></div>
    <div class="actions start">
      ${o.status === 'PENDING' ? `<button class="primary" data-action="repay" data-id="${o.id}">Thanh toán</button>` : ''}
      ${['PENDING', 'CONFIRMED'].includes(o.status) ? `<button class="ghost" data-action="cancel" data-id="${o.id}">Huỷ đơn</button>` : ''}
      ${o.status !== 'PENDING' ? `<button class="ghost" data-action="reorder" data-id="${o.id}">↻ Đặt lại</button>` : ''}
    </div>
  </article>`;
}

async function renderOrders() {
  const box = $('#orders');
  $('#orderFilter').innerHTML = [['', 'Tất cả'], ...Object.entries(STATUS)].map(([k, v]) =>
    `<button data-action="order-filter" data-status="${k}" class="${state.orderFilter === k ? 'active' : ''}">${v}</button>`).join('');
  if (!session.token) {
    box.innerHTML = '<p class="empty">Vui lòng <button class="link" data-action="login">đăng nhập</button> để xem đơn hàng.</p>';
    return;
  }
  if (!state.orders.length) box.innerHTML = '<p class="empty">Đang tải...</p>';
  try {
    state.orders = await api(`/orders${state.orderFilter ? `?status=${state.orderFilter}` : ''}`);
    box.innerHTML = state.orders.map(orderCard).join('') || '<p class="empty">Chưa có đơn hàng nào.</p>';
  } catch (e) {
    box.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

function reorder(o) {
  let added = 0;
  for (const i of o.items) {
    const f = foodById(i.foodId);
    if (!f?.available) continue;
    const q = Math.min(i.quantity, f.stock - (state.cart[f.id] || 0));
    if (q > 0) { state.cart[f.id] = (state.cart[f.id] || 0) + q; added += q; }
  }
  store.set('cart', state.cart);
  renderCart();
  toast(added ? `Đã thêm ${added} phần vào giỏ` : 'Các món trong đơn này hiện đã hết');
  if (added) toggleCart(true);
}

// ---------- Chi tiết món & đánh giá ----------
async function openFood(id, focusReview = false) {
  const box = $('#foodDetail');
  box.innerHTML = '<p class="empty">Đang tải...</p>';
  $('#foodDialog').showModal();
  try {
    const [f, reviews] = await Promise.all([api(`/foods/${id}`), api(`/foods/${id}/reviews`)]);
    box.innerHTML = `
      <div class="detail-head">
        <div class="detail-img">${foodImg(f.image)}</div>
        <div>
          <small class="muted">${esc(f.category)}</small>
          <h2>${esc(f.name)}</h2>
          <div class="meta">${f.reviewCount ? `${stars(f.rating)} ${f.rating}/5 · ${f.reviewCount} đánh giá` : '<span class="muted">Chưa có đánh giá</span>'} · Đã bán ${f.sold}</div>
          <p>${esc(f.description)}</p>
          <div class="row"><span class="price big">${money(f.price)}</span><small class="stock">${stockText(f)}</small></div>
          <button class="primary" data-action="add" data-id="${f.id}" ${f.available ? '' : 'disabled'}>${f.available ? '+ Thêm vào giỏ' : 'Hết hàng'}</button>
        </div>
      </div>
      <h3>Đánh giá</h3>
      ${session.token ? `<form id="reviewForm" class="review-form" data-id="${f.id}">
        <div class="star-input" role="radiogroup" aria-label="Số sao">
          ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" name="rating" id="r${n}" value="${n}" ${n === 5 ? 'checked' : ''}><label for="r${n}" title="${n} sao">★</label>`).join('')}
        </div>
        <textarea name="comment" rows="2" maxlength="500" placeholder="Món này thế nào? (chỉ đánh giá được món bạn đã nhận)"></textarea>
        <p class="error small" id="reviewError"></p>
        <button class="primary" type="submit">Gửi đánh giá</button>
      </form>` : '<p class="muted small"><button class="link" data-action="login">Đăng nhập</button> để đánh giá món đã đặt.</p>'}
      <div class="reviews">${reviews.map((r) => `<div class="review">
        <div class="row"><b>${esc(r.userName)}</b>${stars(r.rating)}</div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<small class="muted">${fmtTime(r.createdAt)}</small></div>`).join('') || '<p class="muted small">Chưa có đánh giá nào.</p>'}
      </div>`;
    if (focusReview) $('#reviewForm textarea')?.focus();
  } catch (e) {
    box.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

function showView(name) {
  if (name === 'account' && !session.token) { name = 'menu'; openAuth('login'); }
  $('#view-menu').hidden = name !== 'menu';
  $('#view-account').hidden = name !== 'account';
  $('#view-orders').hidden = name !== 'orders';
  $$('.nav [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'orders') renderOrders();
  if (name === 'account') fillAccount();
  window.scrollTo({ top: 0 });
}

// ---------- Tài khoản: sửa thông tin, đổi mật khẩu, nạp ví ----------
function fillAccount() {
  const f = $('#profileForm'), u = session.user;
  f.email.value = u.email; f.name.value = u.name; f.phone.value = u.phone || '';
  ['#profileMsg', '#pwMsg', '#topupMsg', '#ptMsg'].forEach((m) => { $(m).textContent = ''; });
  refreshWallet();
  loadPoints();
}
async function loadPoints() {
  try {
    const p = await api('/points');
    $('#ptBalance').textContent = p.balance;
    $('#ptTier').textContent = `Hạng ${p.tier}${p.bonus ? ` · +${p.bonus}%` : ''}`;
    $('#ptNext').textContent = p.next ? `Còn ${p.next.need} điểm nữa lên hạng ${p.next.name}.` : 'Bạn đang ở hạng cao nhất 🎉';
    $('#ptBar').style.width = `${Math.min(100, p.balance / 5)}%`;
    $('#ptRewards').innerHTML = p.rewards.map((r) => `<button type="button" data-action="redeem" data-id="${r.id}" ${p.balance < r.points ? 'disabled' : ''}>
      <b>${esc(r.title)}</b><small>Đơn từ ${money(r.minOrder)} · ${r.points} điểm</small></button>`).join('');
    $('#ptVouchers').innerHTML = p.vouchers.length ? p.vouchers.map((v) => `<div class="pt-voucher"><span><b>${esc(v.code)}</b> ${esc(v.description)} <small>HSD ${esc(v.expiresAt)}</small></span>
      <button class="link small" data-action="use-coupon" data-code="${esc(v.code)}">Dùng</button></div>`).join('') : 'Chưa có';
    $('#ptHistory').innerHTML = p.history.map((h) => `<li><span>${esc(h.note || '')}</span><b class="${h.delta > 0 ? 'up' : 'down'}">${h.delta > 0 ? '+' : ''}${h.delta}</b></li>`).join('') || '<li>Chưa có giao dịch</li>';
  } catch {}
}
async function redeem(rewardId) {
  const msg = $('#ptMsg');
  try {
    const r = await api('/points/redeem', { method: 'POST', body: { rewardId } });
    msg.className = 'error ok'; msg.textContent = `✓ Đã đổi: mã ${r.code} (HSD ${r.expiresAt})`;
    await loadPoints();
  } catch (err) { msg.className = 'error'; msg.textContent = err.message; }
}
async function topup(amount) {
  const msg = $('#topupMsg');
  try {
    await api('/payments/wallet/topup', { method: 'POST', body: { amount } });
    await refreshWallet();
    msg.className = 'error ok'; msg.textContent = `✓ Đã nạp ${money(amount)} vào ví`;
    toast(`Đã nạp ${money(amount)} vào ví (mô phỏng)`);
  } catch (err) { msg.className = 'error'; msg.textContent = err.message; }
}
const submitForm = (sel, msgSel, fn) => $(sel).addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $(msgSel);
  try { msg.className = 'error ok'; msg.textContent = await fn(Object.fromEntries(new FormData(e.target))); }
  catch (err) { msg.className = 'error'; msg.textContent = err.message; }
});
submitForm('#profileForm', '#profileMsg', async (b) => {
  setSession(await api('/users/me', { method: 'PATCH', body: b }));
  return '✓ Đã lưu thông tin';
});
submitForm('#pwForm', '#pwMsg', async (b) => {
  await api('/users/me/password', { method: 'POST', body: b });
  $('#pwForm').reset();
  return '✓ Đã đổi mật khẩu';
});
submitForm('#topupForm', '#topupMsg', async (b) => {
  await topup(Number(b.amount));
  $('#topupForm').reset();
  return $('#topupMsg').textContent;
});

// ---------- Sự kiện ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.action) {
    case 'view': showView(el.dataset.view); break;
    case 'category': state.filters.category = id; renderCategories(); loadMenu(); break;
    case 'add': setQty(id, (state.cart[id] || 0) + 1); toast(`Đã thêm ${foodById(id)?.name || 'món'} vào giỏ`); break;
    case 'qty': setQty(id, (state.cart[id] || 0) + Number(el.dataset.d)); break;
    case 'open-cart': toggleCart(true); break;
    case 'close-cart': toggleCart(false); break;
    case 'use-coupon':
      $('#couponForm').code.value = el.dataset.code;
      if (subtotal()) applyCoupon(el.dataset.code);
      else toast(`Đã chọn mã ${el.dataset.code} — thêm món vào giỏ rồi bấm Áp dụng`);
      toggleCart(true);
      break;
    case 'to-top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'auth-mode': openAuth(state.authMode === 'login' ? 'register' : 'login'); break;
    case 'scroll-menu': $('#menuTitle').scrollIntoView({ behavior: 'smooth' }); break;
    case 'remove-coupon': state.coupon = null; $('#couponMsg').textContent = ''; renderCart(); break;
    case 'checkout': openPay(); break;
    case 'login': state.resumeCheckout = false; $$('dialog[open]').forEach((d) => d.close()); openAuth('login'); break;
    case 'logout': setSession(null); showView('menu'); toast('Đã đăng xuất'); break;
    case 'close-dialog': el.closest('dialog').close(); break;
    case 'detail': openFood(id); break;
    case 'review': openFood(id, true); break;
    case 'order-filter': state.orderFilter = el.dataset.status; renderOrders(); break;
    case 'repay': openPay(state.orders.find((o) => o.id === id)); break;
    case 'reorder': reorder(state.orders.find((o) => o.id === id)); break;
    case 'redeem': await redeem(el.dataset.id); break;
    case 'topup-amount': await topup(Number(el.dataset.amount)); break;
    case 'topup':
      try { await api('/payments/wallet/topup', { method: 'POST', body: { amount: 200000 } }); await refreshWallet(); toast('Đã nạp 200.000 ₫ vào ví (mô phỏng)'); }
      catch (err) { toast(err.message); }
      break;
    case 'cancel':
      if (!confirm(`Huỷ đơn #${id}?`)) break;
      try { await api(`/orders/${id}/cancel`, { method: 'POST' }); toast('Đã huỷ đơn'); renderOrders(); loadAll(); refreshWallet(); }
      catch (err) { toast(err.message); }
      break;
  }
});


// Dùng chung cho đăng nhập mật khẩu và mạng xã hội
async function finishLogin(s, remember) {
  setSession(s, remember);
  // Phân luồng theo vai trò: admin -> Tổng quan, nhân viên -> Xử lý đơn, khách -> ở lại trang đặt món
  if (isStaff()) { location.href = homeOf(session.user.role); return; }
  $('#authDialog').close();
  $('#authForm').reset();
  toast(`Chào mừng, ${session.user.name}!`);
  if (state.resumeCheckout) { state.resumeCheckout = false; openPay(); }
  else if (!$('#view-orders').hidden) renderOrders();
}

// ---------- Đăng nhập Google / Facebook: chỉ hiện nút khi máy chủ đã cấu hình khoá ----------
const loadScript = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = no; document.head.append(s); });
async function socialLogin(provider, token) {
  try { await finishLogin(await api('/users/social', { method: 'POST', body: { provider, token } }), $('#authForm').remember.checked); }
  catch (err) { $('#authError').textContent = err.message; }
}
(async function initSocial() {
  let cfg; try { cfg = await api('/users/social-config'); } catch { return; }
  if (cfg.google) {
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      google.accounts.id.initialize({ client_id: cfg.google, callback: (r) => socialLogin('google', r.credential) });
      google.accounts.id.renderButton($('#gsiBtn'), { type: 'icon', shape: 'square', size: 'large' });
      $('#gsiBtn').hidden = false;
    }).catch(() => {});
  }
  if (cfg.facebook) {
    loadScript('https://connect.facebook.net/vi_VN/sdk.js').then(() => {
      FB.init({ appId: cfg.facebook, version: 'v19.0', cookie: false });
      $('#fbBtn').hidden = false;
      $('#fbBtn').addEventListener('click', () => FB.login((r) => r.authResponse && socialLogin('facebook', r.authResponse.accessToken), { scope: 'public_profile,email' }));
    }).catch(() => {});
  }
  $('#socialDiv').hidden = $('#socialBox').hidden = !(cfg.google || cfg.facebook);
})();

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { email: f.email.value, password: f.password.value };
  if (state.authMode === 'register') Object.assign(body, { name: f.name.value, phone: f.phone.value });
  try {
    await finishLogin(await api(`/users/${state.authMode}`, { method: 'POST', body }), f.remember.checked);
  } catch (err) {
    $('#authError').textContent = err.message;
  }
});

$('#couponForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = e.target.code.value.trim();
  if (code) applyCoupon(code);
});

let searchTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filters.q = e.target.value.trim(); loadMenu(); }, 250);
});
$('#price').addEventListener('change', (e) => { state.filters.price = e.target.value; loadMenu(); });
$('#sort').addEventListener('change', (e) => { state.filters.sort = e.target.value; loadMenu(); });
$('#inStock').addEventListener('change', (e) => { state.filters.inStock = e.target.checked; loadMenu(); });

$('#payForm').addEventListener('change', (e) => { if (e.target.name === 'method') updateMethod(); });
$('#payForm').addEventListener('submit', (e) => { e.preventDefault(); submitPay(e.target); });
$('#payDialog').addEventListener('close', () => { if (state.payOrder && !$('#view-orders').hidden) renderOrders(); });

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'reviewForm') return;
  e.preventDefault();
  const f = e.target;
  try {
    await api(`/foods/${f.dataset.id}/reviews`, { method: 'POST', body: { rating: Number(f.rating.value), comment: f.comment.value } });
    toast('Cảm ơn bạn đã đánh giá!');
    openFood(f.dataset.id);
    loadAll(); loadMenu();
  } catch (err) {
    $('#reviewError').textContent = err.message;
  }
});

document.addEventListener('session', renderUser);

// ---------- Khởi động ----------
(async () => {
  renderDemoAccounts($('#demoBox'));
  renderUser();
  initBell(() => { if (!$('#view-orders').hidden) renderOrders(); });
  try {
    [state.categories] = await Promise.all([api('/categories'), loadAll()]);
    renderCategories();
    renderCart();
    loadMenu();
    loadPromos();
  } catch (e) {
    $('#menu').innerHTML = `<p class="empty">Không tải được thực đơn: ${esc(e.message)}</p>`;
  }
  showView(location.hash === '#don-hang' ? 'orders' : 'menu');
})();
