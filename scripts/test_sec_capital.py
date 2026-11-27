"""Check SEC evidence dates, units and historical estimation boundaries."""
import copy
import json
import shutil
import subprocess
import unittest
from pathlib import Path

from build_sec_capital import build_context

ROOT = Path(__file__).resolve().parents[1]


class SecCapitalTests(unittest.TestCase):
    def setUp(self):
        self.history = json.loads((ROOT / 'data/sec/capital-history.json').read_text(encoding='utf-8'))
        self.dataset = json.loads((ROOT / 'data/trades.json').read_text(encoding='utf-8'))

    def test_pilot_matches_latest_two_distinct_traded_symbols(self):
        symbols = list(dict.fromkeys(t['symbol'] for t in sorted(self.dataset['trades'], key=lambda t: t['opened'], reverse=True) if t['date'] <= '2026-11-25' and t['symbol'] != 'QQQ'))
        self.assertEqual(set(symbols[:2]), set(self.history['issuers']))
        generated = build_context(self.history, self.dataset)
        self.assertEqual(generated, json.loads((ROOT / 'data/sec/trade-capital.json').read_text(encoding='utf-8')))

    def test_independent_amounts_and_no_trade_mutations(self):
        baseline = copy.deepcopy(self.dataset)
        output = build_context(self.history, self.dataset)
        amd = next(t for t in output['trades'] if t['symbol'] == 'AMD' and t['entryAt'].startswith('2026-11-25'))
        self.assertEqual(amd['marketCapEstimate']['value'], 1640087251 * 373.35)
        self.assertEqual(amd['marketCapEstimate']['shareCountAgeDays'], 28)
        self.assertEqual(self.dataset, baseline)
        self.assertNotIn('QQQ', output['issuers'])
        benf = next(t for t in output['trades'] if t['symbol'] == 'BENF' and t['entryAt'].startswith('2026-11-24'))
        self.assertEqual(benf['marketCapEstimate']['shares'], 19146748)
        self.assertEqual(benf['marketCapEstimate']['scope'], 'quoted_class')
        observations = self.history['issuers']['AMD']['observations']
        estimate = next(x for x in observations if x['metric'] == 'floatShares')
        self.assertAlmostEqual(estimate['value'], 232300000000 / 143.81)

    def context_at(self, opened, price=10):
        self.dataset['trades'] = [{'id': 'test', 'symbol': 'AMD', 'opened': opened, 'entryPrice': price}]
        return build_context(self.history, self.dataset)['trades'][0]

    def test_as_of_is_not_publication_date(self):
        # January shares are not known before the February filing.
        self.assertIsNone(self.context_at('2026-02-03T10:00:00-05:00')['marketCapEstimate'])
        # Date-only publication cannot establish order on the filing day.
        self.assertIsNone(self.context_at('2026-02-04T10:00:00-05:00')['marketCapEstimate'])
        self.assertEqual(self.context_at('2026-02-05T10:00:00-05:00')['marketCapEstimate']['shares'], 1630410843)

    def test_exact_acceptance_boundary(self):
        before = self.context_at('2026-11-03T18:00:17-05:00')
        after = self.context_at('2026-11-03T18:00:18-05:00')
        self.assertEqual(before['marketCapEstimate']['shares'], 1630410843)
        self.assertEqual(after['marketCapEstimate']['shares'], 1640087251)

    def test_missing_zero_and_unreconciled_split(self):
        for price in (None, 0, float('nan')):
            self.assertIsNone(self.context_at('2026-11-25T10:00:00-05:00', price)['marketCapEstimate'])
        self.history['issuers']['AMD']['events'].append({
            'asOf': '2026-11-01', 'filingId': 'amd-2026-q3', 'affectsShareBasis': True,
            'description': 'Synthetic unreconciled split for boundary testing.'})
        result = self.context_at('2026-11-25T10:00:00-05:00')
        self.assertEqual(result['unavailableReason'], 'unreconciled_share_basis_change')
        self.assertIsNone(result['marketCapEstimate'])

    def test_identity_units_duplicates_and_arithmetic_rejected(self):
        original = copy.deepcopy(self.history)
        for mutation in ('cik', 'unit', 'duplicate', 'calculation'):
            self.history = copy.deepcopy(original)
            issuer = self.history['issuers']['AMD']
            if mutation == 'cik':
                issuer['cik'] = '999'
            elif mutation == 'unit':
                issuer['observations'][0]['unit'] = 'shares'
            elif mutation == 'duplicate':
                issuer['observations'].append(issuer['observations'][0])
            else:
                next(x for x in issuer['observations'] if x['basis'] == 'estimated')['value'] = 1
            with self.assertRaises(ValueError):
                build_context(self.history, self.dataset)

    @unittest.skipUnless(shutil.which('node'), 'Node is required for SEC disclosure rendering checks')
    def test_disclosure_rendering(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], check=True)


if __name__ == '__main__':
    unittest.main()
