# Paired efficiency evaluation (M75)

Model: muse-spark-1.3-contributor · generated 2026-10-12T14:43:02.075Z · verdict: pass

Run compaction ledger: reserved $0.0262769, settled $0.00071786, outstanding $0, retained unknown $0.

Certified digest: 8699c398e736b1b8d4ff5ee28ca5a953da76c5c60be226e2d3d951f65bb97590 · computed: 8699c398e736b1b8d4ff5ee28ca5a953da76c5c60be226e2d3d951f65bb97590

## Arm: baseline

| Task                     | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost     | Tool calls | Cards | Questions | Paid refused | Order |
| ------------------------ | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | -------- | ---------- | ----- | --------- | ------------ | ----- |
| accept-long-compaction   | accept  | no   | failed    | 1        | 1        | 23717 | 0      | 835    | $0.0026  | 1          | 0     | 0         | 0            | 1     |
| heldout-long-compaction  | heldout | no   | failed    | 1        | 1        | 23727 | 0      | 996    | $0.0026  | 1          | 0     | 0         | 0            | 4     |
| accept-long-middle-value | accept  | yes  | completed | 8        | 8        | 73814 | 52518  | 2744   | $0.0028  | 7          | 0     | 0         | 0            | 3     |
| heldout-long-middle-rule | heldout | yes  | completed | 9        | 9        | 74522 | 50342  | 2141   | $0.0030  | 8          | 1     | 0         | 0            | 2     |
| accept-off-by-one        | accept  | yes  | completed | 4        | 4        | 11490 | 8147   | 317    | $0.00042 | 3          | 0     | 0         | 0            | 1     |
| accept-null-guard        | accept  | yes  | completed | 4        | 4        | 11513 | 8147   | 400    | $0.00044 | 3          | 0     | 0         | 0            | 4     |
| accept-await-read        | accept  | yes  | completed | 4        | 4        | 11459 | 8147   | 319    | $0.00042 | 3          | 0     | 0         | 0            | 3     |
| accept-import-path       | accept  | yes  | completed | 3        | 3        | 8526  | 5474   | 274    | $0.00038 | 2          | 0     | 0         | 0            | 2     |
| accept-no-secret         | accept  | yes  | completed | 4        | 4        | 11430 | 8147   | 315    | $0.00041 | 3          | 0     | 0         | 0            | 1     |
| accept-empty-average     | accept  | yes  | completed | 3        | 3        | 8530  | 5474   | 335    | $0.00039 | 2          | 0     | 0         | 0            | 4     |
| heldout-strict-equal     | heldout | yes  | completed | 4        | 4        | 11402 | 8147   | 277    | $0.00040 | 3          | 0     | 0         | 0            | 3     |
| heldout-clear-timer      | heldout | yes  | completed | 4        | 4        | 11643 | 8403   | 377    | $0.00042 | 3          | 0     | 0         | 0            | 2     |
| heldout-sort-numbers     | heldout | yes  | completed | 3        | 3        | 8511  | 5474   | 327    | $0.00039 | 2          | 0     | 0         | 0            | 1     |
| heldout-await-write      | heldout | yes  | completed | 5        | 5        | 15011 | 11460  | 490    | $0.00048 | 5          | 0     | 0         | 0            | 4     |
| accept-multi-edit        | accept  | yes  | completed | 4        | 4        | 11493 | 8147   | 344    | $0.00042 | 3          | 0     | 0         | 0            | 3     |
| heldout-multi-edit       | heldout | yes  | completed | 4        | 4        | 11519 | 5602   | 341    | $0.00068 | 3          | 0     | 0         | 0            | 2     |

accept-long-compaction compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-compaction compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-long-middle-value compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-middle-rule compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-off-by-one compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-null-guard compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-await-read compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-import-path compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-no-secret compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-empty-average compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-strict-equal compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-clear-timer compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-sort-numbers compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-await-write compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

Arm compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept: 8/9 passed (89%), 35 attempts in 35 requests, 171972 input (104201 cached) + 5883 output tokens, $0.0082.
heldout: 6/7 passed (86%), 30 attempts in 30 requests, 156335 input (89428 cached) + 4949 output tokens, $0.0079.

accept-long-compaction failed:

