# Deploy VYRO VX7 (Smart Business POS) — ONE Vercel deployment

Frontend (React) + backend (FastAPI, at `api/index.py` → `server/server.py`)
now deploy together as a single Vercel project. No separate backend host,
no MongoDB. All data lives in Firestore.

## 1. Firebase project (5 min)
1. Firebase Console → your project (`vxro-vx7`) → **Build → Firestore
   Database** → create database (production mode).
2. Project settings → **Service accounts** → **Generate new private key**.
   Keep the downloaded JSON — you'll paste it into Vercel as one env var.
3. Project settings → General → "Your apps" → Web app → confirm the
   `REACT_APP_FIREBASE_*` values already in `.env` match your project.

## 2. Push to GitHub, import into Vercel
1. Push this repo to GitHub.
2. vercel.com/new → import the repo → Framework Preset: **Create React
   App**. Root Directory: repo root (where `package.json` and `api/` both
   live) — do NOT set it to `server/`.
3. `vercel.json` already sets `buildCommand`/`outputDirectory` for the
   frontend and rewrites `/api/*` to the Python function — nothing else
   to configure in the dashboard.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)
```
REACT_APP_FIREBASE_API_KEY=...
REACT_APP_FIREBASE_AUTH_DOMAIN=...
REACT_APP_FIREBASE_PROJECT_ID=vxro-vx7
REACT_APP_FIREBASE_STORAGE_BUCKET=...
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=...
REACT_APP_FIREBASE_APP_ID=...
REACT_APP_BACKEND_URL=            # leave EMPTY — same-origin now

JWT_SECRET=<long random string>
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=<strong password>
FIREBASE_PROJECT_ID=vxro-vx7
FIREBASE_SERVICE_ACCOUNT_JSON=<paste the ENTIRE service-account JSON as one line>
```
`FIREBASE_SERVICE_ACCOUNT_JSON` is the important one — Vercel functions
don't get Firebase's ambient credentials the way `firebase deploy` does, so
the Admin SDK needs this explicitly (see `server/firestore_db.py`).

## 4. Deploy
Click Deploy. One URL serves everything:
- `https://your-app.vercel.app/` → React app
- `https://your-app.vercel.app/api/...` → FastAPI (Firestore-backed)

Check `https://your-app.vercel.app/api/` → `{"status":"ok"}`.

## 5. First run
- Open your Vercel URL → **Create Shop Account** → pick your **Business
  Type** → 14-day trial key + empty shop.
- Platform admin: sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` → `/admin`.
- Install as an app: Chrome desktop → install icon in address bar; Android
  Chrome → ⋮ → Install app.

## Notes
- `server/requirements.txt` (mirrored at root `requirements.txt` for
  Vercel's Python builder) no longer includes `motor`/`pymongo` — Firestore
  only, via `firebase-admin` + `google-cloud-firestore`.
- If you ever need the FastAPI backend hosted separately again (Render/
  Railway), it still runs standalone from `server/`: `uvicorn server:app`
  — just set the same Firebase env vars there.
