const express = require("express");
const pool = require("../db");

const router = express.Router();

/**
 * GET /api/accounts?user_id=1
 * Возвращает только активные счета
 */
router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        name,
        type,
        currency,
        balance,
        is_archived,
        closed_at,
        created_at
      FROM accounts
      WHERE user_id = $1
        AND COALESCE(is_archived, false) = false
      ORDER BY created_at DESC, id DESC
      `,
      [user_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/accounts error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * POST /api/accounts
 */
router.post("/", async (req, res) => {
  try {
    const {
      user_id,
      name,
      type,
      currency = "RUB",
      balance = 0,
    } = req.body;

    if (!user_id || !name || !type) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const allowedTypes = ["card", "cash", "savings", "investment"];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid account type" });
    }

    const created = await pool.query(
      `
      INSERT INTO accounts (user_id, name, type, currency, balance, is_archived)
      VALUES ($1, $2, $3, $4, $5, false)
      RETURNING id, user_id, name, type, currency, balance, is_archived, closed_at, created_at
      `,
      [user_id, name.trim(), type, currency, balance]
    );

    res.status(201).json(created.rows[0]);
  } catch (error) {
    console.error("POST /api/accounts error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/accounts/:id
 * Редактирование счета
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, currency, balance } = req.body;

    const allowedTypes = ["card", "cash", "savings", "investment"];
    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid account type" });
    }

    const updated = await pool.query(
      `
      UPDATE accounts
      SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        currency = COALESCE($3, currency),
        balance = COALESCE($4, balance)
      WHERE id = $5
      RETURNING id, user_id, name, type, currency, balance, is_archived, closed_at, created_at
      `,
      [
        name ? name.trim() : null,
        type ?? null,
        currency ?? null,
        balance ?? null,
        id,
      ]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.json(updated.rows[0]);
  } catch (error) {
    console.error("PATCH /api/accounts/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * PATCH /api/accounts/:id/close
 * Закрыть счет (архивировать)
 */
router.patch("/:id/close", async (req, res) => {
  try {
    const { id } = req.params;

    const closed = await pool.query(
      `
      UPDATE accounts
      SET is_archived = true,
          closed_at = NOW()
      WHERE id = $1
      RETURNING id, user_id, name, type, currency, balance, is_archived, closed_at, created_at
      `,
      [id]
    );

    if (closed.rows.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.json(closed.rows[0]);
  } catch (error) {
    console.error("PATCH /api/accounts/:id/close error:", error);
    res.status(500).json({ message: "Server error" });
  }
});


/**
 * DELETE /api/accounts/:id
 * Лучше не использовать, но можно оставить как реальное удаление
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await pool.query(
      `
      DELETE FROM accounts
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    res.json({ success: true, deletedId: Number(id) });
  } catch (error) {
    console.error("DELETE /api/accounts/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;