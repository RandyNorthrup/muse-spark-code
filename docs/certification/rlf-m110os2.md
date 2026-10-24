# RLF-M110OS2: Node OS images built and booted for both architectures

Recovery lane. Base `5ae94646` (main at 0.19.0, with RLM110A0's
OS1 recipe, OS2 update client and A3). Landed RLF-M110OS's fifteen
commits (OS3–OS7) by cherry-pick: a whole-branch merge would have
dragged 957 unrelated `int/recovery` commits, so only the lane's own
stack (`fbad2fbad`..`32909e2c4`, 96 files) landed, with records and
generated files resolved toward current main.

## Checklist

- Muse Node OS images boot-tested in QEMU for both architectures:
  x86-64 under TCG (host QEMU 10.1.0, OVMF) and aarch64 through
  container QEMU 10.0.13 with AAVMF, both to the serial login
  prompt with zero failed units. KVM boots stay named as waiting:
  this rig has no `/dev/kvm` in the sandbox, so both receipts are
  TCG; the pipeline boots x86-64 with KVM on CI.
- The SPDX SBOM is attached per architecture (147 Debian packages
  each, validator-clean).
- RLF-M110OS's drills re-run on real images (T1, S1 on the real
  UKI, A1, F1, B1 on both images, R1 on two real builds).
- The threat-model acceptance stays with the lead (L6).

## Builds (2026-10-23, linuxlt)

Built in the privileged `muse-nodeos-builder:rlf-m110os2` container
(Debian trixie pinned by digest, mkosi 27.1 from the `pins.json`
tarball with its SHA-256 verified, systemd 257 toolset, cryptsetup
2.7.5, qemu-user-static for the arm64 cross build). The arm64 build
registered `qemu-aarch64` with the fixed-binary flag for its run
only; the host table was verified back to its three pre-existing
entries afterwards.

- x86-64: `out/build-a-x86-64/muse-node-x86-64.raw`,
  5,910,843,392 bytes,
  SHA-256 `5762a3a89d8be41e61697504c816c25ad4a215ffd2a54f40b60e0916192b4508`.
- arm64: `out/build-a-arm64/muse-node-arm64.raw`,
  5,910,843,392 bytes,
  SHA-256 `05a988c1c65f000fdaf744b6b8227df32345b6a0e3dd0ae4c77ad12b86be30d`.

Each image carries its architecture's Linux runtime tarball
(`muse-spark-code-acp-0.19.0-linux-{x64,arm64}.tgz`, packed on this
lane; the arm64 native helpers were cross-compiled from the in-tree
sources with the repo's flags and smoke-matched against the native
pair under `qemu-aarch64`).

## Boots

`scripts/os-boot-test.mjs` against sparse clones (pristine images
kept for the comparison):

- x86-64, TCG on q35 (`-cpu max`, one vCPU, as OS1
  qualified it): the `localhost login:` prompt in 163,019 ms
  wall. Zero `FAILED` units; the only `failed` lines are the
  wireless `regulatory.db` loads (no radio in QEMU). An
  earlier receipt on QEMU's default i440fx (200,321 ms) was
  superseded when the driver pinned q35.
- aarch64, container QEMU (`virt`, `cortex-a72`, `-bios`
  AAVMF `5d314729…`, `efi-virtio.rom` from `ipxe-qemu` as
  RLM110B found): `localhost login:` in 141,327 ms wall.
  Kernel `6.12.111+deb13-arm64`, `Detected architecture arm64`,
  zero `FAILED` units.

The marker is the getty prompt: systemd's own status lines carry
ANSI escapes, so their plain text never matches byte for byte
(measured on the first attempt, which booted fully but timed out
on the unwrapped marker).

## SBOM

`scripts/os-sbom.mjs` wrote one SPDX 2.3 document per manifest
(image plus every Debian package with a `pkg:deb` purl,
`NOASSERTION` everywhere the manifest stays silent). Both
documents parse cleanly under `spdx-tools` 0.8.5.

## Reproducibility (R1 on real images)

