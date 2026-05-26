import { Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Header from "./Header";
import "./layout.css";

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 900 : true
  );

  useEffect(() => {
    const handleResize = () => {
      const nextIsDesktop = window.innerWidth > 900;
      setIsDesktop(nextIsDesktop);
      if (nextIsDesktop) setSidebarOpen(false);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="layout">
      <Sidebar
        isOpen={isDesktop || sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="main">
        <Header
          isDesktop={isDesktop}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        />

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
