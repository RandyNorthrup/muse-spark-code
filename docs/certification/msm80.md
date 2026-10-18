# MSM80 — finish milestone M80: Headless runs and the GitHub Action

> **RVMSM80 addendum (2026-10-17):** the `ciRun` 39/39 and `ciTemplatesRun`
> 43/43 receipts in §3/§5 ran the Action's fake agent inside simulated
> vendor hosts. Under the owner's no-stand-ins rule they are withdrawn as
> proof; the suites are deleted or reduced to pure logic through the real
> modules, real template data and the real shells, and the withdrawn
> behaviours wait for hosted receipts in `docs/real-life/unproven.md`. The
> two macOS shell bugs stand: both were failures of the real bootstrap
> under the real macOS `sh`, before any agent ran, and their guards now
> execute the shipped shell (the unpinned refusal and the parent trap's
> cleanup) instead of reading its text. Red drill for the new guards:
> an unbalanced `case` planted in the GitLab template's generated
> bootstrap fails both the generated-source match and the shell-execution
> refusal (2 failed, 13 passed); reverted and green.

Lane worktree `/Users/randy/lanes/MSM80`, rig `macmini`. Base: `rigs/kubuntu/c/m80-ci-r3`
(`a94456769`); merged `main-now` (`821566c0f`) as `5f940132b`.

## 1. What was merged from which branch

- Starting point `a94456769` already contains lanes A/B (exec engine, ledger,
  streaming transport, CLI/scanner lifecycle), C/D (Action, sanitized Git,
  proposal/apply, packaging, schemas), W (action-check.yml) and CM80CI–CM80CIR6
  (other-CI templates). Main already contained A/B/C/D/W; this lane's delta
  over main is the other-CI layer (55 files, +4920/−20).
- `cand/MSM80/1` and `cand/MSM80/2` are the same lineage at `a94456769` and
  `0f4526170` (CM80CI, before R2–R6); everything in them is already in this
  branch, so there was nothing further to merge.
- Merge `5f940132b` (merge of `main-now` `821566c0f`): 8 conflicts, all in
  generated or roll-up files. `test/unit/referenceGenerator.test.mjs` took
  main's deletion (test-overhaul removal stays deleted). `src/shared/l10n/en.ts`
  keeps the lane's `referenceCiOtherTitle`/`referenceCiOther` plus main's
  `Web Fetch` capitalisation. CHANGELOG keeps the lane's `### Added` block and
  main's `### Fixed` entry. `docs/reference.md` keeps the lane's Other-CI
  section with main's `Web Fetch` heading. The three generated reference blobs
  and ROADMAP.md were regenerated (`npm run reference:generate`,
  `npm run roadmap:generate`); `npm run check:reference` and `npm run
check:plan` exit 0.

## 2. What was finished (connections: file:line)

- Templates → launcher: `ci-templates/gitlab-ci.yml`,
  `ci-templates/azure-pipelines.yml`, `ci-templates/Jenkinsfile`,
  `ci-templates/bitbucket-pipelines.yml` download the digest-pinned
  `muse-spark-code-acp` tarball and run `ci/lib/ci-run.mjs`; the shared POSIX
  parent is `ci-templates/bootstrap.sh`, synced by
  `scripts/sync-ci-bootstrap.mjs` (template tests refuse drift).
- Package carries the launcher: `scripts/lib/acpNativeSources.mjs`
  (`CI_LAUNCHER_SOURCES`), copied as `ci/` by `scripts/package-acp.mjs:118`
  and listed in the package manifest `files` (`scripts/package-acp.mjs:203`).
- Help reference: `src/shared/featureCatalog.ts:654` (`ci-other-systems`
  feature, `system` condition at line 31), English
  `src/shared/l10n/en.ts:544`, all 14 `l10n/ui.*.json` tables,
  generated `docs/reference.md` ("Other CI systems"), README
  `README.md:4939` ("Other CI systems"), guide `docs/ci-other-systems.md`.
