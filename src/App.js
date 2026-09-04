import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AppProvider, useApp } from "@/context/AppContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Admin from "@/pages/Admin";
import Dashboard from "@/pages/Dashboard";
import Billing from "@/pages/Billing";
import Products from "@/pages/Products";
import Inventory from "@/pages/Inventory";
import Purchases from "@/pages/Purchases";
import Sales from "@/pages/Sales";
import Customers from "@/pages/Customers";
import Suppliers from "@/pages/Suppliers";
import Returns from "@/pages/Returns";
import Reports from "@/pages/Reports";
import BarcodeLabels from "@/pages/BarcodeLabels";
import ImportExport from "@/pages/ImportExport";
import Users from "@/pages/Users";
import Activity from "@/pages/Activity";
import Settings from "@/pages/Settings";
import License from "@/pages/License";
import DayClose from "@/pages/DayClose";

const Loading = () => <div className="p-8 text-slate-500">Loading VYRO VX7…</div>;

const Protected = ({ children }) => {
  const { ready, user } = useApp();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.platformRole === "superadmin" || user.platform_role === "superadmin") return <Navigate to="/superadminpanel" replace />;
  return <Layout>{children}</Layout>;
};

const AdminOnly = () => {
  const { ready, user } = useApp();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (!(user.platformRole === "superadmin" || user.platform_role === "superadmin")) return <Navigate to="/dashboard" replace />;
  return <Admin />;
};

const routes = [
  ["/dashboard", Dashboard], ["/billing", Billing], ["/products", Products], ["/inventory", Inventory],
  ["/purchases", Purchases], ["/sales", Sales], ["/customers", Customers], ["/suppliers", Suppliers],
  ["/returns", Returns], ["/reports", Reports], ["/day-close", DayClose], ["/labels", BarcodeLabels], ["/import-export", ImportExport],
  ["/users", Users], ["/activity", Activity], ["/settings", Settings], ["/license", License],
];

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Toaster position="top-center" richColors />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/superadminpanel" element={<AdminOnly />} />
          {/* NOTE: this route is intentionally not linked from anywhere in the UI
              (not the login page, not the nav). Only someone who already knows
              the exact URL can reach it — and even then, AdminOnly still checks
              the real platformRole from the Firebase Auth token, so guessing
              the URL alone gives no access. */}
          {routes.map(([path, C]) => (
            <Route key={path} path={path} element={<Protected><C /></Protected>} />
          ))}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
