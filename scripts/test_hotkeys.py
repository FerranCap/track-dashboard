"""Verify DAS hotkey serialization and configuration interactions."""
import shutil
import subprocess
import unittest
from pathlib import Path


class HotkeyTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for hotkey checks')
    def test_hotkeys(self):
        result = subprocess.run(['node', str(Path(__file__).with_suffix('.js'))],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
