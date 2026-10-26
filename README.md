# Shared Widget BE

## Deploy tạm từ nhánh `temp`, không dùng R2

File `wrangler.personal.jsonc` dùng tài khoản cá nhân và Worker
`shared-widget-be-temp`. Binding R2 được comment trong file này; cấu hình
staging/production của team trong `wrangler.jsonc` được giữ nguyên.

Khi không có binding `FILES`, upload avatar, tạo scan có ảnh và `/files/*`
trả HTTP 503. Đăng ký, đăng nhập, cập nhật tên và các API không dùng ảnh vẫn
hoạt động khi đã cấu hình D1 và email. Xóa scan bỏ qua bước xóa file trên R2.
Code xử lý ảnh được giữ lại và hoạt động lại khi khôi phục binding `FILES`.

Tạo D1 riêng, rồi thay `REPLACE_WITH_YOUR_D1_DATABASE_ID` trong file cá nhân
bằng `database_id` vừa nhận được:

```bash
npx wrangler d1 create shared-widget-temp --config wrangler.personal.jsonc
npx wrangler d1 migrations apply DB --remote --config wrangler.personal.jsonc
npx wrangler deploy --config wrangler.personal.jsonc
npx wrangler secret put JWT_SECRET --config wrangler.personal.jsonc
npx wrangler secret put EMAIL_USER --config wrangler.personal.jsonc
npx wrangler secret put EMAIL_PASS --config wrangler.personal.jsonc
```

`EMAIL_PASS` là Gmail App Password. Không commit secret hoặc đặt
`NODE_ENV=development` trên Worker public. API xác thực chưa sử dụng được
cho đến khi cấu hình đủ secret. Push nhánh `temp` không kích hoạt workflow
deploy hiện tại; dùng lệnh deploy thủ công bên trên.

---

Backend REST API (Express) chạy trên **Cloudflare Workers**. Dữ liệu lưu trong **D1** (SQLite), file ảnh lưu trong **R2**.

| Môi trường | URL | Deploy khi |
|---|---|---|
| Local | `http://localhost:8787` | `npm run dev` trên máy bạn |
| Staging | `https://shared-widget-be-staging.mastersdev.workers.dev` | merge vào `develop` |
| Production | `https://shared-widget-be.mastersdev.workers.dev` | merge vào `main` |

Tài liệu API (Swagger) ở `<URL>/api-docs`.

