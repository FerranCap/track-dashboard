"""Validate key accounting invariants of the generated Quant dataset."""
import json
import unittest
from collections import Counter
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / 'data' / 'trades.json'


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads(PATH.read_text(encoding='utf-8'))
        cls.trades = cls.data['trades']

    def test_schema_and_unique_trade_ids(self):
        self.assertEqual(self.data['schemaVersion'], 2)
        ids = [trade['id'] for trade in self.trades]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(self.data['tradeCount'], len(ids))

    def test_entry_and_hold_fields(self):
        for trade in self.trades:
            self.assertGreaterEqual(trade['holdMinutes'], 0)
            self.assertIsNotNone(trade['entryPrice'])
            self.assertGreater(trade['entryQty'], 0)
            self.assertIsNone(trade['mae'])
            self.assertIsNone(trade['mfe'])

    def test_counts_and_pnl(self):
        self.assertEqual(Counter(trade['side'] for trade in self.trades)['BUY'] +
                         Counter(trade['side'] for trade in self.trades)['SELL'], len(self.trades))
        self.assertEqual(round(sum(trade['pnl'] for trade in self.trades), 2), 1880.37)
        self.assertLessEqual(self.data['uniqueExecutionRows'], self.data['executionRows'])


if __name__ == '__main__':
    unittest.main()
