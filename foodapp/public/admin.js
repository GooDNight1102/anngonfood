'use strict';
// Đường dẫn: foodapp/public/admin.js
// Trang quản trị: dashboard doanh thu, xử lý đơn, quản lý món & tồn kho, mã giảm giá, phân quyền, xuất báo cáo.
// ADMIN thấy mọi tab; STAFF chỉ thấy Đơn hàng + Món ăn (chỉ sửa được số lượng còn).

const NEXT_LABEL = { PREPARING: '👨‍🍳 Bắt đầu chuẩn bị', DELIVERING: '🛵 Giao hàng', COMPLETED: '✅ Hoàn thành', CANCELLED: 'Huỷ đơn' };
const st = { tab: 'dashboard', days: 7, foods: [], categories: [], orders: [], editing: null };

// ---------- Khung trang, đăng nhập & phân quyền ----------
// Tab nào cho vai trò nào. Server vẫn kiểm tra quyền ở mọi API — đây chỉ là ẩn/hiện cho gọn.
const TAB_ROLES = {
  dashboard: ['ADMIN'], orders: ['ADMIN', 'STAFF'], foods: ['ADMIN', 'STAFF'],
  coupons: ['ADMIN'], qr: ['ADMIN'], users: ['ADMIN'],
};
const role = () => session.user?.role;
const canSee = (tab) => TAB_ROLES[tab]?.includes(role());
const defaultTab = () => (isAdmin() ? 'dashboard' : 'orders');

function renderShell() {
  const staff = isStaff();
  $('#loginPanel').hidden = staff;
  $('#adminNav').hidden = !staff;
  $('#roleTag').textContent = { ADMIN: 'Admin', STAFF: 'Nhân viên' }[role()] || 'Quản trị';
  $('#loginHint').textContent = session.user && !staff
    ? `Tài khoản ${session.user.email} là Khách hàng, không vào được trang này. Vui lòng đăng nhập tài khoản nhân viên hoặc quản trị viên.`
    : 'Dành cho nhân viên và quản trị viên.';
  $('#userArea').innerHTML = session.user
    ? `<span class="hi"><b>${esc(session.user.name)}</b></span> <button class="link" data-action="logout">Đăng xuất</button>` : '';
  // Ẩn tab / nút không thuộc quyền của vai trò hiện tại
  $$('#adminNav [data-tab]').forEach((b) => { b.hidden = !canSee(b.dataset.tab); });
  $$('[data-roles]').forEach((el) => { el.hidden = !el.dataset.roles.split(' ').includes(role()); });
  if (staff) showTab(location.hash.slice(1) || defaultTab());
  else $$('[data-panel]').forEach((p) => { p.hidden = true; });
}

function showTab(tab) {
  if (!canSee(tab)) tab = defaultTab(); // nhân viên gõ #dashboard trên URL -> về Đơn hàng
  st.tab = tab;
  history.replaceState(null, '', `#${tab}`);
  $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  $$('#adminNav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  LOADERS[tab]();
}

// ---------- Dashboard ----------
const short = (v) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));
function niceMax(v) {
  if (v <= 0) return 100000;
  const p = 10 ** Math.floor(Math.log10(v));
  return (Math.ceil((v / p) * 2) / 2) * p;
}
const dm = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

