# CIFIXV — 0.17.0 visual CI repair

Base `f5e0760c3`, branch `rel017/cifixv`, Linux test rig `linuxlt`.
Only the visual harness, reviewed baselines and source classification are owned.
Full quality and hosted replay remain lead-owned. No merge, push, paid/model
call, dependency, hook, timeout or threshold change.

## Root causes and regression evidence

1. `buildScheduleHarness` used the process working directory while the baseline
   server served an extracted Git revision. The schedule script returned 200,
   but its dynamically imported `temp/m115-v/surface/ScheduleSurface.js` returned 404. Pass the served root as esbuild's absolute working directory: both the
   actual revision's component source and emitted standalone entry now belong
   to that root. The regression uses a distinct historical source marker and
   checks entry status, module status, MIME and source identity. Before: 1/2
   failed on 404 versus 200; after: 2/2 passed, repository deadlines unchanged.
2. The first real pixel failure is `panel/accounts-edit/default/light/320`:
   1,632 changed pixels versus the unchanged allowance of 12. Compared the
   original and candidate PNGs: the intended `vis017` input-boundary contrast
   repair changes `--ms-border` to `--ms-boundary`. The later accounts link
   token repair is also intentional. Baseline generation/review and full pixel
   replay are pending. `digest-mismatch: error` alone is an artifact-action
   input echo, not a named pixel scene; no artifact validation is relaxed.
3. `m114Audit.test.mjs` (the classification owner, rather than visualStability)
   reproduced the reported accounts CSS failure: 6/7 passed, 1/7 failed.
   Recomputed SHA-256 from every current `audit.sources` file and retained all
   classifications/mappings and the immutable historical revision. Only
   `src/webview/models/sections/accounts/accounts.css` changed:
   `a8d731e592734bea4954ca6d9f7a5a5199203585ed14e7d6082b220520aa3971`
   to `ac3967716315d0b6fee79ef3df8cc5097763e1ff12a833272bf368a62acbfb87`.
   No tracked audit-refresh generator exists (PLAN section 7); this is the
   existing source-receipt algorithm, not a changed test or classification.
   After refresh: 7/7 passed.

## Verification so far

- `harnessHistoricalFixture` + `m114Audit`: 2 files, 9 tests passed.
- Changed JavaScript files: eslint passed with zero warnings; Prettier passed.
- `check:roadmap`: current, no milestone/status/heading changes.
- Production build invoked by `check:visual` passed before its pixel failure.

The new historical-loading guard fired against the original broken code.
All remaining visual, accessibility and stability results will be added after
reviewed generation. Full PNG sets stay outside git under the lane's private
disk-backed temporary directory.
