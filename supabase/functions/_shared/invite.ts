const INVITE_CODE_LENGTH = 10;
const INVITE_CODE_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateInviteCode() {
  const values = crypto.getRandomValues(new Uint32Array(INVITE_CODE_LENGTH));

  return Array.from(values)
    .map((value) => INVITE_CODE_CHARS[value % INVITE_CODE_CHARS.length])
    .join("");
}

