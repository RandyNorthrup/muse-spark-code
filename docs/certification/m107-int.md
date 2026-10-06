# M107INT round 3 — T2, U and H integration

Windows 11 rig, `C:/lanes/M107INT`, branch `m107/int`, starting
`267b04dc2`. The round-3 rig brief explicitly authorizes only the three
listed no-fast-forward merges and scoped checks; no full quality, push,
rebase, stash, disk-space implementation, paid/live model call, credential
read or dependency installation. Existing hooks remain enabled and unchanged.
Model attempts: **0**.

## T2 join

Merge `b96676eb` joins `m107/t2` (`c0f188f28`). Additive CHANGELOG and PLAN conflicts retain
both records. The Windows helper retains C1's holder and A's controls next
to T2's same-handle member signals. Linux retains POSIX path semantics and
C1's direct-child identity proof, now refusing exited roots, with T2's fresh
ancestry/enrollment proof. The registry adopts T2's detailed tree-stop API;
C1's lease maps only its admitted `done` result to forced dispatch. The old
registry whole-job boolean stop is removed. Its existing epoch regression
now exercises retirement during action enumeration.

Complete T2 suites, direct Windows commands with at most three files and
`--maxWorkers=3 --testTimeout=120000`:

- `treesWindows`, `treesActions`, `jobSource`: **26 passed**; native Windows
  registered stop and forged-birth refusal pass.
- `treesLifecycle`, `treesPosix`, `treesLifecycleNative`: **53 passed,
  4 existing native-platform skips**.
- `trees`, `treesMacNative`, `resourcesContracts`: **28 passed,
  3 existing Darwin-platform skips**.

Typecheck initially caught a widened test-only signal result and readonly
deferred-array mismatch in the adapted regression. Explicit return typing
and the fixture's actual mutable snapshot type correct both without a cast
or gate change. Final joined checks, shutdown audit, U/H receipts and sizes
are recorded below as completed.

## U join

Clean merge `682a9784` joins `m107/u` (`c0d142350`). All five TypeScript
projects pass. The complete `resourceStatus`, `resourceStatusPortable` and
`ResourceSurface` files pass **24/24**. The App and harness regression batch
and final browser acceptance are recorded with the final scoped checks.
The merge retains U's injected lazy App port and named W/M104/M96c/J
delivery bindings; no startup import, guessed MHP shape or cap increase.

## H join

Merge `fa759459` joins `m107/h` (`3885f037b`), retaining all three additive PLAN conflicts
in M107, gates and residual risks. Add H's supplied Unreleased repair note.
All five TypeScript projects pass. Complete `runtimeResources`,
`acpResources`, `execResources`: **34 passed**; `acpAgent`, `execRun`,
`acpRuntime`: **185 passed**; `execArgs`, `execOutput`, `execSchema`:
**101 passed**. H's prototype-store and repeated-pause review regressions
pass unchanged. The frozen v1 result and existing schemas remain intact.

U's App, AppLazy and harness-entry batch also passes **155/155**. Its
existing jsdom canvas diagnostics are unchanged; the real browser result
is recorded separately below.

## Registered shutdown audit and repairs

Raw-call inventory: ignored `temp/m107-int-kill-audit.txt`, generated with
`rg` over `src` and the Windows native sources. **No remaining direct
signal/kill path reaches a governed payload without its registered lease.**

