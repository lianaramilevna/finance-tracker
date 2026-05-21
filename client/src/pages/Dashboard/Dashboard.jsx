import { useCallback, useEffect, useMemo, useState } from "react";
import { getTransactions } from "../../shared/api/transactions";
import { getAccounts } from "../../shared/api/accounts";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { calcExpense, calcIncome, isTransferTransaction } from "../../shared/lib/calc";
import { getCurrentUser } from "../../shared/lib/session";
import { formatDate, formatMoney } from "../../shared/lib/format";
import ExpenseChart from "../../widgets/charts/ExpenseChart";
import "./dashboard.css";

const PERIOD_OPTIONS = [
  { value: "7d", label: "Эта неделя" },
  { value: "month", label: "Текущий месяц" },
  { value: "custom", label: "Свой период" },
];

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
  } else if (periodKey === "month") {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  }

  const durationDays = Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  );
  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (durationDays - 1) * DAY_MS);

  return { start, end, prevStart, prevEnd };
}

function getCustomPeriodRange(startDateStr, endDateStr) {
  const start = atStartOfDay(new Date(startDateStr));
  const end = atStartOfDay(new Date(endDateStr));
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  const durationDays = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const prevEnd = new Date(start.getTime() - DAY_MS);
  const prevStart = new Date(prevEnd.getTime() - (durationDays - 1) * DAY_MS);

  return { start, end, prevStart, prevEnd };
}