// Biểu đồ cột 1 chuỗi (doanh thu/ngày): SVG thuần, một màu, tooltip khi rê chuột / chạm
function barChart(el, data) {
  // Vẽ theo đúng bề rộng thật để chữ trên trục không bị co nhỏ trên điện thoại
  const W = Math.max(300, Math.round(el.clientWidth || 760)), H = W < 500 ? 220 : 260, L = 46, R = 8, T = 14, B = 30;
  const iw = W - L - R, ih = H - T - B;
  const max = niceMax(Math.max(...data.map((d) => d.revenue)));
  const step = iw / data.length;
  const bw = Math.max(3, Math.min(32, step * 0.62));
  const y = (v) => T + ih - (v / max) * ih;
  const every = Math.ceil(data.length / Math.max(3, Math.floor(W / 75)));
  const bar = (x, top, w, h) => {
    const r = Math.min(4, w / 2, h);
    return `M${x},${T + ih}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${T + ih}Z`;
  };
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ doanh thu theo ngày">
    ${[0, 0.25, 0.5, 0.75, 1].map((t) => `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(t * max)}" y2="${y(t * max)}"/>
      <text class="axis" x="${L - 8}" y="${y(t * max) + 4}" text-anchor="end">${short(t * max)}</text>`).join('')}
    ${data.map((d, i) => {
      const x = L + i * step;
      return `<g class="bar" data-i="${i}">
        <rect class="hit" x="${x}" y="${T}" width="${step}" height="${ih}"/>
        ${d.revenue ? `<path class="mark" d="${bar(x + (step - bw) / 2, y(d.revenue), bw, ih - (y(d.revenue) - T))}"/>` : ''}
        ${i % every === 0 || i === data.length - 1 ? `<text class="axis" x="${x + step / 2}" y="${H - 10}" text-anchor="middle">${dm(d.date)}</text>` : ''}
      </g>`;
    }).join('')}
  </svg><div class="chart-tip" hidden></div>`;
  const tip = $('.chart-tip', el);
  const show = (e) => {
    const g = e.target.closest('.bar');
    if (!g) { tip.hidden = true; return; }
    const d = data[g.dataset.i];
    $$('.bar', el).forEach((b) => b.classList.toggle('on', b === g));
    tip.innerHTML = `<b>${dm(d.date)}</b><br>${money(d.revenue)}<br><span class="muted">${d.orders} đơn</span>`;
    tip.hidden = false;
    const box = el.getBoundingClientRect(), r = g.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(r.left - box.left + r.width / 2, 60), box.width - 60)}px`;
  };
  el.onpointermove = show;
  el.onpointerdown = show;
  el.onpointerleave = () => { tip.hidden = true; $$('.bar', el).forEach((b) => b.classList.remove('on')); };
}

