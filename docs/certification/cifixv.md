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
   token repair is also intentional. Full baseline generation and image review
   and full pixel replay are complete. `digest-mismatch: error` alone
   is an artifact-action input echo, not a named pixel scene. The aggregate
   requires `needs.visual-shards.result == success` before merging six valid
   receipts (`.github/workflows/build.yml:181`); the failed schedule shards
   cannot provide those receipts. No workflow or artifact validation changes.
   The hosted run was not fetched: the lane prohibits network calls.
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

## Verification

- Final serial owning runs: 7 files, 43 tests passed at repository defaults,
  every invocation `npx vitest run <files> --maxWorkers=3`, maximum three files:
  `harnessHistoricalFixture` + `m114Audit` + `visualGate` 21/21;
  `visualSource` + `visualMatrix` 10/10; `visualCapture` 11/11;
  `visualStability` 1/1. The browser owners run separately because each builds.
- Changed JavaScript files: eslint passed with zero warnings; Prettier passed.
- `check:roadmap`: current, no milestone/status/heading changes.
- Full `npm run build`: exit 0, including tokens, production compilation,
  all existing size/split/global gates and third-party notices. Measured:
  activation 549.4/600 KiB, Model API 515.8/525 KiB, resource governor
  106.1/125 KiB, checkpoint store 87.3/225 KiB. No budget was changed.
- Full `npm run check:visual`: exit 0, 9,792 captures, 17 changed pixels total,
  maximum three per image under unchanged limits. Baseline 447,310,229 bytes;
  candidate 447,310,992 bytes. Receipt `temp/m114-visual-result.json` binds
  the exact formatted manifest; no baseline reconstruction was needed on this
  matching rig environment.
- Separately reconstructed actual base `f5e0760c3` through `snapshot` and
  served its real schedule editor/list/timeline in Chrome: 12/12 captures,
  light/high-contrast dark and 320/690 px. Historical checkout removed after
  success. This proves the served-root repair through the browser even though
  the full pixel replay used the available reviewed archive.
- All five typechecks, localization, host API, reference, plan and plain knip:
  exit 0.
- Final `visualStability`: 1/1 passed at repository defaults (24.24 s whole file,
  independent default-bounded hooks; no `--testTimeout`).
- Full `jscpd`: exit 1 on an existing 51-token clone at
  `test/unit/modelApiLoopGuarantees.test.ts:741` and `:890`. Neither file nor
  duplication policy is changed; this belongs to the lead/other CI lane.

## Excluded attempts

The first full reviewed generation stopped after 3,816 captures because
`slash-commands` lost its rendered menu (no page errors). Three complete
focused matrices, six themes and both widths (36 default-state captures),
all passed with draft `/co`, caret 3, the composer focused and 16 real options.
No speculative product or capture change was made. The full generator was
restarted in a new external archive; the incomplete archive is not a baseline.
An accidentally overlapping unit invocation was interrupted with exit 130;
it is excluded; every owning file subsequently passed serially. A preliminary
pixel replay was interrupted when the manifest was formatted; the final full
replay above binds the formatted bytes. No deadline was raised.

## Reviewed baseline

Used the documented full-matrix update, after committing all capture inputs:

```sh
npm run check:visual -- --update --review=CIFIXV-integrated-accessibility-review-2026-10-09 --archive="$TMPDIR/cifixv-reviewed-final"
```

Exit 0: 9,792 PNGs, 447,310,229 bytes, 136 scenes and 185 render inputs across
six themes, 320/690 px and all six states. Captured source:
`484964c46c307b48a5f00b127c4bf358dd27aebf`. Chrome `153.0.8010.52`, Linux,
rasterization `a8de1ddfb6e62687899116825ad89f19166af18efdb086980f1c0e365c739033`.
The formatted manifest SHA-256 is
`c18961a47c55863b3955e9ddec2b41b25ac6004920b1af63764a0ffb63ea0ae4`.
The complete PNG set stays outside git at
`/var/tmp/l-CIFIXV/cifixv-reviewed-final`; review sheets, their frame index,
the prior manifest and the comparison scripts are retained separately at
`/var/tmp/l-CIFIXV/cifixv-review-final`.

Compared every candidate against the prior reviewed archive. Exactly 1,870
frames exceed the existing pixel tolerance; 757 other changed hashes remain
within that tolerance (751 have zero changed pixels, six have one); no capture
keys were added. The JSON receipt names those 66 groups with within-tolerance frames
as well as the 27 meaningful scene groups, 91 scenes in their union. Reviewed all 884 distinct
changed images on 59 labelled before/after sheets, plus original-size pairs
for accounts inputs, One Dark Pro Models focus, Dracula Resources history,
320 px team merge paths and high-contrast Help. The compact tracked receipt
`cifixv-visual-review.json` binds the exact manifest, changed-frame index,
sheet index and every sheet hash. Existing tolerance and coverage are retained.
Compared old/new capture metadata: state targets, applied flags, dimensions,
component mappings and capture keys are identical; only PNG hashes/byte counts
and the review/archive/source-revision fields change.

Accepted changes are the already merged `vis017` boundary contrast repair
(`0e5c4d39a`), Resources popover's three wrapping actions and narrow labelled
history cards, full-width team merge paths, current Resources Help commands,
and current release notes. Controls retain visible focus/state differences;
merge paths wrap by path; narrow history fields become readable labelled
cards. No new product regression was identified.

Named scenes with meaningful changes:

| Scenes                                                                                                                                                                                                   | Frames per scene |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------: |
| `accounts-edit`, `accounts-thresholds`                                                                                                                                                                   |               72 |
| `accounts-swap`                                                                                                                                                                                          |               70 |
| `help-narrow`, `whats-new`                                                                                                                                                                               |               36 |
| `models-configure`, `models-credential`, `models-errors`, `models-models`, `models-pick`, `models-providers`, `models-scanning`, `models-suggestions`, `models-table`, `models-test-cost`, `models-undo` |               72 |
| `resource-controls`, `resource-history`, `runners`                                                                                                                                                       |               72 |
| `team-cards`, `team-traffic`, `team-traffic-hints`, `team-traffic-recovery`                                                                                                                              |               72 |
| `traffic-conflicts`, `traffic-lanes`, `traffic-leases`, `traffic-mergeQueue`                                                                                                                             |               72 |

## Gate-fire drills

Both deliberate mutations ran at repository defaults, failed for the intended
reason, and restored the original file bytes in `finally` with SHA-256 checks.

| Mutation                                         | Failure                                                                                        | Restored file SHA-256                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Remove `repoRoot` from the schedule harness call | `harnessHistoricalFixture`: one failure, module 404 versus 200; unrelated fixture test passed  | `cc5c0f8d6793009d6ae23c7c6260bd418bf8d02d86ce9b0f10c7faf611a546eb` |
| Restore the stale accounts source hash           | `m114Audit`: one failure, actual current CSS hash versus stale receipt; six other tests passed | `0279ce4e93f56b0495895a2272358a802dfbe11e94d0d0d3593dc1b727790685` |

Logs: `temp/cifixv-drill-historical-schedule-root.log`,
`temp/cifixv-drill-current-accounts-classification.log`;
machine receipt `temp/cifixv-drills.json`. All final owning suites passed after
restoration. Accessibility results follow when complete.
Full quality and hosted CI replay remain lead-owned.
