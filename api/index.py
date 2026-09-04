"""
Vercel entry point.

Vercel auto-detects any Python file under /api as a serverless function and,
since we export a variable named `app` that is an ASGI app, it runs it
directly (no extra adapter needed) — same FastAPI app that server/server.py
defines, now talking to Firestore instead of MongoDB.

vercel.json rewrites every /api/* request to this file; FastAPI's own
router (prefix="/api") then does the rest of the routing internally.
"""
import os
import sys

SERVER_DIR = os.path.join(os.path.dirname(__file__), "..", "server")
sys.path.insert(0, os.path.abspath(SERVER_DIR))

from server import app  # noqa: E402  (import after sys.path tweak, on purpose)
