"""VYRO VX7 — Smart Business POS cloud API (multi-shop, JWT auth, license management)."""
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Any, Literal

import uuid
import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator
from starlette.middleware.cors import CORSMiddleware
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_auth_requests

from templates import BUSINESS_TYPES, TEMPLATES, UNITS, template_for
from firestore_db import get_db

# Firestore is now the only database — no MongoDB connection needed.
db = get_db()

JWT_SECRET = os.environ.get('JWT_SECRET', 'dev-jwt-secret-change-me')
JWT_ALG = "HS256"
ACCESS_MIN = 60 * 12

# Firebase project ID (from Firebase console -> Project settings -> General).
# Used to verify Google Sign-In ID tokens issued by Firebase Auth on the frontend.
FIREBASE_PROJECT_ID = os.environ.get('FIREBASE_PROJECT_ID', '')
_google_auth_req = google_auth_requests.Request()

app = FastAPI(title="VYRO VX7 API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)
log = logging.getLogger("jewelbox")
logging.basicConfig(level=logging.INFO)


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso() -> str:
    return now().isoformat()


def oid() -> str:
    return uuid.uuid4().hex


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def create_token(payload: dict, minutes: int = ACCESS_MIN) -> str:
    return jwt.encode({**payload, "exp": now() + timedelta(minutes=minutes)}, JWT_SECRET, algorithm=JWT_ALG)


# ---------------------------------------------------------------- permissions
PERMS = {
    "Owner": {"*"},
    "Manager": {"product:write", "stock:adjust", "sale:create", "sale:void", "purchase:write", "party:write",
                "return:write", "report:read", "price:permanent", "settings:read"},
    "Cashier": {"sale:create", "party:write"},
    "Staff": {"sale:create"},
}
READ_ROLES = {"Owner", "Manager", "Cashier", "Staff"}


class Principal(BaseModel):
    user_id: str
    shop_id: Optional[str] = None
    name: str = ""
    email: str = ""
    role: Optional[str] = None
    platform_role: Optional[str] = None


async def current_principal(
    request: Request, cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer)
) -> Principal:
    token = cred.credentials if cred else request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in to continue")
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired. Please sign in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = await db.users.find_one({"id": data.get("sub"), "active": True})
    if not user:
        raise HTTPException(status_code=401, detail="Account not found or disabled")
    return Principal(
        user_id=user["id"], shop_id=user.get("shopId"), name=user["name"], email=user["email"],
        role=user.get("role"), platform_role=user.get("platformRole"),
    )


def require(*perms: str):
    async def dep(p: Principal = Depends(current_principal)) -> Principal:
        if p.platform_role == "superadmin" and not p.shop_id:
            raise HTTPException(status_code=403, detail="Use the shop app with a shop account")
        if p.role not in READ_ROLES:
            raise HTTPException(status_code=403, detail="You do not have access to this action")
        allowed = PERMS.get(p.role, set())
        if "*" in allowed:
            return p
        if perms and not set(perms).issubset(allowed):
            raise HTTPException(status_code=403, detail="Your role cannot perform this action")
        return p
    return dep


async def require_super(p: Principal = Depends(current_principal)) -> Principal:
    if p.platform_role != "superadmin":
        raise HTTPException(status_code=403, detail="Admin access only")
    return p


def scope(p: Principal, extra: dict | None = None) -> dict:
    q = {"shopId": p.shop_id}
    if extra:
        q.update(extra)
    return q


def clean(doc: dict | None) -> dict | None:
    if not doc:
        return None
    doc.pop("_id", None)
    doc.pop("passwordHash", None)
    return doc


async def audit(p: Principal, action: str, detail: str, device: str = "web"):
    await db.activity.insert_one({
        "id": oid(), "shopId": p.shop_id, "action": action, "detail": detail,
        "user": p.name, "device": device, "createdAt": iso(),
    })


async def next_number(shop_id: str, key: str, prefix: str) -> str:
    doc = await db.counters.find_one_and_update(
        {"shopId": shop_id, "key": key}, {"$inc": {"value": 1}}, upsert=True, return_document=True
    )
    return f"{prefix}{str(doc['value']).zfill(4)}"


DEFAULT_SETTINGS = {
    "invoicePrefix": "INV-", "purchasePrefix": "PUR-", "defaultTax": 5, "defaultPayment": "Cash",
    "autoPrint": False, "minStock": 5, "allowNegativeStock": False, "receiptWidth": "80mm", "logo": "",
    "customUnits": [],
}


# ---------------------------------------------------------------- schemas
class ShopSignup(BaseModel):
    businessName: str = Field(min_length=2)
    businessType: str = "General Retail"
    address: str = ""
    phone: str = ""
    gstin: str = ""
    ownerName: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=6)


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthIn(BaseModel):
    idToken: str = Field(min_length=10)
    # Only used the first time a brand-new Google user signs in (no existing shop found
    # for their email) so we can create their shop the same way email signup does.
    businessName: str = ""
    businessType: str = "General Retail"


class UserIn(BaseModel):
    name: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=6)
    role: Literal["Owner", "Manager", "Cashier", "Staff"] = "Cashier"


class UserPatch(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["Owner", "Manager", "Cashier", "Staff"]] = None
    password: Optional[str] = None
    active: Optional[bool] = None


