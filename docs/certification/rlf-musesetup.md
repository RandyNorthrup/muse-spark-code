# RLF-MUSESETUP certification (M110os: setup installs Meta's CLI, D227)

Lane: RLF-MUSESETUP. Base: int/recovery `b781451b94`, then merged
RLF-M110OS2 (`refs/remotes/rlf-m110os2`, tip `15df6deba`) as `52b9e9c7e`.
Date: 2026-10-30. Rig: linuxlt.

## What this lane proves

The owner's ruling on Q-M110 item 4 (Meta's terms), verbatim: "for the
meta term just make the install part of the setup process". Recorded as
D227 in PLAN.md §2 (`c1dbb6531`); Q-M110 item 4 closed in §3. Our OS
images, packs and the desktop never contain Meta's Muse Code CLI; the
first-boot setup (and the desktop onboarding when M111b builds it, and
the extension's own setup where it offers Muse Code) installs it from
Meta's official source as a step the person sees, with Meta's terms
shown for the person to accept, and verifies what it installed. The
relay stays for the one person who owns the subscription; team mode
keeps waiting on Meta (D90.17 otherwise unchanged).

## Research the code stands on (all read live, 2026-10-30)

- Meta's POSIX installer `https://dev.meta.ai/install.sh`: HTTP 200,
  9,314 bytes, 314 lines. Requires `bash`, `curl`, `mktemp` (plus
  `sha256sum`/`shasum` when a checksum is advertised). Installs the
  launcher into `$HOME/.local/bin` unless `MUSE_INSTALL_DIR` is set;
  downloads the launcher from `https://api.meta.ai/muse-launcher.sh`
  over TLS 1.2+ (`--proto '=https'`, `--proto-redir '=https'`,
  `--max-redirs 3`); syntax-checks it (`bash -n`) and verifies it
  against the `x-content-sha256` header when present; runs it with
  `MUSE_LAUNCHER_INSTALL=1`; appends PATH lines to shell profiles
  unless `MUSE_NO_MODIFY_PATH=1`. The setup passes
  `MUSE_NO_MODIFY_PATH=1` (the node manages PATH) and honours
  `MUSE_INSTALL_DIR`.
- Meta's terms `https://dev.meta.ai/legal/terms-of-service`: HTTP 200,
  title "Legal", "Last updated: October 9, 2026". This is the terms
  page every setup surface links.
- The node image boots with `/` read-only (`/dev/vda2 / ext4 ro` in
  the drill transcript) and service homes under `/var/lib`, so the
  setup installs the CLI into a home under `/var` (the drill used
  `/var/lib/muse-drill/home`).

## The setup step (what the person sees)

`src/runtime/node/firstBoot/installMuseCode.ts` (`947de9539`): fetches
Meta's installer (TLS, https-only redirects capped at Meta's own 3,
three download attempts with backoff, 1 MiB cap), runs it with bash as
the setup home with profiles untouched, and verifies
`<home>/.local/bin/muse --version`. Expected failures return stable
reasons (`download-failed`, `install-failed`, `verify-failed`,
`timed-out`); bugs throw.

The wizard gains the Muse Code section (terms sentence plus the terms
link, the home-folder note, Install/Skip), the review gains its row,
and completing with Install runs the step: success completes with the
installed version on the done page (also on later visits); failure
brings the wizard back with `Muse Code could not be installed:
{reason}` and nothing completes, so the person retries or skips.
Strings in English plus all 14 tables (`node scripts/check-l10n.mjs`
green).

The extension's Install Muse Code confirmation names Meta's terms with
a Read-link beside the command; clicking Run Installer is the accept.
Verification there already existed (CLI polling).

Shipment: the setup server first rode `dist/node.js` statically, which
measured the seed reader's YAML parser into it (71.3 KiB → 208.7 KiB
against a 75 KiB budget). It ships as its own chunk instead
(`30dfdadc1`): `dist/nodeSetup.js`, loaded when the first boot runs
it, with its measured budget (143.4 KiB against 175 KiB). The split
check pins the chunk's exact ten inputs; the ACP package ships it;
the lazy registry knows it. `dist/node.js` is back to 71.3/75.

## The never-in-images side (D227 enforced)

