#!/bin/sh
# B0: the image-owned manifest pins are hashed BEFORE dpkg or tar sees an artifact.
set -eu
pack=$1
case "$pack" in base|build) ;; *) exit 1 ;; esac
cd /tmp/muse-toolset
checksums=/usr/local/share/muse-toolset/checksums/$pack.sha256
sha256sum --strict -c "$checksums"
export DEBIAN_FRONTEND=noninteractive
# Python's two meta packages have Pre-Depends, so configure their interpreter
# before unpacking them. Everything still comes from this verified pack.
set --
python=
python_minimal=
while read -r _checksum file; do
  case "$file" in
    debs/*)
      case "$(dpkg-deb -f "$file" Package)" in
        python3) python=$file ;;
        python3-minimal) python_minimal=$file ;;
        *) set -- "$@" "$file" ;;
      esac
      ;;
  esac
done < "$checksums"
if [ "$pack" = base ] && { [ -z "$python_minimal" ] || [ -z "$python" ]; }; then
  printf '%s\n' 'Pinned Python packages missing from base toolset' >&2
  exit 1
fi
dpkg --unpack "$@"
dpkg --configure -a
if [ "$pack" = base ]; then
  dpkg --install "$python_minimal"
  dpkg --install "$python"
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
