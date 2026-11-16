#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# All fixtures, draft state and search databases stay inside the temporary run.
testdir="$(mktemp -d "${TMPDIR:-/tmp}/simaq-core.XXXXXX")"
trap 'rm -rf "$testdir"' EXIT
export SIMAQ_SEARCH_INDEX_DIR="$testdir/index"
cache="${TMPDIR:-/tmp}/simaq-swift-cache"
common=(-swift-version 5 -module-cache-path "$cache")

node --test Web/settings.test.cjs Web/editor/*.test.cjs
swiftc "${common[@]}" Native/MarkdownLinks.swift Native/NoteMetadata.swift Native/Workspace.swift Native/Assets.swift tests/workspaceTests.swift -o "$testdir/workspace-tests"
"$testdir/workspace-tests"
swiftc "${common[@]}" -I Native/CSQLite -lsqlite3 Native/MarkdownLinks.swift Native/Search.swift tests/search_tests.swift -o "$testdir/search-tests"
"$testdir/search-tests"
swiftc "${common[@]}" Native/Reader.swift tests/ReaderTests.swift -o "$testdir/reader-tests"
"$testdir/reader-tests" --boundary-only
if [[ "${1:-}" == "--reader" ]]; then
    "$testdir/reader-tests"
else
    echo "Reader compiled; WebKit runtime skipped (run with --reader in a desktop session)."
fi
