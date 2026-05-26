const { chat, extractJsonObject, isLlmEnabled } = require("./llm/huggingface");

const SYSTEM_PROMPT = `Ты финансовый помощник приложения Balance. Отвечай только на русском языке.
Используй ТОЛЬКО цифры из переданного JSON. Не выдумывай операции и категории.
Формат ответа — строго JSON без markdown:
{
  "overview": "1-2 предложения об общей ситуации за месяц",
  "budget_advice": [
    {
      "category": "название категории как во входных данных",
      "message": "2-3 предложения: что произошло и что делать",
      "suggested_limit": число или null,
      "increase_limit": true/false
    }
  ]
}
Если перерасход повторяется (avg_3m близко к spent или spent > limit), рекомендуй increase_limit true и suggested_limit не ниже suggested_limit из данных.
Если разовый всплеск (spent сильно выше avg_3m), increase_limit false.
Не используй английские названия месяцев и латиницу.
Если net < 0, не называй баланс положительным.
Запрещено использовать английские слова.`;

const CHAT_PROMPT = `Ты финансовый помощник приложения Balance. Отвечай только на русском языке.
Используй ТОЛЬКО данные из переданного JSON (цифры, категории, бюджеты). Ничего не выдумывай.
Если в JSON есть account или account_scope_label — отвечай только по этому счёту, не смешивай с другими.
Список available_accounts — все счета пользователя; если в вопросе назван банк/карта, сопоставь с name или aliases.

Формат ответа для пользователя:
- 2–5 коротких предложений, без списков и без английских слов
- никаких приветствий («дорогой клиент» и т.п.)
- если вопрос про бюджет/лимит:
  - если лимит по категории не найден во входных данных: предложи завести бюджет и назвать примерный лимит (ориентир — текущий расход за месяц + 10%)
  - если лимит найден: не предлагай «снизить лимит», если пользователь не превышает лимит и нет признаков перерасхода
  - рекомендуемую сумму называй только если она есть во входных данных (например suggested_limit_rule) или если лимита нет (тогда считай от spent)
- запрещено отвечать в JSON/markdown и использовать фигурные скобки { }`;

function formatMoney(amount, currency = "RUB") {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  } catch {
    return `${Math.round(Number(amount) || 0)} ${currency}`;
  }
}

function buildForecastOverviewPart(result, currency = "RUB") {
  const forecast = (result?.insights || []).find((item) => item.type === "forecast");
  if (!forecast) return "";

  const income = Number(result?.summary?.income || 0);
  const expense = Number(result?.summary?.expense || 0);
  const meta = forecast.meta || {};
  const projected = Number(meta.projected_expense ?? 0);
  const delta = Number(meta.projected_delta ?? 0);

  if (!Number.isFinite(projected) || projected <= 0) return "";

  if (income > 0 && projected > income) {
    return ` Прогноз: к концу месяца расходы могут выйти на ${formatMoney(projected, currency)} — это больше доходов (${formatMoney(income, currency)}). До конца месяца осталось потратить примерно ${formatMoney(Math.max(delta, 0), currency)}.`;
  }

  return ` Прогноз: к концу месяца расходы около ${formatMoney(projected, currency)} (сейчас ${formatMoney(expense, currency)}). До конца месяца — ещё примерно ${formatMoney(Math.max(delta, 0), currency)}.`;
}

function buildRuleOverview(result) {
  const income = Number(result?.summary?.income || 0);
  const expense = Number(result?.summary?.expense || 0);
  const net = Number(result?.summary?.net || 0);
  const currency = result?.summary?.currency || "RUB";
  const scope =
    result?.account_scope_label && result.account_scope_label !== "по всем счетам"
      ? result.account_scope_label
      : null;
  const label = result?.period_label || "За период";

  const warnings = (result?.insights || []).filter((i) => i.type === "warning");
  const topWarning = warnings[0] || null;

  const scopePart = scope ? `${label} ${scope}` : label;

  const base =
    net >= 0
      ? `${scopePart}: доходы ${formatMoney(income, currency)}, расходы ${formatMoney(expense, currency)}, остаток ${formatMoney(net, currency)}.`
      : `${scopePart}: доходы ${formatMoney(income, currency)}, расходы ${formatMoney(expense, currency)}, перерасход ${formatMoney(Math.abs(net), currency)}.`;

  const warnPart =
    warnings.length > 0
      ? ` Внимание: ${warnings.length} предупреждени${warnings.length === 1 ? "е" : warnings.length <= 4 ? "я" : "й"} (например, «${topWarning?.title || "бюджет или счёт"}»).`
      : " Критичных предупреждений нет.";

  const forecastPart = buildForecastOverviewPart(result, currency);

  return `${base}${forecastPart}${warnPart}`.trim();
}

