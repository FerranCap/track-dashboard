# Trade news context pilot

The VIVK pilot retains only verified publications that intersect at least one entry window: **48 elapsed hours before the first entry, including the lower boundary and excluding entry itself**. Times below are New York time. It does not collect a continuous news feed.

## Files and rebuild

- `articles.json`: reviewed publication records, short factual summaries and timestamp evidence. Reproductions of one article use `sourceUrls`, not additional article IDs. Separate publications discussing the same event share an `eventId`.
- `research.json`: source access, exact entries reviewed, unresolved candidates and coverage limitations. New trades and changed entries do not inherit a completed review.
- `trade-context.json`: generated, reproducible links from publications to trades. Do not edit it by hand.

```powershell
python scripts/build_news.py --symbols VIVK --hours 48
python -m unittest discover -s scripts -p 'test_*.py'
```

The Tickers table loads `trade-context.json` and shows a publication count with expandable dates, source links, summaries and linked entries. Unresearched tickers show an unreviewed state rather than zero news. Deployment rebuilds this context after trade consolidation and includes the generated file in the site artifact. Rebuild locally after daily trade imports before reviewing new windows. Trade IDs, execution counts, PnL and accounting sources are not modified. VIE fields remain in the issuer database but are not shown as a table column.

## Reviewed results

Review date: 2026-11-06. Seven VIVK trades across four sessions have confirmed preceding publications: **7 publications, 6 distinct topics and 11 trade/publication links**. Finding a publication is not evidence that it caused the price move, and coverage remains partial.

| Entry, New York | Side | Confirmed prior context | Distinct topics |
| --- | --- | --- | --- |
| 2026-07-24 10:27:29 | Short | Jul 24 09:15: additional crude programs | 1 |
| 2026-07-29 08:21:49 | Short | Jul 27 09:15: Houston commissioning; Jul 29 07:59: Benzinga crude guidance report | 2 |
| 2026-07-29 08:30:55 | Short | Jul 27 09:15: Houston commissioning; Jul 29 07:59: Benzinga crude guidance report | 2 |
| 2026-07-29 09:22:42 | Short | Jul 29 07:59: Benzinga report; Jul 29 09:15: official guidance release | 1 |
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

The research log keeps two unresolved candidates out of confirmed counts: a Jul 22 report with no publication hour and a Jul 28 report whose displayed 12:38 clock has no independently established timezone. No headline-only premium snippets or automated market roundups are counted as confirmed issuer news in this pilot.

Publication evidence does not prove the current text matches the exact version available before entry. All records disclose `contentAsOfEntryVerified: false`. The summaries describe reported facts and conditions, not a retrospective claim of causation or sentiment.

Minute precision is modeled as a one-minute interval. A record is confirmed for a trade only if that complete interval fits inside its entry window; a boundary overlap remains uncertain. Unknown timezones and date-only candidates stay in the research log instead of receiving invented timestamps. Matching uses UTC elapsed time across daylight saving changes.
