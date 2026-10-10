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
