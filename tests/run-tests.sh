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
echo "=== [1/2] Node.js unit tests ==========================================="
node --test tests

echo
echo "=== [2/2] Python backend self-test ====================================="
if command -v python3 >/dev/null 2>&1; then
  python3 server/mdnotes_server.py --selftest
else
  python server/mdnotes_server.py --selftest
fi

echo
echo "=== All tests passed. =================================================="
