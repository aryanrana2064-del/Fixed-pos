# Python/Mongo backend hata ke Firebase pe migrate

## Kya ho gaya (is pass mein)
- `functions/main.py` — Firebase Cloud Functions "worker". Isme:
  - `bootstrap_account` — Google/email login ke baad shop create karta hai
    (naya user) ya role/shopId "claims" attach karta hai (existing user).
    Disabled account ko clear error deta hai (crash nahi).
  - `create_sale` — sale banata hai, stock atomically (Firestore transaction)
    ghatata hai, aur agar due amount > 0 hai to customer select karna zaroori
    hai (kisi bhi payment mode mein) — warna paisa link hue bina gayab nahi
    hoga.
  - `adjust_stock` — manual stock adjust, apna khud ka adjustment ID `ref` ke
    roop mein movement log mein save karta hai.
- `firestore.rules` — kaunsa data client seedha padh/likh sakta hai, aur kya
  sirf Cloud Functions se hi ho sakta hai (sales, stock, movements — taaki
  koi client se seedha stock chhed na sake).
- `src/lib/firebase.js` — email/password sign-up + sign-in add kiya (ab tak
  sirf Google tha), aur Cloud Functions call karne ka setup.
- `src/lib/firebaseApi.js` — naya API layer jo in Functions ko call karta hai.

## "Ek key" kahan hai
Kahin nahi manually banani padegi — jab tum `firebase deploy` karoge, Firebase
khud in functions ko apne project ke andar authenticate kar deta hai (Admin
SDK auto-detects credentials). Isiliye koi service-account JSON commit ya
manage nahi karna. Bas Firebase project se connect hone ke liye `.env` mein
`REACT_APP_FIREBASE_*` values honi chahiye (jo already hain).

## Deploy kaise karein
```bash
npm install -g firebase-tools
firebase login
firebase use --add          # apna Firebase project select karo
firebase deploy --only firestore:rules,firestore:indexes,functions
```

## Abhi kya BAAKI hai (agla step)
Ye poore 1200-line backend ka pehla slice hai. Jo abhi Firestore/Functions
pe nahi gaya:
- Purchases, returns, payment-receive (customer se paisa lena)
- Reports (dashboard, day-close)
- Licensing admin panel (superadmin: license create/patch)
- Products/parties ka poora CRUD (abhi sirf list; create/edit seedha
  Firestore se ho sakta hai rules ke through, lekin frontend forms abhi
  purane `api.js` (axios) ko call kar rahe hain — unhe `firebaseApi.js` pe
  point karna baaki hai)

Batao agla kaunsa hissa migrate karna hai, main wahi pattern follow karke
karta rahunga (Cloud Function jahan atomic/permission logic chahiye, seedha
Firestore jahan simple read/write kaafi hai).
