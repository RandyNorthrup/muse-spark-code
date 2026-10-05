# CIFLOW — tiered CI and merge queue (2026-10-04)

The owner's brief authorizes local implementation and a hooked commit only.
No push, workflow dispatch, repository setting or ruleset mutation was made.
`release.yml` belongs to RELFAST and is unchanged. This record certifies local
workflow guards; hosted timing and merge-queue acceptance remain open.

## Measurement before changes

Successful [CI run 37211362498](https://github.com/RandyNorthrup/muse-spark-code/actions/runs/37211362498)
checked PR #106, head `ff030885ea642793b5b21a0ce1cd0d7703ec9f65`;
the Windows log identifies checkout `13d65eff64c6ac593aa38ef27cf10dae19e7ec75`.
Read with `gh run view 37211362498 --json jobs` and
`gh run view 37211362498 --log --job 111463131027`.

| Windows portion                                                                     | Observed time |
| ----------------------------------------------------------------------------------- | ------------- |
| Formatting, lint, five compiler projects, l10n, host API, knip, cycles, duplication | 3m25s         |
| Unit/process-e2e tests with V8 coverage                                             | 24m13s        |
| All 448 a11y pages (112 scenarios × four themes)                                    | 8m11s         |
| VS Code integration                                                                 | 1m15s         |
| Setup, build, audit, cache and cleanup remainder                                    | 1m19s         |
| Total quality job                                                                   | 38m23s        |

Ubuntu quality was 13m38s: quality:gates 7m02s, a11y 4m54s, integration
54s. macOS quality was 10m06s. Packaging was 1m11s after Windows finished;
the old CI run took 40 minutes from creation to packaged artifacts.

Replaying the installed Vitest sequencer's SHA-1 path ordering and balanced
four-shard ranges against the historical Windows file timings gives
87/87/86/86 files and test-body totals of 355.6/322.6/181.9/378.7 seconds.
Those totals exclude setup, transformation and coverage reporting; they
support the 6–10 minute shard estimate but are not new hosted measurements.

The accessibility script runs the same production browser bundle and axe
rules across the same scenarios and four captured VS Code themes. Its OS
difference is worker count (six maximum on Ubuntu, two on Windows), not
the page or acceptance rules. Run every page once on Ubuntu. Native process,
filesystem and helper behavior still receives its platform tests.

## Event layout and expected timing

- `pull_request` with the repository variable `CI_MERGE_QUEUE` set to `on`:
  Ubuntu static/build/audit gates and all unit/process-e2e tests without
  coverage, plus gitleaks and semgrep. Expected ≤12 minutes. Without the
  variable a PR runs the full tier, as before CIFLOW (lead review, below).
- `merge_group`: static/build/audit on Ubuntu, Windows and macOS; four
  coverage shards per OS; one merged coverage gate per OS at unchanged
  90/85/90/90 thresholds; full Ubuntu a11y; Linux/Windows integration; macOS
  compilation/disclaim check; universal VSIX, ACP tarball and SBOM checks.
  Expected 10–15 minutes, subject to shard balance and runner availability.
- `workflow_dispatch`: full tier. The reusable workflow defaults to full
  for other callers, including the unchanged release workflow until RELFAST
  lands artifact reuse.

Windows test files remain serial within each shard. Every shard is required;
each merge checks four nonempty blob files before `--merge-reports`. Vitest's
installed blob reporter includes the coverage map, and merging calls the
same coverage threshold enforcement as an unsharded run. Only partial shard
collection omits threshold enforcement; merged and ordinary runs retain it.

Artifact producers can run before slow tests finish, but the required package
aggregate cannot pass until the complete selected tier, helper, artifacts,
gitleaks and semgrep pass. Existing `muse-dictate-darwin`,
`muse-spark-code-vsix`, `muse-spark-code-acp` and `muse-spark-code-sboms`
artifact names, paths and package verification steps are unchanged.

## Required-check mapping and maintainer rollout

Read-only API inspection of ruleset `23896617` (`main`) on 2026-10-04 found
exactly these seven required names. The release-tag ruleset `23893754` has
no required checks. Hosts and Action check are not required, so no
`merge_group` trigger was added to them; their existing behavior stays intact.

| Required context, unchanged on both events | PR producer                | Queue producer                                     |
| ------------------------------------------ | -------------------------- | -------------------------------------------------- |
| `build / quality (ubuntu-latest)`          | Entire fast-tier aggregate | Entire full-tier aggregate                         |
| `build / quality (windows-latest)`         | Same fast aggregate        | Same full aggregate                                |
| `build / quality (macos-latest)`           | Same fast aggregate        | Same full aggregate                                |
| `build / gitleaks`                         | Real history scan          | Real history scan                                  |
| `build / semgrep`                          | Real SAST scan             | Real SAST scan                                     |
| `build / dictation helper (macos)`         | Entire fast-tier aggregate | Same full aggregate, including the compiled helper |
| `build / package (.vsix)`                  | Same fast aggregate        | Same full aggregate, including universal artifacts |

The lead must edit **main ruleset 23896617 only**, after this change lands:

1. Keep all seven required contexts above exactly as they are.
2. Change `required_status_checks.parameters.strict_required_status_checks_policy`
   from `true` to `false` (turn off requiring PR branches to be up to date).
3. Add the merge-queue rule, use **merge commits**, require **all group checks
   to pass**, set minimum and maximum merge group sizes to **1**, initial
   build concurrency to **1**, and check response timeout to **30 minutes**.
   One PR per group makes the checked merge commit the commit that lands.
4. Keep existing deletion, non-fast-forward and review/thread-resolution
   protections and release-tag rules unchanged.
5. Only after the queue rule is accepted, run
   `gh variable set CI_MERGE_QUEUE --body on`, which switches PRs to the fast
   tier; `gh variable delete CI_MERGE_QUEUE` switches them back. Use
   **Merge when ready** after PR checks; inspect the first fast PR run and
   the first queue run on its exact SHA.

No required-check rename or addition is needed. The PUT body for steps 1–4
(built from the live ruleset; it differs only in `strict` and the added
`merge_queue` rule) was handed to the lead outside the repository.

**Blocker: queue availability.** GitHub's documentation
(`data/reusables/gated-features/merge-queue.md` in github/docs, read
2026-10-04) says merge queues are available "in any public repository owned
by an organization, or in private repositories owned by organizations using
GitHub Enterprise Cloud". `gh api repos/RandyNorthrup/muse-spark-code` reports
`owner.type: "User"`. Expect the ruleset PUT to be refused (not tried; no
setting was changed). With the variable unset, nothing is weaker than before
CIFLOW: PRs keep the full tier and the queue path stays ready. Moving the
repository to an organization is the owner's decision. Timing estimates are
not claims of achieved hosted performance.

## Local verification

Windows focused workflow suites pass: `npx vitest run
test/unit/manifest.test.ts test/unit/actionManifest.test.ts`, 35 tests in two
files, exit 0; the restored final suites also pass 35/35. `actionlint` passes
both changed workflows. Changed-file ESLint passes with zero warnings.

Missing-shard drill: replace the full matrix's `[1,2,3,4]` with `[1,2,3]`, run
`npx vitest run test/unit/manifest.test.ts`, observe exit 1 in **collects all
four shards per OS and gates merged coverage with unchanged thresholds**.
Restore original bytes in `finally`, verify matching SHA-256
`b0049d61558d62f1cea5dce3e7ddf8916d5e381ac9abf62a09ec152f0b6aa5a5`,
then rerun both suites: 35 tests pass, exit 0. Valid red output is in
`temp/ciflow-red.log` locally. The first drill could not open an absent log
directory and did not run tests; its finally restored the source.

The serial static run passed host, webview and unit compiler projects. The
hard 75-minute box required stopping its owned process subtree while the e2e
compiler was running. E2e/integration compiler projects, knip, jscpd,
localization, host API and production build remain deferred to the lead.
No new build sizes or full quality/suite success are claimed. Partial raw
output is in `temp/ciflow-static.log`. Required brief gates (changed-file
ESLint, workflow suites, actionlint and final formatting) are the commit gates;
the common brief's remaining static checks need the lead's final-tree run.

An optional exhaustive Bash simulation of aggregate result combinations was
stopped under common.md's two-failed-fixes rule. Per-case shell launches
exceeded the existing 5s timeout; batching exceeded Windows's command-line
limit (`ENAMETOOLONG`); stdin batching still took 21s because Windows launches
each subshell as a process. The unshipped simulator was discarded rather than
raise a timeout or continue rewriting it. Required workflow-parsing guards
remain: exact event selection, all five matrix-emitted required names plus
the real security checks, dependency lists, fail-closed shell checks, four
shards, artifact wiring and merged coverage floors. Exhaustive runtime result
simulation and hosted execution remain unproved. One earlier local run read
old tests during the aggregate simplification and was invalidated; no passing
claim is based on that run.

The first changed-file ESLint invocation took roughly 14 minutes on the shared
Windows host and found one conditional-object-spread style error. The fix uses
the configured logical spread form and every() predicate; threshold values and shard semantics are
unchanged. No rule, timeout or budget was weakened.

The worktree initially contained Vitest/coverage-v8 5.0.1 despite lockfile
pins at 5.0.2. `npm ci` refreshed dependencies successfully before final validation. Host
runtime observed: Windows, Node v24.20.0, npm 11.19.0; CI remains pinned to
Node 22. The feature-delivery structural validator cannot parse the project's
existing prose milestone plan (no quality-ledger fence); plan-format migration
is deferred. The brief forbids full local quality and full test-suite runs;
those and hosted runs remain lead-owned.

## Lead review and completion (2026-10-04)

An adversarial review of `f6a40927` (all of `.github/workflows`,
`vitest.config.ts` and the tests) found two defects. Both are fixed in
`d97d5e0c`, and each fix has a test that fails without it.

1. **gitleaks fails every merge group.** The pinned
   `gitleaks/gitleaks-action@e0c47f4f` refuses any event outside push,
   pull_request, workflow_dispatch and schedule (`src/index.js`:
   `core.error("The [merge_group] event is not yet supported"); process.exit(1)`).
   In a reusable workflow `GITHUB_EVENT_NAME` is the caller's, so
   `build / gitleaks` would fail every queue entry and nothing could merge.
   The action now runs except on `merge_group`. A merge group downloads the
   action's own default CLI, gitleaks 8.24.3. The tarball's SHA-256
   `9991e0b2…ee29c` matched the release's checksums file and a local
   download. The CLI runs
   `gitleaks git --redact --no-banner -v --log-opts=HEAD .` over every
   commit the group's commit reaches.
   Scratch-repository drill (gitleaks 8.30.1): a fake key in a PR commit
   behind a `--no-ff` merge is found with `--log-opts=HEAD` (exit 1). The
   action's PR-style `--no-merges --first-parent base^..head` range from the
   merge commit misses it (exit 0), which is why the range is not reused.
   The worktree's real history passes the same command: 680 commits, no
   leaks, exit 0.
2. **Nothing tied the fast tier to the queue.** `fast` was simply
   `event_name == 'pull_request'`. Without an active merge queue a PR would
   pass all seven required names on Ubuntu-only checks and merge with no
   full gate ever run, the CIFLOW PR itself included. `ci.yml` now
   requires `vars.CI_MERGE_QUEUE == 'on'` as well, and the maintainer sets
   that variable only after the ruleset gains the queue. Unset (today), PRs
   run the full tier, now sharded.

Smaller changes: shards run `--reporter=default --reporter=blob`, so a
failing shard's log names its test (the blob reporter alone prints none). A
test pins the CI static list to `quality:gates` minus `test:unit`. The
headers of `build.yml` and `ci.yml` describe the tiers again.

Checked and found sound: aggregate `if: always()` with `test X = success` for
every selected-tier job (a skipped required job would report success, and
this rejects it). The `--shard` threshold switch and the merged enforcement
were proved on Vitest 5.0.2. `merge_group` is needed only on `ci.yml`: the
ruleset requires none of the Hosts or Action check names. The concurrency
group `ci-${{ github.ref }}` is unique per queue group
(`gh-readonly-queue/main/pr-N-…`), so no queue run cancels another. Every
artifact name and package step `release.yml` (main and RELFAST) reads is
unchanged; the release's own build gets the full tier (`fast` defaults to
`false`).

