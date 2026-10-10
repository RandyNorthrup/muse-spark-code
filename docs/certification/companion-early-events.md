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
`1997aab9d94ed3872ad00a3348dce8ee37f2fbf20c837cc2fa76e78354374a6286`).

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
5 s repo default timeout). `server.ts` restored byte-exact (same SHA-256 as
above); test file SHA-256
`b31aed6661c5e4b0279e41869d3deeb8d031266b3e54fab6d977d40b1af18780`.

Gates on macmini, repo default timeout, `--maxWorkers=3`:
`companionStartup.test.ts` 5 passed (~18 ms test time); `npm run typecheck`
(all five projects) clean; `npx eslint --max-warnings=0` on both changed
files clean (the first helper draft tripped `unicorn/consistent-boolean-name`,
`unicorn/prefer-await` and `no-confusing-void-expression`; rewritten, no
disables); `npx prettier --check` clean; `npm run build` exit 0,
`dist/usageCompanion.js` 44.5 KiB of its 50 KiB budget.
