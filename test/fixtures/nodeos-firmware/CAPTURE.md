# Debian snapshot firmware responses (recorded)

Captured 2026-10-23 on linuxlt, one file per firmware package with:

```sh
curl -sSL "https://snapshot.debian.org/mr/binary/<name>/" -o "<name>.json"
```

SHA-256 (recompute after any copy; the firmware suite fails on drift):

```text
9eccdbcd52fe13f0aa92ecc322904a98bb9ccaa8b0ebe93c74f0ba6186d693f9  firmware-amd-graphics.json
4ad49ee66c528eef653619bb3f3f4f50f4a4cf47f4071e773f355467d6827bc3  firmware-atheros.json
550dd179ccffa3f72d0850667c3ff7c2393572099dc7a027b6daf1b61053a9b3  firmware-brcm80211.json
009b4116f675d389465bc466a73d5ca7a96ad97bf40919f0196f5d57a33b1e75  firmware-intel-graphics.json
f43cd314b763aeba2bddf3f3cdee821474c78021a4fe6a348a46d736d8092edd  firmware-iwlwifi.json
aeb1a9c8e72ae00315977a74ed1e346fae9782d4b352a9cfb2721e37f8c81f24  firmware-mediatek.json
896d97328b86c7d42ec9b27b9a09a9e06e403694699a488a57ea8c62584f2545  firmware-realtek.json
```

Each response lists that binary's known versions, first-listed first
(`20260916-1` for every package on capture day). check-firmware's
transcript mode reads these instead of the network; the live suite
re-resolves against snapshot.debian.org where the network allows it.
