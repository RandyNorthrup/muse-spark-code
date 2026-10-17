#!/bin/sh
# Neovim check (hosts.yml, PLAN.md M63): Neovim's Linux release, plenary.nvim
# and CodeCompanion at the pins below (each at least seven days old when
# pinned) in WORK, then check.lua headless against AGENT (the installed
# muse-spark-code-acp) and the fake Muse Code CLI. HOME and Neovim's own
# folders are WORK's, and -u names the configuration.
#
#   sh test/hosts/run-neovim.sh AGENT WORK
set -eu
agent="$1"
work="$2"
here="$(cd "$(dirname "$0")" && pwd)"
nvim_version="v0.11.4"
codecompanion_tag="v19.25.0"
plenary_commit="74b06c6c75e4eeb3108ec01852001636d85a932b"
mkdir -p "$work/pack" "$work/home" "$work/workspace"
curl -fsSL -o "$work/nvim.tar.gz" \
  "https://github.com/neovim/neovim/releases/download/$nvim_version/nvim-linux-x86_64.tar.gz"
tar -xzf "$work/nvim.tar.gz" -C "$work"
git clone --quiet --depth 1 --branch "$codecompanion_tag" \
  https://github.com/olimorris/codecompanion.nvim "$work/pack/codecompanion.nvim"
git clone --quiet https://github.com/nvim-lua/plenary.nvim "$work/pack/plenary.nvim"
git -C "$work/pack/plenary.nvim" checkout --quiet "$plenary_commit"
muse="$(sh "$here/fake-muse.sh" "$work/fake-muse")"
"$work/nvim-linux-x86_64/bin/nvim" --version | head -1
cd "$work/workspace"
HOME="$work/home" XDG_DATA_HOME="$work/home/data" XDG_STATE_HOME="$work/home/state" \
  XDG_CACHE_HOME="$work/home/cache" XDG_CONFIG_HOME="$work/fake-muse/config" \
  NVIM_PACK="$work/pack" MUSE_ACP="$agent" FAKE_MUSE="$muse" \
  "$work/nvim-linux-x86_64/bin/nvim" --headless -u "$here/neovim/init.lua" \
  -c "luafile $here/neovim/check.lua"
