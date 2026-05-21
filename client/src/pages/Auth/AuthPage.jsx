import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkUsernameAvailable,
  loginUser,
  registerUser,
} from "../../shared/api/auth";
import { saveSession } from "../../shared/lib/session";
import "./AuthPage.css";

function validateUsername(username) {
  const value = String(username || "").trim();

  if (!value) return "Введите имя пользователя";
  if (value.length < 3) return "Минимум 3 символа";
  if (value.length > 30) return "Максимум 30 символов";
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) {
    return "Только буквы, цифры, _ и -";
  }

  return "";
}

function validateEmail(email) {
  const value = String(email || "").trim().toLowerCase();

  if (!value) return "Введите email";
  if (/\s/.test(value)) return "Без пробелов";
  if (value.startsWith(".") || value.endsWith(".")) return "Некорректный email";
  if (!/^(?!.*\.\.)[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return "Формат: name@example.com";
  }

  return "";
}

function validatePassword(password) {
  const value = String(password || "");

  if (!value) return "Введите пароль";
  if (value.length < 8) return "Минимум 8 символов";
  if (/\s/.test(value)) return "Без пробелов";
  //if (!/[A-Za-zА-Яа-яЁё]/.test(value)) return "Нужна хотя бы одна буква";
  if (!/\d/.test(value)) return "Нужна хотя бы одна цифра";

  return "";
}

function AuthPage() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    username: "",
    email: "",
    login: "",
    password: "",
    repeatPassword: "",
  });

  const [errors, setErrors] = useState({
    username: "",
    email: "",
    login: "",
    password: "",
    repeatPassword: "",
    form: "",
  });

  const [touched, setTouched] = useState({
    username: false,
    email: false,
    login: false,
    password: false,
    repeatPassword: false,
  });

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState("idle");

  const navigate = useNavigate();
  const isLogin = mode === "login";

  const title = useMemo(() => (isLogin ? "Вход" : "Регистрация"), [isLogin]);

  const validateSingleField = (name, value, currentForm = form, currentMode = mode) => {
    if (currentMode === "login") {
      if (name === "login") {
        return String(value || "").trim() ? "" : "Введите логин или email";
      }
      if (name === "password") {
        return validatePassword(value);
      }
      return "";
    }

    if (name === "username") return validateUsername(value);
    if (name === "email") return validateEmail(value);
    if (name === "password") return validatePassword(value);

    if (name === "repeatPassword") {
      if (!value) return "Повторите пароль";
      if (value !== currentForm.password) return "Пароли не совпадают";
      return "";
    }

    return "";
  };

  const runValidation = (nextForm = form, nextMode = mode) => {
    const nextErrors = {
      username: "",
      email: "",
      login: "",
      password: "",
      repeatPassword: "",
      form: "",
    };

    if (nextMode === "login") {
      nextErrors.login = String(nextForm.login || "").trim()
        ? ""
        : "Введите логин или email";
      nextErrors.password = validatePassword(nextForm.password);
      return nextErrors;
    }

    nextErrors.username = validateUsername(nextForm.username);
    nextErrors.email = validateEmail(nextForm.email);
    nextErrors.password = validatePassword(nextForm.password);

    if (!nextForm.repeatPassword) {
      nextErrors.repeatPassword = "Повторите пароль";
    } else if (nextForm.password !== nextForm.repeatPassword) {
      nextErrors.repeatPassword = "Пароли не совпадают";
    }

    return nextErrors;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;

    const nextForm = { ...form, [name]: value };
    setForm(nextForm);

    const fieldError = validateSingleField(name, value, nextForm, mode);

    setErrors((prev) => ({
      ...prev,
      [name]: fieldError,
      form: "",
    }));

    if (name === "username") {
      setUsernameStatus("idle");
    }

    if (name === "password" && mode === "register" && nextForm.repeatPassword) {
      setErrors((prev) => ({
        ...prev,
        repeatPassword:
          nextForm.password === nextForm.repeatPassword
            ? "" : "Пароли не совпадают",
      }));
    }

    if (name === "repeatPassword" && mode === "register") {
      setErrors((prev) => ({
        ...prev,
        repeatPassword:
          nextForm.repeatPassword === nextForm.password ? "" : "Пароли не совпадают",
      }));
    }
  };

  const handleBlur = async (e) => {
    const { name, value } = e.target;

    setTouched((prev) => ({ ...prev, [name]: true }));

    const fieldError = validateSingleField(name, value, form, mode);
    setErrors((prev) => ({
      ...prev,
      [name]: fieldError,
    }));

    if (name === "username" && mode === "register" && !fieldError) {
      try {
        setUsernameStatus("checking");
        const result = await checkUsernameAvailable(value);

        if (result.available) {
          setUsernameStatus("available");
          setErrors((prev) => ({ ...prev, username: "" }));
        } else {
          setUsernameStatus("unavailable");
          setErrors((prev) => ({
            ...prev,
            username: result.message || "Это имя пользователя уже занято",
          }));
        }
      } catch (error) {
        setUsernameStatus("idle");
        setErrors((prev) => ({
          ...prev,
          username: error.message || "Не удалось проверить имя пользователя",
        }));
      }
    }

    if (name === "password" && mode === "register" && form.repeatPassword) {
      setErrors((prev) => ({
        ...prev,
        repeatPassword:
          form.password === form.repeatPassword ? "" : "Пароли не совпадают",
      }));
    }
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setErrors({
      username: "",
      email: "",
      login: "",
      password: "",
      repeatPassword: "",
      form: "",
    });
    setTouched({
      username: false,
      email: false,
      login: false,
      password: false,
      repeatPassword: false,
    });
    setUsernameStatus("idle");
    setShowPassword(false);
    setShowRepeatPassword(false);

    setForm((prev) => ({
      ...prev,
      username: nextMode === "login" ? "" : prev.username,
      email: nextMode === "login" ? "" : prev.email,
      login: nextMode === "login" ? prev.login : "",
      repeatPassword: "",
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const nextErrors = runValidation(form, mode);
    setErrors(nextErrors);
    setTouched({
      username: true,
      email: true,
      login: true,
      password: true,
      repeatPassword: true,
    });

    const hasErrors = Object.values(nextErrors).some(Boolean);
    if (hasErrors) return;

    try {
      setLoading(true);

      if (isLogin) {
        const { user, token } = await loginUser({
          login: form.login,
          password: form.password,
        });

        saveSession({ user, token });
        navigate("/dashboard", { replace: true });
        return;
      }

      if (usernameStatus !== "available") {
        const result = await checkUsernameAvailable(form.username);
        if (!result.available) {
          setErrors((prev) => ({
            ...prev,
            username: result.message || "Это имя пользователя уже занято",
          }));
          setUsernameStatus("unavailable");
          return;
        }
        setUsernameStatus("available");
      }

      const { user, token } = await registerUser({
        username: form.username,
        email: form.email,
        password: form.password,
      });

      saveSession({ user, token });
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        form: err.message || "Ошибка",
      }));
    } finally {
      setLoading(false);
    }
  };

  const showError = (field) => touched[field] && errors[field];

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="auth-brand">— Balance —</div>

          <h1>Контролируй доходы и расходы в одном месте</h1>

          <p className="auth-text">
            Balance — помогает вести бюджет, отслеживать операции, анализировать траты и видеть, куда уходят деньги.
          </p>

          <div className="auth-actions">
            <button
              type="button"
              className={isLogin ? "hero-btn active" : "hero-btn"}
              onClick={() => handleModeChange("login")}
            >
              Войти
            </button>

            <button
              type="button"
              className={!isLogin ? "hero-btn active" : "hero-btn"}
              onClick={() => handleModeChange("register")}
            >
              Зарегистрироваться
            </button>
          </div>

          <div className="auth-points">
            <div className="auth-point">Аналитика доходов и расходов</div>
            <div className="auth-point">Бюджеты и категории</div>
            <div className="auth-point">Цели накоплений и счета</div>
          </div>
        </section>

        <section className="auth-card">
          <h2 className="auth-title">{title}</h2>
          <p className="auth-subtitle">
            {isLogin
              ? "Войди в аккаунт, чтобы открыть свои финансы"
              : "Создай аккаунт и начни вести доходы и расходы"}
          </p>

          <div className="auth-switch">
            <button
              className={isLogin ? "active" : ""}
              onClick={() => handleModeChange("login")}
              type="button"
            >
              Вход
            </button>
            <button
              className={!isLogin ? "active" : ""}
              onClick={() => handleModeChange("register")}
              type="button"
            >
              Регистрация
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isLogin ? (
              <div className="auth-field">
                <input
                  name="login"
                  type="text"
                  value={form.login}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Логин или email"
                  required
                  autoComplete="username"
                />
                {showError("login") && (
                  <p className="auth-field-error">{errors.login}</p>
                )}
              </div>
            ) : (
              <div className="auth-field">
                <input
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Уникальное имя пользователя"
                  required
                />
                {mode === "register" && usernameStatus === "checking" && (
                  <p className="auth-field-hint">Проверяем доступность...</p>
                )}
                {mode === "register" && usernameStatus === "available" && !errors.username && (
                  <p className="auth-field-ok">Имя пользователя доступно</p>
                )}
                {showError("username") && (
                  <p className="auth-field-error">{errors.username}</p>
                )}
              </div>
            )}

            {!isLogin && (
              <div className="auth-field">
                <input
                  name="email"
                  type="text"
                  value={form.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Почта"
                  required
                  autoComplete="email"
                />
                {showError("email") && (
                  <p className="auth-field-error">{errors.email}</p>
                )}
              </div>
            )}

            <div className="auth-field">
              <div className="password-wrap">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Пароль"
                  required
                  autoComplete={isLogin ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>
              {showError("password") && (
                <p className="auth-field-error">{errors.password}</p>
              )}
            </div>

            {!isLogin && (
              <div className="auth-field">
                <div className="password-wrap">
                  <input
                    name="repeatPassword"
                    type={showRepeatPassword ? "text" : "password"}
                    value={form.repeatPassword}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="Повторите пароль"
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowRepeatPassword((prev) => !prev)}
                    aria-label={
                      showRepeatPassword ? "Скрыть пароль" : "Показать пароль"
                    }
                  >
                    {showRepeatPassword ? "🙈" : "👁"}
                  </button>
                </div>
                {showError("repeatPassword") && (
                  <p className="auth-field-error">{errors.repeatPassword}</p>
                )}
              </div>
            )}

            {errors.form && <p className="auth-error">{errors.form}</p>}

            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? "Загрузка..." : isLogin ? "Войти" : "Зарегистрироваться"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default AuthPage;