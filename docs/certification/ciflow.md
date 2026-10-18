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

## D122 — CI capacity from the organization account (2026-10-16, 2026-10-17)

**Why.** GitHub's limits are per account (docs `actions/reference/limits`,
read from `github/docs` 2026-10-16): 40 concurrent jobs with at most 5 on
macOS on the owner's Pro account, 20 with 5 on macOS on a free
organization. One full run of ours has 43 jobs, 12 of them macOS (counted
from run 38915744271), so macOS queued in three waves and pull requests
waited behind each other. The owner opened the free organization
`scnetsolutions` for capacity only; the repository stays on his account.

**What (the first design, 2026-10-16; replaced 2026-10-17, below).**
`ci.yml` gains `route` (picks the part from the event, the
repository and `ORG_CI`) and a `push` trigger on `ci/head-*` that runs only
in the capacity repository. `build.yml` takes `part` (`all` by default):
`home` keeps the Ubuntu shards, `org` runs only the Windows and macOS
shards, every other job runs outside `org`, and the `required` aggregate
names `org part` only when the shards ran in its own run.
`scripts/ci-org-relay.mjs` moves the merge commit and the result between the
two accounts with the maintainer's `gh` sign-in. A first design with two
stored tokens was dropped: minting them needed the owner's passkey and a
copy of each value, and the relay needs neither.

**Tests (the first design; the file went with PR #183's deletion of
`test/unit/manifest.test.ts`).** The one new test runs `route`'s own step from `ci.yml` in bash
for eight events, with the values GitHub sets (no made-up data):
`npx vitest run test/unit/manifest.test.ts` 41 passed, exit 0 (this PC,
2026-10-17). `actionlint` on both workflows, ESLint (zero warnings),
typecheck and `knip`: exit 0. Deliberate break (2026-10-17, on this route step): removing the
same-repository condition from the route step made the test fail, exit 1;
restored, it passed. The proof that the split works is its first real pull
request run in both accounts, recorded below once it has run.

### Review and redesign (2026-10-17)

**What was weak or broken in the first design.** Read with
`gh api repos/RandyNorthrup/muse-spark-code/rules/branches/main`
(2026-10-17): ruleset 23896617 requires the seven names and not
`build / org part`, with no expected source. In a `home` run the `required`
aggregate's `quality (windows-latest)` and `quality (macos-latest)` passed
with no Windows or macOS unit shard run, so a pull request could merge while
those shards failed or never ran. The relay ran on the maintainer's
computer: when it was not running, every home pull request waited; it found
home runs by downloading the `route` job's log. Dependabot's branches are in
this repository, so `SAME_REPO` sent its pull requests `home` (the route
test had no Dependabot case). `scripts/release-reuse.mjs` accepts a
successful `pull_request` run of `ci.yml`, and a home run's conclusion did
not include the shards. The variables were not set and the capacity
repository had no run (`gh variable list`; `gh api
repos/scnetsolutions/muse-spark-code-ci/actions/runs`: 0), so nothing ran
on the first design. The capacity repository is public, on the free
organization plan, with Actions on and every action allowed; secret
scanning push protection is off there and here (`security_and_analysis`,
read 2026-10-17). Turned on in the capacity repository alone, it would scan
the whole history on the first push.

**Research (read 2026-10-17).**

