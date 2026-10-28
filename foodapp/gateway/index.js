'use strict';
// Đường dẫn: foodapp/gateway/index.js
// API GATEWAY — cổng vào duy nhất: phục vụ giao diện web + định tuyến /api/* tới từng service
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { config } = require('../shared/lib');

const PUBLIC = path.join(__dirname, '..', 'public');
const ROUTES = {
  users: 'user', foods: 'food', categories: 'food', orders: 'order', coupons: 'order',
  payments: 'payment', notifications: 'notification',
};
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

async function health(res) {
  const checks = await Promise.all(Object.keys(config.services).filter((s) => s !== 'gateway').map(async (s) => {
    try {
      const r = await fetch(`http://127.0.0.1:${config.services[s]}/health`, { signal: AbortSignal.timeout(1500) });
      return [s, r.ok ? 'UP' : 'DOWN'];
    } catch { return [s, 'DOWN']; }
  }));
  const services = Object.fromEntries(checks);
  json(res, Object.values(services).every((v) => v === 'UP') ? 200 : 503, { gateway: 'UP', services });
}

// Địa chỉ để mở web trên điện thoại (cùng Wi-Fi): PUBLIC_URL (ngrok / tên miền thật) hoặc IP mạng LAN của máy này.
// IP dải 192.168.x / 10.x / 172.16–31.x (Wi-Fi gia đình, văn phòng) được xếp lên đầu.
function networkUrls() {
  const port = config.services.gateway;
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address)
    .sort((a, b) => Number(/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(b)) - Number(/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)))
    .map((ip) => `http://${ip}:${port}`);
  return [process.env.PUBLIC_URL?.replace(/\/+$/, ''), ...lan].filter(Boolean);
}

function proxy(req, res, service) {
  const headers = { ...req.headers };
  delete headers['x-internal-key']; // client không được giả làm service nội bộ
  delete headers.host;
  const upstream = http.request(
    { host: '127.0.0.1', port: config.services[service], method: req.method, path: req.url.slice(4), headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  upstream.on('error', () => { if (!res.headersSent) json(res, 503, { error: `Dịch vụ ${service} tạm thời không phản hồi` }); });
  req.pipe(upstream);
}

function serveStatic(req, res, pathname) {
  let file;
  try { file = path.normalize(path.join(PUBLIC, pathname === '/' ? 'index.html' : decodeURIComponent(pathname))); }
  catch { return json(res, 400, { error: 'URL không hợp lệ' }); }
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Không được phép' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'Không tìm thấy' });
    res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  const seg = pathname.split('/')[2];
  if (seg === 'health') return health(res);
  if (seg === 'network') return json(res, 200, { urls: networkUrls() }); // dùng để tạo mã QR vào trang đặt hàng
  const service = ROUTES[seg];
  if (!service) return json(res, 404, { error: 'Không tìm thấy API' });
  proxy(req, res, service);
}).listen(config.services.gateway, '0.0.0.0', () => {
  console.log(`[gateway] mở trình duyệt: http://localhost:${config.services.gateway}`);
  for (const u of networkUrls()) console.log(`[gateway] điện thoại (cùng Wi-Fi) mở: ${u}`);
});
