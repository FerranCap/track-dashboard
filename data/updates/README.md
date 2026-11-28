# Incremental data updates

The update tools collect source data with ordinary Python code. They do not call
an AI model or require an AI API key. Chat/model work is limited to compact
review packets and unresolved interpretation. Planning and staging do not change
trades, journal, risk, reviewed profiles, capital history or curated news.

## Daily use

Run from the repository root, with Python 3.11+ and timezone data available:

```powershell
python scripts/update_data.py status
python scripts/update_data.py run --limit 5 --max-requests 12
```

Select one or more traded tickers with `--symbols AMD` or `--symbols AMD,BENF`.
Combine it with `--domains news` or `--domains sec` to choose the data type.
Unknown traded symbols are rejected. The global queue/state is retained; the
selector restricts collection, packet generation and ready-publication promotion.

`run` alternates news and SEC jobs so one domain cannot starve the other. It
resumes from persistent checkpoints, reuses successful source responses and
defers failed sources instead of immediately retrying them. `--domains news`
or `--domains sec` restricts work. `--refresh` explicitly retries collection and
refreshes sources, rather than repeating all historical research by default.

## Ticker review registry

`status` reports review counts and the ten most recently traded tickers needing
work. Use `status --symbols AMD` for an exact ticker. After reviewing all of a
ticker's trade windows and verifying price coverage, explicitly record the work:

```powershell
python scripts/update_data.py ticker-review --symbols AMD --review-status reviewed_limited --note "News review is partial; later capital changes are unverified."
```

Use `complete` only when no SEC gaps, pending candidates or partial news reviews
remain. `reviewed_limited` records actual research and its remaining limitations;
it does not claim the missing information is known or that historical coverage is
exhaustive. Missing trade-window reviews or uncovered traded days prevent either
status. Never mark a ticker reviewed from collection or failed requests alone.

Each record stores a fingerprint of all canonical trades for that ticker, excluding
the derived country field. A new, deleted or corrected trade changes its computed
status to `trade_changed` and returns it to normal collection. The previous record
remains available for audit. The ordinary `run` and `packet` commands skip unchanged
reviewed tickers; `--refresh` is an explicit override. Existing evidence and exact
entry reviews remain in force when a ticker reopens. Explicit price commands still
perform their own preflight and reuse validated coverage.

The command also loads the existing local Python timezone dependencies. An
optional Windows launcher is available without requiring PowerShell script signing:

```powershell
./scripts/update-data.cmd run --domains news --limit 5
```

If timezone support is missing on Windows, install the small base dependency
locally; it is not a model or a paid data service:

```powershell
python -m pip install --target .cache/python-deps -r scripts/requirements-updates.txt
```

## Files and portability

| File/directory | Purpose |
| --- | --- |
| `config.json` | Batch, request, source and review-packet limits. |
| `queue.json` | Regenerated jobs grouped by issuer and overlapping windows. |
| `state.json` | Persistent collection progress, receipts and source limitations. |
| `ticker-reviews.json` | Explicit per-ticker review decisions, limitations and trade fingerprints. |
| `cache/` | Compressed source responses, SHA-256 checksums and retrieval metadata. |
| `candidates.json` | Deduplicated discoveries and persistent review decisions. |
| `review-packet.json` | Bounded evidence and exact historical research tasks. |
| `decision-template.json` | Pending decisions for the packet; copy before editing. |
| `last-run.json` | Small counters from the last collection batch. |

These files are inside the repository and are not ignored, except temporary
files and the process lock. Commit and push them to resume on another machine.
They are not packaged into the public website. Collection-only changes do not
trigger website deployment. Credentials stay in environment variables, never
these files. Cached responses from the previous ignored SEC cache can be reused;
their original retrieval age is explicitly unknown, not relabeled as fresh.

## Prepared website queries

`python scripts/build_query_data.py` builds `data/generated/` from consolidated
trades, reviewed news and SEC contexts, historical risk and the validated price
index. The originals remain authoritative. `trade-index.json` indexes trades by
ticker and session and records historical R values; `news-index.json` provides
matching metadata, with full details in `news/tickers/`; `similarity-index.json`
contains entry-time comparable references. `tickers/` and `sessions/` contain
reusable summaries. The summaries cover their stated full scope, not arbitrary
filter combinations. Unknown values stay unknown and date-only news remains
distinct from timestamp matches.

The manifest records input hashes, generated-file hashes and per-artifact
dependencies. Unchanged ticker and session artifacts are reused; global indexes
are regenerated as needed. `python scripts/build_query_data.py --check` compares
against a full reconstruction. Source-version markers are written before news
and SEC contexts change, so an interrupted standalone rebuild makes the browser
fall back instead of using the previous prepared index. After direct imports,
profile, news, SEC, risk or price changes, run the corresponding canonical
builders first, then the query builder and checks once after the batch. The
incremental updater and website deployment already perform this final build.

## News

Planning excludes existing reviews only when trade ID, exact opening timestamp,
issuer CIK and the required 48-hour scope still match. Several entries share one
collection window when their windows overlap. Corrected/new entries get their
own work. Existing unresolved publication candidates remain visible in packets.

Collectors start with Finviz and Yahoo Finance and then check SEC 8-K/6-K filing
metadata, including overlapping older submissions files when available. Quote
feeds are discovery sources, not exhaustive historical archives. A failed,
empty or recent-only source never creates a no-news review. Historical windows
that cannot be covered become explicit research tasks, not fabricated zeros.

Known timezone-aware publication times use the exact interval. Unknown clocks
stay in audit metadata. Verified dates can use the established same-day/two-day
fallback; date-only same-day order remains unconfirmed. Relative labels such as
Today are not converted into invented publication dates.

