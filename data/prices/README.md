# Historical market prices

This directory is reserved for historical ticker prices, including traded
sessions and surrounding trading days. It is part of the repository and is not
excluded by `.gitignore`. No market data has been imported here yet.

Use the following layout as data is added:

```text
data/prices/
  raw/<provider>/<dataset>/<schema>/<download-id>/
  bars/<provider>/<dataset>/<schema>/<symbol>/<YYYY>/<YYYY-MM-DD>.parquet
  manifests/<download-id>.json
```

- `raw/`: original downloaded files, preserving their source encoding and
  precision. Retain original provider files such as DBN when available.
- `bars/`: normalized OHLCV data, separated by provider, dataset, resolution,
  symbol and session. Prefer Parquet for new large price histories.
- `manifests/`: provenance and coverage for each import, including provider,
  dataset, schema, source filenames and checksums, download time, instrument IDs
  and dated symbol mappings, requested and observed ranges, session timezone,
  session hours, price units, adjustment basis and known gaps or limitations.

Store event timestamps in UTC and define trading-session dates using
`America/New_York` for US equities. Distinguish regular and extended hours,
unadjusted and adjusted prices, splits and ADS ratios. Missing intervals do not
automatically mean zero activity. Keep venue-specific data separate from
consolidated data. Reuse overlapping ticker sessions rather than duplicating
them for every trade.

The existing NVDA JSON chart files remain in `data/research/`; they have not been
moved or duplicated. That directory currently serves the research prototype.
This new directory does not automatically feed the dashboard or introduce a
local query engine. A later import and query workflow must connect it.

Local additions require a commit and push to be available on another computer.
Large historical downloads may require Git LFS; it has not been configured by
creating this directory. Do not publish raw downloads automatically through the
website deployment.