```text
the turn ended failed: Context window full: /compact or /handoff
the verifier failed: node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<task>\workspace\answer.js' imported from <task>\verify-m1aaRe\verify.mjs
  code: 'ERR_MODULE_NOT_FOUND',
  url: '<task>/workspace/answer.js'
}
Node.js v24.20.0
```

heldout-long-compaction failed:

```text
the turn ended failed: Context window full: /compact or /handoff
the verifier failed: node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<task>\workspace\transform.js' imported from <task>\verify-5PGQzR\verify.mjs
  code: 'ERR_MODULE_NOT_FOUND',
  url: '<task>/workspace/transform.js'
}
Node.js v24.20.0
```

## Arm: packing

Mechanism: observation packing (M73): a tool result over 8000 characters rides whole for 2 requests, then as a placeholder with its id, size and first and last lines; recall_output pages the original back

| Task                     | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost     | Tool calls | Cards | Questions | Paid refused | Order |
| ------------------------ | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | -------- | ---------- | ----- | --------- | ------------ | ----- |
| accept-long-compaction   | accept  | no   | failed    | 1        | 1        | 23897 | 0      | 1445   | $0.0027  | 1          | 0     | 0         | 0            | 2     |
| heldout-long-compaction  | heldout | no   | failed    | 1        | 1        | 23909 | 0      | 1525   | $0.0027  | 1          | 0     | 0         | 0            | 1     |
| accept-long-middle-value | accept  | yes  | completed | 9        | 9        | 52447 | 37271  | 1924   | $0.0020  | 8          | 1     | 0         | 0            | 4     |
| heldout-long-middle-rule | heldout | yes  | completed | 9        | 9        | 53169 | 37271  | 2094   | $0.0021  | 8          | 1     | 0         | 0            | 3     |
| accept-off-by-one        | accept  | yes  | completed | 3        | 3        | 9098  | 2929   | 259    | $0.00068 | 2          | 0     | 0         | 0            | 2     |
| accept-null-guard        | accept  | yes  | completed | 4        | 4        | 12608 | 8915   | 542    | $0.00050 | 3          | 0     | 0         | 0            | 1     |
| accept-await-read        | accept  | yes  | completed | 3        | 3        | 9066  | 5730   | 311    | $0.00041 | 2          | 0     | 0         | 0            | 4     |
| accept-import-path       | accept  | yes  | completed | 4        | 4        | 12127 | 8787   | 280    | $0.00041 | 3          | 0     | 0         | 0            | 3     |
| accept-no-secret         | accept  | yes  | completed | 4        | 4        | 12232 | 8787   | 384    | $0.00044 | 3          | 0     | 0         | 0            | 2     |
| accept-empty-average     | accept  | yes  | completed | 3        | 3        | 9095  | 5730   | 309    | $0.00041 | 2          | 0     | 0         | 0            | 1     |
| heldout-strict-equal     | heldout | yes  | completed | 4        | 4        | 12180 | 8787   | 316    | $0.00043 | 3          | 0     | 0         | 0            | 4     |
| heldout-clear-timer      | heldout | yes  | completed | 4        | 4        | 12310 | 8787   | 366    | $0.00045 | 3          | 0     | 0         | 0            | 3     |
| heldout-sort-numbers     | heldout | yes  | completed | 5        | 5        | 15754 | 11972  | 596    | $0.00053 | 4          | 1     | 0         | 0            | 2     |
| heldout-await-write      | heldout | yes  | completed | 4        | 4        | 12476 | 8915   | 384    | $0.00046 | 3          | 0     | 0         | 0            | 1     |
| accept-multi-edit        | accept  | yes  | completed | 3        | 3        | 9118  | 2929   | 301    | $0.00069 | 2          | 0     | 0         | 0            | 4     |
| heldout-multi-edit       | heldout | yes  | completed | 4        | 4        | 12264 | 5986   | 359    | $0.00072 | 3          | 0     | 0         | 0            | 3     |

accept-long-compaction compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-compaction compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-long-middle-value compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-middle-rule compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-off-by-one compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-null-guard compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-await-read compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-import-path compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-no-secret compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-empty-average compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-strict-equal compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-clear-timer compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-sort-numbers compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-await-write compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

Arm compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

| Task                     | Packing saved (estimated tokens) | Recalls |
| ------------------------ | -------------------------------- | ------- |
| accept-long-compaction   | 0                                | 0       |
| heldout-long-compaction  | 0                                | 0       |
| accept-long-middle-value | 51684                            | 1       |
| heldout-long-middle-rule | 51684                            | 1       |
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
| accept-multi-edit        | 0                                | 0       |
| heldout-multi-edit       | 0                                | 0       |

