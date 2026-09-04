import { useEffect, useState } from "react";
import { dashboardStats, money } from "@/lib/ops";
import { useApp } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, CartesianGrid } from "recharts";
import { TrendingUp, ShoppingBag, IndianRupee, Package, Layers, Wallet, AlertTriangle, Users, Receipt, Truck } from "lucide-react";

const Card = ({ label, value, icon: Icon, tone = "slate", testid }) => (
  <div data-testid={testid} className="card p-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
    <div className="flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-wide font-medium text-slate-500">{label}</span>
      <Icon size={16} className={`text-${tone}-500`} />
    </div>
    <div className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
  </div>
);

const Panel = ({ title, children, action }) => (
  <div className="card h-full">
    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {action}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

export default function Dashboard() {
  const { tick, shop } = useApp();
  const [s, setS] = useState(null);
  const nav = useNavigate();

  useEffect(() => { dashboardStats().then((d) => d && setS(d)).catch(() => {}); }, [tick]);
  if (!s) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-5" data-testid="dashboard">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500">{shop?.businessName}{shop?.businessType ? ` · ${shop.businessType}` : ""} · {new Date().toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
        </div>
        <div className="flex gap-2">
          <button data-testid="dash-day-close" onClick={() => nav("/day-close")} className="btn-ghost">Day Closing</button>
          <button data-testid="dash-new-bill" onClick={() => nav("/billing")} className="btn-gold">⚡ New Bill</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <Card testid="stat-today-sales" label="Today's Sales" value={money(s.todaySales)} icon={TrendingUp} tone="emerald" />
        <Card testid="stat-today-purchases" label="Today's Purchases" value={money(s.todayPurchases)} icon={ShoppingBag} tone="blue" />
        <Card testid="stat-today-profit" label="Today's Profit" value={money(s.todayProfit)} icon={IndianRupee} tone="amber" />
        <Card testid="stat-products" label="Total Products" value={s.totalProducts} icon={Package} />
        <Card testid="stat-units" label="Total Stock Units" value={s.totalUnits} icon={Layers} />
        <Card testid="stat-stock-value" label="Stock Value" value={money(s.stockValue)} icon={Wallet} />
        <Card testid="stat-low-stock" label="Low Stock" value={s.lowStockCount} icon={AlertTriangle} tone="red" />
        <Card testid="stat-customers" label="Customers" value={s.customers} icon={Users} />
        <Card testid="stat-outstanding" label="Customer Outstanding" value={money(s.outstanding)} icon={Receipt} tone="red" />
        <Card testid="stat-supplier-outstanding" label="Supplier Outstanding" value={money(s.supplierOutstanding || 0)} icon={Truck} tone="blue" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Panel title="Sales Overview (last 7 days)">
            <div className="grid grid-cols-3 gap-3 mb-4 text-center">
              <div><div className="text-xs text-slate-500">Today</div><div className="font-semibold tabular-nums">{money(s.todaySales)}</div></div>
              <div><div className="text-xs text-slate-500">Week</div><div className="font-semibold tabular-nums">{money(s.weekSales)}</div></div>
              <div><div className="text-xs text-slate-500">Month</div><div className="font-semibold tabular-nums">{money(s.monthSales)}</div></div>
            </div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={s.series}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="sales" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        <Panel title="Sales by Category">
          <div className="space-y-3" data-testid="category-sales">
            {(s.categorySales || []).length === 0 && <div className="text-slate-400 text-sm">No sales yet</div>}
            {(s.categorySales || []).map((c) => {
              const totalAll = (s.categorySales || []).reduce((a, b) => a + b.amount, 0) || 1;
              const pct = Math.round((c.amount / totalAll) * 100);
              return (
                <div key={c.category}>
                  <div className="flex justify-between text-sm"><span className="truncate pr-2">{c.category}</span><span className="tabular-nums">{money(c.amount)}</span></div>
                  <div className="h-2 bg-slate-100 rounded-full mt-1"><div className="h-2 rounded-full bg-[#1e3a8a]" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          <h4 className="text-xs font-semibold text-slate-500 mt-5 mb-2">TOP SELLING</h4>
          <div className="space-y-1.5 text-sm">
            {s.top.length === 0 && <div className="text-slate-400">No sales yet</div>}
            {s.top.map((t) => (
              <div key={t.name} className="flex justify-between"><span className="truncate pr-2">{t.name}</span><span className="tabular-nums text-slate-500">{t.qty}</span></div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Low Stock">
          <div className="space-y-1.5 text-sm" data-testid="low-stock-list">
            {s.lowStock.length === 0 && <div className="text-slate-400">All good</div>}
            {s.lowStock.map((p) => (
              <div key={p.id} className="flex justify-between"><span className="truncate pr-2">{p.name}</span><span className="text-red-600 tabular-nums">{p.stock}</span></div>
            ))}
          </div>
        </Panel>
        <Panel title="Recent Sales">
          <div className="space-y-1.5 text-sm" data-testid="recent-sales">
            {s.recentSales.map((x) => (
              <div key={x.id} className="flex justify-between"><span>{x.invoiceNo} · {x.customerName || "Walk-in"}</span><span className="tabular-nums">{money(x.total)}</span></div>
            ))}
            {!s.recentSales.length && <div className="text-slate-400">No sales yet</div>}
          </div>
        </Panel>
        <Panel title="Outstanding Customers">
          <div className="space-y-1.5 text-sm">
            {s.outstandingCustomers.map((c) => (
              <div key={c.id} className="flex justify-between"><span>{c.name}</span><span className="tabular-nums text-red-600">{money(c.balance)}</span></div>
            ))}
            {!s.outstandingCustomers.length && <div className="text-slate-400">Nothing pending</div>}
          </div>
        </Panel>
      </div>

      <Panel title="Recent Purchases">
        <div className="space-y-1.5 text-sm">
          {s.recentPurchases.map((x) => (
            <div key={x.id} className="flex justify-between"><span>{x.purchaseNo} · {x.supplierName || "—"}</span><span className="tabular-nums">{money(x.total)}</span></div>
          ))}
          {!s.recentPurchases.length && <div className="text-slate-400">No purchases yet</div>}
        </div>
      </Panel>
    </div>
  );
}
