# Filings status and insights design

## Goal

Make official mutual-fund filing ingestion dependable and observable. Opening
Insights should attempt a refresh automatically without blocking the user. The
app must show exactly which scheme has usable data, which is being refreshed,
which is stale, and why a scheme could not be refreshed. A user can retry only
the affected schemes with **Fetch latest filings**.

This release also turns the Insights sheet into a more useful research view:
look-through holdings and exposure analytics retain their existing calculations
but gain filing provenance, freshness, and coverage context. Risk metrics remain
NAV-derived and are labelled separately from filing-derived data.

## Non-goals

- No brokerage connection, paper trading, scheduling, account, or execution.
- No invented filing metrics or third-party ratings.
- No blocking page load while an AMC source is slow or unavailable.
- No background retry loop that repeatedly hammers AMC disclosure pages.

## Data model

Add a SQLite record for each filing attempt by scheme, containing the scheme
code, requested month, attempted/finished timestamps, result (`fresh`,
`missing-source`, `download-failed`, `parse-failed`, or `unmapped`), AMC, source
URL when known, human-readable reason, and the filing `as_of` date when one was
ingested. Keep the latest record per scheme/month and retain earlier months for
auditability.

`holdings` remains the source of truth for usable portfolio data. A scheme is
`fresh` when it has holdings for the target/current disclosure month; older
holdings remain displayable as `stale`, with their actual filing date. Existing
fixture data is explicitly identified as fixture/cached data rather than claimed
to be a live filing.

## Ingestion and API flow

1. Opening Insights immediately requests cached insights and filing status for
   the active schemes.
2. In parallel, the client asks the API to ensure filings only for schemes that
   are missing or stale. The request returns a per-scheme result; it does not
   hide failures behind an empty `missing` list.
3. The client refetches insights once the ensure request settles. Cached data is
   never removed if a refresh fails.
4. The API loads the cached scheme master, fetches it once only if absent, and
   records a master/source failure instead of silently using an empty mapping.
5. AMC fetches expose their selected source URL and failure category to the
   caller. The parser reports whether a file downloaded but had no recognised
   rows or no scheme mapping.
6. The manual button is shown whenever one or more focused schemes is stale,
   unavailable, or failed. It performs one explicit retry and updates the same
   status rows in place.

The FastAPI endpoints return structured `filings` status alongside insights.
Network and parse exceptions are translated into a stable API result; unexpected
server failures still use an HTTP error response.

## Insights experience

At the top of the sheet, show a compact **Filing coverage** block for the
focused basket: latest usable filing date, coverage count (for example `2 of 3
funds`), and one line per fund with its state and reason. Use the existing
letterpress visual language and status colours only for status semantics.

Existing Holdings, Mix, Overlap, and Risk sections remain. Their labels make
the boundary clear:

- Holdings, sector, asset class, credit, equity-size, overlap, PE, and expense
  are based on the displayed filing date and show coverage/staleness.
- Sharpe, volatility, drawdown, alpha/beta, rolling return, and correlation are
  based on NAV and still render when filings are unavailable.
- A partial basket displays calculations from the covered funds, labelled as
  partial rather than treating missing funds as zero.

## Error handling

The API never reports success simply because the request completed. Each scheme
has one explicit terminal state and a reason. The UI distinguishes `fetching`
from `unavailable`, preserves the last usable filing, and gives the retry action
an accessible busy label. Refresh work is deduplicated per scheme set so opening
and saving a basket cannot start competing downloads.

## Tests and verification

Backend tests cover successful ingestion, each recorded failure category,
staleness detection, cached-data preservation, and structured endpoint results.
Frontend tests cover automatic refresh, manual retry visibility, status copy,
partial-coverage labels, and NAV risk surviving a filing failure. Run the API
test suite, web Vitest suite, TypeScript build, and a browser check of Insights
with a missing and a cached filing.
