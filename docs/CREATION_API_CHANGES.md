# Đề xuất API — Doodle và Tranh đôi

## Bổ sung2026-10-27 — chỉ tác giả được xóa nét
| Nơi sửa | Thao tác | Lý do / quy tắc | Nơi sử dụng |
| --- | --- | --- | --- |
| WebSocket stroke.remove | Giữ kiểm tra actorId, dùng cho tẩy và undo | Cả creator lẫn partner chỉ xóa ID nét của mình; server lấy actor từ ticket, không tin client | Room eraser hit-test, Undo |
| WebSocket stroke.start / PostcardDrawing.tool.description | Sửa với kind=shared_canvas | Chỉ tạo pen; raster eraser mới trả403 vì mask layer chung có thể xóa nét người khác. Legacy không kind vẫn tương thích | New shared editor/protocol |
| WebSocket canvas.clear | Sửa với kind=shared_canvas | Trả403 cho cả creator và partner; dùng remove từng nét riêng thay vì clear-all | Chặn client cũ/bypass |
| DELETE /postcards/{id} | Sửa mô tả/guard | Creator cũng không hủy khi snapshot còn nét của tác giả khác; trả403, chọn lưu/đóng. Vẫn hủy được nháp chỉ có nét của mình | Owner exit sheet |
| Canonical preview/PNG rendering | Sửa | Mask cũ chỉ tác động nét cùng actorId được vẽ trước mask; giữ thứ tự chồng nét. R2 PNG đã lưu không tự sửa lại | RoomCanvasPainter/export |

Không đổi auth, token, schema DB, endpoint mới hoặc quyền lưu/đặt tên/đóng.
Tẩy mới xóa nguyên nét của chính người thao tác, không quét pixel của layer chung.
Riêng bước ownership không đổi24h; chính sách tiếp theo được duyệt bên dưới.

## Quyết định2026-10-27 — 24h chỉ áp dụng widget
| Nơi sửa | Thao tác | Lý do | Nơi dùng |
| --- | --- | --- | --- |
| Postcard.expiresAt description | Sửa | Hạn widget=sentAt+24h; không phải hạn lưu ảnh | Widget-state/native deadline |
| GET /postcards/{id}/image | Bỏ410 do TTL | Thư viện vẫn tải ảnh sau24h, giữ Bearer/active pair/no-store và kiểm tra lại sau R2 I/O | ArtworkRepository, library tile/detail |
| Hourly postcard image cleanup | Sửa | Không enqueue TTL; bỏ queue TTL cũ cho Doodle đã commit/pair active; giữ orphan/disconnect cleanup | R2 library retention |
| Flutter Artwork/widget selector | Sửa | widgetExpired chỉ lọc widget; bỏ expiry timer/gate trong thư viện | Postcat feed vs library |

Không sửa auth, schema DB hay gửi lại sentAt; không gia hạn widget khi xem ảnh.
`expiry_queued` cũ giữ nguyên tương thích nhưng không còn dùng cho TTL.
Ảnh demo đã bị cron cũ xóa không thể khôi phục từ metadata.

Trạng thái: IMPLEMENTED ON ISOLATED DEMO (2026-10-26), không thay backend nguồn.
Worker: https://shared-widget-demo-api.nguyennhatlan285.workers.dev
51/51 local tests và remote synthetic smoke PASS. Báo cáo dưới đây giữ cả các
đề xuất đầy đủ; khác biệt triển khai ghi ở cuối.
Nguồn: D:/Dyland/Downloads/api-docs.json, SHA256
279713559946def8f59cb243083421ad01a66c7e4af272152654e91343d877a8.
Không sửa bản gốc trong Downloads; không sửa auth, pair, device hoặc scan service.
Các JSON pointer dưới đây là vị trí cần cập nhật trong OpenAPI/backend. Chỉ sửa
Swagger không tạo ra API đang chạy. Flutter phải kiểm tra capability trước khi ghi.

## Hai loại nội dung
`doodle`: một người chụp ảnh/vẽ/sticker/text hoặc vẽ nền trống; soạn riêng trên
máy, gửi một PNG đã flatten; người kia chỉ thấy sau khi gửi. Hết 24h thì rời widget
nhưng thư viện vẫn giữ ảnh/ngày/người gửi để xem lại và lọc. `expiresAt` chỉ là
hạn hiển thị widget; ảnh vẫn private và yêu cầu pair còn active.

