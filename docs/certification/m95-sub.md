# C-M95-SUB — Model API on the Muse Code subscription

2026-10-10, rig `linuxlt`, worktree `/home/randy/lanes/CMSUBKEY`,
branch `c/m95-subkey` from `82d50d5e4`. Owner order 2026-10-10 (binding);
PLAN D216 records the scope and the D74/M95b tension for the lead.
No real CLI auth file was read on this rig; every fixture is a temp-dir or
in-memory fake. No paid or live model call. No new dependency.

## Current behavior after the RVCMSUBKEY3 repair

The explicit subscription opt-in resolves one frozen in-memory `BillingRoute`
per Meta-direct attempt from the captured `providers.meta.access_token` shape.
The CLI file remains bounded to 64 KiB. Missing, unsigned, unreadable and
Keychain-only sign-ins refuse with subscription guidance even if a pasted key
exists. A fresh compare after admission can stop a changed kind/account; it
cannot replace the attempt's credential. The synchronous guard checks the
actual sent key digest. Provider transports retain their own origin-bound auth.

Plan chat records tokens and plan pricing, reserves/settles zero dollars in
host/runtime accounting, and carries no reply dollar price. Sending state ends
with the request and never controls journal availability. Verified plan-only
history stores an explicit zero so a subsequent capped provider turn does not
become unknown legacy spend. Subscription ownership hashes a fixed label plus
the resolved sign-in path, normalized for Windows separators; the captured
metadata has no account/user id. Bearer rotation preserves saved-session
visibility. Sign-out releases subscription-bound fences for unrelated models.

Disabled extras stay quiet. Enabled hosted search, subagents, Auto review, Best-of-N, hook models and Judge
require the pasted key, normal price/daily-budget/use consent and paid usage
accounting. A granted search response also bills its model tokens to that key;
the consent question discloses their rates. Denied search leaves chat on the
plan. Images and voice keep their established pasted-key lanes. Every observed
key remains redacted for the process lifetime, including later snapshot saves.

The earlier commit/drill sections below are historical evidence; superseded
boolean snapshots, bearer rebinds and unconditional search refusal are removed.

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

- Fakes establish local routing and accounting, not Meta's live billing of a
  subscription credential. This lane makes no real sign-in or model call.
- The fallback identity is device/path-local: moving the sign-in file changes
  its identity. The captured shape has no account/user id; account changes
  reusing the same path cannot be distinguished without new captured metadata.
- macOS Keychain-backed sign-ins refuse; file-backed sign-ins are supported.
- Headless subscription runs still require `--max-budget-usd` for separately
  billed images. Hosted search, voice and subagents remain unavailable there.
- Full quality, visual regression and editor integration belong to the lead,
  under this lane's shared rules. No browser was launched for round 3. The
  earlier visual gate attempt was blocked by sandbox socket permissions; no
  workaround was built. Round 3 changes existing localized messages/consent
  text without CSS or layout changes.

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

Committed as `2bc6b58d4`, with the installed hooks and post-hook diff review.

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

### Part 2 — per-attempt billing and paid extras

The new core `billingRoute.ts` module keeps credential/pricing state out of
`subscriptionKey.ts`, which the nine-byte-slack headless preflight imports.
Routes are frozen. Only Meta-direct models obtain one; provider auth ignores
both a Meta route and an explicit Meta auth override. The synchronous guard
compares the sent key's digest with the frozen credential, independently of
the stable conversation identity. `confirmBillingRoute` runs immediately after
awaited preparation and only compares kind/account: it can refuse, never swap
in a fresh key. Ordinary, compaction, reviewer and subagent guards carry it.

Paid extras resolve a pay-as-you-go route under existing price/budget/use
consent, including search's model-token rate disclosure. The subscription
turn's dollar exemption is never a client-wide setting. `sendingRoute` is
cleared on completion; journal availability ignores sending state. A verified
plan-only snapshot stores zero explicitly, avoiding unknown legacy liability
on the next capped provider turn. This extra history marker was required by
the joined sign-out regression; it is not billing state and never exempts a
future attempt. Persistent identities remain 64-character SHA-256 digests,
matching the existing stored-session schema without changing that boundary.

Baseline checks run the named regressions against `bcceeb684` production
`ModelApiHost.ts`, `transport.ts` and `runtimeAccountingEntry.ts`. Fixture-only
adapters supply the baseline's old boolean dependency and bearer-derived
account id; the new route dependency was not part of that API. The credential
source stays an in-memory fake. Baseline readiness/settings checks replace
only those two production modules with the base versions. Every temporary
production and fixture replacement restores exact original bytes and checks
SHA-256 in a `finally` block. The restart behavior itself was correct at the
base; its new pure-predicate tests expose the missing test seam (the baseline
has no exported predicate).

