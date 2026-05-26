import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getTransactions } from "../../shared/api/transactions";
import { getAccounts } from "../../shared/api/accounts";
import { getBudgets } from "../../shared/api/budgets";
import { getGoals } from "../../shared/api/goals";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { calcExpense, calcIncome, isTransferTransaction } from "../../shared/lib/calc";
import {
  formatChangePercent,
  formatPreviousPeriodHint,
  getChangePercent,
  getCustomPeriodRange,
  getPeriodRange,
  isWithinRange,
} from "../../shared/lib/periodRange";
import { getCurrentUser } from "../../shared/lib/session";
import { formatDate, formatMoney } from "../../shared/lib/format";
import ExpenseChart from "../../widgets/charts/ExpenseChart";
import EmptyState from "../../shared/ui/EmptyState";
import "./dashboard.css";

const PERIOD_OPTIONS = [
  { value: "7d", label: "Эта неделя" },
  { value: "month", label: "Текущий месяц" },
  { value: "custom", label: "Свой период" },
];

const QUICK_ACTIONS = [
  { to: "/transactions", label: "Операции", hint: "Добавить или найти" },
  { to: "/import", label: "Импорт", hint: "CSV / XLSX" },
  { to: "/budgets", label: "Бюджет", hint: "Лимиты месяца" },
  { to: "/assistant", label: "Помощник", hint: "Советы и чат" },
];

function getMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatPeriodLabel(period, ranges, appliedCustomStart, appliedCustomEnd) {
  if (!ranges) return "";

  const fmt = (date) =>
    date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

  if (period === "custom" && appliedCustomStart && appliedCustomEnd) {
    return `${fmt(ranges.start)} — ${fmt(ranges.end)}`;
  }
  if (period === "7d") {
    return `${fmt(ranges.start)} — ${fmt(ranges.end)}`;
  }
  if (period === "month") {
    return ranges.start.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }
  return `${fmt(ranges.start)} — ${fmt(ranges.end)}`;
}

function getBudgetStatus(item) {
  const progress = Number(item.progress_percent || 0);
  if (progress > 100) return "exceeded";
  if (progress >= 80) return "warning";
  return "ok";
}

