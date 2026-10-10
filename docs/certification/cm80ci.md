# CM80CI certification — headless runs on GitLab, Azure, Jenkins, Bitbucket

Lanes CM80CI (branch `c/m80-ci`, rig `macbook`) and CM80CI-R2 (branch
`c/m80-ci-r2`, host lane), 2026-10-10. Status: built, tested with fakes on
Linux, macOS and Windows, **not certified** (no live run on these systems,
no release carrying the launcher yet, registry path waits on M80's LR).

## R2: one launcher (lead ruling after review RVCM80CI)

Review RVCM80CI (3 P1, 10 P2, 1 P3) traced every finding to one cause: the
first lane wrote a second launcher, `ci-templates/muse-spark-run.mjs`, that
re-implemented the GitHub Action badly. R2 deletes it. The Action's own
reviewed scripts are now the launcher on every system:

- `action/lib/ci-run.mjs` composes, unchanged, the Action's input grammar
  (`tools.mjs` `parseActionInputs`, `resolveTools`, `allocateInvocation`,
  `childEnvironment`), the installer (`install.mjs` `installAgent`, candidate
  path: SHA-256, `--ignore-scripts`, private npm config, pinned registry,
  identity and bin containment), the sanitized Git (`git.mjs` `safeGit`),
  the owner (`lifecycle.mjs` `createLauncherOwner`: signal forwarding, kill
  and reap bounds, drained bounded pipes), and the run (`run-exec.mjs`
  `runProposal`: review diff cut to `max-diff-bytes`, prompt file, `exec
--key-stdin`, `result.mjs` extraction against the result schema, patch,
  `scan-secrets --key-stdin`, publication; `outputsFor`, `exitCodeFor`,
  `revokeIfStopped`, `summaryFor`). New code is only what other systems
  need: key intake under every name, the system adapter, the job-deadline
  check, the checkout from the system's own clone, the change resource, and
  publication into `muse-spark-out/`.
- `action/lib/ci-adapters.mjs`: per-system facts (workspace, run identity,
  event, fork, protection, head, base) from GitLab, Azure, Jenkins and
  Bitbucket predefined variables, and `decideCi`, the launcher's own gate.
- `action/prompts/ci/{review,fix}.md`: the Action's prompts, worded for a
  change instead of a pull request number.
- The package carries `action/lib` and `action/prompts` as `ci/`
  (`scripts/lib/acpNativeSources.mjs` `CI_LAUNCHER_SOURCES`, used by
  `scripts/package-acp.mjs` and the packaging fixtures' shared layout).
- The four templates are thin wrappers around one identical bootstrap.

The GitHub Action's steps are untouched; `run-exec.mjs` only exports two
existing helpers (`revokeIfStopped`, `summaryFor`). Its suites pass
unchanged (receipts below).

## Findings, fixes, tests, drills

| #   | Finding (RVCM80CI)                                      | Fix                                                                                                                                                                                                                                          | Regression test                                                                                                                                      | Drill    |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | P1: the original secret variable survives in children   | Bootstrap: `set +x`, copy into an unexported shell variable, `unset MUSE_MODEL_API_KEY` before any command, value only on the exec line. Launcher: `takeCiKey` deletes every variable whose value holds the key; children get the allow-list | `ciRun` "takes the key out under every name", per-system e2e with a recording spawn; `ciTemplatesRun` per system under `sh -xe` with recording shims | D1, D2   |
| 2   | P1: Jenkins binds credentials before any trust gate     | `withCredentials` only inside the stage whose `when` (`beforeAgent true`) excludes `CHANGE_FORK` and change requests unless trusted; `decideCi` refuses before install                                                                       | `ciTemplates` Jenkins structure; `ciRun` refusal cases (nothing allocated, nothing spawned)                                                          | D3, D4   |
| 3   | P1: registry install bypasses the Action's verification | Template checks SHA-256 before unpacking; launcher installs with `installAgent` (digest again, scripts off, private config, pinned registry, identity, bin)                                                                                  | `ciTemplatesRun` digest mismatch; `ciRun` lifecycle scripts and `.npmrc`, digest mismatch, impostor identity                                         | D5, D6   |
| 4   | P2: Azure `False` refuses every trusted run             | `azureBoolean` (case-insensitive) for `System.PullRequest.IsFork` and Azure inputs; template condition uses Azure's case-insensitive `eq()`                                                                                                  | `ciRun` Azure booleans, Azure e2e (`IsFork: False`, trust `True`)                                                                                    | D7       |
| 5   | P2: Bitbucket step is null                              | Step keys nested under `step:`; listed under `branches` and `custom` only                                                                                                                                                                    | `ciTemplates` Bitbucket parse (yaml), `ciTemplatesRun` Bitbucket script                                                                              | D8       |
| 6   | P2: `max-diff-bytes` unused, no base/head diff          | Adapter names head and base; fresh checkout; Action's `generateDiff` cut to the input                                                                                                                                                        | `ciRun` "cuts the diff", e2e asserts two `--untrusted-file`                                                                                          | D9       |
| 7   | P2: cancellation leaves the agent child alive           | Action owner: SIGINT/SIGTERM forwarded, SIGKILL at the bound; bootstrap `exec`s so the launcher is the step process                                                                                                                          | `ciRun` "SIGTERM stops the run and kills the agent child" (POSIX)                                                                                    | D10      |
| 8   | P2: installer pipes never drained                       | Action owner's bounded sinks drain stdout and stderr of every child                                                                                                                                                                          | `ciRun` "a child writing megabytes to both pipes finishes"                                                                                           | D11      |
| 9   | P2: prompt text parsed as CLI options                   | No inline prompt input; the Action's prompt template is rendered to a private file and passed with `--prompt-file`                                                                                                                           | `ciRun` e2e asserts `--prompt-file`                                                                                                                  | D12      |
| 10  | P2: exit 0 published as completed                       | Action's `extractResult` (schema, sequence, exit-code agreement); `revokeIfStopped`; status unknown and exit 1 otherwise                                                                                                                     | `ciRun` empty and malformed output                                                                                                                   | D13      |
| 11  | P2: Bitbucket prompt-file alternative unreachable       | No prompt inputs remain; Bitbucket exports use `${VAR-default}`, so an explicit empty value stays empty                                                                                                                                      | `ciTemplates` no `:-` on inputs; `ciTemplatesRun` explicit empty budget refused                                                                      | D14      |
| 12  | P2: timeouts exceed the fixed job deadline              | `checkJobDeadline` refuses before install (GitLab `CI_JOB_TIMEOUT`, else the template's `MUSE_CI_JOB_TIMEOUT_MINUTES`); jobs 35 minutes                                                                                                      | `ciRun` deadline unit and launcher refusal; `ciTemplates` timeout equals declared value                                                              | D15, D16 |
| 13  | P2: validators and integration tests absent             | YAML parsed with `yaml`; exact scripts executed; launcher end to end with real clone, Git and npm                                                                                                                                            | the three suites                                                                                                                                     | D8, D2   |
| 14  | P3: roadmap not updated                                 | M80 entry names the four systems; `ROADMAP.md` regenerated                                                                                                                                                                                   | `npm run check:roadmap`                                                                                                                              | D17      |

## Per-system trust mechanism

See `docs/ci-other-systems.md` for the full table. In short: GitLab's
Protected variable plus `rules:` that never run the job for fork or
untrusted merge requests, unprotected refs or tags; Azure's fork secret
policy (off), a secret mapped only in the run step's `env:`, and a job
`condition:`; Jenkins `withCredentials` only inside the guarded stage;
Bitbucket's Secured variable with the step under `branches: main` and
`custom` only. The launcher re-checks the same facts and refuses before
installing anything.

## Test receipts

All at repository timeouts (no `--testTimeout`), through `rig-test.sh`.

- **macmini** (macOS 15.7.4), snapshot `16fc7fb9`: `ciRun` 26, `ciTemplates`
  21, `ciTemplatesRun` 7, `runtimeChatGptPackage` 2 (real packager with the
  new `ci/` copy): 4 files, 56 passed.
- **kubuntu** (Linux), snapshot `9114d0c7`: the three CI suites, every
  Action suite (`actionRunExec` 37, `actionInstall` 10, `actionGit` 51,
  `actionInputs` 19, `actionGate` 17, `actionManifest` 10, `actionPost` 10,
  `actionApply` 6) and the packaging suites (`acpPackageFixtures`,
  `usagePackaging`, `legalScanBundle`, `resourceAcpPackaging`, `execSchema`,
  `acpNpmReadme`): 279 passed. `runtimeChatGptPackage` timed out in its
  `beforeAll` production build (60 s hook) on this rig, in that run and
  alone (snapshot `c615c6f9`); it passes on macmini above in 42 s.
- **win11** (Windows 11 VM), snapshot `d47657e8`: `ciRun` and
  `ciTemplates`: 45 passed, 9 skipped (POSIX-only: the exact-template
  suite, the SIGTERM case and the private-folder mode check). An earlier
  run on the same tree (snapshot `e6003870`, 384 s against 111 s) timed out
  the first end-to-end case at 60 s while the VM was contended; identical
  cases took 9 s to 51 s in that run and 8 s to 9 s in the rerun.
- Host: `tsc -p test/unit` (only the pre-existing `museCodeSdk142.test.ts`
  error, also on the base), eslint `--max-warnings=0` and prettier on
  every changed file, `check:reference`, `check-plan` (207 milestones, 0
  drift), `check:l10n` (0 problems), `roadmap:generate` / `check:roadmap`.

## Red drills

Each break was made in the working tree, the named test seen failing on a
rig at repository timeouts, and every file restored from a byte copy and
compared by SHA-256 (`sha256sum -c` against the baseline below).

Baseline SHA-256 (restored and verified `OK` after every batch):
`action/lib/install.mjs` 3b320f55…806ed, `ci-adapters.mjs` 45bb6281…0a3cb,
`ci-run.mjs` edb66999…1f7d7, `run-exec.mjs` 298a5856…434cb, `lifecycle.mjs`
a7b92ac5…f4d35, `Jenkinsfile` ba460fd7…63b67, `gitlab-ci.yml` c1cac403…67118,
`bitbucket-pipelines.yml` 317f0de7…d3753, `azure-pipelines.yml`
f1afd4dd…bc3b5, `docs/roadmap/entries.json` 0a3b38bb…c21786.

Batches ran on kubuntu; the breaks in one batch touch disjoint tests.

- Batch 1 (snapshot `aeaa0fbf`, 15 failed, 39 passed):
  - D3: Jenkinsfile `expression { env.CHANGE_FORK == null }` removed →
    "Jenkins: the credential is bound only inside the stage…" failed.
  - D7: `azureBoolean` no longer lower-cases → "reads Azure's string
    booleans…", "names forks…", "uses the Action's grammar… Azure booleans",
    both Azure end-to-end runs and the Azure fork refusal failed.
  - D9: staged `maxDiffBytes` fixed at 1,048,576 → "cuts the diff to
    max-diff-bytes" failed.
  - D12: exec's `--prompt-file` renamed → the GitLab, Jenkins and Bitbucket
    end-to-end runs failed on their argv check.
  - D14: Bitbucket `${MUSE_INPUT_MAX_BUDGET_USD-2.00}` made `:-` → "Bitbucket
    keeps an explicitly empty value…" and "…explicitly empty budget, which
    the launcher refuses" failed.
  - D15: `checkJobDeadline` call removed from `runCi` → "azure refuses {
    MUSE_INPUT_TIMEOUT_MINUTES: '30' }…" failed.
- Batch 2 (snapshot `6bf5cc8e`, 18 failed, 36 passed):
  - D1: `takeCiKey`'s scrub of every variable holding the key removed →
    "takes the key out under every name" and every in-process end-to-end
    run (a planted copy stayed in the environment) failed.
  - D2: GitLab `unset MUSE_MODEL_API_KEY` removed → "gitlab: the key reaches
    exec's stdin and no program's environment…" (recording shims saw the
    key) and the bootstrap validators failed.
  - D4: `decideCi`'s fork refusal removed → "refuses forks…" and the Jenkins,
    GitLab and Azure fork refusals failed.
  - D5: GitLab digest comparison removed → "a tarball whose digest differs
    is never unpacked or run" failed.
  - D13: status forced to completed on exec exit 0 → "empty output…" and
    "malformed output is never published as completed" failed.
- Batch 3 (snapshot `407d84ea`, 14 failed, 40 passed):
  - D6: `install.mjs` `--ignore-scripts` flag and `npm_config_ignore_scripts`
    removed → "ignores lifecycle scripts and a checked-out .npmrc…" (the
    lifecycle sentinel ran) and the end-to-end flag checks failed.
  - D8: Bitbucket step children de-indented to siblings of `step:` (the
    first lane's layout; `yaml` reads `step: null`) → "Bitbucket: the step
    parses into a real step…", the Bitbucket bootstrap, timeout and
    template-run tests failed.
  - D10: the owner's stop no longer terminates the current child → "SIGTERM
    stops the run and kills the agent child" failed (timed out, child
    alive; the orphan was killed on the rig afterwards).
  - D11: the child's stderr sink replaced by one that never reads → "a child
    writing megabytes to both pipes finishes instead of blocking" failed.
  - D16: Azure `timeoutInMinutes` 35 → 25 → "Azure: timeoutInMinutes equals
    the declared MUSE_CI_JOB_TIMEOUT_MINUTES" failed.
- D17 (host): the M80 roadmap summary reverted without regenerating →
  `npm run check:roadmap` failed ("ROADMAP.md is stale from line 5");
  restored, current.

The first lane's two drills are superseded with the files they broke.

## Editor and platform rows

These templates drive the headless runtime, not an editor bridge, so every
editor gets the same run. The templates target Linux runners; the launcher
is Node with built-ins only and is tested on Linux, macOS and Windows. The
exact-template suite needs a POSIX shell and runs on Linux and macOS.

## R4: shell never touches the key (CM80CIR4, 2026-10-10)

This is the current design and supersedes the R2/R3 transport and lifecycle
claims above. The shell's download subshell removes the single generated
key-name/alias list without reading values. Only the Node launcher reads the
vendor credential source; it strips names and all value copies, refuses
conflicts and keeps the value in memory for the trusted private stdin and
redaction. GitLab's vendor-created File variable is read directly by Node;
no bootstrap key file, holder or copying child exists.

The publisher creates output outside the clone under job temp. Uploads
select only that directory after the publisher completes; no repository
fallback. Early failures have no output to upload. Cleanup ownership starts
at launcher entry, before fact/workspace validation. Filesystem publication,
stale-output removal and cleanup run in cancellable workers stopped through
AbortSignals at their bounds. Admission uses measured elapsed time from the
earliest vendor timestamp available, otherwise the bootstrap start, without
an assumed two-minute setup allowance.

The review's unconfirmed Bitbucket P1 is **confirmed as a qualification and
documentation gap**, not as a captured key leak: one user script does not
prove the environment of automatic clone/setup/upload processes, and
deployment variables are narrower than repository variables. No hosted
capture is authorized here; vendor process isolation remains unqualified.

### Findings, fixes, tests, drills (all 8 confirmed findings fixed; unconfirmed P1 verdict below)

| #    | Finding (RVCM80CI3)                                                          | Fix                                                                                                                                                                              | Regression test (fails without it)                                                                       | Red drill (restored byte-exact, `sha256sum -c` OK)                                                                           |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 P1 | GitLab File-variable path gives the key to `cp`                              | No bootstrap key file, holder or copying child; Node reads the vendor file directly (`ci-key.mjs`)                                                                               | `ciTemplatesRun` R4-P1-1: no `cp` shim, no held-key input file, exec key line intact                     | `cp` child re-added to the subshell: held-key probe fires, test fails                                                        |
| 2 P1 | Renamed/alias bindings reach bootstrap children; launcher cannot scrub them  | Generated name list + declared `MUSE_CI_KEY_ALIASES` unset before the first child; `readCiKey` refuses conflicting names and deletes every value copy                            | `ciTemplatesRun` alias exact-script runs (4 systems); `ciRun` R4-P1-2 conflict/scrub cases               | Alias loop removed: renamed value reaches `curl` env on all 4 systems; value-scrub loop removed: `COPY` survives, test fails |
| 3 P1 | Upload selects repository-planted artifacts after early failure              | Launcher-owned job-temp output root; GitLab/Bitbucket configure no repository artifact path; Azure/Jenkins upload only after the publication marker from the publisher directory | `ciRun` R4-P1-3 planted directory/symlink cases; `ciTemplatesRun` R4-P1-3 early-failure cases per system | `artifacts:` restored to GitLab: template assertion fails                                                                    |
| 4 P2 | Two-minute setup assumption admits uncovered turns                           | `jobStartMs` from the earliest measured start (GitLab job start, Azure pipeline start, Jenkins build start, else bootstrap start); no fixed allowance                            | `ciRun` R4-P2-5 Azure 16-minute-preparation refusal; fallback measures bootstrap elapsed                 | `Math.min` replaced with `nowMs`: refusal never throws, test fails                                                           |
| 5 P2 | Bounds time out the wait without stopping publication/cleanup work           | Filesystem publication/removal/cleanup run in a credential-free subprocess killed through its AbortSignal (`ci-files.mjs`); late writes cannot land                              | `ciRun` R4-P2-6 late-publication, subprocess-kill (SIGKILL, no late write) and retained-cleanup cases    | `child.kill` removed: worker survives to a different error, kill test fails                                                  |
| 6 P2 | Cleanup ownership misses early launcher failures                             | `ci-entry.mjs` registers its bounded exit owner on its first line, before importing the proposal launcher                                                                        | `ciRun` R4-P2-7 malformed-facts/missing-workspace cases; `ciTemplatesRun` module-load case               | Exit owner removed: bootstrap temp survives module-load failure, test fails                                                  |
| 7 P2 | Stale-output removal unbounded and dishonest on failure                      | `refuseExistingOutput` removes through `boundedFiles` and surfaces removal failure instead of claiming removal                                                                   | `ciRun` R4-P2-8 abort and EACCES cases                                                                   | Failure swallowed into a removal claim: EACCES oracle fails                                                                  |
| 8 P3 | PLAN.md records superseded R2/R3 transport; generation command not in README | R4 transport/lifecycle recorded in PLAN.md (D65 amendment + M80 entry); README documents `sync-ci-bootstrap.mjs`                                                                 | `ciTemplates` R4-P3-9 plan/certification wording test                                                    | Transport sentence weakened: wording test fails                                                                              |

Unconfirmed P1 verdict: **confirmed as a qualification and documentation gap,
not as a captured leak.** One user script cannot establish the environment of
Bitbucket's automatic clone/setup/upload processes, and deployment variables
are narrower than repository variables. The template uses a Secured
deployment variable (`deployment: muse-spark`), states the limit in the
template header, guide and `ciTemplates` R4-P1-U test, and configures no
repository artifact path. No hosted capture is authorized in this lane; vendor
process isolation remains unqualified.

Bootstrap trap hardening (continuation, 2026-10-10): the EXIT-trap removal is
`timeout -s KILL 5 rm -rf … 2>/dev/null || rm -rf …`, so a missing or
non-executing `timeout` cannot change the failure exit status (dash runs the
trap under the inherited `set -e`, which turned a digest refusal into exit
126 where `timeout` cannot exec). Drill: fallback removed → digest test fails
with 126; restored byte-exact.

### Test receipts (kubuntu rig, this worktree, repository timeouts, no `--testTimeout`)

- `ciRun` + `ciTemplates` + `ciTemplatesRun`: 85 passed.
- `actionRunExec` + `actionInstall` + `actionGit`: 98 passed.
- `actionInputs` + `actionGate` + `actionManifest`: 46 passed.
- `actionPost` + `actionApply` + `acpPackageFixtures`: 19 passed.
- Total: 248 tests across 12 files, all passed.
- `npm run typecheck` (all five projects): exit 0. One new-test type error
  found and fixed during the lane (overloaded `spawn` fake narrowed to the
  file's existing explicit spawn-child signature in
  `test/unit/helpers/actionModules.d.ts`).
- `npx eslint --max-warnings=0` on every changed source/test file: exit 0.
  Eight lint errors in the lane's work found and fixed (missing
  `Buffer` import and object-literal default in `ci-run.mjs`; scoping and
  `replaceAll`/`switch` modernizations in the template tests). No new
  `eslint-disable`, no `any`, no gate weakened.
