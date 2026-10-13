# CATCHMONEY record — round 3: a failure is never a different fact (2026-10-12)

Rounds 1 and 2 rewrote 32 catch handlers one by one; the round-2 review
(RVAPP-CATCHMONEY2) found the same shape seven more times: a "could not
read" or "could not save" becomes a DIFFERENT fact (absent; allowed once;
nothing wrong) or reaches only a log line. Round 3 changes the shape so the
wrong outcome cannot be written.

## The shape

1. Every read that guards money, consent or a credential returns a
   three-valued result: the value, known absent, or could-not-read with a
   closed kind. The collapsing booleans `hasProviderCredential()` and
   `hasModelApiCredential()` are deleted; the guards fail closed on
   could-not-read and tell the person once per kind.
2. The switches are exhaustive by the compiler (`assertExhaustive`: a fourth
   state or a forgotten arm does not compile). The guard test
   (`test/unit/credentialReadGuard.test.ts`) parses the money, consent and
   credential modules and fails on any `catch` returning `false`,
   `undefined`, `[]` or `{}` unless the absence is proven under a named
   condition on the failure or documented with a `read-state: cert TBL-nn`
   marker whose row is in the table below.
3. A safety action runs whatever was thrown: decided by what was SENT, never
   by the type of what was thrown.
4. A notice goes to the session that asked: bound when the question is asked
   and carried with the pending write, never looked up when the failure
   happens.

## Three-state table (12 rows)

Every read, its callers, what each does on could-not-read, and the sentence
the person is told. All sentences are UI text in 14 languages; kind words
are closed translated phrases, never errnos or internal names.

