# Agent rules

A past mistake is unwriteable when the owner and check below exist. Use the owner. Run the check.

| Class | Owner | Check |
| --- | --- | --- |
| NAV results with header status | `NavRun` constructors in `apps/web/src/state/navRun.ts` | `npx tsc -b` in `apps/web`; `navRun.test.ts` |
| Search dismiss vs fetch | `SearchRun` in `apps/web/src/state/searchRun.ts` | TLC `verify/search/run.sh` |
| Ensure persist order | pending-order writes in `apps/api/app/ingest/ensure.py` | TLC `verify/ensure/run.sh` |
| Filing size | `reject_filing` / `MAX_BYTES` | `node scripts/lint-filing-size.mjs` |
| CSS vs shadcn utilities | unlayered rules after `@layer` | `npm run lint:css` in `apps/web` |
| Backtest calendar | `navDatesInRange` in `apps/web/src/lib/series.ts` | `npm run lint:nav-dates` in `apps/web` |
| Weight overflow vs 100% | `WEIGHT_CENT` / `hasWeightOverflow`, `isWeightBalanced` | `npm run lint:weight-constants` in `apps/web` |
| SQLite thread and FKs | `connect_db` in `apps/api/app/db.py` | `node scripts/lint-sqlite-connect.mjs` |

CI is `.github/workflows/test.yml`. Comments encode a constraint types miss.
