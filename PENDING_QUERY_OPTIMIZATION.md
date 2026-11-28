# Query-data optimization status

The implementation resumed and was completed locally on 2026-11-28. Do not deploy, commit or push without authorization.

- `scripts/build_query_data.py` generates indexed and precomputed website data under `data/generated/`. Per-ticker, per-news-ticker and per-session outputs are reused when their inputs and stored hashes are unchanged; global indexes are rebuilt as necessary.
- The dashboard uses prepared trade, risk, news and similarity data, loads detailed news and ticker summaries on demand, and renders the active section. Source version markers and canonical-data fallbacks guard against stale derived inputs.
- Per-session summaries are generated for future consumers; Calendar currently calculates its filtered statistics from the canonical trades, preserving its existing behavior.
- `AGENTS.md` and `data/updates/README.md` describe the regeneration workflow and when to discuss additional preprocessed data with the user.
- Validation: `python scripts/build_query_data.py --check` passed for 1,330 files; the complete Python/Node suite passed (90 tests). Local browser checks covered navigation, news details, units, watchlist sessions and a trade chart.

After relevant source changes, follow the builder and validation instructions in `AGENTS.md`. Do not edit generated files manually.
