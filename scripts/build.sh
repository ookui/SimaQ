#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
for name in editor render tables; do
  for ext in js css; do
    asset="Web/editor/$name.$ext"
    if [[ ! -s "$asset" ]]; then
      echo "缺少编辑资源 $asset" >&2
      exit 1
    fi
  done
done
mkdir -p build
target="build/SimaQ.app"
mkdir -p "$target/Contents/MacOS" "$target/Contents/Resources"
swiftc -swift-version 5 -target arm64-apple-macos13.0 -O -module-cache-path "${TMPDIR:-/tmp}/simaq-swift-cache" -I Native/CSQLite -lsqlite3 Native/*.swift -o build/SimaQ.next
mv build/SimaQ.next "$target/Contents/MacOS/SimaQ"
cp Native/Info.plist "$target/Contents/Info.plist"
rsync -a --delete --exclude 'node_modules' --exclude 'src' --exclude 'package*.json' --exclude '*.test.cjs' --exclude '*.mjs' --exclude '.DS_Store' Web/ "$target/Contents/Resources/Web/"
rsync -a --delete Templates/ "$target/Contents/Resources/Templates/"
rsync -a --delete Samples/ "$target/Contents/Resources/Samples/"
cp docs/Guide.html "$target/Contents/Resources/Guide.html"
cp Native/SimaQ.icns "$target/Contents/Resources/SimaQ.icns"
codesign --force --sign - "$target"
codesign --verify --deep --strict "$target"
touch "$target"
echo "$PWD/$target"