| Finding               | Fix                                                                                                                            | Named regression                                                                                                                                      | Red drill                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1, readiness          | Refused subscription returns its actual signed-out guidance, with no pasted-key fallback.                                      | ACP live-sign-in case plus missing/unreadable cases, with/without a pasted key.                                                                       | `r3-f1`, force ready.                                                                                                 |
| 2, paid extras        | Disabled search stays quiet; enabled search, reviewer and subagent use the pasted key with consent and paid usage.             | Disabled search; consented search's actual auth bytes/dollar price; reviewer/subagent auth and paid route; missing child key; token-price disclosure. | `r3-f2-off`, unconditional warning; `r3-f2-paid`, ordinary route for paid work; `r3-f2-disclosure`, hide token rates. |
| 3, runtime lifecycle  | Per-attempt guard decides plan exemption; other providers remain dollar-billed.                                                | `prices each attempt after client creation and keeps provider responses dollar-billed`.                                                               | `r3-f3-plan`/`r3-f3-provider`, force exemption false/true.                                                            |
| 4, billing race       | Frozen route supplies auth and pricing, sent digest is checked, fresh post-prepare comparison only stops changes.              | Hook opt-out, pacing sign-out, compaction, frozen-key rotation, prepare order, mismatched sent key, provider-owned auth.                              | `r3-f4-confirm`, `snapshot`, `digest`, `provider`, `frozen`.                                                          |
| 5, rotated secrets    | Retain every observed literal in the shared redactor and snapshot scrub list.                                                  | Two-save A-to-B rotation keeps A redacted on save 2.                                                                                                  | `r3-f5`, clear/release retained literals.                                                                             |
| 6, next capped turn   | Clear sending state, preserve journal access, record known zero history.                                                       | `keeps the next capped provider turn usable after a subscription turn`; signed-out capped provider.                                                   | `r3-f6`, retain old route and hide journal; `r3-f6-zero-history`, omit known zero.                                    |
| 7, ownership/sign-out | Fixed-label/resolved-path identity preserves rotated history; drop subscription-bound host/budget fences for unrelated models. | Rotation sends accepted auth bytes and keeps saved sessions visible after reopening; living-host sign-out at zero and positive caps.                  | `r3-f7-rotation`, bearer identity; `r3-f7-fences`, keep subscription fences.                                          |
| 8, restart coverage   | Pure restart predicate includes both backend and subscription settings.                                                        | Both affected-setting cases and unrelated-setting control.                                                                                            | `r3-f8`, remove subscription setting.                                                                                 |

The fake wire accepts only `Bearer LLM|1|secret`. Rotation and paid-route tests
assert accepted Authorization bytes; refused requests do not count as proof
of correct auth. The external paid-scope regression also verifies a pasted-key digest independently
of its stable subscription owner. The provider fixture has a distinct non-secret account id
while retaining that same wire key, so coincident fake key digests cannot mask
the living-host account fence.

### Round 3 route drills — SHA-256 restoration records

The following digests are pre-drill and verified post-restore values. Later
formatting is a deliberate edit after restoration, not a failed restore.

