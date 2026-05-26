function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function aliasMatchesQuestion(question, alias) {
  const q = normalizeText(question);
  const key = normalizeText(alias);
  if (!q || !key) return false;

  if (key.length >= 4) {
    return q.includes(key);
  }

  const re = new RegExp(`(^|[^a-zа-я0-9])${escapeRegex(key)}([^a-zа-я0-9]|$)`, "i");
  return re.test(q);
}

function buildAccountSearchKeys(account) {
  const rawName = String(account?.name || "").trim();
  const normalizedName = normalizeText(rawName);
  const keys = new Set();

  if (normalizedName) keys.add(normalizedName);

  const withoutNoise = normalizedName
    .replace(/\b(карта|счет|счёт|банк|card|bank|дебет|кредит)\b/g, " ")
    .replace(/\*+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (withoutNoise) keys.add(withoutNoise);

  for (const token of withoutNoise.split(" ").filter(Boolean)) {
    if (token.length >= 2) keys.add(token);
  }

  for (const token of normalizedName.split(" ").filter(Boolean)) {
    if (token.length >= 2) keys.add(token);
  }

  const digitGroups = rawName.match(/\d{4,}/g) || [];
  for (const digits of digitGroups) {
    keys.add(digits);
    if (digits.length > 4) keys.add(digits.slice(-4));
  }

  return [...keys].filter(Boolean);
}

const GENERIC_ACCOUNT_WORDS = new Set([
  "карта",
  "счет",
  "счёт",
  "банк",
  "card",
  "bank",
  "дебет",
  "кредит",
  "black",
  "дебетовая",
  "кредитная",
]);

function isDistinctAccountKey(key) {
  const normalized = normalizeText(key);
  if (!normalized || normalized.length < 3) return false;
  if (GENERIC_ACCOUNT_WORDS.has(normalized)) return false;
  if (/^\d+$/.test(normalized)) return normalized.length >= 4;
  return true;
}

function scoreAccountInQuestion(question, account) {
  const q = normalizeText(question);
  if (!q) return { total: 0, distinct: 0 };

  let total = 0;
  let distinct = 0;
  const keys = buildAccountSearchKeys(account);

  for (const key of keys) {
    if (!key) continue;

    let keyScore = 0;

    if (aliasMatchesQuestion(q, key)) {
      keyScore = key.length * 12 + (key.length >= 5 ? 25 : 10);
    } else if (key.length >= 4) {
      const qTokens = q.split(/[^a-zа-я0-9]+/i).filter((t) => t.length >= 4);
      for (const token of qTokens) {
        const dist = levenshtein(token, key);
        const allowed = Math.max(1, Math.floor(Math.min(token.length, key.length) / 4));
        if (dist <= allowed) {
          keyScore = Math.max(keyScore, 35 + key.length);
        }
      }
    }

    if (keyScore <= 0) continue;
    total = Math.max(total, keyScore);
    if (isDistinctAccountKey(key)) {
      distinct = Math.max(distinct, keyScore);
    }
  }

  return { total, distinct };
}

async function getUserAccounts(client, userId) {
  const result = await client.query(
    `
    SELECT id, name, type
    FROM accounts
    WHERE user_id = $1
      AND COALESCE(is_archived, false) = false
    ORDER BY name ASC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name || "Счёт"),
    type: row.type ? String(row.type) : null,
  }));
}

function findAccountFromQuestion(question, accounts = []) {
  const q = normalizeText(question);
  if (!q || !accounts.length) return null;

  let bestAccount = null;
  let bestScore = 0;
  let bestDistinctScore = 0;

  for (const account of accounts) {
    const { total, distinct } = scoreAccountInQuestion(question, account);
    if (total > bestScore) {
      bestScore = total;
      bestDistinctScore = distinct;
      bestAccount = account;
    }
  }

  if (bestAccount && bestDistinctScore >= 14) {
    return bestAccount;
  }

  if (bestAccount && bestScore >= 14 && accounts.length === 1) {
    return bestAccount;
  }

  const wantsCard = /(по\s+карт|с\s+карт|на\s+карт|картой|банковск|дебетов)/.test(q);
  const cardAccounts = accounts.filter((item) => normalizeText(item.type) === "card");

  if (wantsCard && cardAccounts.length === 1) {
    return cardAccounts[0];
  }

  const wantsCash = /(наличн|наличк|кэш|cash)/.test(q);
  const cashAccounts = accounts.filter((item) => normalizeText(item.type) === "cash");
  if (wantsCash && cashAccounts.length === 1) {
    return cashAccounts[0];
  }

  const wantsSavings = /(накопит|сбереж|вклад|savings)/.test(q);
  const savingsAccounts = accounts.filter((item) => normalizeText(item.type) === "savings");
  if (wantsSavings && savingsAccounts.length === 1) {
    return savingsAccounts[0];
  }

  return null;
}

function resolveAccountScope({ bodyAccountId, question, accounts = [] }) {
  const explicitId = Number(bodyAccountId);
  if (Number.isInteger(explicitId) && explicitId > 0) {
    const found = accounts.find((item) => Number(item.id) === explicitId);
    if (found) {
      return { accountId: found.id, accountName: found.name };
    }
  }

  const fromQuestion = findAccountFromQuestion(question, accounts);
  if (fromQuestion) {
    return { accountId: fromQuestion.id, accountName: fromQuestion.name };
  }

  return { accountId: null, accountName: null };
}

function accountClause(alias, accountId, params) {
  if (!accountId) return "";
  params.push(accountId);
  return ` AND ${alias}.account_id = $${params.length}`;
}

function formatAccountsForContext(accounts = []) {
  return accounts.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    aliases: buildAccountSearchKeys(item).slice(0, 8),
  }));
}

module.exports = {
  normalizeText,
  getUserAccounts,
  findAccountFromQuestion,
  resolveAccountScope,
  accountClause,
  buildAccountSearchKeys,
  formatAccountsForContext,
};
