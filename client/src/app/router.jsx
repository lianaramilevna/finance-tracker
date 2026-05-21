import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../widgets/layout/AppLayout";
import AuthPage from "../pages/Auth/AuthPage";
import Dashboard from "../pages/Dashboard/Dashboard";
import Transactions from "../pages/Transactions/Transactions";
import Analytics from "../pages/Analytics/Analytics";
import Accounts from "../pages/Accounts/Accounts";
import Settings from "../pages/Settings/Settings";
import Budgets from "../pages/Budgets/Budgets";
import Goals from "../pages/Goals/Goals";
import ImportPage from "../pages/Import/ImportPage";
import { isAuthenticated } from "../shared/lib/session";

function RequireAuth({ children }) {
  return isAuthenticated() ? children : <Navigate to="/" replace />;
}

function PublicOnly({ children }) {
  return isAuthenticated() ? <Navigate to="/dashboard" replace /> : children;
}

function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <PublicOnly>
              <AuthPage />
            </PublicOnly>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default Router;