async function loadDashboard() {
  try {
    const s = await api(`/orders/admin/stats?days=${st.days}`);
    const k = s.kpis;
    const tiles = [
      ['Doanh thu', money(k.revenue)], ['Số đơn', k.orders], ['Giá trị TB / đơn', money(k.avgOrder)],
      ['Khách hàng', k.customers], ['Đã giảm giá', money(k.discount)], ['Đơn đã huỷ', s.byStatus.CANCELLED || 0],
    ];
    const icons = ['💰', '🧾', '📈', '👥', '🏷️', '🚫'];
    $('#kpis').innerHTML = tiles.map(([l, v], i) => `<div class="kpi k${i}"><span class="kpi-ico">${icons[i]}</span><small>${l}</small><strong>${v}</strong></div>`).join('');
    $('#greet').textContent = `Xin chào, ${session.user.name} 👋`;
    $('#today').textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    barChart($('#revenueChart'), s.byDay);
    $('#revenueTable').innerHTML = `<table class="table compact"><tr><th>Ngày</th><th>Số đơn</th><th>Doanh thu</th></tr>
      ${s.byDay.filter((d) => d.orders).map((d) => `<tr><td>${dm(d.date)}</td><td>${d.orders}</td><td>${money(d.revenue)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Chưa có doanh thu</td></tr>'}</table>`;
    const top = s.topFoods[0]?.quantity || 1;
    $('#topFoods').innerHTML = s.topFoods.map((f) => `<div class="hbar">
        <div class="row small"><span>${esc(f.name)}</span><span><b>${f.quantity}</b> phần · ${money(f.revenue)}</span></div>
        <div class="track"><div class="fill" style="width:${(f.quantity / top) * 100}%"></div></div></div>`).join('')
      || '<p class="muted small">Chưa có dữ liệu</p>';
    $('#statusBreakdown').innerHTML = `<div class="status-list">${Object.keys(STATUS).map((k2) =>
      `<div class="row small">${badge(k2)}<b>${s.byStatus[k2] || 0}</b></div>`).join('')}</div>`;
    $('#methodBreakdown').innerHTML = s.byMethod.map((m) =>
      `<div class="row small"><span>${METHOD[m.method] || '—'}</span><span>${m.orders} đơn · <b>${money(m.revenue)}</b></span></div>`).join('')
      || '<p class="muted small">Chưa có dữ liệu</p>';
  } catch (e) { toast(e.message); }
}

// Tải CSV qua fetch (cần gửi token), rồi lưu thành file
async function downloadReport(from, to) {
  const res = await fetch(`/api/orders/admin/report?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Không xuất được báo cáo');
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'bao-cao.csv';
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Đơn hàng ----------
// Thẻ đếm đơn theo trạng thái (bấm để lọc). ponytail: tải toàn bộ đơn để đếm; thêm endpoint đếm khi có hàng nghìn đơn
async function loadOrderSummary() {
  try {
    const all = await api('/orders/admin/all?status=');
    const n = (k) => all.filter((o) => o.status === k).length;
    const tiles = [['PENDING', '⏳'], ['CONFIRMED', '✅'], ['PREPARING', '🍳'], ['DELIVERING', '🛵'], ['COMPLETED', '🎉']];
    $('#orderSummary').innerHTML = tiles.map(([k, ic]) => `<button class="kpi stat ${$('#oStatus').value === k ? 'on' : ''}" data-action="filter-status" data-status="${k}">
      <span class="kpi-ico">${ic}</span><small>${STATUS[k]}</small><strong>${n(k)}</strong></button>`).join('');
  } catch {}
}


async function loadOrders() {
  const qs = new URLSearchParams({ status: $('#oStatus').value, q: $('#oSearch').value.trim() });
  try {
    st.orders = await api(`/orders/admin/all?${qs}`);
    loadOrderSummary();
    $('#adminOrders').innerHTML = st.orders.map((o) => `
      <article class="order ${o.status}">
        <div class="row"><strong>#${o.id}</strong>${badge(o.status)}</div>
        <small class="muted">${fmtTime(o.createdAt)}</small>
        <div class="who">🛵 <b>${esc(o.customerName)}</b>${o.phone ? ` · <a href="tel:${esc(o.phone)}">${esc(o.phone)}</a>` : ''}</div>
        ${o.address ? `<small>${esc(o.address)}</small>` : ''}
        <ul class="items">${o.items.map((i) => `<li><span>${i.quantity} × ${esc(i.name)}</span><span>${money(i.price * i.quantity)}</span></li>`).join('')}</ul>
        ${o.note ? `<p class="note">📝 ${esc(o.note)}</p>` : ''}
        <div class="row"><span class="small muted">${o.paymentMethod ? METHOD[o.paymentMethod] : 'Chưa chọn'} · ${PAY_STATUS[o.paymentStatus]}${o.couponCode ? ` · ${esc(o.couponCode)}` : ''}</span>
          <strong class="price">${money(o.total)}</strong></div>
        ${o.next.length ? `<div class="actions start">${o.next.map((s) =>
          `<button class="${s === 'CANCELLED' ? 'ghost danger' : 'primary'}" data-action="set-status" data-id="${o.id}" data-status="${s}">${NEXT_LABEL[s]}</button>`).join('')}</div>` : ''}
      </article>`).join('') || '<p class="empty">Không có đơn nào.</p>';
  } catch (e) { toast(e.message); }
}

// ---------- Món ăn & tồn kho ----------
async function loadFoods() {
  try {
    [st.foods, st.categories] = await Promise.all([api('/foods?all=1'), api('/categories')]);
    $('#catSelect').innerHTML = st.categories.map((c) => `<option value="${c.id}">${esc(c.icon)} ${esc(c.name)}</option>`).join('');
    renderFoods();
  } catch (e) { toast(e.message); }
}
function renderFoods() {
  const q = $('#fSearch').value.trim().toLowerCase();
  const low = $('#fLow').checked;
  const list = st.foods.filter((f) => (!q || f.name.toLowerCase().includes(q)) && (!low || f.stock <= 5));
  $('#foodTable').innerHTML = `<thead><tr><th>Món</th><th>Danh mục</th><th>Giá</th><th>Còn</th><th>Đã bán</th><th>Đánh giá</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>${list.map((f) => `<tr class="${f.active ? '' : 'muted-row'}">
      <td><span class="cell-food"><span class="thumb">${foodImg(f.image)}</span>${esc(f.name)}</span></td>
      <td>${esc(f.category)}</td>
      <td>${money(f.price)}</td>
      <td><input class="stock-input ${f.stock <= 5 ? 'low' : ''}" type="number" min="0" value="${f.stock}" data-id="${f.id}" aria-label="Số lượng còn của ${esc(f.name)}"></td>
      <td>${f.sold}</td>
      <td>${f.reviewCount ? `★ ${f.rating} (${f.reviewCount})` : '—'}</td>
      <td>${f.active ? '<span class="badge COMPLETED">Đang bán</span>' : '<span class="badge CANCELLED">Đã ẩn</span>'}</td>
      <td class="nowrap">${isAdmin() ? `<button class="link small" data-action="edit-food" data-id="${f.id}">Sửa</button>
        <button class="link small" data-action="toggle-food" data-id="${f.id}">${f.active ? 'Ẩn' : 'Hiện'}</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">Không có món nào</td></tr>'}</tbody>`;
}
const foodBody = (f, patch = {}) => ({
  name: f.name, description: f.description, price: f.price, stock: f.stock,
  categoryId: f.categoryId, image: f.image, active: f.active, ...patch,
});
async function saveFood(id, body) {
  const saved = await api(id ? `/foods/${id}` : '/foods', { method: id ? 'PUT' : 'POST', body });
  const i = st.foods.findIndex((f) => f.id === saved.id);
  if (i >= 0) st.foods[i] = saved; else st.foods.push(saved);
  renderFoods();
  return saved;
}
function openFoodForm(food = null) {
  st.editing = food;
  st.pendingImage = null;
  const f = $('#foodForm');
  f.reset();
  $('#foodFormTitle').textContent = food ? `Sửa món: ${food.name}` : 'Thêm món mới';
  $('#foodError').textContent = '';
  if (food) {
    for (const k of ['name', 'price', 'stock', 'image', 'description']) f[k].value = food[k] ?? '';
    f.categoryId.value = food.categoryId;
    f.active.checked = food.active;
  }
  $('#imgPreview').innerHTML = foodImg(f.image.value);
  $('#foodDialog').showModal();
}

// Thu nhỏ ảnh ngay trên trình duyệt (tối đa 800px, JPEG) để file gửi lên nhẹ, tải trang nhanh
function resizeImage(file, max = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; // ảnh PNG nền trong suốt -> nền trắng
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('File không phải ảnh hợp lệ')); };
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Mã giảm giá ----------
async function loadCoupons() {
  try {
    const list = await api('/coupons');
    $('#couponTable').innerHTML = `<thead><tr><th>Mã</th><th>Mô tả</th><th>Giảm</th><th>Đơn tối thiểu</th><th>Đã dùng</th><th>Hết hạn</th><th>Trạng thái</th></tr></thead>
      <tbody>${list.map((c) => `<tr class="${c.active ? '' : 'muted-row'}">
        <td><b>${esc(c.code)}</b></td><td>${esc(c.description || '')}</td>
        <td>${c.type === 'PERCENT' ? `${c.value}%${c.maxDiscount ? ` (tối đa ${money(c.maxDiscount)})` : ''}` : money(c.value)}</td>
        <td>${money(c.minOrder)}</td><td>${c.usedCount}${c.usageLimit ? ` / ${c.usageLimit}` : ''}</td>
        <td>${c.expiresAt ? c.expiresAt.split('-').reverse().join('/') : 'Không'}</td>
        <td><label class="switch"><input type="checkbox" data-action="toggle-coupon" data-code="${esc(c.code)}" ${c.active ? 'checked' : ''}> ${c.active ? 'Bật' : 'Tắt'}</label></td>
      </tr>`).join('')}</tbody>`;
  } catch (e) { toast(e.message); }
}

// ---------- Người dùng ----------
async function loadUsers() {
  try {
    const users = await api('/users');
    const count = (r) => users.filter((u) => u.role === r).length;
    $('#roleSummary').innerHTML = Object.keys(ROLE_NAME).map((r) => `<span>${roleBadge(r)} <b>${count(r)}</b></span>`).join('');
    $('#userTable').innerHTML = `<thead><tr><th>#</th><th>Họ tên</th><th>Email</th><th>SĐT</th><th>Ngày tạo</th><th>Vai trò</th></tr></thead>
      <tbody>${users.map((u) => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.phone || '')}</td>
        <td>${fmtTime(u.createdAt).slice(6)}</td>
        <td><select data-action="role" data-id="${u.id}" ${u.id === session.user.id ? 'disabled' : ''} aria-label="Vai trò của ${esc(u.name)}">
          ${Object.entries(ROLE_NAME).map(([r, n]) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${n}</option>`).join('')}
        </select></td></tr>`).join('')}</tbody>`;
  } catch (e) { toast(e.message); }
}

// ---------- Mã QR vào trang đặt hàng ----------
// Mặc định dùng địa chỉ điện thoại truy cập được (PUBLIC_URL hoặc IP LAN), không dùng localhost
const isLocal = (u) => /\/\/(localhost|127\.|\[::1\])/i.test(u);
function renderQr(base) {
  const url = `${base.trim().replace(/\/+$/, '')}/`;
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $('#qrCode').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  $('#qrUrl').textContent = url;
  $('#qrWarn').hidden = !isLocal(url);
}
async function loadQr() {
  if ($('#qrCode').innerHTML) return;
  let urls = [];
  try { urls = (await api('/network')).urls; } catch {}
  $('#baseList').innerHTML = urls.map((u) => `<option value="${esc(u)}">`).join('');
  const base = !isLocal(location.origin) ? location.origin : urls[0] || location.origin;
  $('#qrForm').base.value = base;
  renderQr(base);
}

const LOADERS = {
  dashboard: loadDashboard, orders: loadOrders, foods: loadFoods, coupons: loadCoupons, users: loadUsers, qr: loadQr,
};


// ---------- Sự kiện ----------
document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return showTab(tab.dataset.tab);
  const days = e.target.closest('[data-days]');
  if (days) {
    st.days = Number(days.dataset.days);
    $$('[data-days]').forEach((b) => b.classList.toggle('active', b === days));
    return loadDashboard();
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.action) {
    case 'logout': setSession(null); break;
    case 'close-dialog': el.closest('dialog').close(); break;
    case 'reload-orders': loadOrders(); break;
    case 'filter-status': $('#oStatus').value = el.dataset.status; loadOrders(); break;
    case 'print': window.print(); break;
    case 'new-food': openFoodForm(); break;
    case 'edit-food': openFoodForm(st.foods.find((f) => f.id === id)); break;
    case 'toggle-food': {
      const f = st.foods.find((x) => x.id === id);
      try { await saveFood(id, foodBody(f, { active: !f.active })); toast(f.active ? 'Đã ẩn món khỏi thực đơn' : 'Món đã hiện lại trên thực đơn'); }
      catch (err) { toast(err.message); }
      break;
    }
    case 'set-status': {
      const status = el.dataset.status;
      let note = '';
      if (status === 'CANCELLED') {
        note = prompt(`Lý do huỷ đơn #${id}? (khách sẽ nhận được thông báo)`, 'Hết nguyên liệu');
        if (note === null) break;
      }
      await busy(el, async () => {
        try {
          const o = await api(`/orders/${id}/status`, { method: 'PATCH', body: { status, note } });
          toast(`Đơn #${id}: ${o.statusText}`);
        } catch (err) { toast(err.message); }
      });
      loadOrders();
      break;
    }
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.matches('.stock-input')) {
      const saved = await api(`/foods/${t.dataset.id}/stock`, { method: 'PATCH', body: { stock: Number(t.value) } });
      st.foods[st.foods.findIndex((x) => x.id === saved.id)] = saved;
      renderFoods();
      toast(`Đã cập nhật số lượng "${saved.name}": ${saved.stock}`);
    } else if (t.dataset.action === 'toggle-coupon') {
      await api(`/coupons/${encodeURIComponent(t.dataset.code)}`, { method: 'PATCH', body: { active: t.checked } });
      loadCoupons();
    } else if (t.dataset.action === 'role') {
      await api(`/users/${t.dataset.id}/role`, { method: 'PATCH', body: { role: t.value } });
      toast('Đã cập nhật vai trò');
    }
  } catch (err) {
    toast(err.message);
    if (t.matches('.stock-input')) renderFoods();
    if (t.dataset.action === 'role') loadUsers();
  }
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const s = await api('/users/login', { method: 'POST', body: { email: e.target.email.value, password: e.target.password.value } });
    history.replaceState(null, '', s.user.role === 'ADMIN' ? '#dashboard' : '#orders'); // admin -> Tổng quan, nhân viên -> Đơn hàng
    setSession(s, e.target.remember.checked);
    $('#loginError').textContent = isStaff() ? '' : 'Tài khoản Khách hàng không vào được trang quản trị';
    e.target.reset();
  } catch (err) { $('#loginError').textContent = err.message; }
});

