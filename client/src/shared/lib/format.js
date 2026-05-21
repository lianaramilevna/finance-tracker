const LOCALE_BY_CURRENCY = {
  EUR: "de-DE",
  USD: "en-US",
  RUB: "ru-RU",
};

export const formatMoney = (value, currency = "RUB") => {
  const amount = Number(value) || 0;
  const code = LOCALE_BY_CURRENCY[currency] ? currency : "RUB";
  const locale = LOCALE_BY_CURRENCY[code];

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(amount);
};

export const formatDate = (value, fallback = "—") => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString("ru-RU");
};