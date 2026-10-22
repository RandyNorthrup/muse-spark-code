# judgeCalibration loader fixtures (M125 lane L)

Clearly synthetic fixtures for the committed-profile loader tests,
built by the real fit/report code (not recorded exchanges, never
fitted profiles). Every profile claims the `synthetic-loader-fixture`
label set on the offline `fixture://offline` endpoint.

- `valid/systemone/loop.stuck/synthetic.json`: a well-formed file the
  loader accepts (200 fit labels, isotonic, independent evidence).
- `invalid/`: one failure each — `weak-evidence.json` (synthetic
  evidence), `missing-evaluation.json` (no measured rates),
  `future-date.json`, `path-mismatch.json` (body says
  risk.destructive under loop.stuck/), `bad.json` (not JSON),
  `duplicate-a.json` + `duplicate-b.json` (same engine twice),
  `top1/loop.stuck/x.json` (unsupported technique segment),
  `systemone/nonsense.family/x.json` (unsupported family segment).