class ProductVariant(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = ""            # e.g. "Black / M"
    sku: str = ""
    barcode: str = ""
    price: float = 0
    stock: float = 0


class ProductIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    brand: str = ""
    category: str = "General"
    subcategory: str = ""
    purchasePrice: float = 0
    price: float = 0
    mrp: float = 0
    discount: float = 0
    stock: float = 0
    minStock: float = 5
    maxStock: float = 0
    unit: str = "Piece"
    supplier: str = ""
    barcode: str = ""
    location: str = ""
    gst: float = 0
    notes: str = ""
    description: str = ""
    photo: str = ""
    variants: List[ProductVariant] = []
    custom: dict = {}

    @field_validator("custom")
    @classmethod
    def cap_custom(cls, v: dict) -> dict:
        if len(v) > 40:
            raise ValueError("Too many extra details")
        return {str(k)[:40]: (str(x)[:500] if not isinstance(x, (int, float, bool)) else x) for k, x in v.items()}


class PartyIn(BaseModel):
    name: str = Field(min_length=1)
    phone: str = ""
    address: str = ""
    openingBalance: float = 0


class SaleItem(BaseModel):
    productId: str
    name: str = ""
    code: str = ""
    price: float
    qty: float
    purchasePrice: float = 0


class PaymentIn(BaseModel):
    mode: Literal["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"] = "Cash"
    amount: float = 0


class SaleIn(BaseModel):
    items: List[SaleItem]
    customerId: str = ""
    discount: float = 0
    taxPercent: float = 0
    payments: List[PaymentIn] = []
    note: str = ""
    clientRef: str = ""       # idempotency key from device (offline queue safe)
    device: str = "web"


class VoidIn(BaseModel):
    reason: str = Field(min_length=2)


class PurchaseIn(BaseModel):
    supplierId: str = ""
    supplierInvoice: str = ""
    items: List[SaleItem]
    taxPercent: float = 0
    paid: float = 0


class ReturnIn(BaseModel):
    kind: Literal["sale", "purchase"]
    refId: str = ""
    items: List[SaleItem]


class AdjustIn(BaseModel):
    productId: str
    qty: float
    type: Literal["in", "out"]
    reason: str = "Manual Adjustment"


class PaymentReceiveIn(BaseModel):
    amount: float
    mode: Literal["Cash", "UPI", "Card", "Bank Transfer", "Other"] = "Cash"
    note: str = ""


class PriceIn(BaseModel):
    price: float


class LicenseCreate(BaseModel):
    business: str
    plan: Literal["Trial", "Starter", "Pro", "Business", "Lifetime"] = "Starter"
    deviceLimit: Optional[int] = None
    notes: str = ""


class LicensePatch(BaseModel):
    key: str
    plan: Optional[str] = None
    status: Optional[Literal["Active", "Revoked", "Expired"]] = None
    extendDays: Optional[int] = None
    deviceLimit: Optional[int] = None


class ActivateIn(BaseModel):
    key: str
    deviceId: str = "web"


PLAN_DAYS = {"Trial": 14, "Starter": 30, "Pro": 30, "Business": 30, "Lifetime": 365 * 20}
PLAN_DEVICES = {"Trial": 2, "Starter": 1, "Pro": 3, "Business": 10, "Lifetime": 5}


def make_key() -> str:
    part = lambda: "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(4))
    return f"JBX-{part()}-{part()}-{part()}"


async def make_unique_key() -> str:
    for _ in range(10):
        key = make_key()
        if not await db.licenses.find_one({"key": key}):
            return key
    raise HTTPException(status_code=500, detail="Could not generate a key. Please try again")


# ---------------------------------------------------------------- movements
async def move(shop_id: str, product: dict, qty: float, kind: str, reason: str, ref: str, user: str):
    delta = qty if kind == "in" else -qty
    updated = await db.products.find_one_and_update(
        {"id": product["id"], "shopId": shop_id},
        {"$inc": {"stock": delta}, "$set": {"updatedAt": iso()}},
        return_document=True,
    )
    new = float(updated.get("stock", 0)) if updated else float(product.get("stock", 0)) + delta
    prev = new - delta
    await db.movements.insert_one({
        "id": oid(), "shopId": shop_id, "productId": product["id"], "productName": product["name"],
        "qty": qty, "type": kind, "reason": reason, "prevStock": prev, "newStock": new,
        "user": user, "ref": ref, "createdAt": iso(),
    })


# ---------------------------------------------------------------- auth routes
@api.get("/")
async def health():
    return {"app": "VYRO VX7 — Smart Business POS", "status": "ok", "mode": "cloud"}


def set_cookies(response: Response, token: str):
    return  # SPA authenticates with the Bearer token; no cookie surface needed


@api.post("/auth/signup-shop")
async def signup_shop(body: ShopSignup, response: Response):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="This email is already registered")
    shop_id = oid()
    await db.shops.insert_one({
        "id": shop_id, "businessName": body.businessName.strip(), "businessType": body.businessType,
        "address": body.address, "phone": body.phone, "gstin": body.gstin, "createdAt": iso(),
    })
    await db.settings.insert_one({"id": oid(), "shopId": shop_id, **DEFAULT_SETTINGS,
                                  "defaultTax": template_for(body.businessType).get("defaultTax", 5),
                                  "updatedAt": iso()})
    key = await make_unique_key()
    await db.licenses.insert_one({
        "id": oid(), "key": key, "business": body.businessName.strip(), "plan": "Trial", "status": "Active",
        "deviceLimit": PLAN_DEVICES["Trial"], "devices": [], "shopId": shop_id,
        "expiry": (now() + timedelta(days=PLAN_DAYS["Trial"])).isoformat(), "createdAt": iso(),
    })
    user_id = oid()
    await db.users.insert_one({
        "id": user_id, "shopId": shop_id, "name": body.ownerName.strip(), "email": email,
        "passwordHash": hash_password(body.password), "role": "Owner", "active": True, "createdAt": iso(),
    })
    token = create_token({"sub": user_id})
    set_cookies(response, token)
    await db.activity.insert_one({"id": oid(), "shopId": shop_id, "action": "SHOP_CREATED",
                                 "detail": body.businessName, "user": body.ownerName, "device": "web",
                                 "createdAt": iso()})
    return {"token": token, "user": {"id": user_id, "name": body.ownerName, "email": email, "role": "Owner",
                                     "shopId": shop_id}, "licenseKey": key}


@api.post("/auth/login")
async def login(body: LoginReq, response: Response):
    email = body.email.lower().strip()
    ident = f"{email}"
    att = await db.login_attempts.find_one({"identifier": ident}) or {}
    if att.get("count", 0) >= 5 and att.get("until") and datetime.fromisoformat(att["until"]) > now():
        raise HTTPException(status_code=429, detail="Too many attempts. Try again in a few minutes")
    user = await db.users.find_one({"email": email, "active": True})
    if not user or not verify_password(body.password, user["passwordHash"]):
        count = att.get("count", 0) + 1
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$set": {"count": count, "until": (now() + timedelta(minutes=15)).isoformat()}}, upsert=True)
        raise HTTPException(status_code=401, detail="Wrong email or password")
    await db.login_attempts.delete_one({"identifier": ident})
    token = create_token({"sub": user["id"]})
    set_cookies(response, token)
    shop = await db.shops.find_one({"id": user.get("shopId")}) if user.get("shopId") else None
    await db.activity.insert_one({"id": oid(), "shopId": user.get("shopId"), "action": "LOGIN",
                                 "detail": f"{user['name']} signed in", "user": user["name"],
                                 "device": "web", "createdAt": iso()})
    return {"token": token, "user": clean(dict(user)), "shop": clean(dict(shop)) if shop else None}


