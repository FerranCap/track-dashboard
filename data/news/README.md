# Reviewed trade news context

## Historical backfill progress

As of 2026-11-06, the source log contains partial reviews for **13 tickers and 31 exact trade entries**. The dataset has 500 tickers and 1,560 trades, leaving **1,529 entries without a matching review**. Of those, 487 tickers have not yet had any entry reviewed. The next work should continue from the most recent unreviewed entries, without inheriting a review merely because the ticker has previously been checked.

The November 2–5 batch adds **7 publications and 12 issuer reviews covering 24 entries**. Combined with the preserved VIVK pilot, the generated context contains **16 publications, 14 topics, 31 trade/publication links, 4 date-only links and 22 trades with qualifying news**. The 44 trades in the generated scope include 13 older entries of these tickers that remain unreviewed; 44 is not the reviewed-entry count. No new date-only publication was needed in this batch.

| Symbol | Reviewed session | Publications added | Publication evidence |
| --- | --- | --- | --- |
| LABT | 2026-11-05 | 1 | [Issuer redemption release](https://www.prnewswire.com/news-releases/lakewood-amedex-biotherapeutics-announces-completion-of-series-c-convertible-preferred-stock-redemption-302930368.html), 08:02 ET; applies to all seven entries. |
| PLCE | 2026-11-05 | 2 | [Leadership filing](https://www.sec.gov/Archives/edgar/data/1041859/000110465926122379/tm2628920d1_8k.htm), November 4, public availability 08:01 EST; [TheStreet reporting](https://www.thestreet.com/retail/57-year-old-childrens-chain-considers-chapter-11-liquidation), November 4, 09:01 EST. |
| HPAI | 2026-11-04 | 1 | [Issuer deployment update](https://www.globenewswire.com/de/news-release/2026/11/03/3394898/0/en/helport-ai-advances-transition-to-autonomous-ai-labor-in-southeast-asian-fintech-market.html), November 3, 17:36 ET. |
| MERC | 2026-11-03 | 1 | [Issuer recapitalization release](https://mercerint.com/news/mercer-international-announces-comprehensive-recapitalization-agreement-with-significant-support-from-noteholders-and-shareholders/), November 2, 18:49 EST; applies to four entries. |
| DKI | 2026-11-04 | 1 | [Charter filing](https://www.sec.gov/Archives/edgar/data/2058584/000149315226049713/form6-k.htm), November 3, 08:18:43 EST. |
| INO | 2026-11-02 | 1 | [Newly published filing and investor presentation](https://www.sec.gov/Archives/edgar/data/1055726/000119312526442648/d150457d8k.htm), November 2, 07:15 EST; the October 30 approval release itself is outside the entry window. |
| INLF, WFF, SRTS, OMH, CHSN | 2026-11-02–04 | 0 | Partial searches found no eligible issuer publication in the consulted sources. This is not exhaustive coverage. |
| VCIG | 2026-11-03 | 0 confirmed | A filing candidate remains unverified; it is not converted to a no-news finding. |

Two candidates remain explicit in `research.json`: a VCIG registration-filing report with conflicting indexed details and an inaccessible original filing, and a same-day DKI report without a confirmed timezone. The DKI filing is independently eligible, but that does not establish the report's timing. Yahoo direct requests returned HTTP 429 across this batch; the audit log identifies indexed evidence and original pages used. Publication timestamps do not establish a pre-entry archived text version. The earlier pilot below is retained as its own audit record.

The VIVK pilot uses **48 elapsed hours before the first entry** when publication time and timezone are confirmed. Only when the hour or timezone is unknown, a verified publication date in either of the **two preceding calendar days** qualifies. For a trade on the 20th, date-only news from the 18th and 19th qualifies. Same-day publications with known times still qualify if they precede entry; same-day date-only news remains uncertain. Entry dates use New York time. No continuous news feed is collected.

## Files and rebuild

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
