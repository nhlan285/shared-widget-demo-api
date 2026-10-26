# Ghi chú thay đổi auth và thiết bị — 22/10/2026

## Nghiệp vụ đã triển khai

- Mỗi tài khoản chỉ có một session hiện tại. Session có hạn và bị thay thế khi đăng nhập thành công ở thiết bị khác.
- Register giữ nguyên request email, password, displayName.
- Verify-email nhận thêm deviceId (UUID v4 của bản cài Flutter). OTP đúng sẽ kích hoạt user, ghi nhận thiết bị tin cậy và tạo session trong cùng giao dịch D1.
- Login nhận deviceId và deviceCredential nếu đã có. Đúng mật khẩu và credential thiết bị tin cậy thì đăng nhập ngay. Thiếu/sai credential thì yêu cầu OTP, kể cả deviceId có trong lịch sử hoặc tài khoản đang không có session.
- Chỉ chuyển session khi OTP thiết bị đúng. Trong lúc chờ OTP, máy cũ vẫn được sử dụng bình thường.
- Logout xóa session và liên kết FCM, nhưng giữ lịch sử/credential thiết bị. Không có session còn hiệu lực nghĩa là deviceCurrent=null; không thêm cột deviceCurrent vào users.
- Không dùng setupToken, không thêm POST /devices trung gian.

## Database

Migration mới: migrations/0005_device_sessions.sql. Không sửa các migration cũ.

| Bảng | Nội dung |
|---|---|
| user_devices | Một bản ghi cho mỗi (user_id, device_id), credential hash, thời gian xác thực/đăng nhập, trạng thái thu hồi, FCM của phiên hiện tại |
| user_sessions | user_id là khóa chính: một phiên hiện tại; session_id, device_id, refresh token hash, hạn dùng |
| device_login_challenges | Thiết bị đích, phiên dự định thay thế, OTP HMAC, lượt thử/gửi, hạn dùng, thời điểm dùng/hủy |

Device credential là chuỗi bí mật ngẫu nhiên 32 byte, trả dưới dạng 64 ký tự hex. Flutter lưu an toàn theo từng tài khoản/bản cài. BE lưu HMAC có ràng buộc userId/deviceId. Đây không phải hardware ID hoặc FCM token; ai sao chép được cả credential vẫn có thể giả thiết bị tin cậy.

HMAC dùng JWT_SECRET với tiền tố riêng cho device, device-otp và refresh. Không cần secret mới; xoay JWT_SECRET sẽ vô hiệu cả token và credential cũ, thiết bị phải OTP lại.

Cột users.fcm_token cũ được giữ để tương thích schema/model cũ, không được sử dụng cho luồng mới.

## API và thay đổi phía Flutter

Tất cả response giữ dạng {statusCode, message, data, timestamp}; lỗi có {statusCode, error, message, timestamp}.

### Register và xác minh email

1. POST /v1/auth-service/register: giữ nguyên request.
2. POST /v1/auth-service/verify-email:

```json
{
  "email": "user@example.com",
  "otp": "123456",
  "deviceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Thành công: data chứa isOTP=false, user, tokens và deviceCredential.

### Login

POST /v1/auth-service/login:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "deviceId": "550e8400-e29b-41d4-a716-446655440000",
  "deviceCredential": "64-ky-tu-hex-neu-da-duoc-cap"
}
```

deviceCredential là tùy chọn. Nếu truyền thì phải đúng định dạng 64 ký tự hex chữ thường; giá trị đúng định dạng nhưng không khớp sẽ đi qua OTP.

- Thành công: data={isOTP:false,user,tokens,deviceCredential}.
- Cần OTP: data={isOTP:true,challengeId,emailMasked,expiresIn:120,resendAfter:60}. Không có access/refresh token.
- Chỉ NODE_ENV=development mới thêm data.otp để thử local; production cần cấu hình EMAIL_USER/EMAIL_PASS.
- Không cập nhật lastLogin nếu mới tạo challenge hoặc OTP thất bại.

### OTP thiết bị

