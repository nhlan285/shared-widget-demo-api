const {
  randomInt,
  randomBytes,
  createHmac,
} = require("node:crypto");

const { binding } = require("../config/cloudflare");
const { CODE_ALPHABET } = require("./constant");

const generateCode = () => {
  let code = "";

  for (let i = 0; i < 8; i++) {
    // Truy cập ký tự bằng [], không gọi chuỗi như hàm.
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }

  return code;
};

const hashInvitationCode = (code) => {
  return createHmac(
    "sha256",
    binding("INVITATION_HMAC_SECRET")
  )
    .update(code.trim().toUpperCase())
    .digest("hex");
};

const hashInvitationLink = (token) => {
  return createHmac(
    "sha256",
    binding("INVITATION_HMAC_SECRET")
  )
    .update(`link:${token}`)
    .digest("hex");
};

const generateInvitation = () => {
  const code = generateCode();
  const linkToken = randomBytes(32).toString("hex");

  const url = new URL("/join", binding("APP_LINK_BASE_URL"));
  url.searchParams.set("t", linkToken);

  return {
    code,
    codeHash: hashInvitationCode(code),
    linkTokenHash: hashInvitationLink(linkToken),
    inviteUrl: url.toString(),
  };
};

module.exports = {
  generateInvitation,
  hashInvitationCode,
  hashInvitationLink,
};