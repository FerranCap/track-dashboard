"""Check that issuer research cannot silently turn an inference into a confirmed country."""
import contextlib
import csv
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('profile_build_data', Path(__file__).with_name('build_data.py'))
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class IssuerProfileTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous_data, self.previous_out = BUILDER.DATA, BUILDER.OUT
        BUILDER.DATA = Path(self.directory.name)
        BUILDER.OUT = BUILDER.DATA / 'trades.json'
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.restore_paths)
        self.trade = dict(QuantTradeId='test-trade', TradeOpen='2026-11-04T14:30:00Z',
                          TradeClose='2026-11-04T14:35:00Z', TradePnL='12.50', Symbol='TEST',
                          TradeSide='BUY', TradeStatus='CLOSED', Side='BUY', Qty='10', Price='5')
        with (BUILDER.DATA / 'trades.csv').open('w', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(self.trade))
            writer.writeheader()
            writer.writerow(self.trade)

    def restore_paths(self):
        BUILDER.DATA, BUILDER.OUT = self.previous_data, self.previous_out

    def write_profiles(self, rows):
        folder = BUILDER.DATA / 'reference'
        folder.mkdir(exist_ok=True)
        with (folder / 'ticker-profiles.csv').open('w', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=['symbol', 'operating_country', 'operations_status', 'incorporation_country'])
            writer.writeheader()
            writer.writerows(rows)

    def build(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return BUILDER.build()

    def test_incorporation_and_operating_country_are_separate(self):
        self.write_profiles([dict(symbol='TEST', operating_country='China', operations_status='explicit_filing', incorporation_country='Cayman Islands')])
        data = self.build()
        self.assertEqual(data['trades'][0]['country'], 'China')
        self.assertEqual(data['tickerProfiles']['TEST']['incorporation_country'], 'Cayman Islands')
        self.assertEqual(data['trades'][0]['pnl'], 12.5)
        self.assertEqual(data['unsupportedFiles'], [])

    def test_inference_is_preserved_but_not_counted_as_confirmed(self):
        self.write_profiles([dict(symbol='TEST', operating_country='United States', operations_status='facilities_inference', incorporation_country='United States')])
        data = self.build()
        self.assertIsNone(data['trades'][0]['country'])
        self.assertEqual(data['tickerProfiles']['TEST']['operating_country'], 'United States')

    def test_duplicate_symbols_are_rejected(self):
        row = dict(symbol='TEST', operating_country='China', operations_status='reviewed', incorporation_country='Cayman Islands')
        self.write_profiles([row, row])
        with self.assertRaisesRegex(ValueError, 'unique'):
            self.build()

    def test_unresearched_ticker_stays_unknown(self):
        self.write_profiles([dict(symbol='OTHER', operating_country='China', operations_status='reviewed', incorporation_country='Cayman Islands')])
        self.assertIsNone(self.build()['trades'][0]['country'])


if __name__ == '__main__':
    unittest.main()
