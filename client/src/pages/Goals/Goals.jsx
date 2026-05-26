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
import { GOAL_STATUS_OPTIONS, formatGoalStatus } from "../../shared/lib/goalStatus";
import { toast } from "../../shared/ui/ToastProvider";
import EmptyState from "../../shared/ui/EmptyState";
import ConfirmModal from "../../shared/ui/ConfirmModal";
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

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
        getGoals(),
        getAccounts(),
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
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Цель создана");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось создать цель");
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
      toast.success("Цель пополнена");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось пополнить цель");
    }
  };

  const requestDelete = (goalId) => {
    setPendingDeleteId(goalId);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    const goalId = pendingDeleteId;
    if (!goalId) return;

    try {
      setDeleting(true);
      await deleteGoal(goalId);
      await loadGoals();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setDeleteOpen(false);
      setPendingDeleteId(null);
      toast.success("Цель удалена");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось удалить цель");
    } finally {
      setDeleting(false);
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
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Цель обновлена");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось обновить цель");
    }
  };

  return (
    <div className="goals-page">
      <p className="page-subtitle">Финансовые цели с прогрессом и быстрым пополнением</p>

      <details className="panel goals-panel goals-guide goals-collapsible">
        <summary className="goals-collapsible-summary">
          <span>Цель и счёт «Сбережения» — в чём разница</span>
        </summary>
        <div className="goals-guide-grid">
          <div className="goals-guide-card">
            <h3>Счёт «Сбережения»</h3>
            <p>
              Это <strong>кошелёк</strong>: где физически лежат отложенные деньги. Баланс меняется
              переводами и операциями. Перевод с карты сюда <strong>не считается расходом</strong> в
              аналитике.
            </p>
            <p className="goals-guide-example">
              Пример: «Накопительный счёт в банке» — 150 000 ₽ на балансе.
            </p>
          </div>
          <div className="goals-guide-card">
            <h3>Цель</h3>
            <p>
              Это <strong>план</strong>: название, сумма к дате, прогресс в процентах. Отдельного
              банковского счёта у цели нет — это учёт «зачем копим».
            </p>
            <p className="goals-guide-example">
              Пример: «Отпуск» — нужно 200 000 ₽, накоплено 45 000 ₽ (22%).
            </p>
          </div>
        </div>
        <ul className="goals-guide-list">
          <li>
            <strong>Только копилка без дедлайна</strong> — достаточно счёта «Сбережения» и переводов
            с карты.
          </li>
          <li>
            <strong>Конкретная цель с датой</strong> — создайте цель; взнос со счёта спишет деньги и
            увеличит прогресс (в аналитике — категория «Цели»).
          </li>
          <li>
            <strong>Сначала перевод, потом прогресс</strong> — перевели на «Сбережения», в цели
            нажмите «Пополнить» с пунктом «Без списания со счёта», чтобы не списать дважды.
          </li>
          <li>
            <strong>Взнос с накопительного</strong> — выберите счёт «Сбережения»: баланс кошелька и
            прогресс цели обновятся вместе.
          </li>
        </ul>
      </details>

      <details className="panel goals-panel goals-guide goals-collapsible">
        <summary className="goals-collapsible-summary">
          <span>Статусы, взносы и дедлайн</span>
        </summary>
        <ul className="goals-guide-list">
          <li>
            <strong>Активна</strong> — цель в работе, прогресс учитывается в сводке и в помощнике.
          </li>
          <li>
            <strong>На паузе</strong> — отложили накопление, данные сохраняются; можно вернуть в
            «Активна» через «Редактировать».
          </li>
          <li>
            <strong>Выполнена</strong> — цель достигнута; отметьте вручную или дождитесь 100% по
            сумме.
          </li>
          <li>
            <strong>Рекомендуемый взнос</strong> — остаток до цели, поделённый на месяцы до дедлайна
            (округление вверх). Без даты срока подсказки нет.
          </li>
          <li>
            <strong>Взнос со счёта</strong> — списание с карты или сбережений; в аналитике учтётся
            как расход (категория «Цели»), если выбран счёт.
          </li>
          <li>
            <strong>Бюджет</strong> — лимиты на ежедневные траты; цели — на крупные накопления.
            Разные инструменты, дополняют друг друга.
          </li>
        </ul>
      </details>

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

      <ConfirmModal
        open={deleteOpen}
        title="Удалить цель?"
        description="Цель и её история пополнений будут удалены."
        confirmText="Удалить"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setPendingDeleteId(null);
        }}
      />

      <section className="panel goals-panel">
        <div className="panel-head">
          <h2>Мои цели</h2>
          <span>{loading ? "Загрузка..." : "Готово"}</span>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : goals.length === 0 ? (
          <EmptyState
            title="Целей пока нет"
            description="Создайте первую цель выше — укажите сумму и срок, чтобы отслеживать накопления."
          />
        ) : (
          <div className="goals-list">
            {goals.map((goal) => {
              const progress = Math.min(Number(goal.progress_percent || 0), 100);
              const isCompleted = Number(goal.current_amount || 0) >= Number(goal.target_amount || 0);
              const recommended = getRecommendedContribution(goal);
              const editModel = editByGoal[goal.id];
              const statusKey = goal.status || "active";

              return (
                <article
                  key={goal.id}
                  className={`goal-item goal-item--${statusKey}${isCompleted ? " goal-item--done" : ""}`}
                >
                  <div className="goal-top">
                    <div>
                      <h3>{goal.name}</h3>
                      <p>
                        {formatMoney(goal.current_amount, currency)} из {formatMoney(goal.target_amount, currency)}
                      </p>
                    </div>
                    <button type="button" className="goal-delete" onClick={() => requestDelete(goal.id)}>
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
                    <span className={`goal-status-badge goal-status-badge--${statusKey}`}>
                      {formatGoalStatus(goal.status)}
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
                        {GOAL_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
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