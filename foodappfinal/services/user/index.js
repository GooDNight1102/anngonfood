'use strict';
// Đường dẫn: foodapp/services/user/index.js
// USER SERVICE — đăng ký, đăng nhập, hồ sơ, phân quyền 3 vai trò: ADMIN · STAFF · GUEST
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { serve, openDb, tx, signToken, requireUser, requireAdmin, HttpError, isUniqueError, toInt, ROLES } = require('../../shared/lib');

const db = openDb(__dirname, 'user');

// Nâng cấp CSDL cũ (chỉ có CUSTOMER / ADMIN) lên 3 vai trò mà KHÔNG mất tài khoản: CUSTOMER -> GUEST.
// SQLite không sửa được CHECK của bảng có sẵn nên phải tạo bảng mới rồi chép dữ liệu sang.
if (!db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'users'`).get().sql.includes(`'STAFF'`)) {
  tx(db, () => {
    db.exec('ALTER TABLE users RENAME TO users_old');
    db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    db.exec(`INSERT INTO users (id, name, email, phone, password_hash, role, created_at)
             SELECT id, name, email, phone, password_hash, CASE role WHEN 'ADMIN' THEN 'ADMIN' ELSE 'GUEST' END, created_at FROM users_old`);
    db.exec('DROP TABLE users_old');
  });
  console.log('[user] Đã nâng cấp CSDL lên 3 vai trò ADMIN / STAFF / GUEST');
}

const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;

function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), crypto.scryptSync(pw, salt, 64));
}

// Tài khoản quản trị mặc định (chỉ tạo khi hệ thống chưa có admin nào)
if (!db.prepare(`SELECT 1 FROM users WHERE role = 'ADMIN'`).get()) {
  db.prepare(`INSERT OR IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'ADMIN')`)
    .run('Quản trị viên', process.env.ADMIN_EMAIL || 'admin@anngon.vn', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'));
}

// Tài khoản mẫu để test (OR IGNORE: chạy lại không bị trùng). Xoá trước khi đưa web lên mạng thật.
const insertDemo = db.prepare('INSERT OR IGNORE INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)');
insertDemo.run('Nhân viên Demo', 'nhanvien@anngon.vn', '0901111222', hashPassword('staff123'), 'STAFF');
insertDemo.run('Khách Demo', 'demo@anngon.vn', '0901234567', hashPassword('demo123'), 'GUEST');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: u.created_at });
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID, FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const getJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r) throw new HttpError(502, 'Không kết nối được máy chủ đăng nhập');
  return r.json().then((j) => (r.ok ? j : null), () => null);
};
async function verifyGoogle(idToken) {
  if (!GOOGLE_CLIENT_ID) throw new HttpError(501, 'Chưa cấu hình GOOGLE_CLIENT_ID');
  const t = await getJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!t || t.aud !== GOOGLE_CLIENT_ID || t.email_verified !== 'true') throw new HttpError(401, 'Token Google không hợp lệ');
  return { email: String(t.email).toLowerCase(), name: t.name };
}
async function verifyFacebook(accessToken) {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) throw new HttpError(501, 'Chưa cấu hình FACEBOOK_APP_ID / FACEBOOK_APP_SECRET');
  const q = encodeURIComponent(accessToken);
  const d = await getJson(`https://graph.facebook.com/debug_token?input_token=${q}&access_token=${FACEBOOK_APP_ID}|${FACEBOOK_APP_SECRET}`);
  if (!d?.data?.is_valid || d.data.app_id !== FACEBOOK_APP_ID) throw new HttpError(401, 'Token Facebook không hợp lệ');
  const me = await getJson(`https://graph.facebook.com/me?fields=name,email&access_token=${q}`);
  return { email: me?.email?.toLowerCase(), name: me?.name };
}
const session = (u) => ({ token: signToken({ sub: u.id, name: u.name, role: u.role }), user: publicUser(u) });

function accountInput(b) {
  const a = {
    name: String(b.name || '').trim(),
    email: String(b.email || '').trim().toLowerCase(),
    phone: String(b.phone || '').trim() || null,
    password: String(b.password || ''),
  };
  if (a.name.length < 2 || a.name.length > 50) throw new HttpError(400, 'Họ tên từ 2–50 ký tự');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) throw new HttpError(400, 'Email không hợp lệ');
  if (a.phone && !/^0\d{9}$/.test(a.phone)) throw new HttpError(400, 'Số điện thoại phải gồm 10 số, bắt đầu bằng 0');
  if (a.password.length < 6) throw new HttpError(400, 'Mật khẩu tối thiểu 6 ký tự');
  return a;
}

