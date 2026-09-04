import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { api, setToken, getToken, apiError } from "@/lib/api";
import { flushOutbox, outboxCount, cacheGet, cacheSet } from "@/lib/db";
import { firebaseSignOut } from "@/lib/firebase";
import { toast } from "sonner";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const PERMS = {
  Owner: ["*"],
  Manager: ["products", "inventory", "billing", "purchases", "sales", "customers", "suppliers", "returns", "reports", "labels", "importexport", "activity", "price_permanent", "stock_adjust", "void_bill"],
  Cashier: ["billing", "customers", "sales"],
  Staff: ["billing"],
};

export const FALLBACK_UNITS = ["Piece", "Pair", "Box", "Pack", "Dozen", "Kg", "Gram", "Litre", "Meter", "Bottle", "Set", "Other"];

export const AppProvider = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [shop, setShop] = useState(null);
  const [settings, setSettings] = useState(null);
  const [license, setLicense] = useState(null);
  const [meta, setMeta] = useState(null);          // business types / units / template
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [tick, setTick] = useState(0);
  const flushing = useRef(false);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const loadShop = useCallback(async () => {
    try {
      const data = await api.get("/shop");
      setShop(data.shop);
      setSettings({ ...data.shop, ...data.settings });
      setLicense(data.license);
      await cacheSet("shopMeta", { shop: data.shop, settings: { ...data.shop, ...data.settings } });
    } catch {
      const cached = await cacheGet("shopMeta");
      if (cached) { setShop(cached.shop); setSettings(cached.settings); }
    }
    try {
      const t = await api.get("/templates");
      setMeta(t);
      await cacheSet("templates", t);
    } catch {
      const cached = await cacheGet("templates");
      if (cached) setMeta(cached);
    }
  }, []);

  const boot = useCallback(async () => {
    if (!getToken()) { setReady(true); return; }
    try {
      const data = await api.get("/auth/me");
      setUser(data.user);
      setShop(data.shop);
      await loadShop();
    } catch (e) {
      if (e?.response?.status === 401) { setToken(""); setUser(null); }
    } finally {
      setReady(true);
    }
  }, [loadShop]);

  useEffect(() => { boot(); }, [boot]);

  const sync = useCallback(async () => {
    if (flushing.current || !navigator.onLine || !getToken()) return;
    flushing.current = true;
    try {
      const sent = await flushOutbox();
      if (sent) {
        toast.success(`${sent} offline bill(s) synced to cloud`);
        refresh();
      }
      setPending(await outboxCount());
    } finally {
      flushing.current = false;
    }
  }, [refresh]);

  useEffect(() => {
    const on = () => { setOnline(true); sync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    outboxCount().then(setPending);
    sync();
    const t = setInterval(() => { if (navigator.onLine) { sync(); setTick((x) => x + 1); } }, 20000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t);
    };
  }, [sync]);

  const afterAuth = async (data) => {
    setToken(data.token);
    setUser(data.user);
    setShop(data.shop || null);
    await loadShop();
  };

  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });
    if (data.user?.platformRole === "superadmin") {
      setToken(data.token);
      setUser(data.user);
      return { admin: true };
    }
    await afterAuth(data);
    return { admin: false };
  };

  const signupShop = async (payload) => {
    const data = await api.post("/auth/signup-shop", payload);
    await afterAuth(data);
    return data;
  };

  // idToken = real Firebase ID token from signInWithGoogle(). businessName is only
  // needed the first time a brand-new Google account signs in (no shop yet) —
  // the backend replies { needsShop: true } so the UI can ask for it and retry.
  const loginWithGoogle = async (idToken, businessName = "", businessType = "General Retail") => {
    const data = await api.post("/auth/google", { idToken, businessName, businessType });
    if (data.needsShop) return data;
    await afterAuth(data);
    return data;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    await firebaseSignOut();
    setToken("");
    setUser(null);
    setShop(null);
  };

  const can = (perm) => {
    if (!user) return false;
    const list = PERMS[user.role] || [];
    return list.includes("*") || list.includes(perm);
  };

  const saveSettings = async (patch) => {
    const data = await api.put("/shop", patch);
    setShop(data.shop);
    setSettings({ ...data.shop, ...data.settings });
    await loadShop();
  };

  // business-type driven defaults (never restrictions)
  const template = meta?.template || { categories: { General: ["Items"] }, customFields: [], attributes: ["Size", "Color"], defaultUnit: "Piece" };
  const units = [...(meta?.units || FALLBACK_UNITS), ...(settings?.customUnits || [])];

  return (
    <AppCtx.Provider value={{ ready, user, shop, settings, license, meta, template, units, online, pending, tick, refresh, login, loginWithGoogle, signupShop, logout, can, saveSettings, loadShop, apiError, sync }}>
      {children}
    </AppCtx.Provider>
  );
};
