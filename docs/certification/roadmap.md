# M122 — Public roadmap: certification

Branch `rel017/roadmap` from `01ee6233b` (`origin/release/0.17.0`), worktree
`mx-roadmap`. No model calls, no live or paid calls, no push.

## What was built

- `scripts/gen-roadmap.mjs` bundles the PLAN reader exactly as
  `scripts/check-plan.mjs` does (esbuild over `readPlan`, `findMilestone`
  and the shared constants) and writes `ROADMAP.md` through Prettier with the
  repository's configuration. `--check` compares instead of writing. Since
  the review fixes, the rules live in `scripts/lib/roadmap.mjs`, a pure
  function of the three input texts with the reader and formatter passed in,
  tested by `test/unit/genRoadmap.test.mjs` (25 tests on in-memory fixtures
  through the real PLAN reader, about 1 s).
- `docs/roadmap/entries.json`: 207 entries, one per PLAN milestone
  (`check:plan`: 207 milestones, 0 drift).
- `npm run check:roadmap` (`node scripts/gen-roadmap.mjs --check`) and
  `npm run roadmap:generate`; `check:roadmap` runs in `quality:gates` (so in
  `quality` and `quality:ci`) and in `build.yml`'s static gates, next to
  `check:plan`.
- PLAN.md: the M122 record and a §10 record,
  `0.17.0 preparation (2026-10-08, release branch)`, which makes 0.17.0 the
  roadmap's next release.

## Placement rules

| PLAN status                                         | Entry `release`     | Section                                                                              |
| --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| built, certified, merged, complete, released        | a shipped version   | Shipped, under that version                                                          |
| built, certified, merged, complete, released        | the pending version | In the next release                                                                  |
| built, certified, merged, complete (not `released`) | none                | In progress, "Built; not in a release yet."                                          |
| building                                            | none / any          | In progress (with "First parts …" if named)                                          |
| waiting                                             | none / any          | In progress ("Waiting on a prerequisite." / "First parts …")                         |
| planned                                             | none                | Planned                                                                              |
| planned                                             | any                 | In progress with "First parts …", plus a printed note that the status line is behind |
| superseded                                          | must be internal    | nowhere                                                                              |

A version is pending while every §10 record for it is a preparation record;
each pending version gets its own _In the next release (X.Y.Z)_ section,
oldest first, and a pending version without a dated `CHANGELOG.md` heading
fails the gate. (Until the review fixes, only the newest changelog version
could be pending.)

## Counts (generated tree)

| Section                      | Milestones |
| ---------------------------- | ---------- |
| In the next release (0.17.0) | 2          |
| In progress                  | 21         |
| Planned                      | 12         |
| Shipped                      | 89         |
| Not public                   | 83         |

SECWINPATH moved from In progress to the next release when its entry gained
`"release": "0.17.0"`.

The 83 non-public entries (each carries its reason in `note`):

- 27 release trains, preparations and integrations (TRAIN…, REL…, INT…,
  LEFT017, VIS017, MONEY017, FIX0150R, FIX0160X, M26-follow-up);
- 12 CI repairs (CI0150…, CIFIX14…, MACSLOW, PR132W);
- 12 review-fix rounds whose result belongs to a public milestone
  (FIXM112…, FIXM116P4, FIXM118…, FIXHELPREF…, REDHELPREF, FIXAGENTOUT,
  SECWINPATH2);
- 7 test and screenshot infrastructure milestones;
- 4 size and startup budgets (M57, DIET1, STARTDIET, VSIXDIET2);
- 3 program range headings whose members have their own entries
  (M43–M56, M67–M85, M87–M88);
- 3 folded or superseded milestones (M41, M44b, M85);
- 15 others with no user-visible change of their own: the scaffold (M0),
  internal refactors and gates (M60, M61, FIXCYCLES, FIXCYCLES2, KNIPC), the
  evaluation harness (M75), dependency and fingerprint updates (DEP138,
  SDK142), store badges (BADGEFIX), exact-money ports tracked by M121
  (PORTS017), groundwork (PROMPTMENU2), infrastructure verification
  (PR132M), the M53 usage follow-up, and this milestone (M122).

## Gate drills (each restored byte-exact, then the gate passed again)

Run with `node scripts/gen-roadmap.mjs --check` on the final formatted files
of `8be63aa28` (before the fingerprint line moved later lines down by two).

