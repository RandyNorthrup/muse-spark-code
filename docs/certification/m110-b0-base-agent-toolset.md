# M110-B0 base agent toolset

Kubuntu rig, worktree `/home/randy/lanes/M110B0`, branch `m110/b0`,
base `989077534`; 2026-10-06. Model attempts: **0**. No credentials read,
no live/paid call, no sign-in, no system settings changed. The rig brief
adds D90.27 to this older plan. Only B0 code and required shared records
are changed; container deployment, OS boot wiring and help surfaces remain
with their named owners.

## Portable bundled skills

The copy/link installer moved from `src/host/skills/` to
`src/core/context/bundledSkillsInstall.ts`. The existing lazy bundle and
VS Code offer/commands still use it. Node/native/editor adapters can bind
the same filesystem implementation without importing VS Code. The Model
API continues to read the vendored package as source `bundled`; project
and personal skills keep their existing precedence.

Before a staged copy is published, every file must match VENDOR.json's
SHA-256 and exact file set. Unsafe, traversal and case-aliased paths fail
before writes; unlisted, missing or changed files cannot replace a working
copy. Existing user-owned skills and unmarked copies are preserved.

| Control                               | Threat rows | Red drill / failed test                                                                             |
| ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| Staged file integrity/exact inventory | H17         | B0-SKILLS-INTEGRITY: remove verification; changed/extra/missing release-byte tests fail             |
| Missing-file refusal                  | H17         | B0-SKILLS-MISSING: disable remaining-file check; missing release-byte test fails                    |
| Case-aliased duplicate refusal        | H10/H17     | B0-SKILLS-PATH: disable duplicate check; README.md/readme.md test fails                             |
| Traversal/trailing-dot refusal        | H10/H17     | B0-SKILLS-TRAVERSAL: disable segment check; ../outside, skills/../outside and README.md. tests fail |

All four runs exited 1 and restored the original source byte-exact:
`fad4677b7b7793587c8545cb5751c5525eefb40da25e09a7516500a0ad43a3fc`.
Full test names and hashes: `m110-b0-skills-drills.json`.

Verification: `npx vitest run test/unit/bundledSkillsInstall.test.ts
test/unit/bundledSkillsVendor.test.ts test/unit/skills.test.ts --maxWorkers=3`
passed **167 tests**, using repository-default timeouts. Host typecheck
passed. No new dependency, user-visible string, command or setting in this
piece. The split guard now names the portable installer's real path.

## Named integration handoffs

- **B0-C-TOOLSET:** C composes the verified toolset layer with its service
  runtime and two-user ownership/permissions; it owns final image signing,
  SBOM, provenance, notices, vulnerability/layer scans and image publication.
- **B0-W-OS1-TOOLSET:** W and OS1 reuse the same toolset for the default
  sandbox. Compilers never enter the OS host. This layer grants no egress,
  mounts, service identity, credentials or approvals.
- **B0-N-SKILLS:** boot binds the portable installer's filesystem paths to
  the tools user's chosen config home and immutable vendored package. It
  must not use or inspect a CLI sign-in home to infer consent (H18).
- **B0-U2-HELP:** no `src/shared/featureCatalog.ts`, reference generator or
  check:reference script exists on this base. Integrate the base toolset,
  bundled workflow skills, existing Install/Remove Bundled Skills commands,
  and first-boot automation-runtime preparation into `/help` when the help
  registry arrives. Do not add a second slash-command implementation here.

Full image/OS/editor support still requires the lead's integrated quality
run and the accepted table's platform receipts. The common brief delegates
`npm run quality` to the lead; this lane runs scoped checks directly here.

## First-boot and Linux ARM64 runtime preparation

`createBaseAgentToolset` is exported by the existing lazy bundled-skills
entry. It supplies the portable `bundled` source and first-party root and
performs only explicitly requested preparation. Both enhancements default on;
explicit false is read afresh each time. N/OS3 inject M81's actual
`prepareRuntime`, `RuntimePrepareRequest`, lifetime/admission and consent
surface. No second downloader, browser launch, CLI install or sign-in is added.

