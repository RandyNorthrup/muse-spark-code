# M100 port to 0.17.1

2026-10-11, macmini, `/Users/randy/lanes/PORTM100`. Accepted phase-2 tip
`1630f022d3b7d982c445fdb7a46a87b252164d23`; authorized release base
`35d7b6f54280e6b6235ae4b90e079b865c3e4ff4`. Real two-parent merge, no
rebase, squash, push, remote machine contact or live/paid model call.
Model attempts **0**, inference spend **0**. Existing caps and repository
per-test deadlines remain unchanged. Hooks use `.husky/_` and the repository's
fail-closed installer. Commands and commit output are recorded in the ignored
`temp/portm100/` directory.

## Semantic resolutions

The merge reports 61 conflicted paths. Additive regions keep both sides unless
specified below; generated files are regenerated from the combined sources.

| Files                                                                                                                                      | Accepted M100 side                                                      | 0.17.1 side                                                                                                             | Resolution and regression coverage                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`                                                                                                                         | Lazy Devices window, service and open command                           | Recording commands, uploaded-file deletion, current providers/stores                                                    | Keep both command registrations and all current activation wiring. `commandRegistration`, `deviceProductionWiring`, `devicesPanel`.                                                                                                                                                     |
| `src/host/html.ts`, `test/unit/html.test.ts`                                                                                               | Devices document surface                                                | Host-issued document identity                                                                                           | Preserve both attributes, including on one document. New combined-attribute regression.                                                                                                                                                                                                 |
| `src/host/devices/deviceReceiver.ts`                                                                                                       | Durable attempt ownership, cancellation, action grants, paid admission  | Account receiver with local policy, placement fences and headroom                                                       | Preserve both independently exported receivers; combine the constants import. `deviceReceiver`, account-device routing suites.                                                                                                                                                          |
| `src/shared/devices.ts`                                                                                                                    | All phase-1/2 contracts and limits                                      | Account-headroom schemas                                                                                                | Preserve both schema families. Contracts and account-device suites.                                                                                                                                                                                                                     |
| `src/shared/protocol.ts`                                                                                                                   | Type-only Devices panel exports                                         | Schedule/media boundaries and `paidBoundary`                                                                            | Keep Devices types without loading panel schemas; keep newer validated boundaries and paid import.                                                                                                                                                                                      |
| `src/shared/constants.ts`                                                                                                                  | Device limits, model-text readers, lazy bundle and storage deadline     | Accounts, session-store bundle, resource handoff bound                                                                  | Add all distinct constants, retain release values and caps.                                                                                                                                                                                                                             |
| Four Devices views importing `formatUsd`                                                                                                   | Currency display through the former text module                         | Exact currency formatter moved out of startup                                                                           | Import `l10n/exactUsd` directly; retain localized amounts and the startup split. Owning view suites.                                                                                                                                                                                    |
| `src/shared/l10n/en.ts`, 14 `l10n/ui.*.json`, 15 `package.nls*.json`, `l10n/untranslated.json`                                             | Device strings, settings and command                                    | All newer text, Title Case labels, provider/account/schedule keys                                                       | Union distinct keys and allowlist leaves. Repository `mergeJsonTable` reports no conflicting leaf values; no translation replaced. Localization, manifest, browser-English suites.                                                                                                      |
| `src/shared/featureCatalog.ts`                                                                                                             | Eighteen Devices entries marked `unshipped`                             | Expanded feature/reference catalog and lazy label access                                                                | Keep catalog and release imports, remove duplicate constants import. Regenerate reference, including Devices documentation.                                                                                                                                                             |
| `scripts/lib/uiTextRegions.mjs`, `test/unit/browserUiText.test.mjs`                                                                        | Devices English loads separately; chunk errors enter the loader's catch | Group literals are protocol words unless accessed through `UI_TEXT`; resource/account/schedule/reference English splits | Keep release scanner semantics and every split; exclude Devices from shared surface English and install it in DevicesApp. Preserve guarded loader catches while loading the release's account English. Adapt the indirect-reader regression to scalar keys; group literals remain lazy. |
| `scripts/lib/deferredBundles.mjs`, `scripts/check-bundle-size.mjs`, `scripts/check-host-globals.mjs`                                       | Lazy Devices registration and 125 KiB cap                               | All current deferred chunks and independent budgets                                                                     | Union entries and checks. No budget increase or weakened split check.                                                                                                                                                                                                                   |
| `.vscodeignore`, `scripts/package-vsix.mjs`, `test/unit/vsixPackaging.test.mjs`                                                            | Devices bundle and native Windows sources                               | Linux created-path helpers, media bundles and current packaging assertions                                              | Keep both allowlists and required-member checks.                                                                                                                                                                                                                                        |
| `scripts/package-acp.mjs`, `scripts/lib/acpNativeSources.mjs`, packaging fixtures (`runtimeChatGptPackage`, `usagePackaging`, `execStdio`) | Devices bundle and storage helper                                       | Central native-source inventory and complete built-bundle fixtures                                                      | Use release inventory and fixture helpers, add DeviceStorage to that inventory once. Keep required Devices bundle.                                                                                                                                                                      |
| `package.json`, `scripts/cycles.json`                                                                                                      | Device roots in dpdm's old command                                      | Windows-safe cycle launcher and current dependency pins                                                                 | Keep release launcher, register both real device entrypoints in its roots, retain only accepted QR dependency addition.                                                                                                                                                                 |
| `vitest.config.ts`, `test/unit/teamHarness.test.mjs`                                                                                       | Generation-bound production build and watch rerun proofs                | Shared localization/package/browser setup and stricter scene completion                                                 | Keep both global setups and both proof/scene contracts. Give the Devices generation its own `deviceProductionBuild` context key so it cannot overwrite the release’s `productionBuild` package path. No test/hook deadline changes.                                                     |
| `test/harness/index.html`                                                                                                                  | Devices scenarios, tracked timers, optional settle parameter            | Finished-scene refusal and scene identity                                                                               | Keep scene guard, timer ownership, settle parameter and Devices target selection.                                                                                                                                                                                                       |
| `CHANGELOG.md`                                                                                                                             | Next-release feature notes                                              | Immutable 0.17.1 and older release history                                                                              | Use repository `mergeChangelog` with branch Unreleased delta and release history; feature notes stay under Unreleased. Helpers live in `src/core/team/merge/` on this tree, rather than `scripts/`.                                                                                     |
| `PLAN.md`, `docs/orchestration-gotchas.md`                                                                                                 | M100 implementation, certification, escape hatches and G50–52           | Current plans, gates, status grammar, archived historical M98 text and newer gotchas                                    | Keep device records and release requirements; use recognized historical prose, a phase-2 subheading and canonical lane columns. Retain release's removal of duplicated M98 sections (archived). Regenerate roadmap.                                                                     |
| Generated reference, roadmap and host inventory                                                                                            | Device coverage                                                         | Current release coverage                                                                                                | Regenerate; no hand-merged generated content.                                                                                                                                                                                                                                           |

## Follow-up integration repairs

- Command registration checks now resolve the actual tuple/Object.entries arrow
  bindings and the invoked schedule/vault factories, including recording IDs.
  Missing factory calls are exercised as negative cases; no command is inferred
  merely from an unused helper file.
- Production generation proof retains its dedicated context key and now covers
  release `design/` inputs and `CHANGELOG.md`; changing either invalidates it.
- The browser source graph keeps group-valued technical words out of eager
  English, preserves each guarded loader's catch, and installs Devices English
  independently. All fourteen language checks remain, as separate default-deadline
  cases. Provider-only `providerText`/`acpChatGpt` move to existing account English.
- A generated browser-only constants module retains canonical `DEVICE_LIMITS`
  values only for literal fields read by the browser graph. Computed and unknown
  readers refuse the build. Node hosts retain the full canonical object.
  The Devices chunk-load failure uses the existing accessible `UnavailableSurface`
  and document reload recovery, preserving the original catch and lazy boundary.
- Cycle roots include the actual Devices UI and both QR dynamic entrypoints.
  Gotcha definitions preserve the release's G60/G61 identities; accepted Vitest
  records become G95/G96, with references updated in the plan. Duplicate
  definitions are folded into the existing rule, and receipt references are
  marked as references rather than new rules.
- Regression expectations preserve 0.17.1's `acceptEdits` label and its permitted
  extension-bearing `NUL.txt` resolved-path policy. Ready-handshake guards now
  include `devicesReady` without changing the other three surfaces.

## Verification

The pre-merge typecheck exposed fixture adaptations: paid hook daily budgets
now use `usdAmountSchema`, the unbound paid-consent probe uses the unchanged
`voice` request, and the phase-2 UI tests import the relocated currency
formatter. The worktree initially contained SDK 1.3.0 while the merged lock
pins 1.4.4. `npm ci --ignore-scripts --no-audit` installed all 903 pinned
packages into a private `$TMPDIR/portm100-deps-*` directory (exit 0); the
original hard-linked install is preserved at
`$TMPDIR/portm100-deps-*/original-node_modules`. Initially linking the private
install exposed dependency paths outside the repository in esbuild metafiles,
so the fresh install was copied to this worktree's regular `node_modules`
directory, with the private copy retained until final cleanup. No original
shared/hard-linked dependency bytes were modified and no dependency version or
gate changed. The repository's dependency ignore stays unchanged.
Repository hooks were installed again
using `scripts/install-git-hooks.mjs`.

Pre-merge `npm run typecheck`: exit **0**, all five projects (host, webview,
unit, e2e, integration), merged lockfile install, macmini. Follow-up receipts
are appended after the commands run.
Follow-up `npm run typecheck`: exit **0**, all five projects. Eight deliberate
regressions produced exit **1**, then restored original file SHA-256 exactly:
combined Devices/document identity; dedicated generation key; design input;
changelog input; group-valued technical words; computed limit reads; unknown
limit reads; unsupported whole-object limit binding. Logs and full restoration
hashes are in `temp/portm100/all-drill-results.json`. Command registration also
removes each factory call in an in-memory source and verifies its commands
are absent; every fourteen-language table check still runs at the default deadline.

Full aggregate `npm run quality`, coverage, hosted CI and four-machine
qualification are delegated to the lead by this lane's explicit brief and
shared rules; they are not claimed as passed here. Vitest runs select at most
three complete files, `--maxWorkers=3`, repository-default timeouts.

## Ordered switch-on prerequisites

1. Bind lane K's owner/vault, setup/action authority and M96 source/execution,
   policy and exact approved snapshot ports. The production
   `unboundDeviceLanePorts` refusal remains; no new listening or execution is
   enabled by this port. M109 existing in the base alone is not this binding.
2. Qualify native worker and storage paths on their actual platforms:
   Windows protected storage/job helpers and interactive-session heap behavior;
   Linux systemd/cgroup/power inhibitor; macOS Aqua/launchd/process membership
   and sleep assertion. Retain uncertainty until local whole-membership proof.
3. Lead runs the installed-host and paired-device qualification on Windows PC,
   Kubuntu VM, Mac mini and Win11 VM: lazy/off zero traffic, mutual fingerprint
   confirmation, QR/manual pairing, opt-in mDNS, approved snapshot/offer,
   disconnect/reconcile/replay/cancel/results and owner/grant isolation.
4. Lead supplies D140 concrete executors, exact-payload approval UI and
   printer/CNC/MCU simulator receipts before offering physical actions.
   Simulator receipts never qualify real hardware; no unattended actuation.
5. Lead completes joined aggregate/coverage/accessibility, hosted and
   cross-platform package gates, then explicitly authorizes the supported slice
   and updates `unshipped` entries. Each owner enables Devices and any discovery,
   compares fingerprints on both machines, approves repository/base/offer and
   the scoped OS listener/firewall permission, and approves paid uses locally.
   Remote/web/ACP/headless hosts retain separate host/key-location qualification.

Merge checkpoint: **`143667fbd8ea0b3927f2e92e18264dfb2cf2c963`**, parents
`1630f022d` and `35d7b6f`. Hooks passed ESLint/Prettier and gitleaks
(44.52 MB, no leaks). The shell wrapper then hit zsh’s read-only `status`
variable; the commit itself succeeded and its two parents were verified.
