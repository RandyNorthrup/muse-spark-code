# M122 — Public roadmap: certification

Branch `rel017/roadmap` from `01ee6233b` (`origin/release/0.17.0`), worktree
`mx-roadmap`. No model calls, no live or paid calls, no push.

## What was built

- `scripts/gen-roadmap.mjs` bundles the PLAN reader exactly as
  `scripts/check-plan.mjs` does (esbuild over `readPlan`, `findMilestone`
  and the shared constants) and writes `ROADMAP.md` through Prettier with the
  repository's configuration. `--check` compares instead of writing.
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

A version is pending only while it is the newest dated `CHANGELOG.md`
heading and every §10 record for it is a preparation record.

## Counts (generated tree)

| Section             | Milestones |
| ------------------- | ---------- |
| In the next release | 1          |
| In progress         | 22         |
| Planned             | 12         |
| Shipped             | 89         |
| Not public          | 83         |

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

Run with `node scripts/gen-roadmap.mjs --check` on the final formatted files.

| Failure mode               | Break                                                | Exit | Message                                                                                  | Restored SHA-256 |
| -------------------------- | ---------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------- | ---------------- |
| Stale `ROADMAP.md`         | Edit the next-release intro sentence in `ROADMAP.md` | 1    | `roadmap: ROADMAP.md is stale from line 15; run npm run roadmap:generate`                | `3b2c2385…2f23`  |
| Milestone without an entry | Remove the M40 entry from `entries.json`             | 1    | `roadmap: M40: PLAN.md milestone has no entry in docs/roadmap/entries.json (add one; …)` | `74296a22…af66`  |
| Entry for an unknown id    | Add `{"id": "M999", …}` to `entries.json`            | 1    | `roadmap: M999: PLAN.md has no such milestone (nearest: M99, M109)`                      | `74296a22…af66`  |
| After restoring all three  | none                                                 | 0    | `Roadmap: 207 entries; ROADMAP.md is current`                                            |                  |

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
