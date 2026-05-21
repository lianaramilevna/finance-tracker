import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import "./layout.css";

function AppLayout() {
  return (
    <div className="layout">
      <Sidebar />

      <div className="main">
        <Header />

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;