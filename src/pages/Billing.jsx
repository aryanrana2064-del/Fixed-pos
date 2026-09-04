import { useEffect, useMemo, useRef, useState } from "react";
import { all } from "@/lib/db";
import { completeSale, findByBarcodeOrCode, changeProductPrice, money } from "@/lib/ops";
import { apiError } from "@/lib/api";
import { printReceipt, printInvoiceA4 } from "@/lib/print";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Plus, Minus, Trash2, Scan, Printer, FileText, Share2, Camera } from "lucide-react";
import CameraScanner, { cameraSupported } from "@/components/CameraScanner";

const MODES = ["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"];

export default function Billing() {
  const { user, settings, refresh, can } = useApp();
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [term, setTerm] = useState("");
  const [cart, setCart] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [discount, setDiscount] = useState(0);
  const [taxPercent, setTaxPercent] = useState(settings?.defaultTax ?? 3);
  const [mode, setMode] = useState(settings?.defaultPayment || "Cash");
  const [paidInput, setPaidInput] = useState("");
  const [continuous, setContinuous] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const scanRef = useRef(null);

  const load = async () => {
    setProducts(await all("products"));
    setCustomers(await all("customers"));
  };
  useEffect(() => { load(); scanRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e) => { if (e.key === "F2") { e.preventDefault(); scanRef.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const suggestions = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(t) || String(p.code).toLowerCase().includes(t) || String(p.barcode).includes(t))
      .slice(0, 8);
  }, [term, products]);

  const addProduct = (p) => {
    if (p.stock <= 0 && !settings?.allowNegativeStock) toast.warning("Low stock — Restock recommended.");
    setCart((c) => {
      const i = c.findIndex((x) => x.productId === p.id);
      if (i >= 0) {
        const copy = [...c];
        copy[i] = { ...copy[i], qty: copy[i].qty + 1 };
        return copy;
      }
      return [...c, { productId: p.id, name: p.name, code: p.code, price: p.price, qty: 1, purchasePrice: p.purchasePrice, stock: p.stock, unit: p.unit }];
    });
    setTerm("");
    if (continuous) setTimeout(() => scanRef.current?.focus(), 10);
  };

  const onScanSubmit = async (e) => {
    e.preventDefault();
    const t = term.trim();
    if (!t) return;
    const p = (await findByBarcodeOrCode(t)) || suggestions[0];
    if (!p) return toast.error("Product not found for " + t);
    addProduct(p);
  };

  const setQty = (id, qty) => setCart((c) => c.map((x) => (x.productId === id ? { ...x, qty: Math.max(1, qty) } : x)));
  const setPrice = (id, price) => setCart((c) => c.map((x) => (x.productId === id ? { ...x, price: Number(price) || 0 } : x)));

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const taxable = Math.max(subtotal - Number(discount || 0), 0);
  const tax = +(taxable * (Number(taxPercent || 0) / 100)).toFixed(2);
  const total = +(taxable + tax).toFixed(2);
  const paid = mode === "Credit" ? Number(paidInput || 0) : paidInput === "" ? total : Number(paidInput);
  const due = +(total - paid).toFixed(2);

  const makePermanent = async (item) => {
    if (!can("price_permanent")) return toast.error("Owner/Manager permission required for permanent price change.");
    const p = products.find((x) => x.id === item.productId);
    try {
      await changeProductPrice({ product: p, newPrice: item.price });
      await load();
      toast.success("Product price updated permanently");
    } catch (e) {
      toast.error(apiError(e));
    }
  };

  const done = async () => {
    if (busy) return;
    if (!cart.length) return toast.error("Cart is empty");
    if (mode === "Credit" && !customerId) return toast.error("Select a customer for credit sale");
    if (due > 0 && !customerId) return toast.error("Select a customer to record the due amount");
    setBusy(true);
    try {
      const payments = [{ mode, amount: Math.max(paid, 0) }];
      const sale = await completeSale({ items: cart.map(({ stock, unit, ...i }) => i), customerId, discount: Number(discount || 0), taxPercent: Number(taxPercent || 0), payments });
      setLastSale(sale);
      setCart([]);
      setDiscount(0);
      setPaidInput("");
      setCustomerId("");
      await load();
      refresh();
      if (sale.offline) toast.warning(`Offline — bill ${sale.invoiceNo} saved locally and will sync automatically`);
      else toast.success(`Bill ${sale.invoiceNo} saved · ${money(sale.total)}`);
      if (settings?.autoPrint) printReceipt(sale, settings);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const shareWhatsApp = (sale) => {
    const text = `${settings.businessName}\nInvoice ${sale.invoiceNo}\nTotal: ${money(sale.total)}\nPaid: ${money(sale.paid)}\nDue: ${money(sale.due)}\nThank you!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4" data-testid="billing-page">
      {scanOpen && (
        <CameraScanner
          onClose={() => setScanOpen(false)}
          onDetected={async (code) => {
            setScanOpen(false);
            const p = await findByBarcodeOrCode(code);
            if (!p) return toast.error(`No product found for ${code}`);
            addProduct(p);
            toast.success(`${p.name} added`);
          }}
        />
      )}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-xl font-semibold tracking-tight">⚡ Quick Billing</h1>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
              <input data-testid="continuous-scan-toggle" type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} className="accent-[#16a34a] w-4 h-4" />
              Continuous Scan {continuous ? "ON" : "OFF"}
            </label>
          </div>
          <form onSubmit={onScanSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={scanRef}
                data-testid="barcode-input"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Scan barcode or search product (F2)"                className="w-full border border-slate-300 rounded-lg px-4 py-3.5 text-base outline-none focus:border-[#16a34a] focus:ring-2 focus:ring-[#16a34a]/25"
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <div data-testid="search-suggestions" className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-auto">
                  {suggestions.map((p) => (
                    <button type="button" key={p.id} data-testid={`suggestion-${p.code}`} onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex justify-between text-sm">
                      <span className="truncate pr-2">{p.name} <span className="text-slate-400">· {p.code}</span></span>
                      <span className="tabular-nums whitespace-nowrap">{money(p.price)} · {p.stock}{p.unit ? " " + p.unit : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button data-testid="scan-add-btn" className="btn-dark px-5"><Scan size={16} /><span className="hidden sm:inline">Add</span></button>
            <button type="button" data-testid="camera-scan-btn" onClick={() => setScanOpen(true)} className="btn-ghost px-4" title="Scan with camera">
              <Camera size={16} /><span className="hidden sm:inline">Camera</span>
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-[11px] uppercase tracking-wide font-semibold text-slate-500">Cart ({cart.length})</div>
          {cart.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">Scan or search a product to start billing</div>
          ) : (
            <div className="divide-y" data-testid="cart-items">
              {cart.map((i) => (
                <div key={i.productId} data-testid={`cart-item-${i.code}`} className="p-3 sm:p-4 flex flex-wrap items-center gap-3">
                  <div className="min-w-[140px] flex-1">
                    <div className="font-medium text-sm">{i.name}</div>
                    <div className="text-xs text-slate-500">{i.code} · stock {i.stock}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-500">₹</span>
                    <input data-testid={`price-${i.code}`} type="number" value={i.price} onChange={(e) => setPrice(i.productId, e.target.value)} className="w-20 border rounded-md px-2 py-1.5 text-sm tabular-nums" />
                    <button data-testid={`perm-price-${i.code}`} onClick={() => makePermanent(i)} title="Update product price permanently" className="text-[10px] border rounded px-1.5 py-1 hover:bg-slate-50">SAVE</button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button data-testid={`qty-minus-${i.code}`} onClick={() => setQty(i.productId, i.qty - 1)} className="w-9 h-9 border rounded-md flex items-center justify-center"><Minus size={14} /></button>
                    <input data-testid={`qty-${i.code}`} type="number" value={i.qty} onChange={(e) => setQty(i.productId, Number(e.target.value))} className="w-14 border rounded-md px-2 py-1.5 text-sm text-center tabular-nums" />
                    <button data-testid={`qty-plus-${i.code}`} onClick={() => setQty(i.productId, i.qty + 1)} className="w-9 h-9 border rounded-md flex items-center justify-center"><Plus size={14} /></button>
                  </div>
                  <div className="w-24 text-right font-semibold tabular-nums" data-testid={`line-total-${i.code}`}>{money(i.price * i.qty)}</div>
                  <button data-testid={`remove-${i.code}`} onClick={() => setCart((c) => c.filter((x) => x.productId !== i.productId))} className="text-red-500 p-1"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {lastSale && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4" data-testid="last-sale-panel">
            <div className="text-sm font-semibold text-emerald-900">Bill {lastSale.invoiceNo} completed · {money(lastSale.total)}</div>
            <div className="flex flex-wrap gap-2 mt-3">
              <button data-testid="print-receipt-btn" onClick={() => printReceipt(lastSale, settings)} className="bg-[#1e3a8a] text-white rounded-lg px-3 py-2 text-sm flex items-center gap-2"><Printer size={14} /> Thermal Receipt</button>
              <button data-testid="print-a4-btn" onClick={() => printInvoiceA4(lastSale, settings)} className="border rounded-lg px-3 py-2 text-sm bg-white flex items-center gap-2"><FileText size={14} /> A4 Invoice</button>
              <button data-testid="share-btn" onClick={() => shareWhatsApp(lastSale)} className="border rounded-lg px-3 py-2 text-sm bg-white flex items-center gap-2"><Share2 size={14} /> Share</button>
              <button data-testid="new-bill-btn" onClick={() => { setLastSale(null); scanRef.current?.focus(); }} className="border rounded-lg px-3 py-2 text-sm bg-white">New Bill</button>
            </div>
          </div>
        )}
      </div>

      <div className="card p-4 space-y-3 lg:sticky lg:top-20 h-fit">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Payment</h3>
        <div>
          <label className="text-xs text-slate-500">Customer</label>
          <select data-testid="customer-select" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm">
            <option value="">Walk-in Customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{`${c.name}${Number(c.balance) ? ` (due ${c.balance})` : ""}`}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-500">Discount ₹</label>
            <input data-testid="discount-input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm tabular-nums" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Tax %</label>
            <input data-testid="tax-input" type="number" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} className="w-full border rounded-lg px-3 py-2.5 text-sm tabular-nums" />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Payment Mode</label>
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            {MODES.map((m) => (
              <button key={m} data-testid={`mode-${m}`} onClick={() => setMode(m)} className={`text-xs py-2.5 rounded-lg border transition-all ${mode === m ? "bg-[#16a34a] border-[#16a34a] font-semibold text-[#1e3a8a]" : "hover:bg-slate-50 border-slate-300"}`}>{m}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Paid Amount</label>
          <input data-testid="paid-input" type="number" value={paidInput} onChange={(e) => setPaidInput(e.target.value)} placeholder={String(total)} className="w-full border rounded-lg px-3 py-2.5 text-sm tabular-nums" />
        </div>
        <div className="border-t pt-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="tabular-nums" data-testid="bill-subtotal">{money(subtotal)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Discount</span><span className="tabular-nums">-{money(discount)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Tax</span><span className="tabular-nums" data-testid="bill-tax">{money(tax)}</span></div>
          <div className="flex justify-between text-lg font-semibold"><span>Total</span><span className="tabular-nums" data-testid="bill-total">{money(total)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Due</span><span className="tabular-nums text-red-600" data-testid="bill-due">{money(Math.max(due, 0))}</span></div>
        </div>
        <button data-testid="done-btn" disabled={busy || cart.length === 0} onClick={done} className="w-full bg-[#16a34a] hover:bg-[#15803d] disabled:opacity-40 disabled:cursor-not-allowed text-[#1e3a8a] font-bold rounded-lg py-4 text-base tracking-wide active:scale-[0.99] transition-all shadow-lg shadow-[#16a34a]/20">
          {busy ? "Saving…" : "DONE"}
        </button>
      </div>
    </div>
  );
}
