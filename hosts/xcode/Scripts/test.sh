#!/bin/bash
set -euo pipefail
host_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_dir="$(cd "$host_dir/../.." && pwd)"
node "$host_dir/Scripts/generate.mjs"
node "$host_dir/Scripts/prepare-tests.mjs"
xcodebuild -project "$host_dir/MuseSpark.xcodeproj" -scheme MuseSpark -configuration Debug \
  -derivedDataPath "$repo_dir/temp/m104x/DerivedData" -destination 'platform=macOS' test CODE_SIGN_IDENTITY=-
