# The add-on layer (M110os OS5)

Add-ons are system-extension images (systemd-sysext), merged read-only
over `/usr` (and `/opt`, which Chrome needs — confirmed in systemd
257's sysext manual, which merges both hierarchies). Each add-on has a
directory here with a machine-checked `addon.json` manifest:

```sh
node os/addons/check-addon.mjs --manifest os/addons/<name>/addon.json [--tree <dir>]
```

## Version matching

The manifest's `osRelease` names the OS release the add-on is built
for. The build stamps it into the image's
`/usr/lib/extension-release.d/extension-release.<name>` file, and
systemd-sysext refuses to merge an image whose ID, VERSION_ID (or
SYSEXT_LEVEL) and ARCHITECTURE do not match the host. An add-on that
no longer matches the running OS is not merged; the update flow
removes it. `--tree` checks a built tree against the manifest before
it ships.

## Build lanes

Where the licence allows it, an add-on is built in CI and signed.
Where it does not (Chrome's and NVIDIA's licences forbid
redistribution), it is built on the device from the vendor's own
signed packages, after the user accepts the vendor's terms. The
manifest's `buildLane` says which; `ci` and `device` are the only
lanes.

## Trust

A manifest with a `keyring` pins the vendor's signing key by
fingerprint. The install keyring is verified against the pin with the
shared check (`os/addons/chrome/check-key.mjs --keyring <file>
--fingerprints <dir>/fingerprints.txt`, or `--transcript` in CI):
anything else refuses. APT sources are added with `signed-by` on the
checked keyring, so the repository metadata is verified at fetch.

## Verity

Sysext images ship with dm-verity. OS6 records each image's roothash
at publish; systemd-sysext verifies the image against it at merge.
