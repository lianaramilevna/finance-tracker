const express = require("express");
const pool = require("../db");
const {
  isYieldAccountType,
  parseAnnualRatePercent,
  normalizeAnnualRateForType,
} = require("../lib/accountYield");

const router = express.Router();

const ACCOUNT_COLUMNS = `
  id,
  user_id,
  name,
  type,
  currency,
  balance,
  annual_rate_percent,
  is_archived,
  closed_at,
  created_at
`;

async function getOwnedAccount(id, userId) {
  const result = await pool.query(
    `
    SELECT ${ACCOUNT_COLUMNS}
    FROM accounts
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  if (Number(result.rows[0].user_id) !== userId) {
    return "forbidden";
  }

  return result.rows[0];
}

function parseArchivedFilter(value) {
  const raw = String(value || "active").trim().toLowerCase();
  if (raw === "archived") return "archived";
  if (raw === "all") return "all";
  return "active";
}

router.get("/", async (req, res) => {
  try {
    const filter = parseArchivedFilter(req.query.archived);

    let whereClause = "user_id = $1";
    if (filter === "active") {
      whereClause += " AND COALESCE(is_archived, false) = false";
    } else if (filter === "archived") {
      whereClause += " AND COALESCE(is_archived, false) = true";
    }

    const result = await pool.query(
      `
      SELECT ${ACCOUNT_COLUMNS}
      FROM accounts
      WHERE ${whereClause}
      ORDER BY created_at DESC, id DESC
      `,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/accounts error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, type, balance = 0, annual_rate_percent } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const allowedTypes = ["card", "cash", "savings", "investment"];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid account type" });
    }

    const parsedRate = parseAnnualRatePercent(annual_rate_percent);
    if (parsedRate === "invalid") {
      return res.status(400).json({ message: "annual_rate_percent must be between 0 and 100" });
    }

    const annualRate = normalizeAnnualRateForType(type, parsedRate);

    const created = await pool.query(
      `
      INSERT INTO accounts (user_id, name, type, currency, balance, annual_rate_percent, is_archived)
      VALUES ($1, $2, $3, 'RUB', $4, $5, false)
      RETURNING ${ACCOUNT_COLUMNS}
      `,
      [req.userId, name.trim(), type, balance, annualRate]
    );

    res.status(201).json(created.rows[0]);
  } catch (error) {
    console.error("POST /api/accounts error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, balance, annual_rate_percent } = req.body;

    const owned = await getOwnedAccount(id, req.userId);
    if (owned === "forbidden") {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (!owned) {
      return res.status(404).json({ message: "Account not found" });
    }

    const allowedTypes = ["card", "cash", "savings", "investment"];
    if (type && !allowedTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid account type" });
    }

    const nextType = type ?? owned.type;
    let nextAnnualRate = owned.annual_rate_percent ?? null;

    if (annual_rate_percent !== undefined) {
      const parsedRate = parseAnnualRatePercent(annual_rate_percent);
      if (parsedRate === "invalid") {
        return res.status(400).json({ message: "annual_rate_percent must be between 0 and 100" });
      }
      nextAnnualRate = normalizeAnnualRateForType(nextType, parsedRate);
    } else if (type && !isYieldAccountType(nextType)) {
      nextAnnualRate = null;
    }

    const updated = await pool.query(
      `
      UPDATE accounts
      SET
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        currency = 'RUB',
        balance = COALESCE($3, balance),
        annual_rate_percent = $4
      WHERE id = $5
        AND user_id = $6
      RETURNING ${ACCOUNT_COLUMNS}
      `,
      [
        name ? name.trim() : null,
        type ?? null,
        balance ?? null,
        nextAnnualRate,
        id,
        req.userId,
      ]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.error("PATCH /api/accounts/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id/close", async (req, res) => {
  try {
    const { id } = req.params;

    const closed = await pool.query(
      `
      UPDATE accounts
      SET is_archived = true,
          closed_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND COALESCE(is_archived, false) = false
      RETURNING ${ACCOUNT_COLUMNS}
      `,
      [id, req.userId]
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

router.patch("/:id/restore", async (req, res) => {
  try {
    const { id } = req.params;

    const restored = await pool.query(
      `
      UPDATE accounts
      SET is_archived = false,
          closed_at = NULL
      WHERE id = $1
        AND user_id = $2
        AND COALESCE(is_archived, false) = true
      RETURNING ${ACCOUNT_COLUMNS}
      `,
      [id, req.userId]
    );

    if (restored.rows.length === 0) {
      return res.status(404).json({ message: "Archived account not found" });
    }

    res.json(restored.rows[0]);
  } catch (error) {
    console.error("PATCH /api/accounts/:id/restore error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await pool.query(
      `
      DELETE FROM accounts
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      [id, req.userId]
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
