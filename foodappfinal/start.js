'use strict';
// Đường dẫn: foodapp/start.js
// Khởi động toàn bộ hệ thống: mỗi service là 1 tiến trình (process) độc lập.
// Lần chạy đầu tiên tự tạo dữ liệu demo (seed.js); đặt NO_SEED=1 để tắt.
const { spawn } = require('node:child_process');
const path = require('node:path');
const config = require('./config.json');

const SERVICES = ['services/user', 'services/food', 'services/order', 'services/payment', 'services/notification', 'gateway'];
const node = (file) => spawn(process.execPath, ['--no-warnings', path.join(__dirname, file)], { stdio: 'inherit' });

const children = SERVICES.map((dir) =>
  node(`${dir}/index.js`).on('exit', (code) => { if (code) console.error(`[start] ${dir} dừng với mã ${code}`); }));

async function seedWhenReady() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${config.services.gateway}/api/health`)).ok) { children.push(node('seed.js')); return; }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
}
if (!process.env.NO_SEED) seedWhenReady();

const stop = () => { children.forEach((c) => c.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