- `os/check.py`: refuses any staged file or directory wearing the
  CLI's installed names (`muse`, `muse.cmd`, `muse-bin-*`,
  `.muse-version`, `.muse-launcher.ps1`), refuses a listed CLI Debian
  package, and requires `curl` (Meta's installer needs it).
- `os/addons/lib/checkAddon.mjs`: refuses a manifest that names the
  CLI, packages it, or fetches a vendor run from Meta's installer
  hosts.
- The pack tool list is closed (`parseToolset`): a `muse-code` tool is
  refused as `Incomplete toolset` (pinned by test).
- The composer already refuses unexpected tarball members; pinned with
  CLI-shaped intruders (`dist/muse`, `muse-bin-1.4.10`).
- `os/build.py` (`b095beeca`): admits what int's pack grew since OS2
  (judge catalog, Vim scripts, judge peer C source) by exact name.

## Red/green drills (each broken on purpose, then restored)

1. check.py no-CLI guard: planted `overlay/usr/local/bin/muse` in a
   tree copy → `ValueError: OS1 policy: no staged Muse Code CLI`,
   exit 1; removed → `OS1 image policy: 0 problems`, exit 0.
2. Add-on CLI refusal: name `muse-code` / packages `['muse-code']` /
   vendorRun `https://dev.meta.ai/install.sh` → each refused with
   `an add-on never stages the Muse Code CLI` (suite cases; shipped
   chrome/nvidia manifests still sound, exit 0).
3. Pack tool list: pushed `muse-code` tool → `Incomplete toolset`
   (suite case).
4. Tarball intruders: `dist/muse` + `muse-bin-1.4.10` members →
   `unexpected archive member` (suite case).
5. Setup failure honesty: completing with a 1 ms install bound brings
   the wizard back with `Muse Code could not be installed: timed-out`
   and nothing completes (suite case, no network needed).
6. Catch gate: the first cut's switch-mapped handler counted GENERIC
   and its finally swallow counted CLEANUP (both rose, gate red);
   rewritten to a branded failure tested with instanceof (NARROW) and
   a bare temp removal (a removal failure is genuine IO failure and
   surfaces as one) → `All catch sites and counts match the baseline`.
7. Bundle budget: the static export blew `dist/node.js` to 208.7/75;
   the lazy chunk restored 71.3/75 with `nodeSetup.js` at 143.4/175.

## First-boot run in the VM (the proof)

Built `x86-64` from this tree in `muse-nodeos-builder:repo`
(privileged, as the recipe requires):

- Runtime pack: `dist/muse-spark-code-acp-0.19.0-linux-x64.tgz`,
  SHA-256 `07d0a69c6b2a86895e774ec1fa011594af8a4cd467f07c195d3636ab65511e8a`
  (packed from this tree; contains `dist/nodeSetup.js`).
- Pristine image `out/x86-64/muse-node-x86-64.raw`,
  SHA-256 `d37a981f0af444b6528447e1c703d09d4bb5d94d34ce3e1400400a89484d1ef4`
  (5.5G sparse, 951M); manifest 1,134 lines, `curl` present.
- Pristine boot via `scripts/os-boot-test.mjs` (q35, TCG, OVMF):
  `{"ok": true, "reason": "marker", "accel": "tcg", "bootMs": 109483}`
  at `localhost login:`.

Drill: sparse clone, injected a oneshot unit + launcher into the
clone's `/etc` + `/opt` only (debugfs, the e2e harness's own
pattern; the pristine image and the recipe untouched), booted with
the same driver. The launcher imports the image's staged
`dist/nodeSetup.js`, scans the image for CLI names, walks the whole
setup over loopback with `museCode=install`, and reports to the
serial console. Transcript (`out/drill/run2/serial.log`):