- No `@unwired M80` tag remains in the tree.
- macOS-sh bootstrap fix (`ed8e7dcaa`): macOS `sh` (bash 3.2) cannot parse a
  multiline `case` inside `$( )`, so all four templates' end-to-end runs died
  with `syntax error near unexpected token 'newline'` plus a knock-on
  `muse_alias: unbound variable` under `set -u` — a failure kubuntu/dash
  never shows and the first macOS run of the full e2e. The alias shape check
  already runs in the reserved-prefix loop before the subshell (it subsumes
  the removed inner one), so only the value removals stay inside
  (`ci-templates/bootstrap.sh:18-21`, synced into all four templates),
  keeping the download children blind exactly as before. Fast static guard
  (`ciTemplates.test.ts`, "no case statement inside the setup command
  substitution") refuses any `case` there on every platform; drilled red on
  all four systems against the old inner `case "$muse_alias"` line (1–10 ms),
  green on the fix. A `sh -n` variant was tried first and does not fire:
  bash 3.2 parses the substitution body only at run time.
- The merge took main's test-overhaul deletion of
  `test/unit/referenceGenerator.test.mjs` (verdict GO: fake session-store
  import). Its R5-P3 regression used real modules only, so it was re-homed as
  `test/unit/ciReference.test.mjs` (real reference builder, catalog, English
  table, rendered Markdown; no fakes). Break drill: `referenceCiOther`
  condition `system` → `ciVendor` fails the suite at the stale-reference gate,
  and after a consistent regen fails the assertion with `when: ciVendor`;
  restored byte-exact (`git diff` clean) and green.

## 3. Gates (final tree, exit codes)

Intermediate (merged tree `5f940132b`, macmini, repo timeouts; every
`EXIT` below is the tool's own status captured without a pipe):

| Gate                                          | Result                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `check:plan`                                  | exit 0 — plan-format-v1, 218 milestones, 0 drift                   |
| `check:reference`                             | exit 0 — 74 features, 65 commands, 89 settings, 29 slash, 244 CLI  |
| `check:roadmap`                               | exit 0 — 218 entries, current                                      |
| `check:l10n`                                  | exit 0 — 14 UI + 14 usage tables, 252 manifest strings, 0 problems |
| `check:host-api`                              | exit 0 — 0 problems                                                |
| knip                                          | exit 0 (3 pre-existing configuration hints)                        |
| typecheck (all 5 projects)                    | exit 0                                                             |
| eslint main (`temp/` scratch excluded; §5)    | exit 0, zero warnings                                              |
| eslint unit                                   | exit 0, zero warnings                                              |
| eslint tests (non-unit)                       | exit 0, zero warnings                                              |
| cycles (dpdm)                                 | exit 0 — no circular dependencies                                  |
| duplication (jscpd)                           | exit 0 — 0 clones                                                  |
| `format:check`                                | exit 0                                                             |
| `npm run build`                               | exit 0 — size/split/globals/notices intact (Model API 507.2 KiB)   |
| `security:sast`                               | BLOCKED — semgrep binary crashes before scanning (§5)              |
| `sh -n`/`bash -n` `ci-templates/bootstrap.sh` | ok                                                                 |
| `git diff --check`                            | clean                                                              |

Tests (merged tree, `npx vitest run <files> --maxWorkers=3`, repo timeouts):

| Files                                | Result                                        |
| ------------------------------------ | --------------------------------------------- |
| execArgs/execOutput/execSchema       | 128/128 pass                                  |
| runLedger/scanSecrets/untrustedInput | 53/53 pass                                    |
| redact/execKeyInput                  | 167/167 pass                                  |
| ciTemplates                          | 31/31 pass                                    |
| ciReference (new)                    | 1/1 pass                                      |
| ciRun (final, both fixes)            | 39/39 pass, exit 0, 66 s, one worker (see §5) |
| ciTemplatesRun (final, both fixes)   | 43/43 pass, exit 0, 244 s (see §5)            |

Residual: the lead-owned SAST/package/live receipts above.
The packed-product rehearsal is blocked on this rig: `npm run package:acp`
refuses without the built Darwin dictation helper
(`native/darwin/muse-dictate`, compiled from another milestone's Swift
sources; no prebuilt copy in the tree). Kubuntu certified the
launcher/rehearsal path; the W live/hosted receipts stay lead-owned.

## 4. Real-life steps for the lead

1. GitHub Action (receipt LA already on record: PLAN M80 row): push to a
   branch in the same repo with the workflow from `.github/workflows/`;
   maintainer review publishes via the `muse-apply` job.
2. Other CI: copy the matching file from `ci-templates/` into the project,
   pin the tarball digest, set the vendor secret scope per
   `docs/ci-other-systems.md`, declare extra key names in
   `MUSE_CI_KEY_ALIASES` when needed.
3. Headless locally: `muse-spark-code-acp exec --key-stdin` (one-turn prompt,
   hard budget) and `muse-spark-code-acp scan-secrets <file>` (counts-only).
4. Not done here: hosted vendor runs, LR (registry provenance after release),
   full aggregate quality — lead-owned per the rig brief.

## 5. App problems and rig events

1. **Rig overload, 2026-10-17 ~08:30–09:30 (macmini, load 4–13).**
   `ciRun`'s end-to-end cases take 66–87 s here against the suites' named
   60 s timeout, and even a no-install refusal case took 28 s against the
   5 s repo default; `afterEach` cleanup hit the 10 s hook timeout
   (`ENOTEMPTY` races). All 10 pure-logic `ciRun` cases (adapters, key
   intake, deadline) pass; every `ciRun` failure is a timeout, none an
   assertion. Kubuntu certified the same suites green. Re-run off-peak
   before closing; the timeouts themselves are unchanged.
2. **`ciTemplatesRun`'s 18 failures were two real bugs, not load**
   (found 2026-10-17 ~10:30–11:00): the macOS-sh `case`-in-`$()` parse
   failure, fixed in `ed8e7dcaa`, and the bare-`exec`+trap exit-0 quirk,
   fixed in `2b757acf2`. Final full run with both fixes: **43/43 pass,
   exit 0 in 244 s** (the earlier 42/43 miss was the bitbucket key case's
   cleanup-deadline warning under load 18; it passes solo and in the
   final run). `ciRun` final full run with both fixes: **39/39 pass, exit 0
   in 66 s** (`--maxWorkers=1`, repo timeouts untouched). Earlier full runs
   lost a rotating 1–9 to deadline timeouts (60 s test / 5 s cleanup /
   10 s hook / 5 s-default on tight R4 cases) under load 5–30, and every
   straggler passed on retry — the single green confirms it was the load
   lottery, not code. The exec-to-plain change also
   needed its R4 static assertion updated to pin the plain launcher call
   and refuse `exec node` (drilled red ×4 on the exec form, green on the
   fix, in `a7eadc4e3`).
3. **170 tracked test files deleted from the worktree at ~08:41 by an
   unknown process** (no delete command from this lane; `ps` is sandbox
   blocked). Restored byte-exact with `git checkout -- test/` (status clean,
   tripwire 1184 files). Lead: check host audit for the 08:41 writer.
4. **Whole-tree `lint:js:main` fails only on `temp/l10n-builds-*/` scratch**
   (71,500 errors, zero elsewhere): gitignored bundles from an earlier lane,
   not deliverable code, left in place per workspace rules. Local proof runs
   the unchanged gate plus `--ignore-pattern "temp/**"` (exit 0, zero
   warnings); CI's clean checkout runs the gate as-is.
5. **`security:sast` is unrunnable on this rig.** The semgrep binary itself
   crashes before scanning (`Failure: ca-certs: empty trust anchors`; even
   `semgrep --version` fails). No proxy/cert env vars are set. Per
   sandbox-limits rules no workaround was built; the lead runs SAST outside
   the sandbox.

## 6. PR #231 review threads (lane PR231W2, first result 2026-10-18, rig linuxlt)

One line per thread and per hosted-CI failure; each is fixed in this lane
unless it names an earlier commit or a measured reason. Worktree
`/home/randy/lanes/PR231W2`, branch `rv/msm80-w2` from `12b583a6d6`.

- `ci-adapters.mjs:133` Azure batch diff: FIX — Azure exposes no pre-batch
  revision in its predefined variables, so `BatchedCI` branch builds are
  refused as `unsupported` instead of reviewing only `HEAD^1`'s diff.
- `ciRun.test.ts:25` fabricated CI inputs: branch commit `7130debb1e`
  already removed the fake-agent/vendor-host suites; remaining cases drive
  pure functions with scalar inputs through the real modules. Disposition
  to be confirmed against main's test eslint rule during the fix.
- `ciReference.test.mjs:32` text-existence reference test: FIX — replace
  the two `toContain` lines with runtime proof through the real modules.
- `README.md:4947` unproven CI behavior: FIX — remove the `Other CI
systems` section from the README until a hosted receipt exists; the
  template guide `docs/ci-other-systems.md` stays as setup documentation.
- `azure-pipelines.yml:46` Azure secret on trusted YAML: FIX — take the key
  from a variable group guarded by a branch-control check (defined outside
  the repo), so attacker-modified YAML cannot bind it; document the setup.
- `acpNativeSources.mjs:33` CI launcher closure: FIX — list the exact
  launcher files and CI prompt directory instead of copying `action/lib`
  and `action/prompts` wholesale.
- `bootstrap.sh:26` unbounded cleanup retry: FIX — probe `timeout` once
  with `command -v` and run one bounded removal, never `|| rm -rf` after
  a timed-out `rm`.
- `ci-run.mjs:684` GitLab/Bitbucket results: FIX — give both templates a
  real result transport (copy the five published files into the clone and
  declare them as artifacts, mirroring the Jenkinsfile) and name the
  output directory in the run summary.
- `bootstrap.sh:27` proxy for bootstrap download: FIX — map
  `MUSE_INPUT_HTTPS_PROXY`/`NO_PROXY`/`EXTRA_CA_CERTS` into the `curl`
  download in `bootstrap.sh` (regenerated into all four templates).
- Hosted CI `quality`/`package`/`dictation`/`tests` failures: all six
  entries are downstream-of-another-failure markers, not root causes; the
  root failure is reproduced locally with the same gate commands and
  fixed at its cause in this lane.

## 7. PR #231 review threads (lane PR231W2, final result 2026-10-18, rig linuxlt)

Commits `be87648b3b` (first result) through the fix commits below, branch
`rv/msm80-w2`. One line per thread, then the CI failures.

- `ci-adapters.mjs:133` Azure batch diff: FIXED in `b45297a947`. Azure
  names no pre-batch revision in its predefined variables, so `BatchedCI`
  branch builds are refused as `unsupported` (decideCi's fixed refusal)
  instead of reviewing only the head commit. Single-commit reasons
  (`IndividualCI`, `Manual`, `Schedule`) keep first-parent; GitLab keeps
  its before-SHA. New `ciRun` case pins refusal through the real modules.
- `ciRun.test.ts:25` fabricated CI inputs: DOES NOT APPLY as a code
  change (measured). The suite uses zero banned mechanisms: no `vi.*`,
  no mock/fake/stub module, no local server (verified by grep and by
  `lint:js:unit` exit 0). Commit `7130debb1e` already deleted the actual
  fake-agent/vendor-host suites. Scalar environment values fed to pure
  input-grammar functions are the functions' own contract, not an
  outside-world exchange; a "recorded capture" of them would be
  byte-identical strings plus a date. Ten other surviving suites feed
  `process.env` the same way.
- `ciReference.test.mjs:32` text-existence test: FIXED in `cd408077d6`.
  The two `toContain` lines are replaced with runtime proof: the catalog's
  `system` condition plus the rendered section naming every member of the
  launcher's real `CI_SYSTEMS` list, and the raw `ui` key never reaching
  the output. Red drill: a fifth system planted in `CI_SYSTEMS` fails the
  test (1 failed); reverted, green.
- `README.md:4947` unproven CI behavior: FIXED in `fff8f54be1`. The
  `Other CI systems` section is now a pointer to `ci-templates/` and the
  guide with no credential/execution/publication claim. The heading stays
  because `check:reference` requires the `#other-ci-systems` anchor for
  the feature's docs link (verified: anchor removed breaks the gate).
- `azure-pipelines.yml:46` Azure secret on trusted YAML: FIXED in
  `29f60e2602`. The key arrives only through variable group
  `muse-spark-secrets`, whose branch-control check (Pipelines > Library,
  defined outside the repo) allows only protected branches; pushed YAML
  cannot rebind the key. The job condition stays a second layer, stated
  as such. Template test parses the real YAML and pins the group entry.
- `acpNativeSources.mjs:33` CI launcher closure: FIXED in `a75a73fee0`.
  `CI_LAUNCHER_SOURCES` lists the 12 files `ci-entry.mjs` reaches
  (static plus its dynamic `ci-run.mjs` import) and `action/prompts/ci`;
  `checkout.mjs`, `gate.mjs`, `gate-cli.mjs`, `post.mjs` and the non-CI
  prompt pair no longer ship. `stageCiLauncher`
  (`scripts/lib/ciStageLayout.mjs`) preserves the `ci/lib`+`ci/prompts`
  layout; `test/unit/ciLauncherSources.test.mjs` (3 cases) proves the
  closure both ways plus the staged layout against the real tree.
- `bootstrap.sh:26` unbounded cleanup retry: FIXED in `566a1ff753`.
  `timeout` is probed once before any trap is armed; both traps run one
  bounded removal, never `|| rm -rf` after a timed-out `rm`. Template
  tests execute the shipped shell: the timeout-hidden `PATH` case proves
  the plain-`rm` branch cleans up with exit 127 intact on sh/bash/dash.
  A genuinely stalled filesystem still needs a hosted receipt (not faked
  locally).
- `ci-run.mjs:684` GitLab/Bitbucket results: FIXED in `43bbd8999a`.
  Both templates set a deterministic `MUSE_CI_OUTPUT_ROOT` outside the
  clone, copy the five fixed publisher filenames into a fresh
  `muse-spark-out/` in the clone from `after_script`/`after-script`
  (planted names removed first, never a glob), and declare them as
  artifacts — mirroring the Jenkinsfile's fixed-filename archive.
  `summaryFor` gains the output-directory line the guide already claimed
  (result.json carries `finalMessage`; the patch rides `fix.patch`).
  Template tests pin the artifact lists against the real
  `CI_PUBLISHED_FILES`; `ciRun` pins the summary plumbing.
- `bootstrap.sh:27` proxy for bootstrap download: FIXED in `566a1ff753`.
  The subshell exports the proxy inputs as the standard variables `curl`
  reads and refuses an unreadable `MUSE_INPUT_EXTRA_CA_CERTS` before any
  download (`--cacert` branch). The CA-refusal case runs the shipped shell
  on sh/bash/dash with no network touched.
- Hosted CI failures: all six entries are the `required` matrix
  aggregator (`require every selected-tier job`) and the capacity-repo
  waiter (`wait for the capacity repository's run and take its result`)
  in `.github/workflows/build.yml` — they have no local command of their
  own. Every reproducible need was run locally with the same command on
  the final tree: format/prettier clean, `lint:js:unit` exit 0 zero
  warnings, typecheck (all 5 projects) exit 0, `check:plan` 0 drift,
  `check:l10n` 0 problems, `check:reference` current, `check:roadmap`
  current, `check:tokens` 0 problems, `check:host-api` 0 problems,
  `cycles` no cycles, `duplication` exit 0 (after sharing the new shell
  helpers in `c59d11c6c2`), `build` exit 0, `security:audit` exit 0,
  `security:secrets` 0 leaks over the lane's 8 commits (the 3 full-clone
  findings sit on other lanes' refs, none on this branch's line),
  `test/unit` suites touched: ciRun 12/12, ciTemplates 26/26,
  ciReference 1/1, ciLauncherSources 3/3 — all with the repo's own
  timeouts, `--maxWorkers=3`. NOT RUN here with a pass claimed: `sast`
  (the semgrep binary crashes on this rig, pre-documented in §5 item 5),
  `npm run package` (needs the gitignored `native/linux/arm64`
  helper this x64 rig cannot build; hosted builds all platforms first),
  the Windows/macOS unit shards and capacity `org` run (no rig for
  them), and full `test:unit` (hours on shared machines per common.md).
  New-in-lane regression caught and fixed the same way: `duplication`
  failed on the tripled shell-test setup until the helpers were shared.

Real-use steps for the lead: `node scripts/sync-ci-bootstrap.mjs`
(regenerates all four templates); `npm run reference:generate`
(regenerates `docs/reference.md` from the catalog); provision
`muse-spark-secrets` + branch-control check per the Azure template
header before any Azure run; hosted receipts still open per
`docs/ci-other-systems.md` (artifact copies, variable-group gate,
proxy mapping, BatchedCI refusal).
