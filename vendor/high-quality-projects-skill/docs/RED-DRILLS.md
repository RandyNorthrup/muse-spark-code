# Red drills: prove checks detect defects

Every project must maintain repeatable red drills for its tests and quality
gates. A red drill temporarily introduces a known defect and proves that the
existing check rejects it for the intended reason. A normal negative test
(invalid input correctly rejected) is useful, but does not prove the test would
detect broken production behavior. Coverage alone does not prove this either.

## When to run

- Before first relying on each configured gate, including the test runner.
- When adding or changing behavior or its tests: drill the affected assertions,
  prioritizing critical journeys, boundaries, error handling, and regressions.
- After changing test discovery, fixtures, mocks, include/exclude paths, gate
  configuration, tool versions, or local/CI command wiring.
- At milestone and release verification: run the project's maintained drill
  set. Wire a small deterministic set into CI; document the command, scope, and
  cadence for broader or expensive drills in the existing plan.

Scale the number of mutations to risk; do not require exhaustive mutation
testing of every line. An empty scaffold must record behavior-test drills as
pending until runnable behavior exists. Zero discovered tests, all tests
skipped, or an unavailable runner cannot count as verified tests.

## Green -> red -> restored green

1. **Map the claim.** Name the requirement or gate, the existing test/check and
   its command, the defect to inject, and the expected assertion or diagnostic.
   Search and enhance the canonical suite and fixtures; do not build a parallel
   test suite that only demonstrates a second implementation.
2. **Establish green.** Run that command against the actual source under review
   with the normal configuration. Confirm the intended tests/files are
   discovered and executed. Record source revision plus any relevant uncommitted
   changes, tool/runtime, and baseline result. Pre-existing failures must be
   reported; isolate a passing affected check before attributing a new failure.
3. **Inject one defect.** In an isolated temporary copy/worktree or disposable
   fixture, change the behavior the test protects, leaving the test and its
   expected result intact. For a gate, add a representative violation inside
   its normal scan scope. Check the mutation applied exactly once. Rebuild or
   clear only drill-owned stale outputs so the check exercises the mutation.
4. **Require the intended red.** Run the same command. Require a non-zero exit
   and the named assertion or diagnostic. A syntax error, missing dependency,
   startup crash, timeout, unrelated failure, or zero selected tests does not
   prove a behavioral assertion. A deliberate syntax violation only proves a
   syntax gate. Capture enough output to distinguish these outcomes.
5. **Restore in all outcomes.** Use `finally`/a cleanup trap to restore exactly
   the drill-owned edits and remove only drill-created files. Preserve prior
   user changes and environments; never use blanket reset/clean commands.
   Verify restoration against the pre-drill bytes or diff, including on error.
6. **Prove green again.** Rerun the same command after restoration, then the
   affected aggregate quality command. Verify CI propagates a child gate's
   failure: no swallowed exit codes, success-on-empty options, or allowed-failure
   settings on required checks. A drill harness itself exits non-zero for a
   surviving mutation, wrong failure, or failed restoration; it succeeds only
   when all declared drills produce the expected evidence.

Never inject defects into production, shared data, live credentials, or an
externally published branch. Use disposable local resources and synthetic
canaries. Do not publish the mutated source or artifacts. Interrupted drills
are incomplete until cleanup and restored-green verification finish.

## Choose meaningful mutations

| Protected behavior | Defect to inject | Evidence required |
|---|---|---|
| Boundary validation | Change `<` to `<=`, or bypass the guard | Existing boundary test fails on the wrong accepted/rejected value |
| Persistence | Omit the write | Independent read through the supported interface fails its assertion |
| Error propagation | Swallow the error or return success | Existing failure-path test rejects the success result |
| UI keyboard handling | Remove `preventDefault` | Existing event assertion fails with a fixture that exercises the handler |
| File inventory | Stop excluding a generated directory | Existing count/pruning assertion fails on a fixture containing that directory |
| Lint/type/security gate | Add a representative violation | Named diagnostic and failing command exit, then a clean rerun |

Tests must observe the real contract and have fixtures where the failure can
occur. Avoid assertions that merely search production source for a string,
duplicate its algorithm to compute the expected answer, or inspect only a mock
that bypasses the behavior being claimed. Use positive, negative, and boundary
cases where applicable, await asynchronous work, and make side effects possible
before asserting they were prevented.

If a mutation survives, treat it as a test/gate gap: fix discovery, the fixture,
assertion, implementation boundary, or command wiring, then repeat the cycle.
Do not lower coverage, skip tests, loosen expectations, or suppress findings to
manufacture green. An equivalent mutation needs a reason and a replacement
that changes observable behavior; it is not a successful drill.

## Record evidence in the existing plan or verification report

For each drill, record: requirement/gate; source and test paths; mutation;
command and environment; baseline exit; expected and observed red diagnostic
and exit; restoration proof and final green; status; evidence/log location.
Keep the repeatable recipe in the existing test tooling, without retaining
broken product code. Link this evidence from milestone and release checklists.

Use **pass**, **fail**, or **deferred**. A deferred drill needs a concrete reason,
owner, and next action; it remains an open verification gate. Scope conclusions
to the behaviors and environments actually exercised. A killed mutation proves
that case, not the correctness of the whole test suite or product.
