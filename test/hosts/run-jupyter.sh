#!/bin/sh
# JupyterLab check (hosts.yml, PLAN.md M63): a venv in WORK with the pinned
# JupyterLab and Jupyter AI, the Muse Spark persona in the served folder,
# the agent AGENT (the installed muse-spark-code-acp) on the fake Muse Code
# CLI, and the chat driven by jupyter.mjs. Jupyter's own folders are WORK's.
#
#   sh test/hosts/run-jupyter.sh AGENT WORK
set -eu
agent="$1"
work="$2"
port="${HOSTS_PORT:-8899}"
here="$(cd "$(dirname "$0")" && pwd)"
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install --quiet --disable-pip-version-check -r "$here/jupyter/requirements.txt"
mkdir -p "$work/served/.jupyter/personas" "$work/home"
cp "$here/jupyter/personas/"* "$work/served/.jupyter/personas/"
muse="$(sh "$here/fake-muse.sh" "$work/fake-muse")"
# Root (the development container) must say so; CI runs unprivileged.
root_flag=""
if [ "$(id -u)" = 0 ]; then root_flag="--allow-root"; fi
(
  cd "$work/served"
  HOME="$work/home" JUPYTER_CONFIG_DIR="$work/home/config" JUPYTER_DATA_DIR="$work/home/data" \
    JUPYTER_RUNTIME_DIR="$work/home/runtime" XDG_CONFIG_HOME="$work/fake-muse/config" \
    MUSE_ACP="$agent" MUSE_ACP_ARGS="--muse-binary $muse" \
    exec "$work/venv/bin/jupyter" lab $root_flag --no-browser --ip 127.0.0.1 --port "$port" \
    --ServerApp.token= --ServerApp.password= --ServerApp.root_dir="$work/served"
) > "$work/jupyter.log" 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
tries=0
until grep -q "is running at" "$work/jupyter.log"; do
  tries=$((tries + 1))
  if [ "$tries" -gt 240 ]; then
    echo "JupyterLab did not start; its log:" >&2
    cat "$work/jupyter.log" >&2
    exit 1
  fi
  sleep 0.5
done
"$work/venv/bin/pip" show jupyterlab jupyter-ai | grep -E '^(Name|Version)'
node "$here/jupyter.mjs" "http://127.0.0.1:$port" "$work/shots"
# Jupyter AI's notebook tools reach the agent (M63c).
grep "MCP servers from the editor: Jupyter MCP Server" "$work/jupyter.log"
