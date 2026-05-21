import { useCallback, useEffect, useMemo, useState } from "react";
import { createBudget, deleteBudget, getBudgets, updateBudget } from "../../shared/api/budgets";
import { getCategories } from "../../shared/api/categories";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { formatMoney } from "../../shared/lib/format";
import { getCurrentUser } from "../../shared/lib/session";
import { toast } from "../../shared/ui/ToastProvider";
import "./budgets.css";

function getMonthValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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
    } catch (error) {
      console.error(error);
      toast("Не удалось сохранить бюджет");
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
    } catch (error) {
      console.error(error);
      toast("Не удалось обновить лимит");
    }
  };

  const handleDelete = async (id) => {
    const confirmed = window.confirm("Удалить лимит бюджета?");
    if (!confirmed) {
      return;
    }

    try {
      await deleteBudget(id);
      await loadData();
    } catch (error) {
      console.error(error);
      toast("Не удалось удалить лимит");
    }
  };

  return (
    <div className="budgets-page">
      <div className="budgets-hero">
        <div>
          <p>Лимиты расходов по категориям и контроль исполнения за месяц</p>
        </div>

        <input
          className="budgets-month"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
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

      <section className="panel budgets-panel">
        <div className="panel-head">
          <h2>Прогресс бюджета</h2>
          <span>{loading ? "Загрузка..." : "Готово"}</span>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : budgets.length === 0 ? (
          <p className="empty-state">На этот месяц лимиты еще не добавлены</p>
        ) : (
          <div className="budgets-list">
            {budgets.map((item) => {
              const progress = Math.min(Number(item.progress_percent || 0), 999);
              const barWidth = `${Math.min(progress, 100)}%`;
              const isOver = progress > 100;

              return (
                <article key={item.id} className="budget-item">
                  <div className="budget-top">
                    <div>
                      <h3>{item.category_name}</h3>
                      <p>
                        {formatMoney(item.spent, currency)} из {formatMoney(item.limit_amount, currency)}
                      </p>
                    </div>

                    <button type="button" className="budget-delete" onClick={() => handleDelete(item.id)}>
                      Удалить
                    </button>
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