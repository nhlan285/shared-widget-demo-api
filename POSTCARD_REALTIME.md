# Postcard: shared canvas and private image upload

## Nghiệp vụ

- Chỉ hai người đang thuộc cùng một pair `active` được truy cập.
- Mỗi người có tối đa một bản nháp: một pair tối đa hai bản nháp.
- Cả hai được vẽ lên mỗi canvas. Người tạo là chủ postcard và là người gửi;
  thành viên còn lại là người nhận, kể cả khi hai người cùng đóng góp nét vẽ.
- Mỗi người chỉ sửa/hoàn tác nét của mình. Cả hai được dùng công cụ tẩy.
- Chủ postcard được xóa toàn bộ canvas, hủy nháp, khóa/mở khóa và Gửi.
- Gửi thành công tạo một ảnh bất biến trong R2. Bản nháp tiếp theo là postcard mới.
- Hủy pair xóa lịch sử postcard khỏi D1 ngay trong transaction archive pair,
  đóng realtime và thu hồi API ảnh. File R2 được xóa ngay khi có thể, có hàng đợi
  retry nếu R2 gặp lỗi. Không thể thu hồi file đã tải về/chia sẻ ngoài app.

Phạm vi này là backend realtime/upload/download. Widget, push notification và
quyền lưu ảnh/chia sẻ trên Android/iOS do frontend triển khai sau.

## Chạy và deploy

```bash
npm run db:migrate:local
npm run dev
npm test
```

Migration mới: `migrations/0006_postcards.sql`. Bổ sung binding `POSTCARD_ROOMS`
cho class `PostcardRoom`, migration Durable Object `postcards-v1` sử dụng
`new_sqlite_classes`, và Cron hàng giờ để retry dọn file. Cấu hình production
và staging đã có trong `wrangler.jsonc`.

Trước khi deploy: áp dụng migration D1 trên đúng môi trường, sau đó deploy
Worker. Không đổi tên class hoặc xóa migration Durable Object đã deploy.

Khi merge sang `temp`, thêm vào cấu hình cá nhân tương ứng:

```json
"durable_objects": {
  "bindings": [{ "name": "POSTCARD_ROOMS", "class_name": "PostcardRoom" }]
},
"migrations": [{ "tag": "postcards-v1", "new_sqlite_classes": ["PostcardRoom"] }],
"triggers": { "crons": ["0 * * * *"] }
```

Giữ Account ID và database của tài khoản cá nhân. Không copy ID database của team.
Không có R2 thì tạo nháp và realtime vẫn hoạt động, nhưng gửi/tải ảnh trả `503`.
Nếu có R2, dùng bucket **private**, không bật URL public `r2.dev` hoặc custom
domain public. Ảnh postcard không được phục vụ từ `/files/postcards/*`.

## REST API

Base path: `/v1/postcards`. Mọi REST API yêu cầu `Authorization: Bearer <accessToken>`.
Response JSON dùng envelope hiện tại: `{ statusCode, message, data, timestamp }`.
Riêng API ảnh thành công trả bytes ảnh, không có JSON envelope.

| Method | Path | Input / kết quả |
| --- | --- | --- |
| POST | `/drafts` | JSON `{width,height,backgroundColor}` → draft + drawing |
| GET | `?status=draft` | Hai bản nháp của pair, có phân trang |
| GET | `?status=sent&page=1&limit=20` | Postcard đã gửi của pair |
| GET | `/:id` | Chi tiết + snapshot canvas chính xác |
| DELETE | `/:id` | Chủ postcard hủy nháp chưa khóa |
| POST | `/realtime-ticket` | Vé WebSocket một lần, hết hạn sau 60 giây |
| POST | `/:id/lock` | JSON `{revision}` → snapshot bị khóa + `lockId` |
| POST | `/:id/unlock` | JSON `{lockId}` → mở khóa |
| POST | `/:id/send` | Multipart: `file`, `revision`, `lockId` |
| GET | `/:id/image` | Bytes ảnh riêng tư, cần Bearer token |
| GET | `/:id/image?download=1` | Bytes ảnh với `Content-Disposition: attachment` |

Canvas: kích thước số nguyên 1–4096 pixel mỗi chiều, màu nền `#RRGGBB`.
Ảnh gửi: PNG hoặc JPEG tối đa 10 MB, đúng kích thước canvas. Server kiểm tra
signature/header, kích thước và một số dấu hiệu file bị cắt; không giải mã/render
ảnh để chứng minh từng pixel khớp nét vẽ. Frontend phải export snapshot server trả về.

