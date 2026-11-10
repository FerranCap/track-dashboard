"""Check historical R display calculations when Node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path


class PnlUnitTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for JavaScript calculation checks')
    def test_pnl_units(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], check=True,
                       capture_output=True, text=True)
