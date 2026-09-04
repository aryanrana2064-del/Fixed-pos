import { useEffect, useState } from "react";
import { all, put, uid, nowISO } from "@/lib/db";
import { money, log } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export default function Suppliers() {
  const { user } = useApp();
  const [list, setList] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [form, setForm] = useState(null);

  const load = async () => {
    setList(await all("suppliers"));
    setPurchases(await all("purchases"));
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Supplier name required");
    try {
      await put("suppliers", { ...form, openingBalance: Number(form.openingBalance || 0) });
      setForm(null);
      await load();
      toast.success("Supplier saved");
    } catch (e2) {
      toast.error(apiError(e2));
    }
  };

  return (
    <div className="space-y-4" data-testid="suppliers-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
        <button data-testid="add-supplier-btn" onClick={() => setForm({ name: "", phone: "", address: "" })} className="btn-gold"><Plus size={15} /> Add Supplier</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr>
            <th className="text-left p-3">Name</th><th className="text-left p-3">Phone</th>
            <th className="text-right p-3">Purchases</th><th className="text-right p-3">Outstanding</th><th className="p-3"></th></tr></thead>
          <tbody data-testid="suppliers-table">
            {list.map((s) => {
              const ps = purchases.filter((p) => p.supplierId === s.id);
              return (
                <tr key={s.id} className="border-t">
                  <td className="p-3 font-medium">{s.name}</td><td className="p-3">{s.phone}</td>
                  <td className="p-3 text-right tabular-nums">{money(ps.reduce((a, b) => a + b.total, 0))} <span className="text-slate-400 text-xs">({ps.length})</span></td>
                  <td className="p-3 text-right tabular-nums text-red-600">{money(s.balance)}</td>
                  <td className="p-3 text-right"><button data-testid={`edit-sup-${s.name}`} onClick={() => setForm(s)} className="border rounded px-2 py-1 text-xs">Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {form && (
        <div className="modal-bg">
          <form onSubmit={save} className="modal max-w-md space-y-3" data-testid="supplier-form">
            <h3 className="text-lg font-semibold">{form.id ? "Edit" : "New"} Supplier</h3>
            <input data-testid="s-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name *" className="inp" />
            <input data-testid="s-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" className="inp" />
            <input data-testid="s-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Address" className="inp" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="border rounded-lg px-4 py-2.5 text-sm">Cancel</button>
              <button data-testid="save-supplier" className="bg-[#16a34a] font-semibold rounded-lg px-5 py-2.5 text-sm">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
