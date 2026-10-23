# Chrome add-on (M110os OS7)

Google Chrome as a system-extension add-on, installed only by the user's
click under Google's terms. `addon.json` is the machine-checked manifest
(OS5's `check-addon` validates it); `fingerprints.txt` pins Google's
signing key; `check-key.mjs` verifies an install keyring against the pin.

## Trust chain (verified live 2026-10-23)

```sh
curl -sSL -o linux_signing_key.pub https://dl.google.com/linux/linux_signing_key.pub
curl -sSL -o Release https://dl.google.com/linux/chrome/deb/dists/stable/Release
curl -sSL -o Release.gpg https://dl.google.com/linux/chrome/deb/dists/stable/Release.gpg
gpg --batch --verify Release.gpg Release
```

Result: a good signature from `Google Inc. (Linux Packages Signing
Authority)`, subkey `0E225917414670F4442C250DFD533C07C264648F`,
and `Architectures: amd64 arm64` — the plan's two architectures.

## Build (runs in OS6 CI and on the device, after OS1)

1. Fetch the keyring and check it: `check-key.mjs --keyring <file>
--fingerprints fingerprints.txt`.
2. Add the APT source from `addon.json` with `signed-by` on that keyring.
3. `apt update` (the Release signature is verified against the keyring)
   and `apt download google-chrome-stable` for the target architecture.
4. Unpack the package into the extension tree and ship it as the
   `chrome_<version>_<arch>.raw` sysext with itsverity hash (OS5).

## Install

The first-boot setup and the dashboard offer **Install Google Chrome**
with the terms linked. The install runs only after the user's click;
without Chrome the node uses Chromium (the manifest's `fallback`).
