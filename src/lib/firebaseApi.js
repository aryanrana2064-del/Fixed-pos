// Replaces src/lib/api.js's axios calls to the old Python/Mongo backend.
// Every function here is a thin wrapper around a Cloud Function (see
// functions/main.py) or a direct Firestore read (governed by firestore.rules).
import { functions, httpsCallable, auth, refreshClaims } from "./firebase";
import {
  getFirestore, collection, query, where, orderBy, limit as fbLimit, getDocs,
} from "firebase/firestore";

const db = getFirestore();

function call(name) {
  return httpsCallable(functions, name);
}

// Call this once, right after a successful signInWithGoogle / signInWithEmail
// / signUpWithEmail. Creates the shop on first login, or attaches
// role/shopId claims for a returning user. Throws a friendly error if the
// account has been disabled (see functions/main.py: bootstrap_account).
export async function bootstrapAccount({ businessName, businessType, device = "web" } = {}) {
  const fn = call("bootstrap_account");
  const { data } = await fn({ businessName, businessType, device });
  await refreshClaims(); // so request.auth.token.shopId/role is available right away
  return data;
}

export async function createSale(sale) {
  const { data } = await call("create_sale")(sale);
  return data;
}

export async function adjustStock(adjustment) {
  const { data } = await call("adjust_stock")(adjustment);
  return data;
}

// Plain reads go straight to Firestore (rules restrict each user to their
// own shopId — see firestore.rules) instead of round-tripping through a
// Cloud Function.
export async function listProducts(shopId) {
  const q = query(collection(db, "products"), where("shopId", "==", shopId), orderBy("name"));
  return (await getDocs(q)).docs.map((d) => d.data());
}

export async function listSales(shopId, max = 200) {
  const q = query(
    collection(db, "sales"),
    where("shopId", "==", shopId),
    orderBy("createdAt", "desc"),
    fbLimit(max)
  );
  return (await getDocs(q)).docs.map((d) => d.data());
}

export function currentUser() {
  return auth?.currentUser || null;
}
