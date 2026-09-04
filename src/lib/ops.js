import { api, DEVICE_ID } from "./api";
import { all, queueSale, uid, nowISO, cacheGet, cacheSet } from "./db";

export const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const log = async () => {};   // activity logging happens server-side

export const findByBarcodeOrCode = async (term) => {
  const t = String(term).trim();
  if (!t) return null;
  const products = await all("products");
  return (
    products.find((p) => p.barcode && p.barcode === t) ||
    products.find((p) => String(p.code).toUpperCase() === t.toUpperCase()) ||
    null
  );
};

export const completeSale = async ({ items, customerId = "", discount = 0, taxPercent = 0, payments = [], note = "" }) => {
  const body = {
    items: items.map(({ productId, name, code, price, qty, purchasePrice }) => ({ productId, name, code, price: Number(price), qty: Number(qty), purchasePrice: Number(purchasePrice || 0) })),
    customerId,
    discount: Number(discount || 0),
    taxPercent: Number(taxPercent || 0),
    payments: payments.map((p) => ({ mode: p.mode, amount: Number(p.amount || 0) })),
    note,
    clientRef: uid("ref"),
    device: DEVICE_ID,
  };
  try {
    return await api.post("/sales", body);
  } catch (e) {
    if (e?.response) throw e;
    // offline: queue the bill and return a local provisional invoice
    await queueSale(body);
    const subtotal = body.items.reduce((s, i) => s + i.price * i.qty, 0);
    const taxable = Math.max(subtotal - body.discount, 0);
    const tax = +(taxable * body.taxPercent / 100).toFixed(2);
    const total = +(taxable + tax).toFixed(2);
    const paid = body.payments.reduce((s, x) => s + x.amount, 0);
    const offlineNo = "OFF-" + String((Number(await cacheGet("offlineSeq")) || 0) + 1).padStart(4, "0");
    await cacheSet("offlineSeq", (Number(await cacheGet("offlineSeq")) || 0) + 1);
    return { ...body, id: body.clientRef, invoiceNo: offlineNo, subtotal, tax, total, paid, due: +(total - paid).toFixed(2), customerName: "", status: "queued", createdAt: nowISO(), offline: true };
  }
};

export const voidSale = ({ saleId, reason }) => api.post(`/sales/${saleId}/void`, { reason });

export const completePurchase = ({ supplierId, supplierInvoice = "", items, taxPercent = 0, paid = 0 }) =>
  api.post("/purchases", {
    supplierId,
    supplierInvoice,
    items: items.map(({ productId, name, code, qty, price }) => ({ productId, name, code, qty: Number(qty), price: Number(price) })),
    taxPercent: Number(taxPercent || 0),
    paid: Number(paid || 0),
  });

export const createReturn = ({ kind, refId = "", items }) =>
  api.post("/returns", { kind, refId, items: items.map(({ productId, name, code, qty, price }) => ({ productId, name, code, qty: Number(qty), price: Number(price) })) });

export const adjustStock = ({ productId, qty, type, reason }) =>
  api.post("/stock/adjust", { productId, qty: Number(qty), type, reason });

export const recordCustomerPayment = ({ customerId, amount, mode = "Cash", note = "" }) =>
  api.post(`/customers/${customerId}/payment`, { amount: Number(amount), mode, note });

export const recordSupplierPayment = ({ supplierId, amount, mode = "Cash", note = "" }) =>
  api.post(`/suppliers/${supplierId}/payment`, { amount: Number(amount), mode, note });

export const changeProductPrice = ({ product, newPrice }) =>
  api.patch(`/products/${product.id}/price`, { price: Number(newPrice) });

export const dashboardStats = async () => {
  try {
    const data = await api.get("/dashboard");
    await cacheSet("dashboard", data);
    return data;
  } catch (e) {
    if (e?.response) throw e;
    return (await cacheGet("dashboard")) || null;
  }
};
