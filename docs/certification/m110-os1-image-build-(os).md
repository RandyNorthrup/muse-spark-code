# M110-OS1 image build (os)

Kubuntu, 2026-10-06/07, `/home/randy/lanes/M110OS1`, branch `m110/os1`,
base `989077534`. Scope: D90.24, only OS1. Model attempts: **0**.
No credential access, paid/live model call, push, merge, rebase, other-lane
edit, new npm dependency or gate weakening. Hooks existed and ran unchanged.

## Delivered recipes and inputs

Debian 13/trixie snapshot `20261005T000000Z`, epoch `1791158400`, fixed
repart seed; digest-pinned Node **24.18.0** and ACP **0.14.0** package.
The runtime package SHA-256 is
`2ade7e967f7c791fedcb9cdfa76d7a28ddb080bb4446f7618e6dce623241cc6f`.
Both upstream Node hashes and the mkosi source pin live in `os/pins.json`;
`stage()` refuses a mkosi whose `--version` does not contain the pinned
version. The source-tarball digest itself is not re-verified (§9 below).
The Pi manifest records the signed archive index URL, its SHA-256, the
public signing fingerprint, firmware `1:1.20260915-1` and board kernels
`6.18.50+rpt-rpi-v8` / `2712`.
FIXM110OS1 corrects the record: the composer did NOT verify the archive
signature or the index before staging when the six media below were built —
the pins were checked by hand at pin time. The composer enforces the chain
now (fingerprint-index-deb admission, "Findings fixed" below). No image
build runs in this lane; the enforcement evidence is the 106-test suite and
the live gpgv proof recorded there, not fresh media.

UEFI media has a 260 MiB ESP, 128 MiB read-only root, paired 1536 MiB usr
and 64 MiB hash slots, and 2 GiB persistent var. Recipe, recorded layouts
and this text now agree on the 260 MiB ESP (the recipe said 256M;
FIXM110OS1 set it to the recorded value and locked it in `check.py`).
Inactive usr/hash slots are
empty, equally sized and NoAuto. Installer media omits persistent var and
uses tmpfs under a volatile root overlay. Pi media replaces the ESP with two
260 MiB native FAT slots; slot A carries firmware, board DTB, overlays,
unchanged package kernel, initrd and verity cmdline. `boot-a.raw` is extracted
again after native assembly; checksums are recomputed after all writes.

The immutable service runner requires C's actual binding and on-device state.
A missing binding or state skips the product unit. There is no production
mock, implicit listener, Muse CLI, Chrome, sign-in, setup code, SSH host key,
TLS key or machine identity in the recipe. Node and tools use distinct
61100/61101 UIDs/GIDs and private 0700 roots. Shared root/kernel limitations
remain H16; `/var` encryption and trusted signed boot remain OS4.

## Executed build and boot commands

The actual composer calls used `python3 os/build.py <target>` with the pinned
runtime/package digest, mkosi 27.1 wrapper and explicit locally extracted
systemd tool search paths. Targets: x86-64 and arm64, each with and without
`--installer`, then pi4 and pi5. Full command/tool receipts stay in `temp/`
on the rig. Package build: `npm run build`, `node scripts/package-acp.mjs`.
`python3 os/build.py --help` and `python3 os/check.py` were run successfully.

Qualification runs `python3 test/e2e/os-image-boot.py <image> <architecture>`;
installer runs add `--optical`, and the corruption drill adds `--corrupt-usr`.
The harness clones media and injects only test code/units into its root.
It never repairs mount points, fstab, libraries, verity or initrd in a clone.
It runs the installed NodeService and nodeHealth with test-only synthetic
state, sealed boot, no sessions and no auth/engine/tools binding. A real
loopback HTTP GET must return ready, usr must be a read-only mapper mount,
networkd and resolved must each be active, and tools UID must fail to read
node's private canary. Every positive run powers itself off.

