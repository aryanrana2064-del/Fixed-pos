import { useEffect, useMemo, useState } from "react";
import { all, put, remove } from "@/lib/db";
import { money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { barcodeSvgMarkup, generateCode128Value } from "@/lib/print";
import { exportProducts } from "@/lib/csv";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Download, QrCode, ChevronDown } from "lucide-react";
import { useNavigate } from "react-router-dom";

const blank = (template, units) => ({
  code: "", name: "", brand: "", category: Object.keys(template.categories || { General: [] })[0] || "General",
  subcategory: "", photo: "", purchasePrice: 0, price: 0, mrp: 0, discount: 0, stock: 0, minStock: 5,
  maxStock: 0, unit: template.defaultUnit || units[0] || "Piece", supplier: "", barcode: "", location: "",
  gst: 0, notes: "", description: "", variants: [], custom: {},
});

export default function Products() {
  const { can, refresh, template, units } = useApp();
  const [items, setItems] = useState([]);
  const [term, setTerm] = useState("");
  const [cat, setCat] = useState("All");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const nav = useNavigate();
  const editable = can("products") || can("*");
  const categories = Object.keys(template.categories || {});

  const load = async () => {
    try { setItems(await all("products")); } catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return items.filter(
      (p) =>
        (cat === "All" || p.category === cat) &&
        (!t || p.name.toLowerCase().includes(t) || String(p.code).toLowerCase().includes(t) ||
          String(p.barcode).includes(t) || String(p.brand || "").toLowerCase().includes(t))
    );
  }, [items, term, cat]);

  const perPage = 12;
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const view = filtered.slice((page - 1) * perPage, page * perPage);

  const save = async (e) => {
    e.preventDefault();
    const f = form;
    if (!f.code.trim() || !f.name.trim()) return toast.error("Product code and name are required");
    try {
      await put("products", {
        ...f,
        code: f.code.trim().toUpperCase(),
        purchasePrice: Number(f.purchasePrice) || 0,
        price: Number(f.price) || 0,
        mrp: Number(f.mrp) || 0,
        discount: Number(f.discount) || 0,
        stock: Number(f.stock) || 0,
        minStock: Number(f.minStock) || 0,
        maxStock: Number(f.maxStock) || 0,
        gst: Number(f.gst) || 0,
        variants: (f.variants || []).map((v) => ({ ...v, price: Number(v.price) || 0, stock: Number(v.stock) || 0 })),
      });
      setForm(null);
      await load();
      refresh();
      toast.success("Product saved");
    } catch (e2) { toast.error(apiError(e2)); }
  };

  const del = async (p) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try {
      await remove("products", p.id);
      await load();
      refresh();
      toast.success("Product deleted");
    } catch (e) { toast.error(apiError(e)); }
  };

  const openNew = () => {
    setForm({ ...blank(template, units), barcode: generateCode128Value() });
    setShowAdvanced(false);
  };

  const setVariant = (i, patch) => setForm({ ...form, variants: form.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  return (
    <div className="space-y-4" data-testid="products-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-slate-500">{items.length} products · {filtered.length} shown</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button data-testid="export-products-btn" onClick={exportProducts} className="btn-ghost"><Download size={15} /> Export CSV</button>
          <button data-testid="goto-import-btn" onClick={() => nav("/import-export")} className="btn-ghost">Import Stock</button>
          {editable && <button data-testid="add-product-btn" onClick={openNew} className="btn-gold"><Plus size={15} /> Add Product</button>}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <input data-testid="product-search" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} placeholder="Search name / code / brand / barcode" className="flex-1 min-w-[200px] inp" />
        <select data-testid="category-filter" value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }} className="inp w-auto">
          {["All", ...new Set([...categories, ...items.map((i) => i.category).filter(Boolean)])].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th">
            <tr>
              <th className="text-left p-3">Code</th><th className="text-left p-3">Product</th>
              <th className="text-left p-3 hidden md:table-cell">Category</th>
              <th className="text-right p-3 hidden sm:table-cell">Cost</th>
              <th className="text-right p-3">Price</th><th className="text-right p-3">Stock</th>
              <th className="text-left p-3 hidden lg:table-cell">Barcode</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody data-testid="products-table">
            {view.map((p) => (
              <tr key={p.id} data-testid={`product-row-${p.code}`} className="border-t border-slate-100 hover:bg-slate-50/70">
                <td className="p-3 font-mono text-xs">{p.code}</td>
                <td className="p-3 font-medium">
                  {p.name}
                  {p.brand && <span className="text-slate-400 font-normal"> · {p.brand}</span>}
                  {(p.variants || []).length > 0 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100">{p.variants.length} variants</span>}
                </td>
                <td className="p-3 hidden md:table-cell text-slate-500">{p.category}{p.subcategory ? ` / ${p.subcategory}` : ""}</td>
                <td className="p-3 text-right tabular-nums hidden sm:table-cell">{money(p.purchasePrice)}</td>
                <td className="p-3 text-right tabular-nums">{money(p.price)}{p.mrp > p.price ? <div className="text-[10px] text-slate-400 line-through">{money(p.mrp)}</div> : null}</td>
                <td className={`p-3 text-right tabular-nums font-semibold ${p.stock <= p.minStock ? "text-rose-600" : ""}`}>{p.stock} <span className="text-[10px] font-normal text-slate-400">{p.unit}</span></td>
                <td className="p-3 hidden lg:table-cell"><span className="font-mono text-[11px] text-slate-500">{p.barcode}</span></td>
                <td className="p-3 text-right whitespace-nowrap">
                  {editable && <button data-testid={`edit-${p.code}`} onClick={() => { setForm({ ...blank(template, units), ...p, variants: p.variants || [], custom: p.custom || {} }); setShowAdvanced(false); }} className="icon-btn"><Pencil size={15} /></button>}
                  {editable && <button data-testid={`delete-${p.code}`} onClick={() => del(p)} className="icon-btn text-rose-600"><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
            {!view.length && <tr><td colSpan={8} className="p-8 text-center text-slate-400">No products found</td></tr>}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex justify-center gap-2">
          <button data-testid="prev-page" disabled={page === 1} onClick={() => setPage(page - 1)} className="btn-ghost disabled:opacity-40">Prev</button>
          <span className="text-sm py-2.5">Page {page} / {pages}</span>
          <button data-testid="next-page" disabled={page === pages} onClick={() => setPage(page + 1)} className="btn-ghost disabled:opacity-40">Next</button>
        </div>
      )}

      {form && (
        <div className="modal-bg">
          <form onSubmit={save} data-testid="product-form" className="modal max-w-3xl space-y-3">
            <h3 className="text-lg font-semibold">{form.id ? "Edit" : "New"} Product</h3>

            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Product Code / SKU *"><input data-testid="p-code" name="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="inp" /></Field>
              <Field label="Product Name *"><input data-testid="p-name" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="inp" /></Field>
              <Field label="Brand"><input data-testid="p-brand" name="brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="inp" /></Field>
              <Field label="Category">
                <input data-testid="p-category" list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value, subcategory: "" })} className="inp" />
                <datalist id="cats">{categories.map((c) => <option key={c}>{c}</option>)}</datalist>
              </Field>
              <Field label="Subcategory">
                <input data-testid="p-subcategory" list="subcats" value={form.subcategory} onChange={(e) => setForm({ ...form, subcategory: e.target.value })} className="inp" />
                <datalist id="subcats">{(template.categories?.[form.category] || []).map((s) => <option key={s}>{s}</option>)}</datalist>
              </Field>
              <Field label="Unit">
                <input data-testid="p-unit" list="units" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="inp" />
                <datalist id="units">{units.map((u) => <option key={u}>{u}</option>)}</datalist>
              </Field>

              <Field label="Purchase Price"><input data-testid="p-purchase" name="purchasePrice" type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className="inp" /></Field>
              <Field label="Selling Price"><input data-testid="p-price" name="price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="inp" /></Field>
              <Field label="MRP"><input data-testid="p-mrp" name="mrp" type="number" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} className="inp" /></Field>
              <Field label="Discount %"><input data-testid="p-discount" type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} className="inp" /></Field>
              <Field label="Tax / GST %"><input data-testid="p-gst" type="number" value={form.gst} onChange={(e) => setForm({ ...form, gst: e.target.value })} className="inp" /></Field>
              <Field label="Supplier"><input data-testid="p-supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className="inp" /></Field>

              <Field label={form.id ? "Current Stock" : "Opening Stock"}><input data-testid="p-stock" name="stock" type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="inp" /></Field>
              <Field label="Minimum Stock"><input data-testid="p-minstock" type="number" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} className="inp" /></Field>
              <Field label="Maximum Stock"><input data-testid="p-maxstock" type="number" value={form.maxStock} onChange={(e) => setForm({ ...form, maxStock: e.target.value })} className="inp" /></Field>
              <Field label="Stock Location / Rack"><input data-testid="p-location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="inp" /></Field>
              <Field label="Barcode">
                <div className="flex gap-2">
                  <input data-testid="p-barcode" name="barcode" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="inp" />
                  <button type="button" data-testid="generate-barcode" onClick={() => setForm({ ...form, barcode: generateCode128Value() })} className="border rounded-lg px-2 text-xs flex items-center gap-1"><QrCode size={14} /> Gen</button>
                </div>
              </Field>
              <Field label="Description"><input data-testid="p-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="inp" /></Field>
            </div>

            <button type="button" data-testid="toggle-advanced" onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm font-medium flex items-center gap-1 text-slate-600">
              <ChevronDown size={15} className={showAdvanced ? "rotate-180 transition-transform" : "transition-transform"} />
              Variants &amp; Advanced Details {template.customFields?.length ? `(${template.customFields.length} fields for your business type)` : ""}
            </button>

            {showAdvanced && (
              <div className="space-y-4 border-t border-slate-100 pt-3" data-testid="advanced-section">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Variants ({(template.attributes || []).join(" / ") || "Size / Color"})</span>
                    <button type="button" data-testid="add-variant" onClick={() => setForm({ ...form, variants: [...(form.variants || []), { name: "", sku: "", barcode: "", price: form.price, stock: 0 }] })} className="btn-ghost py-1.5 px-2 text-xs">+ Add Variant</button>
                  </div>
                  {(form.variants || []).length === 0 && <p className="text-xs text-slate-400">No variants — this product is sold as a single item.</p>}
                  {(form.variants || []).map((v, i) => (
                    <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-2">
                      <input data-testid={`v-name-${i}`} value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })} placeholder="e.g. Black / M" className="inp" />
                      <input data-testid={`v-sku-${i}`} value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} placeholder="SKU" className="inp" />
                      <input data-testid={`v-barcode-${i}`} value={v.barcode} onChange={(e) => setVariant(i, { barcode: e.target.value })} placeholder="Barcode" className="inp" />
                      <input data-testid={`v-price-${i}`} type="number" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} placeholder="Price" className="inp" />
                      <div className="flex gap-1">
                        <input data-testid={`v-stock-${i}`} type="number" value={v.stock} onChange={(e) => setVariant(i, { stock: e.target.value })} placeholder="Stock" className="inp" />
                        <button type="button" onClick={() => setForm({ ...form, variants: form.variants.filter((_, j) => j !== i) })} className="icon-btn text-rose-600"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                {(template.customFields || []).length > 0 && (
                  <div>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Extra Details</span>
                    <div className="grid sm:grid-cols-3 gap-3 mt-2">
                      {template.customFields.map((cf) => (
                        <Field key={cf.key} label={cf.label}>
                          <input
                            data-testid={`cf-${cf.key}`}
                            type={cf.type === "number" ? "number" : cf.type === "date" ? "date" : "text"}
                            value={form.custom?.[cf.key] ?? ""}
                            onChange={(e) => setForm({ ...form, custom: { ...form.custom, [cf.key]: e.target.value } })}
                            className="inp"
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {form.barcode && <div className="border rounded-lg p-2 flex justify-center" dangerouslySetInnerHTML={{ __html: barcodeSvgMarkup(form.barcode) }} />}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" data-testid="cancel-product" onClick={() => setForm(null)} className="btn-ghost">Cancel</button>
              <button data-testid="save-product" className="btn-gold">Save Product</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-xs text-slate-500">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);
