"""Check session boundaries and minute aggregation for the research chart."""
import unittest

from build_research_bars import aggregate_session


def record(timestamp, opening='10', high='12', low='9', closing='11', volume='7'):
    return dict(hd=dict(ts_event=timestamp), symbol='NVDA', open=opening,
                high=high, low=low, close=closing, volume=volume)


class ResearchBarTests(unittest.TestCase):
    def test_ohlc_volume_and_chronology(self):
        result = aggregate_session([
            record('2026-10-01T08:00:59Z', '11', '14', '10', '13', '5'),
            record('2026-10-01T08:00:01Z'),
            record('2026-10-01T08:02:00Z'),
        ], '2026-10-01')
        self.assertEqual(result['sourceRecordCount'], 3)
        self.assertEqual(len(result['bars']), 2)
        first = result['bars'][0]
        self.assertEqual([first[key] for key in ('open', 'high', 'low', 'close', 'volume')],
                         ['10', '14', '9', '13', 12])
        self.assertEqual(result['bars'][1]['time'] - first['time'], 120)

    def test_session_date_is_new_york_in_summer_and_winter(self):
        for date, previous, boundary in [('2026-10-01', '2026-10-01T03:59:59Z', '2026-10-01T04:00:00Z'),
                                          ('2026-11-17', '2026-11-17T04:59:59Z', '2026-11-17T05:00:00Z')]:
            with self.subTest(date=date):
                result = aggregate_session([record(previous), record(boundary)], date)
                self.assertEqual(result['sourceRecordCount'], 1)

    def test_empty_session_is_rejected(self):
        with self.assertRaises(ValueError):
            aggregate_session([], '2026-10-01')

    def test_decimal_precision_is_preserved(self):
        result = aggregate_session([record('2026-10-01T08:00:00Z',
            '230.380000001', '230.380000003', '230.380000000', '230.380000002')], '2026-10-01')
        self.assertEqual(result['bars'][0]['open'], '230.380000001')
