import JsBarcode from "jsbarcode";
import QRCode from "qrcode";

export const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const barcodeSvgMarkup = (value, opts = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  try {
    JsBarcode(el, String(value), { format: "CODE128", width: 1.5, height: 45, fontSize: 12, margin: 4, ...opts });
  } catch (e) {
    return `<div style="font:11px monospace">${value}</div>`;
  }
  return el.outerHTML;
};

export const generateCode128Value = () => "JBX" + Math.floor(100000000 + Math.random() * 899999999);

// Builds a standard UPI deep link (opens any UPI app with amount pre-filled)
// and renders it as a QR code data URL the receipt/invoice can embed as <img>.
// Returns "" if no UPI ID is configured in Settings, so callers can skip it.
export const upiQrDataUrl = async (settings, amount, note = "") => {
  const upiId = (settings?.upiId || "").trim();
  if (!upiId || !amount || amount <= 0) return "";
  const params = new URLSearchParams({
    pa: upiId,
    pn: settings.businessName || "Merchant",
    am: Number(amount).toFixed(2),
    cu: "INR",
    ...(note ? { tn: note } : {}),
  });
  const upiUrl = `upi://pay?${params.toString()}`;
  try {
    return await QRCode.toDataURL(upiUrl, { margin: 1, width: 160 });
  } catch {
    return "";
  }
};

const openPrint = (title, css, body) => {
  const w = window.open("", "_blank", "width=460,height=700");
  if (!w) return false;
  w.document.write(`<html><head><title>${title}</title><style>${css}</style></head><body>${body}<script>window.onload=function(){setTimeout(function(){window.print();},250);}</script></body></html>`);
  w.document.close();
  return true;
};

export const printReceipt = async (sale, settings) => {
  const width = settings.receiptWidth === "58mm" ? "56mm" : "76mm";
  const css = `@page{size:${settings.receiptWidth || "80mm"} auto;margin:2mm}
  body{font-family:'Courier New',monospace;width:${width};font-size:11px;color:#000}
  h2{text-align:center;margin:2px 0;font-size:14px}.c{text-align:center}
  table{width:100%;border-collapse:collapse}td{font-size:11px;padding:1px 0}
  .r{text-align:right}.line{border-top:1px dashed #000;margin:4px 0}.b{font-weight:700}`;
  const items = sale.items
    .map((i) => `<tr><td colspan="3">${i.name}</td></tr><tr><td>${i.qty} x ${i.price}</td><td></td><td class="r">${(i.qty * i.price).toFixed(2)}</td></tr>`)
    .join("");
  const qrAmount = sale.due > 0 ? sale.due : 0;
  const qrDataUrl = qrAmount > 0 ? await upiQrDataUrl(settings, qrAmount, sale.invoiceNo) : "";
  const qrBlock = qrDataUrl
    ? `<div class="c" style="margin-top:6px"><img src="${qrDataUrl}" width="120" height="120" alt="UPI QR" /><br/>Scan to pay due ₹${qrAmount.toFixed(2)}</div>`
    : "";
  const body = `<h2>${settings.businessName}</h2>
  <div class="c">${settings.address || ""}<br/>Ph: ${settings.phone || ""}${settings.gstin ? `<br/>GSTIN: ${settings.gstin}` : ""}</div>
  <div class="line"></div>
  <table><tr><td>Invoice</td><td class="r b">${sale.invoiceNo}</td></tr>
  <tr><td>Date</td><td class="r">${new Date(sale.createdAt).toLocaleString("en-IN")}</td></tr>
  <tr><td>Customer</td><td class="r">${sale.customerName || "Walk-in"}</td></tr></table>
  <div class="line"></div><table>${items}</table><div class="line"></div>
  <table>
  <tr><td>Subtotal</td><td class="r">${sale.subtotal.toFixed(2)}</td></tr>
  <tr><td>Discount</td><td class="r">-${sale.discount.toFixed(2)}</td></tr>
  <tr><td>Tax (${sale.taxPercent}%)</td><td class="r">${sale.tax.toFixed(2)}</td></tr>
  <tr class="b"><td>TOTAL</td><td class="r">${sale.total.toFixed(2)}</td></tr>
  <tr><td>Paid</td><td class="r">${sale.paid.toFixed(2)}</td></tr>
  <tr><td>Due</td><td class="r">${sale.due.toFixed(2)}</td></tr>
  <tr><td>Mode</td><td class="r">${(sale.payments || []).map((p) => p.mode).join(", ")}</td></tr>
  </table><div class="line"></div>
  ${qrBlock}
  <div class="c">Thank you for shopping with us!</div>`;
  return openPrint(sale.invoiceNo, css, body);
};

