# No stand-ins, second pass (lane no-standins-2, 2026-10-17)

Branch `chore/no-standins-2`, started at PR #223 (`chore/no-standins`,
c3355c0c20). The stand-ins #223 left, one line per item: removed (its claim
withdrawn), rewritten to drive the real code, or already gone on #223.

## Items

- `test/unit/eval/evalTasks.test.ts` ('starts the verifier with none of the run’s environment') — rewritten to real code: `vi.stubEnv`/`vi.unstubAllEnvs` replaced by setting the two variables on the real `process.env` and restoring each prior value in `finally`; the real verifier subprocess still proves it inherits none of them. No claim withdrawn.
- `test/unit/helpers/vault/windowsVaultMemoryHello.cs`, `windowsVaultMemoryKsp.cs`, `windowsVaultMemoryDpapi.cs` and their only user `windowsVaultGuardCapture.cs` — removed: test-only WinRT Hello, KSP and DPAPI stand-ins that no test, script or workflow has compiled since the test overhaul deleted their driver (f2b00c0947); their two PLAN.md §8 rows went with them. Claim withdrawn: the native Windows vault guard capture (Hello signing projection, KSP named-key lifecycle, DPAPI current-user scope); proof is the packed product's real vault run on Windows.
- `test/unit/helpers/windowsScreenRecorderChecks.cs` (`fakeType`, `PendingOperation<T>`, `PendingTranscode`, `BufferPort`, `MemoryStreamPort`) — the six random-access sink cap cases rewritten to real code (the production `BoundedRandomAccessStream` over a real WinRT `InMemoryRandomAccessStream` and `Windows.Storage.Streams.Buffer`); the hand-written `IAsyncOperation`/`IAsyncActionWithProgress` stand-ins removed with their four cases in `windowsScreenRecorderNative.test.ts` (cancelRace, pending ×4 stages, latePending, pendingEncode). Claims withdrawn: Stop/Cancel cancels and closes a pending WinRT picker, file, open or prepare operation; Cancel stays atomic against a concurrent Stop; an operation registered after Cancel is cancelled; a normal Stop finalizes encoding that a later Cancel cancels. Proof is the packed product's real recording run on Windows.

## Red drills

- evalTasks: `src/core/eval/workspace.ts` verifier spawn changed from `env: {}` to `env: { ...process.env }`; `npx vitest run test/unit/eval/evalTasks.test.ts -t "none of the run"` failed (exit 1, `expected { passed: false, … } to deeply equal { passed: true, detail: '' }`); reverted, passes.
- Screen recorder sink: `Admit(Position, buffer.Length)` removed from `BoundedRandomAccessStream.WriteAsync` in `native/windows/MuseSparkScreenRecord.cs`; `npx vitest run test/unit/windowsScreenRecorderNative.test.ts -t streamWrite` failed (exit 1, `expected 'error:InvalidOperationException' to be 'error:RecordingLimitException'`: the write reached the real stream); reverted, all 32 cases pass on this Windows 11 rig.
