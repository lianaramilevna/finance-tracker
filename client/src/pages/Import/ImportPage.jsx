import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAccounts } from "../../shared/api/accounts";
import { getCategories } from "../../shared/api/categories";
import { commitImport, previewImport } from "../../shared/api/imports";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { formatMoney } from "../../shared/lib/format";
import { getCurrentUser } from "../../shared/lib/session";
import { toast } from "../../shared/ui/ToastProvider";
import EmptyState from "../../shared/ui/EmptyState";
import { snapshotUploadFile } from "../../shared/lib/uploadFile";
import "./import.css";

const UNCERTAIN_CATEGORIES = new Set(["Без категории", "Прочее", ""]);

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
  const [fileLoading, setFileLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [forcedRowNumbers, setForcedRowNumbers] = useState(() => new Set());
  const [previewFilter, setPreviewFilter] = useState("all");
  const [categoryOverrides, setCategoryOverrides] = useState({});
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);

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

  useEffect(() => {
    setForcedRowNumbers(new Set());
  }, [selectedAccountId]);

  const loadCategoryLists = useCallback(async () => {
    if (!userId) {
      setExpenseCategories([]);
      setIncomeCategories([]);
      return;
    }

    try {
      const [expenseData, incomeData] = await Promise.all([
        getCategories("expense"),
        getCategories("income"),
      ]);
      setExpenseCategories(Array.isArray(expenseData) ? expenseData : []);
      setIncomeCategories(Array.isArray(incomeData) ? incomeData : []);
    } catch (error) {
      console.error(error);
      setExpenseCategories([]);
      setIncomeCategories([]);
    }
  }, [userId]);

  useEffect(() => {
    loadCategoryLists();
  }, [loadCategoryLists]);

  const getEffectiveCategory = useCallback(
    (row) => {
      const override = categoryOverrides[row.rowNumber];
      if (override !== undefined) return override;
      return row.category || "";
    },
    [categoryOverrides]
  );

  const needsCategoryReview = useCallback(
    (row) => UNCERTAIN_CATEGORIES.has(getEffectiveCategory(row)),
    [getEffectiveCategory]
  );

  const setRowCategory = (rowNumber, categoryName) => {
    setCategoryOverrides((prev) => ({
      ...prev,
      [rowNumber]: categoryName,
    }));
  };

  const getCategoryOptionsForRow = useCallback(
    (row) => {
      const baseList = row.type === "income" ? incomeCategories : expenseCategories;
      const effective = getEffectiveCategory(row);
      const names = new Set(baseList.map((item) => item.name));

      if (effective && !names.has(effective)) {
        return [...baseList, { id: `extra-${row.rowNumber}`, name: effective }];
      }

      return baseList;
    },
    [expenseCategories, incomeCategories, getEffectiveCategory]
  );

  const handleFileChange = async (e) => {
    const picked = e.target.files?.[0] || null;
    // Сброс input — можно снова выбрать тот же файл; отправляем копию из state
    e.target.value = "";

    setPreview(null);
    setForcedRowNumbers(new Set());
    setCategoryOverrides({});
    setPreviewFilter("all");
    setMessage("");

    if (!picked) {
      setFile(null);
      return;
    }

    try {
      setFileLoading(true);
      const snapshot = await snapshotUploadFile(picked);
      setFile(snapshot);
    } catch (error) {
      console.error(error);
      setFile(null);
      setMessage("Не удалось прочитать файл. Выберите его снова.");
      toast.error("Не удалось прочитать файл");
    } finally {
      setFileLoading(false);
    }
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
      setForcedRowNumbers(new Set());
      setCategoryOverrides({});
      setPreviewFilter("all");
      setMessage(
        data.rows?.length
          ? "Файл распознан. Проверь предпросмотр и импортируй."
          : "Файл распознан, но операции не найдены."
      );
      toast.success("Файл распознан. Проверь предпросмотр.");
    } catch (error) {
      console.error(error);
      setPreview(null);
      const hint =
        error instanceof TypeError
          ? "Не удалось отправить файл (он мог измениться на диске). Выберите файл заново и нажмите «Показать предпросмотр»."
          : error.message || "Не удалось разобрать файл";
      setMessage(hint);
      toast.error(hint);
    } finally {
      setPreviewing(false);
    }
  };

  const toggleForceRow = (rowNumber) => {
    setForcedRowNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) {
        next.delete(rowNumber);
      } else {
        next.add(rowNumber);
      }
      return next;
    });
  };

  const importableCount = useMemo(() => {
    if (!preview?.rows?.length) return 0;
    return preview.rows.filter(
      (row) => !row.duplicate || forcedRowNumbers.has(row.rowNumber)
    ).length;
  }, [preview, forcedRowNumbers]);

  const forcedCount = forcedRowNumbers.size;

  const previewRowsVisible = useMemo(() => {
    if (!preview?.rows?.length) return [];

    if (previewFilter === "new") {
      return preview.rows.filter((row) => !row.duplicate || forcedRowNumbers.has(row.rowNumber));
    }

    if (previewFilter === "duplicate") {
      return preview.rows.filter((row) => row.duplicate);
    }

    if (previewFilter === "uncertain") {
      return preview.rows.filter((row) => needsCategoryReview(row));
    }

    return preview.rows;
  }, [preview, previewFilter, forcedRowNumbers, needsCategoryReview]);

  const totalPreviewRows = preview?.rows?.length || 0;

  const uncertainCategoryCount = useMemo(() => {
    if (!preview?.rows?.length) return 0;
    return preview.rows.filter((row) => needsCategoryReview(row)).length;
  }, [preview, needsCategoryReview]);

  const manualCategoryCount = useMemo(
    () => Object.keys(categoryOverrides).length,
    [categoryOverrides]
  );

  const handleImport = async () => {
    if (!preview?.rows?.length) {
      setMessage("Сначала сделай предпросмотр файла");
      return;
    }

    if (!selectedAccountId) {
      setMessage("Выбери счёт");
      return;
    }

    const rowsToImport = preview.rows
      .filter((row) => !row.duplicate || forcedRowNumbers.has(row.rowNumber))
      .map((row) => ({
        date: row.date,
        type: row.type,
        amount: row.amount,
        note: row.note,
        category: getEffectiveCategory(row) || row.category,
        externalId: row.externalId,
        force_import: Boolean(row.duplicate && forcedRowNumbers.has(row.rowNumber)),
      }));

    if (rowsToImport.length === 0) {
      setMessage("Для импорта не осталось операций. Отметьте дубликаты «Всё равно импортировать».");
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

      const forcedPart =
        result.forcedImportedCount > 0
          ? ` Принудительно добавлено дубликатов: ${result.forcedImportedCount}.`
          : "";

      setMessage(
        `Импорт завершён: ${result.importedCount} операций. Дубликаты пропущены: ${result.skippedDuplicates}.${forcedPart}`
      );
      toast.success(`Импорт завершён: ${result.importedCount} операций.`);

      setPreview(null);
      setFile(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось импортировать операции");
      toast.error(error.message || "Не удалось импортировать операции");
    } finally {
      setImporting(false);
    }
  };

  const summary = preview?.summary || null;
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];

  const duplicateCount = useMemo(
    () => preview?.rows?.filter((row) => row.duplicate).length || 0,
    [preview]
  );

  const displayFileName = file?.name || preview?.fileName || "Файл не выбран";

  return (
    <div className="import-page">
      <p className="page-subtitle">
        Загрузи CSV или XLSX, выбери счёт и проверь операции перед сохранением.
      </p>

      <details className="panel import-panel import-guide import-collapsible">
        <summary className="import-collapsible-summary">
          <span>Как импортировать выписку</span>
        </summary>
        <div className="import-guide-grid">
          <div className="import-guide-card">
            <h3>Форматы</h3>
            <p>
              Поддерживаются <strong>CSV</strong> и <strong>Excel</strong> (.xlsx, .xls) — типичные
              банковские выписки. Колонки распознаются автоматически: дата, сумма, описание, MCC.
            </p>
            <p className="import-guide-example">Один файл — один счёт в приложении.</p>
          </div>
          <div className="import-guide-card">
            <h3>Порядок действий</h3>
            <p>
              <strong>1.</strong> Выберите счёт → <strong>2.</strong> файл → <strong>3.</strong>{" "}
              «Показать предпросмотр» → <strong>4.</strong> проверьте категории и дубликаты →{" "}
              <strong>5.</strong> «Импортировать».
            </p>
            <p className="import-guide-example">Сначала предпросмотр, потом сохранение в базу.</p>
          </div>
        </div>
        <ul className="import-guide-list">
          <li>
            <strong>Категории по MCC</strong> — код из выписки сопоставляется со справочником
            (продукты, транспорт и т.д.). Если не уверены — смените в списке предпросмотра.
          </li>
          <li>
            <strong>Дубликаты</strong> — совпадение по дате, типу, сумме и описанию (или ID банка).
            Повторы пропускаются; для двух реальных оплат — «Всё равно импортировать».
          </li>
          <li>
            <strong>«Без категории» и «Прочее»</strong> — проверьте в фильтре «Уточнить категорию»
            перед импортом, чтобы аналитика и бюджет были точнее.
          </li>
          <li>
            <strong>Предупреждения о бюджете</strong> — если импорт приведёт к перерасходу лимита,
            система покажет это до сохранения.
          </li>
        </ul>
      </details>

      <section className="panel import-panel">
        <div className="panel-head">
          <h2>Файл и счёт</h2>
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
              <EmptyState
                title="Нет счетов для импорта"
                description="Создайте счёт (карта, наличные), затем загрузите выписку в этот счёт."
                actionLabel="Перейти к счетам"
                actionTo="/accounts"
              />
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

              <div className="file-name">
                {fileLoading ? "Чтение файла..." : displayFileName}
              </div>
            </div>

          </div>

          <div className="import-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={handlePreview}
              disabled={!file || fileLoading || previewing || !selectedAccountId}
            >
              {previewing ? "Анализ..." : "Показать предпросмотр"}
            </button>

            <button
              type="button"
              className="primary-btn"
              onClick={handleImport}
              disabled={!preview?.rows?.length || importing || !selectedAccountId}
            >
              {importing ? "Импорт..." : `Импортировать (${importableCount})`}
            </button>
          </div>
        </div>
      </section>

      {message && <div className="import-message">{message}</div>}

      {warnings.length > 0 && (
        <section className="panel import-panel">
          <div className="panel-head">
            <h2>Предупреждения</h2>
            <span>Проверка бюджета на основе импорта</span>
          </div>

          <div className="import-warnings">
            {warnings.map((w, idx) => (
              <div key={`${w.kind}-${w.category_id}-${w.month}-${idx}`} className="import-warning">
                <strong>
                  {w.kind === "budget_exceeded" ? "Превышение бюджета" : "Предупреждение"}
                </strong>
                <div>
                  {w.month}: {w.category} — лимит {formatMoney(w.limit_amount, currency)}, станет{" "}
                  {formatMoney(w.projected_spent, currency)} (перерасход{" "}
                  {formatMoney(w.over_by, currency)}).
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {preview && (
        <>
          <div className="import-summary-grid">
            <div className="summary-card">
              <span>Распознано операций</span>
              <strong>{summary?.totalRows || 0}</strong>
            </div>

            {(summary?.invalidRows || 0) > 0 && (
              <div className="summary-card">
                <span>Не распознано строк</span>
                <strong>{summary.invalidRows}</strong>
              </div>
            )}

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
              <span>К импорту</span>
              <strong>{importableCount}</strong>
            </div>

            {forcedCount > 0 && (
              <div className="summary-card">
                <span>Включено вручную</span>
                <strong>{forcedCount}</strong>
              </div>
            )}

            {uncertainCategoryCount > 0 && (
              <div className="summary-card">
                <span>Уточнить категорию</span>
                <strong>{uncertainCategoryCount}</strong>
              </div>
            )}

            {manualCategoryCount > 0 && (
              <div className="summary-card">
                <span>Категория изменена</span>
                <strong>{manualCategoryCount}</strong>
              </div>
            )}
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
              <span>
                {displayFileName} · {totalPreviewRows} операций
                {previewRowsVisible.length !== totalPreviewRows
                  ? ` · показано ${previewRowsVisible.length}`
                  : ""}
              </span>
            </div>

            <div className="preview-filters">
              <button
                type="button"
                className={previewFilter === "all" ? "preview-filter-btn active" : "preview-filter-btn"}
                onClick={() => setPreviewFilter("all")}
              >
                Все ({totalPreviewRows})
              </button>
              <button
                type="button"
                className={previewFilter === "new" ? "preview-filter-btn active" : "preview-filter-btn"}
                onClick={() => setPreviewFilter("new")}
              >
                К импорту ({importableCount})
              </button>
              <button
                type="button"
                className={
                  previewFilter === "duplicate" ? "preview-filter-btn active" : "preview-filter-btn"
                }
                onClick={() => setPreviewFilter("duplicate")}
              >
                Дубликаты ({duplicateCount})
              </button>
              {uncertainCategoryCount > 0 && (
                <button
                  type="button"
                  className={
                    previewFilter === "uncertain"
                      ? "preview-filter-btn active"
                      : "preview-filter-btn"
                  }
                  onClick={() => setPreviewFilter("uncertain")}
                >
                  Уточнить категорию ({uncertainCategoryCount})
                </button>
              )}
            </div>

            <p className="import-dedup-hint">
              Дубликат — та же операция: дата, тип, сумма и описание (без MCC и лишних
              символов). Если в файле есть ID операции банка — повтор по ID тоже считается
              дубликатом. Первая строка в файле сохраняется, повторы пропускаются. Если это
              две реальные оплаты — нажмите «Всё равно импортировать» у нужной строки.
              Категорию можно изменить в списке — для «Без категории» и «Прочее» выберите
              подходящую из списка.
            </p>

            <div className="preview-table">
              <div className="preview-head preview-head--sticky">
                <span>Дата</span>
                <span>Описание</span>
                <span>MCC</span>
                <span>Категория</span>
                <span>Тип</span>
                <span>Сумма</span>
                <span>Статус</span>
              </div>

              <div className="preview-table-body">
              {previewRowsVisible.length === 0 ? (
                <p className="empty-state">Нет операций для выбранного фильтра</p>
              ) : (
              previewRowsVisible.map((row) => {
                const isForced = forcedRowNumbers.has(row.rowNumber);
                const effectiveCategory = getEffectiveCategory(row);
                const categoryOptions = getCategoryOptionsForRow(row);
                const isCategoryUncertain = needsCategoryReview(row);
                const isCategoryEdited = Object.prototype.hasOwnProperty.call(
                  categoryOverrides,
                  row.rowNumber
                );
                const rowClass = [
                  "preview-row",
                  row.duplicate ? "duplicate" : "",
                  isForced ? "forced-import" : "",
                  isCategoryUncertain ? "uncertain-category" : "",
                  isCategoryEdited ? "category-edited" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <div
                    key={row.rowNumber}
                    className={rowClass}
                  >
                    <span>{row.date}</span>
                    <span title={row.note || ""}>{row.note || "—"}</span>
                    <span>{row.mcc || "—"}</span>
                    <select
                      className="preview-category-select"
                      value={effectiveCategory}
                      onChange={(e) => setRowCategory(row.rowNumber, e.target.value)}
                      title="Категория при импорте"
                    >
                      {categoryOptions.length === 0 ? (
                        <option value={effectiveCategory}>{effectiveCategory || "—"}</option>
                      ) : (
                        categoryOptions.map((cat) => (
                          <option key={`${row.rowNumber}-${cat.id}`} value={cat.name}>
                            {cat.name}
                          </option>
                        ))
                      )}
                    </select>
                    <span className={row.type === "income" ? "positive" : "negative"}>
                      {row.type === "income" ? "Доход" : "Расход"}
                    </span>
                    <span className={row.type === "income" ? "positive" : "negative"}>
                      {row.type === "income" ? "+" : "-"}
                      {formatMoney(row.amount, currency)}
                    </span>
                    <div className="preview-status-cell">
                      <span className={row.duplicate && !isForced ? "duplicate-label" : "new-label"}>
                        {isForced
                          ? "Будет импортирована"
                          : row.duplicateReason || (row.duplicate ? "Дубликат" : "Новая")}
                      </span>
                      {row.duplicate && (
                        <button
                          type="button"
                          className={
                            isForced ? "force-import-btn force-import-btn--active" : "force-import-btn"
                          }
                          onClick={() => toggleForceRow(row.rowNumber)}
                        >
                          {isForced ? "Отменить" : "Всё равно импортировать"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
              )}
              </div>
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