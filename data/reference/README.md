# Issuer research database

`ticker-profiles.csv` is the canonical database for the 500 distinct symbols in the supplied trade history. Research snapshot: **2026-11-05**. Each row links to SEC issuer metadata and the annual report or registration statement used in the extraction. No account details or trade executions are sent to the SEC.

The database separates three questions:

- **Incorporation:** the country and state/territory that govern the listed legal entity's corporate organization, from SEC metadata or the filing cover.
- **Principal operations:** an operating-country concentration expressly disclosed in the filing, a documented review, or an explicitly labeled inference from functional facilities. An executive-office address alone is insufficient.
- **Structure:** direct common/ordinary shares versus American depositary shares, and whether an issuer-specific VIE arrangement is expressly described or denied. Depositary shares and a VIE are independent attributes.

A jurisdiction is not a claim that only that jurisdiction's laws apply. A company can have simultaneous regulatory exposure in several countries. Revenue location, operating facilities, incorporation and headquarters are separate facts; uncertain principal-country attribution stays blank. Hong Kong, mainland China and Taiwan remain distinct labels.

## Files

| File | Purpose |
| --- | --- |
| `ticker-profiles.csv` | Canonical source-linked issuer records used by the dashboard. |
| `research-summary.json` | Coverage counts, including unverified fields and inferences. |
| `ticker-identities.json` | Historical symbols and CIKs missing from the current ticker index. |
| `ticker-review-overrides.json` | Documented corrections and reviews that survive re-extraction. |

Raw SEC responses and working excerpts are cached in `.cache/ticker-research/`, excluded from Git and publication. The downloadable database contains factual classifications and paraphrased research notes, not complete filings.

## Field definitions

| Fields | Meaning |
| --- | --- |
| `symbol`, `issuer_name`, `cik` | Trade-history symbol, SEC issuer name at research time and stable SEC filer identifier. A historical symbol may differ from the current name/ticker. |
| `first_trade_date`, `last_trade_date` | Observed trade dates in the supplied history, not legal validity dates. |
| `incorporation_country`, `incorporation_jurisdiction` | Country and detailed jurisdiction of the listed entity. US state codes are expanded to their full state names so Delaware and DE do not form different groups. |
| `headquarters_country` | Country of the separately disclosed business address. It is not substituted for operating country. |
| `operating_country`, `operations_basis` | Principal-country classification, if established, and its reasoning. Blank means unknown or no single country established. |
| `security_type`, `security_basis` | `direct_equity`, `ADS` or `unknown`, with the basis for distinguishing the listed security. |
| `vie_status`, `vie_basis` | `yes_explicit`, `no_explicit` or `unknown`, with the basis. Unknown is not equivalent to no VIE. An accounting VIE is not necessarily a Chinese contractual operating structure. |
| `identity_status`, `identity_source_url` | Exact current ticker match or historical ticker lookup, with its source. |
| `incorporation_status` | `sec_metadata`, `filing_cover` or `unverified`. |
| `operations_status` | `explicit_filing`, `reviewed`, `facilities_inference` or `unverified`. |
| `structure_status` | `cover_table`, `reviewed` or `unverified`. It concerns the listed security, not proof of VIE absence. |
| `review_status` | `complete` means the extraction has values for the requested fields, including an inference if labeled; `partial` means some requested field remains unresolved. This is not a legal certification or a claim of exhaustive manual review. |
| `source_profile_url`, `source_filing_url`, `source_filing_date` | Primary SEC sources and the filing's publication date. |
| `checked_on`, `historical_note`, `notes` | Research snapshot date, historical limitations and additional notes. |

Dashboard country studies and unidentified-ticker counts use only `incorporation_country`. A missing detailed jurisdiction, operating country, headquarters, security type or VIE does not make a ticker unidentified. Those fields remain available in the Tickers registry as reference information. The legacy trade-level `country` field still stores confirmed operating country for compatibility, but is not used to group dashboard statistics. Existing PnL and trade accounting are unchanged.

The second review pass uses operating disclosures and functional properties to resolve supported classifications, with persistent reasoning in `ticker-review-overrides.json`. Multiple-country businesses, virtual executive addresses and international shipping routes are not forced into one operating country. VIE reviews distinguish current arrangements from terminated structures, accounting consolidation from Chinese contractual operating structures, and unconsolidated interests from consolidated subsidiaries. A generic accounting policy or a statement about off-balance-sheet arrangements alone does not establish VIE absence.

## Updating the snapshot

The initial extraction used the SEC's [current ticker index](https://www.sec.gov/files/company_tickers.json), [historical ticker file](https://www.sec.gov/include/ticker.txt), submissions API and original filings. Historical aliases are corroborated with issuer records; do not assume a ticker is globally unique forever.

```powershell
$env:SEC_USER_AGENT = 'Your application name and genuine contact email'
python scripts/research_tickers.py
python scripts/classify_tickers.py
python scripts/build_data.py
python -m unittest discover -s scripts -p 'test_*.py'
```

The collector is resumable, caches public responses and limits request rate. `--symbols AIOK,TNMG` refreshes selected issuers while retaining other cached records. Its working CSV stays in the ignored cache. The classifier rebuilds the canonical CSV from the full cache and applies `ticker-review-overrides.json` last. Updating the research cutoff requires changing `AS_OF` in the collector and reviewing newer reorganizations; cached sources are intentionally reused unless explicitly removed.

Review filings for changes in domicile, subsidiaries, ADR programs, VIE termination and business combinations before treating this snapshot as a historical classification for each individual trade. Blank fields remain research work rather than invented values.