The Chrome for Testing 154.0.8037.92 Linux ARM64 archive was downloaded on
this rig from its exact storage.googleapis.com URL. Its 121,182,296 bytes
hash to `0ed0e47d9e9f639197f508d62ada09e5c6b4c4c60edab3160a9312a733091df6`;
287 entries expand to 279,456,406 bytes. The executable is 190,385,552 bytes,
SHA-256 `8ef1e673b0083695a65e383dedf07fca9ecc1cffebf02b92c0059eb3879d8a9e`.
The existing M81 store validates the pin, download, entries and executable.
Legacy manifests without this optional platform refuse before consent or
download. Native Linux ARM64 browser execution remains an integration
receipt, not a claim based on this amd64 rig. No model attempts.

Capture command (archive retained under gitignored temp):

```sh
curl --fail --location --output temp/m110-b0/chrome-headless-shell-linux-arm64.zip https://storage.googleapis.com/chrome-for-testing-public/154.0.8037.92/linux-arm64/chrome-headless-shell-linux-arm64.zip
sha256sum temp/m110-b0/chrome-headless-shell-linux-arm64.zip
```

| Control                                      | Threat rows | Red drill / failed test                                                                        |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| ARM64 platform uses its own pin              | H17         | B0-ARM-PLATFORM; platform mapping and ARM64 store preparation                                  |
| Missing ARM64 pin refuses before work        | H09/H17     | B0-ARM-MISSING-PIN; older pin refusal                                                          |
| Default-on skills/browser and explicit false | H12/H18     | B0-SKILLS-DEFAULT/OFF and B0-BROWSER-DEFAULT/OFF; default and explicit-false preparation tests |
| No Muse Code paths means no CLI installation | H17/H18     | B0-MUSE-OPTIONAL; no-CLI default preparation                                                   |
| Chosen platform determines package roots     | H10         | B0-PORTABLE-ROOT; exact Windows package paths                                                  |

All eight mutations exited 1, with named assertion failures and byte-exact
restoration; see `m110-b0-browser-boot-drills.json`. The initial Windows
assertion normalized separators and could not detect use of the wrong path
implementation; it was strengthened to require native Windows paths before
the successful red run. Final scoped run: runtimeManifest, runtimeStore and
baseAgentToolset, **31 tests passed** at default timeout. Localization gate:
14 language tables, zero problems; only an existing platform-description
key changes, so no manifest key is added.

**B0-N-OS3-BOOT:** bind this factory after settings/consent are available,
with packageRoot `/usr/local/share/muse-toolset` in the toolset layer and
per-tools-user storage. Load `dist/bundledSkills.js` and
`dist/browserRuntime.js` through the installed package's lazy factories.
Include those bundles and both skill asset trees in the node/native package;
the current standalone ACP packager does not include them. Respect H17/H18
before passing Muse Code install paths. No backend-specific model support
is required; this filesystem/runtime preparation is shared by all editors.

## Pinned offline toolset layer

`deploy/toolset/base.json` contains every required tool's exact version,
source URL, SHA-256 and byte length, plus the complete Debian dependency
closure and architecture-specific Debian image digests. The fifteen tools
are git, gh, Node 24, Python 3 with uv, ripgrep, fd, jq, curl, unzip,
build-essential, clang, make, cmake and gitleaks. There is no new npm
package. The amd64/arm64 records contain 163/162 artifacts (158/157 Debian
packages, three upstream archives, two uv licenses). The complete exact
inventory is the manifest; the observed versions are in
`m110-b0-toolset-amd64-smoke.json` and `deploy/toolset/README.md`.

The Debian image index is
`sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f`;
amd64/arm64 child digests are
`918311b7b6c4c6f68b232ba516584925f6c78ad82b6fd534b98979df6438e483` and
`a2ca65377c251208de42e1a2722cb949211236c161b634f6f3663754e2d06850`.
Authenticated apt metadata in those exact Debian images selected the Debian
package versions and lengths. Package-manager download-only capture used an
empty status database to include the full dependency closure; this ran only
inside disposable containers. Publisher checksum files independently matched
Node 24.21.0, uv 0.12.23 and gitleaks 8.30.1. Exact tagged uv MIT/Apache
licenses are separately pinned; other package/archive notices are retained.

