# RLF-MAKERFENCE certification — the hardware fence refuses physical actions, not work

Lane RLF-MAKERFENCE, recovery release. Worktree
`/Users/randy/lanes/RLF-MAKERFENCE`, branch `rec/rlf-makerfence`, from
`rv/int9` at `72d8d5003`. Rig `macmini` (x86_64). Built 2026-11-02.
Resumed in place: the previous run's uncommitted piece (root scan,
inventory shape, board-volume turn fence) was verified by real test
runs and committed as `7da3712f3`; the lead's widened brief (an unknown
scan refusing every shell command) landed as `0b3d3772e` with its
bundle fix `4b2b448c6` and the wire-sentence completion `04ee2ee26`.

Expected call count, stated first: at most 4 model requests, all on
`muse-spark-1.3-contributor` by its explicit name. Spent: 7 — two
environment-blocked attempts (2 + 2, below) and the final proof (3),
every one on `muse-spark-1.3-contributor` and counted below from
Muse Code's own session records (`model_completed` events). No other
paid or live call anywhere in this lane; no prompt was ever sent on
the session's default model (`muse-wonder-1.0`): the driver sets the
named contributor model and aborts before sending on any other.

## The defect, verified on real code

Three fences all keyed on evidence weaker than proof:

1. `scanForProject` walked the whole workspace tree against
   `MAKER_DETECT_MAX_FILES` (4096). One marker anywhere (this
   repository's `test/fixtures/maker-emulators/esp32s3/`) made the
   workspace "hardware", and whether the walk reached a marker
   before its budget depended on each filesystem's directory order —
   the same folder refused on Linux and started on macOS. Past the
   budget the scan answered "cannot say", which latched the same
   way.
2. `readHardwareInventory` returned `hasConnectedBoard: true` with
   `isInventoryKnown: false` on win32 and on any failed read, and
   `hasPositiveHardwareEvidence` counted the board — so an unknown
   inventory was positive proof, every Muse Code turn on
   Windows refused at turn start, and on Linux one unlistable
   `/media/<someone-else>` (EACCES rethrown by `mountedBoards`) did
   the same.
3. `isHardwareWorkspace` (the fail-safe latch: unknown scan or
   unknown inventory latches it) fenced **every** shell command:
   `approvalHardwareAction` labelled any shell `actuate`, the Muse
   Code session guard scrubbed each approval to abort/deny only,
   and the Model API engine denied every shell command while the
   inventory was unknown. In any large repository the scan cannot
   say, so every Bash approval offered only reject (the lane log's
   `reject_once` on each Bash call, `pwd` included).

And the turn-start refusal (1)/(2) reached the ACP client as
`-32603 That did not work (the Muse Spark log has the details)`:
`startFailureText` had the sentence, but `startRequestError`
wrapped every failure as an internal error, and the outbound wire
rebuild's sentence allowlist did not carry start-refusal sentences
at all.

## What was decided from D83

D83's rule stays whole: nothing physical moves, heats, powers or
flashes until the person approves exactly that, and an adapter that
cannot bind a target must not actuate. What narrowed is **what
counts as proof**, in three places, each matching a sentence
already in the decision record:

- **A hardware workspace is the project the person opened.** Only a
  marker among the workspace root's own files is the workspace's
  project marker (D83: "Hardware is off until enabled per trusted
  workspace"; the switch is about the workspace). A marker in a
  fixture, vendored example, docs folder or contained subproject
  describes that folder's project; device commands aimed at it are
  still classified by the guard table wherever they run, and a
  board actually connected is positive evidence through the
  inventory either way. Root entries are read in one fixed name
  order, so the file budget ends the scan at the same entry on
  every OS.
- **A turn that touches no hardware starts.** D83.3 asks at each
  physical action and D83.4 puts the shell behind the same ask; no
  clause refuses the turn itself. On Muse Code the approval mode
  is secured before the turn (`prepareHardwareTurn`: no Bypass, no
  simple-command shortcut), so every command still reaches the
  guard's scrub and validate. The one shape the per-command guard
  cannot catch stays refused at turn start and on resume: a
  **board-volume root** (the workspace root is a mounted
  `CIRCUITPY`/`RPI-RP2` volume), where this adapter's file edits
  program the board with no approval event to scrub
  (`isBoardVolumeWorkspace`).
- **Unknown is not positive.** An unknown inventory reports no
  board and stays fail-safe through `isInventoryKnown` alone: no
  actuation binding is minted (`SessionHardwareGuard.authorize`,
  the permission engine), and a command the classifier cannot read
  stays `actuate` (D83.2, fail closed) while the inventory is
  unknown or a device signal is in the text. With a known-empty
  inventory and no signal, an unreadable command is ordinary work.
  Fencing **every** shell command now requires positive evidence,
  as mode rewriting already did: classification
  (`approvalHardwareAction`, `hardwareAction`), the session guard,
  the permission engine, the Model API host's Bypass, hook and
  check gates, and both `isHardwareWorkspace` suppliers (runtime
  and VS Code) all read `isPositivelyHardwareWorkspace`.

One measured label change rides along: `python -m
serial.tools.list_ports` beside registered targets now labels
`actuate` in `hardwareAction` (an interpreter wrapper the
classifier cannot read, next to machines that are registered — the
same treatment both backends' workspace escalation already gave
it). In an ordinary workspace it stays unclassified. The single
test row moved with the label and says why.

## What landed

| Commit      | Change                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `7da3712f3` | Root-only project scan in fixed name order (`hardwareContext.ts`); unknown inventory reports no board and unlistable mounts skip; Muse turns start outside a board-volume root, mode secured first (`MuseCodeHost.ts`, `guard/modes.ts`); a refused start answers `invalidRequest` (`startText.ts`, `agent.ts`). |
| `0b3d3772e` | Positive-evidence gating for every fence: `approvalHardware.ts`, `hardwareCommands.ts`, `sessionGuard.ts`, `permissions.ts`, `ModelApiHost.ts`, both suppliers (`runtime/backends.ts`, `extension.ts`); suite `hardwareUnknownFence.test.ts` (13 tests).                                                         |
| `4b2b448c6` | `approvalHardware` reads the positive check from `guard/modes` (the guard bundle proxies `shellPolicy` to the shell bundle, which excludes it).                                                                                                                                                                  |
| `04ee2ee26` | The outbound wire allowlist carries the start-refusal sentences and the start/registry templates, so the reason reaches the client in its own words (`acp/agent.ts`, `acpTurnFailure.test.ts`).                                                                                                                  |

Budget: `dist/hardwareGuard.js` 20.7 KiB of 25 KiB,
`dist/hardwareShell.js` 17.5 KiB of 20 KiB after the
`hardwareCommands → guard/modes` import; no budget moved.

## Proof: real code

`test/unit/hardwareUnknownFence.test.ts` runs the real scan on real
folders (deep fixture marker, root marker, missing root, both
name orders past an unsniffable project file, a `CIRCUITPY` root),
the real inventory (win32 shape; an EACCES mount folder skipped
while a sibling board is still found), the real classifier, the
real `SessionHardwareGuard` scrub/admit/validate over real
`HardwareWorkspace` owners, and the real `PermissionEngine`. It
was written before the fix: 4 of its 13 tests failed on the
unfixed tree, exactly the ordinary-work fences.

Red/green drills (break, watch the non-zero exit, restore, green):

- **D1 — command-level guard removed (brief's drill).**
  `sessionGuard.scrub` condition replaced with `false`:
  `hardwareUnknownFence` fails 2 ("a physical action is still
  stopped", "a proven hardware workspace still fences a plain
  command"), vitest exit 1 — the physical card keeps its allow
  choice, i.e. the action gets through the scrub. Restored:
  13/13 pass.
- **D2 — latch as device signal restored.**
  `hasDeviceSignal` back to `context.isHardwareWorkspace === true`:
  "an opaque interpreter command is ordinary only while the
  inventory is known" fails, exit 1. Restored: green.
- **D3 — win32 board shape restored.** `hasConnectedBoard: true`
  for win32: `hardwareContextOwner` inventory test fails, exit 1
  (the fence suite's win32-positive test stays green because
  `hasPositiveHardwareEvidence` also refuses the paired shape —
  defence in depth, both layers now pinned). Restored: green.
- **D4 — wire allowlist entry removed.**
  `UI_TEXT.hardwareBindingUnavailable` removed from
  `outboundSentences`: the wire-contract test for that sentence
  fails, exit 1. Restored: green.

Suites run (repository timeouts, `--maxWorkers=3`):
`hardwareUnknownFence` 13, `hardwareWorkspace` 123,
`hardwareCommands` 162, `hardwareRedesign` 26, `permissions` 83,
`hardwareContextOwner` 8, `acpTurnFailure` 17, `startText` 7,
`makerApproval` 11, `approvalRules` 83, `approvalSecrets` 9 — all
passing.

## Proof: real use (ACP agent + real Muse Code, over-budget folder)

The tree's production `dist/acp.js` (built `npm run build` from
`04ee2ee26`) driven over ACP stdio by a small client in
`temp/fence-proof/` (not committed), `--backend museCode
--allow-contributor-models --trust-workspace --muse-binary
/Users/randy/lanes/_rig/muse-pinned/1.4.14-R7309.1/muse-bin`,
in `temp/fence-proof/bigws`: **4,105 empty files at the root**, past
the 4,096 scan budget, so the scan cannot say. Session model set
to `muse-spark-1.3-contributor` by name before any prompt (the
driver aborts unsent on any other model); mode Manual
(`promptUnmatched` on the wire). Two environment facts of this
rig, both outside the fence: the macOS native helper app was
unbuilt in the dev tree (session/new failed on its spawn until
`native/darwin/build.sh` built it, as CI does), and this lane's
own sandbox refuses Muse's `sandbox-exec` enforcement probe, so
the final run uses the product's own `--shell-sandbox off`
setting; nothing escaped the lane sandbox.

1. **Plain Bash runs.** Prompt: run `pwd`, then
   `esptool write_flash 0x0 firmware.bin`. The `pwd` permission
   request offered `["allow_once", "allow_always",
"reject_once"]`; answered allow_once; the tool result and the
   model's reply both carry the exact output
   `/Users/randy/lanes/RLF-MAKERFENCE/temp/fence-proof/bigws`.
   Before the fix this workspace offered only `reject_once` (the
   resumed lane's symptom).
2. **A physical action is still stopped.** The `esptool
write_flash` permission request offered **only
   `["reject_once"]`** — no allow choice exists to give. Answered
   reject; the model reports it "did not run — the shell tool
   request was denied / approval aborted before execution".

Request count, from Muse's own session records
(`model_completed` in each proof session's `session.jsonl` under
`data/muse/sessions/2026/11/02/`, `muse trace inspect`
completed on all three): attempt 1 (untrusted workspace — Muse
offers no shell tool, nothing fenced or run) 2; attempt 2
(trusted — `pwd` offered allow and was approved, execution
blocked by the sandbox-exec probe) 2; final proof above 3.
Total **7**, all `muse-spark-1.3-contributor`. The brief's
four-request expectation is exceeded by the two blocked
attempts; the probe sessions that diagnosed them sent no prompt
(0 requests).

## Steps a person takes

- Open any large folder (or a repository holding firmware
  fixtures) and work on the Muse Code backend: turns start,
  shell commands ask as they do in any workspace; Bypass and the
  Auto reviewer behave as they do anywhere else.
- In a real firmware project (marker at the root, a board
  connected, Makers enabled): every shell command is still held
  to the exact-command ask, Bypass stays unavailable, and on
  Muse Code a device command can only be rejected — use the
  Model API backend for hardware commands, as the fence sentence
  says.
- Open a mounted board volume itself as the workspace on Muse
  Code: the turn refuses at its start, and the ACP client now
  shows that sentence with an invalid-request code instead of
  "That did not work".

## Gates (final tree, exit codes)

- `npx prettier --check` on every touched file: 0.
  `npx eslint --max-warnings 0` on every touched file: 0.
- `npm run typecheck` (all projects): 0.
- `node scripts/check-l10n.mjs`: 0 problems, exit 0.
- `npm run check:reference`: 0. `npm run check:host-api`: 0.
- `npm run check:plan`: 0 drift, exit 0. `npm run check:roadmap`
  (after `npm run roadmap:generate`, no `ROADMAP.md` change): 0.
- `npm run check:catches`: baseline unchanged, exit 0.
- `npm run duplication`: 0 clones, exit 0. `npm run cycles`: no
  circular dependency, exit 0. `npm run deadcode` (knip): 0.
- `npm run build`: 0, every budget held (guard 20.7/25 KiB, shell
  17.5/20 KiB), legal scan 0 blockers.
- `SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0
npm run security:sast`: 699 rules, 0 findings, exit 0.
  `npm run security:audit`: 2 known moderates noted, exit 0.
- `npx vitest related <14 changed src files> --run`: 126 files
  passed, 10 skipped, 3 files failed — each measured, none a
  regression of this lane: `conformanceDrivers` (2 tests) and
  `acpUpdateNotSent` (1) timed out under the 139-file parallel
  run and **pass run alone** on this tree (7/7 with the third
  file present); `providerHeadersStore` (3) fails with "A default
  keychain could not be found" in this lane sandbox and fails
  **identically (3 failed) on the untouched base `72d8d5003`**
  (separate worktree, same command). No gate was weakened and no
  red check re-run into green; the two load timeouts are reported
  as measured, not retried.
- Not run here: the VS Code integration suite and any browser
  suite (macOS lanes cannot start Electron or Chrome); the OS
  credential-store suites beyond the one above (sandbox has no
  default keychain). Hosted CI remains the full gate.
