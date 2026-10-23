# Committed calibration profiles (M125 lane L)

One JSON file per (technique, family, engine) the project has measured:

```
profiles/<technique>/<family>/<engine-slug>.json
```

Each file is a `committedCalibrationFileSchema` envelope
(`src/shared/judgeCalibration/fileSchema.ts`): the commit date, the
independent label set the fit used, and the profile body. The two
path segments must equal the body's technique and family; the engine
slug is unique per directory and the body's provider, model and
endpoint name the measured engine.

## What may be committed

- Fitted only from independent labels (`independent-hand` or `m75`
  for these families; the parser refuses anything else, including the
  setup's rows, which carry no label source at all).
- At least 200 independent fit labels, 5 or more bins, and the 20%
  guardrail the calibration parser enforces.
- Independent evidence with measured rates: `evidence` and the
  evaluation's `evidence` are both `independent`. Weak (`synthetic`)
  or missing (no evaluation) evidence fails the calibration suite,
  which fails the build in CI.
- Dated and sourced: `committedAt` is the fit's date (never the
  future) and `labelSet` names the lane V run or bench it came from.

Selection prefers the exact (technique, family, engine) file, then
the newest file for the (technique, family), then the newest file for
the (technique, engine). No file means the family is off: the engine
path reports its own `profile-missing` and the decision runs its
deterministic checks with that reason.
