import { useEffect, useState } from "react";
import { all } from "@/lib/db";
import { completePurchase, money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export default function Purchases() {
  const { user, refresh } = useApp();
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [tax, setTax] = useState(18);
  const [paid, setPaid] = useState(0);
  const [rows, setRows] = useState([{ productId: "", qty: 1, price: 0 }]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setProducts(await all("products"));
    setSuppliers(await all("suppliers"));
    setList((await all("purchases")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };
  useEffect(() => { load(); }, []);

  const subtotal = rows.reduce((s, r) => s + Number(r.qty || 0) * Number(r.price || 0), 0);
  const total = +(subtotal * (1 + Number(tax || 0) / 100)).toFixed(2);

  const submit = async () => {
    if (busy) return;
    const items = rows
      .filter((r) => r.productId && Number(r.qty) > 0)
      .map((r) => {
        const p = products.find((x) => x.id === r.productId);
        return { productId: r.productId, name: p.name, code: p.code, qty: Number(r.qty), price: Number(r.price) };
      });
    if (!items.length) return toast.error("Add at least one product");
    if (!supplierId) return toast.error("Select a supplier");
    if (rows.some((r) => !r.productId || Number(r.qty) <= 0)) return toast.error("Select a product and quantity for every row");
    setBusy(true);
    try {
      const pur = await completePurchase({ supplierId, supplierInvoice: invoice, items, taxPercent: Number(tax || 0), paid: Number(paid || 0) });
      toast.success(`Purchase ${pur.purchaseNo} saved · stock updated`);
      setOpen(false);
      setRows([{ productId: "", qty: 1, price: 0 }]);
      setInvoice(""); setPaid(0); setSupplierId("");
      await load();
      refresh();
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="purchases-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Purchases</h1>
        <button data-testid="new-purchase-btn" onClick={() => setOpen(true)} className="btn-gold"><Plus size={15} /> New Purchase</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr>
            <th className="text-left p-3">No</th><th className="text-left p-3">Supplier</th><th className="text-left p-3 hidden sm:table-cell">Bill</th>
            <th className="text-left p-3">Date</th><th className="text-right p-3">Total</th><th className="text-right p-3">Paid</th><th className="text-right p-3">Due</th></tr></thead>
          <tbody data-testid="purchases-table">
            {list.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3 font-medium">{p.purchaseNo}</td><td className="p-3">{p.supplierName || "—"}</td>
                <td className="p-3 hidden sm:table-cell text-slate-500">{p.supplierInvoice}</td>
                <td className="p-3 text-xs text-slate-500">{new Date(p.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="p-3 text-right tabular-nums">{money(p.total)}</td>
                <td className="p-3 text-right tabular-nums">{money(p.paid)}</td>
                <td className="p-3 text-right tabular-nums text-red-600">{money(p.due)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="p-8 text-center text-slate-400">No purchases yet</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-bg">
          <div className="modal max-w-2xl space-y-3" data-testid="purchase-form">
            <h3 className="text-lg font-semibold">New Purchase</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <select data-testid="p-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="inp">
                <option value="">Select supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input data-testid="p-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Supplier bill no" className="inp" />
              <input data-testid="p-tax" type="number" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="Tax %" className="inp" />
            </div>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select data-testid={`p-item-${i}`} value={r.productId} onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setRows(rows.map((x, j) => (j === i ? { ...x, productId: e.target.value, price: p ? p.purchasePrice : 0 } : x)));
                  }} className="inp flex-1">
                    <option value="">Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{`${p.name} (${p.stock})`}</option>)}
                  </select>
                  <input data-testid={`p-qty-${i}`} type="number" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="inp w-20" />
                  <input data-testid={`p-price-${i}`} type="number" value={r.price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} className="inp w-24" />
                  <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-red-500 p-1"><Trash2 size={16} /></button>
                </div>
              ))}
              <button data-testid="p-add-row" onClick={() => setRows([...rows, { productId: "", qty: 1, price: 0 }])} className="border rounded-lg px-3 py-2 text-sm">+ Add Item</button>
            </div>
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{money(subtotal)}</span></div>
            <div className="flex justify-between font-semibold"><span>Total (incl. tax)</span><span className="tabular-nums" data-testid="p-total">{money(total)}</span></div>
            <input data-testid="p-paid" type="number" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="Paid amount" className="inp" />
            <div className="flex justify-end gap-2">
              <button data-testid="p-cancel" onClick={() => setOpen(false)} className="btn-ghost">Cancel</button>
              <button data-testid="p-save" disabled={busy} onClick={submit} className="btn-gold disabled:opacity-50">Save Purchase</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