@api.post("/auth/google")
async def auth_google(body: GoogleAuthIn, response: Response):
    if not FIREBASE_PROJECT_ID:
        raise HTTPException(status_code=500, detail="Google sign-in is not configured on the server (missing FIREBASE_PROJECT_ID)")
    try:
        claims = google_id_token.verify_firebase_token(body.idToken, _google_auth_req, audience=FIREBASE_PROJECT_ID)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid or expired Google sign-in. Please try again")
    if not claims.get("email"):
        raise HTTPException(status_code=400, detail="Your Google account has no email on file")
    email = claims["email"].lower().strip()
    google_uid = claims.get("user_id") or claims.get("sub")
    name = claims.get("name") or email.split("@")[0]

    existing_any = await db.users.find_one({"email": email})
    if existing_any and not existing_any.get("active", True):
        raise HTTPException(status_code=403, detail="This account has been disabled. Please contact your shop owner")

    user = await db.users.find_one({"email": email, "active": True})

    if user:
        # existing account -> link Google (if not already) and sign in
        if not user.get("googleId"):
            await db.users.update_one({"id": user["id"]}, {"$set": {"googleId": google_uid, "updatedAt": iso()}})
            user["googleId"] = google_uid
        token = create_token({"sub": user["id"]})
        set_cookies(response, token)
        shop = await db.shops.find_one({"id": user.get("shopId")}) if user.get("shopId") else None
        await db.activity.insert_one({"id": oid(), "shopId": user.get("shopId"), "action": "LOGIN",
                                     "detail": f"{user['name']} signed in with Google", "user": user["name"],
                                     "device": "web", "createdAt": iso()})
        return {"token": token, "user": clean(dict(user)), "shop": clean(dict(shop)) if shop else None, "isNew": False}

    # brand-new Google user -> needs a shop; ask the frontend for a business name first
    if not body.businessName.strip():
        return {"needsShop": True, "suggestedName": name, "email": email}

    shop_id = oid()
    await db.shops.insert_one({
        "id": shop_id, "businessName": body.businessName.strip(), "businessType": body.businessType,
        "address": "", "phone": "", "gstin": "", "createdAt": iso(),
    })
    await db.settings.insert_one({"id": oid(), "shopId": shop_id, **DEFAULT_SETTINGS,
                                  "defaultTax": template_for(body.businessType).get("defaultTax", 5),
                                  "updatedAt": iso()})
    key = await make_unique_key()
    await db.licenses.insert_one({
        "id": oid(), "key": key, "business": body.businessName.strip(), "plan": "Trial", "status": "Active",
        "deviceLimit": PLAN_DEVICES["Trial"], "devices": [], "shopId": shop_id,
        "expiry": (now() + timedelta(days=PLAN_DAYS["Trial"])).isoformat(), "createdAt": iso(),
    })
    user_id = oid()
    await db.users.insert_one({
        "id": user_id, "shopId": shop_id, "name": name, "email": email,
        "googleId": google_uid, "passwordHash": None, "role": "Owner", "active": True, "createdAt": iso(),
    })
    token = create_token({"sub": user_id})
    set_cookies(response, token)
    await db.activity.insert_one({"id": oid(), "shopId": shop_id, "action": "SHOP_CREATED",
                                 "detail": body.businessName, "user": name, "device": "web", "createdAt": iso()})
    return {"token": token, "user": {"id": user_id, "name": name, "email": email, "role": "Owner", "shopId": shop_id},
            "shop": clean(await db.shops.find_one({"id": shop_id})), "licenseKey": key, "isNew": True}


@api.get("/auth/me")
async def me(p: Principal = Depends(current_principal)):
    shop = await db.shops.find_one({"id": p.shop_id}) if p.shop_id else None
    return {"user": p.model_dump(), "shop": clean(dict(shop)) if shop else None}


@api.post("/auth/logout")
async def logout():
    return {"ok": True}


# ---------------------------------------------------------------- shop + settings
@api.get("/templates")
async def get_templates(p: Principal = Depends(current_principal)):
    shop = await db.shops.find_one({"id": p.shop_id}) if p.shop_id else None
    btype = (shop or {}).get("businessType", "General Retail")
    return {"businessTypes": BUSINESS_TYPES, "units": UNITS, "current": btype,
            "template": template_for(btype), "all": TEMPLATES}


@api.get("/shop")
async def get_shop(p: Principal = Depends(require())):
    shop = clean(await db.shops.find_one({"id": p.shop_id})) or {}
    s = clean(await db.settings.find_one({"shopId": p.shop_id})) or dict(DEFAULT_SETTINGS)
    lic = clean(await db.licenses.find_one({"shopId": p.shop_id}))
    return {"shop": shop, "settings": {**shop, **s}, "license": lic}


@api.put("/shop")
async def update_shop(body: dict, p: Principal = Depends(require("settings:read"))):
    shop_fields = {k: body[k] for k in ("businessName", "businessType", "address", "phone", "gstin") if k in body}
    if shop_fields:
        await db.shops.update_one({"id": p.shop_id}, {"$set": {**shop_fields, "updatedAt": iso()}})
    setting_fields = {k: body[k] for k in DEFAULT_SETTINGS if k in body}
    if setting_fields:
        await db.settings.update_one({"shopId": p.shop_id}, {"$set": {**setting_fields, "updatedAt": iso()}},
                                     upsert=True)
    await audit(p, "SETTINGS_CHANGE", "Business / billing settings updated")
    return await get_shop(p)


# ---------------------------------------------------------------- users
@api.get("/users")
async def list_users(p: Principal = Depends(require("settings:read"))):
    docs = await db.users.find(scope(p), {"_id": 0, "passwordHash": 0}).to_list(200)
    return docs


@api.post("/users")
async def create_user(body: UserIn, p: Principal = Depends(require("*"))):
    email = body.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="This email is already registered")
    doc = {"id": oid(), "shopId": p.shop_id, "name": body.name.strip(), "email": email,
           "passwordHash": hash_password(body.password), "role": body.role, "active": True, "createdAt": iso()}
    await db.users.insert_one(doc)
    await audit(p, "USER_CREATE", f"{body.name} ({body.role})")
    return clean(doc)