$('#foodForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const saved = await saveFood(st.editing?.id, {
      name: f.name.value, categoryId: Number(f.categoryId.value), price: Number(f.price.value), stock: Number(f.stock.value),
      image: f.image.value, description: f.description.value, active: f.active.checked,
    });
    if (st.pendingImage) {
      const withImg = await api(`/foods/${saved.id}/image`, { method: 'POST', body: { data: st.pendingImage } });
      st.foods[st.foods.findIndex((x) => x.id === withImg.id)] = withImg;
      renderFoods();
    }
    $('#foodDialog').close();
    toast(st.editing ? 'Đã lưu thay đổi' : 'Đã thêm món mới');
  } catch (err) { $('#foodError').textContent = err.message; }
});

$('#newUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const u = await api('/users', { method: 'POST', body });
    e.target.reset();
    $('#newUserError').textContent = '';
    toast(`Đã tạo tài khoản ${ROLE_NAME[u.role]}: ${u.email}`);
    loadUsers();
  } catch (err) { $('#newUserError').textContent = err.message; }
});

$('#imgFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    st.pendingImage = await resizeImage(file);
    $('#imgPreview').innerHTML = `<img src="${st.pendingImage}" alt="">`;
    $('#foodError').textContent = '';
  } catch (err) { st.pendingImage = null; e.target.value = ''; $('#foodError').textContent = err.message; }
});
$('#foodForm').image.addEventListener('input', (e) => { if (!st.pendingImage) $('#imgPreview').innerHTML = foodImg(e.target.value); });