- `npx prettier --check` on changed files: exit 0. `check:l10n`: 0 problems
  (14 UI, 14 usage, 252 manifest, 1512 source). `check:reference`: current
  (78 features, 71 commands, 100 settings, 29 slash, 257 CLI).
- `npm run build`: exit 0, bundle caps and split checks pass.
- Not run here: full `quality`, hosted vendor qualification, live L/LA/LR
  receipts (lead-owned, as before). No live runs, no real keys, no paid calls.

## R5: RVCM80CI4 findings fixed (lane CM80CIR5, 2026-10-10)

Review RVCM80CI4 at `8b38be1ef` (kubuntu) confirmed 1 P1, 1 P2, 1 P3. All
three are fixed below with a regression test each; every fix sweeps the
lane for siblings of the same kind. Fakes only; no real CI runs, no live
runs, no real keys, no paid calls. No new dependency, no widened guard.

| #    | Finding (RVCM80CI4)                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                       | Regression test (fails without it)                                                                                                                                                                                                                                                                                | Red drill (restored byte-exact, `sha256sum -c` OK)                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1 P1 | Azure start expression `{0:yyyy-MM-ddTHH:mm:ss.fffZ}` is not a documented `format()` form, so the pipeline rejects it (or drops the value) and the launcher loses vendor time                 | `MUSE_CI_PIPELINE_STARTED_AT` is now `$[ format('{0:yyyy}-{0:MM}-{0:dd}T{0:HH}:{0:mm}:{0:ss}Z', pipeline.startTime) ]`: every `{0:…}` item is exactly one documented specifier and every separator lives outside the items. `pipeline.startTime` (documented special datetime variable, UTC default) still supplies the conservative pre-checkout start; `jobStartMs` already ignores unparseable values in favour of the bootstrap start | `ciTemplates` "Azure expressions use only documented syntax": the start variable's specifiers are all documented, only ISO separators sit outside the items, all of yyyy/MM/dd/HH/mm/ss ship, a sample rendering parses via `Date.parse`; plus every Azure `$[…]`/condition expression uses documented words only | Old literal restored → the specifier test fails; restored OK                                                                            |
| 2 P2 | The parent trap unsets `muse_dir` then expands it under `set -u`, so an exec failure (e.g. no Node on a persistent agent's PATH) skips both removals and leaks the `0700` bootstrap directory | The parent copies `muse_cleanup_dir="$muse_dir"` before the trap; the trap copies `muse_rm_dir="$muse_cleanup_dir"` first, then unsets names/aliases, then removes `"$muse_rm_dir"`. Synced into all four templates by `node scripts/sync-ci-bootstrap.mjs`. Siblings swept: the inner download trap never unsets before use; no other unset-then-expand trap exists in the lane                                                          | `ciTemplatesRun` R5-P2 runs the exact parent slice from `bootstrap.sh` (generated names expanded) under `sh -e` and `bash -e` with a failing exec and asserts the directory is gone with no unbound-variable error                                                                                                | Old trap restored → the test fails; a manual dash probe shows `muse_dir: parameter not set` with the directory left behind; restored OK |
| 3 P3 | The Other CI systems help is gated on the invented selector `ciVendor&artifactTransport&secretIsolation`, which names nothing the product sets                                                | The condition is now `system`: the dimension (`gitlab`/`azure`/`jenkins`/`bitbucket`) the launcher branches on (`CI_SYSTEMS` in `ci-adapters.mjs`, the `system` parameter across `ci-run.mjs`), whose per-system states the paragraph explains. Reference regenerated (`reference.generated.json`/`.ts`, node blob, `docs/reference.md` now reads `system: Digest-pinned…`)                                                               | `referenceGenerator` R5-P3 asserts the feature's summary/description equal `{ conditions: [{ when: 'system', text: { ui: 'referenceCiOther' } }] }`, the rendered text starts with `system: ` without `ciVendor`, and the Markdown reference contains it                                                          | Condition reverted → the stale-reference gate fires; with a consistent regen the named test fails; source restored, regenerated, OK     |

Azure documentation cited (page fetched 2026-10-10,
[Expressions](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions?view=azure-devops)):
`format` "uses .NET custom date and time format specifiers for date
formatting (`yyyy`, `yy`, `MM`, `M`, `dd`, `d`, `HH`, `H`, `m`, `mm`,
`ss`, `s`, `f`, `ff`, `ffff`, `K`)" with the example
"`format('{0:yyyyMMdd}', pipeline.startTime)`", where "`pipeline.startTime`
is a special date time object variable" formatting
`system.pipelineStartTime`, "The default time zone for `pipeline.startTime`
is UTC". No hosted compile text was captured (no real CI runs in this
lane); the expression now uses only forms that page documents, and the
launcher keeps its bootstrap-start fallback for any value it cannot parse.

### Test receipts (kubuntu rig, this worktree, repository timeouts, no `--testTimeout`)

- `ciTemplates` + `ciTemplatesRun` + `ciRun`: 88 passed (85 at R4 + 2 P1
  expression tests + 1 P2 trap test).
- `referenceGenerator`: 117 passed (includes the new R5-P3 condition test).
- Typecheck, eslint and prettier on changed files, `check:l10n`,
  `check:reference` and `npm run build`: see the R5 lane report.
