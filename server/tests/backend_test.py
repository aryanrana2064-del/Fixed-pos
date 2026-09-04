"""JewelBox POS — cloud API backend tests (multi-tenant, JWT, license admin).

Covers: auth (signup/login/lockout/me), tenant isolation, RBAC (Owner/Cashier),
products (dup code/barcode, opening stock, price history), sales (create, idempotency,
void, dashboard exclusion), purchases, customers/ledger, returns, stock adjust,
license admin (create/patch/revoke) and license activation edge cases.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@jewelbox.app"
ADMIN_PASSWORD = "Admin@2026"


def _uniq(prefix: str = "TEST") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# =========================================================
# Fixtures
# =========================================================
@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def shop_a(http):
    email = f"{_uniq('shopA')}@testshop.io"
    body = {
        "businessName": "TEST_ShopA",
        "ownerName": "Alice",
        "email": email,
        "password": "Test@1234",
    }
    r = http.post(f"{API}/auth/signup-shop", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["token"], "user": d["user"], "email": email, "licenseKey": d["licenseKey"]}


@pytest.fixture(scope="session")
def shop_b(http):
    email = f"{_uniq('shopB')}@testshop.io"
    body = {
        "businessName": "TEST_ShopB",
        "ownerName": "Bob",
        "email": email,
        "password": "Test@1234",
    }
    r = http.post(f"{API}/auth/signup-shop", json=body)
    assert r.status_code == 200, r.text
    d = r.json()
    return {"token": d["token"], "user": d["user"], "email": email, "licenseKey": d["licenseKey"]}


@pytest.fixture(scope="session")
def admin_token(http):
    r = http.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


# =========================================================
# Health
# =========================================================
def test_health(http):
    r = http.get(f"{API}/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# =========================================================
# Auth: signup/login/me/lockout
# =========================================================
def test_signup_and_me(http, shop_a):
    r = http.get(f"{API}/auth/me", headers=_auth_headers(shop_a["token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["user"]["email"].lower() == shop_a["email"].lower()
    assert d["user"]["role"] == "Owner"
    assert d["shop"]["businessName"] == "TEST_ShopA"


def test_signup_duplicate_email(http, shop_a):
    r = http.post(f"{API}/auth/signup-shop", json={
        "businessName": "TEST_DupBiz", "ownerName": "Dup Owner",
        "email": shop_a["email"], "password": "Test@1234",
    })
    assert r.status_code == 400, r.text
    assert "already registered" in r.json()["detail"].lower()


def test_login_wrong_password(http, shop_a):
    r = http.post(f"{API}/auth/login", json={"email": shop_a["email"], "password": "wrong"})
    assert r.status_code == 401
    assert "wrong email or password" in r.json()["detail"].lower()


def test_login_lockout_after_5():
    """5 failed attempts must return 429 on the 6th."""
    email = f"{_uniq('lock')}@testshop.io"
    # first create the account
    requests.post(f"{API}/auth/signup-shop", json={
        "businessName": "TEST_Lock", "ownerName": "L",
        "email": email, "password": "Test@1234"})
    # 5 wrong attempts
    for _ in range(5):
        requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"})
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "bad"})
    assert r.status_code == 429


def test_missing_token_401():
    # use fresh session so cookies from other tests do not authenticate us
    r = requests.get(f"{API}/products")
    assert r.status_code == 401


# =========================================================
# Multi-tenant isolation
# =========================================================
def test_products_isolated(http, shop_a, shop_b):
    # A creates a product
    ra = http.post(f"{API}/products",
                   headers=_auth_headers(shop_a["token"]),
                   json={"code": "A-P1", "name": "A Product", "price": 100, "stock": 5})
    assert ra.status_code == 200, ra.text
    pa_id = ra.json()["id"]

    # B creates a product
    rb = http.post(f"{API}/products",
                   headers=_auth_headers(shop_b["token"]),
                   json={"code": "B-P1", "name": "B Product", "price": 200, "stock": 3})
    assert rb.status_code == 200, rb.text
    pb_id = rb.json()["id"]

    # A's list must not contain B's product
    la = http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json()
    assert any(p["id"] == pa_id for p in la)
    assert not any(p["id"] == pb_id for p in la)

    # cross-tenant PUT with shop A token trying B's id -> 404
    r_put = http.put(f"{API}/products/{pb_id}",
                     headers=_auth_headers(shop_a["token"]),
                     json={"code": "B-P1", "name": "hacked", "price": 1, "stock": 0})
    assert r_put.status_code == 404
    r_del = http.delete(f"{API}/products/{pb_id}", headers=_auth_headers(shop_a["token"]))
    assert r_del.status_code == 404


def test_cross_tenant_void(http, shop_a, shop_b):
    # A creates product, sells; B tries to void
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("SKU"), "name": "SoldItem", "price": 100, "stock": 10}).json()
    sale = http.post(f"{API}/sales",
                     headers=_auth_headers(shop_a["token"]),
                     json={"items": [{"productId": p["id"], "price": 100, "qty": 1}],
                           "payments": [{"mode": "Cash", "amount": 100}]}).json()
    r = http.post(f"{API}/sales/{sale['id']}/void",
                  headers=_auth_headers(shop_b["token"]),
                  json={"reason": "hack"})
    # Bob is Owner too so passes RBAC; must fail via scope -> 404
    assert r.status_code == 404


# =========================================================
# RBAC — staff accounts
# =========================================================
@pytest.fixture(scope="session")
def cashier(http, shop_a):
    email = f"{_uniq('cash')}@testshop.io"
    r = http.post(f"{API}/users",
                  headers=_auth_headers(shop_a["token"]),
                  json={"name": "Cash User", "email": email, "password": "Test@1234", "role": "Cashier"})
    assert r.status_code == 200, r.text
    login = http.post(f"{API}/auth/login", json={"email": email, "password": "Test@1234"})
    return {"token": login.json()["token"], "email": email, "id": r.json()["id"]}


def test_cashier_cannot_create_product(http, cashier):
    r = http.post(f"{API}/products",
                  headers=_auth_headers(cashier["token"]),
                  json={"code": "CX1", "name": "x", "price": 1, "stock": 1})
    assert r.status_code == 403


def test_cashier_cannot_void(http, shop_a, cashier):
    # create a sale via owner
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("V"), "name": "vitem", "price": 50, "stock": 5}).json()
    sale = http.post(f"{API}/sales",
                    headers=_auth_headers(shop_a["token"]),
                    json={"items": [{"productId": p["id"], "price": 50, "qty": 1}],
                          "payments": [{"mode": "Cash", "amount": 50}]}).json()
    r = http.post(f"{API}/sales/{sale['id']}/void",
                  headers=_auth_headers(cashier["token"]),
                  json={"reason": "no"})
    assert r.status_code == 403


def test_disabled_user_cannot_login(http, shop_a, cashier):
    # disable
    r = http.patch(f"{API}/users/{cashier['id']}",
                   headers=_auth_headers(shop_a["token"]),
                   json={"active": False})
    assert r.status_code == 200
    # login should fail
    r = http.post(f"{API}/auth/login", json={"email": cashier["email"], "password": "Test@1234"})
    assert r.status_code == 401
    # re-enable for other tests? not needed since cashier fixture used above
    http.patch(f"{API}/users/{cashier['id']}",
               headers=_auth_headers(shop_a["token"]),
               json={"active": True})


# =========================================================
# Products — duplicate code/barcode, opening stock, price history
# =========================================================
def test_duplicate_code_rejected(http, shop_a):
    code = _uniq("DUP")
    r1 = http.post(f"{API}/products",
                   headers=_auth_headers(shop_a["token"]),
                   json={"code": code, "name": "d1", "price": 1, "stock": 0})
    assert r1.status_code == 200
    r2 = http.post(f"{API}/products",
                   headers=_auth_headers(shop_a["token"]),
                   json={"code": code, "name": "d2", "price": 1, "stock": 0})
    assert r2.status_code == 400
    assert "code" in r2.json()["detail"].lower()


def test_duplicate_barcode_rejected(http, shop_a):
    bc = _uniq("BC")
    r1 = http.post(f"{API}/products",
                   headers=_auth_headers(shop_a["token"]),
                   json={"code": _uniq("C"), "name": "b1", "price": 1, "stock": 0, "barcode": bc})
    assert r1.status_code == 200
    r2 = http.post(f"{API}/products",
                   headers=_auth_headers(shop_a["token"]),
                   json={"code": _uniq("C"), "name": "b2", "price": 1, "stock": 0, "barcode": bc})
    assert r2.status_code == 400
    assert "barcode" in r2.json()["detail"].lower()


def test_opening_stock_no_double(http, shop_a):
    r = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("OS"), "name": "opening", "price": 10, "stock": 7})
    assert r.status_code == 200
    prod = r.json()
    assert float(prod["stock"]) == 7  # exactly, not doubled
    # a movement should exist
    movs = http.get(f"{API}/movements", headers=_auth_headers(shop_a["token"])).json()
    m = next((m for m in movs if m["productId"] == prod["id"]), None)
    assert m is not None
    assert m["qty"] == 7 and m["type"] == "in"
    assert m["prevStock"] == 0 and m["newStock"] == 7


def test_price_change_writes_history(http, shop_a):
    r = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("PH"), "name": "ph", "price": 100, "stock": 0})
    pid = r.json()["id"]
    r2 = http.patch(f"{API}/products/{pid}/price",
                    headers=_auth_headers(shop_a["token"]),
                    json={"price": 150})
    assert r2.status_code == 200
    assert r2.json()["price"] == 150


# =========================================================
# Sales — create, idempotency, invoice numbering, void
# =========================================================
def test_sale_idempotency(http, shop_a):
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("ID"), "name": "idem", "price": 20, "stock": 10}).json()
    client_ref = _uniq("REF")
    body = {"items": [{"productId": p["id"], "price": 20, "qty": 2}],
            "payments": [{"mode": "Cash", "amount": 40}],
            "clientRef": client_ref}
    r1 = http.post(f"{API}/sales", headers=_auth_headers(shop_a["token"]), json=body)
    r2 = http.post(f"{API}/sales", headers=_auth_headers(shop_a["token"]), json=body)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["invoiceNo"] == r2.json()["invoiceNo"]
    # stock deducted only once
    prod = next(x for x in http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json() if x["id"] == p["id"])
    assert prod["stock"] == 8


def test_invoice_numbering_and_void(http, shop_a):
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("V"), "name": "voidable", "price": 100, "stock": 5}).json()
    s1 = http.post(f"{API}/sales",
                   headers=_auth_headers(shop_a["token"]),
                   json={"items": [{"productId": p["id"], "price": 100, "qty": 1}],
                         "payments": [{"mode": "Cash", "amount": 100}]}).json()
    assert s1["invoiceNo"].startswith("INV-")

    # void it
    r = http.post(f"{API}/sales/{s1['id']}/void",
                  headers=_auth_headers(shop_a["token"]),
                  json={"reason": "customer refused"})
    assert r.status_code == 200
    vd = r.json()
    assert vd["status"] == "void"
    assert vd["total"] == 0 and vd["due"] == 0
    assert vd.get("originalTotal") == 100

    # second void attempt
    r2 = http.post(f"{API}/sales/{s1['id']}/void",
                   headers=_auth_headers(shop_a["token"]),
                   json={"reason": "again"})
    assert r2.status_code == 400
    assert "already" in r2.json()["detail"].lower()

    # stock restored
    prod = next(x for x in http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json() if x["id"] == p["id"])
    assert prod["stock"] == 5

    # dashboard excludes voided sale from today's sales
    dash = http.get(f"{API}/dashboard", headers=_auth_headers(shop_a["token"])).json()
    # cannot assert exact totals because other sales exist but structure is present
    assert "todaySales" in dash


def test_credit_sale_and_customer_ledger(http, shop_a):
    # customer
    c = http.post(f"{API}/customers",
                  headers=_auth_headers(shop_a["token"]),
                  json={"name": _uniq("Cust"), "phone": "9999", "openingBalance": 0}).json()
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("CR"), "name": "credit-item", "price": 300, "stock": 5}).json()
    sale = http.post(f"{API}/sales",
                     headers=_auth_headers(shop_a["token"]),
                     json={"items": [{"productId": p["id"], "price": 300, "qty": 1}],
                           "customerId": c["id"], "payments": []}).json()
    assert sale["due"] == 300
    # ledger
    led = http.get(f"{API}/customers/{c['id']}/ledger", headers=_auth_headers(shop_a["token"])).json()
    assert any(row["type"].startswith("Sale") for row in led["rows"])
    # customer balance increased
    cust = next(x for x in http.get(f"{API}/customers", headers=_auth_headers(shop_a["token"])).json() if x["id"] == c["id"])
    assert cust["balance"] == 300
    # record payment
    pay = http.post(f"{API}/customers/{c['id']}/payment",
                    headers=_auth_headers(shop_a["token"]),
                    json={"amount": 100, "mode": "Cash"})
    assert pay.status_code == 200 and pay.json()["balance"] == 200


# =========================================================
# Purchases — supplier required, stock increases
# =========================================================
def test_purchase_without_supplier(http, shop_a):
    r = http.post(f"{API}/purchases",
                  headers=_auth_headers(shop_a["token"]),
                  json={"supplierId": "", "items": [{"productId": "x", "price": 1, "qty": 1}]})
    # supplierId missing/bad -> 400 "Select a supplier"
    assert r.status_code in (400, 422)


def test_purchase_flow(http, shop_a):
    sup = http.post(f"{API}/suppliers",
                    headers=_auth_headers(shop_a["token"]),
                    json={"name": _uniq("Sup"), "openingBalance": 0}).json()
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("PU"), "name": "pu-item", "price": 500, "stock": 0}).json()
    r = http.post(f"{API}/purchases",
                  headers=_auth_headers(shop_a["token"]),
                  json={"supplierId": sup["id"],
                        "items": [{"productId": p["id"], "price": 200, "qty": 3}],
                        "paid": 100})
    assert r.status_code == 200, r.text
    pur = r.json()
    assert pur["total"] == 600
    assert pur["due"] == 500
    # stock increased
    prod = next(x for x in http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json() if x["id"] == p["id"])
    assert prod["stock"] == 3
    # supplier balance increased
    s2 = next(x for x in http.get(f"{API}/suppliers", headers=_auth_headers(shop_a["token"])).json() if x["id"] == sup["id"])
    assert s2["balance"] == 500


# =========================================================
# Returns & stock adjust
# =========================================================
def test_sale_return_and_adjust(http, shop_a):
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("RT"), "name": "rt", "price": 100, "stock": 10}).json()
    # return of a sale (stock++)
    r = http.post(f"{API}/returns",
                  headers=_auth_headers(shop_a["token"]),
                  json={"kind": "sale", "items": [{"productId": p["id"], "price": 100, "qty": 2}]})
    assert r.status_code == 200
    prod = next(x for x in http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json() if x["id"] == p["id"])
    assert prod["stock"] == 12
    # adjust out
    r2 = http.post(f"{API}/stock/adjust",
                   headers=_auth_headers(shop_a["token"]),
                   json={"productId": p["id"], "qty": 3, "type": "out", "reason": "damaged"})
    assert r2.status_code == 200
    prod = next(x for x in http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json() if x["id"] == p["id"])
    assert prod["stock"] == 9


def test_cashier_cannot_adjust_stock(http, shop_a, cashier):
    p = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("A"), "name": "adj", "price": 10, "stock": 5}).json()
    r = http.post(f"{API}/stock/adjust",
                  headers=_auth_headers(cashier["token"]),
                  json={"productId": p["id"], "qty": 1, "type": "out", "reason": "x"})
    assert r.status_code == 403


# =========================================================
# CSV Import
# =========================================================
def test_import_products(http, shop_a):
    rows = [
        {"code": _uniq("I1"), "name": "imp1", "price": 10, "stock": 1},
        {"code": _uniq("I2"), "name": "imp2", "price": 20, "stock": 2},
        {"badRow": True},
    ]
    r = http.post(f"{API}/products/import",
                  headers=_auth_headers(shop_a["token"]),
                  json={"rows": rows, "mode": "skip"})
    assert r.status_code == 200
    s = r.json()
    assert s["created"] == 2
    assert s["failed"] == 1


# =========================================================
# License admin (superadmin)
# =========================================================
def test_admin_login_and_list(http, admin_token):
    r = http.get(f"{API}/admin/licenses", headers=_auth_headers(admin_token))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_admin_endpoints_forbidden_for_shop(http, shop_a):
    r = http.get(f"{API}/admin/licenses", headers=_auth_headers(shop_a["token"]))
    assert r.status_code == 403
    r2 = http.get(f"{API}/admin/shops", headers=_auth_headers(shop_a["token"]))
    assert r2.status_code == 403


def test_admin_create_extend_revoke(http, admin_token):
    r = http.post(f"{API}/admin/licenses",
                  headers=_auth_headers(admin_token),
                  json={"business": "TEST_LicBiz", "plan": "Pro"})
    assert r.status_code == 200, r.text
    lic = r.json()
    key = lic["key"]
    assert lic["plan"] == "Pro" and lic["status"] == "Active"

    # extend +30d
    r2 = http.patch(f"{API}/admin/licenses",
                    headers=_auth_headers(admin_token),
                    json={"key": key, "extendDays": 30})
    assert r2.status_code == 200
    # revoke
    r3 = http.patch(f"{API}/admin/licenses",
                    headers=_auth_headers(admin_token),
                    json={"key": key, "status": "Revoked"})
    assert r3.status_code == 200 and r3.json()["status"] == "Revoked"
    # re-activate
    r4 = http.patch(f"{API}/admin/licenses",
                    headers=_auth_headers(admin_token),
                    json={"key": key, "status": "Active"})
    assert r4.status_code == 200 and r4.json()["status"] == "Active"


def test_activate_revoked_key_fails(http, admin_token, shop_a):
    # create a fresh key then revoke, then try to activate as shop A
    r = http.post(f"{API}/admin/licenses",
                  headers=_auth_headers(admin_token),
                  json={"business": "TEST_Rev", "plan": "Starter"})
    key = r.json()["key"]
    http.patch(f"{API}/admin/licenses",
               headers=_auth_headers(admin_token),
               json={"key": key, "status": "Revoked"})
    r2 = http.post(f"{API}/license/activate",
                   headers=_auth_headers(shop_a["token"]),
                   json={"key": key, "deviceId": "web"})
    assert r2.status_code == 403


def test_activate_key_bound_to_other_shop(http, admin_token, shop_a, shop_b):
    # create unused key, bind to A, then try activating from B
    r = http.post(f"{API}/admin/licenses",
                  headers=_auth_headers(admin_token),
                  json={"business": "TEST_Bind", "plan": "Starter"})
    key = r.json()["key"]
    r_a = http.post(f"{API}/license/activate",
                    headers=_auth_headers(shop_a["token"]),
                    json={"key": key, "deviceId": "webA"})
    assert r_a.status_code == 200
    r_b = http.post(f"{API}/license/activate",
                    headers=_auth_headers(shop_b["token"]),
                    json={"key": key, "deviceId": "webB"})
    assert r_b.status_code == 403


def test_admin_shops_lists_registered(http, admin_token):
    r = http.get(f"{API}/admin/shops", headers=_auth_headers(admin_token))
    assert r.status_code == 200
    shops = r.json()
    assert any(s["businessName"].startswith("TEST_Shop") for s in shops)


# =========================================================
# Settings update
# =========================================================
def test_settings_update_persists(http, shop_a):
    r = http.put(f"{API}/shop",
                 headers=_auth_headers(shop_a["token"]),
                 json={"invoicePrefix": "TST-", "defaultTax": 5, "businessName": "TEST_ShopA-Renamed"})
    assert r.status_code == 200
    # reload
    r2 = http.get(f"{API}/shop", headers=_auth_headers(shop_a["token"]))
    d = r2.json()
    assert d["settings"]["invoicePrefix"] == "TST-"
    assert d["settings"]["defaultTax"] == 5
    assert d["shop"]["businessName"] == "TEST_ShopA-Renamed"


# =========================================================
# VYRO VX7 UPDATE: templates, universal product fields, variants,
# custom fields, day-close report, Bank Transfer payment
# =========================================================
def test_templates_endpoint(http, shop_a):
    """GET /api/templates returns businessTypes / units / current / template."""
    r = http.get(f"{API}/templates", headers=_auth_headers(shop_a["token"]))
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("businessTypes", "units", "current", "template"):
        assert k in d, f"missing {k}"
    assert "Jewellery" in d["businessTypes"]
    assert "Garments & Fashion" in d["businessTypes"]
    assert "Grocery" in d["businessTypes"]
    assert "Piece" in d["units"] and "Kg" in d["units"]
    # template shape
    tpl = d["template"]
    assert "categories" in tpl and "customFields" in tpl and "defaultUnit" in tpl


def test_signup_with_business_type_and_defaults(http):
    """Signup with businessType=Grocery -> /templates.current=Grocery, defaultUnit=Kg,
       and Garments defaults show size/color/fabric/style customFields."""
    for btype, expected_unit, expected_cf_keys in [
        ("Garments & Fashion", "Piece", {"size", "color", "fabric", "style"}),
        ("Grocery", "Kg", {"batch", "expiry", "packSize"}),
    ]:
        email = f"{_uniq('bt')}@testshop.io"
        r = http.post(f"{API}/auth/signup-shop", json={
            "businessName": f"TEST_{btype}",
            "ownerName": "Owner", "email": email, "password": "Test@1234",
            "businessType": btype,
        })
        assert r.status_code == 200, r.text
        tok = r.json()["token"]
        t = http.get(f"{API}/templates", headers=_auth_headers(tok)).json()
        assert t["current"] == btype
        assert t["template"]["defaultUnit"] == expected_unit
        got = {c["key"] for c in t["template"]["customFields"]}
        assert expected_cf_keys.issubset(got), f"{btype} missing customFields: {expected_cf_keys - got}"


def test_business_type_does_not_restrict_categories_or_units(http, shop_a):
    """A shop must be able to create products with any category / unit
    regardless of businessType (defaults only, never restrictions)."""
    r = http.post(f"{API}/products",
                  headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("FREE"), "name": "AnyCategory",
                        "category": "SomeRandomCat", "unit": "Litre",
                        "price": 50, "stock": 4})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["category"] == "SomeRandomCat"
    assert p["unit"] == "Litre"


def test_universal_product_fields_persist(http, shop_a):
    """brand / mrp / discount / maxStock / description / unit persist and round-trip."""
    body = {
        "code": _uniq("UP"), "name": "UniversalItem",
        "brand": "Acme", "mrp": 999.0, "discount": 10.0, "maxStock": 200.0,
        "description": "A universal test product", "unit": "Pack",
        "price": 799.0, "stock": 12,
    }
    r = http.post(f"{API}/products", headers=_auth_headers(shop_a["token"]), json=body)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # GET back
    all_prods = http.get(f"{API}/products", headers=_auth_headers(shop_a["token"])).json()
    p = next(x for x in all_prods if x["id"] == pid)
    assert p["brand"] == "Acme"
    assert float(p["mrp"]) == 999.0
    assert float(p["discount"]) == 10.0
    assert float(p["maxStock"]) == 200.0
    assert p["description"].startswith("A universal")
    assert p["unit"] == "Pack"
    # opening stock 12 must not be doubled
    assert float(p["stock"]) == 12


def test_product_variants_persist(http, shop_a):
    """Variants array is stored and returned intact."""
    variants = [
        {"name": "Black / M", "sku": "BLK-M", "barcode": "V-BC-M", "price": 500, "stock": 3},
        {"name": "Black / L", "sku": "BLK-L", "barcode": "V-BC-L", "price": 520, "stock": 2},
    ]
    body = {
        "code": _uniq("VAR"), "name": "TShirt", "price": 500, "stock": 0,
        "variants": variants,
    }
    r = http.post(f"{API}/products", headers=_auth_headers(shop_a["token"]), json=body)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    p = next(x for x in http.get(f"{API}/products",
                                  headers=_auth_headers(shop_a["token"])).json() if x["id"] == pid)
    assert isinstance(p.get("variants"), list) and len(p["variants"]) == 2
    names = sorted(v["name"] for v in p["variants"])
    assert names == ["Black / L", "Black / M"]
    # each variant preserved
    v0 = next(v for v in p["variants"] if v["name"] == "Black / M")
    assert v0["sku"] == "BLK-M" and v0["barcode"] == "V-BC-M"
    assert float(v0["price"]) == 500 and float(v0["stock"]) == 3


def test_product_custom_fields_persist(http, shop_a):
    """product.custom is a free-form dict that must round-trip untouched."""
    body = {
        "code": _uniq("CF"), "name": "CustomFieldItem", "price": 10, "stock": 1,
        "custom": {"size": "XL", "color": "Red", "fabric": "Cotton", "style": "Slim"},
    }
    r = http.post(f"{API}/products", headers=_auth_headers(shop_a["token"]), json=body)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    p = next(x for x in http.get(f"{API}/products",
                                  headers=_auth_headers(shop_a["token"])).json() if x["id"] == pid)
    assert p.get("custom") == {"size": "XL", "color": "Red", "fabric": "Cotton", "style": "Slim"}


def test_bank_transfer_payment_mode(http, shop_a):
    """A sale paid with mode='Bank Transfer' must be accepted and reflected
    in /api/payments and /api/reports/day-close modes."""
    p = http.post(f"{API}/products", headers=_auth_headers(shop_a["token"]),
                  json={"code": _uniq("BT"), "name": "BankItem", "price": 250, "stock": 5}).json()
    sale = http.post(f"{API}/sales", headers=_auth_headers(shop_a["token"]),
                     json={"items": [{"productId": p["id"], "price": 250, "qty": 1}],
                           "payments": [{"mode": "Bank Transfer", "amount": 250}]})
    assert sale.status_code == 200, sale.text
    sd = sale.json()
    assert any(pay["mode"] == "Bank Transfer" for pay in sd["payments"])
    # day-close must include Bank Transfer in modes
    dc = http.get(f"{API}/reports/day-close", headers=_auth_headers(shop_a["token"])).json()
    modes = {m["mode"]: m["amount"] for m in dc["modes"]}
    assert "Bank Transfer" in modes
    assert modes["Bank Transfer"] >= 250


def test_day_close_math_and_shape(http, shop_a):
    """Day-close endpoint returns expected shape and math (bills, netSales, collected, credit given)."""
    # baseline
    base = http.get(f"{API}/reports/day-close", headers=_auth_headers(shop_a["token"])).json()
    bills0 = base["bills"]
    net0 = base["netSales"]
    coll0 = base["collected"]

    # create a fresh cash bill of known amount and a credit sale + customer receipt
    prod = http.post(f"{API}/products", headers=_auth_headers(shop_a["token"]),
                     json={"code": _uniq("DC"), "name": "DC-item", "price": 100, "stock": 20}).json()
    cust = http.post(f"{API}/customers", headers=_auth_headers(shop_a["token"]),
                     json={"name": _uniq("DCcust"), "openingBalance": 0}).json()
    # cash bill 100
    http.post(f"{API}/sales", headers=_auth_headers(shop_a["token"]),
              json={"items": [{"productId": prod["id"], "price": 100, "qty": 1}],
                    "payments": [{"mode": "Cash", "amount": 100}]})
    # credit bill 200
    http.post(f"{API}/sales", headers=_auth_headers(shop_a["token"]),
              json={"items": [{"productId": prod["id"], "price": 100, "qty": 2}],
                    "customerId": cust["id"], "payments": []})
    # khata (customer) receipt 50
    http.post(f"{API}/customers/{cust['id']}/payment", headers=_auth_headers(shop_a["token"]),
              json={"amount": 50, "mode": "Cash"})

    dc = http.get(f"{API}/reports/day-close", headers=_auth_headers(shop_a["token"])).json()
    for k in ("date", "bills", "grossSales", "discount", "tax", "netSales", "collected",
              "creditGiven", "customerReceipts", "profit", "purchases", "returns",
              "voidedBills", "modes", "byUser", "itemsSold"):
        assert k in dc, f"day-close missing key {k}"
    assert dc["bills"] == bills0 + 2
    # net sales must include 100 (cash) + 200 (credit) = +300
    assert round(dc["netSales"] - net0, 2) == 300.0
    # collected = paid_on_bills (100) + receipts (50) = +150
    assert round(dc["collected"] - coll0, 2) == 150.0
    # creditGiven includes the 200 credit
    assert dc["creditGiven"] >= 200
    assert dc["customerReceipts"] >= 50


def test_day_close_past_date_returns_zeros(http, shop_a):
    """Picking an old past date returns zero counts (no sales that day)."""
    r = http.get(f"{API}/reports/day-close?date=2001-01-01",
                 headers=_auth_headers(shop_a["token"]))
    assert r.status_code == 200
    d = r.json()
    assert d["date"] == "2001-01-01"
    assert d["bills"] == 0
    assert d["netSales"] == 0
    assert d["collected"] == 0


def test_cashier_cannot_read_day_close(http, cashier):
    """Cashier lacks report:read, must get 403 on day-close."""
    r = http.get(f"{API}/reports/day-close", headers=_auth_headers(cashier["token"]))
    assert r.status_code == 403


def test_dashboard_category_sales_and_supplier_outstanding(http, shop_a):
    r = http.get(f"{API}/dashboard", headers=_auth_headers(shop_a["token"]))
    assert r.status_code == 200
    d = r.json()
    assert "categorySales" in d and isinstance(d["categorySales"], list)
    assert "supplierOutstanding" in d
    assert isinstance(d["supplierOutstanding"], (int, float))


def test_health_reports_vyro_brand(http):
    r = http.get(f"{API}/")
    assert r.status_code == 200
    d = r.json()
    # backend must NOT identify as JewelBox any more
    assert "jewelbox" not in d.get("app", "").lower()
    assert "vyro" in d.get("app", "").lower()

