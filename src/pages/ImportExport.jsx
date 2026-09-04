import { useState } from "react";
import Papa from "papaparse";
import { api, apiError } from "@/lib/api";
import { all } from "@/lib/db";
import { sampleTemplate, parseCsv, downloadFile, exportProducts } from "@/lib/csv";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

const COLLECTIONS = ["products", "customers", "suppliers", "sales", "purchases", "returns", "movements", "payments", "activity", "users"];

export default function ImportExport() {
  const { refresh, shop } = useApp();
  const [rows, setRows] = useState(null);
  const [mode, setMode] = useState("skip");
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsed = await parseCsv(f);
      const existing = await all("products");
      const codes = new Map(existing.map((p) => [String(p.code).toUpperCase(), p]));
      const seen = new Set();
      setRows(parsed.map((r, i) => {
        const code = String(r["Product Code"] || "").trim().toUpperCase();
        const name = String(r["Product Name"] || "").trim();
        const errors = [];
        if (!code) errors.push("Missing Product Code");
        if (!name) errors.push("Missing Product Name");
        if (!r["Selling Price"] || Number.isNaN(Number(r["Selling Price"]))) errors.push("Invalid Selling Price");
        const dupInFile = code && seen.has(code);
        if (code) seen.add(code);
        return { row: i + 2, raw: r, code, name, errors, duplicateInFile: dupInFile, existing: codes.get(code) || null, valid: errors.length === 0 };
      }));
      setSummary(null);
    } catch {
      toast.error("Could not read the file. Please use the sample template.");
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const payload = rows.filter((c) => c.valid && !c.duplicateInFile).map((c) => ({
        code: c.code, name: c.name,
        category: String(c.raw["Category"] || "General").trim(),
        subcategory: String(c.raw["Subcategory"] || "").trim(),
        brand: String(c.raw["Brand"] || "").trim(),
        mrp: Number(c.raw["MRP"] || 0),
        purchasePrice: Number(c.raw["Purchase Price"] || 0),
        price: Number(c.raw["Selling Price"] || 0),
        stock: Number(c.raw["Stock Quantity"] || 0),
        minStock: Number(c.raw["Minimum Stock"] || 5),
        unit: String(c.raw["Unit"] || "Piece").trim(),
        barcode: String(c.raw["Barcode"] || "").trim(),
        supplier: String(c.raw["Supplier"] || "").trim(),
        location: String(c.raw["Location"] || "").trim(),
        gst: Number(c.raw["GST"] || 0),
      }));
      const s = await api.post("/products/import", { rows: payload, mode });
      const failedLocal = rows.length - payload.length;
      setSummary({ ...s, failed: s.failed + failedLocal });
      setRows(null);
      refresh();
      toast.success(`Import done · ${s.created} created, ${s.updated} updated`);
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  const backup = async () => {
    try {
      const data = {};
      for (const c of COLLECTIONS) data[c] = await all(c);
      downloadFile(`vyro-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify({ app: "VYRO VX7", version: 3, shop: shop?.businessName, exportedAt: new Date().toISOString(), data }, null, 2),
        "application/json");
      toast.success("Cloud backup downloaded");
    } catch (e) { toast.error(apiError(e)); }
  };

  const restore = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!["VYRO VX7", "JewelBox POS"].includes(json.app) || !json.data?.products) return toast.error("Invalid backup file");
      if (!window.confirm(`Restore ${json.data.products.length} products from this backup into your cloud account? Existing products with the same code will be updated. Nothing is deleted.`)) return;
      const s = await api.post("/products/import", { rows: json.data.products, mode: "update" });
      setSummary(s);
      refresh();
      toast.success(`Restored · ${s.created} created, ${s.updated} updated`);
    } catch (e2) { toast.error(apiError(e2, "Could not restore this file")); }
  };

  const stats = rows && {
    valid: rows.filter((c) => c.valid && !c.duplicateInFile && !c.existing).length,
    invalid: rows.filter((c) => !c.valid).length,
    duplicates: rows.filter((c) => c.existing || c.duplicateInFile).length,
  };

  return (
    <div className="space-y-4" data-testid="import-export-page">
      <h1 className="text-2xl font-semibold tracking-tight">Import / Export</h1>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Import Stock (CSV)</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <button data-testid="download-template" onClick={() => downloadFile("vyro-import-template.csv", sampleTemplate())} className="btn-ghost">Download Sample Template</button>
          <input data-testid="import-file" type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        </div>

        {rows && (
          <div className="space-y-3" data-testid="import-preview">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Valid new rows</div><div className="text-lg font-semibold text-emerald-600" data-testid="valid-count">{stats.valid}</div></div>
              <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Invalid rows</div><div className="text-lg font-semibold text-rose-600" data-testid="invalid-count">{stats.invalid}</div></div>
              <div className="border rounded-lg p-3"><div className="text-xs text-slate-500">Duplicates</div><div className="text-lg font-semibold text-amber-600" data-testid="dup-count">{stats.duplicates}</div></div>
            </div>
            <div className="border rounded-lg overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="th"><tr><th className="text-left p-2">Row</th><th className="text-left p-2">Code</th><th className="text-left p-2">Name</th><th className="text-left p-2">Status</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.row} className="border-t border-slate-100">
                      <td className="p-2">{c.row}</td><td className="p-2 font-mono">{c.code}</td><td className="p-2">{c.name}</td>
                      <td className="p-2">{!c.valid ? <span className="text-rose-600">{c.errors.join(", ")}</span> : c.duplicateInFile ? <span className="text-rose-600">Duplicate in file</span> : c.existing ? <span className="text-amber-600">Existing product</span> : <span className="text-emerald-600">OK</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm text-slate-600">Duplicates:</span>
              {[["skip", "Skip"], ["update", "Update Existing"], ["new", "Create New"]].map(([k, l]) => (
                <button key={k} data-testid={`dup-${k}`} onClick={() => setMode(k)} className={`text-sm border rounded-lg px-3 py-1.5 ${mode === k ? "bg-[#16a34a] font-semibold" : ""}`}>{l}</button>
              ))}
              <button data-testid="confirm-import" disabled={busy} onClick={doImport} className="btn-dark ml-auto disabled:opacity-50">Import Now</button>
            </div>
          </div>
        )}

        {summary && (
          <div className="border rounded-lg p-3 text-sm bg-emerald-50" data-testid="import-summary">
            Created <b>{summary.created}</b> · Updated <b>{summary.updated}</b> · Skipped <b>{summary.skipped}</b> · Failed <b>{summary.failed}</b>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm">Export</h3>
        <div className="flex flex-wrap gap-2">
          <button data-testid="export-products" onClick={exportProducts} className="btn-ghost">Export Products CSV</button>
          <button data-testid="export-backup" onClick={backup} className="btn-ghost">Export Full Backup (JSON)</button>
        </div>
        <p className="text-xs text-slate-500">Your live data already lives in the cloud and syncs across devices. This backup is an extra offline copy you can keep.</p>
      </div>

      <div className="card p-4 space-y-2">
        <h3 className="font-semibold text-sm">Restore from Backup</h3>
        <p className="text-xs text-slate-500">Products from a backup file are merged into your account (same code = updated). Nothing is deleted.</p>
        <input data-testid="restore-file" type="file" accept="application/json,.json" onChange={restore} className="text-sm" />
      </div>
    </div>
  );
}
