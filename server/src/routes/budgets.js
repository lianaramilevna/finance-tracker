const express = require("express");
const pool = require("../db");

const router = express.Router();

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function parseMonthKey(monthKey) {
  const raw = String(monthKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return null;
  }

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));

  const monthDate = `${year}-${String(month).padStart(2, "0")}-01`;

  return { start, end, monthKey: raw, monthDate };
}

async function getBudgetRows(client, userId, monthKey) {
  const monthRange = parseMonthKey(monthKey);
  if (!monthRange) {
    return [];
  }

  const result = await client.query(
    `
    SELECT
      b.id,
      b.user_id,
      b.category_id,
      b.month,
      b.limit_amount,
      COALESCE(c.name, 'Удалённая категория') AS category_name
    FROM budgets b
    LEFT JOIN categories c ON c.id = b.category_id
    WHERE b.user_id = $1
      AND b.month = $2::date
    ORDER BY COALESCE(c.name, 'Удалённая категория') ASC, b.id ASC
    `,
    [userId, monthRange.monthDate]
  );

  const rows = [];

  for (const item of result.rows) {
    const spentResult = await client.query(
      `
      SELECT COALESCE(SUM(t.amount), 0) AS spent
      FROM transactions t
      WHERE t.user_id = $1
        AND t.category_id = $2
        AND t.type = 'expense'
        AND t.transfer_group_id IS NULL
        AND t.date >= $3::date
        AND t.date <= $4::date
      `,
      [userId, item.category_id, monthRange.monthDate, monthRange.end.toISOString().slice(0, 10)]
    );

    const spent = Number(spentResult.rows[0]?.spent || 0);
    const limitAmount = Number(item.limit_amount || 0);
    const remaining = Math.max(limitAmount - spent, 0);
    const progressPercent = limitAmount > 0 ? Math.round((spent / limitAmount) * 100) : 0;

    rows.push({
      id: item.id,
      user_id: item.user_id,
      category_id: item.category_id,
      category_name: item.category_name,
      month: getCurrentMonthKey(new Date(item.month)),
      limit_amount: limitAmount,
      spent,
      remaining,
      progress_percent: progressPercent,
    });
  }

  return rows;
}

router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const month = String(req.query.month || getCurrentMonthKey()).trim();

    const monthRange = parseMonthKey(month);
    if (!monthRange) {
      return res.status(400).json({ message: "Invalid month format" });
    }

    const rows = await getBudgetRows(pool, userId, month);
    res.json(rows);
  } catch (error) {
    console.error("GET /api/budgets error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.userId;
    const categoryId = toPositiveInt(req.body.category_id);
    const month = String(req.body.month || getCurrentMonthKey()).trim();
    const limitAmount = Number(req.body.limit_amount);

    if (!categoryId || !month || !Number.isFinite(limitAmount) || limitAmount < 0) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const monthRange = parseMonthKey(month);
    if (!monthRange) {
      return res.status(400).json({ message: "Invalid month format" });
    }

    await client.query("BEGIN");

    const categoryCheck = await client.query(
      `
      SELECT id, name
      FROM categories
      WHERE id = $1
        AND type = 'expense'
      LIMIT 1
      `,
      [categoryId]
    );

    if (categoryCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Category not found" });
    }

    const existing = await client.query(
      `
      SELECT id
      FROM budgets
      WHERE user_id = $1
        AND category_id = $2
        AND month = $3::date
      LIMIT 1
      `,
      [userId, categoryId, monthRange.monthDate]
    );

    if (existing.rows.length > 0) {
      await client.query(
        `
        UPDATE budgets
        SET limit_amount = $1
        WHERE id = $2
        `,
        [limitAmount, existing.rows[0].id]
      );
    } else {
      await client.query(
        `
        INSERT INTO budgets (user_id, category_id, month, limit_amount)
        VALUES ($1, $2, $3::date, $4)
        `,
        [userId, categoryId, monthRange.monthDate, limitAmount]
      );
    }

    await client.query("COMMIT");

    const rows = await getBudgetRows(pool, userId, month);
    const updatedRow = rows.find((item) => Number(item.category_id) === Number(categoryId)) || null;

    res.status(201).json(updatedRow || { success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/budgets error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);
    const limitAmount = Number(req.body.limit_amount);

    if (!id || !Number.isFinite(limitAmount) || limitAmount < 0) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const updated = await pool.query(
      `
      UPDATE budgets
      SET limit_amount = $1
      WHERE id = $2
        AND user_id = $3
      RETURNING id, user_id, category_id, month, limit_amount
      `,
      [limitAmount, id, req.userId]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: "Budget not found" });
    }

    const row = updated.rows[0];
    const monthKey = getCurrentMonthKey(new Date(row.month));
    const rows = await getBudgetRows(pool, Number(row.user_id), monthKey);
    const computed = rows.find((item) => Number(item.id) === Number(row.id)) || null;

    res.json(computed || row);
  } catch (error) {
    console.error("PATCH /api/budgets/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = toPositiveInt(req.params.id);

    if (!id) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const deleted = await pool.query(
      `
      DELETE FROM budgets
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      [id, req.userId]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: "Budget not found" });
    }

    res.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("DELETE /api/budgets/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;