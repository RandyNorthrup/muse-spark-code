# M107 R — relocation

Worktree `/home/randy/lanes/M107R`, branch `m107/r`, base `c8bdf35fc`.
Read the rig brief, shared `codex/common.md`, AGENTS, D87 and M107 in full,
lane 0's contracts/platform record and M100's research record. No live or
paid call, credential read, dependency, network call, merge, rebase or push.
The rig brief overrides the old common merge instruction and delegates
aggregate quality to the lead. Normal hooks are installed.

## Implementation plan and dependency boundary

Implement D87.7 and acceptance 9 in the owned portable
`src/core/resources/relocate.ts`, with complete fake-device/runner tests in
`test/unit/relocate.test.ts`. Use lane 0's strict headroom, status and event
contracts. No service wire shape is invented: the dispatch adapter owns its
existing M100/M96c frame and receives only the extra reason and level.

M100 S/E and M96c/C2 are absent from this base: there is no remotePool,
devicePool, deviceReceiver or runners/routing file. Build against explicit
injected ports rather than supplying their missing implementations. Named
handoffs below describe the real bindings. No other lane's code is edited.

Policy covers offered normal targets, ample-before-some headroom, Devices
off with zero device-port activity, SSH only for approved heavy checks,
relocation off/ask, queued-only automatic movement, explicit Move to with
proved local retirement, Keep here through confirmed receiver cancellation,
and a visible row plus one conversation notice, Traffic and journal events.
Unknown admission never allows local retry or another target. The existing
owner must claim the attempt before any asynchronous work and settle it
without releasing uncertain occupancy. Receiver admission reads its own
current level immediately before the existing durable admission operation.

No new setting, command, UI chunk, string, dependency or tunable is needed.
Use the existing resourceMoveTo/resourceKeepHere/resourceRelocatedNotice
translations when the task surfaces are joined. W owns PLAN, CHANGELOG,
delivery documentation and bundle wiring; those bindings remain explicit
instead of editing W's files. Final scoped checks and byte-exact red drill
receipts will be recorded here as executed.

## Named integration handoffs

- **M107-R-M100-pool-binding:** remotePool/devicePool expose only paired,
  repository/role/check-approved, currently connected offers. hasOffer must
  check the complete existing offer, including exact mapping and snapshot
  consent; the device/runner supplier receives the exact work and binds
  offers and dispatch to that attempt. Headroom supplies no authority.
  Disabled Devices never evaluates
  the device supplier. Compose deviceResourceSchema into M100's own status
  parser. Dispatch retains M100's durable attempt identity, journals,
  permissions, paid consent, model capabilities and reconciliation.
- **M107-R-M100-receiver-binding:** call the exported normal-level guard at
  the final receiver admission boundary (`canAdmitResourceRelocation`), with
  no asynchronous gap before
  its durable admission; recheck all M100 permissions there too. Cancellation
  must return refused only with a confirmed no-admission outcome; a dropped
  reply, unresolved launch or cancellation uncertainty returns uncertain.
  An AbortSignal alone is never such a receipt. Keep here waits for that
  outcome and cannot recall work already admitted.
- **M107-R-C2-runner-retirement-binding:** M96c provides the exclusive
  attempt claim/settlement and its local retirement proof. Automatic routing
  is only for queued tasks/checks; an SSH offer is only for a heavy check.
  Move to names an offered target and retires the running local check before
  any dispatch. Claim failure cannot settle another owner's lease. Keep
  uncertain ownership occupied; no endpoint, timer, parent exit or user
  assertion is a retirement proof. Bind G's hasRelocationTarget to the
  existing approved, validated cached pool observations, without discovery.
- **M107-R-U-J-W-delivery:** bind row/notice/Traffic/event callbacks to the
  shared task surfaces and M102 resource journal, and keep one relocator per
  conversation. Surface adapters read existing UI_TEXT at use. This same
  portable policy is available to every interactive editor; headless refuses
  relocation. Join the module only in the existing lazy governor/team/runner
  graphs; keep startup growth zero and all existing caps. featureCatalog is
  absent on this base: add relocation, Move to, Keep here and receiver
  admission help entries at integration. W records the shared PLAN/§7/§9
  qualification, README consent/limits and an Unreleased CHANGELOG entry:
  approved queued work can route by resource headroom; a running check moves
  only after explicit choice and proved retirement. Two paired-rig receipts,
  M100 acceptance J and final full quality remain the dependency owners'
  integrated checks, not claimed by the fake-only lane.

## Implemented behavior and limits

