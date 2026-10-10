# Companion early events — no event fires before its subscriber exists

Worktree `/Users/randy/lanes/COMPSUB`, branch `fix/companion-early-events`,
base `82d50d5e4` (= origin/main). No network, paid/live calls, push, merge or
rebase. Socket tests are named for the lead: this sandbox forbids listening
sockets (`listen EPERM` on 127.0.0.1), so every regression test here uses a
socket-free fake.

## Scope

`src/host/companion/**` does not exist; the only companion transport is
`src/runtime/companion/**`. Every lifecycle listener in that directory was
inspected:

| Site                                                              | Verdict                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `server.ts` startup (`listen` await)                              | **Fixed** — see below                                                |
| `server.ts` request handler (`response.once('close')`)            | Already synchronous, before any `await`                              |
| `server.ts` `ending`/`closed` promise                             | Attached at creation, before any `await`                             |
| `events.ts` `open()` (`response.once('close')`, `subscribe`)      | Already synchronous; sync emissions re-checked (`has`/`unsubscribe`) |
| `upload.ts` (`request.once('aborted')`, `response.once('close')`) | Attached synchronously before the first `await`                      |
| `guard.ts`, `sessions.ts`, `page.ts`, `nativeAttachments.ts`      | No lifecycle listeners                                               |

## The bug

In `startCompanionServer` (`src/runtime/companion/server.ts`) three
subscriptions happened only after the `await` on the `listen` callback:

1. `server.once('error', reject)` was removed on success, leaving **zero**
   `error` listeners post-startup — any later server `error` threw uncaught.
2. Nothing listened for server `close` — a close before the listen callback
   left startup hanging forever (the idle timer is only armed post-startup).
3. `process.once('SIGINT'/'SIGTERM')` attached post-startup — a signal in the
   window was missed and the process died without graceful close. (The
   `options.signal` abort already had a post-await `throwIfAborted` re-check.)

## The fix

Same pattern as the vault broker fix: subscribe before awaiting, buffer early
signals. All listeners attach synchronously before `server.listen`:

- One persistent `server.on('error')`: rejects startup while the bind is in
  flight, routes to the graceful `close()` path afterwards.
- One `server.once('close')`: rejects startup with `EPANEL_BIND` while the
  bind is in flight, routes to `close()` on an unexpected later close.
- `process.once('SIGINT'/'SIGTERM')` into a buffering `AbortController`;
  after startup, a set buffer runs `close()` before returning the handle.
- Early signal listeners are removed in a `finally`, on every path.
- New optional `createTransport` parameter (defaults to `node:http`'s
  `createServer`, narrowed to the one listener shape used). The only caller,
  `openUsageCompanion`, is unchanged. The fake lives in `test/**` only.

No user-visible strings changed (`EPANEL_*` are wire codes, not UI text), so
no `l10n/` change was needed. No new abstraction beyond the one-parameter
gate the socket-free tests require.

## Regression tests (`test/unit/companionStartup.test.ts`)

`FakeCompanionServer extends Server`: a real `Server` whose `listen`
captures its callback and never binds, with a scripted `address()`,
`close()` and `closeAllConnections()`. Full type compatibility, no casts.
Four cases, all socket-free:

1. Listen `error` before startup resolves rejects with that error.
2. Transport `close` before startup resolves rejects `EPANEL_BIND`
   (previously hung forever).
3. `process.emit('SIGINT')` before startup resolves ends shut down
   (`closed` resolves, `launchUrl()` throws, listener counts restored).
4. Transport `error` after startup shuts down gracefully (previously threw
   uncaught out of `emit`).

## Drill

With the fix saved (SHA-256 noted below), the startup block was restored to
the late subscription (seam kept so the fake can run): 3 failed, 1 passed —
the early-`close` case by 5 s timeout (the hang), the signal case by staying
open, the post-startup `error` by throwing out of `emit`. The fix was then
restored byte-exact.

- Fixed `src/runtime/companion/server.ts`
  SHA-256 `15d5241904dc7d3c1ae753a5a1fdaeaba914cca3d4d487c4c745e64812da8406`
  (pre-lint renames; renames only: `listening` → `isListening`, early-signal
  flag → buffering `AbortController`, branch-order and fake cleanups).

## Gates run on this rig (macmini)

- `test/unit/companionStartup.test.ts`: 4 passed (9 ms, repo default timeout).
- `test/unit/companionEvents|Guard|Sessions.test.ts`: run alongside (result
  in final message).
