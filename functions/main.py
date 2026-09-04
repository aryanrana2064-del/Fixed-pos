"""
VYRO VX7 — Firebase Cloud Functions "worker".

This replaces server/server.py + MongoDB. There is no hosted API and no
connection string to protect: these functions run *inside* Firebase, use the
Admin SDK (which is auto-authenticated by Firebase — no key file to manage),
and Firestore replaces MongoDB. The web app and the APK both call these
functions directly with the Firebase client SDK (httpsCallable), using the
Firebase Auth ID token they already have from sign-in.

This is a first migration slice covering the flows that need server-side
trust (auth bootstrap, atomic stock movement, permission checks). Plain
reads/lists and simple edits (products, customers) are done straight from
the client against Firestore, governed by firestore.rules.
"""
import datetime
import secrets
import string

from firebase_admin import initialize_app, auth as fb_auth, firestore
from firebase_functions import https_fn, options
from google.cloud.firestore_v1 import Increment, Transaction

initialize_app()
db = firestore.client()

options.set_global_options(region="asia-south1", max_instances=10)

PERMS = {
    "Owner": {"*"},
    "Manager": {"product:write", "stock:adjust", "sale:create", "sale:void", "purchase:write",
                "party:write", "return:write", "report:read", "price:permanent", "settings:read"},
    "Cashier": {"sale:create", "party:write"},
    "Staff": {"sale:create"},
}
DEFAULT_SETTINGS = {
    "invoicePrefix": "INV-", "purchasePrefix": "PUR-", "defaultTax": 5, "defaultPayment": "Cash",
    "autoPrint": False, "minStock": 5, "allowNegativeStock": False, "receiptWidth": "80mm", "logo": "",
    "customUnits": [],
}
PLAN_DAYS = {"Trial": 14, "Starter": 30, "Pro": 30, "Business": 30, "Lifetime": 365 * 20}
PLAN_DEVICES = {"Trial": 2, "Starter": 1, "Pro": 3, "Business": 10, "Lifetime": 5}


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def new_id() -> str:
    return db.collection("_").document().id


def make_license_key() -> str:
    part = lambda: "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(4))
    return f"JBX-{part()}-{part()}-{part()}"


def require_auth(req: https_fn.CallableRequest):
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "Please sign in to continue")
    return req.auth


def require_perm(req: https_fn.CallableRequest, *perms: str):
    """Mirrors the old `require()` dependency, but reads role/shopId from the
    Firebase Auth custom claims set by bootstrap_account (no DB round trip)."""
    auth = require_auth(req)
    claims = auth.token or {}
    role = claims.get("role")
    shop_id = claims.get("shopId")
    if claims.get("platformRole") == "superadmin" and not shop_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Use the shop app with a shop account")
    if role not in PERMS:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "You do not have access to this action")
    allowed = PERMS[role]
    if "*" not in allowed and perms and not set(perms).issubset(allowed):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Your role cannot perform this action")
    return auth.uid, shop_id, role


# --------------------------------------------------------------------------
# Auth bootstrap — called once right after Firebase Auth sign-in (Google OR
# email/password, both already handled by Firebase Auth on the client). This
# is where "new user -> create shop" or "existing user -> attach claims"
# happens. Equivalent of the old /auth/google and /auth/signup-shop routes,
# minus the crash bug: a disabled account is rejected with a clear error
# instead of being treated as brand-new (which is what caused the old crash).
# --------------------------------------------------------------------------
@https_fn.on_call()
def bootstrap_account(req: https_fn.CallableRequest):
    auth = require_auth(req)
    email = (auth.token.get("email") or "").lower().strip()
    if not email:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Your account has no email on file")
    name = auth.token.get("name") or email.split("@")[0]
    data = req.data or {}

    users = db.collection("users")
    existing_q = list(users.where("email", "==", email).limit(1).stream())
    existing = existing_q[0].to_dict() if existing_q else None

    if existing and not existing.get("active", True):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED,
                                   "This account has been disabled. Please contact your shop owner")

    if existing:
        # existing account -> just (re)attach claims + link uid, sign in
        users.document(existing["id"]).update({"authUid": auth.uid, "updatedAt": now_iso()})
        fb_auth.set_custom_user_claims(auth.uid, {
            "shopId": existing.get("shopId"), "role": existing.get("role"),
            "platformRole": existing.get("platformRole"),
        })
        db.collection("activity").document(new_id()).set({
            "id": new_id(), "shopId": existing.get("shopId"), "action": "LOGIN",
            "detail": f"{existing['name']} signed in", "user": existing["name"],
            "device": data.get("device", "web"), "createdAt": now_iso(),
        })
        return {"status": "signed_in", "shopId": existing.get("shopId"), "role": existing.get("role")}

    # brand-new user -> create their shop (first-login-creates-shop flow)
    business_name = (data.get("businessName") or f"{name}'s Shop").strip()
    business_type = data.get("businessType") or "General Retail"
    shop_id = new_id()
    db.collection("shops").document(shop_id).set({
        "id": shop_id, "businessName": business_name, "businessType": business_type,
        "address": "", "phone": "", "gstin": "", "createdAt": now_iso(),
    })
    db.collection("settings").document(new_id()).set({
        "id": new_id(), "shopId": shop_id, **DEFAULT_SETTINGS, "updatedAt": now_iso(),
    })
    key = make_license_key()
    db.collection("licenses").document(new_id()).set({
        "id": new_id(), "key": key, "business": business_name, "plan": "Trial", "status": "Active",
        "deviceLimit": PLAN_DEVICES["Trial"], "devices": [], "shopId": shop_id,
        "expiry": (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=PLAN_DAYS["Trial"])).isoformat(),
        "createdAt": now_iso(),
    })
    user_id = new_id()
    users.document(user_id).set({
        "id": user_id, "shopId": shop_id, "name": name, "email": email, "authUid": auth.uid,
        "role": "Owner", "active": True, "createdAt": now_iso(),
    })
    fb_auth.set_custom_user_claims(auth.uid, {"shopId": shop_id, "role": "Owner"})
    db.collection("activity").document(new_id()).set({
        "id": new_id(), "shopId": shop_id, "action": "SHOP_CREATED", "detail": business_name,
        "user": name, "device": data.get("device", "web"), "createdAt": now_iso(),
    })
    return {"status": "shop_created", "shopId": shop_id, "role": "Owner", "licenseKey": key}


