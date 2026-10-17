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
- The merge took main's test-overhaul deletion of
  `test/unit/referenceGenerator.test.mjs` (verdict GO: fake session-store
  import). Its R5-P3 regression used real modules only, so it was re-homed as
  `test/unit/ciReference.test.mjs` (real reference builder, catalog, English
  table, rendered Markdown; no fakes). Break drill: `referenceCiOther`
  condition `system` → `ciVendor` fails the suite at the stale-reference gate,
  and after a consistent regen fails the assertion with `when: ciVendor`;
  restored byte-exact (`git diff` clean) and green.

## 3. Gates (final tree, exit codes)

Intermediate (merged tree `5f940132b`, macmini, repo timeouts):

| Gate                                          | Result                                                             |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `check:plan`                                  | exit 0 — plan-format-v1, 218 milestones, 0 drift                   |
| `check:reference`                             | exit 0 — 74 features, 65 commands, 89 settings, 29 slash, 244 CLI  |
| `check:roadmap`                               | exit 0 — 218 entries, current                                      |
| `check:l10n`                                  | exit 0 — 14 UI + 14 usage tables, 252 manifest strings, 0 problems |
| `check:host-api`                              | exit 0 — 0 problems                                                |
| knip                                          | exit 0 (3 pre-existing configuration hints)                        |
| `sh -n`/`bash -n` `ci-templates/bootstrap.sh` | ok                                                                 |
| `git diff --check`                            | clean                                                              |
| prettier                                      | new files pass after `--write`                                     |

Tests (merged tree, `npx vitest run <files> --maxWorkers=3`, repo timeouts):

| Files                                | Result                                   |
| ------------------------------------ | ---------------------------------------- |
| execArgs/execOutput/execSchema       | 128/128 pass                             |
| runLedger/scanSecrets/untrustedInput | 53/53 pass                               |
| redact/execKeyInput                  | 167/167 pass                             |
| ciTemplates                          | 31/31 pass                               |
| ciReference (new)                    | 1/1 pass                                 |
| ciRun                                | (running)                                |
| ciTemplatesRun                       | 18 failed — under investigation (see §5) |

Still to run: eslint on changed files (zero warnings), typecheck (all
projects), cycles, duplication, `npm run build`, `SEMGREP_ENABLE_VERSION_CHECK=0
npm run security:sast`, full `npm run quality`.

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

## 5. App problems

(TODO.)
