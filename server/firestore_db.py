"""
Thin async-compatible Firestore layer that mimics the small slice of the
Motor (async MongoDB) collection API used by server.py:

    db.<collection>.find_one(filter, projection)
    db.<collection>.find(filter, projection).sort(field, direction).to_list(n)
    db.<collection>.insert_one(doc)
    db.<collection>.update_one(filter, {"$set": ..., "$inc": ...}, upsert=)
    db.<collection>.update_many(filter, {"$set": ...})
    db.<collection>.delete_one(filter)
    db.<collection>.count_documents(filter)
    db.<collection>.find_one_and_update(filter, update, upsert=, return_document=)
    db.<collection>.create_index(...)   # no-op, Firestore indexes are declared
                                         # separately in firestore.indexes.json

This lets server.py talk directly to Firebase/Firestore from Python
(via the Admin SDK) without rewriting all of its business logic — only the
database engine underneath changes. MongoDB is no longer used anywhere.

Only the filter shapes actually used in this project are supported:
plain equality (including booleans) and `{"field": {"$ne": value}}`.
"""
import asyncio
import json
import os

import firebase_admin
from firebase_admin import credentials
from google.cloud import firestore as gcf
from google.cloud.firestore_v1 import Increment


def _load_credentials():
    """Look for service-account creds in an env var first (Vercel-friendly),
    then fall back to a file path, then to Application Default Credentials
    (useful when this runs on GCP infra)."""
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON") or os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if raw:
        info = json.loads(raw)
        return credentials.Certificate(info)
    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if path and os.path.exists(path):
        return credentials.Certificate(path)
    return None


def _init_app():
    if firebase_admin._apps:
        return firebase_admin.get_app()
    cred = _load_credentials()
    options = {}
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    if project_id:
        options["projectId"] = project_id
    if cred:
        return firebase_admin.initialize_app(cred, options or None)
    return firebase_admin.initialize_app(options=options or None)


_app = _init_app()
_client: gcf.Client = firebase_admin.firestore.client()


def _is_ne(v):
    return isinstance(v, dict) and set(v.keys()) == {"$ne"}


def _split_filter(filt: dict):
    """Return (equality_filters, ne_filters) from a Mongo-style filter dict."""
    eq, ne = {}, {}
    for k, v in (filt or {}).items():
        if _is_ne(v):
            ne[k] = v["$ne"]
        else:
            eq[k] = v
    return eq, ne


def _post_filter(doc: dict, ne: dict) -> bool:
    return all(doc.get(k) != v for k, v in ne.items())


def _project(doc: dict, projection):
    if not doc or not projection:
        return doc
    excludes = {k for k, v in projection.items() if v == 0}
    includes = {k for k, v in projection.items() if v == 1}
    if includes:
        return {k: v for k, v in doc.items() if k in includes}
    return {k: v for k, v in doc.items() if k not in excludes}


class _Cursor:
    def __init__(self, col_ref, filt, projection):
        self._col_ref = col_ref
        self._eq, self._ne = _split_filter(filt)
        self._projection = projection
        self._sort_field = None
        self._sort_dir = gcf.Query.ASCENDING

    def sort(self, field, direction=1):
        self._sort_field = field
        self._sort_dir = gcf.Query.ASCENDING if direction == 1 else gcf.Query.DESCENDING
        return self

    def to_list(self, length=None):
        return asyncio.to_thread(self._run, length)

    def _run(self, length):
        q = self._col_ref
        for k, v in self._eq.items():
            q = q.where(filter=gcf.FieldFilter(k, "==", v))
        if self._sort_field:
            q = q.order_by(self._sort_field, direction=self._sort_dir)
        out = []
        for snap in q.stream():
            data = snap.to_dict() or {}
            if not _post_filter(data, self._ne):
                continue
            out.append(_project(data, self._projection))
            if length and len(out) >= length:
                break
        return out