### Drills (all red, then restored, then green)

Merged coverage on Vitest 5.0.2: two shards of `manifest` and
`actionManifest` with `--coverage --reporter=default --reporter=blob`. Each
exited 0 at about 3% coverage, since shards carry no thresholds, and each
printed its own results. `vitest run --merge-reports --coverage` then
exited 1 with `ERROR: Coverage for lines (2.96%) does not meet global
threshold (90%)` and the same for functions, statements and branches.

Workflow guards, scripted by `ciflow-drills.mjs` (lead scratchpad). It
breaks a file, runs the named test, restores the original bytes in
`finally` and compares SHA-256 (`build.yml cb8fafc0…3505`,
`ci.yml 7852e317…8ad1`, each matching after restore):

| Break                                                                              | Test                                                      | Result                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| aggregate `test "$COVERAGE" = success` → `!= failure` (accepts an unexpected skip) | passes a required name only when its whole tier succeeded | exit 1; the one flipped case is `full, coverage skipped: passes` (want `fails`) |
| drop the gitleaks action's `if: github.event_name != 'merge_group'`                | scans a merge group with the checked CLI                  | exit 1                                                                          |
| `fast` back to `event_name == 'pull_request'` only                                 | checks PRs quickly and merge groups/manual calls fully    | exit 1                                                                          |
| drop `cycles` from the CI static list                                              | same                                                      | exit 1                                                                          |
| restored                                                                           | all five CIFLOW tests                                     | exit 0, 5 passed                                                                |