Đăng ký qua `POST /v1/auth-service/register` chỉ cần:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "displayName": "Nguyễn An"
}
```

`displayName` được trim, phải là chuỗi không rỗng và được phép trùng.
Sau đăng ký, xác thực email bằng OTP để kích hoạt tài khoản.
`PUT /v1/user-service/me` nhận JSON để đổi `displayName`, hoặc multipart
với `file` để đổi avatar (`displayName` là tùy chọn khi upload).

Migration `0004_simplify_user_profile.sql` bỏ các cột `username`, `description`,
`birthday`, `phone`, `gender`, giữ nguyên các cột còn lại và quan hệ hiện có.
Áp dụng migration cho đúng môi trường trước khi chạy phiên bản backend này;
frontend cần gửi `displayName` thay cho `username`, `firstName`, `lastName`.

---

## 1. Bắt đầu

Yêu cầu Node.js 20 trở lên. **Không cần** tài khoản Cloudflare.

```bash
git clone https://github.com/thanhNgan13/shared_widget_be.git
cd shared_widget_be
git checkout develop
npm install
cp .dev.vars.example .dev.vars    # biến môi trường local (JWT_SECRET, NODE_ENV)
npm run db:migrate:local          # tạo bảng trong D1 giả lập
npm run dev                       # http://localhost:8787/api-docs
```

`npm run dev` giả lập D1 và R2 trong thư mục `.wrangler/` trên máy bạn, không đụng tới staging hay production. Muốn xoá sạch dữ liệu local thì xoá `.wrangler/` rồi chạy lại `npm run db:migrate:local`.

| Lệnh | Việc làm |
|---|---|
| `npm run dev` | Chạy API local, tự reload khi sửa code |
| `npm test` | Chạy test end-to-end (tự dựng D1/R2 tạm, không cần `npm run dev`) |
| `npm run db:migrate:local` | Áp dụng migration mới vào D1 local |

Test được chia theo module trong `test/*.test.js`, dùng chung helper
`test/helpers/testServer.js`. Mỗi file tự khởi động Worker trên cổng riêng,
chạy migration vào D1/R2 tạm và dọn môi trường sau khi kết thúc. Tài khoản test
được tạo qua API; các file không phụ thuộc dữ liệu của nhau và không đọc
secret trong `.dev.vars` cá nhân. Email thật được tắt trong cấu hình test.

`npm test` chạy các file tuần tự để tránh nhiều Worker cùng build OpenAPI;
các ca kiểm tra accept/revoke đồng thời vẫn gửi request song song trong test.
Đây là test end-to-end backend trên runtime local, không phải unit test hoặc
cam kết bao phủ 100% nhánh code.

```bash
npm test
node --test test/pair.test.js
node --test test/pairInvitation.test.js
```

---

## 2. Một request đi qua những đâu

```
Client (app / widget)
   │
   ▼
worker.mjs ───────── /files/<key> ──────────▶ helpers/serveFile.js ──▶ R2
   │  (mọi đường dẫn khác)
   ▼
src/app.js            CORS, đọc body (JSON / multipart), /api-docs
   ▼
src/routes/*          URL nào gọi controller nào, kèm Swagger JSDoc
   ▼
src/middlewares/      authenticateToken: kiểm tra JWT, gán req.userId
   ▼
src/controllers/*     validate input, gọi model, trả response
   ▼
src/models/*          câu SQL, đổi snake_case (DB) ⇄ camelCase (API)
   ▼
src/config/database.js ──▶ D1        src/config/storage.js ──▶ R2
```

Mỗi tầng chỉ gọi tầng ngay dưới nó: route không viết SQL, controller không gọi thẳng D1/R2.

Luồng auth nhiều bước dùng `controller → services/authSessionService → models → config`.
Service chỉ điều phối nghiệp vụ và email, model giữ SQL. Thiết kế đăng nhập một thiết bị,
request Flutter, API OTP mới và lưu ý migration được ghi tại [AUTH_DEVICE_CHANGES.md](./AUTH_DEVICE_CHANGES.md).

---

## 3. Cấu trúc thư mục

```
shared_widget_be/
├── worker.mjs                    # Entry của Worker: chuyển request vào Express, riêng /files/* đọc thẳng từ R2
├── wrangler.jsonc                # Cấu hình Cloudflare: tên Worker, D1, R2 cho production và staging
├── migrations/                   # Schema D1, mỗi lần đổi schema là một file mới
│   ├── 0001_init.sql             #   bảng users, scans
│   └── 0002_otp_codes.sql        #   bảng otp_codes (mã xác thực email)
├── scripts/build-openapi.js      # Sinh build/openapi.json từ Swagger JSDoc (tự chạy trước dev/deploy)
├── src/
│   ├── app.js                    # Tạo Express app: CORS, body parser, /api-docs, gắn routes
│   ├── config/
│   │   ├── cloudflare.js         # Giữ bindings (DB, FILES, JWT_SECRET, EMAIL_*) của request hiện tại
│   │   ├── database.js           # get / all / run: helper SQL trên D1
│   │   ├── storage.js            # putFile / deleteFiles / keyFromUrl: helper trên R2
│   │   └── swagger.js            # Thông tin chung và schema dùng chung của Swagger
│   ├── routes/
│   │   ├── index.js              # Gắn prefix /v1/auth-service, /v1/user-service, /v1/scan-service
│   │   ├── authRoutes.js         # register, verify-email, resend-verification, login, refresh-token
│   │   ├── userRoutes.js         # GET/PUT /me
│   │   └── scanRoutes.js         # CRUD /scans
│   ├── middlewares/
│   │   └── authMiddleware.js     # authenticateToken (bắt buộc JWT), optionalAuth
│   ├── controllers/              # authController, userController, scanController
│   ├── models/                   # userModel, scanModel, otpModel
│   ├── helpers/
│   │   ├── parseMultipartForm.js # Đọc form-data (file upload) → { files, fields }
│   │   └── serveFile.js          # Trả file từ R2, hỗ trợ Range / ETag
│   └── utils/
│       ├── constant.js           # API_VERSION, thời hạn token / OTP, MAX_FILE_SIZE (10 MB), getJwtSecret
│       ├── emailUtils.js         # Gửi email OTP qua Gmail SMTP (worker-mailer)
│       ├── password.js           # hashPassword / verifyPassword (PBKDF2)
│       ├── sendResponse.js       # sendSuccessResponse / sendErrorResponse
│       └── validators.js         # validateEmail, validateUsername, validatePassword
├── test/                         # Test end-to-end, mỗi module dùng môi trường local riêng
│   ├── helpers/testServer.js     # Worker, D1/R2 tạm, tạo user và dọn tiến trình Windows/Linux
│   ├── auth.test.js              # Register, OTP, resend, login và refresh
│   ├── user.test.js              # Profile và avatar
│   ├── scan.test.js              # CRUD, phân trang và quyền sở hữu scan
│   ├── pair.test.js              # Cặp hiện tại, ngày kỷ niệm, disconnect và ghép mới
│   ├── pairInvitation.test.js    # Code/link, preview/accept/revoke, expiry, retry và race
│   └── docs.test.js              # Swagger, export, CORS và file R2
└── .github/workflows/ci-cd.yml   # CI/CD: test mọi PR, deploy khi merge
```

---

## 4. Những điều cần biết khi viết code

Code chạy trên Cloudflare Workers, không phải Node.js server thông thường, nên có vài khác biệt.

**Lấy D1 / R2 / secret qua `src/config`, không qua `process.env`.** Mỗi request, `worker.mjs` gọi `setBindings(env)`; code trong `src/` dùng:

```js
const { get, all, run } = require("../config/database");   // D1
const { putFile, deleteFiles } = require("../config/storage"); // R2
const { getJwtSecret } = require("../utils/constant");       // secret JWT_SECRET
```

**Luôn trả response bằng `sendSuccessResponse` / `sendErrorResponse`** (`src/utils/sendResponse.js`) để mọi API có cùng dạng JSON:

```json
{ "statusCode": 200, "message": "...", "data": { }, "timestamp": "..." }
{ "statusCode": 400, "error": "Validation Failed", "message": "...", "timestamp": "..." }
```

**File upload:** đọc bằng `parseMultipartForm(req)`, lưu bằng `putFile(key, buffer, mimetype)`. Database chỉ lưu đường dẫn tương đối `/files/<key>`; `sendSuccessResponse` tự đổi thành URL đầy đủ theo môi trường đang chạy. Vì vậy cùng một dữ liệu trả đúng link trên local, staging và production.

**Database:** cột trong D1 đặt kiểu `snake_case`, JSON trả cho client dùng `camelCase`. Model chuyển đổi trong hàm `fromRow` (xem `src/models/scanModel.js`). Luôn truyền tham số qua `?`, không ghép chuỗi vào SQL:

```js
await get("SELECT * FROM scans WHERE key=? AND user_id=?", [scanId, userId]);
```

**Giới hạn CPU:** gói Free cho mỗi request khoảng 10 ms CPU. Tránh thư viện tính toán nặng chạy bằng JS thuần (ví dụ `bcrypt` mất ~100 ms, nên mật khẩu dùng PBKDF2 native trong `utils/password.js`).

**Không có hệ thống file lúc chạy:** không dùng `fs.readFile` trong `src/`. Swagger được sinh sẵn thành `build/openapi.json` bởi `scripts/build-openapi.js` trước mỗi lần `dev` / `deploy`.

**Thêm thư viện npm:** chỉ dùng thư viện chạy được trên Workers (thuần JS, hoặc dùng các module Node mà Workers hỗ trợ qua `nodejs_compat`). Thêm xong chạy `npm test` để chắc nó chạy được.

---

## 5. Thêm một endpoint mới

Ví dụ thêm `GET /v1/scan-service/scans/:scanId`:

1. **Model** (`src/models/scanModel.js`): thêm hàm đọc/ghi D1, trả object camelCase qua `fromRow`.
2. **Controller** (`src/controllers/scanController.js`): validate input, gọi model, trả bằng `sendSuccessResponse` / `sendErrorResponse`. Bắt lỗi bằng `try/catch` và trả 500 khi lỗi không lường trước.
3. **Route** (`src/routes/scanRoutes.js`): khai báo route, thêm `authenticateToken` nếu cần đăng nhập, kèm block `@swagger` mô tả request/response:
   ```js
   /**
    * @swagger
    * /scan-service/scans/{scanId}:
    *   get:
    *     tags: [Scan Management]
    *     security: [{ bearerAuth: [] }]
    *     ...
    */
   router.get("/scans/:scanId", authenticateToken, scanController.getScan);
   ```
   Service mới (prefix mới) thì tạo file route mới và gắn trong `src/routes/index.js`.
4. **Test** (`test/<module>.test.js`): thêm case gọi endpoint, dùng helper chung để tạo dữ liệu riêng cho file, chạy `npm test`.
5. Mở `http://localhost:8787/api-docs` kiểm tra Swagger hiển thị đúng.

