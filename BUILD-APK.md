# APK GitHub se automatically kaise banega

Ye React app **Capacitor** ke zariye Android APK mein wrap hoti hai. Ek
GitHub Actions workflow (`.github/workflows/build-apk.yml`) already add kar
diya gaya hai jo APK build karta hai — aapko kuch install karne ki zaroorat
nahi.

## Setup (ek baar)

1. Is poore folder ko GitHub par ek naye (ya existing) repo mein push karo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```

2. (Optional, sirf agar Google Sign-In chahiye APK mein) Repo ke
   **Settings → Secrets and variables → Actions → New repository secret**
   mein ye values daalo (`.env.example` dekho):
   - `REACT_APP_BACKEND_URL`
   - `REACT_APP_FIREBASE_API_KEY`
   - `REACT_APP_FIREBASE_AUTH_DOMAIN`
   - `REACT_APP_FIREBASE_PROJECT_ID`
   - `REACT_APP_FIREBASE_STORAGE_BUCKET`
   - `REACT_APP_FIREBASE_MESSAGING_SENDER_ID`
   - `REACT_APP_FIREBASE_APP_ID`

   Agar ye secrets set nahi kiye, APK phir bhi ban jayega, bas Google
   Sign-In kaam nahi karega aur backend URL blank rahega.

## APK kaise milega

- Jab bhi `main` branch par push karoge, workflow apne aap chalega.
- Ya GitHub repo ke **Actions** tab mein "Build Android APK" workflow open
  karke **Run workflow** button se manually bhi trigger kar sakte ho.
- Build complete hone ke baad, us workflow run ke page ke neeche
  **Artifacts** section mein `vyro-vx7-debug-apk.zip` milega — usse download
  karke unzip karo, andar `app-debug.apk` hoga. Wahi apne phone par install
  karo (unknown sources allow karni pad sakti hai).

## Ye kaise kaam karta hai

1. Workflow React app ko `yarn build` se normal web build banata hai.
2. `npx cap add android` + `npx cap sync android` us build ko ek Android
   project mein wrap karta hai (Capacitor ke zariye) — ye android/ folder
   repo mein commit nahi hota, har run mein fresh generate hota hai.
3. Gradle us Android project se `app-debug.apk` build karta hai.
4. APK ko GitHub Actions "artifact" ke roop mein upload kar diya jaata hai.

## Debug vs Release APK

Abhi ye workflow sirf **debug APK** banata hai (bina signing ke, testing ke
liye theek hai). Agar Play Store ke liye ya production install ke liye
**signed release APK** chahiye, bata dena — uske liye keystore generate
karke ek aur GitHub Secret mein daalna padega, aur workflow mein
`assembleRelease` step add karna padega.