**Every final source URL was then downloaded directly over HTTPS on this
rig by the production staging command, with every length and hash verified:**

```sh
node scripts/stage-node-toolset.mjs amd64 temp/m110-b0/download-amd64
node scripts/stage-node-toolset.mjs arm64 temp/m110-b0/download-arm64
```

Results: **294,982,776** verified amd64 bytes and **272,742,885** arm64 bytes.
Original URI/capture/download/build logs and downloaded archives are under
`temp/m110-b0/`; no binaries or test images are committed. Both architectures
also staged successfully from independently verified cached downloads.
HTTP length validation initially rejected content-encoded GitHub text;
requesting `Accept-Encoding: identity` made the header describe the pinned
bytes, without relaxing any integrity/length check.

The installer runs only in the image, hashes the entire pack before any dpkg
or tar call, and installs offline. Read-only artifact mounts come from a
throwaway stage; archives do not occupy shipped layers. Every runtime target
drops to UID/GID 10001, with root-owned binaries, manifest and skill assets.
No service user, listener, socket, egress grant, CLI, key or approval is added.
C owns the two named identities and service/tool separation; W/OS1 own the
workspace sandbox. No compilers enter the OS host.

A follow-up ownership probe found Node/uv/gitleaks still carried their
publishers' UIDs (1001/1001/501); a read-only-root access check alone did
not prove root ownership. The installer now uses tar's no-same-owner and
no-same-permissions flags and removes group/world write from `/usr/local`.
The smoke asserts UID 0 and safe modes on all three binaries, manifest
and first-party skill. Both new guards were broken and failed their named
assertions, then restored byte-exact.

The final amd64 base and compiler images built with `--network none`.
The real build-pack smoke ran offline with a read-only root, no capabilities,
no-new-privileges and an executable `/tmp` scratch mount. It confirmed every
tool's version, GCC/Clang compile-and-execute, CMake build-and-execute, uv's
local no-download Python venv, local git, 46 exact vendor hashes, first-party
skills, and installed-file non-writability as UID 10001. The uv cache is placed
in the writable scratch folder; production C must provide a writable tools
home. An exploratory noexec scratch mount correctly refused execution, and
an exploratory read-only home correctly refused uv's default cache.

A separate real-image tamper run mounted a changed Node archive with the
original expected hash. The actual installer exited 1 at `sha256sum`:
`node.tar.gz: FAILED`, before dpkg or tar could run. The guard also has a
source mutation and named failing unit assertion below.

## Measured image budgets

Docker-save receipts contain the actual compressed layer sizes (raw layer
exports are measured by deterministic streaming gzip; no files are extracted
or executed). Receipts: `m110-b0-base-amd64-size.json` and
`m110-b0-build-amd64-size.json`.

| Pack                        | Measured amd64 compressed bytes |      Budget | Status                       |
| --------------------------- | ------------------------------: | ----------: | ---------------------------- |
| base                        |                     181,489,585 | 200,000,000 | passes existing cap          |
| build (base plus compilers) |                     388,029,252 | 450,000,000 | passes new separate pack cap |

The new build budget is measured +15%, rounded up to 25 MB (D90.4 reports
packs separately). The existing base cap is unchanged and hardcoded in the
measurement gate: a supplied budget cannot enlarge it. C must remeasure
its composed service base; only 18,510,415 bytes remain here. ARM64 artifact
verification is complete, but native ARM64 build/smoke/size receipts remain
**B0-C-OS1-ARM64**, per the plan's native-runner rule; no QEMU result is
substituted. Linux ARM64/Apple silicon browser execution likewise remains
an integrated M81/platform receipt.

## Toolset control-to-threat mapping and red evidence

Each mutation runs a complete owned test file with repository-default
timeouts, records its named assertion failure and restores the source
byte-exact. Full failure names and restored SHA-256 values are recorded in
`m110-b0-toolset-drills.json`.

