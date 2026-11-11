# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: anyone who would have used the original [basket-lab](https://github.com/abhimanyu003/basket-lab) — a DIY Indian mutual-fund and ETF investor comparing a few baskets (lumpsum or SIP) without opening a brokerage app.

Secondary: someone who opens a shared URL and needs the comparison to make sense without a tour.

## Product Purpose

Basket Lab is a local web app for building Indian MF and ETF baskets, backtesting lumpsum or SIP, comparing CAGR / XIRR / max drawdown, reading yearly ranking, inspecting official AMFI-filing insights, and sharing the setup as a URL.

Success: typing a fund name stays responsive; a 3-basket 3-year backtest still works offline after the first NAV fetch; every insight field is either a real filing/NAV value or an explicit empty state. After one viewport, comparing returns must be obvious.

## Positioning

Search stays fast because it queries TigZig `/mf/v1/search` only — never a full `api.mfapi.in/mf` dump, never Fuse.js. Insights refuse invented numbers: JSON `null` is not `0`; missing PE/expense is “not in filing.” Indian ETFs are AMFI schemes with the same codes as mutual funds. No accounts; baskets live in `localStorage` plus a `s=` share query.

## Operating Context

One route `/`. Shared links are the same page with query params.

Local two-process setup: Vite React app + FastAPI on `127.0.0.1` only. SQLite `data/basket.sqlite` holds filings, never NAV. Browser IndexedDB holds NAV. Foliyo Markets `get_fund_details` feeds insights.

Core loop: Compare tab for mode/amount/period, table, and charts. Baskets tab to edit weights. Insights tab for filings and risk. Share copies the URL from the header.

## Capabilities and Constraints

Confirmed:

- Search: TigZig first; MFAPI search fallback. Debounce 200ms, min 2 chars, abort in-flight.
- NAV: TigZig bulk first; live payload is `schemes: [{ scheme_code, data }]` (array). MFAPI per-scheme fallback. Cache in IndexedDB.
- Backtest: lumpsum uses CAGR; SIP uses XIRR; max drawdown is peak-to-trough. Pure client calc.
- Insights: top holdings, sector, asset mix, credit, equity large/mid/small, overlap, expense, PE from Foliyo Markets (by AMFI code). Sharpe/vol from NAV series. Missing fields stay empty. Manual AMC Excel upload still works.
- Share: pako-compressed `s=` query. No accounts.
- Amount ≥ ₹100. Weights must sum 100% ± 0.1 to save.
- FastAPI bound to 127.0.0.1. No NAV in SQLite.

Out of scope unless the user asks later:

- Groww / Kuvera / Tickertape scrapes
- User accounts or cloud baskets
- Non-AMFI / US funds
- ETF premium/discount vs market price

Undecided: public hosting beyond local `npm run dev` + uvicorn.

## Brand Commitments

Name is **Basket Lab**. This is a React remake of the original vanilla-JS tool, not a pixel clone. The desk is frost/teal/Geist (see DESIGN.md). The information set and one-route lab stay.

Confirmed session direction from the user: treat it as a public remake; the first viewport must make comparing returns obvious.

## Evidence on Hand

- Default baskets in `apps/web/src/data/defaults.json` (UTI Nifty 50 Index 118741, PPFAS Flexi 122639, Nifty BeES 140084).
- Fixture holdings `fixtures/holdings/sample.csv` (122639, 140084 only). Other schemes stay empty until Foliyo ensure or a manual upload.
- Live TigZig and MFAPI for search/NAV.
- Foliyo Markets for insights snapshots.

Do not fabricate PE, expense, filings, or third-party ratings. Do not invent customer quotes, benchmarks, or hosted-product claims.

## Product Principles

1. **Compare returns first.** A first-time visitor should see how baskets performed before they are asked to edit allocations.
2. **Honest or absent.** Missing NAV or filings stay empty states. Never substitute zero.
3. **Search stays light.** Never download the scheme universe into the browser.
4. **Same lab, public-ready.** Keep the original’s information (settings, baskets, table, two charts, ranking, insights, share). Hierarchy and density may change; the job may not.
5. **Local and shareable.** No accounts. A URL is the whole handoff.

## Accessibility & Inclusion

No product-specific accessibility standard was established. Keyboard use, visible focus, and honest status copy are required by the existing spec (Escape/focus-trap on the editor is known debt).
