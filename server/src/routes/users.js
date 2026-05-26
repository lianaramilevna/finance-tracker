const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db");
const { requireSelfParam } = require("../middleware/authenticate");

const router = express.Router();

router.use("/:id", requireSelfParam("id"));

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

  if (!/[A-Za-zА-Яа-яЁё]/.test(value)) {
    return "Пароль должен содержать хотя бы одну букву";
  }

  if (!/\d/.test(value)) {
    return "Пароль должен содержать хотя бы одну цифру";
  }

  return null;
}

router.get("/:id/settings", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT id, username, email, currency
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("GET /api/users/:id/settings error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id/settings", async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email } = req.body;

    const usernameError = username ? validateUsername(username) : null;
    if (usernameError) {
      return res.status(400).json({ message: usernameError });
    }

    const emailError = email ? validateEmail(email) : null;
    if (emailError) {
      return res.status(400).json({ message: emailError });
    }

    const existing = await pool.query(
      `
      SELECT id
      FROM users
      WHERE id <> $1
        AND (
          LOWER(username) = LOWER(COALESCE($2, username))
          OR LOWER(email) = LOWER(COALESCE($3, email))
        )
      LIMIT 1
      `,
      [id, username ? String(username).trim() : null, email ? String(email).trim().toLowerCase() : null]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Username or email already exists" });
    }

    const updated = await pool.query(
      `
      UPDATE users
      SET
        username = COALESCE($1, username),
        email = COALESCE($2, email),
        currency = 'RUB'
      WHERE id = $3
      RETURNING id, username, email, currency
      `,
      [
        username ? String(username).trim() : null,
        email ? String(email).trim().toLowerCase() : null,
        id,
      ]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    console.error("PATCH /api/users/:id/settings error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id/password", async (req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const newPasswordError = validatePassword(newPassword);
    if (newPasswordError) {
      return res.status(400).json({ message: newPasswordError });
    }

    const result = await pool.query(
      `
      SELECT id, password_hash
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];
    const storedHash = user.password_hash;

    let currentOk = false;

    if (isHashedPassword(storedHash)) {
      currentOk = await bcrypt.compare(String(currentPassword), storedHash);
    } else {
      currentOk = String(currentPassword) === String(storedHash);

      if (currentOk) {
        const migratedHash = await bcrypt.hash(String(currentPassword), SALT_ROUNDS);
        await pool.query(
          `
          UPDATE users
          SET password_hash = $1
          WHERE id = $2
          `,
          [migratedHash, id]
        );
      }
    }

    if (!currentOk) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const nextHash = await bcrypt.hash(String(newPassword), SALT_ROUNDS);

    await pool.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      `,
      [nextHash, id]
    );

    res.json({ success: true, message: "Password updated" });
  } catch (error) {
    console.error("PATCH /api/users/:id/password error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/clear-data", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    // Delete financial history in safe FK order
    await client.query(`DELETE FROM transactions WHERE user_id = $1`, [id]);
    await client.query(`DELETE FROM budgets WHERE user_id = $1`, [id]);

    // goal_contributions -> goals (goal_id CASCADE), but clean explicitly for clarity
    await client.query(
      `
      DELETE FROM goal_contributions
      WHERE goal_id IN (SELECT id FROM goals WHERE user_id = $1)
      `,
      [id]
    );
    await client.query(`DELETE FROM goals WHERE user_id = $1`, [id]);

    await client.query(`DELETE FROM accounts WHERE user_id = $1`, [id]);
    await client.query(`DELETE FROM categories WHERE user_id = $1`, [id]);

    // Keep profile; keep single currency
    await client.query(`UPDATE users SET currency = 'RUB' WHERE id = $1`, [id]);

    await client.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/users/:id/clear-data error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;

    await client.query("BEGIN");

    // ensure FK restrictions won't block deletion
    await client.query(`DELETE FROM transactions WHERE user_id = $1`, [id]);

    const deleted = await client.query(
      `
      DELETE FROM users
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (deleted.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }

    await client.query("COMMIT");
    res.json({ success: true, deletedId: Number(id) });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/users/:id error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;