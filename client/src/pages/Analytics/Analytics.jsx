import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Line,
} from "recharts";
import { getTransactions } from "../../shared/api/transactions";
import { getAccounts } from "../../shared/api/accounts";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { getCurrentUser } from "../../shared/lib/session";
import { formatDate, formatMoney } from "../../shared/lib/format";
import { calcExpense, calcIncome, isTransferTransaction } from "../../shared/lib/calc";
import EmptyState from "../../shared/ui/EmptyState";
import "./analytics.css";

const ACCOUNT_FILTER_STORAGE_KEY = "analytics_account_filter";

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "month", label: "Этот месяц" },
  { value: "quarter", label: "Этот квартал" },
  { value: "year", label: "Этот год" },
  { value: "all", label: "За всё время" },
];

const PIE_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#a855f7",
];

const OTHER_COLOR = "#6b7280";
const MAX_CATEGORIES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function atStartOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getPeriodRange(periodKey) {
  const now = new Date();
  const end = atStartOfDay(now);
  let start = atStartOfDay(now);

  if (periodKey === "7d") {
    start = new Date(end.getTime() - 6 * DAY_MS);
  } else if (periodKey === "30d") {
    start = new Date(end.getTime() - 29 * DAY_MS);
  } else if (periodKey === "month") {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  } else if (periodKey === "quarter") {
    const quarterStartMonth = Math.floor(end.getMonth() / 3) * 3;
    start = new Date(end.getFullYear(), quarterStartMonth, 1);
  } else if (periodKey === "year") {
    start = new Date(end.getFullYear(), 0, 1);
  } else if (periodKey === "all") {
    return { start: null, end: null, prevStart: null, prevEnd: null };
  }

  const durationDays = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  );
  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (durationDays - 1) * DAY_MS);

  return { start, end, prevStart, prevEnd };
}

function isWithinRange(value, start, end) {
  if (!value || !start || !end) return false;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;

  const atStart = atStartOfDay(date).getTime();
  return atStart >= start.getTime() && atStart <= end.getTime();
}

