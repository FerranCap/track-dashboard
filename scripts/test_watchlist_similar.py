"""Run Watchlist similarity matching and independent range-control checks."""
import shutil
import subprocess
import unittest
from pathlib import Path


class WatchlistSimilarTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for Watchlist similarity checks')
    def test_matching_and_range_controls(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