@api.patch("/users/{user_id}")
async def patch_user(user_id: str, body: UserPatch, p: Principal = Depends(require("*"))):
    target = await db.users.find_one(scope(p, {"id": user_id}))
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    patch: dict[str, Any] = {"updatedAt": iso()}
    if body.name:
        patch["name"] = body.name.strip()
    if body.role:
        patch["role"] = body.role
    if body.password:
        patch["passwordHash"] = hash_password(body.password)
    if body.active is not None:
        if target["id"] == p.user_id and body.active is False:
            raise HTTPException(status_code=400, detail="You cannot disable your own account")
        patch["active"] = body.active
    await db.users.update_one({"id": user_id, "shopId": p.shop_id}, {"$set": patch})
    await audit(p, "USER_UPDATE", target["name"])
    return clean(await db.users.find_one({"id": user_id}))


# ---------------------------------------------------------------- products
@api.get("/products")
async def list_products(p: Principal = Depends(require())):
    return await db.products.find(scope(p), {"_id": 0}).sort("name", 1).to_list(5000)


@api.post("/products")
async def create_product(body: ProductIn, p: Principal = Depends(require("product:write"))):
    code = body.code.strip().upper()
    if await db.products.find_one(scope(p, {"code": code})):
        raise HTTPException(status_code=400, detail="Product code already exists")
    if body.barcode and await db.products.find_one(scope(p, {"barcode": body.barcode})):
        raise HTTPException(status_code=400, detail="This barcode is already used by another product")
    doc = {**body.model_dump(), "code": code, "id": oid(), "shopId": p.shop_id,
           "createdAt": iso(), "updatedAt": iso()}
    opening = float(doc["stock"])
    doc["stock"] = 0
    await db.products.insert_one(dict(doc))
    if opening:
        await move(p.shop_id, doc, opening, "in", "Opening Stock", doc["id"], p.name)
    doc = clean(await db.products.find_one({"id": doc["id"]}))
    await audit(p, "PRODUCT_CREATE", doc["name"])
    return doc


@api.put("/products/{pid}")
async def update_product(pid: str, body: ProductIn, p: Principal = Depends(require("product:write"))):
    existing = await db.products.find_one(scope(p, {"id": pid}))
    if not existing:
        raise HTTPException(status_code=404, detail="Product not found")
    code = body.code.strip().upper()
    if await db.products.find_one(scope(p, {"code": code, "id": {"$ne": pid}})):
        raise HTTPException(status_code=400, detail="Product code already exists")
    if body.barcode and await db.products.find_one(scope(p, {"barcode": body.barcode, "id": {"$ne": pid}})):
        raise HTTPException(status_code=400, detail="This barcode is already used by another product")
    patch = {**body.model_dump(), "code": code, "updatedAt": iso()}
    stock_diff = float(body.stock) - float(existing.get("stock", 0))
    patch.pop("stock")
    await db.products.update_one({"id": pid, "shopId": p.shop_id}, {"$set": patch})
    if stock_diff:
        await move(p.shop_id, {**existing, **patch}, abs(stock_diff), "in" if stock_diff > 0 else "out",
                   "Manual Adjustment", pid, p.name)
    if float(existing.get("price", 0)) != float(body.price):
        await db.priceHistory.insert_one({"id": oid(), "shopId": p.shop_id, "productId": pid,
                                          "productName": body.name, "oldPrice": existing.get("price", 0),
                                          "newPrice": body.price, "user": p.name, "createdAt": iso()})
    await audit(p, "PRODUCT_UPDATE", body.name)
    return clean(await db.products.find_one({"id": pid}))


@api.patch("/products/{pid}/price")
async def change_price(pid: str, body: PriceIn, p: Principal = Depends(require("price:permanent"))):
    prod = await db.products.find_one(scope(p, {"id": pid}))
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.products.update_one({"id": pid, "shopId": p.shop_id},
                                 {"$set": {"price": body.price, "updatedAt": iso()}})
    await db.priceHistory.insert_one({"id": oid(), "shopId": p.shop_id, "productId": pid,
                                      "productName": prod["name"], "oldPrice": prod["price"],
                                      "newPrice": body.price, "user": p.name, "createdAt": iso()})
    await audit(p, "PRICE_CHANGE", f"{prod['name']}: {prod['price']} → {body.price}")
    return clean(await db.products.find_one({"id": pid}))


@api.delete("/products/{pid}")
async def delete_product(pid: str, p: Principal = Depends(require("product:write"))):
    prod = await db.products.find_one(scope(p, {"id": pid}))
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    await db.products.delete_one({"id": pid, "shopId": p.shop_id})
    await audit(p, "PRODUCT_DELETE", prod["name"])
    return {"ok": True}


@api.post("/products/import")
async def import_products(body: dict, p: Principal = Depends(require("product:write"))):
    rows: List[dict] = body.get("rows", [])
    mode = body.get("mode", "skip")
    summary = {"created": 0, "updated": 0, "skipped": 0, "failed": 0}
    for r in rows:
        try:
            item = ProductIn(**r)
        except Exception:
            summary["failed"] += 1
            continue
        code = item.code.strip().upper()
        existing = await db.products.find_one(scope(p, {"code": code}))
        if existing:
            if mode == "skip":
                summary["skipped"] += 1
                continue
            if mode == "update":
                await db.products.update_one({"id": existing["id"], "shopId": p.shop_id},
                                             {"$set": {**item.model_dump(), "code": code, "updatedAt": iso()}})
                summary["updated"] += 1
                continue
            code = f"{code}-{secrets.randbelow(900) + 100}"
        await db.products.insert_one({**item.model_dump(), "code": code, "id": oid(), "shopId": p.shop_id,
                                      "createdAt": iso(), "updatedAt": iso()})
        summary["created"] += 1
    await audit(p, "STOCK_IMPORT", f"created {summary['created']}, updated {summary['updated']}")
    return summary


# ---------------------------------------------------------------- parties
@api.get("/customers")
async def list_customers(p: Principal = Depends(require())):
    return await db.customers.find(scope(p), {"_id": 0}).sort("name", 1).to_list(2000)


@api.post("/customers")
async def create_customer(body: PartyIn, p: Principal = Depends(require("party:write"))):
    doc = {**body.model_dump(), "id": oid(), "shopId": p.shop_id, "balance": body.openingBalance,
           "createdAt": iso(), "updatedAt": iso()}
    await db.customers.insert_one(doc)
    await audit(p, "CUSTOMER_CREATE", body.name)
    return clean(doc)


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: PartyIn, p: Principal = Depends(require("party:write"))):
    if not await db.customers.find_one(scope(p, {"id": cid})):
        raise HTTPException(status_code=404, detail="Customer not found")
    await db.customers.update_one({"id": cid, "shopId": p.shop_id}, {"$set": {
        "name": body.name, "phone": body.phone, "address": body.address, "updatedAt": iso()}})
    await audit(p, "CUSTOMER_UPDATE", body.name)
    return clean(await db.customers.find_one({"id": cid}))


