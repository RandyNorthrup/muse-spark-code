# Per-platform .vsix packages (VSIXPLATFORM lane)

## 1. Per-platform helper inventory (2026-10-18, linuxlt rig)

Method: source sizes measured in this worktree with `du -b` (exact bytes);
CI-built binary sizes are NOT measurable on this Linux rig and are marked
CI below. Per-target `.vsix` sizes are measured by CI's package job, which
alone holds all four compiled helpers.

### Shipped native pieces per target

| Target       | Ships                                                  | Local source bytes                                                                                                                                                                                                                         | CI-built binary                                                                                                                                        |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| win32-x64    | native/windows/* (10 files)                            | 170,960                                                                                                                                                                                                                                    | none (compiled/interpreted on the person's machine: .ps1 run directly, .cs compiled at first vault use by `src/host/vault/slots/windowsVaultBuild.ts`) |
| win32-arm64  | same 10 files as win32-x64                             | 170,960                                                                                                                                                                                                                                    | none (same reason; no arch-specific code, so arm64 is supported today)                                                                                 |
| darwin-x64   | native/darwin/muse-dictate, muse-dictate-screen.app/** | sources 129,776 (Dictation.swift 38,756, ScreenRecord.swift 26,860, VaultKey.swift 15,989, MuseSparkCreated.c 10,588, Info.plist 1,583, 16 lproj ~14,000); binary is universal x64+arm64, 80,798 bytes deflated per native/darwin/build.sh | dist/native/darwin/muse-vault (universal binary, size CI)                                                                                              |
| darwin-arm64 | same darwin files as darwin-x64                        | 129,776 sources                                                                                                                                                                                                                            | same CI binaries                                                                                                                                       |
| linux-x64    | native/linux/x64/muse-created                          | source MuseSparkCreated.c 10,588                                                                                                                                                                                                           | binary CI (built by scripts/build-linux-helper.mjs on ubuntu-24.04)                                                                                    |
| linux-arm64  | native/linux/arm64/muse-created                        | source 10,588                                                                                                                                                                                                                              | binary CI (ubuntu-24.04-arm)                                                                                                                           |

Windows file split (identical on x64 and arm64): dictate.ps1 6,909,
capture.ps1 10,902, MuseSparkJob.cs 42,917, MuseSparkMcpJob.cs 29,247,
MuseSparkMcpLauncher.cs 5,320, MuseSparkScreenRecord.cs 39,424,
MuseSparkVault.cs 24,897, MuseSparkVaultCng.cs 3,800,
MuseSparkVaultHello.cs 6,183, MuseSparkVaultLock.cs 1,361.

### Cross-platform pieces (ship in EVERY target)

- native/runner/runner-helper.ps1 (20,782) + runner-helper.sh (6,476):
  the SSH runner copies the helper to the REMOTE side, so a Windows person
  reaching a Linux box needs the .sh and vice versa (`src/host/runners/sshRunner.ts`).
- Everything else in the .vsix (dist bundles, l10n, docs) is platform-neutral.

### NOT shipped (not in .vscodeignore allowlist)

- native/confine/MuseSparkConfine.c (20,289): dev/sandbox use only.
- native/darwin/*.swift, *.c sources: only their CI-built binaries ship.

### Each platform's share of today's universal package

Today's universal `.vsix` carries ALL of the above: ~171 KB Windows
sources + ~130 KB darwin sources + universal muse-dictate binary + .app
resources + muse-vault darwin binary + both muse-created binaries.
Provisional universal size 3,272,933 bytes on Kubuntu with the real x64
helper, an empty arm64 helper and no macOS artifacts (scripts/check-vsix-size.mjs);
budget 3,788,800 bytes (3700 KiB). Per-target packages drop every other
platform's pieces: a Windows target drops the darwin binaries + both
muse-created binaries; a Linux target drops the darwin binaries + the
Windows sources + the other arch's helper; a darwin target drops the
Windows sources + both muse-created binaries. Exact per-target byte sizes
and headroom are recorded in §2 below once CI builds them.

Incoming pressure (brief): six open pull requests need about 131 KB more;
the vault's cross-platform keyring needs about 4.7 MB of binaries. Neither
fits the universal package; per-platform packages absorb the platform's own
share only.

### Universal fallback: shipped (lane PR246FIX, 2026-10-18, macmini rig)

The release ships the six targeted packages plus the untargeted universal
package (`muse-spark-code-<version>.vsix`, no `--target`). VS Code serves
the universal package as the fallback on every platform without its own
package, so Alpine (`alpine-x64`, `alpine-arm64`) and `linux-armhf`
servers — the extension is `extensionKind: ["workspace"]`, so a Dev
Container or Remote SSH window installs it on the server — keep installing
exactly what they ran before: the universal package carries every
allowlisted helper. (There is no `web` package to serve: the extension has
no `browser` entry, so VS Code never installs it on web.) The fallback
meets the same unchanged budget; CI packs, checks and publishes it with
the six. Both registries serve the matching target package where one
exists (vsce 4.0.0 `--target`; ovsx documents target-platform downloads)
and the universal package everywhere else.

## 2. Measured per-target sizes and headroom (2026-10-18; linuxlt and macmini rigs)

Budget for every package: 3,788,800 bytes (3700 KiB, `scripts/check-vsix-size.mjs`, unchanged).
A size failure names the artifact that went over.

Locally packed from the full production build on the named rig
(`npm run build` green with budgets, then `node scripts/package-vsix.mjs
--target <t>`, or no flag for the universal fallback), each asserting its
own `TargetPlatform` in `extension.vsixmanifest` (or none for the
fallback) and zero foreign helpers in its entry list. No two archives
are byte-identical: the `TargetPlatform` string alone differs per target
(`cmp -l` of the two Windows archives below differs from byte 15 on).

| Target       | Measured bytes | Headroom | Method                                                                                                                                                                                                                                                  |
| ------------ | -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| linux-x64    | 3,248,894      | 539,906  | complete local package on linuxlt (helper built there: `native/linux/x64/muse-created`, 43,208 bytes)                                                                                                                                                   |
| win32-x64    | 3,282,047      | 506,753  | complete local package on macmini (Windows helpers are arch-independent sources in git)                                                                                                                                                                 |
| win32-arm64  | 3,282,048      | 506,752  | complete local package on macmini: same stage as win32-x64 except `TargetPlatform="win32-arm64"`, hence one byte larger, never identical bytes                                                                                                          |
| linux-arm64  | CI             | CI       | helper built on ubuntu-24.04-arm in CI; same filter as x64                                                                                                                                                                                              |
| darwin-x64   | CI             | CI       | universal darwin binaries built on macOS in CI (muse-dictate + .app via build.sh, muse-vault); stage filter proven locally                                                                                                                              |
| darwin-arm64 | CI             | CI       | same CI binaries as darwin-x64                                                                                                                                                                                                                          |
| universal    | CI             | CI       | packed by CI's package job with all helpers (both muse-created binaries, Windows sources, darwin binaries); reference only: 3,272,933 bytes on Kubuntu with the real x64 helper, an empty arm64 helper and no macOS artifacts (not a shippable package) |

CI's package job prints every package's bytes (`stat -c '%n %s' ./*.vsix`),
checks each against the budget, and asserts per target: all shared
bundles present, only its own helpers present, no other platform's
helpers, and its `TargetPlatform` in the manifest — and for the fallback:
every helper present and no `TargetPlatform` at all.

## 3. Every place that assumed one universal package

- `scripts/package-vsix.mjs`: staged everything VSCE allowlisted and packed
  one archive. Now stages per `--target` and packs six.
- `scripts/check-vsix-size.mjs`: took exactly one path. Now checks every
  artifact against the same budget, and a failure names the artifact that
  went over.
- `scripts/publish-registry.mjs`: took exactly one artifact and verified the
  universal download. Now publishes every artifact first, then polls all
  fresh ones under one shared 30-minute deadline (`pollAllVisible`,
  re-checking unfinished targets in the same job), verifying each against
  its own target's download (Marketplace `?targetPlatform=`, Open VSX
  `/api/<ns>/<name>/<target>/<version>`, universal download for the
  fallback). The Marketplace and Open VSX jobs run 60 minutes to cover all
  publishes plus that poll.
- `scripts/release-reuse.mjs`: expected `muse-spark-code-<version>.vsix` and
  read one manifest. Now expects all six targeted names plus the universal
  fallback name and reads all seven manifests.
- `.github/workflows/build.yml` packages job: built and checked one
  universal VSIX. Now builds once, packs and checks six targeted packages
  plus the universal fallback (asserting the fallback carries every helper
  and no `TargetPlatform`); the ACP agent's
  npm package is unchanged (one tarball for every platform).
- `.github/workflows/release.yml`: comments said "universal VSIX". Now
  per-target packages plus the fallback; every glob (`release/*.vsix`, `./*.vsix`,
  `SHA256SUMS`) already expands to all seven.
- `docs/RELEASING.md`, `README.md`: said one universal VSIX. Now per-target.
- `PLAN.md`: new decision D209 (fallback and shared poll added by PR246FIX).
  `CHANGELOG.md`: Packaging entry under `[Unreleased]` (moved out of
  `[0.19.0]`: the change is not in that tag).
- Unchanged on purpose: the ACP npm package (runs on the person's machine,
  needs every platform's sources), `native/runner/*` (ships in every
  target: the SSH runner copies the helper to the remote side), the
  `required` aggregate's `package (.vsix)` check name (release recovery
  matches on it), and the universal `npm run package` path itself
  (hosts.yml and forks.yml still install the all-platforms package into
  test editors; the stores only ever receive the six targeted ones).

No behaviour change for a person on any platform: same bundles, same
helpers, same panel; only the store serves the matching package.

## 4. Grok review findings on PR #246 (lane PR246FIX, 2026-10-18, macmini rig)

One line per finding; each fixed at its cause in this lane:

1. Alpine (alpine-x64/alpine-arm64) and linux-armhf servers cannot install once the universal package is gone — fix: keep publishing the untargeted universal package as the fallback for every platform without a targeted package, within the same unchanged budget.
2. Sequential publish-then-poll per artifact can cancel the 40-minute job after only some targets are published — fix: publish every artifact first, then poll all fresh ones under one shared deadline that fits raised job timeouts, re-checking unfinished targets in the same job.
3. README/CONTRIBUTING/install example still describe one universal package — fix: name the per-target files (`muse-spark-code-<target>-<version>.vsix`) plus the universal fallback, everywhere the release artifact is described.
4. Certification claimed identical bytes across targets (false: TargetPlatform differs) and left three budgets as "CI" — fix: state measured sizes per target with method, no identical-bytes claim.
5. `check-vsix-size` failure does not say which target went over — fix: name the artifact in the error.
6. CHANGELOG bullet sits under `[0.19.0]` though the change is not in that tag — fix: move it to `[Unreleased]`.

## 5. PR246FIX proof (2026-10-18, macmini rig)

- `test/unit/vsixTargets.test.mjs`: 9 tests, passed, repo timeout.
  `test/unit/publishRegistry.test.mjs` (new): 4 tests, passed, repo
  timeout — driven against the real `pollAllVisible`/`publishOnce` with
  their declared injection points, no module stand-ins.
- Gate-fire check: with `pending.delete(label)` disabled in
  `pollAllVisible`, the re-check test fails (1 failed, 3 passed);
  reverted, all 4 pass again.
- Local packs from the green production build
  (`npm run build`, budgets hold): `muse-spark-code-win32-x64-0.19.0.vsix`
  3,282,047 bytes, `muse-spark-code-win32-arm64-0.19.0.vsix` 3,282,048
  bytes, each within budget via `scripts/check-vsix-size.mjs`, each
  declaring its own `TargetPlatform`, `cmp -l` differing from byte 15.
- `node --check` passes on both changed scripts;
  `scripts/publish-registry.mjs` with no arguments prints the fixed usage
  label (`publication refused`) and exits 1.
- Not measurable on this rig (no Linux helper toolchain, darwin binaries
  are CI builds): linux-arm64, darwin-x64, darwin-arm64, universal sizes —
  CI's package job prints and checks them (`stat -c '%n %s' ./*.vsix`).