# --------------------------------------------------------------------------
# Stock movement helper — atomic (Firestore transaction == the $inc fix from
# the Mongo version), used by both create_sale and adjust_stock below.
# --------------------------------------------------------------------------
@firestore.transactional
def _move_stock_txn(transaction: Transaction, shop_id: str, product_id: str, delta: float,
                     reason: str, ref: str, kind: str, user_name: str):
    prod_ref = db.collection("products").document(product_id)
    snap = prod_ref.get(transaction=transaction)
    if not snap.exists or snap.get("shopId") != shop_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.NOT_FOUND, "Product not found")
    prev_stock = float(snap.get("stock") or 0)
    new_stock = prev_stock + delta
    transaction.update(prod_ref, {"stock": Increment(delta), "updatedAt": now_iso()})
    move_id = new_id()
    transaction.set(db.collection("movements").document(move_id), {
        "id": move_id, "shopId": shop_id, "productId": product_id, "productName": snap.get("name"),
        "qty": abs(delta), "type": kind, "reason": reason, "prevStock": prev_stock, "newStock": new_stock,
        "user": user_name, "ref": ref, "createdAt": now_iso(),
    })
    return new_stock


# --------------------------------------------------------------------------
# Stock adjust (manual +/-). Same fix as before: the adjustment gets its own
# id and that id is stored as `ref`, not a fixed "adjust" string.
# --------------------------------------------------------------------------
@https_fn.on_call()
def adjust_stock(req: https_fn.CallableRequest):
    uid, shop_id, role = require_perm(req, "stock:adjust")
    data = req.data or {}
    product_id = data.get("productId")
    qty = abs(float(data.get("qty", 0)))
    kind = data.get("type")
    reason = data.get("reason") or "Manual Adjustment"
    if not product_id or qty <= 0 or kind not in ("in", "out"):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Invalid adjustment")

    user_name = req.auth.token.get("name") or req.auth.token.get("email", "")

    adjustment_id = new_id()
    db.collection("adjustments").document(adjustment_id).set({
        "id": adjustment_id, "shopId": shop_id, "productId": product_id, "qty": qty,
        "type": kind, "reason": reason, "user": user_name, "createdAt": now_iso(),
    })
    delta = qty if kind == "in" else -qty
    transaction = db.transaction()
    new_stock = _move_stock_txn(transaction, shop_id, product_id, delta, reason, adjustment_id, kind, user_name)
    db.collection("activity").document(new_id()).set({
        "id": new_id(), "shopId": shop_id, "action": "STOCK_ADJUST",
        "detail": f"{'+' if kind == 'in' else '-'}{qty} ({reason})", "user": user_name,
        "device": data.get("device", "web"), "createdAt": now_iso(),
    })
    return {"productId": product_id, "newStock": new_stock}


# --------------------------------------------------------------------------
# Create sale. Same fix as before: if the due amount (total - paid) is > 0
# on ANY payment mode, a customerId is required — not just for "Credit" —
# so the balance is never silently dropped.
# --------------------------------------------------------------------------
@https_fn.on_call()
def create_sale(req: https_fn.CallableRequest):
    uid, shop_id, role = require_perm(req, "sale:create")
    data = req.data or {}
    items = data.get("items") or []
    if not items:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Add at least one item")
    customer_id = data.get("customerId") or ""
    discount = float(data.get("discount", 0))
    tax_percent = float(data.get("taxPercent", 0))
    payments = data.get("payments") or []
    user_name = req.auth.token.get("name") or req.auth.token.get("email", "")

    subtotal = sum(float(i["price"]) * float(i["qty"]) for i in items)
    taxable = max(subtotal - discount, 0)
    tax = round(taxable * tax_percent / 100, 2)
    total = round(taxable + tax, 2)
    paid = round(sum(float(p.get("amount", 0)) for p in payments), 2)
    due = round(total - paid, 2)

    if due > 0 and not customer_id:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                   "Select a customer to record the due amount")

    sale_id = new_id()
    transaction = db.transaction()
    for item in items:
        delta = -abs(float(item["qty"]))
        _move_stock_txn(transaction, shop_id, item["productId"], delta, "Sale", sale_id, "out", user_name)

    profit = sum((float(i["price"]) - float(i.get("purchasePrice", 0))) * float(i["qty"]) for i in items)
    db.collection("sales").document(sale_id).set({
        "id": sale_id, "shopId": shop_id, "items": items, "customerId": customer_id,
        "subtotal": round(subtotal, 2), "discount": discount, "tax": tax, "total": total,
        "paid": paid, "due": due, "profit": round(profit, 2), "payments": payments,
        "note": data.get("note", ""), "clientRef": data.get("clientRef", ""),
        "device": data.get("device", "web"), "user": user_name, "status": "completed",
        "createdAt": now_iso(),
    })
    if due > 0 and customer_id:
        db.collection("parties").document(customer_id).update({"balance": Increment(due), "updatedAt": now_iso()})
    return {"saleId": sale_id, "total": total, "due": due}
