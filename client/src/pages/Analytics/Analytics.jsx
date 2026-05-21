import { useCallback, useEffect, useMemo, useState } from "react";
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
import "./analytics.css";

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

  return result.map((item) => ({
    ...item,
    percent: totalAmount > 0 ? Math.round((item.value / totalAmount) * 100) : 0,
  }));
}

function Analytics() {
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

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

  const ranges = useMemo(() => getPeriodRange(period), [period]);

  const periodTransactions = useMemo(() => {
    if (period === "all") return transactions;
    return transactions.filter((item) =>
      isWithinRange(item.date, ranges.start, ranges.end)
    );
  }, [transactions, period, ranges]);

  const previousPeriodTransactions = useMemo(() => {
    if (period === "all") return [];
    return transactions.filter((item) =>
      isWithinRange(item.date, ranges.prevStart, ranges.prevEnd)
    );
  }, [transactions, period, ranges]);

  const income = useMemo(() => calcIncome(periodTransactions), [periodTransactions]);

  const expense = useMemo(() => calcExpense(periodTransactions), [periodTransactions]);

  const net = income - expense;

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

  const activeAccountsCount = accounts.length;

  const totalAccountBalance = useMemo(
    () => accounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0),
    [accounts]
  );

  const negativeAccounts = useMemo(
    () => accounts.filter((acc) => Number(acc.balance || 0) < 0),
    [accounts]
  );

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

    transactions.forEach((t) => {
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
  }, [transactions]);

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
      <div className="analytics-hero">
        <div>
          <p>
            Сначала общий результат, потом структура доходов и расходов,
            затем динамика по месяцам и состояние счетов.
          </p>
        </div>

        <div className="analytics-period">
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
      </div>

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

        <div className="analytics-stat">
          <span>Сбережение</span>
          <strong>{savingsRate}%</strong>
          <small>Доля дохода, оставшаяся после расходов</small>
        </div>

        <div className="analytics-stat">
          <span>Активные счета</span>
          <strong>{activeAccountsCount}</strong>
          <small>
            {negativeAccounts.length > 0
              ? `${negativeAccounts.length} в минусе`
              : "Нет отрицательных счетов"}
          </small>
        </div>

        <div className="analytics-stat">
          <span>Баланс счетов</span>
          <strong>{formatMoney(totalAccountBalance, currency)}</strong>
          <small>Сумма всех активных счетов</small>
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
            <span>Расходы по категориям</span>
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
            <span>Доходы по категориям</span>
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
            <span>Доходы, расходы и итог за 6 месяцев</span>
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

          {accounts.length === 0 ? (
            <p className="empty-state">Пока нет счетов</p>
          ) : (
            <div className="analytics-list">
              {[...accounts]
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
            <span>Последние записи по выбранному периоду</span>
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