class FSCollection:
    def __init__(self, client: gcf.Client, name: str):
        self._client = client
        self._name = name
        self._ref = client.collection(name)

    # ---- reads -----------------------------------------------------
    def find(self, filt=None, projection=None):
        return _Cursor(self._ref, filt or {}, projection)

    async def find_one(self, filt=None, projection=None):
        filt = filt or {}
        if list(filt.keys()) == ["id"] and isinstance(filt["id"], str):
            def _get():
                snap = self._ref.document(filt["id"]).get()
                return snap.to_dict() if snap.exists else None
            data = await asyncio.to_thread(_get)
            return _project(data, projection) if data else None
        rows = await self.find(filt, projection).to_list(1)
        return rows[0] if rows else None

    async def count_documents(self, filt=None):
        rows = await self.find(filt or {}).to_list(None)
        return len(rows)

    # ---- writes ------------------------------------------------------
    async def insert_one(self, doc: dict):
        doc = dict(doc)
        doc_id = doc.get("id") or self._ref.document().id
        doc.setdefault("id", doc_id)

        def _set():
            self._ref.document(doc_id).set(doc)
        await asyncio.to_thread(_set)
        return doc

    async def _matching_refs(self, filt, limit=None):
        eq, ne = _split_filter(filt)

        def _run():
            q = self._ref
            for k, v in eq.items():
                q = q.where(filter=gcf.FieldFilter(k, "==", v))
            out = []
            for snap in q.stream():
                data = snap.to_dict() or {}
                if not _post_filter(data, ne):
                    continue
                out.append(snap.reference)
                if limit and len(out) >= limit:
                    break
            return out
        return await asyncio.to_thread(_run)

    @staticmethod
    def _payload(update: dict) -> dict:
        payload = {}
        payload.update(update.get("$set", {}))
        for k, v in update.get("$inc", {}).items():
            payload[k] = Increment(v)
        return payload

    async def update_one(self, filt, update, upsert=False, return_document=False):
        refs = await self._matching_refs(filt, limit=1)
        if refs:
            ref = refs[0]
            payload = self._payload(update)

            def _upd():
                ref.update(payload)
                return ref.get().to_dict() if return_document else None
            return await asyncio.to_thread(_upd)
        if upsert:
            new_doc = {k: v for k, v in filt.items() if not isinstance(v, dict)}
            new_doc.update(update.get("$set", {}))
            for k, v in update.get("$inc", {}).items():
                new_doc[k] = new_doc.get(k, 0) + v
            new_doc = await self.insert_one(new_doc)
            return new_doc if return_document else None
        return None

    async def update_many(self, filt, update):
        refs = await self._matching_refs(filt)
        payload = self._payload(update)

        def _upd_all():
            for ref in refs:
                ref.update(payload)
        await asyncio.to_thread(_upd_all)

    async def delete_one(self, filt):
        refs = await self._matching_refs(filt, limit=1)
        if refs:
            await asyncio.to_thread(refs[0].delete)

    async def find_one_and_update(self, filt, update, upsert=False, return_document=True):
        """Atomic read-modify-write, used for the invoice/purchase counters."""
        eq, ne = _split_filter(filt)

        @gcf.transactional
        def _txn(transaction: gcf.Transaction):
            q = self._ref
            for k, v in eq.items():
                q = q.where(filter=gcf.FieldFilter(k, "==", v))
            snaps = [s for s in q.get(transaction=transaction) if _post_filter(s.to_dict() or {}, ne)]
            if snaps:
                ref = snaps[0].reference
                data = snaps[0].to_dict() or {}
            elif upsert:
                doc_id = self._ref.document().id
                ref = self._ref.document(doc_id)
                data = dict(eq)
                data["id"] = doc_id
            else:
                return None
            for k, v in update.get("$inc", {}).items():
                data[k] = data.get(k, 0) + v
            data.update(update.get("$set", {}))
            transaction.set(ref, data)
            return data

        transaction = self._client.transaction()
        return await asyncio.to_thread(_txn, transaction)

    async def create_index(self, *args, **kwargs):
        # Firestore indexes are declared declaratively in firestore.indexes.json
        # and deployed with `firebase deploy --only firestore:indexes`.
        return None


class FirestoreDB:
    """Drop-in replacement for `client[db_name]` (an AsyncIOMotorDatabase):
    `db.products`, `db.sales`, etc. resolve to Firestore collections."""

    def __init__(self, client: gcf.Client):
        self._client = client
        self._collections: dict[str, FSCollection] = {}

    def __getattr__(self, name: str) -> FSCollection:
        if name not in self._collections:
            self._collections[name] = FSCollection(self._client, name)
        return self._collections[name]

    def close(self):
        pass


def get_db() -> FirestoreDB:
    return FirestoreDB(_client)
