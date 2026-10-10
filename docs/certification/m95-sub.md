# C-M95-SUB — Model API on the Muse Code subscription

2026-10-10, rig `linuxlt`, worktree `/home/randy/lanes/CMSUBKEY`,
branch `c/m95-subkey` from `82d50d5e4`. Owner order 2026-10-10 (binding);
PLAN D106 records the scope and the D74/M95b tension for the lead.
No real CLI auth file was read on this rig; every fixture is a temp-dir or
in-memory fake. No paid or live model call. No new dependency.

## What it is

One opt-in per host (`museSpark.useMuseCodeSubscription` in VS Code,
`--subscription` for `serve`/`exec`) drives the Model API backend from the
subscription key the Muse Code CLI holds after a browser or device-code
sign-in (`providers.meta` `access_token` only), read fresh from the CLI's
auth file per OS (XDG honoured, Windows included) on every call: nothing is
cached or retained between reads, and a 64 KiB size guard refuses oversized
files before they are read. A `muse auth set` pay-as-you-go file reads as
unsigned and refuses; it is never billed as plan. The key is held in memory
only. Opted in but missing/unreadable/unsigned (or a
macOS Keychain pointer, never read): the turn refuses with the fix; a
pasted key is never billed silently. Subscription Meta turns record pricing
`plan` ("Muse Code plan" for Meta plan rows, no dollar charge), settle $0
through host, runtime journal and ledger, skip the dollar
session-budget reservation and durable preflight like plan models, and in
headless runs admit at zero dollars while still counting requests. Paid
images POST on the stored key (refusing without one); hosted search stays
off plan-billed turns. Rotation rebinds the account fences; the opt-in
restarts the backend; refused subscriptions fall back to provider accounts.

## Commits

- `3f272fefb` core source, refusals, redact + 28 tests.
- `8f1906348` plan pricing and budget exemption + 3 host-turn tests.
- `7264b970b` VS Code setting, store gate, manager wiring + 7 tests.
- `78cb5a50a` serve/exec flag, runtime backend, exec ledger + arg tests.
- `96338a9c6` RVCMSUBKEY batch 1: P1s, P2-3..P2-7, P3-9, label split, tests.
- `20f44791e` RVCMSUBKEY batch 2: 100 KiB cap, bounded preflight, regressions.
- RVCMSUBKEY batch 3 (docs, canary hardening, this record): committed last.

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

## RVCMSUBKEY red drills (2026-10-10, all findings, restored byte-exact)

Each row: the guard broken, the named test failing, the restore verified
with `git status`/`git diff` empty for the file. Repository timeouts, at
most 3 files per run.

- P1-1 (`subscriptionKey.ts` back to `api_key`-first): `sends access_token,
never a pay-as-you-go api_key beside it`, `refuses a pay-as-you-go muse
auth set file as unsigned` and the `api_key` unsigned case failed; rest
  passed. Restored.
- P1-1 resolver (`refuses a pay-as-you-go file while on`): covered by the
  same break (resolver reads through the same function).
- P1-2 registry (`track()` dropped in `getApiKey`): `registers the key it
sends, so shared redaction covers it` failed; rest passed. The first
  drill did NOT fail: the canary was `LLM_`-shaped, which the shape
  patterns redact without the registry. The canary was hardened to an
  opaque value (`opaque subscription value 8e2b4a`) and the re-drill
  failed as required. Restored.
- P1-2 snapshot (scrub dropped in `withCredentialRedaction`): both
  `headless credential redaction` tests failed (opaque SUB and PASTED
  persist), proving the canaries evade the patterns and the literals are
  load-bearing. Restored.
- P2-3 (subscription-first block dropped in `modelApiReadiness`): `counts
a live subscription sign-in with no pasted key, before touching the
store` failed. Restored.
- P2-4 image (`authKey` not threaded in `imageRequest`): `sends a paid
image on the stored key while chat bills the subscription` failed.
  Restored.
- P2-4 search (`isSubscriptionPlanTurn` gate dropped in
  `webSearchConsent`): `keeps hosted search off a plan-billed turn`
  failed. Restored.
- P2-5 cost (`planPricedAttempt` dropped in `noteUsage`) and journal
  (dropped in `budgetJournal`): `persists no dollar spend` and `carries no
dollar cost on the reply usage` failed. Restored.
- P2-5 label (provider branch dropped in `display.ts`, provider attach
  dropped in `aggregate.ts`): `names a Meta plan row Muse Code plan` and
  `keeps a Meta plan row apart` failed, plus the pre-existing `separates
every certainty` (updated for the split). Restored.
- P2-5 runtime (`isPlanBilling` forced false): `settles a plan-billed
turn at $0 in the paid daily journal (plan: true)` failed. Restored.
- P2-6 rebind (both rebinds dropped): `rebinds the account fences when
the CLI rotates the key mid-conversation` failed (second turn refused
  at the fence, one dispatch). Restored.
