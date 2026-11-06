# Reviewed trade news context

## Historical backfill progress

As of 2026-11-06, the source log contains partial reviews for **127 tickers and 305 exact trade entries**. The dataset has 500 tickers and 1,560 trades, leaving **1,255 entries without a matching review**. Of those, 373 tickers have not yet had any entry reviewed. The next work should continue from the most recent unreviewed entries, without inheriting a review merely because the ticker has previously been checked.

The user-authorized fifteen-minute backfill on November 6 added **54 reviewed entries and 20 publications**, preserving the previous 31 reviewed entries. At the end of that first timed batch, totals were **38 publications, 32 topics, 94 trade/publication links, 8 date-only links and 71 trades with news** across 85 reviewed entries. These are historical batch counts, not current totals.

Resume with ZBAO on July 22 (12:07:13 New York), KUST on July 22 (10:00:26), and LABT on July 22 (08:31:01), then the July 21 OMH and KIDZ entries. September and August gaps covered by this batch are now reviewed. Validate each exact entry against research.json before extending a review.

The first timed batch covered exact selected entry dates for SLGB, TNMG, BURU, CETX, PCLA, CHOW, NEXR, AIOK, NUWE, POM, TDIC, ZTG, YRD, TGL, GENK, GLND, JZ, TCRT and WFF. Canonical sources and date exclusions are retained in articles.json and research.json. Same-day date-only matches for GLND and WFF explicitly leave pre-entry publication unconfirmed. GENK's initially uncertain timezone was resolved using explicit EDT syndications. The WFF report's Viatris acquisition assertion is disputed, and is not recorded as an actual corporate transaction. Direct Yahoo retrieval was restricted; indexed syndications and original releases are identified individually. These are partial source reviews, not exhaustive archived feeds.

### Third timed batch: thirty-minute continuation

The user-authorized thirty-minute continuation on November 6 added **120 exact reviewed entries and 68 publications**, preserving all previous 185 exact reviews, articles, source records and trade links. Accumulated review coverage is **305 of 1,560 trades (19.55%)**, leaving **1,255 unreviewed**. The new entries comprise **102 with linked publications and 18 with none established in consulted sources**. Overall, **259 reviewed trades have news and 46 have none established**. All reviews remain partial source reviews, not exhaustive archive coverage.

Current generated totals are **143 publications, 135 topics, 294 trade/publication links and 36 date-only links**. This batch adds 109 links, including 22 date-only links. The generated scope contains 419 trades, including 114 unreviewed entries; scope size is not a review-completion count. Sources cover 127 reviewed tickers, with 373 tickers still without any exact reviewed entry.

Time checks distinguish publication from event dates. RDAC's August 19 Nasdaq event was filed on August 20 according to SEC EDGAR, and ZYBT's August 5 letter was announced August 6. AUUD's original August 10 release at 07:00 ET precedes entry despite later reproductions at 09:50/09:58. BMGL's 15:36 UTC commentary qualifies only its final September 14 entry. DFNS's July 31 operating update at 10:39 ET is after entry, while the separately dated prior-day report can qualify. GMM's visible July 28 21:46 ET timestamp takes precedence over its July 29 URL path. Known out-of-window timestamps are never converted into date-only matches.

Unknown-timezone publications retain null publishedAt and a separate audit clock. Same-day CDTG, SDOT and AGRZ market mentions explicitly warn that their afternoon clocks could be after the entries; they count solely under the user's agreed date rule, without asserting pre-entry availability. Conditional acquisitions, capital facilities, projections, share registrations and medical publications are described without treating them as completed financings, realized revenue, issued shares or regulatory approvals. Finviz and Yahoo were checked first, with original issuer/distributor evidence followed where accessible; direct Yahoo access remained restricted.

An independent reconciliation recalculated every link from publication dates/timestamps, checked issuer CIKs and unique canonical IDs/URLs, confirmed every article serves at least one trade, and preserved every previous exact review and link. The raw trade SHA-256 remains `1eb6cb2172e928c1c93bd4d18afd3687438134674d435e57b4f86e747fe43fa8`; all 1,560 trades, execution accounting and PnL remain unchanged. The Python suite and JavaScript coverage/filter checks pass. Changes are local.