- POST /v1/auth-service/verify-device-login: {challengeId, otp}. OTP đúng trả cùng dữ liệu đăng nhập thành công và credential thiết bị.
- POST /v1/auth-service/resend-device-login-otp: {challengeId}. Cấp mã mới, giữ challengeId, vô hiệu mã cũ, không reset attempts.
- Hạn OTP: 2 phút; tối đa 5 lượt thử, lần tiếp theo bị từ chối. Một tài khoản phải chờ 60 giây giữa các lần gửi và tối đa 5 lần gửi trong cửa sổ 10 phút (tính gộp tạo challenge và resend).
- Tạo challenge mới sẽ hủy yêu cầu chờ cũ của tài khoản. Challenge hết hạn có thể resend nếu chưa hết lượt thử và phiên chưa đổi; nếu hết lượt thử, bắt đầu login lại sau giới hạn gửi.
- OTP sai: 400; phiên dự định thay thế đã đổi: 409 LOGIN_STATE_CHANGED, cần login lại; gửi liên tục: 429.
- Gửi email lỗi: challenge mới bị hủy, trả 503 OTP_DELIVERY_FAILED; giữ phiên cũ và vẫn áp dụng giới hạn gửi.

### Refresh và logout

- POST /v1/auth-service/refresh-token: {refreshToken}. Chỉ nhận refresh token của session hiện tại. Mỗi token dùng được một lần để đổi sang bộ mới; Flutter phải tuần tự hóa refresh và lưu bộ mới ngay.
- POST /v1/auth-service/logout: Bearer access token, không cần deviceId. Xóa session và FCM của đúng phiên, giữ lịch sử thiết bị.
- Middleware kiểm tra tokenUse=access, chữ ký HS256, hạn token và session trong D1. Refresh token không được dùng làm Bearer access token, access token không dùng để refresh.
- Phiên đã đổi/logout/hết hạn: 401 SESSION_REVOKED. Flutter đóng socket nếu có, xóa access/refresh token và ảnh widget cũ, chuyển về login; giữ credential nếu chỉ logout thông thường.
- Token sai/hết hạn/thiếu loại và định danh session: 403 Invalid Token ở API có auth. Không có token: 401.

### FCM thiết bị hiện tại

- GET /v1/devices/current: data={deviceId,platform,pushRegistered,verifiedAt,lastLoginAt}; không trả credential/hash/FCM token.
- PUT /v1/devices/current: chỉ nhận {fcmToken}. BE lấy deviceId từ session. Cập nhật khi FCM token đổi hoặc sau login.
- DELETE /v1/devices/current: không body. Chỉ xóa liên kết FCM, không logout và không xóa thiết bị tin cậy.
- Khi chuyển session, FCM cũ bị xóa. Flutter cần đăng ký lại token cho phiên mới. Chưa triển khai gửi push Firebase trong thay đổi này.

## Tổ chức code

- authController: validate và response; giữ register/resend email, sửa verify-email/login/refresh, thêm verify/resend device OTP và logout.
- authSessionService: điều phối model và email; không chứa SQL.
- sessionModel: chuyển phiên, kích hoạt user/ghi thiết bị/tiêu thụ OTP trong D1 batch, refresh có điều kiện, logout.
- deviceLoginChallengeModel: tạo, tăng lượt thử, resend, hủy challenge có kiểm tra phiên và giới hạn gửi.
- deviceModel: lịch sử tin cậy và FCM chỉ thuộc session hiện tại; sửa hàm GET còn thiếu.
- tokenUtils: ký/xác minh token riêng mục đích, tạo/băm bí mật.
- deviceValidators/AuthError: validate và lỗi nghiệp vụ có kiểm soát.
- authMiddleware: dùng chung xác thực cho authenticateToken/authenticateUser/optionalAuth, tránh bỏ sót session.
- routes/index.js: gắn deviceRoutes. Route auth/device có đầy đủ Swagger request/response.
- test helper tạo deviceId và lưu credential/session thật; cập nhật test cũ cho hợp đồng mới, thêm test/device.test.js.

## Đồng thời và ràng buộc

- Chuyển session bắt đầu bằng câu ghi có điều kiện đối chiếu expected_session_id và bằng chứng xác thực trong D1 transaction.
- Các thao tác tiếp theo chỉ chạy nếu session vừa tạo khớp; challenge chỉ thành công một lần.
- Hai request OTP hoặc refresh đồng thời không tạo hai bộ token cùng được chấp nhận cho hai phiên.
- Logout hoặc cập nhật FCM từ phiên cũ không thay đổi phiên mới.
- Middleware kiểm tra session tại đầu mỗi request; request đã được xác thực trước thời điểm thu hồi có thể đang xử lý. Các câu ghi session/FCM vẫn đối chiếu lại session trong SQL.

## Chạy và tương thích

