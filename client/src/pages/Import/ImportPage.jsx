import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccounts } from "../../shared/api/accounts";
import { commitImport, previewImport } from "../../shared/api/imports";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { formatMoney } from "../../shared/lib/format";
import { getCurrentUser } from "../../shared/lib/session";
import "./import.css";

function ImportPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const user = getCurrentUser();
  const userId = user?.id ?? null;
  const currency = user?.currency || "RUB";

  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");

  const loadAccounts = useCallback(async () => {
    if (!userId) {
      setAccounts([]);
      setLoadingAccounts(false);
      return;
    }

    try {
      setLoadingAccounts(true);
      const data = await getAccounts();
      const activeAccounts = Array.isArray(data) ? data : [];
      setAccounts(activeAccounts);

      if (activeAccounts.length > 0) {
        setSelectedAccountId((prev) => prev || String(activeAccounts[0].id));
      }
    } catch (error) {
      console.error(error);
      setAccounts([]);
      setMessage("Не удалось загрузить счета");
    } finally {
      setLoadingAccounts(false);
    }
  }, [userId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleFileChange = (e) => {
    const nextFile = e.target.files?.[0] || null;
    setFile(nextFile);
    setPreview(null);
    setMessage("");
  };

  const handleChooseFile = () => {
    fileInputRef.current?.click();
  };

  const handlePreview = async () => {
    if (!file) {
      setMessage("Сначала выбери файл CSV или XLSX");
      return;
    }

    if (!selectedAccountId) {
      setMessage("Сначала выбери счёт");
      return;
    }

    try {
      setPreviewing(true);
      setMessage("");

      const data = await previewImport({
        file,
        account_id: Number(selectedAccountId),
      });

      setPreview(data);
      setMessage(
        data.rows?.length
          ? "Файл распознан. Проверь предпросмотр и импортируй."
          : "Файл распознан, но операции не найдены."
      );
    } catch (error) {
      console.error(error);
      setPreview(null);
      setMessage(error.message || "Не удалось разобрать файл");
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!preview?.rows?.length) {
      setMessage("Сначала сделай предпросмотр файла");
      return;
    }

    if (!selectedAccountId) {
      setMessage("Выбери счёт");
      return;
    }

    const rowsToImport = preview.rows.filter((row) => !row.duplicate);

    if (rowsToImport.length === 0) {
      setMessage("Для импорта не осталось новых операций");
      return;
    }

    try {
      setImporting(true);
      setMessage("");

      const result = await commitImport({
        account_id: Number(selectedAccountId),
        rows: rowsToImport,
      });

      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));

      setMessage(
        `Импорт завершён: ${result.importedCount} операций. Дубликаты пропущены: ${result.skippedDuplicates}.`
      );

      setPreview(null);
      setFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось импортировать операции");
    } finally {
      setImporting(false);
    }
  };

  const summary = preview?.summary || null;

  const duplicateCount = useMemo(
    () => preview?.rows?.filter((row) => row.duplicate).length || 0,
    [preview]
  );

  const displayFileName = file?.name || preview?.fileName || "Файл не выбран";

  return (
    <div className="import-page">
      <div className="import-hero">
        <div>
          <p>
            Загрузи CSV или XLSX, выбери счёт и проверь операции перед сохранением.
          </p>
        </div>

        <div className="import-hero-note">Сначала предпросмотр, потом импорт.</div>
      </div>

      <section className="panel import-panel">
        <div className="panel-head">
          <h2>1. Файл и счёт</h2>
          <span>Один счёт — одна выписка</span>
        </div>

        <div className="import-grid">
          <div className="import-field">
            <label>Счёт</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              disabled={loadingAccounts}
            >
              <option value="">Выбери счёт</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            {accounts.length === 0 && !loadingAccounts && (
              <small className="import-hint">
                Сначала создай счёт на странице Accounts.
              </small>
            )}
          </div>

          <div className="import-field">
            <label>Файл выписки. Поддерживаются CSV и Excel-файлы.</label>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="file-input-hidden"
            />

            <div className="file-picker">
              <button
                type="button"
                className="secondary-btn file-picker-btn"
                onClick={handleChooseFile}
              >
                Выбрать файл
              </button>

              <div className="file-name">{displayFileName}</div>
            </div>

          </div>

          <div className="import-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={handlePreview}
              disabled={!file || previewing || !selectedAccountId}
            >
              {previewing ? "Анализ..." : "Показать предпросмотр"}
            </button>

            <button
              type="button"
              className="primary-btn"
              onClick={handleImport}
              disabled={!preview?.rows?.length || importing || !selectedAccountId}
            >
              {importing ? "Импорт..." : "Импортировать"}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="import-message">{message}</div>}

      {preview && (
        <>
          <div className="import-summary-grid">
            <div className="summary-card">
              <span>Распознано операций</span>
              <strong>{summary?.totalRows || 0}</strong>
            </div>

            <div className="summary-card">
              <span>По MCC определено</span>
              <strong>{summary?.mccMatchedRows || 0}</strong>
            </div>

            <div className="summary-card">
              <span>Доходы</span>
              <strong className="positive">
                {formatMoney(summary?.incomeTotal || 0, currency)}
              </strong>
            </div>

            <div className="summary-card">
              <span>Расходы</span>
              <strong className="negative">
                {formatMoney(summary?.expenseTotal || 0, currency)}
              </strong>
            </div>

            <div className="summary-card">
              <span>Дубликаты в файле</span>
              <strong>{summary?.duplicateInFileRows || 0}</strong>
            </div>

            <div className="summary-card">
              <span>Дубликаты в счёте</span>
              <strong>{summary?.duplicateDbRows || 0}</strong>
            </div>

            <div className="summary-card">
              <span>Новых операций</span>
              <strong>{(summary?.totalRows || 0) - duplicateCount}</strong>
            </div>
          </div>

          {preview.errors?.length > 0 && (
            <section className="panel import-panel">
              <div className="panel-head">
                <h2>Ошибки строк</h2>
                <span>Их лучше проверить в файле</span>
              </div>

              <div className="error-list">
                {preview.errors.map((item) => (
                  <div key={`${item.rowNumber}-${item.reason}`} className="error-item">
                    <strong>Строка {item.rowNumber}</strong>
                    <span>{item.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel import-panel">
            <div className="panel-head">
              <h2>Предпросмотр</h2>
              <span>{displayFileName}</span>
            </div>

            <div className="preview-table">
              <div className="preview-head">
                <span>Дата</span>
                <span>Описание</span>
                <span>MCC</span>
                <span>Категория</span>
                <span>Тип</span>
                <span>Сумма</span>
                <span>Статус</span>
              </div>

              {preview.rows.slice(0, 30).map((row) => (
                <div
                  key={`${row.rowNumber}-${row.date}-${row.amount}-${row.signature}`}
                  className={row.duplicate ? "preview-row duplicate" : "preview-row"}
                >
                  <span>{row.date}</span>
                  <span>{row.note || "—"}</span>
                  <span>{row.mcc || "—"}</span>
                  <span>{row.category || "—"}</span>
                  <span className={row.type === "income" ? "positive" : "negative"}>
                    {row.type === "income" ? "Доход" : "Расход"}
                  </span>
                  <span className={row.type === "income" ? "positive" : "negative"}>
                    {row.type === "income" ? "+" : "-"}
                    {formatMoney(row.amount, currency)}
                  </span>
                  <span>{row.duplicate ? "Дубликат" : "Новая"}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="import-footer">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => navigate("/transactions")}
        >
          Вернуться к операциям
        </button>
      </div>
    </div>
  );
}

export default ImportPage;