| Control                                                                                                     | Threat rows | Red drill IDs                                                       |
| ----------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| Strict boundary schema, required tools, exact filenames, duplicate package/case aliases, trailing dots      | H10/H17     | B0-PINS-SCHEMA/STRICT/TOOLS/FILE/ALIASES/PACKAGES/TRAILING-DOT      |
| HTTPS origin, no URL credentials, fragments, unsigned query or latest/current                               | H10/H17     | B0-PINS-ORIGIN/CREDENTIALS/FRAGMENT/QUERY/LATEST                    |
| Only known archives, Node 24, each tool in its declared pack                                                | H17         | B0-PINS-ARCHIVE/NODE24/PACK                                         |
| Cached length/hash and verified private staging copies                                                      | H10/H17     | B0-CACHE-LENGTH/HASH; B0-STAGE-VERIFY                               |
| Manual redirects, destination, status, exact header/body length, streamed cap, digest and identity encoding | H09/H17     | B0-TRANSFER-REDIRECTS/LOCATION/STATUS/HEADER/CAP/INTEGRITY/IDENTITY |
| Partial cleanup, unsupported arch refusal, new directory only, fresh-stage cleanup                          | H09/H10     | B0-TRANSFER-CLEANUP; B0-STAGE-ARCHITECTURE/NEW-DIR/CLEANUP          |
| Root-owned archive extraction and non-group/world-writable installed files                                  | H11/H17     | B0-INSTALL-OWNER/MODES                                              |
| Digest-pinned image, non-root runtime, discarded artifact binds, hash before install                        | H11/H17     | B0-IMAGE-DIGEST/NONROOT/BIND; B0-INSTALL-HASH                       |
| Compressed budget and fixed existing base cap                                                               | H09         | B0-SIZE-CAP/BASE-CAP/PACK/BUDGET                                    |
| Exported image manifest, arch, path, layers and content checks                                              | H09/H10/H17 | B0-SIZE-MANIFEST/ARCH/PATH/LAYERS/IMAGES/CONFIG/LAYER               |

Container controls additionally have the real offline build, unprivileged
smoke and archive-tamper evidence above. These receipts prove this toolset
layer, not C's final service isolation, registry provenance or OS hardening.
The layer requires C's SBOM/notices/licensing/vulnerability scan and signed
publication; none is claimed complete by B0.

**B0-C-OS1-BROWSER-DEPS:** M81 preparation verifies and publishes bytes; it
does not launch the browser. The final automation sandbox must supply the
pinned headless shell's system libraries and prove process execution on each
native architecture. The ARM64 archive's executable was inspected with
`readelf -d` on this rig; that ELF inspection is not an execution receipt.
Do not equate a prepared runtime with a qualified browser sandbox.

## Final scoped verification

Kubuntu: all five typecheck projects passed. Changed-file ESLint passed;
plain knip passed (only pre-existing configuration hints); jscpd found zero
clones; localization reports 14 tables and zero problems. Production build
passes every existing budget and split check: extension 437.0 KiB / 600,
Model API 447.0 KiB / 475, bundledSkills 16.7 KiB / 50, browserRuntime
20.2 KiB / 50. No cap, rule, timeout, coverage threshold or ignore changed.

The host-API check exits 1 for the **same eleven stale J-owned Node-import
counts already documented by N** (`m110-n-node-service.md`, final scoped
verification). Its 332 VS Code APIs, 31 importing files and 61 theme variables
are unchanged. B0 adds no VS Code dependency or API. **B0-J-HOST-API:** J
regenerates/reviews that record after integration; B0 does not edit J's file.
The absence of the help registry is separately recorded above. Lead still
runs full quality and platform gates after bindings are integrated.

Final guard receipts comprise four portable-skills mutations, eight
first-boot/browser mutations and 46 staging/image/size mutations: **58 red
drills**, each a named assertion failure followed by byte-exact restoration.
No model attempts, paid/live calls, global install, credential read, machine
setting change, push, merge or rebase. Docker/shellcheck were already
installed on the rig; Docker images and caches remain private scratch.

Final unit runs (repository default timeout, each at most three files):

- bundledSkillsInstall, bundledSkillsVendor, skills: **167 passed**;
- runtimeManifest, runtimeStore, baseAgentToolset: **31 passed**;
- nodeToolset, nodeToolsetSize: **56 passed**.

