"""Check ticker denominators, data presence and generated completeness bars."""
import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from build_data_completeness import build_inventory, price_inventory

ROOT = Path(__file__).resolve().parents[1]


class DataCompletenessTests(unittest.TestCase):
    def setUp(self):
        self.dataset = json.loads((ROOT / 'data/trades.json').read_text(encoding='utf-8'))
        self.capital = json.loads((ROOT / 'data/sec/trade-capital.json').read_text(encoding='utf-8'))
        self.news = json.loads((ROOT / 'data/news/trade-context.json').read_text(encoding='utf-8'))

    def test_generated_inventory_and_independent_presence_counts(self):
        baseline = copy.deepcopy(self.dataset)
        result = build_inventory(self.dataset, self.capital, self.news, price_inventory(ROOT))
        expected = json.loads((ROOT / 'data/reference/data-completeness.json').read_text(encoding='utf-8'))
        self.assertEqual(result, expected)
        symbols = {trade['symbol'] for trade in self.dataset['trades']}
        self.assertEqual(set(result['symbols']), symbols)
        self.assertEqual(set(result['fields']['incorporationCountry']), symbols)
        self.assertEqual(result['fields']['floatShares'], ['AMD', 'BENF'])
        self.assertEqual(result['fields']['marketCap'], ['AMD'])
        self.assertEqual(result['fields']['quotedClassValue'], ['BENF'])
        self.assertEqual(result['fields']['prices1m'], ['AKAN', 'BENF', 'NVDA'])
        self.assertEqual(result['fields']['prices1s'], ['NVDA'])
        reviewed = {entry['symbol'] for entry in self.news['trades'] if entry.get('reviewedOn')
                    and entry.get('reviewStatus') != 'not_reviewed'}
        linked = {entry['symbol'] for entry in self.news['trades'] if entry.get('articles')}
        self.assertEqual(set(result['fields']['news']), reviewed | linked)
        self.assertEqual(self.dataset, baseline)

    def test_unknowns_missing_profiles_and_zero(self):
        source = {'generatedAt': 'test', 'tradeCount': 2, 'tickerProfiles': {'A': {
            'cik': '1', 'issuer_name': 'Issuer', 'operating_country': 'unknown', 'headquarters_country': ''}},
            'trades': [{'id': 'a', 'symbol': 'A', 'opened': '2026-11-25T10:00:00-05:00', 'entryPrice': 1},
                       {'id': 'b', 'symbol': 'B', 'opened': '2026-11-25T10:00:00-05:00'}]}
        capital = {'issuers': {'A': {'cik': '1', 'filings': {'f': {}}, 'observations': [
            {'metric': 'floatShares', 'value': 0, 'filingId': 'f'},
            {'metric': 'sharesOutstanding', 'value': None, 'filingId': 'f'}]}}}
        news = {'trades': [{'tradeId': 'a', 'symbol': 'A', 'entryAt': source['trades'][0]['opened'],
                           'reviewStatus': 'reviewed_no_news', 'reviewedOn': '2026-11-27', 'articles': []}]}
        result = build_inventory(source, capital, news, {})
        self.assertEqual(result['symbols'], ['A', 'B'])
        self.assertEqual(result['fields']['operatingCountry'], [])
        self.assertEqual(result['fields']['headquartersCountry'], [])
        self.assertEqual(result['fields']['floatShares'], ['A'])
        self.assertEqual(result['fields']['sharesOutstanding'], [])
        self.assertEqual(result['fields']['news'], ['A'])
        news['trades'][0]['entryAt'] = '2000-01-01'
        self.assertEqual(build_inventory(source, capital, news, {})['fields']['news'], [])

    def test_prices_need_actual_valid_bars(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prices = root / 'data/prices'
            prices.mkdir(parents=True)
            for symbol, bars in [('EMPTY', []), ('BAD', [{'time': 1, 'open': 0}]),
                                 ('GOOD', [{'time': 1, 'open': '1', 'high': '2', 'low': '1', 'close': '2'}])]:
                (prices / f'{symbol}.json').write_text(json.dumps({'symbol': symbol, 'interval': '1m', 'bars': bars}))
            (prices / 'manifest.json').write_text(json.dumps({'symbol': 'MANIFEST', 'interval': '1m', 'file': 'missing.json'}))
            self.assertEqual(price_inventory(root), {'1m': {'GOOD'}, '1s': set()})

    @unittest.skipUnless(shutil.which('node'), 'Node is required for completeness rendering checks')
    def test_completeness_rendering(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
