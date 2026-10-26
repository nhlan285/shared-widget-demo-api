const { get, run } = require("../config/database");
const { db } = require("../config/cloudflare");

const getCurrentPair = async (userId) => {
  const row = await get(
    `
      SELECT
        p.pair_id,
        p.timezone,
        p.anniversary_date,
        p.created_at,
        (
          SELECT json_group_array(
            json_object(
              'userId', pm.user_id,
              'displayName', u.display_name,
              'slot', pm.slot
            )
          )
          FROM pair_members pm
          JOIN users u ON u.user_id = pm.user_id
          WHERE pm.pair_id = p.pair_id
            AND pm.left_at IS NULL
        ) AS members_json
      FROM pairs p
      JOIN pair_members me ON me.pair_id = p.pair_id
      WHERE me.user_id = ?
        AND me.left_at IS NULL
        AND p.status = 'active'
      LIMIT 1
    `,
    [userId]
  );

  if (!row) return null;

  return {
    pairId: row.pair_id,
    timezone: row.timezone,
    anniversaryDate: row.anniversary_date,
    createdAt: new Date(row.created_at).toISOString(),
    members: JSON.parse(row.members_json).sort(
      (a, b) => a.slot - b.slot
    ),
  };
};

const updateAnniversary = async (
  pairId,
  userId,
  anniversaryDate
) => {
  const result = await run(
    `
      UPDATE pairs
      SET anniversary_date = ?, updated_at = ?
      WHERE pair_id = ?
        AND status = 'active'
        AND EXISTS (
          SELECT 1 FROM pair_members me
          WHERE me.pair_id = pairs.pair_id
            AND me.user_id = ?
            AND me.left_at IS NULL
        )
    `,
    [anniversaryDate, Date.now(), pairId, userId]
  );

  return result.meta.changes > 0;
};
const createPairFromInvitation = async (
  invitationId,
  acceptorId
) => {
  const invitation = await get(
    `
      SELECT *
      FROM pair_invitations
      WHERE invitation_id = ?
    `,
    [invitationId]
  );

  if (!invitation) {
    const error = new Error("Invitation not found");
    error.statusCode = 404;
    throw error;
  }

  // Retry sau khi accept thành công nhưng FE mất response.
  if (
    invitation.status === "accepted"
    && invitation.accepted_by === acceptorId
  ) {
    const currentPair = await getCurrentPair(acceptorId);

    if (
      currentPair
      && currentPair.pairId === invitation.accepted_pair_id
    ) {
      return { pair: currentPair, created: false };
    }

    const error = new Error("This connection has ended");
    error.statusCode = 409;
    throw error;
  }

  const now = Date.now();

  if (
    invitation.status !== "pending"
    || invitation.expires_at <= now
  ) {
    const error = new Error("Invitation is unavailable");
    error.statusCode = 409;
    throw error;
  }

  if (invitation.inviter_id === acceptorId) {
    const error = new Error("Cannot accept your own invitation");
    error.statusCode = 400;
    throw error;
  }

  const pairId = crypto.randomUUID();
  const inviterMembershipId = crypto.randomUUID();
  const acceptorMembershipId = crypto.randomUUID();

  const database = db();

  await database.batch([
    // Kiểm tra lại invitation và hai user ngay lúc ghi.
    // Nếu không đủ điều kiện, không tạo dòng pairs.
    database.prepare(`
      INSERT INTO pairs (
        pair_id,
        created_by,
        status,
        created_at,
        updated_at
      )
      SELECT ?, i.inviter_id, 'forming', ?, ?
      FROM pair_invitations i
      JOIN users inviter ON inviter.user_id = i.inviter_id
      JOIN users acceptor ON acceptor.user_id = ?
      WHERE i.invitation_id = ?
        AND i.status = 'pending'
        AND i.expires_at > ?
        AND i.inviter_id <> acceptor.user_id
        AND inviter.is_active = 1
        AND acceptor.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM pair_members
          WHERE user_id IN (i.inviter_id, acceptor.user_id)
            AND left_at IS NULL
        )
    `).bind(
      pairId,
      now,
      now,
      acceptorId,
      invitationId,
      now
    ),

    // Nếu INSERT pairs phía trên không tạo dòng,
    // FK tại đây sẽ gây lỗi và rollback cả batch.
    database.prepare(`
      INSERT INTO pair_members (
        membership_id,
        pair_id,
        user_id,
        slot,
        joined_at
      )
      VALUES (?, ?, ?, 1, ?)
    `).bind(
      inviterMembershipId,
      pairId,
      invitation.inviter_id,
      now
    ),

    database.prepare(`
      INSERT INTO pair_members (
        membership_id,
        pair_id,
        user_id,
        slot,
        joined_at
      )
      VALUES (?, ?, ?, 2, ?)
    `).bind(
      acceptorMembershipId,
      pairId,
      acceptorId,
      now
    ),

    // Trigger kiểm tra cặp có đủ hai thành viên.
    database.prepare(`
      UPDATE pairs
      SET status = 'active'
      WHERE pair_id = ?
    `).bind(pairId),

    database.prepare(`
      UPDATE pair_invitations
      SET status = 'accepted',
          accepted_by = ?,
          accepted_pair_id = ?,
          accepted_at = ?
      WHERE invitation_id = ?
        AND status = 'pending'
    `).bind(
      acceptorId,
      pairId,
      now,
      invitationId
    ),

    // Hai người đã kết nối: hủy các lời mời pending khác.
    database.prepare(`
      UPDATE pair_invitations
      SET status = 'revoked'
      WHERE status = 'pending'
        AND inviter_id IN (?, ?)
    `).bind(invitation.inviter_id, acceptorId),
  ]);

  return {
    pair: {
      pairId,
      status: "active",
      timezone: "Asia/Ho_Chi_Minh",
      anniversaryDate: null,
      createdAt: new Date(now).toISOString(),
    },
    created: true,
  };
};

const disconnectPair = async (pairId, userId) => {
  const database = db();
  const now = Date.now();

  const results = await database.batch([
    database.prepare(`
      UPDATE pairs
      SET status = 'archived',
          archived_at = ?,
          updated_at = ?
      WHERE pair_id = ?
        AND status = 'active'
        AND EXISTS (
          SELECT 1 FROM pair_members me
          WHERE me.pair_id = pairs.pair_id
            AND me.user_id = ?
            AND me.left_at IS NULL
        )
    `).bind(now, now, pairId, userId),

    // Thu hồi lời mời pending của hai người,
    // chỉ khi đúng cặp vừa được disconnect.
    database.prepare(`
      UPDATE pair_invitations
      SET status = 'revoked'
      WHERE status = 'pending'
        AND created_at <= ?
        AND inviter_id IN (
          SELECT user_id FROM pair_members
          WHERE pair_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM pairs p
          JOIN pair_members me ON me.pair_id = p.pair_id
          WHERE p.pair_id = ?
            AND p.status = 'archived'
            AND p.archived_at = ?
            AND me.user_id = ?
        )
    `).bind(now, pairId, pairId, now, userId),
  ]);

  // Trigger pair_archive_members tự đặt left_at
  // cho cả hai membership.
  return results[0].meta.changes > 0;
};

module.exports = {
  getCurrentPair,
  updateAnniversary,

  disconnectPair,
    createPairFromInvitation,
};