| Failure mode               | Break                                                | Exit | Message                                                                                  | Restored SHA-256 |
| -------------------------- | ---------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- | ---------------- |
| Stale `ROADMAP.md`         | Edit the next-release intro sentence in `ROADMAP.md` | 1    | `roadmap: ROADMAP.md is stale from line 15; run npm run roadmap:generate`                | `3b2c2385…2f23`  |
| Milestone without an entry | Remove the M40 entry from `entries.json`             | 1    | `roadmap: M40: PLAN.md milestone has no entry in docs/roadmap/entries.json (add one; …)` | `74296a22…af66`  |
| Entry for an unknown id    | Add `{"id": "M999", …}` to `entries.json`            | 1    | `roadmap: M999: PLAN.md has no such milestone (nearest: M99, M109)`                      | `74296a22…af66`  |
| After restoring all three  | none                                                 | 0    | `Roadmap: 207 entries; ROADMAP.md is current`                                            |                  |

## Review fixes (RVROADMAP, 2026-10-08)

The independent review of `8be63aa28` found 11 P2 and 3 P3 issues, each
checked against its cited source before the fix. Claims commit `95023a743`;
generator, tests and PLAN record `89bcaf6ff`.

| #   | Finding                                          | Change                                                                                                                                                                      | Evidence or test                                                                                                      |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | M21 said sensitive config writes always ask      | "asks for approval in every mode except Bypass"                                                                                                                             | `permissions.ts` `verdictFor` returns allow for `allowAll` first; CHANGELOG 0.6.0                                     |
| 2   | M51 opt-in, M73 off by default                   | Both "on by default since 0.13.0"                                                                                                                                           | CHANGELOG 0.13.0 (D78); `package.json` `modelApiHooks` and `modelApiObservationPacking` default `true`                |
| 3   | M35 advertised Model API Muse Voice              | "the Model API backend currently refuses it …", label _Not available yet_                                                                                                   | `extension.ts` `museVoice` returns `sessionBudgetVoiceUnavailable` for every Model API selection                      |
| 4   | M56 "every request" routed                       | Model API requests on every supported version; Muse Voice's connection only from VS Code 1.112                                                                              | CHANGELOG 0.10.0; README Proxies and certificates; `voiceProcesses.ts` `new WebSocket(url)`                           |
| 5   | M82 cap without the child exception              | "though child tasks you approve separately can take it past the cap"                                                                                                        | `ModelApiHost.ts` `budgeted()`; CHANGELOG 0.12.0                                                                      |
| 6   | M107 slowed and paused running work              | Holds back new background work; work already running continues                                                                                                              | README "Keeping your machine responsive"; CHANGELOG 0.16.0                                                            |
| 7   | M112 promised exactly once                       | "with a warning if a failed save means it may be sent again"                                                                                                                | `src/acp/agent.ts` `commitAnswers`; CHANGELOG 0.17.0                                                                  |
| 8   | SECWINPATH had no release                        | `"release": "0.17.0"`; listed under the next release                                                                                                                        | `afc978b72` (the Windows path merge) is an ancestor of the release branch, not of `v0.16.0`                           |
| 9   | M80 read as an ordinary released feature         | "both can be tried but are not certified or supported yet"                                                                                                                  | PLAN M80 receipts L and LR pending; README Headless and CI; AGENTS.md M80 rule                                        |
| 10  | An older preparation was listed as shipped       | Every version with only preparation records is pending, each in its own section, oldest first; a preparation without a dated heading fails                                  | Tests "lists every prepared, unreleased version …", "moves a version under Shipped …", "refuses a prepared version …" |
| 11  | `m19` and `SECWINPATH` passed the id guard       | Public words are matched, case-insensitively and as whole words, against every milestone and working id PLAN.md and entries.json know, besides `[MD]\d+`                    | Tests "rejects a known milestone or working id …" (5 cases), "still rejects unknown …", "accepts words …"             |
| 12  | M95b Preview implied live-checked services       | "though a successful reply from either real service has not been checked yet"                                                                                               | `docs/certification/m95b.md` acceptance 1, 5 and 8                                                                    |
| 13  | A missing id crashed with a `TypeError`          | The id is validated before lookup: `entries.json entry N: "id" must be a non-empty trimmed string naming a PLAN.md milestone`                                               | Tests "reports an id that is … as a malformed entry" (missing, number, untrimmed, empty)                              |
| 14  | PLAN changes that read the same passed `--check` | A SHA-256 source fingerprint (milestone ids, headings, statuses, status dates; §10 record versions, dates, kinds; changelog headings; every entry) is the comment on line 5 | Tests "changes when … changes" (6 cases); gate drills G1–G3 below                                                     |

