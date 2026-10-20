# DEPSFINAL1 certification — dependency PRs #169, #194, #195, #215 on the joined 0.19.0 tree

Worktree `/Users/user/lanes/DEPSFINAL1`, branch `release/0.19.0-depsfinal1`,
base `ace760a0b7` (release join head). Rig `macbook` (darwin arm64).
Base-cause proofs ran in a clean worktree of `ace760a0b7` at `$TMPDIR/base-check`
(own `npm ci`), removed after use. Raw per-shard logs in worktree `temp/`
(gitignored, not committed): `temp/mshard-<1..16>.log`, `temp/g-*.log`,
partition script `temp/shard-partition.mjs`.

## 1. Merges (one commit each, in order, hooks on)

- `96d781b68` — merge `cand/DEPSFINAL1/1` (PR #169, from `09ece70ffb`).
  `actions/setup-node` 7.0.0→7.1.0, `actions/upload-artifact` 7.0.1→7.0.2,
  `actions/download-artifact` 8.0.1→8.0.2 across `build.yml`, `hosts.yml`,
  `forks.yml`, `release.yml`, `real-use.yml`, `action-live.yml`,
  `browser-check.yml`, `browser-runtime-pin.yml`. Join-side steps kept;
  stale pins in join-added lines bumped to the same PR versions (0 stale left).
- `c9001a4a3` — merge `cand/DEPSFINAL1/2` (PR #194, from `ec9b3b36fd`).
  Production deps: `mdast-util-from-markdown` 2.0.3→2.1.0,
  `mdast-util-to-markdown` 2.1.3→2.2.0, `smol-toml` 1.9.0→1.9.1.
- `1420dc5bf` — merge `cand/DEPSFINAL1/3` (PR #195, from `b1056f4215`).
  13 dev updates (697 files in the PR): `@agentclientprotocol/sdk` 1.7.0→1.8.0,
  `@types/node` 22.20.4→22.20.5, `axe-core` 4.13.0→4.14.0,
  `eslint` 10.11.0→10.12.0, `eslint-plugin-unicorn` 76.0.0→77.0.0,
  `jscpd` 5.4.0→5.4.1, `jsdom` 30.1.1→30.1.2, `knip` 6.39.0→6.41.0,
  `playwright-core` 1.63.0→1.64.0, `prettier` 3.9.9→3.9.10,
  `stylelint` 17.15.0→17.16.0, `typescript-eslint` 8.70.1→8.71.1,
  `@napi-rs/keyring` 2.1.0→2.1.1. `package.json` versions taken from the PR;
  `src/`, `test/`, `scripts/`, `action/`, `eslint.config.mjs`,
  `package-lock.json` kept from the join side; `@napi-rs/keyring` kept in
  devDependencies with the join's `dependencies` copy bumped to 2.1.1;
  join-deleted `src/core/schedules/time/loop.ts` and
  `src/host/backend/sessionBudgetJournal.ts` kept deleted (`git rm`).
- `453d2b340` — merge `cand/DEPSFINAL1/4` (PR #215, from `c4d77223e6`).
  `.github/semgrep/requirements.txt`: `semgrep==1.178.0` → `==1.180.0`.
- `80839ed27` — lockfile regenerated with `npm install` (never hand-merged);
  unicorn 77.0.0 confirmed installed. `npm ci` afterwards: exit 0.

## 2. Lint fixes (separate commits grouped by rule; no rule off, no new disable)

Full-tree `eslint . --max-warnings=0` is 0 errors (`LINT-EXIT:0`).

- `51df260d7` — unicorn comment-asterisk style, 2579 sites (`--fix` after
  isolating the rule; type-error autofixes separated out).
- `db3cc04dd` — `unicorn/prefer-type-error`, 24 sites (hand-fixed at cause).
- `ba9fd0097` — `unicorn/no-unnecessary-array-flat-map`, 42 sites.
- `0df5c9ad7` — `unicorn/prefer-default-parameters`, 25 sites.
- `68e1467c9` — `unicorn/prefer-single-object-destructuring`, 3 sites.
- `fe9bf2903` — `unicorn/no-object-as-default-parameter`, 1 site.
- `d2e756a9e` — `@typescript-eslint/no-unsafe-argument`, 3 sites.
- `26b209072` — `unicorn/no-unnecessary-parameters`, 45 sites, plus the one
  `eslint-disable-next-line` the lane needs: `filePin` bytes/sha256 keep their
  slots because the release stamper owns them (inline reason in code +
  PLAN.md §8 `DEPSFINAL1` row, AGENTS rule 4).
- `055b9b932` — follow-on dedupe: the unnec-params reflow made `send()` and
  the retry test build the identical recorded `[call, result]` pair in
  `test/unit/invariants.test.ts`; both share `recordedPair()`. jscpd back to
  the 15 pre-existing clones (invariants 42/42 green, eslint/prettier clean).

## 3. Gates (exit codes on the lane)

| gate                                                                           | exit | note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format:check` (prettier)                                                      | 0    | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| eslint full tree `--max-warnings=0`                                            | 0    | 0 errors after §2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lint:css` (stylelint 17.16)                                                   | 0    | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `lint:ps`                                                                      | skip | Windows-only by design (darwin here); no `.ps1` touched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `check:l10n`                                                                   | 0    | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `check:badges` / `check:reference` / `check:roadmap` / `check:wrap-up-request` | 0    | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `check:tokens` (inside `build`)                                                | 0    | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm ci`                                                                       | 0    | proves the regenerated lockfile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `security:audit`                                                               | 0    | 2 advisories, 1 exception — same 2 advisories on base                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `cycles` (dpdm)                                                                | 0    | no circular dependency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `knip` (= `deadcode`)                                                          | 1    | PRE-EXISTING: byte-identical output on base (knip 6.39.0): 1 unused export `VAULT_UI_TICK_MS`, 6 config + 11 tag hints. Bump 6.39.0→6.41.0 changed nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `duplication` (jscpd 5.4.1)                                                    | 1    | PRE-EXISTING: 15 clones on base with old and new jscpd; lane briefly had 16 (my reflow) → fixed by `055b9b932`, back to the same 15. All 15 in vault/platform + vault-test files untouched by this lane                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `check:plan`                                                                   | 1    | PRE-EXISTING: PLAN.md 3,815,454 B on base already over the 85% bound (3,565,158 of 4,194,304); my §8 row adds ~1.6 KB. Archiving is the join's job                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `check:catches`                                                                | 1    | PRE-EXISTING: same count drift on base (host SWALLOW 23→21, GENERIC 123→114, CLEANUP 86→88; runtime SWALLOW 63→35, GENERIC 215→209, CLEANUP 100→127) — the vault/schedule groups landed after the baseline was generated. Lane delta: +12 re-keyed GENERIC sites (all 12 read and verified handled: NARROW or REPORTED — entry.ts:33, helpers.ts:268, sharingEntry.ts:306, journal.ts:82, agent.ts:2729, acpWorker.ts:397, sshRunner.ts:414, ModelApiHost.ts:3926/7840, state.ts:1802, bundledSkillsInstall.ts:561, runExec.ts:1409) and 1 line shift (vaultBrokerEntry 565→566). Baseline regen belongs to the final join (must not bless 35 untriaged join sites from a deps lane) |
| `check:host-api`                                                               | 1    | PRE-EXISTING: identical on base (vault group added `src/host/vault/vaultActionDialogs.ts` after the record; 383 APIs, 50 files, 30 built-ins, 71 theme vars, 1 problem)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `check:usable-reply`                                                           | 1    | PRE-EXISTING: identical on base (`deliveryBinding.ts:317` raw completed-terminal read)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `typecheck:host` / `:webview` / `:integration`                                 | 0    | clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `typecheck:unit`                                                               | 2    | PRE-EXISTING, lane is a strict subset: base 27 errors, lane 24 (my reflows repaired 2 in `estimateComposer.test.ts` + 1 in `estimateSession.test.ts`); remaining 24 identical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `typecheck:e2e`                                                                | 2    | PRE-EXISTING: same single `estimateFailures.ts(11,10)` TS2554 on base                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `build` (production + budgets)                                                 | 1    | PRE-EXISTING, stops where predicted: `CHANGELOG.md` 0.19.0 notes decode to 324,829 B over the What's New bound of 76,800 B (`whatsNewContent.mjs:611`). CHANGELOG untouched by this lane. Trimming release notes is the release manager's job (`docs/RELEASING.md`); bundle-size budgets cannot run until it passes                                                                                                                                                                                                                                                                                                                                                                  |

## 4. Full unit suite as CI shards it

CI macOS runs `npx vitest run --shard="N/16"` (16 shards). In this tree the
`--shard` flag selects ZERO files on every shard (`No test files found`),
identically on the untouched base (base `--shard=1/16`: exit 1, same message)
— the flag-level anomaly is pre-existing and unexplained at vitest level
(glob finds 766 files standalone; explicit file args run fine; not
fileParallelism). So each CI partition was executed by enumerating it:
`temp/shard-partition.mjs` replicates vitest 5 `BaseSequencer.shard` exactly
(sha1 hex of the leading-slash `/`-relative path, ascending sort,
`calculateShardRange` slice) over vitest's own glob set (cross-checked
identical to `git ls-files`: 766 files, no mismatch). Shards 1–14 × 48 files,
15–16 × 47. Each shard ran as one `npx vitest run --reporter=default
<48 files>` with the repo's own config (maxWorkers 3, repo timeout — never
`--testTimeout`). Method deviation: explicit file args instead of the broken
`--shard` flag; same files, same partitions, same config.

Result: 765 files executed (22,032 passed, 152 failed, 106 skipped);
`packagedBundles.test.mjs` (shard 13) aborts whole-shard on both trees because
globalSetup's production-package build hits the What's New bound (§3) — its
other 47 shard-mates ran as 13b. EVERY failing test below was reproduced on
the base tree (name-identical diffs), except the scheduleLeaseLifecycle timing
set, which varies run to run on both trees (4 runs: lane-shard 10,
lane-alone 6, base 5, base-alone 8, shifting membership — deadline/abort
races under load; plus one deterministic stale-cert failure common to both,
see below).

Per-shard files (failed/passed) and tests (failed/passed):
1: 3/45, 7/5644 · 2: 4/44, 4/634 · 3: 2/45, 23/5715 · 4: 0/47, 0/542 ·
5: 1/47, 4/638 · 6: 3/43, 24/564 · 7: 3/45, 13/1332 · 8: 3/44, 2/397 ·
9: 3/45, 7/1086 · 10: 5/41, 8/576 · 11: 9/35, 18/522 · 12: 2/46, 18/897 ·
13b: 3/42, 4/585 · 14: 4/44, 7/1542 · 15: 1/46, 1/461 · 16: 3/43, 12/897.

Every failing file and its cause (all pre-existing on `ace760a0b7`):

- Rig-environment (real OS affordances absent in this sandbox): `macRss`
  (real `/bin/ps` child sampling), `credentialMigrationStore` (22, real
  keychain — login keychain never available here), `brokerSession`
  (broker child processes), `writerCrashPosix` (17, SIGKILL/crash recovery),
  `brokerSocketDirectory` (macOS data folder), `fileLease`, `shellNoDeadline`,
  `usageService`, `runtimeDailyBudget`, `accountsCommand` (credential-store
  refusal), `filesCancel`, `uploadLedgerTwoProcess`, `modelApiPacing`,
  `treesLifecycleNative`, `runnerHelperNative` (skipped file),
  `nativeGitPullRequestReads` (hook timing), `storeProject` (live npm
  channel), `reportProductionTransport`, `vaultPanelBuild`, `subscriptionCopilot`.
- Join-drift truth/cert pins (fail identically on base; the join is mid-flight):
  `cx1r2Truth` (4), `cx1r4Truth` (2), `estimatorPlanSnapshotRealPlan`,
  `estimatorSnapshotStrict`, `estimatorDiagnostics` (9), `estimatorPanel`,
  `estimatorSurfaces` (4), `estimateComposer`, `estimateSession`,
  `modelTextCompression` (bundle bytes), `lazyBundleFiles`,
  `toolRoundsUsableReplyGuard`, `commandHelp`, `agentOutcome`,
  `chatgptPlanFacts` (3, provider catalog), `acpTranslate`,
  `reportSourceFailures` (3), `reportSourceRecordBoundaries`,
  `reviewMaterialProbes` (2), `teamConstants`, `paletteRegistry`,
  `legalCoverage`, `modelApiLegalScan`, `networkPosture` (1, known),
  `execExactCount` (2, known), `whatsNewContent` (2, CHANGELOG over bound),
  `estimatorBundle`, `reports.e2e` (17, real journals).
- Timing-flaky on both trees: `scheduleLeaseLifecycle` (see §5).
- Unrunnable anywhere on this tree: `packagedBundles` (What's New bound, §3).

## 5. Special notes for the final join

- `scheduleLeaseLifecycle` "certification identifies the actual
  filesystem-port bytes" fails on BOTH trees for the same structural reason:
  recorded `a56001ab…` (stale), base source `5acaed32…` (join drift), lane
  source `7486edbf…` (my reflow on top). Fail→fail; the join must refresh the
  cert record in `docs/certification/m113-playbook-schedules-c-m113-4.md`.
- The lane's lint reflows are behavior-preserving (comment/whitespace/
  param-style only); the one functional-adjacent change is `throw new Error`
  → `throw new TypeError` at 24 sites per `prefer-type-error`, which the
  full-tree eslint, typecheck (24 ⊆ 27) and the suites above absorb with no
  new failure.
- `vitest --shard` finds no files on this tree (pre-existing); the join/CI
  should confirm hosted CI shards populate before relying on them.
- Drills: no product behavior changed (deps + lint reflows only), so no
  real-life run was spent; the e2e file in the suite (`reports.e2e`,
  shard 12) ran with the pre-existing failures above.