function isBadRussianOverview(text, currency = "RUB") {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t.length < 24) return true;
  if (/[A-Za-z]/.test(t)) return true;
  if (currency === "RUB" && /(рупи|рупий|rupee|usd|доллар|евро|тенге|гривн)/i.test(t)) return true;
  if (/\bскидк/i.test(t) && !/(скидк[аи].{0,20}(магазин|покуп|акци))/i.test(t)) return true;
  if (/общая ситуация/i.test(t) && !/(доход|расход|остаток|перерасход|прогноз)/i.test(t)) return true;
  return false;
}

function isListyOrSalesy(text) {
  const t = String(text || "");
  if (/^\s*дорог(ой|ая)\s+клиент/i.test(t)) return true;
  if (/(^|\n)\s*[\-\*]\s+/.test(t)) return true; // markdown lists
  return false;
}

function pickTopBySpent(monthCategories = [], limit = 3) {
  return [...(monthCategories || [])]
    .filter((x) => x && x.category && Number(x.spent || 0) > 0)
    .sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0))
    .slice(0, limit);
}

function accountScopePrefix(contextPayload) {
  if (contextPayload?.account?.name) {
    return `По счёту «${contextPayload.account.name}» `;
  }
  return "";
}

function expenseCategoriesForContext(contextPayload) {
  if (contextPayload?.month_categories?.length > 0) {
    return contextPayload.month_categories;
  }
  return (contextPayload?.expense_categories || []).map((item) => ({
    category: item.category,
    spent: item.spent,
  }));
}

function buildTopExpenseAnswer(contextPayload) {
  const currency = contextPayload?.currency || "RUB";
  const scope = accountScopePrefix(contextPayload);
  const label = contextPayload?.period_label || "за выбранный период";
  const top = pickTopBySpent(expenseCategoriesForContext(contextPayload), 3);
  if (top.length === 0) {
    return `${scope}За ${label} нет расходов по выбранному счёту.`.trim();
  }
  const first = top[0];
  const rest = top.slice(1);
  const restText =
    rest.length > 0
      ? ` Далее: ${rest.map((r) => `«${r.category}» ${formatMoney(r.spent, currency)}`).join(", ")}.`
      : "";
  return `${scope}Самые большие траты ${label} — «${first.category}»: ${formatMoney(first.spent, currency)}.${restText}`.trim();
}