- r3-f2-off: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `e6850001c4adfd37d00728fb5f70d5d6fc43b8c449f5a8e169bc14be2597b1b6`, restored byte-exact. Tests: test/unit/subscriptionBilling.test.ts.
- r3-f2-paid: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `e6850001c4adfd37d00728fb5f70d5d6fc43b8c449f5a8e169bc14be2597b1b6`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts, test/unit/subscriptionBilling.test.ts.
- r3-f3-plan: `src/runtime/runtimeAccountingEntry.ts`; exit 1; SHA-256 `5ac2ca8dc3da4a52cee8efbf0059fc8e173f31e17b0894b348c0e66ebb416948`, restored byte-exact. Tests: test/unit/runtimeAccounting.test.ts.
- r3-f3-provider: `src/runtime/runtimeAccountingEntry.ts`; exit 1; SHA-256 `5ac2ca8dc3da4a52cee8efbf0059fc8e173f31e17b0894b348c0e66ebb416948`, restored byte-exact. Tests: test/unit/runtimeAccounting.test.ts.
- r3-f4-confirm: `src/core/backends/modelapi/transport.ts`; exit 1; SHA-256 `bd1dbb99726be0f80edde5e5b26590648c3ca538c8ff0683ee66100becc8473d`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.
- r3-f4-snapshot: `src/core/backends/modelapi/transport.ts`; exit 1; SHA-256 `bd1dbb99726be0f80edde5e5b26590648c3ca538c8ff0683ee66100becc8473d`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts, test/unit/subscriptionBilling.test.ts.
- r3-f4-digest: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `e6850001c4adfd37d00728fb5f70d5d6fc43b8c449f5a8e169bc14be2597b1b6`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.
- r3-f4-provider: `src/core/backends/modelapi/transport.ts`; exit 1; SHA-256 `bd1dbb99726be0f80edde5e5b26590648c3ca538c8ff0683ee66100becc8473d`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.
- r3-f6: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `e6850001c4adfd37d00728fb5f70d5d6fc43b8c449f5a8e169bc14be2597b1b6`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.
- r3-f7-rotation: `src/host/auth/subscriptionCredential.ts`; exit 1; SHA-256 `9047c270c2ee38739f07be04a257b1607d0e625694e5ab6f427f5237677ff216`, restored byte-exact. Tests: test/unit/subscriptionBilling.test.ts.
- r3-f7-fences: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `e6850001c4adfd37d00728fb5f70d5d6fc43b8c449f5a8e169bc14be2597b1b6`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.
- r3-f4-frozen: `src/core/backends/modelapi/billingRoute.ts`; exit 1; SHA-256 `4669f3d28488290d72b03566284dfbed74e012ebd79cc122b31ca19cec3e4359`, restored byte-exact. Tests: test/unit/subscriptionCredential.test.ts.
- r3-f6-zero-history: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `e6850001c4adfd37d00728fb5f70d5d6fc43b8c449f5a8e169bc14be2597b1b6`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.
- r3-f2-disclosure: `src/core/paid/paidConsent.ts`; exit 1; SHA-256 `4db6004393da5f5bf27edd95f05c118010c18c37ceb758682ff48333c17a081b`, restored byte-exact. Tests: test/unit/paidConsent.test.ts.

- r3-headless-route: inject forbidden billing-route input into `dist/meta-acp/headless.json`; exit 1; SHA-256 `84fb13b2e10b3850f030d6bddf07a7c2df7de80ebc07b8c5c2ed449ed29dacda`, restored byte-exact. Gate: `node scripts/check-bundle-split.mjs`.

### Round 3 baseline and gate follow-up

Final baseline route run: 18 failed / 16 passed in the three scoped files.
The uncapped and capped living-host sign-out cases now both fail, after
separating the configured-provider account id from the accepted fake Meta
key's digest. The baseline readiness/settings run is 6 failed / 67 passed:
three subscription refusal cases plus three missing-predicate cases. The
original two-save secret regression was also red on the base (part 1).
All replacements restored exact bytes with SHA-256 verification.

The small route module is explicitly activation-allowed for the host/runtime
credential binding, with its reason recorded in the split inventory. A new
headless exclusion gate was proven red by inserting its forbidden source into
the generated headless metafile; the gate names the file, then the metafile
restores to its original hash and the split check passes. No cap changes.

The first static run found formatter/lint conflicts in nested conditionals;
explicit branches preserve the same lazy auth reads without those conflicts.
Knip found the now-unused `subscriptionFileText` helper; it is removed.
Jscpd found repeated spy/refusal fixtures; one local guard observer and table
cases retain all assertions. The host API record changes only the Node
crypto/path import counts for the new module. Reference and roadmap records
are regenerated. The setting description now explicitly names separately
billed paid extras, with translations in all 14 manifest tables as well as
the new messages in all 14 UI tables. No gate threshold, ignore, level or test
timeout is changed.

- r3-f7-external: `src/core/backends/modelapi/ModelApiHost.ts`; exit 1; SHA-256 `f6804f5d9288f7c5be627ff6d5a278b9a501c7b72f1dbf00099656fbde48c842`, restored byte-exact. Tests: test/unit/subscriptionRoutes.test.ts.

The public external-paid budget scope had one remaining comparison between a
credential digest and the stable conversation owner. It now resolves a paid
route when no internal caller supplied one; the owner stays stable and the
credential check uses that route. The joined regression and `r3-f7-external`
drill prove this without dispatching a paid request. A formatter/baseline
probe overlap was caught; after both completed, all five restoration hashes
matched, and subsequent mutation steps were serialized.

### Final round 3 verification (macmini)

