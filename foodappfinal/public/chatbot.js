// Chatbot tư vấn: chạy hoàn toàn ở trình duyệt, dựa trên luật + dữ liệu thật từ API (không cần AI bên ngoài).
// ponytail: so khớp từ khoá đơn giản; muốn hiểu câu tự do hơn thì nối vào một LLM ở phía gateway.
(() => {
  const plain = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const has = (t, ...ws) => ws.some((w) => t.includes(w));

  const root = document.createElement('div');
  root.className = 'chatbot';
  root.innerHTML = `
    <button class="chat-fab" data-chat="toggle" aria-label="Mở trợ lý ĂnNgon">💬</button>
    <section class="chat-box" hidden aria-label="Trợ lý ĂnNgon">
      <header><b>🤖 Trợ lý ĂnNgon</b><button data-chat="toggle" aria-label="Đóng">✕</button></header>
      <div class="chat-log" id="chatLog" aria-live="polite"></div>
      <div class="chat-quick" id="chatQuick"></div>
      <form id="chatForm"><input name="q" placeholder="Hỏi về món, giá, voucher, điểm…" autocomplete="off" maxlength="200"><button class="primary">Gửi</button></form>
    </section>`;
  document.body.append(root);
  const box = root.querySelector('.chat-box'), log = root.querySelector('#chatLog');
  const QUICK = ['🔥 Món hot hôm nay', '👥 Combo nhiều người', '🎟️ Voucher đang có', '⭐ Điểm của tôi', '📦 Đơn của tôi', '🚚 Giao hàng & thanh toán'];
  root.querySelector('#chatQuick').innerHTML = QUICK.map((q) => `<button type="button" data-chat="ask" data-q="${esc(q)}">${esc(q)}</button>`).join('');

  const say = (html, who = 'bot') => {
    const m = document.createElement('div'); m.className = `msg ${who}`; m.innerHTML = html;
    log.append(m); log.scrollTop = log.scrollHeight;
  };
  const cards = (list) => list.slice(0, 4).map((f) => `<div class="chat-food"><span>${foodImg(f.image)}</span>
    <div><b>${esc(f.name)}</b><small>${money(f.price)}${f.available ? '' : ' · hết hàng'}</small></div>
    <button class="primary" data-action="add" data-id="${f.id}" ${f.available ? '' : 'disabled'}>+</button></div>`).join('');
  const foods = () => state.all.filter((f) => f.available);

  async function answer(raw) {
    const t = plain(raw);
    const all = foods();
    if (has(t, 'xin chao', 'hello', 'chao', 'hi')) return 'Chào bạn! Mình có thể gợi ý món, tìm theo giá, báo voucher, điểm thưởng và tra cứu đơn. Bạn muốn ăn gì hôm nay? 😋';
    if (has(t, 'combo', 'nhieu nguoi', 'nhom', 'gia dinh', 'ban be'))
      return `Combo cho nhiều người đây:${cards(all.filter((f) => f.categoryId === 5))}`;
    if (has(t, 'hot', 'ban chay', 'goi y', 'ngon nhat', 'an gi')) {
      const top = [...all].filter((f) => f.categoryId !== 5).sort((a, b) => (b.sold || 0) - (a.sold || 0)).slice(0, 4);
      return `Mình gợi ý các món được gọi nhiều nhất:${cards(top)}`;
    }
    if (has(t, 'voucher', 'ma giam', 'khuyen mai', 'giam gia')) {
      const l = await api('/coupons/public').catch(() => []);
      let extra = '';
      if (session.token) { const p = await api('/points').catch(() => null); if (p?.vouchers.length) extra = `<br>Voucher đổi điểm của bạn: ${p.vouchers.map((v) => `<code>${esc(v.code)}</code>`).join(', ')}`; }
      return l.length ? `Mã đang áp dụng:<ul>${l.map((c) => `<li><b>${esc(c.code)}</b> — ${esc(c.description)}</li>`).join('')}</ul>Nhập mã ở giỏ hàng nhé.${extra}` : `Hiện chưa có mã chung nào.${extra}`;
    }
    if (has(t, 'diem', 'tich diem', 'doi qua', 'hang')) {
      if (!session.token) return 'Đăng nhập để tích điểm nhé: 1.000 ₫ = 1 điểm, đổi voucher từ 100 điểm. Hạng Bạc +10%, Vàng +20% điểm.';
      const p = await api('/points').catch(() => null);
      return p ? `Bạn có <b>${p.balance} điểm</b> (hạng ${esc(p.tier)}).${p.next ? ` Còn ${p.next.need} điểm nữa lên hạng ${esc(p.next.name)}.` : ''}<br><button class="link small" data-action="view" data-view="account">Đổi voucher ngay →</button>` : 'Chưa tải được điểm, thử lại sau nhé.';
    }
    if (has(t, 'don', 'giao den dau', 'trang thai')) {
      if (!session.token) return 'Bạn đăng nhập giúp mình để tra đơn nhé.';
      const o = (await api('/orders').catch(() => []))[0];
      return o ? `Đơn gần nhất #${o.id}: <b>${esc(o.statusText)}</b> · ${money(o.total)}.<br><button class="link small" data-action="view" data-view="orders">Xem chi tiết →</button>` : 'Bạn chưa có đơn nào.';
    }
    if (has(t, 'giao hang', 'ship', 'phi giao', 'thanh toan', 'tra tien', 'vi ', 'the ', 'cod', 'gio mo', 'mo cua', 'lien he', 'hotline'))
      return 'Giao nội thành 30–45 phút. Thanh toán: tiền mặt khi nhận, thẻ hoặc ví ĂnNgon Pay. Mở cửa 7:00–22:00, hotline 1900 1234.';
    const m = t.match(/(\d+)\s*(k|nghin|000)?/);
    if (m && has(t, 'duoi', 're', 'tam', 'gia', 'khoang', 'k')) {
      const max = Number(m[1]) * (m[2] ? 1000 : Number(m[1]) < 1000 ? 1000 : 1);
      const l = all.filter((f) => f.price <= max).sort((a, b) => b.price - a.price);
      if (l.length) return `Món từ ${money(max)} trở xuống:${cards(l)}`;
    }
    const kw = t.split(/\s+/).filter((w) => w.length > 1);
    const found = all.filter((f) => kw.some((w) => plain(f.name).includes(w)));
    if (found.length) return `Mình tìm được:${cards(found)}`;
    return 'Mình chưa hiểu ý này 😅 Bạn thử hỏi: "món hot", "combo", "món dưới 50k", "voucher", "điểm của tôi" hoặc gõ tên món nhé.';
  }

  async function ask(q) {
    say(esc(q), 'me');
    try { say(await answer(q)); } catch { say('Có lỗi xảy ra, bạn thử lại nhé.'); }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chat]'); if (!b) return;
    if (b.dataset.chat === 'toggle') { box.hidden = !box.hidden; if (!box.hidden && !log.children.length) say('Xin chào! Mình là trợ lý ĂnNgon 👋 Mình giúp gì được cho bạn?'); }
    if (b.dataset.chat === 'ask') ask(b.dataset.q.replace(/^\S+\s/, ''));
  });
  root.querySelector('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault(); const q = e.target.q.value.trim(); e.target.q.value = ''; if (q) ask(q);
  });
})();