Total: **254 tests passed**, no skips/filtering/timeout override. Final
real-image smoke passed after the ownership correction, and both refreshed
compressed receipts pass their unchanged base/new measured pack budgets.
Both local commits before this layer ran the repository's hooks and found
no staged secrets; the toolset commit uses the same unmodified hooks.

## RVM110B0 review repair

FIXM110B0 on Kubuntu, 2026-10-06, starting at `962a870f6`. Both review
findings are fixed; no P1 was reported and no P2/P3 review residual is left.
The existing native ARM64, composed-image, signing/SBOM/scans and boot/help
integration handoffs above still apply. No dependency, model call, credential
read or machine setting change; no weakened guard, timeout, budget or hook.

| Finding                                               | Result and threat binding                                                                                                                                                                                                                                      | Regression                                                                                                                                                                                                              | Red drill                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P2 unlisted Debian packages reach dpkg                | Fixed, H17: staging derives image-owned checksums from the pinned manifest, outside the artifact mounts. Hash every entry before any dpkg-deb/dpkg/tar call; dispatch only the listed Debian paths, including the exact Python pair, without package globs.    | `nodeToolsetInstall.test.mjs`: installs only manifest-named debs in base/build; keeps manifest pins when the artifact list is rewritten; refuses changed bytes before package inspection.                               | B0-RV-INSTALL-ORIGINAL, B0-RV-PIN-SOURCE, B0-RV-PIN-DISPATCH, B0-RV-PIN-HASH |
| P2 late staging failures retain an incomplete context | Fixed, H09: the existing fresh-directory cleanup now covers Containerfile, installer and both skill trees. Errors propagate, the incomplete context is removed, and a retry builds the complete context. Existing contexts and cached inputs remain untouched. | `nodeToolset.test.mjs`: cleans a failed Containerfile/install.sh/vendor/first-party-skills copy and permits retry. Each fake performs the real copy before raising ENOSPC, proving cleanup of partially written assets. | B0-RV-STAGE-CLEANUP                                                          |

Additional guard drills: B0-RV-PYTHON-PINS removes the required Python-pair
check; B0-RV-PIN-PUBLISH omits the staged image inventory; B0-RV-PIN-IMAGE
omits its Containerfile COPY. Each fails its corresponding named assertion.
All **eight** complete-file red runs exit 1 at the repository's default
timeout. Every mutated source is restored byte-exact and compared by SHA-256;
commands, full failing test names and before/restoration hashes are in
[`m110-b0-review-drills.json`](m110-b0-review-drills.json). The original
installer itself was replayed and failed the new package-dispatch assertions.
Before moving asset copies into the cleanup scope, all four new copy-failure
regressions failed because staging reported success instead of the copy error.

Final owned run, no skips, filters or timeout override:

```sh
npx vitest run test/unit/nodeToolset.test.mjs test/unit/nodeToolsetInstall.test.mjs test/unit/nodeToolsetSize.test.mjs --maxWorkers=3
```

**65 tests pass**. Scoped ESLint and installer ShellCheck pass. The staging
CLI also successfully copied and reverified **294,982,776** amd64 bytes from
the existing private verified cache into a fresh complete context; ARM64
likewise reverified **272,742,885** bytes. Neither used network access
(`temp/m110-b0-review-stage-amd64.log`, `temp/m110-b0-review-stage-arm64.log`).
No host tools were installed. All five typecheck projects pass; localization
still reports 14 tables and zero problems. The host-API gate reproduces exactly
the eleven inherited J-owned stale Node-import counts documented above,
with unchanged VS Code API/importing-file/theme counts (332/31/61).

The repaired size receipts (`m110-b0-review-base-amd64-size.json`,
`m110-b0-review-build-amd64-size.json`) record rebuilt images with fresh layer
digests, including the new 7,847-byte checksums layer, at 181,502,964 and
388,041,749 compressed bytes against the unchanged 200,000,000/450,000,000
budgets. The `--network none` build logs remain private under
`temp/m110-b0-review-*.log`. The re-smoke of the repaired images (the
compiler/tool/skill/ownership run as UID 10001) cited the same removed file,
so it is likewise unreceipted and falls under the open item below.

