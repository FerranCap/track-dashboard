# Historical market prices

This directory is reserved for historical ticker prices, including traded
sessions and surrounding trading days. It is part of the repository and is not
excluded by `.gitignore`. The initial local comparison contains BENF on
2026-11-24 in `ohlcv-1m`, separately downloaded from `XNAS.ITCH`, `XNAS.BASIC`
and `EQUS.MINI`. Each request covers midnight to midnight in America/New_York;
only provider-supplied bars are retained. The combined preflight estimate was
USD 0.001235425472. Original DBN, fixed-point Parquet and validated manifests
are retained. See `comparisons/benf-2026-11-24.json` for counts and observed
ranges. Coverage and volume differ by dataset; their overlapping volumes must
not be added together. These files have not been published.

Use the following layout as data is added:

```text
data/prices/
  index.json
  tickers/<SYMBOL>/<YYYY-MM-DD>/
    executions.json
    <provider>/<dataset>/ohlcv-1m/
      <download-id>.dbn.zst
      <download-id>.parquet
      <download-id>.manifest.json
      chart.json
```

- `.dbn.zst`: original downloaded records, preserving encoding and precision.
- `.parquet`: normalized fixed-point OHLCV, kept separately for each source.
- `.manifest.json`: provenance and coverage for each import, including provider,
  dataset, schema, source filenames and checksums, download time, instrument IDs
  and dated symbol mappings, requested and observed ranges, session timezone,
  session hours, price units, adjustment basis and known gaps or limitations.
- `chart.json`: reusable browser series with UTC epoch seconds and USD prices
  serialized as decimal strings. Sources are never combined.
- `executions.json`: deduplicated original CSV fills keyed by trade ID, with exact
  opening/closing timestamps to reject stale trade corrections. It contains no
  account identifiers and does not change trade accounting.
- `index.json`: lightweight lookup by ticker, New York session date and source;
  the browser loads only the selected day's source and execution file.

After adding validated Parquet files, run `python scripts/build_price_charts.py`
and `python scripts/build_data_completeness.py`. The explicit price downloader
also runs these builders after a download. The chart builder is offline and
checks manifest hashes, duplicates and execution quantities. `--check` validates
existing chart files without pandas; `--package DESTINATION` copies only the
index, chart JSON and execution JSON needed by the website. It excludes DBN,
Parquet, quote reports and manifests.

The current downloader groups new archives by ticker (or an explicit symbol
batch), requested start date, provider, dataset and schema. Legacy manifests in
`manifests/` remain readable for overlap checks. Download segments spanning
multiple days produce one `chart.json` per actual New York session date.

Store event timestamps in UTC and define trading-session dates using
`America/New_York` for US equities. Distinguish regular and extended hours,
unadjusted and adjusted prices, splits and ADS ratios. Missing intervals do not
automatically mean zero activity. Keep venue-specific data separate from
consolidated data. Reuse overlapping ticker sessions rather than duplicating
them for every trade.

The existing NVDA JSON chart files remain in `data/research/`; they have not been
moved or duplicated. That directory currently serves the research prototype.
Calendar now uses the shared price index for its trade chart. It shows one
selected trade with five minutes of context on each side by default, a source
selector and real execution markers. Price charts always use USD; dashboard
USD/R settings apply to PnL only. Missing bars remain gaps, and a ticker without
downloaded prices shows an explicit unavailable state.

Local additions require a commit and push to be available on another computer.
Large historical downloads may require Git LFS; it has not been configured by
creating this directory. Do not publish raw downloads automatically through the
website deployment.
