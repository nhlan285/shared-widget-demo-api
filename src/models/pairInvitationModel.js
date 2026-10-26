const { get, run } = require("../config/database");
const { db } = require("../config/cloudflare");
const pairModel = require("./pairModel");

const {
  generateInvitation,
  hashInvitationCode,
  hashInvitationLink,
} = require("../utils/invitationUtils");

const invitationError = (message, statusCode) => {
  return Object.assign(new Error(message), { statusCode });
}; // Kết thúc hàm tại đây.

const ELIGIBLE_USER = `
  SELECT u.user_id
  FROM users u
  WHERE u.user_id = ?
    AND u.is_active = 1
    AND NOT EXISTS (
      SELECT 1 FROM pair_members pm
      WHERE pm.user_id = u.user_id
        AND pm.left_at IS NULL
    )
`;
    const createInvitation = async (userId) => {
        const user = await get(
            "SELECT is_active FROM users WHERE user_id = ?",
            [userId]
        );
        if (!user || !user.is_active) {
            throw invitationError("An active account is required", 403);
        }
        const membership = await get(
            `
            SELECT membership_id FROM pair_members
            WHERE user_id = ? AND left_at IS NULL
            `,
            [userId]
        );
        if (membership) {
            throw invitationError("You already have a pair", 409);

        }
        const database = db();
        for (let attempt = 0; attempt < 5; attempt++) {
            const invitationId = crypto.randomUUID();
            const generated = generateInvitation();
            const now = Date.now();
            const expiresAt = now + 24 * 60 * 60 * 1000;

            try {

                const results = await database.batch([
                    // thu hồi lời mời pending cũ
                    database.prepare(`
                        UPDATE pair_invitations 
                        SET status = 'revoked'
                        WHERE inviter_id = ? 
                            AND status = 'pending'
                            AND inviter_id IN (${ELIGIBLE_USER})
                        `).bind(userId, userId),

                    // chỉ insert nếu user vẫn đủ điều kiện
                    database.prepare(`

                            INSERT INTO pair_invitations(
                            invitation_id, 
                            inviter_id, 
                            code_hash,
                            link_token_hash,
                            status,
                            expires_at,
                            created_at
                            
                            )
                            SELECT ?, user_id, ?, ?, 'pending', ?,? 
                            FROM (${ELIGIBLE_USER}) AS eligible

                            `).bind(
                        invitationId,
                        generated.codeHash,
                        generated.linkTokenHash,
                        expiresAt,
                        now,
                        userId
                    ),
                ]);
                if (!results[1].meta.changes) {
                    throw invitationError('Your accoun or pair status has changed',
                        409);
                }
                return {
                    invitationId,
                    code: generated.code,
                    inviteUrl: generated.inviteUrl,
                    qrContent: generated.inviteUrl,
                    expiresAt: new Date(expiresAt).toISOString(),
                };
            } catch (error) {
                const collision =
                    /UNIQUE constraint failed: pair_invitations\.(code_hash|link_token_hash)/i
                        .test(error.message);

                if (!collision) throw error;

                // Trùng code/token: batch rollback, sinh lại.
            }
        }
        throw invitationError(
            "Could not generate an invitation. Please retry",
            503
        );
    };
    // input đã được controller validate.
// Cột SQL được chọn từ hai chuỗi cố định, không lấy từ client.
const findInvitation = async (input) => {
  const usingCode = input.code !== undefined;

  const condition = usingCode
    ? "i.code_hash = ?"
    : "i.link_token_hash = ?";

  const hash = usingCode
    ? hashInvitationCode(input.code)
    : hashInvitationLink(input.linkToken);

  return get(
    `
      SELECT
        i.*,
        u.display_name AS inviter_name,
        u.is_active AS inviter_active
      FROM pair_invitations i
      JOIN users u ON u.user_id = i.inviter_id
      WHERE ${condition}
    `,
    [hash]
  );
};

const requireActiveUser = async (userId) => {
  const user = await get(
    "SELECT is_active FROM users WHERE user_id = ?",
    [userId]
  );

  if (!user || !user.is_active) {
    throw invitationError("An active account is required", 403);
  }
};

// Kiểm tra trạng thái lời mời, chưa tạo dữ liệu.
const requirePendingInvitation = (invitation, userId) => {
  if (!invitation) {
    throw invitationError("Invitation not found", 404);
  }

  if (invitation.inviter_id === userId) {
    throw invitationError(
      "Cannot accept your own invitation",
      400
    );
  }

  if (
    invitation.status === "expired"
    || (
      invitation.status === "pending"
      && invitation.expires_at <= Date.now()
    )
  ) {
    throw invitationError("Invitation has expired", 410);
  }

  if (invitation.status !== "pending") {
    throw invitationError(
      "Invitation is no longer available",
      409
    );
  }

  if (!invitation.inviter_active) {
    throw invitationError(
      "The inviter is no longer available",
      409
    );
  }
};

