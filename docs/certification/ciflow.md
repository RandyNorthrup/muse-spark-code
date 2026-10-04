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
