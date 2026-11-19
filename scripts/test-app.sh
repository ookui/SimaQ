#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--all" ]]; then
  "$0"
  exec "$0" --performance
fi
app="$PWD/build/SimaQ.app/Contents/MacOS/SimaQ"
testdir="$(mktemp -d "${TMPDIR:-/tmp}/simaq-acceptance.XXXXXX")"
export SIMAQ_TEST_HOME="$testdir/state"
export SIMAQ_SEARCH_INDEX_DIR="$testdir/index"
if [[ "${1:-}" == "--performance" ]]; then
    export SIMAQ_TEST_ROOT="$testdir/corpus"
    python3 benchmarks/generate_corpus.py "$SIMAQ_TEST_ROOT"
    phases=(app-search-timing)
else
    export SIMAQ_TEST_ROOT="$testdir/fixture"
    cp -R Samples "$SIMAQ_TEST_ROOT"
    phases=(app-integration app-restore app-preferences app-editing app-caret app-wechat app-math app-file-previews app-inline-images app-scroll-settings)
    if [[ "${1:-}" == "--caret" ]]; then phases=(app-caret); fi
fi
for phase in "${phases[@]}"; do
  export SIMAQ_TEST_OUTPUT="$testdir/$phase.json"
  export SIMAQ_TEST_SCRIPT="$PWD/tests/$phase.js"
  "$app" || { cat "$SIMAQ_TEST_OUTPUT" 2>/dev/null; exit 1; }
  cat "$SIMAQ_TEST_OUTPUT"
  echo
done
echo "Test results: $testdir"
