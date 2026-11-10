"""Check news eligibility, evidence boundaries and reviewed historical context."""
import copy
import hashlib
import json
import unittest
from pathlib import Path

from build_news import build_context


ROOT = Path(__file__).resolve().parents[1]


class NewsContextTests(unittest.TestCase):
    def setUp(self):
        self.trade = {'id': 'trade-1', 'symbol': 'VIVK', 'opened': '2026-11-06T09:00:00-05:00'}
        self.dataset = {'trades': [self.trade], 'tickerProfiles': {'VIVK': {'cik': '1450704'}}}
        self.article = {'id': 'news-1', 'eventId': 'event-1', 'symbol': 'VIVK', 'issuerCik': '1450704',
                        'publishedAt': '2026-11-05T09:00:00-05:00', 'timePrecision': 'second',
                        'verificationStatus': 'verified_publication', 'timestampEvidence': 'Source states UTC offset',
                        'url': 'https://example.org/news', 'sourceUrls': ['https://example.org/source']}
        self.review = {'symbol': 'VIVK', 'windowHours': 48, 'coverage': 'partial', 'checkedOn': '2026-11-06',
                       'tradeEntries': {'trade-1': self.trade['opened']}}

    def build(self, articles=None, reviews=None):
        return build_context(self.dataset, [self.article] if articles is None else articles,
                             [self.review] if reviews is None else reviews, {'VIVK'})

    def test_exact_48_hour_window_excludes_entry_and_future(self):
        for stamp, expected in [('2026-11-04T09:00:00-05:00', 1),
                                ('2026-11-04T08:59:59-05:00', 0),
                                ('2026-11-06T08:59:59-05:00', 1),
                                ('2026-11-06T09:00:00-05:00', 0),
                                ('2026-11-06T09:00:01-05:00', 0)]:
            with self.subTest(stamp=stamp):
                self.article['publishedAt'] = stamp
                self.assertEqual(len(self.build()['trades'][0]['articles']), expected)

    def test_minute_precision_does_not_invent_seconds(self):
        self.trade['opened'] = '2026-11-06T09:00:30-05:00'
        self.article.update(publishedAt='2026-11-06T09:00:00-05:00', timePrecision='minute')
        context = self.build()['trades'][0]
        self.assertEqual(context['articles'], [])
        self.assertEqual(context['uncertainArticleIds'], ['news-1'])
        self.assertEqual(context['status'], 'pending_verification')

    def test_dst_uses_elapsed_hours_in_utc(self):
        self.trade['opened'] = '2026-11-02T08:00:00-05:00'
        self.article['publishedAt'] = '2026-10-31T09:00:00-04:00'
        self.assertEqual(len(self.build()['trades'][0]['articles']), 1)
        self.article['publishedAt'] = '2026-10-31T08:59:59-04:00'
        self.assertEqual(len(self.build()['trades'][0]['articles']), 0)

    def test_date_fallback_for_unknown_time_same_or_previous_days(self):
        self.article.update(publishedAt=None, timePrecision='day', verificationStatus='verified_date')
        for day, expected in [('2026-11-03', 0), ('2026-11-04', 1), ('2026-11-05', 1), ('2026-11-06', 1), ('2026-11-07', 0)]:
            with self.subTest(day=day):
                self.article['publicationDate'] = day
                result = self.build()
                self.assertEqual(len(result['trades'][0]['articles']), expected)
                if expected:
                    link = result['trades'][0]['articles'][0]
                    self.assertEqual(link['matchingBasis'], 'publication_date')
                    self.assertIsNone(link['ageSecondsMin'])
                    self.assertIsNone(link['ageSecondsMax'])
                if day == '2026-11-06':
                    self.assertEqual(result['trades'][0]['status'], 'news_found')
                    self.assertTrue(result['trades'][0]['articles'][0]['publicationBeforeEntryUnconfirmed'])
                    self.assertIsNone(self.article['publishedAt'])

    def test_date_fallback_uses_new_york_entry_day(self):
        self.trade['opened'] = '2026-11-06T02:00:00Z'
        self.article.update(publishedAt=None, publicationDate='2026-11-03', timePrecision='day', verificationStatus='verified_date')
        self.assertEqual(len(self.build()['trades'][0]['articles']), 1)
        self.article['publicationDate'] = '2026-11-05'
        self.assertEqual(len(self.build()['trades'][0]['articles']), 1)

    def test_missing_review_is_not_no_news(self):
        self.assertEqual(self.build([], [])['trades'][0]['status'], 'pending_verification')
        self.assertEqual(self.build([])['trades'][0]['status'], 'none_found_in_reviewed_sources')
        self.trade['opened'] = '2026-11-06T10:00:00-05:00'
        self.assertEqual(self.build([])['trades'][0]['reviewStatus'], 'not_reviewed')

    def test_identity_duplicates_and_timezone_validation(self):
        self.article['issuerCik'] = '123'
        with self.assertRaisesRegex(ValueError, 'issuer'):
            self.build()
        self.article['issuerCik'] = '1450704'
        with self.assertRaisesRegex(ValueError, 'Duplicate news IDs'):
            self.build([self.article, self.article])
        duplicate = {**self.article, 'id': 'news-2'}
        with self.assertRaisesRegex(ValueError, 'Duplicate canonical'):
            self.build([self.article, duplicate])
        self.article['publishedAt'] = '2026-11-05T09:00:00'
        with self.assertRaisesRegex(ValueError, 'UTC offset'):
            self.build()

    def test_topics_are_deduplicated_without_backdating_publications(self):
        later = {**self.article, 'id': 'news-2', 'url': 'https://example.org/later',
                 'publishedAt': '2026-11-06T10:00:00-05:00'}
        result = self.build([self.article, later])
        self.assertEqual(result['counts']['articles'], 1)
        later['publishedAt'] = '2026-11-06T08:00:00-05:00'
        result = self.build([self.article, later])
        self.assertEqual(len(result['trades'][0]['articles']), 2)
        self.assertEqual(result['trades'][0]['eventCount'], 1)

    def test_one_publication_can_match_two_verified_issuers(self):
        other = {'id': 'trade-2', 'symbol': 'OTHER', 'opened': self.trade['opened']}
        self.dataset['trades'].append(other)
        self.dataset['tickerProfiles']['OTHER'] = {'cik': '123'}
        self.article['additionalIssuers'] = [{'symbol': 'OTHER', 'issuerCik': '123'}]
        result = build_context(self.dataset, [self.article], [], {'VIVK', 'OTHER'})
        self.assertEqual(result['counts']['articles'], 1)
        self.assertEqual(result['counts']['tradeArticleLinks'], 2)
        self.assertEqual(result['counts']['events'], 1)
        other_only = build_context(self.dataset, [self.article], [], {'OTHER'})
        self.assertEqual(other_only['counts']['articles'], 1)
        self.assertEqual(other_only['trades'][0]['articles'][0]['articleId'], 'news-1')
        other['opened'] = '2026-11-05T08:00:00-05:00'
        self.assertEqual(build_context(self.dataset, [self.article], [], {'OTHER'})['counts']['articles'], 0)

    def test_additional_issuer_identity_is_validated(self):
        self.dataset['tickerProfiles']['OTHER'] = {'cik': '123'}
        self.article['additionalIssuers'] = [{'symbol': 'OTHER', 'issuerCik': '456'}]
        with self.assertRaisesRegex(ValueError, 'issuer'):
            self.build()
        self.article['additionalIssuers'] = [{'symbol': 'VIVK', 'issuerCik': '1450704'}]
        with self.assertRaisesRegex(ValueError, 'Duplicate news issuer'):
            self.build()

    def test_actual_pilot_and_unchanged_accounting(self):
        read = lambda path: json.loads(path.read_text(encoding='utf-8'))
        dataset = read(ROOT / 'data/trades.json')
        before = copy.deepcopy(dataset)
        articles = read(ROOT / 'data/news/articles.json')['articles']
        reviews = read(ROOT / 'data/news/research.json')['reviews']
        result = build_context(dataset, articles, reviews, {'VIVK'})
        self.assertEqual(dataset, before)
        generated = read(ROOT / 'data/news/trade-context.json')
        full = build_context(dataset, articles, reviews, {record['symbol'] for record in articles + reviews})
        self.assertEqual(full, generated)
        self.assertEqual(result, build_context(dataset, generated['articles'], generated['reviews'], {'VIVK'}))
        self.assertEqual(result['counts'], {'trades': 7, 'articles': 9, 'events': 7,
                                           'tradeArticleLinks': 15, 'dateFallbackLinks': 4, 'tradesWithNews': 7})
        by_entry = {trade['entryAt']: trade for trade in result['trades']}
        early = by_entry['2026-07-29T08:21:49-04:00']['articles']
        self.assertNotIn('vivk-20260729-crude-guidance-release', [article['articleId'] for article in early])
        later = by_entry['2026-11-06T09:06:58-05:00']['articles']
        self.assertEqual([article['articleId'] for article in later], ['vivk-20261105-bernard-brown-release'])
        self.assertEqual(result['tradeAccountingSha256'], hashlib.sha256(json.dumps(dataset['trades'], sort_keys=True).encode()).hexdigest())

    def test_recent_session_backfill(self):
        read = lambda path: json.loads(path.read_text(encoding='utf-8'))
        dataset = read(ROOT / 'data/trades.json')
        generated = read(ROOT / 'data/news/trade-context.json')
        articles = read(ROOT / 'data/news/articles.json')['articles']
        reviews = read(ROOT / 'data/news/research.json')['reviews']
        self.assertEqual(generated['counts'], {'trades': 859, 'articles': 394, 'events': 341,
                                              'tradeArticleLinks': 860, 'dateFallbackLinks': 268,
                                              'tradesWithNews': 591})
        entries = {trade['id']: trade for trade in dataset['trades']}
        reviewed = {trade_id for review in reviews for trade_id, opened in review['tradeEntries'].items()
                    if trade_id in entries and entries[trade_id]['opened'] == opened}
        self.assertEqual(len(reviewed), 644)
        self.assertEqual(len(reviews), 288)
        recent = [trade for trade in generated['trades'] if trade['symbol'] == 'LABT' and trade['entryAt'].startswith('2026-11-05')]
        self.assertEqual(len(recent), 7)
        self.assertTrue(all([link['articleId'] for link in trade['articles']] == ['labt-20261105-series-c-redemption-release'] for trade in recent))
        by_symbol = {review['symbol']: review for review in reviews}
        self.assertEqual(len(by_symbol['VCIG']['unresolvedCandidates']), 0)
        self.assertEqual(len(by_symbol['DKI']['unresolvedCandidates']), 0)
        self.assertTrue(by_symbol['VCIG']['resolvedCandidates'])
        self.assertTrue(by_symbol['DKI']['resolvedCandidates'])
        self.assertFalse(any(article['symbol'] in {'SRTS', 'CHSN'} for article in articles))
        self.assertIn('omh-20260721-agm-report-date', {article['id'] for article in articles})
        november_inlf = [trade for trade in generated['trades'] if trade['symbol'] == 'INLF' and trade['entryAt'].startswith('2026-11')]
        self.assertTrue(all(not trade['articles'] for trade in november_inlf))
        self.assertEqual(sum(link['matchingBasis'] == 'publication_date' for trade in generated['trades'] for link in trade['articles']), 268)
        dki = next(article for article in articles if article['id'] == 'dki-20261104-charter-report-date')
        self.assertIsNone(dki['publishedAt'])
        self.assertEqual(dki['timePrecision'], 'day')
        vcig = next(article for article in articles if article['id'] == 'vcig-20261103-registration-report')
        self.assertTrue(vcig['sourceWarnings'])
        self.assertEqual(vcig['publishedAt'], '2026-11-03T06:06:00-05:00')
        july_labt = [trade for trade in generated['trades'] if trade['symbol'] == 'LABT' and trade['entryAt'].startswith('2026-07-22')]
        self.assertTrue(july_labt)
        self.assertTrue(all(trade['reviewStatus'] == 'partial' for trade in july_labt))
        older_labt = [trade for trade in generated['trades'] if trade['symbol'] == 'LABT'
                      and not trade['entryAt'].startswith(('2026-11-05', '2026-07-22'))]
        self.assertTrue(all(trade['reviewStatus'] == 'not_reviewed' for trade in older_labt))
        tcrt = [trade for trade in generated['trades'] if trade['symbol'] == 'TCRT' and trade['entryAt'].startswith('2026-10-13')]
        self.assertEqual(len(tcrt), 6)
        for trade in tcrt:
            linked = {link['articleId'] for link in trade['articles']}
            self.assertIn('tcrt-20261013-paragon-velaris', linked)
            self.assertEqual('tcrt-20261013-velaris-acquisition-release' in linked,
                             trade['entryAt'][11:16] > '10:31')
            self.assertEqual(trade['eventCount'], 1)
        genk = next(article for article in articles if article['id'] == 'genk-20261014-restaurant-loi')
        self.assertEqual(genk['publishedAt'], '2026-10-14T08:31:00-04:00')
        wff = next(article for article in articles if article['id'] == 'wff-20261009-benzinga-disputed-acquisition-report')
        self.assertIsNone(wff['publishedAt'])
        self.assertTrue(wff['sourceWarnings'])
        nxl = [trade for trade in generated['trades'] if trade['symbol'] == 'NXL' and trade['entryAt'].startswith('2026-10-01')]
        self.assertEqual(len(nxl), 5)
        self.assertEqual(sum(any(link['articleId'] == 'nxl-20260929-commercial-advisor' for link in trade['articles']) for trade in nxl), 1)
        self.assertTrue(all(any(link['articleId'] == 'nxl-20261001-south-america-distribution' for link in trade['articles']) for trade in nxl))
        tnl = [trade for trade in generated['trades'] if trade['symbol'] == 'TNMG' and trade['entryAt'].startswith('2026-09-18')]
        self.assertEqual(len(tnl), 8)
        self.assertTrue(all([link['articleId'] for link in trade['articles']] == ['tnmg-20260918-tnl-daily'] for trade in tnl))
        reto = [trade for trade in generated['trades'] if trade['symbol'] == 'RETO' and trade['entryAt'].startswith('2026-09-15')]
        self.assertEqual(len(reto), 5)
        self.assertTrue(all(not trade['articles'] and trade['reviewStatus'] == 'partial' for trade in reto))
        self.assertNotIn('reto-20260915-after-hours-report-date', {article['id'] for article in articles})
        self.assertTrue(by_symbol['RETO']['resolvedCandidates'])
        bmgl = [trade for trade in generated['trades'] if trade['symbol'] == 'BMGL' and trade['entryAt'].startswith('2026-09-14')]
        self.assertEqual(len(bmgl), 4)
        self.assertEqual(sum(bool(trade['articles']) for trade in bmgl), 1)
        self.assertTrue(all(bool(trade['articles']) == (trade['entryAt'][11:16] > '11:36') for trade in bmgl))
        auud = next(article for article in articles if article['id'] == 'auud-20260810-s4-effective')
        self.assertEqual(auud['publishedAt'], '2026-08-10T07:00:00-04:00')
        auud_entry = next(trade for trade in generated['trades'] if trade['symbol'] == 'AUUD' and trade['entryAt'].startswith('2026-08-10'))
        self.assertIn(auud['id'], {link['articleId'] for link in auud_entry['articles']})
        rdac = next(trade for trade in generated['trades'] if trade['symbol'] == 'RDAC' and trade['entryAt'].startswith('2026-08-19'))
        self.assertEqual(rdac['reviewStatus'], 'partial')
        self.assertFalse(rdac['articles'])
        cycu = [trade for trade in generated['trades'] if trade['symbol'] == 'CYCU' and trade['entryAt'].startswith('2026-07-30')]
        self.assertEqual(len(cycu), 10)
        self.assertTrue(all([link['articleId'] for link in trade['articles']] == ['cycu-20260730-consulting-award'] for trade in cycu))
        for article_id in ('cdtg-20260904-market-report-date', 'sdot-20260821-market-report-date'):
            article = next(article for article in articles if article['id'] == article_id)
            self.assertIsNone(article['publishedAt'])
            self.assertTrue(article['sourceWarnings'])
            self.assertTrue(all(link['publicationBeforeEntryUnconfirmed'] for trade in generated['trades']
                                for link in trade['articles'] if link['articleId'] == article_id))
        otlk = [trade for trade in generated['trades'] if trade['symbol'] == 'OTLK'
                and trade['entryAt'].startswith('2026-05-26')]
        self.assertEqual(len(otlk), 2)
        for trade in otlk:
            linked = {link['articleId'] for link in trade['articles']}
            self.assertIn('otlk-20260526-fda-appeal', linked)
            self.assertEqual('otlk-20260526-stocktwits-appeal' in linked,
                             trade['entryAt'][11:16] > '10:55')
        rubi = next(article for article in articles if article['id'] == 'rubi-20260611-trillium-ownership-date')
        self.assertEqual(rubi['publishedAt'], '2026-06-11T10:58:50-04:00')
        self.assertEqual(rubi['timePrecision'], 'second')
        tdic = next(review for review in reviews if any(candidate['id'] == 'tdic-20260616-squeezereport-date-pending'
                    for candidate in review.get('resolvedCandidates', [])))
        self.assertFalse(tdic['unresolvedCandidates'])
        self.assertIn('tdic-20260616-squeezereport-date', {article['id'] for article in articles})


if __name__ == '__main__':
    unittest.main()
