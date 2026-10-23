#!/bin/sh
# Classic Vim's check (hosts.yml, PLAN.md M66): real Vim 8.1+ drives the
# editors/vim plugin against the installed agent package. No model is called:
# the session runs one locally answered command (/whatsnew), or, where the
# Muse Code CLI is not installed, the check proves the refusal surfaces
# instead of hanging. Needs Vim with +job/+channel and node.
#
#   sh test/hosts/vim.sh INSTALLED_DIR [WORK]
set -eu
installed="$1"
work="${2:-$(mktemp -d -t vim-check)}"
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$installed/editors/vim"
for file in plugin/muse_spark.vim autoload/muse_spark.vim doc/muse_spark.txt README.md; do
  if [ ! -f "$plugin/$file" ]; then
    echo "FAIL vim: $plugin/$file is missing from the installed package" >&2
    exit 1
  fi
done
if ! command -v vim > /dev/null; then
  echo "FAIL vim: no vim on PATH" >&2
  exit 1
fi
if ! vim --version | grep -q '+job'; then
  echo "FAIL vim: this Vim has no +job" >&2
  exit 1
fi
if ! vim --version | grep -q '+channel'; then
  echo "FAIL vim: this Vim has no +channel" >&2
  exit 1
fi
version="$(vim --version | head -n 1)"
echo "vim: $version"
node_bin="$(command -v node)"
agent_js="$installed/dist/acp.js"
if [ ! -f "$agent_js" ]; then
  echo "FAIL vim: $agent_js is missing from the installed package" >&2
  exit 1
fi
expected="$(node -e "console.log(require('$installed/package.json').version)")"
mkdir -p "$work/cwd"
transcript="$work/transcript.txt"
# The driver bounds every wait itself and cquits past it, so no external
# timeout is needed (macOS has no `timeout` command).
VIM_PLUGIN="$plugin" \
VIM_NODE="$node_bin" \
VIM_ACP_JS="$agent_js" \
VIM_VERSION="$expected" \
VIM_CWD="$work/cwd" \
VIM_TRANSCRIPT="$transcript" \
  vim --not-a-term -Nu NONE -n -S "$here/vim-driver.vim"
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL vim: the driver left nonzero ($status); transcript:" >&2
  cat "$transcript" >&2
  exit 1
fi
echo "ok   vim: the plugin drove the packed agent; transcript in $transcript"
cat "$transcript"
