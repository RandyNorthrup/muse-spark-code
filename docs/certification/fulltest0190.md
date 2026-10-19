# FULLTEST 0.19.0 — full unit suite on the joined trains + limits tree

Lane: FULLTEST (`test/0190-fullsuite`), worktree `/home/randy/lanes/FULLTEST`.
Base: main join `33b5b11126` (release/0.19.0, trains + limits groups merged).

## Build repair (join defects, fixed in this lane)

### 1. CHANGELOG 0.19.0 over the What's New decode bound

- Symptom: `npm run build` failed: `CHANGELOG.md 0.19.0: its release notes
decode to 102794 bytes, over the What's New bound of 76800 bytes`.
- Cause: the trains group grew the 0.19.0 section to 91779 bytes (measured
  per revision with `scripts/lib/whatsNewContent.mjs`: pre-join base 24557,
  trains tip 91779, limits side 33746, join 102794). 24 bullets duplicated
  already-released 0.18.0/0.17.2 entries verbatim (proven: identical text in
  the released sections; same change landed on both sides, e.g. `a4adb8b2e1`
  on release, `98b2b00d5a` on trains).
- Fix: deleted the 24 duplicates from 0.19.0 (they stay documented under
  their release), condensed the rest without dropping a change, merged the
  doubled `### Changed`/`### Added` headings. Envelope now 75751 bytes.
- Proof: `npm run build` passes the What's New step; `changelogVersion`,
  `whatsNew*` suites green.

### 2. dist/modelApi.js 1.7 KiB over its 525 KiB cap

- Symptom: `OVER dist/modelApi.js: 526.7 KiB (budget 525 KiB)`.
- Cause: legitimate feature growth from both groups on a bundle the trains
  join left 36 bytes under its cap (trains tree measured 537564/537600).
  Per-input metafile deltas trains→join: transport +958, timeouts +388,
  retryPolicy +304, ModelApiHost +220, entry +103, tools +100, goals +46.
  No dead code found (removed limit constants are fully gone).
- Fix (D6 diet, cap unchanged): `ObservationPack` + spill paging load with
  `dist/modelApiTools.js` on the first packing turn (`ensurePacking` in
  `runTurn`; resume/fork ledgers replay from the existing fallback fields;
  load failure fails the turn, never a silent skip). Packing-only model
  text moved to a new `PACK_MODEL_TEXT` block (both bundles declared
  readers). modelApi.js now 522.8 KiB; modelApiTools.js 32.0/50 KiB.
- Proof: `npm run build` (size + split gates), `invariants`,
  `autoCompact`, `bundleDiet` suites green.

### 3. dist/legalScan.js 216 bytes over its 150 KiB cap

- Symptom: `OVER dist/legalScan.js: 150.1 KiB (budget 150 KiB)`.
- Cause: PR #214 abort-responsiveness growth (scan +242, workspace +149).
- Fix (D6 diet, cap unchanged): the header-fix planner loads as
  `dist/legalFix.js` (75 KiB budget, measured 64.9 + 15%) on the first scan
  with a fixable finding or the first fix request; a scan that needs it and
  cannot load it is refused naming the cause. legalScan.js now 143.1 KiB.
  Shared yield helper (`scanYield.ts`) saved a further ~70 bytes.
- Proof: `npm run build` (size + split + registry gates); packed
  `muse-spark-code-acp legal` on a fixture project reports `fixable:true`
  with the chunk present and `The legal scan failed: Cannot find module
'.../dist/legalFix.js'` with it removed; three new `legalScan` cases.

## Shard results (repo default timeout, `--maxWorkers=3`)

CI runs `npx vitest run --shard="$SHARD/$SHARDS"` (Ubuntu: 4 shards) with
no `--testTimeout` (repo default 5 s per test; Windows-only 15 s override
in `vitest.config.ts`). The repo caps workers at 3 (`MAX_TEST_WORKERS`),
so `--maxWorkers=3` here matches CI. The shard glob covers
`test/unit/**` AND `test/e2e/**` (config `include`), so e2e files run
inside unit shards on CI too.

### Shard 1/4

- 117 files, 11957 tests → 3 failed, all in `test/unit/manifest.test.ts`
  (records F1–F3 below). After the fixes: `manifest.test.ts` 40/40 green.

### Shard 2/4

- 117 files, 1757 tests → 2 failed: `cx1r2Truth` two-newest budget
  (record F4) and `sharingArtifacts` exec-schema drift (record F5). After
  the fixes: `cx1r2Truth` + `cx1r4Truth` 23/23 green, `sharingArtifacts`
  1/1 green.

### Shard 3/4

