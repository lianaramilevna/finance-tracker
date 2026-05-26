const YIELD_ACCOUNT_TYPES = new Set(["savings", "investment"]);

function isYieldAccountType(type) {
  return YIELD_ACCOUNT_TYPES.has(String(type || "").trim());
}

function parseAnnualRatePercent(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const rate = Number(value);
  if (Number.isNaN(rate) || rate < 0 || rate > 100) {
    return "invalid";
  }

  return Math.round(rate * 100) / 100;
}

function normalizeAnnualRateForType(type, rate) {
  if (!isYieldAccountType(type)) {
    return null;
  }
  return rate;
}

/** Простой процент: ориентир для UI, не замена банковского расчёта */
function estimateYieldIncome(balance, annualRatePercent, period = "month") {
  const amount = Number(balance || 0);
  const rate = Number(annualRatePercent || 0);
  if (amount <= 0 || rate <= 0) {
    return 0;
  }

  const yearly = (amount * rate) / 100;
  if (period === "year") {
    return Math.round(yearly * 100) / 100;
  }

  return Math.round((yearly / 12) * 100) / 100;
}

function getRateFieldLabel(type) {
  if (type === "investment") {
    return "Ожидаемая доходность, % годовых";
  }
  if (type === "savings") {
    return "Ставка по вкладу, % годовых";
  }
  return null;
}

module.exports = {
  YIELD_ACCOUNT_TYPES,
  isYieldAccountType,
  parseAnnualRatePercent,
  normalizeAnnualRateForType,
  estimateYieldIncome,
  getRateFieldLabel,
};
