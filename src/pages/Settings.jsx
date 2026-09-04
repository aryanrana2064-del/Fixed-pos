import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

export default function Settings() {
  const { settings, saveSettings, meta } = useApp();
  const [f, setF] = useState(settings || {});

  const save = async (e) => {
    e.preventDefault();
    try {
      await saveSettings({
        ...f,
        defaultTax: Number(f.defaultTax) || 0,
        minStock: Number(f.minStock) || 0,
        customUnits: f.customUnits || [],
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Could not save settings. Please check your connection.");
    }
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => setF({ ...f, logo: r.result });
    r.readAsDataURL(file);
  };

  const Section = ({ title, children }) => (
    <div className="card p-4 space-y-3">
      <h3 className="font-semibold text-sm uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
  const F = ({ label, children }) => (
    <label className="block"><span className="text-xs text-slate-500">{label}</span><div className="mt-1">{children}</div></label>
  );

  return (
    <form onSubmit={save} className="space-y-4 max-w-3xl" data-testid="settings-page">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Business">
        <F label="Business Name"><input data-testid="set-business" value={f.businessName || ""} onChange={(e) => setF({ ...f, businessName: e.target.value })} className="inp" /></F>
        <F label="Business Type">
          <select data-testid="set-business-type" value={f.businessType || "General Retail"} onChange={(e) => setF({ ...f, businessType: e.target.value })} className="inp">
            {(meta?.businessTypes || ["General Retail"]).map((t) => <option key={t}>{t}</option>)}
          </select>
        </F>
        <F label="Phone"><input data-testid="set-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="inp" /></F>
        <F label="Address"><input data-testid="set-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} className="inp" /></F>
        <F label="GSTIN"><input data-testid="set-gst" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} className="inp" /></F>
        <F label="Logo"><input data-testid="set-logo" type="file" accept="image/*" onChange={onLogo} className="text-sm" /></F>
        {f.logo && <img src={f.logo} alt="logo" className="h-12 object-contain" />}
      </Section>

      <Section title="Billing">
        <F label="Invoice Prefix"><input data-testid="set-prefix" value={f.invoicePrefix} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value })} className="inp" /></F>
        <F label="Default Tax %"><input data-testid="set-tax" type="number" value={f.defaultTax} onChange={(e) => setF({ ...f, defaultTax: e.target.value })} className="inp" /></F>
        <F label="Default Payment Mode">
          <select data-testid="set-payment" value={f.defaultPayment} onChange={(e) => setF({ ...f, defaultPayment: e.target.value })} className="inp">
            {["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </F>
        <F label="Auto Print after bill">
          <label className="flex items-center gap-2 text-sm mt-2"><input data-testid="set-autoprint" type="checkbox" checked={!!f.autoPrint} onChange={(e) => setF({ ...f, autoPrint: e.target.checked })} /> {f.autoPrint ? "ON" : "OFF"}</label>
        </F>
        <F label="Receipt Width">
          <select data-testid="set-receipt" value={f.receiptWidth} onChange={(e) => setF({ ...f, receiptWidth: e.target.value })} className="inp">
            <option value="58mm">58mm Thermal</option><option value="80mm">80mm Thermal</option>
          </select>
        </F>
        <F label="UPI ID (for QR code on bill)">
          <input data-testid="set-upi" value={f.upiId || ""} placeholder="yourshop@upi"
            onChange={(e) => setF({ ...f, upiId: e.target.value.trim() })} className="inp" />
        </F>
      </Section>

      <Section title="Inventory">
        <F label="Default Minimum Stock"><input data-testid="set-minstock" type="number" value={f.minStock} onChange={(e) => setF({ ...f, minStock: e.target.value })} className="inp" /></F>
        <F label="Allow Negative Stock">
          <label className="flex items-center gap-2 text-sm mt-2"><input data-testid="set-negative" type="checkbox" checked={!!f.allowNegativeStock} onChange={(e) => setF({ ...f, allowNegativeStock: e.target.checked })} /> {f.allowNegativeStock ? "Allowed" : "Blocked"}</label>
        </F>
      </Section>

      <Section title="Barcode">
        <F label="Barcode Symbology"><input value="CODE 128" readOnly className="inp bg-slate-50" /></F>
        <F label="Label Size"><input value="48mm × 25mm (2 per row)" readOnly className="inp bg-slate-50" /></F>
      </Section>

      <Section title="Units">
        <F label="Custom Units (comma separated)">
          <input data-testid="set-custom-units" value={(f.customUnits || []).join(", ")}
            onChange={(e) => setF({ ...f, customUnits: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
            placeholder="e.g. Tola, Roll, Bundle" className="inp" />
        </F>
        <F label="Standard Units"><input value={(meta?.units || []).join(", ")} readOnly className="inp bg-slate-50" /></F>
      </Section>

      <button data-testid="save-settings" className="btn-gold px-6 py-3">Save Settings</button>
      <p className="text-xs text-slate-500">Backup &amp; Restore is available in <b>Import / Export</b>. User permissions in <b>Users</b>. License details in <b>License</b>.</p>
    </form>
  );
}
