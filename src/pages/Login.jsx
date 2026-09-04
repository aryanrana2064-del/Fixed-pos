import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { api, apiError } from "@/lib/api";
import { signInWithGoogle, firebaseEnabled } from "@/lib/firebase";
import { Boxes, Loader2 } from "lucide-react";

const FALLBACK_TYPES = ["General Retail", "Jewellery", "Garments & Fashion", "Footwear", "Grocery", "Electronics & Mobile", "Cosmetics", "Hardware", "Stationery & Books", "Gift & Lifestyle", "Other"];

export default function Login() {
  const { login, signupShop, loginWithGoogle } = useApp();
  const [tab, setTab] = useState("login");
  const [types, setTypes] = useState(FALLBACK_TYPES);
  const [f, setF] = useState({ email: "", password: "", businessName: "", businessType: "General Retail", ownerName: "", phone: "", address: "", gstin: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [pendingGoogle, setPendingGoogle] = useState(null); // { idToken, suggestedName } when a brand-new Google user needs a shop name
  const nav = useNavigate();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const finishGoogle = async (idToken, businessName = "") => {
    const data = await loginWithGoogle(idToken, businessName, f.businessType);
    if (data.needsShop) {
      setPendingGoogle({ idToken, suggestedName: data.suggestedName || "" });
      return;
    }
    setPendingGoogle(null);
    if (data.licenseKey) setNewKey(data.licenseKey);
    nav("/dashboard");
  };

  const handleGoogle = async () => {
    setErr("");
    setGoogleBusy(true);
    try {
      const { idToken } = await signInWithGoogle();
      await finishGoogle(idToken);
    } catch (e2) {
      setErr(e2?.message || apiError(e2, "Google sign-in failed. Please try again."));
    } finally {
      setGoogleBusy(false);
    }
  };

  const submitGoogleShop = async (e) => {
    e.preventDefault();
    if (!pendingGoogle) return;
    setErr("");
    setGoogleBusy(true);
    try {
      await finishGoogle(pendingGoogle.idToken, f.businessName || pendingGoogle.suggestedName);
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setGoogleBusy(false);
    }
  };

  useEffect(() => { api.get("/templates").then((t) => t?.businessTypes && setTypes(t.businessTypes)).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (tab === "login") {
        const res = await login(f.email, f.password);
        nav(res.admin ? "/superadminpanel" : "/dashboard");
      } else {
        const data = await signupShop({
          businessName: f.businessName, businessType: f.businessType, ownerName: f.ownerName,
          email: f.email, password: f.password, phone: f.phone, address: f.address, gstin: f.gstin,
        });
        setNewKey(data.licenseKey);
        setTimeout(() => nav("/dashboard"), 1500);
      }
    } catch (e2) {
      setErr(apiError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1120] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#16a34a]/10 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="w-full max-w-md bg-white rounded-2xl p-7 shadow-2xl relative">
        <div className="flex items-center gap-2 mb-1">
          <Boxes className="text-[#16a34a]" />
          <h1 className="text-2xl font-semibold tracking-tight">VYRO VX7</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5">Smart Business POS — Billing, Stock &amp; Business Management for every shop</p>

        {pendingGoogle ? (
          <form onSubmit={submitGoogleShop} className="space-y-3" data-testid="google-shop-form">
            <p className="text-sm text-slate-600">One last step — name your shop to finish setting up your Google account.</p>
            <input data-testid="s-business" required autoFocus value={f.businessName || pendingGoogle.suggestedName}
              onChange={set("businessName")} placeholder="Shop / Business name *" className="inp py-3" />
            <label className="block">
              <span className="text-xs text-slate-500">Select Your Business Type</span>
              <select data-testid="s-business-type" value={f.businessType} onChange={set("businessType")} className="inp py-3 mt-1">
                {types.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            {err && <div data-testid="login-error" className="text-sm text-rose-600">{err}</div>}
            <button data-testid="google-shop-submit" disabled={googleBusy}
              className="w-full bg-[#16a34a] hover:bg-[#15803d] text-[#1e3a8a] font-semibold rounded-lg py-3 flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-[#16a34a]/20 transition-all">
              {googleBusy && <Loader2 size={16} className="animate-spin" />}
              Create Shop & Start Trial
            </button>
            <button type="button" onClick={() => setPendingGoogle(null)} className="w-full text-xs text-slate-400 underline">Cancel</button>
          </form>
        ) : (
        <>
        {firebaseEnabled && (
          <>
            <button type="button" data-testid="google-signin" onClick={handleGoogle} disabled={googleBusy}
              className="w-full flex items-center justify-center gap-2 border border-slate-300 rounded-lg py-3 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-all mb-4">
              {googleBusy ? <Loader2 size={16} className="animate-spin" /> : (
                <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.61Z" />
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.19l-2.91-2.26c-.81.54-1.85.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.98v2.33A9 9 0 0 0 9 18Z" />
                  <path fill="#FBBC05" d="M3.96 10.7A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.98-2.33Z" />
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.98 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
                </svg>
              )}
              Continue with Google
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px bg-slate-200 flex-1" /><span className="text-xs text-slate-400">or</span><div className="h-px bg-slate-200 flex-1" />
            </div>
          </>
        )}
        <div className="flex gap-2 mb-5 bg-slate-100 rounded-lg p-1">
          {[["login", "Sign In"], ["signup", "Create Shop Account"]].map(([k, l]) => (
            <button key={k} data-testid={`tab-${k}`} onClick={() => { setTab(k); setErr(""); }}
              className={`flex-1 text-sm py-2 rounded-md transition-all ${tab === k ? "bg-white shadow font-semibold" : "text-slate-500"}`}>{l}</button>
          ))}
        </div>
        </>
        )}

        {!pendingGoogle && (newKey ? (
          <div className="text-center py-6" data-testid="signup-success">
            <p className="text-sm text-slate-600">Shop created! Your 14-day trial license key:</p>
            <p className="font-mono text-lg font-bold mt-2">{newKey}</p>
            <p className="text-xs text-slate-500 mt-3">Opening your dashboard…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {tab === "signup" && (
              <>
                <input data-testid="s-business" required value={f.businessName} onChange={set("businessName")} placeholder="Shop / Business name *" className="inp py-3" />
                <label className="block">
                  <span className="text-xs text-slate-500">Select Your Business Type</span>
                  <select data-testid="s-business-type" value={f.businessType} onChange={set("businessType")} className="inp py-3 mt-1">
                    {types.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <span className="text-[11px] text-slate-400">Sets your default categories, units, tax and extra product fields. You can use any feature regardless of type.</span>
                </label>
                <input data-testid="s-owner" required value={f.ownerName} onChange={set("ownerName")} placeholder="Owner name *" className="inp py-3" />
                <div className="grid grid-cols-2 gap-3">
                  <input data-testid="s-phone" value={f.phone} onChange={set("phone")} placeholder="Phone" className="inp py-3" />
                  <input data-testid="s-gstin" value={f.gstin} onChange={set("gstin")} placeholder="GSTIN" className="inp py-3" />
                </div>
                <input data-testid="s-address" value={f.address} onChange={set("address")} placeholder="Shop address" className="inp py-3" />
              </>
            )}
            <input data-testid="login-email" required type="email" value={f.email} onChange={set("email")} placeholder="Email *" className="inp py-3" />
            <input data-testid="login-password" required type="password" value={f.password} onChange={set("password")} placeholder={tab === "signup" ? "Create password (min 6 chars) *" : "Password *"} className="inp py-3" />
            {err && <div data-testid="login-error" className="text-sm text-rose-600">{err}</div>}
            <button data-testid={tab === "login" ? "login-submit" : "signup-submit"} disabled={busy}
              className="w-full bg-[#16a34a] hover:bg-[#15803d] text-[#1e3a8a] font-semibold rounded-lg py-3 flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-[#16a34a]/20 transition-all">
              {busy && <Loader2 size={16} className="animate-spin" />}
              {tab === "login" ? "Sign In" : "Create Shop & Start Trial"}
            </button>
          </form>
        ))}

        <p className="text-xs text-slate-400 mt-5">
          Shop owners: create one account, then add your staff under <b>Users</b>.
        </p>
      </div>
    </div>
  );
}
