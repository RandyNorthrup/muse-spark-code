#!/bin/sh
set -eu
: "${MUSE_NODE_IMAGE:?Set the verified image@sha256 digest}"
: "${MUSE_NODE_BIND_ADDRESS:?Choose the host LAN interface}"
exec docker run --name muse-spark-code-node --read-only \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --cap-add CHOWN --cap-add SETUID --cap-add SETGID --cap-add SETPCAP \
  --tmpfs /run:rw,nosuid,nodev,noexec,mode=0755 --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
  --mount type=volume,src=muse-node-state,dst=/var/lib/muse-spark-code-node \
  --mount type=volume,src=muse-node-workspaces,dst=/workspaces \
  --publish "$MUSE_NODE_BIND_ADDRESS:8443:8443" \
  --log-opt max-size=10m --log-opt max-file=3 --stop-timeout 30 \
  --restart unless-stopped --detach "$MUSE_NODE_IMAGE"
