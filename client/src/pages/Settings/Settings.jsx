import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  changeUserPassword,
  getUserSettings,
  updateUserSettings,
} from "../../shared/api/users";
import { logoutUser } from "../../shared/api/auth";
import { clearSession, getCurrentUser, updateCurrentUser } from "../../shared/lib/session";
import "./settings.css";

const CURRENCIES = ["RUB", "EUR", "USD"];

function Settings() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = currentUser?.id || null;

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);

  const [profileForm, setProfileForm] = useState({
    username: "",
    email: "",
    currency: "RUB",
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    repeatPassword: "",
  });

  const [profileErrors, setProfileErrors] = useState({
    username: "",
    email: "",
  });

  const [passwordErrors, setPasswordErrors] = useState({
    currentPassword: "",
    newPassword: "",
    repeatPassword: "",
  });

  const currencyLabel = useMemo(() => {
    return CURRENCIES.includes(profileForm.currency) ? profileForm.currency : "RUB";
  }, [profileForm.currency]);

  useEffect(() => {
    const loadSettings = async () => {
      if (!userId) {
        setMessage("Сначала войди в аккаунт.");
        setLoading(false);
        return;
      }

      try {
        const data = await getUserSettings(userId);

        const nextUser = {
          ...currentUser,
          username: data.username || currentUser?.username || "",
          email: data.email || currentUser?.email || "",
          currency: data.currency || "RUB",
        };

        setProfileForm({
          username: nextUser.username,
          email: nextUser.email,
          currency: nextUser.currency,
        });

        updateCurrentUser(nextUser);
        setMessage("");
      } catch (error) {
        console.error(error);
        setMessage("Не удалось загрузить настройки");
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [userId]); // intentionally not depending on currentUser to avoid reload loops

  const validateUsername = (username) => {
    const value = String(username || "").trim();

    if (!value) return "Введите имя пользователя";
    if (value.length < 3) return "Минимум 3 символа";
    if (value.length > 30) return "Максимум 30 символов";
    if (!/^[\p{L}\p{N}_-]+$/u.test(value)) {
      return "Только буквы, цифры, _ и -";
    }

    return "";
  };

  const validateEmail = (email) => {
    const value = String(email || "").trim().toLowerCase();

    if (!value) return "Введите email";
    if (/\s/.test(value)) return "Без пробелов";
    if (value.startsWith(".") || value.endsWith(".")) return "Некорректный email";
    if (!/^(?!.*\.\.)[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      return "Формат: name@example.com";
    }

    return "";
  };

  const validatePasswordForm = () => {
    const nextErrors = {
      currentPassword: "",
      newPassword: "",
      repeatPassword: "",
    };

    if (!passwordForm.currentPassword.trim()) {
      nextErrors.currentPassword = "Введите текущий пароль";
    }

    if (!passwordForm.newPassword.trim()) {
      nextErrors.newPassword = "Введите новый пароль";
    } else if (passwordForm.newPassword.length < 8) {
      nextErrors.newPassword = "Пароль должен быть минимум 8 символов";
    } else if (/\s/.test(passwordForm.newPassword)) {
      nextErrors.newPassword = "Пароль не должен содержать пробелы";
    }

    if (!passwordForm.repeatPassword.trim()) {
      nextErrors.repeatPassword = "Повторите новый пароль";
    } else if (passwordForm.newPassword !== passwordForm.repeatPassword) {
      nextErrors.repeatPassword = "Пароли не совпадают";
    }

    return nextErrors;
  };

  const handleProfileChange = (e) => {
    const { name, value } = e.target;
    setProfileForm((prev) => ({ ...prev, [name]: value }));

    setProfileErrors((prev) => ({
      ...prev,
      [name]: name === "username" ? validateUsername(value) : validateEmail(value),
    }));

    setMessage("");
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));

    setPasswordErrors((prev) => ({
      ...prev,
      [name]: "",
    }));

    setPasswordMessage("");
  };

  const handleSaveProfile = async () => {
    if (!userId) {
      setMessage("Сначала войди в аккаунт.");
      return;
    }

    const nextErrors = {
      username: validateUsername(profileForm.username),
      email: validateEmail(profileForm.email),
    };

    setProfileErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingProfile(true);
      setMessage("");

      const updated = await updateUserSettings(userId, {
        username: profileForm.username,
        email: profileForm.email,
        currency: currencyLabel,
      });

      const nextUser = {
        ...currentUser,
        username: updated.username,
        email: updated.email,
        currency: updated.currency,
      };

      updateCurrentUser(nextUser);

      setProfileForm({
        username: updated.username,
        email: updated.email,
        currency: updated.currency,
      });

      setMessage("Профиль сохранён");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось сохранить профиль");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSavePassword = async () => {
    if (!userId) {
      setPasswordMessage("Сначала войди в аккаунт.");
      return;
    }

    const nextErrors = validatePasswordForm();
    setPasswordErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPassword(true);
      setPasswordMessage("");

      await changeUserPassword(userId, {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        repeatPassword: "",
      });

      setPasswordMessage("Пароль успешно изменён");
    } catch (error) {
      console.error(error);
      setPasswordMessage(error.message || "Не удалось изменить пароль");
    } finally {
      setSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      // ignore network errors on logout
    }
    clearSession();
    navigate("/", { replace: true });
  };

  if (loading) {
    return (
      <div className="settings-page">
        <div className="settings-card">
          <p className="settings-status">Загрузка...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <div>
          <p>Настройки профиля, валюты и безопасности</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-section-title">
            <h2>Профиль</h2>
            <span>Имя пользователя, email и валюта</span>
          </div>

          <div className="settings-block">
            <label>Имя пользователя</label>
            <input
              type="text"
              name="username"
              value={profileForm.username}
              onChange={handleProfileChange}
              placeholder="Имя пользователя"
            />
            {profileErrors.username && (
              <p className="settings-field-error">{profileErrors.username}</p>
            )}
          </div>

          <div className="settings-block">
            <label>Email</label>
            <input
              type="text"
              name="email"
              value={profileForm.email}
              onChange={handleProfileChange}
              placeholder="Email"
            />
            {profileErrors.email && (
              <p className="settings-field-error">{profileErrors.email}</p>
            )}
          </div>

          <div className="settings-block">
            <label>Основная валюта</label>
            <select
              className="settings-select"
              value={profileForm.currency}
              onChange={(e) =>
                setProfileForm((prev) => ({ ...prev, currency: e.target.value }))
              }
            >
              {CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
            <p className="settings-hint">
              Сейчас суммы будут отображаться в выбранной валюте.
            </p>
          </div>

          <div className="settings-actions-row">
            <button
              className="settings-save-btn"
              onClick={handleSaveProfile}
              disabled={savingProfile}
              type="button"
            >
              {savingProfile ? "Сохранение..." : "Сохранить профиль"}
            </button>

            <button
              className="settings-logout-btn"
              onClick={handleLogout}
              type="button"
            >
              Выйти
            </button>
          </div>

          {message && <p className="settings-status">{message}</p>}
        </section>

        <section className="settings-card">
          <div className="settings-section-title">
            <h2>Безопасность</h2>
            <span>Смена пароля</span>
          </div>

          <div className="settings-block">
            <label>Текущий пароль</label>
            <div className="password-wrap">
              <input
                type={showCurrentPassword ? "text" : "password"}
                name="currentPassword"
                value={passwordForm.currentPassword}
                onChange={handlePasswordChange}
                placeholder="Введите текущий пароль"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowCurrentPassword((prev) => !prev)}
                aria-label={showCurrentPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showCurrentPassword ? "🙈" : "👁"}
              </button>
            </div>
            {passwordErrors.currentPassword && (
              <p className="settings-field-error">{passwordErrors.currentPassword}</p>
            )}
          </div>

          <div className="settings-block">
            <label>Новый пароль</label>
            <div className="password-wrap">
              <input
                type={showNewPassword ? "text" : "password"}
                name="newPassword"
                value={passwordForm.newPassword}
                onChange={handlePasswordChange}
                placeholder="Минимум 8 символов"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowNewPassword((prev) => !prev)}
                aria-label={showNewPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showNewPassword ? "🙈" : "👁"}
              </button>
            </div>
            {passwordErrors.newPassword && (
              <p className="settings-field-error">{passwordErrors.newPassword}</p>
            )}
          </div>

          <div className="settings-block">
            <label>Повторите новый пароль</label>
            <div className="password-wrap">
              <input
                type={showRepeatPassword ? "text" : "password"}
                name="repeatPassword"
                value={passwordForm.repeatPassword}
                onChange={handlePasswordChange}
                placeholder="Повторите новый пароль"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowRepeatPassword((prev) => !prev)}
                aria-label={showRepeatPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showRepeatPassword ? "🙈" : "👁"}
              </button>
            </div>
            {passwordErrors.repeatPassword && (
              <p className="settings-field-error">{passwordErrors.repeatPassword}</p>
            )}
          </div>

          <div className="settings-actions-row">
            <button
              className="settings-save-btn"
              onClick={handleSavePassword}
              disabled={savingPassword}
              type="button"
            >
              {savingPassword ? "Сохранение..." : "Изменить пароль"}
            </button>
          </div>

          {passwordMessage && (
            <p className="settings-status">{passwordMessage}</p>
          )}
        </section>

    
      </div>
    </div>
  );
}

export default Settings;