@api.post("/customers/{cid}/payment")
async def customer_payment(cid: str, body: PaymentReceiveIn, p: Principal = Depends(require("party:write"))):
    c = await db.customers.find_one(scope(p, {"id": cid}))
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Enter a valid amount")
    await db.customers.update_one({"id": cid, "shopId": p.shop_id},
                                 {"$inc": {"balance": -body.amount}, "$set": {"updatedAt": iso()}})
    await db.payments.insert_one({"id": oid(), "shopId": p.shop_id, "party": "customer", "partyId": cid,
                                  "amount": body.amount, "mode": body.mode, "note": body.note,
                                  "refType": "receipt", "user": p.name, "createdAt": iso()})
    await audit(p, "CUSTOMER_PAYMENT", f"{c['name']} · {body.amount}")
    return clean(await db.customers.find_one({"id": cid}))


@api.get("/customers/{cid}/ledger")
async def customer_ledger(cid: str, p: Principal = Depends(require())):
    c = clean(await db.customers.find_one(scope(p, {"id": cid})))
    if not c:
        raise HTTPException(status_code=404, detail="Customer not found")
    sales = await db.sales.find(scope(p, {"customerId": cid}), {"_id": 0}).to_list(1000)
    pays = await db.payments.find(scope(p, {"partyId": cid, "refType": "receipt"}), {"_id": 0}).to_list(1000)
    rows = []
    if c.get("openingBalance"):
        rows.append({"date": c["createdAt"], "type": "Opening Balance", "debit": c["openingBalance"], "credit": 0})
    for s in sales:
        if s.get("status") == "void":
            continue
        rows.append({"date": s["createdAt"], "type": f"Sale {s['invoiceNo']}", "debit": s["total"], "credit": s["paid"]})
    for x in pays:
        rows.append({"date": x["createdAt"], "type": f"Payment ({x['mode']})", "debit": 0, "credit": x["amount"]})
    rows.sort(key=lambda r: r["date"])
    return {"customer": c, "rows": rows}


@api.get("/suppliers")
async def list_suppliers(p: Principal = Depends(require())):
    return await db.suppliers.find(scope(p), {"_id": 0}).sort("name", 1).to_list(2000)


@api.post("/suppliers")
async def create_supplier(body: PartyIn, p: Principal = Depends(require("party:write"))):
    doc = {**body.model_dump(), "id": oid(), "shopId": p.shop_id, "balance": body.openingBalance,
           "createdAt": iso(), "updatedAt": iso()}
    await db.suppliers.insert_one(doc)
    await audit(p, "SUPPLIER_CREATE", body.name)
    return clean(doc)


@api.put("/suppliers/{sid}")
async def update_supplier(sid: str, body: PartyIn, p: Principal = Depends(require("party:write"))):
    if not await db.suppliers.find_one(scope(p, {"id": sid})):
        raise HTTPException(status_code=404, detail="Supplier not found")
    await db.suppliers.update_one({"id": sid, "shopId": p.shop_id}, {"$set": {
        "name": body.name, "phone": body.phone, "address": body.address, "updatedAt": iso()}})
    return clean(await db.suppliers.find_one({"id": sid}))


@api.post("/suppliers/{sid}/payment")
async def supplier_payment(sid: str, body: PaymentReceiveIn, p: Principal = Depends(require("purchase:write"))):
    s = await db.suppliers.find_one(scope(p, {"id": sid}))
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    await db.suppliers.update_one({"id": sid, "shopId": p.shop_id},
                                 {"$inc": {"balance": -body.amount}, "$set": {"updatedAt": iso()}})
    await db.payments.insert_one({"id": oid(), "shopId": p.shop_id, "party": "supplier", "partyId": sid,
                                  "amount": body.amount, "mode": body.mode, "refType": "paid",
                                  "user": p.name, "createdAt": iso()})
    await audit(p, "SUPPLIER_PAYMENT", f"{s['name']} · {body.amount}")
    return clean(await db.suppliers.find_one({"id": sid}))


# ---------------------------------------------------------------- sales
@api.get("/sales")
async def list_sales(p: Principal = Depends(require())):
    return await db.sales.find(scope(p), {"_id": 0}).sort("createdAt", -1).to_list(2000)


@api.post("/sales")
async def create_sale(body: SaleIn, p: Principal = Depends(require("sale:create"))):
    if not body.items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    if body.clientRef:
        dup = await db.sales.find_one(scope(p, {"clientRef": body.clientRef}), {"_id": 0})
        if dup:
            return dup                      # idempotent: offline queue / double click safe
    settings = await db.settings.find_one({"shopId": p.shop_id}) or DEFAULT_SETTINGS
    products: dict[str, dict] = {}
    for it in body.items:
        prod = await db.products.find_one(scope(p, {"id": it.productId}))
        if not prod:
            raise HTTPException(status_code=400, detail="A product in the cart no longer exists")
        if not settings.get("allowNegativeStock") and float(prod.get("stock", 0)) < it.qty:
            raise HTTPException(status_code=400, detail=f"Not enough stock: {prod['name']} ({prod.get('stock', 0)} left)")
        products[it.productId] = prod

    subtotal = round(sum(i.price * i.qty for i in body.items), 2)
    taxable = max(subtotal - body.discount, 0)
    tax = round(taxable * body.taxPercent / 100, 2)
    total = round(taxable + tax, 2)
    paid = round(sum(x.amount for x in body.payments), 2)
    due = round(total - paid, 2)
    invoice_no = await next_number(p.shop_id, "invoice", settings.get("invoicePrefix", "INV-"))
    customer = await db.customers.find_one(scope(p, {"id": body.customerId})) if body.customerId else None
    if body.customerId and not customer:
        raise HTTPException(status_code=400, detail="Selected customer not found")

    sale = {
        "id": oid(), "shopId": p.shop_id, "invoiceNo": invoice_no, "clientRef": body.clientRef,
        "customerId": body.customerId, "customerName": customer["name"] if customer else "",
        "items": [i.model_dump() for i in body.items], "subtotal": subtotal, "discount": body.discount,
        "taxPercent": body.taxPercent, "tax": tax, "total": total, "paid": paid, "due": due,
        "payments": [x.model_dump() for x in body.payments], "note": body.note,
        "profit": round(sum((i.price - (i.purchasePrice or 0)) * i.qty for i in body.items), 2),
        "user": p.name, "device": body.device, "status": "completed",
        "createdAt": iso(), "updatedAt": iso(),
    }
    await db.sales.insert_one(dict(sale))
    for it in body.items:
        await move(p.shop_id, products[it.productId], it.qty, "out", "sale", sale["id"], p.name)
    for x in body.payments:
        if x.amount:
            await db.payments.insert_one({"id": oid(), "shopId": p.shop_id, "party": "customer",
                                          "partyId": body.customerId, "amount": x.amount, "mode": x.mode,
                                          "refId": sale["id"], "refType": "sale", "user": p.name,
                                          "createdAt": iso()})
    if customer and due > 0:
        await db.customers.update_one({"id": body.customerId, "shopId": p.shop_id},
                                      {"$inc": {"balance": due}, "$set": {"updatedAt": iso()}})
    await audit(p, "SALE", f"{invoice_no} · {total}", body.device)
    return clean(dict(sale))