| Symbol | Entry session | Newly reviewed trades | Trades with linked publications |
| --- | --- | ---: | ---: |
| FTFT | 2026-09-16 | 1 | 1 |
| SUGP | 2026-09-15 | 1 | 1 |
| NCT | 2026-09-14 | 2 | 2 |
| FTFT | 2026-09-14 | 1 | 1 |
| BMGL | 2026-09-14 | 4 | 1 |
| TRUG | 2026-09-11 | 4 | 4 |
| TNON | 2026-09-10 | 3 | 3 |
| OLB | 2026-09-09 | 1 | 1 |
| PDSB | 2026-09-08 | 1 | 1 |
| GCDT | 2026-09-08 | 1 | 1 |
| OFAL | 2026-09-04 | 1 | 1 |
| CDTG | 2026-09-04 | 2 | 2 |
| AKAN | 2026-09-04 | 1 | 1 |
| SSM | 2026-09-01 | 1 | 1 |
| HKPD | 2026-09-01 | 1 | 0 |
| CLGN | 2026-08-31 | 1 | 1 |
| QNRX | 2026-08-28 | 1 | 1 |
| FNGR | 2026-08-28 | 1 | 1 |
| CYAB | 2026-08-28 | 2 | 2 |
| MIMI | 2026-08-27 | 1 | 1 |
| CELU | 2026-08-27 | 1 | 1 |
| SOAR | 2026-08-26 | 1 | 1 |
| TNMG | 2026-08-25 | 1 | 1 |
| SWVL | 2026-08-25 | 1 | 1 |
| LUCY | 2026-08-24 | 2 | 2 |
| BTCT | 2026-08-24 | 1 | 1 |
| SDOT | 2026-08-21 | 1 | 1 |
| JUNS | 2026-08-21 | 2 | 2 |
| MMA | 2026-08-20 | 3 | 3 |
| HUIZ | 2026-08-20 | 5 | 5 |
| CDTG | 2026-08-20 | 1 | 0 |
| BRLS | 2026-08-20 | 2 | 0 |
| YJ | 2026-08-19 | 1 | 1 |
| TNON | 2026-08-19 | 1 | 1 |
| RDAC | 2026-08-19 | 1 | 0 |
| MSS | 2026-08-19 | 3 | 3 |
| XOS | 2026-08-18 | 2 | 2 |
| AIXC | 2026-08-18 | 1 | 1 |
| ONFO | 2026-08-14 | 2 | 2 |
| MDXH | 2026-08-14 | 1 | 1 |
| HCTI | 2026-08-13 | 2 | 2 |
| FGI | 2026-08-13 | 3 | 3 |
| DFSC | 2026-08-13 | 1 | 1 |
| PLAG | 2026-08-11 | 1 | 1 |
| MSGY | 2026-08-11 | 1 | 0 |
| GLE | 2026-08-11 | 1 | 1 |
| SCKT | 2026-08-10 | 2 | 2 |
| AUUD | 2026-08-10 | 1 | 1 |
| NAMI | 2026-08-07 | 1 | 1 |
| CPOP | 2026-08-07 | 1 | 1 |
| SURG | 2026-08-06 | 1 | 1 |
| AZI | 2026-08-06 | 1 | 1 |
| ZYBT | 2026-08-05 | 1 | 0 |
| YXT | 2026-08-05 | 3 | 0 |
| INLF | 2026-08-05 | 1 | 0 |
| TNMG | 2026-08-04 | 2 | 2 |
| ENSC | 2026-08-04 | 1 | 0 |
| AMIX | 2026-08-04 | 1 | 1 |
| EDBL | 2026-08-03 | 1 | 1 |
| MGRX | 2026-07-31 | 1 | 1 |
| FCUV | 2026-07-31 | 1 | 1 |
| DFNS | 2026-07-31 | 1 | 1 |
| NUWE | 2026-07-30 | 4 | 4 |
| CYCU | 2026-07-30 | 10 | 10 |
| GMM | 2026-07-29 | 1 | 1 |
| AGRZ | 2026-07-29 | 1 | 1 |
| POLA | 2026-07-28 | 3 | 3 |
| MTNB | 2026-07-27 | 2 | 2 |
| LVWR | 2026-07-24 | 1 | 1 |
| WBUY | 2026-07-23 | 1 | 1 |
| EHGO | 2026-07-23 | 3 | 0 |
| AEHL | 2026-07-23 | 1 | 1 |

### Second timed batch: twenty-minute continuation

The next user-authorized twenty-minute batch on November 6 added **100 exact reviewed entries and 37 publications**. All previous 85 reviews and all previous articles were preserved. At the end of that second batch, the accumulated review count was **185 of 1,560 trades (11.86%)**, leaving **1,375 unreviewed**. Of the 185 reviewed entries, **157 have linked publications and 28 have none established in the consulted sources**. A completed partial source review is not an exhaustive claim of no news.

Generated totals at the end of the second batch were **75 publications, 69 topics, 185 trade/publication links and 14 date-only links**. The 254 trades in the generated symbol scope include 69 unreviewed entries; the generated scope is not a completion count. This batch's 100 newly reviewed entries comprise 86 with linked publications and fourteen without an eligible publication established.

Confirmed times preserve exact 48-hour boundaries: the September 29 NXL advisor release qualifies for only the earliest October 1 entry, and the September 16 TNMG release is already too old at the earliest September 18 entry. Final source verification confirmed RETO commentary at September 15 23:29 EDT, after all five intraday entries. Its initial date-only staging was removed, and its exclusion plus timezone evidence is preserved in resolvedCandidates. ZTG's separately dated article uses the agreed date fallback for an unknown timezone, while its original filing's known out-of-window timestamp is not reused. GRML's expansion headline is explicitly qualified as a pending license application, and SDST's Form 144 is labeled a proposed insider sale rather than an executed trade or issuer financing.

