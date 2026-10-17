# Paired efficiency evaluation (M75)

Model: muse-spark-1.3-contributor · generated 2026-09-28T21:08:27.725Z · verdict: pass

## Arm: baseline

| Task                 | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost    | Tool calls | Cards |
| -------------------- | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | ------- | ---------- | ----- |
| accept-off-by-one    | accept  | yes  | completed | 3        | 3        | 7610  | 4706   | 262    | $0.0004 | 2          | 0     |
| accept-null-guard    | accept  | yes  | completed | 3        | 3        | 7641  | 4706   | 350    | $0.0004 | 2          | 0     |
| accept-await-read    | accept  | yes  | completed | 4        | 4        | 10163 | 7251   | 309    | $0.0004 | 3          | 0     |
| accept-import-path   | accept  | yes  | completed | 6        | 6        | 15965 | 12725  | 429    | $0.0004 | 5          | 0     |
| accept-no-secret     | accept  | yes  | completed | 3        | 3        | 7509  | 4706   | 230    | $0.0003 | 2          | 0     |
| accept-empty-average | accept  | yes  | completed | 3        | 3        | 7573  | 4706   | 277    | $0.0004 | 2          | 0     |
| heldout-strict-equal | heldout | yes  | completed | 4        | 4        | 10139 | 7251   | 293    | $0.0004 | 3          | 0     |
| heldout-clear-timer  | heldout | yes  | completed | 5        | 5        | 13434 | 7635   | 507    | $0.0007 | 4          | 1     |
| heldout-sort-numbers | heldout | yes  | completed | 3        | 3        | 7529  | 4706   | 297    | $0.0004 | 2          | 0     |
| heldout-await-write  | heldout | yes  | completed | 5        | 5        | 13319 | 10052  | 489    | $0.0004 | 4          | 0     |

accept: 6/6 passed (100%), 22 attempts in 22 requests, 56461 input (38800 cached) + 1857 output tokens, $0.0022.
heldout: 4/4 passed (100%), 17 attempts in 17 requests, 44421 input (29644 cached) + 1586 output tokens, $0.0019.

## Capability floors

| Arm      | Split   | Tasks | Pass rate | Floor | Held |
| -------- | ------- | ----- | --------- | ----- | ---- |
| baseline | accept  | 6     | 100%      | 75%   | yes  |
| baseline | heldout | 4     | 100%      | 75%   | yes  |