accept: 8/9 passed (89%), 34 attempts in 34 requests, 149688 input (81078 cached) + 5755 output tokens, $0.0082.
heldout: 6/7 passed (86%), 31 attempts in 31 requests, 142062 input (81718 cached) + 5640 output tokens, $0.0074.

accept-long-compaction failed:

```text
the turn ended failed: Context window full: /compact or /handoff
the verifier failed: node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<task>\workspace\answer.js' imported from <task>\verify-kficEk\verify.mjs
  code: 'ERR_MODULE_NOT_FOUND',
  url: '<task>/workspace/answer.js'
}
Node.js v24.20.0
```

heldout-long-compaction failed:

```text
the turn ended failed: Context window full: /compact or /handoff
the verifier failed: node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<task>\workspace\transform.js' imported from <task>\verify-e4nxqU\verify.mjs
  code: 'ERR_MODULE_NOT_FOUND',
  url: '<task>/workspace/transform.js'
}
Node.js v24.20.0
```

## Arm: auto-compaction

Mechanism: automatic compaction (M74): the eval host compacts at a settled tool boundary as evaluated, with an evaluation admission that reserves every extra attempt against the run budget and settles it there

| Task                     | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost     | Tool calls | Cards | Questions | Paid refused | Order |
| ------------------------ | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | -------- | ---------- | ----- | --------- | ------------ | ----- |
| accept-long-compaction   | accept  | yes  | completed | 10       | 11       | 82683 | 50056  | 3498   | $0.0041  | 10         | 2     | 1         | 0            | 3     |
| heldout-long-compaction  | heldout | yes  | completed | 10       | 11       | 86248 | 57081  | 4502   | $0.0040  | 10         | 2     | 1         | 0            | 2     |
| accept-long-middle-value | accept  | yes  | completed | 9        | 9        | 81864 | 70280  | 2289   | $0.0018  | 8          | 1     | 0         | 0            | 1     |
| heldout-long-middle-rule | heldout | yes  | completed | 8        | 8        | 72546 | 50598  | 2530   | $0.0029  | 7          | 1     | 0         | 0            | 4     |
| accept-off-by-one        | accept  | yes  | completed | 3        | 3        | 8547  | 5474   | 252    | $0.00037 | 2          | 0     | 0         | 0            | 3     |
| accept-null-guard        | accept  | yes  | completed | 3        | 3        | 8591  | 5474   | 359    | $0.00040 | 2          | 0     | 0         | 0            | 2     |
| accept-await-read        | accept  | yes  | completed | 3        | 3        | 8486  | 5474   | 243    | $0.00037 | 2          | 0     | 0         | 0            | 1     |
| accept-import-path       | accept  | yes  | completed | 4        | 4        | 11406 | 8147   | 259    | $0.00040 | 3          | 0     | 0         | 0            | 4     |
| accept-no-secret         | accept  | yes  | completed | 5        | 5        | 14615 | 11076  | 427    | $0.00047 | 4          | 0     | 0         | 0            | 3     |
| accept-empty-average     | accept  | yes  | completed | 3        | 3        | 8521  | 5474   | 281    | $0.00038 | 2          | 0     | 0         | 0            | 2     |
| heldout-strict-equal     | heldout | yes  | completed | 3        | 3        | 8436  | 5474   | 237    | $0.00036 | 2          | 0     | 0         | 0            | 1     |
| heldout-clear-timer      | heldout | yes  | completed | 4        | 4        | 11553 | 8275   | 330    | $0.00042 | 3          | 0     | 0         | 0            | 4     |
| heldout-sort-numbers     | heldout | yes  | completed | 4        | 4        | 11377 | 8147   | 309    | $0.00041 | 3          | 0     | 0         | 0            | 3     |
| heldout-await-write      | heldout | yes  | completed | 7        | 7        | 21661 | 17830  | 635    | $0.00055 | 6          | 0     | 0         | 0            | 2     |
| accept-multi-edit        | accept  | yes  | completed | 3        | 3        | 8548  | 5474   | 273    | $0.00038 | 2          | 0     | 0         | 0            | 1     |
| heldout-multi-edit       | heldout | yes  | completed | 3        | 3        | 8557  | 5474   | 289    | $0.00038 | 2          | 0     | 0         | 0            | 4     |

