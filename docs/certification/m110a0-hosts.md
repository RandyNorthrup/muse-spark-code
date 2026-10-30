# M110 A0 install/host beats (S0 proof)

Lane RLM110A0, rig `macmini`, 2026-10-22/23. The LAN profile proves on the
packaged CLI (`dist/node.js`) and the ACP agent (`dist/acp.js node`), and
its installer proves in committed tests that run the real POSIX tools.
Everything below names what ran where; open runbooks carry exact commands
for the hosts this rig cannot reach.

## Proven on macmini

Data roots lived under `$TMPDIR` (`m110-s0-proof`, `m110-s0-acp`,
`m110-s0-stale`), each created fresh and checked on disk after.

| Beat              | Command                                                             | Result                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI help          | `node dist/node.js --help`                                          | exit 2 with usage lines                                                                                                                                                                                                            |
| CLI init          | `node dist/node.js init --label Home --name home.local -w <ws>`     | exit 0: title, one-time code, expiry, LAN-only note                                                                                                                                                                                |
| CLI status        | `node dist/node.js status -d <root>`                                | exit 0: id, `running:false`, sealed key store (stopped node answers locally)                                                                                                                                                       |
| CLI serve         | `node dist/node.js serve -d <root>`                                 | exit 1 with `The node feature is unavailable.`                                                                                                                                                                                     |
| CLI wipe, no flag | `node dist/node.js wipe -d <root>`                                  | exit 1 with `Wiping requires --confirm-wipe.`; both directories still on disk                                                                                                                                                      |
| CLI wipe          | `node dist/node.js wipe --confirm-wipe -d <root>`                   | exit 0; state root and workspace both gone                                                                                                                                                                                         |
| ACP init          | `node dist/acp.js node init --agent-id home --label Home -d <root>` | exit 0, status `complete` with the one-time code                                                                                                                                                                                   |
| ACP status        | `node dist/acp.js node status -d <root>`                            | exit 0 after TTL expiry quiesces (poll with `--ttl 0`)                                                                                                                                                                             |
| ACP wipe, no flag | `node dist/acp.js node wipe -d <root>`                              | exit 1, refuse `confirmWipe`                                                                                                                                                                                                       |
| ACP wipe          | `node dist/acp.js node wipe --confirm-wipe -d <root>`               | status `complete`, directories gone                                                                                                                                                                                                |
| Stale lock        | plant `service.lock`, wipe                                          | exit 1 `running`; `rm service.lock`; wipe exit 0, directories gone                                                                                                                                                                 |
| Installer tests   | `npx vitest run test/unit/nodeInstall.test.mjs`                     | 8/8: real `sha256sum`, `chmod`, `getent`/`id`, PATH-found `gh`; layout modes/content, no-toolhost content, missing members refused, arg checks, verify-arg forms, tamper/unlisted/missing-tools refused, gh rejection fails closed |
| Linux runs in CI  | hosted workflow on Ubuntu                                           | installer tests pass on Linux in CI (the lane's gate evidence)                                                                                                                                                                     |

Wipe semantics proven through the packaged CLI, not doubles: the guard
(no flag), the guard (running node), then lock-hold, key-slot destroy,
identity destroy, state-root and workspace removal.

## Open runbooks

### Full install on a Linux PC

```sh
curl -fSLO "https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/muse-spark-code-acp-<version>.tgz"
curl -fSLO "https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/SHA256SUMS"
sudo sh install.sh --tarball muse-spark-code-acp-<version>.tgz --sums SHA256SUMS
sudo systemctl enable --now muse-node.service muse-node-toolhost.service
systemctl status muse-node.service --no-pager
sudo -u muse-node node /opt/muse/dist/node.js status --data-root /var/lib/muse-spark-code-node
```

Pass: users 10001/10002 and group 10003 exist, `/opt/muse/dist/node.js` and
the checksums verify, units enabled, status answers `running:false` sealed.
Blocked here: needs a real Linux PC (no Linux VM on this rig).

### Attestation success path

```sh
gh attestation verify muse-spark-code-acp-<version>.tgz --repo RandyNorthrup/muse-spark-code
```

Pass: `gh` verifies the release attestation for the exact tarball.
Blocked here: `gh` network use was denied in this session.

### Docker Desktop on macOS

```sh
export MUSE_NODE_BIND_ADDRESS="<Mac LAN address>"
export MUSE_NODE_IMAGE="ghcr.io/randynorthrup/muse-spark-code-node@sha256:<digest>"
sh deploy/compose/docker-run.sh
docker exec muse-spark-code-node node /opt/muse/dist/node.js init --label Home --name home.local --workspace-root /workspaces
docker exec muse-spark-code-node node /opt/muse/dist/node.js status
```

Pass: no wildcard publish, macOS firewall prompt names Docker, init/status
answer as proven above. Blocked here: Docker Desktop's backend runs but its
socket never appeared (`/var/run/docker.sock` ENOENT; pipe
`.settings.json` writes hang), and per the sandbox rule no shim or wrapper
was built. Retry when Docker is healthy.

### Rootless Podman with the quadlet

```sh
cp deploy/systemd/*.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start muse-node.service
```

Pass: published port carries the person's chosen address from
`MUSE_NODE_BIND_ADDRESS`. Blocked here: needs Linux.

### Docker Desktop on Windows

Same `docker-run.sh` from Git Bash or WSL, LAN address from `ipconfig`,
Defender prompt allowed on private networks only. Blocked here: needs the
owner's Windows PC.

### QEMU image boots

Await a boot image from the OS lanes. Blocked here: no QEMU or Linux image
on this rig.

### Second PC with passkey join

The A1/M104 service binding has landed since (`docs/certification/rlf-nodeserve.md`);
still needs two machines. Not attempted.
