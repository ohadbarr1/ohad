# Report-Day autopilot (lane AP, Phase 3 wave 1)

Spec: `research/program_2026-10/README.md` §4 Phase 3 (W7-R1, W3-R1/R4, W5-R4). Code only, **off by default**: every entry point is a
dry run unless `--apply`; nothing deploys, pushes, notifies or schedules.

```
poll.py   MAYA → new filings since the last report id seen (state: data/registry/autopilot_state.json)
          → classify (fetch_maya rules; period from the XBRL instance when attached) → --apply: PDF + XBRL + liabilities htm into the
          source layout, documents.csv (+ warehouse when duckdb is importable), data/registry/autopilot_filings.json
t0.py     data/registry/xbrl_facts.json → kpi.json: 19 ת930 concepts per period; a new period lands "unverified" until the printed
          figure of the same report agrees (lines.json / kpi_windows.json / capital.json)
deltas.py headline deltas with both sources: profit YoY, comprehensive income YoY, equity QoQ, CSM QoQ (same basis), solvency
run.py    poll → skeleton → extraction hook (OFF) → builders → gate → web/public/data/autopilot/status.json → prints ./deploy.sh
tests/    recorded MAYA responses (Phoenix + Menora, Q2'26 report day); no network
```

Run: `/usr/bin/python3 pipeline/autopilot/run.py` (dry run), `… --apply --no-poll` (rebuild the status from disk),
`/usr/bin/python3 -m unittest discover -s pipeline/autopilot/tests`. CI: `.github/workflows/autopilot.yml` (manual dispatch, dry run,
status.json as an artifact).

What the XBRL can and cannot give: the ISA instance is the ת930 summary form, 26 ifrs-full concepts. No filer tags insurance revenue,
insurance service result, CSM, dividends, AUM or solvency (`fetch_xbrl.py --registry --coverage` prints the matrix over all 431
instances). Those come only from the PDF, i.e. from the extraction step that waits for the owner's budget. The form's quarter contexts
always say "three months" even where Menora/Clal/Hachshara/Ayalon put year-to-date figures in them, so a T+0 quarter follows the filer's
own habit for that quarter and stays unverified until the printed figure agrees.

Network: MAYA's public JSON list API and mayafiles, User-Agent `fox-research-il-autopilot`, ≤ 1 request/s by default (never > 2/s),
raw list responses cached under `data/raw/maya_autopilot/<date>/` on `--apply`; a 403/429 stops the run (`blocked` in the status), it is
never retried around. Liabilities schedules (form ת126, htm only) are cached at `data/raw/maya_liabilities/htm/<rid>.htm.gz`, the path
the debt-ladder lane's `fetch_liabilities.py` reads.

## Switches (config.json, all off)

| switch | effect when on | who turns it on |
|---|---|---|
| `llm.enabled` + `approved_by` + `budget_tokens_per_run` | the extraction hook in `run.py` may call the model (not implemented in wave 1) | owner, per the standing budget rule |
| `push.enabled` | the sender below may send | owner, after the Firebase steps |
| `deploy.auto` | stays false: deploy is `./deploy.sh` by a human after the gate | — |

## Web Push / FCM: design note (not implemented)

**What a push says.** One per filing, on the status.json `deltas.push` already computed: title `הראל Q2'26`, body
`רווח נקי 1,068 מ' ש"ח (+28.1% YoY) · CSM 17,717 (+1.4% QoQ) · הון 12,635 (+3.7% QoQ)`; tap opens `/company/<id>?p=<period>` (Report
Day). Sent only after the gate passed **and** the period is published; an unverified skeleton figure is sent with the suffix `· לא מאומת`
or not at all (owner's choice; recommendation: send, labelled, because T+0 is the point). One extra push per company per day at most;
none between 22:00 and 07:00 Israel time (queued to 07:00).

**What the owner must enable.**
1. Firebase console → Project settings → Cloud Messaging: generate the Web Push certificate (VAPID key pair). The public key goes into
   the web build (`VITE_FCM_VAPID`), the private side stays in Firebase.
2. Firebase Messaging in the app: `firebase/messaging` in the service worker (`firebase-messaging-sw.js` or merged into the existing SW),
   CSP `connect-src` + `https://fcmregistrations.googleapis.com https://fcm.googleapis.com` in `web/firebase.json`.
3. A sender with a service-account credential: either a Cloud Function on the Blaze plan (triggered by a Firestore write of the new
   status) or a step in the owner-run `deploy.sh` after a successful deploy (no Blaze needed: a local script with the Admin SDK and a
   service-account JSON kept outside the repo). Recommendation: the deploy-step sender; it keeps "a human published it" as the trigger.
4. Topics, not token lists: `co_<id>` per company and `all`; a subscription is a client call, so no personal data is stored server-side.

**Cost.** FCM itself is free at any volume. Hosting/Firestore stay inside the free tier at this audience (17 companies × ~5 filings a
quarter ≈ 85 pushes/quarter per topic). A Cloud Function sender needs Blaze (pay-as-you-go; at this volume ≈ $0, but a billing account
is required); the deploy-step sender costs nothing. iOS delivers Web Push only to the installed PWA (iOS 16.4+), so the install prompt
(W3-R1) is part of the feature.

**Opt-in UX.** Never prompt on first visit. The bell appears on the company header and in "שלי" after the second visit or after a
company is followed; a tap opens a sheet: "התראה ביום הדוח · <company> · כותרת וארבעה מספרים" with two choices (this company / all
followed companies), then the browser permission prompt. A denied permission shows a quiet "ההתראות חסומות בדפדפן" with how to undo it,
and is never asked again. The sheet states what is sent, when (report day only), and that nothing personal is stored (topic subscription).
Unsubscribe is the same bell. A test push ("כך תיראה ההתראה") is offered once after opting in, from the latest filing's real deltas.