`shared_canvas`: hai người vẽ cùng, một canvas active/pair; owner là người thắng
transaction tạo. Owner mới đặt tên/lưu/đóng/hủy. Partner rời màn hình không đóng
room. Bản lưu bất biến không có TTL; widget canvas lấy bản lưu mới nhất.

## Bảng thay đổi (mọi thay đổi hợp đồng trong phạm vi này)
| Vị trí OpenAPI (JSON pointer) | Thao tác | Nội dung / lý do | Nơi dùng Flutter |
| --- | --- | --- | --- |
| `/paths/~1postcards~1capabilities/get` | Thêm | `{data:{contractVersion:2,privateDoodles:true,singleActiveCanvas:true,canvasArchive:true}}`; chỉ bật khi backend đã triển khai đầy đủ semantics tương ứng. 404/501 là chưa hỗ trợ, không thay bằng mock | CreationWorkspace bootstrap, khóa CTA chưa hỗ trợ |
| `/components/schemas/Postcard/properties` | Sửa/thêm | `kind: doodle/shared_canvas`, `title`, `expiresAt` nullable, `closedAt` nullable; `status` thêm `saved`; `senderId` là owner; required ID/kind/status/dimensions/timestamps. Bản cũ thiếu kind không tự đoán | Library, Doodle widget, room owner |
| `/paths/~1postcards/get/parameters` | Thêm | `kind`, `from`, `to` RFC3339 inclusive/exclusive, `senderId` lặp hoặc CSV được quy định thống nhất, `q` Unicode; lọc TRƯỚC phân trang. `status` thêm saved. Sắp thời gian DESC rồi ID DESC. `data.hasMore` boolean. 50/page | Library dùng cùng bộ lọc cho All/Tranh đôi/Doodle |
| `/paths/~1postcards~1doodles/post` | Thêm | multipart `file` PNG/JPEG <=10MB, `caption` <=160, `source:camera/blank`; `Idempotency-Key` UUID bắt buộc scoped user/pair; atomically upload private + sentAt/expiresAt=sentAt+24h; cùng key cùng payload trả bản cũ, payload khác 409; không tạo shared draft | Hai editor -> một preview -> send |
| `/paths/~1postcards~1drafts/post` | Sửa | body cũ + `kind:shared_canvas`; enforce unique active canvas PAIR bằng transaction/DO, không chỉ unique owner. 409 trả `data.activePostcardId`; client mở bản thắng. Trả ownerId qua senderId và snapshot canonical; không publish private Doodle draft | Draw/Vẽ ở lobby |
| `/paths/~1postcards~1active-canvas/get` | Thêm | `{data:Postcard|null}` snapshot canonical, tối đa một canvas active. 403 pair mất, null là không có. Không suy ra từ trang đầu danh sách | Active card / ẩn Draw, join/reconnect |
| `/paths/~1postcards~1{id}~1close/post` | Thêm | Owner only; multipart `file,title,revision,lockId`; title 1..80 sau trim. Dùng lock hiện có, kiểm tra đúng revision/kích thước; đóng active + lưu status=saved bất biến atomically; retry đã saved trả bản cũ. Mở khóa khi upload lỗi matching lock; TTL lock120s | Lưu & đóng canvas |
| `/paths/~1postcards~1{id}/delete` | Giữ/sửa mô tả | Chỉ owner hủy canvas draft unlocked; không DELETE sent/saved; không dùng DELETE khi partner rời | Owner hủy khi thoát |
| `/paths/~1postcards~1{id}~1send/post` | Deprecate cho luồng mới | Giữ tương thích postcard cũ; không dùng để gửi PNG Doodle riêng vì snapshot shared không chứa camera/sticker. Không xóa endpoint đang có client | Legacy only |
| `/paths/~1postcards~1widget-state/get` | Thêm | `{data:{doodle:Postcard|null,canvas:Postcard|null}}`; doodle mới nhất chưa hết hạn, canvas shared saved mới nhất theo closedAt; server time `now`; client ẩn TTL trên resume/đúng deadline. Không gồm draft | Hai Android widgets về sau |
| `/paths/~1postcards~1{id}~1image/get` | Sửa | Giữ Bearer và bytes, same-origin API; Doodle qua24h vẫn trả ảnh200 cho pair hợp lệ; Cache-Control:private,no-store. Pair disconnect/auth mất phải thu hồi bytes cache; canvas saved vẫn truy cập khi pair active | PrivateArtwork / detail |
| WebSocket protocol trong POSTCARD_REALTIME.md | Thêm | Giữ stroke.* snapshot/revision/lock đã có. Room broadcasts `canvas.created` với postcard, `canvas.closed` với postcard, `canvas.discarded` với postcardId và `doodle.sent` với postcard; pair-wide events buộc refetch authoritative lists/active. Không broadcast Doodle nháp | Lobby, library invalidation, editor |
| `/components/schemas/ErrorResponse` (riêng creation) | Thêm | Machine `code`: FEATURE_NOT_AVAILABLE, ACTIVE_CANVAS_EXISTS, REVISION_CONFLICT, NOT_OWNER; không đổi mã401/403; 503 R2/DO | Recovery/disabled states |