function formatDateRu(iso) {
  const raw = String(iso || "").slice(0, 10);
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function buildShowCategoryAnswer(question, contextPayload) {
  const currency = contextPayload?.currency || "RUB";
  const cats =
    contextPayload?.month_categories?.length > 0
      ? contextPayload.month_categories
      : (contextPayload?.expense_categories || []).map((c) => ({
          category: c.category,
          spent: c.spent,
        }));

  const snap = findCategoryMention(question, cats);
  if (!snap) {
    return "Уточните категорию как в приложении (например «продукты»), и я покажу расходы по ней.";
  }

  const txs = (contextPayload?.top_transactions || [])
    .filter((t) => t.type === "expense" && normalizeText(t.category) === normalizeText(snap.category))
    .slice(0, 5);

  if (txs.length > 0) {
    const list = txs
      .map((t) => `${formatDateRu(t.date)} — ${formatMoney(t.amount, currency)}`)
      .join("; ");
    return `По «${snap.category}» за период: всего ${formatMoney(snap.spent, currency)}. Крупные операции: ${list}.`;
  }

  return `По «${snap.category}» за период потрачено ${formatMoney(snap.spent, currency)}${snap.limit_amount != null ? ` при лимите ${formatMoney(snap.limit_amount, currency)}` : ""}.`;
}

function buildNearLimitAnswer(contextPayload) {
  const currency = contextPayload?.currency || "RUB";
  const alerts = (contextPayload?.budget_alerts || []).filter(
    (b) => b && (b.status === "warning" || b.status === "exceeded")
  );
  if (alerts.length === 0) {
    return "Сейчас нет категорий близко к лимиту или с перерасходом. Можно проверить бюджеты в разделе «Бюджет».";
  }
  const top = alerts.slice(0, 3);
  return `Близко к лимиту или с перерасходом: ${top
    .map((b) => {
      const pct = b.percent != null ? ` (${b.percent}%)` : "";
      return `«${b.category}» — ${formatMoney(b.spent, currency)} из ${formatMoney(b.limit, currency)}${pct}`;
    })
    .join("; ")}.`;
}

function buildBudgetRunwayAnswer(contextPayload) {
  const currency = contextPayload?.currency || "RUB";
  const income = Number(contextPayload.income || 0);
  const expense = Number(contextPayload.expense || 0);
  const net = Number(contextPayload.net || 0);

  if (expense <= 0) {
    return "За период расходов почти нет — к концу месяца по текущим данным запас сохранится.";
  }

  const range = contextPayload?.range;
  if (!range?.start || !range?.end) {
    return `Итог за период: ${net >= 0 ? "+" : "−"}${formatMoney(Math.abs(net), currency)}. Для прогноза до конца месяца выберите период «Месяц».`;
  }

  const start = new Date(`${range.start}T12:00:00`);
  const end = new Date(`${range.end}T12:00:00`);
  const today = new Date();
  const periodEnd = end > today ? end : today;
  const daysPassed = Math.max(1, Math.ceil((today - start) / (24 * 60 * 60 * 1000)) + 1);
  const daysTotal = Math.max(1, Math.ceil((periodEnd - start) / (24 * 60 * 60 * 1000)) + 1);
  const daysLeft = Math.max(0, daysTotal - daysPassed);
  const daily = expense / daysPassed;
  const projected = expense + daily * daysLeft;

  if (projected > income && income > 0) {
    return `При текущем темпе расходы к концу периода могут достичь ~${formatMoney(projected, currency)} при доходах ${formatMoney(income, currency)}. Стоит сократить траты на ${formatMoney(projected - income, currency)} или пересмотреть бюджеты.`;
  }

  return `При текущем темпе к концу периода расходы ~${formatMoney(projected, currency)}${income > 0 ? `, доходы ${formatMoney(income, currency)}` : ""}. Запас по итогу около ${formatMoney(Math.max(income - projected, net), currency)}.`;
}

function buildPeakDaysAnswer(contextPayload) {
  const currency = contextPayload?.currency || "RUB";
  const daily = Array.isArray(contextPayload?.daily_totals) ? contextPayload.daily_totals : [];
  const top = [...daily]
    .filter((d) => Number(d.expense || 0) > 0)
    .sort((a, b) => Number(b.expense) - Number(a.expense))
    .slice(0, 3);
  if (top.length === 0) {
    return "За период нет данных по дням с расходами.";
  }
  return `Больше всего тратили: ${top
    .map((d) => `${formatDateRu(d.date)} — ${formatMoney(d.expense, currency)}`)
    .join(", ")}.`;
}

function buildIncomeSourcesAnswer(contextPayload) {
  const currency = contextPayload?.currency || "RUB";
  const scope = accountScopePrefix(contextPayload);
  const sources = Array.isArray(contextPayload?.income_sources)
    ? contextPayload.income_sources
    : [];
  const top = sources
    .filter((x) => x && x.source && Number(x.amount || 0) > 0)
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, 3);
  if (top.length === 0) return null;

  const parts = top.map((s) => `«${s.source}» ${formatMoney(s.amount, currency)}`);
  return `${scope}Основные источники доходов за период: ${parts.join(", ")}.`.trim();
}

