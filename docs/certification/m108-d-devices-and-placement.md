# M108 D — devices and placement

Worktree `/home/randy/lanes/M108D`, branch `m108/d`, Kubuntu, base
`76c1231e8` (lane 0 + K + T + P and review corrections).
Read the rig brief, common rules, orchestration gotchas, AGENTS, D88 and
M108 in full, account-terms research and lane 0/policy/P certification.
No credentials read, network/model/paid calls, dependency installs, pushes,
merges, rebases or hook changes.

## Scope

Placement amendment (a) is recorded in D88.10 before implementation. It
was absent on this base; the lane brief supplies the amendment's scope.
`onePerDevicePerProvider` defaults on. Its refusal explicitly offers
another device or turning off the rule. Pinning replaces the account's
previous device/node; different providers can occupy the same device.
The metadata owner serializes mutations before I/O and supplies the atomic
publication fence. Snapshot authority expires as soon as a pin is changed.

`src/core/team/remotePool.ts` routes by a pinned device's provider bucket,
keeps a conversation/worker's assignment while there is room, spreads new
workers by headroom and retains pool order on ties. A manual destination
never falls back after refusal. Unknown/missing offers provide no capacity
(G5); an uncertain send retains its admission/lease and is never retried on
another device by this code (G6). Routing requires consent and resource
admission through M100/M107's injected claim. Every send/retry checks live
placement, provider headroom, capability/permission and the claim.

`src/host/devices/deviceReceiver.ts` has no VS Code dependency and composes
P's real account pool. Only accounts pinned here can be selected. The
receiver chooses its own account, model estimate, modes/flags, budgets and
policy gate. A sender's vendor-limit trigger requires this receiver's own
confirmation even if its account has room. The final gate checks policy
changes/revocation, provider lifecycle, local pin, model access, permission,
thresholds, Retry-After and the original budgets. Known nonsends refund;
ambiguous sends retain P's account liability and the remote lease claim.

Strict local schema fragments reject sender account identities, labels,
credentials, confirmations, machine ids, paid prices and interaction flags.
Offers contain only `{ provider: ample | some | none }`. These fragments
extend an authenticated M100 envelope at integration; they are neither a
guessed vendor wire shape nor a transport. No live capture was needed or
attempted. Paid consent and credential lookup remain the executing host's
existing P/K ports; no stored key goes to a peer.

The three runtime messages have real translations in all fourteen tables;
`Send to {device}` reads the installed language when called. No manifest
command/setting or UI bundle is invented on this base.

## Named integration handoffs

- **D-K-W-PLACEMENT:** bind `AccountPlacementStore` to the profile's local
  metadata owner, with a single `AccountPlacements` instance and atomic
  `write(rows, check)`. Initialize the existing default account on the local
  device. Account removal/unpairing, cross-window/process invalidation and
  rule changes share that owner; do not share repository git configuration.
  Bind `isKnown` to the current K registry and the paired-device/node registry.
  Placement metadata stays local and never moves secrets between devices.
- **D-M100-OFFERS:** compose the provider buckets into M100's authenticated
  offers. `offers()` supplies only live authenticated peers; failed polls
  expire their availability, with unknown status shown by M100. Account ids,
  labels, groups, confirmations and private capacity readings never enter
  those offers. Map node ids to the same opaque placement identity contract.
- **D-M107-RELOCATION:** bind `canRoute` to the selected model's capability
  record, pair/receiver incarnation, grants and resource governor. `admit`
  atomically reserves before the next admission, retains the immutable
  original `budgetOwner` and must not reset the parent's/daily budget.
  `claim.check` fences leases/epochs and revocation synchronously at every
  transport send. `finish(uncertain)` retains liability/lease until M100's
  authoritative retirement; no unknown worker is abandoned or duplicated.
