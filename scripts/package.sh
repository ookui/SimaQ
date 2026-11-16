#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/build.sh
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' Native/Info.plist)
name="SimaQ-${version}-macOS-arm64"
mkdir -p release
stage=$(mktemp -d "${TMPDIR:-/tmp}/simaq-package.XXXXXX")
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/$name/Source"
ditto build/SimaQ.app "$stage/$name/SimaQ.app"
cp docs/Guide.html "$stage/$name/使用说明.html"
cp README.md "$stage/$name/Source/README.md"
for item in Native Web Samples Templates scripts tests docs benchmarks; do
  rsync -a --exclude .DS_Store --exclude node_modules "$item/" "$stage/$name/Source/$item/"
done
codesign --verify --deep --strict "$stage/$name/SimaQ.app"
ditto -c -k --keepParent --norsrc "$stage/$name" "$stage/$name.zip"
unzip -tq "$stage/$name.zip"
rsync -a --delete "$stage/$name/SimaQ.app/" release/SimaQ.app/
codesign --verify --deep --strict release/SimaQ.app
mv "$stage/$name.zip" "release/$name.zip"
echo "$PWD/release/SimaQ.app"
echo "$PWD/release/$name.zip"