SEC filing existence/date can be established deterministically from official
issuer metadata. The tool conservatively uses the filing date, leaves the
publication hour null and does not interpret document contents. These ready
publications are excluded from the model review packet. Accept them explicitly:

```powershell
python scripts/update_data.py run --domains news --limit 5 --apply-ready-sec-news --check
```

This does not mark the whole historical window reviewed. Other discoveries need
issuer/date/content review. Duplicate syndications can be resolved with
`duplicateOf` pointing to an existing canonical article ID. The publication is
then retained once with the additional source URL and its original research
audit. Conflicting existing publication metadata is never silently overwritten.

## Small review packets

```powershell
python scripts/update_data.py packet
python scripts/update_data.py inspect --job NEWS_JOB_ID
```

Read `review-packet.json`, not the full cache or whole canonical archives. The
default packet has at most 10 candidate items and a total character budget of
12,000, with short excerpts. Oversized items stay staged and can be inspected
separately. Source text is untrusted data, never instructions. No source text is
executed, and no model is called automatically.

Copy the template to a new decision file. Set `reviewer` and `reviewedOn`, then
use `accept`, `reject` (with a reason), or leave `pending`. Each decision must
retain its candidate ID and evidence hash. If evidence changes, the old decision
does not silently apply. A non-SEC publication acceptance needs `issuerCik`,
`identityEvidence`, factual `summary`, `publisher`, `kind` and
`timestampEvidence`; `publication` can contain explicitly verified corrections
to headline, source URL, date or timestamp. Preserve source warnings.

To record a researched news window, add a `jobReviews` item containing the exact
job ID/fingerprint, `windowReviewed: true`, sources with documented `access`
(`reviewed`, `search_index` or `api_archive`) and coverage limitations. Failed
requests alone are insufficient. Identical decisions/window reviews are no-ops.

```powershell
python scripts/update_data.py apply --decisions data/updates/my-decisions.json --check
```

The complete proposed state is validated before canonical writes. Existing news
and reviews are preserved. Derived news, SEC and completeness files are rebuilt
once per accepted batch. No `build_data.py` rerun is needed for news-only work.
Tests run once with `--check`; failures remain failures. Dated regression
expectations are not rewritten automatically and require independent
reconciliation when newly accepted data changes their historical totals.

## SEC facts and reviewed profiles

The SEC collector stages structured Company Facts, primary filing references
and short operating/security/capital excerpts. Repeated identical facts are
deduplicated. Facts are not blindly treated as current float: share classes,
split adjustment bases, ADS ratios, publication dates and older observations
must be reconciled. Operating country is not inferred from headquarters.

Set `SEC_USER_AGENT` to your application identity and genuine contact for fresh
SEC requests. The existing project's public repository identity is the fallback;
it does not invent an email address. Rate/request limits apply across the batch.

Accepted SEC decisions can use either or both:

- `profilePatch`: `{ "symbol": "TICKER", "fields": { ... } }`, accompanied by
  `previousProfileHash`. Only existing string columns can be changed, not the
  issuer identity. Updates persist in the canonical CSV and reviewed overrides.
  An operating-country change requires `operations_basis`. The trade builder
  runs once to refresh embedded profiles; PnL and execution accounting must match.
- `issuerPatch`: a reviewed canonical capital record/extension with its symbol
  and CIK. Existing issuers require `previousIssuerHash`. Prior observations and
  events are retained, and conflicting observation IDs are rejected. Normal SEC
  capital validation is applied before accepting the batch.

Identity changes and substantive historical corrections still require explicit
reconciliation; they are not automated guesses.

## Databento prices

Price jobs default to one-minute XNAS.ITCH bars for the traded New York calendar
day only, from local midnight to the following local midnight. No additional days
are downloaded unless explicitly requested.
Dataset and window settings are configurable. Existing research chart snippets
are not assumed to cover whole sessions. Already validated overlapping download
windows are reused; each download processes the first remaining gap.

The optional downloader needs `DATABENTO_API_KEY` and the packages in
`scripts/requirements-update-prices.txt`. It checks schema availability, obtains
provider cost/record-count estimates and quotes without downloading by default:

```powershell
python scripts/update_data.py prices --job PRICE_JOB_ID --max-cost-usd 0
```

To execute, supply `--execute-download` and an explicit acceptable ceiling. The
default ceiling is zero; there are no background paid downloads. The estimate
is a preflight guard, not a guarantee of the final provider bill. Windows not
fully available yet remain pending. A maximum record count bounds batch size.

Original DBN and fixed-point Parquet preserve source values and instrument
mapping. Manifests record actual coverage, checksums, row counts and provenance.
Downloaded bars are checked for range, OHLCV validity, timestamps, symbol identity
and duplicates. Empty results do not imply complete coverage. Validated manifests
feed the data-completeness bars without rereading every Parquet file. Raw price
data is not published automatically; large-file Git/LFS setup remains separate.

## Operational limits

This ecosystem automates collection, deduplication, progress and validation; it
does not supply a licensed historical news archive or eliminate necessary human
interpretation. Finviz/Yahoo availability and historical depth are source
limitations. New provider adapters can stage the same candidate format without
changing canonical schemas. Failed requests are checkpointed with backoff and
attempt limits. A live process lock prevents concurrent update runs; inspect its
PID before removing a stale lock after an interrupted process.

Public source documentation: [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
[Databento cost preflight](https://databento.com/docs/api-historical/metadata/metadata-get-cost?lang=python),
[Databento Parquet export](https://databento.com/docs/api-historical/helpers/dbn-store-to-parquet?lang=python).