`imageUrl` và `downloadUrl` là **đường dẫn tương đối**. Ghép với origin API,
không ghép thêm `/v1` lần nữa. Tải bằng HTTP có Authorization, sau đó dùng bytes
cho lưu file hoặc OS share sheet; URL này không phải link chia sẻ public.

`revision` trong danh sách bản nháp là `null`, vì nét vẽ nằm trong Durable Object.
Lấy revision chính xác từ GET detail hoặc WebSocket snapshot/event.

## Kết nối realtime

1. Lấy pair qua API hiện có.
2. Gọi `POST /v1/postcards/realtime-ticket` bằng access token.
3. Tạo WebSocket tới `data.websocketUrl` trong 60 giây.
4. Server gửi `room.snapshot` chứa các bản nháp hiện tại.
5. Subscribe một room cho cả pair; mỗi sự kiện có `postcardId` để chọn canvas.

Ticket dùng một lần, chỉ dành cho WebSocket, không dùng được làm REST token.
Không truyền access token đăng nhập trực tiếp trong URL. Một user có tối đa
hai kết nối đồng thời. Kết nối hết hạn khi access token hết hạn hoặc tối đa
một giờ; lấy ticket mới và kết nối lại. Không log URL chứa ticket.

Snapshot ban đầu:

```json
{
  "type": "room.snapshot",
  "pairId": "<pairId>",
  "postcards": [
    {
      "postcardId": "<postcardId>",
      "senderId": "<ownerId>",
      "recipientId": "<partnerId>",
      "status": "draft",
      "width": 1080,
      "height": 1440,
      "backgroundColor": "#ffffff",
      "revision": 0,
      "drawing": {
        "revision": 0,
        "clearRevision": 0,
        "strokes": [],
        "locked": false,
        "lockExpiresAt": null
      }
    }
  ]
}
```

## Sự kiện client gửi

Mọi thay đổi cần `postcardId`, `eventId` riêng và `baseRevision` là revision
server mới nhất mà client đã biết. `eventId`/`strokeId` gồm chữ, số, `_`, `-`,
tối đa 64 ký tự; nên dùng UUID. Không truyền `actorId`: server tự gán.

```json
{
  "type": "stroke.start",
  "postcardId": "<postcardId>",
  "eventId": "<uuid>",
  "baseRevision": 0,
  "strokeId": "<uuid>",
  "tool": "pen",
  "color": "#ff6699",
  "width": 0.01,
  "point": { "x": 0.2, "y": 0.3 }
}
```

| Type | Các field bổ sung |
| --- | --- |
| `stroke.start` | `strokeId`, `tool: pen/eraser`, `color`, `width`, `point` |
| `stroke.append` | `strokeId`, `points: [{x,y}, ...]`, 1–64 điểm/lần |
| `stroke.end` | `strokeId` của chính người gửi |
| `stroke.remove` | `strokeId` của chính người gửi (hoàn tác) |
| `canvas.clear` | Chỉ chủ postcard; cần baseRevision chính xác |
| `canvas.sync` | Chỉ cần `postcardId`; yêu cầu snapshot, không thay đổi dữ liệu |

Tọa độ `x,y` chuẩn hóa 0–1. Độ rộng bút 0.001–0.1 nhân với chiều rộng canvas.
Render nét theo thứ tự `strokes` trong snapshot. Vẽ nét lên layer trong suốt;
eraser dùng `destination-out` trên layer này, rồi ghép layer lên màu nền canvas
khi export. Cả hai client phải dùng cùng quy tắc render.

Mỗi người được có một nét chưa kết thúc trên mỗi canvas, hai người có thể vẽ
đồng thời. Giới hạn mỗi canvas: 256 nét, tổng 8000 điểm; message tối đa 16 KB,
tối đa 60 message/giây/kết nối. Gom nhiều điểm vào `stroke.append` thay vì gửi
mỗi điểm riêng. Frontend có thể lấy mẫu/đơn giản hóa đường trước khi gửi.

Server sắp thứ tự, lưu bền vững rồi broadcast thay đổi cho **cả hai**, bao gồm
người gửi. Sự kiện có `actorId`, `eventId`, `postcardId`, `revision` mới và
payload đã kiểm tra. Client đối chiếu eventId để không vẽ hai lần khi đã hiển
thị nét lạc quan ở local.

