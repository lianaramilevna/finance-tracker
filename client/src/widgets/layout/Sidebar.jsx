import { NavLink } from "react-router-dom";
import {
  FiBarChart2,
  FiTrendingUp,
  FiCreditCard,
  FiTarget,
  FiSettings,
  FiGrid,
  FiDollarSign,
  FiUploadCloud,
  FiCpu,
} from "react-icons/fi";
import "./sidebar.css";

const MAIN_NAV = [
  { to: "/dashboard", icon: FiGrid, label: "Обзор" },
  { to: "/transactions", icon: FiDollarSign, label: "Операции" },
  { to: "/assistant", icon: FiCpu, label: "ИИ‑помощник" },
  { to: "/import", icon: FiUploadCloud, label: "Импорт" },
  { to: "/analytics", icon: FiBarChart2, label: "Аналитика" },
];

const FINANCE_NAV = [
  { to: "/accounts", icon: FiCreditCard, label: "Счета" },
  { to: "/budgets", icon: FiTrendingUp, label: "Бюджет" },
  { to: "/goals", icon: FiTarget, label: "Цели" },
];

function Sidebar({ isOpen = true, onClose }) {
  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? " open" : ""}`}
        onClick={onClose}
        aria-hidden={!isOpen}
      />
      <aside className={`sidebar${isOpen ? " sidebar--open" : ""}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-name">— Balance —</span>
        </div>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <span className="sidebar-label">Главное</span>
          <nav className="menu">
            {MAIN_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `menu-item${isActive ? " active" : ""}${
                    item.to === "/assistant" ? " menu-item--assistant" : ""
                  }`
                }
                onClick={onClose}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="sidebar-section">
          <span className="sidebar-label">Планирование</span>
          <nav className="menu">
            {FINANCE_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `menu-item${isActive ? " active" : ""}`}
                onClick={onClose}
              >
                <item.icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="menu-divider" />

        <nav className="menu">
          <NavLink
            to="/settings"
            className={({ isActive }) => `menu-item${isActive ? " active" : ""}`}
            onClick={onClose}
          >
            <FiSettings size={20} />
            <span>Настройки</span>
          </NavLink>
        </nav>
      </div>
      </aside>
    </>
  );
}

export default Sidebar;