- P2-7 (try/catch dropped in the manager `getAccountId` factory):
  `starts an unrelated provider while the subscription key is refused`
  failed. Restored.
- P3-9 (`isMissing` back to ENOENT-only): `reads ENOTDIR from stat as
missing` failed; EACCES/EPERM still read unreadable. Restored.
- P3-10 (cap set to 99 KiB): `check-bundle-size` fires OVER on
  `dist/headless.js`; restored to 100 KiB (`ok`, 102,391 B).
- P3-11 (`read()` forced unsigned): `reads a real temp config home
through the resolved path` failed (path assertion still passed),
  proving the test exercises `read()`, not only `path()`. Restored.
- P2-8: every path comparison in the lane's tests normalises both sides
  through one helper; not drillable on linuxlt (no backslashes at rest),
  verified by construction for Windows CI.
- P3-12: the output-canary test keeps the canary in the values under
  test and fails when the literal is dropped (see P1-2 snapshot).

## Known limits (for the lead)

- No live capture of a subscription key exists here; the `access_token`
  rule is reasoned from the two captured shapes (`AUTH_SET_FILE` →
  `apiKey`, `DEVICE_LOGIN_FILE` → `accountLogin` in
  `docs/certification/sign-in-detection.md`). A live sign-in with a
  subscription that bills the plan would still be the strongest proof.
- macOS Keychain-backed sign-ins refuse with the fix; file-backed sign-ins
  work on all three OSes.
- A file rotation landing between a turn's billing snapshot and its auth
  read (milliseconds) can mislabel one record; there is no shared cache,
  each side reads the file fresh.
- Paid images need a stored key; hosted search stays off plan-billed
  turns; voice keeps its own stored-key getter.
- Headless subscription runs still require `--max-budget-usd` (bounds paid
  image spend); the receipt reports `$0` billed for plan-covered chat.
- `dist/headless.js` cap restored to 100 KiB (D6 amendment reverted, PLAN
  §7): 100.0 KiB (102,391 B) with 9 B of headroom. The size gate fired as
  designed (OVER at 101.5 pre-slim, 100.6, 100.1, then ok).
- The P2-6 settings-restart half (opt-in toggle restarts the backend) has
  no dedicated test: it reuses the long-standing backend-restart machinery
  and has no unit harness. The rotation rebind is fully covered.
- `npm run check:visual` is blocked on this rig: headless Chrome dies at
  launch (`socketpair: Operation not permitted`, sandbox). The lane's only
  visual surfaces are the settings row, usage labels and the KpiTiles key;
  the lead runs the gate outside the sandbox. No shim or workaround was built.

## CMSUBKEYR3 redesign (2026-10-10, macmini)

Third review round: **REDESIGN**. Base `bcceeb684`, branch `c/m95-subkey-r3`.
One immutable per-attempt billing route binds pricing and authorization;
after admission the fresh route is compare-only and can only stop a send.
The captured DEVICE_LOGIN_FILE has name/email/avatar but no account/user id;
use the lead-approved stable fixed-label + resolved-path digest, normalized
for Windows separators. No real credentials are read, no live or paid calls,
no new dependency. Full quality belongs to the lead under this lane's shared
rules; no merge is authorized by the rig brief.

### Part 1 — readiness, retained redaction, restart predicate

Baseline `bcceeb684` production with the regressions: ACP subscription
readiness returned the pasted-key guidance; the two-save rotation test
persisted key A on save 2 (2 failed / 46 passed). After repair, the three
owned files passed 74/74 at repository timeouts and three workers.
The restart predicate is extracted from the reviewed condition and covers
both the backend and subscription setting plus an unrelated-setting control.

- r3-f1: `src/runtime/backends.ts`; exit 1; SHA-256 `4f176521686520c4a6bfbfc562dad5c09d82a921252a9e2077339b1431787193`, restored byte-exact. Tests: test/unit/acpRuntime.test.ts.
- r3-f5: `src/host/auth/subscriptionCredential.ts`; exit 1; SHA-256 `ec243eafd2ca524d01ab7d7d958ef61885f897c3929c5f5510a4a7815a87da13`, restored byte-exact. Tests: test/unit/subscriptionRedaction.test.ts.
- r3-f8: `src/host/settings.ts`; exit 1; SHA-256 `93f778f65866efe1e5fcdd76132c6f3fa73d6e19b167c3aea2513d9f0a737874`, restored byte-exact. Tests: test/unit/settings.test.ts.

F1: subscription refusal forced ready, readiness test fails. F5: tracked
literals replaced/released, two-save rotation fails. F8: subscription setting
removed, its restart case fails. An initial F5 mutation of just the returned
literal list stayed green because the retained shared registry independently
scrubs snapshots; the second mutation breaks retention and fires the test.
No production file is left mutated. Installed hook path `.husky/_` is used.
