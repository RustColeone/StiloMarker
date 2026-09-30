#!/usr/bin/env bash
# =============================================================================
#  StlioMarker / mdnotes -- one-click self-test runner (Linux/macOS)
#
#  Runs the Node.js unit-test suite (tests/) and the Python backend self-test.
#  Usage:  ./tests/run-tests.sh
# =============================================================================
set -euo pipefail

# Move to the repository root (this script lives in tests/).
cd "$(dirname "$0")/.."

echo
echo "=== [1/3] Node.js unit tests ==========================================="
node --test tests

echo
echo "=== [2/3] Python backend self-test ====================================="
if command -v python3 >/dev/null 2>&1; then
  python3 server/mdnotes_server.py --selftest
else
  python server/mdnotes_server.py --selftest
fi

echo
echo "=== [3/3] Sync reliability regressions =================================="
if command -v python3 >/dev/null 2>&1; then
  python3 -B tests/server-reliability.test.py
else
  python -B tests/server-reliability.test.py
fi

echo "=== All tests passed. =================================================="
