"""Run duration studies calculation and rendering checks."""
import shutil
import subprocess
import unittest
from pathlib import Path


class DurationTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for duration study checks')
    def test_duration_studies(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], check=True,
                       capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main()
