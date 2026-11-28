"""Check price chart provenance, source isolation and execution reconciliation."""
import copy
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from build_price_charts import check, validate_series, executions

ROOT = Path(__file__).resolve().parents[1]


class PriceChartTests(unittest.TestCase):
    def test_generated_sources_preserve_fixed_point_prices_and_counts(self):
        index = json.loads((ROOT / 'data/prices/index.json').read_text(encoding='utf-8'))
        session = index['tickers']['BENF']['2026-11-24']
        self.assertEqual({s['dataset']: s['barCount'] for s in session['sources']},
                         {'XNAS.ITCH': 703, 'XNAS.BASIC': 695, 'EQUS.MINI': 576})
        self.assertEqual(check(), 63)
        for source in session['sources']:
            path = ROOT / source['file']
            self.assertTrue(path.is_relative_to(ROOT / 'data/prices/tickers/BENF/2026-11-24'))
            payload = json.loads(path.read_text(encoding='utf-8'))
            validate_series(payload)
            self.assertTrue(all(isinstance(b['close'], str) for b in payload['bars']))
            for manifest_path in path.parent.glob('*.manifest.json'):
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
                self.assertEqual(len(payload['bars']), manifest['rowCount'])
                for kind, key in [('raw', 'rawFile'), ('normalized', 'normalizedFile')]:
                    self.assertEqual(hashlib.sha256((ROOT / manifest[key]).read_bytes()).hexdigest(), manifest['checksums'][kind])

    def test_recorded_executions_match_canonical_trade_identity(self):
        data = json.loads((ROOT / 'data/trades.json').read_text(encoding='utf-8'))
        trades = {t['id']: t for t in data['trades'] if t['symbol'] == 'BENF' and t['date'] == '2026-11-24'}
        saved = json.loads((ROOT / 'data/prices/tickers/BENF/2026-11-24/executions.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['trades'], executions(ROOT, trades))
        self.assertEqual(sorted(len(t['fills']) for t in saved['trades'].values()), [4, 8, 15])
        self.assertTrue(all(t['complete'] for t in saved['trades'].values()))

    def test_duplicate_or_wrong_day_bars_are_rejected(self):
        path = next((ROOT / 'data/prices/tickers/BENF').rglob('chart.json'))
        payload = json.loads(path.read_text(encoding='utf-8'))
        invalid = copy.deepcopy(payload)
        invalid['bars'].insert(0, invalid['bars'][0])
        with self.assertRaises(ValueError):
            validate_series(invalid)
        invalid = copy.deepcopy(payload)
        invalid['date'] = '2026-11-23'
        with self.assertRaises(ValueError):
            validate_series(invalid)

    def test_website_package_contains_only_indexed_browser_files(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            self.assertEqual(check(destination=destination), 63)
            self.assertEqual(check(destination), 63)
            files = [path for path in destination.rglob('*') if path.is_file()]
            self.assertEqual(len(files), 63)
            self.assertTrue(all(path.suffix == '.json' for path in files))
            self.assertFalse(any(path.name.endswith('.manifest.json') for path in files))

    @unittest.skipUnless(shutil.which('node'), 'Node is required for chart window and rendering checks')
    def test_chart_window_source_switching_and_real_fills(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
