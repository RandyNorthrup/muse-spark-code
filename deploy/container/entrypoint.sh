#!/bin/bash
set -euo pipefail
umask 077

# These IDs and paths are the lane N integration contract. Never recursively
# chown a volume: workspaces are untrusted, and symlinks must not redirect root.
prepare_volume() {
  local directory=$1 owner=$2
  test -d "$directory" && test ! -L "$directory"
  if test "$(stat -c %u "$directory")" = 0; then
    test -z "$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit)"
    chmod 0700 "$directory"
    chown "$owner:$owner" "$directory"
  fi
  test "$(stat -c '%u:%g:%a' "$directory")" = "$owner:$owner:700"
}
prepare_volume /var/lib/muse-spark-code-node 10001
prepare_volume /workspaces 10002
mkdir -p /run/muse-tools/home
chmod 0710 /run/muse-tools
chmod 0700 /run/muse-tools/home
chown 10002:10002 /run/muse-tools/home
chown 10002:10003 /run/muse-tools

drop_node() {
  exec setpriv --reuid=10001 --regid=10001 --groups=10003 \
    --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs \
    env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
    HOME=/var/lib/muse-spark-code-node XDG_CONFIG_HOME=/var/lib/muse-spark-code-node/config \
    MUSE_NODE_DATA_ROOT=/var/lib/muse-spark-code-node MUSE_NODE_WORKSPACE_ROOT=/workspaces \
    MUSE_NODE_TOOL_SOCKET=/run/muse-tools/host.sock \
    tini -g -- node /opt/muse/dist/node.js "$@"
}

if test "${1:-}" != serve; then
  drop_node "$@"
fi

# The tool host must create host.sock as 0660, authenticate its node peer and
# stop on owner disconnect. No credentials or node home reach this process.
setpriv --reuid=10002 --regid=10002 --groups=10003 \
  --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs --pdeathsig=TERM \
  env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
  HOME=/run/muse-tools/home XDG_CONFIG_HOME=/run/muse-tools/home/config \
  XDG_RUNTIME_DIR=/run/muse-tools/home \
  node /opt/muse/dist/nodeToolHost.js \
    --socket /run/muse-tools/host.sock --workspace /workspaces &
drop_node "$@"
