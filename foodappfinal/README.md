<!-- Đường dẫn: foodapp/README.md -->
# 🍜 ĂnNgon — Website đặt đồ ăn giao tận nơi (Microservices) · v2

HTML · CSS · JavaScript (Node.js) · JSON · SQL (SQLite). **Không cần `npm install`** — chỉ dùng thư viện có sẵn của Node.

## Chạy

Yêu cầu: **Node.js ≥ 22.13**.

```bash
npm run reset-db # chỉ cần nếu muốn xoá sạch dữ liệu cũ
npm start        # bật 6 tiến trình: gateway + 5 service
# Khách hàng:  http://localhost:3000
# Quản trị:    http://localhost:3000/admin.html   (admin / nhân viên)
npm test         # kiểm thử end-to-end 17 nhóm luồng chính (dùng CSDL tạm, không đụng dữ liệu thật)
npm run seed     # (tuỳ chọn) tạo dữ liệu demo bằng tay khi hệ thống đang chạy
```

**Dữ liệu demo tự động**: lần đầu `npm start`, hệ thống tự tạo 5 khách hàng (`khach1@anngon.vn` … `khach5@anngon.vn` / `123456`), ~40 đơn hàng rải trong 14 ngày gần nhất (đủ trạng thái), đánh giá món — để Dashboard có biểu đồ ngay. Chạy lại sẽ tự bỏ qua. Không muốn dữ liệu demo: `NO_SEED=1` (PowerShell: `$env:NO_SEED=1; npm start`). Muốn tạo lại từ đầu: `npm run reset-db` rồi `npm start`.

**Sửa ảnh món**: Quản trị → **Món ăn** → bấm **Sửa** ở món cần đổi → mục *Ảnh món* chọn file ảnh từ máy (JPG/PNG/WEBP, tự thu nhỏ còn 800px) → **Lưu**. Ảnh được lưu trong `public/images/`. Có thể dùng emoji hoặc link ảnh trên mạng thay cho file.

Đổi tài khoản admin mặc định bằng biến môi trường `ADMIN_EMAIL`, `ADMIN_PASSWORD` (chỉ áp dụng khi CSDL chưa có admin), đổi khoá ký token bằng `APP_SECRET`.

**Tài khoản mẫu** (form đăng nhập có khối "Tài khoản mẫu" để bấm điền nhanh — xoá `DEMO_ACCOUNTS` trong `public/common.js` và các dòng `insertDemo` trong `services/user/index.js` trước khi đưa web lên mạng):

| Vai trò | Email | Mật khẩu | Sau khi đăng nhập |
|---|---|---|---|
| 👑 Quản trị viên (ADMIN) | `admin@anngon.vn` | `admin123` | Vào thẳng **Tổng quan** (dashboard) |
| 🧑‍🍳 Nhân viên (STAFF) | `nhanvien@anngon.vn` | `staff123` | Vào thẳng **Xử lý đơn hàng** |
| 🙂 Khách hàng (GUEST) | `demo@anngon.vn` | `demo123` | Ở lại trang đặt món |
| 🙂 Khách hàng demo | `khach1@anngon.vn` … `khach5@anngon.vn` | `123456` | (có sẵn lịch sử đơn) |

## Phân quyền 3 vai trò

| Chức năng | Khách hàng | Nhân viên | Quản trị viên |
|---|:-:|:-:|:-:|
| Xem thực đơn, đặt món, thanh toán, đánh giá, theo dõi đơn | ✔ | ✔ | ✔ |
| Vào trang quản trị, nhận thông báo đơn mới | | ✔ | ✔ |
| Xử lý đơn hàng (chuẩn bị → giao → hoàn thành, huỷ) | | ✔ | ✔ |
| Cập nhật số lượng còn của món | | ✔ | ✔ |
| Thêm / sửa / ẩn món, đổi giá, đổi ảnh | | | ✔ |
| Xem doanh thu (Tổng quan), xuất báo cáo | | | ✔ |
| Mã giảm giá, mã QR | | | ✔ |
| Tạo tài khoản (nhân viên…), đổi vai trò | | | ✔ |

- Đăng ký trên web luôn là **Khách hàng** (không tự chọn được vai trò). Tài khoản nhân viên do admin tạo ở tab **Người dùng**.
- **Quyền được kiểm tra ở server** (`requireStaff` / `requireAdmin` trong `shared/lib.js`) cho mọi API, không chỉ ẩn nút. Nhân viên gọi thẳng API doanh thu sẽ nhận lỗi 403.
- CSDL cũ (vai trò `CUSTOMER`) tự được nâng cấp lên `GUEST` khi chạy, không mất tài khoản.

