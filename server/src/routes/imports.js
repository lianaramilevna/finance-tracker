const express = require("express");
const multer = require("multer");
const pool = require("../db");
const {
  readSheetRows,
  parseRows,
  buildSignatureKeys,
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
    SELECT
      TO_CHAR(date, 'YYYY-MM-DD') AS date,
      type,
      amount,
      COALESCE(note, '') AS note
    FROM transactions
    WHERE user_id = $1
      AND account_id = $2
    `,
    [userId, accountId]
  );

  const signatures = new Set();

  for (const row of result.rows) {
    for (const key of buildSignatureKeys({
      date: row.date,
      type: row.type,
      amount: row.amount,
      note: row.note,
    })) {
      signatures.add(key);
    }
  }

  return signatures;
}

function rowMatchesExistingSignatures(row, existingSignatures) {
  const keys = buildSignatureKeys({
    date: row.date,
    type: row.type,
    amount: row.amount,
    note: row.note,
    externalId: row.externalId,
  });

  return keys.some((key) => existingSignatures.has(key));
}

function rememberImportedSignatures(existingSignatures, row) {
  const keys = buildSignatureKeys({
    date: row.date,
    type: row.type,
    amount: row.amount,
    note: row.note,
    externalId: row.externalId,
  });

  for (const key of keys) {
    existingSignatures.add(key);
  }
}

function parseMonthKeyFromDate(dateStr) {
  const raw = String(dateStr || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function monthDateFromKey(monthKey) {
  return `${monthKey}-01`;
}

function endDateFromMonthKey(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  const end = new Date(Date.UTC(year, month, 0));
  return end.toISOString().slice(0, 10);
}

async function resolveCategoryIdByName(client, { userId, type, name }) {
  const cleaned = String(name || "").trim();
  if (!cleaned) return null;

  const result = await client.query(
    `
    SELECT id
    FROM categories
    WHERE type = $1
      AND LOWER(TRIM(name)) = LOWER(TRIM($2))
      AND (user_id = $3 OR user_id IS NULL)
    ORDER BY (user_id = $3) DESC, id DESC
    LIMIT 1
    `,
    [type, cleaned, userId]
  );

  return result.rows[0]?.id || null;
}

async function buildBudgetWarnings(client, { userId, rows }) {
  const categoryCache = new Map();
  const importSums = new Map();
  const categoryNames = new Map();

  for (const row of rows) {
    if (!row || row.duplicate) continue;
    if (row.type !== "expense") continue;
    if (!row.category) continue;

    const monthKey = parseMonthKeyFromDate(row.date);
    if (!monthKey) continue;

    const cacheKey = `${monthKey}|expense|${String(row.category).trim().toLowerCase()}`;
    let categoryId = categoryCache.get(cacheKey) ?? null;

    if (categoryId === undefined) {
      categoryId = await resolveCategoryIdByName(client, {
        userId,
        type: "expense",
        name: row.category,
      });
      categoryCache.set(cacheKey, categoryId);
    }

    if (!categoryId) continue;

    const sumKey = `${monthKey}|${categoryId}`;
    importSums.set(sumKey, (importSums.get(sumKey) || 0) + Number(row.amount || 0));
    categoryNames.set(sumKey, String(row.category || "").trim() || "Без категории");
  }

  if (importSums.size === 0) {
    return [];
  }

  const warnings = [];

  const monthKeys = [...new Set([...importSums.keys()].map((key) => key.split("|")[0]))];

  for (const monthKey of monthKeys) {
    const monthDate = monthDateFromKey(monthKey);
    const endDate = endDateFromMonthKey(monthKey);
    if (!endDate) continue;

    const categoryIds = [...importSums.keys()]
      .filter((key) => key.startsWith(`${monthKey}|`))
      .map((key) => Number(key.split("|")[1]))
      .filter((id) => Number.isInteger(id) && id > 0);

    const uniqueCategoryIds = [...new Set(categoryIds)];
    if (uniqueCategoryIds.length === 0) continue;

    const budgetsResult = await client.query(
      `
      SELECT category_id, limit_amount
      FROM budgets
      WHERE user_id = $1
        AND month = $2::date
        AND category_id = ANY($3::int[])
      `,
      [userId, monthDate, uniqueCategoryIds]
    );

    const limitByCategory = new Map(
      budgetsResult.rows.map((row) => [Number(row.category_id), Number(row.limit_amount || 0)])
    );

    if (limitByCategory.size === 0) continue;

    const spentResult = await client.query(
      `
      SELECT category_id, COALESCE(SUM(amount), 0) AS spent
      FROM transactions
      WHERE user_id = $1
        AND type = 'expense'
        AND transfer_group_id IS NULL
        AND category_id = ANY($2::int[])
        AND date >= $3::date
        AND date <= $4::date
      GROUP BY category_id
      `,
      [userId, uniqueCategoryIds, monthDate, endDate]
    );

    const spentByCategory = new Map(
      spentResult.rows.map((row) => [Number(row.category_id), Number(row.spent || 0)])
    );

    for (const categoryId of uniqueCategoryIds) {
      const limit = limitByCategory.get(categoryId);
      if (!Number.isFinite(limit)) continue;

      const sumKey = `${monthKey}|${categoryId}`;
      const importSpent = Number(importSums.get(sumKey) || 0);
      if (importSpent <= 0) continue;

      const currentSpent = Number(spentByCategory.get(categoryId) || 0);
      const projectedSpent = currentSpent + importSpent;

      if (projectedSpent > limit) {
        warnings.push({
          kind: "budget_exceeded",
          month: monthKey,
          category_id: categoryId,
          category: categoryNames.get(sumKey) || "Категория",
          limit_amount: limit,
          current_spent: currentSpent,
          import_spent: importSpent,
          projected_spent: projectedSpent,
          over_by: projectedSpent - limit,
        });
      }
    }
  }

  return warnings;
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
      const alreadyExists = rowMatchesExistingSignatures(row, existingSignatures);

      return {
        ...row,
        duplicate: alreadyExists || row.duplicateInFile,
        duplicateReason: alreadyExists
          ? "Уже есть в этом счёте"
          : row.duplicateInFile
          ? row.externalId
            ? "Повтор ID операции в файле"
            : "Повтор строки в файле"
          : null,
      };
    });

    const warnings = await buildBudgetWarnings(pool, { userId, rows });

    res.json({
      fileName: req.file.originalname,
      summary: {
        ...parsed.summary,
        duplicateDbRows: rows.filter((row) => row.duplicateReason === "Уже есть в этом счёте").length,
      },
      rows,
      warnings,
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
    let forcedImportedCount = 0;

    for (const row of rows) {
      const date = String(row.date || "").trim();
      const type = row.type === "income" ? "income" : "expense";
      const amount = Number(row.amount);
      const note = row.note ? String(row.note).trim() : null;
      const categoryName = String(row.category || "").trim();
      const forceImport = row.force_import === true || row.forceImport === true;

      if (!date || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      const importRow = {
        date,
        type,
        amount,
        note,
        externalId: row.externalId || row.external_id || null,
      };

      if (!forceImport && rowMatchesExistingSignatures(importRow, existingSignatures)) {
        skippedDuplicates += 1;
        continue;
      }

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

      if (!forceImport) {
        rememberImportedSignatures(existingSignatures, importRow);
      } else {
        forcedImportedCount += 1;
      }

      importedCount += 1;
    }

    const newBalance = await recalculateAccountBalance(client, accountId);

    await client.query("COMMIT");

    res.json({
      success: true,
      importedCount,
      skippedDuplicates,
      forcedImportedCount,
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