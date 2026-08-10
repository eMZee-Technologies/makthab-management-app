#!/usr/bin/env python3
"""Bring up the Makthab app locally on Ubuntu/WSL (install, build, migrate, start dev servers).

Thin wrapper -- see scripts/run.py for the actual steps, or run:
  ./run.py --help
"""
import subprocess
import sys
from pathlib import Path

if __name__ == "__main__":
    script = Path(__file__).resolve().parent / "scripts" / "run.py"
    sys.exit(subprocess.run([sys.executable, str(script), *sys.argv[1:]]).returncode)
