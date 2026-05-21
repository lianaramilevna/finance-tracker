const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const {
  toPublicUser,
  signUserToken,
  setAuthCookie,
  clearAuthCookie,
} = require("../lib/authToken");

const router = express.Router();

const SALT_ROUNDS = 12;

function isHashedPassword(value) {
  return typeof value === "string" && value.startsWith("$2");
}

function validateUsername(username) {
  const value = String(username || "").trim();

  if (value.length < 3) {
    return "Имя пользователя должно содержать минимум 3 символа";
  }
  if (value.length > 30) {
    return "Имя пользователя должно содержать не более 30 символов";
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) {
    return "Имя пользователя может содержать только буквы, цифры, _ и -";
  }

  return null;
}

function validateEmail(email) {
  const value = String(email || "").trim().toLowerCase();

  if (!value) {
    return "Email обязателен";
  }
  if (/\s/.test(value)) {
    return "Email не должен содержать пробелы";
  }
  if (value.startsWith(".") || value.endsWith(".")) {
    return "Введите корректный email";
  }
  if (!/^(?!.*\.\.)[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return "Введите корректный email";
  }

  return null;
}

function validatePassword(password) {
  const value = String(password || "");

  if (value.length < 8) {
    return "Пароль должен содержать минимум 8 символов";
  }
  if (/\s/.test(value)) {
    return "Пароль не должен содержать пробелы";
  }
  //if (!/[A-Za-zА-Яа-яЁё]/.test(value)) {
    //return "Пароль должен содержать хотя бы одну букву";}
  if (!/\d/.test(value)) {
    return "Пароль должен содержать хотя бы одну цифру";
  }

  return null;
}

router.get("/check-username", async (req, res) => {
  try {
    const username = String(req.query.username || "").trim();

    const usernameError = validateUsername(username);
    if (usernameError) {
      return res.status(400).json({ available: false, message: usernameError });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [username]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({
        available: false,
        message: "Это имя пользователя уже занято",
      });
    }

    return res.status(200).json({ available: true, message: "Имя пользователя доступно" });
  } catch (error) {
    console.error("GET /api/check-username error:", error);
    res.status(500).json({ available: false, message: "Server error" });
  }
});

router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const usernameError = validateUsername(username);
    if (usernameError) {
      return res.status(400).json({ message: usernameError });
    }

    const emailError = validateEmail(email);
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ message: passwordError });
    }

    const cleanedUsername = String(username).trim();
    const cleanedEmail = String(email).trim().toLowerCase();
    const cleanedPassword = String(password);

    const existing = await pool.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER($1)
         OR LOWER(email) = LOWER($2)
      LIMIT 1
      `,
      [cleanedUsername, cleanedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Пользователь уже существует" });
    }

    const passwordHash = await bcrypt.hash(cleanedPassword, SALT_ROUNDS);

    const created = await pool.query(
      `
      INSERT INTO users (username, email, password_hash, currency)
      VALUES ($1, $2, $3, 'RUB')
      RETURNING id, username, email, currency
      `,
      [cleanedUsername, cleanedEmail, passwordHash]
    );

    const user = created.rows[0];
    const token = signUserToken(user.id);
    setAuthCookie(res, token);

    res.status(201).json({ user: toPublicUser(user), token });
  } catch (error) {
    console.error("POST /api/register error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ message: "Login and password are required" });
    }

    const cleanedLogin = String(login).trim();
    const cleanedPassword = String(password);

    const result = await pool.query(
      `
      SELECT id, username, email, currency, password_hash
      FROM users
      WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)
      LIMIT 1
      `,
      [cleanedLogin]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];
    const storedHash = user.password_hash;

    let passwordOk = false;

    if (isHashedPassword(storedHash)) {
      passwordOk = await bcrypt.compare(cleanedPassword, storedHash);
    } else {
      passwordOk = cleanedPassword === storedHash;

      if (passwordOk) {
        const newHash = await bcrypt.hash(cleanedPassword, SALT_ROUNDS);
        await pool.query(
          `
          UPDATE users
          SET password_hash = $1
          WHERE id = $2
          `,
          [newHash, user.id]
        );
      }
    }

    if (!passwordOk) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const publicUser = toPublicUser(user);
    const token = signUserToken(user.id);
    setAuthCookie(res, token);

    res.json({ user: publicUser, token });
  } catch (error) {
    console.error("POST /api/login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

module.exports = router;