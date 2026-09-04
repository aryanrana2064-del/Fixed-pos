import { useEffect, useState } from "react";
import { all, put } from "@/lib/db";
import { barcodeSvgMarkup, printLabels, generateCode128Value } from "@/lib/print";
import { money } from "@/lib/ops";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

export default function BarcodeLabels() {
  const { settings } = useApp();
  const [products, setProducts] = useState([]);
  const [sel, setSel] = useState({});
  const [term, setTerm] = useState("");

  const load = async () => setProducts(await all("products"));
  useEffect(() => { load(); }, []);

  const filtered = products.filter((p) => !term || p.name.toLowerCase().includes(term.toLowerCase()) || String(p.code).toLowerCase().includes(term.toLowerCase()));
  const chosen = filtered.filter((p) => sel[p.id]);

  const assign = async (p) => {
    try {
      await put("products", { ...p, barcode: generateCode128Value() });
      await load();
      toast.success("Barcode assigned");
    } catch {
      toast.error("Could not assign barcode. Please try again.");
    }
  };

  const print = () => {
    const labels = [];
    (chosen.length ? chosen : []).forEach((p) => {
      const n = Number(sel[p.id]) || 1;
      for (let i = 0; i < n; i++) labels.push(p);
    });
    if (!labels.length) return toast.error("Select at least one product");
    if (!printLabels(labels, settings)) toast.error("Please allow pop-ups to print labels");
  };

  return (
    <div className="space-y-4" data-testid="labels-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Barcode &amp; Labels</h1>
        <button data-testid="print-labels-btn" onClick={print} className="btn-gold">Print Labels ({chosen.length})</button>
      </div>
      <input data-testid="label-search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products" className="inp max-w-sm" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => (
          <div key={p.id} data-testid={`label-card-${p.code}`} className="card p-3 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{p.name}</div>
                <div className="text-xs text-slate-500">{p.code} · {money(p.price)}</div>
              </div>
              <input data-testid={`label-qty-${p.code}`} type="number" min="0" value={sel[p.id] || ""} placeholder="0" onChange={(e) => setSel({ ...sel, [p.id]: e.target.value })} className="w-16 border rounded-md px-2 py-1 text-sm" />
            </div>
            <div className="mt-2 flex justify-center overflow-hidden" dangerouslySetInnerHTML={{ __html: p.barcode ? barcodeSvgMarkup(p.barcode, { height: 34 }) : "" }} />
            {!p.barcode && <button data-testid={`assign-${p.code}`} onClick={() => assign(p)} className="w-full border rounded-lg py-1.5 text-xs mt-2">Generate Code 128</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
