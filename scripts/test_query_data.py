"""Verify prepared query data against canonical source semantics."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from build_query_data import ROOT, artifacts, build, encode, read


class QueryDataTests(unittest.TestCase):
    def test_indexes_preserve_trade_news_and_risk(self):
        generated = {key: json.loads(value) for key, value in artifacts(ROOT).items() if '/' not in key}
        source = read(ROOT, 'data/trades.json')
        news = read(ROOT, 'data/news/trade-context.json')
        index = generated['trade-index.json']
        self.assertEqual(sum(map(len, index['byTicker'].values())), len(source['trades']))
        self.assertEqual(sum(map(len, index['byDate'].values())), len(source['trades']))
        self.assertEqual(set(index['trades']), {trade['id'] for trade in source['trades']})
        for trade in source['trades']:
            row = index['trades'][trade['id']]
            self.assertEqual(row['opened'], trade['opened'])
            self.assertEqual(row['pnlUsd'], trade['pnl'])
            if row['riskUsd'] is not None:
                self.assertAlmostEqual(row['pnlR'], trade['pnl'] / row['riskUsd'])
            else:
                self.assertIsNone(row['pnlR'])
        compact = generated['news-index.json']
        self.assertTrue(compact['deferredDetails'])
        self.assertEqual([article['id'] for article in compact['articles']], [article['id'] for article in news['articles']])
        self.assertTrue(all('summary' not in article for article in compact['articles']))
        original = {article['id']: article for article in news['articles']}
        all_files = artifacts(ROOT)
        for symbol in compact['scopedSymbols']:
            path = f'news/tickers/{symbol}.json'
            if path in all_files:
                detail = json.loads(all_files[path])
                self.assertTrue(all(article == original[article['id']] for article in detail['articles']))
        self.assertEqual(compact['trades'], news['trades'])
        self.assertEqual(compact['byTrade'], {row['tradeId']: row['articles'] for row in news['trades']})
        self.assertEqual(len(generated['similarity-index.json']['records']), len(source['trades']))

    def fixture(self, root):
        trade = {'id': 'zero', 'symbol': 'A', 'date': '2026-11-24', 'opened': '2026-11-24T10:00:00-05:00', 'closed': '2026-11-24T10:01:00-05:00', 'pnl': 0, 'entryPrice': 1}
        inputs = {'data/trades.json': {'generatedAt': 'one', 'trades': [trade], 'tickerProfiles': {'A': {'symbol': 'A', 'cik': '123'}}},
                  'data/news/trade-context.json': {'schemaVersion': 1, 'windowHours': 48, 'dateFallbackDays': 2, 'scopedSymbols': [], 'articles': [], 'trades': [], 'reviews': []},
                  'data/sec/trade-capital.json': {'issuers': {}, 'trades': []}, 'data/session-risk.json': [],
                  'data/prices/index.json': {'tickers': {}}}
        for name, payload in inputs.items():
            path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(encode(payload))
        return inputs

    def test_incremental_build_missing_risk_and_zero(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); inputs = self.fixture(root)
            first = build(root); self.assertGreater(first['changed'], 0)
            ticker = read(root, 'data/generated/tickers/A.json')
            self.assertEqual(ticker['statistics']['pnl'], 0)
            self.assertEqual(ticker['statistics']['scratch'], 1)
            self.assertEqual(ticker['tradesWithoutRisk'], 1)
            self.assertEqual(build(root)['changed'], 0)
            self.assertEqual(build(root, check=True)['changed'], 0)
            old_session = (root / 'data/generated/sessions/2026-11-24.json').read_bytes()
            inputs['data/session-risk.json'] = [{'effectiveDate': '2026-11-24', 'risk': 100}]
            (root / 'data/session-risk.json').write_bytes(encode(inputs['data/session-risk.json']))
            with self.assertRaises(ValueError): build(root, check=True)
            self.assertGreater(build(root)['changed'], 0)
            self.assertEqual((root / 'data/generated/sessions/2026-11-24.json').read_bytes(), old_session)
            row = read(root, 'data/generated/trade-index.json')['trades']['zero']
            self.assertEqual(row['pnlR'], 0)
            self.assertEqual(read(root, 'data/generated/tickers/A.json')['tradesWithoutRisk'], 0)

    def test_unsafe_symbol_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); inputs = self.fixture(root)
            inputs['data/trades.json']['trades'][0]['symbol'] = '../escape'
            (root / 'data/trades.json').write_bytes(encode(inputs['data/trades.json']))
            with self.assertRaises(ValueError): artifacts(root)

    def test_incremental_isolation_matches_full_rebuild(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); inputs = self.fixture(root)
            trade = copy.deepcopy(inputs['data/trades.json']['trades'][0])
            trade.update(id='other', symbol='B', date='2026-11-25', opened='2026-11-25T10:00:00-05:00', closed='2026-11-25T10:01:00-05:00', pnl=3)
            inputs['data/trades.json']['trades'].append(trade)
            inputs['data/trades.json']['tickerProfiles']['B'] = {'symbol': 'B', 'cik': '456'}
            (root / 'data/trades.json').write_bytes(encode(inputs['data/trades.json']))
            build(root)
            untouched = [root / 'data/generated/tickers/B.json', root / 'data/generated/sessions/2026-11-25.json']
            before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in untouched]
            inputs['data/trades.json']['trades'][0]['pnl'] = 7
            inputs['data/trades.json']['generatedAt'] = 'two'
            (root / 'data/trades.json').write_bytes(encode(inputs['data/trades.json']))
            self.assertGreater(build(root)['changed'], 0)
            self.assertEqual([(path.read_bytes(), path.stat().st_mtime_ns) for path in untouched], before)
            self.assertEqual(build(root, check=True)['changed'], 0)
            self.assertEqual(read(root, 'data/generated/tickers/A.json')['statistics']['pnl'], 7)


if __name__ == '__main__': unittest.main()
