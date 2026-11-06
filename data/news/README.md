# Reviewed trade news context

## Historical backfill progress

As of 2026-11-06, the source log contains partial reviews for **13 tickers and 31 exact trade entries**. The dataset has 500 tickers and 1,560 trades, leaving **1,529 entries without a matching review**. Of those, 487 tickers have not yet had any entry reviewed. The next work should continue from the most recent unreviewed entries, without inheriting a review merely because the ticker has previously been checked.

The initial November 2-5 batch added 7 publications and 12 issuer reviews covering 24 entries. Resolving DKI and VCIG under the revised user policy adds two publications. Combined with the preserved VIVK pilot, the context now has **18 publications, 15 topics, 33 trade/publication links, 5 date-only links and 23 trades with news**. Its 44 trades include 13 older entries that remain unreviewed; 44 is not the reviewed-entry count.

| Symbol | Reviewed session | Publications added | Publication evidence |
| --- | --- | --- | --- |
| LABT | 2026-11-05 | 1 | [Issuer redemption release](https://www.prnewswire.com/news-releases/lakewood-amedex-biotherapeutics-announces-completion-of-series-c-convertible-preferred-stock-redemption-302930368.html), 08:02 ET; applies to all seven entries. |
| PLCE | 2026-11-05 | 2 | [Leadership filing](https://www.sec.gov/Archives/edgar/data/1041859/000110465926122379/tm2628920d1_8k.htm), November 4, public availability 08:01 EST; [TheStreet reporting](https://www.thestreet.com/retail/57-year-old-childrens-chain-considers-chapter-11-liquidation), November 4, 09:01 EST. |
| HPAI | 2026-11-04 | 1 | [Issuer deployment update](https://www.globenewswire.com/de/news-release/2026/11/03/3394898/0/en/helport-ai-advances-transition-to-autonomous-ai-labor-in-southeast-asian-fintech-market.html), November 3, 17:36 ET. |
| MERC | 2026-11-03 | 1 | [Issuer recapitalization release](https://mercerint.com/news/mercer-international-announces-comprehensive-recapitalization-agreement-with-significant-support-from-noteholders-and-shareholders/), November 2, 18:49 EST; applies to four entries. |
| DKI | 2026-11-04 | 2 | [Charter filing](https://www.sec.gov/Archives/edgar/data/2058584/000149315226049713/form6-k.htm), November 3, 08:18:43 EST; [November 4 report](https://www.investing.com/news/stock-market-news/why-is-darkiris-stock-surging-66-today-93CH-4997941), counted by date with its unconfirmed clock hidden. |
| INO | 2026-11-02 | 1 | [Newly published filing and investor presentation](https://www.sec.gov/Archives/edgar/data/1055726/000119312526442648/d150457d8k.htm), November 2, 07:15 EST; the October 30 approval release itself is outside the entry window. |
| INLF, WFF, SRTS, OMH, CHSN | 2026-11-02–04 | 0 | Partial searches found no eligible issuer publication in the consulted sources. This is not exhaustive coverage. |
| VCIG | 2026-11-03 | 1 | [Financialist report](https://www.financialist.com/news/ipo/vci-global-ltd-files-amendment-for-share-offering-000121390026115124), 06:06 EST. Publication is verified; conflicting contents remain explicit source warnings. |

The original DKI and VCIG candidates are preserved in resolvedCandidates, with their resolutions and article IDs. DKI counts by date with pre-entry ordering explicitly unconfirmed. VCIG counts as an identified publication while its conflicting filing details, earlier indexed-title mismatch and inaccessible underlying filing remain visible. No unresolved publication candidates remain in these reviews; older unreviewed entries still remain pending. Direct Yahoo requests returned HTTP 429. Earlier pilot notes below are retained as audit history.

Confirmed publication times use **48 elapsed hours before the first entry**. Under the revised user rule, an unknown hour or timezone means using the verified date on the New York entry day or either of its two preceding dates. Same-day date matches count but do not establish publication before entry. Hide the unknown clock in the dashboard and retain it only in audit metadata; publishedAt stays null. A known out-of-window timestamp cannot use date fallback. No continuous news feed is collected.

## Files and rebuild

Tickers has a separate news coverage audit for the entire trade history, independent of the analysis filters and issuer-country completeness. It lists unreviewed entries, partial ticker reviews and unresolved publication candidates, with search and status filters. A ticker is complete only when every current trade ID and exact entry timestamp has a 48-hour review and no candidate remains unresolved. A reviewed entry with no publication found still counts as reviewed. The completion badge is hidden for empty history, unavailable news, new or changed entries and unresolved candidates. The badge describes review progress, not exhaustive news discovery.

The general and comparison news sliders use 0 to disable filtering, 50 for 24 hours, and 100 for 48 hours. Exact timestamps use elapsed hours. Date-only same-day publications use a nominal zero-hour band and enter at any positive setting; previous-day publications enter at 24 hours, and two-days-earlier publications at 48 hours. These are filter bands, not invented timestamps or exact ages. Same-day pre-entry order remains explicitly unconfirmed. Identified, dated publications with contradictory contents count, with discrepancies in sourceWarnings and the summary; this verifies publication existence, not its financial claims. Apply activates changes; Clear disables the filter.

- `articles.json`: reviewed publication records, short factual summaries and timestamp evidence. Reproductions of one article use `sourceUrls`, not additional article IDs. Separate publications discussing the same event share an `eventId`.
- `research.json`: source access, exact entries reviewed, unresolved candidates and coverage limitations. New trades and changed entries do not inherit a completed review.
- `trade-context.json`: generated, reproducible links from publications to trades. Do not edit it by hand.

```powershell
python scripts/build_news.py --hours 48
python -m unittest discover -s scripts -p 'test_*.py'
```

The Tickers table loads `trade-context.json` and shows a publication count with expandable dates, source links, summaries and linked entries. Unresearched tickers show an unreviewed state rather than zero news. Deployment rebuilds this context after trade consolidation and includes the generated file in the site artifact. The default scope includes every symbol in the curated articles and research log; `--symbols VIVK` is an optional restricted pilot rebuild. Daily imports include new news research as required by `AGENTS.md`; this builder only links already curated evidence. Trade IDs, execution counts, PnL and accounting sources are not modified. VIE fields remain in the issuer database but are not shown as a table column.

## Reviewed results

Review date: 2026-11-06. Seven VIVK trades across four sessions have confirmed preceding publications: **9 publications, 7 distinct topics and 15 trade/publication links** (11 timestamp links and 4 date-fallback links). Finding a publication is not evidence that it caused the price move, and coverage remains partial.

| Entry, New York | Side | Confirmed prior context | Distinct topics |
| --- | --- | --- | --- |
| 2026-07-24 10:27:29 | Short | Jul 22: crude-contract report, date fallback; Jul 24 09:15: additional crude programs | 2 |
| 2026-07-29 08:21:49 | Short | Jul 27 09:15: Houston commissioning; Jul 28: commissioning report, date fallback; Jul 29 07:59: Benzinga crude guidance report | 2 |
| 2026-07-29 08:30:55 | Short | Jul 27 09:15: Houston commissioning; Jul 28: commissioning report, date fallback; Jul 29 07:59: Benzinga crude guidance report | 2 |
| 2026-07-29 09:22:42 | Short | Jul 28: commissioning report, date fallback; Jul 29 07:59: Benzinga report; Jul 29 09:15: official guidance release | 2 |
| 2026-10-09 09:17:41 | Long | Oct 9 09:00: nonbinding Direct Midstream acquisition LOI | 1 |
| 2026-11-06 08:48:23 | Long | Nov 4 09:00: conditional well agreement at acquisition target; Nov 5 09:00: project adviser | 2 |
| 2026-11-06 09:06:58 | Long | Nov 5 09:00: project adviser | 1 |

The Jul 27 release is already over 48 hours old at the Jul 29 09:22 entry. Similarly, the Nov 4 release is over 48 hours old at the Nov 6 09:06 entry. The matching is per trade, not a whole-session label.

## Source checks

- [Jul 24 issuer release, hosted by Finviz](https://finviz.com/news/372412/vivakor-surpasses-1-billion-in-annualized-physical-crude-transactions): additional physical crude programs. [Indexed Yahoo syndication](https://sg.finance.yahoo.com/news/vivakor-surpasses-1-billion-annualized-131500139.html) states 09:15 GMT-4.
- [Jul 27 issuer release, hosted by Finviz](https://finviz.com/news/372852/vivakor-advances-houston-oil-remediation-processing-center-toward-commercial-operations): completion of joint-venture funding commitments and start of commissioning. The [release listing](https://marketchameleon.com/Overview/VIVK/PressReleases/) corroborates 09:15 ET.
- [Jul 29 Benzinga reporting](https://www.benzinga.com/markets/small-cap/26/07/60756438/exclusive-vivakor-expands-crude-oil-business-again-targets-1-5-billion-annual-platform): the [indexed Yahoo syndication](https://uk.finance.yahoo.com/news/vivakor-expands-crude-oil-business-115958522.html) says 07:59 GMT-4; Benzinga's current article header rounds to 08:00. The record retains minute precision and documents this discrepancy.
- [Jul 29 official release, hosted by Finviz](https://finviz.com/news/374234/vivakor-updates-guidance-of-crude-oil-marketing-platform-to-approximately-15-billion-annually): separate 09:15 publication on the same guidance topic. It is **not** attached to the 08:21 or 08:30 entries. The release is also reproduced with an [explicit EDT timestamp](https://www.streetinsider.com/related.php?id=26831826&type=pr).
- [Oct 9 issuer release, hosted by Finviz](https://finviz.com/news/400869/vivakor-signs-loi-for-proposed-40-million-acquisition-of-direct-midstream): nonbinding LOI, not a completed acquisition. [Indexed Yahoo syndication](https://finance.yahoo.com/energy/articles/vivakor-signs-loi-proposed-40-130000449.html) states 09:00 EDT.
- [Nov 4 issuer release, hosted by Finviz](https://finviz.com/news/415478/vivakor-highlights-direct-midstreams-new-mexico-operating-agreement-as-proposed-acquisition-advances): conditional agreement at the proposed acquisition target. [Indexed Yahoo syndication](https://sg.finance.yahoo.com/news/vivakor-highlights-direct-midstream-mexico-140000960.html) states 09:00 GMT-5.
- [Nov 5 issuer release, hosted by Finviz](https://finviz.com/news/417059/vivakor-engages-energy-infrastructure-executive-bernard-brown-to-advance-airport-hydrogen-project): project adviser engagement. [Indexed Yahoo syndication](https://sg.finance.yahoo.com/news/vivakor-engages-energy-infrastructure-executive-140000490.html) states 09:00 GMT-5.

## Remaining uncertainties

Direct Yahoo requests returned HTTP 429; its indexed issuer/Benzinga syndications were compared with individually opened Finviz/Benzinga pages. The issuer site timed out, and the GlobeNewswire archive did not expose usable original article pages in this review. The primary issuer statements are preserved as syndicated releases, not represented as directly fetched issuer-site pages.

The two earlier timing candidates now qualify under the user-authorized date fallback: the [Jul 22 contract report](https://ticker.report/news/vivk-vivakor-signs-new-crude-oil-contracts-adding-289m-in-annual-activity-2026-07-22) has no publication hour, and the [Jul 28 commissioning report](https://www.benzinga.com/trading-ideas/movers/26/07/60735063/whats-going-on-with-vivakor-shares-on-tuesday) displays 12:38 without a verified timezone. They are labeled as date matches, not given invented midnight timestamps. Their earlier research notes remain in resolvedCandidates for audit. No headline-only premium snippets or automated market roundups are counted as confirmed issuer news in this pilot.

Publication evidence does not prove the current text matches the exact version available before entry. All records disclose `contentAsOfEntryVerified: false`. The summaries describe reported facts and conditions, not a retrospective claim of causation or sentiment.

Minute precision is modeled as a one-minute interval. A record is confirmed for a trade only if that complete interval fits inside its entry window; a boundary overlap remains uncertain. Date-only records use publishedAt: null, a verified publicationDate and matchingBasis: publication_date. Exact-time records retain matchingBasis: timestamp and cannot fall back to dates to bypass an out-of-window hour. Matching uses UTC elapsed time across daylight saving changes.