function getChangePercent(current, previous) {
  if (previous === 0) {
    if (current === 0) return 0;
    return 100;
  }

  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

function getMonthKey(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(monthKey) {
  if (!monthKey) return "—";
  const [year, month] = monthKey.split("-");
  return `${month}.${year.slice(2)}`;
}

function readStoredAccountFilter() {
  try {
    return localStorage.getItem(ACCOUNT_FILTER_STORAGE_KEY) || "all";
  } catch {
    return "all";
  }
}

function filterByAccount(list, accountFilter) {
  if (!accountFilter || accountFilter === "all") return list;
  return list.filter((item) => String(item.account_id) === String(accountFilter));
}

function getPeriodLabel(periodKey) {
  return PERIOD_OPTIONS.find((item) => item.value === periodKey)?.label || periodKey;
}

function mergeZeroPercentIntoOther(items, totalAmount) {
  if (!items.length || totalAmount <= 0) return items;

  const withPercent = items.map((item) => ({
    ...item,
    percent: Math.round((item.value / totalAmount) * 100),
  }));

  const tiny = withPercent.filter((item) => item.percent === 0 && item.name !== "Прочее");
  if (tiny.length === 0) return withPercent;

  const kept = withPercent.filter((item) => item.percent > 0 || item.name === "Прочее");
  const tinySum = tiny.reduce((sum, item) => sum + item.value, 0);

  let merged = kept;
  if (tinySum > 0) {
    const otherIndex = merged.findIndex((item) => item.name === "Прочее");
    if (otherIndex >= 0) {
      merged = merged.map((item, index) =>
        index === otherIndex ? { ...item, value: item.value + tinySum } : item
      );
    } else {
      merged = [...merged, { name: "Прочее", value: tinySum }];
    }
  }

  return merged.map((item) => ({
    ...item,
    percent: Math.round((item.value / totalAmount) * 100),
  }));
}

function aggregateTopCategories(data, totalAmount, maxCategories) {
  if (!data.length) return [];

  const sorted = [...data].sort((a, b) => b.value - a.value);

  let result;
  if (sorted.length <= maxCategories) {
    result = [...sorted];
  } else {
    const top = sorted.slice(0, maxCategories - 1);
    const otherItems = sorted.slice(maxCategories - 1);
    const otherSum = otherItems.reduce((sum, item) => sum + item.value, 0);
    result = [...top];
    if (otherSum > 0) {
      result.push({ name: "Прочее", value: otherSum });
    }
  }

  return mergeZeroPercentIntoOther(result, totalAmount);
}

function Analytics() {
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");
  const [accountFilter, setAccountFilter] = useState(readStoredAccountFilter);

  const loadData = useCallback(async () => {
    if (!userId) {
      setTransactions([]);
      setAccounts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const [transactionsData, accountsData] = await Promise.all([
        getTransactions(),
        getAccounts(),
      ]);

      setTransactions(Array.isArray(transactionsData) ? transactionsData : []);
      setAccounts(Array.isArray(accountsData) ? accountsData : []);
    } catch (error) {
      console.error(error);
      setTransactions([]);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadData();

    window.addEventListener(FINANCE_DATA_CHANGED, loadData);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, loadData);
  }, [loadData]);

  useEffect(() => {
    try {
      localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, accountFilter);
    } catch {
      // ignore storage errors
    }
  }, [accountFilter]);

  useEffect(() => {
    if (accountFilter === "all" || accounts.length === 0) return;
    const exists = accounts.some((item) => String(item.id) === String(accountFilter));
    if (!exists) setAccountFilter("all");
  }, [accounts, accountFilter]);

  const selectedAccount = useMemo(() => {
    if (accountFilter === "all") return null;
    return accounts.find((item) => String(item.id) === String(accountFilter)) || null;
  }, [accounts, accountFilter]);

  const accountFilteredTransactions = useMemo(
    () => filterByAccount(transactions, accountFilter),
    [transactions, accountFilter]
  );

  const ranges = useMemo(() => getPeriodRange(period), [period]);

  const periodTransactions = useMemo(() => {
    if (period === "all") return accountFilteredTransactions;
    return accountFilteredTransactions.filter((item) =>
      isWithinRange(item.date, ranges.start, ranges.end)
    );
  }, [accountFilteredTransactions, period, ranges]);

  const previousPeriodTransactions = useMemo(() => {
    if (period === "all") return [];
    return accountFilteredTransactions.filter((item) =>
      isWithinRange(item.date, ranges.prevStart, ranges.prevEnd)
    );
  }, [accountFilteredTransactions, period, ranges]);

  const periodDays = useMemo(() => {
    if (period === "all" || !ranges?.start || !ranges?.end) return null;
    return Math.max(
      1,
      Math.floor((ranges.end.getTime() - ranges.start.getTime()) / DAY_MS) + 1
    );
  }, [period, ranges]);

  const periodOpsCount = useMemo(
    () => periodTransactions.filter((item) => !isTransferTransaction(item)).length,
    [periodTransactions]
  );

  const hasPeriodData = periodOpsCount > 0;

  const income = useMemo(() => calcIncome(periodTransactions), [periodTransactions]);

  const expense = useMemo(() => calcExpense(periodTransactions), [periodTransactions]);

  const net = income - expense;

  const monthExpenseForecast = useMemo(() => {
    if (period !== "month") return null;
    if (!ranges?.start || !ranges?.end) return null;

    const now = ranges.end;
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysPassed = Math.min(daysInMonth, Math.max(1, now.getDate()));

    const projected = Math.round((expense / daysPassed) * daysInMonth);

    return {
      daysPassed,
      daysInMonth,
      projectedExpense: projected,
      projectedDelta: projected - expense,
    };
  }, [period, ranges, expense]);

  const prevIncome = useMemo(
    () => calcIncome(previousPeriodTransactions),
    [previousPeriodTransactions]
  );

  const prevExpense = useMemo(
    () => calcExpense(previousPeriodTransactions),
    [previousPeriodTransactions]
  );

  const prevNet = prevIncome - prevExpense;

  const netChange = period === "all" ? null : getChangePercent(net, prevNet);
  const incomeChange = period === "all" ? null : getChangePercent(income, prevIncome);
  const expenseChange = period === "all" ? null : getChangePercent(expense, prevExpense);

  const savingsRate = useMemo(() => {
    if (income <= 0) return 0;
    return Math.max(Math.round((net / income) * 100), 0);
  }, [net, income]);

  const visibleAccounts = useMemo(() => {
    if (!selectedAccount) return accounts;
    return accounts.filter((item) => String(item.id) === String(selectedAccount.id));
  }, [accounts, selectedAccount]);

  const activeAccountsCount = visibleAccounts.length;

  const totalAccountBalance = useMemo(
    () => visibleAccounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0),
    [visibleAccounts]
  );

  const negativeAccounts = useMemo(
    () => visibleAccounts.filter((acc) => Number(acc.balance || 0) < 0),
    [visibleAccounts]
  );

  const avgDailyExpense = useMemo(() => {
    if (!periodDays || expense <= 0) return null;
    return Math.round(expense / periodDays);
  }, [periodDays, expense]);

  const topExpenseCategory = useMemo(() => {
    const map = new Map();

    periodTransactions
      .filter((t) => t.type === "expense" && !isTransferTransaction(t))
      .forEach((t) => {
        const key = t.category || "Без категории";
        map.set(key, (map.get(key) || 0) + Number(t.amount || 0));
      });

    const aggregated = aggregateTopCategories(
      [...map.entries()].map(([name, value]) => ({ name, value })),
      expense,
      MAX_CATEGORIES
    );

    return aggregated.length ? aggregated[0] : null;
  }, [periodTransactions, expense]);

  const topIncomeCategory = useMemo(() => {
    const map = new Map();

    periodTransactions
      .filter((t) => t.type === "income" && !isTransferTransaction(t))
      .forEach((t) => {
        const key = t.category || "Без категории";
        map.set(key, (map.get(key) || 0) + Number(t.amount || 0));
      });

    const aggregated = aggregateTopCategories(
      [...map.entries()].map(([name, value]) => ({ name, value })),
      income,
      MAX_CATEGORIES
    );

    return aggregated.length ? aggregated[0] : null;
  }, [periodTransactions, income]);

  const expensePieData = useMemo(() => {
    const map = new Map();

    periodTransactions
      .filter((t) => t.type === "expense" && !isTransferTransaction(t))
      .forEach((t) => {
        const key = t.category || "Без категории";
        map.set(key, (map.get(key) || 0) + Number(t.amount || 0));
      });

    const rawData = [...map.entries()].map(([name, value]) => ({
      name,
      value,
    }));

    return aggregateTopCategories(rawData, expense, MAX_CATEGORIES);
  }, [periodTransactions, expense]);

  const incomePieData = useMemo(() => {
    const map = new Map();

    periodTransactions
      .filter((t) => t.type === "income" && !isTransferTransaction(t))
      .forEach((t) => {
        const key = t.category || "Без категории";
        map.set(key, (map.get(key) || 0) + Number(t.amount || 0));
      });

    const rawData = [...map.entries()].map(([name, value]) => ({
      name,
      value,
    }));

    return aggregateTopCategories(rawData, income, MAX_CATEGORIES);
  }, [periodTransactions, income]);

  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months = [];

    for (let i = 5; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = getMonthKey(date);

      months.push({
        key,
        label: getMonthLabel(key),
        income: 0,
        expense: 0,
        net: 0,
      });
    }

    const lookup = new Map(months.map((item) => [item.key, item]));

    accountFilteredTransactions.forEach((t) => {
      if (isTransferTransaction(t)) return;

      const key = getMonthKey(t.date);
      if (!key || !lookup.has(key)) return;

      const item = lookup.get(key);
      if (t.type === "income") {
        item.income += Number(t.amount || 0);
      } else {
        item.expense += Number(t.amount || 0);
      }
    });

    return months.map((item) => ({
      ...item,
      net: item.income - item.expense,
    }));
  }, [accountFilteredTransactions]);

  const accountScopeLabel = selectedAccount ? selectedAccount.name : "Все счета";

  const transactionsLink =
    accountFilter !== "all" ? `/transactions?account=${accountFilter}` : "/transactions";

  const resetFilters = () => {
    setAccountFilter("all");
    setPeriod("month");
  };

  const hasActiveFilters = accountFilter !== "all" || period !== "month";

  const biggestExpense = useMemo(() => {
    return (
      [...periodTransactions]
        .filter((t) => t.type === "expense" && !isTransferTransaction(t))
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0] || null
    );
  }, [periodTransactions]);

  const biggestIncome = useMemo(() => {
    return (
      [...periodTransactions]
        .filter((t) => t.type === "income" && !isTransferTransaction(t))
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))[0] || null
    );
  }, [periodTransactions]);

  const latestTransactions = useMemo(() => {
    return [...periodTransactions]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6);
  }, [periodTransactions]);

  const revenueShare = useMemo(() => {
    const totalMovement = income + expense;
    if (totalMovement <= 0) return 0;
    return Math.round((income / totalMovement) * 100);
  }, [income, expense]);

  const expenseShare = useMemo(() => {
    const totalMovement = income + expense;
    if (totalMovement <= 0) return 0;
    return Math.round((expense / totalMovement) * 100);
  }, [income, expense]);

  const getCategoryColor = (index, name) => {
    if (name === "Прочее") return OTHER_COLOR;
    return PIE_COLORS[index % PIE_COLORS.length];
  };

  return (
    <div className="analytics-page">
      <p className="page-subtitle">
        Сначала общий результат, потом структура доходов и расходов, затем динамика по месяцам и состояние счетов.
      </p>

      <div className="analytics-filters">
          <div className="analytics-filter">
            <label htmlFor="analytics-period">Период</label>
            <select
              id="analytics-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {PERIOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="analytics-filter">
            <label htmlFor="analytics-account">Счёт</label>
            <select
              id="analytics-account"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              disabled={loading || accounts.length === 0}
            >
              <option value="all">Все счета</option>
              {accounts.map((account) => (
                <option key={account.id} value={String(account.id)}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
      </div>

      {hasActiveFilters && (
        <div className="analytics-active-filters">
          <span>
            {accountScopeLabel} · {getPeriodLabel(period)}
          </span>
          <button type="button" className="analytics-reset-btn" onClick={resetFilters}>
            Сбросить фильтры
          </button>
        </div>
      )}

      {!loading && !hasPeriodData && (
        <EmptyState
          title="Нет данных за выбранные фильтры"
          description={
            selectedAccount
              ? `На счёте «${selectedAccount.name}» за период «${getPeriodLabel(period)}» нет операций (кроме переводов). Смените период или счёт.`
              : `За период «${getPeriodLabel(period)}» нет операций. Добавьте транзакции или импортируйте выписку.`
          }
          actionLabel="Перейти к операциям"
          actionTo={transactionsLink}
        />
      )}

      <div className="analytics-stats">
        <div className="analytics-stat">
          <span>Итог за период</span>
          <strong>{formatMoney(net, currency)}</strong>
          <small className={net >= 0 ? "delta-positive" : "delta-negative"}>
            {period === "all"
              ? "За всё время"
              : `${netChange >= 0 ? "+" : ""}${netChange}% к прошлому периоду`}
          </small>
        </div>

        <div className="analytics-stat">
          <span>Доходы</span>
          <strong>{formatMoney(income, currency)}</strong>
          <small
            className={
              period === "all"
                ? ""
                : incomeChange >= 0
                ? "delta-positive"
                : "delta-negative"
            }
          >
            {period === "all"
              ? "Все поступления"
              : `${incomeChange >= 0 ? "+" : ""}${incomeChange}% к прошлому периоду`}
          </small>
        </div>

        <div className="analytics-stat">
          <span>Расходы</span>
          <strong>{formatMoney(expense, currency)}</strong>
          <small
            className={
              period === "all"
                ? ""
                : expenseChange <= 0
                ? "delta-positive"
                : "delta-negative"
            }
          >
            {period === "all"
              ? "Все списания"
              : `${expenseChange >= 0 ? "+" : ""}${expenseChange}% к прошлому периоду`}
          </small>
        </div>

        {monthExpenseForecast && (
          <div className="analytics-stat">
            <span>Прогноз расходов (месяц)</span>
            <strong>{formatMoney(monthExpenseForecast.projectedExpense, currency)}</strong>
            <small>
              На основе {monthExpenseForecast.daysPassed} из {monthExpenseForecast.daysInMonth} дней:{" "}
              {monthExpenseForecast.projectedDelta >= 0 ? "+" : ""}
              {formatMoney(monthExpenseForecast.projectedDelta, currency)} к текущим расходам
            </small>
          </div>
        )}

        <div className="analytics-stat">
          <span>Операций за период</span>
          <strong>{periodOpsCount}</strong>
          <small>Без учёта переводов между счетами</small>
        </div>

        {avgDailyExpense != null && (
          <div className="analytics-stat">
            <span>Средний расход в день</span>
            <strong>{formatMoney(avgDailyExpense, currency)}</strong>
            <small>За {periodDays} дн. выбранного периода</small>
          </div>
        )}

        <div className="analytics-stat">
          <span>Сбережение</span>
          <strong>{savingsRate}%</strong>
          <small>Доля дохода, оставшаяся после расходов</small>
        </div>

        <div className="analytics-stat">
          <span>{selectedAccount ? "Счёт" : "Активные счета"}</span>
          <strong>{selectedAccount ? selectedAccount.name : activeAccountsCount}</strong>
          <small>
            {negativeAccounts.length > 0
              ? `${negativeAccounts.length} в минусе`
              : selectedAccount
              ? selectedAccount.type || "—"
              : "Нет отрицательных счетов"}
          </small>
        </div>

        <div className="analytics-stat">
          <span>{selectedAccount ? "Баланс счёта" : "Баланс счетов"}</span>
          <strong>{formatMoney(totalAccountBalance, currency)}</strong>
          <small>
            {selectedAccount ? accountScopeLabel : "Сумма всех активных счетов"}
          </small>
        </div>
      </div>

      {negativeAccounts.length > 0 && (
        <div className="analytics-warning">
          <strong>Внимание:</strong> {negativeAccounts.length} счёт(а) сейчас с
          отрицательным балансом.
        </div>
      )}

      <div className="analytics-grid">
        <section className="panel analytics-panel">
          <div className="panel-head">
            <h2>Куда уходят деньги</h2>
            <span>
              {accountScopeLabel} · расходы по категориям
            </span>
          </div>

          {loading ? (
            <p className="empty-state">Загрузка...</p>
          ) : expensePieData.length === 0 ? (
            <p className="empty-state">Нет расходов для отображения</p>
          ) : (
            <div className="analytics-chart-wrap">
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={expensePieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={72}
                      outerRadius={110}
                      paddingAngle={3}
                    >
                      {expensePieData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={getCategoryColor(index, entry.name)}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatMoney(Number(value || 0), currency)
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="analytics-side-list">
                {expensePieData.map((item, index) => (
                  <div key={item.name} className="analytics-side-item">
                    <span
                      className="analytics-dot"
                      style={{ background: getCategoryColor(index, item.name) }}
                    />
                    <div className="analytics-side-text">
                      <strong>{item.name}</strong>
                      <span>{item.percent}%</span>
                    </div>
                    <div className="analytics-side-value">
                      {formatMoney(item.value, currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel analytics-panel">
          <div className="panel-head">
            <h2>Откуда приходят деньги</h2>
            <span>
              {accountScopeLabel} · доходы по категориям
            </span>
          </div>

          {loading ? (
            <p className="empty-state">Загрузка...</p>
          ) : incomePieData.length === 0 ? (
            <p className="empty-state">Нет доходов для отображения</p>
          ) : (
            <div className="analytics-chart-wrap">
              <div className="analytics-chart">
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={incomePieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={72}
                      outerRadius={110}
                      paddingAngle={3}
                    >
                      {incomePieData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={getCategoryColor(index, entry.name)}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatMoney(Number(value || 0), currency)
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="analytics-side-list">
                {incomePieData.map((item, index) => (
                  <div key={item.name} className="analytics-side-item">
                    <span
                      className="analytics-dot"
                      style={{ background: getCategoryColor(index, item.name) }}
                    />
                    <div className="analytics-side-text">
                      <strong>{item.name}</strong>
                      <span>{item.percent}%</span>
                    </div>
                    <div className="analytics-side-value">
                      {formatMoney(item.value, currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="panel analytics-panel analytics-wide">
          <div className="panel-head">
            <h2>Динамика по месяцам</h2>
            <span>
              {accountScopeLabel} · доходы, расходы и итог за 6 месяцев
            </span>
          </div>

          <div className="analytics-trend">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip
                  formatter={(value) => formatMoney(Number(value || 0), currency)}
                />
                <Legend />
                <Bar dataKey="income" name="Доходы" fill="#22c55e" />
                <Bar dataKey="expense" name="Расходы" fill="#ef4444" />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Итог"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={{ r: 3 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel analytics-panel">
          <div className="panel-head">
            <h2>Счета</h2>
            <span>Сначала самые крупные</span>
          </div>

          {visibleAccounts.length === 0 ? (
            <p className="empty-state">Пока нет счетов</p>
          ) : (
            <div className="analytics-list">
              {[...visibleAccounts]
                .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
                .map((account) => (
                  <div key={account.id} className="analytics-list-item">
                    <div>
                      <strong>{account.name}</strong>
                      <span>{account.type}</span>
                    </div>
                    <div className={Number(account.balance || 0) < 0 ? "negative" : ""}>
                      {formatMoney(account.balance || 0, currency)}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </section>

        <section className="panel analytics-panel">
          <div className="panel-head">
            <h2>Самые крупные операции</h2>
            <span>Самый большой расход и самый большой доход</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
            }}
          >
            <div className="analytics-spot">
              <strong>Самый большой расход</strong>
              {biggestExpense ? (
                <>
                  <div>{biggestExpense.category || "Без категории"}</div>
                  <div>{formatDate(biggestExpense.date)}</div>
                  <div className="negative">
                    -{formatMoney(biggestExpense.amount, currency)}
                  </div>
                </>
              ) : (
                <p className="empty-state">Нет расходов</p>
              )}
            </div>

            <div className="analytics-spot">
              <strong>Самый большой доход</strong>
              {biggestIncome ? (
                <>
                  <div>{biggestIncome.category || "Без категории"}</div>
                  <div>{formatDate(biggestIncome.date)}</div>
                  <div className="positive">
                    +{formatMoney(biggestIncome.amount, currency)}
                  </div>
                </>
              ) : (
                <p className="empty-state">Нет доходов</p>
              )}
            </div>
          </div>
        </section>

        <section className="panel analytics-panel analytics-wide">
          <div className="panel-head">
            <h2>Последние операции</h2>
            <span>
              {accountScopeLabel} · последние записи за период
            </span>
          </div>

          {latestTransactions.length === 0 ? (
            <p className="empty-state">Нет транзакций</p>
          ) : (
            <div className="analytics-table">
              {latestTransactions.map((t) => (
                <div key={t.id} className="analytics-table-row">
                  <span>{formatDate(t.date)}</span>
                  <span>{t.account || "—"}</span>
                  <span>{t.category || "Без категории"}</span>
                  <span className={t.type === "income" ? "positive" : "negative"}>
                    {t.type === "income" ? "+" : "-"}
                    {formatMoney(t.amount, currency)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="analytics-section-footer">
            <Link to={transactionsLink} className="analytics-link-btn">
              Все операции{selectedAccount ? ` — ${selectedAccount.name}` : ""}
            </Link>
          </div>
        </section>

        <section className="panel analytics-panel analytics-wide">
          <div className="panel-head">
            <h2>Короткий вывод</h2>
            <span>Что важно знать прямо сейчас</span>
          </div>

          <div className="analytics-insight-grid">
            <div className="analytics-insight">
              <span>Главная категория расходов</span>
              <strong>
                {topExpenseCategory
                  ? `${topExpenseCategory.name} — ${formatMoney(
                      topExpenseCategory.value,
                      currency
                    )}`
                  : "Нет данных"}
              </strong>
            </div>

            <div className="analytics-insight">
              <span>Главная категория доходов</span>
              <strong>
                {topIncomeCategory
                  ? `${topIncomeCategory.name} — ${formatMoney(
                      topIncomeCategory.value,
                      currency
                    )}`
                  : "Нет данных"}
              </strong>
            </div>

            <div className="analytics-insight">
              <span>Расходы</span>
              <strong>Расходы составляют {expenseShare}% всех операций</strong>
            </div>

            <div className="analytics-insight">
              <span>Доходы</span>
              <strong>Доходы составляют {revenueShare}% всех операций</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Analytics;