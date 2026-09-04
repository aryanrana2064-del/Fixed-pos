import { useEffect, useState } from "react";
import { all, put, uid, nowISO } from "@/lib/db";
import { recordCustomerPayment, money, log } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Plus } from "lucide-react";

const empty = { name: "", phone: "", address: "", openingBalance: 0 };

export default function Customers() {
  const { user, refresh } = useApp();
  const [list, setList] = useState([]);
  const [sales, setSales] = useState([]);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState(null);
  const [sel, setSel] = useState(null);
  const [pay, setPay] = useState({ amount: "", mode: "Cash" });

  const load = async () => {
    setList(await all("customers"));
    setSales(await all("sales"));
    setPayments(await all("payments"));
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Customer name is required");
    try {
      await put("customers", { ...form, openingBalance: Number(form.openingBalance || 0) });
      setForm(null);
      await load();
      refresh();
      toast.success("Customer saved");
    } catch (e2) {
      toast.error(apiError(e2));
    }
  };

  const submitPayment = async () => {
    const amt = Number(pay.amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    try {
      await recordCustomerPayment({ customerId: sel.id, amount: amt, mode: pay.mode });
      setPay({ amount: "", mode: "Cash" });
      await load();
      refresh();
      const fresh = (await all("customers")).find((c) => c.id === sel.id);
      setSel(fresh);
      toast.success("Payment recorded");
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const ledger = (c) => {
    const rows = [];
    if (c.openingBalance) rows.push({ date: c.createdAt, type: "Opening Balance", debit: c.openingBalance, credit: 0 });
    sales.filter((s) => s.customerId === c.id).forEach((s) => rows.push({ date: s.createdAt, type: `Sale ${s.invoiceNo}`, debit: s.total, credit: s.paid }));
    payments.filter((p) => p.partyId === c.id && p.refType === "receipt").forEach((p) => rows.push({ date: p.createdAt, type: `Payment (${p.mode})`, debit: 0, credit: p.amount }));
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  };

  return (
    <div className="space-y-4" data-testid="customers-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Customers &amp; Khata</h1>
        <button data-testid="add-customer-btn" onClick={() => setForm({ ...empty })} className="btn-gold"><Plus size={15} /> Add Customer</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr>
            <th className="text-left p-3">Name</th><th className="text-left p-3">Phone</th>
            <th className="text-left p-3 hidden sm:table-cell">Address</th><th className="text-right p-3">Outstanding</th><th className="p-3"></th></tr></thead>
          <tbody data-testid="customers-table">
            {list.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-medium">{c.name}</td><td className="p-3">{c.phone}</td>
                <td className="p-3 hidden sm:table-cell text-slate-500">{c.address}</td>
                <td className={`p-3 text-right tabular-nums font-semibold ${Number(c.balance) > 0 ? "text-red-600" : "text-emerald-700"}`} data-testid={`balance-${c.name}`}>{money(c.balance)}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button data-testid={`khata-${c.name}`} onClick={() => setSel(c)} className="border rounded px-2 py-1 text-xs">Khata</button>
                  <button data-testid={`edit-cust-${c.name}`} onClick={() => setForm(c)} className="border rounded px-2 py-1 text-xs ml-1">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-bg">
          <form onSubmit={save} className="modal max-w-md space-y-3" data-testid="customer-form">
            <h3 className="text-lg font-semibold">{form.id ? "Edit" : "New"} Customer</h3>
            <input data-testid="c-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name *" className="inp" />
            <input data-testid="c-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="inp" />
            <input data-testid="c-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" className="inp" />
            {!form.id && <input data-testid="c-opening" type="number" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} placeholder="Opening Balance" className="inp" />}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="border rounded-lg px-4 py-2.5 text-sm">Cancel</button>
              <button data-testid="save-customer" className="bg-[#16a34a] font-semibold rounded-lg px-5 py-2.5 text-sm">Save</button>
            </div>
          </form>
        </div>
      )}

      {sel && (
        <div className="modal-bg">
          <div className="modal max-w-xl" data-testid="khata-panel">
            <h3 className="text-lg font-semibold">{sel.name} — Khata</h3>
            <p className="text-sm text-slate-500">{sel.phone} · Outstanding <b className="text-red-600">{money(sel.balance)}</b></p>
            <div className="mt-3 border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left p-2">Date</th><th className="text-left p-2">Particulars</th><th className="text-right p-2">Debit</th><th className="text-right p-2">Credit</th></tr></thead>
                <tbody>
                  {ledger(sel).map((r, i) => (
                    <tr key={i} className="border-t"><td className="p-2 text-xs">{new Date(r.date).toLocaleDateString("en-IN")}</td><td className="p-2">{r.type}</td>
                      <td className="p-2 text-right tabular-nums">{r.debit ? money(r.debit) : "—"}</td><td className="p-2 text-right tabular-nums">{r.credit ? money(r.credit) : "—"}</td></tr>
                  ))}
                  {!ledger(sel).length && <tr><td colSpan={4} className="p-6 text-center text-slate-400">No entries</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <input data-testid="pay-amount" type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="Payment amount" className="inp flex-1 min-w-[140px]" />
              <select data-testid="pay-mode" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })} className="inp w-28">
                {["Cash", "UPI", "Card", "Other"].map((m) => <option key={m}>{m}</option>)}
              </select>
              <button data-testid="record-payment" onClick={submitPayment} className="btn-gold">Receive</button>
              <button data-testid="close-khata" onClick={() => setSel(null)} className="btn-ghost">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