Two x86-64 builds compared with `os-repro-check --compare`
(exit 1, every divergence named): the `.raw` differs (build A
`5762a3a8…`, build B `46338c10…`) with `var`, `usr-a`,
`usr-a-verity`, `roothash`, `root`, `efi`, `esp`, `SHA256SUMS`
and `artifacts.json`. Root-caused by mounting both images'
partitions: `/usr` and `/` content and metadata (mode, owner,
mtime, paths) are byte-identical; the UKI's
`.sbat`/`.osrel`/`.uname`/`.linux`/`.initrd` sections are
identical and only `.cmdline` differs in the transitive
`usrhash=`; `/var` differs in exactly one file
(`cache/ldconfig/aux-cache`). The `.raw` divergence is
filesystem bytes below the file view (identical UUID,
superblock times, content and metadata — consistent with
mkfs's unpinned per-build randomness); `roothash`, `esp` and
the receipts differ transitively. Payload content is fully
reproducible; byte reproducibility waits on the filesystem
seed (OS1-OS6-RELEASE binding), so `REPRO_ENFORCE` stays
`false`. The comparison itself found and fixed a real gap:
the tool read whole files and crashed over 2 GiB; it now
hashes in 64 MiB chunks (suite green, recorded raw hash
matches `sha256sum`).

Two arm64 builds compared with the same tool (exit 1): the
same ten-file divergence set as x86-64 (`.raw` build A
`05a988c1…`, build B `ba037bd6…`, with `var`, `usr-a`,
`usr-a-verity`, `roothash`, `root`, `efi`, `esp` and the two
receipts), confirming the same root causes on both
architectures.

## Drills re-run

- T1 threshold gate: `--threshold 100` exits 0, `--threshold 0`
  exits 1 on the planted insecure unit (exposure 9.4).
- S1 boot signing on the real 135 MiB UKI: `--verify-only` on
  the unsigned image exits 1; signing with a throwaway drill key
  exits 0; a one-byte tamper exits 1; the failed sign exits 1
  and leaves no output file.
- A1 add-on manifests: both shipped manifests sound (exit 0);
  a name-violated manifest exits 2.
- F1 firmware: the recorded 7 packages resolve live (exit 0);
  an unknown package exits 1.
- Key pins: chrome and nvidia transcripts match (exit 0 each).
- B1 boot driver: both real images to the login prompt (above);
  the suite's timeout/panic halves still pass on the proving guest.

## Waiting, named

- KVM boots (no `/dev/kvm` here); the pipeline's x86-64 boot
  uses KVM on CI.
- TPM, MOK and LUKS enrollment on hardware (O4 and owner hardware).
- Image signing (the owner's key ceremony); the pipeline
  publishes unsigned with a loud warning until then.
- OSJ, the Ollama add-on: out until the owner says go.
- The threat-model acceptance stays with the lead (L6).

## Gate matrix

- `prettier --check` (touched files and full `format:check`): 0.
- `eslint --max-warnings 0` (touched files): 0.
- `npm run typecheck`: 0.
- `node scripts/check-l10n.mjs`: 0 (14 UI tables, 266 manifest strings).
- `npm run check:reference`: 0 (83 features, current).
- `npm run check:host-api`: 0 after regenerating the record for the
  landed sources.
- `npm run check:plan`: 1, deferred in PLAN.md §7 (3,602,059 bytes
  over the 85% budget; pristine `5ae946464` is 3,601,912 bytes,
  also over — lead-coordinated archiving).
- `npm run check:roadmap`: 0 (222 entries, current; unblocked by
  uniting the duplicated Q-M110 in §3).
- `npm run check:catches`: 0 (baseline matches, no regen).
- `npm run duplication`: 0 (0 clones).
- `npm run cycles`: 0 (no circular dependencies).
- `npm run deadcode`: 0.
- `npm run build`: 0 (every budget holds; notices and legal
  records clean).
- `npm run check:workflow-scripts`: 0 (67 files, 19 pre-install
  builtin-only).
- `npm run security:sast`: 0 full-repo; 0 findings on the
  lane's 30 touched sources.
- Suites: the ten `nodeOs*` suites green (86 tests), including
  the new SBOM suite over the recorded manifest;
  `osImageBuild.test.mjs` green (131); `nodeSurface.test.ts`
  green (CSS URL pin holds).
- `npx vitest related` over the lane's changed sources (repo-default
  timeouts, `--maxWorkers=3`, 2026-10-23 resume run): firstBoot
  server/setupCode/seed → 3 files, 36 passed; firstBoot
  disks/display/pages → 2 files, 16 passed; firstBoot
  schemas/setupStore plus ownerStore → 5 files, 59 passed;
  nvidiaConsent/chromeConsent/httpServer → 3 files, 31 passed;
  nodeSurface → 1 file, 4 passed. Every run green. `constants.ts`
  (a one-value fix) and `en.ts` (an additive key block) were not
  passed through `related`: each is imported widely enough to pull
  the whole battery, which the lane rules forbid. They are covered
  instead by the nodeSurface pin suite (which asserts the value)
  and by `check:l10n` plus the nodeOs suites (which render the
  keys).

## Red/green drill (2026-10-23 resume run)

`NODE_WORKSPACE_ASSET` broken back to `./node/files/main.js`:
`npx vitest run test/unit/nodeSurface.test.ts` exits 1 (1 failed,
3 passed). Restored byte-exact (`git diff` empty on the file);
the suite is green again (4 passed).
