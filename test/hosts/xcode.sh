#!/bin/sh
# Xcode 26.3's external route, as far as a rig can take it (PLAN.md M66):
# the mcpbridge health probe, then a session carrying one real stdio MCP
# server (this package's own `mcp` mode, or `xcrun mcpbridge` itself with
# XCODE_MCP_SERVER=xcode where Xcode runs). No model is called. The probe
# always exits 0 with its verdict; the attach proof exits 0 on a carried
# server, 1 on failure, 2 without the Muse Code CLI. Not wired into CI
# (hosts.yml): it needs a Mac, and the CLI where it proves the attach.
#
#   sh test/hosts/xcode.sh INSTALLED_DIR [WORK]
#   XCODE_MCP_SERVER=xcode sh test/hosts/xcode.sh INSTALLED_DIR [WORK]
set -eu
installed="$1"
work="${2:-$(mktemp -d -t xcode-check)}"
here="$(cd "$(dirname "$0")" && pwd)"
agent_js="$installed/dist/acp.js"
if [ ! -f "$agent_js" ]; then
  echo "FAIL xcode: $agent_js is missing from the installed package" >&2
  exit 1
fi
if [ "$(uname)" = Darwin ]; then
  echo "--- mcpbridge health"
  node "$here/xcode-probe.mjs"
else
  echo "NOT-APPLICABLE xcrun ships on macOS only"
fi
echo "--- attach proof"
mkdir -p "$work/cwd"
XCODE_ACP_JS="$agent_js" \
XCODE_NODE="$(command -v node)" \
XCODE_CWD="$work/cwd" \
  node "$here/xcode-attach.mjs"