export const printInvoiceA4 = (sale, settings) => {
  const css = `@page{size:A4;margin:12mm}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px}
  .head{display:flex;justify-content:space-between;border-bottom:3px solid #b8892b;padding-bottom:10px}
  h1{margin:0;font-size:22px;color:#1f2937}.muted{color:#555}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th{background:#1f2937;color:#fff;text-align:left;padding:7px;font-size:11px}
  td{padding:7px;border-bottom:1px solid #e5e7eb}
  .r{text-align:right}.tot{width:280px;margin-left:auto;margin-top:12px}
  .tot td{border:none;padding:4px 7px}.grand{font-weight:700;font-size:15px;border-top:2px solid #b8892b}`;
  const items = sale.items
    .map((i, n) => `<tr><td>${n + 1}</td><td>${i.name}<div class="muted">${i.code || ""}</div></td><td class="r">${i.qty}</td><td class="r">${i.price.toFixed(2)}</td><td class="r">${(i.qty * i.price).toFixed(2)}</td></tr>`)
    .join("");
  const body = `<div class="head"><div><h1>${settings.businessName}</h1>
  <div class="muted">${settings.address || ""}<br/>Ph: ${settings.phone || ""}${settings.gstin ? ` · GSTIN: ${settings.gstin}` : ""}</div></div>
  <div class="r"><h1>TAX INVOICE</h1><div class="muted">${sale.invoiceNo}<br/>${new Date(sale.createdAt).toLocaleString("en-IN")}</div></div></div>
  <div style="margin-top:14px"><b>Bill To:</b> ${sale.customerName || "Walk-in Customer"}</div>
  <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${items}</tbody></table>
  <table class="tot">
  <tr><td>Subtotal</td><td class="r">${money(sale.subtotal)}</td></tr>
  <tr><td>Discount</td><td class="r">-${money(sale.discount)}</td></tr>
  <tr><td>Tax (${sale.taxPercent}%)</td><td class="r">${money(sale.tax)}</td></tr>
  <tr class="grand"><td>Grand Total</td><td class="r">${money(sale.total)}</td></tr>
  <tr><td>Paid (${(sale.payments || []).map((p) => p.mode).join(", ")})</td><td class="r">${money(sale.paid)}</td></tr>
  <tr><td>Balance Due</td><td class="r">${money(sale.due)}</td></tr></table>
  <p class="muted" style="margin-top:30px">Thank you for your business! Goods once sold are subject to shop policy.</p>`;
  return openPrint(sale.invoiceNo, css, body);
};

export const printLabels = (labels, settings) => {
  const css = `@page{margin:6mm}body{font-family:Arial;margin:0}
  .grid{display:flex;flex-wrap:wrap;gap:4mm}
  .lbl{width:48mm;border:1px dashed #bbb;padding:3mm;text-align:center;page-break-inside:avoid}
  .n{font-size:10px;font-weight:700;margin-bottom:1mm}.c{font-size:9px;color:#444}
  .p{font-size:12px;font-weight:700;margin-top:1mm}svg{max-width:100%}`;
  const body = `<div class="grid">${labels
    .map((l) => `<div class="lbl"><div class="n">${l.name}</div><div class="c">${l.code}</div>${barcodeSvgMarkup(l.barcode || l.code)}<div class="p">${money(l.price)}</div></div>`)
    .join("")}</div>`;
  return openPrint("Barcode Labels", css, body);
};
