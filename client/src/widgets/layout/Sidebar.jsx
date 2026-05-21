import { NavLink } from "react-router-dom";
import { FiBarChart2, FiTrendingUp, FiCreditCard, FiTarget, FiSettings, FiGrid, FiDollarSign } from "react-icons/fi";
import "./sidebar.css";

function Sidebar() {
  return (
    <div className="sidebar">
      <div className="logo"> — Balance —</div>

      <nav className="menu">
        <NavLink to="/dashboard" className="menu-item">
          <FiGrid size={20} />
          <span>Обзор</span>
        </NavLink>

        <NavLink to="/transactions" className="menu-item">
          <FiDollarSign size={20} />
          <span>Операции</span>
        </NavLink>

        <NavLink to="/analytics" className="menu-item">
        <FiBarChart2 size={20} />
          <span>Аналитика</span>
        </NavLink>

        <NavLink to="/accounts" className="menu-item">
          <FiCreditCard size={20} />
          <span>Счета</span>
        </NavLink>

        <NavLink to="/budgets" className="menu-item">
          <FiTrendingUp size={20} />
          <span>Бюджет</span>
        </NavLink>

        <NavLink to="/goals" className="menu-item">
          <FiTarget size={20} />
          <span>Цели</span>
        </NavLink>

        <div className="menu-divider"></div>

        <NavLink to="/settings" className="menu-item">
          <FiSettings size={20} />
          <span>Настройки</span>
        </NavLink>
      </nav>
    </div>
  );
}

export default Sidebar;