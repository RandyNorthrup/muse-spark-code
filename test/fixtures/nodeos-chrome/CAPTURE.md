# Google Linux signing key (recorded)

Captured 2026-10-23 on linuxlt with:

```sh
curl -sSL -o linux_signing_key.pub https://dl.google.com/linux/linux_signing_key.pub
```

SHA-256: `54dea5f6c2a26091578cf52a999cebc6b64df478d37ad4dce96376b711e3b27cbc` —
recompute after any copy; the check-key suite fails on drift.

Primary (pinned in `os/addons/chrome/fingerprints.txt`):

```text
EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796
Google Inc. (Linux Packages Signing Authority) <linux-packages-keymaster@google.com>
```

Verified the same day: the `stable` Release from
`https://dl.google.com/linux/chrome/deb/dists/stable/` carries a good
signature from subkey `0E225917414670F4442C250DFD533C07C264648F`
(a subkey of the pinned primary) and lists `Architectures: amd64 arm64`.

Refresh: re-fetch and re-verify; a changed primary is a rotation to pin
deliberately, never to accept silently.
