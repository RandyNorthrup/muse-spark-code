#!/bin/sh
set -eu
# Mounted into the pinned skopeo helper. /run is private tmpfs, and the registry
# token arrives only on stdin. The node's image contains none of this material.
skopeo login --authfile /run/auth.json --username "$REGISTRY_USER" --password-stdin ghcr.io
skopeo copy --all --preserve-digests --authfile /run/auth.json \
  oci-archive:/image.tar "docker://$DESTINATION"
