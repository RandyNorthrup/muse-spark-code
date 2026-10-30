# The Muse Node OS image builder: Debian 13 (systemd 257, the toolset mkosi
# 27.1 needs) pinned by digest, with the mkosi release pinned in os/pins.json
# (its SHA-256 is checked before it is installed). The node-os pipeline and a
# person reproducing an image build and run this one container:
#   docker build -f os/builder/Dockerfile -t muse-nodeos-builder os
#   docker run --rm --privileged -v "$PWD:/work" -w /work muse-nodeos-builder \
#     python3 os/build.py x86-64 --runtime dist/<runtime>.tgz --runtime-sha256 <digest> \
#     --mkosi /usr/local/bin/mkosi
# mkosi assembles disks with loop mounts, so the container runs privileged.
# A cross-architecture build (arm64 on x86-64) additionally needs the host's
# binfmt_misc entry for qemu-aarch64 registered with the fixed-binary flag.
FROM debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
      systemd systemd-boot-efi systemd-boot-tools systemd-container systemd-repart systemd-ukify \
      cryptsetup-bin \
      dosfstools e2fsprogs mtools kmod cpio \
      gdisk fdisk util-linux \
      squashfs-tools zstd xz-utils tar gzip \
      ca-certificates curl gpgv openssl \
      debian-archive-keyring debootstrap \
      qemu-user-static binfmt-support \
      sbsigntool clevis \
  && rm -rf /var/lib/apt/lists/*
COPY pins.json /tmp/pins.json
RUN set -eu; \
    url="$(python3 -c 'import json; print(json.load(open("/tmp/pins.json"))["mkosi"]["url"])')"; \
    sha="$(python3 -c 'import json; print(json.load(open("/tmp/pins.json"))["mkosi"]["sha256"])')"; \
    curl -fsSL -o /opt/mkosi.tar.gz "$url"; \
    echo "$sha  /opt/mkosi.tar.gz" | sha256sum -c -; \
    pip install --break-system-packages /opt/mkosi.tar.gz; \
    rm /opt/mkosi.tar.gz /tmp/pins.json; \
    mkosi --version; ukify --version | head -1; systemd-repart --version | head -1; \
    veritysetup --version; cryptsetup --version