- **D-M100-RECEIVER:** bind receiver `admit` to M100's own permissions,
  repository/base/input grants, epoch and M107's governor. Build `request`
  from the receiving task's local session and stable worker identity;
  resolve prices/capabilities locally. Supply one stable `AccountPoolDeps`
  lifecycle per provider/product, its receiver-owned confirmation service
  and its P/K credential/send fence. `isPinnedHere` is synchronous and current,
  incorporating placement generations so re-pinning away and back cannot
  revive an old admission. Remote success is a validated M100 receipt, not
  a sender's assumption; quarantine late epochs. Retain the sender's original
  pooling trigger when constructing the credential-free fragment.
- **D-U-H-W-SURFACES:** bind pin controls, the rule's default-on toggle and
  conflict error, manual `Send to {device}` and routing notices to the lazy
  Models & Agents/devices panel, shared bridges and companion. ACP/runtime
  owners consume the same core; unsupported pairing modes remain M100's
  explicitly deferred scope. No VS Code-only implementation was added.
- **D-W-DOCS-HELP-BUNDLES:** W owns README/CHANGELOG, manifest setting text,
  privacy/security, ACP/CI/editor docs, help/reference and lazy bundle wiring.
  The feature catalogue is absent on this base: add entries for account
  pinning, `onePerDevicePerProvider`, conflict recovery, provider headroom
  routing and `Send to {device}` when it lands. Keep these modules inside the
  lazy device/provider bundles, with their own existing size/split budgets;
  activation/chat startup must gain no imports. W runs the full quality and
  editor/harness gate after binding M100/M107 (absent here). No fake production
  adapter or empty-success seam was added, and no cap/gate was weakened.

## Verification and red drills

Kubuntu rig, worktree `/home/randy/lanes/M108D`, no `--testTimeout`
(repo default), `--maxWorkers=3`. One execution tool at a time.

- `npx vitest run test/unit/remoteAccountPool.test.ts
test/unit/deviceAccountReceiver.test.ts --maxWorkers=3` → **34 passed**
  (20 + 14), twice: before the lint fixes and after.
- `npx tsc -p tsconfig.json --noEmit` and `-p test/unit/tsconfig.json
--noEmit` → clean.
- `npx eslint --max-warnings=0` on the six changed/new source/test/helper
  files → 15 errors found and fixed (parenthesised ternary,
  `Promise.withResolvers<undefined>`, await-member split, switch
  branches, typed `vi.fn` params); re-run clean.
- `npx prettier --check` on the touched files → clean after `--write`.
- `node scripts/check-l10n.mjs` → 14 tables, 0 problems.
- `npx knip` → exit 0 (two pre-existing config hints only).
- `npx jscpd` → 0 clones.
- The full quality gate belongs to the lead and was not run in this lane.

Red drills (each: break the guard, see the named test fail, restore the
file, verify SHA-256 byte-exact; pre-drill hashes `bcc26f3a…962a90`
for `remotePool.ts` and `6d7b61ad…ad0cf43` for `deviceReceiver.ts`,
both `OK` after every drill):

1. `onePerDevicePerProvider` default `?? true` → `?? false`: named test
   `defaults onePerDevicePerProvider on and names both ways forward on
refusal` fails (1 failed, 19 skipped). Restored.
2. `rank > 0` → `rank >= 0` (route to no-headroom offers): named test
   `treats missing/unknown offers as unavailable and validates the
authenticated fragment` fails. Restored.
3. `request: fragment` → `request: { ...fragment, account:
placement.account }` (account id in the device frame): named test
   `sends only provider/model/trigger, never account ids, labels,
confirmations or parent ids` fails. Restored.
4. `if (decision.kind !== 'allow')` → `&& false` (receiver skips its own
   gate): named test `honors Only at my own caps and Cancel, and respects
on and one-person rows` fails. Restored.
5. `snapshot.check()` removed from `beforeSend` (stale placement after
   re-pinning): named test `invalidates a queued route on repinning and
never abandons or duplicates an uncertain send` fails. Restored.

Lane notes for integration: no file path is compared or matched anywhere
in this lane (placements key on opaque provider/account/device ids, so
there is no separator to normalise); no money arithmetic was added
(estimates and budgets pass through the injected P ports untouched, exact
USD stays in T/P); no UI and no bundle was added (new modules are
imported by nothing on this base, so activation and every cap are
unchanged); no new dependency; no live, paid or credential use.
