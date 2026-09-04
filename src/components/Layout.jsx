import { NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useApp } from "@/context/AppContext";
import {
  LayoutDashboard, Zap, Package, Boxes, ShoppingCart, ReceiptText, Users, Truck,
  RotateCcw, BarChart3, QrCode, FileSpreadsheet, UserCog, ScrollText, Settings as Cog,
  KeyRound, Menu, X, LogOut, Wifi, WifiOff, CalendarCheck, Sun, Moon,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: null },
  { to: "/billing", label: "Quick Billing", icon: Zap, perm: "billing", hot: true },
  { to: "/products", label: "Products", icon: Package, perm: null },
  { to: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory" },
  { to: "/purchases", label: "Purchases", icon: ShoppingCart, perm: "purchases" },
  { to: "/sales", label: "Sales", icon: ReceiptText, perm: "sales" },
  { to: "/customers", label: "Customers & Khata", icon: Users, perm: "customers" },
  { to: "/suppliers", label: "Suppliers", icon: Truck, perm: "suppliers" },
  { to: "/returns", label: "Returns", icon: RotateCcw, perm: "returns" },
  { to: "/reports", label: "Reports", icon: BarChart3, perm: "reports" },
  { to: "/day-close", label: "Day Closing", icon: CalendarCheck, perm: "reports" },
  { to: "/labels", label: "Barcode & Labels", icon: QrCode, perm: "labels" },
  { to: "/import-export", label: "Import / Export", icon: FileSpreadsheet, perm: "importexport" },
  { to: "/users", label: "Users & Permissions", icon: UserCog, perm: "settings" },
  { to: "/activity", label: "Activity Log", icon: ScrollText, perm: "activity" },
  { to: "/settings", label: "Settings", icon: Cog, perm: "settings" },
  { to: "/license", label: "License", icon: KeyRound, perm: "settings" },
];

export const Layout = ({ children }) => {
  const { user, shop, logout, online, pending, can } = useApp();
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const nav = useNavigate();

  const items = NAV.filter((n) => !n.perm || can(n.perm));

  const doLogout = async () => {
    await logout();
    nav("/login");
  };

  return (
    <div className="min-h-screen bg-background flex">
      {open && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        data-testid="sidebar"
        className={`fixed lg:static z-40 top-0 left-0 h-screen w-[260px] bg-[#1e3a8a] text-slate-300 flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="px-5 py-5 flex items-center gap-2 border-b border-white/10 bg-gradient-to-r from-[#16a34a]/15 to-transparent">
          <Boxes className="text-[#16a34a]" size={22} />
          <div>
            <div className="text-white font-semibold tracking-tight">VYRO VX7</div>
            <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{shop?.businessName || "Smart Business POS"}</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setOpen(false)} data-testid="sidebar-close">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              data-testid={`nav-${n.to.slice(1)}`}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
                  isActive
                    ? "bg-[#16a34a] text-[#1e3a8a] font-semibold shadow-lg shadow-[#16a34a]/20"
                    : "hover:bg-white/5 hover:text-white hover:translate-x-0.5"
                }`
              }
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.hot && <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-white/10">F2</span>}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={doLogout}
          data-testid="logout-btn"
          className="m-3 flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm bg-white/5 hover:bg-white/10"
        >
          <LogOut size={16} /> Logout
        </button>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-3">
          <button className="lg:hidden" onClick={() => setOpen(true)} data-testid="sidebar-open">
            <Menu size={22} />
          </button>
          <div className="text-sm font-medium text-foreground truncate">
            {user?.name} <span className="text-muted-foreground">· {user?.role}</span>
          </div>
          {mounted && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="icon-btn ml-auto"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              data-testid="theme-toggle"
            >
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          )}
          <div
            data-testid="online-status"
            className={`text-xs px-2.5 py-1.5 rounded-full font-medium flex items-center gap-1.5 ${
              online ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {online ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="hidden sm:inline">{online ? "Online — Cloud synced" : "Offline — Working Locally"}</span>
          </div>
          {pending > 0 && (
            <div data-testid="pending-sync" className="text-xs px-2.5 py-1.5 rounded-full bg-sky-50 text-sky-700 font-medium">
              {pending} bill(s) to sync
            </div>
          )}
        </header>
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full animate-[fadeIn_.25s_ease-out]">{children}</main>
      </div>
    </div>
  );
};

export default Layout;
