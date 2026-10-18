# CM80CI certification — headless runs on GitLab, Azure, Jenkins, Bitbucket

> **RVMSM80 addendum (2026-10-17):** every receipt below that rests on the
> fake agent or a locally simulated vendor host is withdrawn as proof under
> the owner's no-stand-ins rule. The process suites are deleted or reduced
> to pure logic through the real modules; the withdrawn behaviours are
> listed in `docs/real-life/unproven.md` and wait for hosted receipts. The
> design records and review history below stand as history, not evidence.

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

This transport design supersedes the R2/R3 transport and lifecycle claims
above. R6 below supersedes its Azure timing and parent-holder ownership.
The shell's download subshell removes the single generated
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

Historical receipt: R6 below replaces the Azure time expression and cleanup
holder policy. The `system` help condition remains current.

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

## R6: all RVCM80CI5 findings fixed (CM80CIR6 in CM80CIR4, 2026-10-10)

Reviewed baseline: `1f0e7dc052e86a88f2b000284296cf55346beddc`.
The lead directed removal of Azure's vendor time expression and protection of
parent cleanup holders with a dedicated prefix. Both P2 findings and the P3
acceptance gap are fixed; the sweep includes every old parent holder and all
four generated templates. No dependency, widened gate, paid/live call, hosted
vendor run, merge, push or subagent. No installation was needed.

| Finding                                                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Red drill                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 P2: Azure's literal Z asserts UTC for a non-UTC organization and loses real elapsed time | Delete the template's vendor time expression and the launcher's reader. Azure uses measured bootstrap epoch time minus `CI_AZURE_SETUP_MS` (600,000 ms); default job and fixture are 45 minutes. An earlier explicit measured job start can only reduce remaining time. Missing bootstrap refuses.                                                                                                                                                                                                                                                            | `ciRun` R6-P2-1 checks east/west-offset and malformed legacy times cannot influence admission, the 35-minute job refuses, 45 admits, six measured bootstrap minutes refuse, missing/future bootstrap refuses and an earlier job start remains conservative. `ciTemplates` checks declared/job timeout equality and admission after the full download bound.                                                                                                                                                                                                                                                | D1: setup reserve set to zero, named R6-P2-1 and two sibling deadline tests fail (3 failures). D7: future-start check removed, the same named test fails (1).                                                                                                                                                                                                                                                                                                                                                                                         |
| 2 P2: declared aliases can overwrite credential bindings and unset cleanup paths           | Every parent holder uses reserved `muse_ci_internal_` names. Shell and Node also reserve `MUSE_CI_`, `MUSE_INPUT_`, `MUSE_AGENT_`, covering temp/start/package bindings assigned at exec and configuration overwritten by wrappers. Shell refuses them before download; Node refuses them too. Ordinary aliases matching `muse_cleanup_dir`, `muse_rm_dir`, `muse_setup`, `muse_dir`, `muse_start_ms`, `muse_sum` and `muse_alias` preserve their original credential values until Node takes them. Subshell holders are already sanitized before assignment. | `ciTemplatesRun` successful exact-script alias runs for all four systems prove trusted exec stdin, child env/argv/log scrubbing and temp removal. Twenty reserved-alias refusal cases (five names × four systems) prove the alias guard refuses before any bootstrap child, including the temp/start/package and agent-version siblings. Exact generated parent slices apply the real unset list and aliases under sh -e, dash -e and bash -e; all 12 runs remove the directory and retain missing-exec exit 127. The prefix test guards the generated unset list; `ciRun` guards independent Node intake. | D2: R5 bootstrap restored and regenerated, 13 failures including all four successful alias and cleanup cases. D3: Node prefix check removed, named intake test fails (1). D4: shell prefix check removed and regenerated, all four before-child cases fail (4). D5: reserved removal holder added to generated unset list, prefix guard and all four cleanup cases fail (5). D8: shell configuration-prefix guards removed, sixteen transport/configuration cases fail. D9: Node configuration-prefix guard removed, the named intake case fails (1). |
| 3 P3: word/specifier tests accept an unmatched parenthesis in the vendor time expression   | Final Azure template must contain no runtime time expression or vendor-time variable; obsolete formatter tests are replaced by this absence guard. Existing condition-word checks remain.                                                                                                                                                                                                                                                                                                                                                                     | `ciTemplates` R6-P3 reads the final generated template and its parsed variables.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | D6: reinsert `$[ format('…', pipeline.startTime)) ]`, YAML remains valid but R6-P3 fails (1).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Azure allowance and qualification boundary

The selected allowance is **10 minutes (600,000 ms)** for job initialization,
full-history checkout and cold UseNode setup before the bootstrap's timestamp.
It is a conservative policy reserve for a qualified Linux runner, deliberately
separate from the measured bootstrap and its 120-second download bound; it is
not a measured hosted maximum or a universal Azure guarantee. The default
20-minute run's full post-admission tail is 1,764,000 ms (29.4 minutes).
Ten minutes setup + two minutes bootstrap download + 29.4 minutes launcher
and tails = 41.4 minutes, leaving 3.6 minutes inside the new 45-minute job.
Admission always deducts actual bootstrap elapsed time; a slow download or
unpack is not replaced by the two-minute figure. The runner owner must prove
all pre-bootstrap setup fits the ten-minute allowance before qualification.
A runner exceeding that requirement must not use this template; merely raising
job timeout is not proof. PLAN D65/M80, the guide, README, changelog and roadmap
state the same number and boundary. Organization timezone is irrelevant.

