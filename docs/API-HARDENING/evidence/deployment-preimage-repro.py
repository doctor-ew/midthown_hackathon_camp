"""Run the current regression for the historical stale-preimage review finding.

The vulnerable behavior was reproduced at d8623fb before the tool repair.
The current regression verifies a stale rollback package cannot become a release base.
"""
import pathlib
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[3]
subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'test',
                '-p', 'deploy_guard_test.py'], cwd=root, check=True)
