"""Validate the user-provided session risk history."""
import json
import unittest
from datetime import date
from pathlib import Path


class SessionRiskTests(unittest.TestCase):
    def test_reviewed_history(self):
        history = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'session-risk.json').read_text(encoding='utf-8'))
        self.assertEqual(history, [
            {'effectiveDate': '2025-01-01', 'risk': 20},
            {'effectiveDate': '2025-09-01', 'risk': 50},
            {'effectiveDate': '2025-10-01', 'risk': 100},
            {'effectiveDate': '2026-01-01', 'risk': 200},
            {'effectiveDate': '2026-04-01', 'risk': 300},
            {'effectiveDate': '2026-11-23', 'risk': 154.45573568551575},
            {'effectiveDate': '2026-11-24', 'risk': 162.65047055105285},
            {'effectiveDate': '2026-11-25', 'risk': 171.46070437256822},
        ])
        dates = [date.fromisoformat(entry['effectiveDate']) for entry in history]
        self.assertEqual(dates, sorted(set(dates)))
        self.assertTrue(all(entry['risk'] > 0 for entry in history))


if __name__ == '__main__':
    unittest.main()
