const { verifyUserToken } = require("../lib/authToken");

function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  return null;
}

function authenticate(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    req.userId = verifyUserToken(token);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireSelfParam(paramName = "id") {
  return (req, res, next) => {
    const resourceId = Number(req.params[paramName]);
    if (!Number.isInteger(resourceId) || resourceId !== req.userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

module.exports = {
  authenticate,
  requireSelfParam,
};