Không xóa endpoint/schema auth/pair/scan/device. Không thêm API fake reactions,
streak, share-link, read receipt khi chưa có nghiệp vụ/contract. Tạm ẩn chức năng
đó trong runtime thật; demo/test fixtures không phải API.

## Realtime và đua đồng thời
Server singleton transaction quyết định, client ẩn nút chỉ là UX. A/B cùng Draw:
1 request201 thắng; request409 chứa ID thắng -> fetch/join room đó. Join/leave
không thay owner. GET active + room.snapshot sau reconnect là nguồn chính xác.
Client không tiếp tục gửi offline, không replay mù sau clear. Event revision gap
-> sync; export duy nhất snapshot trả từ lock; owner đối chiếu trạng thái sau timeout
trước khi retry close. Đóng/hủy room phải thông báo cả lobby lẫn editor.

## Kích thước và dữ liệu
Shared canvas hiện3:4 (1080x1440); Doodle/camera giữ kích thước PNG thực tế, cùng
một kind=doodle. Android widget `2x2` là số ô launcher (không phải aspect ratio2:2
vì2:2 vẫn=1:1); launcher/OEM có thể resize. Không crop ảnh3:4 thành vuông làm
mất nét: fitCenter/letterbox. Widget native và cập nhật background cần WorkManager/
push được duyệt ở phase riêng; không đánh đồng preview Flutter với widget OS.

## Trạng thái tích hợp

### Đã triển khai trên demo riêng
capabilities, kind/title/TTL, private Doodle send, active singleton (kind bắt buộc),
owner close/title, server filters/hasMore, latest widget metadata, private media/orphan+disconnect cleanup.
Physical postcards.status vẫn draft/sent; creation_metadata ánh xạ shared sent
thành saved qua API để không rewrite bảng gốc. Legacy không kind vẫn tương thích.
Giữ tên event gốc postcard.created/sent/discarded và thêm doodle.sent; Flutter nhận
cả tên gốc lẫn tên canvas.* đề xuất. Machine code đầy đủ ngoài409 active còn là
đề xuất; client hiện phân loại theo HTTP status. Native OS widgets là phase riêng.
Auth/pair/device không đổi nghiệp vụ; chỉ khôi phục route bị conflict từ mẫu.
Chặn lộ ảnh qua /files/postcards (mẫu có test nhưng runtime thiếu guard).
Production dependency audit0 sau patch lockfile body-parser; dev-only4 còn tồn tại.
Production NODE_ENV được giữ; SMTP/email chưa cấu hình. Smoke dùng identities và
session kiểm thử seed riêng, không thêm endpoint bỏ qua đăng nhập/OTP.
API đang có: GET pair/current, postcards list/detail/image, ticket/stroke/lock.
API đề xuất chưa có capability: không gọi write từ production. Bản FE phải hiển
thị yêu cầu backend, không mô phỏng gửi thành công. Chưa có credential test từ auth
ở nhánh này; không yêu cầu người dùng gửi JWT/password/OTP vào chat.
