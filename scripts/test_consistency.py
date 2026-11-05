"""Run browser-independent consistency calculation checks when Node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path


class ConsistencyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for JavaScript calculation checks')
    def test_consistency_calculations(self):
        script = Path(__file__).with_suffix('.js')
        subprocess.run(['node', str(script)], check=True, capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main()
