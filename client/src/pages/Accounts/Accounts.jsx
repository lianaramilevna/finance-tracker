import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closeAccount,
  createAccount,
  getAccounts,
  updateAccount,
} from "../../shared/api/accounts";
import { getCurrentUser } from "../../shared/lib/session";
import { formatMoney } from "../../shared/lib/format";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { FiEdit2, FiX } from "react-icons/fi"; // ← импорт иконок
import "./accounts.css";

const ACCOUNT_TYPES = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "savings", label: "Сбережения" },
  { value: "investment", label: "Инвестиции" },
];

function Accounts() {
  const user = getCurrentUser();
  const userId = user?.id || null;
  const currency = user?.currency || "RUB";

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    type: "cash",
    balance: "",
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    type: "cash",
    balance: "",
  });

  const loadAccounts = useCallback(async () => {
    if (!userId) {
      setAccounts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await getAccounts(userId);

      const activeAccounts = Array.isArray(data)
        ? data.filter((acc) => !acc.is_archived)
        : [];

      setAccounts(activeAccounts);
    } catch (error) {
      console.error(error);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadAccounts();

    const handleDataChanged = () => {
      loadAccounts();
    };

    window.addEventListener(FINANCE_DATA_CHANGED, handleDataChanged);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, handleDataChanged);
  }, [loadAccounts]);

  const totalBalance = useMemo(() => {
    return accounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
  }, [accounts]);

  const negativeAccounts = useMemo(() => {
    return accounts.filter((acc) => Number(acc.balance || 0) < 0);
  }, [accounts]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAdd = async (e) => {
    e.preventDefault();

    if (!userId || !form.name.trim()) return;

    try {
      setSaving(true);

      await createAccount({
        user_id: userId,
        name: form.name.trim(),
        type: form.type,
        currency,
        balance: form.balance === "" ? 0 : Number(form.balance),
      });

      setForm({
        name: "",
        type: "cash",
        balance: "",
      });

      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
    } catch (error) {
      console.error(error);
      alert(error.message || "Не удалось добавить счёт");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async (id) => {
    const confirmClose = window.confirm("Закрыть счёт? Он исчезнет из списка активных.");
    if (!confirmClose) return;

    try {
      await closeAccount(id);
      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
    } catch (error) {
      console.error(error);
      alert(error.message || "Не удалось закрыть счёт");
    }
  };

  const openEdit = (account) => {
    setEditingAccountId(account.id);
    setEditForm({
      name: account.name || "",
      type: account.type || "cash",
      balance: String(account.balance ?? 0),
    });
    setEditOpen(true);
  };

  const closeEdit = () => {
    setEditOpen(false);
    setEditingAccountId(null);
    setEditSaving(false);
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();

    if (!editingAccountId || !editForm.name.trim()) return;

    try {
      setEditSaving(true);

      await updateAccount(editingAccountId, {
        name: editForm.name.trim(),
        type: editForm.type,
        balance: editForm.balance === "" ? 0 : Number(editForm.balance),
        currency,
      });

      closeEdit();
      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
    } catch (error) {
      console.error(error);
      alert(error.message || "Не удалось сохранить изменения");
    } finally {
      setEditSaving(false);
    }
  };

  const getAccountLabel = (type) => {
    return ACCOUNT_TYPES.find((item) => item.value === type)?.label || type;
  };

  return (
    <div className="accounts-page">
      <div className="accounts-hero">
        <div>
          <p>Управление счетами, картами и наличными</p>
        </div>
      </div>

      {negativeAccounts.length > 0 && (
        <div className="accounts-warning">
          <strong>Внимание:</strong> {negativeAccounts.length} счёт(а) с отрицательным балансом.
        </div>
      )}

      <div className="accounts-stats">
        <div className="accounts-stat">
          <span>Всего счетов</span>
          <strong>{accounts.length}</strong>
        </div>

        <div className="accounts-stat">
          <span>Общий баланс</span>
          <strong className={totalBalance < 0 ? "balance-negative" : ""}>
            {formatMoney(totalBalance, currency)}
          </strong>
        </div>
      </div>

      <section className="panel accounts-panel">
        <div className="panel-head">
          <h2>Добавить счёт</h2>
          <span>Создай новый счёт для операций</span>
        </div>

        <form className="account-form" onSubmit={handleAdd}>
          <input
            type="text"
            name="name"
            placeholder="Например, Основная карта"
            value={form.name}
            onChange={handleChange}
          />

          <select name="type" value={form.type} onChange={handleChange}>
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>

          <input
            type="number"
            name="balance"
            placeholder="Начальный баланс"
            value={form.balance}
            onChange={handleChange}
            min="0"
            step="1"
          />

          <button className="account-add-btn" type="submit" disabled={saving}>
            {saving ? "Добавление..." : "Добавить счёт"}
          </button>
        </form>
      </section>

      <section className="panel accounts-panel">
        <div className="panel-head">
          <h2>Мои счета</h2>
          <span>{loading ? "Загрузка..." : "Готово"}</span>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : accounts.length === 0 ? (
          <p className="empty-state">Пока нет счетов</p>
        ) : (
          <div className="accounts-grid">
            {accounts.map((acc) => {
              const isNegative = Number(acc.balance || 0) < 0;

              return (
                <article
                  key={acc.id}
                  className={`account-card account-type-${acc.type} ${
                    isNegative ? "account-card-negative" : ""
                  }`}
                >
                  <div className="account-top">
                    <div>
                      <span className="account-type-label">
                        {getAccountLabel(acc.type)}
                      </span>
                      <h3>{acc.name}</h3>
                    </div>

                    <div className="account-actions">
                      <button
                        className="account-edit-btn"
                        onClick={() => openEdit(acc)}
                        title="Редактировать"
                        type="button"
                      >
                        <FiEdit2 size={16} /> {/* ← иконка вместо ✏️ */}
                      </button>

                      <button
                        className="account-close-btn"
                        onClick={() => handleClose(acc.id)}
                        title="Закрыть счёт"
                        type="button"
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>

                  <div className={`account-balance ${isNegative ? "balance-negative" : ""}`}>
                    {formatMoney(acc.balance || 0, acc.currency || currency)}
                  </div>

                  <div className="account-meta">
                    <span>Валюта</span>
                    <strong>{acc.currency || currency}</strong>
                  </div>

                  {isNegative && (
                    <div className="account-badges">
                      <span className="account-badge danger">Минусовой счёт</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editOpen && (
        <div className="account-modal-overlay" onClick={closeEdit}>
          <div className="account-modal" onClick={(e) => e.stopPropagation()}>
            <div className="account-modal-head">
              <h3>Редактировать счёт</h3>
              <button type="button" className="modal-close-btn" onClick={closeEdit}>
                <FiX size={18} /> {/* ← иконка вместо ✕ */}
              </button>
            </div>

            <form className="account-edit-form" onSubmit={handleSaveEdit}>
              <div className="account-edit-field">
                <label>Название</label>
                <input
                  type="text"
                  name="name"
                  value={editForm.name}
                  onChange={handleEditChange}
                />
              </div>

              <div className="account-edit-field">
                <label>Тип</label>
                <select name="type" value={editForm.type} onChange={handleEditChange}>
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="account-edit-field full">
                <label>Баланс</label>
                <input
                  type="number"
                  name="balance"
                  value={editForm.balance}
                  onChange={handleEditChange}
                  step="1"
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="modal-secondary" onClick={closeEdit}>
                  Отмена
                </button>

                <button type="submit" className="modal-primary" disabled={editSaving}>
                  {editSaving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Accounts;