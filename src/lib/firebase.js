// Real Firebase Auth (Google + email/password) and Cloud Functions. Fill in
// the REACT_APP_FIREBASE_* values in your .env from Firebase Console ->
// Project settings -> General -> Your apps -> Web app. There is no separate
// backend anymore: sign-in happens straight against Firebase Auth, and
// business logic (creating a shop, sales, stock) runs in Cloud Functions
// (see /functions/main.py), called via httpsCallable below.
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let auth = null;
let functions = null;
if (firebaseEnabled) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  auth = getAuth(app);
  functions = getFunctions(app, "asia-south1"); // must match options.set_global_options region in functions/main.py
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Opens the real Google account picker, returns a fresh Firebase ID token (JWT)
// that the backend verifies against your Firebase project.
export async function signInWithGoogle() {
  if (!auth) {
    throw new Error("Google sign-in isn't configured yet. Add REACT_APP_FIREBASE_* keys to your .env.");
  }
  const result = await signInWithPopup(auth, googleProvider);
  const idToken = await result.user.getIdToken();
  return { idToken, profile: result.user };
}

// Email/password sign-up + sign-in, straight against Firebase Auth (no
// custom bcrypt/JWT — Firebase already hashes + rate-limits this securely).
export async function signUpWithEmail(email, password) {
  if (!auth) throw new Error("Firebase isn't configured yet. Add REACT_APP_FIREBASE_* keys to your .env.");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInWithEmail(email, password) {
  if (!auth) throw new Error("Firebase isn't configured yet. Add REACT_APP_FIREBASE_* keys to your .env.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function firebaseSignOut() {
  if (auth) {
    try { await fbSignOut(auth); } catch { /* ignore */ }
  }
}

// Forces a refresh of the ID token so freshly-set custom claims (shopId,
// role — set by the bootstrapAccount Cloud Function) show up immediately,
// instead of waiting up to an hour for the token to naturally expire.
export async function refreshClaims() {
  if (auth?.currentUser) await auth.currentUser.getIdToken(true);
}

export { auth, functions, httpsCallable };
