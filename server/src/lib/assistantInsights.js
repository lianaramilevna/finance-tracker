const { accountClause } = require("./assistantAccount");

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

  return { monthDate, endDate, daysInMonth: end.getUTCDate() };
}

function formatMoneyRub(amount) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);
}

function buildInsight({ type, priority, title, message, action, meta }) {
  return {
    type,
    priority,
    title,
    message,
    action: action || null,
    meta: meta || null,
    ai_message: null,
  };
}

function computeSuggestedLimit({ spent, limit, avg3m }) {
  const base = Math.max(spent * 1.1, avg3m > 0 ? avg3m * 1.05 : spent, limit);
  return Math.ceil(base / 100) * 100;
}

async function getCategoryAvgExpense(client, userId, categoryId, months = 3, accountId = null) {
  const params = [userId, categoryId, months];
  const accountFilter = accountClause("t", accountId, params);

  const result = await client.query(
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
        AND t.date >= (DATE_TRUNC('month', CURRENT_DATE) - ($3::int * INTERVAL '1 month'))
        ${accountFilter}
      GROUP BY DATE_TRUNC('month', t.date)
    ) sub
    `,
    params
  );

  return Number(result.rows[0]?.avg_spent || 0);
}

function formatDateISO(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function resolvePeriodRange(pool, userId, period) {
  const now = new Date();
  const key = String(period || "month").toLowerCase();

  if (key === "week") {
    const end = formatDateISO(now);
    const start = formatDateISO(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    return { period: "week", startDate: start, endDate: end, label: "Неделя" };
  }

  if (key === "all") {
    const res = await pool.query(
      `SELECT MIN(date)::date AS min_date FROM transactions WHERE user_id = $1`,
      [userId]
    );
    const minDate = res.rows[0]?.min_date ? formatDateISO(res.rows[0].min_date) : null;
    const end = formatDateISO(now);
    const start = minDate || end;
    return { period: "all", startDate: start, endDate: end, label: "Всё время" };
  }

  const monthKey = getCurrentMonthKey();
  const range = monthRangeFromKey(monthKey);
  return {
    period: "month",
    startDate: range.monthDate,
    endDate: range.endDate,
    label: "Месяц",
    monthKey,
    daysInMonth: range.daysInMonth,
  };
}

async function generateAssistantInsights(pool, userId, currency = "RUB", options = {}) {
  const accountId =
    Number.isInteger(Number(options.accountId)) && Number(options.accountId) > 0
      ? Number(options.accountId)
      : null;
  const accountName = accountId ? String(options.accountName || "").trim() || null : null;

  const now = new Date();
  const range = await resolvePeriodRange(pool, userId, options.period);
  const periodLabel = accountName ? `${range.label} · ${accountName}` : range.label;
  const daysPassed =
    range.period === "month"
      ? Math.max(1, now.getDate())
      : Math.max(
          1,
          Math.ceil(
            (new Date(range.endDate).getTime() - new Date(range.startDate).getTime()) /
              (24 * 60 * 60 * 1000)
          ) + 1
        );
  const daysInPeriod =
    range.period === "month"
      ? range.daysInMonth || 30
      : Math.max(
          1,
          Math.ceil(
            (new Date(range.endDate).getTime() - new Date(range.startDate).getTime()) /
              (24 * 60 * 60 * 1000)
          ) + 1
        );

  const insights = [];

  const periodParams = [userId, range.startDate, range.endDate];
  const periodAccountFilter = accountClause("transactions", accountId, periodParams);

  const periodStats = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN type = 'income' AND transfer_group_id IS NULL THEN amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN type = 'expense' AND transfer_group_id IS NULL THEN amount ELSE 0 END), 0) AS expense
    FROM transactions
    WHERE user_id = $1
      AND date >= $2::date
      AND date <= $3::date
      ${periodAccountFilter}
    `,
    periodParams
  );

  const income = Number(periodStats.rows[0]?.income || 0);
  const expense = Number(periodStats.rows[0]?.expense || 0);
  const net = income - expense;

  if (expense > 0 && range.period === "month") {
    const projectedExpense = Math.round((expense / Math.max(1, daysPassed)) * daysInPeriod);
    const projectedDelta = projectedExpense - expense;

    insights.push(
      buildInsight({
        type: "forecast",
        priority: projectedExpense > income && income > 0 ? "high" : "medium",
        title: "Прогноз до конца месяца",
        message: `При текущем темпе расходы${accountName ? ` по счёту «${accountName}»` : ""} к концу месяца могут составить около ${formatMoneyRub(projectedExpense)}. До конца месяца это ещё примерно ${formatMoneyRub(projectedDelta)} сверх уже учтённых ${formatMoneyRub(expense)}.`,
        action: { label: "Открыть аналитику", path: "/analytics" },
        meta: {
          kind: "forecast",
          projected_expense: projectedExpense,
          projected_delta: projectedDelta,
          current_expense: expense,
        },
      })
    );
  }

  if (income > 0) {
    const savingsRate = Math.round((net / income) * 100);
    insights.push(
      buildInsight({
        type: savingsRate >= 20 ? "success" : savingsRate >= 0 ? "info" : "warning",
        priority: savingsRate < 0 ? "high" : "low",
        title: "Норма сбережений",
        message:
          savingsRate >= 20
            ? `Отлично: вы откладываете около ${savingsRate}% дохода в этом месяце.`
            : savingsRate >= 0
            ? `Сейчас сбережения ~${savingsRate}% от дохода. Попробуйте удерживать 20%+.`
            : `Расходы превышают доходы на ${formatMoneyRub(Math.abs(net))} в этом месяце.`,
        action: { label: "Бюджет", path: "/budgets" },
      })
    );
  }

  const topCategoryParams = [userId, range.startDate, range.endDate];
  const topCategoryAccountFilter = accountClause("t", accountId, topCategoryParams);

  const topCategory = await pool.query(
    `
    SELECT c.name AS category, COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = $1
      AND t.type = 'expense'
      AND t.transfer_group_id IS NULL
      AND t.date >= $2::date
      AND t.date <= $3::date
      ${topCategoryAccountFilter}
    GROUP BY c.name
    ORDER BY total DESC
    LIMIT 1
    `,
    topCategoryParams
  );

  if (topCategory.rows[0]) {
    const cat = topCategory.rows[0];
    insights.push(
      buildInsight({
        type: "info",
        priority: "low",
        title: "Главная статья расходов",
        message: `Больше всего за период уходит на «${cat.category || "Без категории"}» — ${formatMoneyRub(cat.total)}${accountName ? ` (счёт «${accountName}»)` : ""}.`,
        action: { label: "Операции", path: "/transactions" },
      })
    );
  }

  const budgetParams = [userId, range.endDate, range.startDate];
  const budgetSpentAccountFilter = accountId
    ? ` AND t.account_id = $${budgetParams.push(accountId)}`
    : "";

  const budgets =
    range.period === "month"
      ? await pool.query(
          `
          SELECT
            b.id AS budget_id,
            b.category_id,
            b.limit_amount,
            COALESCE(c.name, 'Категория') AS category_name,
            (
              SELECT COALESCE(SUM(t.amount), 0)
              FROM transactions t
              WHERE t.user_id = b.user_id
                AND t.category_id = b.category_id
                AND t.type = 'expense'
                AND t.transfer_group_id IS NULL
                AND t.date >= b.month
                AND t.date <= $2::date
                ${budgetSpentAccountFilter}
            ) AS spent
          FROM budgets b
          LEFT JOIN categories c ON c.id = b.category_id
          WHERE b.user_id = $1
            AND b.month = $3::date
          `,
          budgetParams
        )
      : { rows: [] };

  for (const row of budgets.rows) {
    const limit = Number(row.limit_amount || 0);
    const spent = Number(row.spent || 0);
    if (limit <= 0) continue;

    const percent = Math.round((spent / limit) * 100);
    const avg3m = await getCategoryAvgExpense(pool, userId, row.category_id, 3, accountId);
    const suggestedLimit = computeSuggestedLimit({ spent, limit, avg3m });
    const overBy = Math.max(spent - limit, 0);
    const isRecurringOverspend = spent > limit && avg3m > 0 && spent >= avg3m * 0.9;

    const budgetMeta = {
      kind: "budget",
      budget_id: row.budget_id,
      category_id: row.category_id,
      category_name: row.category_name,
      limit,
      spent,
      over_by: overBy,
      percent,
      avg_3m: Math.round(avg3m),
      suggested_limit: suggestedLimit,
      status: spent > limit ? "exceeded" : percent >= 80 ? "warning" : "ok",
      increase_limit: isRecurringOverspend,
    };

    if (spent > limit) {
      const ruleHint = isRecurringOverspend
        ? ` Рекомендуемый лимит: ${formatMoneyRub(suggestedLimit)} (средний расход ~${formatMoneyRub(avg3m)}/мес).`
        : " Похоже на разовый всплеск — лимит можно не повышать.";

      insights.push(
        buildInsight({
          type: "warning",
          priority: "high",
          title: `Бюджет превышен: ${row.category_name}`,
          message: `Потрачено ${formatMoneyRub(spent)} при лимите ${formatMoneyRub(limit)} (+${formatMoneyRub(overBy)}).${ruleHint}`,
          action: isRecurringOverspend
            ? {
                label: `Поднять лимит до ${formatMoneyRub(suggestedLimit)}`,
                path: "/budgets",
                apply_budget: {
                  budget_id: row.budget_id,
                  limit_amount: suggestedLimit,
                },
              }
            : { label: "Бюджеты", path: "/budgets" },
          meta: budgetMeta,
        })
      );
    } else if (percent >= 80) {
      insights.push(
        buildInsight({
          type: "warning",
          priority: "medium",
          title: `Бюджет почти исчерпан: ${row.category_name}`,
          message: `Использовано ${percent}% лимита (${formatMoneyRub(spent)} из ${formatMoneyRub(limit)}).`,
          action: { label: "Бюджеты", path: "/budgets" },
          meta: budgetMeta,
        })
      );
    }
  }

  if (accountId) {
    const selectedAccount = await pool.query(
      `
      SELECT id, name, balance
      FROM accounts
      WHERE user_id = $1
        AND id = $2
        AND COALESCE(is_archived, false) = false
      LIMIT 1
      `,
      [userId, accountId]
    );

    const acc = selectedAccount.rows[0];
    if (acc && Number(acc.balance) < 0) {
      insights.push(
        buildInsight({
          type: "warning",
          priority: "high",
          title: `Отрицательный баланс: ${acc.name}`,
          message: `На выбранном счёте «${acc.name}» ${formatMoneyRub(acc.balance)}. Проверьте операции или переведите средства с другого счёта.`,
          action: { label: "Счета", path: "/accounts" },
        })
      );
    }
  } else {
    const negativeAccounts = await pool.query(
      `
      SELECT name, balance
      FROM accounts
      WHERE user_id = $1
        AND COALESCE(is_archived, false) = false
        AND balance < 0
      ORDER BY balance ASC
      LIMIT 3
      `,
      [userId]
    );

    const positiveAccounts = await pool.query(
      `
      SELECT name, balance
      FROM accounts
      WHERE user_id = $1
        AND COALESCE(is_archived, false) = false
        AND balance > 0
      ORDER BY balance DESC
      LIMIT 3
      `,
      [userId]
    );

    for (const acc of negativeAccounts.rows) {
      const bestSource = positiveAccounts.rows[0] || null;
      const extraHint = bestSource
        ? ` На счёте «${bestSource.name}» есть ${formatMoneyRub(bestSource.balance)} — можно перевести часть средств.`
        : "";

      insights.push(
        buildInsight({
          type: "warning",
          priority: "high",
          title: `Отрицательный баланс: ${acc.name}`,
          message: `На счёте «${acc.name}» ${formatMoneyRub(acc.balance)}.${extraHint}`,
          action: { label: "Счета", path: "/accounts" },
        })
      );
    }
  }

  const goals = await pool.query(
    `
    SELECT name, target_amount, current_amount, target_date, status
    FROM goals
    WHERE user_id = $1
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 5
    `,
    [userId]
  );

  for (const goal of goals.rows) {
    const target = Number(goal.target_amount || 0);
    const current = Number(goal.current_amount || 0);
    const remaining = Math.max(target - current, 0);
    const progress = target > 0 ? Math.round((current / target) * 100) : 0;

    if (goal.target_date) {
      const deadline = new Date(goal.target_date);
      const daysLeft = Math.ceil((deadline - now) / (24 * 60 * 60 * 1000));

      if (daysLeft > 0 && daysLeft <= 60 && progress < 80) {
        const monthlyNeed = Math.ceil(remaining / Math.max(1, Math.ceil(daysLeft / 30)));
        insights.push(
          buildInsight({
            type: "info",
            priority: "medium",
            title: `Цель «${goal.name}»`,
            message: `До дедлайна ${daysLeft} дн., осталось ${formatMoneyRub(remaining)}. Рекомендуемый взнос ~${formatMoneyRub(monthlyNeed)}/мес.`,
            action: { label: "Цели", path: "/goals" },
          })
        );
      }
    } else if (progress > 0 && progress < 100) {
      insights.push(
        buildInsight({
          type: "info",
          priority: "low",
          title: `Цель «${goal.name}»`,
          message: `Прогресс ${progress}%. Осталось накопить ${formatMoneyRub(remaining)}.`,
          action: { label: "Цели", path: "/goals" },
        })
      );
    }
  }

  const txCountParams = [userId, range.startDate, range.endDate];
  const txCountAccountFilter = accountClause("transactions", accountId, txCountParams);

  const txCount = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM transactions
    WHERE user_id = $1
      AND date >= $2::date
      AND date <= $3::date
      ${txCountAccountFilter}
    `,
    txCountParams
  );

  if (Number(txCount.rows[0]?.count || 0) < 5) {
    insights.push(
      buildInsight({
        type: "info",
        priority: "low",
        title: "Мало операций в этом месяце",
        message: "Импортируйте банковскую выписку — помощник точнее построит прогнозы и рекомендации.",
        action: { label: "Импорт", path: "/import" },
      })
    );
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    generated_at: new Date().toISOString(),
    period: range.period,
    period_label: periodLabel,
    range: { start: range.startDate, end: range.endDate },
    month: range.monthKey || null,
    account: accountId ? { id: accountId, name: accountName } : null,
    account_scope_label: accountId ? `по счёту «${accountName}»` : "по всем счетам",
    summary: {
      income,
      expense,
      net,
      currency,
      transaction_count: Number(txCount.rows[0]?.count || 0),
    },
    insights,
  };
}

module.exports = {
  generateAssistantInsights,
};
