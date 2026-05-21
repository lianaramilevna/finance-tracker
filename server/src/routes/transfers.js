const express = require("express");
const pool = require("../db");
const { insertTransaction, getNextTransferGroupId } = require("../lib/transactionService");

const router = express.Router();

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getActiveAccount(client, accountId, userId) {
  const result = await client.query(
    `
    SELECT id, name, currency, COALESCE(is_archived, false) AS is_archived
    FROM accounts
    WHERE id = $1 AND user_id = $2
    LIMIT 1
    `,
    [accountId, userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const account = result.rows[0];
  if (account.is_archived) {
    return "archived";
  }

  return account;
}

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const fromAccountId = toPositiveInt(req.body.from_account_id);
    const toAccountId = toPositiveInt(req.body.to_account_id);
    const amount = Number(req.body.amount);
    const date = String(req.body.date || "").trim() || new Date().toISOString().slice(0, 10);
    const note = req.body.note ? String(req.body.note).trim() : null;

    if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
      return res.status(400).json({ message: "Invalid accounts for transfer" });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    await client.query("BEGIN");

    const fromAccount = await getActiveAccount(client, fromAccountId, req.userId);
    const toAccount = await getActiveAccount(client, toAccountId, req.userId);

    if (!fromAccount || !toAccount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Account not found" });
    }

    if (fromAccount === "archived" || toAccount === "archived") {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Cannot transfer to or from archived account" });
    }

    if (fromAccount.currency !== toAccount.currency) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Accounts must have the same currency" });
    }

    const fromBalanceResult = await client.query(
      `
      SELECT balance
      FROM accounts
      WHERE id = $1
      FOR UPDATE
      `,
      [fromAccountId]
    );

    const fromBalance = Number(fromBalanceResult.rows[0]?.balance || 0);
    if (fromBalance < amount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Insufficient balance on source account" });
    }

    const transferGroupId = await getNextTransferGroupId(client);
    const transferNote = note || `Перевод: ${fromAccount.name} → ${toAccount.name}`;

    const outId = await insertTransaction(client, {
      userId: req.userId,
      accountId: fromAccountId,
      type: "expense",
      amount,
      date,
      note: transferNote,
      categoryName: "Перевод",
      transferGroupId,
    });

    const inId = await insertTransaction(client, {
      userId: req.userId,
      accountId: toAccountId,
      type: "income",
      amount,
      date,
      note: transferNote,
      categoryName: "Перевод",
      transferGroupId,
    });

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      transfer_group_id: transferGroupId,
      from_transaction_id: outId,
      to_transaction_id: inId,
      amount,
      date,
      note: transferNote,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/transfers error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