---

## 6. Đổi schema database

1. Tạo file mới `migrations/000N_<mô_tả>.sql` (số tăng dần), ví dụ `0002_add_scan_note.sql`:
   ```sql
   ALTER TABLE scans ADD COLUMN note TEXT NOT NULL DEFAULT '';
   ```
2. `npm run db:migrate:local` rồi `npm test`.
3. Commit cùng code dùng cột mới. CI tự chạy migration trên staging/production trước khi deploy.

Quy tắc:

- **Không sửa** file migration đã merge, kể cả sửa lỗi chính tả. Muốn đổi gì thì thêm file mới.
- Migration chạy **trước** khi code mới lên, nên phải chạy được với code cũ: thêm bảng, thêm cột có `DEFAULT` thì an toàn. Xoá hoặc đổi tên cột thì tách làm hai lần: lần 1 bỏ dùng cột trong code, lần 2 mới xoá cột.

---

## 7. Quy trình làm việc với Git

```
develop ──▶ feature/<tên>  (code, npm test trên máy)
                 │
                 ▼  mở PR vào develop        → CI chạy npm test
            review, merge                     → CI deploy STAGING
                 │
                 ▼  thử trên staging
   PR develop → main, merge                   → CI deploy PRODUCTION
```

- Tạo nhánh từ `develop`, đặt tên `feature/<tên>` hoặc `fix/<tên>`.
- Không push thẳng vào `develop` / `main`; mọi thay đổi qua Pull Request.
- PR chỉ merge được khi check `test` trên GitHub xanh. Chạy `npm test` trên máy trước khi push để khỏi chờ.
- Sau khi merge vào `develop`, kiểm tra trên staging trước khi mở PR lên `main`.

