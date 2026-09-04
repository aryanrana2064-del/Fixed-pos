import { useEffect, useState } from "react";
import { all } from "@/lib/db";
import { money, voidSale } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { printReceipt, printInvoiceA4 } from "@/lib/print";
import { exportRowsCsv } from "@/lib/csv";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Ban, Printer, Eye, Download } from "lucide-react";

const REASONS = ["Wrong item billed", "Wrong price / quantity", "Customer cancelled", "Duplicate bill", "Payment failed", "Other"];

export default function Sales() {
  const { settings, user, can, refresh } = useApp();
  const [list, setList] = useState([]);
  const [sel, setSel] = useState(null);
  const [voidFor, setVoidFor] = useState(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => setList((await all("sales")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  useEffect(() => { load(); }, []);

  const doVoid = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await voidSale({ saleId: voidFor.id, reason: note.trim() ? `${reason} — ${note.trim()}` : reason });
      setVoidFor(null);
      setNote("");
      await load();
      refresh();
      toast.success("Bill voided · stock restored");
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  const active = list.filter((s) => s.status !== "void");

  return (
    <div className="space-y-5" data-testid="sales-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="text-sm text-slate-500">{active.length} valid bills · {money(active.reduce((s, x) => s + x.total, 0))} total</p>
        </div>
        <button data-testid="export-sales" onClick={() => exportRowsCsv("sales.csv", list.map(({ items, payments, ...s }) => s))} className="btn-ghost"><Download size={15} /> Export CSV</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr>
            <th className="text-left p-3">Invoice</th><th className="text-left p-3">Customer</th><th className="text-left p-3">Date</th>
            <th className="text-right p-3">Total</th><th className="text-right p-3">Paid</th><th className="text-right p-3">Due</th><th className="p-3"></th></tr></thead>
          <tbody data-testid="sales-table">
            {list.map((s) => (
              <tr key={s.id} className={`border-t border-slate-100 hover:bg-slate-50/70 ${s.status === "void" ? "opacity-60" : ""}`} data-testid={`sale-row-${s.invoiceNo}`}>
                <td className="p-3 font-medium">
                  {s.invoiceNo}
                  {s.status === "void" && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold" data-testid={`void-badge-${s.invoiceNo}`}>VOID</span>}
                  {s.status === "void" && <div className="text-[11px] text-slate-400">{s.voidReason} · by {s.voidedBy}</div>}
                </td>
                <td className="p-3">{s.customerName || "Walk-in"}</td>
                <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{new Date(s.createdAt).toLocaleString("en-IN")}</td>
                <td className="p-3 text-right tabular-nums">{s.status === "void" ? <span className="line-through text-slate-400">{money(s.originalTotal)}</span> : money(s.total)}</td>
                <td className="p-3 text-right tabular-nums">{money(s.paid)}</td>
                <td className="p-3 text-right tabular-nums text-rose-600">{money(s.due)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button data-testid={`view-${s.invoiceNo}`} onClick={() => setSel(s)} className="icon-btn" title="View"><Eye size={15} /></button>
                  <button data-testid={`print-${s.invoiceNo}`} onClick={() => printReceipt(s, settings)} className="icon-btn" title="Print"><Printer size={15} /></button>
                  {s.status !== "void" && can("void_bill") && (
                    <button data-testid={`void-${s.invoiceNo}`} onClick={() => setVoidFor(s)} className="icon-btn text-rose-600" title="Void bill"><Ban size={15} /></button>
                  )}
                </td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="p-10 text-center text-slate-400">No sales yet</td></tr>}
          </tbody>
        </table>
      </div>

      {voidFor && (
        <div className="modal-bg">
          <div className="modal max-w-md" data-testid="void-dialog">
            <h3 className="text-lg font-semibold">Void bill {voidFor.invoiceNo}?</h3>
            <p className="text-sm text-slate-500 mt-1">
              {money(voidFor.originalTotal || voidFor.total)} · {voidFor.customerName || "Walk-in"}. Stock of {voidFor.items.length} item(s) will be returned to inventory
              {voidFor.customerId && voidFor.due > 0 ? " and the customer's outstanding will be reduced" : ""}. The bill is kept with a VOID mark — nothing is deleted.
            </p>
            <label className="block mt-4"><span className="text-xs text-slate-500">Reason *</span>
              <select data-testid="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="inp mt-1">
                {REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="block mt-3"><span className="text-xs text-slate-500">Note (optional)</span>
              <input data-testid="void-note" value={note} onChange={(e) => setNote(e.target.value)} className="inp mt-1" placeholder="Any extra detail" />
            </label>
            <div className="flex justify-end gap-2 mt-5">
              <button data-testid="void-cancel" onClick={() => setVoidFor(null)} className="btn-ghost">Cancel</button>
              <button data-testid="void-confirm" disabled={busy} onClick={doVoid} className="bg-rose-600 text-white font-semibold rounded-lg px-5 py-2.5 text-sm disabled:opacity-50">Void Bill & Restore Stock</button>
            </div>
          </div>
        </div>
      )}

      {sel && (
        <div className="modal-bg">
          <div className="modal max-w-lg" data-testid="sale-detail">
            <h3 className="text-lg font-semibold">{sel.invoiceNo} {sel.status === "void" && <span className="text-sm text-rose-600">(VOID)</span>}</h3>
            <p className="text-sm text-slate-500">{sel.customerName || "Walk-in"} · {new Date(sel.createdAt).toLocaleString("en-IN")}</p>
            <div className="mt-3 divide-y divide-slate-100 text-sm">
              {sel.items.map((i) => (
                <div key={i.productId} className="flex justify-between py-2"><span>{i.name} × {i.qty}</span><span className="tabular-nums">{money(i.price * i.qty)}</span></div>
              ))}
            </div>
            <div className="mt-3 space-y-1 text-sm border-t border-slate-100 pt-3">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums">{money(sel.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="tabular-nums">-{money(sel.discount)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Tax</span><span className="tabular-nums">{money(sel.tax)}</span></div>
              <div className="flex justify-between font-semibold text-base"><span>Total</span><span className="tabular-nums">{money(sel.status === "void" ? sel.originalTotal : sel.total)}</span></div>
              {sel.status === "void" && <div className="text-xs text-rose-600">Voided by {sel.voidedBy} · {sel.voidReason}</div>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => printInvoiceA4(sel, settings)} className="btn-ghost">A4 Invoice</button>
              <button data-testid="close-detail" onClick={() => setSel(null)} className="btn-dark">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