- Limits: [actions/reference/limits](https://docs.github.com/en/actions/reference/limits):
  Free 20 concurrent jobs, Pro 40, macOS 5 on both; a job runs at most 6
  hours; `GITHUB_TOKEN` makes at most 1,000 requests an hour per repository.
- Writing across accounts needs a credential of its own: events made with
  `GITHUB_TOKEN` start no workflow run, and an App installation token or a
  personal token does
  ([trigger a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)).
- An installation token lasts one hour and reaches only the installation's
  repositories and the permissions asked for
  ([generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)).
  `actions/create-github-app-token` v3.3.0 (released 2026-10-12, commit
  `64ab729a6294000f5aa4a4bc0b73d1f32bc45510`) takes `client-id`, `owner`,
  `repositories` and `permission-*`, revokes the token in its post step and
  skips that once it has expired (`lib/post.js` at v3.3.0).
- Editing files under `.github/workflows` needs the App's **Workflows**
  permission
  ([choosing permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app));
  `actions: write` does not cover it
  ([create-github-app-token#301](https://github.com/actions/create-github-app-token/issues/301)).
- Secrets: none reach a fork's run, none of the Actions secrets reach a
  Dependabot run, and a secret cannot stand in `if:`; test it through `env`
  ([use secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
  [Dependabot on Actions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions)).
- Required checks: any person or integration with write access can set any
  status, and a rule can name the app it expects
  ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
- Billing: standard runners are free in public repositories; a free
  organization includes 2,000 minutes a month for private ones
  ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- A job token reads another account's public repository through the API:
  `actions/setup-node`, in every job here, reads `actions/node-versions` with
  its default `github.token` ("When running this action on github.com, the
  default value is sufficient", its `action.yml`), and the run and job
  endpoints say "Anyone with read access to the repository can use this
  endpoint" (GitHub's OpenAPI description, read 2026-10-17). No page states
  it for these two endpoints with a job token whose `actions` permission is
  none, so the first hosted run is that proof; until then the wait step
  prints each failed read and fails ten minutes after the push.

**The design now.** PLAN.md D122 has the rule and the alternatives weighed.
One GitHub App owned by the organization, installed on the capacity
repository alone, with Contents and Workflows write; its key is a secret of
this repository only. build.yml's `org` job pushes the merge commit and waits
for the run there; the `required` aggregate folds the result into the seven
names. The relay script and its npm script are gone.

**Proofs (this PC, 2026-10-17).**

- `actionlint` 1.7.12, the latest release, on every workflow: exit 0.
  shellcheck is not installed here, so actionlint checked no `run:` script:
  NOT RUN.
- `zizmor` 1.25.2 `--offline` on `ci.yml` and `build.yml`: no findings
  (exit 0). With `--persona=pedantic`, one low finding, on main's unchanged
  `npx run-s ${{ matrix.part.gates }}` line.
- `route`'s step, read out of `ci.yml` and run with GitHub's
  `bash --noprofile --norc -eo pipefail`, for nine cases: capacity push
  `ci/pr-185` → `org`; push `ci/head-abc` → exit 1; own pull request with
  `ORG_CI` on and the key → `home`; `ORG_CI` off, no key (Dependabot or an
  unset secret), fork, fast tier, merge group and manual run → `all`.
- The push step, read out of `build.yml` and run against a local bare
  repository standing for the capacity repository (git's `url.insteadOf`),
  with a merge commit made as GitHub makes it (first parent main): exit 0,
  `ci/base` at the first parent and `ci/pr-185` at the merge. After main and
  the pull request each gained a commit, the second push sent 8 objects (3
  commits, 3 trees, 2 blobs), not the history again.
- The credential helper of that step: `git credential fill` answered
  `username=x-access-token` and the step's `TOKEN` (a dummy value).
- The wait step, read out of `build.yml` and run against real runs on
  GitHub, with `CAPACITY` pointed at a public repository that has push runs
  of a `ci.yml`: vitest-dev/vitest run 38750089126 (success) → exit 0, a
  28-line summary with every job linked; run 38930830264 (failure) → exit 1.
  Against `scnetsolutions/muse-spark-code-ci` and a commit with no run there:
  exit 1 after ten minutes, "no CI run on 59fce97aaa… appeared". Against a
  repository that does not exist: a warning each minute
  (`gh: Not Found (HTTP 404)`), then exit 1.
- The `required` step, read out of `build.yml`, with `PART=home`: `org`
  success → exit 0; failure, cancelled or skipped → exit 1; `PART=all` with
  `org` skipped → exit 0. Deliberate break: with the three lines that check
  `org` removed (a copy of `build.yml`), `PART=home` and a failed `org` gave
  exit 0, the first design's fault; restored, exit 1.

**No new test file.** main deleted `test/unit/manifest.test.ts` (PR #183),
and a unit test of `route` would feed it event values written in the test.
The runs above drove the steps themselves; the hosted runs are the proof.

**Still open.** The owner's five steps (CONTRIBUTING.md, "The capacity
repository (D122)"), then the first same-repository pull request: its run
here and the capacity repository's run, linked, with wall times against a
part `all` run. Optional hardening of something older than this change: the
main ruleset's seven checks name no expected source, so any writer's status
could satisfy them; naming GitHub Actions as their source closes that.

**What the design assumes.** The capacity comes from two accounts: the
concurrency limits are per account, so the pull request's repository and the
capacity repository must belong to different ones. On 2026-10-17 GitHub
refused the merge-queue rule on this repository (422 "Invalid rule
'merge_queue'"): merge queues are "available in any public repository owned
by an organization" (`github/docs`, `data/reusables/gated-features/merge-queue.md`).
If this repository moves into `scnetsolutions` for the queue, both
repositories share that free organization's 20 jobs and five macOS slots,
the split gains nothing, and `ORG_CI` should be deleted; the capacity
repository would then belong in the personal account (Pro: 40 jobs, five
macOS), behind an App that account owns, with the two hard-coded names in
`ci.yml` and `build.yml` changed. With the queue on, pull requests take the
fast tier and `merge_group` runs carry the full one, which `route` keeps on
part `all` today.

### Review fixes (ORGFIX210, 2026-10-17, on this rig)

The Codex reviewer's three P1 findings on PR #210, each fixed at its cause.
This section supersedes "Still open" above as of this date. `main-now`
(3d30a7321) was already merged into this branch (a218586e0), so the
required merge added no commit.

**Re-proof of the workflow steps against the edited files (this rig,
2026-10-17).** `actionlint` 1.7.12 (latest release) on all eight workflows:
exit 0. `zizmor` 1.31.1 (latest release) `--offline` on `ci.yml` and
`build.yml`: exit 0, with two low findings, both on lines this change does
not touch: `ci.yml`'s `./.github/workflows/build.yml` (newer zizmor prefers
the `$` self-repository syntax) and `build.yml`'s `npm install` of the
just-built agent tarball (that install is the test of the packaged
artifact). Both stay as they are. Three reasoned `shellcheck disable`
comments were added, none changing behavior: the push step's single quotes
keep the App token out of git's process list (the helper's shell expands it
from the step environment), `browser-check.yml`'s guard is deliberately
"not (A and B)" over two `[ ]` tests, and `release.yml`'s backticks are
literal markdown. They are visible only where shellcheck is installed;
without it `actionlint` passed before and after.
`route`'s step, read out of `ci.yml` and run with GitHub's
`bash --noprofile --norc -eo pipefail`, for the same nine cases: every
result as documented (`ci/pr-185` push → `org`, `ci/head-abc` push →
exit 1, own PR with `ORG_CI` on and the key → `home`, everything else →
`all`). The push step, read out of `build.yml` and run against a local bare
repository with a merge commit made as GitHub makes it: `ci/base` at the
first parent and `ci/pr-185` at the merge, and the second push after new
commits on both sides updated both refs without re-sending history. The
credential helper answered `username=x-access-token` and the step's `TOKEN`.
The `required` step with `PART=home`: `org` success → exit 0; failure,
cancelled or skipped → exit 1; `PART=all` with `org` skipped → exit 0. The
deliberate break on a copy (the `org` check removed) gave exit 0 with a
failed `org`, and the restored file gives exit 1. A cold `npm ci` from
`registry.npmjs.org` (901 packages, empty cache) took 11–12 s twice.
The extracted seed workflow parses as YAML and passes `actionlint`: exit 0.
The wait step's logic is unchanged; its `bash -n` passes and its exact query
shape and `pick` filter were run live against real runs (vitest-dev/vitest
38750089126 success → selected, `test success` passes; 38930830264 failure
→ selected, `test success` fails; the jobs endpoint returned the 22 rows the
summary renders). Only the `gh` transport itself could not run here: this
rig's `gh` build requires a login and there is no credential to give it, so
that transport rests on its unchanged 2026-10-17 run; nothing about it was
edited.

**Finding 1 — prove the cross-repository path before merging.** The four
App setup steps in CONTRIBUTING.md are done 2026-10-17: the app is
`msc-ci-capacity` (App ID 5362310, owned by `scnetsolutions`), installed on
`scnetsolutions/muse-spark-code-ci` only, with Contents and Workflows read
and write; `ORG_CI_APP_CLIENT_ID` and the secret `ORG_CI_APP_PRIVATE_KEY`
are set here, and `ORG_CI` is `on` (CONTRIBUTING.md steps 1–4 now say so).
PR #210 does not merge until the first hosted split run is recorded below:
nothing merges unproven, and the record belongs on the pull request. The
lead's next push of this branch triggers that run by itself (same-repo PR,
full tier while the queue is off, key present → `route` picks `home` and
pushes `ci/pr-210`). It must show all of this:

- Here: the PR's `CI` run is part `home`; the job named `tests
(windows-latest, macos-latest) in scnetsolutions/muse-spark-code-ci`
  pushes `GITHUB_SHA` as `ci/pr-210` (and `ci/base` at its first parent),
  finds the capacity run, and succeeds with a summary reading `Windows and
macOS unit shards: success` followed by sixteen linked shard rows.
- There: a push-triggered `CI` run on branch `ci/pr-210` whose head SHA is
  that same merge SHA; `route` picks `org`; all sixteen `tests
(windows-latest, shard 1–8)` and `tests (macos-latest, shard 1–8)` succeed.
- The required `quality (windows-latest)` and `quality (macos-latest)` are
  green here with the ruleset unchanged, and this run's cross-repo poll is
  what the `org` job's own read-only token proved (the App token only
  pushes; it expires after an hour while the wait may run up to six).
- Record here: both run URLs, both wall times against a part `all` run, and
  the shard times — the first run's shards start cold (step 6's seed lands
  after), which is what the 25-minute `org` bound below covers.

**Finding 2 — let the capacity wait survive the documented queue
(`build.yml` `org`, was 180 minutes).** The bound is now 360: GitHub's own
job ceiling on hosted runners (`actions/reference/limits`, read from
`github/docs` 2026-10-17: "Each job in a workflow can run for up to 6 hours
of execution time"), not our figure. Four queued pull requests ahead take
eight waves for their 32 macOS shards plus two more for this run's eight:
ten waves of full-length shards is 200 minutes before route and setup
overhead, which fits in 360 with room left; anything longer fails at the
platform's limit instead of ours. The poll itself costs one status read a
minute (at most ~360 reads, far under the token's 1,000-requests-an-hour
allowance), and the wait loop has no bound of its own besides the job. No
other line of the wait changed, so its proof above still covers it.

**Finding 3 — share one warmed cache across the capacity branches
(`build.yml` `unit`, was 20 minutes everywhere).** A cache restores only
from the current or the default branch (the dependency-caching reference),
and a `ci/pr-<number>` branch is neither, so every new pull request's
sixteen shards started cold; with macOS shards measured at 19 warm minutes
under a 20-minute limit, the cold install alone could time out a healthy
shard. Two legs: the `unit` job's bound is now `part == 'org'` → 25,
everything else stays 20 (the warm bound and its history are untouched).
25 is the 20-minute warm bound plus the measured cold `npm ci` (about a
minute, above) and margin, still far under the platform ceiling. And
CONTRIBUTING.md step 6 has the owner seed the capacity default-branch
cache: a `seed-cache.yml` file placed once on that repository's `main`,
run once by hand, then weekly, checking out only this repository's
`package.json` and `package-lock.json` and warming one npm cache per
capacity OS, holding no secret. `setup-node` restores by key prefix, so any
recent seed warms every `ci/pr-<number>` run on the same OS.

## CISHARDS — more shards, every shard on the organization's runners (2026-10-17, this rig)

`gh` has no credential on this rig (`gh auth login` required), so the
durations below come from the public Actions API, which needs none:
`actions/workflows/363874181/runs` for the runs and
`actions/runs/<id>/jobs?per_page=100` for each job's
`completed_at − started_at`. `ci.yml` almost never runs on `main` itself
(pull_request, merge_group, dispatch and `ci/pr-*` pushes only, and the
merge queue is off), so "the last green runs on main" are the green runs of
main-line commits: PR #210's split run and the two green merge-train runs
just before it.

### Baseline (all green, 2026-10-17)

Run 39078180972 (PR #210, part `home`; wall 10.4 min):

| Job                                                                                    | Duration                  |
| -------------------------------------------------------------------------------------- | ------------------------- |
| route                                                                                  | 0.1 min                   |
| tests (ubuntu-latest, shards 1–4)                                                      | 1.4 / 1.4 / 1.0 / 1.4 min |
| tests (windows-latest, macos-latest) in scnetsolutions/muse-spark-code-ci (`org` wait) | 10.1 min                  |
| static gates, slowest (macos build, windows lint)                                      | 3.9 / 5.0 min             |
| integration (ubuntu / windows)                                                         | 1.2 / 2.0 min             |
| dictation helper, semgrep, gitleaks, packages                                          | 2.2 / 2.2 / 0.5 / 2.0 min |

Its capacity run 39078260135 on branch `ci/pr-210` (part `org`; wall
8.0 min), current counts 4 Ubuntu (home) + 8 Windows + 8 macOS (org):

| Shards                     | Slowest job       | Fastest job       |
| -------------------------- | ----------------- | ----------------- |
| windows-latest, shards 1–8 | 2.8 min (shard 8) | 1.3 min (shard 4) |
| macos-latest, shards 1–8   | 2.2 min (shard 8) | 1.1 min (shard 2) |

Run 39070870774 (merge train 2026-10-17-3, part `all`; wall 11.6 min):
Windows shards 2.0–2.9 min, macOS 1.3–2.3 min, Ubuntu 1.4–2.0 min;
slowest static gate 9.2 min (macos lint). Run 39065488443 (train
2026-10-17-1, part `all`; wall 24.4 min): same shards, the wall is
personal-account queueing — that is the ~21-minute scale the brief names.
The suite is 311 files (`test/unit`, plus `test/e2e` in the same run);
every current shard is already under 5 minutes, but the slowest Windows
shard (2.9 min) times the documented ~60% hosted swing (PLAN.md §8) lands
at 4.6 min — no margin left as the suite grows back.

### Chosen counts and arithmetic

Ubuntu 8, Windows 16, macOS 16: forty shards, every one of them in part
`org` when `ORG_CI` is on. Windows and macOS run files serially
(`vitest.config.ts`: `fileParallelism` off on win32 and hosted macOS), so
shard test time halves with the file count: slowest Windows shard test
≈ 2.9 − 0.7 (warm setup) ≈ 2.2 min per 1/8 of the suite → ≈ 1.1 min per
1/16, plus ≈ 0.7 min setup ≈ 1.8 min typical, × 1.6 variance ≈ 2.9 min.
Cold org start adds ≈ 1 min `npm ci` (measured 11–12 s download, above) →
≈ 2.8 min × 1.6 ≈ 4.5 min, still under 5. macOS: ≈ 8 min suite / 16 ≈
0.5 min + setup ≈ 1.5 min × 1.6 ≈ 2.4 min. Ubuntu (parallel workers):
2.0 min max at 1/4 → ≈ 1.3 min at 1/8 × 1.6 ≈ 2.1 min.

Expected wall: the org unit phase ≈ slowest shard + route/setup ≈ 4–5
min; the home run ≈ max(slowest static gate, org wait) ≈ 10 min; and a
split pull request runs zero shard jobs on the personal account (was four
Ubuntu), so queued runs stop waiting behind its shards. Part-`all` runs
(forks, Dependabot, merge groups) keep everything here with forty smaller
shards instead of twenty: more setup minutes in total, a shorter slowest
tail. Timeouts stay 20 warm / 25 org: ceilings, not targets.

### What changed (this lane)

`build.yml`: the `unit` matrix runs 8 Ubuntu + 16 Windows + 16 macOS shards
(`SHARDS` 8/16/16; Ubuntu excludes 9–16), and runs none of them in a `home`
run (`if: inputs.part != 'home'`), so part `org` carries all forty. The
`org` job stands for the shards on all three platforms and its summary
header reads `Unit shards (Ubuntu, Windows, macOS)`. The `required`
aggregate requires `org` (not `unit`) when `PART=home` and `unit` (not
`org`) otherwise; the seven required names are unchanged. `ci.yml` keeps
its route: same-repo PRs with the key go `home`, everything else stays
`all`. PLAN.md D122 and CONTRIBUTING.md's capacity section name the forty
shards.

### Local proof (this rig, 2026-10-17)

- Both workflows parse as YAML. The `fromJSON` matrix expressions,
  simulated for every (`part`, `fast`) combination, give 40 combos
  (8 Ubuntu + 16 Windows + 16 macOS) on `all` and `org`, none built on
  `home` (`unit` is skipped by its `if`), 1 unsharded Ubuntu combo on
  `fast`, and every shard index within its `SHARDS` (8/16/16). The
  simulation caught one real bug before it shipped: the first edit left
  `part == 'org'` in the exclude's empty branch, which would have run
  `--shard=9/8` … `--shard=16/8` on Ubuntu in the capacity run; the empty
  branch is now `fast` only.
- The `required` step, read out of `build.yml` and run under GitHub's
  `bash --noprofile --norc -eo pipefail`, 7/7: `home` passes only on `org`
  success (failure, cancelled and skipped all exit 1); `all` passes only on
  `unit` success. Break drill on a copy: `= success` → `!= failure` on the
  org check lets a skipped `org` through (exit 0); the file as committed
  exits 1.
- The `route` step, read out of `ci.yml`, 9/9 with the 2026-10-17
  expectations (capacity push → `org`, bad branch → exit 1, own PR with key
  → `home`, everything else → `all`).
- `actionlint` 1.7.12 (latest release; shellcheck present, so `run:`
  scripts were checked): exit 0 on both workflows. `zizmor` 1.31.1
  `--offline`: the two known low findings, both on untouched lines
  (`build.yml`'s install of the just-built agent tarball, `ci.yml`'s
  `./.github/workflows/build.yml` self path); `--persona=pedantic` adds the
  known `matrix.part.gates` template finding, also untouched. Nothing on a
  changed line.
- `prettier --check` on all six changed files, `npm run check:plan`
  (plan-format-v1, 218 milestones, 0 drift) and `npm run build`: exit 0.
  No JS/TS file changed, so ESLint and typecheck have no files in scope;
  no unit-test file names the shard matrix, and workflow steps are proved
  by driving the extracted steps above, not by a new test file (no-fakes
  rule: a unit test would feed the steps invented event values).

### Hosted proof (lead's push; the real gate)

The push of this branch opens a same-repository PR run here and a
`ci/pr-<n>` run there. It must show all of this, recorded on the PR:

- Here: `route` picks `home`; `unit` is skipped; `org` pushes `GITHUB_SHA`
  as `ci/pr-<n>` (and `ci/base` at its first parent) and succeeds with a
  summary reading `Unit shards (Ubuntu, Windows, macOS): success` followed
  by forty linked shard rows.
- There: a push-triggered run on `ci/pr-<n>` at that same SHA; `route`
  picks `org`; all forty `tests (<os>, shard N)` succeed, none over
  ~5 minutes.
- The required `quality (ubuntu-latest)`, `quality (windows-latest)` and
  `quality (macos-latest)` are green here with the ruleset unchanged, and
  both walls plus every shard time go into this record against the baseline
  above.

## CISHARDS2 — every Windows and macOS job runs on the organization's runners (2026-10-18, this rig)

### Inventory: every job still on windows-latest or macos-latest on the personal side

Read off the workflow files at this lane's base (`a72759811`). Durations
are `completed_at − started_at` from the public Actions API (no credential):
run 39078180972 (PR #210, part `home`) for CI jobs, run 39080679626 (hosts),
run 39078180976 (browser-check) and run 39069570743 (forks). The longest
unit test shard is 2.9 min (Windows shard, merge-train run 39070870774).

| #   | Job (workflow)                                      | Runner today   | Before (min)      | Moves to                            | Label there                                               |
| --- | --------------------------------------------------- | -------------- | ----------------- | ----------------------------------- | --------------------------------------------------------- |
| 1   | static gates, lint (build.yml `checks`)             | windows-latest | 5.0               | org run, `part` `org`               | larger (`msc-windows-8core`)                              |
| 2   | static gates, unit lint (build.yml `checks`)        | windows-latest | 1.8               | org run                             | larger (named in the brief with the other gates)          |
| 3   | static gates, build (build.yml `checks`)            | windows-latest | 4.8               | org run                             | larger                                                    |
| 4   | static gates, lint (build.yml `checks`)             | macos-latest   | 3.7               | org run                             | standard (PR218FIX: no larger macOS runner on a free org) |
| 5   | static gates, unit lint (build.yml `checks`)        | macos-latest   | 1.3               | org run                             | standard (as row 4)                                       |
| 6   | static gates, build (build.yml `checks`)            | macos-latest   | 3.9               | org run                             | standard (as row 4)                                       |
| 7   | unit shards 1–16 (build.yml `unit`)                 | windows/macos  | moved by CISHARDS | stays in the org run                | standard (brief: shards stay free)                        |
| 8   | integration (build.yml, windows)                    | windows-latest | 2.0               | org run                             | standard (under the 2.9 min shard bar)                    |
| 9   | compile dictation helper (build.yml `native-build`) | macos-latest   | 2.2               | org run                             | standard (under the bar)                                  |
| 10  | package helper, darwin (hosts.yml `native-helpers`) | macos-latest   | 0.8               | moves with its workflow (see below) | standard                                                  |
| 11  | agent package (hosts.yml, windows)                  | windows-latest | 1.1               | moves with its workflow             | standard                                                  |
| 12  | agent package (hosts.yml, macos)                    | macos-latest   | 0.6               | moves with its workflow             | standard                                                  |
| 13  | package helper, darwin (forks.yml `native-helpers`) | macos-latest   | 0.8               | moves with its workflow             | standard                                                  |
| 14  | captures (browser-check.yml, windows)               | windows-latest | 3.1               | org run, per-OS split               | larger (over the 2.9 min bar)                             |
| 15  | captures (browser-check.yml, macos)                 | macos-latest   | 2.4               | org run, per-OS split               | standard (under the bar)                                  |

Ubuntu jobs (static gates, unit shards 1–8, integration, helpers,
packages, aggregates) and the `org` wait itself stay on the personal
account, as do all jobs of every fork, Dependabot, merge-group, manual,
schedule and push run (part `all`, as now).

### How each moves

- **build.yml (rows 1–9).** The `checks`, `integration` and `native-build`
  matrices pick their operating systems from `part`: `home` keeps only the
  Ubuntu leg here, `org` (the capacity repository's push run) runs only the
  Windows/macOS legs, `all` runs everything here as now. `native-build` is
  skipped in `home` exactly like `unit` already is. `packages` stays on
  Ubuntu here but runs after `org` in a `home` run: the `org` job downloads
  the two darwin artifacts from the capacity run it just waited for and
  re-uploads them under their existing names, so `packages` and the release
  reuse path read them unchanged. The `required` aggregate keeps its seven
  names; in a `home` run the Windows/macOS quality names and the dictation
  helper name require `org` instead of the Ubuntu-only legs here.
- **hosts.yml and forks.yml (rows 10–13).** Their jobs consume each other's
  artifacts inside one run (`native-helpers` → `packages`/`vsix` →
  `agent`/`fork`), which cannot cross repositories, so the whole workflow
  moves: a routed same-repository pull request run (new `route` job, same
  nine cases as `ci.yml`'s) skips every job here, and the capacity
  repository's `ci/pr-<n>` push run runs every job there. Any other event
  runs everything here, as now.
- **browser-check.yml (rows 14–15).** Its per-OS captures upload only their
  own result files, so it splits: a routed run keeps the Ubuntu capture
  here and runs the Windows and macOS captures in the capacity run; any
  other event runs all three here.
- **Larger labels.** `runs-on` selects the larger label only when all three
  hold: `part == 'org'`, the repository variable `LARGE_RUNNERS == 'on'`,
  and the job's row above says larger. `vars` resolves in the repository
  that owns the run, so the variable lives on the organization repository
  alone (lead step: `gh variable set LARGE_RUNNERS --body on` there, before
  pushing the pull request — it is read when each job starts); a
  fork's `pull_request` run is part `all` on its own repository and can
  never satisfy the first condition. Standard runners stay free for this
  public repository; only the rows above marked larger bill the
  organization's budget.
- **The App token never runs pull-request code.** The `org` job's steps are
  enumerated in the implementation record below; it mints the token,
  clones, pushes the merge commit, polls the public run API and relays the
  two darwin artifacts. It runs no `npm ci`, no script and no binary the
  pull request carries.

### Expected cost per pull-request run (arithmetic, before-minutes as estimate)

Prices: Windows 8-core $0.042/min; standard runners $0.
Larger-runner minutes on a typical pull request (no browser-path files):
Windows gates 5.0 + 1.8 + 4.8 = 11.6 min × 0.042 = **≈ $0.49 per run**.
A browser-path pull request adds the Windows capture 3.1 × 0.042 = $0.130,
total ≈ $0.62. At $40 a month that is about 81 typical runs before the
budget stops paid usage (the lead switches `LARGE_RUNNERS` off first).
macOS stays on free standard runners: the GitHub-owned macOS larger labels
need a Team or Enterprise plan and the capacity organization is free
(PR218FIX, below). Larger runners should finish the same gates
faster; the after-minutes replace these estimates once the first hosted
run lands, in the implementation record below.

### Implementation record (this lane)

`build.yml` (checks/integration/native-build legs by `part`, `native-build`
skipped in `home`, `packages` after `org` with a producer assert, `org`
relays the two darwin artifacts, `required` keeps its seven names with
per-check meaning), `ci.yml` (header), `hosts.yml`/`forks.yml` (new `route`,
whole-workflow move), `browser-check.yml` (new `route`, per-OS split,
larger Windows capture). Larger labels apply only when `part == 'org'`
and that repository's `LARGE_RUNNERS` is `on`. PLAN.md D122,
CONTRIBUTING.md (capacity section + lead step 7) and CHANGELOG.md move with
the code.

**Local proof (this rig, 2026-10-18).** Both actionlint 1.7.12 (shellcheck
present, so `run:` scripts were checked) and prettier: exit 0 on all eight
workflows; `npm run check:plan` (plan-format-v1, 218 milestones, 0 drift),
`npm run typecheck` (all five compiler projects) and `npm run build`
(every bundle within budget): exit 0. No JS/TS file changed, so ESLint has
no file in scope; the hook's changed-file ESLint ran on every commit.
`zizmor` 1.31.1 `--offline` on the five touched workflows: three
low findings, every one on a line this change does not touch (build's
install of the just-built agent tarball, ci's `./.github/workflows`
self path, hosts' install of the just-built agent package);
`--persona=pedantic` adds three template-injection helps, also untouched
(`matrix.part.gates`, `matrix.fork`, `matrix.release`, all from static
lists). `temp/cishards2-drills.mjs` drives the steps out of the committed
files under GitHub's `bash --noprofile --norc -eo pipefail`: 125/125 green
— ci route 9/9, hosts/forks/browser routes 8/8 each, required 5 checks ×
home/all green plus home org-failed/cancelled/skipped (15 red), home
Ubuntu-leg failures failing only their own names, all-part producer
failures, fast-tier greens, packages assert 5/5, checks/integration/captures
matrix simulation for every part, runs-on label simulation
(org+large → larger labels, large off/unset or part all/home →
standard), and `bash -n` on the wait, relay and push steps. Break drill on
a copy (`test "$ORG" = success` → `!= failure`) lets a skipped `org`
through; the committed file rejects it. One drill bug was found and fixed
in the driver itself (its expression tokenizer glued parentheses to names);
the workflow expressions were never changed for it.

**The App token never installs or runs pull-request code.** The `org` job's
steps after this change, in order: create-github-app-token (pinned v3.3.0,
contents+workflows of the capacity repository only), checkout
(fetch-depth 0, no credentials), `git push` of the two refs through a
credential helper that reads the step environment, the wait loop (`gh api`
reads of the public run endpoints with the job's own token, summary
write), `gh run download` of the two darwin artifacts from that run, and
their re-upload under the existing names. No `npm ci`, no `node`, no
script and no binary the pull request carries runs in this job; the
downloaded helpers are only re-uploaded (the `test -f` guards fail the job
if the layout ever differs). The checkout action clones but executes
nothing from the tree.

**After-minutes.** Larger-runner minutes are not yet measured (no hosted
run on this lane); the $1.40/$1.53 estimates above use the before-minutes.
The lead's hosted run replaces them here with the six gate times, the
Windows capture time, and the true billed total.

### Hosted proof (lead's push; the real gate)

The push of this branch opens a same-repository pull request run here and
a `ci/pr-<n>` push run in `scnetsolutions/muse-spark-code-ci` (plus
hosts/forks/browser-check runs there when their paths match). It must show
all of this, recorded on the pull request:

- Here, the `CI` run's `route` picks `home`; `unit` and `native-build` are
  skipped; `checks` holds only the three Ubuntu gates; `integration` holds
  only Ubuntu; `org` pushes `GITHUB_SHA` as `ci/pr-<n>` (and `ci/base` at
  its first parent), succeeds with the forty shard rows plus the gate,
  integration and helper legs, and re-uploads `muse-dictate-darwin` and
  `muse-vault-darwin`; `packages` consumes them unchanged.
- There, the `ci/pr-<n>` run's `route` picks `org`; the Windows static
  gates run on `msc-windows-8core` (once the lead sets `LARGE_RUNNERS` to
  `on` there before pushing; before that, standard labels), the macOS gates
  on standard `macos-latest`, every other moved leg on standard runners;
  all succeed.
- **No job running on `windows-latest` or `macos-latest` remains on the
  personal run**: its jobs list shows Ubuntu legs, `route`, the `org` wait
  (Ubuntu), the aggregates and the Linux helpers/packages only. Hosts,
  Forks and browser-check personal runs of the pull request show `route`,
  the `relay` job, skipped jobs (Hosts/Forks) or the Ubuntu capture only
  (browser-check).
- The required `quality (ubuntu/windows/macos-latest)`, `dictation helper
(macos)` and `package (.vsix)` are green here with the ruleset unchanged.
- Both walls, every moved leg's minutes (the after column), and the billed
  total go into this record against the estimates above.
- Dependabot, fork, merge-group and manual runs are unaffected (part `all`,
  standard labels); the lead's `LARGE_RUNNERS` step stays a variable flip,
  never a workflow edit.

### Review fixes (RVCISHARDS2, 2026-10-17, this rig)

Three defects the lane's matrix-only simulation could not see, each proved
before its fix by `temp/rv-cishards2-drill.mjs` (parsed-workflow facts plus
the `required` step executed under `bash -eo pipefail`; 15 failures before,
all pass after):

- build.yml's `checks` job kept `if: inputs.part != 'org'`, so the capacity
  run — the only run whose `checks` matrix holds Windows and macOS — skipped
  the static gates entirely, and a `home` run's `quality (windows-latest)` /
  `quality (macos-latest)` could go green with those gates run nowhere (the
  larger-runner `runs-on` branch was dead with it). The job-level condition
  is gone; the matrix picks each part's operating systems.
- hosts.yml's, forks.yml's and browser-check.yml's jobs all `needs: route`
  with no status function in their conditions, so GitHub's implicit
  `success()` over `needs` skipped every one of them whenever `route` itself
  is skipped — a push to `main` here would have run the whole Hosts workflow
  as an empty success. Each job now carries `!cancelled()`, and chained jobs
  require their predecessor's success explicitly.
- forks.yml's and browser-check.yml's new `ci/pr-*` push triggers had no
  `paths`, so every capacity push would have run them in full; they now
  mirror their `pull_request` paths, as hosts.yml already did.

The hosted proof above must additionally show the Windows and macOS
`static gates (...)` jobs present and green in the capacity run, and a
push to `main` here still running the full Hosts workflow.

### Review fixes (PR218FIX, 2026-10-18, this rig)

Six Codex threads on PR #218 (branch `ci/more-shards2`): three were already
fixed by RVCISHARDS2 and are verified present, not redone; three applied.

- build.yml:77 (static gates skipped in org builds): already fixed
  (`ed4feb907`) — no job-level guard; the matrix picks each part's systems.
- forks.yml:90 (relay offloaded results): FIXED (`a1d6a761d`) — hosts.yml,
  forks.yml and browser-check.yml each gain a `relay` job that runs only in
  a `home` run, polls the capacity repository's run of the same workflow on
  the pushed merge commit, and takes its result (failure there fails here).
  When no run appears within ten minutes, the capacity push matched none of
  that workflow's paths, so no run was started: the job succeeds with a
  warning instead of failing a pull request whose latest push touched none
  of those paths (a docs-only follow-up push to a src pull request must stay
  green). build.yml's `org` job already fails closed when the push itself is
  missing, so a genuinely lost push still goes red there.
- hosts.yml:70 (Hosts skipped on source main pushes): already fixed
  (`54b617125`) — every job carries `!cancelled()`.
- browser-check.yml:44 (path filtering on capacity pushes): already fixed
  (`684a9f091`) — both push triggers mirror their `pull_request` paths.
- build.yml:417 (artifact downloads): FIXED (`9d6232c68`) — the relay mints
  a fresh App token after the wait (actions read on the capacity repository
  alone) and the two `gh run download` calls use it instead of this run's
  own `github.token`, which is scoped to this repository; the push token is
  not reused because it may have expired during the wait.
- hosts.yml:106 (fast PR runs): FIXED (`a1d6a761d`) — the three auxiliary
  routes gain `ci.yml`'s fast-tier condition (`FAST`, `pull_request` with
  `CI_MERGE_QUEUE == 'on'` → `all`), so a fast-tier pull request keeps every
  Hosts/Forks job and every browser capture local, matching the build,
  which pushes no capacity branch in that tier.

Drill `temp/pr218fix-drill.mjs` (local only, not committed) drives the steps
out of the committed files under GitHub's `bash --noprofile --norc -eo
pipefail`, 18/18 green: each of the three routes gives `all` with
`FAST=true` and `home` with `FAST=false`, and the pre-fix step gives `home`
for a fast pull request (the bug); each `relay` step exits 0 on a successful
capacity run, 1 on a failed one, and 0 with a warning when no run appears.
`bash -n` passes on all three relay steps. Hosted runs are the proof (below).

Lead measurement (org run 39083598004 with `LARGE_RUNNERS=on`, static gates
on standard labels): two causes, both fixed in this lane. First, `runs-on`
is read when each job starts, so a variable set after the push reaches only
jobs that start later — the early static gates kept standard labels while
the later Windows browser capture (run 39083598068) took
`msc-windows-8core`. CONTRIBUTING.md step 7 now says to set the variable
before pushing. Second, the macOS gates can never take a larger label on
this free organization: the GitHub-owned macOS larger labels
(`macos-latest-xlarge`) need a Team or Enterprise plan
([Actions runner pricing](https://docs.github.com/en/enterprise-cloud@latest/billing/reference/actions-runner-pricing):
"Larger runners are only available for organizations and enterprises using
the GitHub Team or GitHub Enterprise Cloud plans"), so that label would
queue forever; `msc-windows-8core` works because it is the organization's
own runner (proven by run 39083598068). build.yml now selects the larger
label for Windows gates only, macOS stays standard like the macOS browser
capture; the inventory rows 4–6, the cost arithmetic (≈ $0.49 typical,
≈ $0.62 browser-path, ≈ 81 runs per $40) and PLAN.md/CONTRIBUTING.md/
CHANGELOG.md say so. The next hosted run (variable set before the push)
must show: the capacity run's three Windows `static gates` jobs on
`msc-windows-8core`, the two macOS `static gates` jobs on standard
`macos-latest`, all green; the home run's `org` relay step green
(capacity-scoped download); and each auxiliary `relay` job green with its
capacity run linked in the summary.

### Relay without a new App permission (PR218FIX2, 2026-10-18, this rig)

Hosted run 39086224761 (job 117553280594, 2026-10-18 01:30Z) failed at the
step PR218FIX added: `##[error]The permissions requested are not granted to
this installation.` Minting a fresh capacity-scoped App token with
`permission-actions: read` needs the Actions permission on the
`msc-ci-capacity` installation, which it does not have — and adding one is
not wanted. The org run itself (scnetsolutions/muse-spark-code-ci run 39086262404) succeeded.

**Chosen token: this run's own `GITHUB_TOKEN`** (`GH_TOKEN: ${{
github.token }}` on the `bring the macOS helpers back` step); the
`relay-token` mint step is deleted, so the workflow requests no permission
the app lacks. Source and why, measured rather than assumed:

- The failed run is itself the measurement for reachability: its `wait`
  step already reads the capacity repository's runs and jobs endpoints with
  `GH_TOKEN: ${{ github.token }}` and got past the wait — only the
  relay-token mint failed. This run's token reaches the public capacity
  repository.
- The REST reference for Actions artifacts
  ([download a repository artifact](https://docs.github.com/en/rest/actions/artifacts?apiVersion=2022-11-28#download-a-repository-artifact),
  read 2026-10-18) says anyone with read access may download, and only a
  private repository needs a token with repo scope. The capacity repository
  is public, so any authenticated token — this run's included — has read
  access. `gh run download` lists and fetches through exactly these
  endpoints.
- It is the narrowest of the tokens the workflow already has. The other
  candidate, the push token (`steps.token.outputs.token`), carries
  contents write plus workflows write and expires one hour after mint
  while the wait may run up to six hours — broader, and possibly dead on
  arrival. This run's token holds only contents read here, lives as long
  as the job, and adds no App permission.

**The next hosted run must show:** the home run's `org` job green end to
end with the org run linked in its summary, the two darwin artifacts
re-uploaded under their existing names, and `packages` consuming them
unchanged. No local simulation counts as proof: this rig has no credential
for the capacity repository, so the download transport itself is proved
only by that hosted relay step going green.

### Review fixes (PR218FIX3, 2026-10-18, this rig)

One Codex P1 thread on PR #218 (branch `ci/more-shards2`), first result:

- browser-check.yml:49 (capacity trigger on incremental, not cumulative,
  paths; forks.yml/hosts.yml same): ACCEPTED and fixed at the cause. The
  `push: branches: [ci/pr-*]` triggers of browser-check.yml and forks.yml
  and the `push: branches: [main, ci/pr-*]` trigger of hosts.yml carry no
  `paths:` filter anymore: a push filter sees only the incremental
  force-push diff while the `pull_request` filter sees the cumulative PR
  diff, so the mirrored filters skipped the capacity run whenever the latest
  update touched only an unrelated file, and each `relay` then passed with
  no Windows or macOS run anywhere. Every capacity push now starts its
  workflow, and the `route` job's new `touches` output re-applies the path
  list: a `ci/pr-*` push diffs the merge commit against its first parent
  (`HEAD^1..HEAD`, the cumulative PR diff — the same `$GITHUB_SHA^1` the
  `org` job pushes as `ci/base`); a `main` push diffs the push's own
  commits (`before..HEAD`, what the removed filter did there); anything else
  keeps `true`. The offloaded jobs run unless `touches == 'false'` (a
  skipped `route` leaves it empty, which still runs — the RVCISHARDS2
  fallback). A non-merge capacity tip, a missing base or a diff error fails
  closed to `true` with a warning, never to a skipped gate. Each `relay`'s
  no-run branch now fails closed (exit 1): with unfiltered starts, no run
  appearing means the push or Actions there failed.

**Local proof (this rig, 2026-10-18).** `temp/pr218fix3-drill.mjs`
(local only, not committed) drives the `touches` step out of each committed
workflow file under GitHub's `bash --noprofile --norc -eo pipefail`,
against real git repos shaped as GitHub shapes them (merge commits with
first parent main): 13/13 green — the stale push (browser file changed,
docs-only head commit) gives `true` on browser-check and hosts; a docs-only
PR gives `false` on all three; a `main` push gives `true`/`false` on its own
commits; a non-merge capacity tip and a missing base fail closed to `true`
with warnings; non-push events keep `true`. The drill also asserts each
`touches` pattern list equals its `pull_request` `paths:` list as sets, and
that every `relay` fails closed with no silent no-run pass left.
`actionlint` 1.7.12 (latest release; shellcheck present, so the three new
`run:` scripts were checked): exit 0 on all eight workflows. `shellcheck`
`-S warning`: clean on all three extracted steps. `prettier --check` on the
five changed files, `npm run check:plan` (plan-format-v1, 218 milestones,
0 drift), `npm run typecheck` (all five compiler projects) and `npm run
build`: exit 0. No JS/TS file changed, so ESLint has no file in scope; the
hook's changed-file ESLint ran on every commit. No unit-test file names
these steps, and workflow steps are proved by driving the extracted steps
above, not by a new test file (no-fakes rule: a unit test would feed the
steps invented event values).

**Hosted proof (lead's push; the real gate).** The push of this branch must
show all of this, recorded on the pull request:

- A pull request whose latest push touches only an unrelated file after an
  earlier browser/hosts/fork path change: the home Browser/Hosts/Forks runs
  start (cumulative match), each capacity `ci/pr-<n>` run starts too, its
  `route` logs `Touches these paths: true (the cumulative merge diff
touches these paths)`, and the offloaded jobs run green.
- A pull request touching none of those paths: the home runs never start
  (unchanged), each capacity run's `route` logs `touches: false` and its
  jobs skip, and the capacity run still concludes success.
- A push to `main` here touching only docs still runs only `route` (the
  in-workflow incremental gate), as the removed push filter did.
- No `relay` takes the no-run branch; if one ever does, it fails the run
  with `the push or Actions there failed`.

### Review fixes (PR218W2, 2026-10-18, this rig)

Three Codex threads on PR #218 (branch `ci/more-shards2`), first result —
no hosted CI failure list follows the threads in this brief, so none to add:

- browser-check.yml (cumulative PR paths on capacity updates, P1): ALREADY
  FIXED by `70e829764` (HEAD) — the `ci/pr-*` push triggers carry no
  `paths:` filter and each `route` job's `touches` output re-applies the
  path list to the cumulative merge diff (`HEAD^1..HEAD`); answered, not redone.
- hosts.yml:409 (appearance deadline from relay start, P1): ACCEPTED, fix in
  this lane — each `relay` waits for the capacity push to land first, then
  starts its ten-minute run-appearance clock from the push.
- forks.yml:302 (relays must outlive healthy multi-stage runs, P2): ACCEPTED,
  fix in this lane — each `relay`'s `timeout-minutes` goes 120 to 360, the
  platform-scale bound build.yml's capacity waiter already uses.