Finding 10 also exposed real data: PLAN §10 held only the
`0.16.0 preparation` record, although 0.16.0 is published (tag `v0.16.0` on
`4da4ef666`, PR #140, release run 37736641658, GitHub release published
2026-10-08 06:17 UTC). The new rule listed 0.16.0 as unreleased until the
`0.16.0 released (…)` record was added.

### Red drills (each restored byte-exact)

Unit drills replace one guard in `scripts/lib/roadmap.mjs`
(SHA-256 `86ea0fd9…be04` before and after each) and run
`npx vitest run test/unit/genRoadmap.test.mjs`. D10, D11 and D13 put back
the `8be63aa28` rule; D14 makes the fingerprint a constant.

| Drill                                             | Exit | Tests that fail                                                                                                                                        |
| ------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D10: only the newest changelog version is pending | 1    | "lists every prepared, unreleased version in its own next-release section, oldest first"; "refuses a prepared version with no dated changelog heading" |
| D11: only `\b[MD]\d+` is rejected                 | 1    | all five "rejects a known milestone or working id …" cases (`m2`, `SECFIX`, `secfix`, `M3` by name, `m4` in a title)                                   |
| D13: no id check before lookup                    | 1    | all four "reports an id that is … as a malformed entry instead of failing" cases                                                                       |
| D14: constant fingerprint                         | 1    | all six "changes when … changes, even though the listing reads the same" cases                                                                         |
| Stale: `staleReason` always passes                | 1    | the six fingerprint cases and "passes a current file and names the first stale line otherwise"                                                         |
| Missing: no missing-entry problem                 | 1    | "refuses a PLAN milestone without an entry"                                                                                                            |
| Unknown: no unknown-id problem                    | 1    | "refuses an entry for a milestone PLAN.md does not have"                                                                                               |
| After restoring all                               | 0    | none (25 passed)                                                                                                                                       |

Gate drills change a real input that the listing does not show and run
`node scripts/gen-roadmap.mjs --check`:

| Drill                                  | Exit | Message                                                                                                                                                                | Restored SHA-256 |
| -------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| G1: an internal note in `entries.json` | 1    | `roadmap: ROADMAP.md was generated from other PLAN.md, CHANGELOG.md or docs/roadmap/entries.json facts (its source fingerprint differs); run npm run roadmap:generate` | `99ae9c98…879f`  |
| G2: M122's heading date in `PLAN.md`   | 1    | same                                                                                                                                                                   | `706f7573…ad35`  |
| G3: the 0.16.0 released record's date  | 1    | same                                                                                                                                                                   | `706f7573…ad35`  |
| After restoring all three              | 0    | `Roadmap: 207 entries; ROADMAP.md is current`                                                                                                                          |                  |

## Known limits

- PLAN status lines are behind the changelog for M95, M96, M101, M105, M106,
  M107, M108, M113, M114, M115 and M117 (still `planned`). The roadmap
  follows PLAN, so they are listed under In progress with "First parts …"
  rather than under Shipped or the next release, and the generator prints a
  note for each. Updating those status lines moves them without editing the
  roadmap by hand.
- Publication is not visible inside the repository. After 0.17.0 is
  published, §10 needs its `0.17.0 released (…)` record and a regeneration,
  or the roadmap keeps calling 0.17.0 the next release (AGENTS.md rule 17,
  `docs/RELEASING.md`).
- `release` is curated per entry because the changelog cites milestone ids
  unevenly (no citation for M10–M32, M112, M118 or M119). The gate checks
  that each named release has a changelog heading, not which release a
  milestone first shipped in.
- SECWINPATH's changelog text sits under `[Unreleased]`, not `[0.17.0]`,
  although its merge is in the 0.17.0 release branch; the roadmap follows
  the code. The release lane should move that text into `[0.17.0]`.
- The id guard is case-insensitive for every known id, so the working ids
  that are English words (`DEFAULTS`, `SHOTS`) cannot appear as whole words
  in public titles or summaries ("defaults", "shots"); rephrase instead.
- The fingerprint covers the facts the roadmap reads, not all of PLAN.md:
  a milestone's goal, lanes or checklist can change without regeneration.
