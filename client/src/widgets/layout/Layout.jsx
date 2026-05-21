import Sidebar from "./Sidebar"
import Header from "./Header";
import "./layout.css";

function Layout({ children }) {
  return (
    <div className="layout">
      
      <div className="main">
                <div className="content">{children}</div>
      </div>
    </div>
  );
}

export default Layout;