function inferDeterministicQna(question) {
  const q = normalizeText(question);
  if (!q) return null;
  const asksTopExpense =
    /(сам(ые)?\s+больш(ие|ая)\s+трат|куда\s+больше\s+всего\s+ушл|на\s+что\s+больше\s+всего\s+потрачен|главн(ые|ая)\s+трат)/.test(
      q
    );
  const asksIncomeSources =
    /(откуда\s+(были\s+)?доход|источник(и)?\s+доход|по\s+доход(ам|у)|доходы\s+откуда)/.test(q);

  const asksWhyMoreExpense =
    /(почему\s+.*(расход|траты).*(больш|вырос|увелич)|почему\s+в\s+этом\s+месяце\s+больше\s+расход)/.test(q);
  const asksMainProblems =
    /(главн(ые|ая)\s+финансов(ые|ая)\s+проблем|что\s+не\s+так\s+с\s+финанс|основн(ые|ая)\s+проблем)/.test(
      q
    );
  const asksComparePrev =
    /(по\s+сравнен(ию|ии)\s+с\s+прошл|что\s+изменил(ось|ось)\s+по\s+сравнен|прошл(ый|ого)\s+месяц)/.test(
      q
    );
  const asksSituationNow =
    /(как\s+выглядит\s+.*ситуац|как\s+дела\s+с\s+финанс|финансовая\s+ситуац.*сейчас)/.test(q);

  const asksWhereTooMuch =
    /(где\s+я\s+трачу\s+слишком\s+много|какие\s+категори.*можно\s+сократ|лишн(ие|яя)\s+трат|где\s+перебор)/.test(
      q
    );
  const asksUnusual =
    /(необычн|аномали|подозрит|странн).*(трат|операц)/.test(q);
  const asksWhyCategoryGrew = /(почему\s+выросли\s+расходы\s+на|почему\s+вырос(ли)?\s+.*(еда|транспорт|развлеч|категор))/i.test(
    q
  );

  const asksBudgetRunway =
    /(уложусь\s+ли\s+в\s+бюджет|хватит\s+ли\s+бюджет|до\s+конца\s+месяца\s+бюджет|риск\s+перерасход)/.test(q);
  const asksNearLimit =
    /(близок\s+к\s+лимит|почти\s+исчерпан|по\s+каким\s+категор.*лимит|где\s+я\s+перерасход)/.test(
      q
    );

  const asksBigTransactions =
    /(крупн(ые|ая)\s+расход|найди\s+крупные\s+расход|сам(ые)?\s+дорог(ие|ая)\s+операц)/.test(q);
  const asksShowCategory =
    /(покажи\s+все\s+расходы\s+по\s+категор|расходы\s+по\s+категор)/.test(q);
  const asksWhatTransaction = /(что\s+это\s+за\s+транзакц|что\s+за\s+операц)/.test(q);

  return {
    asksTopExpense,
    asksIncomeSources,
    asksWhyMoreExpense,
    asksMainProblems,
    asksComparePrev,
    asksSituationNow,
    asksWhereTooMuch,
    asksUnusual,
    asksWhyCategoryGrew,
    asksBudgetRunway,
    asksNearLimit,
    asksBigTransactions,
    asksShowCategory,
    asksWhatTransaction,
  };
}