accept-long-compaction compaction ledger: reserved $0.0131378, settled $0.00032983, outstanding $0, retained unknown $0.

heldout-long-compaction compaction ledger: reserved $0.0131391, settled $0.00038803, outstanding $0, retained unknown $0.

accept-long-middle-value compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-middle-rule compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-off-by-one compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-null-guard compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-await-read compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-import-path compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-no-secret compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-empty-average compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-strict-equal compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-clear-timer compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-sort-numbers compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-await-write compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

Arm compaction ledger: reserved $0.0262769, settled $0.00071786, outstanding $0, retained unknown $0.

accept: 9/9 passed (100%), 43 attempts in 44 requests, 233261 input (166929 cached) + 7881 output tokens, $0.0086.
heldout: 7/7 passed (100%), 39 attempts in 40 requests, 220378 input (152879 cached) + 8832 output tokens, $0.0089.

## Arm: strict-tools

Mechanism: M101 strict-subset schemas for a capable selected model

| Task                     | Split   | Pass | Terminal  | Attempts | Requests | Input | Cached | Output | Cost     | Tool calls | Cards | Questions | Paid refused | Order |
| ------------------------ | ------- | ---- | --------- | -------- | -------- | ----- | ------ | ------ | -------- | ---------- | ----- | --------- | ------------ | ----- |
| accept-long-compaction   | accept  | no   | failed    | 1        | 1        | 23863 | 0      | 578    | $0.0026  | 1          | 0     | 0         | 0            | 4     |
| heldout-long-compaction  | heldout | no   | failed    | 1        | 1        | 23874 | 0      | 771    | $0.0026  | 1          | 0     | 0         | 0            | 3     |
| accept-long-middle-value | accept  | yes  | completed | 9        | 9        | 82541 | 71048  | 2116   | $0.0018  | 8          | 1     | 0         | 0            | 2     |
| heldout-long-middle-rule | heldout | yes  | completed | 8        | 8        | 71348 | 60183  | 2101   | $0.0017  | 7          | 1     | 0         | 0            | 1     |
| accept-off-by-one        | accept  | yes  | completed | 3        | 3        | 9052  | 5730   | 290    | $0.00041 | 2          | 0     | 0         | 0            | 4     |
| accept-null-guard        | accept  | yes  | completed | 3        | 3        | 9010  | 5730   | 329    | $0.00041 | 2          | 0     | 0         | 0            | 3     |
| accept-await-read        | accept  | yes  | completed | 4        | 4        | 12146 | 8787   | 377    | $0.00043 | 3          | 0     | 0         | 0            | 2     |
| accept-import-path       | accept  | yes  | completed | 4        | 4        | 12010 | 8659   | 268    | $0.00041 | 3          | 0     | 0         | 0            | 1     |
| accept-no-secret         | accept  | yes  | completed | 4        | 4        | 12086 | 8787   | 369    | $0.00043 | 3          | 0     | 0         | 0            | 4     |
| accept-empty-average     | accept  | yes  | completed | 3        | 3        | 8965  | 5730   | 309    | $0.00040 | 2          | 0     | 0         | 0            | 3     |
| heldout-strict-equal     | heldout | yes  | completed | 4        | 4        | 12109 | 8787   | 342    | $0.00042 | 3          | 0     | 0         | 0            | 2     |
| heldout-clear-timer      | heldout | yes  | completed | 3        | 3        | 9112  | 2929   | 314    | $0.00069 | 2          | 0     | 0         | 0            | 1     |
| heldout-sort-numbers     | heldout | yes  | completed | 4        | 4        | 12067 | 8787   | 339    | $0.00042 | 3          | 0     | 0         | 0            | 4     |
| heldout-await-write      | heldout | yes  | completed | 4        | 4        | 12423 | 5986   | 415    | $0.00074 | 3          | 0     | 0         | 0            | 3     |
| accept-multi-edit        | accept  | yes  | completed | 3        | 3        | 9003  | 5730   | 300    | $0.00040 | 2          | 0     | 0         | 0            | 2     |
| heldout-multi-edit       | heldout | yes  | completed | 4        | 4        | 12189 | 8787   | 363    | $0.00044 | 3          | 0     | 0         | 0            | 1     |

