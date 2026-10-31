# mkosi package manifest (recorded)

Captured 2026-10-23 on linuxlt: the x86-64 image build's JSON
manifest, written by mkosi 27.1 (the `pins.json` pin, SHA-256
verified) from the Debian `20261005T000000Z` snapshot:

```sh
python3 os/build.py x86-64 \
  --runtime dist/muse-spark-code-acp-0.19.0-linux-x64.tgz \
  --runtime-sha256 d641beeffa9122623d83d14608ae29bb3d83bb7581e3f9ebc573ef98f6af2ecd \
  --mkosi /usr/local/bin/mkosi
```

- `muse-node-x86-64.manifest`: 147 `deb` packages, image
  version 0.19.0.
  SHA-256: `6df4c8aeacd9de31278be408595ccdab9c9a5174aeacdf4077494adc8fe9b997`

The SBOM suite converts this manifest and asserts every package
lands in the SPDX document with its exact name, version and purl.