**Dữ liệu thử**
- Thẻ: `4111 1111 1111 1111` → thành công · `4000 0000 0000 0002` → bị từ chối
- Ví ĂnNgon Pay: mỗi tài khoản có sẵn 200.000 ₫, bấm “Nạp 200.000 ₫” để nạp thêm (mô phỏng)
- Mã giảm giá: `GIAM10`, `CHAOBAN30`, `TRASUA15`
- Mở trên điện thoại (cùng Wi-Fi): dùng địa chỉ `http://192.168.x.x:3000` in ra ở terminal khi chạy `npm start`, hoặc quét **mã QR** ở trang Quản trị → Mã QR

## Tính năng

| Nhóm | Tính năng |
|---|---|
| Khách hàng | Trang chủ (ưu đãi, món bán chạy) & thực đơn · Tìm kiếm **không dấu** (gõ “bun bo” ra “Bún bò Huế”), lọc danh mục / giá / còn hàng, sắp xếp · Giỏ hàng + mã giảm giá · Đặt món **giao tận nơi** (địa chỉ + SĐT) · Thanh toán thẻ / **ví điện tử mô phỏng** / **tiền mặt khi nhận hàng** · **Theo dõi trạng thái** (dòng thời gian) · **Lịch sử đặt món**, lọc theo trạng thái, đặt lại · **Đánh giá món** (chỉ sau khi nhận món) · **Thông báo** đơn hàng (chuông) |
| Quản trị | **Dashboard doanh thu** (KPI, biểu đồ theo ngày, món bán chạy, trạng thái, phương thức TT) · **Xuất báo cáo CSV** mở bằng Excel · **Xử lý đơn** theo luồng · **Quản lý món** (thêm/sửa/ẩn) & **số lượng còn** · Mã giảm giá · **Mã QR vào trang đặt hàng** (in lên tờ rơi / hộp đựng) · **Phân quyền** người dùng |
| Chung | Đăng ký / đăng nhập, phân quyền **ADMIN / STAFF / GUEST** · Lưu toàn bộ dữ liệu vào SQL · Responsive (điện thoại, máy tính bảng, máy tính) |

## Kiến trúc

```
 Trình duyệt: index.html (khách) · admin.html (quản trị)
        │  chỉ gọi /api/*
        ▼
 ┌──────────────────── API Gateway :3000 ────────────────────┐
 │ định tuyến · phục vụ web tĩnh · /api/health                │
 │ xoá header X-Internal-Key từ bên ngoài                     │
 └──┬─────────┬───────────┬──────────────┬────────────┬──────┘
    ▼         ▼           ▼              ▼            ▼
 User      Food        Order         Payment     Notification
 :4001     :4002       :4003         :4004       :4005
 user.db   food.db     order.db      payment.db  notification.db
           ▲  ▲          │ │ ▲           │
           │  └─giữ/trả kho┘ │ └─báo thanh toán┘
           └── hỏi "đã mua?" ┘ └──── gửi thông báo ────► Notification
```

- **Database-per-service**: mỗi service có file SQLite + `schema.sql` riêng. Không service nào đọc DB của service khác — chỉ gọi qua HTTP/JSON.
- **Xác thực stateless**: token ký HMAC chứa `{ id, tên, vai trò }`; mọi service tự kiểm tra. API quản trị yêu cầu vai trò `ADMIN`.
- **Lời gọi nội bộ** (giữ kho, báo thanh toán, hoàn tiền, gửi thông báo) dùng header `X-Internal-Key`; Gateway luôn xoá header này nên client không giả mạo được.

## Luồng đơn hàng

```
PENDING ──thanh toán──► CONFIRMED ──► PREPARING ──► DELIVERING ──► COMPLETED
(chờ TT)               (đã xác nhận)  (đang làm)    (đang giao)   (hoàn thành)
PENDING / CONFIRMED ──khách huỷ──► CANCELLED   ·   mọi bước trước COMPLETED ──admin huỷ──► CANCELLED
```

1. **Đặt món** → Order gọi Food **giữ hàng nguyên tử** (thiếu 1 món là huỷ cả lần giữ), nhận giá thật, áp mã giảm giá, lưu đơn `PENDING`.
2. **Thanh toán** → Payment lấy số tiền từ Order, trừ thẻ / ví (số dư thật trong DB) / ghi nhận tiền mặt, rồi báo Order chuyển `CONFIRMED`.
3. **Huỷ đơn** → trả hàng vào kho, trả lượt mã giảm giá, hoàn tiền (ví được cộng lại).
4. Đơn chưa thanh toán sau **15 phút** tự huỷ để giải phóng tồn kho.
5. Mỗi lần đổi trạng thái → ghi vào `order_events` (dòng thời gian) và gửi thông báo cho khách / admin.

**Tính nhất quán**: chuyển trạng thái bằng `UPDATE … WHERE status IN (…)` (không ai ghi đè ai); unique index chặn thanh toán 2 lần kể cả bấm đồng thời; nếu đã trừ tiền mà đơn vừa bị huỷ, giao dịch tự hoàn tiền.

## API (qua Gateway `/api`)

🔒 = cần đăng nhập · 🧑‍🍳 = nhân viên hoặc admin · 👑 = chỉ admin

