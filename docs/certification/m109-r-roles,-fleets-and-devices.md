# M109-R — Roles, fleets and devices

Lane `m109/r`, base `8a151dd4`, MacBook Pro Intel rig, 2026-10-06.
Scope: PLAN D89.6, D89.10, D89.13 and M109 acceptance 9, 13, 18.
No model attempts, paid calls, credential-store reads, dependencies, UI edits,
merge, push or gate changes. Hooks remain enabled. Runtime bindings below are
integration obligations; this lane does not enable a shipped vault surface.

## Implementation and authority

`src/core/vault/fleet.ts` validates role ceilings and defaults research,
design and marketing to `none`. Trusted launch facts establish source,
unattended status, host/session/workspace and process identity. Descendants
inherit the intersection of their parent's ceiling. All twelve worker
sources use distinct generated requester ids and private sockets; Windows
pipe comparisons normalize separators and case. Tickets go only through
the injected inherited-pipe handoff, with a final identity/digest/deadline
predicate. Host provenance cannot be cleared by model input.

Delegation is one authenticated user card per task, with role, targets,
counts and a SHA-256 binding. Only `allowOnce`/`deny` are representable for
this task card; approval lasts until task retirement. It never creates an
Always grant. Scope reservations are synchronous, counts are monotonic,
and the model can only remove scopes or lower counts. Out-of-scope, exhausted or
tainted task requests require a fresh broker approval, including under an
ordinary Always grant. The task adapter exposes `requestOutside` explicitly;
a returned automatic ticket is refused. After admission, `canUse` rechecks
current narrowed targets/counts at release, and the private pipe checks it too. The injected broker
task-authorization adapter remains responsible for current item policy,
presence, taint, audit and final admission. A task card cannot bypass those
checks or authorize paid use.

`src/core/vault/remote.ts` uses lane 0's strict remote request contract.
Authenticated pair/lease facts, local item selection and a fresh owner-side
card precede every signature/code, even under Always mode. The owner-side
card binds both the broker's request and the remote session/origin. Only
signatures and current codes cross the paired channel, never handles,
items, grants, tickets, approvals, seeds or credential material. The receiver
validates request id, kind and pinned owner identity, privately delivers the
result, erases its buffers and returns only success. These capabilities are
usable authority; they are not safe to put in a model's context.

Lock, connection loss, task retirement and disposal invalidate pending
effects. Late capability buffers are erased before fallible cleanup. One
failed route close must not leave sibling/descendant routes live. The code
uses existing constants and translated `UI_TEXT.vault` labels at runtime;
no strings or manifest entries are added.

## Named integration handoffs

