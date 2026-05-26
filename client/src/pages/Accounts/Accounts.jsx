import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closeAccount,
  createAccount,
  getAccounts,
  restoreAccount,
  updateAccount,
} from "../../shared/api/accounts";
import { createTransfer } from "../../shared/api/transfers";
import { getCurrentUser } from "../../shared/lib/session";
import { formatMoney } from "../../shared/lib/format";
import {
  estimateYieldIncome,
  formatRatePercent,
  getRateFieldLabel,
  isYieldAccountType,
} from "../../shared/lib/accountYield";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { toast } from "../../shared/ui/ToastProvider";
import { FiEdit2, FiX } from "react-icons/fi";
import ConfirmModal from "../../shared/ui/ConfirmModal";
import "./accounts.css";

const ACCOUNT_TYPES = [
  { value: "cash", label: "Наличные" },
  { value: "card", label: "Карта" },
  { value: "savings", label: "Сбережения" },
  { value: "investment", label: "Инвестиции" },
];

const ACCOUNT_TYPE_HINTS = {
  card: "Повседневные траты: зарплата, покупки, импорт выписки. Сюда приходят доходы и уходят расходы.",
  cash: "Наличные в кошельке. Удобно для мелких трат без карты.",
  savings:
    "Вклад или накопительный счёт: переводите сюда деньги с карты. Можно указать годовую ставку — приложение покажет ориентир дохода. Фактические проценты от банка вносите операцией «Доход».",
  investment:
    "Брокер, ИИС, ПИФ: переводите сумму для инвестиций. Ожидаемую доходность можно указать для плана; реальные дивиденды и купоны — отдельным доходом с категорией «Инвестиции».",
};