The portable coordinator is one instance per conversation; each owned
attempt has a shared, final result. Automatic moves require local relocate
or pause; an explicit check Move to also works at throttle. Normal, disabled,
off and headless states keep work here without loading pools. Selection
prefers ample, falls back to some in stable pool order, validates untrusted
headroom strictly, and contacts no unoffered peer. A failed probe may choose
another already offered target; once dispatch begins, no failure or refusal
automatically selects another target. Admission loss and unproved local
retirement retain uncertain occupancy. Repeated run/Keep here cannot reset
that outcome.

The claim/settlement, durable dispatch/cancellation and retirement contracts
are mandatory injected dependencies, not production fakes. All permissions,
provider/model capability checks, paid confirmations and accounting remain
with the existing executing owner. Error adapters must report fixed/scrubbed
diagnostics, never log an untrusted peer/transport error verbatim. No owner
lease is released based on an AbortSignal or a lost reply.

Keep here can confirm that nothing was sent remotely even if an already
requested local retirement remains unknown; that acknowledgement still
settles the owner as uncertain and grants no successor. A final review
regression proved the distinction before fixing it: the complete 82-test
file exited 1 only at **Keep here confirms no remote admission even when
local retirement remains uncertain**, expecting true and receiving false.
Track dispatch-start evidence separately from the local settlement result;
the restored full file then passed 82/82 with the default timeout.

The mandatory row callback runs before dispatch and must install the named
target/reason row. Admitted moves trigger a once-per-conversation notice,
independent Traffic notification and the existing privacy-bounded resource
event subscription for J's journal. A failed notice can retry on the next
move; observer failures cannot undo admission. Traffic receives its own
event copy. Metadata is frozen so a row adapter cannot alter the dispatch
reason or level. The extra dispatch object is exactly `{reason, level}`;
no source readings, process ids, paths, command, environment or task brief
is spread into it. The task stays in M100/M96c's own already-approved frame.

Repository mapping identifiers are opaque and passed unchanged to the
existing offer adapter. This module does no filesystem path comparison;
the canary acceptance uses Windows separators too. Pool factories, claim
and final offer checks are synchronous. The receiver must make its own
durable decision: a stale sender probe is never an admission authority.

The module is deliberately unbound in production until the named M100/C2
dependencies join. No placeholder, fake implementation, dead-code ignore,
new UI or activation import is added. Delivery docs/help, lazy binding,
paired-rig receipts and aggregate gates remain explicit W/lead handoffs.

## Executed guard-fire receipts (Kubuntu)

All 65 final mutations ran the complete owning 83-test file with
`npx vitest run test/unit/relocate.test.ts --maxWorkers=3`. Every run exited
1 at named tests; none was filtered, skipped or given a raised timeout.
Each mutation restored the saved source bytes in finally and compared
SHA-256 equal before the next run. The original and final source hash is
`58c1c11923c04029c734e39ea63913b63d26e586100d0c3be9a5441ae533f944`.

The first survey's early-Ask mutation survived because the later consent
check still asked. Add the missing assertion that the first question is
pending before the second target read; it now fails. The complete final
survey reruns every guard after the local/remote retirement distinction,
ESLint's condition ordering and the shared test setup below. Preliminary
or repeated runs are not counted as extra distinct drills. The deliberately
removed initial yield fails the reentrant-start test by assertion and also
reports a RangeError; no drill depends on a raised timeout.