accept-long-compaction compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-compaction compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-long-middle-value compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-long-middle-rule compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-off-by-one compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-null-guard compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-await-read compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-import-path compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-no-secret compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-empty-average compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-strict-equal compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-clear-timer compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-sort-numbers compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-await-write compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

heldout-multi-edit compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

Arm compaction ledger: reserved $0, settled $0, outstanding $0, retained unknown $0.

accept: 8/9 passed (89%), 34 attempts in 34 requests, 178676 input (120201 cached) + 4936 output tokens, $0.0071.
heldout: 6/7 passed (86%), 28 attempts in 28 requests, 153122 input (95459 cached) + 4645 output tokens, $0.0069.

accept-long-compaction failed:

```text
the turn ended failed: Context window full: /compact or /handoff
the verifier failed: node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<task>\workspace\answer.js' imported from <task>\verify-N3wBmo\verify.mjs
  code: 'ERR_MODULE_NOT_FOUND',
  url: '<task>/workspace/answer.js'
}
Node.js v24.20.0
```

heldout-long-compaction failed:

```text
the turn ended failed: Context window full: /compact or /handoff
the verifier failed: node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<task>\workspace\transform.js' imported from <task>\verify-773zki\verify.mjs
  code: 'ERR_MODULE_NOT_FOUND',
  url: '<task>/workspace/transform.js'
}
Node.js v24.20.0
```

## packing against baseline

| Split   | Pass rate | Attempts | Input tokens | Output tokens | Cost |
| ------- | --------- | -------- | ------------ | ------------- | ---- |
| accept  | 89% → 89% | -3%      | -13%         | -2%           | ±0%  |
| heldout | 86% → 86% | +3%      | -9%          | +14%          | -7%  |

## auto-compaction against baseline

| Split   | Pass rate  | Attempts | Input tokens | Output tokens | Cost |
| ------- | ---------- | -------- | ------------ | ------------- | ---- |
| accept  | 89% → 100% | +23%     | +36%         | +34%          | +5%  |
| heldout | 86% → 100% | +30%     | +41%         | +78%          | +12% |

## strict-tools against baseline

| Split   | Pass rate | Attempts | Input tokens | Output tokens | Cost |
| ------- | --------- | -------- | ------------ | ------------- | ---- |
| accept  | 89% → 89% | -3%      | +4%          | -16%          | -13% |
| heldout | 86% → 86% | -7%      | -2%          | -6%           | -12% |

## Capability floors

| Arm             | Split   | Tasks | Pass rate | Floor | Held |
| --------------- | ------- | ----- | --------- | ----- | ---- |
| baseline        | accept  | 9     | 89%       | 75%   | yes  |
| baseline        | heldout | 7     | 86%       | 75%   | yes  |
| packing         | accept  | 9     | 89%       | 75%   | yes  |
| packing         | heldout | 7     | 86%       | 75%   | yes  |
| auto-compaction | accept  | 9     | 100%      | 75%   | yes  |
| auto-compaction | heldout | 7     | 100%      | 75%   | yes  |
| strict-tools    | accept  | 9     | 89%       | 75%   | yes  |
| strict-tools    | heldout | 7     | 86%       | 75%   | yes  |

## Strict tools engaged (M101)

| Arm          | Tasks                                                                                                                                                                                                                                                                                                                                                 | Never strict | Held |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---- |
| strict-tools | accept-long-compaction, heldout-long-compaction, accept-long-middle-value, heldout-long-middle-rule, accept-off-by-one, accept-null-guard, accept-await-read, accept-import-path, accept-no-secret, accept-empty-average, heldout-strict-equal, heldout-clear-timer, heldout-sort-numbers, heldout-await-write, accept-multi-edit, heldout-multi-edit | none         | yes  |

## Packing engaged (M73)

| Arm     | Long-output tasks                                  | Never packed | Held |
| ------- | -------------------------------------------------- | ------------ | ---- |
| packing | accept-long-middle-value, heldout-long-middle-rule | none         | yes  |

## Compaction engaged (M74)

| Arm             | Long-context tasks                              | Never compacted | Held |
| --------------- | ----------------------------------------------- | --------------- | ---- |
| auto-compaction | accept-long-compaction, heldout-long-compaction | none            | yes  |

| Task                    | Settled compactions | Applied compactions |
| ----------------------- | ------------------- | ------------------- |
| accept-long-compaction  | 1                   | 1                   |
| heldout-long-compaction | 1                   | 1                   |
