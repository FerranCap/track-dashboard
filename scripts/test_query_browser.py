import shutil
import subprocess
import unittest
from pathlib import Path


class QueryDataBrowserTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for generated index parity checks')
    def test_generated_index_parity(self):
        result = subprocess.run(['node', str(Path(__file__).with_name('test_query_data.js'))], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
