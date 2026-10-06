# M107INT round 3 — T2, U and H integration

Windows 11 rig, `C:/lanes/M107INT`, branch `m107/int`, starting
`267b04dc2`. The round-3 rig brief explicitly authorizes only the three
listed no-fast-forward merges and scoped checks; no full quality, push,
rebase, stash, disk-space implementation, paid/live model call, credential
read or dependency installation. Existing hooks remain enabled and unchanged.
Model attempts: **0**.

## T2 join

Merge `m107/t2` (`c0f188f28`). Additive CHANGELOG and PLAN conflicts retain
both records. The Windows helper retains C1's holder and A's controls next
to T2's same-handle member signals. Linux retains POSIX path semantics and
C1's direct-child identity proof, now refusing exited roots, with T2's fresh
ancestry/enrollment proof. The registry adopts T2's detailed tree-stop API;
C1's lease maps only its admitted `done` result to forced dispatch. The old
registry whole-job boolean stop is removed. Its existing epoch regression
now exercises retirement during action enumeration.

Complete T2 suites, direct Windows commands with at most three files and
`--maxWorkers=3 --testTimeout=120000`:

- `treesWindows`, `treesActions`, `jobSource`: **26 passed**; native Windows
  registered stop and forged-birth refusal pass.
- `treesLifecycle`, `treesPosix`, `treesLifecycleNative`: **53 passed,
  4 existing native-platform skips**.
- `trees`, `treesMacNative`, `resourcesContracts`: **28 passed,
  3 existing Darwin-platform skips**.

Typecheck initially caught a widened test-only signal result and readonly
deferred-array mismatch in the adapted regression. Explicit return typing
and the fixture's actual mutable snapshot type correct both without a cast
or gate change. Final joined checks, shutdown audit, U/H receipts and sizes
are recorded below as completed.

## U join

Clean merge `682a9784` joins `m107/u` (`c0d142350`). All five TypeScript
projects pass. The complete `resourceStatus`, `resourceStatusPortable` and
`ResourceSurface` files pass **24/24**. The App and harness regression batch
and final browser acceptance are recorded with the final scoped checks.
The merge retains U's injected lazy App port and named W/M104/M96c/J
delivery bindings; no startup import, guessed MHP shape or cap increase.

## H join

Merge `m107/h` (`3885f037b`), retaining all three additive PLAN conflicts
in M107, gates and residual risks. Add H's supplied Unreleased repair note.
All five TypeScript projects pass. Complete `runtimeResources`,
`acpResources`, `execResources`: **34 passed**; `acpAgent`, `execRun`,
`acpRuntime`: **185 passed**; `execArgs`, `execOutput`, `execSchema`:
**101 passed**. H's prototype-store and repeated-pause review regressions
pass unchanged. The frozen v1 result and existing schemas remain intact.

U's App, AppLazy and harness-entry batch also passes **155/155**. Its
existing jsdom canvas diagnostics are unchanged; the real browser result
is recorded separately below.
