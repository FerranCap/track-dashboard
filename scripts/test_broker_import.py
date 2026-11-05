"""Check broker position reconstruction and explicit cost treatment."""
import unittest
from decimal import Decimal

from import_broker_trades import normalize


def fill(side, qty, time, pnl='0', ecn='0', order='C2611050001'):
    return {'Symbol': 'TEST', 'Side': side, 'Qty': str(qty), 'Price': '2', 'Time': time,
            'P / L': pnl, 'ECNFee': ecn, 'Cloid': order}


class BrokerImportTests(unittest.TestCase):
    def test_partial_exits_form_one_trade_and_preserve_duplicate_fills(self):
        rows = [fill('S', 1, '09:02:00', '1', '-0.1'),
                fill('S', 1, '09:02:00', '1', '-0.1'), fill('B', 2, '09:01:00', ecn='-0.1')]
        output, trades = normalize(rows, '2026-11-05', 'ecn')
        self.assertEqual(len(trades), 1)
        self.assertEqual(len(output), 3)
        self.assertEqual(Decimal(trades[0]['pnl']), Decimal('1.7'))
        self.assertEqual(output[0]['TradeSide'], 'BUY')
        self.assertEqual(sum(Decimal(row['Commission']) for row in output), Decimal('0.3'))

    def test_short_cycle_and_reported_pnl(self):
        rows = [fill('B', 2, '09:02:00', '3', '0.1'), fill('SS', 2, '09:01:00', ecn='-0.2')]
        output, trades = normalize(rows, '2026-11-05', 'reported')
        self.assertEqual(output[0]['TradeSide'], 'SELL')
        self.assertEqual(trades[0]['pnl'], '3')
        self.assertEqual(output[0]['PnLBasis'], 'reported_without_ecn')

    def test_same_input_has_stable_trade_ids(self):
        rows = [fill('S', 1, '09:02:00'), fill('B', 1, '09:01:00')]
        self.assertEqual(normalize(rows, '2026-11-05', 'reported'), normalize(rows, '2026-11-05', 'reported'))

    def test_incomplete_and_reversed_positions_are_rejected(self):
        for rows in ([fill('B', 2, '09:01:00')],
                     [fill('S', 3, '09:02:00'), fill('B', 2, '09:01:00')]):
            with self.assertRaises(ValueError):
                normalize(rows, '2026-11-05', 'ecn')

    def test_date_mismatch_and_missing_basis_are_rejected(self):
        with self.assertRaises(ValueError):
            normalize([fill('B', 1, '09:01:00')], '2026-11-04', 'ecn')
        with self.assertRaises(ValueError):
            normalize([], '2026-11-05', '')


if __name__ == '__main__':
    unittest.main()
