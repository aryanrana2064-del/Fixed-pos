
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiError, setToken } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Gem, LogOut, Plus, RefreshCw } from "lucide-react";

const PLANS = ["Trial", "Starter", "Pro", "Business", "Lifetime"];
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

export default function Admin() {
  const { user, logout } = useApp();
  const [licenses, setLicenses] = useState([]);
  const [shops, setShops] = useState([]);
  const [form, setForm] = useState({
    business: "",
    plan: "Starter",
    deviceLimit: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      setLicenses(await api.get("/admin/licenses"));
      setShops(await api.get("/admin/shops"));
    } catch (e) {
      toast.error(apiError(e));

      if (e?.response?.status === 401) {
        nav("/login");
      }
    }
  }, [nav]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e) => {
    e.preventDefault();

    if (!form.business.trim()) {
      return toast.error("Enter the business name");
    }

    setBusy(true);

    try {
      const lic = await api.post("/admin/licenses", {
        ...form,
        deviceLimit: form.deviceLimit
          ? Number(form.deviceLimit)
          : null,
      });

      toast.success(`License created: ${lic.key}`);

      setForm({
        business: "",
        plan: "Starter",
        deviceLimit: "",
        notes: "",
      });

      await load();
    } catch (e2) {
      toast.error(apiError(e2));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (key, body) => {
    try {
      await api.patch("/admin/licenses", {
        key,
        ...body,
      });

      toast.success("License updated");
      await load();
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const signOut = async () => {
    await logout();
    setToken("");
    nav("/login");
  };

  return (
    <div
      className="min-h-screen bg-[#f6f7f9]"
      data-testid="admin-page"
    >
      <header className="bg-[#1e3a8a] text-white px-5 py-4 flex items-center gap-3">
        <Gem className="text-[#16a34a]" size={20} />

        <div>
          <div className="font-semibold">
            VYRO VX7 — License Admin
          </div>

          <div className="text-[11px] text-slate-400">
            {user?.email}
          </div>
        </div>

        <button
          onClick={load}
          className="ml-auto text-sm flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2"
          data-testid="admin-refresh"
        >
          <RefreshCw size={14} />
          Refresh
        </button>

        <button
          onClick={signOut}
          className="text-sm flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2"
          data-testid="admin-logout"
        >
          <LogOut size={14} />
          Logout
        </button>
      </header>

      <main className="p-5 max-w-[1300px] mx-auto space-y-5">
        <form
          onSubmit={create}
          className="card p-4 grid sm:grid-cols-5 gap-3 items-end"
          data-testid="create-license-form"
        >
          <label className="block sm:col-span-2">
            <span className="text-xs text-slate-500">
              Business name *
            </span>

            <input
              data-testid="lic-business"
              value={form.business}
              onChange={(e) =>
                setForm({
                  ...form,
                  business: e.target.value,
                })
              }
              className="inp mt-1"
              placeholder="Customer's shop name"
            />
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">
              Plan
            </span>

            <select
              data-testid="lic-plan"
              value={form.plan}
              onChange={(e) =>
                setForm({
                  ...form,
                  plan: e.target.value,
                })
              }
              className="inp mt-1"
            >
              {PLANS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">
              Device limit
            </span>

            <input
              data-testid="lic-devices"
              type="number"
              value={form.deviceLimit}
              onChange={(e) =>
                setForm({
                  ...form,
                  deviceLimit: e.target.value,
                })
              }
              className="inp mt-1"
              placeholder="auto"
            />
          </label>

          <button
            data-testid="lic-create"
            disabled={busy}
            className="btn-gold justify-center disabled:opacity-50"
          >
            <Plus size={15} />
            Create Key
          </button>
        </form>

        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold">
            Licenses ({licenses.length})
          </div>

          <table className="w-full text-sm">
            <thead className="th">
              <tr>
                <th className="text-left p-3">Key</th>
                <th className="text-left p-3">Business</th>
                <th className="text-left p-3">Plan</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Expiry</th>
                <th className="text-right p-3">Devices</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>

            <tbody data-testid="licenses-table">
              {licenses.map((l) => (
                <tr
                  key={l.key}
                  className="border-t border-slate-100"
                  data-testid={`lic-row-${l.key}`}
                >
                  <td className="p-3 font-mono text-xs font-semibold">
                    {l.key}
                  </td>

                  <td className="p-3">
                    {l.shopName || l.business}

                    {l.shopId ? (
                      <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        in use
                      </span>
                    ) : (
                      <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        unused
                      </span>
                    )}
                  </td>

                  <td className="p-3">
                    {l.plan}
                  </td>

                  <td
                    className={`p-3 font-medium ${
                      l.status === "Active"
                        ? "text-emerald-600"
                        : "text-rose-600"
                    }`}
                  >
                    {l.status}
                  </td>

                  <td className="p-3 text-xs">
                    {new Date(l.expiry).toLocaleDateString(
                      "en-IN"
                    )}
                  </td>

                  <td className="p-3 text-right tabular-nums">
                    {(l.devices || []).length}/{l.deviceLimit}
                  </td>

                  <td className="p-3 whitespace-nowrap text-right">
                    <button
                      data-testid={`extend-${l.key}`}
                      onClick={() =>
                        patch(l.key, {
                          extendDays: 30,
                        })
                      }
                      className="border rounded px-2 py-1 text-xs"
                    >
                      +30d
                    </button>

                    <select
                      data-testid={`plan-${l.key}`}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          patch(l.key, {
                            plan: e.target.value,
                          });
                        }
                      }}
                      className="border rounded px-1 py-1 text-xs ml-1"
                    >
                      <option value="">
                        Plan…
                      </option>

                      {PLANS.map((p) => (
                        <option
                          key={p}
                          value={p}
                        >
                          {p}
                        </option>
                      ))}
                    </select>

                    {l.status === "Revoked" ? (
                      <button
                        data-testid={`activate-${l.key}`}
                        onClick={() =>
                          patch(l.key, {
                            status: "Active",
                          })
                        }
                        className="border rounded px-2 py-1 text-xs ml-1 text-emerald-700"
                      >
                        Activate
                      </button>
                    ) : (
                      <button
                        data-testid={`revoke-${l.key}`}
                        onClick={() =>
                          patch(l.key, {
                            status: "Revoked",
                          })
                        }
                        className="border rounded px-2 py-1 text-xs ml-1 text-rose-600"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {!licenses.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-8 text-center text-slate-400"
                  >
                    No licenses yet — create one above
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-100 text-sm font-semibold">
            Shops ({shops.length})
          </div>

          <table className="w-full text-sm">
            <thead className="th">
              <tr>
                <th className="text-left p-3">Shop</th>
                <th className="text-left p-3">Phone</th>
                <th className="text-left p-3">Plan</th>
                <th className="text-right p-3">Users</th>
                <th className="text-right p-3">Products</th>
                <th className="text-right p-3">Bills</th>
                <th className="text-left p-3">Key</th>
              </tr>
            </thead>

            <tbody data-testid="shops-table">
              {shops.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-slate-100"
                >
                  <td className="p-3 font-medium">
                    {s.businessName}
                  </td>

                  <td className="p-3">
                    {s.phone}
                  </td>

                  <td className="p-3">
                    {s.plan}
                  </td>

                  <td className="p-3 text-right tabular-nums">
                    {s.users}
                  </td>

                  <td className="p-3 text-right tabular-nums">
                    {s.products}
                  </td>

                  <td className="p-3 text-right tabular-nums">
                    {s.sales}
                  </td>

                  <td className="p-3 font-mono text-xs">
                    {s.licenseKey}
                  </td>
                </tr>
              ))}

              {!shops.length && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-8 text-center text-slate-400"
                  >
                    No shops registered yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
