# NVIDIA add-on (M110os OS5)

NVIDIA's driver as a system-extension add-on, installed only by the
user's click under NVIDIA's license. `addon.json` is the machine-checked
manifest (`os/addons/check-addon.mjs` validates it); `fingerprints.txt`
pins NVIDIA's repository key; the shared `check-key.mjs` verifies an
install keyring against the pin.

## Trust chain (verified live 2026-10-23)

```sh
curl -sSL -o 8793F200.pub https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/8793F200.pub
curl -sSL -o InRelease https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/InRelease
gpg --batch --verify InRelease
```

Result: a good signature from `Kitmaker (Debian 13 Trixie)`, key
`02182E60104FCDC26EAE1B8597A5D4CB8793F200`, on both the `x86_64` and
`sbsa` InRelease files. The repos carry `nvidia-driver` and
`nvidia-open` 595.45.04-1 (x86_64) and 595.58.03-1 (sbsa), pinned per
architecture in the manifest.

## Flavours and MOK

GPUs of the Turing generation and newer use the open kernel modules
(`nvidia-open`); Pascal and older use the proprietary module
(`nvidia-driver`). The manifest carries both; the installer picks by
the detected GPU. The modules are signed on the device and the signing
key is enrolled through MOK (`mokutil --import`, confirmed at the
next boot), so they load under Secure Boot.

## Build (runs on the device, after OS1; D90.24 keeps licensed add-ons off CI)

1. Fetch the keyring and check it: `check-key.mjs --keyring <file>
--fingerprints fingerprints.txt`.
2. Add the APT source from `addon.json` with `signed-by` on that keyring.
3. `apt update` (the InRelease signature is verified against the keyring)
   and `apt download` the pinned packages for the target architecture.
4. Unpack the packages into the extension tree, stamp the
   extension-release file from the manifest's `osRelease`, sign the
   kernel modules, and ship the `nvidia_<version>_<arch>.raw` sysext
   with its verity hash (OS6 records the roothash at publish).

## Install

The first-boot setup and the dashboard offer the NVIDIA driver with
the license linked. The install runs only after the user's click;
without it the node has no NVIDIA driver and says so.
