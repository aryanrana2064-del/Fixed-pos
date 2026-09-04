# VYRO VX7 — Smart Business POS

Universal, cloud-based POS & business management for **any retail shop**: General Retail, Jewellery, Garments & Fashion, Footwear, Grocery, Electronics & Mobile, Cosmetics, Hardware, Stationery & Books, Gift & Lifestyle and more. FastAPI + MongoDB is the source of truth; the React PWA is the shop terminal. Same shop, many devices, same live data — and billing keeps working when the internet drops.

## Business types & templates
At signup the shop picks a **Business Type**. That only sets **defaults** — categories, default unit, default tax and the optional "Advanced Details" fields — it never blocks any feature:

| Type | Example custom fields |
|---|---|
| Jewellery | Purity, Gross/Net Weight, Making Charges, Stone Details, HUID |
| Garments & Fashion | Size, Color, Fabric, Style |
| Footwear | Size (UK), Color, Material |
| Grocery | Batch, Expiry, Pack Size |
| Electronics & Mobile | Model, IMEI, Serial, Warranty, Storage |
| Cosmetics | Shade, Batch, Expiry |
| Hardware / Stationery / Gift / General / Other | Material, Size, Author/ISBN, Occasion … |

Business type can be changed anytime in **Settings**.

## Products (universal)
Name · SKU/Code · Brand · Category / Subcategory · Unit (Piece, Pair, Box, Pack, Dozen, Kg, Gram, Litre, Meter, Bottle, Set + your own custom units) · Description · Purchase Price · Selling Price · MRP · Discount % · Tax/GST · Opening/Current/Minimum/Maximum Stock · Stock Location · Code 128 barcode · **Variants** (e.g. Black/S, Black/M — each with own SKU, barcode, price, stock) · **Custom fields** per business type.

## Modules
Dashboard (live cards incl. **Sales by Category**, Customer & Supplier Outstanding, top selling, low stock, recent transactions) · ⚡ Quick Billing (USB/Bluetooth scanner, **camera barcode scanning** on Android Chrome, continuous scan, per-bill & permanent price change, discount, tax, Cash/UPI/Card/Bank Transfer/Credit/Other, credit → khata, duplicate-safe DONE) · Thermal 58/80mm + A4 invoice + WhatsApp share + auto-print · **Day Closing** (one-tap end-of-day: gross/discount/tax/net, collected by mode, credit given, khata receipts, purchases, returns, voided bills, profit, billing by staff — printable + CSV) · Products · Inventory + stock-movement ledger · Purchases · Returns · Customers & Khata · Suppliers · 13 Reports (Sales, Purchases, Profit, Inventory, Low Stock, Customers & Suppliers, Product Performance, Category Performance, Payments, Tax/GST, Discounts, Returns, Stock Movement) · Barcode & Labels · Import/Export · Users & Permissions · Activity Log · Settings · License.

## Roles (enforced server-side)
| Role | Access |
|---|---|
| Owner | Everything: users, settings, license, price/stock changes, void bills |
| Manager | Products, Inventory, Purchases, Sales, Reports, Day Closing, price/stock changes, void bills |
| Cashier | Quick Billing + Customers + Sales list |
| Staff | Quick Billing only |

## Offline
Reads fall back to an IndexedDB cache; new bills queue with a `clientRef` idempotency key and replay on reconnect (repeat `clientRef` returns the same bill — no duplicates, no double stock deduction). Header shows `Online — Cloud synced` / `Offline — Working Locally` + `N bill(s) to sync`.

## License
Platform admin panel at **`/admin`**: create keys (Trial/Starter/Pro/Business/Lifetime), extend +30d, change plan, set device limit, revoke / re-activate, and see every registered shop. New shops get a 14-day trial automatically; shop owners activate a paid key on the **License** page. Data is never deleted when a license expires.

## Run locally
```bash
cd server && pip install -r requirements.txt && uvicorn server:app --port 8001
yarn install && yarn start        # http://localhost:3000
```

## Environment
`.env` (frontend, see `.env.example`): `REACT_APP_BACKEND_URL=https://your-api-host` + `REACT_APP_FIREBASE_*` (for Google Sign-In).
`server/.env`: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGINS`, `FIREBASE_PROJECT_ID` (see `server/.env.example`). Secrets stay on the server.

## Google Sign-In (Firebase Auth)
Email/password auth and Google Sign-In both create/read real users in MongoDB — there's no mock mode.

1. In the [Firebase Console](https://console.firebase.google.com), create/select a project.
2. **Authentication -> Sign-in method -> Google -> Enable.**
3. **Project settings -> General -> Your apps -> Add app -> Web (`</>`)**. Copy the config values into your frontend `.env` as `REACT_APP_FIREBASE_*` (see `.env.example`).
4. Copy the same project's **Project ID** into `server/.env` as `FIREBASE_PROJECT_ID`.
5. **Authentication -> Settings -> Authorized domains** — add `localhost` (for dev) and your production domain (e.g. your Vercel URL).
6. Restart both frontend and backend after editing `.env` files (Create React App only reads `REACT_APP_*` vars at build/start time).

Flow: the "Continue with Google" button on `/login` opens the real Google account picker via Firebase, gets a signed ID token, and posts it to `POST /api/auth/google`. The backend verifies that token against your Firebase project (`google-auth`'s `verify_firebase_token`, no extra service-account file needed) and either logs the matching MongoDB user in or — for a brand-new Google account — asks for a shop name once and creates the shop exactly like email signup does (14-day trial license included). If the Google account's email already has a password-based account, it's linked automatically so both sign-in methods work for the same user.

## Deploy
Frontend → Vercel (root of this folder, build `yarn build`, output `build`, `vercel.json` handles SPA rewrites). API → Render/Railway/Fly + MongoDB Atlas. Full steps in `DEPLOY-VERCEL.md`.

## Tests
`cd server && export REACT_APP_BACKEND_URL=<api-host> && python -m pytest tests/ -q` → **42 tests** covering auth, brute-force lockout, tenant isolation, RBAC, billing idempotency, void, khata, purchases, returns, CSV import, business templates, universal product fields, variants, custom fields, Day Closing math, license admin.

## Printing note
Printing uses the browser print dialog (58/80mm and A4 page sizes). Browsers do not allow silent printer access — choose your thermal printer once in the dialog.