| Path                                    | Registered route                                                       | Raw calls retained only for                                                          |
| --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Shells, hooks, short CLI                | `runCommand` → `killTree(resource)` → registry                         | Unconfigured legacy embeddings                                                       |
| MCP explicit Stop and root-exit cleanup | `observeMcpProcess(resource)` → registry                               | Unconfigured legacy containment; the raw Node handle adapter                         |
| MCP launcher control failure            | `spawnMcpJob` → registered stop                                        | Unconfigured launchers                                                               |
| Browser, including missing-pipe cleanup | `killBrowser` → registered stop                                        | Unconfigured legacy browser containment                                              |
| Git abort/timeout                       | registered stop; refusal rejects without waiting for a still-live root | Unconfigured embeddings                                                              |
| Voice/recorder                          | admitted process's registered stop; refusal reaches the driver         | Unconfigured embeddings; higher-level driver `kill` methods delegate to this adapter |
| Plugin POSIX and native job             | exact returned handle's lease retained in a WeakMap → registry         | Unconfigured embeddings                                                              |
| SDK owner stop                          | C1 lease → T2 detailed registered tree kill                            | The SDK's own launcher/lifecycle remains its existing dependency boundary            |

Remaining raw _infrastructure_ calls are the excluded Windows job holder's
failed-start cleanup and the runtime's own shutdown watchdog. Signal-zero
liveness probes remain in window presence, browser-store ownership and
Linux group retirement. T2's POSIX mutation primitive is the single
birth-verified raw payload signal; its native Windows counterpart proves
creation, live state and job membership through the retained process handle.
The legacy native `Terminate` function is reachable only from the
unconfigured branch of `killTree`. Native owner-death/kill-on-close cleanup
remains the containment contract. The superseded C1 `TerminateVerified`
method and reader-level boolean whole-job kill are removed.

Registered refusal cannot release occupancy or fall back to a bare kill.
Shell and Git failure paths settle explicitly; MCP framing-fault cleanup
handles a rejected stop without an unhandled promise or private error text.
Normal permits still retire only on the existing positive whole-tree proof.
The SDK's internal shutdown implementation was inspected at the installed
1.3.0 pin; no SDK or dependency file changed. Native Linux/Darwin combined
launch qualification remains the existing W/lead handoff, not a Win11 claim.
Specifically, the SDK's private transport still escalates its owned POSIX
group with `process.kill` and its Windows launcher with the child handle
after its own deadline. Its public spawn API has no signal/stop callback.
This dependency/containment path is not certified as a registered member
action; replacing or changing the SDK transport is a named W/lead handoff.
The zero remaining direct governed-payload paths above is a trunk-source
audit result, not a claim that the SDK contains no private raw signals.

Before repair, complete `processTree`/`mcpProcess` files: **3 failed,
41 passed**. The new regressions show root-exit no-op and missing MCP
lease routing. Before the lazy runtime export join, complete
`deferredBundles`: **1 failed, 27 passed**, at the missing `createResources`
export. The stronger final split inventory additionally checks that runtime
entry/host/settings occur only in `dist/resourceGovernor.js`.

The native short-CLI fixture initially retained the old fake lease with no
stop port, so the new fail-closed behavior kept its process alive and folder
removal failed with EBUSY; fixture cleanup also hit the unchanged hook bound.
Bind that fixture to the real registered API and retain verified cleanup in
finally. Complete Windows launch/shell/helper rerun: **24 passed**. SDK's
unknown-stop fixture now refuses T2's `signal`, preserving the real current
API rather than spying on the removed method. No timeout or test predicate
was changed.

## Guard-fire records

Each complete owning file ran with `--maxWorkers=3 --testTimeout=120000`.
Each mutation exited 1 and restored its saved source buffer byte-exact in
finally, with SHA-256 equality. No focused test filter, skip, suppression,
gate, threshold or timeout change. Driver, full red logs, JSON test reports
and hashes: ignored `temp/m107-int-drills.mjs`, `m107-int-drills.json`,
`m107-int-red-*.log/.json`.

