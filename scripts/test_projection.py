"""Run projection calculation checks when Node is available."""
import shutil
import subprocess
import unittest
from pathlib import Path


class ProjectionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required for projection checks')
    def test_projection_calculations(self):
        subprocess.run(['node', str(Path(__file__).with_suffix('.js'))],
                       check=True, capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main()