| Method | Endpoint | | Mô tả |
|---|---|---|---|
| POST | `/users/register`, `/users/login` | | `{name, email, password, phone?}` → `{token, user}` |
| GET | `/users/me` | 🔒 | Hồ sơ |
| GET · POST | `/users` | 👑 | Danh sách người dùng · admin tạo tài khoản `{name, email, password, role: ADMIN\|STAFF\|GUEST}` |
| PATCH | `/users/:id/role` | 👑 | Đổi vai trò `{role}` |
| GET | `/categories` | | Danh mục |
| GET | `/foods?q=&category=&minPrice=&maxPrice=&inStock=1&sort=` | | Tìm kiếm / lọc. `sort`: popular, rating, newest, price_asc, price_desc |
| GET | `/foods/:id` · `/foods/:id/reviews` | | Chi tiết món · đánh giá |
| POST | `/foods/:id/reviews` | 🔒 | `{rating 1–5, comment?}` — chỉ khi đã có đơn hoàn thành chứa món |
| POST | `/foods/:id/image` | 👑 | Tải ảnh món `{data: "data:image/jpeg;base64,..."}` (≤ 700KB) |
| PATCH | `/foods/:id/stock` | 🧑‍🍳 | Cập nhật số lượng còn `{stock}` |
| POST · PUT · DELETE | `/foods`, `/foods/:id` | 👑 | Thêm / sửa / ẩn món. `GET /foods?all=1` (🧑‍🍳) xem cả món ẩn |
| GET | `/coupons/public` | | Mã đang áp dụng (trang chủ) |
| POST | `/coupons/check` | | `{code, subtotal}` → `{discount}` |
| GET · POST · PATCH | `/coupons`, `/coupons/:code` | 👑 | Danh sách · tạo · bật/tắt |
| POST | `/orders` | 🔒 | `{address, phone, items:[{foodId, quantity}], couponCode?, note?}` |
| GET | `/orders?status=` · `/orders/:id` | 🔒 | Lịch sử · chi tiết (kèm `events`) |
| POST | `/orders/:id/cancel` | 🔒 | Khách huỷ (khi chưa chuẩn bị) |
| GET | `/orders/admin/all?status=&q=` | 🧑‍🍳 | Danh sách đơn (`status=ACTIVE`: đang xử lý) |
| PATCH | `/orders/:id/status` | 🧑‍🍳 | `{status, note?}` — chỉ bước hợp lệ (xem `next` trong đơn) |
| GET | `/orders/admin/stats?days=7\|30\|90` | 👑 | Số liệu dashboard |
| GET | `/orders/admin/report?from=&to=` | 👑 | File CSV báo cáo doanh thu |
| POST | `/payments` | 🔒 | `{orderId, method: CARD\|WALLET\|COD, cardNumber?}` |
| GET · POST | `/payments/wallet` · `/payments/wallet/topup` | 🔒 | Số dư ví · nạp `{amount}` (mô phỏng) |
| GET · POST | `/notifications` · `/notifications/read-all` | 🔒 | Thông báo · đánh dấu đã đọc |
| GET | `/health` | | Trạng thái các service |
| GET | `/network` | | Địa chỉ LAN / PUBLIC_URL của máy chủ (để tạo mã QR) |

Lỗi luôn trả `{ "error": "..." }` kèm mã HTTP chuẩn (400/401/402/403/404/409/503).

## Cấu trúc thư mục

```
config.json            cổng các service + khoá bí mật
start.js               bật toàn bộ hệ thống
shared/lib.js          HTTP router, DB, token, phân quyền, gọi service — dùng chung
gateway/index.js       API Gateway
services/<tên>/        index.js + schema.sql: user, food, order, payment, notification
public/                index.html + app.js (khách) · admin.html + admin.js (quản trị)
                       common.js (dùng chung) · style.css · vendor/qrcode.js (tạo mã QR, giấy phép MIT)
seed.js                tạo dữ liệu demo (tự chạy lần đầu)
test.js                kiểm thử end-to-end
```

## Giới hạn đã biết / hướng mở rộng

- Thông báo dùng polling 10 giây → chuyển sang Server-Sent Events / WebSocket khi cần tức thời.
- Hoàn kho / hoàn tiền khi huỷ là best-effort (ghi log nếu service kia tắt) → dùng outbox + message queue (RabbitMQ/Kafka) khi triển khai thật.
- Đổi vai trò có hiệu lực ở lần đăng nhập sau (vai trò nằm trong token).
- Mỗi mã giảm giá giới hạn tổng lượt, chưa giới hạn số lần cho từng khách.
- Ảnh món tải lên được lưu trên đĩa (`public/images/`); khi triển khai nhiều máy chủ nên dùng kho ảnh chung (S3, Cloudinary…). Danh mục cố định trong `schema.sql`.
- Tách mỗi service ra container riêng (Docker Compose): thay `127.0.0.1:port` bằng tên host trong `config.json`.
