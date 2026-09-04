import { useEffect, useState } from "react";
import { api, apiError } from "@/lib/api";
import { money } from "@/lib/ops";
import { exportRowsCsv } from "@/lib/csv";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";
import { Printer, Download } from "lucide-react";

const Row = ({ label, value, strong, tone }) => (
  <div className={`flex justify-between py-2 border-b border-slate-100 last:border-0 ${strong ? "font-semibold" : ""}`}>
    <span className={strong ? "" : "text-slate-500"}>{label}</span>
    <span className={`tabular-nums ${tone === "red" ? "text-rose-600" : tone === "green" ? "text-emerald-600" : ""}`}>{value}</span>
  </div>
);

export default function DayClose() {
  const { settings, shop } = useApp();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [d, setD] = useState(null);

  const load = async (day) => {
    try { setD(await api.get("/reports/day-close", { date: day })); }
    catch (e) { toast.error(apiError(e)); }
  };
  useEffect(() => { load(date); }, [date]);

  const print = () => {
    if (!d) return;
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) return toast.error("Please allow pop-ups to print");
    const line = (a, b) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`;
    w.document.write(`<html><head><title>Day Closing ${d.date}</title><style>
      @page{size:80mm auto;margin:3mm}body{font-family:'Courier New',monospace;width:74mm;font-size:11px}
      h2,h3{text-align:center;margin:2px 0}table{width:100%;border-collapse:collapse}td{padding:1px 0}
      .r{text-align:right}.line{border-top:1px dashed #000;margin:4px 0}.b{font-weight:700}</style></head><body>
      <h2>${settings?.businessName || shop?.businessName || "VYRO VX7"}</h2>
      <h3>DAY CLOSING · ${new Date(d.date).toLocaleDateString("en-IN")}</h3><div class="line"></div>
      <table>
      ${line("Bills", d.bills)}${line("Items sold", d.itemsSold)}
      ${line("Gross sales", money(d.grossSales))}${line("Discount", "-" + money(d.discount))}
      ${line("Tax", money(d.tax))}
      <tr class="b">${`<td>NET SALES</td><td class="r">${money(d.netSales)}</td>`}</tr>
      ${line("Customer receipts", money(d.customerReceipts))}
      <tr class="b">${`<td>TOTAL COLLECTED</td><td class="r">${money(d.collected)}</td>`}</tr>
      ${line("Credit given", money(d.creditGiven))}${line("Purchases", money(d.purchases))}
      ${line("Returns", money(d.returns))}${line("Voided bills", d.voidedBills)}${line("Profit", money(d.profit))}
      </table><div class="line"></div><b>COLLECTION BY MODE</b><table>
      ${d.modes.map((m) => line(m.mode, money(m.amount))).join("")}
      </table><div class="line"></div><b>BY USER</b><table>
      ${d.byUser.map((u) => line(`${u.user} (${u.bills})`, money(u.amount))).join("")}
      </table><div class="line"></div>
      <div style="text-align:center">Cash counted: ____________<br/>Signature: ____________</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`);
    w.document.close();
  };

  if (!d) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-4 max-w-4xl" data-testid="day-close-page">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Day Closing</h1>
          <p className="text-sm text-slate-500">One-tap end-of-day summary of everything collected</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input data-testid="day-close-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp w-auto" />
          <button data-testid="day-close-print" onClick={print} className="btn-dark"><Printer size={15} /> Print</button>
          <button data-testid="day-close-export" onClick={() => exportRowsCsv(`day-close-${d.date}.csv`, [{ ...d, modes: d.modes.map((m) => `${m.mode}:${m.amount}`).join(" | "), byUser: d.byUser.map((u) => `${u.user}:${u.amount}`).join(" | ") }])} className="btn-ghost"><Download size={15} /> CSV</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[["Bills", d.bills], ["Net Sales", money(d.netSales)], ["Total Collected", money(d.collected)], ["Profit", money(d.profit)]].map(([l, v]) => (
          <div key={l} className="card p-4">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{l}</div>
            <div className="text-xl font-semibold tabular-nums mt-1">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4" data-testid="day-close-summary">
          <h3 className="text-sm font-semibold mb-2">Sales Summary</h3>
          <Row label="Gross sales" value={money(d.grossSales)} />
          <Row label="Discount given" value={"-" + money(d.discount)} tone="red" />
          <Row label="Tax collected" value={money(d.tax)} />
          <Row label="Net sales" value={money(d.netSales)} strong />
          <Row label="Items sold" value={d.itemsSold} />
          <Row label="Credit given (unpaid)" value={money(d.creditGiven)} tone="red" />
          <Row label="Customer receipts (khata)" value={money(d.customerReceipts)} tone="green" />
          <Row label="Total collected today" value={money(d.collected)} strong tone="green" />
          <Row label={`Purchases (${d.purchaseCount})`} value={money(d.purchases)} />
          <Row label={`Returns (${d.returnCount})`} value={money(d.returns)} />
          <Row label="Voided bills" value={d.voidedBills} />
          <Row label="Profit" value={money(d.profit)} strong />
        </div>

        <div className="space-y-4">
          <div className="card p-4" data-testid="day-close-modes">
            <h3 className="text-sm font-semibold mb-2">Collection by Payment Mode</h3>
            {d.modes.length === 0 && <p className="text-sm text-slate-400">Nothing collected on this date</p>}
            {d.modes.map((m) => <Row key={m.mode} label={m.mode} value={money(m.amount)} />)}
          </div>
          <div className="card p-4" data-testid="day-close-users">
            <h3 className="text-sm font-semibold mb-2">Billing by Staff</h3>
            {d.byUser.length === 0 && <p className="text-sm text-slate-400">No bills on this date</p>}
            {d.byUser.map((u) => <Row key={u.user} label={`${u.user} · ${u.bills} bill(s)`} value={money(u.amount)} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
