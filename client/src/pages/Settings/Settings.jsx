import { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import {
  changeUserPassword,
  clearUserData,
  deleteUserAccount,
  getUserSettings,
  updateUserSettings,
} from "../../shared/api/users";
import { logoutUser } from "../../shared/api/auth";
import { clearSession, getCurrentUser, updateCurrentUser } from "../../shared/lib/session";
import { toast } from "../../shared/ui/ToastProvider";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import "./settings.css";

const CLEAR_CONFIRM_PHRASE = "ОЧИСТИТЬ";
const DELETE_CONFIRM_PHRASE = "УДАЛИТЬ";

function Settings() {
  const navigate = useNavigate();
  const currentUser = getCurrentUser();
  const userId = currentUser?.id || null;

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [message, setMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showRepeatPassword, setShowRepeatPassword] = useState(false);

  const [profileForm, setProfileForm] = useState({
    username: "",
    email: "",
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
          currency: "RUB",
        };

        setProfileForm({
          username: nextUser.username,
          email: nextUser.email,
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
      });

      const nextUser = {
        ...currentUser,
        username: updated.username,
        email: updated.email,
        currency: "RUB",
      };

      updateCurrentUser(nextUser);

      setProfileForm({
        username: updated.username,
        email: updated.email,
      });

      setMessage("Профиль сохранён");
      toast.success("Профиль сохранён");
    } catch (error) {
      console.error(error);
      setMessage(error.message || "Не удалось сохранить профиль");
      toast.error(error.message || "Не удалось сохранить профиль");
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
      toast.success("Пароль успешно изменён");
    } catch (error) {
      console.error(error);
      setPasswordMessage(error.message || "Не удалось изменить пароль");
      toast.error(error.message || "Не удалось изменить пароль");
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

  const openClearModal = () => {
    setClearConfirmText("");
    setClearModalOpen(true);
  };

  const closeClearModal = () => {
    if (clearing) return;
    setClearModalOpen(false);
    setClearConfirmText("");
  };

  const openDeleteModal = () => {
    setDeleteConfirmText("");
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (deleting) return;
    setDeleteModalOpen(false);
    setDeleteConfirmText("");
  };

  const handleClearData = async () => {
    if (!userId) return;
    if (clearConfirmText.trim() !== CLEAR_CONFIRM_PHRASE) return;

    try {
      setClearing(true);
      await clearUserData(userId);
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
      setClearModalOpen(false);
      setClearConfirmText("");
      toast.success("Данные очищены");
      navigate("/accounts");
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось очистить данные");
    } finally {
      setClearing(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!userId) return;
    if (deleteConfirmText.trim() !== DELETE_CONFIRM_PHRASE) return;

    try {
      setDeleting(true);
      await deleteUserAccount(userId);
    } catch (error) {
      console.error(error);
      toast.error(error.message || "Не удалось удалить аккаунт");
      return;
    } finally {
      setDeleting(false);
    }

    setDeleteModalOpen(false);
    setDeleteConfirmText("");

    try {
      await logoutUser();
    } catch {
      // ignore
    }
    clearSession();
    toast.success("Аккаунт удалён");
    navigate("/", { replace: true });
  };

  const clearPhraseOk = clearConfirmText.trim() === CLEAR_CONFIRM_PHRASE;
  const deletePhraseOk = deleteConfirmText.trim() === DELETE_CONFIRM_PHRASE;

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
      <p className="page-subtitle">Настройки профиля, безопасности и данных</p>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-section-title">
            <h2>Профиль</h2>
            <span>Имя пользователя и email</span>
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
            <div className="settings-select" aria-disabled="true">
              RUB
            </div>
            <p className="settings-hint">
              В приложении используется одна валюта: рубли.
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

        <section className="settings-card settings-card-wide">
          <div className="settings-section-title">
            <h2>Данные</h2>
            <span>Очистка истории и удаление аккаунта</span>
          </div>

          <div className="settings-block">
            <p className="settings-hint">
              «Очистить данные» удалит счета, операции, бюджеты, цели и категории, но оставит профиль.
              «Удалить аккаунт» удалит всё полностью — потребуется ввести слово подтверждения.
            </p>
          </div>

          <div className="settings-actions-row">
            <button
              className="settings-danger-btn"
              type="button"
              onClick={openClearModal}
              disabled={clearing || deleting}
            >
              Очистить данные
            </button>

            <button
              className="settings-danger-btn settings-danger-btn--strong"
              type="button"
              onClick={openDeleteModal}
              disabled={clearing || deleting}
            >
              Удалить аккаунт
            </button>
          </div>
        </section>
      </div>

      {clearModalOpen && (
        <div className="settings-modal-overlay" onClick={closeClearModal}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-head">
              <h3>Очистить данные?</h3>
              <button type="button" className="settings-modal-close" onClick={closeClearModal}>
                <FiX size={18} />
              </button>
            </div>
            <p className="settings-modal-text">
              Будут удалены: счета, операции, бюджеты, цели и ваши категории. Профиль и вход
              сохранятся.
            </p>
            <label className="settings-modal-label">
              Введите <strong>{CLEAR_CONFIRM_PHRASE}</strong> для подтверждения
            </label>
            <input
              type="text"
              className="settings-modal-input"
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder={CLEAR_CONFIRM_PHRASE}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="settings-modal-actions">
              <button type="button" className="settings-modal-secondary" onClick={closeClearModal}>
                Отмена
              </button>
              <button
                type="button"
                className="settings-danger-btn"
                onClick={handleClearData}
                disabled={!clearPhraseOk || clearing}
              >
                {clearing ? "Очистка..." : "Очистить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && (
        <div className="settings-modal-overlay" onClick={closeDeleteModal}>
          <div className="settings-modal settings-modal--danger" onClick={(e) => e.stopPropagation()}>
            <div className="settings-modal-head">
              <h3>Удалить аккаунт?</h3>
              <button type="button" className="settings-modal-close" onClick={closeDeleteModal}>
                <FiX size={18} />
              </button>
            </div>
            <p className="settings-modal-text">
              Будут удалены профиль и все финансовые данные. Это действие нельзя отменить.
            </p>
            <label className="settings-modal-label">
              Введите <strong>{DELETE_CONFIRM_PHRASE}</strong> для подтверждения
            </label>
            <input
              type="text"
              className="settings-modal-input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={DELETE_CONFIRM_PHRASE}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="settings-modal-actions">
              <button type="button" className="settings-modal-secondary" onClick={closeDeleteModal}>
                Отмена
              </button>
              <button
                type="button"
                className="settings-danger-btn settings-danger-btn--strong"
                onClick={handleDeleteAccount}
                disabled={!deletePhraseOk || deleting}
              >
                {deleting ? "Удаление..." : "Удалить навсегда"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;