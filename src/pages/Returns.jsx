import { useEffect, useState } from "react";
import { all } from "@/lib/db";
import { createReturn, money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

export default function Returns() {
  const { user, refresh } = useApp();
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [list, setList] = useState([]);
  const [kind, setKind] = useState("sale");
  const [refId, setRefId] = useState("");
  const [row, setRow] = useState({ productId: "", qty: 1, price: 0 });

  const load = async () => {
    setProducts(await all("products"));
    setSales((await all("sales")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setList((await all("returns")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!row.productId) return toast.error("Select a product");
    const p = products.find((x) => x.id === row.productId);
    try {
      await createReturn({ kind, refId, items: [{ productId: p.id, name: p.name, code: p.code, qty: Number(row.qty), price: Number(row.price || p.price) }] });
      setRow({ productId: "", qty: 1, price: 0 });
      await load();
      refresh();
      toast.success(`${kind === "sale" ? "Sale" : "Purchase"} return saved · stock updated`);
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  return (
    <div className="space-y-4" data-testid="returns-page">
      <h1 className="text-2xl font-semibold tracking-tight">Returns</h1>
      <div className="card p-4 grid sm:grid-cols-5 gap-3 items-end">
        <label className="block"><span className="text-xs text-slate-500">Return Type</span>
          <select data-testid="r-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="inp mt-1">
            <option value="sale">Sale Return (stock +)</option>
            <option value="purchase">Purchase Return (stock -)</option>
          </select>
        </label>
        <label className="block"><span className="text-xs text-slate-500">Original Invoice</span>
          <select data-testid="r-ref" value={refId} onChange={(e) => setRefId(e.target.value)} className="inp mt-1">
            <option value="">Not linked</option>
            {sales.map((s) => <option key={s.id} value={s.id}>{s.invoiceNo}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs text-slate-500">Product</span>
          <select data-testid="r-product" value={row.productId} onChange={(e) => {
            const p = products.find((x) => x.id === e.target.value);
            setRow({ ...row, productId: e.target.value, price: p ? p.price : 0 });
          }} className="inp mt-1">
            <option value="">Select…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{`${p.name} (${p.stock})`}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs text-slate-500">Qty</span>
          <input data-testid="r-qty" type="number" value={row.qty} onChange={(e) => setRow({ ...row, qty: e.target.value })} className="inp mt-1" />
        </label>
        <button data-testid="r-submit" onClick={submit} className="btn-gold justify-center">Save Return</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Type</th><th className="text-left p-3">Items</th><th className="text-right p-3">Value</th></tr></thead>
          <tbody data-testid="returns-table">
            {list.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-3 text-xs text-slate-500">{new Date(r.createdAt).toLocaleString("en-IN")}</td>
                <td className="p-3">{r.kind === "sale" ? "Sale Return" : "Purchase Return"}</td>
                <td className="p-3">{r.items.map((i) => `${i.name} × ${i.qty}`).join(", ")}</td>
                <td className="p-3 text-right tabular-nums">{money(r.total)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={4} className="p-8 text-center text-slate-400">No returns yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
