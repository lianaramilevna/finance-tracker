import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deleteTransaction,
  getTransactions,
  updateTransaction,
} from "../../shared/api/transactions";
import { getAccounts } from "../../shared/api/accounts";
import { getCategories } from "../../shared/api/categories";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { getCurrentUser } from "../../shared/lib/session";
import { formatDate, formatMoney } from "../../shared/lib/format";
import { isTransferTransaction } from "../../shared/lib/calc";
import { toast } from "../../shared/ui/ToastProvider";
import { FiEdit2, FiTrash2, FiX } from "react-icons/fi";
import "./transactions.css";

function Transactions() {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editCategories, setEditCategories] = useState([]);
  const [editOptionsLoading, setEditOptionsLoading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  const [editForm, setEditForm] = useState({
    accountId: "",
    categoryId: "",
    amount: "",
    type: "expense",
    date: "",
    note: "",
  });

  const loadTransactions = useCallback(async () => {
    if (!userId) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await getTransactions();
      setTransactions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadAccounts = useCallback(async () => {
    if (!userId) {
      setAccounts([]);
      return;
    }

    try {
      const data = await getAccounts();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setAccounts([]);
    }
  }, [userId]);

  useEffect(() => {
    loadTransactions();
    loadAccounts();

    window.addEventListener(FINANCE_DATA_CHANGED, loadTransactions);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, loadTransactions);
  }, [loadTransactions, loadAccounts]);

  useEffect(() => {
    if (!editOpen || !userId) return;

    let active = true;

    const loadEditCategories = async () => {
      try {
        setEditOptionsLoading(true);
        const data = await getCategories(editForm.type);
        if (!active) return;
        setEditCategories(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
        if (active) setEditCategories([]);
      } finally {
        if (active) setEditOptionsLoading(false);
      }
    };

    loadEditCategories();

    return () => {
      active = false;
    };
  }, [editOpen, editForm.type, userId]);

  const accountOptions = useMemo(() => {
    const map = new Map();

    accounts.forEach((acc) => {
      map.set(String(acc.id), {
        id: acc.id,
        name: acc.name,
      });
    });

    return [...map.values()];
  }, [accounts]);

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transactions.filter((t) => {
      const matchesType = typeFilter === "all" ? true : t.type === typeFilter;
      const matchesAccount =
        accountFilter === "all" ? true : String(t.account_id) === accountFilter;

      const formattedDate = t.date ? formatDate(t.date).toLowerCase() : "";
      const rawDate = t.date ? String(t.date).toLowerCase() : "";

      const text = [
        t.category,
        t.account,
        t.note,
        t.type,
        rawDate,
        formattedDate,
        String(t.amount),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = query ? text.includes(query) : true;

      return matchesType && matchesAccount && matchesSearch;
    });
  }, [transactions, search, typeFilter, accountFilter]);

  const sortedTransactions = useMemo(() => {
    const list = [...filteredTransactions];

    if (sortBy === "newest") {
      return list.sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    if (sortBy === "oldest") {
      return list.sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    if (sortBy === "amount_desc") {
      return list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    }

    if (sortBy === "amount_asc") {
      return list.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    }

    return list;
  }, [filteredTransactions, sortBy]);

  const summary = useMemo(() => {
    const income = sortedTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const expense = sortedTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const balance = income - expense;

    return {
      total: sortedTransactions.length,
      income,
      expense,
      balance,
    };
  }, [sortedTransactions]);

  const handleDelete = async (id) => {
    try {
      await deleteTransaction(id);
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
    } catch (error) {
      console.error(error);
      toast("Не удалось удалить транзакцию");
    }
  };

  const openEdit = (transaction) => {
    setEditingId(transaction.id);
    setEditForm({
      accountId: transaction.account_id ? String(transaction.account_id) : "",
      categoryId: transaction.category_id ? String(transaction.category_id) : "",
      amount: String(transaction.amount ?? ""),
      type: transaction.type || "expense",
      date: transaction.date ? String(transaction.date).slice(0, 10) : "",
      note: transaction.note || "",
    });
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditingId(null);
    setEditCategories([]);
    setEditOptionsLoading(false);
    setSavingEdit(false);
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;

    if (name === "type") {
      setEditForm((prev) => ({
        ...prev,
        type: value,
        categoryId: "",
      }));
      return;
    }

    setEditForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();

    if (!editingId) return;
    if (!editForm.accountId || !editForm.categoryId || !editForm.amount || !editForm.date) {
      toast("Заполни все обязательные поля");
      return;
    }

    try {
      setSavingEdit(true);

      await updateTransaction(editingId, {
        user_id: userId,
        account_id: Number(editForm.accountId),
        category_id: Number(editForm.categoryId),
        amount: Number(editForm.amount),
        type: editForm.type,
        date: editForm.date,
        note: editForm.note.trim() || null,
      });

      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      closeEdit();
    } catch (error) {
      console.error(error);
      toast(error.message || "Не удалось сохранить изменения");
    } finally {
      setSavingEdit(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setAccountFilter("all");
    setSortBy("newest");
  };

  return (
    <div className="transactions-page">
      <div className="transactions-hero">
        <div>
          <p>Журнал операций, фильтрация и управление транзакциями</p>
        </div>

        <div className="transactions-hero-actions">
          <button className="import-btn" type="button" onClick={() => navigate("/import")}>
            Импорт выписки
          </button>

          <button className="clear-filters-btn" type="button" onClick={clearFilters}>
            Сбросить фильтры
          </button>
        </div>
      </div>

      <div className="transactions-summary">
        <div className="summary-card">
          <span>Показано</span>
          <strong>{summary.total}</strong>
        </div>

        <div className="summary-card">
          <span>Доходы</span>
          <strong className="summary-income">
            {formatMoney(summary.income, currency)}
          </strong>
        </div>

        <div className="summary-card">
          <span>Расходы</span>
          <strong className="summary-expense">
            {formatMoney(summary.expense, currency)}
          </strong>
        </div>

        <div className="summary-card">
          <span>Итог</span>
          <strong className={summary.balance >= 0 ? "summary-positive" : "summary-negative"}>
            {formatMoney(summary.balance, currency)}
          </strong>
        </div>
      </div>

      <div className="toolbar toolbar-grid">
        <input
          className="search-input"
          type="text"
          placeholder="Поиск по категории, счёту, заметке, сумме или дате"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="all">Все типы</option>
          <option value="expense">Расходы</option>
          <option value="income">Доходы</option>
        </select>

        <select
          className="filter-select"
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
        >
          <option value="all">Все счета</option>
          {accountOptions.map((account) => (
            <option key={account.id} value={String(account.id)}>
              {account.name}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
          <option value="amount_desc">Сумма: по убыванию</option>
          <option value="amount_asc">Сумма: по возрастанию</option>
        </select>
      </div>

      <section className="panel transactions-panel">
        <div className="panel-head">
          <h2>Список транзакций</h2>
          <span>{loading ? "Загрузка..." : "Готово"}</span>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : sortedTransactions.length === 0 ? (
          <p className="empty-state">Нет транзакций по выбранным фильтрам</p>
        ) : (
          <div className="transactions-table">
            <div className="table-head">
              <span>Дата</span>
              <span>Счёт</span>
              <span>Категория</span>
              <span>Тип</span>
              <span>Сумма</span>
              <span>Заметка</span>
              <span>Действия</span>
            </div>

            {sortedTransactions.map((t) => (
              <div key={t.id} className="table-row">
                <span>{formatDate(t.date)}</span>
                <span>{t.account || "—"}</span>
                <span className="row-category">{t.category || "Без категории"}</span>
                <span className={t.type === "income" ? "type income" : "type expense"}>
                  {isTransferTransaction(t)
                    ? "Перевод"
                    : t.type === "income"
                    ? "Доход"
                    : "Расход"}
                </span>
                <span className={t.type === "income" ? "amount income" : "amount expense"}>
                  {t.type === "income" ? "+" : "-"}
                  {formatMoney(t.amount, currency)}
                </span>
                <span className="note">{t.note || "—"}</span>

                <span className="transaction-row-actions">
                  <button
  className="edit-btn"
  onClick={() => openEdit(t)}
  title="Редактировать"
  type="button"
>
  <FiEdit2 size={16} />
</button>

<button
  className="delete-btn"
  onClick={() => handleDelete(t.id)}
  title="Удалить"
  type="button"
>
  <FiTrash2 size={16} />
</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {editOpen && (
        <div className="transaction-modal-overlay" onClick={closeEdit}>
          <div className="transaction-modal" onClick={(e) => e.stopPropagation()}>
            <div className="transaction-modal-head">
              <h3>Редактировать транзакцию</h3>
              <button type="button" className="modal-close-btn" onClick={closeEdit}>
                <FiX size={18} />
              </button>
            </div>

            {editOptionsLoading ? (
              <p className="empty-state">Загрузка данных...</p>
            ) : (
              <form className="transaction-edit-form" onSubmit={handleSaveEdit}>
                <div className="transaction-edit-field">
                  <label>Счёт</label>
                  <select
                    name="accountId"
                    value={editForm.accountId}
                    onChange={handleEditChange}
                  >
                    <option value="">Выбери счёт</option>
                    {accountOptions.map((account) => (
                      <option key={account.id} value={String(account.id)}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="transaction-edit-field">
                  <label>Тип</label>
                  <select name="type" value={editForm.type} onChange={handleEditChange}>
                    <option value="expense">Расход</option>
                    <option value="income">Доход</option>
                  </select>
                </div>

                <div className="transaction-edit-field">
                  <label>Категория</label>
                  <select
                    name="categoryId"
                    value={editForm.categoryId}
                    onChange={handleEditChange}
                  >
                    <option value="">Выбери категорию</option>
                    {editCategories.map((category) => (
                      <option key={category.id} value={String(category.id)}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="transaction-edit-field">
                  <label>Сумма</label>
                  <input
                    type="number"
                    name="amount"
                    value={editForm.amount}
                    onChange={handleEditChange}
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="transaction-edit-field">
                  <label>Дата</label>
                  <input
                    type="date"
                    name="date"
                    value={editForm.date}
                    onChange={handleEditChange}
                  />
                </div>

                <div className="transaction-edit-field full">
                  <label>Заметка</label>
                  <textarea
                    name="note"
                    value={editForm.note}
                    onChange={handleEditChange}
                    placeholder="Необязательно"
                  />
                </div>

                <div className="modal-actions">
                  <button type="button" className="modal-secondary" onClick={closeEdit}>
                    Отмена
                  </button>

                  <button
                    type="submit"
                    className="modal-primary"
                    disabled={savingEdit}
                  >
                    {savingEdit ? "Сохранение..." : "Сохранить"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Transactions;