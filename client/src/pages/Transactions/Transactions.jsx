import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import EmptyState from "../../shared/ui/EmptyState";
import ConfirmModal from "../../shared/ui/ConfirmModal";
import { FiEdit2, FiTrash2, FiX } from "react-icons/fi";
import "./transactions.css";

function toDateKey(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function Transactions() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortBy, setSortBy] = useState("newest");

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

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

  const loadCategories = useCallback(async () => {
    if (!userId) {
      setAllCategories([]);
      return;
    }

    try {
      const [expense, income] = await Promise.all([
        getCategories("expense"),
        getCategories("income"),
      ]);
      setAllCategories([
        ...(Array.isArray(expense) ? expense : []),
        ...(Array.isArray(income) ? income : []),
      ]);
    } catch (error) {
      console.error(error);
      setAllCategories([]);
    }
  }, [userId]);

  useEffect(() => {
    loadTransactions();
    loadAccounts();
    loadCategories();

    window.addEventListener(FINANCE_DATA_CHANGED, loadTransactions);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, loadTransactions);
  }, [loadTransactions, loadAccounts, loadCategories]);

  useEffect(() => {
    const accountFromUrl = searchParams.get("account");
    if (!accountFromUrl) return;
    setAccountFilter(String(accountFromUrl));
  }, [searchParams]);

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
      map.set(String(acc.id), { id: acc.id, name: acc.name });
    });
    return [...map.values()];
  }, [accounts]);

  const categoryFilterOptions = useMemo(() => {
    if (typeFilter === "all") return allCategories;
    return allCategories.filter((item) => item.type === typeFilter);
  }, [allCategories, typeFilter]);

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transactions.filter((t) => {
      const matchesType = typeFilter === "all" ? true : t.type === typeFilter;
      const matchesAccount =
        accountFilter === "all" ? true : String(t.account_id) === accountFilter;
      const matchesCategory =
        categoryFilter === "all" ? true : String(t.category_id) === categoryFilter;

      const txDate = toDateKey(t.date);
      const matchesDateFrom = dateFrom ? txDate >= dateFrom : true;
      const matchesDateTo = dateTo ? txDate <= dateTo : true;

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

      return (
        matchesType &&
        matchesAccount &&
        matchesCategory &&
        matchesDateFrom &&
        matchesDateTo &&
        matchesSearch
      );
    });
  }, [transactions, search, typeFilter, accountFilter, categoryFilter, dateFrom, dateTo]);

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

  const selectableTransactions = useMemo(
    () => sortedTransactions.filter((t) => !isTransferTransaction(t)),
    [sortedTransactions]
  );

  useEffect(() => {
    const visible = new Set(sortedTransactions.map((t) => t.id));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [sortedTransactions]);

  const summary = useMemo(() => {
    const income = sortedTransactions
      .filter((t) => t.type === "income" && !isTransferTransaction(t))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const expense = sortedTransactions
      .filter((t) => t.type === "expense" && !isTransferTransaction(t))
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    return {
      total: sortedTransactions.length,
      income,
      expense,
      balance: income - expense,
    };
  }, [sortedTransactions]);

  const allSelectableSelected =
    selectableTransactions.length > 0 &&
    selectableTransactions.every((t) => selectedIds.has(t.id));

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(selectableTransactions.map((t) => t.id)));
  };

  const requestDelete = (id) => {
    setPendingDeleteId(id);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!pendingDeleteId) return;

    try {
      setDeleting(true);
      await deleteTransaction(pendingDeleteId);
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setDeleteOpen(false);
      setPendingDeleteId(null);
      toast.success("Операция удалена");
    } catch (error) {
      console.error(error);
      toast.error("Не удалось удалить транзакцию");
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    try {
      setBulkWorking(true);
      await Promise.all(ids.map((id) => deleteTransaction(id)));
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast.success(`Удалено операций: ${ids.length}`);
    } catch (error) {
      console.error(error);
      toast.error("Не удалось удалить выбранные операции");
    } finally {
      setBulkWorking(false);
    }
  };

  const handleBulkCategory = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || !bulkCategoryId) return;

    const category = allCategories.find((item) => String(item.id) === bulkCategoryId);
    if (!category) {
      toast.error("Выберите категорию");
      return;
    }

    const targets = ids
      .map((id) => transactions.find((t) => t.id === id))
      .filter(Boolean)
      .filter((t) => !isTransferTransaction(t) && t.type === category.type);

    if (targets.length === 0) {
      toast.error("Нет операций подходящего типа для выбранной категории");
      return;
    }

    try {
      setBulkWorking(true);
      await Promise.all(
        targets.map((t) =>
          updateTransaction(t.id, {
            user_id: userId,
            account_id: t.account_id,
            category_id: Number(bulkCategoryId),
            amount: Number(t.amount),
            type: t.type,
            date: toDateKey(t.date),
            note: t.note || null,
          })
        )
      );
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setSelectedIds(new Set());
      setBulkCategoryId("");
      toast.success(`Категория обновлена: ${targets.length}`);
    } catch (error) {
      console.error(error);
      toast.error("Не удалось изменить категорию");
    } finally {
      setBulkWorking(false);
    }
  };

  const openEdit = (transaction) => {
    if (isTransferTransaction(transaction)) {
      toast.error("Переводы редактируются через раздел «Счета»");
      return;
    }

    setEditingId(transaction.id);
    setEditForm({
      accountId: transaction.account_id ? String(transaction.account_id) : "",
      categoryId: transaction.category_id ? String(transaction.category_id) : "",
      amount: String(transaction.amount ?? ""),
      type: transaction.type || "expense",
      date: toDateKey(transaction.date),
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
      toast.error("Заполните все обязательные поля");
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
      toast.success("Операция сохранена");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось сохранить изменения");
    } finally {
      setSavingEdit(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setAccountFilter("all");
    setCategoryFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortBy("newest");
    setSelectedIds(new Set());
  };

  const bulkCategoryOptions = useMemo(() => {
    const selected = [...selectedIds]
      .map((id) => transactions.find((t) => t.id === id))
      .filter(Boolean)
      .filter((t) => !isTransferTransaction(t));

    const types = new Set(selected.map((t) => t.type));
    if (types.size !== 1) return allCategories;
    const onlyType = [...types][0];
    return allCategories.filter((item) => item.type === onlyType);
  }, [selectedIds, transactions, allCategories]);

  return (
    <div className="transactions-page">
      <p className="page-subtitle">Журнал операций, фильтрация и управление транзакциями</p>

      <div className="transactions-hero-actions">
        <button className="import-btn" type="button" onClick={() => navigate("/import")}>
          Импорт выписки
        </button>

        <button className="clear-filters-btn" type="button" onClick={clearFilters}>
          Сбросить фильтры
        </button>
      </div>

      <div className="transactions-summary">
        <div className="summary-card">
          <span>Показано</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="summary-card">
          <span>Доходы</span>
          <strong className="summary-income">{formatMoney(summary.income, currency)}</strong>
        </div>
        <div className="summary-card">
          <span>Расходы</span>
          <strong className="summary-expense">{formatMoney(summary.expense, currency)}</strong>
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
          placeholder="Поиск по категории, счёту, заметке, сумме"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="filter-select"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setCategoryFilter("all");
          }}
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
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="all">Все категории</option>
          {categoryFilterOptions.map((category) => (
            <option key={category.id} value={String(category.id)}>
              {category.name}
            </option>
          ))}
        </select>

        <input
          className="filter-select"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Дата с"
        />

        <input
          className="filter-select"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Дата по"
        />

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

        {selectedIds.size > 0 && (
          <div className="transactions-bulk-bar">
            <span>Выбрано: {selectedIds.size}</span>
            <div className="transactions-bulk-actions">
              <select
                className="filter-select transactions-bulk-select"
                value={bulkCategoryId}
                onChange={(e) => setBulkCategoryId(e.target.value)}
                disabled={bulkWorking}
              >
                <option value="">Сменить категорию</option>
                {bulkCategoryOptions.map((category) => (
                  <option key={category.id} value={String(category.id)}>
                    {category.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="transactions-bulk-btn"
                onClick={handleBulkCategory}
                disabled={bulkWorking || !bulkCategoryId}
              >
                Применить
              </button>
              <button
                type="button"
                className="transactions-bulk-btn danger"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkWorking}
              >
                Удалить выбранные
              </button>
              <button
                type="button"
                className="transactions-bulk-btn ghost"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkWorking}
              >
                Снять выбор
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : transactions.length === 0 ? (
          <EmptyState
            title="Операций пока нет"
            description="Добавьте операцию вручную или импортируйте банковскую выписку — тогда появятся аналитика и подсказки помощника."
            actionLabel="Импортировать выписку"
            actionTo="/import"
          />
        ) : sortedTransactions.length === 0 ? (
          <EmptyState
            title="Ничего не найдено"
            description="По выбранным фильтрам операций нет. Сбросьте фильтры или измените поисковый запрос."
            actionLabel="Сбросить фильтры"
            onAction={clearFilters}
          />
        ) : (
          <div className="transactions-table">
            <div className="table-head">
              <span className="table-check">
                <input
                  type="checkbox"
                  checked={allSelectableSelected}
                  onChange={toggleSelectAll}
                  aria-label="Выбрать все"
                />
              </span>
              <span>Дата</span>
              <span>Счёт</span>
              <span>Категория</span>
              <span>Тип</span>
              <span>Сумма</span>
              <span>Заметка</span>
              <span>Действия</span>
            </div>

            {sortedTransactions.map((t) => {
              const isTransfer = isTransferTransaction(t);
              const isSelected = selectedIds.has(t.id);

              return (
                <div
                  key={t.id}
                  className={`table-row${isSelected ? " table-row-selected" : ""}`}
                >
                  <span className="table-check">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isTransfer}
                      onChange={() => toggleSelect(t.id)}
                      aria-label={`Выбрать операцию ${t.id}`}
                      title={isTransfer ? "Переводы не выбираются для массовых действий" : ""}
                    />
                  </span>
                  <span>{formatDate(t.date)}</span>
                  <span>{t.account || "—"}</span>
                  <span className="row-category">{t.category || "Без категории"}</span>
                  <span className={t.type === "income" ? "type income" : "type expense"}>
                    {isTransfer ? "Перевод" : t.type === "income" ? "Доход" : "Расход"}
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
                      title={isTransfer ? "Перевод не редактируется здесь" : "Редактировать"}
                      type="button"
                      disabled={isTransfer}
                    >
                      <FiEdit2 size={16} />
                    </button>

                    <button
                      className="delete-btn"
                      onClick={() => requestDelete(t.id)}
                      title="Удалить"
                      type="button"
                    >
                      <FiTrash2 size={16} />
                    </button>
                  </span>
                </div>
              );
            })}
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
                  <button type="submit" className="modal-primary" disabled={savingEdit}>
                    {savingEdit ? "Сохранение..." : "Сохранить"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteOpen}
        title="Удалить операцию?"
        description="Операция будет удалена без возможности восстановления. Баланс счёта пересчитается."
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

      <ConfirmModal
        open={bulkDeleteOpen}
        title={`Удалить ${selectedIds.size} операций?`}
        description="Выбранные операции будут удалены. Переводы в выбор не попадают."
        confirmText="Удалить выбранные"
        danger
        loading={bulkWorking}
        onConfirm={handleBulkDelete}
        onClose={() => {
          if (bulkWorking) return;
          setBulkDeleteOpen(false);
        }}
      />
    </div>
  );
}

export default Transactions;