@api.post("/sales/{sid}/void")
async def void_sale(sid: str, body: VoidIn, p: Principal = Depends(require("sale:void"))):
    sale = await db.sales.find_one(scope(p, {"id": sid}))
    if not sale:
        raise HTTPException(status_code=404, detail="Bill not found")
    if sale.get("status") == "void":
        raise HTTPException(status_code=400, detail="This bill is already voided")
    for it in sale["items"]:
        prod = await db.products.find_one(scope(p, {"id": it["productId"]}))
        if prod:
            await move(p.shop_id, prod, it["qty"], "in", "bill-void", sale["id"], p.name)
    if sale.get("customerId") and sale.get("due", 0) > 0:
        await db.customers.update_one({"id": sale["customerId"], "shopId": p.shop_id},
                                      {"$inc": {"balance": -sale["due"]}, "$set": {"updatedAt": iso()}})
    await db.sales.update_one({"id": sid, "shopId": p.shop_id}, {"$set": {
        "status": "void", "voidReason": body.reason, "voidedBy": p.name, "voidedAt": iso(),
        "originalTotal": sale["total"], "total": 0, "paid": 0, "due": 0, "profit": 0, "updatedAt": iso()}})
    await audit(p, "BILL_VOID", f"{sale['invoiceNo']} · {sale['total']} · {body.reason}")
    return clean(await db.sales.find_one({"id": sid}))


# ---------------------------------------------------------------- purchases / returns / stock
@api.get("/purchases")
async def list_purchases(p: Principal = Depends(require())):
    return await db.purchases.find(scope(p), {"_id": 0}).sort("createdAt", -1).to_list(2000)


@api.post("/purchases")
async def create_purchase(body: PurchaseIn, p: Principal = Depends(require("purchase:write"))):
    if not body.items:
        raise HTTPException(status_code=400, detail="Add at least one product")
    supplier = await db.suppliers.find_one(scope(p, {"id": body.supplierId}))
    if not supplier:
        raise HTTPException(status_code=400, detail="Select a supplier")
    settings = await db.settings.find_one({"shopId": p.shop_id}) or DEFAULT_SETTINGS
    subtotal = round(sum(i.price * i.qty for i in body.items), 2)
    tax = round(subtotal * body.taxPercent / 100, 2)
    total = round(subtotal + tax, 2)
    purchase = {
        "id": oid(), "shopId": p.shop_id,
        "purchaseNo": await next_number(p.shop_id, "purchase", settings.get("purchasePrefix", "PUR-")),
        "supplierId": body.supplierId, "supplierName": supplier["name"],
        "supplierInvoice": body.supplierInvoice, "items": [i.model_dump() for i in body.items],
        "subtotal": subtotal, "taxPercent": body.taxPercent, "tax": tax, "total": total,
        "paid": body.paid, "due": round(total - body.paid, 2), "user": p.name, "createdAt": iso(),
    }
    await db.purchases.insert_one(dict(purchase))
    for it in body.items:
        prod = await db.products.find_one(scope(p, {"id": it.productId}))
        if not prod:
            continue
        await db.products.update_one({"id": it.productId, "shopId": p.shop_id},
                                     {"$set": {"purchasePrice": it.price}})
        await move(p.shop_id, prod, it.qty, "in", "purchase", purchase["id"], p.name)
    if purchase["due"] > 0:
        await db.suppliers.update_one({"id": body.supplierId, "shopId": p.shop_id},
                                      {"$inc": {"balance": purchase["due"]}})
    await audit(p, "PURCHASE", f"{purchase['purchaseNo']} · {total}")
    return clean(dict(purchase))


@api.get("/returns")
async def list_returns(p: Principal = Depends(require())):
    return await db.returns.find(scope(p), {"_id": 0}).sort("createdAt", -1).to_list(1000)


@api.post("/returns")
async def create_return(body: ReturnIn, p: Principal = Depends(require("return:write"))):
    if not body.items:
        raise HTTPException(status_code=400, detail="Select a product")
    ret = {"id": oid(), "shopId": p.shop_id, "kind": body.kind, "refId": body.refId,
           "items": [i.model_dump() for i in body.items],
           "total": round(sum(i.price * i.qty for i in body.items), 2), "user": p.name, "createdAt": iso()}
    await db.returns.insert_one(dict(ret))
    for it in body.items:
        prod = await db.products.find_one(scope(p, {"id": it.productId}))
        if prod:
            await move(p.shop_id, prod, it.qty, "in" if body.kind == "sale" else "out",
                       f"{body.kind}-return", ret["id"], p.name)
    await audit(p, "RETURN", f"{body.kind} return · {ret['total']}")
    return clean(dict(ret))


@api.get("/movements")
async def list_movements(p: Principal = Depends(require())):
    return await db.movements.find(scope(p), {"_id": 0}).sort("createdAt", -1).to_list(1000)


@api.post("/stock/adjust")
async def adjust_stock(body: AdjustIn, p: Principal = Depends(require("stock:adjust"))):
    prod = await db.products.find_one(scope(p, {"id": body.productId}))
    if not prod:
        raise HTTPException(status_code=404, detail="Product not found")
    adjustment_id = oid()
    await db.adjustments.insert_one({
        "id": adjustment_id, "shopId": p.shop_id, "productId": body.productId,
        "qty": abs(body.qty), "type": body.type, "reason": body.reason,
        "user": p.name, "createdAt": iso(),
    })
    await move(p.shop_id, prod, abs(body.qty), body.type, body.reason, adjustment_id, p.name)
    await audit(p, "STOCK_ADJUST", f"{prod['name']} {'+' if body.type == 'in' else '-'}{abs(body.qty)} ({body.reason})")
    return clean(await db.products.find_one({"id": body.productId}))