const requireUnpairedUsers = async (inviterId, acceptorId) => {
  const membership = await get(
    `
      SELECT membership_id
      FROM pair_members
      WHERE user_id IN (?, ?)
        AND left_at IS NULL
      LIMIT 1
    `,
    [inviterId, acceptorId]
  );

  if (membership) {
    throw invitationError(
      "One of the users already has a pair",
      409
    );
  }
};

const previewInvitation = async (input, userId) => {
  await requireActiveUser(userId);

  const invitation = await findInvitation(input);

  requirePendingInvitation(invitation, userId);

  await requireUnpairedUsers(
    invitation.inviter_id,
    userId
  );

  return {
    invitationId: invitation.invitation_id,
    inviter: {
      userId: invitation.inviter_id,
      displayName: invitation.inviter_name,
    },
    expiresAt: new Date(
      invitation.expires_at
    ).toISOString(),
  };
};

// Chuẩn hóa response accept để lần đầu và retry cùng cấu trúc.
const acceptedPairData = (pair) => ({
  pairId: pair.pairId,
  status: "active",
  timezone: pair.timezone,
  anniversaryDate: pair.anniversaryDate,
  createdAt: pair.createdAt,
});

const getAcceptedResult = async (invitation, userId) => {
  if (
    !invitation
    || invitation.status !== "accepted"
    || invitation.accepted_by !== userId
  ) {
    return null;
  }

  const pair = await pairModel.getCurrentPair(userId);

  if (
    !pair
    || pair.pairId !== invitation.accepted_pair_id
  ) {
    throw invitationError("This connection has ended", 409);
  }

  return {
    created: false,
    pair: acceptedPairData(pair),
  };
};

const acceptInvitation = async (input, userId) => {
  await requireActiveUser(userId);

  const invitation = await findInvitation(input);

  // Kiểm tra retry trước khi kiểm tra user chưa có pair.
  // Người vừa accept thành công đương nhiên đã có pair.
  const previousResult = await getAcceptedResult(
    invitation,
    userId
  );

  if (previousResult) return previousResult;

  requirePendingInvitation(invitation, userId);

  await requireUnpairedUsers(
    invitation.inviter_id,
    userId
  );

  try {
    // Hàm hiện có tạo pair + memberships + accepted
    // trong cùng D1 batch.
    const result = await pairModel.createPairFromInvitation(
      invitation.invitation_id,
      userId
    );

    return {
      created: result.created,
      pair: acceptedPairData(result.pair),
    };
  } catch (error) {
    // Có thể request khác đã accept/revoke trong lúc này.
    // Đọc lại để phân biệt retry, xung đột và lỗi hệ thống.
    const latest = await findInvitation(input);

    const retryResult = await getAcceptedResult(
      latest,
      userId
    );

    if (retryResult) return retryResult;

    await requireActiveUser(userId);
    requirePendingInvitation(latest, userId);

    await requireUnpairedUsers(
      latest.inviter_id,
      userId
    );

    // Không nhận diện được lỗi nghiệp vụ:
    // truyền lỗi lên controller để trả 500.
    throw error;
  }
};

const revokeInvitation = async (invitationId, userId) => {
  await requireActiveUser(userId);

  // Query kèm owner để không lộ lời mời của người khác.
  const invitation = await get(
    `
      SELECT status, expires_at
      FROM pair_invitations
      WHERE invitation_id = ?
        AND inviter_id = ?
    `,
    [invitationId, userId]
  );

  if (!invitation) {
    throw invitationError("Invitation not found", 404);
  }

  // Retry hủy lời mời đã hủy được coi là thành công.
  if (invitation.status === "revoked") return;

  const result = await run(
    `
      UPDATE pair_invitations
      SET status = 'revoked'
      WHERE invitation_id = ?
        AND inviter_id = ?
        AND status = 'pending'
        AND expires_at > ?
    `,
    [invitationId, userId, Date.now()]
  );

  if (result.meta.changes) return;

  // Kiểm tra lại khi accept/hết hạn xảy ra đồng thời.
  const latest = await get(
    `
      SELECT status, expires_at
      FROM pair_invitations
      WHERE invitation_id = ?
        AND inviter_id = ?
    `,
    [invitationId, userId]
  );

  if (!latest) {
    throw invitationError("Invitation not found", 404);
  }

  if (latest.status === "revoked") return;

  if (
    latest.status === "expired"
    || (
      latest.status === "pending"
      && latest.expires_at <= Date.now()
    )
  ) {
    throw invitationError("Invitation has expired", 410);
  }

  throw invitationError(
    "Invitation is no longer pending",
    409
  );
};


   module.exports = {
  createInvitation,
  previewInvitation,
  acceptInvitation,
  revokeInvitation,
};