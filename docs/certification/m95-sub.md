# C-M95-SUB — Model API on the Muse Code subscription

2026-10-10, rig `linuxlt`, worktree `/home/randy/lanes/CMSUBKEY`,
branch `c/m95-subkey` from `82d50d5e4`. Owner order 2026-10-10 (binding);
PLAN D103 records the scope and the D74/M95b tension for the lead.
No real CLI auth file was read on this rig; every fixture is a temp-dir or
in-memory fake. No paid or live model call. No new dependency.

## What it is

One opt-in per host (`museSpark.useMuseCodeSubscription` in VS Code,
`--subscription` for `serve`/`exec`) drives the Model API backend from the
subscription key the Muse Code CLI holds after sign-in (`providers.meta`
`api_key` first, else `access_token`), read fresh from the CLI's auth file
per OS (XDG honoured, Windows included) on every call: nothing is cached or
retained between reads, and a 64 KiB size guard refuses oversized files
before they are read. The key is held in memory only. Opted in but missing/unreadable/unsigned (or a
macOS Keychain pointer, never read): the turn refuses with the fix; a
pasted key is never billed silently. Subscription Meta turns record pricing
`plan` (shared Plan label, no dollar charge), skip the dollar
session-budget reservation and durable preflight like plan models, and in
headless runs admit at zero dollars while still counting requests.

## Commits

- `3f272fefb` core source, refusals, redact + 28 tests.
- `8f1906348` plan pricing and budget exemption + 3 host-turn tests.
- `7264b970b` VS Code setting, store gate, manager wiring + 7 tests.
- `78cb5a50a` serve/exec flag, runtime backend, exec ledger + arg tests.

## Red drills (break the guard, see the named test fail, restore byte-exact)

Pre-drill SHA-256: `subscriptionKey.ts`
`8470fd1e3080c445e4c8db3888e6584cfb1ce0159b68ca47c55c1dda77c09c38`,
`ModelApiHost.ts`
`fefe0b693f7e55d3572d7768f3fe3f71bbd8c5939d062e9f678e75046e67e69e`.
Backups under the lane `$TMPDIR`, removed afterwards. After the drills,
`subscriptionKey.ts` was hardened to a discriminated `SubscriptionKeyRead`
union (then-current SHA
`e79854fe49118cbbb681d10e1f0b26c1f667bd4d93f418e32162f4812b912aaa`;
`ModelApiHost.ts` unchanged since its drill restore).

- A (consent): `if (!(await deps.isSubscriptionEnabled()))` → `if (false)`.
  `test/unit/subscriptionKey.test.ts` failed exactly the 2 opt-in-off cases
  (`uses the pasted key while the opt-in is off`, `reports none while off
with no pasted key`); 26 passed. Restored to the SHA above.
- B (billing): plan-pricing ternary → `undefined`. The 2 plan tests in
  `test/unit/subscriptionBilling.test.ts` failed
  (`records plan pricing …`, `sends under a tiny dollar cap …`); 1 passed.
  Restored to the SHA above.
- C (validation): key hygiene `/[\r\n]/u` → `/[\r]/u`. The `a\nb` case of
  `reads unsigned for an unusable key` failed; 27 passed. Restored.

Post-drill evolution (later deliberate edits, not drills): the module was
slimmed for the headless budget (fresh read on every call, no `zod`,
no `node:crypto`, no value cache, no `redact`/`digestFor`; per-OS path
split into `src/core/backends/musecode/credentialPath.ts`) plus two
`unicorn/no-await-expression-member` fixes and one narrowing fix in
`runExec.ts`. Current SHA-256: `subscriptionKey.ts`
`163d76bd1c59f50d8f6ee7600924d9784c865ed1d474057875cbc045471f2d36`,
`credentialPath.ts`
`fee58404b9592c37f43e06b1aee2442951096b3cd86c60e6ba2d1b15545e423b`.

## Verification scope

Repository timeouts throughout (no `--testTimeout` anywhere); at most 3
files per vitest run. A mid-lane `execFetch` failure (L10–L12, `subscription
is not defined`) was a real regression from editing the wrong `getApiKey`
(the `modelApiManager` factory instead of its call site): fixed by threading
the wrapper as a factory parameter, all 36 pass. `usageIntegration`'s panel
case (`/usage.js` 401, got 502) fails identically on the pristine base
`82d50d5e4` in a throwaway worktree (removed afterwards): pre-existing rig
failure (local panel server under sandbox), not this lane. No `git stash`
is used on this lane.

## Known limits (for the lead)

- No live capture of a subscription key exists here; `api_key`-first is
  reasoned from `muse auth set`, `access_token` is best-effort. Verify
  against a live sign-in before changing the precedence.
- Surfaces show the shared Plan label, not the literal "Muse Code plan"
  (D103 §4: a distinct certainty would ripple through journal schemas,
  aggregates, surfaces and 14 usage tables for one label).
- macOS Keychain-backed sign-ins refuse with the fix; file-backed sign-ins
  work on all three OSes.
- A file rotation landing between a turn's billing snapshot and its auth
  read (milliseconds) can mislabel one record; there is no shared cache,
  each side reads the file fresh.
- Paid extras (search, images, voice) still bill a stored key on every host.
- Headless subscription runs still require `--max-budget-usd` (bounds paid
  image spend); the receipt reports `$0` billed for plan-covered chat.
- `dist/headless.js` budget amended 100 → 120 KiB (D6 amendment, PLAN §7):
  deliberate +2.2 KiB (100.6 vs 98.4 base, same toolchain), 0.6 over the
  old cap after slimming removed `zod`, caching and `redact`/`digest`. The
  size gate fired as designed (OVER at 101.5 pre-slim, 100.6 post-slim).
- `npm run check:visual` is blocked on this rig: headless Chrome dies at
  launch (`socketpair: Operation not permitted`, sandbox). The lane's only
  visual surface is the settings row and usage labels; the lead runs the
  gate outside the sandbox. No shim or workaround was built.