- 20 failed: `modelTextCompression` ×1 (record F6, fixed), the
  `connectorStdio` kill-switch case ×1 (record F7, fixed by split), and
  `inspectNative` ×18 (record F8, lane-sandbox-only, no code change).
- After the fixes: `modelTextCompression` 2/2 green; the whole
  `connectorStdio` file 7/7 green (slowest split case 2232 ms).
- Full re-run after all fixes (`temp/shard3b.log`): 110 passed files,
  1599 passed tests; only `inspectNative` fails (F19 hook-timeout
  variant this time) plus the `browserUiText` flake (F18, since fixed).
  `browserUiText` re-run after its split: 26/26 green.

### Shard 4/4

- 17 failed (records F9–F17 below): `l10nPackParity` hook ×1, `Palette`
  ×1, `attachments` ×1, `cliReference` ×1, `legalReceipts` ×1,
  `legalScan` ×1, `legalTextMatch` ×4, `nativeGitPullRequestReads` ×1,
  `outputSchema` ×1, `paletteRegistry` ×1, `planReader` ×2,
  `teamConstants` ×2.
- After the fixes: every touched file re-run green (slowest margins:
  attachments case 5 ms, cliReference case 187 ms, GPL property case
  ~240 ms, l10n hook ~2 s vs 30 s).
- Full re-run after all fixes (`temp/shard4b.log`): EXIT 0 — 115 files
  passed (1 skipped), 3029 tests passed, 0 failed.

## Failure records (cause → fix)

### F1. manifest: Tab budget defaults stale (real test defect, fixed)

- The Tab budget test expected default 1 / min 0.05 / max 50; the
  NOLIMITS5 decision (`9425bf555d`) makes them 0 / 0 / no-max. Updated
  the test to the decided values.

### F2. manifest: `modelApiMaxRetries` machine scope unregistered (real defect, fixed)

- `package.json` already scopes the setting to machine, but
  `MACHINE_SCOPED_SETTINGS` lacked it. Added it to the registry.

### F3. manifest: CIFLOW checks missing from build.yml (real defect, fixed)

- `quality:gates` runs `check:usable-reply` and `check:wrap-up-request`
  but the `build.yml` checks job did not list them. Wired both into the
  workflow; both scripts pass.

### F4. cx1r2Truth: two-newest release-notes budget (real join defect, fixed)

- 77688 > 76800 bytes. Trimmed the release notes; the truth suite passes.

### F5. sharingArtifacts: exec-schema drift (real join defect, fixed)

- Schema said `maxRequests` 1–MAX_SAFE_INTEGER; the limits side caps
  1–500 (`EXEC_MAX_REQUESTS` in `execArgs.ts`). Reproduced on the
  pristine join base, then regenerated via `node scripts/exec-schema.mjs`.

### F6. modelTextCompression: stale representative key (real join defect, fixed)

- Symptom: `expected 'var i=Object.defineProperty;…' to match
/[{,]verifyUncheckedCodeLoading:/`.
- Cause: the verify-split train (`0d66936899`) moved
  `verifyUncheckedCodeLoading` from the compressed bundle into the new
  `VERIFY_MODEL_TEXT` block but left the spot-check naming it. Fails
  identically on the pristine join base (`33b5b11126`); not caused by
  this lane's bundle splits (the key sits in `VERIFY_MODEL_TEXT` on
  base and on this tree).
- Fix (`ccc3fefe1f`): the spot-check now names `continuationPrompt`,
  which still ships in the compressed bundle. The test drives the real
  esbuild plugin: 2/2 green.

### F7. connectorStdio kill-switch case: 5 s timeout (real test defect, fixed)

- Symptom: `Test timed out in 5000ms` in-shard; focused repeats measured
  2747 ms → 4675 ms → 5546 ms (timeout) on an otherwise idle 8-CPU rig:
  flaky against the repo timeout on ANY machine, including CI's shared
  runners (e2e files run inside CI unit shards).
- Cause: one case booted four sequential full agent processes over real
  stdio. Setup was already shared (`beforeAll`); the per-case process
  count was the cost. No timeout raised (brief §4).
- Fix (`39c019004a`): split into two cases keeping every assertion,
  following the file's own RVMSM124 split precedent. `resume`/`grant`
  refuse on the terminal check before reading kill state (proven in
  `src/runtime/connector/command.ts`), so the widening half needs no
  kill switch. Whole file: 7/7 green, slowest split case 2232 ms.

### F8. inspectNative ×18: confine helper refuses every system program (lane-sandbox-only, no change)

- Symptom (all 18, e.g. `runs verified cat`): exit 125 with
  `{"refused":"systemFile"}`; every downstream assertion (canaries,
  exclusion lists, B1-10/13/14, budgets, root binding, self-tests)
  cascades from the same refusal.
