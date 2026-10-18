# No stand-ins, second pass (lane no-standins-2, 2026-10-17)

Branch `chore/no-standins-2`, started at PR #223 (`chore/no-standins`,
c3355c0c20). The stand-ins #223 left, one line per item: removed (its claim
withdrawn), rewritten to drive the real code, or already gone on #223.

## Items

- `test/unit/eval/evalTasks.test.ts` ('starts the verifier with none of the run’s environment') — rewritten to real code: `vi.stubEnv`/`vi.unstubAllEnvs` replaced by setting the two variables on the real `process.env` and restoring each prior value in `finally`; the real verifier subprocess still proves it inherits none of them. No claim withdrawn.
- `test/unit/helpers/vault/windowsVaultMemoryHello.cs`, `windowsVaultMemoryKsp.cs`, `windowsVaultMemoryDpapi.cs` and their only user `windowsVaultGuardCapture.cs` — removed: test-only WinRT Hello, KSP and DPAPI stand-ins that no test, script or workflow has compiled since the test overhaul deleted their driver (f2b00c0947); their two PLAN.md §8 rows went with them. Claim withdrawn: the native Windows vault guard capture (Hello signing projection, KSP named-key lifecycle, DPAPI current-user scope); proof is the packed product's real vault run on Windows.

## Red drills

- evalTasks: `src/core/eval/workspace.ts` verifier spawn changed from `env: {}` to `env: { ...process.env }`; `npx vitest run test/unit/eval/evalTasks.test.ts -t "none of the run"` failed (exit 1, `expected { passed: false, … } to deeply equal { passed: true, detail: '' }`); reverted, passes.
