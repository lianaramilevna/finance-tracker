import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  FiCpu,
  FiTrendingUp,
  FiAlertTriangle,
  FiCheckCircle,
  FiClock,
  FiBarChart2,
  FiSend,
} from "react-icons/fi";
import {
  askAssistant,
  getAssistantInsights,
  getAssistantStatus,
} from "../../shared/api/assistant";
import { getAccounts } from "../../shared/api/accounts";
import { updateBudget } from "../../shared/api/budgets";
import { getCurrentUser } from "../../shared/lib/session";
import { formatMoney } from "../../shared/lib/format";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { toast } from "../../shared/ui/ToastProvider";
import "./assistant.css";

const ACCOUNT_FILTER_STORAGE_KEY = "assistant_account_filter";

function readStoredAccountFilter() {
  try {
    return localStorage.getItem(ACCOUNT_FILTER_STORAGE_KEY) || "all";
  } catch {
    return "all";
  }
}

const TYPE_ICONS = {
  forecast: FiTrendingUp,
  warning: FiAlertTriangle,
  success: FiCheckCircle,
  info: FiCpu,
};

function Assistant() {
  const user = getCurrentUser();
  const currency = user?.currency || "RUB";

  const [period, setPeriod] = useState("month");
  const [accountFilter, setAccountFilter] = useState(readStoredAccountFilter);
  const [accounts, setAccounts] = useState([]);
  const [data, setData] = useState(null);
  const [llmStatus, setLlmStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!user?.id) {
      setAccounts([]);
      return;
    }

    getAccounts()
      .then((data) => setAccounts(Array.isArray(data) ? data : []))
      .catch(() => setAccounts([]));
  }, [user?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(ACCOUNT_FILTER_STORAGE_KEY, accountFilter);
    } catch {
      // ignore
    }
  }, [accountFilter]);

  useEffect(() => {
    if (accountFilter === "all" || accounts.length === 0) return;
    const exists = accounts.some((item) => String(item.id) === String(accountFilter));
    if (!exists) setAccountFilter("all");
  }, [accounts, accountFilter]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("assistant_analysis_history_v1");
      const parsed = raw ? JSON.parse(raw) : [];
      setHistory(Array.isArray(parsed) ? parsed : []);
    } catch {
      setHistory([]);
    }
  }, []);

  const saveToHistory = useCallback((result) => {
    try {
      const item = {
        id: `${Date.now()}`,
        created_at: new Date().toISOString(),
        period: result?.period || period,
        period_label: result?.period_label || null,
        summary: result?.summary || null,
        headline: result?.ai_overview || null,
      };
      const next = [item, ...history].slice(0, 4);
      setHistory(next);
      localStorage.setItem("assistant_analysis_history_v1", JSON.stringify(next));
    } catch {
      // ignore
    }
  }, [history, period]);

  const analyze = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const [result, status] = await Promise.all([
        getAssistantInsights(period, accountFilter),
        getAssistantStatus().catch(() => null),
      ]);

      setData(result);
      setLlmStatus(status);
      saveToHistory(result);
    } catch (err) {
      console.error(err);
      setError(err.message || "Не удалось загрузить рекомендации");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period, accountFilter, saveToHistory]);

  useEffect(() => {
    setData(null);
  }, [period, accountFilter]);

  useEffect(() => {
    const handleDataChanged = () => setData(null);
    window.addEventListener(FINANCE_DATA_CHANGED, handleDataChanged);
    return () => window.removeEventListener(FINANCE_DATA_CHANGED, handleDataChanged);
  }, []);

  const handleApplyBudget = async (insight) => {
    const apply = insight.action?.apply_budget;
    if (!apply?.budget_id || !apply?.limit_amount) return;

    try {
      setApplyingId(apply.budget_id);
      await updateBudget(apply.budget_id, { limit_amount: apply.limit_amount });
      toast.success(`Лимит обновлён: ${formatMoney(apply.limit_amount, currency)}`);
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      await analyze();
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Не удалось обновить лимит");
    } finally {
      setApplyingId(null);
    }
  };

  const handleAsk = async (e) => {
    e.preventDefault();
    const text = question.trim();
    if (!text) return;

    try {
      setChatLoading(true);
      setChatAnswer("");
      const result = await askAssistant(text, period, accountFilter);
      setChatAnswer(result.answer || "");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "ИИ недоступен.");
    } finally {
      setChatLoading(false);
    }
  };

  const summary = data?.summary;
  const insights = Array.isArray(data?.insights) ? data.insights : [];
  const llm = data?.llm || llmStatus;

  const llmOnline = llm?.enabled && llm?.available;
  const hasLlm = Boolean(llm?.enabled);

  const sections = useMemo(() => {
    const main = [];
    const warnings = [];
    const tips = [];
    const forecast = [];

    for (const item of insights) {
      if (item.type === "warning") warnings.push(item);
      else if (item.type === "forecast") forecast.push(item);
      else tips.push(item);
    }

    // Main insights: top 3 by priority order
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = [...insights].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
    main.push(...sorted.slice(0, 3));

    return { main, warnings, tips, forecast };
  }, [insights]);

  return (
    <div className="assistant-page">
      <p className="page-subtitle">
        Выберите период, нажмите «Проанализировать» и получите инсайты, предупреждения, рекомендации и короткий прогноз. В чат можно задавать вопросы по своим данным.
      </p>
      <div className={`assistant-llm-status ${llmOnline ? "online" : "offline"}`}>
        <span className="assistant-llm-dot" />
        {llmOnline
          ? `ИИ подключен`
          : llm?.enabled === false
          ? "ИИ отключён (LLM_ENABLED=false)"
          : `ИИ офлайн${llm?.reason ? `: ${llm.reason}` : ""}.`}
      </div>

      <div className="assistant-controls">
          <div className="assistant-period">
            <label>Период</label>
            <div className="assistant-period-buttons">
              <button type="button" className={period === "week" ? "active" : ""} onClick={() => setPeriod("week")}>
                Неделя
              </button>
              <button type="button" className={period === "month" ? "active" : ""} onClick={() => setPeriod("month")}>
                Месяц
              </button>
              <button type="button" className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>
                Всё время
              </button>
            </div>
          </div>

          <div className="assistant-account">
            <label htmlFor="assistant-account">Счёт для ответов</label>
            <select
              id="assistant-account"
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              disabled={accounts.length === 0}
            >
              <option value="all">Все счета</option>
              {accounts.map((account) => (
                <option key={account.id} value={String(account.id)}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>

          <button type="button" className="assistant-analyze" onClick={analyze} disabled={loading}>
            <FiBarChart2 size={18} />
            {loading ? "Анализ…" : "Проанализировать"}
          </button>
      </div>

      {error && <div className="assistant-error">{error}</div>}


      {loading && (
        <div className="assistant-loading">
          {llmOnline ? "Считаем аналитику и запрашиваем ИИ…" : "Считаем аналитику…"}
        </div>
      )}

      {!data && !loading && (
        <div className="assistant-empty-state">
          <p className="assistant-empty">
            Выберите период и счёт, затем нажмите «Проанализировать». Инсайты и чат будут по выбранному счёту.
          </p>
        </div>
      )}

      {data?.ai_overview && (
        <section className="assistant-ai-overview">
          <h2>Короткий вывод</h2>
          <p>{data.ai_overview}</p>
        </section>
      )}

      {data?.account_scope_label && data.account_scope_label !== "по всем счетам" && (
        <p className="assistant-scope-note">Анализ: {data.account_scope_label}</p>
      )}

      {summary && (
        <section className="assistant-grid">
          <div className="assistant-kpi">
            <span>Доходы</span>
            <strong>{formatMoney(summary.income, currency)}</strong>
          </div>
          <div className="assistant-kpi">
            <span>Расходы</span>
            <strong>{formatMoney(summary.expense, currency)}</strong>
          </div>
          <div className="assistant-kpi">
            <span>Итог</span>
            <strong className={summary.net >= 0 ? "positive" : "negative"}>
              {formatMoney(summary.net, currency)}
            </strong>
          </div>
          <div className="assistant-kpi">
            <span>Операций</span>
            <strong>{summary.transaction_count}</strong>
          </div>
        </section>
      )}

      {data && (
        <>
          <section className="assistant-section">
            <h2>Главные инсайты</h2>
            <div className="assistant-insight-list">
              {sections.main.map((item, index) => {
                const Icon = TYPE_ICONS[item.type] || FiCpu;
                return (
                  <article
                    key={`${item.title}-${index}`}
                    className={`assistant-insight assistant-insight--${item.type} assistant-insight--${item.priority}`}
                  >
                    <div className="assistant-insight-icon">
                      <Icon size={22} />
                    </div>
                    <div className="assistant-insight-body">
                      <h3>{item.title}</h3>
                      <p>{item.message}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="assistant-section">
            <h2>Предупреждения</h2>
            {sections.warnings.length === 0 ? (
              <p className="assistant-empty">Предупреждений за период не найдено.</p>
            ) : (
              <div className="assistant-insight-list">
                {sections.warnings.map((item, index) => {
                  const Icon = TYPE_ICONS[item.type] || FiAlertTriangle;
                  const apply = item.action?.apply_budget;
                  return (
                    <article
                      key={`${item.title}-${index}`}
                      className={`assistant-insight assistant-insight--${item.type} assistant-insight--${item.priority}`}
                    >
                      <div className="assistant-insight-icon">
                        <Icon size={22} />
                      </div>
                      <div className="assistant-insight-body">
                        <h3>{item.title}</h3>
                        <p>{item.message}</p>
                        <div className="assistant-insight-actions">
                          {apply?.budget_id && (
                            <button
                              type="button"
                              className="assistant-apply-btn"
                              disabled={applyingId === apply.budget_id}
                              onClick={() => handleApplyBudget(item)}
                            >
                              {applyingId === apply.budget_id
                                ? "Сохранение…"
                                : item.action?.label || "Применить"}
                            </button>
                          )}

                          {item.action?.path && !apply?.budget_id && (
                            <Link to={item.action.path} className="assistant-insight-link">
                              {item.action.label} →
                            </Link>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="assistant-section">
            <h2>Советы и рекомендации</h2>
            {sections.tips.length === 0 ? (
              <p className="assistant-empty">Пока нет рекомендаций — добавьте данные или импортируйте выписку.</p>
            ) : (
              <div className="assistant-insight-list">
                {sections.tips.map((item, index) => {
                  const Icon = TYPE_ICONS[item.type] || FiCpu;
                  return (
                    <article
                      key={`${item.title}-${index}`}
                      className={`assistant-insight assistant-insight--${item.type} assistant-insight--${item.priority}`}
                    >
                      <div className="assistant-insight-icon">
                        <Icon size={22} />
                      </div>
                      <div className="assistant-insight-body">
                        <h3>{item.title}</h3>
                        <p>{item.message}</p>
                        {item.action?.path && (
                          <Link to={item.action.path} className="assistant-insight-link">
                            {item.action.label} →
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="assistant-section">
            <h2>Краткий прогноз по бюджету и целям</h2>
            {sections.forecast.length === 0 ? (
              <p className="assistant-empty">
                Для прогноза нужен режим «Месяц» и достаточно операций.
              </p>
            ) : (
              <div className="assistant-insight-list">
                {sections.forecast.map((item, index) => {
                  const Icon = TYPE_ICONS[item.type] || FiTrendingUp;
                  return (
                    <article
                      key={`${item.title}-${index}`}
                      className={`assistant-insight assistant-insight--${item.type} assistant-insight--${item.priority}`}
                    >
                      <div className="assistant-insight-icon">
                        <Icon size={22} />
                      </div>
                      <div className="assistant-insight-body">
                        <h3>{item.title}</h3>
                        <p>{item.message}</p>
                        {item.action?.path && (
                          <Link to={item.action.path} className="assistant-insight-link">
                            {item.action.label} →
                          </Link>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <section className="assistant-chat panel">
        <h2>Вопрос к ИИ</h2>
        <p className="assistant-chat-hint">
          Например: «Самые большие траты по карте Альфа?» — можно указать любой ваш счёт по имени
          {accounts.length > 0 && (
            <>
              : {accounts.map((a) => a.name).join(", ")}
            </>
          )}
          . Или выберите счёт в списке выше.
          {accountFilter !== "all" && (
            <>
              {" "}
              Сейчас ответы только по «
              {accounts.find((a) => String(a.id) === String(accountFilter))?.name || "выбранный"}».
            </>
          )}
        </p>

        {!llmOnline && hasLlm && (
          <div className="assistant-chat-warn">
            Сейчас облачный ИИ недоступен — на типовые вопросы отвечу по вашим данным. Для сложных вопросов подождите и повторите.
          </div>
        )}

        <form className="assistant-chat-form" onSubmit={handleAsk}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ваш вопрос…"
            disabled={chatLoading}
          />
          <button type="submit" disabled={chatLoading || !question.trim()}>
            <FiSend size={18} />
            {chatLoading ? "Думаю…" : "Спросить"}
          </button>
        </form>

        {chatAnswer && (
          <div className="assistant-chat-answer assistant-chat-answer--card">
            <div className="assistant-chat-answer-title">
              <FiCheckCircle size={16} />
              Ответ
            </div>
            <p className="assistant-chat-text">{chatAnswer}</p>
          </div>
        )}
      </section>

      <details className="assistant-help">
        <summary className="assistant-help-summary">
          <span>Как задавать вопросы ассистенту</span>
        </summary>
        <div className="assistant-help-body">
          <p className="assistant-help-lead">
            Ответы и инсайты строятся по выбранному периоду и фильтру «Счёт для ответов». Чем точнее
            вопрос — тем полезнее результат.
          </p>
          <div className="assistant-help-grid">
            <div className="assistant-help-card">
              <h3>Примеры запросов</h3>
              <ul>
                <li>«Сколько я потратил(а) на еду за месяц?»</li>
                <li>«Траты по карте Альфа за неделю»</li>
                <li>«Топ‑5 категорий расходов за всё время»</li>
                <li>«Почему итог месяца отрицательный?»</li>
              </ul>
            </div>
            <div className="assistant-help-card">
              <h3>Как правильно уточнять</h3>
              <ul>
                <li>
                  <strong>Счёт</strong>: выберите вверху «Счёт для ответов» или укажите в вопросе.
                </li>
                <li>
                  <strong>Период</strong>: неделя/месяц/всё время переключаются сверху.
                </li>
                <li>
                  <strong>Категория</strong>: «еда», «такси», «жкх» — лучше, чем «мелкие траты».
                </li>
              </ul>
            </div>
          </div>
          <p className="assistant-help-note">
            Совет: если вы уже выбрали конкретный счёт, вопросы в чате тоже будут отвечаться в рамках
            этого счёта.
          </p>
        </div>
      </details>

      {history.length > 0 && (
        <section className="assistant-section">
          <h2>Последние анализы</h2>
          <div className="assistant-history">
            {history.slice(0, 4).map((h) => (
              <div key={h.id} className="assistant-history-item">
                <div className="assistant-history-head">
                  <span className="assistant-history-period">
                    <FiClock size={14} /> {h.period_label || h.period}
                  </span>
                  <span className="assistant-history-time">
                    {new Date(h.created_at).toLocaleString("ru-RU")}
                  </span>
                </div>
                {h.summary && (
                  <div className="assistant-history-kpis">
                    <span>Итог: {formatMoney(h.summary.net, currency)}</span>
                    <span>Расходы: {formatMoney(h.summary.expense, currency)}</span>
                  </div>
                )}
                {h.headline && <div className="assistant-history-text">{h.headline}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default Assistant;
