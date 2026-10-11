# CITIME017 — Windows unit tests in five shards (REL017INT, 2026-10-09)

The measurements and the estimate behind this change are CITIME017's, in
`docs/certification/rel017ci.md` ("CITIME017 — Windows shard time, acpStdio,
the handoff case"). With the product fixes in, four Windows shards were
estimated at 18.3 / 14.2 / 20.0 / 18.0 min against the `unit` job's 20-minute
limit; five at 15.5 / 13.8 / 13.4 / 13.3 / 14.5 min. Lead decision: five
Windows shards. Ubuntu and macOS keep four. No timeout, threshold or job
limit changed.

## Change

`.github/workflows/build.yml`:

- `unit` matrix: `shard` is `[1,2,3,4,5]` on the full tier, with
  `exclude` dropping shard 5 for `ubuntu-latest` and `macos-latest` (the fast
  tier keeps `[1]` and an empty exclude). The run passes
  `--shard="$SHARD/$SHARDS"`, where `SHARDS` is 5 on `windows-latest` and 4
  elsewhere.
- `coverage` job: the same per-OS `SHARDS` drives the presence check
  (`for shard in $(seq 1 "$SHARDS")`) before the merged-coverage run, so a
  missing Windows shard 5 still fails the job.
- Nothing else splits by shard index or count: `vitest.config.ts` only drops
  coverage thresholds while `--shard` is present (count-independent), and the
  visual-regression shards (six) are a separate job, unchanged.

`test/unit/manifest.test.ts` pins the new matrix, exclude, per-OS count and
presence loop. `CONTRIBUTING.md` and PLAN.md's CIFLOW section say four on
Ubuntu/macOS, five on Windows. `actionlint` reports nothing on the edited
workflow.

## Drill (Kubuntu, repository default timeouts)

| Break                                                                  | Result                                                                                                                         | Restored                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| Both per-OS `SHARDS:` expressions in build.yml replaced by `SHARDS: 4` | `manifest.test.ts` exit 1: "collects every shard per OS (five on Windows) and gates merged coverage with unchanged thresholds" | SHA-256 `facc6946…88a35` matches; 39/39 |

## Needs the hosted run

The 15.5-minute ceiling is an estimate from hosted timings of earlier runs;
the first full-tier run on this head is the measurement.
