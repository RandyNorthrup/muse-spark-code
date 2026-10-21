# Catch burn-down: vault (D119)

Area: `src/runtime/vault` and `src/host/vault`, except
`src/runtime/vault/windowsBrokerProcess.ts` and
`src/runtime/vault/brokerProcess.ts` (another job owns those two files).
Base: PR #247 head after PR247FIX2 (9842587340). The catch classifier
(PR #161) is not in this tree; sites were listed with its copy from the
truth group (`git show b7537ba6f3:scripts/catch-inventory.mjs`), run from
`temp/catch/` (never committed). The baseline regeneration stays with the
join.

Outcome: GENERIC 64 -> 48, SWALLOW 32 -> 0. No catch was widened, no error
invented, no person-facing sentence changed: every fix keeps the exact
fixed words and only names the expected condition, carries the cause, or
records the kind. New person-facing strings: none (no l10n change).

## Fixed (48)

Code fixes that the classifier now accepts (verified per file after each
edit; drills noted where a test proves the fix):

- `src/host/vault/vaultActionDialogs.ts` (3 GENERIC -> NARROW): the key-file
  read names `vscode.FileSystemError` and rethrows the rest; both
  `importSshKey` failures ask for a passphrase only on the key module's own
  fixed refusal (`isSshRefusal`, exact sentence match, the same idiom as
  `refusalMessage`/`isVeto`). Proof: `test/unit/vault/sshKeyRefusal.test.ts`
  drives real `ssh-keygen` keys (garbage, oversize, encrypted PEM and
  OpenSSH files all refuse with the one sentence; the tool's passphrase
  opens the PEM bytes) plus a generated-key round trip.
- `src/host/vault/vaultNativeEditor.ts` (GENERIC -> NARROW): a refused edit
  keeps its fixed sentence with its cause; `Cancelled` still returns null.
  Person-visible sentence unchanged; callers matching on it are unaffected.
- `src/host/vault/vaultPanelHost.ts` (6 GENERIC -> 1 NARROW + 5 REPORTED):
  every failure path now records its kind in the log in fixed words
  (`failureForLog`, the sibling-lane idiom) through a new required
  `log: Logger` dep, wired from the entry's own `deps.log`. The person keeps
  the exact same toasts and views; only the record is new. No new unit test:
  the service seam admits no real implementation on this rig (it needs a
  live broker); verified by host typecheck, eslint, the classifier and the
  related suites.
- `src/host/vault/vaultPanelService.ts` (SWALLOW -> CLEANUP): the optional
  ambient discovery degrades to no suggestions, never to a failed snapshot;
  the handler now says so.
- `src/host/vault/vaultExecSpawn.ts` (SWALLOW -> CLEANUP): a failed
  contained-tree kill still fails the result through the flag; the handler
  now says the stop is best-effort. Proof: `test/unit/vault/vaultExecSpawn.test.ts`
  builds the helper paths for real and proves a refused write removes the
  half-built folder while the refusal still rejects.
- `src/runtime/vault/slots/linuxTpm2Slot.ts` (2 GENERIC -> NARROW,
  2 SWALLOW -> CLEANUP): both sealed-blob parses name `SyntaxError`
  (`JSON.parse` throws only that) and rethrow the rest; the stop race and
  the broken-stdin failures state their outcomes. Proof: the existing
  tampered-record test still rejects `VaultError`, plus the slot suite.
- `src/runtime/vault/slots/macVaultProtocol.ts` (GENERIC -> NARROW): only
  the validated `MacVaultError` crosses; anything else keeps the fixed
  sentence with its cause. Proof: new slot test drives the real transport
  at a missing helper (real spawn failure) and asserts the sentence plus
  the cause; drill: both new protocol tests fail on the old code.
- `src/runtime/vault/slots/windowsVaultProtocol.ts` (GENERIC -> REPORTED):
  same boundary, same proof (real transport at a missing PowerShell).
- `src/runtime/vault/vaultBrokerEntry.ts` (GENERIC -> REPORTED,
  3 SWALLOW -> CLEANUP): the failed Windows serve stops through the shared
  best-effort `stopFailedServe`; the stop-race, close-race and main-entry
  cleanups state that the exit code and the fixed stderr word are the
  launcher's record.
- `src/runtime/vault/vaultCommand.ts` (GENERIC -> REPORTED,
  2 CLEANUP kept): the gone-source cleanup is shared (`clearGoneImport`,
  exported for the test) so the delete refusal still throws; the parse
  fallback states it never echoes arguments. Proof:
  `test/unit/vault/vaultCommand.test.ts` (real parses incl. the undefined
  paths, the refusal mapping, both cleanup outcomes).
- `src/runtime/vault/vaultInput.ts` (3 SWALLOW -> CLEANUP): failed
  cleanups, a failed echo restoration and a failed setup all state that the
  line still rejects with the fixed refusal.
- `src/runtime/vault/posixNative.ts` (SWALLOW -> CLEANUP): a malformed lock
  answer never resolves the hold; the fixed refusal rejects it.
- `src/runtime/vault/brokerBindings.ts` (2 SWALLOW -> CLEANUP): a staged
  package without the OS binding anchors in the file with the same record
  and rollback rules, on both platforms.
- `src/runtime/vault/slots/linuxVaultSlots.ts`,
  `src/runtime/vault/slots/macVaultSlots.ts` (SWALLOW -> CLEANUP each): a
  failed hardware probe offers no hardware tier; the OS-store tier serves.
- `src/runtime/vault/slots/macVaultTransport.ts` (SWALLOW -> CLEANUP): the
  stop after a failed exchange is best-effort; the fixed refusal rejects.
- `src/runtime/vault/slots/windowsVaultSlots.ts` (SWALLOW -> 2 CLEANUP): the
  failed CNG probe and the ended screen-lock watch state their outcomes.
- `src/runtime/vault/windowsHost.ts` (SWALLOW -> CLEANUP): an unprovable
  process is no host; identity needs proof, never a guess.
- `src/runtime/vault/windowsPipeRelay.ts` (6 SWALLOW -> CLEANUP): fault,
  answer, ready and client parse failures fail the relay with the fixed
  refusal; the two spawn cleanups state that the relay fails and the spawn
  rejects.
- `src/runtime/vault/slots/windowsVaultTransport.ts` (5 SWALLOW -> CLEANUP):
  the stop, stdin, rebuild and guard-source failures of a dead exchange
  state their outcomes.
- `test/unit/vault/vaultHeadlessDeny.test.ts` (new): the headless deny
  (execVault:116) and the panel bridge (vaultSurface:61) fail closed for
  real — an unparsable use is denied as unattended with the fixed sentence,
  a tainted use as tainted, an unparsable panel message with the fixed
  sentence — without consulting the broker or the panel port (both tripwired).

## Designed baselines with reasons (48 GENERIC kept, with evidence)

Fixed-vocabulary boundaries (the error's class IS the kind; `ports.ts`
documents that no native text crosses; none has a cause slot to fill):

- `src/runtime/vault/fileAnchor.ts:39,60,68`: absent stays "no history"
  (`isVaultFileMissing` -> null), anything else keeps the fixed repair and
  never a filesystem sentence. Proof: `fileAnchor.test.ts` (starts empty,
  damaged record -> rollback, blocked location -> storeUnavailable).
- `src/runtime/vault/keyringAnchor.ts:62,143,155,166`: a damaged anchor
  never reads as "no history" (fail-closed rollback); the OS-store mapping
  converts at the boundary. Proof: the same anchor tests (the file anchor
  inherits `read`, including the damaged-record case).
- `src/runtime/vault/brokerBindings.ts:96,114,159,184`: the audit keyring
  mapping converts at the boundary. Proof: `brokerWithoutKeyring.test.ts`
  plus the anchor tests.
- `src/runtime/vault/slots/osStoreVaultSlot.ts:90`: `VaultError` passes,
  the rest maps at the boundary. Evidence: the documented
  storeUnavailable-repair rule (RVCM1091B 4) plus the passing slot suite;
  no OS store exists on this rig to fail for real.
- `src/runtime/vault/slots/linuxTpm2Slot.ts:51,366`: the spawn backstop and
  the unwrap backstop map at the boundary; the unwrap passes both fixed
  classes. Proof: the slot suite (refusals without a device, tampered
  records rejected).
- `src/runtime/vault/slots/windowsVaultSlot.ts:134`: the unwrap boundary
  keeps the fixed sentence. Windows-only; not drivable on this rig.

Fail-closed denies (the fixed outcome IS the report; no condition is
missing because every failure must deny):

- `src/runtime/vault/execVault.ts:116`: any request failure denies as
  unattended with the fixed sentence. Proof: the new deny tests.
- `src/runtime/vault/vaultSurface.ts:61`: any dispatch failure is the fixed
  denial. Proof: the new deny test (garbage never reaches the port).
- `src/runtime/vault/vaultInput.ts:164`: any bad material wipes and denies.
  Privacy design: parse errors can quote secret bytes.
- `src/runtime/vault/posixHost.ts:109`, `src/runtime/vault/windowsHost.ts:164`:
  any unreadable record refuses the host. Proof (POSIX):
  `test/unit/vault/vaultHostIdentity.test.ts` plants real host files
  (missing, corrupt, exact match, drifted identity and session); the Windows
  twin is not drivable on this rig.
- `src/runtime/vault/slots/macVaultSlots.ts:134`: presence refuses after a
  real probe. Proof: `slotProviders.test.ts` (absent helper -> false).
- `src/runtime/vault/slots/windowsVaultSlots.ts:122`: same for Hello.
  Windows-only.
- `src/runtime/vault/vaultRuntimeEntry.ts:61`: a broken watch fails
  `vault watch` instead of ending it as success (F7); the destroy error is
  the failure channel the classifier cannot see.

Rule outcomes (the returned word is the decision vocabulary, decided by
rule upstream; nothing is hidden):

- `src/runtime/vault/epochContender.ts:134,143` and
  `src/runtime/vault/windowsHost.ts:373,382`: unparsable records retire by
  rule under the mutex (RVCM109JE); unprovable holders wait (fail closed).
  No unit drive exists on this rig (both need the native identity helper);
  evidence is the documented rule plus the passing vault suites.
- `src/runtime/vault/windowsHost.ts:238`: not our shape is never deleted.
- `src/runtime/vault/posixNative.ts:67`: the probe's numeric exit protocol
  (2 proves absence, 1 retries once); only the fixed failure escapes.

Bounded startup retries (the loop must retry; the deadline throws with the
cause; the classifier cannot bless a retry path):

- `src/runtime/vault/posixClientPlatform.ts:70`,
  `src/runtime/vault/windowsClientPlatform.ts:119`: only proven death
  permits launch; live-startup transients wait for the deadline.

Terminal/CLI channels (stderr plus a nonzero exit IS the record; there is
no logger on the CLI path, and the classifier cannot see `printError`):

- `src/runtime/vault/vaultCommand.ts:357,365,542`: every refusal keeps its
  own sentence on the terminal (`vaultCommandFailure`, exact match) with
  exit 1. Proof: the new command tests (mapping, both receipt paths' words).
- `src/host/vault/brokerProcess.ts:56`: only a replaced broker retries the
  open; the same broker's error rethrows with its cause.
- `src/host/vault/vaultExecSpawn.ts:73`: a spawn/assert failure returns the
  fixed no-access shell result with the envelope wiped. No callers in this
  tree; the helper-paths test covers the file's provable surface.
- `src/host/vault/slots/windowsVaultBuild.ts:98`: an unsafe parent falls
  back to the temp tree with the host report signal (already accepted in
  the parent burn-down list).

Stream/promise channels the classifier cannot see (`callback(err)`,
`reject(err)`, `fail(err)` and fd cleanup whose original error rethrows):

- `src/runtime/vault/windowsPipeRelay.ts:73,184,416,551,600,676,798,866`:
  `_write` reports through the stream callback; dead stdin throws the fixed
  refusal; query failures remove the pending entry and reject with the
  error-or-fixed; publish/claim/rotate clean up owned fds and rethrow the
  original. Windows-only.
- `src/runtime/vault/slots/windowsVaultTransport.ts:72,103`: header parse
  and helper spawn failures keep the fixed refusal. Covered by the dead
  PowerShell test's path.

## Files remaining

None in the assigned area is partly done except by the kept list above:
every file with a kept GENERIC is listed with its reason. The two excluded
files were not touched. Whole-file states: fully fixed (no GENERIC/SWALLOW)
are vaultActionDialogs, vaultNativeEditor, vaultPanelHost,
vaultPanelService, macVaultProtocol, windowsVaultProtocol,
vaultBrokerEntry, vaultInput, linuxVaultSlots, macVaultTransport; the rest
keep only the documented GENERIC above.
