#!/bin/bash
set -euo pipefail
host_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_dir="$(cd "$host_dir/../.." && pwd)"
# A reproducible local build never chooses an account or provisions implicitly.
team_id=""
if [[ $# -eq 2 && "$1" == --team ]]; then
  team_id="$2"
elif [[ $# -ne 0 ]]; then
  echo 'Usage: build.sh [--team TEAM_ID]' >&2
  exit 2
fi
node "$host_dir/Scripts/generate.mjs"
set -- -project "$host_dir/MuseSpark.xcodeproj" -scheme MuseSpark -configuration Release \
  -derivedDataPath "$repo_dir/temp/m104x/ReleaseDerivedData" build
if [[ -n "$team_id" ]]; then
  if [[ ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then
    echo 'ENATIVE_TEAM' >&2
    exit 2
  fi
  set -- "$@" CODE_SIGN_STYLE=Automatic "DEVELOPMENT_TEAM=$team_id" CODE_SIGN_IDENTITY='Apple Development' -allowProvisioningUpdates
else
  set -- "$@" CODE_SIGN_IDENTITY=-
fi
# License failures remain failures. This script never accepts a license or terms.
xcodebuild "$@" > "$repo_dir/temp/m104x/build-release.log" 2>&1
app_path="$repo_dir/temp/m104x/ReleaseDerivedData/Build/Products/Release/Muse Spark for Xcode.app"
codesign --verify --deep --strict "$app_path"
archive_path="$repo_dir/temp/m104x/Muse-Spark-for-Xcode.zip"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$archive_path"
printf '%s\n' "$archive_path"
