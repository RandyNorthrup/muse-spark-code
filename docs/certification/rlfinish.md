# RLFINISH — partly shipped milestones, recovery lane record

Branch `rec/rlfinish`, worktree on MINI-DT (the owner's Windows PC),
2026-10-22. Base: main at 0.19.0 (`f3941b8548`). The brief: land the
remains of M101, M112, TOOLROUNDS, M127, M94, M80 and M105 with
real-code tests and at most 20 counted live calls on
`muse-spark-1.3-contributor`.

Live calls made by this lane: 0. Every live row the brief names needs
the owner's key and spend decision plus lead dispatch, so they are
recorded below as open owner/lead items with their expected counts,
not run.

## What landed

### TOOLROUNDS — D109 correction, Windows leg green

- D109's text no longer names a 200 default: the default was removed
  under D121/D208, and the plan says the caller allowance only.
- Round 9 (Windows leg of cross-platform certification) ran green;
  two symlinked-directory cases hit this account's EPERM limit and
  stay with hosted CI. Record: `docs/certification/toolrounds.md`.
- Linux and browser legs stay hosted-CI-owned.

### M101 — lanes C2, O, T, E and the signature/replay blockers

- The three blockers closed with real-code tests
  (`test/unit/configuredReplayOrigins.test.ts`,
  `test/unit/replayOrigins.test.ts`, `test/unit/capabilityRecord.test.ts`,
  `test/unit/sessionStore.test.ts` — all green, see gates).
- The lane's duplication pass folds the codec tests' first-turn
  bodies onto one shared builder
  (`test/unit/helpers/turnBodies.ts`).

### M127 — SDK 1.4.11, remaining wraps, UI for the new reads

- `@muse-code/sdk` 1.4.10 → 1.4.11 under a one-shot minimum-age
  override (installed 3 days under the 7-day rule); `.npmrc` untouched.
- Wraps with capture tests (`test/fixtures/m127/`, 10 fixtures):
  session/leave, skill activation, workflow controls, computer-use
  reads. `test/unit/museCodeLatest.test.ts`: 52 green.
- UI: task, hook and plugin panels plus the History recap
  (`SessionListsDialog`, `HistoryDialog`, `HistoryPromptRow`;
  `ui:look -- session-lists` in light and dark). Recap button only
  when `canRecapSessions`; failure posts inline `outcome:failed`.
- The duplication pass folds the list-row schemas onto the shared
  tables (`backgroundTaskRowSchema`, `sessionHookRowSchema`), the
  setup reads onto `toComputerUseSetup`, and the child-control
  refusal into its siblings' case.

### M94 — output cap, spend-gate and hooks suites, catch pass

- Acceptance 6: the output cap is the person's
  `museSpark.tabMaxOutputTokens` setting (0 = the record maximum),
  resolved via `ModelApiClient.recordMaxOutputTokens()`; the TAB_*
  caps are deleted.
- Spend-gate and hooks real-code suites
  (`tabSpendGate.test.ts`, `tabHooks.test.ts`): the settle pins the
  reservation day, hooks stay fail-closed.
- Catch pass: the engine's stream read returns its failure as an
  outcome (`readStream`, REPORTED), and a crashing scheduled run
  reports through the work's own `report` channel instead of hanging
  (REPORTED). GENERIC 267 → 266, CLEANUP 235 → 234; baseline
  regenerated with only those two identities removed.
- Open: the live check (~3 calls), the remaining acceptance rows,
  and the acc-19 shim note (10.336 KiB attributable vs the 4 KiB
  ambition — a lead follow-up, not committed here).

### M112 — extension-host test green on both versions

- `test/integration/questions.test.ts` (the real panel) green on
  stable and minimum. The minimum-version failures are the
  activation/focus cases in `extension.test.ts`, measured
  pre-existing on the untouched base `f3941b8548`.
- Open: the 2 live checks (owner key + lead).

### M80 — packaged-CLI rehearsal green

- From a clean install: `test/hosts/exec.sh` 18/18 and the secret
  scanner on both builds. The scanner's silent second case is the
  by-design exit-only refusal.
- Open: hosted matrices and the L/LA/LR receipts (CI runs and owner
  dispatch; no worktree can do them).

### M105 — R2 Windows host-deps factory, unbound

- `src/host/media/windowsRecorderDeps.ts`: compiles the shipped
  `native/windows/MuseSparkScreenRecord.cs` with the inbox compiler
  into locked storage, revalidates before each launch, spawns
  directly with a credential-free environment, reserves the
  `muse-spark-screen-` namespace, and inspects with M1's sniffer.
  The C# joins `JOB_SOURCE_FILES` as standalone (no job half).
- `test/unit/windowsRecorderDeps.test.ts`: 8 green against the real
  helper — prepare, trust, probe, `available()` agreeing with the
  binary's own `--probe` (this rig answers ready, exit 0), launch
  port with line buffering, reserve/remove, inspect of a real MP3,
  refusals, and the framer's latch.
- Diagnosis kept: the default governed runner fails in unit-test
  context (`Resource admission unavailable`), so the factory spawns
  directly like the converter's trust probes.
- `test/unit/windowsScreenRecorderNative.test.ts`: 40 green,
  including the migrated shared storage lockdown
  (`lockWindowsStorageDir`).
- No entry point wires the factory. Binding, macOS/Linux drivers
  and owner-device receipts stay lead and owner steps.

## Red/green drills

Each: break on purpose, non-zero exit, exact restore, green. The
tree was byte-clean (`git diff --stat` empty) after every restore.

1. Scheduler crash report removed (`work.report(error)` → `void
error`): `tabScheduler.test.ts` red, exit 1
   (`temp/drill1-red.log`); restored; green, exit 0.
2. Framer drops every line (`push` → `[]`):
   `windowsRecorderDeps.test.ts` red, exit 1
   (`temp/drill2-red.log`); restored; green, exit 0.
3. Stream outcome lies (`{ ok: false, cause }` → `{ ok: true }`):
   `tabEngine.test.ts` red, exit 1 (`temp/drill3-red.log`);
   restored; green, exit 0.
4. Duplication: `npx jscpd` found 5 exact clones (58 lines) in the
   lane's M101/M127 work, exit 1; after the dedupe phase, no
   duplicates, exit 0 (`temp/jscpd3.log`).
5. Catches: `npm run check:catches` failed on the lane's new
   `tabEngine.ts:229` GENERIC and `tabScheduler.ts:49` CLEANUP,
   exit 1 (`temp/catches.log`); after the fixes and the lowered
   baseline, all sites match, exit 0.

## Gate exit codes (final tree)

- prettier --check (113 touched files, then the 6 record files): 0
- eslint --max-warnings 0 (61 lintable touched files): 0
- typecheck (all projects): 0
- check:l10n: 0
- check:reference: 0
- check:host-api: 0 (record regenerated for the recorder's node imports)
- check:plan: 1 — PLAN.md is 3,567,452 bytes, 2,294 over the 85%
  bound. The file entered the lane 1,567 under; the brief-mandated
  dated status lines cannot honestly fit in the remaining room, and
  the sanctioned archive needs lead-scale merge proofs across ~40
  open branches. Lead item, not weakenable here.
- check:roadmap: 0 (regenerated; fingerprint only)
- check:catches: 0
- duplication (jscpd, 0 clones): 0
- cycles: 0
- deadcode: 0
- build: 0 (after removing this rig's stale `dist/` metafiles and
  `.vscode-test/` downloads — both regenerable — and regenerating
  the lazy registry minus 3 phantom harness rows)
- SAST: 2 — tool failure, not a finding: `semgrep-core exited with
code 1`, `rule validation failed`; the `semgrep` binary itself
  errors (precedent: MSM105's rig-block note). Lead runs it outside.
- security:audit: 0
- vitest related (39 changed sources): exit 1 — 744 files, 22,290
  tests; the only 8 failures are environmental, none in lane code:
  6 EPERM-symlink (this account cannot create symlinks; the brief
  leaves these to hosted CI), 1 Windows MAX_PATH refusal in
  lintStagedBatching, 1 vault pipe `No access` refusal. The related
  run pulled 2 vault files transitively; both failed before any
  store write (socket-path checks and broker discovery refusal).
  No vault suite is rerun here.
- Suites: museCodeLatest 52, windowsScreenRecorderNative 40,
  tabScheduler 7, tabEngine 5, windowsRecorderDeps 8, responsesCodec
  56, ollamaCodec 40, sessionListsDialog/historyRecap/sessionStore/
  tabHooks/tabSpendGate/tabConstants/tabOutputSetting/tabRequest/
  replayOrigins/capabilityRecord/configuredReplayOrigins (10 files,
  106 tests) — all green, exit 0.
- Integration (M112, real panel, both VS Code versions): green;
  minimum-version activation/focus failures measured pre-existing.
- Not run here: vault suites (forbidden on this PC until
  RLVAULTANCHOR), hosted CI, live model rows (0 calls made).

## Commits (oldest first)

- `4ff9bc9e4d` docs(plan): D109 states no turn-call default
- `4b64fbd97d` docs(toolrounds): round 9 Windows leg green
- `fe2fd4012a` feat(m101): the three signature and replay blockers
- `c35398af5e` feat(m94): Tab pacing (acceptance 9)
- `aa427d2a6e` feat(m94): never abort a sent request (acceptance 7)
- `eeef77245e` feat(m94): output cap setting (acceptance 6)
- `483419eb9f` test(m94): spend-gate and hooks suites
- `4a786a16c6` deps(m127): SDK 1.4.11
- `b9a89b4bf7` feat(m127): remaining wraps
- `bba5ba7e37` feat(m127): UI for the new reads
- `d301e152e6` chore(rlfinish): duplication clones cleared
- `5de5c7b9a5` fix(m94): Tab catch fixes + baseline
- `40ee0ac7f3` feat(m105): R2 Windows factory (unbound)
- (records commit follows: PLAN lines, CHANGELOG, ROADMAP, this file,
  host-api record, lazy registry)
