"""Run shared trade-filter behavior checks when Node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path


class TradeFilterTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for trade filter checks')
    def test_trade_filters(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], check=True,
                       capture_output=True, text=True)
