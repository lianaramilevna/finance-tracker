export const DAY_MS = 24 * 60 * 60 * 1000;

export function atStartOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Тот же календарный день в соседнем месяце (31 мар → 28/29 фев). */
export function shiftCalendarMonth(date, deltaMonths) {
  const source = atStartOfDay(date);
  const day = source.getDate();
  const target = new Date(source.getFullYear(), source.getMonth() + deltaMonths, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return atStartOfDay(target);
}

function getRollingPreviousRange(start, end) {
  const durationDays = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  );
  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (durationDays - 1) * DAY_MS);
  return { prevStart: atStartOfDay(prevStart), prevEnd: atStartOfDay(prevEnd) };
}

export function getPeriodRange(periodKey) {
  const now = new Date();
  const end = atStartOfDay(now);
  let start = atStartOfDay(now);

  if (periodKey === "7d") {
    start = new Date(end.getTime() - 6 * DAY_MS);
  } else if (periodKey === "month") {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  }

  start = atStartOfDay(start);

  let prevStart;
  let prevEnd;

  if (periodKey === "month") {
    // MTD vs те же календарные даты прошлого месяца (1-е … сегодня)
    prevStart = atStartOfDay(new Date(start.getFullYear(), start.getMonth() - 1, 1));
    prevEnd = shiftCalendarMonth(end, -1);
  } else {
    ({ prevStart, prevEnd } = getRollingPreviousRange(start, end));
  }

  return { start, end, prevStart, prevEnd };
}

export function getCustomPeriodRange(startDateStr, endDateStr) {
  const start = atStartOfDay(new Date(startDateStr));
  const end = atStartOfDay(new Date(endDateStr));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start.getTime() > end.getTime()) return null;

  const { prevStart, prevEnd } = getRollingPreviousRange(start, end);
  return { start, end, prevStart, prevEnd };
}

export function isWithinRange(value, start, end) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const atStart = atStartOfDay(date).getTime();
  return atStart >= start.getTime() && atStart <= end.getTime();
}

/**
 * Относительное изменение в процентах.
 * null — если в прошлом периоде не было базы для сравнения (0 → X).
 */
export function getChangePercent(current, previous) {
  const curr = Number(current) || 0;
  const prev = Number(previous) || 0;

  if (prev === 0) {
    if (curr === 0) return 0;
    return null;
  }

  return Math.round(((curr - prev) / Math.abs(prev)) * 100);
}

export function formatChangePercent(value) {
  if (value === null) return "—";
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : ""}${value}%`;
}

export function formatPreviousPeriodHint(periodKey) {
  if (periodKey === "month") {
    return "к тем же датам прошлого месяца";
  }
  if (periodKey === "7d") {
    return "к предыдущим 7 дням";
  }
  return "к прошлому периоду той же длины";
}