- `npm run typecheck`: clean, all projects.
- `npx eslint --max-warnings=0` on both changed files: clean.
- `npx prettier --check` on changed files: clean.
- `npm run build`: bundle sizes in final message.

## Left for the lead (outside this sandbox)

- `test/unit/companionServer.test.ts`, `test/unit/companionLifecycle.test.ts`
  (and any other suite that binds real loopback sockets) could not run here:
  `listen` returns `EPERM` in this sandbox. They are untouched by this change
  except through the startup block they share; please run them outside.

## RVCOMPSUB findings fixed (lane COMPSUB2, same worktree)

Both findings are P3; both are fixed with no residuals. Class sweeps: the
only test that asserts a signal/abort-driven close is in
`companionStartup.test.ts` (sibling lifecycle tests assert idle close
explicitly with short timers and no signals, so no ambiguity there), and the
only caller-abort subscription in `src/runtime/companion/**` was the
post-await one (no other module takes a caller signal). No guard was widened;
no new dependency; no UI/MODEL_TEXT string (`npm run check:l10n` 0 problems).

> Correction (lane COMPSUB3, RVCOMPSUB2 finding 1): the parenthetical above
> was wrong. `test/unit/companionLifecycle.test.ts:56` awaited
> `panel.closed` unbounded with the default 5000 ms idle timer armed after a
> runtime abort — the same ambiguity class, missed by this sweep. Fixed and
> re-swept exactly; see “RVCOMPSUB2 findings fixed (lane COMPSUB3)” below.

### Finding 1 — signal test could pass on the idle timer

`settlesBeforeIdle()` (`test/unit/companionStartup.test.ts`): the early-signal
test and the post-startup-error test (same class — the 5000 ms idle timer
settles the same `closed` promise there too) must now settle `closed` within
1000 ms, 4 s before idle could fire, and assert `closedCalls` is 1. With the
cause removed the tests fail in ~1 s instead of passing at 5 s on Windows CI.
Drill: with `if (earlySignal.signal.aborted) await close()` removed, the
signal test fails (`expected false to be true`); with the post-startup
`onSignal()` routing broken, the error test fails the same way. `server.ts`
restored byte-exact (SHA-256
`1997aab9d94ed3872ad00a3348dce8ee37f2aff9a7262ac9aceb96d2d1295e12` —
64 hex digits; the earlier record here had 66 and is corrected).

### Finding 2 — caller abort during the bind never settled startup

`options.signal` is now subscribed before the `listen` await
(`src/runtime/companion/server.ts`: `onCallerAbort` rejects startup with the
signal's reason via `throwIfAborted`, the same rejection the post-bind
re-check produces; the pre-await subscription is removed in the `finally` on
every path, and the post-startup `abort → onSignal` behaviour is unchanged).
Regression test `rejects at once when the caller aborts while the bind is in
flight`: aborts with the bind held (never released, so only the new path can
settle it), expects rejection `This operation was aborted`, `closedCalls` 1,
and SIGINT/SIGTERM listener counts restored. Drill: with the pre-await
`addEventListener` line removed, the test fails (startup stays pending to the
5 s repo default timeout). `server.ts` restored byte-exact (SHA-256
`1997aab9d94ed3872ad00a3348dce8ee37f2aff9a7262ac9aceb96d2d1295e12`,
the same 64-hex digest the corrected Finding 1 record names); test file
SHA-256 at that commit
`b31aed6661c5e4b0279e41869d3deeb8d031266b3e54fab6d977d40b1af18780`
(superseded in lane COMPSUB3, which moves the shared guard into
`test/unit/helpers/companion.ts` — refreshed digest below).

Gates on macmini, repo default timeout, `--maxWorkers=3`:
`companionStartup.test.ts` 5 passed (~18 ms test time); `npm run typecheck`
(all five projects) clean; `npx eslint --max-warnings=0` on both changed
files clean (the first helper draft tripped `unicorn/consistent-boolean-name`,
`unicorn/prefer-await` and `no-confusing-void-expression`; rewritten, no
disables); `npx prettier --check` clean; `npm run build` exit 0,
`dist/usageCompanion.js` 44.5 KiB of its 50 KiB budget.

## RVCOMPSUB2 findings fixed (lane COMPSUB3, same worktree)

Both findings are P3; both are fixed with no residuals. No guard was
widened; no new dependency; `server.ts` is byte-identical (see digest
below); no UI/MODEL_TEXT string (`npm run check:l10n` 0 problems).

