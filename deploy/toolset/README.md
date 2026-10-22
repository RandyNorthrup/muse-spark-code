# Base agent toolset (Unofficial)

This is M110-B0's reusable offline toolset layer. C owns the final node
image, users, signing and deployment; W/OS1 own the default workspace
sandbox. This layer opens no listener, installs no Muse Code CLI and
holds no credential. Native ARM64 execution remains unqualified on this
amd64 rig. It is not a complete deployable node.

`base.json` pins the Debian image index and architecture digests, every
required tool and its complete Debian dependency closure, including source
URL, exact package/release version, length and SHA-256 for both architectures.
The download commands below fetched and verified all 163 amd64 and 162 arm64
artifacts on Kubuntu. Node/uv/gitleaks additionally matched their publishers'
release checksum lists; Debian metadata was authenticated by apt in the
pinned Debian image. No host package manager installs these tools.

| Tool                          | Version observed on amd64    | Pack  |
| ----------------------------- | ---------------------------- | ----- |
| git                           | 2.47.3                       | base  |
| gh                            | 2.46.0-3 (Debian)            | base  |
| Node                          | 24.21.0                      | base  |
| Python                        | 3.13.5                       | base  |
| uv                            | 0.12.23                      | base  |
| ripgrep                       | 14.1.1                       | base  |
| fd (`fdfind` with `fd` alias) | 10.2.0                       | base  |
| jq                            | 1.7 / Debian 1.7.1-6+deb13u4 | base  |
| curl                          | 8.14.1                       | base  |
| unzip                         | 6.0                          | base  |
| build-essential               | 12.12                        | build |
| clang                         | 19.1.7                       | build |
| make                          | 4.4.1                        | build |
| cmake                         | 3.31.6                       | build |
| gitleaks                      | 8.30.1                       | base  |

Run from the repository root, using new build-context directories. Staging
refuses an existing context, unpinned source/redirect, excess length or hash
mismatch, and deletes only the fresh incomplete context on failure, including
failures copying the installer, build recipe or either bundled skill tree. It may
also accept a third argument naming a downloaded cache; it copies and verifies
every artifact before building. A cache never becomes a live build mount.

```sh
node scripts/stage-node-toolset.mjs amd64 temp/m110-b0/download-amd64
node scripts/stage-node-toolset.mjs arm64 temp/m110-b0/download-arm64
```

The layer is built without network access. Artifacts are read-only bind mounts
from a discarded stage; their compressed archives do not remain in shipped
layers. Staging derives per-pack checksum inventories from `base.json` and
copies them into the image outside the artifact mounts. The installer hashes
every inventory entry before dpkg-deb, dpkg or tar runs, then installs only the
named Debian packages, including the exact Python pair. Extra `.deb` files and
changes to a pack's diagnostic `SHA256SUMS` cannot add an installable package.
Installed binaries, manifest and bundled assets are root-owned. Both targets finish as
UID/GID 10001; C supplies its named tools user and separate service identity.
The `build` target includes all compilers; compilers belong in the sandbox,
never in the OS host. The base and build targets retain all available package
notices, Node's archive notices and pinned uv/gitleaks licenses.

Commands successfully run on this rig (the cached context contains the same
verified bytes as the direct-download context):

```sh
sudo -n docker build --platform linux/amd64 --network none --target base -f temp/m110-b0/image-amd64/Containerfile -t muse-toolset-b0:base temp/m110-b0/image-amd64
sudo -n docker build --platform linux/amd64 --network none --target build -f temp/m110-b0/image-amd64/Containerfile -t muse-toolset-b0:build temp/m110-b0/image-amd64
sudo -n docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,exec,nosuid,nodev -i muse-toolset-b0:build python3 - < test/fixtures/toolset/smoke.py
sudo -n docker save muse-toolset-b0:base > temp/m110-b0/base-amd64.tar
sudo -n docker save muse-toolset-b0:build > temp/m110-b0/build-amd64.tar
python3 scripts/measure-node-toolset.py temp/m110-b0/base-amd64.tar base deploy/toolset/budgets.json
python3 scripts/measure-node-toolset.py temp/m110-b0/build-amd64.tar build deploy/toolset/budgets.json
```

`measure-node-toolset.py` reads Docker's exported manifest and measures
compressed layers without extracting or executing them. Base is hard-capped
at the existing 200,000,000 bytes, even if a caller supplies a larger cap.
The separate new build budget is 450,000,000 bytes (measured 388,029,252,
plus 15%, rounded up to 25 MB). The measured base is 181,489,585 bytes.
C must remeasure its composed service base under the existing cap; native
arm64 must build, smoke and measure on an arm64 runner before release.

The assets live at `/usr/local/share/muse-toolset/vendor/` and
`/usr/local/share/muse-toolset/first-party-skills/`. The existing lazy
`dist/bundledSkills.js` exports `createBaseAgentToolset`: inject the settings
readers, package root, optional qualified Muse Code install paths and M81's
actual lazy `prepareRuntime`/request/consent. Settings default on and explicit
false stays off. Its source is `bundled`, with ordinary project/personal
precedence. Chrome for Testing is prepared through M81's store, separate
from the user's browser, after download consent. Paid/model consent is
unchanged and no model call occurs here.

`/help` integration entries (B0-U2-HELP, registry absent on this base): the
15 tools and base/build selection; bundled workflow skills and their
Install/Remove commands; default-on first-boot preparation and explicit-off
settings; verified automation-runtime consent, supported pins and refusals.
There are no new slash commands or public settings in this layer.

Evidence and named integration bindings are in
[the B0 certification](../../docs/certification/m110-b0-base-agent-toolset.md).
