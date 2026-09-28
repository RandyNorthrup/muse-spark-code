# Paired efficiency evaluation (M75)

Model: muse-spark-1.3-contributor · generated 2026-09-28T20:23:13.823Z · verdict: incomplete

## Arm: baseline

| Task              | Split  | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost    | Tool calls | Cards |
| ----------------- | ------ | ---- | --------- | -------- | -------- | ----- | ------ | ------ | ------- | ---------- | ----- |
| accept-off-by-one | accept | yes  | completed | 3        | 3        | 7616  | 4706   | 275    | $0.0004 | 2          | 0     |
| accept-await-read | accept | yes  | completed | 3        | 3        | 7548  | 2417   | 249    | $0.0006 | 2          | 0     |

accept: 2/2 passed (100%), 6 attempts in 6 requests, 15164 input (7123 cached) + 524 output tokens, $0.0009.
heldout: not run.

## Capability floors

| Arm      | Split   | Tasks | Pass rate | Floor | Held    |
| -------- | ------- | ----- | --------- | ----- | ------- |
| baseline | accept  | 2     | 100%      | 75%   | yes     |
| baseline | heldout | 0     | 0%        | 75%   | not run |
