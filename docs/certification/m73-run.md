# Paired efficiency evaluation (M75)

Model: muse-spark-1.3-contributor · generated 2026-10-02T16:29:02.257Z · verdict: pass

## Arm: baseline

| Task                     | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost    | Tool calls | Cards | Questions | Paid refused | Order |
| ------------------------ | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | ------- | ---------- | ----- | --------- | ------------ | ----- |
| accept-off-by-one        | accept  | yes  | completed | 3        | 3        | 8186  | 5218   | 284    | $0.0004 | 2          | 0     | 0         | 0            | 1     |
| accept-null-guard        | accept  | yes  | completed | 4        | 4        | 11457 | 8147   | 563    | $0.0005 | 3          | 0     | 0         | 0            | 2     |
| accept-await-read        | accept  | yes  | completed | 3        | 3        | 8128  | 5218   | 267    | $0.0004 | 2          | 0     | 0         | 0            | 1     |
| accept-import-path       | accept  | yes  | completed | 4        | 4        | 10938 | 7763   | 293    | $0.0004 | 3          | 0     | 0         | 0            | 2     |
| accept-no-secret         | accept  | yes  | completed | 4        | 4        | 10938 | 7763   | 338    | $0.0004 | 3          | 0     | 0         | 0            | 1     |
| accept-empty-average     | accept  | yes  | completed | 3        | 3        | 8134  | 5218   | 284    | $0.0004 | 2          | 0     | 0         | 0            | 2     |
| heldout-strict-equal     | heldout | yes  | completed | 3        | 3        | 8061  | 5218   | 218    | $0.0003 | 2          | 0     | 0         | 0            | 1     |
| heldout-clear-timer      | heldout | yes  | completed | 3        | 3        | 8380  | 5218   | 457    | $0.0004 | 2          | 0     | 0         | 0            | 2     |
| heldout-sort-numbers     | heldout | yes  | completed | 5        | 5        | 14043 | 8019   | 468    | $0.0007 | 4          | 1     | 0         | 0            | 1     |
| heldout-await-write      | heldout | yes  | completed | 4        | 4        | 10994 | 5090   | 371    | $0.0007 | 3          | 0     | 0         | 0            | 2     |
| accept-long-middle-value | accept  | yes  | completed | 9        | 9        | 81842 | 70280  | 2603   | $0.0018 | 8          | 1     | 0         | 0            | 1     |
| heldout-long-middle-rule | heldout | yes  | completed | 8        | 8        | 69497 | 58519  | 1869   | $0.0016 | 7          | 1     | 0         | 0            | 2     |

accept: 7/7 passed (100%), 30 attempts in 30 requests, 139623 input (109607 cached) + 4632 output tokens, $0.0041.
heldout: 5/5 passed (100%), 23 attempts in 23 requests, 110975 input (82064 cached) + 3383 output tokens, $0.0037.

## Arm: packing

Mechanism: observation packing (M73): a tool result over 8000 characters rides whole for 2 requests, then as a placeholder with its id, size and first and last lines; recall_output pages the original back

| Task                     | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost    | Tool calls | Cards | Questions | Paid refused | Order |
| ------------------------ | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | ------- | ---------- | ----- | --------- | ------------ | ----- |
| accept-off-by-one        | accept  | yes  | completed | 3        | 3        | 8545  | 5474   | 266    | $0.0004 | 2          | 0     | 0         | 0            | 2     |
| accept-null-guard        | accept  | yes  | completed | 5        | 5        | 15046 | 11332  | 726    | $0.0005 | 4          | 1     | 0         | 0            | 1     |
| accept-await-read        | accept  | yes  | completed | 3        | 3        | 8523  | 5474   | 286    | $0.0004 | 2          | 0     | 0         | 0            | 2     |
| accept-import-path       | accept  | yes  | completed | 5        | 5        | 14550 | 11076  | 333    | $0.0004 | 4          | 0     | 0         | 0            | 1     |
| accept-no-secret         | accept  | yes  | completed | 4        | 4        | 11417 | 8147   | 320    | $0.0004 | 3          | 0     | 0         | 0            | 2     |
| accept-empty-average     | accept  | yes  | completed | 4        | 4        | 11477 | 8147   | 375    | $0.0004 | 3          | 0     | 0         | 0            | 1     |
| heldout-strict-equal     | heldout | yes  | completed | 4        | 4        | 11458 | 8275   | 326    | $0.0004 | 3          | 0     | 0         | 0            | 2     |
| heldout-clear-timer      | heldout | yes  | completed | 3        | 3        | 8623  | 5474   | 280    | $0.0004 | 2          | 0     | 0         | 0            | 1     |
| heldout-sort-numbers     | heldout | yes  | completed | 3        | 3        | 8465  | 5346   | 288    | $0.0004 | 2          | 0     | 0         | 0            | 2     |
| heldout-await-write      | heldout | yes  | completed | 7        | 7        | 21638 | 17830  | 690    | $0.0006 | 6          | 2     | 0         | 0            | 1     |
| accept-long-middle-value | accept  | yes  | completed | 8        | 8        | 43752 | 29094  | 1547   | $0.0018 | 7          | 0     | 0         | 0            | 2     |
| heldout-long-middle-rule | heldout | yes  | completed | 9        | 9        | 49116 | 37128  | 1681   | $0.0016 | 8          | 1     | 0         | 0            | 1     |

| Task                     | Packing saved (estimated tokens) | Recalls |
| ------------------------ | -------------------------------- | ------- |
| accept-off-by-one        | 0                                | 0       |
| accept-null-guard        | 0                                | 0       |
| accept-await-read        | 0                                | 0       |
| accept-import-path       | 0                                | 0       |
| accept-no-secret         | 0                                | 0       |
| accept-empty-average     | 0                                | 0       |
| heldout-strict-equal     | 0                                | 0       |
| heldout-clear-timer      | 0                                | 0       |
| heldout-sort-numbers     | 0                                | 0       |
| heldout-await-write      | 0                                | 0       |
| accept-long-middle-value | 43070                            | 1       |
| heldout-long-middle-rule | 51684                            | 1       |

accept: 7/7 passed (100%), 32 attempts in 32 requests, 113310 input (78744 cached) + 3853 output tokens, $0.0044.
heldout: 5/5 passed (100%), 26 attempts in 26 requests, 99300 input (74053 cached) + 3265 output tokens, $0.0033.

## packing against baseline

| Split   | Pass rate   | Attempts | Input tokens | Output tokens | Cost |
| ------- | ----------- | -------- | ------------ | ------------- | ---- |
| accept  | 100% → 100% | +7%      | -19%         | -17%          | +6%  |
| heldout | 100% → 100% | +13%     | -11%         | -3%           | -11% |

## Capability floors

| Arm      | Split   | Tasks | Pass rate | Floor | Held |
| -------- | ------- | ----- | --------- | ----- | ---- |
| baseline | accept  | 7     | 100%      | 75%   | yes  |
| baseline | heldout | 5     | 100%      | 75%   | yes  |
| packing  | accept  | 7     | 100%      | 75%   | yes  |
| packing  | heldout | 5     | 100%      | 75%   | yes  |

## Packing engaged (M73)

| Arm     | Long-output tasks                                  | Never packed | Held |
| ------- | -------------------------------------------------- | ------------ | ---- |
| packing | accept-long-middle-value, heldout-long-middle-rule | none         | yes  |