The aggregate test runs the `required` step's own script, cut from
`build.yml`, under bash with `-eo pipefail`, as GitHub runs it. There are 22
cases in one bash process: the full tier all green; each of the nine jobs
failed; each full-only job skipped; the helper cancelled; the fast tier
green with the rest skipped; each fast job skipped; semgrep cancelled. Only
the two all-green cases may pass. The test also checks that every needed
job has its own `needs.<id>.result` variable. It took about 7.5 s on this
loaded Windows host, so its budget is 60 s. The first run of the drill
script spawned Vitest through a shell and split the `-t` name into file
filters. That attempt timed out and its bytes were restored by hand
(SHA-256 matched); the rerun without a shell is the one recorded above.

### Final-tree checks

The tree is `382f9791` (`8645e8b9`, after merging `origin/main` at 0.12.1
with `changelog-rebase.py`: the CI bullet stays in `[Unreleased]`, where a
plain merge had put it under `0.12.0`, and every release heading is
main's). On the Windows host, every one of these exited 0: the five
compiler projects, `check:l10n`, `check:host-api`, `deadcode`, `cycles`,
`duplication`, `build` (every bundle within budget, for example
`extension.js` 590.6/600 KiB) and `format:check`. `actionlint` 1.7.12 passes
all six workflows. Changed-file ESLint passed in the pre-commit hook. Its
first attempt failed on 10 unicorn findings in the new test, which were
fixed, not suppressed.

The tests ran on the Kubuntu rig (`rig-test.sh kubuntu`, snapshot
`c08aef79` of this tree plus this record): `manifest`, `actionManifest`,
`changelogVersion` and `test/e2e/execStdio.e2e.test.ts` gave 4 files and 74
tests passed, exit 0. That includes the aggregate's bash cases on Linux and
the package guard, which runs the `build.yml` tarball step. On the Windows
host the first three suites passed. The e2e file hit 3 and then 6 timeouts
(`Test timed out in 30000ms`) at a load average of 86–101 on 20 cores from
other sessions. CIFLOW changes nothing under `test/e2e`, `scripts` or `src`,
and the step that file cuts from `build.yml` is byte-identical to
`origin/main`'s (SHA-256 `e1c8a342…715d`, 18 lines).

### Hand-off

The ruleset PUT body is in the lead's scratchpad (`ciflow-ruleset.json`).
It is live ruleset 23896617 with `strict_required_status_checks_policy:
false` and one `merge_queue` rule: `MERGE`, `ALLGREEN`, entries to merge
1/1, build concurrency 1, 0 wait, 30-minute check timeout. Nothing was
applied. See the queue-availability blocker above. Still open: hosted PR
and queue runs, measured wall times, and the queue itself.
