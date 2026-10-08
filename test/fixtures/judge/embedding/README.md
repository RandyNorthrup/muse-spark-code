# Embedding fast-path fixtures

These fixtures are synthetic test data, not model captures, real M75
routing receipts, or evidence that a family head is useful.
`labels.json` holds one hand-separable `risk.destructive` dataset: label 1
vectors sit near `[0.9, 0.1, …]`, label 0 near `[0.1, 0.9, …]`. Fit, tuning
and evaluation splits use separate task and repository groups, so grouped
partition tests exercise disjoint groups. Every vector is fabricated only
here under `test/`.

The family targets are independent of outcomes:

- `risk.destructive`: can the command delete or overwrite data, or change
  shared state, irreversibly? Approval and passing checks do not alter a label.
- `skill.fit`: does the skill apply to the request? These are synthetic
  examples of the M75 routing-label contract, not existing M75 measurements.

The numerical tests fit this fixture with small injected limits and expand
its fit rows to exercise the 40-label enabling refusal. They retain
`evidence: synthetic`, so no fitted head can certify a family. Hundreds of
independent labels per family and a paired held-out report (L98P2-EMBED,
lead-owned) are the separate prerequisite before a head enables.