### Drills and restoration

Each drill ran its whole owning file with `npx vitest run <file> --maxWorkers=3`
and repository timeouts. Each mutated source and generated copy was restored
from saved bytes in a finally block, then compared with its original SHA-256.
All nine restorations passed. The final P3 drill used the review's extra closing
parenthesis, so this is proof of the previously missed malformed expression.

The first green attempt exposed an outdated 35-minute Azure fixture and a
cleanup-test extractor that selected the inner timestamp assignment. The
fixture now follows the 45-minute template; the extractor selects the quoted
parent result assignment. D2 then reproduced the real old trap failure with
that corrected extractor. No timeout, assertion or gate was relaxed. Linux
runs dash explicitly; macOS runs its shipped sh/bash without adding a dash
installation requirement. Windows retains the existing POSIX-suite boundary.
All editors use this same headless runtime; there is no editor-specific change.
The duplication gate exposed 16 lines of repeated per-test temp lifecycle in
the two owning suites. They now call one lifecycle factory in the existing
`ciFixtures.ts`; `jscpd` reports zero clones with its unchanged zero threshold.
Creation, cleanup and the missing-layout refusal keep the same behavior.

### Verification (kubuntu, directly in this worktree)

- Three complete owning files: `ciTemplates.test.ts` (31),
  `ciTemplatesRun.test.ts` (43), `ciRun.test.ts` (39): **113 passed** before
  the last transport/configuration drills; the initial guard set passed 97.
  Repository timeouts throughout, no `--testTimeout`.
- Final restored-tree checks and production sizes are recorded in the closing
  receipt below.
- Full quality and hosted/live qualification remain lead-owned under the rig
  brief. Existing external boundaries remain hosted vendor validation,
  GitLab/Bitbucket external-temp artifact transport, Bitbucket automatic-process
  isolation/timeout receipts and M80 release/live receipts. These fake tests
  close all three owned review findings and do not close those boundaries.

Restored implementation and regression bytes:

| File                                   | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `action/lib/ci-run.mjs`                | `8b95793460449e931368fb0156545c1bf4ec9fe72e5df39d95fc42619db79458` |
| `action/lib/ci-key.mjs`                | `3e0dd3c2056f7fe185e40b690ee76b061bf08c7da8452428f12c96c92356dc31` |
| `ci-templates/bootstrap.sh`            | `ce0bee8d4069929c8cc55cf7ef84b52ec8d5af6bbe42dae9d516766db84c86c6` |
| `ci-templates/gitlab-ci.yml`           | `3ebdee5298a8e0b7a23708c7be1f2e634ac8a47d5be57dbcebba44bd67a9974e` |
| `ci-templates/azure-pipelines.yml`     | `bfd960aeeafee0c8b684ed9a8a22fb2a7be9d98b299e4ab8d8b079e7ec2aff92` |
| `ci-templates/Jenkinsfile`             | `c8c7a37f31f362a0d92d80a928f8467766ddc11f8c8ff357c534b859adbbeb5e` |
| `ci-templates/bitbucket-pipelines.yml` | `d21c214f53b5acf96cb4930cc900eb5f014c56c6ec19d92e3aa343fd20c4b51a` |
| `test/unit/ciRun.test.ts`              | `46c3e01676c9df491ebc2bc94fb0e5ed004ddbae6a883f594bb6e346a7249556` |
| `test/unit/ciTemplates.test.ts`        | `646c33307f07cd514f81a483e62e0bb503ece10eb2324a372d8ac23e38c3ec29` |
| `test/unit/ciTemplatesRun.test.ts`     | `b62dec6f5fc9d0eacc3b997cf23f76f8c4139ed5777531c1d72930738f943a9e` |
| `test/unit/helpers/ciFixtures.ts`      | `1b0d36ef4ad301494f4ab3c6642375089d70034fb551ef59ce45155f5a8d1029` |

### Closing receipt (2026-10-10, kubuntu)

- Final restored source: owning files **113/113 passed** (31 templates,
  43 exact-script cases, 39 launcher cases), then reference generator
  **117/117 passed**: **230 tests**, repository timeouts, maxWorkers=3,
  at most three files in a run. No raised timeout or filtered test.
- All five TypeScript projects passed via `npm run typecheck`; the final
  helper/tests then passed `npm run typecheck:unit`. Targeted ESLint (zero
  warnings), Prettier on all supported changed files, plain knip, jscpd
  (zero clones), localization (14 UI/14 usage tables, 252 manifest strings,
  1512 source files, zero problems), host API, reference and roadmap gates
  all exited 0. Bootstrap shell syntax and `git diff --check` passed.
  Jenkinsfile/bootstrap.sh have no inferred Prettier parser; their exact
  generated shell is exercised by the POSIX suite instead.
- `npm run build` exited 0 with every existing budget/split/global/notice
  gate intact. Bytes/KiB: extension 563,348 / 550.14 (cap 600), Model API
  528,186 / 515.81 (cap 525), checkpoint store 89,366 / 87.27 (cap 225),
  reference 57,689 / 56.34 (cap 125). No cap or bundle-layout change.
- All nine deliberate drills failed their named regressions and restored
  every mutated file byte-exact. No new deferral, dependency, installation,
  daemon or background service. Full aggregate quality and hosted/live
  receipts remain lead-owned as the rig/common brief directs.
