#!/bin/sh
# A VS Code fork's check (forks.yml, PLAN.md M62b): the fork's latest Linux
# x64 release (fork-release.mjs), unpacked into WORK without installing it;
# its version and VS Code base printed; the VSIX installed with the fork's
# own CLI and listed; then the extension's integration tests in the fork.
# FORK_URL, when set, is the package to test instead of the latest (an
# AppImage, a .deb or a tar archive), with FORK only naming the run. Needs
# the dev build (`npm run build:dev`) and a display (xvfb-run on Linux).
#
#   sh test/hosts/run-fork.sh cursor|devin-desktop|kiro|positron VSIX WORK
set -eu
fork="$1"
vsix="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
work="$3"
here="$(cd "$(dirname "$0")" && pwd)"
url="${FORK_URL:-}"
if [ -z "$url" ]; then
  release="$(node "$here/fork-release.mjs" latest "$fork")"
  url="${release#* }"
  echo "$fork ${release%% *}: $url"
fi
rm -rf "$work/app"
mkdir -p "$work/app" "$work/data" "$work/extensions"
curl -fsSL -o "$work/package" "$url"
case "$url" in
  *.AppImage)
    chmod +x "$work/package"
    (cd "$work/app" && "$work/package" --appimage-extract > /dev/null)
    ;;
  *.deb) dpkg-deb -x "$work/package" "$work/app" ;;
  *.tar.gz | *.tgz | *.tar | *.tar.xz) tar -xf "$work/package" -C "$work/app" ;;
  *)
    echo "FAIL $fork: no unpacker for $url" >&2
    exit 1
    ;;
esac
product="$(find "$work/app" -path '*/resources/app/product.json' | head -n 1)"
if [ -z "$product" ]; then
  echo "FAIL $fork: no resources/app/product.json in the package" >&2
  exit 1
fi
root="${product%/resources/app/product.json}"
described="$(node "$here/fork-release.mjs" describe "$root")"
name="$(printf '%s\n' "$described" | head -n 1)"
printf '%s\n' "$described" | tail -n 1
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf -- '- %s\n' "$(printf '%s\n' "$described" | tail -n 1)" >> "$GITHUB_STEP_SUMMARY"
fi
set -- --user-data-dir "$work/data" --extensions-dir "$work/extensions"
"$root/bin/$name" "$@" --install-extension "$vsix"
"$root/bin/$name" "$@" --list-extensions --show-versions > "$work/extensions.txt"
if ! grep -qi '^randynorthrup\.muse-spark-code@' "$work/extensions.txt"; then
  echo "FAIL $fork: the VSIX is not among the installed extensions:" >&2
  cat "$work/extensions.txt" >&2
  exit 1
fi
echo "ok   $fork: $(grep -i '^randynorthrup\.muse-spark-code@' "$work/extensions.txt") installed"
cd "$here/../.."
HOST_BIN="$root/$name" HOST_LABEL="$fork" npx vscode-test --config test/hosts/installed.vscode-test.mjs
