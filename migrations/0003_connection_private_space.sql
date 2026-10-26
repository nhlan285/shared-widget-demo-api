-- Timestamp mới dùng Unix milliseconds: Date.now().
-- UUID được tạo ở backend bằng crypto.randomUUID().
-- Giữ nguyên bảng users và auth hiện tại.

-- 1. Không gian riêng của cặp đôi
CREATE TABLE pairs (
  pair_id TEXT NOT NULL PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(user_id),

  -- forming chỉ dùng trong lúc backend tạo cặp.
  status TEXT NOT NULL DEFAULT 'forming'
    CHECK (status IN ('forming', 'active', 'archived')),

  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  anniversary_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,

  CHECK (updated_at >= created_at),
  CHECK (
    (status = 'archived'
      AND archived_at IS NOT NULL
      AND archived_at >= created_at)
    OR
    (status <> 'archived' AND archived_at IS NULL)
  )
);

-- 2. Thành viên của không gian riêng
CREATE TABLE pair_members (
  membership_id TEXT NOT NULL PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(pair_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),

  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,

  UNIQUE (pair_id, user_id),
  UNIQUE (pair_id, slot),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- Một user chỉ có tối đa một membership chưa kết thúc.
CREATE UNIQUE INDEX uq_active_pair_per_user
  ON pair_members(user_id)
  WHERE left_at IS NULL;

CREATE INDEX idx_members_user_history
  ON pair_members(user_id, joined_at DESC, pair_id);

-- 3. Lời mời dùng chung cho code, link và QR
CREATE TABLE pair_invitations (
  invitation_id TEXT NOT NULL PRIMARY KEY,
  inviter_id TEXT NOT NULL REFERENCES users(user_id),

  -- Không lưu code hoặc link token dạng plaintext.
  code_hash TEXT NOT NULL UNIQUE,
  link_token_hash TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),

  expires_at INTEGER NOT NULL,
  accepted_by TEXT REFERENCES users(user_id),
  accepted_pair_id TEXT REFERENCES pairs(pair_id),
  accepted_at INTEGER,
  created_at INTEGER NOT NULL,

  CHECK (expires_at > created_at),
  CHECK (accepted_by IS NULL OR accepted_by <> inviter_id),
  CHECK (
    (status = 'accepted'
      AND accepted_by IS NOT NULL
      AND accepted_pair_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND accepted_at >= created_at
      AND accepted_at < expires_at)
    OR
    (status <> 'accepted'
      AND accepted_by IS NULL
      AND accepted_pair_id IS NULL
      AND accepted_at IS NULL)
  )
);

-- Một người chỉ có một lời mời pending.
CREATE UNIQUE INDEX uq_pending_invitation
  ON pair_invitations(inviter_id)
  WHERE status = 'pending';

CREATE INDEX idx_invitation_expiry
  ON pair_invitations(status, expires_at);

-- Không cho tạo ngay một cặp active chưa có thành viên.
CREATE TRIGGER pair_insert_requires_forming
BEFORE INSERT ON pairs
WHEN NEW.status <> 'forming'
BEGIN
  SELECT RAISE(ABORT, 'PAIR_MUST_START_FORMING');
END;

-- Chỉ kích hoạt khi có đúng hai thành viên,
-- và người tạo cặp là một trong hai người.
CREATE TRIGGER pair_activate_requires_two
BEFORE UPDATE OF status ON pairs
WHEN NEW.status = 'active' AND OLD.status <> 'active'
BEGIN
  SELECT CASE WHEN
    OLD.status <> 'forming'
    OR (
      SELECT COUNT(*) FROM pair_members
      WHERE pair_id = NEW.pair_id AND left_at IS NULL
    ) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM pair_members
      WHERE pair_id = NEW.pair_id
        AND user_id = NEW.created_by
        AND left_at IS NULL
    )
  THEN RAISE(ABORT, 'PAIR_REQUIRES_TWO_MEMBERS') END;
END;

-- Cặp đã kết thúc không mở lại.
CREATE TRIGGER pair_status_cannot_go_back
BEFORE UPDATE OF status ON pairs
WHEN
  (OLD.status = 'archived' AND NEW.status <> 'archived')
  OR (OLD.status = 'active' AND NEW.status = 'forming')
BEGIN
  SELECT RAISE(ABORT, 'PAIR_CANNOT_REOPEN');
END;

-- Chỉ thêm thành viên trong bước tạo cặp.
CREATE TRIGGER member_insert_requires_forming
BEFORE INSERT ON pair_members
WHEN NEW.left_at IS NOT NULL OR NOT EXISTS (
  SELECT 1 FROM pairs
  WHERE pair_id = NEW.pair_id AND status = 'forming'
)
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_REQUIRES_FORMING_PAIR');
END;

-- Membership giữ nguyên danh tính và lịch sử tham gia.
CREATE TRIGGER member_identity_immutable
BEFORE UPDATE OF
  membership_id, pair_id, user_id, slot, joined_at
ON pair_members
WHEN
  NEW.membership_id <> OLD.membership_id
  OR NEW.pair_id <> OLD.pair_id
  OR NEW.user_id <> OLD.user_id
  OR NEW.slot <> OLD.slot
  OR NEW.joined_at <> OLD.joined_at
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_IDENTITY_IMMUTABLE');
END;

-- Muốn rời cặp phải archive trước; không tái sử dụng membership cũ.
CREATE TRIGGER member_leave_requires_archive
BEFORE UPDATE OF left_at ON pair_members
WHEN NEW.left_at IS NOT OLD.left_at AND (
  NEW.left_at IS NULL
  OR OLD.left_at IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM pairs
    WHERE pair_id = OLD.pair_id AND status = 'archived'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_LEAVE_REQUIRES_ARCHIVE');
END;

CREATE TRIGGER member_delete_requires_archive
BEFORE DELETE ON pair_members
WHEN EXISTS (
  SELECT 1 FROM pairs
  WHERE pair_id = OLD.pair_id AND status <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_DELETE_REQUIRES_ARCHIVE');
END;

-- Archive cặp tự kết thúc membership của cả hai.
CREATE TRIGGER pair_archive_members
AFTER UPDATE OF status ON pairs
WHEN OLD.status <> 'archived' AND NEW.status = 'archived'
BEGIN
  UPDATE pair_members
  SET left_at = NEW.archived_at
  WHERE pair_id = NEW.pair_id AND left_at IS NULL;
END;