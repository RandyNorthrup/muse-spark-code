# Muse Node on a home PC

The home node is one person's Muse Spark Code on their own machine: the node
holds their workspaces and serves them over the home LAN. This guide installs
it two ways: natively on Linux, or in Docker Desktop on macOS and Windows.

What the node does today: `init`, `serve`, `stop`, `status` and `wipe`
run; `lock` and `unlock` refuse explicitly until the operator control
transport lands, and the tool host unit stays inert until a release ships
its bundle. Each procedure below names its proof in
`docs/certification/m110a0-hosts.md`: steps proven on this rig say **proven**,
steps awaiting a Linux PC, Docker or the network say **lead-run**.

## Native Linux

Requirements: a Debian-family PC with systemd, Node 22 or newer and `gh`.
The installer refuses anything older or missing, loudly.

Download the release tarball and its checksums (replace `<version>` with the
release, for example `0.19.0`):

```sh
curl -fSLO "https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/muse-spark-code-acp-<version>.tgz"
curl -fSLO "https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/SHA256SUMS"
```

**Lead-run:** downloads need the network.

Fetch the installer beside them (it ships in the repository at
`deploy/install/`), then run it as root:

```sh
sudo sh install.sh \
  --tarball muse-spark-code-acp-<version>.tgz \
  --sums SHA256SUMS
```

The installer verifies the tarball's SHA-256 entry and the release's GitHub
attestation for that exact file, creates the `muse-node` (10001) and
`muse-tools` (10002) users with the shared `muse-bus` (10003) group, unpacks
to `/opt/muse`, lays out `/var/lib/muse-spark-code-node` and installs the two
units `muse-node.service` and `muse-node-toolhost.service`. It enables the
units without starting them; reinstalling over a live install is refused.
`--bundle` verifies an offline attestation bundle instead of reaching the
network. **Lead-run:** the full install needs Linux; checksums, refusals and
the `--root` layout are proven by `test/unit/nodeInstall.test.mjs`.

Initialize the node (as the service user, with the workspace directory the
installer prepared):

```sh
sudo -u muse-node node /opt/muse/dist/node.js init \
  --label Home --name home.local \
  --workspace-root /var/lib/muse-spark-code-node/workspaces
```

**Proven:** `init` prints the title, a one-time setup code with its expiry,
and the LAN-only note, and exits 0.

Open only the node's port, `8443/tcp`, and nothing else:

```sh
sudo ufw allow 8443/tcp
```

or, where firewalld runs:

```sh
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --reload
```

**Lead-run:** firewall changes need the owner's Linux PC.

Enable and start the units, then check status:

```sh
sudo systemctl enable --now muse-node.service muse-node-toolhost.service
sudo -u muse-node node /opt/muse/dist/node.js status \
  --data-root /var/lib/muse-spark-code-node
```

**Lead-run:** `systemctl` needs Linux. `status` itself is proven: a stopped
node answers its id, `running:false` and a sealed key store, exit 0.

`serve` starts when the units do: it boots the service and listens on
the interface `init` selected, printing the certificate fingerprint
([Serving](serve.md)). **Lead-run:** `systemctl` needs Linux; serve itself
is proven on the rig (`docs/certification/rlf-nodeserve.md`).

## Docker Desktop on macOS

Requirements: Docker Desktop and the verified image digest from the release
(`ghcr.io/randynorthrup/muse-spark-code-node@sha256:<digest>`; verify the
digest against the release attestation before trusting it).

Publish the node's port on the Mac's LAN address only, never a wildcard.
With the host address in `MUSE_NODE_BIND_ADDRESS` and the verified digest in
`MUSE_NODE_IMAGE`, the shipped `deploy/compose/docker-run.sh` runs the node
with its two volumes and nothing else published:

```sh
export MUSE_NODE_BIND_ADDRESS="<the Mac's LAN address>"
export MUSE_NODE_IMAGE="ghcr.io/randynorthrup/muse-spark-code-node@sha256:<digest>"
sh deploy/compose/docker-run.sh
```

**Lead-run:** Docker Desktop on this rig never produced its socket
(m110a0-hosts.md), so the container run awaits a working host.

macOS asks the first time the node listens: the prompt names Docker, not the
node. Allow LAN connections and keep the publish address a LAN address; the
node itself refuses wildcard binds. **Lead-run:** the prompt appears on first
listen, which needs the container run above.

Initialize and check the node inside the container (the data root and
workspace are the container's volumes):

```sh
docker exec muse-spark-code-node node /opt/muse/dist/node.js init \
  --label Home --name home.local --workspace-root /workspaces
docker exec muse-spark-code-node node /opt/muse/dist/node.js status
```

The CLI answers exactly as the native run: **proven** outside the container,
lead-run inside it.

## Docker Desktop on Windows

Requirements: Docker Desktop with the WSL 2 backend, and the verified image
digest as above. The container command is the same `docker-run.sh` (run it
from Git Bash or WSL with the two variables exported); find the PC's LAN
address with `ipconfig`. Windows Defender Firewall prompts on first listen:
allow private networks only. **Lead-run:** needs the owner's Windows PC.

## Wipe a home node

Wipe needs its explicit flag and removes the state root and the recorded
workspace volume together:

```sh
node /opt/muse/dist/node.js wipe --confirm-wipe --data-root /var/lib/muse-spark-code-node
```

Without `--confirm-wipe` wipe refuses and keeps every directory; on a
running node it refuses with `The node is running. Stop it before wiping.`
**Proven** through the packaged CLI and the ACP `node` subcommand alike.

A stale lock (a crash left `service.lock` behind) refuses the same way.
Recover it only after checking no node process runs, then remove the lock
file and wipe again:

```sh
pgrep -f 'dist/node.js serve' || sudo rm /var/lib/muse-spark-code-node/service.lock
```

**Proven:** the refusal, the removal and the wipe after it, exit 0 with both
directories gone from disk.

In Docker, `wipe` inside the container removes the node's data; removing the
`muse-node-state` and `muse-node-workspaces` volumes removes everything the
container kept. **Lead-run:** needs the container run above.

## Troubleshooting

| Symptom                                                  | Meaning                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `The node feature is unavailable.` on `lock` or `unlock` | The operator control transport has yet to land. Nothing is broken.                       |
| `The node is running. Stop it before wiping.`            | A supervisor holds the lock, or a crash left it stale; see above.                        |
| `toolhost bundle absent` at install                      | The release predates the tool host bundle; the toolhost unit stays inert.                |
| `attestation rejected`                                   | The tarball is not the release's: re-download both files, never `--bundle` a stranger's. |
| `already installed`                                      | Upgrades are a later lane: wipe and remove `/opt/muse` first, deliberately.              |
| `re-run as root`                                         | Users and systemd need root; `--root` stages a layout for inspection only.               |