@api.get("/activity")
async def list_activity(p: Principal = Depends(require())):
    return await db.activity.find(scope(p), {"_id": 0}).sort("createdAt", -1).to_list(500)


@api.get("/payments")
async def list_payments(p: Principal = Depends(require())):
    return await db.payments.find(scope(p), {"_id": 0}).sort("createdAt", -1).to_list(2000)


# ---------------------------------------------------------------- dashboard
@api.get("/dashboard")
async def dashboard(p: Principal = Depends(require())):
    products = await db.products.find(scope(p), {"_id": 0}).to_list(5000)
    sales = await db.sales.find(scope(p, {"status": {"$ne": "void"}}), {"_id": 0}).to_list(5000)
    purchases = await db.purchases.find(scope(p), {"_id": 0}).to_list(5000)
    customers = await db.customers.find(scope(p), {"_id": 0}).to_list(2000)
    settings = await db.settings.find_one({"shopId": p.shop_id}) or DEFAULT_SETTINGS
    today = now().date().isoformat()
    day = lambda d: str(d)[:10]
    t_sales = [s for s in sales if day(s["createdAt"]) == today]
    t_pur = [x for x in purchases if day(x["createdAt"]) == today]
    low = [x for x in products if float(x.get("stock", 0)) <= float(x.get("minStock") or settings.get("minStock", 5))]

    per_day: dict[str, float] = {}
    for s in sales:
        per_day[day(s["createdAt"])] = per_day.get(day(s["createdAt"]), 0) + s["total"]
    series = []
    for i in range(6, -1, -1):
        d = (now() - timedelta(days=i)).date()
        series.append({"day": d.strftime("%a"), "sales": round(per_day.get(d.isoformat(), 0), 2)})

    top: dict[str, dict] = {}
    cat_sales: dict[str, float] = {}
    pmap = {x["id"]: x for x in products}
    for s in sales:
        for i in s["items"]:
            t = top.setdefault(i["productId"], {"name": i.get("name", ""), "qty": 0, "amount": 0})
            t["qty"] += i["qty"]
            t["amount"] += i["price"] * i["qty"]
            cat = pmap.get(i["productId"], {}).get("category") or "Uncategorised"
            cat_sales[cat] = round(cat_sales.get(cat, 0) + i["price"] * i["qty"], 2)

    suppliers = await db.suppliers.find(scope(p), {"_id": 0}).to_list(2000)

    week = (now() - timedelta(days=6)).isoformat()
    month = (now() - timedelta(days=29)).isoformat()
    return {
        "todaySales": round(sum(s["total"] for s in t_sales), 2),
        "todayPurchases": round(sum(x["total"] for x in t_pur), 2),
        "todayProfit": round(sum(s.get("profit", 0) for s in t_sales), 2),
        "weekSales": round(sum(s["total"] for s in sales if s["createdAt"] >= week), 2),
        "monthSales": round(sum(s["total"] for s in sales if s["createdAt"] >= month), 2),
        "totalProducts": len(products),
        "totalUnits": round(sum(float(x.get("stock", 0)) for x in products), 2),
        "stockValue": round(sum(float(x.get("stock", 0)) * float(x.get("purchasePrice", 0)) for x in products), 2),
        "lowStockCount": len(low), "lowStock": low[:8],
        "customers": len(customers),
        "outstanding": round(sum(float(c.get("balance", 0)) for c in customers), 2),
        "outstandingCustomers": sorted([c for c in customers if float(c.get("balance", 0)) > 0],
                                       key=lambda c: -float(c["balance"]))[:6],
        "recentSales": sorted(sales, key=lambda s: s["createdAt"], reverse=True)[:6],
        "recentPurchases": sorted(purchases, key=lambda s: s["createdAt"], reverse=True)[:5],
        "series": series,
        "top": sorted(top.values(), key=lambda t: -t["qty"])[:5],
        "categorySales": sorted([{"category": k, "amount": v} for k, v in cat_sales.items()], key=lambda x: -x["amount"])[:8],
        "supplierOutstanding": round(sum(float(s.get("balance", 0)) for s in suppliers), 2),
        "suppliers": len(suppliers),
    }


@api.get("/reports/day-close")
async def day_close(date: Optional[str] = None, p: Principal = Depends(require("report:read"))):
    day = (date or now().date().isoformat())[:10]
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Please pick a valid date")
    sales = [s for s in await db.sales.find(scope(p, {"status": {"$ne": "void"}}), {"_id": 0}).to_list(5000)
             if s["createdAt"][:10] == day]
    voided = [s for s in await db.sales.find(scope(p, {"status": "void"}), {"_id": 0}).to_list(5000)
              if s["createdAt"][:10] == day]
    purchases = [x for x in await db.purchases.find(scope(p), {"_id": 0}).to_list(5000) if x["createdAt"][:10] == day]
    receipts = [x for x in await db.payments.find(scope(p, {"refType": "receipt"}), {"_id": 0}).to_list(5000)
                if x["createdAt"][:10] == day]
    returns = [x for x in await db.returns.find(scope(p), {"_id": 0}).to_list(2000) if x["createdAt"][:10] == day]

    modes: dict[str, float] = {}
    for s in sales:
        for x in s.get("payments", []):
            if x.get("amount"):
                modes[x["mode"]] = round(modes.get(x["mode"], 0) + x["amount"], 2)
    for r in receipts:
        modes[r["mode"]] = round(modes.get(r["mode"], 0) + r["amount"], 2)

    by_user: dict[str, dict] = {}
    for s in sales:
        u = by_user.setdefault(s.get("user", "—"), {"user": s.get("user", "—"), "bills": 0, "amount": 0})
        u["bills"] += 1
        u["amount"] = round(u["amount"] + s["total"], 2)

    return {
        "date": day,
        "bills": len(sales),
        "grossSales": round(sum(s["subtotal"] for s in sales), 2),
        "discount": round(sum(s["discount"] for s in sales), 2),
        "tax": round(sum(s["tax"] for s in sales), 2),
        "netSales": round(sum(s["total"] for s in sales), 2),
        "collected": round(sum(s["paid"] for s in sales) + sum(r["amount"] for r in receipts), 2),
        "creditGiven": round(sum(s["due"] for s in sales), 2),
        "customerReceipts": round(sum(r["amount"] for r in receipts), 2),
        "profit": round(sum(s.get("profit", 0) for s in sales), 2),
        "purchases": round(sum(x["total"] for x in purchases), 2),
        "purchaseCount": len(purchases),
        "returns": round(sum(x["total"] for x in returns), 2),
        "returnCount": len(returns),
        "voidedBills": len(voided),
        "modes": [{"mode": k, "amount": v} for k, v in sorted(modes.items(), key=lambda kv: -kv[1])],
        "byUser": sorted(by_user.values(), key=lambda u: -u["amount"]),
        "itemsSold": round(sum(i["qty"] for s in sales for i in s["items"]), 2),
    }