Repository timeouts throughout; at most three files per run, three workers.
1,169 tests in 15 owned/scoped files pass: host 669, joined routes 13, billing
10, credential 12, runtime accounting 11, paid consent 38, redaction 3,
client 77, manager 24, ACP runtime 47, golden requests 140, prefix 28,
exec fetch 36, key source 35, settings 26. The last host/routes/billing run
passes 692/692 after the final note preserves generic reviewer failures and
shows only the recognized localized missing-key explanation.

`npm run typecheck` passes all five projects; the final private note change
also passes the host project. Changed-file ESLint and prettier pass; knip has
no unused exports, jscpd has zero clones, l10n has zero problems, host API,
reference, plan and roadmap checks all pass. `npm run build` passes the token,
size, split, host-global and third-party notice gates. No threshold, ignore,
rule level, timeout or hook is weakened. The final hook uses `.husky/_`, runs
lint-staged sequentially and gitleaks, then the staged and committed diffs are
re-read. Full quality, integration/editor runs and visual coverage remain the
lead's responsibility under this lane's shared rules; no browser or live/paid
model call is made here.

| Bundle                      |   Bytes | Hard cap |
| --------------------------- | ------: | -------: |
| `dist/extension.js`         | 568,560 |  600 KiB |
| `dist/modelApi.js`          | 531,886 |  525 KiB |
| `dist/headless.js`          | 102,391 |  100 KiB |
| `dist/runtimeAccounting.js` |  31,745 |   50 KiB |

The headless bundle is unchanged at 102,391 bytes (9 bytes of headroom); its
new route-exclusion gate is red/green proven above. No dependency is added,
no real credential is read, and no branch is pushed, rebased or merged.

## CMSUBKEYR4 — all nine RVCMSUBKEY3 findings (2026-10-11, macmini)

Owner decision recorded in PLAN M95: **one billing route, resolved once and
carried everywhere**. ConversationOwner and PayerCredential are distinct zod
brands; the saved conversation and its budget retain the owner while a paid
attempt binds the actual credential digest. The shared resolver classifies
ordinary, compaction, catalogue, token-count and every PaidFeature, including
an admission's paidFeature flag. Both transport entries require its opaque
AttemptBillingRoute result. The inventory names all ten production call sites,
finds their RequestTransport receivers and rejects a hand-built route.

The hook wrapper preserves the frozen route and its compare-only confirmation.
Judge resolves its payer separately from the conversation owner and carries the
route to its side stream; its existing admitted daily reservation remains the
only one. Best-of-N compares payer to payer, with and without a parent journal.
The parent scope and saved sessions retain stable ownership. Voice's sibling
external-scope comparison also uses the payer, and every scope consumer parses
its digest at the boundary before calling the branded payer contract.

Search quotes and authority keys include payer kind and the exact disclosed
model-token rates. Both Always and window Once share that binding; legacy
unbound grants cannot authorize the newly disclosed obligation. Provider auth
remains origin-bound. Subscription/provider host transitions are symmetric,
retain owned history, and preserve budget ownership across sign-out. Runtime
readiness checks schema-valid provider credentials before returning subscription
sign-in guidance, matching the editor's provider-first readiness behavior.
Windows path identity resolves and case-folds any drive and UNC path. The retry
refusal describes this attempt in English and all fourteen translations,
without a claim about earlier dispatched requests.

| Finding | Fix                                                                               | Regression                                                                                                           |
| ------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1       | Consent/authority key binds payer kind and token-rate disclosure                  | paidConsent: asks again when payer kind or model-token billing disclosure changes, in both directions                |
| 2       | Prompt/agent admission preserves frozen route and confirmation                    | hookModelHandlers: carries the frozen paid route through a prompt / agent hook                                       |
| 3       | Judge resolves the paid payer, carries auth and uses one existing reservation     | judgeSharedBudget: production Judge subscription receipt, actual plan and paid Authorization bytes                   |
| 4       | Branded owner/payer split; Best-of-N and voice compare payer to payer             | bestOfNRunner: admits a parent scope whose stable owner differs from its paying credential; manager scoped candidate |
| 5       | Shared resolver honors every admission paidFeature; transport requires its result | manager: paid candidates with parent scope false / true; billingRouteInventory                                       |
| 6       | Symmetric host binding, stable per-session ownership and retained history         | subscriptionRoutes: subscription to provider and back without restarting; list/resume/start                          |
| 7       | Runtime provider credentials precede subscription refusal                         | acpRuntime: providers ready after subscription sign-out; malformed-record control                                    |
| 8       | Resolved/case-folded Windows sign-in identity, any drive and UNC                  | subscriptionCredential: resolves and case-folds Windows sign-in identities on any drive                              |
| 9       | Localized refusal names only the refused attempt                                  | subscriptionRoutes: refused retry after an earlier response was dispatched                                           |

