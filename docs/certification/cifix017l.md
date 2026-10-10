# CIFIX017L: 0.17.0 CI reds on Linux and macOS (run 37950960680)

Lane: rel017/cifixl from 8f0a75ea1. All results are from kubuntu (Linux,
10 cores, shared with other lanes) at the repository's default timeouts
(5 s per test, 10 s per hook) unless a case names its own bound.

## Root causes and fixes

| Failure                                                                        | Root cause                                                                                                                                                                                                        | Fix                                                                                                                                       | Commit               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| cyclesRoots (all OSes)                                                         | resourceProcessEntry, fileSessionStoreEntry, mcpVaultEntry (build entries), mcpJobLaunch (lazy target) and test/harness/schedules.mjs (knip entry) were not dpdm roots                                            | Added to the `cycles` roots; dpdm finds no cycle                                                                                          | 0095f2b49            |
| flightRecorder R2 (all OSes)                                                   | The package is right: .vscodeignore ships dist/mcpVault.js and dist/resourceProcess.js. REPORT_PACKAGE_FRAME_PATHS was stale, so crash reports dropped frames from those bundles                                  | Both registered as frame paths                                                                                                            | a2c17c02b            |
| acpStdio e2e, 4 tests (Linux, macOS)                                           | The agent answered `spawn <package>/native/linux/x64/muse-created ENOENT`: every governed launch makes its temp root through the created-path helper the real package ships; the fixture laid out only JavaScript | The fixture compiles the reviewed MuseSparkCreated.c (an argv shim stands in for muse-dictate on macOS)                                   | 1b2edceca            |
| acpStdio on a umask 002 desktop (found on this rig)                            | The creation registry refuses a group-writable parent; the agent kept its manifest straight in its data folder, which takes the user's umask (0775 on Ubuntu desktops)                                            | Registry in its own `resource-created/` folder, created 0700                                                                              | 7811ad68d            |
| nativeScheduleBackground (ubuntu)                                              | The test's fixture verifier refused every symlink; systemd 255 lists /etc/xdg/systemd/user, a root-owned link on Ubuntu 24.04. Product order (manager's search order, first untrusted refuses) is right           | Fixture trusts a root-owned link exactly when its target and parent chain are                                                             | fe0dbf5de            |
| modelsMoneyLifecycle (ubuntu)                                                  | Test race: release() waited one tick, then findByRole's 1 s; resolving the chunk's imports on a loaded runner outlasts it. The product shows the alert once the import fails                                      | release() awaits the document's money load inside act                                                                                     | 5a80ad271            |
| visualCapture CSP test (ubuntu), visualCapture / visualStability hooks (macOS) | Every capture run rebuilt the same fixture bundles and notes (~1.1-1.4 s here)                                                                                                                                    | Built once per process, kept in memory, written per origin                                                                                | 75377a769, 439c7744c |
| slashCommandsBundle beforeAll (macOS)                                          | A second full production build (8.9 s here; timed out at 10 s here too)                                                                                                                                           | Its one test moves into webviewBundle, which already owns a build                                                                         | 73a011228            |
| webviewBundle, 2 tests (macOS)                                                 | Each spawns check-bundle-split.mjs, which re-parsed the same metafiles on every inputsOf() call                                                                                                                   | Metafiles parsed once (3.1 s -> 2.4 s, byte-identical output); the two gate-spawning tests get a named 20 s bound (SPLIT_GATE_TIMEOUT_MS) | 73a011228            |
| m114Panel (macOS)                                                              | Each page parsed a 1.2 MB unminified fixture (~340 ms a page)                                                                                                                                                     | Minified (~170 ms); the test's two pages open together: 1133 -> 519 ms                                                                    | 619d7fa0e            |
| m114ConversationReview, 6 timeouts (macOS)                                     | Each fixture page parsed a 2.4 MB unminified fixture (~650 ms)                                                                                                                                                    | Minified: axe cases ~0.8 s, forced-colour cases 2.2 -> 1.7 s                                                                              | 18c98674e            |
| m114Audit, readmeShots (all OSes)                                              | 7973a33ac and 8f0a75ea1 changed audited sources and README pixel inputs                                                                                                                                           | Audit source hashes refreshed; README shots recaptured (10 changed, 9 pixel-identical left) and the input digest refreshed                | 0dc991d18, c57483c17 |

## Drills

- acpStdio umask regression: the e2e makes the agent's data folder 0775.
  Before 7811ad68d it fails 4 tests ("Unsafe creation registry ownership or
  permissions"); after, 13/13 under umask 022 and 002.
- acpStdio helper: before 1b2edceca, 4 tests fail with the ENOENT above
  under umask 022; after, 13/13.
- nativeScheduleBackground: with `XDG_CONFIG_DIRS=/etc/xdg` (the runner's
  unit-path shape) the old fixture fails exactly as CI; the new one passes
  46/46, with and without it.
- modelsMoneyLifecycle: a 1.5 s delay injected into the mocked chunk fails
  4/5 cases with the old release() (the failure case with the CI symptom)
  and 0/5 with the new one. Injection reverted.
- check-bundle-split memo: the mutated-metafile test still sees the gate
  refuse (exit 1, the governor message).

## Not fixed here

- **New release blocker:** after dff9a9965 (CHANGELOG 0.17.0 entries moved),
  dist/whatsNew.json's decoded JSON is 79,510 bytes, over
  WHATS_NEW_CONTENT_DECODE_MAX_BYTES (75 KiB). `node scripts/build.mjs`
  fails ("That did not work") and whatsNewContent.test.ts "keeps both
  complete releases identical" fails. Trimming the notes or raising the
  bound is the owner's call. The visual suites above were verified with a
  local, uncommitted 80 KiB bound, then restored byte-exact.
- `npm run duplication` reports one clone in windowsTrustedPath.test.ts
  (206-211 vs 279-284), outside this lane.
- modelApiHost's two macOS failures run in 80-130 ms here, with coverage
  too; nothing slow in them, so no change: they need a Mac measurement.
- m114ConversationReview's three macOS assertion failures (.tool-toggle
  outline 3px, .steps-toggle pressed image equal to hover) do not reproduce
  on Linux.