Restored-source SHA-256 of `src/runtime/companion/server.ts`: `1997aab9d94ed3872ad00a3348dce8ee37f2aff9a7262ac9aceb96d2d1295e12`

### Finding 1 — lifecycle abort test could pass on the idle timer

`test/unit/companionLifecycle.test.ts:56` (“closes and revokes launch URLs
on runtime abort”) awaited `panel.closed` unbounded with the default 5000 ms
idle timer armed: removing only the post-startup abort subscription
(`src/runtime/companion/server.ts:308`) still passed via the idle timer at
~5 s (15 s Windows CI default: same pass). The test now awaits the shared
`settlesBeforeIdle(panel.closed)` (`test/unit/helpers/companion.ts`,
moved out of `companionStartup.test.ts` so the two suites share one guard —
`jscpd` threshold is 0, so no second copy): `closed` must settle within
1000 ms, 4 s before idle could fire.

Exact class sweep (every `closed` await in `test/unit`, `grep -rn`):

- `companionLifecycle.test.ts:60` (runtime abort) — **fixed** (this test).
- `companionLifecycle.test.ts:70` (idle exit, `idleTimeoutMs: 150`) —
  asserts the idle path itself with a short timer and no signal; no
  ambiguity, unchanged.
- `companionServer.test.ts` — no `closed` await; panels close in the
  `trackedPanels` afterEach; unchanged.
- `companionBrowser.test.ts` — no `closed`/abort/signal await; unchanged.
- `companionStartup.test.ts` signal + post-startup-error tests — already
  bounded; now import the shared guard, behaviour unchanged.
- `test/unit/execClient.test.ts:97`, `test/unit/execRun.test.ts:833` —
  different component (`exec` connections, not companion); out of lane.
- Source sweep (`grep` over `src/runtime/companion/`): the only
  caller-abort subscriptions are the `server.ts:291` pre-await /
  `:308` post-startup pair; `upload.ts` only reads `.aborted` and composes
  signals synchronously, settling nothing.

Drill: with only the `server.ts:308` line removed, the socket-free
equivalent of the guarded assertion (`temp/drill-abort-guard.ts`, same
5000 ms idle, same 1000 ms bound) reports
`NOT-SETTLED-WITHIN-1000MS` (exit 1); with shipped code it reports
`SETTLED-BY-ABORT` (exit 0). The named vitest file cannot bind sockets in
this sandbox (`listen EPERM`, as certified above), so the lead re-runs
`test/unit/companionLifecycle.test.ts` outside it. `server.ts` restored
byte-exact — SHA-256 before the drill and after the restore are both the
digest recorded above.

### Finding 2 — certification recorded a 66-digit source hash

The Finding 1 drill record read
`1997aab9…54374a6286` (66 hex digits — a 36-char prefix ending `…ee37f2`
shared with the real digest, then diverged);
replaced in place with the real 64-hex digest recorded above (verified with
Node's SHA-256 over `git show` output for both reviewed commits and over
the worktree file — all three agree). The Finding 2 “same SHA-256 as
above” is now spelled out explicitly with the same digest.

Regression test `test/unit/companionCertification.test.ts`: extracts the
labelled digest above (exactly one match required) and compares it with the
SHA-256 of `git show HEAD:src/runtime/companion/server.ts` hashed as raw
bytes, so a future source change without a re-recorded digest fails loudly
instead of silently certifying stale bytes. Drill: with one hex digit of
the labelled digest flipped, the test fails (the certification no longer
contains HEAD's digest); with the digest restored byte-exact (doc SHA-256
identical before the flip and after the restore) it passes.

Refreshed file digests (COMPSUB3 edits; `server.ts` unchanged):

- `test/unit/companionStartup.test.ts`
  `b966aa8ede4120df7eb67a38ca9841462ed994ec026e5280e54d903c5d2d2d67`
- `test/unit/companionLifecycle.test.ts`
  `107ae10b59c729f017230d32ef6dc8bb822eb805b42b732c689372344d373ea8`
- `test/unit/helpers/companion.ts`
  `9e34708167a747502c66e2ecfe7ca82390fd624e41beecbdc3770346e360cf9c`
- `test/unit/companionCertification.test.ts`
  `98f2f3cc76263cfe1b23aa60ac6c5e7bec043b6f258c5ff69cb58a060c30a5ef`

Gates on macmini, repo default timeout, `--maxWorkers=3`: results in the
lane's final message.