async function parseEnrichJsonWithRetry(raw, payloadForPrompt) {
  try {
    return extractJsonObject(raw);
  } catch {
    const repaired = await chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "Твой предыдущий ответ был НЕвалидным JSON. Верни ТОЛЬКО валидный JSON без markdown и без пояснений.\n" +
            `Данные:\n${JSON.stringify(payloadForPrompt, null, 2)}\n\n` +
            `Невалидный ответ:\n${String(raw || "").slice(0, 4000)}`,
        },
      ],
      { maxTokens: 320, temperature: 0.2 }
    );
    return extractJsonObject(repaired);
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeRu(text) {
  return normalizeText(text)
    .split(/[^a-zа-я0-9]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function levenshtein(a, b) {
  const s = String(a || "");
  const t = String(b || "");
  if (s === t) return 0;
  if (!s) return t.length;
  if (!t) return s.length;

  const m = s.length;
  const n = t.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;

  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }

  return dp[n];
}

function findCategoryMention(question, monthCategories = []) {
  const q = normalizeText(question);
  if (!q) return null;

  const qTokens = tokenizeRu(q);
  if (qTokens.length === 0) return null;

  // 1) exact/substring match first
  const sorted = [...monthCategories].sort(
    (a, b) => String(b.category || "").length - String(a.category || "").length
  );

  for (const item of sorted) {
    const name = normalizeText(item.category);
    if (!name) continue;
    if (q.includes(name)) return item;
  }

  // 2) fuzzy token match for typos (e.g. "продуткы" -> "продукты")
  let best = null;
  let bestScore = Infinity;

  for (const item of monthCategories) {
    const name = String(item.category || "").trim();
    if (!name) continue;
    const cTokens = tokenizeRu(name);
    if (cTokens.length === 0) continue;

    for (const qt of qTokens) {
      for (const ct of cTokens) {
        if (qt.length < 4 || ct.length < 4) continue;
        const dist = levenshtein(qt, ct);
        const allowed = Math.max(1, Math.floor(Math.min(qt.length, ct.length) / 4));
        if (dist <= allowed && dist < bestScore) {
          bestScore = dist;
          best = item;
        }
      }
    }
  }

  return best;
}

function inferLimitIntent(question) {
  const q = normalizeText(question);
  const wantsRaise =
    /(подня(ть|л|ли|в|вши|тие)|подним(и|ем|ете|у|ут|ать)|повыс|увелич|больше)/.test(q);
  const wantsLower = /(сниз|уменьш|меньше)/.test(q);
  return { wantsRaise, wantsLower };
}

function formatRub(value) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function buildDeterministicLimitAnswer({ question, snapshot, currency = "RUB" }) {
  if (!snapshot) return null;

  const { wantsRaise, wantsLower } = inferLimitIntent(question);
  if (!wantsRaise && !wantsLower) return null;

  const spent = Number(snapshot.spent || 0);
  const limit = snapshot.limit_amount != null ? Number(snapshot.limit_amount || 0) : null;
  const percent = limit ? Math.round((spent / Math.max(limit, 1)) * 100) : null;
  const suggested = snapshot.suggested_limit_rule != null ? Number(snapshot.suggested_limit_rule) : null;

  const category = snapshot.category || "категория";

  if (!limit) {
    const proposed = Math.ceil((spent * 1.1) / 100) * 100;
    return `По «${category}» у вас пока нет бюджета. В этом месяце потрачено ${formatRub(spent)} (${currency}). Можно завести лимит примерно ${formatRub(proposed)} — это текущие расходы + 10%.`;
  }

  if (wantsRaise) {
    if (spent <= limit * 0.8) {
      return `Сейчас по «${category}» потрачено ${formatRub(spent)} из ${formatRub(limit)} (${percent}%). Поднимать лимит не нужно — запас большой.`;
    }

    if (spent > limit) {
      const over = spent - limit;
      const next = suggested || Math.ceil((spent * 1.1) / 100) * 100;
      return `По «${category}» уже перерасход ${formatRub(over)}: ${formatRub(spent)} при лимите ${formatRub(limit)}. Если это повторяется, логично поднять лимит до ${formatRub(next)}.`;
    }

    // 80–100%
    return `По «${category}» потрачено ${formatRub(spent)} из ${formatRub(limit)} (${percent}%). Лимит можно оставить как есть и просто контролировать траты до конца месяца.`;
  }

  if (wantsLower) {
    if (spent < limit * 0.3) {
      const proposed = Math.max(Math.ceil((spent * 1.5) / 100) * 100, 500);
      return `Сейчас по «${category}» потрачено ${formatRub(spent)} из ${formatRub(limit)} (${percent}%). Снижать лимит можно, но лучше дождаться конца месяца. Если хотите уменьшить уже сейчас — попробуйте ${formatRub(proposed)}.`;
    }
    return `По «${category}» потрачено ${formatRub(spent)} из ${formatRub(limit)} (${percent}%). Снижать лимит сейчас рискованно — он может не хватить до конца месяца.`;
  }

  return null;
}

function roundLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.ceil(n / 100) * 100;
}

function buildLlmPayload(summary, insights) {
  const budgetAlerts = insights
    .filter((item) => item.meta?.kind === "budget")
    .map((item) => ({
      category: item.meta.category_name,
      limit: item.meta.limit,
      spent: item.meta.spent,
      over_by: item.meta.over_by,
      percent: item.meta.percent,
      avg_3m: item.meta.avg_3m,
      suggested_limit: item.meta.suggested_limit,
      status: item.meta.status,
    }));

  return {
    month: summary.month || null,
    currency: summary.currency || "RUB",
    income: summary.income,
    expense: summary.expense,
    net: summary.net,
    budget_alerts: budgetAlerts,
    highlights: insights.slice(0, 6).map((item) => ({
      title: item.title,
      message: item.message,
      type: item.type,
      priority: item.priority,
    })),
  };
}