| Mutation                        | Named failing test (first; some mutations fail more)                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| receiver-level                  | refuses a receiver at throttle even with an offer                                      |
| cancelled-status                | Keep here before a run is sticky and starts no pool activity                           |
| headless                        | has no device activity for headless                                                    |
| governor-disabled               | has no device activity for disabled                                                    |
| relocation-off                  | has no device activity for off                                                         |
| normal-local                    | keeps automatic work local at normal                                                   |
| automatic-throttle              | keeps automatic work local at throttle                                                 |
| offer-authority                 | has no device activity for noOffer                                                     |
| disabled-device-supplier        | has no device activity for devicesOff                                                  |
| device-disabled-after-selection | rechecks devicesOff after an asynchronous choice                                       |
| ineligible-kind                 | never relocates toolShell                                                              |
| changed-kind                    | refuses a task whose kind becomes ineligible while waiting for consent                 |
| running-explicit-choice         | never automatically moves a running check                                              |
| running-worker                  | never automatically moves a running worker                                             |
| missing-retirement              | does not move without retirement proof (missing)                                       |
| retirement-proof                | does not move without retirement proof (false)                                         |
| retirement-unknown              | does not move without retirement proof (false)                                         |
| runner-disabled                 | refuses a misclassified SSH offer for disabled                                         |
| runner-worker                   | refuses a misclassified SSH offer for worker                                           |
| runner-light                    | refuses a misclassified SSH offer for light                                            |
| receiver-normal-headroom        | refuses a receiver at throttle even with an offer                                      |
| headroom-none                   | rechecks the receiver headroom after selection                                         |
| peer-validation                 | refuses a receiver at throttle even with an offer                                      |
| ample-preference                | prefers ample over some and preserves pool order for equal headroom                    |
| some-fallback                   | prefers ample over some and preserves pool order for equal headroom                    |
| explicit-target                 | Move to dispatches the named check target only after proved local retirement           |
| iteration-cancel                | aborts target iteration after Keep here instead of probing another device              |
| exclusive-claim                 | never tries a second target after dispatch is lost                                     |
| claim-reentrant-policy          | rechecks cancel from the exclusive claim before loading a pool                         |
| initial-ask                     | rechecks keep after an asynchronous choice                                             |
| fresh-ask                       | requires new ask consent when mode changes during the headroom read                    |
| manual-choice-is-consent        | Move to dispatches the named check target only after proved local retirement           |
| fresh-headroom                  | rechecks devicesOff after an asynchronous choice                                       |
| post-retirement-policy          | rechecks policy after retirement without another device probe                          |
| queued-before-row               | rechecks started after an asynchronous choice                                          |
| queued-after-fresh-ask          | does not treat a newly observed ask mode as implicit approval                          |
| policy-after-fresh-ask          | rechecks recovery after consent newly required during a headroom read                  |
| final-level                     | refuses reentrant level from the row before dispatch                                   |
| final-ask                       | refuses reentrant ask from the row before dispatch                                     |
| final-phase                     | refuses reentrant started from the row before dispatch                                 |
| final-offer                     | refuses reentrant revoke from the row before dispatch                                  |
| required-row                    | routes an offered queued worker with a row before dispatch and all move records        |
| notice                          | routes an offered queued worker with a row before dispatch and all move records        |
| notice-once                     | notifies once per conversation and records every move despite a failing observer       |
| notice-success                  | retries a failed notice on the next move while keeping Traffic and journal independent |
| traffic                         | routes an offered queued worker with a row before dispatch and all move records        |
| journal                         | routes an offered queued worker with a row before dispatch and all move records        |
| observer-isolation              | a Traffic observer cannot mutate the journal event                                     |
| keep-here-abort                 | Keep here before a run is sticky and starts no pool activity                           |
| keep-here-receipt               | Keep here waits for the receiver outcome admitted                                      |
| refusal-is-local                | Keep here waits for the receiver outcome refused                                       |
| admitted-wins                   | Keep here waits for the receiver outcome admitted                                      |
| unknown-admission               | Keep here waits for the receiver outcome uncertain                                     |
| lost-dispatch                   | never tries a second target after dispatch is lost                                     |
| settlement-result               | routes an offered queued worker with a row before dispatch and all move records        |
| settlement-authority            | never tries a second target after dispatch is lost                                     |
| confirmed-move-only             | Keep here waits for the receiver outcome uncertain                                     |
| dispatch-private-field          | routes an offered queued worker with a row before dispatch and all move records        |
| journal-private-field           | routes an offered queued worker with a row before dispatch and all move records        |
| immutable-dispatch-metadata     | a row adapter cannot change the reason that will be dispatched                         |
| deferred-reentrant-start        | installs its shared promise before a synchronous port reenters run                     |
| memoized-cancelled-outcome      | a lost reply retains ownership even when Keep here requested cancellation              |
| local-uncertainty-kept          | Keep here confirms no remote admission even when local retirement remains uncertain    |
| marked-dispatch-start           | Keep here waits for the receiver outcome admitted                                      |
| headroom-after-fresh-consent    | rechecks receiver headroom while waiting for newly required consent                    |

## Verification scope

All checks run directly on Kubuntu, serially for heavy tools, using the
repository's existing thresholds and caps. There are no installations,
new suppressions, casts, ignores, skipped tests or changes to hook commands.
The full quality and full-unit run are explicitly prohibited by this lane's
rig/common brief; the lead owns those on the joined dependency tree.

The initial duplication gate found three cloned test setup ranges. Two
shared helpers now script consent becoming necessary at the second reading
and hold/cancel an actual dispatch. The remaining shared cancellation
continuation belongs in that admission helper too. The final existing
`npx jscpd` reports 1,236 files and zero clones. Scenarios and assertions
remain, and the final guard survey runs those exact fixtures.

