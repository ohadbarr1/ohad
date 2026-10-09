# insurance-dashboard

Research terminal for Israeli insurers and long-term savings managers (Fiscal.ai + Qualtrim + EY InsurTool/Investool).

- Start with `HANDOFF.md` (state, verified facts, research queue) and `PLAN.md` (one-week plan).
- Site: `web/` (React + TS + Vite). Run `npm run dev`; `npx tsc --noEmit` must stay clean.
- Data: `pipeline/*.py` -> `web/public/data/*.json`. Every company number carries its PDF page.
- Never fabricate figures; label estimates; distinguish target vs forward vs actual.
- UI: no explanatory prose or methodology pages; numbers, charts and source pages only. Dense, units labeled.
- Talk to the user in Hebrew, bottom line first.
