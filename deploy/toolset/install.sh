#!/bin/sh
# B0: the entire pack is hashed BEFORE apt or tar may execute/read an artifact.
set -eu
pack=$1
case "$pack" in base|build) ;; *) exit 1 ;; esac
cd /tmp/muse-toolset
sha256sum --strict -c SHA256SUMS
export DEBIAN_FRONTEND=noninteractive
# Python's two meta packages have Pre-Depends, so configure their interpreter
# before unpacking them. Everything still comes from this verified pack.
set --
for file in /tmp/muse-toolset/debs/*.deb; do
  case "$(dpkg-deb -f "$file" Package)" in
    python3|python3-minimal) ;;
    *) set -- "$@" "$file" ;;
  esac
done
dpkg --unpack "$@"
dpkg --configure -a
if [ "$pack" = base ]; then
  dpkg --install /tmp/muse-toolset/debs/python3-minimal_*.deb
  dpkg --install /tmp/muse-toolset/debs/python3_*.deb
fi
if [ "$pack" = base ]; then
  tar --no-same-owner --no-same-permissions -xzf node.tar.gz -C /usr/local --strip-components=1
  tar --no-same-owner --no-same-permissions -xzf uv.tar.gz -C /usr/local/bin --strip-components=1 --wildcards '*/uv' '*/uvx'
  tar --no-same-owner --no-same-permissions -xzf gitleaks.tar.gz -C /usr/local/bin gitleaks
  mkdir -p /usr/local/share/doc/uv /usr/local/share/doc/gitleaks
  cp licenses/uv-license-* /usr/local/share/doc/uv/
  tar --no-same-owner --no-same-permissions -xzf gitleaks.tar.gz -C /usr/local/share/doc/gitleaks LICENSE
  ln -s /usr/bin/fdfind /usr/local/bin/fd
  mkdir -p /home/muse-tools
  chown 10001:10001 /home/muse-tools
fi
chmod -R go-w /usr/local
rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