**Correction (RVF110B0 P2):** no tamper-build receipt was captured. The file
previously cited here, `m110-b0-review-amd64-smoke.json`, was byte-identical
to the pre-repair `m110-b0-toolset-amd64-smoke.json` (SHA-256
`5c2bd242e39283b4452cf69b648cb3f8e0f5cc11c608053ab6267eacbf8a26f4`) and
recorded only tool versions and boolean flags: no build command, image id,
`unlisted.deb`, checksum rewrite or dpkg call. It has been removed, and the
claim that a real `--network none` image build ignored an invalid
`debs/unlisted.deb` is withdrawn. The unlisted-deb case is covered by the
unit/script tests that actually exercise it, in
`test/unit/nodeToolsetInstall.test.mjs` (5 passed at the repository default
timeout): `installs only manifest-named debs in the base pack` and `in the
build pack` (the fixture plants `debs/unlisted.deb` in the artifact pack and
the installer dispatches only manifest-named debs);
`keeps manifest pins when an artifact pack rewrites its checksum list` (the
planted file's real SHA-256 is appended to the pack's diagnostic `SHA256SUMS`
while the image-owned inventory is unchanged, and the planted file is still
not installed); and `refuses changed pinned deb bytes before any package
inspection or installation` (the dpkg and dpkg-deb call logs stay empty).
Red drills B0-RV-INSTALL-ORIGINAL, B0-RV-PIN-SOURCE, B0-RV-PIN-DISPATCH and
B0-RV-PIN-HASH in [`m110-b0-review-drills.json`](m110-b0-review-drills.json)
record those assertions failing against the pre-repair glob installer and
being restored byte-exact.

**OPEN qualification item (B0-TAMPER-SMOKE):** the real offline image-build
tamper smoke has not been run. On a rig with Docker, stage a fresh context,
plant an invalid `debs/unlisted.deb` in **both** artifact packs, append its
real SHA-256 to each pack's diagnostic `SHA256SUMS` (leaving the staged
image-owned inventories unchanged), then run the exact README commands:

```sh
sudo -n docker build --platform linux/amd64 --network none --target base -f temp/m110-b0-tamper/image-amd64/Containerfile -t muse-toolset-b0-tamper:base temp/m110-b0-tamper/image-amd64
sudo -n docker build --platform linux/amd64 --network none --target build -f temp/m110-b0-tamper/image-amd64/Containerfile -t muse-toolset-b0-tamper:build temp/m110-b0-tamper/image-amd64
```

The new receipt must contain the exact build commands, both image ids, the
planted file name, its SHA-256, and the dpkg selection evidence (the
installer's dispatched-package list showing only manifest-named debs reached
dpkg-deb/dpkg), plus the re-smoke output (`test/fixtures/toolset/smoke.py`
per the README run command). Until that receipt exists, no real-image tamper
or repaired-image smoke claim stands.

The actual saved images were measured by the unchanged compressed-layer gate:

| Pack  | Repaired compressed bytes | Unchanged budget | Receipt                                |
| ----- | ------------------------: | ---------------: | -------------------------------------- |
| base  |               181,502,964 |      200,000,000 | `m110-b0-review-base-amd64-size.json`  |
| build |               388,041,749 |      450,000,000 | `m110-b0-review-build-amd64-size.json` |

Exact private contexts/images and full build logs remain under `temp/m110-b0/`
and `temp/m110-b0-review-*.log`. Native ARM64 build/smoke/size qualification
remains B0-C-OS1-ARM64; staging ARM64 bytes is not execution evidence.

Remaining scoped checks passed: plain knip (only its two inherited config
hints), jscpd (zero clones), changed-file Prettier and production build.
Production sizes remain extension **437.0 KiB / 600**, Model API
**447.0 KiB / 475**, bundledSkills **16.7 KiB / 50**, browserRuntime
**20.2 KiB / 50**; split, host-global and third-party-notice checks pass.
The only failing scoped check is the inherited B0-J-HOST-API snapshot noted
above. Full quality/coverage/platform gates remain delegated to the lead by
the rig/common brief. The repair commit `60bf4ad18` ran both unchanged hooks;
lint-staged passed and gitleaks found no staged secrets. No push, merge or
rebase was performed.