function createAccount(a, role) {
  try {
    const { lastInsertRowid } = db.prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(a.name, a.email, a.phone, hashPassword(a.password), role);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  } catch (e) {
    if (isUniqueError(e)) throw new HttpError(409, 'Email đã được đăng ký');
    throw e;
  }
}

serve('user', [
  // Tự đăng ký trên web luôn là GUEST (khách hàng) — không thể tự chọn vai trò
  ['POST', '/users/register', (ctx) => {
    ctx.status = 201;
    return session(createAccount(accountInput(ctx.body), 'GUEST'));
  }],

  ['POST', '/users/login', (ctx) => {
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(ctx.body.email || '').trim().toLowerCase());
    if (!u || !checkPassword(String(ctx.body.password || ''), u.password_hash)) {
      throw new HttpError(401, 'Email hoặc mật khẩu không đúng');
    }
    return session(u);
  }],

  // ===== Đăng nhập bằng Google / Facebook (xác minh token ở máy chủ, không tin dữ liệu từ trình duyệt) =====
  ['GET', '/users/social-config', () => ({ google: GOOGLE_CLIENT_ID || null, facebook: FACEBOOK_APP_ID || null })],

  ['POST', '/users/social', async (ctx) => {
    const { provider, token } = ctx.body;
    if (!token || typeof token !== 'string') throw new HttpError(400, 'Thiếu token đăng nhập');
    const p = provider === 'google' ? await verifyGoogle(token) : provider === 'facebook' ? await verifyFacebook(token) : null;
    if (!p) throw new HttpError(400, 'Phương thức đăng nhập không hỗ trợ');
    if (!p.email) throw new HttpError(400, 'Tài khoản này không chia sẻ email, hãy đăng ký bằng email');
    let u = db.prepare('SELECT * FROM users WHERE email = ?').get(p.email);
    if (u && u.role !== 'GUEST') throw new HttpError(403, 'Tài khoản quản trị / nhân viên chỉ đăng nhập bằng mật khẩu');
    if (!u) {
      // mật khẩu ngẫu nhiên: tài khoản mạng xã hội không đăng nhập bằng mật khẩu cho tới khi khách tự đặt
      const { lastInsertRowid } = db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'GUEST')")
        .run(p.name || p.email.split('@')[0], p.email, hashPassword(crypto.randomBytes(24).toString('hex')));
      u = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    }
    return session(u);
  }],

  ['GET', '/users/me', (ctx) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(requireUser(ctx.req).sub);
    if (!u) throw new HttpError(404, 'Không tìm thấy người dùng');
    return publicUser(u);
  }],

  // Khách tự sửa họ tên, số điện thoại (email và vai trò không tự đổi được)
  ['PATCH', '/users/me', (ctx) => {
    const id = requireUser(ctx.req).sub;
    const name = String(ctx.body.name || '').trim();
    const phone = String(ctx.body.phone || '').trim() || null;
    if (name.length < 2 || name.length > 50) throw new HttpError(400, 'Họ tên từ 2–50 ký tự');
    if (phone && !/^0\d{9}$/.test(phone)) throw new HttpError(400, 'Số điện thoại phải gồm 10 số, bắt đầu bằng 0');
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, id);
    return session(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }],

  ['POST', '/users/me/password', (ctx) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(requireUser(ctx.req).sub);
    if (!u || !checkPassword(String(ctx.body.oldPassword || ''), u.password_hash)) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
    const pw = String(ctx.body.newPassword || '');
    if (pw.length < 6) throw new HttpError(400, 'Mật khẩu mới tối thiểu 6 ký tự');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), u.id);
    return { ok: true };
  }],

  // ----- Quản trị (chỉ ADMIN) -----
  ['GET', '/users', (ctx) => {
    requireAdmin(ctx.req);
    return db.prepare(`SELECT * FROM users ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'STAFF' THEN 1 ELSE 2 END, id DESC LIMIT 500`)
      .all().map(publicUser);
  }],

  // Admin tạo tài khoản (thường dùng để tạo tài khoản nhân viên): { name, email, phone?, password, role }
  ['POST', '/users', (ctx) => {
    requireAdmin(ctx.req);
    if (!ROLES.includes(ctx.body.role)) throw new HttpError(400, 'Vai trò không hợp lệ');
    ctx.status = 201;
    return publicUser(createAccount(accountInput(ctx.body), ctx.body.role));
  }],

  ['PATCH', '/users/:id/role', (ctx) => {
    const admin = requireAdmin(ctx.req);
    const id = toInt(ctx.params.id);
    const role = ctx.body.role;
    if (!ROLES.includes(role)) throw new HttpError(400, 'Vai trò không hợp lệ');
    if (id === admin.sub) throw new HttpError(400, 'Không thể tự đổi quyền của chính mình');
    if (!db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id).changes) throw new HttpError(404, 'Không tìm thấy người dùng');
    return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  }],
]);