Focused coverage instruments only R's production module under the unchanged
repository thresholds; it is not aggregate unit coverage:
`npx vitest run test/unit/relocate.test.ts --maxWorkers=3 --coverage --coverage.include=src/core/resources/relocate.ts`.
The restored suite passes 83/83 in about one second: **100% statements**
(116/116), **99.22% branches** (128/129), **100% functions** (14/14) and
**100% lines** (93/93). The last consent/headroom guard has its own named
red/restored drill, even though V8 retains one unhit branch.

First-piece restored-tree checks: `npm run typecheck` exits 0 across all five
projects; a fresh `npm run typecheck:unit` after the final fixture changes
also exits 0. Final explicit-source ESLint exits 0 with zero warnings;
Prettier checks all three changed files successfully; staged whitespace
checks pass. The final plain owning-file run after all 65 mutations passes
83/83 with the repository default timeout. Source SHA-256 matches the final
drill restoration above. The ordinary early commit follows these checks;
remaining static/build and hook receipts are appended after execution.

## Final delivery receipts (Kubuntu, Node v24.18.0)

Implementation commit **04df97c2f** ran ordinary serial lint-staged:
ESLint `--fix`, Prettier and staged redacted gitleaks all passed. Gitleaks
scanned 60.30 KB with no leaks. Husky's generated launcher and the existing
`core.hooksPath=.husky/_` were already present; no hook/config changes or
bypasses. The production source hash remained exactly the final drill hash
after the hook. The tree was clean after the commit and production build.

| Check                                                                                      | Final result                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| All-project typecheck; fresh final unit-project typecheck                                  | Exit 0                                                                                                                               |
| Final source/test ESLint                                                                   | Exit 0, zero warnings                                                                                                                |
| Explicit-file Prettier; staged whitespace                                                  | Exit 0                                                                                                                               |
| Final owning Vitest file                                                                   | Exit 0, 83/83, default timeout, three-worker maximum                                                                                 |
| Focused R coverage                                                                         | Exit 0, 100% statements/functions/lines, 99.22% branches; thresholds unchanged                                                       |
| `JITI_FS_CACHE=0 npm run deadcode`                                                         | Exit 0, only existing vendor/axe-core configuration hints; disabling Jiti's filesystem cache avoids writing into shared node_modules |
| Final `npx jscpd`                                                                          | Exit 0, 1,236 files, zero clones                                                                                                     |
| `node scripts/check-l10n.mjs`                                                              | Exit 0, 14 tables, 164 manifest strings, 635 source files, zero problems                                                             |
| `npm run check:host-api`                                                                   | Exit 0, 336 VS Code APIs, 32 vscode importers, 26 Node built-ins, 61 theme variables, zero problems; no generated-record change      |
| `npm run cycles`                                                                           | Exit 0, 593 dependencies, no cycles                                                                                                  |
| `npx dpdm --no-warning --no-tree --exit-code circular:1 -T src/core/resources/relocate.ts` | Exit 0, R's seven-module graph, no cycles                                                                                            |
| `npm run build`                                                                            | Exit 0, every existing cap, bundle/model-text split, host-global check and 83-package notices                                        |

Measured production artifacts:

| Artifact                                 | Measured size / existing cap |
| ---------------------------------------- | ---------------------------- |
| Activation                               | 446.2 / 600 KiB              |
| Model API                                | 449.4 / 475 KiB              |
| ACP                                      | 837.9 / 850 KiB              |
| Checkpoint store                         | 77.3 / 225 KiB               |
| Shared English fallback, compressed      | 48.7 / 125 KiB               |
| Webview startup including static imports | 894.8 / 900 KiB              |
| Deferred webview JavaScript              | 49.7 / 50 KiB                |

The existing governor bundle measures 61.0 KiB. Inspect all 39 generated
Node/webview/ACP build metafiles with path separators normalized: none
includes R's module. Thus this lane adds zero shipped/startup bytes on this
base, and these sizes qualify the existing integration tree, not R's future
joined bundle. W must bind/measure R with M100/C2, retain the lazy boundary
and every cap, and certify the end-to-end rows and two paired rigs. No new
UI chunk is required by this pure-policy lane.

Only the owned module, owning tests and this record differ from base.
No other lane-owned source, shared string/manifest, gate, budget, dependency,
setting, Git configuration or delivery document is edited. All required
missing dependency/documentation/help bindings are named above; full quality
is left to the lead as the explicit rig brief requires. The final receipt
commit uses the same normal hooks and explicit-path staging. No merge,
rebase or push occurs.
