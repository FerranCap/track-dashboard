"""Run optimal risk calculation checks when Node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path


class OptimalRiskTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for optimal risk checks')
    def test_optimal_risk(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
