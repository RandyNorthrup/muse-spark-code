# RLF-M100K — M100 phase 2 lane K: owner binding and vault path

Rig: linuxlt. Branch: `rec/rlf-m100k`. Base: int/recovery at
`d057bf2038c3676fcf2e6b06dcf3b53a3d42b3da` (main at 0.19.0 plus 30+
merged lanes, incl. RLM100 paired devices and RLVAULTANCHOR).

## Merge checkpoint

**`d89a6ac07...`**, parents `d057bf20` (base) and `72ff0c86`
(`src/RLF-M100K/01-rec-rlm109`, RLM109 vault migration, pooled
accounts, retire), 2026-10-23. Hooks passed (ESLint/Prettier, secret
scan); tree verified clean after the hook.

Resolutions: `chatgpt.ts` keeps the base's `oidc` module plus RLM109's
`chatgptRecord` (RLM109's pre-refactor inline OIDC schemas dropped as
duplicates; two stale `ISSUER`/`ORIGIN` references renamed to the
`CHATGPT_*` names); `migrateCredentials.ts` takes RLM109's ChatGPT
subscription credential while Grok stays with its lane;
`vaultMigrationBundle.ts` comment merged;
`scripts/catch-baseline.json` and `docs/ide-compatibility/host-api.md`
regenerated from the merged tree (no hand merge of generated files).

Merge follow-up: the RLM109 source was red on `check-bundle-split`
(verified on its own tree: `chatgpt.ts` imports the new
`chatgptRecord.ts` but no allowlist names it), so the merge inherited
three problems. Fixed the codebase's own way: `chatgptRecord.ts`
joins `SUBSCRIPTION_ONLY` (rides with the dispatch like `chatgpt.ts`)
and the vault-migration exception (the codec parses the installed
record, like `modelRef`/`accountCredentialRecord`). Red observed
before, green after; no red drill depends on it.

Merge verification on this rig: full typecheck clean; migration suites
17 passed (`migrationCodecRoundTrip`, `credentialMigration`); the six
chatgpt suites 49 passed; the store-backed suites
(`chatgptSubscriptionMigration`, `credentialMigrationStore`,
`posixVaultPanelFlow`) skip here via the shared POSIX broker-suite
guard (no session bus, no keyring on this rig) and run on hosted CI on
real stores.

## What this lane built

New `src/core/devices/ownerBind.ts`:

- `DeviceOwnerBindings`: pairs bound to owners at pairing completion,
  keyed by pair, owner and the binding side's own device (one device
  may serve and request over the same pair). A valid pair key for the
  wrong owner fails here with `grant`.
- `DeviceOwnerGrants`: per-message authorization by role under
  least-privilege time-bounded revocable grants — binding, owner/role
  match, time bound, revision currency, mode ceiling and the per-owner
  quota ledger. One owner's spend never changes another owner's
  ledger. Denials are typed `DeviceGrantRefusal`s.
- `DeviceOwnerAudit`: every bind, issue, revoke, authorize, spend,
  serve and request decision appended through an injected port, and
  fail-closed (an action the audit did not record did not happen).
- Brokered-use call sites over the M100 channel with M109 lane R:
  `ownerVaultChannel` serves binding-verified facts (never payload
  facts) to `VaultRemoteOwner`; `serveOwnerBrokeredUse` serves one
  framed use and audits allow/deny;
  `hasConsumedOwnerBrokeredUse` requests one use and consumes the
  bound reply through lane R.
- Pair-key envelopes: the PEM sealed under a fresh data key bound to
  the pair, the data key wrapped by the caller's OS-store slot
  (`protectPairKey`/`unprotectPairKey`). Nothing of the PEM rests in
  the envelope.

Carriage: the multiplexed channel gains `vaultRequest`/`vaultResponse`
members on the control stream (`src/core/devices/channel.ts`);
`vaultRemoteResponseSchema` moves to `src/shared/vaultProtocol.ts`
unchanged (re-exported from `src/core/vault/remote.ts`).

## Proof status

Drills run over the two-process pinned-TLS rig (new `owner-bind`
driver scenario; rig helpers factored into `test/e2e/deviceRig.ts`;
both drill parents attach exit listeners up front — a late attach
misses a fast exit and hangs the suite, found and fixed in this
lane):

- Wrong owner: valid pair key, owner B's claim on an owner-A binding
  → `owner-mismatch` refusal; owner A's claim allowed on the same
  channel (positive control). Red proof: bypassing the owner check in
  `resolve()` turns the drill red (dialer exits 1 before
  OWNER-REFUSED).
- Grant replay past its bound: a grant allowed while current, then
  replayed after expiry → `grant-expired` refusal. Red proof:
  bypassing the expiry check turns the drill red (dialer exits 1
  before GRANT-REPLAY-REFUSED). Superseded-revision replay is proven
  at message level in the unit suite.