| Id                 | Owner                       | Binding and required receipt                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-roles            | M96                         | Embed `vaultRoleSecretsSchema` in the charter and supply trusted charter ceilings to `VaultFleet.open`; include handles/targets/counts in `delegate` proposals. Models never set effective launch identity or broaden a ceiling.                                                                                                                                                                                                                                           |
| R-routes           | S/X, M48, M77, M96          | Bind `VaultWorkerRoute` to one authenticated launched process, owner-only socket and inherited ticket pipe. `close` synchronously invalidates that registration/connection and terminates its feeders. Never expose a ticket in argv, env or a tool result. Preserve Muse Code's own sign-in.                                                                                                                                                                              |
| R-task-authority   | B/U/H                       | Bind `VaultFleetDelegationPort.approve` only to authenticated user UI. Bind `request` to temporary broker task authority, with current policy/presence/taint checks, audit and synchronous `canAdmit` at admission and `canUse` through final release. `requestOutside` must force a fresh card, never reuse an ordinary Always/session grant. Base B has no temporary task-authority adapter; do not translate this into a standing grant or synthetic per-use UI answer. |
| R-unattended       | M52, M88, M45, M96c, M107 R | Supply `schedule`, `timedSend`, `goal`, `scheduler`, `relocation`, `headless` or `userUnattended` trigger from trusted admission facts. Relocation stays unattended on its receiver. Preserve H's hard `--vault` gate and CI's no-vault policy.                                                                                                                                                                                                                            |
| R-channel          | M100 S/E, M107 R            | Bind owner/consumer ports to the pinned mutual-TLS pair and active task lease. Disconnect subscriptions must fire synchronously. No item names in offers/status. Late/unknown worker state never becomes authorization to duplicate work; M100 owns G5/G6/G7/G27.                                                                                                                                                                                                          |
| R-remote-SSH       | S/M100 E                    | Resolve and prove the actual SSH exchange; verify session-bind, host key, user and signed data. Execute inside the broker and keep admission alive through final transport write; return only signature bytes. Receiver delivers only to the corresponding SSH exchange.                                                                                                                                                                                                   |
| R-remote-code      | L/X/B/M100 E                | Resolve the exact HTTPS origin to the receiver's verified stdin/fill sink; owner chooses the item locally. Lane 0's remote request names an origin while canonical `totp` use names a command. The composite owner card binds both; the resolver and broker route must prove that origin-to-sink relationship before execution. Never return code to a tool/model, and never return a seed.                                                                                |
| R-UI-editors       | U/H/M104                    | Render delegation and remote owner cards in the shared lazy UI/ACP permission surfaces. Run four-theme/320px/axe checks on a browser rig. No browser available here, and no visual code changed. All editors use the same core; no VS Code-only path added. Move the value-free card projection into the shared bridge contract with lane 0; browser consumers import core types only.                                                                                     |
| R-wiring-reference | W                           | Load these core modules only from declared vault/team/device lazy readers, retain budgets, add featureCatalog/reference entries when that file is present, and update product docs after bindings actually ship. No activation import is added here.                                                                                                                                                                                                                       |

The M96/team and M100/device files named in the plan are absent on this
base, as are M96c and M107 adapters, S/X and the featureCatalog generator.
They are not replaced with production fakes. Store/platform crypto remains
owned by C/P/B; this lane handles no private item bytes.

## Threat/control test map

| Threat | R control and test files                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1     | Role ceilings, task scope/narrowing and trusted taint: `fleet.test.ts`, `delegation.test.ts`.                                                                                                     |
| V7     | Late, malformed and throwing-transport capability erasure, plus receiver sink erasure: `remote.test.ts`. JS/base64 strings and OS memory zeroization remain the research's residual.              |
| V10    | Restricted frames, authenticated pinned identity, fresh local approval, private receiver sinks: `remote.test.ts`.                                                                                 |
| V11    | Task/remote digest, id, expiry, replay and synchronous count admission: `delegation.test.ts`, `remote.test.ts`.                                                                                   |
| V12    | Every automatic trigger marks unattended; real B refuses ordinary grants, taint and presence; remote work refuses unattended callers: `fleet.test.ts`, `remote.test.ts`.                          |
| V13    | Unique sockets, Windows normalization, trusted registration, private handoff, identity/digest checks and copied access rejection: `fleet.test.ts`. Real peer/OS isolation remains B/S/X captures. |
| V16    | Lock/retirement/disposal barriers and isolated route cleanup: `fleet.test.ts`, `remote.test.ts`.                                                                                                  |

V2–V6, V8–V9, V14–V15 retain their named runtime owners in
`m109-threat-model.md`. M107 resource/temp-root gotchas G9–G13/G16 and M100
dispatch/liveness/environment gotchas remain their owners' controls, not
duplicate schedulers or cleanup code in this lane.

## Verification receipts

Checks run directly on this rig, one compiler/test/linter/build at a time.
Final Vitest runs use repository default timeout and at most three files/
workers. Aggregate `quality`, integration/editor/platform captures and
browser checks remain lead-owned under the rig brief.

Initial focused run: 39 passed, one failed. The concurrent-use fake invoked
the second request's callback for both replies; fixed to keep one callback
per request. No timeout was raised.