| Mutation                    | Complete owning file | Observed failure                                                                                               |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| tree-stop-authority         | `processTree`        | Root-exit stop/refusal regression                                                                              |
| tree-exit-authority         | `processTree`        | Root-exit stop/refusal regression                                                                              |
| stop-refusal                | `resourceStops`      | Browser, Git, voice and both plugin refusal regressions                                                        |
| stop-gone-proof             | `processTree`        | Positive retirement proof is required                                                                          |
| mcp-exit-authority          | `mcpProcess`         | Both root-exit lease regressions                                                                               |
| mcp-stop-authority          | `mcpProcess`         | Explicit registered Stop cannot signal its launcher                                                            |
| browser-stop-authority      | `resourceStops`      | Both browser admitted/refused cases                                                                            |
| git-stop-authority          | `resourceStops`      | Refused Git stop cannot use a raw child kill                                                                   |
| voice-stop-authority        | `resourceStops`      | Refused voice stop reaches the driver                                                                          |
| plugin-posix-stop-authority | `resourceStops`      | POSIX plugin refusal                                                                                           |
| plugin-job-stop-authority   | `resourceStops`      | Native-job plugin refusal                                                                                      |
| mcp-stop-rejection          | `mcpStdio`           | Framing-fault refusal must be handled and logged without the private canary                                    |
| runtime-factory-export      | `deferredBundles`    | Split inventory rejects absent runtime entry/host/settings before the factory assertion                        |
| private-cli-storage         | `execResources`      | A misrouted LOCALAPPDATA, still inside the private temporary fixture, fails the expected resume-file assertion |

**14 distinct red/restored mutations.** The runtime-export driver originally
classified only failing assertions; the stronger beforeAll split check fires
first on final source. Its exit-1 suite failure is retained and rerun with
suite-failure accounting; this is not a passing/survived mutation. All
restored complete files pass, including the actual runtime factory load.

H's original terminal fixture set only XDG_DATA_HOME. On Windows that did
not isolate LOCALAPPDATA, so earlier owning runs could write the numeric
resume marker under the rig's default agent-data folder. The fixture now
sets LOCALAPPDATA, USERPROFILE, HOME and XDG_DATA_HOME to its private
temporary folder and checks the expected platform storage path. No outside
profile marker was read or removed because its prior state is unknown.
The guard drill redirects only into another private fixture subfolder.
Restored complete runtime/ACP/exec resource files: **34 passed**.

The shared lazy artifact exports both window `resourceGovernorHost` and
runtime `createResources`, installs the runtime caller's language, and
requires the shared English/validation cohort. ACP packaging includes both
resource artifacts. No resource policy or sampler is added to activation.
The base still lacks the feature catalog/reference generator; W retains
that named final-delivery handoff instead of inventing a new catalog here.

## Final scoped suites and browser acceptance

The final serial trunk run covers **54 complete files: 1,567 passed,
0 failed, 22 existing platform skips**. Each invocation names at most three
files, uses three workers and the unchanged 120-second test bound. It covers
samplers, tree authority/lifecycle, governor/queue/launch host, all actuator
platform files, native shell and launcher contracts, adapters and real lazy
factories, command admission/Stop, MCP/checkpoint boundaries, plugin
containment, backend owners, best-of-N, schedules, request goldens, browser,
Git, voice/recorder and checkpoints. The final request-golden batch passes
all 134 assertions with the MuseCodeHost and accountHost files. The separate
U owning/App batches (179 passes), H ACP/exec compatibility batches (286
passes), and T2 owning batches are recorded above; repeated overlapping
files are not added into the trunk total.

`node test/harness/resources-check.mjs` exits 0 on Win11: **48 scenes**,
four themes, 690/320 widths, panel normal/throttle/relocate/pause, companion
and Traffic. Every scene has zero browser errors, axe violations/incomplete
findings and horizontal overflow. Traffic action dispatch, resume/settings,
keyboard focus/dismissal and reduced motion assertions pass. The harness
remains fake-only. Screenshots and full results stay under
`temp/m107-u/harness/`; compact final test, drill and browser receipts are
tracked in `docs/certification/m107-int-receipts.json`.

