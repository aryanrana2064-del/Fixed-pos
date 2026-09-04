import { useEffect, useState } from "react";
import { api, apiError, DEVICE_ID } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

const PLANS = [
  { plan: "Trial", price: "Free · 14 days", devices: 2 },
  { plan: "Starter", price: "₹299 / month", devices: 1 },
  { plan: "Pro", price: "₹599 / month", devices: 3 },
  { plan: "Business", price: "₹999 / month", devices: 10 },
  { plan: "Lifetime", price: "₹14,999 one-time", devices: 5 },
];

export default function License() {
  const { online, loadShop } = useApp();
  const [lic, setLic] = useState(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setLic(await api.get("/license")); } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const status = (() => {
    if (!lic) return "Not Activated";
    if (lic.status !== "Active") return lic.status;
    const days = Math.ceil((new Date(lic.expiry) - Date.now()) / 864e5);
    if (days < 0) return "Expired";
    if (days <= 7) return `Expiring in ${days} day(s)`;
    return "Active";
  })();

  const activate = async () => {
    if (!key.trim()) return toast.error("Enter your license key");
    setBusy(true);
    try {
      await api.post("/license/activate", { key: key.trim().toUpperCase(), deviceId: DEVICE_ID });
      setKey("");
      await load();
      await loadShop();
      toast.success("License activated");
    } catch (e) { toast.error(apiError(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="license-page">
      <h1 className="text-2xl font-semibold tracking-tight">License</h1>

      <div className="card p-4 space-y-2" data-testid="license-card">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500">Status</span>
          <span data-testid="license-status" className={`text-sm font-semibold ${status === "Active" ? "text-emerald-600" : status.startsWith("Expiring") ? "text-amber-600" : "text-rose-600"}`}>{status}</span>
        </div>
        {lic && (
          <div className="grid sm:grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500">Key:</span> <b className="font-mono">{lic.key}</b></div>
            <div><span className="text-slate-500">Business:</span> {lic.business}</div>
            <div><span className="text-slate-500">Plan:</span> {lic.plan}</div>
            <div><span className="text-slate-500">Devices:</span> {(lic.devices || []).length}/{lic.deviceLimit}</div>
            <div><span className="text-slate-500">Expiry:</span> {new Date(lic.expiry).toLocaleDateString("en-IN")}</div>
            <div><span className="text-slate-500">This device:</span> <span className="font-mono">{DEVICE_ID}</span></div>
          </div>
        )}
        <p className="text-xs text-slate-500 pt-2">
          Keys are generated and managed by the platform admin. Billing keeps working offline on this device even if the internet drops; your data is never deleted when a license expires.
          {!online && " You are offline — activation needs internet."}
        </p>
        <div className="flex gap-2 flex-wrap pt-2">
          <input data-testid="license-key-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="JBX-XXXX-XXXX-XXXX" className="inp flex-1 min-w-[200px] font-mono" />
          <button data-testid="activate-btn" disabled={busy} onClick={activate} className="btn-gold disabled:opacity-50">Activate Key</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr><th className="text-left p-3">Plan</th><th className="text-left p-3">Price</th><th className="text-right p-3">Devices</th></tr></thead>
          <tbody>
            {PLANS.map((p) => (
              <tr key={p.plan} className="border-t border-slate-100"><td className="p-3 font-medium">{p.plan}</td><td className="p-3">{p.price}</td><td className="p-3 text-right">{p.devices}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