$('#couponForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/coupons', { method: 'POST', body });
    e.target.reset();
    $('#couponError').textContent = '';
    toast(`Đã tạo mã ${body.code.toUpperCase()}`);
    loadCoupons();
  } catch (err) { $('#couponError').textContent = err.message; }
});

$('#reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button', e.target);
  await busy(btn, () => downloadReport(e.target.from.value, e.target.to.value).catch((err) => toast(err.message)));
});

$('#qrForm').addEventListener('submit', (e) => { e.preventDefault(); renderQr(e.target.base.value); });

let searchTimer;
$('#oStatus').addEventListener('change', loadOrders);
$('#oSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadOrders, 300); });
$('#fSearch').addEventListener('input', renderFoods);
$('#fLow').addEventListener('change', renderFoods);

document.addEventListener('session', renderShell);

// ---------- Khởi động ----------
const todayStr = new Date().toLocaleDateString('sv-SE');
const d30 = new Date(Date.now() - 29 * 864e5).toLocaleDateString('sv-SE');
$('#reportForm').from.value = d30;
$('#reportForm').to.value = todayStr;
renderDemoAccounts($('#demoBox'));
renderShell();
// Sửa tay địa chỉ (#dashboard...) cũng đi qua kiểm tra quyền
window.addEventListener('hashchange', () => { if (isStaff() && location.hash.slice(1) !== st.tab) showTab(location.hash.slice(1)); });
// Có đơn mới / khách huỷ -> tự làm mới màn hình đang xem
initBell(() => { if (['orders', 'dashboard'].includes(st.tab)) LOADERS[st.tab](); });