Staging và production có D1, R2 và `JWT_SECRET` riêng: dữ liệu và token đăng nhập của hai bên không dùng chung được.

App client chọn môi trường bằng base URL: bản dev/test trỏ vào staging, chỉ bản phát hành mới trỏ vào production.

---

## 8. API

| Method | Path | Auth |
|---|---|---|
| POST | `/v1/auth-service/register` | |
| POST | `/v1/auth-service/verify-email` | |
| POST | `/v1/auth-service/resend-verification` | |
| POST | `/v1/auth-service/login` | |
| POST | `/v1/auth-service/refresh-token` | |
| GET | `/v1/user-service/me` | Bearer |
| PUT | `/v1/user-service/me` (JSON, hoặc multipart có `file` để đổi ảnh đại diện) | Bearer |
| GET | `/v1/scan-service/scans?page=&limit=&sortOrder=` | Bearer |
| POST | `/v1/scan-service/scans` (multipart: `file`, `label`, `confidence`) | Bearer |
| PUT | `/v1/scan-service/scans/:scanId` | Bearer |
| DELETE | `/v1/scan-service/scans/:scanId` | Bearer |
| DELETE | `/v1/scan-service/scans` | Bearer |
| GET | `/files/<key>` (ảnh đã upload) | |

- **Đăng ký bằng email:** `register` tạo tài khoản chưa kích hoạt và gửi mã 6 số tới email. Client gọi `verify-email` với `{ email, otp }` để kích hoạt; thành công thì trả luôn token như `login`. Chưa xác thực thì `login` trả 401 `"Account Inactive"`.
  - Mã hết hạn sau 2 phút, nhập sai 5 lần thì mã bị huỷ. `resend-verification` gửi mã mới, cách nhau ít nhất 60 giây (429 nếu gọi sớm hơn).
  - Đăng ký lại một email chưa xác thực thì bản cũ bị thay bằng bản mới. Email đã xác thực thì báo `"Email already in use"`.
  - Local / test (`NODE_ENV=development`): mã được trả trong `data.otp` của response, không cần cấu hình Gmail.