No real credential file, OS credential store, live or paid model call, new
dependency, merge, push, cap increase or hook modification. All work runs here
in the foreground. Full quality and installed/native-editor certification are
assigned to the lead by the rig/common brief. The lane runs owning suites at
repository timeouts, three workers and at most three files per invocation.

### RVCMSUBKEY3 red-drill receipts

Every invocation ran the complete named file at repository timeouts, with
`--maxWorkers=3`; exit 1 was required. Every source restored to the recorded
pre-mutation SHA-256 in `finally`. No mutation remains.

| Finding   | Guard deliberately broken                                                 | Failed / passed          | Restored source SHA-256                                            |
| --------- | ------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ |
| F1        | Remove payer/disclosure from authority key                                | 1 failed; 38 passed (39) | `6b552e033d70b1454d905177e91c7467f6e134a01f70ea79c8cc7c11582354d2` |
| F2        | Drop route and compare-only confirmation from hook wrapper                | 2 failed; 14 passed (16) | `a3e398e6f95abdf830daf6bbd4cf0bf9c350ffe7b557fd1d617a532ba1afae64` |
| F3        | Resolve ordinary plan route for Judge payer                               | 1 failed; 5 passed (6)   | `aa2b11c418e84a34e8bbeeded1ae765bd2e55b1eaeda21976d757abb032ff82d` |
| F4        | Compare external scope owner to Best-of-N payer                           | 1 failed; 46 passed (47) | `1ec2834b73c81671fb3f9cddec9e8823f9f5d96d0810c76c3d197a9e3264c3fb` |
| F5        | Ignore paid feature classification in the shared resolver                 | 2 failed; 24 passed (26) | `bfee0de1516beff3f2dd2178c99f066f403b4cf021b53d43862ecb1d40f2e0c4` |
| F6        | Allow only the plan-to-provider transition                                | 1 failed; 14 passed (15) | `aa2b11c418e84a34e8bbeeded1ae765bd2e55b1eaeda21976d757abb032ff82d` |
| F7        | Return signedOut before checking provider credentials                     | 1 failed; 47 passed (48) | `c01320632e2867c7b013136cfa5858a546bed4260f6d87e1acd45dd3bf821d32` |
| F8        | Preserve Windows path case                                                | 1 failed; 12 passed (13) | `bfee0de1516beff3f2dd2178c99f066f403b4cf021b53d43862ecb1d40f2e0c4` |
| F9        | Restore the false Nothing-was-sent promise                                | 1 failed; 14 passed (15) | `829ed4e0ef259fc72eb4c77b0c36525ee18411f824bfceff218fd8af57a01d59` |
| inventory | Construct an image-entry route with Object.freeze instead of the resolver | 1 failed; 1 passed (2)   | `90256fcb360acba9527e61d4b6c1523afa7e0d8f0df2609ebb555569cac45af5` |

Two sibling guards were also broken and restored after the adapter sweep:

| Guard                           | Named regression                                                           | Red result                | Restored source SHA-256                                            |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| Admitted image snapshot         | carries an admitted image payer without rereading either credential source | 1 failed ; 77 passed (78) | `851dab1bb4885d4f74117b8aa5051e7924e1f8826a97b8c2bd2858fa59c3cab5` |
| Retry payer fence before pacing | refuses a legacy payer change before a retry can join pacing               | 1 failed ; 15 passed (16) | `50a3d84d94d02329b3c36051e2b1c41cddcfd42f24b2d3d52e95bcee718d2703` |

The image guard carries the paid snapshot and compare-only confirmation;
the client does not reread its credential sources for an admitted image.
Legacy clients still verify credential continuity after pacing and before
retry pacing. Their resolved payer cannot be silently replaced on retry.
The child retry regression now asserts this earlier refusal and a single
admission, rather than expecting admission under a different bearer.

The first broad client run exposed the lost legacy pacing check and a
scheduled retry repeatedly waiting with a fixed fake clock. Its worker was
stopped; a temporary bounded pacing probe identified the retry, and pacing.ts
was restored byte-for-byte. The production fix refuses a changed resolved
payer before the retry can join pacing. No timeout or gate was changed.

### Bundle-boundary repair

