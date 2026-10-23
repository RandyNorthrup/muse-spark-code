# NVIDIA CUDA Debian 13 repository key (recorded)

Captured 2026-10-23 on linuxlt with:

```sh
curl -sSL -o 8793F200.pub https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/8793F200.pub
gpg --batch --import 8793F200.pub
gpg --batch --list-keys --with-colons > colons.txt
```

SHA-256: `09edb5196bca272c091633d4e04dd6c8f3a07278834868220aa669c895f6cfd7` —
recompute after any copy; the check-key suite fails on drift.

Primary (pinned in `os/addons/nvidia/fingerprints.txt`):

```text
02182E60104FCDC26EAE1B8597A5D4CB8793F200
Kitmaker (Debian 13 Trixie) <kitmaker@nvidia.com>
```

Verified the same day: the `x86_64` and `sbsa` InRelease files from
`https://developer.download.nvidia.com/compute/cuda/repos/debian13/`
both carry a good signature from this key. The repos carry
`nvidia-driver` and `nvidia-open` 595.45.04-1 (x86_64) and 595.58.03-1
(sbsa), pinned per architecture in `os/addons/nvidia/addon.json`.

Refresh: re-fetch and re-verify; a changed primary is a rotation to pin
deliberately, never to accept silently.
