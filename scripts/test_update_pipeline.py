"""Check incremental collection, evidence boundaries and reviewed promotion."""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from update_pipeline import (ROOT, SourceCache, digest, load_inputs, merge_candidate, plan_updates,
                             read_json, scope_update_plan, write_json, write_review_packet)
from update_sources import (canonical_url, matching_entries, news_candidate, parse_finviz, parse_yahoo,
                            sec_filing_item)
from update_data import apply_decisions, collect_batch, rebuild
from update_prices import price_download, uncovered_price_windows


class UpdatePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = read_json(ROOT / 'data/updates/config.json')
        self.trade = {'id': 'a', 'symbol': 'TEST', 'opened': '2026-11-24T10:00:00-05:00',
                      'closed': '2026-11-24T10:05:00-05:00', 'date': '2026-11-24', 'pnl': 12.5, 'entryPrice': 2}
        self.dataset = {'generatedAt': 'test', 'tradeCount': 1, 'trades': [self.trade],
                        'tickerProfiles': {'TEST': {'symbol': 'TEST', 'issuer_name': 'Test Issuer', 'cik': '123',
                                                    'incorporation_country': 'United States', 'security_type': 'direct_equity'}}}
        self.inputs = {'dataset': self.dataset, 'research': {'schemaVersion': 1, 'reviews': []},
                       'capital': {'schemaVersion': 1, 'issuers': {}}, 'config': self.config}
        for name, value in [('data/trades.json', self.dataset), ('data/news/articles.json', {'schemaVersion': 1, 'articles': []}),
                            ('data/news/research.json', self.inputs['research']), ('data/sec/capital-history.json', self.inputs['capital']),
                            ('data/updates/config.json', self.config)]:
            write_json(self.root / name, value)

    def job(self):
        return next(job for job in plan_updates(self.inputs)['jobs'] if job['domain'] == 'news')

    def test_price_job_covers_only_the_traded_new_york_day(self):
        job = next(job for job in plan_updates(self.inputs)['jobs'] if job['domain'] == 'prices')
        self.assertEqual(job['start'], '2026-11-24T00:00:00-05:00')
        self.assertEqual(job['end'], '2026-11-25T00:00:00-05:00')

    def test_plan_is_deterministic_merges_windows_and_invalidates_corrected_entry(self):
        self.dataset['trades'].append({**self.trade, 'id': 'b', 'opened': '2026-11-24T11:00:00-05:00'})
        self.dataset['tradeCount'] = 2
        first = plan_updates(self.inputs)
        self.assertEqual(first, plan_updates(self.inputs))
        news = [job for job in first['jobs'] if job['domain'] == 'news']
        self.assertEqual(len(news), 1)
        self.assertEqual(len(news[0]['entries']), 2)
        self.inputs['research']['reviews'] = [{'issuerCik': '123', 'windowHours': 48, 'tradeEntries': {'a': self.trade['opened']}}]
        self.assertEqual(len(self.job()['entries']), 1)
        self.dataset['trades'][0]['opened'] = '2026-11-24T10:00:01-05:00'
        self.assertEqual(len(self.job()['entries']), 2)
        self.assertNotEqual(self.job()['id'], news[0]['id'])
        self.inputs['research']['reviews'][0]['issuerCik'] = '999'
        self.assertEqual(len(self.job()['entries']), 2)

    def test_ticker_scope_keeps_only_requested_issuer_jobs_and_rejects_unknowns(self):
        self.dataset['trades'].append({**self.trade, 'id': 'other', 'symbol': 'OTHER'})
        self.dataset['tickerProfiles']['OTHER'] = {'symbol': 'OTHER', 'issuer_name': 'Other', 'cik': '456'}
        plan = plan_updates(self.inputs)
        scoped = scope_update_plan(plan, {'TEST'}, self.dataset)
        self.assertTrue(scoped['jobs'])
        self.assertTrue(all(job['symbols'] == ['TEST'] for job in scoped['jobs']))
        self.assertTrue(any(job['symbols'] == ['OTHER'] for job in plan['jobs']))
        with self.assertRaises(ValueError):
            scope_update_plan(plan, {'UNKNOWN'}, self.dataset)

    def test_filing_and_news_time_rules_include_exact_lower_exclude_entry(self):
        entries = self.job()['entries']
        self.assertEqual(len(matching_entries({'publishedAt': '2026-11-22T10:00:00-05:00'}, entries)), 1)
        self.assertEqual(matching_entries({'publishedAt': self.trade['opened']}, entries), [])
        self.assertEqual(matching_entries({'publishedAt': '2026-11-22T09:59:59-05:00', 'publicationDate': '2026-11-22'}, entries), [])
        self.assertEqual(len(matching_entries({'publicationDate': '2026-11-24'}, entries)), 1)
        self.assertEqual(matching_entries({'publicationDate': '2026-11-21'}, entries), [])

    def test_parsers_preserve_unknown_dates_and_do_not_execute_source_text(self):
        rss = b'<rss><channel><item><title>Issuer update</title><link>https://example.com/a?utm_source=rss</link><pubDate>Tue, 24 Nov 2026 09:00:00 -0500</pubDate><description>&lt;script&gt;bad()&lt;/script&gt;Source text</description></item></channel></rss>'
        item = parse_yahoo(rss)[0]
        self.assertEqual(item['publishedAt'], '2026-11-24T09:00:00-05:00')
        self.assertEqual(item['sourceUrl'], 'https://example.com/a')
        self.assertNotIn('bad()', item['excerpt'])
        html = b'<table id="news-table"><tr><td>Nov-24-26 09:00AM</td><td><a class="tab-link-news" href="https://example.com/a">Issuer A</a></td></tr><tr><td>10:00AM</td><td><a href="https://example.com/b">Issuer B</a></td></tr><tr><td>Today 09:00AM</td><td><a href="https://example.com/c">Issuer C</a></td></tr></table>'
        items = parse_finviz(html)
        self.assertEqual(items[0]['publicationDate'], '2026-11-24')
        self.assertEqual(items[1]['publicationDate'], '2026-11-24')
        self.assertIsNone(items[2]['publicationDate'])
        self.assertTrue(all(item['publishedAt'] is None for item in items))
        with self.assertRaises(ValueError):
            canonical_url('javascript:bad()')

    def test_cache_reuses_bytes_and_limits_requests_and_retries(self):
        calls = []
        class Response:
            status = 200
            def geturl(self): return 'https://finviz.com/stock?t=TEST'
            def read(self, size): return b'cached body'
            def __enter__(self): return self
            def __exit__(self, *args): pass
        def opener(request, timeout):
            calls.append(request.full_url)
            return Response()
        config = {**self.config['network'], 'maxRequests': 1, 'minimumIntervalSeconds': 0}
        cache = SourceCache(self.root, config, opener=opener)
        url = 'https://finviz.com/stock?t=TEST'
        self.assertEqual(cache.get(url)[0], b'cached body')
        self.assertEqual(cache.get(url)[1]['access'], 'cache')
        self.assertEqual(len(calls), 1)
        self.assertEqual(cache.get('https://finviz.com/stock?t=OTHER')[1]['access'], 'request_budget_exhausted')
        def failing(*args, **kwargs): raise OSError('failure')
        failed = SourceCache(self.root, config, opener=failing)
        other = 'https://finviz.com/stock?t=FAIL'
        self.assertEqual(failed.get(other)[1]['access'], 'failed')
        self.assertEqual(failed.get(other)[1]['access'], 'deferred')
        self.assertEqual(failed.requests, 1)

    def test_repeated_evidence_keeps_review_and_packet_is_bounded(self):
        job = self.job()
        item = {'headline': 'Issuer filing', 'publicationDate': '2026-11-24', 'publishedAt': None,
                'publisher': 'SEC EDGAR', 'sourceUrl': 'https://www.sec.gov/Archives/edgar/data/123/000000012326000001/a.htm', 'excerpt': 'Evidence'}
        first = news_candidate(item, job, {'url': item['sourceUrl'], 'sha256': 'abc', 'fetchedAt': 'one'}, self.config['news'])
        second = news_candidate(item, job, {'url': item['sourceUrl'], 'sha256': 'def', 'fetchedAt': 'two'}, self.config['news'])
        candidates = {first['id']: {**first, 'decision': 'rejected'}}
        merge_candidate(candidates, second)
        self.assertEqual(candidates[first['id']]['decision'], 'rejected')
        huge = {**first, 'id': 'huge', 'excerpt': 'x' * 50000, 'proposal': {'raw': 'x' * 50000}}
        candidates['huge'] = huge
        write_review_packet(self.root, plan_updates(self.inputs), {'jobs': {}}, candidates, self.config['review'])
        packet = (self.root / 'data/updates/review-packet.json').read_text(encoding='utf-8')
        self.assertLessEqual(len(packet), self.config['review']['maxCharacters'])
        self.assertNotIn('rejected', packet)

    def trusted_candidate(self):
        item = sec_filing_item({'form': '8-K', 'accessionNumber': '0000000123-26-000001', 'primaryDocument': 'a.htm',
                                'filingDate': '2026-11-24', 'acceptanceDateTime': '2026-11-24T09:00:00Z'}, '123')
        candidate = news_candidate(item, self.job(), {'url': 'https://data.sec.gov/submissions/CIK0000000123.json', 'sha256': 'abc'}, self.config['news'], True)
        write_json(self.root / 'data/updates/candidates.json', {candidate['id']: candidate})
        return candidate

    def test_promotion_is_validated_idempotent_and_does_not_invent_window_review(self):
        candidate = self.trusted_candidate()
        decisions = {'schemaVersion': 1, 'reviewer': 'test', 'reviewedOn': '2026-11-27', 'items': [
            {'candidateId': candidate['id'], 'evidenceHash': candidate['evidenceHash'], 'action': 'accept'}]}
        baseline = (self.root / 'data/trades.json').read_bytes()
        self.assertEqual(apply_decisions(self.root, decisions)['accepted'], 1)
        self.assertEqual(apply_decisions(self.root, decisions)['accepted'], 0)
        result = rebuild(self.root)
        self.assertEqual(result['articles'], 1)
        self.assertEqual(read_json(self.root / 'data/news/research.json')['reviews'], [])
        article = read_json(self.root / 'data/news/articles.json')['articles'][0]
        self.assertEqual(article['timePrecision'], 'day')
        self.assertIsNone(article['publishedAt'])
        self.assertEqual((self.root / 'data/trades.json').read_bytes(), baseline)

    def test_stale_decision_and_unsupported_no_news_review_do_not_write(self):
        candidate = self.trusted_candidate()
        baseline = (self.root / 'data/news/articles.json').read_bytes()
        decisions = {'schemaVersion': 1, 'reviewer': 'test', 'reviewedOn': '2026-11-27', 'items': [
            {'candidateId': candidate['id'], 'evidenceHash': 'wrong', 'action': 'accept'}]}
        with self.assertRaises(ValueError): apply_decisions(self.root, decisions)
        self.assertEqual((self.root / 'data/news/articles.json').read_bytes(), baseline)
        job = self.job()
        decisions.update(items=[], jobReviews=[{'jobId': job['id'], 'fingerprint': job['fingerprint'], 'windowReviewed': True,
                                              'sources': [{'access': 'failed', 'url': 'https://finviz.com/stock?t=TEST'}]}])
        with self.assertRaises(ValueError): apply_decisions(self.root, decisions)
        self.assertEqual(read_json(self.root / 'data/news/research.json')['reviews'], [])

    def test_collection_skips_processed_jobs_and_never_marks_no_news(self):
        plan = plan_updates(self.inputs)
        state = {'schemaVersion': 1, 'jobs': {job['id']: {'status': 'source_limited'} for job in plan['jobs']}}
        write_json(self.root / 'data/updates/state.json', state)
        result = collect_batch(self.root, plan, self.inputs, {'news'}, 3, max_requests=0)
        self.assertEqual(result['jobsProcessed'], 0)
        self.assertEqual(result['requests'], 0)
        self.assertEqual(read_json(self.root / 'data/news/research.json')['reviews'], [])

    def test_window_reviews_are_repeatable_and_preserve_exact_entries(self):
        job = self.job()
        decisions = {'schemaVersion': 1, 'reviewer': 'test', 'reviewedOn': '2026-11-27', 'items': [], 'jobReviews': [
            {'jobId': job['id'], 'fingerprint': job['fingerprint'], 'windowReviewed': True,
             'sources': [{'url': 'https://finviz.com/stock?t=TEST', 'access': 'reviewed'}]}]}
        self.assertEqual(apply_decisions(self.root, decisions)['reviewedEntries'], 1)
        self.assertEqual(apply_decisions(self.root, decisions)['reviewedEntries'], 0)
        self.assertEqual(len(read_json(self.root / 'data/news/research.json')['reviews']), 1)

    def test_reviewed_profile_patch_persists_in_overrides(self):
        import csv
        profile = self.dataset['tickerProfiles']['TEST']
        profile.update(operating_country='', operations_status='unverified', operations_basis='')
        write_json(self.root / 'data/trades.json', self.dataset)
        path = self.root / 'data/reference/ticker-profiles.csv'
        path.parent.mkdir(parents=True)
        with path.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(profile))
            writer.writeheader()
            writer.writerow(profile)
        candidate = {'id': 'sec-profile', 'domain': 'sec', 'cik': '123', 'symbols': ['TEST'], 'evidenceHash': 'evidence'}
        write_json(self.root / 'data/updates/candidates.json', {candidate['id']: candidate})
        decisions = {'schemaVersion': 1, 'reviewer': 'test', 'reviewedOn': '2026-11-27', 'items': [
            {'candidateId': candidate['id'], 'evidenceHash': 'evidence', 'action': 'accept', 'previousProfileHash': digest(profile),
             'profilePatch': {'symbol': 'TEST', 'fields': {'operating_country': 'Canada', 'operations_status': 'reviewed',
                                                         'operations_basis': 'Explicit operating asset concentration in the reviewed filing.'}}}]}
        self.assertEqual(apply_decisions(self.root, decisions)['profileRecords'], 1)
        self.assertEqual(read_json(self.root / 'data/reference/ticker-review-overrides.json')['TEST']['operating_country'], 'Canada')
        self.assertEqual(self.dataset['trades'][0]['pnl'], 12.5)

    def test_price_preflight_prevents_unapproved_spend_and_future_ranges(self):
        job = next(job for job in plan_updates(self.inputs)['jobs'] if job['domain'] == 'prices')
        calls = []
        client = SimpleNamespace(metadata=SimpleNamespace(
            get_dataset_range=lambda **kwargs: {'start': '2020-01-01T00:00:00Z', 'end': '2030-01-01T00:00:00Z'},
            get_cost=lambda **kwargs: 5,
            get_record_count=lambda **kwargs: 100),
            timeseries=SimpleNamespace(get_range=lambda **kwargs: calls.append(kwargs)))
        result = price_download(self.root, job, 0, True, client)
        self.assertEqual(result['status'], 'cost_budget_exceeded')
        self.assertEqual(calls, [])
        self.assertEqual(price_download(self.root, job, 10, False, client)['status'], 'quote_only')
        client.metadata.get_dataset_range = lambda **kwargs: {'start': '2020-01-01T00:00:00Z', 'end': '2026-11-24T12:00:00Z'}
        self.assertEqual(price_download(self.root, job, 10, True, client)['status'], 'window_not_fully_available')
        self.assertEqual(calls, [])

    def test_price_overlaps_are_reused_without_requiring_provider_credentials(self):
        job = next(job for job in plan_updates(self.inputs)['jobs'] if job['domain'] == 'prices')
        path = self.root / 'data/prices/bars/a.parquet'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'validated-test-file')
        manifest = {'type': 'validated_price_download', 'validatedOHLCV': True, 'dataset': job['dataset'],
                    'schema': job['schema'], 'symbols': ['TEST'], 'normalizedFile': path.relative_to(self.root).as_posix(),
                    'normalizedBytes': path.stat().st_size, 'start': job['start'], 'end': job['end']}
        write_json(self.root / 'data/prices/manifests/test.json', manifest)
        self.assertEqual(uncovered_price_windows(self.root, job), [])
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(price_download(self.root, job, 0)['status'], 'already_downloaded')


if __name__ == '__main__':
    unittest.main()
