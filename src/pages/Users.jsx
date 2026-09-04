import { useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

const ROLE_INFO = {
  Owner: "Full access including users, settings, license and data restore",
  Manager: "Products, Inventory, Sales, Purchases, Reports, price & stock changes, void bills",
  Cashier: "Quick Billing + Customers",
  Staff: "Restricted — Quick Billing only",
};

export default function Users() {
  const { user } = useApp();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setList(await api.get("/users")); } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.id) {
        const body = { name: form.name, role: form.role };
        if (form.password) body.password = form.password;
        await api.patch(`/users/${form.id}`, body);
      } else {
        await api.post("/users", { name: form.name, email: form.email, password: form.password, role: form.role });
      }
      setForm(null);
      await load();
      toast.success("Staff account saved");
    } catch (e2) { toast.error(apiError(e2)); } finally { setBusy(false); }
  };

  const toggle = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      await load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="space-y-4" data-testid="users-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff & Permissions</h1>
          <p className="text-sm text-slate-500">Each staff member signs in with their own email &amp; password</p>
        </div>
        <button data-testid="add-user-btn" onClick={() => setForm({ name: "", email: "", password: "", role: "Cashier" })} className="btn-gold">Add Staff</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr><th className="text-left p-3">Name</th><th className="text-left p-3">Email</th><th className="text-left p-3">Role</th><th className="text-left p-3 hidden lg:table-cell">Access</th><th className="p-3"></th></tr></thead>
          <tbody data-testid="users-table">
            {list.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${u.active ? "" : "opacity-50"}`}>
                <td className="p-3 font-medium">{u.name}{!u.active && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100">disabled</span>}</td>
                <td className="p-3">{u.email}</td>
                <td className="p-3">{u.role}</td>
                <td className="p-3 hidden lg:table-cell text-slate-500 text-xs">{ROLE_INFO[u.role]}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button data-testid={`edit-user-${u.name}`} onClick={() => setForm({ id: u.id, name: u.name, email: u.email, role: u.role, password: "" })} className="border rounded px-2 py-1 text-xs">Edit</button>
                  {u.email !== user?.email && (
                    <button data-testid={`toggle-user-${u.name}`} onClick={() => toggle(u)} className="border rounded px-2 py-1 text-xs ml-1 text-rose-600">{u.active ? "Disable" : "Enable"}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-bg">
          <form onSubmit={save} className="modal max-w-md space-y-3" data-testid="user-form">
            <h3 className="text-lg font-semibold">{form.id ? "Edit" : "New"} Staff Account</h3>
            <input data-testid="u-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name *" className="inp" />
            {!form.id && <input data-testid="u-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email *" className="inp" />}
            <input data-testid="u-password" type="password" required={!form.id} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={form.id ? "New password (leave blank to keep)" : "Password (min 6 chars) *"} className="inp" />
            <select data-testid="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="inp">
              {Object.keys(ROLE_INFO).map((r) => <option key={r}>{r}</option>)}
            </select>
            <p className="text-xs text-slate-500">{ROLE_INFO[form.role]}</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="btn-ghost">Cancel</button>
              <button data-testid="save-user" disabled={busy} className="btn-gold disabled:opacity-50">Save</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
