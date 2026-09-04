import Papa from "papaparse";
import { all } from "./db";

export const TEMPLATE_COLUMNS = [
  "Product Code", "Product Name", "Brand", "Category", "Subcategory", "Purchase Price", "Selling Price",
  "MRP", "Stock Quantity", "Minimum Stock", "Unit", "Barcode", "Supplier", "Location", "GST",
];

export const downloadFile = (filename, content, type = "text/csv;charset=utf-8;") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const sampleTemplate = () =>
  Papa.unparse([
    TEMPLATE_COLUMNS,
    ["SKU-001", "Sample Product A", "BrandX", "General", "Items", "800", "1400", "1600", "10", "5", "Piece", "8901234567", "Supplier A", "R1", "5"],
    ["SKU-002", "Sample Product B", "BrandY", "General", "Accessories", "40", "80", "99", "100", "10", "Piece", "8901234568", "Supplier B", "R2", "18"],
  ]);

export const parseCsv = (file) =>
  new Promise((resolve, reject) => {
    Papa.parse(file, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data), error: reject });
  });

export const exportProducts = async () => {
  const products = await all("products");
  downloadFile("vyro-products.csv", Papa.unparse(products.map((p) => ({
    "Product Code": p.code, "Product Name": p.name, Brand: p.brand || "", Category: p.category, Subcategory: p.subcategory,
    "Purchase Price": p.purchasePrice, "Selling Price": p.price, MRP: p.mrp || "", "Stock Quantity": p.stock,
    "Minimum Stock": p.minStock, Unit: p.unit, Barcode: p.barcode, Supplier: p.supplier,
    Location: p.location, GST: p.gst,
  }))));
};

export const exportRowsCsv = (filename, rows) => downloadFile(filename, Papa.unparse(rows));