TBL-01 — `readModelApiCredential()` (`src/host/auth/credentialStore.ts`):
found / absent / unreadable with kind crypto, locked, no-service, denied,
timeout, other (mapped from the throw's code or name only). The one adapter
file is `src/host/auth/credentialRead.ts`, so the KEYSTORE lane merges by
replacing it. Callers fail closed through one exhaustive switch
(`storedKeyMayExist`, plus a kind-level switch in `reasonTextForKind`):

| Caller                           | On could-not-read                                                           | Person told             |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------- |
| `choose` (backend selection)     | counts as present: never offers sign-in as if no key existed                | notice once per kind    |
| `confirmCliSignIn`               | counts as present: a sign-in never lifts the logout hold                    | notice once per kind    |
| sign-out terminal clear          | counts as present: the hold is never released while a credential may remain | hold kept + notice      |
| `refreshLogoutHold`              | counts as present: hold never released                                      | notice once per kind    |
| `releaseLogoutHold`              | counts as present: hold goes back on                                        | notice once per kind    |
| `signIn` recovery                | counts as present: "can recover" is never true                              | notice once per kind    |
| `ensureSelectedHost` (extension) | counts as present: host choice never proceeds as if no key existed          | warning once per window |

Sentence: `credentialStoreUnreadable` ("Saved credentials could not be
read: {reason}. The safe state is kept: nothing was signed out or released.
Check keychain access and try again.") with `credentialStoreReason*` kind
words. Tests: `test/unit/credentialStore.test.ts` (three states, scan finds
a working provider past an unreadable entry and still records it,
non-Errors keep their kind),
`test/unit/providerCredentialStore.test.ts`,
`test/unit/authService.test.ts` ("with an unreadable credential store":
hold kept, no lift, never signed-out-as-if-none, told once per kind).

TBL-02 — `getApiKey()` operational collapse (`credentialStore.ts`):
undefined for non-guard backend key reads only, warned once with the kind
word; guards must use TBL-01.

TBL-03 — `readAccountState` (`accountHost.ts`): "cannot say" reads as
unsigned-in; the sign-in gate re-asks rather than releasing anything on it.

TBL-04 — `setLogoutHold` write failure (`authService.ts`): `false` is "not
saved", never "not held"; every caller keeps the hold and says
`signOutHoldFailed`.

TBL-05 — `stopBackend` failure: `false` is "still running", never "nothing
to stop"; the sign-out keeps its hold with `signOutStopFailed`.

TBL-06 — `runInTerminal` failure: `false` is "not attempted", never "logged
out"; the sign-out falls back to the next logout path.

TBL-07 — `remember()` write failure (`paidConsent.ts`): `false` is "not
kept, allowed once, person told" (`onNotKept` fired above the return), never
"not allowed".

TBL-08 — `searchApprovalOrder()` failure: `undefined` is "no order, allowed
once, person told", never "no quote".

TBL-09 — grant record read failure (`paidGrants.ts`): warns with its kind
and reads as no record, so the use asks again (fail closed for money).

TBL-10 — quote folder listing failure: `[]` is "cannot list, ask again"
with the kind warned and carried in the next question, never "no quotes".
The warning is once per damage through the shared noter.

TBL-11 — damage marker read (`damageNotice.ts`): a missing or damaged
marker reads as no marker, and no marker announces; the marker only ever
suppresses a DUPLICATE announcement, so its absence can never hide damage.

TBL-12 — usage-history choice read (`history.ts`): `false` is "no consent
without a readable choice", announced once per damage, never "refused".

## Safety actions (run whatever was thrown)

- OAuth refresh quarantine (P2-2, `src/core/mcp/oauth/client.ts`): the
  token POST may already have rotated the refresh token server-side, so
  `vault.invalidate` runs before the type test, decided by
  `dispatch.hasStarted` (what was SENT). The rewritten test
  (`test/unit/vault/mcpOAuth.test.ts`, "quarantines a sent refresh whatever
  the save failure is, then rethrows it") asserts invalidate ran AND the
  boundary still denies instead of leaking the foreign value. The old
  assertion (no quarantine for a non-Error) was wrong because a non-Error
  save failure does not un-send the rotation.
- Secret-material wipes stay in `finally` (client wipe, parsed/item wipe):
  decided by scope exit, never by the failure's type.
- Non-`Error` throws keep their kind everywhere: every rewritten handler
  rethrows them before any type test.

## Notice rules (one place: `DamageNoter`)

Once per distinct damage, again when the damage changes, again when it
recurs after the file was healthy; never on every sample. The marker is
written atomically (temporary file plus rename) and cleared on a healthy
read. One sentence per damaged thing, saying what is damaged, what the
product does, and what to do:

| Damage                            | Sentence key                                        | Shown                                         |
| --------------------------------- | --------------------------------------------------- | --------------------------------------------- |
| history choice unreadable         | `resourceHistoryChoiceUnreadable`                   | editor notice, stderr once, ACP error channel |
| history choice invalid            | `resourceHistoryChoiceInvalid`                      | same                                          |
| credential store unreadable       | `credentialStoreUnreadable` + kind                  | editor notice / panel warning                 |
| quote folder unreadable           | warn kind + `PaidQuoteNotice` in the question       | log once + next paid question                 |
| schedule consent unreadable       | `scheduleConsentUnreadable` + errno kind            | refused reason in the panel                   |
| panel foreign failure             | `actionFailed` ("That did not work…")               | draft errors, never a write conflict          |
| media refusal / stop / permission | host reason / cleared / `recordingPermissionDenied` | media controls                                |
| paid choice not kept              | feature + kind sentence at once                     | asking session (P2-3)                         |

The asking session's id travels with the pending paid write
(`notifySession` through `allows`/`decide`/`allowSearch`/`remember` into
`PaidNotKeptNotice.sessionId`): with two sessions sharing one folder, A's
failing save tells A even when B asked meanwhile
(`test/unit/acpPaid.test.ts`, "tells the asking session…").

Follow-up (not this round): the ACP agent has no session-notification
transport in reach of the resource entry, so a damaged choice there falls
back to the agent's existing resource-error channel with the true sentence;
a dedicated `session/notification` needs the agent's sender threaded
through.

## Review finding closures (P2-1 … P2-7, P3-1 … P3-7)

| Finding                                    | Commit                           | Test                                                                                                |
| ------------------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| P2-1 three-valued credential reads         | P2-1/P3-5 commit                 | `credentialStore`, `providerCredentialStore`, `authService` unreadable-store, `credentialReadGuard` |
| P2-2 quarantine before the type test       | P2-2 commit                      | `mcpOAuth` "quarantines a sent refresh…"                                                            |
| P2-3 notice bound at ask time              | P2-3/guard commit                | `acpPaid` "tells the asking session…"                                                               |
| P2-4 unreadable announced every sample     | P2-4/5/6 commit                  | `resourceHistoryReview` "reports an unreadable history choice once…"                                |
| P2-5 three hosts, three wrong sentences    | P2-4/5/6 commit                  | `resourceHistoryReview` "tells the damaged choice…"                                                 |
| P2-6 once-marker never cleared             | P2-4/5/6 commit                  | `resourceHistoryReview` "reports the same damage again…"                                            |
| P2-7 media refusals and stop               | Part 3 batch commit              | `companionMedia` refusal / stop / permission / generic                                              |
| P3-1 panel queue foreign failure           | Part 3 batch commit              | `modelsPanelEdit` "records a foreign save failure…" (rewritten)                                     |
| P3-2 no internal words                     | adapter + sentence keys          | `reasonTextForKind`, kind-word keys in 14 languages                                                 |
| P3-3 stale quote notice, unbounded warning | Part 3 batch commit (paidGrants) | `paidGrants` stale-notice + warn-once                                                               |
| P3-4 consent errno reaches the sentence    | Part 3 batch commit (schedules)  | `scheduleRuntime` kind-word tests                                                                   |
| P3-5 classifier blesses `String(error)`    | P2-1/P3-5 commit                 | `catchInventory` suite + named site fixed + `credentialStore` log test                              |
| P3-6 test that cannot fail                 | Part 3 batch commit (paidGrants) | `paidGrants` missing-folder test (reaches the branch)                                               |
| P3-7 stale line numbers, rule 18 wording   | records commit                   | table below regenerated from the code; AGENTS.md rule 18 matches the classifier                     |

Rounds 1–2 history: 32 handlers rewritten with per-handler drills (see git
history `fix/catch-money` before this round's merge); the round-2 review
drove this round's redesign instead of a third handler-by-handler pass.

## Red drills (each construction fires)

- A boolean reintroduced: adding `hasModelApiCredential()` back to the
  store fails the guard with `src/host/auth/credentialStore.ts:96:
collapsing boolean hasModelApiCredential reintroduced: use
readModelApiCredential`. Restored byte-exact (sha256 da6b3dac…).
- A non-exhaustive switch: deleting the `absent` arm fails the compiler
  with `src/host/auth/authService.ts(848,33): error TS2345: Argument of
type '{ readonly outcome: "absent"; }' is not assignable to parameter of
type 'never'`. Restored byte-exact (sha256 50ccb162…).
- The quarantine after the type test: the old order fails the rewritten
  `mcpOAuth` test (invalidate never called). Restored byte-exact (sha256
  fccab8cf…).
- The notice looked up late: the old `notifySessions`-only lookup fails the
  two-session test (B told, A never). Restored byte-exact (sha256
  205bee64…).
- P2-4/P2-6/P3-6/P3-1 drills: the new tests fail on the old code (history
  d21cbc87…, paidGrants c74209b8…, modelsPanel d858ffaa…), each restored
  byte-exact.

## Catch baseline (classifier change, P3-5)

`mark` in `scripts/lib/catch-inventory.mjs` now records an identifier
inside a non-redacting call as a leak, with a verified-safe set
(`storeErrorCode`, `describeStoreError` via `redactSecrets`, `errorKind`,
`errorName`, `codeOf`; a bare `describe` stays a leak because the same name
is wrapped in one module and raw in three others). The stricter classifier
reclassifies 94 handlers from REPORTED to GENERIC across acp/core/host/root/
runtime — all raw-error logs the old classifier blessed (e.g.
`${String(error)}`, message-bearing `describe()`). The named ones in this
lane's files are fixed (`credentialStore.ts` warn,
`acp/paid.ts` forget warn, panel/media/consent sentences); the rest are
grandfathered by regenerating the baseline with the documented
`--write-baseline` after this intentional fix, recorded here for follow-up
(the full list was diffed old-vs-new classifier output; counts per area are
in `scripts/catch-baseline.json`). The gate still fails on any new rise.

## Guarded-modules handler table (P3-7, generated from the code)

Regenerated with the repository's own scanner; do not hand-edit. Command:

`node --input-type=module -e "import('./scripts/lib/catch-inventory.mjs').then(m =>
console.log(JSON.stringify(m.scanCatches(process.cwd()))))"` filtered to
the guarded paths (`src/host/auth`, `src/core/paid`, `src/acp/paid.ts`,
`src/runtime/paidGrants.ts`, `src/runtime/damageNotice.ts`,
`src/runtime/schedules`, `src/runtime/resources`), 98 handlers at this
round's head. Every absence return in these modules is either proven under
a named condition or carries a `read-state: cert TBL-nn` marker from the
table above; the guard test enforces both.

| File:line                                     | Class    | Handler                                                                          |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| src/acp/paid.ts:143                           | REPORTED | { this.deps.log.warn( `Paid use of ${request.feature}: the editor could not be a |
| src/acp/paid.ts:286                           | REPORTED | { // The log carries only the failure's kind, never the store message. this.deps |
| src/core/paid/paidAuthority.ts:470            | NARROW   | { if (!(error instanceof Error) // !('code' in error) // error.code !== 'EEXIST' |
| src/core/paid/paidConsent.ts:267              | REPORTED | { await settle(Usd.from(0).toAmount()) throw error }                             |
| src/core/paid/paidConsent.ts:399              | NARROW   | { // A store that cannot be written leaves this use allowed once (an // account  |
| src/core/paid/paidConsent.ts:439              | NARROW   | { // A quote order the store cannot hand out leaves the approved use // allowed  |
| src/core/paid/paidConsent.ts:645              | NARROW   | { // A quote grant the store cannot keep leaves the approved use // allowed once |
| src/core/paid/paidConsent.ts:972              | NARROW   | { // Only malformed text fails here; a parsed but unversioned generation // answ |
| src/core/paid/paidConsent.ts:1034             | CLEANUP  | { // A failed prior owner must not block this mutation; its caller received the  |
| src/core/paid/paidConsent.ts:1161             | REPORTED | { this.askEpochs.delete(request.feature) throw error }                           |
| src/core/paid/paidConsent.ts:1208             | NARROW   | { // Another instance revoked first: re-read and advance past it. // Any other f |
| src/core/paid/paidConsent.ts:1219             | NARROW   | { // A concurrent revoke advanced further meanwhile: its clear owns // the grant |
| src/host/auth/accountHost.ts:83               | NARROW   | { // The host failed or did not answer in time: it said nothing, which is // not |
| src/host/auth/accountHost.ts:115              | NARROW   | { // A host that cannot start answers with the fallback. Anything that is // not |
| src/host/auth/accountHost.ts:127              | REPORTED | { log.warn(`The Muse Code account host did not close cleanly: ${errorName(error) |
| src/host/auth/accountHost.ts:272              | REPORTED | { await handshake.close() throw error }                                          |
| src/host/auth/authService.ts:279              | GENERIC  | { // read-state: cert TBL-04. A hold write that fails returns false, and // ever |
| src/host/auth/authService.ts:324              | GENERIC  | { // read-state: cert TBL-05. "Could not stop" returns false and the // sign-out |
| src/host/auth/authService.ts:373              | GENERIC  | { this.deps.log.warn('The running backend could not stop before switching backen |
| src/host/auth/authService.ts:599              | GENERIC  | { this.deps.log.warn( `In-panel sign-in failed: ${error instanceof Error ? error |
| src/host/auth/authService.ts:645              | REPORTED | { if (this.publishedTicket !== published) { this.deps.log.warn('The backend did  |
| src/host/auth/authService.ts:789              | GENERIC  | { this.deps.log.warn( `Muse Code installer terminal failed: ${error instanceof E |
| src/host/auth/authService.ts:890              | REPORTED | { this.deps.log.warn('Plan account identity could not be read') }                |
| src/host/auth/authService.ts:968              | GENERIC  | { // read-state: cert TBL-06. "Terminal would not open" returns false and // the |
| src/host/auth/authService.ts:1010             | REPORTED | { isKeyClearFailed = true this.deps.log.warn('Stored Model API key could not be  |
| src/host/auth/authService.ts:1024             | REPORTED | { isProviderClearFailed = true this.deps.log.warn( 'Stored model provider creden |
| src/host/auth/cliAccount.ts:58                | GENERIC  | { return MISSING_CODES.has(errorCode(error)) ? undefined : { signature: UNREADAB |
| src/host/auth/cliAccount.ts:69                | GENERIC  | { return { signature, verdict: 'unrecognized' } }                                |
| src/host/auth/credentialStore.ts:60           | NARROW   | { // read-state: cert TBL-02 (see the method note): this collapse is by // desig |
| src/host/auth/credentialStore.ts:103          | NARROW   | { // An unreadable key says nothing about presence. Anything that is not // an e |
| src/host/auth/credentialStore.ts:123          | NARROW   | { // A provider list that cannot be read cannot prove no provider holds // a cre |
| src/host/auth/credentialStore.ts:154          | NARROW   | { // An entry that cannot be read says nothing about presence, so the // scan co |
| src/host/auth/deviceSignIn.ts:227             | REPORTED | { if (isAborted()) { return 'cancelled' } throw error }                          |
| src/host/auth/deviceSignIn.ts:323             | REPORTED | { deps.log.warn('Muse Code did not confirm the sign-in cancel; closing its host' |
| src/runtime/damageNotice.ts:103               | CLEANUP  | { // A missing or damaged marker announces, never hides. return }                |
| src/runtime/damageNotice.ts:112               | CLEANUP  | { // Best effort: an unwritten marker only repeats the announcement. }           |
| src/runtime/damageNotice.ts:119               | CLEANUP  | { // Best effort: a leftover marker only repeats an announcement. }              |
| src/runtime/paidGrants.ts:62                  | NARROW   | { // Only malformed JSON reads invalid here: anything else keeps its // kind. Th |
| src/runtime/paidGrants.ts:74                  | REPORTED | { if (storeErrorCode(error) === ENOENT) { return undefined } // read-state: cert |
| src/runtime/paidGrants.ts:113                 | REPORTED | { if (storeErrorCode(error) !== EEXIST) { throw error } const winner = read(file |
| src/runtime/paidGrants.ts:159                 | NARROW   | { // A missing quote folder holds no quotes; an unreadable one is // reported wi |
| src/runtime/resources/entry.ts:129            | SWALLOW  | { options.onError(new Error(UI_TEXT.resourceHistoryInvalid)) }                   |
| src/runtime/resources/history.ts:133          | GENERIC  | { return 'unknown' }                                                             |
| src/runtime/resources/history.ts:172          | NARROW   | { // A missing choice is the default (answered inside the reader); an // unreada |
| src/runtime/resources/history.ts:220          | NARROW   | { // A failed sample is reported once, never replaced by an invented // reading. |
| src/runtime/resources/history.ts:232          | NARROW   | { // A failed event is reported once and dropped. Anything that is not // an err |
| src/runtime/resources/history.ts:244          | CLEANUP  | { // The pump owns this reading: a foreign failure has no consumer, so // the ta |
| src/runtime/resources/history.ts:253          | CLEANUP  | { // As above: a foreign event failure is recorded once and dropped. report() }  |
| src/runtime/resources/host.ts:116             | GENERIC  | { options.onError(error) }                                                       |
| src/runtime/resources/host.ts:137             | GENERIC  | { options.onError(error) }                                                       |
| src/runtime/resources/host.ts:211             | REPORTED | { work.delete(id) throw error }                                                  |
| src/runtime/resources/host.ts:217             | REPORTED | { work.delete(id) throw error }                                                  |
| src/runtime/resources/load.ts:59              | REPORTED | { for (const unsubscribe of bound.values()) unsubscribe() bound.clear() loaded = |
| src/runtime/resources/load.ts:98              | REPORTED | { if (jobs === current) jobs = undefined throw error }                           |
| src/runtime/resources/load.ts:104             | REPORTED | { if (jobs === current) jobs = undefined throw error }                           |
| src/runtime/resources/settings.ts:29          | REPORTED | { if (storeErrorCode(error) === 'ENOENT') return undefined throw new Error(UI_TE |
| src/runtime/schedules/args.ts:182             | GENERIC  | { // A malformed option must never echo a prompt or unknown credential argument. |
| src/runtime/schedules/authorityStore.ts:24    | GENERIC  | { throw new Error('scheduleStoredJsonInvalid') }                                 |
| src/runtime/schedules/authorityStore.ts:44    | NARROW   | { if (error instanceof Error && error.message === 'scheduleIdentifierAlreadyIssu |
| src/runtime/schedules/binding.ts:55           | REPORTED | { binding = undefined throw error }                                              |
| src/runtime/schedules/command.ts:172          | GENERIC  | { return failure(options, UI_TEXT.scheduleV2.runtime.invalidRequest) }           |
| src/runtime/schedules/command.ts:183          | GENERIC  | { return failure(options, UI_TEXT.scheduleV2.runtime.unavailable) }              |
| src/runtime/schedules/consent.ts:26           | NARROW   | { // A missing file is no consent; a file the store cannot read is // neither ab |
| src/runtime/schedules/consent.ts:40           | NARROW   | { // Only malformed text reads invalid here; anything else keeps its kind. if (! |
| src/runtime/schedules/engine.ts:207           | GENERIC  | { throw new Error('scheduleStoredJsonInvalid') }                                 |
| src/runtime/schedules/engine.ts:215           | GENERIC  | { onError(error) return }                                                        |
| src/runtime/schedules/engine.ts:234           | SWALLOW  | { remaining.push(deferred) }                                                     |
| src/runtime/schedules/engine.ts:290           | GENERIC  | { onError(error) }                                                               |
| src/runtime/schedules/engine.ts:290           | GENERIC  | { onError(error) }                                                               |
| src/runtime/schedules/engine.ts:302           | GENERIC  | { onError(error) }                                                               |
| src/runtime/schedules/nativeBackground.ts:372 | REPORTED | { if (this.deps.platform === 'linux') { // Refused reconciliation must not leave |
| src/runtime/schedules/nodeBackgroundIo.ts:85  | REPORTED | { if (storeErrorCode(error) === 'ENOENT') return throw error }                   |
| src/runtime/schedules/nodeBackgroundIo.ts:184 | GENERIC  | { if (storeErrorCode(error) === 'ENOENT') continue throw unsafeScheduleLauncher( |
| src/runtime/schedules/nodeBackgroundIo.ts:313 | NARROW   | { if ( typeof error === 'object' && error !== null && 'code' in error && typeof  |
| src/runtime/schedules/nodeBackgroundIo.ts:335 | REPORTED | { if (storeErrorCode(error) === 'ENOENT') return throw error }                   |
| src/runtime/schedules/nodeBackgroundIo.ts:375 | GENERIC  | { if (storeErrorCode(error) !== 'ENOENT') throw unsafeScheduleLauncher(directory |
| src/runtime/schedules/nodeBackgroundIo.ts:391 | GENERIC  | { if (storeErrorCode(error) === 'ENOENT') return throw unsafeScheduleLauncher(fi |
| src/runtime/schedules/nodeScheduleFs.ts:49    | REPORTED | { if ( attempt + 1 >= SCHEDULE_FS_RETRY_ATTEMPTS // ['EPERM', 'EBUSY', 'EACCES'] |
| src/runtime/schedules/nodeScheduleFs.ts:97    | REPORTED | { if (!hasCode(error, 'EEXIST')) throw error }                                   |
| src/runtime/schedules/nodeScheduleFs.ts:111   | GENERIC  | { if (hasCode(error, 'ENOENT')) cleanup.delete(file) else cleanup.add(file) }    |
| src/runtime/schedules/nodeScheduleFs.ts:128   | REPORTED | { if (!hasCode(error, 'ENOENT')) throw error }                                   |
| src/runtime/schedules/nodeScheduleFs.ts:146   | REPORTED | { // Our unique temporary bytes identify a publication already committed. if (is |
| src/runtime/schedules/nodeScheduleFs.ts:155   | REPORTED | { // A competing lease release may remove the destination between // EEXIST and  |
| src/runtime/schedules/nodeScheduleFs.ts:191   | REPORTED | { if (hasCode(error, 'ENOENT')) return throw error }                             |
| src/runtime/schedules/nodeScheduleFs.ts:201   | REPORTED | { if (hasCode(error, 'ENOENT')) return [] throw error }                          |
| src/runtime/schedules/nodeScheduleFs.ts:225   | REPORTED | { if (!hasCode(error, 'ENOENT')) throw error }                                   |
| src/runtime/schedules/nodeScheduleFs.ts:315   | CLEANUP  | { // Hint publication is cleanup debt, not acquisition authority. await guard()  |
| src/runtime/schedules/nodeScheduleFs.ts:331   | GENERIC  | { heartbeatError = error instanceof Error ? error : new Error('scheduleLeaseHear |
| src/runtime/schedules/nodeScheduleFs.ts:362   | CLEANUP  | { /* Expiry owns release recovery. */ }                                          |
| src/runtime/schedules/registry.ts:12          | GENERIC  | { throw new Error('scheduleStoredJsonInvalid') }                                 |
| src/runtime/schedules/runtime.ts:80           | GENERIC  | { failures.push(error) }                                                         |
| src/runtime/schedules/runtime.ts:107          | GENERIC  | { const reason = UI_TEXT.scheduleV2.runtime.wakeBarrierTimeout return { exitCode |
| src/runtime/schedules/runtime.ts:116          | GENERIC  | { const reason = scheduleLauncherReason(error) ?? UI_TEXT.scheduleV2.runtime.inv |
| src/runtime/schedules/runtime.ts:154          | REPORTED | { unhold() throw error }                                                         |
| src/runtime/schedules/settle.ts:37            | GENERIC  | { if (result !== undefined) { const reason = scheduleLauncherReason(error) resul |
| src/runtime/schedules/surface.ts:124          | GENERIC  | { try { this.deps.notice( scheduleLauncherReason(error) ?? UI_TEXT.scheduleV2.ru |
| src/runtime/schedules/surface.ts:129          | GENERIC  | { // Creation already committed: notifier failure cannot invite a duplicate retr |
| src/runtime/schedules/surface.ts:141          | GENERIC  | { return { kind: 'refused', // An unreadable consent file names its errno's kind |

## Prove notes (2026-10-12, macmini rig)

- `npm run build` stays red on one budget: `dist/modelsPanel.js` is
  125.2 KiB against its 125 KiB budget. The isolated base worktree at
  d38908d0c builds 124.2 KiB; per-bundle metafiles attribute the +1,036
  bytes to the required P2-1 three-valued read (`credentialRead.ts`
  adapter +566, `credentialStore.ts` +483), while the P3-1 panel hunk
  itself shrinks the bundle by 13 bytes and the round's new sentences ride
  the shared UI-text chunk, never this bundle. No trim reaches the
  217-byte gap without contorting reviewed code: recorded as a justified
  deferral in PLAN.md §7 (rule 2), no threshold changed, the lead rebases
  the budget or directs a trim at integration.
- `test/unit/acpAgent.test.ts` "exposes all three ChatGPT actions…" fails
  identically on the untouched base (isolated clone at d38908d0c): not
  this change.
- Two load-flakes, each green on a quiet re-run at the repository's
  timeouts: `acpAgent` "never remembers a paid answer arriving after the
  prompt cancelled" (`until()` has a hard two-second deadline in the
  untouched `test/unit/helpers/acpWaits.ts`; fails with pristine HEAD
  files under load) and `catchInventory` "holds src/acp and src/webview at
  zero SWALLOW and GENERIC" (full-tree scan exceeds the 5 s test timeout
  under load; 13/13 alone).