# ---------------------------------------------------------------- license (shop side)
@api.get("/license")
async def my_license(p: Principal = Depends(require())):
    lic = clean(await db.licenses.find_one({"shopId": p.shop_id}))
    if lic:
        expired = lic["expiry"] < iso()
        if expired and lic["status"] == "Active":
            await db.licenses.update_one({"id": lic["id"]}, {"$set": {"status": "Expired"}})
            lic["status"] = "Expired"
    return lic


@api.post("/license/activate")
async def activate_license(body: ActivateIn, p: Principal = Depends(require("*"))):
    key = body.key.strip().upper()
    lic = await db.licenses.find_one({"key": key})
    if not lic:
        raise HTTPException(status_code=404, detail="License key not found")
    if lic["status"] == "Revoked":
        raise HTTPException(status_code=403, detail="This license has been revoked")
    if lic.get("shopId") and lic["shopId"] != p.shop_id:
        raise HTTPException(status_code=403, detail="This key is already used by another business")
    devices = lic.get("devices", [])
    if body.deviceId not in devices:
        if len(devices) >= lic["deviceLimit"]:
            raise HTTPException(status_code=403, detail="Device limit reached for this license")
        devices.append(body.deviceId)
    shop = await db.shops.find_one({"id": p.shop_id})
    await db.licenses.update_one({"key": key}, {"$set": {
        "shopId": p.shop_id, "business": shop["businessName"], "devices": devices,
        "activatedAt": iso(), "updatedAt": iso()}})
    await db.licenses.update_many({"shopId": p.shop_id, "key": {"$ne": key}},
                                  {"$set": {"status": "Superseded", "shopId": None, "updatedAt": iso()}})
    await audit(p, "LICENSE_ACTIVATE", key)
    return clean(await db.licenses.find_one({"key": key}))


# ---------------------------------------------------------------- license admin (superadmin)
@api.get("/admin/licenses")
async def admin_list(_: Principal = Depends(require_super)):
    docs = await db.licenses.find({}, {"_id": 0}).sort("createdAt", -1).to_list(1000)
    shops = {s["id"]: s["businessName"] for s in await db.shops.find({}, {"_id": 0}).to_list(1000)}
    for d in docs:
        d["shopName"] = shops.get(d.get("shopId"), "")
        if d["status"] == "Active" and d["expiry"] < iso():
            d["status"] = "Expired"
    return docs


@api.get("/admin/shops")
async def admin_shops(_: Principal = Depends(require_super)):
    shops = await db.shops.find({}, {"_id": 0}).to_list(1000)
    for s in shops:
        s["users"] = await db.users.count_documents({"shopId": s["id"]})
        s["products"] = await db.products.count_documents({"shopId": s["id"]})
        s["sales"] = await db.sales.count_documents({"shopId": s["id"], "status": {"$ne": "void"}})
        lic = await db.licenses.find_one({"shopId": s["id"]}, {"_id": 0})
        s["plan"] = lic["plan"] if lic else "—"
        s["licenseKey"] = lic["key"] if lic else ""
        s["expiry"] = lic["expiry"] if lic else ""
    return shops


@api.post("/admin/licenses")
async def admin_create(body: LicenseCreate, _: Principal = Depends(require_super)):
    doc = {"id": oid(), "key": await make_unique_key(), "business": body.business, "plan": body.plan, "status": "Active",
           "deviceLimit": body.deviceLimit or PLAN_DEVICES[body.plan], "devices": [], "shopId": None,
           "notes": body.notes, "expiry": (now() + timedelta(days=PLAN_DAYS[body.plan])).isoformat(),
           "createdAt": iso()}
    await db.licenses.insert_one(dict(doc))
    return clean(dict(doc))


@api.patch("/admin/licenses")
async def admin_patch(body: LicensePatch, _: Principal = Depends(require_super)):
    key = body.key.strip().upper()
    lic = await db.licenses.find_one({"key": key})
    if not lic:
        raise HTTPException(status_code=404, detail="License key not found")
    patch: dict[str, Any] = {"updatedAt": iso()}
    if body.plan in PLAN_DAYS:
        patch["plan"] = body.plan
        patch["deviceLimit"] = body.deviceLimit or PLAN_DEVICES[body.plan]
    if body.status:
        patch["status"] = body.status
    if body.deviceLimit:
        patch["deviceLimit"] = body.deviceLimit
    if body.extendDays:
        base = max(datetime.fromisoformat(lic["expiry"]), now())
        patch["expiry"] = (base + timedelta(days=body.extendDays)).isoformat()
        patch["status"] = body.status or "Active"
    await db.licenses.update_one({"key": key}, {"$set": patch})
    return clean(await db.licenses.find_one({"key": key}))


app.include_router(api)

_origins = [o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',')]
_wildcard = _origins == ['*']
app.add_middleware(
    CORSMiddleware,
    allow_origins=[] if _wildcard else _origins,
    allow_origin_regex=".*" if _wildcard else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.products.create_index([("shopId", 1), ("code", 1)], unique=True)
    await db.products.create_index([("shopId", 1), ("barcode", 1)])
    await db.sales.create_index([("shopId", 1), ("createdAt", -1)])
    await db.sales.create_index([("shopId", 1), ("clientRef", 1)])
    await db.licenses.create_index("key", unique=True)
    await db.counters.create_index([("shopId", 1), ("key", 1)], unique=True)
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@jewelbox.app").lower()
    admin_pass = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({"id": oid(), "shopId": None, "name": "Platform Admin", "email": admin_email,
                                   "passwordHash": hash_password(admin_pass), "role": None,
                                   "platformRole": "superadmin", "active": True, "createdAt": iso()})
    elif not verify_password(admin_pass, existing["passwordHash"]):
        await db.users.update_one({"email": admin_email},
                                  {"$set": {"passwordHash": hash_password(admin_pass),
                                            "platformRole": "superadmin", "active": True}})


@app.on_event("shutdown")
async def shutdown():
    client.close()