| Check                                                        | Rig result                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Vitest (fleet, delegation, remote; `--maxWorkers=3`) | 59 passed, default timeout.                                                                                                                                                                                         |
| `npm run typecheck`                                          | All five projects passed. Test helpers passed repeated unit typecheck after deduplication.                                                                                                                          |
| Changed-file ESLint / Prettier                               | Zero warnings/errors; final hook repeats both.                                                                                                                                                                      |
| `node scripts/check-l10n.mjs`                                | 14 tables, 164 manifest strings, 612 source files; zero problems.                                                                                                                                                   |
| `npm run deadcode`                                           | Passed; unchanged vendor/axe configuration hints only.                                                                                                                                                              |
| `npx jscpd`                                                  | Zero clones. Six initial test-only clones removed with shared proposal, pipe-wait and delegation setup helpers; threshold unchanged.                                                                                |
| `npm run cycles` and direct dpdm over fleet/remote           | Passed; 561 production and 11 lane dependency nodes, no cycles.                                                                                                                                                     |
| `npm run build`                                              | Passed size, split, host globals and notices. Extension 436.9/600 KiB; Model API 446.8/475 KiB; checkpoint store 77.1/225 KiB; webview startup plus static imports 897.9/900 KiB; ACP 817.0/850 KiB. No cap raised. |
| `npm run check:host-api`                                     | One generated-record drift; named W handoff below.                                                                                                                                                                  |

The host API record still has the pre-B import counts. B's existing
`m109-b-host-api.patch` proves its expected counts; R adds only two
`node:crypto` imports, changing B's 53 to 55. Current source counts are:
child_process 14, crypto 55, fs 36, fs/promises 49, net 10, path 89. The
332 VS Code APIs, 31 VS Code adapter files, 25 Node built-ins and 61 theme
variables are unchanged. **R-host-api**, owner W: regenerate/review
`docs/ide-compatibility/host-api.md` on the joined tree and rerun the check.
This lane leaves that owned generated file untouched and adds no ignore.

### Deliberate guard failures

[Machine-readable receipts](m109-r-drills.json) record **63** mutations:
F01–F20 (roles, identities, sockets, provenance, ticket handoff and cleanup),
D01–D21 (task authority, answer binding, deadlines, count admission, narrowing
and forced outside-task approval), R01–R22 (pinned device identity, restricted
frames, local approval, replay, final release and byte erasure). Every run
used the full owning test file, `--maxWorkers=3`, repository default timeout,
and no test filtering. Every mutation produced its expected named failure;
every restoration matched the pre-mutation bytes and SHA-256.

All final receipts match these restored source hashes:

- `fleet.ts`: `f940097093bd1b2c584a90f7cb20adf2dbce9da04a2966dee8f810d50df3ce0f`
- `remote.ts`: `c05eeb599f1ee7c0bbb0f63574c6044104f642a622b785154eb49d90f1a00836`

Proof preparation strengthened four witnesses: saturation uses a valid route,
forged access uses a valid proposal, concurrent admission records each
reservation decision separately from the later release guard, and remote
expiry asserts that the owner never calls `broker.answer` after its deadline.
The latter two initially stayed green when one guard was removed because a
second guard independently refused release; the strengthened named tests
then failed. A test-title mismatch in the receipt runner was corrected.

Review also closed two task-authority gaps before certification: outside-card
uses no longer fall back to ordinary automatic authority, and a scope/count
narrowed after admission is checked again at release. The lowered count is
compared against each admission's ordinal, preserving the still-covered use.

## Planning status and next slice

M109 remains planned/integration-open. This lane supplies core R behavior and
tests against explicit ports; it does not certify a complete running fleet.
Next slice binds R-task-authority and R-routes with M96/B/S/X, then joins
M100 S/E and M107 R for owner-to-receiver use and all-editor UI verification.
W must rerun the joined-tree full gate, budgets and threat matrix before
claiming M109 supported. Q-M109's Secure Enclave capture remains separate.