The existing zero-duplication gate fired on five new repeated blocks (47
lines): the two plugin lease branches and mock MCP/lease setup. A local
plugin stop function and shared test-only lease fixture remove them without
changing guards or assertions. `npx.cmd jscpd` then reports zero clones.
The affected complete stop files pass **51/51** after factoring; all eleven
affected red drills fire again and restore byte-exact, including both
plugin adapter branches. Complete plugin/containment/adapters: **57 passed,
14 existing platform skips**, including native Windows timeout, detached
grandchild and memory-bound checks. Final compact receipts retain these new hashes.

## Static checks, production artifacts and packaging

All five TypeScript projects pass after the duplication factoring. The
full merged/new JS/TS union passes ESLint with zero warnings; the full
merged/new supported-file union passes Prettier. Styles pass Stylelint.
Localization: 14 tables, 164 manifest strings, 634 source files,
**0 problems**. `npm.cmd run cycles`, plain `npm.cmd run deadcode` and
`npx.cmd jscpd` exit 0. Knip retains its two existing configuration hints;
no ignore changed. Only its filesystem cache is disabled to keep the
shared node_modules install read-only. `node scripts/exec-schema.mjs
--check` confirms the unchanged frozen v1 schemas.

`npm.cmd run check:host-api -- --write` regenerates the record, and the
subsequent check exits 0: 336 VS Code APIs, 32 importing files, 26 Node
built-ins, 61 theme variables. Reviewed additions are U's resource status
adapter: StatusBarAlignment/Left, StatusBarItem.name, window and existing
status-item/ThemeColor APIs' new caller. fs/promises/path counts grow for
the portable runtime files. The portable `vscode` boundary check remains
green; no new API is hidden or suppressed.

`npm.cmd run build` exits 0, including every existing cap, bundle-split,
host-global and notices check. No budget or gate changed. Main measurements:

| Artifact                                 |   KiB |                                       Existing cap KiB |
| ---------------------------------------- | ----: | -----------------------------------------------------: |
| extension                                | 446.2 |                                                    600 |
| Model API                                | 449.4 |                                                    475 |
| resourceGovernor (lazy, both factories)  |  61.0 | W's final new-bundle budget remains a delivery handoff |
| resourceAdmission (shared shim)          |   1.5 |                               No existing separate cap |
| ACP                                      | 837.9 |                                                    850 |
| Webview startup including static imports | 894.8 |                                                    900 |
| Webview deferred JS                      |  49.7 |                                                     50 |
| agentImport                              | 123.5 |                                                    125 |
| planMarkdown                             | 144.1 |                                                    150 |
| checkpointStore                          |  77.3 |                                                    225 |

The split checks prove the governor policy, sampler, registry and runtime
entry/host/settings stay in their lazy artifact, and that Node bundles use
the shared English/validation cohorts. The existing deferred JS and ACP
margins are small; these measurements do not authorize future cap changes.

After verifying the resolved stage is an ordinary directory inside this
worktree's dist, `node scripts/package-acp.mjs` succeeds. The private local
0.14.0 tarball contains 39 files, including resourceAdmission.js and
resourceGovernor.js. No publish or installation. Production `dist/acp.js`
and the actual extracted tarball both pass `resources status --json`,
`resources resume --json` and `--help`; JSON is parsed by the shared resource
schema. Their entire data/home/temp environment is private to the worktree,
with no credential variables, model or key-store access. The expected
`resources history --json` response is explicit unavailable, exit 1 and
empty stdout. Resume files are checked only in the private folder. The
first scratch smoke attempt stopped before CLI execution because esbuild
preserved entry subdirectories; explicit entry filenames correct the
scratch harness, and both actual artifacts pass.

Detailed final command receipts remain in `temp/m107-int-gate-*.log`,
`m107-int-gates.json`, `m107-int-cli-smoke.json` and the production metadata.
No full quality, full unit/coverage, external network, live/paid call,
credential read, dependency install or disk-lane implementation ran.
