# MSM80 — finish milestone M80: Headless runs and the GitHub Action

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

| Files                                | Result                                                  |
| ------------------------------------ | ------------------------------------------------------- |
| execArgs/execOutput/execSchema       | 128/128 pass                                            |
| runLedger/scanSecrets/untrustedInput | 53/53 pass                                              |
| redact/execKeyInput                  | 167/167 pass                                            |
| ciTemplates                          | 31/31 pass                                              |
| ciReference (new)                    | 1/1 pass                                                |
| ciRun (runs 2–3, both fixes)         | 31/39 then 30/39; all failures deadline-driven (see §5) |
| ciTemplatesRun (final, both fixes)   | 43/43 pass, exit 0, 244 s (see §5)                      |

Still to run: `ciRun` to green in a quiet window.
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
   final run). `ciRun` post-fix runs 2–3: **31/39** then **30/39**, every
   failure deadline-driven (60 s test / 5 s cleanup / 10 s hook timeouts,
   plus 5 s-default timeouts on tight R4 cases, under load 7–30; each run
   passes a rotating subset of the launcher e2e, which is the load lottery,
   not code). A quiet full-green run is still wanted. The exec-to-plain change also
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
