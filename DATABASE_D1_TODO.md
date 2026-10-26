# Share Widget — Database D1 bổ sung và checklist triển khai

Ngày soạn: 14/10/2026.

## 1. Phạm vi và nền tảng hiện có

Giữ JavaScript + Express trên Cloudflare Workers, D1 qua binding DB và ảnh trên R2 qua binding FILES. Không yêu cầu PostgreSQL, Redis, Cloudinary, Prisma hoặc TypeScript. Tài liệu nghiệp vụ được dùng để xác định hành vi sản phẩm.

Repo hiện có users, scans, otp_codes. Giữ nguyên đăng ký, đăng nhập, OTP, refresh token và các cột auth hiện tại. Các FK bổ sung trỏ tới users(user_id), không tạo bảng users mới. scans là nghiệp vụ scan cũ, không dùng thay posts. Đây là tài liệu thiết kế và SQL đề xuất, chưa áp dụng migration hay thay đổi API.

Auth không thuộc backlog xây lại. Tuy nhiên API nghiệp vụ cần chặn user đang xóa tài khoản; việc thu hồi token khi xóa cần tích hợp với auth hiện có.

## 2. Quy ước và quyết định nghiệp vụ

- ID: TEXT UUID, tạo bằng crypto.randomUUID() ở Worker.
- Timestamp mới: INTEGER Unix milliseconds UTC, backend đặt bằng Date.now(). Không dùng chung phép so sánh với timestamp TEXT ISO của users/scans cũ; chuyển đổi ở biên API.
- Ngày streak/ngày kỷ niệm: TEXT YYYY-MM-DD. Timezone cặp mặc định Asia/Ho_Chi_Minh.
- Boolean: INTEGER 0/1. JSON: TEXT và json_valid().
- Database snake_case; API camelCase để thống nhất repo hiện tại.
- Một user tối đa một membership active; cặp active đúng hai người.
- Code/link/QR cùng một invitation, đề xuất hạn 24 giờ. Chỉ lưu hash/HMAC token; QR chứa link, không cần bảng QR.
- Widget lấy bài mới nhất của partner chưa xóa và còn hạn 24 giờ. Hết hạn không xóa bài.
- Pair archived giữ kỷ niệm; không mở lại, ghép mới tạo pair mới.
- Streak chung cho cặp đôi: một trong hai người mở app và gửi thành công ít nhất một postcard trong ngày thì +1. Cả hai gửi hoặc gửi nhiều postcard chỉ +1/ngày. Chỉ mở app, reaction, lời nhắn và widget refresh không tăng streak. Cho phép bỏ một ngày; bỏ hai ngày liên tiếp thì lần gửi hợp lệ tiếp theo bắt đầu từ 1. Ngày nghỉ không được cộng.
- R2 lưu bytes; D1 lưu object key và metadata, không lưu URL công khai làm bằng chứng quyền.
- FK mặc định RESTRICT. Xóa tài khoản theo job; giữ UUID user và bài partner.
- Các giá trị giới hạn trong tài liệu là đề xuất MVP cần chốt khi triển khai.

## 3. Danh sách bảng còn thiếu

| Bảng | Vai trò |
| --- | --- |
| user_lifecycle | Trạng thái xóa tài khoản, không đổi schema auth users |
| pairs | Không gian chung, timezone, ngày kỷ niệm |
| pair_members | Thành viên active và lịch sử |
| pair_invitations | Lời mời code/link, hạn và kết quả accept |
| media_assets | Ảnh/thumbnail R2, owner, trạng thái |
| posts | Photo/doodle/postcard, hạn widget, idempotency |
| reactions | Một reaction/user/post |
| replies | Lời nhắn, chống retry trùng |
| post_receipts | Delivered/seen của người nhận |
| post_favorites | Favorite riêng từng user |
| pair_activity_days | Ngày cặp có postcard gửi thành công, làm nguồn tính streak |
| devices | Installation và push binding |
| notifications | Hộp thông báo |
| outbox_events | Công việc bền vững, retry, cleanup |

