import { useEffect, useState } from "react";
import { all } from "@/lib/db";
import { adjustStock, money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { exportRowsCsv } from "@/lib/csv";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

export default function Inventory() {
  const { user, can, refresh, settings } = useApp();
  const [products, setProducts] = useState([]);
  const [moves, setMoves] = useState([]);
  const [tab, setTab] = useState("stock");
  const [adj, setAdj] = useState({ productId: "", qty: 1, type: "in", reason: "Manual Adjustment" });

  const load = async () => {
    setProducts(await all("products"));
    setMoves((await all("movements")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!can("stock_adjust")) return toast.error("Permission required for stock adjustment.");
    if (!adj.productId) return toast.error("Select a product");
    try {
      await adjustStock({ ...adj, qty: Number(adj.qty) });
      await load();
      refresh();
      toast.success("Stock adjusted");
    } catch (e2) {
      toast.error(apiError(e2));
    }
  };

  const low = products.filter((p) => p.stock <= (p.minStock ?? settings.minStock));

  return (
    <div className="space-y-4" data-testid="inventory-page">
      <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
      <div className="flex gap-2 flex-wrap">
        {[["stock", "Current Stock"], ["moves", "Stock Movements"], ["low", `Low Stock (${low.length})`], ["adjust", "Adjust Stock"]].map(([k, l]) => (
          <button key={k} data-testid={`tab-${k}`} onClick={() => setTab(k)} className={`px-3.5 py-2 rounded-lg text-sm border transition-all ${tab === k ? "bg-[#1e3a8a] text-white border-[#1e3a8a]" : "bg-white border-slate-300 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>

      {tab === "adjust" && (
        <form onSubmit={submit} className="card p-4 grid sm:grid-cols-4 gap-3 items-end">
          <label className="block"><span className="text-xs text-slate-500">Product</span>
            <select data-testid="adj-product" value={adj.productId} onChange={(e) => setAdj({ ...adj, productId: e.target.value })} className="inp mt-1">
              <option value="">Select…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{`${p.name} (${p.stock})`}</option>)}
            </select>
          </label>
          <label className="block"><span className="text-xs text-slate-500">Quantity</span>
            <input data-testid="adj-qty" type="number" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} className="inp mt-1" />
          </label>
          <label className="block"><span className="text-xs text-slate-500">Type</span>
            <select data-testid="adj-type" value={adj.type} onChange={(e) => setAdj({ ...adj, type: e.target.value })} className="inp mt-1">
              <option value="in">Stock In</option><option value="out">Stock Out</option>
            </select>
          </label>
          <label className="block"><span className="text-xs text-slate-500">Reason</span>
            <select data-testid="adj-reason" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} className="inp mt-1">
              {["Manual Adjustment", "Opening Stock", "Damaged Stock", "Lost", "Found"].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <button data-testid="adj-submit" className="btn-gold sm:col-span-4 justify-center">Apply Adjustment</button>
        </form>
      )}

      {(tab === "stock" || tab === "low") && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="th"><tr>
              <th className="text-left p-3">Code</th><th className="text-left p-3">Product</th>
              <th className="text-right p-3">Stock</th><th className="text-right p-3">Min</th>
              <th className="text-right p-3">Value</th><th className="text-left p-3 hidden sm:table-cell">Rack</th></tr></thead>
            <tbody data-testid="stock-table">
              {(tab === "low" ? low : products).map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{p.code}</td><td className="p-3">{p.name}</td>
                  <td className={`p-3 text-right tabular-nums font-semibold ${p.stock <= p.minStock ? "text-red-600" : ""}`}>{p.stock}</td>
                  <td className="p-3 text-right tabular-nums text-slate-500">{p.minStock}</td>
                  <td className="p-3 text-right tabular-nums">{money(p.stock * p.purchasePrice)}</td>
                  <td className="p-3 hidden sm:table-cell text-slate-500">{p.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "moves" && (
        <>
          <button data-testid="export-moves" onClick={() => exportRowsCsv("stock-movements.csv", moves)} className="border rounded-lg px-3 py-2 text-sm bg-white">Export CSV</button>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="th"><tr>
                <th className="text-left p-3">Date</th><th className="text-left p-3">Product</th><th className="text-left p-3">Type</th>
                <th className="text-right p-3">Qty</th><th className="text-right p-3">Prev</th><th className="text-right p-3">New</th><th className="text-left p-3 hidden sm:table-cell">User</th></tr></thead>
              <tbody data-testid="movements-table">
                {moves.slice(0, 100).map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="p-3 text-xs text-slate-500">{new Date(m.createdAt).toLocaleString("en-IN")}</td>
                    <td className="p-3">{m.productName}</td>
                    <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${m.type === "in" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{m.reason}</span></td>
                    <td className="p-3 text-right tabular-nums">{m.type === "in" ? "+" : "-"}{m.qty}</td>
                    <td className="p-3 text-right tabular-nums text-slate-500">{m.prevStock}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{m.newStock}</td>
                    <td className="p-3 hidden sm:table-cell text-slate-500">{m.user}</td>
                  </tr>
                ))}
                {!moves.length && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No movements yet</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
