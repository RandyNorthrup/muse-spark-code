# CM80CI certification — headless runs on GitLab, Azure, Jenkins, Bitbucket

Lane CM80CI (branch `c/m80-ci`), 2026-10-10, rig `macbook`. Scope: one
template per system under `ci-templates/` plus the shared dependency-free
runner `ci-templates/muse-spark-run.mjs`, equivalent to the GitHub Action's
documented inputs (plan/review mode, fix-mode limits, budget cap, model,
the key from that system's secret store, no comment/push, the same
refusals and exit codes). Docs: `docs/ci-other-systems.md`, README's
Other CI systems, Help reference `ci-other-systems`. No new dependency, no
escape hatch (PLAN.md §8 unchanged), no bundle-cap change.

## What was built

- `ci-templates/muse-spark-run.mjs` — validates every input with the
  Action's grammar (`action/lib/tools.mjs`), refuses untrusted sources
  with exit 0 before any dispatch (the Action's gate-skip semantics),
  deletes the key from the child environment, pipes it over private stdin
  to exactly one trusted child (`exec --key-stdin`, argv mirroring
  `action/lib/run-exec.mjs`), propagates exec's exit code unchanged, and
  installs the agent with no secret (exact registry pin or
  tarball-plus-digest, mirroring the Action's two install paths).
- Four templates wiring that runner with per-system secret stores and
  fork mechanisms: GitLab project-path rules + Masked/Protected variable,
  Azure `System.PullRequest.IsFork` + secret variable, Jenkins
  `withCredentials` (run stage only) + `CHANGE_FORK` with a same-repo PR
  opt-in, Bitbucket Secured variable + PR-build marking.
- Tests: `test/unit/ciTemplates.test.ts` (27 structural validators) and
  `test/unit/ciTemplatesRun.test.ts` (7 fake-agent end-to-end runs),
  with types for the runner in `test/unit/helpers/ciTemplates.d.ts`
  (the `actionModules.d.ts` pattern).

## Claim limits (not certified)

No live run on any of these four systems exists; the npm-registry install
path still waits on M80's LR receipt. Until then the tarball-plus-digest
path is the honest install route. The docs page, README and CHANGELOG say
exactly this.

## Test receipts (macbook, repository timeouts, no `--testTimeout`)

- `npx vitest run test/unit/ciTemplates.test.ts
test/unit/ciTemplatesRun.test.ts --maxWorkers=3` → 2 files, 34 tests,
  all pass.
- `node scripts/check-l10n.mjs` → 14 UI tables, 14 usage tables,
  252 manifest strings, 1512 source files; 0 problems.
- `node scripts/gen-reference.mjs --check` → 78 features; current.
  (One new `ci-other-systems` row; `REFERENCE_CAPABILITIES` gained its
  `acp:modelApi` surface next to `output-schema`.)
- eslint `--max-warnings=0` and prettier `--check` on every new/changed
  file → clean (the Jenkinsfile matches no staged lint pattern).

## Red drills (deliberate breaks, byte-exact restoration)

1. Validator drill: `MUSE_MAX_REQUESTS: '30'` → `'31'` in
   `ci-templates/gitlab-ci.yml`. `carries the Action-parity defaults:
gitlab-ci.yml` failed (1 failed, 26 passed). Restored with
   `git checkout --`; SHA-256 `d2d5f8a7…aca6ce` before and after.
2. Secret-piping drill: `'--key-stdin'` → `'--key-stdin-broken'` in the
   runner's `execArguments`. `pipes the key over private stdin only and
propagates completed/0` failed (1 failed, 6 passed). Restored with
   `git checkout --`; SHA-256 `f2d2b8d2…e2f7853d19` before and after.

## Review pass (one pass over every class)

- Validation/security: key shape validated before use; deleted from every
  child env; never on argv, never printed; tarball digest required;
  version pin exact; prompt/file bounds mirror exec's; templates refuse
  forks through each system's own signal and fail closed when unset.
- Failure paths and honesty: every refusal/input/key/install failure maps
  to the documented exit code; missing key on a trusted run exits 3;
  watchdog kills a hung agent with exit 6; no missing result invents
  success; uncertified status is stated in docs, README and CHANGELOG.
- Concurrency/lifecycle: one owner per run; single-flight `finish`
  latch; timer cleared on every path; install bound 300 s like the
  Action; no process spans template steps.
- Docs: CI systems page, README rows, CHANGELOG `[Unreleased]`, PLAN.md
  M80 status, Help reference row with all 14 translations.

## Editor and platform rows

Headless templates are editor-agnostic: they drive the ACP/headless
runtime, not any editor bridge, so VS Code, JetBrains, Visual Studio,
Eclipse, Zed, Xcode, Neovim/Emacs/Sublime and ACP all get the same run —
no later lane needed. Templates target Linux runners with Node 22; the
runner is dependency-free Node, normalises paths to forward slashes, and
its tests run at repository timeouts on this rig (Windows/macOS/Linux
hosted runs remain lead-owned).