function mergeBudgetAdvice(insights, budgetAdvice) {
  if (!Array.isArray(budgetAdvice) || budgetAdvice.length === 0) {
    return insights;
  }

  const byCategory = new Map(
    budgetAdvice.map((row) => [String(row.category || "").trim().toLowerCase(), row])
  );

  return insights.map((insight) => {
    if (insight.meta?.kind !== "budget") {
      return insight;
    }

    const key = String(insight.meta.category_name || "").trim().toLowerCase();
    const advice = byCategory.get(key);
    if (!advice) {
      return insight;
    }

    const llmLimit = roundLimit(advice.suggested_limit);
    const finalLimit = llmLimit || insight.meta.suggested_limit;

    return {
      ...insight,
      ai_message: String(advice.message || "").trim() || null,
      meta: {
        ...insight.meta,
        suggested_limit: finalLimit,
        increase_limit: Boolean(advice.increase_limit),
        llm_suggested_limit: llmLimit,
      },
      action:
        advice.increase_limit && finalLimit && insight.meta.budget_id
          ? {
              label: `Поднять лимит до ${finalLimit}`,
              path: "/budgets",
              apply_budget: {
                budget_id: insight.meta.budget_id,
                limit_amount: finalLimit,
              },
            }
          : insight.action,
    };
  });
}

