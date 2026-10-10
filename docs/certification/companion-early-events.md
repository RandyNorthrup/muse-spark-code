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