Independent verification recalculated all eligible links from timestamps/dates, checked issuer CIKs, unique article IDs/URLs and preservation of prior exact entry reviews. The raw trade dataset SHA-256 remains `1eb6cb2172e928c1c93bd4d18afd3687438134674d435e57b4f86e747fe43fa8`; accounting is unchanged. The Python suite and JavaScript news coverage/filter checks pass. Direct Yahoo retrieval remained restricted; reviewed sources and limitations are stored per issuer.

| Symbol | Entry sessions | Newly reviewed trades | Trades with linked publications |
| --- | --- | ---: | ---: |
| TC | 2026-10-14 | 1 | 1 |
| WFF | 2026-10-13 | 1 | 1 |
| LGCL | 2026-10-07 | 3 | 3 |
| OLB | 2026-10-06 | 3 | 3 |
| IPDN | 2026-10-06 | 2 | 2 |
| APUS | 2026-10-05 | 3 | 3 |
| BEAT | 2026-10-05 | 1 | 1 |
| SDEV | 2026-10-05 | 1 | 1 |
| MI | 2026-10-05 | 2 | 0 |
| NXL | 2026-10-01 | 5 | 5 |
| TNON | 2026-09-30 | 4 | 4 |
| CNTB | 2026-09-30 | 1 | 1 |
| BKYI | 2026-09-29 | 4 | 4 |
| SLXN | 2026-09-29 | 1 | 1 |
| MTEK | 2026-09-28 | 1 | 1 |
| ARAY | 2026-09-28 | 1 | 1 |
| SOAR | 2026-09-28 | 1 | 1 |
| KNRX | 2026-09-28 | 1 | 1 |
| CLRO | 2026-09-28 | 1 | 0 |
| TDIC | 2026-09-25 | 2 | 0 |
| JAGX | 2026-09-25 | 1 | 1 |
| INLF | 2026-09-25 | 1 | 1 |
| GLND | 2026-09-24 | 3 | 3 |
| SPHL | 2026-09-24 | 1 | 0 |
| BENF | 2026-09-23 | 3 | 3 |
| TNMG | 2026-09-18 | 8 | 8 |
| GIPR | 2026-09-18 | 4 | 4 |
| IMCC | 2026-09-18 | 2 | 0 |
| MRNO | 2026-09-18 | 1 | 0 |
| GCDT | 2026-09-23 | 2 | 2 |
| LHSW | 2026-09-22 | 2 | 2 |
| GRML | 2026-09-22 | 2 | 2 |
| ZEO | 2026-09-22 | 1 | 1 |
| VEEA | 2026-09-15 | 8 | 8 |
| QCLS | 2026-09-16 | 5 | 5 |
| DLXY | 2026-09-16 | 3 | 3 |
| RETO | 2026-09-15 | 5 | 0 |
| MEDS | 2026-09-16 | 3 | 3 |
| KXIN | 2026-09-17 | 3 | 3 |
| SDST | 2026-09-17 | 2 | 2 |
| ZTG | 2026-09-18 | 1 | 1 |

### First timed batch entry audit

| Symbol | Entry sessions | Newly reviewed trades | Trades with linked publications |
| --- | --- | ---: | ---: |
| SLGB | 2026-10-30 | 3 | 3 |
| TNMG | 2026-10-30 | 2 | 2 |
| BURU | 2026-10-29 | 12 | 12 |
| CETX | 2026-10-29 | 2 | 2 |
| PCLA | 2026-10-29 | 1 | 0 |
| CHOW | 2026-10-30, 2026-10-19 | 3 | 0 |
| NEXR | 2026-10-27 | 1 | 1 |
| AIOK | 2026-10-23, 2026-10-27 | 6 | 5 |
| NUWE | 2026-10-27 | 1 | 1 |
| POM | 2026-10-28 | 1 | 0 |
| TDIC | 2026-10-27 | 1 | 1 |
| ZTG | 2026-10-16 | 4 | 4 |
| YRD | 2026-10-14 | 2 | 2 |
| TGL | 2026-10-14 | 2 | 2 |
| GENK | 2026-10-14 | 1 | 1 |
| GLND | 2026-10-14 | 1 | 1 |
| JZ | 2026-10-08 | 3 | 3 |
| TCRT | 2026-10-13 | 6 | 6 |
| WFF | 2026-10-09 | 2 | 2 |

The initial November 2-5 batch added 7 publications and 12 issuer reviews covering 24 entries. Resolving DKI and VCIG under the revised user policy added two publications. Before the timed backfill, the preserved VIVK pilot and that batch contained **18 publications, 15 topics, 33 trade/publication links, 5 date-only links and 23 trades with news**. Its 44 trades included 13 older entries without reviews. The following table preserves that earlier batch's audit history.

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
