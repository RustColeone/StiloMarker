#!/usr/bin/env bash
# Every test of the repository, from anywhere: tools/run-tests.mjs says what
# it runs. Add --browser for the browser tests.
#   ./tests/run-tests.sh [--browser]
cd "$(dirname "$0")/.." && exec node tools/run-tests.mjs "$@"