Các nét độc lập có thể xuất phát từ revision hơi cũ để A/B không liên tục
xung đột. Event trước lần clear hoặc cũ hơn cửa sổ 128 revision bị từ chối.
Server giữ 128 event gần nhất để nhận biết retry; gửi lại event đã nhận được
trả `event.ack` với `duplicate: true`, không thêm nét.

Lỗi WebSocket:

```json
{"type":"error","status":409,"eventId":"<uuid>","message":"Revision conflict; request sync before retrying"}
```

Khi mất mạng: kết nối lại bằng ticket mới, lấy snapshot server, đối chiếu các
event chưa có xác nhận. Chỉ retry event trong cửa sổ cho phép với eventId cũ;
khi nhận 409, đồng bộ và xử lý lại thao tác chưa được xác nhận thay vì tự ý
ghi đè toàn bộ canvas. Mất kết nối không đồng nghĩa hủy pair.

## Khóa → xuất ảnh → gửi

1. Chủ postcard dừng thao tác của mình, chờ các event đang gửi được xác nhận.
2. `POST /:id/lock` với revision mới nhất. Nếu nhận 409, sync rồi thử lại.
3. Server khóa thao tác của cả hai và broadcast `canvas.locked`.
4. Chủ postcard **render snapshot trong response lock**, không export buffer local
   còn chưa đồng bộ. Nét chưa `stroke.end` vẫn render tới điểm server đã nhận.
5. Export đúng kích thước PNG/JPEG, upload multipart với `lockId` và `revision`.
6. Server kiểm tra lock trước và sau upload, lưu ảnh R2 và commit D1.
7. Broadcast `postcard.sent` chứa metadata và API ảnh. Người nhận tải ảnh bằng JWT.

Lock có hạn 120 giây. Upload lỗi sẽ cố mở đúng lock, frontend cũng có thể gọi
unlock để hủy thao tác gửi. Nếu client chết hoặc multipart hỏng đến mức không
đọc được lockId, lock tự hết hạn; alarm thông báo mở khóa sau đó. Khi gửi thành
công, retry cùng postcardId trả lại kết quả cũ, không thay ảnh hoặc tạo postcard
thứ hai. Người nhận có thể dùng GET danh sách sent để khôi phục nếu bỏ lỡ event.

Các sự kiện server khác:

- `postcard.created`: draft mới của A hoặc B.
- `canvas.snapshot`: kết quả `canvas.sync`, field `postcard`.
- `canvas.locked` / `canvas.unlocked`: đổi trạng thái được phép vẽ.
- `postcard.discarded`: bỏ canvas khỏi giao diện.
- `postcard.sent`: chuyển từ preview nét vẽ sang ảnh hoàn chỉnh.
- `pair.disconnected`: xóa lịch sử/cache của pair; socket đóng mã 4003.
- Socket đóng mã 4001: xác thực hết hạn, lấy ticket mới.

Client phải tải lại danh sách sau reconnect để biết các bản nháp đã được gửi
hoặc hủy trong lúc offline. Không có bảo đảm push tới thiết bị đã tắt app ở
phạm vi backend này.

## R2 cleanup và lỗi giữa chừng

Mỗi upload có object key riêng và một dòng theo dõi trước khi upload. Khi
finalize thành công, D1 cập nhật postcard và bỏ dòng theo dõi trong cùng batch.
Upload thất bại được dọn ngay; nếu request chết giữa chừng, Cron thu gom object
sau thời gian chờ 10 phút. Hủy pair đưa ảnh đã gửi vào hàng đợi xóa và xóa
metadata ngay trong trigger. Tác vụ dọn xử lý tối đa 100 key mỗi lần; lỗi giữ
nguyên hàng đợi để Cron giờ sau thử tiếp.

Việc xóa room cũng có hàng đợi D1 để Cron retry nếu lần đóng room tức thì thất
bại. Bản nháp không có kết nối/không bị khóa vẫn được lưu nhưng không cần alarm
chạy liên tục. Khi có kết nối hoặc lock, alarm kiểm tra mỗi 30 giây.

Backend không thể thu hồi ảnh đã tải/chia sẻ ra ngoài hoặc xóa ngay cache trên
thiết bị đang offline. Frontend xóa cache pair khi nhận disconnect hoặc đồng bộ
lại và biết pair không còn hoạt động.

Tham khảo runtime:
[Cloudflare WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