function Dashboard() {
  const user = getCurrentUser();
  const userId = user?.id;
  const currency = user?.currency || "RUB";

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [goals, setGoals] = useState([]);
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
      setBudgets([]);
      setGoals([]);
      setLoading(false);
      return;
    }

    const month = getMonthKey();

    try {
      setLoading(true);
      const [transactionsResult, accountsResult, budgetsResult, goalsResult] =
        await Promise.allSettled([
          getTransactions(),
          getAccounts(),
          getBudgets(month),
          getGoals(),
        ]);

      setTransactions(
        transactionsResult.status === "fulfilled" && Array.isArray(transactionsResult.value)
          ? transactionsResult.value
          : []
      );
      setAccounts(
        accountsResult.status === "fulfilled" && Array.isArray(accountsResult.value)
          ? accountsResult.value
          : []
      );
      setBudgets(
        budgetsResult.status === "fulfilled" && Array.isArray(budgetsResult.value)
          ? budgetsResult.value
          : []
      );
      setGoals(
        goalsResult.status === "fulfilled" && Array.isArray(goalsResult.value)
          ? goalsResult.value
          : []
      );
    } catch (error) {
      console.error(error);
      setTransactions([]);
      setAccounts([]);
      setBudgets([]);
      setGoals([]);
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

  const topAccounts = useMemo(() => {
    return [...accounts]
      .sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
      .slice(0, 4);
  }, [accounts]);

  const ranges = useMemo(() => {
    if (period === "custom") {
      if (!appliedCustomStart || !appliedCustomEnd) return null;
      return getCustomPeriodRange(appliedCustomStart, appliedCustomEnd);
    }
    return getPeriodRange(period);
  }, [period, appliedCustomStart, appliedCustomEnd]);

  const periodLabel = formatPeriodLabel(period, ranges, appliedCustomStart, appliedCustomEnd);
  const changeHint = formatPreviousPeriodHint(period);

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

  const sortedPeriodTransactions = useMemo(() => {
    return [...periodTransactions].sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return (b.id || 0) - (a.id || 0);
    });
  }, [periodTransactions]);

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
    return sortedPeriodTransactions.find(
      (t) => t.type === "income" && !isTransferTransaction(t)
    );
  }, [sortedPeriodTransactions]);

  const latestExpense = useMemo(() => {
    return sortedPeriodTransactions.find(
      (t) => t.type === "expense" && !isTransferTransaction(t)
    );
  }, [sortedPeriodTransactions]);

  const expenseShare = useMemo(() => {
    if (!income) return 0;
    return Math.round((expense / income) * 100);
  }, [expense, income]);

  const expenseTransactions = useMemo(() => {
    return periodTransactions.filter(
      (t) => t.type === "expense" && !isTransferTransaction(t)
    );
  }, [periodTransactions]);

  const recentTransactions = useMemo(() => {
    return sortedPeriodTransactions
      .filter((t) => !isTransferTransaction(t))
      .slice(0, 5);
  }, [sortedPeriodTransactions]);

  const budgetAlerts = useMemo(() => {
    return budgets
      .filter((item) => getBudgetStatus(item) !== "ok")
      .sort(
        (a, b) => Number(b.progress_percent || 0) - Number(a.progress_percent || 0)
      )
      .slice(0, 3);
  }, [budgets]);

  const activeGoals = useMemo(() => {
    return goals
      .filter((goal) => goal.status !== "completed")
      .sort((a, b) => Number(b.progress_percent || 0) - Number(a.progress_percent || 0))
      .slice(0, 3);
  }, [goals]);

  const handleApplyCustom = () => {
    if (customStart && customEnd) {
      setAppliedCustomStart(customStart);
      setAppliedCustomEnd(customEnd);
    }
  };

  const showCustomHint = period === "custom" && (!appliedCustomStart || !appliedCustomEnd);

  return (
    <div className="dashboard-page">
      <p className="page-subtitle">Мониторинг доходов, расходов и финансовых тенденций</p>

      <details className="panel dashboard-guide dashboard-collapsible">
        <summary className="dashboard-collapsible-summary">
          <span>Как читать обзор</span>
        </summary>
        <ul className="dashboard-guide-list">
          <li>
            <strong>Итог за период</strong> — разница между доходами и расходами (без переводов между
            счетами).
          </li>
          <li>
            <strong>Общий баланс</strong> — сумма по всем счетам прямо сейчас, не зависит от выбранного
            периода.
          </li>
          <li>
            <strong>Проценты у доходов и расходов</strong> — для недели сравниваются предыдущие 7 дней;
            для месяца — те же календарные даты прошлого месяца.
          </li>
          <li>
            <strong>Бюджет и цели</strong> — быстрые напоминания; подробности в соответствующих
            разделах.
          </li>
        </ul>
      </details>

      {!loading && accounts.length === 0 && (
        <EmptyState
          title="Начните с первого счёта"
          description="Создайте карту или наличные — после этого появятся операции, графики и сводка."
          actionLabel="Перейти к счетам"
          actionTo="/accounts"
        />
      )}

      <div className="dashboard-toolbar">
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
                aria-label="Дата начала"
              />
              <span className="custom-range-sep">—</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                aria-label="Дата окончания"
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

        <p className="dashboard-period-label">
          {showCustomHint ? "Выберите даты и нажмите «Применить»" : periodLabel}
        </p>
      </div>

      <div className="stats-grid">
        <div className="stat-card stat-balance">
          <span>Итог за период</span>
          <strong>{formatMoney(periodResult, currency)}</strong>
        </div>

        <div className="stat-card stat-income">
          <span>Доходы</span>
          <strong>{formatMoney(income, currency)}</strong>
          {!showCustomHint && ranges && (
            <small
              className={
                incomeChange === null
                  ? "delta-neutral"
                  : incomeChange >= 0
                    ? "delta-positive"
                    : "delta-negative"
              }
              title={incomeChange === null ? "В прошлом периоде не было доходов" : undefined}
            >
              {formatChangePercent(incomeChange)} {changeHint}
            </small>
          )}
        </div>

        <div className="stat-card stat-expense">
          <span>Расходы</span>
          <strong>{formatMoney(expense, currency)}</strong>
          {!showCustomHint && ranges && (
            <small
              className={
                expenseChange === null
                  ? "delta-neutral"
                  : expenseChange <= 0
                    ? "delta-positive"
                    : "delta-negative"
              }
              title={expenseChange === null ? "В прошлом периоде не было расходов" : undefined}
            >
              {formatChangePercent(expenseChange)} {changeHint}
            </small>
          )}
        </div>

        <div className="stat-card stat-accounts">
          <span>Баланс счетов</span>
          <strong>{formatMoney(accountBalance, currency)}</strong>
          <small>{accounts.length} {accounts.length === 1 ? "счёт" : accounts.length < 5 ? "счёта" : "счетов"}</small>
        </div>
      </div>

      {topAccounts.length > 0 && (
        <div className="dashboard-accounts-strip">
          {topAccounts.map((account) => (
            <Link key={account.id} to={`/transactions?account=${account.id}`} className="account-chip">
              <span className="account-chip-name">{account.name}</span>
              <strong>{formatMoney(account.balance, currency)}</strong>
            </Link>
          ))}
          <Link to="/accounts" className="account-chip account-chip--more">
            Все счета →
          </Link>
        </div>
      )}

      <div className="dashboard-quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <Link key={action.to} to={action.to} className="dashboard-quick-action">
            <strong>{action.label}</strong>
            <span>{action.hint}</span>
          </Link>
        ))}
      </div>

      <div className="dashboard-layout">
        <section className="panel chart-panel">
          <div className="panel-header">
            <h2>Расходы по категориям</h2>
            <span className="panel-subtitle">Сводка по структуре затрат</span>
          </div>

          {loading ? (
            <p className="empty-state">Загрузка...</p>
          ) : showCustomHint ? (
            <EmptyState
              title="Выберите период"
              description="Укажите даты «с» и «по», затем нажмите «Применить»."
            />
          ) : expenseTransactions.length === 0 ? (
            <EmptyState
              title="Нет расходов за период"
              description="Добавьте операции или импортируйте выписку — график появится автоматически."
              actionLabel="Импорт выписки"
              actionTo="/import"
            />
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
                ? `${topExpenseCategory.name} — ${formatMoney(topExpenseCategory.value, currency)}`
                : "Пока нет данных"}
            </strong>
          </div>

          <div className="insight-card">
            <span className="insight-label">Последний доход</span>
            <strong>
              {latestIncome
                ? `${latestIncome.category} — ${formatMoney(latestIncome.amount, currency)}`
                : "Нет доходов"}
            </strong>
            {latestIncome && (
              <span className="insight-meta">{formatDate(latestIncome.date)}</span>
            )}
          </div>

          <div className="insight-card">
            <span className="insight-label">Последний расход</span>
            <strong>
              {latestExpense
                ? `${latestExpense.category} — ${formatMoney(latestExpense.amount, currency)}`
                : "Нет расходов"}
            </strong>
            {latestExpense && (
              <span className="insight-meta">{formatDate(latestExpense.date)}</span>
            )}
          </div>

          <div className="insight-card">
            <span className="insight-label">Расходы к доходам</span>
            <strong>{income > 0 ? `${expenseShare}%` : "Недостаточно данных"}</strong>
            {income > 0 && expenseShare > 100 && (
              <span className="insight-meta insight-meta--warn">Расходы выше доходов</span>
            )}
          </div>

          {budgetAlerts.length > 0 && (
            <div className="dashboard-widget">
              <div className="dashboard-widget-head">
                <h3>Бюджет</h3>
                <Link to="/budgets">Открыть →</Link>
              </div>
              {budgetAlerts.map((item) => {
                const status = getBudgetStatus(item);
                return (
                  <div key={item.id} className={`dashboard-alert dashboard-alert--${status}`}>
                    <span>{item.category_name}</span>
                    <strong>
                      {formatMoney(item.spent, currency)} / {formatMoney(item.limit_amount, currency)}
                    </strong>
                  </div>
                );
              })}
            </div>
          )}

          {activeGoals.length > 0 && (
            <div className="dashboard-widget">
              <div className="dashboard-widget-head">
                <h3>Цели</h3>
                <Link to="/goals">Открыть →</Link>
              </div>
              {activeGoals.map((goal) => {
                const progress = Math.min(Number(goal.progress_percent || 0), 100);
                return (
                  <div key={goal.id} className="dashboard-goal-mini">
                    <div className="dashboard-goal-mini-top">
                      <span>{goal.name}</span>
                      <strong>{progress}%</strong>
                    </div>
                    <div className="dashboard-goal-mini-track">
                      <div
                        className="dashboard-goal-mini-fill"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <span className="dashboard-goal-mini-meta">
                      {formatMoney(goal.current_amount, currency)} из{" "}
                      {formatMoney(goal.target_amount, currency)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      <section className="panel summary-panel">
        <div className="panel-header panel-header-row">
          <div>
            <h2>Последние операции</h2>
            <span className="panel-subtitle">За выбранный период</span>
          </div>
          <Link to="/transactions" className="dashboard-link-all">
            Все операции →
          </Link>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : showCustomHint ? (
          <EmptyState title="Период не выбран" description="Задайте свой диапазон дат выше." />
        ) : recentTransactions.length === 0 ? (
          <EmptyState
            title="Нет операций за период"
            description="Добавьте доход или расход, либо импортируйте выписку."
            actionLabel="Импорт выписки"
            actionTo="/import"
          />
        ) : (
          <div className="summary-grid">
            {recentTransactions.map((t) => (
              <div key={t.id} className="summary-item">
                <div>
                  <div className="summary-title">{t.category || "Без категории"}</div>
                  <div className="summary-meta">
                    {formatDate(t.date)}
                    {t.account ? ` · ${t.account}` : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </div>
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
