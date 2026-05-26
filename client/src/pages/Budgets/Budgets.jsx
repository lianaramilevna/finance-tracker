import { useCallback, useEffect, useMemo, useState } from "react";
import { createBudget, deleteBudget, getBudgets, updateBudget } from "../../shared/api/budgets";
import { getCategories } from "../../shared/api/categories";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { formatMoney } from "../../shared/lib/format";
import { getCurrentUser } from "../../shared/lib/session";
import { toast } from "../../shared/ui/ToastProvider";
import EmptyState from "../../shared/ui/EmptyState";
import ConfirmModal from "../../shared/ui/ConfirmModal";
import "./budgets.css";

function getMonthValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabel(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return monthKey;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(year, month - 1, 1);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }

  return date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function getBudgetStatus(item) {
  const progress = Number(item.progress_percent || 0);
  if (progress > 100) {
    return "exceeded";
  }
  if (progress >= 80) {
    return "warning";
  }
  return "ok";
}

function formatBudgetStatus(status) {
  if (status === "exceeded") {
    return "Перерасход";
  }
  if (status === "warning") {
    return "Близко к лимиту";
  }
  return "В норме";
}

function Budgets() {
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [month, setMonth] = useState(getMonthValue());
  const [categories, setCategories] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const [form, setForm] = useState({
    categoryId: "",
    limitAmount: "",
  });

  const loadData = useCallback(async () => {
    if (!userId) {
      setCategories([]);
      setBudgets([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [categoriesResult, budgetsResult] = await Promise.allSettled([
        getCategories("expense"),
        getBudgets(month),
      ]);

      if (categoriesResult.status === "fulfilled") {
        setCategories(Array.isArray(categoriesResult.value) ? categoriesResult.value : []);
      } else {
        console.error(categoriesResult.reason);
        setCategories([]);
      }

      if (budgetsResult.status === "fulfilled") {
        setBudgets(Array.isArray(budgetsResult.value) ? budgetsResult.value : []);
      } else {
        console.error(budgetsResult.reason);
        setBudgets([]);
      }
    } catch (error) {
      console.error(error);
      setCategories([]);
      setBudgets([]);
    } finally {
      setLoading(false);
    }
  }, [month, userId]);

  useEffect(() => {
    loadData();
    window.addEventListener(FINANCE_DATA_CHANGED, loadData);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, loadData);
  }, [loadData]);

  useEffect(() => {
    if (!form.categoryId && categories.length > 0) {
      setForm((prev) => ({ ...prev, categoryId: String(categories[0].id) }));
    }
  }, [categories, form.categoryId]);

  const summary = useMemo(() => {
    const totalLimit = budgets.reduce((sum, item) => sum + Number(item.limit_amount || 0), 0);
    const totalSpent = budgets.reduce((sum, item) => sum + Number(item.spent || 0), 0);
    return {
      totalLimit,
      totalSpent,
      totalRemaining: Math.max(totalLimit - totalSpent, 0),
    };
  }, [budgets]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAddBudget = async (event) => {
    event.preventDefault();

    if (!userId || !form.categoryId || form.limitAmount === "") {
      return;
    }

    try {
      setSaving(true);
      await createBudget({
        user_id: userId,
        category_id: Number(form.categoryId),
        month,
        limit_amount: Number(form.limitAmount),
      });

      setForm((prev) => ({ ...prev, limitAmount: "" }));
      await loadData();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Лимит сохранён");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось сохранить бюджет");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickUpdate = async (id, nextValue) => {
    const amount = Number(nextValue);
    if (Number.isNaN(amount) || amount < 0) {
      return;
    }

    try {
      await updateBudget(id, { limit_amount: amount });
      await loadData();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Лимит обновлён");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось обновить лимит");
    }
  };

  const requestDelete = (id) => {
    setPendingDeleteId(id);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;

    try {
      setDeleting(true);
      await deleteBudget(id);
      await loadData();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setDeleteOpen(false);
      setPendingDeleteId(null);
      toast.success("Лимит удалён");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось удалить лимит");
    } finally {
      setDeleting(false);
    }
  };

  const monthLabel = formatMonthLabel(month);
  const overCount = budgets.filter((item) => getBudgetStatus(item) === "exceeded").length;

  return (
    <div className="budgets-page">
      <p className="page-subtitle">Лимиты расходов по категориям и контроль исполнения за месяц</p>

      <details className="panel budgets-panel budgets-guide budgets-collapsible">
        <summary className="budgets-collapsible-summary">
          <span>Как работает бюджет</span>
        </summary>
        <div className="budgets-guide-grid">
          <div className="budgets-guide-card">
            <h3>Бюджет (лимит)</h3>
            <p>
              Это <strong>план</strong>: сколько максимум хотите потратить по категории в выбранном
              месяце. Лимит задаётся отдельно на каждый месяц и категорию.
            </p>
            <p className="budgets-guide-example">
              Пример: «Продукты» — 25 000 ₽ на май.
            </p>
          </div>
          <div className="budgets-guide-card">
            <h3>Факт (операции)</h3>
            <p>
              Это <strong>сумма расходов</strong> по категории за месяц из раздела «Операции».
              Переводы между счетами и доходы в бюджет не попадают.
            </p>
            <p className="budgets-guide-example">
              Пример: потрачено 18 400 ₽ — остаток 6 600 ₽ (74%).
            </p>
          </div>
        </div>
        <ul className="budgets-guide-list">
          <li>
            <strong>Одна категория — один лимит</strong> на месяц. Повторное сохранение обновит сумму,
            а не создаст дубликат.
          </li>
          <li>
            <strong>Полоса зелёная</strong> до 100%, <strong>красная</strong> при перерасходе.
            Бейдж «Близко к лимиту» — от 80%.
          </li>
          <li>
            <strong>Аналитика</strong> показывает общую картину трат; <strong>бюджет</strong> — контроль
            лимитов по категориям. Используйте вместе.
          </li>
          <li>
            <strong>Помощник</strong> напомнит о перерасходе и предложит скорректировать лимит, если
            траты повторяются из месяца в месяц.
          </li>
        </ul>
      </details>

      <div className="budgets-toolbar">
        <label className="budgets-month-field">
          <span>Месяц</span>
          <input
            className="budgets-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <p className="budgets-month-hint">
          Сейчас: <strong>{monthLabel}</strong>
          {overCount > 0 ? ` · перерасход в ${overCount} катег.` : ""}
        </p>
      </div>

      <div className="budgets-stats">
        <div className="budgets-stat">
          <span>Лимиты</span>
          <strong>{formatMoney(summary.totalLimit, currency)}</strong>
        </div>
        <div className="budgets-stat">
          <span>Потрачено</span>
          <strong>{formatMoney(summary.totalSpent, currency)}</strong>
        </div>
        <div className="budgets-stat">
          <span>Остаток</span>
          <strong>{formatMoney(summary.totalRemaining, currency)}</strong>
        </div>
        <div className="budgets-stat">
          <span>Категорий с лимитом</span>
          <strong>{budgets.length}</strong>
        </div>
      </div>

      <section className="panel budgets-panel">
        <div className="panel-head">
          <h2>Добавить лимит</h2>
          <span>Если категория уже есть, лимит обновится</span>
        </div>

        <form className="budgets-form" onSubmit={handleAddBudget}>
          <select
            name="categoryId"
            value={form.categoryId}
            onChange={handleChange}
            disabled={categories.length === 0}
          >
            {categories.length === 0 ? (
              <option value="">Нет категорий расходов</option>
            ) : (
              categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))
            )}
          </select>

          <input
            type="number"
            name="limitAmount"
            placeholder="Лимит"
            min="0"
            step="1"
            value={form.limitAmount}
            onChange={handleChange}
          />

          <button type="submit" disabled={saving || categories.length === 0}>
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </form>
      </section>

      <ConfirmModal
        open={deleteOpen}
        title="Удалить лимит бюджета?"
        description="Лимит будет удалён только за выбранный месяц."
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

      <section className="panel budgets-panel">
        <div className="panel-head">
          <h2>Прогресс бюджета</h2>
          <span>{loading ? "Загрузка..." : "Готово"}</span>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : categories.length === 0 ? (
          <EmptyState
            title="Нет категорий расходов"
            description="Сначала добавьте расходы в операциях — категории появятся автоматически, и можно будет задать лимиты."
            actionLabel="К операциям"
            actionTo="/transactions"
          />
        ) : budgets.length === 0 ? (
          <EmptyState
            title="Лимиты на этот месяц не заданы"
            description="Добавьте лимит по категории выше — помощник сможет предупреждать о перерасходе."
          />
        ) : (
          <div className="budgets-list">
            {budgets.map((item) => {
              const progress = Math.min(Number(item.progress_percent || 0), 999);
              const barWidth = `${Math.min(progress, 100)}%`;
              const isOver = progress > 100;
              const status = getBudgetStatus(item);

              return (
                <article
                  key={item.id}
                  className={`budget-item budget-item--${status}`}
                >
                  <div className="budget-top">
                    <div>
                      <h3>{item.category_name}</h3>
                      <p>
                        {formatMoney(item.spent, currency)} из {formatMoney(item.limit_amount, currency)}
                      </p>
                    </div>

                    <div className="budget-top-actions">
                      <span className={`budget-status-badge budget-status-badge--${status}`}>
                        {formatBudgetStatus(status)}
                      </span>
                      <button type="button" className="budget-delete" onClick={() => requestDelete(item.id)}>
                        Удалить
                      </button>
                    </div>
                  </div>

                  <div className="budget-progress-track">
                    <div
                      className={isOver ? "budget-progress-fill budget-progress-over" : "budget-progress-fill"}
                      style={{ width: barWidth }}
                    />
                  </div>

                  <div className="budget-meta">
                    <span>{progress}%</span>
                    <span>
                      Остаток: {formatMoney(item.remaining, currency)}
                    </span>
                  </div>

                  <div className="budget-edit">
                    <label htmlFor={`limit-${item.id}`}>Лимит:</label>
                    <input
                      id={`limit-${item.id}`}
                      type="number"
                      defaultValue={Number(item.limit_amount)}
                      min="0"
                      step="1"
                      onBlur={(event) => handleQuickUpdate(item.id, event.target.value)}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default Budgets;