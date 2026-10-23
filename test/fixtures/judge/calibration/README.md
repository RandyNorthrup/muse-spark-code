# Offline calibration fixtures

These fixtures are synthetic test data, not model captures, real M75 routing
receipts, or evidence that a model is calibrated. `grouped-risk.json` contains
an overconfident binary distribution: fit labels have positive rates 0.25 and
0.75 at predictions 0.1 and 0.9. All three splits have separate task and
repository groups. Model predictions are fabricated only here under `test/`.

`labels.json` records the family targets independently of outcomes:

- `risk.destructive`: can the command delete or overwrite data, or change
  shared state, irreversibly? Approval and passing checks do not alter a label.
- `skill.fit`: does the skill apply to the request? These are synthetic
  examples of the M75 routing-label contract, not existing M75 measurements.

The numerical tests expand independently identified rows to exercise the
199/200 fit-label boundary, pooled ties, and degenerate inputs. They retain
`evidence: synthetic`, so reports cannot activate those profiles. Real labelled
predictions and a counted model receipt are a separate prerequisite.
