"""Verify journal data and interactions with the dashboard's JavaScript runtime."""
import shutil
import subprocess
import unittest
from pathlib import Path


class JournalTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for journal checks')
    def test_journal(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))], check=True,
                       capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main()
