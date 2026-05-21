import { useEffect, useMemo, useState } from "react";
import { createCategory, getCategories } from "../../shared/api/categories";
import { getAccounts } from "../../shared/api/accounts";
import { getCurrentUser } from "../../shared/lib/session";
import { toast } from "../../shared/ui/ToastProvider";

function AddTransaction({ onAdd, onCancel }) {
  const user = getCurrentUser();
  const userId = user?.id || null;

  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [newCategory, setNewCategory] = useState("");

  const [form, setForm] = useState({
    amount: "",
    accountId: "",
    categoryId: "",
    type: "expense",
    date: "",
    note: "",
  });

  const safeAccounts = useMemo(() => {
    return Array.isArray(accounts) ? accounts : [];
  }, [accounts]);

  const safeCategories = useMemo(() => {
    return Array.isArray(categories) ? categories : [];
  }, [categories]);

  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      try {
        const [accountsData, categoriesData] = await Promise.all([
          userId ? getAccounts() : Promise.resolve([]),
          getCategories(form.type),
        ]);

        if (!mounted) return;

        setAccounts(Array.isArray(accountsData) ? accountsData : []);
        setCategories(Array.isArray(categoriesData) ? categoriesData : []);

        if (Array.isArray(accountsData) && accountsData.length > 0) {
          setForm((prev) => ({
            ...prev,
            accountId: prev.accountId || String(accountsData[0].id),
          }));
        }
      } catch (error) {
        console.error(error);
        if (mounted) {
          setAccounts([]);
          setCategories([]);
        }
      }
    };

    loadData();

    setForm((prev) => ({
      ...prev,
      categoryId: "",
    }));
    setShowNewCategoryInput(false);
    setNewCategory("");

    return () => {
      mounted = false;
    };
  }, [form.type, userId]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "categoryId" && value === "__new__") {
      setShowNewCategoryInput(true);
      return;
    }

    if (name === "type") {
      setForm((prev) => ({
        ...prev,
        type: value,
        categoryId: "",
      }));
      setShowNewCategoryInput(false);
      setNewCategory("");
      return;
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAddNewCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;

    try {
      const created = await createCategory({
        name: trimmed,
        type: form.type,
        user_id: userId,
      });

      setCategories((prev) => [...prev, created]);

      setForm((prev) => ({
        ...prev,
        categoryId: String(created.id),
      }));

      setNewCategory("");
      setShowNewCategoryInput(false);
    } catch (error) {
      console.error(error);
      toast(error.message || "Не удалось добавить категорию");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.amount || !form.accountId || !form.categoryId || !form.date) return;

    onAdd({
      id: Date.now(),
      amount: Number(form.amount),
      account_id: Number(form.accountId),
      category_id: Number(form.categoryId),
      type: form.type,
      date: form.date,
      note: form.note || null,
      user_id: userId,
    });

    setForm({
      amount: "",
      accountId: "",
      categoryId: "",
      type: "expense",
      date: "",
      note: "",
    });

    setShowNewCategoryInput(false);
    setNewCategory("");

    if (onCancel) onCancel();
  };

  return (
    <form className="transaction-form" onSubmit={handleSubmit}>
      <div className="transaction-field">
        <label>Счёт</label>
        <select
          name="accountId"
          value={form.accountId}
          onChange={handleChange}
          required
        >
          <option value="">Выбери счёт</option>
          {safeAccounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </select>

        {safeAccounts.length === 0 && (
          <small style={{ color: "#64748b" }}>
            Сначала добавь счёт в разделе Счета
          </small>
        )}
      </div>

      <div className="transaction-field">
        <label>Сумма</label>
        <input
          type="number"
          name="amount"
          value={form.amount}
          onChange={handleChange}
          placeholder="Например, 1200"
          min="0"
          step="0.01"
        />
      </div>

      <div className="transaction-field">
        <label>Тип</label>
        <select name="type" value={form.type} onChange={handleChange}>
          <option value="expense">Расход</option>
          <option value="income">Доход</option>
        </select>
      </div>

      <div className="transaction-field">
        <label>Категория</label>

        {!showNewCategoryInput ? (
          <select
            name="categoryId"
            value={form.categoryId}
            onChange={handleChange}
          >
            <option value="">Выбери категорию</option>

            {safeCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}

            <option value="__new__">+ Новая категория</option>
          </select>
        ) : (
          <div style={{ display: "flex", gap: "10px" }}>
            <input
              type="text"
              name="newCategory"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Новая категория"
            />

            <button type="button" className="add-category-btn" onClick={handleAddNewCategory}>
              Добавить
            </button>
          </div>
        )}
      </div>

      <div className="transaction-field">
        <label>Дата</label>
        <input
          type="date"
          name="date"
          value={form.date}
          onChange={handleChange}
        />
      </div>

      <div className="transaction-field">
        <label>Заметка</label>
        <input
          type="text"
          name="note"
          value={form.note}
          onChange={handleChange}
          placeholder="Необязательно"
        />
      </div>

      <div className="transaction-actions">
        <button type="submit" className="primary-btn">
          Добавить
        </button>

        {onCancel && (
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}

export default AddTransaction;