async function enrichInsightsWithLlm(result) {
  if (!isLlmEnabled()) {
    return {
      ...result,
      llm: { enabled: false, available: false, reason: "disabled" },
      ai_overview: buildRuleOverview(result),
    };
  }

  const payload = buildLlmPayload(
    { ...result.summary, month: result.month },
    result.insights
  );

  const hasBudgetAlerts = payload.budget_alerts.length > 0;
  if (!hasBudgetAlerts && payload.highlights.length === 0) {
    return {
      ...result,
      llm: { enabled: true, available: false, reason: "no_data" },
    };
  }

  try {
    const raw = await chat([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Проанализируй данные и верни JSON:\n${JSON.stringify(payload, null, 2)}`,
      },
    ], { maxTokens: 320, temperature: 0.3 });

    const parsed = await parseEnrichJsonWithRetry(raw, payload);
    const insights = mergeBudgetAdvice(result.insights, parsed.budget_advice);

    return {
      ...result,
      insights,
      ai_overview: buildRuleOverview({ ...result, insights }),
      llm: {
        enabled: true,
        available: true,
        provider: "huggingface",
        model: process.env.HF_MODEL || "meta-llama/Llama-3.2-1B-Instruct",
      },
    };
  } catch (error) {
    console.error("LLM enrich error:", error.message);
    return {
      ...result,
      ai_overview: buildRuleOverview(result),
      llm: {
        enabled: true,
        // JSON parsing/format errors are not connectivity failures.
        available: true,
        provider: "huggingface",
        reason: error.message,
      },
    };
  }
}

function tryDeterministicAnswer(question, contextPayload) {
  const detQna = inferDeterministicQna(question);
  if (detQna?.asksTopExpense) {
    const ans = buildTopExpenseAnswer(contextPayload);
    if (ans) return ans;
  }
  if (detQna?.asksIncomeSources) {
    const ans = buildIncomeSourcesAnswer(contextPayload);
    if (ans) return ans;
  }
  if (detQna?.asksComparePrev && contextPayload?.previous_period?.summary) {
    const curExp = Number(contextPayload.expense || 0);
    const prevExp = Number(contextPayload.previous_period.summary.expense || 0);
    const currency = contextPayload.currency || "RUB";
    const diff = curExp - prevExp;
    const sign = diff >= 0 ? "+" : "−";
    const scope = accountScopePrefix(contextPayload);
    return `${scope}По сравнению с предыдущим периодом расходы ${sign}${formatMoney(Math.abs(diff), currency)} (${formatMoney(curExp, currency)} сейчас против ${formatMoney(prevExp, currency)} раньше). Если хотите, уточните категорию — покажу, где именно выросло.`.trim();
  }
  if (detQna?.asksSituationNow) {
    const currency = contextPayload.currency || "RUB";
    const label = contextPayload.period_label || "Период";
    const scope = accountScopePrefix(contextPayload);
    return `${scope}${label}: доходы ${formatMoney(contextPayload.income || 0, currency)}, расходы ${formatMoney(contextPayload.expense || 0, currency)}, итог ${Number(contextPayload.net || 0) >= 0 ? "+" : "−"}${formatMoney(Math.abs(contextPayload.net || 0), currency)}. Самая затратная категория — спросите «на что я трачу больше всего?».`.trim();
  }
  if (detQna?.asksMainProblems) {
    const warnings = Array.isArray(contextPayload?.budget_alerts) ? contextPayload.budget_alerts.filter((b) => b && (b.status === "exceeded" || b.status === "warning")) : [];
    const currency = contextPayload.currency || "RUB";
    const parts = [];
    if (Number(contextPayload.net || 0) < 0) parts.push("расходы выше доходов");
    if (warnings.length > 0) parts.push(`напряжённые бюджеты (${warnings.length} катег.)`);
    if (parts.length === 0) return "Явных проблем не видно: вы укладываетесь по итогам и нет критичных предупреждений. Можно сосредоточиться на целях и регулярности учёта.";
    return `Главные проблемы сейчас: ${parts.join(", ")}. Хотите — скажу, какие 1–2 действия дадут самый быстрый эффект (по вашим категориям).`;
  }
  if (detQna?.asksWhereTooMuch) {
    const currency = contextPayload.currency || "RUB";
    const scope = accountScopePrefix(contextPayload);
    const cats = Array.isArray(contextPayload?.expense_categories) ? contextPayload.expense_categories : [];
    const top = cats.slice(0, 3);
    if (top.length === 0) return `${scope}За период нет данных по расходам. Нажмите «Проанализировать» и попробуйте снова.`.trim();
    return `${scope}Сильнее всего тянут расходы: ${top.map((c) => `«${c.category}» ${formatMoney(c.spent, currency)}`).join(", ")}. Если назовёте одну категорию, подскажу конкретные варианты, где ужаться.`.trim();
  }
  if (detQna?.asksBigTransactions) {
    const currency = contextPayload.currency || "RUB";
    const scope = accountScopePrefix(contextPayload);
    const rows = Array.isArray(contextPayload?.top_transactions) ? contextPayload.top_transactions : [];
    const expenses = rows.filter((r) => r.type === "expense").slice(0, 3);
    if (expenses.length === 0) return `${scope}Крупных расходов за период не нашёл (или нет данных).`.trim();
    const label = contextPayload?.range_label || "за период";
    return `${scope}Крупные расходы ${label}: ${expenses
      .map((r) => `${formatDateRu(r.date)} — «${r.category}» ${formatMoney(r.amount, currency)}`)
      .join("; ")}.`;
  }
  if (detQna?.asksShowCategory) {
    return buildShowCategoryAnswer(question, contextPayload);
  }
  if (detQna?.asksNearLimit) {
    return buildNearLimitAnswer(contextPayload);
  }
  if (detQna?.asksBudgetRunway) {
    return buildBudgetRunwayAnswer(contextPayload);
  }
  if (detQna?.asksUnusual) {
    const currency = contextPayload?.currency || "RUB";
    const txs = (contextPayload?.top_transactions || []).filter((t) => t.type === "expense");
    if (txs.length === 0) return "Нет операций для сравнения.";
    const avg =
      txs.reduce((s, t) => s + Number(t.amount || 0), 0) / Math.max(1, txs.length);
    const unusual = txs.filter((t) => Number(t.amount || 0) >= avg * 2).slice(0, 3);
    if (unusual.length === 0) {
      return "Явно необычных крупных трат не видно — суммы распределены относительно ровно.";
    }
    return `Похоже на необычные траты (в 2+ раза выше средней ~${formatMoney(avg, currency)}): ${unusual
      .map((t) => `${formatDateRu(t.date)} «${t.category}» ${formatMoney(t.amount, currency)}`)
      .join("; ")}.`;
  }
  if (detQna?.asksWhyMoreExpense && contextPayload?.previous_period?.summary) {
    const currency = contextPayload.currency || "RUB";
    const cur = Number(contextPayload.expense || 0);
    const prev = Number(contextPayload.previous_period.summary.expense || 0);
    const diff = cur - prev;
    const cats = Array.isArray(contextPayload?.expense_categories) ? contextPayload.expense_categories : [];
    const top = cats[0] ? ` Больше всего расходов в категории «${cats[0].category}» (${formatMoney(cats[0].spent, currency)}).` : "";
    if (diff > 0) {
      return `В этом периоде расходы выше: ${formatMoney(cur, currency)} против ${formatMoney(prev, currency)} ранее (+${formatMoney(diff, currency)}).${top} Если хотите, скажите «почему выросли расходы на <категория>».`;
    }
    if (diff < 0) {
      return `В этом периоде расходы ниже: ${formatMoney(cur, currency)} против ${formatMoney(prev, currency)} ранее (−${formatMoney(Math.abs(diff), currency)}).${top}`.trim();
    }
    return `Расходы на уровне прошлого периода: ${formatMoney(cur, currency)}.`;
  }

  const categoriesForLimit =
    contextPayload?.month_categories?.length > 0
      ? contextPayload.month_categories
      : (contextPayload?.expense_categories || []).map((c) => ({
          category: c.category,
          spent: c.spent,
          limit_amount: null,
        }));

  const deterministic = buildDeterministicLimitAnswer({
    question,
    snapshot: findCategoryMention(question, categoriesForLimit),
    currency: contextPayload?.currency || "RUB",
  });
  if (deterministic) {
    return deterministic;
  }

  const q = normalizeText(question);
  if (/(в\s+какие\s+дни|когда\s+больше\s+трат|дни.*больше\s+трат)/.test(q)) {
    return buildPeakDaysAnswer(contextPayload);
  }

  return null;
}

async function answerUserQuestion(question, contextPayload) {
  const deterministic = tryDeterministicAnswer(question, contextPayload);
  if (deterministic) {
    return deterministic;
  }

  if (!isLlmEnabled()) {
    return "На этот вопрос нужен ИИ, но он отключён (LLM_ENABLED=false). Попробуйте типовые вопросы: «на что трачу больше всего», «крупные расходы», «откуда доходы».";
  }

  let raw;
  try {
    raw = await chat([
    {
      role: "system",
      content: CHAT_PROMPT,
    },
    {
      role: "user",
      content: `Данные:\n${JSON.stringify(contextPayload, null, 2)}\n\nВопрос: ${String(question).trim()}`,
    },
  ], { maxTokens: 220, temperature: 0.35 });
  } catch (error) {
    const msg = String(error?.message || "");
    if (/high memory|temporarily unavailable|rate limit/i.test(msg)) {
      return "ИИ временно перегружен. Подождите минуту и повторите, или задайте вопрос проще (например «на что трачу больше всего»).";
    }
    return "Не удалось получить ответ от ИИ. Попробуйте позже или переформулируйте вопрос.";
  }

  const text = String(raw || "").trim();
  if (/[A-Za-z]/.test(text) || isListyOrSalesy(text)) {
    const retry = await chat([
      {
        role: "system",
        content: `${CHAT_PROMPT}\n\nВАЖНО: в ответе запрещена латиница и английские слова.`,
      },
      {
        role: "user",
        content: `Данные:\n${JSON.stringify(contextPayload, null, 2)}\n\nВопрос: ${String(question).trim()}`,
      },
    ], { maxTokens: 220, temperature: 0.35 });
    const retryText = String(retry || "").trim();
    if (/[A-Za-z]/.test(retryText) || isListyOrSalesy(retryText)) {
      // Hard fallback: never leak English into UI; keep answer safe and short.
      if (detQna?.asksTopExpense) {
        return "Нажмите «Проанализировать», и я покажу топ‑категории трат за выбранный период.";
      }
      if (detQna?.asksIncomeSources) {
        return "Нажмите «Проанализировать», и я покажу основные источники доходов за выбранный период.";
      }
      return "Я могу отвечать только по вашим данным и на русском. Уточните вопрос (и категорию, если речь о бюджете) — и я отвечу по цифрам.";
    }
    return retryText;
  }

  return text;
}

module.exports = {
  enrichInsightsWithLlm,
  answerUserQuestion,
  tryDeterministicAnswer,
  buildLlmPayload,
};