function Accounts() {
  const user = getCurrentUser();
  const userId = user?.id || null;
  const currency = user?.currency || "RUB";

  const [activeTab, setActiveTab] = useState("active");
  const [accounts, setAccounts] = useState([]);
  const [archivedAccounts, setArchivedAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState(null);

  const [form, setForm] = useState({
    name: "",
    type: "cash",
    balance: "",
    annual_rate_percent: "",
  });

  const [transferForm, setTransferForm] = useState({
    from_account_id: "",
    to_account_id: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    type: "cash",
    balance: "",
    annual_rate_percent: "",
  });

  const loadActiveAccounts = useCallback(async () => {
    if (!userId) {
      setAccounts([]);
      return;
    }

    const data = await getAccounts({ archived: "active" });
    setAccounts(Array.isArray(data) ? data : []);
  }, [userId]);

  const loadArchivedAccounts = useCallback(async () => {
    if (!userId) {
      setArchivedAccounts([]);
      return;
    }

    const data = await getAccounts({ archived: "archived" });
    setArchivedAccounts(Array.isArray(data) ? data : []);
  }, [userId]);

  const loadAccounts = useCallback(async () => {
    if (!userId) {
      setAccounts([]);
      setArchivedAccounts([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      await Promise.all([loadActiveAccounts(), loadArchivedAccounts()]);
    } catch (error) {
      console.error(error);
      setAccounts([]);
      setArchivedAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [userId, loadActiveAccounts, loadArchivedAccounts]);

  useEffect(() => {
    loadAccounts();

    const handleDataChanged = () => {
      loadAccounts();
    };

    window.addEventListener(FINANCE_DATA_CHANGED, handleDataChanged);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, handleDataChanged);
  }, [loadAccounts]);

  const displayedAccounts = activeTab === "active" ? accounts : archivedAccounts;

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

  const handleTransferChange = (e) => {
    const { name, value } = e.target;
    setTransferForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAdd = async (e) => {
    e.preventDefault();

    if (!userId || !form.name.trim()) return;

    try {
      setSaving(true);

      const payload = {
        user_id: userId,
        name: form.name.trim(),
        type: form.type,
        currency,
        balance: form.balance === "" ? 0 : Number(form.balance),
      };

      if (isYieldAccountType(form.type) && form.annual_rate_percent !== "") {
        payload.annual_rate_percent = Number(form.annual_rate_percent);
      }

      await createAccount(payload);

      setForm({
        name: "",
        type: "cash",
        balance: "",
        annual_rate_percent: "",
      });

      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Счёт добавлен");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось добавить счёт");
    } finally {
      setSaving(false);
    }
  };

  const handleTransfer = async (e) => {
    e.preventDefault();

    if (!transferForm.from_account_id || !transferForm.to_account_id) {
      toast.error("Выберите счета для перевода");
      return;
    }

    try {
      setTransferSaving(true);

      await createTransfer({
        from_account_id: Number(transferForm.from_account_id),
        to_account_id: Number(transferForm.to_account_id),
        amount: Number(transferForm.amount),
        date: transferForm.date,
        note: transferForm.note.trim() || null,
      });

      setTransferForm((prev) => ({
        ...prev,
        amount: "",
        note: "",
      }));

      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Перевод выполнен");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось выполнить перевод");
    } finally {
      setTransferSaving(false);
    }
  };

  const requestClose = (id) => {
    setPendingCloseId(id);
    setCloseOpen(true);
  };

  const handleClose = async () => {
    if (!pendingCloseId) return;

    try {
      setClosing(true);
      await closeAccount(pendingCloseId);
      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setCloseOpen(false);
      setPendingCloseId(null);
      toast.success("Счёт архивирован");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось закрыть счёт");
    } finally {
      setClosing(false);
    }
  };

  const handleRestore = async (id) => {
    try {
      await restoreAccount(id);
      await loadAccounts();
      setActiveTab("active");
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Счёт восстановлен");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось восстановить счёт");
    }
  };

  const openEdit = (account) => {
    setEditingAccountId(account.id);
    setEditForm({
      name: account.name || "",
      type: account.type || "cash",
      balance: String(account.balance ?? 0),
      annual_rate_percent:
        account.annual_rate_percent != null && account.annual_rate_percent !== ""
          ? String(account.annual_rate_percent)
          : "",
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

      const payload = {
        name: editForm.name.trim(),
        type: editForm.type,
        balance: editForm.balance === "" ? 0 : Number(editForm.balance),
        currency,
        annual_rate_percent: isYieldAccountType(editForm.type)
          ? editForm.annual_rate_percent === ""
            ? null
            : Number(editForm.annual_rate_percent)
          : null,
      };

      await updateAccount(editingAccountId, payload);

      closeEdit();
      await loadAccounts();
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      toast.success("Изменения сохранены");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось сохранить изменения");
    } finally {
      setEditSaving(false);
    }
  };

  const getAccountLabel = (type) => {
    return ACCOUNT_TYPES.find((item) => item.value === type)?.label || type;
  };

  const accountTypeHint = ACCOUNT_TYPE_HINTS[form.type] || "";
  const editAccountTypeHint = ACCOUNT_TYPE_HINTS[editForm.type] || "";
  const formRateLabel = getRateFieldLabel(form.type);
  const editRateLabel = getRateFieldLabel(editForm.type);

  const yieldSummary = useMemo(() => {
    const yieldAccounts = accounts.filter(
      (acc) =>
        isYieldAccountType(acc.type) &&
        Number(acc.annual_rate_percent || 0) > 0 &&
        Number(acc.balance || 0) > 0
    );

    const monthly = yieldAccounts.reduce(
      (sum, acc) =>
        sum + estimateYieldIncome(acc.balance, acc.annual_rate_percent, "month"),
      0
    );

    return { count: yieldAccounts.length, monthly };
  }, [accounts]);

  return (
    <div className="accounts-page">
      <p className="page-subtitle">Управление счетами, переводами и архивом</p>

      {negativeAccounts.length > 0 && (
        <div className="accounts-warning">
          <strong>Внимание:</strong> {negativeAccounts.length} счёт(а) с отрицательным балансом.
        </div>
      )}

      <div className="accounts-stats">
        <div className="accounts-stat">
          <span>Активных счетов</span>
          <strong>{accounts.length}</strong>
        </div>

        <div className="accounts-stat">
          <span>Общий баланс</span>
          <strong className={totalBalance < 0 ? "balance-negative" : ""}>
            {formatMoney(totalBalance, currency)}
          </strong>
        </div>

        <div className="accounts-stat">
          <span>В архиве</span>
          <strong>{archivedAccounts.length}</strong>
        </div>

        {yieldSummary.count > 0 && (
          <div className="accounts-stat accounts-stat-yield">
            <span>Ориентир дохода / мес</span>
            <strong>{formatMoney(yieldSummary.monthly, currency)}</strong>
            <small>по ставке на {yieldSummary.count} сч.</small>
          </div>
        )}
      </div>

      {accounts.length >= 2 && (
        <section className="panel accounts-panel">
          <div className="panel-head">
            <h2>Перевод между счетами</h2>
            <span>Создаёт две связанные операции в истории</span>
          </div>

          <form className="transfer-form" onSubmit={handleTransfer}>
            <select
              name="from_account_id"
              value={transferForm.from_account_id}
              onChange={handleTransferChange}
              required
            >
              <option value="">Со счёта</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({formatMoney(acc.balance, acc.currency || currency)})
                </option>
              ))}
            </select>

            <select
              name="to_account_id"
              value={transferForm.to_account_id}
              onChange={handleTransferChange}
              required
            >
              <option value="">На счёт</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({formatMoney(acc.balance, acc.currency || currency)})
                </option>
              ))}
            </select>

            <input
              type="number"
              name="amount"
              min="0.01"
              step="0.01"
              placeholder="Сумма"
              value={transferForm.amount}
              onChange={handleTransferChange}
              required
            />

            <input
              type="date"
              name="date"
              value={transferForm.date}
              onChange={handleTransferChange}
              required
            />

            <input
              type="text"
              name="note"
              placeholder="Комментарий (необязательно)"
              value={transferForm.note}
              onChange={handleTransferChange}
            />

            <button type="submit" disabled={transferSaving}>
              {transferSaving ? "Перевод..." : "Перевести"}
            </button>
          </form>
        </section>
      )}

      <details className="panel accounts-panel accounts-guide accounts-collapsible">
        <summary className="accounts-collapsible-summary">
          <span>Как пользоваться типами счетов</span>
        </summary>
        <ul className="accounts-guide-list">
          <li>
            <strong>Карта / наличные</strong> — деньги «в обороте»: траты, доходы, импорт выписки.
          </li>
          <li>
            <strong>Сбережения / вклад</strong> — перевод с карты сюда; укажите <strong>ставку %
            годовых</strong> для ориентира. Когда банк начислил проценты — добавьте «Доход» (категория
            «Прочее» или «Инвестиции»).
          </li>
          <li>
            <strong>Инвестиции</strong> — брокер/ИИС: перевод денег + опционально ожидаемая
            доходность для плана. Факт: дивиденды и продажи — операции «Доход» / «Расход».
          </li>
          <li>
            <strong>Цели</strong> (раздел «Цели») — не заменяют сбережения: цель = план и прогресс
            (отпуск, 200 000 ₽), сбережения = кошелёк с балансом. Часто используют вместе: деньги
            на счёте «Сбережения», прогресс — в цели.
          </li>
        </ul>
      </details>

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

          <div className="account-type-field">
            <select name="type" value={form.type} onChange={handleChange}>
              {ACCOUNT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {accountTypeHint && <p className="account-type-hint">{accountTypeHint}</p>}
          </div>

          <input
            type="number"
            name="balance"
            placeholder="Начальный баланс"
            value={form.balance}
            onChange={handleChange}
            min="0"
            step="1"
          />

          {formRateLabel && (
            <div className="account-rate-field">
              <label htmlFor="create-annual-rate">{formRateLabel}</label>
              <input
                id="create-annual-rate"
                type="number"
                name="annual_rate_percent"
                placeholder="Необязательно, например 16"
                value={form.annual_rate_percent}
                onChange={handleChange}
                min="0"
                max="100"
                step="0.01"
              />
              <p className="account-rate-note">
                Только ориентир в интерфейсе. Баланс меняется переводами и реальными операциями.
              </p>
            </div>
          )}

          <button className="account-add-btn" type="submit" disabled={saving}>
            {saving ? "Добавление..." : "Добавить счёт"}
          </button>
        </form>
      </section>

      <section className="panel accounts-panel">
        <div className="panel-head accounts-list-head">
          <div>
            <h2>{activeTab === "active" ? "Мои счета" : "Архивные счета"}</h2>
            <span>{loading ? "Загрузка..." : "Готово"}</span>
          </div>

          <div className="accounts-tabs">
            <button
              type="button"
              className={activeTab === "active" ? "active" : ""}
              onClick={() => setActiveTab("active")}
            >
              Активные ({accounts.length})
            </button>
            <button
              type="button"
              className={activeTab === "archived" ? "active" : ""}
              onClick={() => setActiveTab("archived")}
            >
              Архив ({archivedAccounts.length})
            </button>
          </div>
        </div>

        {loading ? (
          <p className="empty-state">Загрузка...</p>
        ) : displayedAccounts.length === 0 ? (
          <p className="empty-state">
            {activeTab === "active" ? "Пока нет счетов" : "Архив пуст"}
          </p>
        ) : (
          <div className="accounts-grid">
            {displayedAccounts.map((acc) => {
              const isNegative = Number(acc.balance || 0) < 0;
              const isArchived = Boolean(acc.is_archived);
              const rateLabel = formatRatePercent(acc.annual_rate_percent);
              const showYield =
                isYieldAccountType(acc.type) &&
                rateLabel &&
                Number(acc.balance || 0) > 0;
              const monthlyYield = showYield
                ? estimateYieldIncome(acc.balance, acc.annual_rate_percent, "month")
                : 0;

              return (
                <article
                  key={acc.id}
                  className={`account-card account-type-${acc.type} ${
                    isNegative ? "account-card-negative" : ""
                  } ${isArchived ? "account-card-archived" : ""}`}
                >
                  <div className="account-top">
                    <div>
                      <span className="account-type-label">
                        {getAccountLabel(acc.type)}
                      </span>
                      <h3>{acc.name}</h3>
                    </div>

                    <div className="account-actions">
                      {!isArchived && (
                        <button
                          className="account-edit-btn"
                          onClick={() => openEdit(acc)}
                          title="Редактировать"
                          type="button"
                        >
                          <FiEdit2 size={16} />
                        </button>
                      )}

                      {isArchived ? (
                        <button
                          className="account-restore-btn"
                          onClick={() => handleRestore(acc.id)}
                          type="button"
                        >
                          Восстановить
                        </button>
                      ) : (
                        <button
                          className="account-close-btn"
                          onClick={() => requestClose(acc.id)}
                          title="Закрыть счёт"
                          type="button"
                        >
                          В архив
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={`account-balance ${isNegative ? "balance-negative" : ""}`}>
                    {formatMoney(acc.balance || 0, acc.currency || currency)}
                  </div>

                  {rateLabel && (
                    <div className="account-meta">
                      <span>
                        {acc.type === "investment" ? "Ожид. доходность" : "Ставка"}
                      </span>
                      <strong>{rateLabel}</strong>
                    </div>
                  )}

                  {showYield && (
                    <div className="account-yield-estimate">
                      ≈ {formatMoney(monthlyYield, acc.currency || currency)} / мес
                      <span> при текущем балансе</span>
                    </div>
                  )}

                  {isArchived && acc.closed_at && (
                    <div className="account-meta">
                      <span>Закрыт</span>
                      <strong>{new Date(acc.closed_at).toLocaleDateString("ru-RU")}</strong>
                    </div>
                  )}

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
                <FiX size={18} />
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
                {editAccountTypeHint && (
                  <p className="account-type-hint">{editAccountTypeHint}</p>
                )}
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

              {editRateLabel && (
                <div className="account-edit-field full">
                  <label>{editRateLabel}</label>
                  <input
                    type="number"
                    name="annual_rate_percent"
                    value={editForm.annual_rate_percent}
                    onChange={handleEditChange}
                    min="0"
                    max="100"
                    step="0.01"
                    placeholder="Пусто — без расчёта"
                  />
                  <p className="account-rate-note">
                    Фактические начисления банка или брокера вносите вручную как «Доход».
                  </p>
                </div>
              )}

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

      <ConfirmModal
        open={closeOpen}
        title="Отправить счёт в архив?"
        description="Счёт пропадёт из активных. Операции и история останутся, счёт можно будет восстановить."
        confirmText="В архив"
        danger
        loading={closing}
        onConfirm={handleClose}
        onClose={() => {
          if (closing) return;
          setCloseOpen(false);
          setPendingCloseId(null);
        }}
      />
    </div>
  );
}

export default Accounts;