```bash
npm run db:migrate:local
npm run dev
npm test
```

- Chưa áp dụng migration vào D1 local cá nhân, staging hoặc production trong lần sửa này; test tự áp dụng vào D1/R2 tạm.
- Token JWT cũ không có sessionId/tokenUse sẽ bị từ chối, cần đăng nhập lại. User đã tồn tại nhưng chưa có history sẽ xác thực OTP ở lần login đầu tiên.
- Flutter cần cập nhật verify-email/login theo hợp đồng trên trước khi dùng backend mới.
- Không thêm dependency npm. Không thay đổi pair, scan hoặc nghiệp vụ streak.
- Chưa có WebSocket trong source hiện tại: khi thêm realtime, phải kiểm tra session khi bắt tay và có cơ chế thu hồi socket phiên cũ. Không thể dựa riêng vào middleware HTTP cho socket đã mở.
- FCM không bảo đảm xóa ngay ảnh đã cache trên máy đang mất mạng; Flutter xử lý dọn cache khi biết phiên bị thu hồi.
- Các challenge lưu để áp dụng giới hạn gửi; trước khi có lượng lớn đăng nhập, nên bổ sung dọn bản ghi hết hạn ngoài cửa sổ giới hạn gửi.

## Kiểm tra

- Test auth cũ đã được điều chỉnh để gửi deviceId và dùng credential khi login lại.
- Test mới: FCM auth/validate, giữ phiên A khi chờ OTP, chuyển sang B, giữ history sau logout, chống giả deviceId, phân biệt token, refresh đồng thời, OTP sai/hết hạn/resend/giới hạn gửi, xác minh đồng thời và challenge cũ.
- Chạy `node --test --test-concurrency=1 test/*.test.js`: **40/40 test pass**, không fail/skip, khoảng 63 giây trên Windows. Đây là cùng lệnh được script `npm test` sử dụng.
- OpenAPI đã build và được kiểm tra bằng swagger-parser: hợp lệ, đủ 25 thao tác API đã đăng ký.
- Test chạy ngoài sandbox vì esbuild trong sandbox không đọc được đường dẫn Worker từ config tạm; chỉ dùng D1/R2 tạm, không gửi email thật.
- Chưa kiểm thử Flutter trên thiết bị thật hoặc gửi email SMTP production; chưa triển khai gửi FCM/WebSocket.

## Sửa controller thiết bị — 25/10/2026

- GET /devices/current gọi getCurrentDevice(userId, sessionId), trả một object thiết bị hiện tại thay vì mảng nơi nhận FCM từ getDevicesByUserId.
- PUT dùng validatePush hiện có, gọi registerDevice(userId, sessionId, fcmToken), rồi đọc thông tin thiết bị để trả response; model trả boolean cập nhật, không phải object.
- DELETE không nhận body/installationId, chỉ gỡ FCM theo userId và sessionId, giữ lịch sử thiết bị tin cậy.
- Thiếu định danh phiên hoặc phiên đổi giữa lúc xử lý được từ chối; giữ try/catch và response helper của dự án. Không trả FCM token hay hash credential.
- Chạy lại `node --test test/device.test.js`: **10/10 test pass**, bao gồm hai test đã báo lỗi. Không thay đổi model, schema hoặc database cá nhân; không chạy lại toàn bộ suite trong lần sửa controller này.

## Sửa lỗi kết nối trong test OTP — 25/10/2026

- Tái hiện test hết hạn OTP bị `POST /auth-service/verify-email: fetch failed (ECONNRESET)` sau các lệnh Wrangler D1 đồng bộ; lỗi xảy ra trước khi nhận HTTP response, không phải assertion OTP sai.
- Test helper gửi `Connection: close` ở health check và API request, tránh tái sử dụng socket keep-alive đã cũ trong lúc tiến trình test bị chặn bởi `execFileSync` của Wrangler.
- Thêm thông tin method/path và mã lỗi gốc vào lỗi fetch để những lần lỗi sau có nguyên nhân rõ ràng; không ghi token hoặc body.
- Không tự gửi lại POST khi lỗi mạng, không đổi thời hạn hoặc logic OTP, không đổi HTTP client của app Flutter.
- Chạy `node --test test/auth.test.js`: **5/5 test pass**, gồm test OTP từng lỗi.
- Chạy lại toàn bộ `node --test --test-concurrency=1 test/*.test.js`: **40/40 test pass**, không fail/skip, khoảng 106 giây.