The first production build failed the unchanged headless cap at 103,481 /
102,400 bytes: providersCommands' free probe brought billingRoute.ts into
preflight. The probe, its existing captured-list parsers and attribution
headers now live in providerProbe.ts, exported by the existing lazy
configuredProviders entry. The terminal wrapper installs its language before
calling the probe. The transport inventory now names providerProbe.ts in the
same ten-call inventory. No new bundle or budget was added.

A second build caught a direct preset-table import in that existing lazy
bundle; it now reads presets through providersEntry, preserving the original
split. The complete production build, all size/split checks, host-global
checks and notices then passed. Headless has neither billingRoute.ts nor
providerProbe.ts as an input.

| Final bundle                |   Bytes | Unchanged cap |
| --------------------------- | ------: | ------------: |
| dist/extension.js           | 561,121 |       614,400 |
| dist/modelApi.js            | 528,678 |       537,600 |
| dist/modelApiBoundaries.js  |  42,038 |        51,200 |
| dist/headless.js            |  99,762 |       102,400 |
| dist/configuredProviders.js |  32,048 |        51,200 |

The expanded Windows drive/UNC drill failed both named path cases (2 failed,
12 passed), restored billingRoute.ts SHA-256 `0821d0b2096907e3d6d2ee636a228ec04dbb22086a634a7cc23726349a03a2b9`,
and the restored routes/billing/credential group passed 40/40.

Final verification used the repository defaults, at most three complete files
per run and three workers, directly on macmini. The Model API host/client/golden
group passed 887/887; conversation/voice/provider transport passed 736/736;
configured providers/free probe/provider commands passed 75/75; and
redaction/accounting/key parsing passed 49/49. The ACP/fetch/loopback group
had one 5-second deadline in its existing first ACP packing/recall case,
with 89 other passes; the entire ACP file then passed unchanged (48/48) at
the same repository timeout. No timeout, assertion or gate was weakened.

All five typecheck projects passed. Changed-file ESLint, Prettier, knip,
localization (1517 source files, fourteen UI tables, zero problems), reference,
plan and roadmap checks passed. The zero-duplication gate caught one shared
budget predicate and repeated test request setup; factoring those preserves
the same fences and leaves zero clones. Full quality/coverage, native editors
and live billing remain the lead's assigned validation, per common.md.
No paid/live request, real credential read, dependency, cap change, merge,
push, rebase or hook change occurred.

The deferred-bundle suite additionally exposed its stricter 530,883-byte
Model API diet pin (the build cap is 537,600). Quote authority now ships
once through the existing Node boundary bundle. Every production constructor
installs the caller's text and locale before use. The shared-source split
inventory includes paidAuthority.ts, so copies cannot silently return.
This preserves both limits and all existing consent authority semantics.
Final remeasurement: dist/modelApi.js = 528,678 bytes.
Final remeasurement: dist/modelApiBoundaries.js = 42,038 bytes.
Final remeasurement: dist/extension.js = 561,121 bytes.

Final strict diet/boundary/consent rerun: deferredBundles, billingRouteInventory
and paidConsent passed 158/158. The complete production build passed again
with both size caps and the stricter diet pin unchanged.

The installed pre-commit hook rejected constructor member order; fields now
precede the quote-authority constructor. The localization gate also rejected
ACP's field-time table read; its constructor now installs the table explicitly.
Hooks and localization checks remain unchanged.

Post-hook verification of implementation commit `9eec89ab0`: the staged diff
is empty and the committed source diff was reread. The hook made no unexpected
logic changes. paidAuthority, acpPaid and paidDailyBudget then passed 81/81,
with the repository timeout and three workers. Host API coverage passed again
(375 APIs, 48 VS Code source files, zero problems). The post-hook host
typecheck also exited 0. Process inspection found no lane-owned test server
or worker left running.

The shared quote-authority copy guard was also deliberately fired: injecting
paidAuthority.ts into the modelApi output's generated metadata made the split
gate exit 1 with “dist/modelApi.js loads dist/modelApiBoundaries.js and still
carries its own copy of src/core/paid/paidAuthority.ts”. The metadata restored
byte-for-byte to SHA-256
`f82f69704873279a68f8bb55a8c6b7a14d57d3350b621bd579c3bd5356f133cf`;
the split gate passed before and after. No generated mutation remains.

The lane exceeded its 90-minute time box while fixing the stricter existing
bundle diet, retaining the installed hooks, and completing restored verification.
All nine findings are fixed; no implementation finding is deferred.
