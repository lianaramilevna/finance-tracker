const express = require("express");
const pool = require("../db");

const router = express.Router();

const initGoalsTables = pool.query(`
  CREATE TABLE IF NOT EXISTS goals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
    current_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
    target_date DATE NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS goal_contributions (
    id SERIAL PRIMARY KEY,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    account_id INTEGER NULL REFERENCES accounts(id) ON DELETE SET NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    note TEXT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  ALTER TABLE goal_contributions
  ADD COLUMN IF NOT EXISTS account_id INTEGER NULL REFERENCES accounts(id) ON DELETE SET NULL;
`);

function toGoalDto(row) {
  const target = Number(row.target_amount || 0);
  const current = Number(row.current_amount || 0);
  const progressPercent = target > 0 ? Math.round((current / target) * 100) : 0;

  return {
    ...row,
    target_amount: target,
    current_amount: current,
    remaining: Math.max(target - current, 0),
    progress_percent: progressPercent,
  };
}

router.get("/", async (req, res) => {
  try {
    await initGoalsTables;

    const { user_id } = req.query;
    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const result = await pool.query(
      `
      SELECT id, user_id, name, target_amount, current_amount, target_date, status, created_at
      FROM goals
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      `,
      [user_id]
    );

    res.json(result.rows.map(toGoalDto));
  } catch (error) {
    console.error("GET /api/goals error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    await initGoalsTables;

    const { user_id, name, target_amount, target_date = null } = req.body;
    const target = Number(target_amount);

    if (!user_id || !name || Number.isNaN(target) || target <= 0) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const created = await pool.query(
      `
      INSERT INTO goals (user_id, name, target_amount, target_date)
      VALUES ($1, $2, $3, $4)
      RETURNING id, user_id, name, target_amount, current_amount, target_date, status, created_at
      `,
      [user_id, String(name).trim(), target, target_date || null]
    );

    res.status(201).json(toGoalDto(created.rows[0]));
  } catch (error) {
    console.error("POST /api/goals error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    await initGoalsTables;

    const { id } = req.params;
    const { name, target_amount, target_date, status } = req.body;
    const target = target_amount !== undefined ? Number(target_amount) : null;

    if (target !== null && (Number.isNaN(target) || target <= 0)) {
      return res.status(400).json({ message: "Invalid target_amount" });
    }

    if (status && !["active", "completed", "paused"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const currentGoal = await pool.query(
      `
      SELECT target_amount, current_amount, status
      FROM goals
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (currentGoal.rows.length === 0) {
      return res.status(404).json({ message: "Goal not found" });
    }

    const existing = currentGoal.rows[0];
    const nextTarget = target !== null ? target : Number(existing.target_amount);
    const nextCurrent = Number(existing.current_amount || 0);
    const resolvedStatus =
      status ??
      (nextCurrent >= nextTarget ? "completed" : String(existing.status || "active"));

    const updated = await pool.query(
      `
      UPDATE goals
      SET
        name = COALESCE($1, name),
        target_amount = COALESCE($2, target_amount),
        target_date = COALESCE($3, target_date),
        status = COALESCE($4, status)
      WHERE id = $5
      RETURNING id, user_id, name, target_amount, current_amount, target_date, status, created_at
      `,
      [
        name ? String(name).trim() : null,
        target,
        target_date ?? null,
        resolvedStatus,
        id,
      ]
    );

    res.json(toGoalDto(updated.rows[0]));
  } catch (error) {
    console.error("PATCH /api/goals/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/contribute", async (req, res) => {
  const client = await pool.connect();

  try {
    await initGoalsTables;

    const { id } = req.params;
    const { amount, note = null, date = null, account_id = null } = req.body;
    const contribution = Number(amount);

    if (Number.isNaN(contribution) || contribution <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    await client.query("BEGIN");

    const goalResult = await client.query(
      `
      SELECT id, user_id, target_amount, current_amount
      FROM goals
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (goalResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Goal not found" });
    }

    const goal = goalResult.rows[0];

    if (account_id) {
      const accountResult = await client.query(
        `
        SELECT id, balance
        FROM accounts
        WHERE id = $1 AND user_id = $2
        LIMIT 1
        `,
        [account_id, goal.user_id]
      );

      if (accountResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Account not found for this user" });
      }

      const account = accountResult.rows[0];
      const nextAccountBalance = Number(account.balance || 0) - contribution;

      if (nextAccountBalance < 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ message: "Insufficient account balance for contribution" });
      }

      await client.query(
        `
        UPDATE accounts
        SET balance = $1
        WHERE id = $2
        `,
        [nextAccountBalance, account_id]
      );
    }

    const nextCurrentAmount = Number(goal.current_amount || 0) + contribution;
    const nextStatus = nextCurrentAmount >= Number(goal.target_amount || 0) ? "completed" : "active";

    const updatedGoal = await client.query(
      `
      UPDATE goals
      SET current_amount = $1, status = $2
      WHERE id = $3
      RETURNING id, user_id, name, target_amount, current_amount, target_date, status, created_at
      `,
      [nextCurrentAmount, nextStatus, id]
    );

    await client.query(
      `
      INSERT INTO goal_contributions (goal_id, account_id, amount, note, date)
      VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_DATE))
      `,
      [id, account_id || null, contribution, note, date]
    );

    await client.query("COMMIT");
    res.json(toGoalDto(updatedGoal.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/goals/:id/contribute error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.get("/:id/contributions", async (req, res) => {
  try {
    await initGoalsTables;

    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT
        gc.id,
        gc.goal_id,
        gc.account_id,
        a.name AS account_name,
        gc.amount,
        gc.note,
        gc.date,
        gc.created_at
      FROM goal_contributions gc
      LEFT JOIN accounts a ON a.id = gc.account_id
      WHERE gc.goal_id = $1
      ORDER BY gc.date DESC, gc.id DESC
      LIMIT 50
      `,
      [id]
    );

    res.json(
      result.rows.map((row) => ({
        ...row,
        amount: Number(row.amount || 0),
      }))
    );
  } catch (error) {
    console.error("GET /api/goals/:id/contributions error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await initGoalsTables;

    const { id } = req.params;
    const deleted = await pool.query(
      `
      DELETE FROM goals
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: "Goal not found" });
    }

    res.json({ success: true, deletedId: Number(id) });
  } catch (error) {
    console.error("DELETE /api/goals/:id error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
