const YIELD_ACCOUNT_TYPES = new Set(["savings", "investment"]);

export function isYieldAccountType(type) {
  return YIELD_ACCOUNT_TYPES.has(String(type || "").trim());
}

export function estimateYieldIncome(balance, annualRatePercent, period = "month") {
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

export function getRateFieldLabel(type) {
  if (type === "investment") {
    return "Ожидаемая доходность, % годовых";
  }
  if (type === "savings") {
    return "Ставка по вкладу, % годовых";
  }
  return null;
}

export function formatRatePercent(rate) {
  const value = Number(rate);
  if (Number.isNaN(value) || value <= 0) {
    return null;
  }
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}%`;
}
