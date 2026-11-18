"""Run the independent research page loading checks."""
import shutil
import subprocess
import unittest
from pathlib import Path


class ResearchPageTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for research page checks')
    def test_independent_page_and_daily_loading(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