Không thêm refresh_sessions vì yêu cầu giữ auth. Không cần bảng memories: query posts. Không cần bảng widget: query bài nhận còn hạn. Không cần bảng downloads/shares trong MVP.

## 4. SQL đề xuất cho migration mới

Tên dự kiến: migrations/0003_share_widget.sql. SQL dưới đây chạy sau 0001/0002. Không sửa các migration đã áp dụng. Không dùng IF NOT EXISTS để che lệch schema.

### 4.1. Lifecycle, pair và invitation

~~~sql
CREATE TABLE user_lifecycle (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','deleting','deleted')),
  requested_at INTEGER,
  deleted_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE pairs (
  pair_id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'forming'
    CHECK (status IN ('forming','active','archived')),
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  anniversary_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE pair_members (
  membership_id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(pair_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  slot INTEGER NOT NULL CHECK (slot IN (1,2)),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  UNIQUE (pair_id,user_id),
  UNIQUE (pair_id,slot),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE UNIQUE INDEX uq_active_pair_per_user
  ON pair_members(user_id) WHERE left_at IS NULL;
CREATE INDEX idx_members_user_history
  ON pair_members(user_id,joined_at DESC,pair_id);

CREATE TABLE pair_invitations (
  invitation_id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(user_id),
  code_hash TEXT NOT NULL UNIQUE,
  link_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at INTEGER NOT NULL,
  accepted_by TEXT REFERENCES users(user_id),
  accepted_pair_id TEXT REFERENCES pairs(pair_id),
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (accepted_by IS NULL OR accepted_by <> inviter_id),
  CHECK (
    (status = 'accepted' AND accepted_by IS NOT NULL
      AND accepted_pair_id IS NOT NULL AND accepted_at IS NOT NULL)
    OR
    (status <> 'accepted' AND accepted_by IS NULL
      AND accepted_pair_id IS NULL AND accepted_at IS NULL)
  )
);
CREATE UNIQUE INDEX uq_pending_invitation
  ON pair_invitations(inviter_id) WHERE status = 'pending';
CREATE INDEX idx_invitation_expiry
  ON pair_invitations(status,expires_at);
~~~

forming là trạng thái nội bộ phục vụ tạo hai membership trước khi active. Không trả pair forming ra API. Tạo pair, hai members và chuyển active trong một batch; lỗi phải rollback toàn batch. Thêm trigger để chặn kích hoạt khi không đủ hai thành viên:

~~~sql
CREATE TRIGGER pair_insert_requires_forming
BEFORE INSERT ON pairs
WHEN NEW.status <> 'forming'
BEGIN
  SELECT RAISE(ABORT,'PAIR_MUST_START_FORMING');
END;

CREATE TRIGGER pair_activate_requires_two
BEFORE UPDATE OF status ON pairs
WHEN NEW.status = 'active' AND (
  OLD.status <> 'forming' OR
  (SELECT COUNT(*) FROM pair_members
    WHERE pair_id = NEW.pair_id AND left_at IS NULL) <> 2
)
BEGIN
  SELECT RAISE(ABORT,'PAIR_REQUIRES_TWO_MEMBERS');
END;

CREATE TRIGGER pair_no_reopen
BEFORE UPDATE OF status ON pairs
WHEN OLD.status = 'archived' AND NEW.status <> 'archived'
BEGIN
  SELECT RAISE(ABORT,'PAIR_CANNOT_REOPEN');
END;
~~~

Service chỉ archive trước khi đặt cả hai left_at trong cùng batch. Không có API tự thêm/xóa membership. Khi triển khai cần bổ sung kiểm tra hoặc trigger chống sửa trực tiếp membership làm cặp active thiếu thành viên.

### 4.2. Media và post

~~~sql
CREATE TABLE media_assets (
  media_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(user_id),
  pair_id TEXT REFERENCES pairs(pair_id),
  purpose TEXT NOT NULL CHECK (purpose IN ('post_image','avatar')),
  image_key TEXT NOT NULL UNIQUE,
  thumbnail_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes > 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','ready','failed','deleting','deleted')),
  created_at INTEGER NOT NULL,
  ready_at INTEGER,
  deleted_at INTEGER,
  CHECK (
    (purpose = 'post_image' AND pair_id IS NOT NULL)
    OR (purpose = 'avatar' AND pair_id IS NULL)
  )
);
CREATE INDEX idx_media_owner ON media_assets(owner_id,created_at DESC);
CREATE INDEX idx_media_cleanup ON media_assets(status,created_at);

CREATE TABLE posts (
  post_id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(pair_id),
  sender_id TEXT NOT NULL REFERENCES users(user_id),
  type TEXT NOT NULL CHECK (type IN ('photo','doodle','postcard')),
  image_media_id TEXT NOT NULL UNIQUE REFERENCES media_assets(media_id),
  caption TEXT CHECK (caption IS NULL OR length(caption) <= 500),
  canvas_data TEXT CHECK (canvas_data IS NULL OR json_valid(canvas_data)),
  reply_to_post_id TEXT REFERENCES posts(post_id) ON DELETE SET NULL,
  client_request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  widget_expires_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (sender_id,client_request_id),
  CHECK (widget_expires_at = created_at + 86400000),
  CHECK (reply_to_post_id IS NULL OR reply_to_post_id <> post_id)
);
CREATE INDEX idx_posts_timeline
  ON posts(pair_id,created_at DESC,post_id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_posts_widget
  ON posts(pair_id,sender_id,created_at DESC,post_id DESC)
  WHERE deleted_at IS NULL;
~~~

Giới hạn file đầu vào đề xuất 10 MiB và 20 MP; kiểm tra magic bytes, decode và format. Ảnh thành phẩm và thumbnail do mobile chuẩn bị hoặc pipeline xử lý ảnh phù hợp Workers tạo; backend không mặc định tin metadata client. Không bê Sharp/native Node vào Worker mà chưa kiểm tra tương thích.

Avatar mới có thể liên kết bằng bảng sau, tránh thay profile_pic đang được code hiện tại sử dụng:

~~~sql
CREATE TABLE user_avatar_media (
  user_id TEXT PRIMARY KEY REFERENCES users(user_id),
  media_id TEXT NOT NULL UNIQUE REFERENCES media_assets(media_id),
  updated_at INTEGER NOT NULL
);
~~~

Thống nhất nguồn avatar khi tích hợp: ưu tiên user_avatar_media, fallback profile_pic cũ. Không duy trì hai nguồn cập nhật độc lập lâu dài.

### 4.3. Tương tác và streak

~~~sql
CREATE TABLE reactions (
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  emoji TEXT NOT NULL CHECK (emoji IN ('❤️','🥰','😂','😍','😢','👍')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (post_id,user_id)
);

CREATE TABLE replies (
  reply_id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  sender_id TEXT NOT NULL REFERENCES users(user_id),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  client_request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (sender_id,client_request_id)
);
CREATE INDEX idx_replies_timeline
  ON replies(post_id,created_at,reply_id) WHERE deleted_at IS NULL;

CREATE TABLE post_receipts (
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  delivered_at INTEGER,
  seen_at INTEGER,
  PRIMARY KEY (post_id,user_id),
  CHECK (seen_at IS NULL OR
    (delivered_at IS NOT NULL AND seen_at >= delivered_at))
);

CREATE TABLE post_favorites (
  user_id TEXT NOT NULL REFERENCES users(user_id),
  post_id TEXT NOT NULL REFERENCES posts(post_id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id,post_id)
);

CREATE TABLE pair_activity_days (
  pair_id TEXT NOT NULL REFERENCES pairs(pair_id),
  activity_date TEXT NOT NULL,
  first_post_at INTEGER NOT NULL,
  last_post_at INTEGER NOT NULL,
  postcard_count INTEGER NOT NULL CHECK (postcard_count > 0),
  PRIMARY KEY (pair_id,activity_date),
  CHECK (last_post_at >= first_post_at)
);
~~~

Validate ngày bằng service; SQL TEXT không tự bảo đảm YYYY-MM-DD hợp lệ. Ghi ngày gửi postcard thành công theo timezone cặp cố định từ khi tạo, mặc định Asia/Ho_Chi_Minh; không dùng ngày client hoặc cắt ngày UTC. seen phải thiết lập delivered nếu chưa có; timestamp chỉ tăng. Favorite riêng từng người. Trim/validate body reply tại API. canvas_data giới hạn 256 KiB ở service.

### 4.4. Thiết bị, thông báo và outbox

~~~sql
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  installation_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios')),
  push_token TEXT UNIQUE,
  app_version TEXT,
  notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (notifications_enabled IN (0,1)),
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_devices_user ON devices(user_id,revoked_at);

CREATE TABLE outbox_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  aggregate_id TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  dedupe_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at INTEGER NOT NULL,
  locked_by TEXT,
  lease_expires_at INTEGER,
  processed_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_outbox_ready
  ON outbox_events(available_at,lease_expires_at)
  WHERE processed_at IS NULL;

CREATE TABLE notifications (
  notification_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  pair_id TEXT REFERENCES pairs(pair_id),
  actor_id TEXT REFERENCES users(user_id),
  type TEXT NOT NULL,
  post_id TEXT REFERENCES posts(post_id),
  source_event_id TEXT NOT NULL,
  read_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id,source_event_id)
);
CREATE INDEX idx_notifications_timeline
  ON notifications(user_id,created_at DESC,notification_id DESC);
~~~

source_event_id cố ý không FK vào outbox để có thể dọn job hoàn tất mà vẫn giữ notification. Payload chỉ chứa ID cần thiết, không chứa ảnh/base64, token hoặc nội dung riêng tư đã xóa. notification/post tham chiếu cần được dọn trước khi hard delete tài nguyên.

devices thay nhu cầu nhiều thiết bị của fcm_token trong users; giữ cột cũ để tương thích, chuyển nguồn push sang devices khi tích hợp. installation_id không phải credential; không cho user tự chiếm binding của người khác. Chuyển account cần gỡ binding cũ theo luồng đã xác thực.

## 5. Quyền và xử lý đồng thời trên D1

D1 batch() thực thi các statement theo thứ tự và rollback batch nếu statement lỗi. Không dùng transaction tương tác kiểu BEGIN/read/await/COMMIT hoặc SELECT FOR UPDATE của PostgreSQL.

Read trước rồi batch ghi chưa đủ để chặn race. Mọi điều kiện quan trọng phải được kiểm tra lại trong SQL/trigger của batch. UPDATE không ảnh hưởng dòng nào không tự làm batch thất bại: cần thiết kế guard có RAISE(ABORT) trong trigger, hoặc thao tác ghi sẽ vi phạm constraint để rollback. Không commit pair rồi mới phát hiện invitation không được claim.

### 5.1. Accept invitation

1. Hash/HMAC code hoặc link token ở Worker, tra invitation còn hạn và pending.
2. Chỉ lấy acceptor ID từ auth; cấm inviter = acceptor.
3. Trong batch: claim invitation có điều kiện pending/expiry, kiểm tra lifecycle hai user và active membership; tạo pair forming; tạo hai members; cập nhật accepted metadata; activate pair; revoke invitation pending khác; ghi outbox.
4. Guard/constraint failure rollback toàn bộ, map xung đột thành 409. Thiết kế trigger claim cụ thể khi triển khai.
5. Retry invitation đã accepted chỉ trả kết quả nếu accepted_by là user hiện tại; invitation ID không được dùng để accept pending.
6. Scheduled job đánh dấu invitation hết hạn; mỗi API vẫn tự kiểm tra expiry, không phụ thuộc job chạy đúng giờ.

### 5.2. Tạo post

Trong batch kiểm tra lại user/pair active, membership, media ready đúng owner/pair/purpose và reply-to đúng cặp còn tồn tại. Ghi post + receipt partner + outbox cùng batch; nếu type=postcard, upsert pair_activity_days trong cùng batch. Chỉ tính postcard tạo thành công; upload riêng, photo/doodle độc lập không tính. Một ngày nhiều postcard tăng postcard_count nhưng chỉ cộng một ngày streak.

UNIQUE sender/request ID chặn trùng; retry so request_hash, cùng payload trả bài cũ, khác payload trả 409. Retry bài đã xóa không khôi phục. Sau batch failure do trùng, đọc bài cũ và trả theo quy tắc; không tạo lại outbox hoặc tăng lại postcard_count/streak.

Disconnect và mutation phải kiểm tra điều kiện ở thời điểm ghi để chặn gửi/react/reply sau archive. Các FK đơn lẻ không chứng minh sender/media/reply cùng pair.

### 5.3. R2 và tác vụ nền

D1 và R2 không có transaction chung. Tạo media uploading với object keys do server đặt trước khi put R2; chỉ ready khi cả hai object sẵn sàng. Lỗi nửa chừng được reconciliation xử lý.

Ghi nghiệp vụ và outbox cùng D1 batch. Scheduled Worker có thể drain outbox MVP; Queues là tùy chọn mở rộng. Claim job bằng UPDATE có điều kiện lease và kiểm tra kết quả/RETURNING, không SELECT FOR UPDATE. Retry backoff, giới hạn attempts và khả năng xử lý job lỗi thủ công. Push có thể trùng; dedup bằng event ID.

## 6. Query widget và Memory Lane

~~~sql
SELECT p.*
FROM posts p
JOIN pairs pr ON pr.pair_id = p.pair_id AND pr.status = 'active'
JOIN pair_members me ON me.pair_id = p.pair_id
  AND me.user_id = ? AND me.left_at IS NULL
WHERE p.sender_id <> me.user_id
  AND p.deleted_at IS NULL
  AND p.widget_expires_at > ?
ORDER BY p.created_at DESC,p.post_id DESC
LIMIT 1;
~~~

Bind user ID từ auth và now từ server. Trả post hoặc null, serverTime và expiry/nextRefreshAt phù hợp. Không xóa post hết hạn widget.

Memory Lane đọc posts chưa xóa của pair mà user từng tham gia; cursor theo created_at/post_id, limit đề xuất 20, max 50. Favorite filter theo user hiện tại. Khoảng ngày theo timezone pair.

### 6.1. Streak cặp đôi: gửi postcard và cho phép bỏ một ngày

Streak chung cho pair: một trong hai thành viên mở app và gửi thành công ít nhất một postcard trong ngày thì ngày đó được tính. Cả hai gửi hoặc nhiều postcard cùng ngày chỉ cộng một ngày. Chỉ mở app, upload chưa tạo bài, gửi thất bại, reaction, lời nhắn, push và widget refresh không tăng streak.

Nguồn là pair_activity_days. Batch tạo post type=postcard upsert ngày theo timezone pair: ngày mới có postcard_count=1; ngày hiện có tăng count và cập nhật last_post_at. Retry cùng client_request_id không tăng count hay tạo ngày mới. first_post_at/last_post_at chỉ phản ánh postcard đủ điều kiện. Postcard trả lời bằng ảnh cũng tính nếu type=postcard. Photo/doodle độc lập không tính; ảnh/doodle ghép thành postcard rồi gửi được tính.

GET /v1/pairs/:pairId/streak trả current, longest, todayActive, lastActivityDate và timezone cho thành viên có quyền. Chỉ đọc, không ghi ngày hoạt động. Không cần API ghi nhận mở app riêng cho streak.

Tính khoảng cách giữa hai ngày lịch YYYY-MM-DD theo timezone pair, không chia chênh lệch timestamp cho 24 giờ:

| Khoảng cách ngày gửi hợp lệ mới so với ngày hợp lệ gần nhất | Kết quả |
| --- | --- |
| 0 ngày | Giữ nguyên streak, dù cả hai cùng gửi |
| 1 ngày | Nối chuỗi, tăng 1 |
| 2 ngày | Cho phép bỏ một ngày, nối chuỗi, tăng 1 |
| Từ 3 ngày | Bỏ ít nhất hai ngày liên tiếp; bắt đầu chuỗi mới = 1 |

Ví dụ: thứ Hai streak 5, thứ Ba không ai gửi postcard, thứ Tư một người gửi = 6. Nếu cả thứ Ba và thứ Tư không ai gửi thì thứ Năm gửi = 1. Ngày nghỉ không được cộng. MVP không giới hạn số lần nghỉ một ngày trong chuỗi nếu khoảng cách giữa các ngày hợp lệ không quá 2 ngày.

current khi đọc: pair active có ngày hợp lệ gần nhất cách hôm nay không quá 2 ngày thì giữ số ngày của chuỗi gần nhất; từ 3 ngày trở lên trả 0. Lần gửi hợp lệ sau khi chuỗi ngắt trả 1. Pair chưa có ngày hợp lệ trả current=0, longest=0. longest là số ngày hợp lệ thực tế lớn nhất trong chuỗi cho phép khoảng cách tối đa 2 ngày; không giảm khi current reset. todayActive cho biết cặp đã có postcard gửi thành công trong ngày hiện tại.

Disconnect: pair archived trả current=0, longest giữ để xem lịch sử. Ghép lại hoặc đổi partner tạo pair mới, streak bắt đầu từ 0. Xóa bài không giảm streak đã đạt; xóa tài khoản theo chính sách dọn ngày hoạt động ở mục 8.

Kiểm thử: chỉ mở app không tăng; một người gửi +1; hai người gửi cùng ngày chỉ +1; photo/doodle không tính nếu không gửi dưới dạng postcard; postcard reply được tính; retry và gửi đồng thời không tính ngày trùng; ranh giới nửa đêm, khoảng cách 0/1/2/3 ngày, archive đồng thời gửi. Ngày được tính là ngày server tạo postcard thành công; bản nháp/offline chưa gửi không tính.

## 7. API cần triển khai

Giữ prefix /v1 của repo. Các endpoint dưới đây là đề xuất đường dẫn mới; thống nhất trước khi mobile tích hợp.

| Module | Endpoint |
| --- | --- |
| Invitation | POST /v1/pair-invitations; POST /preview; POST /accept; DELETE /:invitationId dưới cùng prefix |
| Pair | GET /v1/pairs/current; GET /v1/pairs; GET/PATCH /v1/pairs/:pairId; POST /v1/pairs/:pairId/disconnect |
| Media | POST /v1/media/images; GET/DELETE /v1/media/:mediaId; GET /v1/media/:mediaId/content?variant=original hoặc thumbnail |
| Post | POST/GET /v1/pairs/:pairId/posts; GET/DELETE /v1/posts/:postId |
| Export | GET /v1/posts/:postId/export?format=png hoặc jpeg |
| Reaction | PUT/DELETE /v1/posts/:postId/reaction |
| Reply | POST/GET /v1/posts/:postId/replies; DELETE /v1/replies/:replyId |
| Receipt | PUT /v1/posts/:postId/receipt |
| Widget | GET /v1/widgets/current |
| Memories | GET /v1/pairs/:pairId/memories; PUT/DELETE /v1/posts/:postId/favorite |
| Streak | GET /v1/pairs/:pairId/streak: current, longest, todayActive, lastActivityDate, timezone |
| Device | POST /v1/devices; PATCH/DELETE /v1/devices/:deviceId |
| Notification | GET /v1/notifications; PATCH /v1/notifications/:notificationId; POST /v1/notifications/read-all |
| Account | Giữ GET/PUT /v1/user-service/me; bổ sung xác nhận xóa và DELETE me |
| Health | GET /health/live; GET /health/ready |

Media content trả bytes qua Worker sau kiểm tra quyền. Native widget không gọi R2 public: dùng luồng tải được xác thực của app và cache riêng; xác định credential refresh nếu native tự tải nền. Nếu dùng token URL ngắn hạn cho widget, cần thiết kế scope/expiry riêng, không đưa access token vào URL.

## 8. Quy tắc xóa và giữ dữ liệu

- Xóa bài: owner soft delete; chặn tải mới; dọn reaction/reply/receipt/favorite/notification; post trả lời độc lập giữ và gỡ reply_to; job xóa hai object R2. Giữ tombstone request ID để không tái tạo khi retry.
- Disconnect: archive pair và đặt left_at cả hai trong batch; revoke invitation liên quan; widget null; giữ quyền đọc kỷ niệm/xóa bài của mình; không gửi/react/reply mới.
- Xóa account: xác minh danh tính qua auth hiện có; set lifecycle deleting và archive pair; worker dọn dữ liệu của user, giữ bài partner. Check lifecycle ở API và realtime; chỉ thu hồi push không đủ vô hiệu hóa JWT.
- users hiện có email/password NOT NULL: không set NULL theo schema tài liệu PostgreSQL. Đề xuất tombstone email duy nhất dưới domain .invalid, password thành giá trị không dùng được, is_active=0, xóa PII/avatar. Không hard delete user khi còn FK lịch sử.
- Dọn otp_codes và scans/media cũ của user trong job; tránh để R2 legacy còn ảnh riêng tư. Chốt retention/deletion ledger để restore không phục hồi dữ liệu đã yêu cầu xóa.
- Khi xóa tài khoản, dọn pair_activity_days của các cặp user tham gia theo chính sách xóa lịch tương tác, streak cặp đó trả 0. Disconnect giữ longest lịch sử và current=0; pair mới bắt đầu streak riêng từ 0.
- Ảnh đã tải/share ra thiết bị khác không thu hồi được; app dọn cache khi đồng bộ.

## 9. Checklist triển khai theo thứ tự

### P0 — D1 và nền tảng quyền
- [ ] Chốt giá trị TTL/giới hạn/ngày streak và contract API.
- [ ] Chuyển SQL đề xuất thành migration 0003; rà constraints, triggers, guard concurrency.
- [ ] Chạy migration local, kiểm tra FK và rollback batch; chỉ áp dụng staging sau kiểm thử.
- [ ] Thêm helper D1 batch và service nghiệp vụ; giữ auth hiện có.
- [ ] Thêm kiểm tra lifecycle, quyền owner/membership active/lịch sử.
- [ ] Xây guard SQL/trigger cho accept/send/disconnect; không tin pre-read.
- [ ] Thống nhất timestamp, cursor, validation, error code và rate limit.
- [ ] Lập dữ liệu test hai user/cặp, tránh dùng dữ liệu production.

### P1 — Ghép đôi và không gian chung
- [ ] Sinh code ngẫu nhiên và link token; hash/HMAC, TTL trong D1.
- [ ] Tạo/preview/accept/revoke, invitation retry và hết hạn.
- [ ] Pair current/history/detail/anniversary.
- [ ] Mobile copy/share/QR/deep link/scanner, giữ pending context qua auth.
- [ ] Test hai accept đồng thời, tự ghép, đang có partner, mã cũ và retry timeout.

### P2 — Media R2 và editor
- [ ] Upload media, kiểm tra magic bytes/decode/bytes/pixels.
- [ ] Chọn pipeline ảnh/thumbnail phù hợp Workers, validate ảnh mobile tạo.
- [ ] Object keys do server tạo; metadata và reconciliation.
- [ ] Content endpoint có quyền; chặn bypass qua /files/* cho key Share Widget.
- [ ] Avatar media và chuyển đổi profile response phù hợp code cũ.
- [ ] Mobile doodle, undo/redo, camera/gallery/sticker, preview và ảnh thành phẩm.
- [ ] Cleanup ready chưa attached sau thời gian đề xuất 24 giờ; kiểm tra reference trước xóa.

### P3 — Bài gửi và tương tác
- [ ] Post create/list/detail/delete; idempotency cùng/khác payload.
- [ ] Receipt delivered/seen; reaction/reply và trả lời bằng postcard.
- [ ] Trạng thái awaitingReply/replied.
- [ ] Post/receipt/outbox và ngày hoạt động postcard ghi atomic; retry không tăng lại postcard_count/streak.
- [ ] Test media sai owner/pair, reply chéo pair và gửi đồng thời disconnect.

### P4 — Worker nền, push và widget
- [ ] Scheduled handler drain outbox, lease/retry/dedup; tùy chọn Queues.
- [ ] Device API và push FCM/APNs qua cách tương thích Workers.
- [ ] Notification list/read/read-all; push payload tối thiểu.
- [ ] Realtime nếu cần: Durable Objects + WebSocket, auth và room membership.
- [ ] Widget current API, native Android/iOS, cache/timeline expiry/deep link.
- [ ] Test hai máy thật, offline, app đóng, bài xóa, logout/đổi account.
- [ ] Reconnect fetch lại API; không dựa vào event luôn được nhận.

### P5 — Kỷ niệm, streak, lưu/share
- [ ] Memory Lane/filter/cursor/favorite.
- [x] Chốt nghiệp vụ: streak chung cho cặp; một trong hai người gửi thành công ít nhất một postcard/ngày thì +1; cho phép bỏ một ngày. Chưa triển khai code.
- [ ] Upsert pair_activity_days trong batch tạo postcard; không cần API mở app riêng.
- [ ] Cả hai gửi hoặc nhiều postcard cùng ngày chỉ tính một ngày; retry không tăng lại count.
- [ ] Current/longest theo ngày gửi hợp lệ với khoảng cách tối đa 2 ngày, timezone cặp cố định.
- [ ] Test chỉ mở app không tăng, photo/doodle độc lập không tính, postcard reply được tính.
- [ ] Test khoảng cách 0/1/2/3 ngày, gửi đồng thời, nửa đêm, disconnect và pair mới.
- [ ] Ngày server tạo bài thành công là ngày được tính; upload/bản nháp/offline chưa gửi không tính.
- [ ] Export PNG/JPEG: quyết định lưu thêm bản export R2 hoặc pipeline chuyển đổi tương thích.
- [ ] Save Gallery/Photos và share file native; xử lý quyền/dung lượng/hủy share.
- [ ] Export không tạo post/streak/notification.

### P6 — Disconnect, xóa và vận hành
- [ ] Archive pair, giữ lịch sử, cặp mới không thấy dữ liệu cặp cũ.
- [ ] Xác nhận xóa account, lifecycle và job dọn R2/D1; giữ bài partner.
- [ ] Dọn legacy scans/avatar/OTP theo chính sách.
- [ ] Tích hợp thu hồi quyền API/socket/push với auth hiện có, không xây lại auth.
- [ ] Swagger cho API mới và sửa quy trình sinh tài liệu trên Windows khi được yêu cầu.
- [ ] Health check, logging scrub, CI/CD, kiểm thử migration staging.
- [ ] Monitoring backlog job, cleanup lỗi, backup/restore và nghiệm thu hai thiết bị.

## 10. Tiêu chí hoàn thành

Hai tài khoản thật ghép qua code/link/QR; gửi ảnh từ một máy và nhận ở máy còn lại; widget hiển thị đúng bài partner và tự hết hạn; bài vẫn có trong memories; reaction/reply/receipt/streak đúng; save/share hoạt động; user ngoài cặp không đọc ảnh; disconnect và xóa tài khoản không làm mất bài partner; retry/race không tạo dữ liệu trùng.

PDF cung cấp roadmap UI mock, không dùng tỷ trọng hoặc mốc ngày trong đó để khẳng định app thật đã hoàn thành. Mobile hiện chưa được audit trong repo backend này.

## 11. Tham khảo

Nguồn nghiệp vụ: share_widget_thiet_ke_database_backend_api (1).md và shared_widget (2).pdf do người dùng cung cấp. Công nghệ do người dùng chọn: Cloudflare hiện tại.

- [D1 Database API: prepared statements và batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)

SQL được kiểm tra cấu trúc bằng SQLite khi soạn; cần nghiệm thu bằng Wrangler D1 local và staging khi chuyển thành migration thực tế.
