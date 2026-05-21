const jwt = require("jsonwebtoken");

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function toPublicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    currency: row.currency || "RUB",
  };
}

function signUserToken(userId) {
  return jwt.sign({ sub: String(userId) }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

function verifyUserToken(token) {
  const payload = jwt.verify(token, getJwtSecret());
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Invalid token payload");
  }
  return userId;
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie("token");
}

module.exports = {
  toPublicUser,
  signUserToken,
  verifyUserToken,
  setAuthCookie,
  clearAuthCookie,
};
