#!/bin/bash
set -euo pipefail
host_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_dir="$(cd "$host_dir/../.." && pwd)"
node "$host_dir/Scripts/generate.mjs"
# Conformance runs only under its runner (hosts/xcode/run.mjs), which
# writes the contract file fresh; without it the target's cases skip.
rm -f "$host_dir/conformance-contract.json" "$host_dir/conformance-observations.json"
xcodebuild -project "$host_dir/MuseSpark.xcodeproj" -scheme MuseSpark -configuration Debug \
  -derivedDataPath "$repo_dir/temp/m104x/DerivedData" -destination 'platform=macOS' test CODE_SIGN_IDENTITY=-
