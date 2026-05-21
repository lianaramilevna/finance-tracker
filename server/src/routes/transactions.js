const express = require("express");
const pool = require("../db");
const { getOrCreateCategory } = require("../lib/categoryUtils");
const { recalculateAccountBalance } = require("../lib/financeUtils");

const router = express.Router();

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function resolveCategoryId(client, { userId, type, category_id, category }) {
  const existingId = toPositiveInt(category_id);
  if (existingId) {
    const found = await client.query(
      `
      SELECT id, type
      FROM categories
      WHERE id = $1
        AND type = $2
      LIMIT 1
      `,
      [existingId, type]
    );

    if (found.rows.length === 0) {
      return null;
    }

    return existingId;
  }

  const cleaned = String(category || "").trim();
  if (!cleaned) {
    return null;
  }

  const categoryRow = await getOrCreateCategory(client, {
    userId,
    type,
    name: cleaned,
  });

  return categoryRow ? categoryRow.id : null;
}

async function buildTransactionResponse(client, transactionId) {
  const result = await client.query(
    `
    SELECT
      t.id,
      t.user_id,
      t.account_id,
      a.name AS account,
      a.type AS account_type,
      t.category_id,
      c.name AS category,
      c.type AS category_type,
      t.amount,
      t.type,
      t.note,
      t.date,
      t.transfer_group_id,
      t.created_at
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.id = $1
    LIMIT 1
    `,
    [transactionId]
  );

  return result.rows[0] || null;
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        t.id,
        t.user_id,
        t.account_id,
        a.name AS account,
        a.type AS account_type,
        t.category_id,
        c.name AS category,
        c.type AS category_type,
        t.amount,
        t.type,
        t.note,
        t.date,
        t.transfer_group_id,
        t.created_at
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC, t.id DESC
      `,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("GET /api/transactions error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      amount,
      type,
      date,
      note = null,
      user_id = null,
      account_id = null,
      category_id = null,
      category = null,
    } = req.body;

    if (
      amount === undefined ||
      amount === null ||
      !type ||
      !date ||
      !["expense", "income"].includes(type)
    ) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber)) {
      return res.status(400).json({ message: "Amount must be a number" });
    }

    const accountId = toPositiveInt(account_id);
    if (!accountId) {
      return res.status(400).json({ message: "account_id is required" });
    }

    const userId = req.userId;

    await client.query("BEGIN");

    const accountCheck = await client.query(
      `
      SELECT id, user_id, balance
      FROM accounts
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [accountId]
    );

    if (accountCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Account not found" });
    }

    const ownerUserId = userId;

    if (Number(accountCheck.rows[0].user_id) !== ownerUserId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Account does not belong to user" });
    }

    const resolvedCategoryId = await resolveCategoryId(client, {
      userId: ownerUserId,
      type,
      category_id,
      category,
    });

    if (!resolvedCategoryId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "category_id or category is required" });
    }

    const inserted = await client.query(
      `
      INSERT INTO transactions (
        user_id,
        account_id,
        category_id,
        amount,
        type,
        note,
        date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        ownerUserId,
        accountId,
        resolvedCategoryId,
        amountNumber,
        type,
        note,
        date,
      ]
    );

    await recalculateAccountBalance(client, accountId);

    await client.query("COMMIT");

    const transaction = await buildTransactionResponse(client, inserted.rows[0].id);
    res.status(201).json(transaction);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/transactions error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const transactionId = toPositiveInt(req.params.id);
    if (!transactionId) {
      return res.status(400).json({ message: "Invalid transaction id" });
    }

    const {
      amount,
      type,
      date,
      note = null,
      user_id = null,
      account_id = null,
      category_id = null,
      category = null,
    } = req.body;

    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT id, user_id, account_id, category_id, amount, type, note, date
      FROM transactions
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [transactionId]
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Transaction not found" });
    }

    const existing = existingResult.rows[0];

    if (Number(existing.user_id) !== req.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Forbidden" });
    }

    const nextType = type && ["expense", "income"].includes(type) ? type : existing.type;
    const nextDate = date || existing.date;
    const nextAmount =
      amount === undefined || amount === null || amount === ""
        ? Number(existing.amount)
        : Number(amount);

    if (!Number.isFinite(nextAmount)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Amount must be a number" });
    }

    const nextAccountId = toPositiveInt(account_id) || Number(existing.account_id);
    const ownerUserId = req.userId;

    const accountCheck = await client.query(
      `
      SELECT id, user_id
      FROM accounts
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [nextAccountId]
    );

    if (accountCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Account not found" });
    }

    if (Number(accountCheck.rows[0].user_id) !== Number(ownerUserId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Account does not belong to user" });
    }

    const resolvedCategoryId = await resolveCategoryId(client, {
      userId: ownerUserId,
      type: nextType,
      category_id,
      category,
    });

    if (!resolvedCategoryId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "category_id or category is required" });
    }

    await client.query(
      `
      UPDATE transactions
      SET
        user_id = $1,
        account_id = $2,
        category_id = $3,
        amount = $4,
        type = $5,
        note = $6,
        date = $7
      WHERE id = $8
      `,
      [
        ownerUserId,
        nextAccountId,
        resolvedCategoryId,
        nextAmount,
        nextType,
        note === undefined ? existing.note : note,
        nextDate,
        transactionId,
      ]
    );

    await recalculateAccountBalance(client, Number(existing.account_id));
    if (Number(existing.account_id) !== Number(nextAccountId)) {
      await recalculateAccountBalance(client, nextAccountId);
    }

    await client.query("COMMIT");

    const transaction = await buildTransactionResponse(client, transactionId);
    res.json(transaction);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/transactions/:id error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const transactionId = toPositiveInt(req.params.id);
    if (!transactionId) {
      return res.status(400).json({ message: "Invalid transaction id" });
    }

    await client.query("BEGIN");

    const existing = await client.query(
      `
      SELECT id, user_id, account_id
      FROM transactions
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [transactionId]
    );

    if (existing.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (Number(existing.rows[0].user_id) !== req.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Forbidden" });
    }

    const accountId = Number(existing.rows[0].account_id);

    await client.query(
      `
      DELETE FROM transactions
      WHERE id = $1
      `,
      [transactionId]
    );

    await recalculateAccountBalance(client, accountId);

    await client.query("COMMIT");

    res.json({ success: true, deletedId: transactionId });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/transactions/:id error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;