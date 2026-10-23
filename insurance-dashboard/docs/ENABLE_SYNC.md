# Enable cross-device sync ("שלי")

Sync ships switched off (`web/src/lib/syncConfig.ts` → `SYNC_ENABLED = false`). While off, the site carries no Firebase code at all
and "שלי" shows "סנכרון בין מכשירים: יופעל בקרוב". Everything already works per browser; sync only mirrors it.

What gets synced: every `fox:*` key in the browser (watchlist, saved peer views and sets, statement views, chart book, valuation
inputs, notes on companies and on figures, recent pages and searches, "seen" markers), except device settings (`density`,
`fin.dense`, `reader`). One Firestore document per key under `users/{uid}/kv/{key}`; last write wins per key; offline writes queue.

## Console steps (project `fox-research-il`, ~10 minutes)

1. **Authentication → Get started → Sign-in method → Google → Enable.** Pick the support e-mail, Save.
2. **Authentication → Settings → Authorized domains.** Check that `fox-research-il.web.app` and `fox-research-il.firebaseapp.com`
   are listed (Hosting adds them; add them if not). Add any custom domain the site will use. `localhost` is listed by default.
3. **Firestore Database → Create database → Production mode → location `me-west1` (Tel Aviv)** (if not offered, `europe-west1`).
   The location cannot be changed later. Free tier (Spark) is enough: 50k reads / 20k writes a day.
4. **Firestore Database → Rules:** paste the contents of `web/firestore.rules` and **Publish**.
   (CLI alternative, from `web/`: `firebase deploy --only firestore:rules` — `firebase.json` already points at the file;
   `deploy.sh` stays hosting-only.)
5. Recommended: **Google Cloud console → Billing → Budgets & alerts**, a small budget with an e-mail alert. Any Google user can sign
   in and use their own storage (the rules cap each value at 256 KB but cannot cap the number of keys). To make sync owner-only,
   add `&& request.auth.token.email in ['you@gmail.com']` to `owner()` in the rules.

No web-app registration is needed: Hosting already serves the project's config at `/__/firebase/init.json` (checked 23.10.26), and
the sign-in helper pages `/__/auth/*` are served without the site's CSP / `X-Frame-Options` headers (checked 23.10.26), so the
popup flow runs on the site's own host.

## Before the flag flip: CSP

Merge the CSP change in `web/firebase.json` (orchestrator request, lane F): `script-src` + `https://apis.google.com`;
`connect-src` + `https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com`;
`frame-src 'self' https://fox-research-il.firebaseapp.com`.

## The flip

In `web/src/lib/syncConfig.ts`:

```ts
export const SYNC_ENABLED = true;
```

Build and deploy as usual (`./deploy.sh`).

## Check

Phone: open `/mine` → "התחבר עם Google" → star a company. Desktop: `/mine` → sign in → the star is there; save a peer view on the
desktop, bring the phone tab back to the front: it appears within seconds (sync runs on focus, every minute while visible, and
1.5 s after any change). Signing out keeps the data in the browser.
