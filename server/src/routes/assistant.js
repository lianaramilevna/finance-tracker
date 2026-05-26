const express = require("express");
const pool = require("../db");
const { generateAssistantInsights } = require("../lib/assistantInsights");
const { enrichInsightsWithLlm, answerUserQuestion, buildLlmPayload } = require("../lib/assistantLlm");
const { checkHfHealth, isLlmEnabled } = require("../lib/llm/huggingface");
const {
  getUserAccounts,
  resolveAccountScope,
  accountClause,
  formatAccountsForContext,
} = require("../lib/assistantAccount");

const router = express.Router();

function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthRangeFromKey(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const monthDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month, 0));
  const endDate = end.toISOString().slice(0, 10);
  return { monthDate, endDate };
}

function roundLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n / 100) * 100;
}

function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startIso, endIso) {
  const a = new Date(`${startIso}T00:00:00.000Z`).getTime();
  const b = new Date(`${endIso}T00:00:00.000Z`).getTime();
  const diff = Math.max(0, b - a);
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function previousRangeFor(baseRange) {
  if (!baseRange?.start || !baseRange?.end) return null;
  const len = daysBetweenInclusive(baseRange.start, baseRange.end);
  const prevEnd = addDays(baseRange.start, -1);
  const prevStart = addDays(prevEnd, -(len - 1));
  return { start: prevStart, end: prevEnd };
}

async function getMonthCategorySnapshot(client, userId, monthDate, endDate, accountId = null) {
  const params = [userId, monthDate, endDate];
  const accountFilter = accountClause("t", accountId, params);

  const rows = await client.query(
    `
    SELECT
      c.id AS category_id,
      c.name AS category_name,
      COALESCE(SUM(t.amount), 0) AS spent,
      b.id AS budget_id,
      b.limit_amount AS limit_amount
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN budgets b
      ON b.user_id = t.user_id
     AND b.category_id = t.category_id
     AND b.month = $2::date
    WHERE t.user_id = $1
      AND t.type = 'expense'
      AND t.transfer_group_id IS NULL
      AND t.date >= $2::date
      AND t.date <= $3::date
      ${accountFilter}
    GROUP BY c.id, c.name, b.id, b.limit_amount
    ORDER BY spent DESC NULLS LAST
    LIMIT 12
    `,
    params
  );

  const enriched = [];
  for (const row of rows.rows) {
    const categoryId = Number(row.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) continue;

    const avgRes = await client.query(
      `
      SELECT COALESCE(AVG(month_total), 0) AS avg_spent
      FROM (
        SELECT DATE_TRUNC('month', t.date) AS m,
               SUM(t.amount) AS month_total
        FROM transactions t
        WHERE t.user_id = $1
          AND t.category_id = $2
          AND t.type = 'expense'
          AND t.transfer_group_id IS NULL
          AND t.date >= (DATE_TRUNC('month', CURRENT_DATE) - (3 * INTERVAL '1 month'))
        GROUP BY DATE_TRUNC('month', t.date)
      ) sub
      `,
      [userId, categoryId]
    );

    const spent = Number(row.spent || 0);
    const limit = row.limit_amount != null ? Number(row.limit_amount || 0) : null;
    const avg3m = Number(avgRes.rows[0]?.avg_spent || 0);
    const suggestedRule = roundLimit(Math.max(spent * 1.1, avg3m > 0 ? avg3m * 1.05 : spent));

    enriched.push({
      category_id: categoryId,
      category: String(row.category_name || "Без категории"),
      spent,
      budget_id: row.budget_id ? Number(row.budget_id) : null,
      limit_amount: limit,
      percent: limit ? Math.round((spent / Math.max(limit, 1)) * 100) : null,
      avg_3m: Math.round(avg3m),
      suggested_limit_rule: suggestedRule,
    });
  }

  return enriched;
}

async function getIncomeSourcesSnapshot(client, userId, startDate, endDate, accountId = null) {
  const params = [userId, startDate, endDate];
  const accountFilter = accountClause("t", accountId, params);

  const rows = await client.query(
    `
    SELECT
      COALESCE(c.name, 'Без категории') AS source,
      COALESCE(SUM(t.amount), 0) AS amount
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = $1
      AND t.type = 'income'
      AND t.transfer_group_id IS NULL
      AND t.date >= $2::date
      AND t.date <= $3::date
      ${accountFilter}
    GROUP BY c.name
    ORDER BY amount DESC
    LIMIT 8
    `,
    params
  );

  return rows.rows.map((r) => ({
    source: String(r.source || "Без категории"),
    amount: Number(r.amount || 0),
  }));
}

async function getExpenseCategoriesSnapshot(client, userId, startDate, endDate, accountId = null) {
  const params = [userId, startDate, endDate];
  const accountFilter = accountClause("t", accountId, params);

  const rows = await client.query(
    `
    SELECT
      COALESCE(c.name, 'Без категории') AS category,
      COALESCE(SUM(t.amount), 0) AS spent
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = $1
      AND t.type = 'expense'
      AND t.transfer_group_id IS NULL
      AND t.date >= $2::date
      AND t.date <= $3::date
      ${accountFilter}
    GROUP BY c.name
    ORDER BY spent DESC
    LIMIT 12
    `,
    params
  );

  return rows.rows.map((r) => ({
    category: String(r.category || "Без категории"),
    spent: Number(r.spent || 0),
  }));
}

async function getDailyTotalsSnapshot(client, userId, startDate, endDate, accountId = null) {
  const params = [userId, startDate, endDate];
  const accountFilter = accountClause("transactions", accountId, params);

  const rows = await client.query(
    `
    SELECT
      date,
      COALESCE(SUM(CASE WHEN type = 'expense' AND transfer_group_id IS NULL THEN amount ELSE 0 END), 0) AS expense,
      COALESCE(SUM(CASE WHEN type = 'income' AND transfer_group_id IS NULL THEN amount ELSE 0 END), 0) AS income
    FROM transactions
    WHERE user_id = $1
      AND date >= $2::date
      AND date <= $3::date
      ${accountFilter}
    GROUP BY date
    ORDER BY date ASC
    `,
    params
  );

  return rows.rows.map((r) => ({
    date: new Date(r.date).toISOString().slice(0, 10),
    expense: Number(r.expense || 0),
    income: Number(r.income || 0),
  }));
}

async function getTopTransactionsSnapshot(client, userId, startDate, endDate, accountId = null) {
  const params = [userId, startDate, endDate];
  const accountFilter = accountClause("t", accountId, params);

  const rows = await client.query(
    `
    SELECT
      t.id,
      t.date,
      t.type,
      t.amount,
      COALESCE(c.name, 'Без категории') AS category,
      COALESCE(a.name, 'Счёт') AS account,
      t.note
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = $1
      AND t.transfer_group_id IS NULL
      AND t.date >= $2::date
      AND t.date <= $3::date
      ${accountFilter}
    ORDER BY t.amount DESC
    LIMIT 8
    `,
    params
  );

  return rows.rows.map((r) => ({
    id: Number(r.id),
    date: new Date(r.date).toISOString().slice(0, 10),
    type: String(r.type),
    amount: Number(r.amount || 0),
    category: String(r.category || "Без категории"),
    account: String(r.account || "Счёт"),
    note: r.note ? String(r.note) : null,
  }));
}

async function getPeriodTotalsSnapshot(client, userId, startDate, endDate, accountId = null) {
  const params = [userId, startDate, endDate];
  const accountFilter = accountClause("transactions", accountId, params);

  const rows = await client.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' AND transfer_group_id IS NULL THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' AND transfer_group_id IS NULL THEN amount ELSE 0 END), 0) AS expense
    FROM transactions
    WHERE user_id = $1
      AND date >= $2::date
      AND date <= $3::date
      ${accountFilter}
    `,
    params
  );

  const income = Number(rows.rows[0]?.income || 0);
  const expense = Number(rows.rows[0]?.expense || 0);

  return {
    income,
    expense,
    net: income - expense,
  };
}

router.get("/status", async (req, res) => {
  try {
    if (!isLlmEnabled()) {
      return res.json({
        enabled: false,
        available: false,
        reason: "LLM_ENABLED=false",
      });
    }

    const health = await checkHfHealth();
    res.json({
      enabled: true,
      ...health,
    });
  } catch (error) {
    console.error("GET /api/assistant/status error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/insights", async (req, res) => {
  try {
    const period = String(req.query.period || "month").toLowerCase();
    const rawAccountId = Number(req.query.account_id);
    const accountId =
      Number.isInteger(rawAccountId) && rawAccountId > 0 ? rawAccountId : null;

    const userResult = await pool.query(
      `SELECT currency FROM users WHERE id = $1 LIMIT 1`,
      [req.userId]
    );

    const currency = userResult.rows[0]?.currency || "RUB";

    let accountName = null;
    if (accountId) {
      const accounts = await getUserAccounts(pool, req.userId);
      accountName = accounts.find((item) => item.id === accountId)?.name || null;
    }

    const base = await generateAssistantInsights(pool, req.userId, currency, {
      period,
      accountId,
      accountName,
    });
    const data = await enrichInsightsWithLlm(base);

    res.json(data);
  } catch (error) {
    console.error("GET /api/assistant/insights error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/chat", async (req, res) => {
  try {
    const question = String(req.body.question || "").trim();
    if (!question) {
      return res.status(400).json({ message: "question is required" });
    }
    const period = String(req.body.period || "month").toLowerCase();
    const wantsThreeMonths = /(за\s*(3|три)\s*месяц)/i.test(question);
    const bodyAccountId = req.body.account_id ?? req.body.accountId ?? null;

    const userResult = await pool.query(
      `SELECT currency FROM users WHERE id = $1 LIMIT 1`,
      [req.userId]
    );
    const currency = userResult.rows[0]?.currency || "RUB";

    const accounts = await getUserAccounts(pool, req.userId);
    const accountScope = resolveAccountScope({
      bodyAccountId,
      question,
      accounts,
    });
    const accountId = accountScope.accountId;

    const base = await generateAssistantInsights(pool, req.userId, currency, {
      period,
      accountId,
      accountName: accountScope.accountName,
    });
    // Keep chat context small for speed (avoid long highlights).
    const full = buildLlmPayload({ ...base.summary, month: base.month }, base.insights);
    const context = {
      month: full.month,
      currency: full.currency,
      income: full.income,
      expense: full.expense,
      net: full.net,
      budget_alerts: full.budget_alerts,
      period: base.period,
      period_label: base.period_label,
      range: base.range,
      account: accountId
        ? { id: accountId, name: accountScope.accountName }
        : null,
      account_scope_label: accountId
        ? `по счёту «${accountScope.accountName}»`
        : "по всем счетам",
      available_accounts: formatAccountsForContext(accounts),
    };

    // If user explicitly asks "за три месяца", override range to last 90 days for snapshots.
    const snapshotRange =
      wantsThreeMonths
        ? (() => {
            const end = new Date().toISOString().slice(0, 10);
            const start = addDays(end, -89);
            return { start, end };
          })()
        : base?.range;

    if (snapshotRange?.start && snapshotRange?.end) {
      if (wantsThreeMonths) {
        context.range = snapshotRange;
        context.range_label = "за последние 3 месяца";
      }
      const periodTotals = await getPeriodTotalsSnapshot(
        pool,
        req.userId,
        snapshotRange.start,
        snapshotRange.end,
        accountId
      );
      context.income = periodTotals.income;
      context.expense = periodTotals.expense;
      context.net = periodTotals.net;

      context.income_sources = await getIncomeSourcesSnapshot(
        pool,
        req.userId,
        snapshotRange.start,
        snapshotRange.end,
        accountId
      );
      context.expense_categories = await getExpenseCategoriesSnapshot(
        pool,
        req.userId,
        snapshotRange.start,
        snapshotRange.end,
        accountId
      );
      context.daily_totals = await getDailyTotalsSnapshot(
        pool,
        req.userId,
        snapshotRange.start,
        snapshotRange.end,
        accountId
      );
      context.top_transactions = await getTopTransactionsSnapshot(
        pool,
        req.userId,
        snapshotRange.start,
        snapshotRange.end,
        accountId
      );

      const prev = previousRangeFor(snapshotRange);
      if (prev) {
        const prevTotals = await getPeriodTotalsSnapshot(
          pool,
          req.userId,
          prev.start,
          prev.end,
          accountId
        );
        context.previous_period = {
          range: prev,
          summary: {
            income: prevTotals.income,
            expense: prevTotals.expense,
            net: prevTotals.net,
            currency,
          },
        };
      }
    }

    if (snapshotRange?.start && snapshotRange?.end && period === "month") {
      const monthKey = getCurrentMonthKey();
      const range = monthRangeFromKey(monthKey);
      if (range) {
        context.month_categories = await getMonthCategorySnapshot(
          pool,
          req.userId,
          range.monthDate,
          range.endDate,
          accountId
        );
      }
    }

    if (accountId && context.period_label && !String(context.period_label).includes("«")) {
      context.period_label = `${context.period_label} ${context.account_scope_label}`;
    }

    const answer = await answerUserQuestion(question, context);

    let llm = { enabled: isLlmEnabled(), available: false, provider: "rules" };
    if (isLlmEnabled()) {
      const health = await checkHfHealth();
      llm = {
        enabled: true,
        available: health.available,
        provider: health.available ? "huggingface" : "rules",
        model: health.model,
        reason: health.reason,
      };
    }

    res.json({
      question,
      answer,
      period,
      account: context.account,
      llm,
    });
  } catch (error) {
    console.error("POST /api/assistant/chat error:", error);
    const msg = String(error?.message || "");
    const status = error?.status;
    const isOverloaded =
      status === 429 ||
      status === 503 ||
      /high memory usage/i.test(msg) ||
      /temporarily unavailable/i.test(msg) ||
      /rate limit/i.test(msg);
    if (isOverloaded) {
      return res.status(503).json({
        message:
          "ИИ временно перегружен на стороне Hugging Face. Подождите 30–60 секунд и повторите запрос, либо попробуйте позже.",
      });
    }
    res.status(500).json({ message: error.message || "Server error" });
  }
});

module.exports = router;
