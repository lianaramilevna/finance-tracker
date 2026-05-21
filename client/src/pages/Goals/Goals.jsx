import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createGoal,
  contributeToGoal,
  deleteGoal,
  getGoalContributions,
  getGoals,
  updateGoal,
} from "../../shared/api/goals";
import { getAccounts } from "../../shared/api/accounts";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { formatDate, formatMoney } from "../../shared/lib/format";
import { getCurrentUser } from "../../shared/lib/session";
import "./goals.css";

function getRecommendedContribution(goal) {
  if (!goal?.target_date) {
    return null;
  }

  const remaining = Number(goal.remaining || 0);
  if (remaining <= 0) {
    return 0;
  }

  const today = new Date();
  const deadline = new Date(goal.target_date);
  if (Number.isNaN(deadline.getTime())) {
    return null;
  }

  const monthsLeft =
    (deadline.getFullYear() - today.getFullYear()) * 12 +
    (deadline.getMonth() - today.getMonth()) +
    (deadline.getDate() >= today.getDate() ? 1 : 0);

  if (monthsLeft <= 0) {
    return remaining;
  }

  return Math.ceil(remaining / monthsLeft);
}

function Goals() {
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [goals, setGoals] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contributeValue, setContributeValue] = useState({});
  const [contributeAccount, setContributeAccount] = useState({});
  const [expandedGoalId, setExpandedGoalId] = useState(null);
  const [historyByGoal, setHistoryByGoal] = useState({});
  const [editByGoal, setEditByGoal] = useState({});

  const [form, setForm] = useState({
    name: "",
    targetAmount: "",
    targetDate: "",
  });

  const loadGoals = useCallback(async () => {
    if (!userId) {
      setGoals([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [goalsData, accountsData] = await Promise.all([
        getGoals(userId),
        getAccounts(userId),
      ]);
      setGoals(Array.isArray(goalsData) ? goalsData : []);
      setAccounts(Array.isArray(accountsData) ? accountsData : []);
    } catch (error) {
      console.error(error);
      setGoals([]);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadGoals();
    window.addEventListener(FINANCE_DATA_CHANGED, loadGoals);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, loadGoals);
  }, [loadGoals]);

  const totals = useMemo(() => {
    const totalTarget = goals.reduce((sum, goal) => sum + Number(goal.target_amount || 0), 0);
    const totalCurrent = goals.reduce((sum, goal) => sum + Number(goal.current_amount || 0), 0);
    return {
      totalTarget,
      totalCurrent,
      totalRemaining: Math.max(totalTarget - totalCurrent, 0),
    };
  }, [goals]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreate = async (event) => {
    event.preventDefault();

    if (!userId || !form.name.trim() || form.targetAmount === "") {
      return;
    }

    try {
      setSaving(true);
      await createGoal({
        user_id: userId,
        name: form.name.trim(),
        target_amount: Number(form.targetAmount),
        target_date: form.targetDate || null,
      });

      setForm({
        name: "",
        targetAmount: "",
        targetDate: "",
      });

      await loadGoals();
    } catch (error) {
      console.error(error);
      alert("Не удалось создать цель");
    } finally {
      setSaving(false);
    }
  };

  const handleContribute = async (goalId) => {
    const amount = Number(contributeValue[goalId] || 0);
    if (Number.isNaN(amount) || amount <= 0) {
      return;
    }

    try {
      const selectedAccountId = contributeAccount[goalId]
        ? Number(contributeAccount[goalId])
        : null;

      await contributeToGoal(goalId, {
        amount,
        account_id: selectedAccountId,
      });
      setContributeValue((prev) => ({ ...prev, [goalId]: "" }));
      await loadHistory(goalId);
      await loadGoals();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
    } catch (error) {
      console.error(error);
      alert("Не удалось пополнить цель");
    }
  };

  const handleDelete = async (goalId) => {
    const confirmed = window.confirm("Удалить цель?");
    if (!confirmed) {
      return;
    }

    try {
      await deleteGoal(goalId);
      await loadGoals();
    } catch (error) {
      console.error(error);
      alert("Не удалось удалить цель");
    }
  };

  const loadHistory = async (goalId) => {
    try {
      const items = await getGoalContributions(goalId);
      setHistoryByGoal((prev) => ({
        ...prev,
        [goalId]: Array.isArray(items) ? items : [],
      }));
    } catch (error) {
      console.error(error);
      setHistoryByGoal((prev) => ({ ...prev, [goalId]: [] }));
    }
  };

  const handleToggleHistory = async (goalId) => {
    const nextExpanded = expandedGoalId === goalId ? null : goalId;
    setExpandedGoalId(nextExpanded);
    if (nextExpanded && !historyByGoal[goalId]) {
      await loadHistory(goalId);
    }
  };

  const handleEditOpen = (goal) => {
    setEditByGoal((prev) => ({
      ...prev,
      [goal.id]: {
        name: goal.name || "",
        target_amount: Number(goal.target_amount || 0),
        target_date: goal.target_date || "",
        status: goal.status || "active",
      },
    }));
  };

  const handleEditChange = (goalId, field, value) => {
    setEditByGoal((prev) => ({
      ...prev,
      [goalId]: {
        ...prev[goalId],
        [field]: value,
      },
    }));
  };

  const handleEditSave = async (goalId) => {
    const payload = editByGoal[goalId];
    if (!payload) {
      return;
    }

    try {
      await updateGoal(goalId, {
        name: payload.name,
        target_amount: Number(payload.target_amount),
        target_date: payload.target_date || null,
        status: payload.status,
      });
      setEditByGoal((prev) => {
        const next = { ...prev };
        delete next[goalId];
        return next;
      });
      await loadGoals();
    } catch (error) {
      console.error(error);
      alert("Не удалось обновить цель");
    }
  };

  return (
    <div className="goals-page">
      <div className="goals-hero">
        <div>
          <p>Финансовые цели с прогрессом и быстрым пополнением</p>
        </div>
      </div>

      <div className="goals-stats">
        <div className="goals-stat">
          <span>Целей</span>
          <strong>{goals.length}</strong>
        </div>
        <div className="goals-stat">
          <span>Накоплено</span>
          <strong>{formatMoney(totals.totalCurrent, currency)}</strong>
        </div>
        <div className="goals-stat">
          <span>Осталось</span>
          <strong>{formatMoney(totals.totalRemaining, currency)}</strong>
        </div>
      </div>

      <section className="panel goals-panel">
        <div className="panel-head">
          <h2>Новая цель</h2>
          <span>Например: отпуск, техника, подушка безопасности</span>
        </div>

        <form className="goals-form" onSubmit={handleCreate}>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            placeholder="Название цели"
          />
          <input
            type="number"
            name="targetAmount"
            value={form.targetAmount}
            onChange={handleChange}
            min="1"
            step="1"
            placeholder="Целевая сумма"
          />
          <input
            type="date"
            name="targetDate"
            value={form.targetDate}
            onChange={handleChange}
          />
          <button type="submit" disabled={saving}>
            {saving ? "Сохранение..." : "Создать"}
          </button>
        </form>
      </section>

      <section className="panel goals-panel">
        <div className="panel-head">
          <h2>Мои цели</h2>
          <span>{loading ? "Загрузка..." : "Готово"}</span>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : goals.length === 0 ? (
          <p className="empty-state">Пока нет целей</p>
        ) : (
          <div className="goals-list">
            {goals.map((goal) => {
              const progress = Math.min(Number(goal.progress_percent || 0), 100);
              const isCompleted = Number(goal.current_amount || 0) >= Number(goal.target_amount || 0);
              const recommended = getRecommendedContribution(goal);
              const editModel = editByGoal[goal.id];

              return (
                <article key={goal.id} className="goal-item">
                  <div className="goal-top">
                    <div>
                      <h3>{goal.name}</h3>
                      <p>
                        {formatMoney(goal.current_amount, currency)} из {formatMoney(goal.target_amount, currency)}
                      </p>
                    </div>
                    <button type="button" className="goal-delete" onClick={() => handleDelete(goal.id)}>
                      Удалить
                    </button>
                  </div>

                  <div className="goal-progress-track">
                    <div className="goal-progress-fill" style={{ width: `${progress}%` }} />
                  </div>

                  <div className="goal-meta">
                    <span>{progress}%</span>
                    <span>
                      {isCompleted
                        ? "Цель выполнена"
                        : `Осталось: ${formatMoney(goal.remaining, currency)}`}
                    </span>
                  </div>

                  <div className="goal-extra-meta">
                    <span>
                      Дедлайн: {formatDate(goal.target_date, "не указан")}
                    </span>
                    <span>
                      Рекомендуемый взнос:{" "}
                      {recommended === null ? "—" : formatMoney(recommended, currency)}
                    </span>
                  </div>

                  <div className="goal-actions">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="Сумма пополнения"
                      value={contributeValue[goal.id] ?? ""}
                      onChange={(event) =>
                        setContributeValue((prev) => ({ ...prev, [goal.id]: event.target.value }))
                      }
                    />
                    <select
                      value={contributeAccount[goal.id] ?? ""}
                      onChange={(event) =>
                        setContributeAccount((prev) => ({
                          ...prev,
                          [goal.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Без списания со счета</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => handleContribute(goal.id)}>
                      Пополнить
                    </button>
                    <button type="button" onClick={() => handleToggleHistory(goal.id)}>
                      {expandedGoalId === goal.id ? "Скрыть историю" : "История"}
                    </button>
                    <button
                      type="button"
                      onClick={() => (editModel ? handleEditSave(goal.id) : handleEditOpen(goal))}
                    >
                      {editModel ? "Сохранить" : "Редактировать"}
                    </button>
                  </div>

                  {editModel && (
                    <div className="goal-edit-grid">
                      <input
                        type="text"
                        value={editModel.name}
                        onChange={(event) => handleEditChange(goal.id, "name", event.target.value)}
                        placeholder="Название"
                      />
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={editModel.target_amount}
                        onChange={(event) =>
                          handleEditChange(goal.id, "target_amount", event.target.value)
                        }
                        placeholder="Целевая сумма"
                      />
                      <input
                        type="date"
                        value={editModel.target_date || ""}
                        onChange={(event) =>
                          handleEditChange(goal.id, "target_date", event.target.value)
                        }
                      />
                      <select
                        value={editModel.status}
                        onChange={(event) => handleEditChange(goal.id, "status", event.target.value)}
                      >
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="completed">completed</option>
                      </select>
                    </div>
                  )}

                  {expandedGoalId === goal.id && (
                    <div className="goal-history">
                      <h4>История пополнений</h4>
                      {Array.isArray(historyByGoal[goal.id]) && historyByGoal[goal.id].length > 0 ? (
                        historyByGoal[goal.id].map((item) => (
                          <div key={item.id} className="goal-history-item">
                            <span>{formatDate(item.date)}</span>
                            <span>{item.account_name || "Без счета"}</span>
                            <span>{formatMoney(item.amount, currency)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="empty-state">Пополнений пока нет</p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default Goals;