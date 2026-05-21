const express = require("express");
const multer = require("multer");
const pool = require("../db");
const {
  readSheetRows,
  parseRows,
  buildSignature,
} = require("../lib/importParser");
const { getOrCreateCategory } = require("../lib/categoryUtils");
const { recalculateAccountBalance } = require("../lib/financeUtils");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getExistingSignatures(client, userId, accountId) {
  const result = await client.query(
    `
    SELECT date, type, amount, COALESCE(note, '') AS note
    FROM transactions
    WHERE user_id = $1
      AND account_id = $2
    `,
    [userId, accountId]
  );

  return new Set(
    result.rows.map((row) =>
      buildSignature({
        date: row.date,
        type: row.type,
        amount: row.amount,
        note: row.note,
      })
    )
  );
}

router.post("/preview", upload.single("file"), async (req, res) => {
  try {
    const userId = req.userId;
    const accountId = toPositiveInt(req.body.account_id);

    if (!accountId) {
      return res.status(400).json({ message: "account_id is required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "File is required" });
    }

    const accountCheck = await pool.query(
      `
      SELECT id, user_id
      FROM accounts
      WHERE id = $1
      LIMIT 1
      `,
      [accountId]
    );

    if (accountCheck.rows.length === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    if (Number(accountCheck.rows[0].user_id) !== Number(userId)) {
      return res.status(403).json({ message: "Account does not belong to user" });
    }

    const rawRows = readSheetRows(req.file.buffer);
    const parsed = parseRows(rawRows);

    const existingSignatures = await getExistingSignatures(pool, userId, accountId);

    const rows = parsed.rows.map((row) => {
      const alreadyExists = existingSignatures.has(
        buildSignature({
          date: row.date,
          type: row.type,
          amount: row.amount,
          note: row.note,
        })
      );

      return {
        ...row,
        duplicate: alreadyExists || row.duplicateInFile,
        duplicateReason: alreadyExists
          ? "Уже есть в этом счёте"
          : row.duplicateInFile
          ? "Дубликат внутри файла"
          : null,
      };
    });

    res.json({
      fileName: req.file.originalname,
      summary: {
        ...parsed.summary,
        duplicateDbRows: rows.filter((row) => row.duplicateReason === "Уже есть в этом счёте").length,
      },
      rows,
      errors: parsed.errors,
    });
  } catch (error) {
    console.error("POST /api/imports/preview error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/commit", async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = req.userId;
    const accountId = toPositiveInt(req.body.account_id);
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

    if (!accountId) {
      return res.status(400).json({ message: "account_id is required" });
    }

    if (rows.length === 0) {
      return res.status(400).json({ message: "rows are required" });
    }

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
      return res.status(404).json({ message: "Account not found" });
    }

    if (Number(accountCheck.rows[0].user_id) !== Number(userId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Account does not belong to user" });
    }

    const existingSignatures = await getExistingSignatures(client, userId, accountId);

    let importedCount = 0;
    let skippedDuplicates = 0;

    for (const row of rows) {
      const date = String(row.date || "").trim();
      const type = row.type === "income" ? "income" : "expense";
      const amount = Number(row.amount);
      const note = row.note ? String(row.note).trim() : null;
      const categoryName = String(row.category || "").trim();

      if (!date || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      const signature = buildSignature({
        date,
        type,
        amount,
        note,
      });

      if (existingSignatures.has(signature)) {
        skippedDuplicates += 1;
        continue;
      }

      existingSignatures.add(signature);

      const category = await getOrCreateCategory(client, {
        userId,
        type,
        name: categoryName || (type === "income" ? "Прочее" : "Без категории"),
      });

      if (!category) {
        throw new Error("Failed to resolve category");
      }

      await client.query(
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
        `,
        [userId, accountId, category.id, amount, type, note, date]
      );

      importedCount += 1;
    }

    const newBalance = await recalculateAccountBalance(client, accountId);

    await client.query("COMMIT");

    res.json({
      success: true,
      importedCount,
      skippedDuplicates,
      newAccountBalance: newBalance,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /api/imports/commit error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;