function isWithinRange(value, start, end) {
  if (!value) return false;
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

function Dashboard() {
  const user = getCurrentUser();
  const userId = user?.id;
  const currency = user?.currency || "RUB";

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("month");

  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [appliedCustomStart, setAppliedCustomStart] = useState("");
  const [appliedCustomEnd, setAppliedCustomEnd] = useState("");

  const loadDashboardData = useCallback(async () => {
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
    loadDashboardData();
    window.addEventListener(FINANCE_DATA_CHANGED, loadDashboardData);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, loadDashboardData);
  }, [loadDashboardData]);

  const accountBalance = useMemo(() => {
    return accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  }, [accounts]);

  const ranges = useMemo(() => {
    if (period === "custom" && appliedCustomStart && appliedCustomEnd) {
      return getCustomPeriodRange(appliedCustomStart, appliedCustomEnd);
    }
    return getPeriodRange(period);
  }, [period, appliedCustomStart, appliedCustomEnd]);

  const periodTransactions = useMemo(() => {
    if (!ranges) return [];
    return transactions.filter((item) =>
      isWithinRange(item.date, ranges.start, ranges.end)
    );
  }, [transactions, ranges]);

  const previousPeriodTransactions = useMemo(() => {
    if (!ranges) return [];
    return transactions.filter((item) =>
      isWithinRange(item.date, ranges.prevStart, ranges.prevEnd)
    );
  }, [transactions, ranges]);

  const income = calcIncome(periodTransactions);
  const expense = calcExpense(periodTransactions);
  const periodResult = income - expense;

  const previousIncome = calcIncome(previousPeriodTransactions);
  const previousExpense = calcExpense(previousPeriodTransactions);

  const incomeChange = getChangePercent(income, previousIncome);
  const expenseChange = getChangePercent(expense, previousExpense);

  const topExpenseCategory = useMemo(() => {
    const map = new Map();
    periodTransactions
      .filter((t) => t.type === "expense" && !isTransferTransaction(t))
      .forEach((t) => {
        const key = t.category || "Без категории";
        map.set(key, (map.get(key) || 0) + Number(t.amount || 0));
      });
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)[0];
  }, [periodTransactions]);

  const latestIncome = useMemo(() => {
    return periodTransactions.find(
      (t) => t.type === "income" && !isTransferTransaction(t)
    );
  }, [periodTransactions]);

  const latestExpense = useMemo(() => {
    return periodTransactions.find(
      (t) => t.type === "expense" && !isTransferTransaction(t)
    );
  }, [periodTransactions]);

  const expenseShare = useMemo(() => {
    if (!income) return 0;
    return Math.round((expense / income) * 100);
  }, [expense, income]);

  const expenseTransactions = useMemo(() => {
    return periodTransactions.filter(
      (t) => t.type === "expense" && !isTransferTransaction(t)
    );
  }, [periodTransactions]);

  const handleApplyCustom = () => {
    if (customStart && customEnd) {
      setAppliedCustomStart(customStart);
      setAppliedCustomEnd(customEnd);
    }
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-hero">
        <div>
          <p>Мониторинг доходов, расходов и финансовых тенденций</p>
        </div>

        <div className="dashboard-period">
          <label htmlFor="dashboard-period">Период</label>
          <select
            id="dashboard-period"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value);
              if (event.target.value !== "custom") {
                setAppliedCustomStart("");
                setAppliedCustomEnd("");
              }
            }}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {period === "custom" && (
            <div className="custom-range-inputs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                placeholder="С"
              />
              <span> – </span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                placeholder="По"
              />
              <button
                type="button"
                onClick={handleApplyCustom}
                disabled={!customStart || !customEnd}
              >
                Применить
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-balance">
          <span>Итог за период</span>
          <strong>{formatMoney(periodResult, currency)}</strong>
        </div>

        <div className="stat-card stat-income">
          <span>Доходы</span>
          <strong>{formatMoney(income, currency)}</strong>
          <small className={incomeChange >= 0 ? "delta-positive" : "delta-negative"}>
            {incomeChange >= 0 ? "+" : ""}
            {incomeChange}% к прошлому периоду
          </small>
        </div>

        <div className="stat-card stat-expense">
          <span>Расходы</span>
          <strong>{formatMoney(expense, currency)}</strong>
          <small className={expenseChange <= 0 ? "delta-positive" : "delta-negative"}>
            {expenseChange >= 0 ? "+" : ""}
            {expenseChange}% к прошлому периоду
          </small>
        </div>
      </div>

      <div className="balance-caption">
        Текущий общий баланс счетов:{" "}
        <strong>{formatMoney(accountBalance, currency)}</strong>
      </div>

      <div className="dashboard-layout">
        <section className="panel chart-panel">
          <div className="panel-header">
            <h2>Расходы по категориям</h2>
            <span className="panel-subtitle">Сводка по структуре затрат</span>
          </div>

          {loading ? (
            <p className="empty-state">Загрузка...</p>
          ) : expenseTransactions.length === 0 ? (
            <p className="empty-state">Нет расходов для отображения</p>
          ) : (
            <ExpenseChart transactions={expenseTransactions} currency={currency} />
          )}
        </section>

        <aside className="panel insights-panel">
          <div className="panel-header">
            <h2>Инсайты</h2>
            <span className="panel-subtitle">Быстрые выводы</span>
          </div>

          <div className="insight-card">
            <span className="insight-label">Главная категория расходов</span>
            <strong>
              {topExpenseCategory
                ? `${topExpenseCategory.name} — ${formatMoney(
                    topExpenseCategory.value,
                    currency
                  )}`
                : "Пока нет данных"}
            </strong>
          </div>

          <div className="insight-card">
            <span className="insight-label">Последний доход</span>
            <strong>
              {latestIncome
                ? `${latestIncome.category} — ${formatMoney(
                    latestIncome.amount,
                    currency
                  )}`
                : "Нет доходов"}
            </strong>
          </div>

          <div className="insight-card">
            <span className="insight-label">Последний расход</span>
            <strong>
              {latestExpense
                ? `${latestExpense.category} — ${formatMoney(
                    latestExpense.amount,
                    currency
                  )}`
                : "Нет расходов"}
            </strong>
          </div>

          <div className="insight-card">
            <span className="insight-label">Соотношение расходов к доходам</span>
            <strong>{income > 0 ? `${expenseShare}%` : "Недостаточно данных"}</strong>
          </div>
        </aside>
      </div>

      <section className="panel summary-panel">
        <div className="panel-header">
          <h2>Краткая сводка</h2>
          <span className="panel-subtitle">Последние изменения</span>
        </div>

        {periodTransactions.length === 0 ? (
          <p className="empty-state">Пока нет транзакций</p>
        ) : (
          <div className="summary-grid">
            {periodTransactions.slice(0, 4).map((t) => (
              <div key={t.id} className="summary-item">
                <div>
                  <div className="summary-title">{t.category || "Без категории"}</div>
                  <div className="summary-meta">{formatDate(t.date)}</div>
                </div>
                <div className={t.type === "income" ? "money income" : "money expense"}>
                  {t.type === "income" ? "+" : "-"}
                  {formatMoney(t.amount, currency)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default Dashboard;