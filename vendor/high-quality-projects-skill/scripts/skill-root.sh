#!/usr/bin/env bash
# Print the root directory of this package — the directory containing
# scripts/ and templates/.
#
# The instructions refer to paths as ${SKILL_ROOT}/... Any agent can resolve
# that by running this script, because the script locates itself rather than
# relying on an environment variable that only one vendor sets.
#
#   SKILL_ROOT="$(bash /path/to/high-quality-projects-skill/scripts/skill-root.sh)"
#
# Resolution order:
#   1. $SKILL_ROOT           - explicit override, wins if set
#   2. $CLAUDE_PLUGIN_ROOT   - set automatically by Claude Code
#   3. this script's own parent directory - works for a plain git clone,
#      a vendored copy, or a submodule, with no environment at all
#
# Always exits 0 and always prints an absolute path.

set -euo pipefail

if [[ -n "${SKILL_ROOT:-}" ]]; then
    printf '%s\n' "${SKILL_ROOT%/}"
    exit 0
fi

if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" ]]; then
    printf '%s\n' "${CLAUDE_PLUGIN_ROOT%/}"
    exit 0
fi

# Resolve symlinks so that a symlinked script still reports the real package
# root. `readlink -f` is coreutils-only; fall back to a portable loop.
target="${BASH_SOURCE[0]}"
while [[ -L "${target}" ]]; do
    link="$(readlink "${target}")"
    if [[ "${link}" = /* ]]; then
        target="${link}"
    else
        directory="$(dirname -- "${target}")"
        target="$(cd -- "${directory}" && pwd)/${link}"
    fi
done

directory="$(dirname -- "${target}")"
root="$(cd -- "${directory}/.." && pwd)"
printf '%s\n' "${root}"
