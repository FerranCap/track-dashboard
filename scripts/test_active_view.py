import shutil
import subprocess
import unittest
from pathlib import Path


class ActiveViewTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for active-view checks')
    def test_active_view(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
