/* Cloud data layer with offline cache (IndexedDB) + offline bill queue. */
import { openDB } from "idb";
import { api, DEVICE_ID } from "./api";

export { DEVICE_ID };

const CACHE_DB = "vyro-cache";
const COLLECTIONS = ["products", "customers", "suppliers", "sales", "purchases", "returns", "movements", "activity", "payments", "users"];

let dbp;
const cache = () => {
  if (!dbp) {
    dbp = openDB(CACHE_DB, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "clientRef" });
      },
    });
  }
  return dbp;
};

export const cacheSet = async (key, value) => (await cache()).put("kv", value, key);
export const cacheGet = async (key) => (await cache()).get("kv", key);

export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const nowISO = () => new Date().toISOString();

export const CATEGORY_TREE = { General: ["Items", "Accessories"] };

/* ---------- reads: network first, cache fallback (offline) ---------- */
export const all = async (name) => {
  if (!COLLECTIONS.includes(name)) return [];
  try {
    const data = await api.get(`/${name}`);
    await cacheSet(name, data);
    return data;
  } catch (e) {
    if (e?.response) throw e;
    return (await cacheGet(name)) || [];
  }
};

export const one = async (name, id) => (await all(name)).find((x) => x.id === id) || null;

/* ---------- writes ---------- */
export const put = async (name, value) => {
  if (name === "products") return value.id ? api.put(`/products/${value.id}`, value) : api.post("/products", value);
  if (name === "customers") return value.id ? api.put(`/customers/${value.id}`, value) : api.post("/customers", value);
  if (name === "suppliers") return value.id ? api.put(`/suppliers/${value.id}`, value) : api.post("/suppliers", value);
  if (name === "users") return value.id ? api.patch(`/users/${value.id}`, value) : api.post("/users", value);
  throw new Error("UNSUPPORTED_WRITE");
};

export const remove = async (name, id) => {
  if (name === "products") return api.del(`/products/${id}`);
  if (name === "users") return api.patch(`/users/${id}`, { active: false });
  throw new Error("UNSUPPORTED_DELETE");
};

/* ---------- offline bill queue ---------- */
export const queueSale = async (payload) => {
  const db = await cache();
  await db.put("outbox", { ...payload, queuedAt: nowISO() });
};

export const outboxCount = async () => (await cache()).count("outbox");

export const flushOutbox = async () => {
  const db = await cache();
  const pending = await db.getAll("outbox");
  let sent = 0;
  for (const item of pending) {
    try {
      const { queuedAt, ...body } = item;
      await api.post("/sales", body);
      await db.delete("outbox", item.clientRef);
      sent += 1;
    } catch (e) {
      if (e?.response?.status >= 400 && e?.response?.status < 500) {
        await db.delete("outbox", item.clientRef); // rejected permanently (e.g. stock)
        continue; // keep syncing the rest of the queue
      }
      break; // likely offline/server down — stop this round, retry later
    }
  }
  return sent;
};