- Cause: `native/confine/MuseSparkConfine.c` `system_file()` admits only
  root-owned, non-writable system files (`s.st_uid` must be 0). On this
  lane's rig the whole system tree is owned by `nobody`:
  `stat -c '%u %U' /usr/bin/cat /usr/bin /usr` → `65534 nobody` on all
  three (caller is uid 1000 `randy`, so the writable-ancestry clause is
  not the trigger; ownership is). `/bin/cat` resolves to
  `/usr/lib/cargo/bin/coreutils/cat`, also `nobody`-owned.
- CI env: the `unit` job runs `runs-on: ${{ matrix.os }}` →
  `ubuntu-latest` (GitHub-hosted, root-owned `/usr`), where verification
  passes and the helpers run. The refusal is fail-closed by design
  (exit 125), so the product is correct; only this sandbox's ownership
  differs.
- Not this lane's change: the identical single-test repro fails on the
  pristine join base (`33b5b11126` in `$TMPDIR/join-base`):
  `AssertionError: cat: {"refused":"systemFile"}`, 1 failed / 21 skipped.

### F9. l10nPackParity hook: 30 s hook timeout (real test defect, fixed)

- Symptom: `Hook timed out in 30000ms` in `beforeAll`, in-shard only.
- Cause: the hook packed the solid 14-locale runtime archive at the
  production brotli quality 11: ~20 s focused against its own 30 s
  `PACK_SETUP_TIMEOUT_MS`. Measured per step (`temp/l10nprobe.mjs`,
  since removed): `loadL10n` 0.4 s, pack 19.9 s.
- Fix: `packRuntimeArchive` takes an optional compression quality
  (production callers keep the default 11); the parity hook packs at
  quality 1 (~0.5 s). The cases assert decoded tables, which are
  quality-invariant, so no assertion changes. Hook now ~2 s vs 30 s;
  file 14/14 green.

### F10. attachments oversized image: 10M-element spread (real test defect, fixed)

- Symptom: `refuses unsupported bytes…` timed out in-shard; 3649 ms
  focused.
- Cause: the fixture built the over-limit PNG with
  `...Array.from({ length: 10_485_760 }, () => 0)`. The product checks
  `byteLength` before decoding (`addImage`), so the body is never read.
- Fix: a header-shaped `new Uint8Array(MAX_IMAGE_BYTES + 1)` buffer —
  same path, same `'10 MB'` reason. Case now 5 ms; file 19/19 green.

### F11. cliReference: cold catalogue build (real test defect, fixed)

- Symptom: first case timed out in-shard; 3066 ms focused.
- Cause: `buildReference` costs ~1.2–2 s cold (JIT) and ~0.11 s warm
  (measured); the first case paid the cold build.
- Fix: `beforeAll` warm-up build (result discarded), the brief's
  prescribed shape. Case now 187 ms; file 2/2 green.

### F12. legalScan build-evidence cases: missing named timeout (real test defect, fixed)

- Symptom: the `000` case timed out in-shard; 1.4–1.6 s focused on this
  tree and on the pristine join base (my `scanYield` extraction did not
  slow it: base 1636 ms vs tree 1429 ms).
- Cause: these scan the same 20 000 files as the cap case that already
  carries the sanctioned `LEGAL_CAP_SCAN_TIMEOUT_MS` (15 s, PLAN.md
  §8), but lacked it. No timeout raised: the file's own mechanism,
  extended to sibling cases doing identical work.
- Fix: the `it.each` carries `LEGAL_CAP_SCAN_TIMEOUT_MS`. File 25/25.

### F13. legalTextMatch property cases: ten long reads per case (real test defect, fixed)

- Symptom: 4 GPL cases timed out in-shard; 1.4–2.4 s focused each.
- Cause: each case looped ten ~200 ms template alignments (template set
  already memoized — cost is inherent volume, not waste).
- Fix: cartesian `it.each` rows (one read per case) over the identical
  seeded inputs (same RNG stream order). Slowest GPL case ~240 ms;
  file 637/637 green.

### F14. nativeGit Infinity deadline: 0 ms kill (real PRODUCT defect, fixed)

- Symptom: `git commit timed out after 0 ms` for a 1.2 s hook under
  `Infinity`.
- Cause: `createGitRunner` mapped `Infinity → 0` (Node execFile's
  no-timeout sentinel), but its only execFile dep now uses the custom
  spawn, where `0` fires the timer at once. The stale comment cited the
  old route.
- Fix (`3e7d42d37b`): omit the deadline for `Infinity`, so the run waits
  for git or the abort. Drives real git with a real 1.2 s hook: 8/8;
  `gitNoKill` 3/3, `nativeGitCore` 28/28 green.

