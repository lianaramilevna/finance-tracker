import { useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import AddTransactionModal from "../../features/transactions/AddTransactionModal";
import { createTransaction } from "../../shared/api/transactions";
import { FINANCE_DATA_CHANGED } from "../../shared/lib/events";
import { logoutUser } from "../../shared/api/auth";
import { clearSession, getCurrentUser } from "../../shared/lib/session";
import { toast } from "../../shared/ui/ToastProvider";
import { FiLogOut, FiMenu, FiUser } from "react-icons/fi";
import "./header.css";

function Header({ isDesktop = true, onToggleSidebar }) {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const user = getCurrentUser();

  const titles = {
    "/dashboard": "Обзор",
    "/transactions": "Операции",
    "/analytics": "Аналитика",
    "/accounts": "Счета",
    "/budgets": "Бюджет",
    "/goals": "Цели",
    "/settings": "Настройки",
    "/import": "Импорт",
    "/assistant": "Умный помощник",
  };

  const pageTitle =
    titles[location.pathname] ||
    Object.entries(titles).find(([path]) => location.pathname.startsWith(path))?.[1] ||
    "Balance";

  const handleAddTransaction = async (transaction) => {
    try {
      await createTransaction(transaction);
      window.dispatchEvent(new Event(FINANCE_DATA_CHANGED));
    } catch (error) {
      console.error(error);
      toast.error("Не удалось добавить транзакцию");
      throw error;
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

  return (
    <>
      <div className="header">
        <div className="header-left">
          {!isDesktop && (
            <button
              type="button"
              className="menu-btn"
              onClick={onToggleSidebar}
              aria-label="Открыть меню"
              title="Меню"
            >
              <FiMenu size={20} />
            </button>
          )}
          <h2 className="header-title">{pageTitle}</h2>
        </div>

        <div className="header-right">
          <button className="add-btn" onClick={() => setIsOpen(true)}>
            + Добавить
          </button>

          <div className="user-block">
            <span className="user-name">{user?.username || "User"}</span>
            <div className="avatar">
              <FiUser size={20} />
            </div>

            <button className="logout-btn" onClick={handleLogout} title="Выйти">
              <FiLogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      <AddTransactionModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onAdd={handleAddTransaction}
      />
    </>
  );
}

export default Header;