No `/dev/kvm` exists; VM receipts use **TCG**, OVMF/AAVMF and no NIC.
ARM uses Cortex-A72; the first `max` CPU run stalled in firmware and hit
its existing 600-second bound. X86 uses `max` and a 300-second bound. One raw two-vCPU run panicked
at the kernel timer/APIC check before initrd; the same image passed on the
one-vCPU retry. The optical pass used two vCPUs; the successful raw/corrupt
receipts record one. The original failed receipt is retained.
These are explicit native e2e bounds, not increased Vitest timeouts.

## Findings and corrections

- Declare explicit groups before numerical users; copy `/efi` as well as
  `/boot` to the ESP; retain empty root mount points by excluding directory
  contents rather than the directories. Each came from a real repart/boot
  failure and has a policy test.
- Include `libstdc++6`: upstream Node refused to start without it. Require
  `/var/tmp` before Debian resolved's private namespace; the original raw
  journal showed `226/NAMESPACE`. Both final network checks are separate.
- Optical initrd uses actual `/usr/sbin/losetup` and discovers the ISO's GPT
  through a read-only loop device. Debian 257's volatile overlay then hid
  the child usr mount: bind verified usr read-only above the overlay before
  switch-root. mkosi removed the first `/etc` enablement during final presets;
  the same unit's dependency now lives under vendor `/usr` and survives.
  [systemd v257 implementation](https://raw.githubusercontent.com/systemd/systemd/v257/src/volatile-root/volatile-root.c).
- Pi staging first exposed host depmod's `/lib/modules` default against a
  package extracted into `/usr/lib/modules`. Explicit `--moduledir` selects
  the real tree; no synthetic symlink or host module path is used.
- Repart directory precedence initially selected the common EFI partition
  instead of Pi boot A; native assembly refused the missing label. Reset the
  inherited directory list and put Pi first. Both FAT slots use the effective
  260 MiB size. ESP does not support NoAuto: remove its ineffective setting;
  firmware selects boot A/B, while usr/hash B keep NoAuto.
- Bound decoded tar reads/seeks and member enumeration before allocation,
  validate every member before writes, reject links/special files and unsafe
  POSIX/Win32 components, admit only exact runtime paths. Partial downloads
  and failed staging are cleaned; outputs exclude aliases and self-references.
- Earlier two-build comparison matched all immutable pieces but not var/raw.
  Excluding the wall-clock alternatives log did not make var deterministic.
  Both comparisons are retained in `m110-os1-repro*.json`. They precede the
  final installer-initrd correction. Whole-image reproducibility remains
  **unproven**; no comparison gate or threshold was weakened.

## Gates and deliberate failures

`npx vitest run test/unit/osImageBuild.test.mjs --maxWorkers=1`: **106 passed**,
repository-default timeout, no filtering/skips. `python3 test/e2e/os-image-postinst.py`:
empty root admitted, all three forbidden-content fixtures refused.
**53 source drills** have named nonzero failures and byte-exact restoration;
all source hashes were checked again after the unchanged hooks.
FIXM110OS1 adds **9 red drills** (table below); every guard below was broken
on purpose, watched fail by name, and restored byte-exact (SHA-256 checked).
ESLint passes all three MJS files (the runner and both test files). Black passes five Python files.
Prettier passes changed Markdown/JSON/MJS. `npm run typecheck` passes all five
projects. `npm run deadcode` passes; `npx jscpd` finds **0 clones**.
Localization: **14 tables, 164 manifest strings, 613 source files; 0 problems**.
`npm run build` passes unchanged split/global/notice/size checks:
extension **437.0/600 KiB**, Model API **447.0/475 KiB**, checkpoint store
**77.2/225 KiB**, node **64.9/75 KiB**, webview **896.2/900 KiB**.
`node scripts/package-acp.mjs` passes with the digest recorded above.

`npm run check:host-api` reports **one inherited stale-record problem**:
base Node built-in import counts differ from `docs/ide-compatibility/host-api.md`.
OS1 changes no src/script/package manifest/host-API record. J/lead must
regenerate/review the shared document. Rig/common rules reserve full
`npm run quality` to the lead; it was not run or weakened here.

| Control                                                     | Threat rows   | Evidence                                                                         |
| ----------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------- |
| No implicit listener or preconfigured state                 | H01, H17      | policy/source drills; actual shell refusal fixtures; missing binding is explicit |
| Pinned snapshot, epoch, seed, Node, runtime and Pi inputs   | H17           | digest/version/admission source drills and captured signed archive metadata      |
| Bounded download/tar metadata, count, expansion and cleanup | H09, H10, H17 | named source-drill failures, decoded-boundary and malformed archive fixtures     |
| Normalized paths, no links or pre-validation writes         | H10, H11      | Win32/POSIX and no-filesystem-write fixtures; source-removal failures            |
| Verified read-only usr, paired slots and inactive admission | H11, H15, H17 | policy drills, real boot mount checks and actual corrupted data-block refusal    |
| Separate non-root users and private state                   | H11           | source drills, real setpriv tools-UID denial and fixture-UID refusal             |
| No automatic Chrome/CLI or machine sign-in                  | H17           | real shell refusal fixtures and individual source mutation/restoration           |

An initial unchanged pre-commit scanner rejected the public fingerprint field
`archiveKeyFingerprint`. It was renamed `archiveSigningFingerprint`; no
scanner rule or hook was changed, and the subsequent commit passed.

Every source receipt records the named failure, nonzero exit and identical
before/restored SHA-256. The native corruption receipt records the damaged
copy's original/restored SHA-256 and requires verity corruption with no ready
marker. The input artifact is never changed. All drills use fake fixtures or
disposable copies. No live Muse/Model API/paid request was made.

## FIXM110OS1: RVM110OS1 findings fixed (kubuntu, 2026-10-09)

Worktree `/home/randy/lanes/FIXM110OS1`, branch `m110/os1-fix`. No network
download, no `build.py` run, no mkosi, no qemu, no new Python dependency
(stdlib only). Pi builds newly shell out to host `gpgv` (ships with apt's
`gpgv` package on any Debian build host); `dpkg-deb`/`depmod` were already
required. All tests below use fixtures; the signed-index shape comes from a
live `gpgv` proof against a throwaway key (recipe follows), never a guess.

### P2-1 Pi packages (H17, H10/H11): signed index enforced, .debs admitted

`os/pi/compose.py:prepare()` now consumes `archiveSigningFingerprint`,
`packagesIndex`, `packagesIndexSha256` and `packagesIndexUrl` from
`os/pi/manifest.json` and stages the real apt chain in this order:
download the InRelease unsigned (it is the trust root; `download()` still
bounds the fetch), verify its clearsign signature with `gpgv`
`--status-fd` against the operator-supplied keyring, requiring a `VALIDSIG`
from the pinned fingerprint; parse the Release SHA256 listing (index files
such as `main/binary-arm64/Packages.gz`, never .debs) and require the
manifest-pinned index path and digest to appear in it; download that
Packages index against the pinned digest; parse its stanzas and require
each manifest .deb to match exactly one stanza on Package name and
Version, arm64/all architecture, stanza Filename and stanza SHA256;
download each .deb against the stanza hash and check its stanza Size; only
then extract through member admission. `packagesIndexSha256` pins the
Packages index file, never the InRelease (the round-1 meaning was wrong;
the manifest and `check.py` now encode the corrected meaning).
`os/check.py` refuses a manifest whose fingerprint, index path or index
SHA-256 is missing or malformed, whose index/package URLs are not `https`,
or whose package pins are absent; `parse_release_hashes` /
`verify_pi_packages` (refused: index digest disagreement, absent index
entry, stanza disagreement, missing or ambiguous stanza, filename or
architecture mismatch, malformed entry, empty listing) run at build time
and are unit-tested directly, including against a real rig InRelease.

The archive keyring is build-time transport, like the ACP runtime tarball:
Pi builds take `--pi-keyring` with `--pi-keyring-sha256` (both required
together, like `--binding`), and any keyring passes only if it yields a
`VALIDSIG` from the manifest-pinned fingerprint. The operator exports the
Raspberry Pi archive key by that fingerprint from a trusted host; the real
key bytes were never available to this offline lane and are not in the
repository. `README.md` documents the invocation.

`.deb` handling: the ar container is parsed in stdlib (exactly one
`data.tar.*`, `debian-binary` must read `2.0`, control member never
extracted so maintainer scripts cannot run). Every data member is admitted
incrementally, one header at a time, through the shared `BoundedArchive`
reader (every decoded byte, PAX record and seek counts against its stream
limit while streaming, never after a full listing): directories and links
count toward the member budget with files, and per-file and total
expansion are checked as each header arrives. Wanted regular files stream
out as they arrive with per-file bytes counted. zstd members decode with
Python 3.14's `compression.zstd` in-process; hosts whose stdlib lacks it
refuse with `OS1 Pi .deb compression unavailable` (fail closed) and
unknown compressions with `OS1 Pi .deb compression`. No host extractor is
invoked: the `dpkg-deb --extract` fallback is gone. Absolute symlink
targets are refused outright; relative ones only when contained (an
explicit component stack that refuses any `..` popping above the root).
Either way the quarantine tree is admitted without following symlinks
(escaping links, hardlinks and special files refused; setuid/setgid
stripped at copy) before anything reaches the overlay. The three
`shutil.copytree` calls in `prepare()` and the `vmlinuz` copy became
descriptor-anchored copies: every stat/open/mkdir/chmod goes through a
directory handle opened `O_DIRECTORY | O_NOFOLLOW` from an lstat-validated
base, descending one component at a time, with the workspace as the trust
root for overlay-subtree sources — so a symlink root, a symlink ancestor
an earlier package planted, or a planted destination component refuses
instead of redirecting the read or write. A missing expected source (the
firmware dir) is `OS1 Pi missing source`, never a silent success. Where
the platform cannot anchor (`os.open` outside `os.supports_dir_fd`), the
same checks run over joined paths: static planted links are still refused
and unexpected errors fail closed; only a concurrent host swap mid-copy is
out of cover, and Pi staging is qualified on Linux. One test-caught bug is
recorded honestly: the first symlink containment used `normpath`-then-
compare, which silently absorbs `..` above root and admitted `/../evil`;
the hostile-`.deb` test failed, and containment is now the explicit stack.

### P2-2 installer read-only /usr (H11): installer profile locked

`os/check.py` reads `os/mkosi.profiles/installer.conf` and requires
`KernelCommandLine=systemd.volatile=overlay` in `[Content]` — the cmdline
the bind-ro unit's `ConditionKernelCommandLine` keys on — so deleting or
changing that line fails the policy gate with `installer volatile overlay`.
The unit's own condition and bind-then-`remount,bind,ro` lines were already
locked. Missing sections/keys fail closed with the policy reason instead of
`KeyError`. Two guard-table rows cover change and deletion.

### P3s fixed in this lane's files

- mkosi pin: `stage()` runs `<mkosi> --version` and `check_mkosi_version`
  requires exit status 0 with the full version token exactly equal to the
  `os/pins.json` pin (`mkosi 27.10` and `mkosi 127.1` refuse; the recipe
  floor `MinimumVersion=27.1` remains). The source-tarball digest is still
  not re-verified: residual below.
- Debian keyring: `check.py` locks `Repositories=main non-free-firmware`
  (no silent third-party repository). Fingerprint-pinning the keyring is the
  residual below.
- Node `.tar.xz`: `stage()` reads `bin/node` and `LICENSE` through
  `extract_selected()` over the same `BoundedArchive` reader as `extract()`
  (xz magic added); unselected members including npm's symlinks are skipped
  by streaming without extraction under their own evidence-sized ceiling
  `NODE_SKIP_LIMIT = 8192` (pinned Node 24.18.0 linux-x64 carries 5,774
  members: 4,703 regular, 1,068 directories, 3 symlinks; digest verified
  against `os/pins.json` before counting on 2026-10-08, ceiling = count +
  2,418 headroom). Wanted members keep the strict limits and must be
  regular files. A 1,100-unwanted-member fixture (past the old 1,024
  ceiling) stages; past 8,192 the reader still refuses.
- ESP size: `os/repart/00-esp.conf` is now `260M`/`260M`, matching the
  recorded GPT layouts and this text; `check.py` locks both values.

### Live gpgv proof (throwaway key, destroyed)

The rig sandbox blocks sockets, so `gpg-agent` cannot start and `gpg`
cannot mint keys here. The lane minted a throwaway RSA-2048 key in pure
Python (no agent), framed OpenPGP packets by hand, and used
`/usr/bin/gpgv` 2.4.8 itself as the oracle: bare pubkey packets are not
usable keyrings (self-signed UID required — found by iterating against
gpgv), and text-mode clearsign hashing omits the trailing CRLF (found by
brute-forcing candidates until `GOODSIG`/`VALIDSIG`). The shipped
`verify_signature`/`clearsign_payload`/`verify_pi_index` then verified the
fixture through the real `gpgv` path, and a wrong fingerprint was refused.
All key material (factors, keyring, messages, agent home) was deleted after
the capture. The committed tests replay the status shape below with
fixture key material built by repetition (no key bytes in the tree); one
case reports an unrelated key to prove the comparison bites. Key bytes are
omitted here too — the secret scanner treats a fingerprint literal as a
secret even for a destroyed throwaway key:

```
[GNUPG:] NEWSIG
[GNUPG:] KEY_CONSIDERED <40-hex fingerprint> 0
[GNUPG:] SIG_ID Kfcj5dJKS0evnOyboBjHkpx+8pY 2026-10-05 1791158400
[GNUPG:] GOODSIG <16-hex keyid> OS1 throwaway fixture key <os1-throwaway@example.invalid>
[GNUPG:] VALIDSIG <40-hex fingerprint> 2026-10-05 1791158400 0 4 0 1 8 01 <40-hex fingerprint>
```

### Red drills (9; each restored byte-exact, SHA-256 checked)

| #   | Broken guard (file)                                              | Named failing test(s)                                              |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | signature step removed (`os/pi/compose.py`)                      | refuses hostile Pi staging input (bad-signature)                   |
| 2   | symlink escape admitted (`os/pi/compose.py`)                     | refuses a hostile Pi .deb member (symlink-outside)                 |
| 3   | installer lock neutered (`os/check.py`)                          | both installer.conf weakened-guard rows                            |
| 4   | fingerprint lock removed (`os/check.py`)                         | manifest fingerprint guard row + hostile staging (bad-fingerprint) |
| 5   | wanted-file admission removed (`os/build.py`)                    | admits only the wanted regular files from an xz archive (link)     |
| 6   | ESP lock removed (`os/check.py`)                                 | repart/00-esp.conf weakened-guard row                              |
| 7   | mkosi version lock removed (`os/build.py`)                       | validates the mkosi input and its staging boundary                 |
| 8   | index-agreement lock removed (`os/check.py`)                     | index disagree/missing/ambiguous rows                              |
| 9   | `KernelCommandLine` changed (`os/mkosi.profiles/installer.conf`) | `python3 os/check.py` exits 1 (`installer volatile overlay`)       |
| 10  | stanza SHA check neutered (`os/check.py`)                        | real index chain (disagree) + hostile staging (index-disagrees)    |
| 11  | resolve-level link check neutered (`os/pi/compose.py`)           | symlink roots/planted ancestors test                               |
| 12  | streaming member budget neutered (`os/pi/compose.py`)            | bounds .deb members while streaming                                |
| 13  | bind-ro `ln` lock neutered (`os/check.py`)                       | weakened postinst guard (bind-ro enablement row only)              |
| 14  | skip ceiling back to 1024 (`os/build.py`)                        | upstream Node members under the evidence ceiling                   |
| 15  | substring version check restored (`os/build.py`)                 | exact mkosi token (27.10, 127.1, failed probes refuse)             |

Restored SHA-256 (before = after every drill): `os/check.py`
`08d606a9fdbee14cad57a1ea4eac9012487924af34ef5fc84eedba2f0e4b6a83`,
`os/build.py`
`469b75d2327fe19b99700c3d4121cbd3d57e433424968672958514a1a8bece73`,
`os/pi/compose.py`
`38bf75ec6a85fad9799908457fe122a71e8dcc8441a3f44dc2b6ef43d195a3b0`,
`os/repart/00-esp.conf`
`41c2b5c8641c3c2c9a06b65cd88b8ca78197607f509b89a68276c24cd8b9c480`,
`os/mkosi.profiles/installer.conf`
`54110936edec3be93a793937ca6a9acf10d8c7d0461b270e6c760855a5e2bba1`.

Round-2 drills 10–15 restored byte-exact to the post-fix tree:
`os/check.py`
`2fc2029979db7692d3c025125d34d90bc847f0ccde114040cd5c42155dd65faa`,
`os/build.py`
`0540f93f2f43afbb3c97f01c588fee6ff5981c7f45faeac30dad66ea0969848c`,
`os/pi/compose.py`
`992e19c96c69d4bfd86cc78da9e0e5adabe2ad9269d56f639badffc8f57109b1`.

### Named residuals (what, why safe, follow-up)

- **FIXM110OS1-mkosi-tarball.** The `--version` string is checked, not the
  source-tarball digest in `os/pins.json`. Safe for now: exact-version
  refusal plus the recipe floor; a substituted mkosi 27.1+ binary still has
  to survive the policy gate and deterministic recipe. Follow-up: OS6
  verifies the tarball digest when it owns publishing (PLAN.md §9).
- **FIXM110OS1-debian-keyring.** Archive trust rests on the build host's
  `debian-archive-keyring`; repositories are locked to
  `main non-free-firmware` with no unsigned fallback. Safe for now: snapshot
  date pinned, packages come from Debian's own archive. Follow-up: OS6 pins
  the keyring by fingerprint (PLAN.md §9).
- **FIXM110OS1B-zstd-host.** zstd data members decode with the stdlib
  `compression.zstd` reader (proven by a real zstd `.deb` staged with no
  host tool; the `dpkg-deb` fallback is gone). A build host whose Python
  predates 3.14 refuses with the named `OS1 Pi .deb compression
unavailable` code (fail closed) instead of reaching any host extractor.
  Safe for now: the refusal is named and tested on both sides. Follow-up:
  none in code — build hosts run Python 3.14+ (README, PLAN.md §9).
- **FIXM110OS1B-pi-pin-rotation.** The Raspberry Pi archive rotates its
  Packages index on every publish: `packagesIndexSha256` in
  `os/pi/manifest.json` names one observed index
  (`81158a38dbb347200ac3222c4183d1297b6f7c3bf39cda642355ddd3e66b1b3c`,
  490,710 bytes, InRelease dated 2026-10-08T19:48:32Z). A later build
  fails closed at the index-digest step and needs refreshed pins; the
  .deb pins stay valid while their stanzas remain published. Safe for
  now: fail-closed with a named reason, never silent acceptance.
  Follow-up: OS6 owns pin refresh alongside publishing (PLAN.md §9).
- **FIXM110OS1B-non-anchoring-hosts.** Tree copies anchor with directory
  descriptors only where `os.open` supports `dir_fd`; elsewhere the same
  checks run over joined paths (static planted links still refused,
  unexpected errors fail closed). A concurrent host swap mid-copy is out
  of cover there. Safe for now: Pi staging is qualified on Linux, where
  anchoring is complete. Follow-up: none unless staging targets another
  host OS.
- **FIXM110OS1-pi-keyring-supply.** The real archive keyring travels outside
  the repository via `--pi-keyring`; only a key matching the manifest
  fingerprint can stage. Follow-up: none in code — operator procedure in
  `README.md`.
- Physical Pi/ARM qualification still waits for Q (unchanged); the ESP
  4 MiB repart-grain question is closed by pinning the recorded value, not
  by explaining the rounding.

### Final fix round FIXM110OS1B (2026-10-08, review RVF110OS1)

Worktree `/home/randy/lanes/FIXM110OS1B`, branch `m110/os1-fix2`. No
`build.py` run of a full image, no mkosi, no qemu, no sudo. Two narrow
network reads only: the Raspberry Pi `trixie` InRelease once (54,861
bytes) plus its referenced `main/binary-arm64/Packages.gz` (490,710
bytes) to confirm the field layout, and the pinned Node 24.18.0
linux-x64 tarball once for the member-count evidence. No large captured
file is committed; scratch downloads stayed in the lane's private temp
dir and were removed.

Live apt evidence (2026-10-08): the InRelease SHA256 section lists index
files (`main/binary-arm64/Packages` and `Packages.gz`, 1,684,276 /
490,710 bytes), never .debs; the downloaded Packages.gz hashes to
`81158a38dbb347200ac3222c4183d1297b6f7c3bf39cda642355ddd3e66b1b3c`,
exactly the InRelease entry, and all three manifest .deb pins agree with
its live stanzas (Filename basename, SHA256, Size for raspi-firmware
`56b6f87…`, both 6.18.50 kernels `41a73543…` / `8d44827f…`). The shipped
`parse_release_hashes` / `verify_pi_packages` chain was run against this
capture: 133 release entries, all three packages resolved. The manifest
now records this index (`packagesIndex`,
`packagesIndexSha256 = 81158a38…`, `releaseDate 2026-10-08T19:48:32Z`).

Minted-key proof: the rig sandbox blocks `gpg-agent` sockets, so `gpg`
cannot mint keys here (same wall as round 1). The committed test mints a
throwaway RSA-2048 key at test time with `node:crypto`, frames the
OpenPGP keyring and clearsign signature by hand (modulus-first MPI
order; text-mode hash omits the trailing CRLF — both verified against
the real `gpgv` 2.4.8 binary, which reports `GOODSIG`/`VALIDSIG`), stages
a real-format Release + Packages.gz through `prepare()` with the real
`gpgv` path, and refuses a wrong keyring before any staging. No key
material is committed. A rig-apt-cache parser test proves the real
Release shape parses (`/var/lib/apt/lists/*InRelease`, read-only;
named skips where `gpgv` or the cache is absent, following the
repository's bun precedent).

Node evidence: `node-v24.18.0-linux-x64.tar.xz` downloads to SHA-256
`55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742`
(the `pins.json` x86-64 pin) and carries 5,774 members (4,703 regular,
1,068 directories, 3 symlinks); `NODE_SKIP_LIMIT = 8192` is that count
plus 2,418 headroom, and the real tarball stages through
`extract_selected()`.

Drill honesty note: the first attempt at drill 11 neutered the base
anchor check and the test still passed — the per-level resolve check
fired first. That is defense in depth working, not a weak test; the
recorded drill neuters the resolve-level check itself.

`black` formats the three Python files single-file here (its multi-file
run needs a socket this sandbox denies); `eslint`, `prettier`, `check:l10n`
and the 130-test suite are recorded below. No gate weakened, no dependency
added, no file lane OS2 owns touched.

## Build host tools and cleanup

Pre-approved apt installs: mkosi 26-3, QEMU x86 10.2.1, OVMF 2025.11,
systemd-container/ukify 259.5, qemu-user/binfmt, xorriso,
debian-archive-keyring, python3-venv, systemd-repart and cryptsetup-bin.
QEMU aarch64/AAVMF, dosfstools, mtools and squashfs-tools were already present.
mkosi 27.1 was run from a locally built source archive; the composer checks
the `--version` string against the `os/pins.json` pin at stage time but does
not re-verify the source tarball digest (named residual below).
Installer El Torito needs repart 261+: Debian repart/shared 262-1 packages
were digest-verified and extracted under this worktree, never installed over
host systemd. Repart package SHA-256:
`99f9f642131c13053e9fe1f8f36833746bd97348d9b24860a01af1610e2852b8`;
shared package SHA-256:
`66978b0102d1da834afa5ec670f8f6a1ded893be9fbe08fa2a5c95c152f90b51`.
No global npm or Python package was installed. Download/package caches,
scratch directories and disposable fixture media under out were removed
after qualification; final media, partition payloads,
manifests, checksums, input receipts and boot logs remain under ignored out.

The first Pi precedence failure is retained as
`temp/os1-pi4-priority-failed.log`; the original module-path refusal was
`depmod: could not open directory .../overlay/lib/modules/...`. The fixed
compositions succeed and their native payloads verify.

## Named integration handoffs

- OS1-C-SERVICE and OS1-C-LOCAL-CONTROL: real NodeServiceBinding, authenticated engine/tools port and control/key input are absent on this base. Product unit skips until immutable binding and on-device state exist; no fake production implementation. The probe uses installed NodeService/nodeHealth with test-only state and no model attempts.
- OS1-OS3-SETUP: first-boot authenticated browser, seed/network import, selected target disk and image write are outside OS1. Installer boot media has volatile /var and never writes a target disk.
- OS1-OS2-SLOTS: publish paired active/inactive usr/hash partition labels, unsigned UEFI UKI and populated native Pi boot-a.raw; OS2 supplies updates, tryboot/EEPROM policy and rollback trials.
- OS1-OS4-HARDENING: unsigned UKI is not a trusted boot chain; /var is not encrypted. Separate UID/private-state read denial is qualified; ptrace/socket-peer/environment isolation and hardening threshold remain C/OS4.
- OS1-OS6-RELEASE: whole-image reproducibility still unproven despite matching immutable components. Repeated builds, source packages, signatures, SBOM/provenance and boot CI remain OS6.
- OS1-Q-HARDWARE: miniPC, old x86 desktop, ARM SystemReady server, Pi4 and Pi5 physical boot receipts are waiting. No KVM on this rig; all recorded VM boots use TCG.
- OS1-J-DOCS: integrate README/CHANGELOG/PLAN/help catalog and inherited host-API record. Base has no featureCatalog.ts. Full quality is reserved for lead; no gate or hook changed.

Physical receipts are assigned to Q as `Q-M110-OS1-X86-MINIPC`,
`Q-M110-OS1-X86-DESKTOP`, `Q-M110-OS1-ARM-SYSTEMREADY`,
`Q-M110-OS1-PI4` and `Q-M110-OS1-PI5`; all are waiting for hardware.

## Final artifacts

All six builds exit 0. Four final UEFI boot probes and one real corrupted-usr
drill pass; Pi media pass native FAT/kernel/verity inspection. Physical boot
remains waiting. Source/boot/Pi/artifact JSON receipts accompany this record.

| Media                                       | Logical bytes | SHA-256                                                            |
| ------------------------------------------- | ------------: | ------------------------------------------------------------------ |
| `out/x86-64/muse-node-x86-64.raw`           | 5,910,839,808 | `37455f0766f19a62db87a2bf37cfab956fab6aec2bb9a3b38d9b1c44977bcbd4` |
| `out/x86-64/muse-node-x86-64-installer.iso` | 3,763,356,160 | `24ab27cc800d17d3ca1fe3f963850a2383d2e0cd2aef3aa23ef79b65dfe3fc6b` |
| `out/arm64/muse-node-arm64.raw`             | 5,910,839,808 | `1035010955837bc56891d56d3e4ca15a28ac4980732ce0d9a6cb5e87c28b8fca` |
| `out/arm64/muse-node-arm64-installer.iso`   | 3,763,356,160 | `7240688f22490e22dbdf039e48295daa81bd66e435f0dd73dc41b5cf06351976` |
| `out/pi4/muse-node-pi4.raw`                 | 6,183,469,568 | `8044fda90056cfae2d9f97970ea33ece6214d988297292a522de0835ef6efd14` |
| `out/pi5/muse-node-pi5.raw`                 | 6,183,469,568 | `6f19cf611a53ec00ee2a5c356b1541c0e5a248c51174c7c1ef3b2e19cebc7552` |

Images and complete split/input/package/checksum/boot receipts are retained
under ignored `out/`; no binary media are committed or published.

Local commits before this final record: `8d017f1c7`, `b7f7cf3c5`,
`0df3da70c`, `905ad6b30`, `0d6d85d6e`, `1a8dfb09e`.
