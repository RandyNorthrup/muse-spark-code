#!/bin/sh
# Emacs check (hosts.yml, PLAN.md M63): acp.el, shell-maker and agent-shell
# at the tags below (each at least seven days old when pinned), cloned into
# WORK, then acp-check.el and agent-shell-check.el in batch against AGENT
# (the installed muse-spark-code-acp) and the fake Muse Code CLI. HOME is
# WORK's, so no Emacs configuration is read.
#
#   sh test/hosts/run-emacs.sh AGENT WORK
set -eu
agent="$1"
work="$2"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$work/lisp" "$work/home" "$work/workspace"
for pin in acp.el@v0.15.1 shell-maker@v0.97.3 agent-shell@v0.77.4; do
  repo="${pin%@*}"
  git clone --quiet --depth 1 --branch "${pin#*@}" "https://github.com/xenodium/$repo" "$work/src/$repo"
  cp "$work/src/$repo"/*.el "$work/lisp/"
done
muse="$(sh "$here/fake-muse.sh" "$work/fake-muse")"
emacs --version | head -1
for check in acp-check agent-shell-check; do
  (cd "$work/workspace" && HOME="$work/home" XDG_CONFIG_HOME="$work/fake-muse/config" \
    ACP_EL_DIR="$work/lisp" MUSE_ACP="$agent" FAKE_MUSE="$muse" WORKSPACE="$work/workspace" \
    emacs --batch -l "$here/emacs/$check.el")
done