- `image-clean=true staged-cli=0` (the image testifies: no CLI)
- `setup-code-accepted=true`, `setup-review=true muse-choice=install`
- `setup-installed=true version=Muse Code 1.4.14 (1.4.14-R7309.1)`
  (Meta's installer ran during setup; the done page reported it)
- `muse-answers=true muse-version=Muse Code 1.4.14 (1.4.14-R7309.1)`
  (independent `/var/lib/muse-drill/home/.local/bin/muse --version`)
- `MUSE-SETUP-DRILL-DONE ok=true reason=installed`
- Receipt: `{"ok": true, "reason": "marker", "accel": "tcg",
"bootMs": 292656}`; zero failed units (only benign wireless
  regulatory firmware lines, no wifi in the VM).

A first attempt failed honestly in the guest (`/root` is not
writable: `/` mounts `ro`); the rerun keeps drill state and the
CLI's home under `/var/lib`, where service homes live, and probes
`/root` only to record the answer (`root-writable=false
cause=EROFS`).

## Touched suites (repo timeouts, `--maxWorkers=3`)

- `nodeOsMuseSetup` (4), `nodeOsSetupServer` (10, incl. the live
  26 s Meta install), `nodeOsFirstBoot` + `nodeOsSetupDisplay` (28),
  `nodeOsSbom` + `nodeOsHardening` (10), `nodeOsBoot` (10),
  `osImageBuild` (149), `nodeOsAddons`, `nodeToolset` (45),
  chrome/nvidia `check-addon` (exit 0 each): all green.
- `vitest related` over the changed sources: related1 (14 passed),
  related2 (38 passed), related3 (2 passed) green; related4
  (`constants.ts`, `en.ts`) 1,097 passed with 28 failed files.

## The related4 28: every one proven pre-existing or environmental

Representatives of each class were rerun alone on this tree and
on a clean checkout of the base (`b781451b94`, same
`node_modules`); the signatures below match on both. Siblings in
the environmental class are grouped by their identical failure
signature without a second base run each.

- Pre-existing on base, identical signature: `commandHelp`
  (`providers headers` falls back to 2-line generic help; the whole
  chain is byte-identical to base), `cx1r2Truth` (base ROADMAP
  already carries the M96d row without "in progress"),
  `estimatorPlanSnapshotRealPlan` (M100's two lane tables and
  Starts cells predate the lane; 417-vs-407 on both), `manifest`
  (`@codemirror/merge` notice + RELFAST 8-vs-7 on both),
  `mhpContract` (same `MHP_VERSION_LOCK` digest `80d04e5d…`; no MHP
  file touched), `acpServeHandshake` (same handshake-text
  mismatch), `browserEnglish` + `browserUiText` (same
  `resourceCpuTime` / `resourceHistoryNewer` surface errors),
  `resourceStatusCpu` (same 5 s sampler timeout).
- Environmental, identical on base: `connectorServe`,
  `connectorStdio` (same "expected 1 to be +0"),
  `connectorStorageGuard` (`ECONNECTOR_STORAGE`),
  `deviceJournal`, `deviceResultChannel`, `deviceResultStore`
  (`storage`), `inspectNative` (`refused: systemFile`),
  `nodeGitRunner` (`This session cannot perform that action`),
  `scheduleBackgroundReconcile` (`Unsafe schedule launcher path`
  under the sandbox), `privateDirectory`, `privateRootLease`,
  `mediaConvert` (private root not owner-only under the lane
  sandbox), `judgeLocalLinuxNative` (EROFS on `/var/tmp`),
  `vault/brokerSocketDirectory` (broker cannot start in the
  sandbox), `vsixCompression` (pinned zopfli not pip-installed).
- `devicesPhase2Harness`, `feedbackBrowser`,
  `teamModelsFirstPaint`: failed only on the lane sandbox's long
  `TMPDIR` (Chrome singleton socket path too long); rerun with
  `TMPDIR=<worktree>/temp/short-tmp` per the machine facts: 3
  files, 27 tests, all green.
- `runtimeLsp`: 3 tests reach the suite's own 240 s budget and time
  out (787 s solo); zero file overlap with the merge or the lane
  (verified: no `lsp` path in either diff). Base comparison:
  same 3 `supervise and stop` tests time out at 240 s on the clean
  base (3 failed / 6 passed, 809 s vs 3 failed / 6 passed, 787 s
  here).

Nothing this lane changed accounts for any of the 28; the lane's
own suites and the other three `related` runs are green.

## Gate matrix (final, this tree, 2026-10-30)

| Gate                              | Exit | Note                                                       |
| --------------------------------- | ---- | ---------------------------------------------------------- |
| prettier --check (touched)        | 0    |                                                            |
| eslint --max-warnings 0 (touched) | 0    |                                                            |
| typecheck                         | 0    |                                                            |
| check-l10n                        | 0    | 0 problems                                                 |
| check:reference                   | 0    |                                                            |
| check:host-api                    | 0    | 0 problems (counts regenerated)                            |
| check:plan                        | 0    | 0 drift                                                    |
| check:roadmap                     | 0    | current, no regen needed                                   |
| check:catches                     | 0    | baseline match                                             |
| duplication                       | 0    | 0 clones                                                   |
| cycles                            | 0    |                                                            |
| deadcode                          | 0    | only pre-existing `@unwired` tags                          |
| build                             | 0    | node 71.3/75, nodeSetup 142.9/175; legal scan 0 incomplete |
| security:sast                     | 1    | PRE-EXISTING: 6 findings, all in base-identical code       |

The build went red first (`06c83a4fc` fixes it): the legal
repository scan cannot admit the recipe's symlinked kernels or the
apt partial cache, so with `out/` present it reported 3 incomplete
and exited 1. `out/` is gitignored regenerable tool output, the
class RLF-HYGIENE already names instead of walking, so it joins
that exclude list. Red before (3 incomplete, exit 1), green after
(0 incomplete, exit 0, the same 149 findings still reported),
with every artifact present.

SAST's 6 findings sit in code byte-identical to the base: five
files this lane never touched, plus `os/build.py:79` (the
download helper's `urlopen`), which predates the lane's hunks
(they start at line 222). Fixing them belongs to their owning
milestones, not to this lane.