- Secret sentinel: no PEM block in either side's captured frames, and
  the real `VaultScrubber` reads the real traffic clean (green) while
  a planted sentinel in the same bytes fails the cleanliness assertion
  (red). Red proof: asserting the planted text clean fails.
- Every claim audited: the listener's `audit.jsonl` holds the exact
  sequence bind, issue, issue, authorize allow, authorize deny
  (owner-mismatch), authorize allow, authorize deny (grant-expired).

Unit suites on this rig: `deviceOwnerBind` (binding, the full
authorization matrix, per-owner quota separation, fail-closed audit,
envelope round-trip through the real passphrase slot);
`deviceOwnerVaultUses` (binding-verified channel facts; a full
request/serve loop against a real locked in-process broker denying
without approval; wrong-owning-device denial before the broker;
replay without reselecting; malformed/aborted input). The locked
broker never touches a store: constructed, never set up or unlocked.

Hosted-CI proofs, named as the brief requires:

- Windows DPAPI leg (`devicePairKeyDpapi`, win32-only): a real pair
  key through the real DPAPI slot and helper, asserting the
  `windowsDpapi`/`dpapi` record, no PEM at rest and a byte-exact
  round trip. DPAPI is per-user crypto with no named store entry, so
  nothing of the owner's store is read or written. Cannot run on
  this rig (Linux); typechecked and linted here.
- The approved-use allow path (setup, add, approve, ticket, code
  bytes over the channel) needs an unlocked broker, hence a real
  store, and is not proven in this lane: the locked-broker suite
  above proves every denial point of the same call sites, and the
  allow path through a live broker stays with M109's broker suites
  and the lead's four-device qualification. No store-backed suite
  was written that this lane could not see green.

Not bound in this lane: production still refuses through
`unboundDeviceLanePorts` (the refusal test stays green). Lane K
delivers the owner-checked authority, call sites and drills; the
install waits on the M100 status conditions (M95 review answer, M108
account surface, the lead's four-device qualification, D215
executors). The M95 review question named in the status is not in
§3; the lead confirms it.

## Gates (exit codes, this rig)

- `npm run typecheck` (all five projects): 0.
- `npx eslint --max-warnings=0` over every touched file: 0.
- `node scripts/catch-inventory.mjs --check`: 0 (three new
  NARROW/REPORTED sites; no SWALLOW/GENERIC movement, no baseline
  change).
- `npx knip`: 0 (pre-existing hints only; the lane's one unused-type
  hint removed at discovery).
- `node scripts/cycles.mjs`: 0, no cycles.
- `npx jscpd`: the lane's files contribute zero clones; the branch
  gate still reports pre-existing pairs (capabilityRecord,
  judgeWiringAssembly, providerPacing, responsesCodec,
  tabOutputSetting/execExactCount/grokClientIdSetting,
  judgeP2RedesignSides) untouched by this lane.
- `node scripts/check-l10n.mjs`: 0 (no UI strings added).
- `npm run check:reference`: 0 (no new commands/settings).
- `npm run check:roadmap`: 0 (ROADMAP.md current, no milestone change).
- `npm run check:plan`: red, pre-existing: PLAN.md is 3,729,414 bytes
  against the 3,565,158-byte bound, and the base d057bf2038 alone is
  3,725,714 bytes, already 160 KiB over before this lane's paragraph.
  Archiving closed history is the lead's call, not a lane edit.
- `npm run build`: green except `check-bundle-size.mjs`, red
  pre-existing: the same 8 bundles are OVER at the merge commit
  d89a6ac07 with byte-identical sizes (reportInputs, reportingPanel,
  resourceGovernor, resourceAdmission, modelApi, vaultActions,
  estimateContracts, wire; worst modelApi 533.3 vs 525 KiB). This
  lane's bundles pass (devices.js 112.9 vs 125 KiB). Proven in a
  scratch worktree under $TMPDIR, removed after.
- `node scripts/check-bundle-split.mjs`: 0 after the lane's allowlist
  fix (merge follow-up above); every later build step green (lazy registry,
  host-globals, notices, legal records).
- `npm run check:host-api`: 0 after regenerating
  `docs/ide-compatibility/host-api.md` (`node:crypto` 257 → 258: the
  lane's new ownerBind.ts importer).
- Lane suites, repository's own timeout, `--maxWorkers=3`, no
  `--testTimeout`: 3 files, 17 passed — bind 11, brokered uses 5,
  the two-process drill test green (wrong owner, expired replay and
  planted sentinel in one rig run); paced channels 6 passed
  (shared-helper refactor); windowsPipeHelperStart refactor
  typechecked (win32-only, for CI).
- Not run: store-backed suites (guarded skip here, hosted CI proves);
  `lint:css`, `lint:ps`, `check:tokens` (no visual/PowerShell/token
  changes).

## Commits (oldest first)

`d89a6ac07` RLM109 merge; `2f76871bd` lane-K core;
`583965418` drills, DPAPI leg and shared rig. Records commit follows.