### F15. paletteRegistry: stale effort tiers (real test defect, fixed)

- Symptom: slider offered `[…, 'max', 'ultra']`, test expected five
  tiers. Reproduced on the pristine join base.
- Cause: the REASONSHAPES per-model effort tiers added `Ultra` to
  `EFFORT_LEVELS`; the expectation was not updated with them.
- Fix: expect the six-tier range. File 49/49 green.

### F16. teamConstants: join-dropped NOLIMITS1 hunk (real join defect, fixed)

- Symptom: `TEAM_ENGINE_HARD_CEILING`/`TEAM_DELEGATE_MAX` are
  `undefined` (expected 20/6).
- Cause: NOLIMITS1 A28 (`f345149261`) removed both invented ceilings
  AND updated this file, but the main join kept the trains side of the
  test against the limits side of the constants. `teamCeilings.test.ts`
  already matches the limits side (verified: empty diff).
- Fix (`5578fa6e48`): replayed the limits side's hunk verbatim.
  `teamConstants` + `teamCeilings` 50/50 green.

### F18. browserUiText all-locales case: 4.5 s focused (real test defect, fixed)

- Symptom: `checks every installed language…` timed out in the shard
  re-run (it had passed the first shard-3 run — flake); 4474 ms
  focused.
- Cause: fourteen full-table validations (parse + two shape walks +
  embedded install each) in one case.
- Fix: one locale per `it.each` case plus one case per broken shape
  (indices, since the tables need the `beforeAll` fixture; a length
  guard pins the shape count). Slowest case ~569 ms; file 26/26 green.

### F19. inspectNative re-run variant: beforeAll hook timeout (same sandbox story, no change)

- The shard-3 re-run showed `Hook timed out in 10000ms` in `beforeAll`
  (ten sequential `cc -O2` compiles + esbuild under load 12+) instead
  of the `systemFile` refusals: all 22 tests skipped. Same rig-only
  cause as F8 (contention rather than ownership this time); on a
  single-tenant CI runner the hook takes seconds.

### F17. Load-only records (no code change; green focused, CI single-tenant)

Rig load during the shards: 12–16 on 8 CPUs (10 users); CI Ubuntu
runners are single-tenant. Each case below passes focused with headroom
and failed only under that contention:

- `Palette` models-view grouping (waitFor): 174 ms focused vs 5 s.
- `legalReceipts` receipt-too-big: 1184 ms focused vs 5 s.
- `outputSchema` recursive-union probe: 261 ms focused vs the 1500 ms
  probe watchdog (spawn starvation under load, not a blocked loop).
- `planReader` 10k milestones / folded status: warm min-parse 112 ms
  vs the 200 ms `REPORT_PLAN_BUDGET_MS` (cold-JIT runs hit 300+ ms;
  `fastestRun` min-of-3 absorbs it when not oversubscribed 3–4×).

## Gates on the final tree

- format: `npm run format:check` green (one `prettier --write` on this
  record itself).
- eslint: `npm run lint:js` exit 0, zero warnings. Note: the first full
  run reported 53 632 errors, all in this lane's own `temp/` scratch
  (measure scripts, probe bundles, `temp/confine/` test output). CI
  runs lint before tests, so `temp/` is empty there; the scratch was
  removed (shard evidence logs kept — `.log` files are not linted) and
  the re-run is clean. `lint:css` green; `lint:ps` skips off-Windows.
- typecheck: all five (`host`, `webview`, `unit`, `e2e`, `integration`)
  green.
- touched suites, all green on the final tree: `manifest` 40/40,
  `cx1r2Truth` + `cx1r4Truth` 23/23, `sharingArtifacts` 1/1,
  `modelTextCompression` 2/2, `connectorStdio` 7/7, `legalScan` 25/25,
  `legalTextMatch` 637/637, `nativeGitPullRequestReads` 8/8,
  `gitNoKill` 3/3, `nativeGitCore` 28/28, `teamConstants` +
  `teamCeilings` 50/50, `paletteRegistry` 49/49, `attachments` 19/19,
  `cliReference` 2/2, `l10nPackParity` 14/14, `browserUiText` 26/26,
  plus `planReader`, `outputSchema`, `Palette`, `legalReceipts`
  focused (unchanged).
- build: `npm run build` exit 0, all bundle budgets and legal records
  green (95 bundles, 1997 files, 0 problems).
- Full shards on the final tree: 3/4 → only `inspectNative`
  (sandbox-only F8/F19); 4/4 → EXIT 0, 3029 passed, 0 failed. Shards
  1–2 need no re-run (no shared-module change since their runs).
