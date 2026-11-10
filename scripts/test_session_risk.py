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
        ])
        dates = [date.fromisoformat(entry['effectiveDate']) for entry in history]
        self.assertEqual(dates, sorted(set(dates)))
        self.assertTrue(all(entry['risk'] > 0 for entry in history))


if __name__ == '__main__':
    unittest.main()