- Access token hết hạn sau 1 ngày, refresh token sau 30 ngày. Gửi kèm header `Authorization: Bearer <accessToken>`.
- `userId` và `key` của scan là UUID. Email không phân biệt hoa thường.
- File upload tối đa 10 MB. Xoá scan thì ảnh trên R2 bị xoá theo; upload ảnh đại diện mới thì ảnh cũ bị xoá.

Dự án được chuyển từ bản Firebase (`cloud_function_skin_scanner/base_training_crud`), giữ nguyên endpoint và dạng JSON: Firestore → D1, Firebase Storage → R2, Cloud Functions → Workers.

---

## 9. Dành cho người quản lý tài khoản Cloudflare

Dev không cần phần này.

**Tài nguyên trên Cloudflare** (đã tạo):

| | Production | Staging |
|---|---|---|
| Worker | `shared-widget-be` | `shared-widget-be-staging` |
| D1 | `shared-widget` | `shared-widget-staging` |
| R2 | `shared-widget-files` | `shared-widget-files-staging` |
| Secret | `JWT_SECRET`, `EMAIL_USER`, `EMAIL_PASS` | `JWT_SECRET` (chuỗi khác), `EMAIL_USER`, `EMAIL_PASS` |

**GitHub** (Settings của repo):

- Secret `CLOUDFLARE_API_TOKEN`: token tạo từ mẫu **Edit Cloudflare Workers** + quyền **Account → D1 → Edit**.
- Environments `staging` và `production` (production có thể bật Required reviewers).
- Ruleset cho `main` và `develop`: bắt buộc PR, bắt buộc check `test`, chặn force push.

**Lệnh tay** (cần `npx wrangler login`):

- Xem log trực tiếp: `npm run logs` / `npm run logs:staging`
- Deploy tay khi CI hỏng: `npm run db:migrate && npm run deploy` / `npm run db:migrate:staging && npm run deploy:staging`
- Đổi secret: `npx wrangler secret put JWT_SECRET --env=""` / `--env staging` (mọi người dùng phải đăng nhập lại)
- Gmail gửi mã xác thực: `npx wrangler secret put EMAIL_USER --env=""` và `EMAIL_PASS` (tương tự với `--env staging`). `EMAIL_PASS` là **App Password** 16 ký tự của tài khoản Gmail (cần bật xác minh 2 bước, tạo ở myaccount.google.com/apppasswords). Thiếu hai secret này thì `register` trả lỗi 500. Gmail giới hạn khoảng 500 email/ngày.

**Chi phí:** dùng hạn mức miễn phí của tài khoản: Workers ~100.000 request/ngày, D1 5 GB và 5 triệu row đọc/ngày, R2 10 GB (tính chung các bucket). Vượt hạn mức Workers/D1 thì API báo lỗi đến 7:00 sáng hôm sau, không tính tiền; R2 vượt 10 GB tính $0.015/GB/tháng.
