#!/usr/bin/env python3
"""Runs every `test_*.py` in the repo. Usage: python3 scripts/test.py [-v] [-k pattern]"""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Any store a test forgets to point at a temp dir lands here, never in the real ~/.corgiops.
os.environ["CORGIOPS_HOME"] = tempfile.mkdtemp(prefix="corgiops-test-home-")
sys.path.insert(0, ROOT)

if __name__ == "__main__":
    unittest.main(module=None, argv=[sys.argv[0], "discover", "-s", ROOT, "-t", ROOT, "-p", "test_*.py", *sys.argv[1:]])
