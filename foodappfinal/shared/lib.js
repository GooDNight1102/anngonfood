'use strict';
// Đường dẫn: foodapp/shared/lib.js
// Thư viện dùng chung cho mọi service: HTTP server, DB, token, phân quyền, gọi service khác.
// Chỉ dùng thư viện chuẩn của Node 22 (không cần npm install).
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config.json');

const SECRET = process.env.APP_SECRET || config.secret;
const TOKEN_TTL = 7 * 24 * 3600; // 7 ngày (giây)

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- Database: mỗi service một file SQLite riêng (database-per-service) ----------
function openDb(serviceDir, name) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, `${name}.db`));
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(path.join(serviceDir, 'schema.sql'), 'utf8'));
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const isUniqueError = (e) => /UNIQUE constraint failed/.test(e?.message);

// ---------- Token ký HMAC (cấu trúc giống JWT, gọn hơn) ----------
const hmac = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const safeEqual = (a, b) =>
  typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL })).toString('base64url');
  return `${body}.${hmac(body)}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !safeEqual(sig, hmac(body))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() / 1000 ? p : null;
}

// Trả về { sub, name, role } hoặc ném 401
function requireUser(req) {
  const user = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!user) throw new HttpError(401, 'Bạn cần đăng nhập');
  return user;
}

// ---------- Phân quyền: ADMIN (quản trị viên) · STAFF (nhân viên) · GUEST (khách hàng) ----------
// ponytail: vai trò nằm trong token -> đổi quyền có hiệu lực ở lần đăng nhập sau; cần thu hồi tức thì thì kiểm tra lại với User Service
const ROLES = ['ADMIN', 'STAFF', 'GUEST'];
function requireRole(req, roles, message) {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw new HttpError(403, message);
  return user;
}
const requireAdmin = (req) => requireRole(req, ['ADMIN'], 'Chỉ quản trị viên mới được thực hiện');
const requireStaff = (req) => requireRole(req, ['ADMIN', 'STAFF'], 'Chỉ nhân viên hoặc quản trị viên mới được thực hiện');
const isStaffRole = (role) => role === 'ADMIN' || role === 'STAFF';

// Lời gọi nội bộ giữa các service. Gateway luôn xoá header này khỏi request từ bên ngoài.
const isInternal = (req) => safeEqual(req.headers['x-internal-key'], SECRET);
function requireInternal(req) {
  if (!isInternal(req)) throw new HttpError(403, 'Chỉ dành cho service nội bộ');
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, 'Dữ liệu gửi lên quá lớn')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new HttpError(400, 'JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}

// routes: [[METHOD, '/path/:param', handler(ctx)]] — khớp theo thứ tự khai báo.
// Handler trả về object (-> JSON) hoặc string (-> gửi nguyên văn, tự đặt ctx.headers['Content-Type']).
function serve(name, routes) {
  const port = config.services[name];
  const table = [['GET', '/health', () => ({ service: name, status: 'UP' })], ...routes].map(([method, pattern, handler]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    return { method, re, keys, handler };
  });

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url, 'http://localhost');
    const ctx = { req, query: url.searchParams, params: {}, body: {}, status: 200, headers: {} };
    let data;
    try {
      const route = table.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw new HttpError(404, 'Không tìm thấy API');
      const m = url.pathname.match(route.re);
      route.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) ctx.body = await readBody(req);
      data = await route.handler(ctx);
    } catch (e) {
      ctx.status = e.status || 500;
      ctx.headers = {};
      if (!e.status) console.error(`[${name}]`, e);
      data = { error: e.status ? e.message : 'Lỗi hệ thống' };
    }
    const raw = typeof data === 'string';
    res.writeHead(ctx.status, { 'Content-Type': 'application/json; charset=utf-8', ...ctx.headers });
    res.end(raw ? data : JSON.stringify(data ?? {}));
    console.log(`[${name}] ${req.method} ${url.pathname} ${ctx.status} ${Date.now() - t0}ms`);
  });
  server.listen(port, '127.0.0.1', () => console.log(`[${name}] chạy tại http://127.0.0.1:${port}`));
  return server;
}

// Gọi service khác (đồng bộ qua HTTP). Lỗi của service đích được chuyển tiếp nguyên mã.
async function call(service, method, pathname, { body, token, internal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (internal) headers['X-Internal-Key'] = SECRET;
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${config.services[service]}${pathname}`, {
      method, headers, body: body && JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(503, `Dịch vụ ${service} tạm thời không phản hồi`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status, data.error || `Lỗi từ dịch vụ ${service}`);
  return data;
}

const toInt = (v) => (v !== '' && v !== null && Number.isInteger(Number(v)) ? Number(v) : NaN);
const money = (n) => `${Number(n).toLocaleString('vi-VN')}đ`;

module.exports = {
  config, HttpError, openDb, tx, isUniqueError, signToken, requireUser, requireAdmin, requireStaff, isStaffRole, ROLES,
  isInternal, requireInternal, serve, call, toInt, money, verifyToken,
};
