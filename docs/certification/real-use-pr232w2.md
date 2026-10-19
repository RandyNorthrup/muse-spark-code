# PR #232 round W2 — review-thread resolutions (lane PR232W2)

Branch `ci/real-use-w2`, continuing PR #232 (`ci/real-use`) at `6fffcd7730`.
First result: one line per thread and per CI failure (fixes land as separate
commits below; this record grows with each).

## Threads

1. `real-use.yml:157` NODE_OPTIONS trap preloaded into the launcher — FIX: clear `BASH_ENV`/`ENV`/`NODE_OPTIONS` on the RU step (action.yml discipline); plant + check stay.
2. `lib/real-use.mjs:353` anchored key pattern misses embedded keys — FIX: scan with the unanchored shapes from `src/shared/redact.ts` (la-check.mjs precedent).
3. `real-use.test.mjs:192` invented transcript fixture — FIX: checkout-measured provenance (real HEAD + real file digests), no placeholders; a fully recorded transcript needs the first green hosted run (no paid calls in test), noted below.
4. `real-use-run.mjs:1` undocumented scripts — FIX: README paragraph beside action-live.yml + CHANGELOG `[Unreleased]` entry, both commands run locally first.
5. `real-use.yml:230` rejected output still uploaded — FIX: transcript upload gated on the check step succeeding.
6. `rc-2026-10-17.json:14` write-file step proves nothing — FIX: new optional `expectFiles` in the steps schema, checked against the product result's `filesChanged`; step declares `hello.txt`.
7. `rc-2026-10-17.json:21` below-minimum allows billed requests — FIX: new optional `expectNoRequests` in the steps schema, enforced in the shared verdict (zero requests and zero cost); step declares it.
8. `lib/real-use.mjs:26` repo-owned 600 s deadline stops jobs — FIX: use the product CLI's own timeout ceiling (`MAX_TIMEOUT_SECONDS`, 21600) for `--timeout` and the launcher reap timer.
9. `real-use-run.mjs:237` key to up to 8 exec children, scanner never used — measured answer: key already confined to the D65-named `exec --key-stdin` reader (env deleted first, memory-only, stdin-only, `finally`-cleared, pre-key validation of every field after thread 11); no staged patch exists here so the scanner reader does not apply; owner decision needed to extend D65 to N bounded exec children (PLAN §3 question).
10. `real-use-run.mjs:266` crash on null accounting — FIX: null-safe reads in launcher and check (`requests ?? 0`, `costUsd?.total ?? '0'` / skip null in sums).
11. `lib/real-use.mjs:172` any string accepted as `expectStatus` — FIX: validate against the exec status set exported from `action/lib/result.mjs`; malformed recipes fail before key intake.

## Hosted CI failures

- The brief lists no separate CI failures after the threads; the failing gate is the real-use workflow itself (thread 1: the trap self-fires, so `check RU` can never go green). Local gates (format, eslint zero warnings on changed files, typecheck, check:plan, check:l10n, build, changed suites) are run per fix commit and recorded with exit codes in the fixes below.

## Fixes (appended per commit)

- `a229eb8e36` first result (this record, one line per thread).
- `08118cd5b9` threads 1–2, 5–8, 10–11: workflow clears `BASH_ENV`/`ENV`/`NODE_OPTIONS` on the RU step (action.yml discipline); `checkNoLeak` scans the unanchored shapes from `src/shared/redact.ts`; transcript upload gated on `steps.check.outcome == 'success'`; steps schema gains validated `expectFiles`/`expectNoRequests` enforced in `verdictForStep`; step timeout is the product's own `EXEC_TIMEOUT_MAX_SECONDS` (21600); null accounting handled in launcher and check; `expectStatus` validated by `isExecStatus` (new `action/lib/result.mjs` export, declared in `actionModules.d.ts`); steps file declares `expectFiles: ["hello.txt"]` and `expectNoRequests: true`; tests use checkout-measured provenance (real HEAD + real steps-file digest). Gate-fire proofs (broken on purpose, watched fail, reverted): leak test fails on the anchored pattern; no-requests verdict test fails with the check neutered. `test/unit/real-use.test.mjs`: 33/33 pass.
- Thread 3 remainder (measured reason): no recorded transcript exists in the repository and none can be made in-lane (paid calls forbidden); provenance fields are measured, never placeholders. The first green hosted dispatch records a real transcript fixture.
- Thread 9 (measured reason + PLAN §3 `Q-REALUSE-KEY`): key already confined to the D65-named `exec --key-stdin` reader (env deleted first, memory-only, stdin-only, `finally`-cleared; every steps-file field validated before intake); no staged patch exists so the scanner reader does not apply. Owner decision needed before first dispatch.
- Docs + follow-up fixes: README paragraph beside action-live.yml (all three scripts ran locally for their usage paths); CHANGELOG `[Unreleased]` release-infrastructure entry; `checkRealUseRun` no longer fails a null ledger (`below-minimum` refusal probes carry none) — proven by the new whole-run PASS test, which fails on the old line with `below-minimum ledger reports a breach`.

## Gates (final tree)

- prettier `--check` on all changed files: pass.
- eslint on changed files: 0 errors, 0 warnings.
- `npm run typecheck` (all 5 projects): exit 0.
- `node scripts/check-plan.mjs`: `plan-format-v1; 218 milestones; 0 drift`.
- `node scripts/check-l10n.mjs`: `0 problems`.
- `npm run build` (production + size/split budgets): exit 0.
- `test/unit/real-use.test.mjs` with the repo default timeout: 34/34 pass.
