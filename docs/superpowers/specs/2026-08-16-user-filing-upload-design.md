# User filing upload and richer filing insights

## Goal

Let a user attach an official AMC monthly portfolio file (`.xlsx`, `.xls`,
`.xlsm`, or `.csv`) to any fund in the Insights desk. The API extracts holdings
and a small set of extra fields, stores only SQLite rows, and deletes the file.
Insights then show AUM, turnover, cash/TREPS in Mix, and a stock-level overlap
table next to the existing pair percentage.

This sits on the existing salmon Insights desk and the filings-status contract
(`fresh` / `stale` / failure states, cached insights first, no invented
numbers).

## Non-goals

- No PDF ingest in this release.
- No QVM / factor scores, third-party ratings, or invented PE / expense.
- No quantity or market-value columns in SQLite.
- No derivative annexure (covered calls, futures) in Insights.
- No copy of the workbook in `data/incoming/` or IndexedDB.
- No file bytes in the share URL.
- No drag-and-drop, multi-file upload, or background folder watch.

## Data model

`holdings` remains the source of truth for look-through weights.

`fundamentals` gains two nullable columns:

- `aum_cr` — total net assets in ₹ crore, when the sheet states a total
- `turnover` — portfolio turnover as a unitless ratio (e.g. `0.26`), when present

Existing `expense_ratio` and `pe` stay nullable. A file that does not contain
them does not write zeros.

Cash-like lines (TREPS, CBLO, reverse repo, cash, cash margin) are stored as
`holdings` rows with `asset_class` set (e.g. `cash` or `treps`) so Mix can show
them. They keep `isin` null when the sheet has none.

Replace rule: a successful upload for scheme `S` with filing date `D`

1. Deletes all `holdings` rows for `S` (every prior `as_of`).
2. Inserts the new rows for `(D, S)`.
3. Upserts `fundamentals` for `(D, S)` with any extracted AUM / turnover.
4. Leaves other schemes untouched.

`filing_status` for the requested month is rewritten from the file date:
`fresh` if `as_of` starts with that month, else `stale`. `reason` is
`user upload`. `source_url` is null. `amc` is filled when the sheet or scheme
master provides it.

## Upload API

`POST /api/ingest/upload`

- Multipart form: `schemeCode` (required), `file` (required), `month` optional
  (defaults to current UTC `YYYY-MM`).
- Accept only `.xlsx`, `.xls`, `.xlsm`, `.csv` by suffix and a 5 MiB cap.
- Write the body to a `tempfile.NamedTemporaryFile`, parse, load, record
  status, then always delete the temp path in `finally`.
- Stamp every extracted holding with the request `schemeCode`. Sheet titles
  such as `FLEXCAP` are not trusted as AMFI codes.
- If the file has no holdings header / no payload rows, return HTTP 422 with
  `{ "error": "parse-failed", "message": "No holdings table in this file." }`
  and do not change existing holdings.
- On success return the same camelCase filing object as `/api/ingest/ensure`
  (`schemeCode`, `state`, `asOf`, `reason`, …).

Client: `uploadFiling(schemeCode, file): Promise<FilingStatus>`.

## Parser additions

Reuse `sheet_to_csv_rows` / `parse_holdings_csv`. Extend the Excel path to:

- Read `as_of` from banner text such as `Portfolio as on Jul 31,2026`.
- Treat section totals (`Equity & Equity Related`, `Debt Instruments`) as
  non-holdings.
- Classify TREPS / cash / cash-margin lines as cash-like holdings.
- Capture `Total Net Assets` as AUM (convert ₹ lakh → crore).
- Capture `Portfolio turnover Ratio` as `turnover`.

Weights that arrive as fractions (`0.10`) stay normalized to percent the same
way auto-ingest already does.

## Insights payload

Each insights basket fund already has expense / PE. Add on the same object:

- `aumCr: number | null` — that scheme’s `fundamentals.aum_cr` for the
  displayed filing date, or null. Never average missing funds as zero.
- `turnover: number | null` — that scheme’s `fundamentals.turnover`, or null.

Snapshot shows these as extra columns on the existing per-fund table.
- `overlapHoldings: Record<string, OverlapName[]>` keyed like existing
  `overlap` (`idA|idB`). Each `OverlapName` is
  `{ isin, name, weightA, weightB, minWeight }`, sorted by `minWeight`
  descending, capped at 15 names. Built from ISIN intersection of the two
  baskets’ look-through weights. Names come from the stored instrument name.

`overlap` (the scalar pair percentage) is unchanged.

## Insights UI

Filing coverage lists every fund in the focused basket. Each row has
**Add filing** (outlined square button), including `fresh` funds.

- Click opens a hidden file input:
  `accept=".xlsx,.xls,.xlsm,.csv"`.
- That fund’s button shows **Reading filing** and `aria-busy` until the
  request settles. Other funds stay usable.
- On success, refetch insights. Snapshot shows AUM and turnover when not
  null. Mix includes cash/TREPS buckets. Overlap keeps the pair bar and adds
  the shared-name table.
- **Fetch latest filings** remains the AMC download retry.

Error copy (under the fund row, loss-colored sentence, no red outline):

| Case | Copy |
|---|---|
| Too large or wrong type (client) | `Use an AMC portfolio file under 5 MB (.xlsx, .xls, or .csv).` |
| 422 no table | `No holdings table in this file.` |
| Other 4xx/5xx | `Could not read this filing.` plus API `message` when present |
| Network | `Upload failed.` |

A failed upload must not clear last-good holdings.

## Error handling and limits

- One in-flight upload per `schemeCode`. A second click on the same fund is
  ignored until the first settles.
- Temp files never outlive the request.
- Auto-ensure and user upload stay independent: upload does not call
  `ensure_filings`; ensure does not delete user-uploaded holdings unless a
  newer official file for that scheme actually parses.

## Tests

API:

- Upload of the ICICI-style fixture (header + `% to Nav` as fraction + TREPS +
  total net assets + turnover) stamps `schemeCode`, stores cash-like rows,
  writes `aum_cr` / `turnover`, deletes the temp path, returns `reason`
  `user upload`.
- File over 5 MiB or `.pdf` is rejected without writing holdings.
- File with no ISIN/% header is 422 and leaves prior holdings in place.
- A second upload for the same scheme replaces older `as_of` rows.

Web:

- Every coverage fund has **Add filing**.
- Choosing a valid file shows **Reading filing**, then updated coverage.
- Rejected type/size shows the 5 MB copy without calling the API.
- Failed upload keeps the previous holdings table.

## Verification

Run the API suite, web Vitest suite, and a browser pass: open Insights, attach
the ICICI Flexicap July 2026 workbook to that fund, confirm holdings/Mix/AUM
appear, confirm the file is gone from `/tmp`, then attach a junk PDF and
confirm the last filing remains.
