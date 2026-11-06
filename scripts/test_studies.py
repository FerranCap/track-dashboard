"""Run price and incorporation-country study checks."""
import shutil
import subprocess
import unittest
from pathlib import Path


class StudyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for study checks')
    def test_price_and_country_studies(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], check=True,
                       capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main()
