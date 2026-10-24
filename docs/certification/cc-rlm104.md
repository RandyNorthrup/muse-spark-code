# cc/rlm104 — re-landing M104 (RLM104) onto int/recovery

Claude Code lane. Base: int/recovery `fcbd0e3f1f`. Source: RLM104's branch
`refs/rigs/linuxlt/rec/rlm104` at `4ecbbd9cc5` (about 266 commits over main
`f3941b8548`; its own record is `m104-rlm104.md` on that branch). The
integrator could not merge it: its Tab extraction parallels RLF-TAB's, its
ACP turns through `conversation.submit` bypass RLACP's slash handling,
resource sessions, outbound error allow-list and accounting, and its move of
49 files into `src/host/vscode/` comes with a rule that six int files break.
This lane ports M104's behaviour area by area onto int's current code,
commits each area when its suites are green, and keeps this record.

Environment: Windows 11 workstation, Node 24.20.0, JDK 21, .NET 10; no
Maven, Neovim or Emacs. Vitest runs with `TMP`/`TEMP` under the worktree's
`temp/tmp` and `GIT_CEILING_DIRECTORIES` at the worktree's `temp/`. No push,
rebase, paid call, live model call or credential-store suite.

## Decision renumbering

| RLM104 | Here | Why                                                                                                                                                                |
| ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D212   | D226 | int holds D212 (secondary roles) and D213–D217; cc-rlm116 renumbers D212–D215 on another branch, so the next free number above D225 is used. References follow it. |

D226's full text (RLM104's D212): MHP adopts one protocol version across
every native host, the current `MHP.version` (`mhp/1.5.0`, wire `1.5`, range
`mhp/1.5.0` to exclusive `mhp/1.6.0`). A native host negotiates that version
or refuses with `MHP_INCOMPATIBLE_VERSION`; no host keeps a negotiation
route, wire tag, schema or test for an older version. The Visual Studio lane
F2 arrived holding the v1.1 frozen contract; RLM104 moved it to 1.5.0.
Eclipse and JetBrains already refuse older versions. The
`mhp-v1.schema.json` and `mhp-v1.1.schema.json` filenames and their locks
stay as native build inputs, but both advertise 1.5.0: the v1 file carries
methods and failures, the v1.1 file adds panels. A future revision bumps
`MHP.version` and `MHP.minimumVersion` and regenerates every schema, lock
and host together.

## Int's own red gates at the base

Measured on `fcbd0e3f1f` before any port, so later numbers compare against
these rather than against zero:

- `check:host-api`: red on int (modelsPanelEntry.ts gained
  `QuickPickOptions.ignoreFocusOut`); regenerated in `304c6b6e0a`.
- `check:catches`: red on int against `scripts/catch-baseline.json` (core
  CLEANUP 240, host SWALLOW 19 / GENERIC 98, runtime SWALLOW 34 /
  GENERIC 192 / CLEANUP 133, webview SWALLOW 11). This lane adds no SWALLOW
  or GENERIC site; the counts below are compared with these.
- `duplication` (jscpd, threshold 0): 41 clones on int, none in a file this
  lane touches; this lane adds none.

## Area 1 — the MHP contract (lane 0, D226)

Ported: `src/shared/hostApi/{capabilities,data,features,framing,methods,panel,panelError,protocol}.ts`,
the two schema snapshots and locks, `src/shared/presentationProtocol.ts`,
the `MHP`, `MHP_ERROR_CODES`, `MHP_PRESENTATION` and `MHP_PANEL` constants,
the exported webview and What's New message schemas the panel envelope
reuses, `scripts/mhp-schema.mjs`, `scripts/mhp-errors.mjs` and the two
generated JVM error tables it writes, `test/unit/mhpContract.test.ts`,
`test/unit/mhpPanelContract.test.ts` and the panel guide. `fallbackUi.ts`
and `portableAssets.ts` move with their first readers (the portable webview
and the runtime panel).

Changed on the way in:

- The v1.1 (panel) lock is re-frozen at the same unreleased `mhp/1.5.0`:
  its envelope embeds the panel payload schemas, and int's webview protocol
  carries messages RLM104's base did not (`retryTurn`, `previewFeedback`,
  `submitFeedback`, `bookmarkSet`, the saved-sequence family and more). The
  regenerated snapshot's diff was reviewed: every change is an int webview
  message. RLM104 did the same at its own join (`9ecf6e3348`). The v1 lock
  is unchanged.
- Two bare catches became NARROW (a malformed `github/request` URL is a
  `TypeError`; an unserializable panel envelope is a `TypeError`), so the
  contract adds no GENERIC site.
- `npm run check:mhp` exists now (the README named it; the branch never
  defined it) and runs in `quality:gates`.

Drills (break, exit non-zero, restore byte-exact by blob hash, green):

| Gate        | Break                                                | Result                           |
| ----------- | ---------------------------------------------------- | -------------------------------- |
| `check:mhp` | `PARSE_ERROR = -32701` in the generated Kotlin table | `MHP_ERROR_TABLE_DRIFT`, exit 1  |
| `check:mhp` | one hex digit of the v1.1 lock digest                | `MHP_VERSION_LOCK: v1.1`, exit 1 |

Suites: `mhpContract` + `mhpPanelContract` 60/60. `check:mhp` 0,
`check:plan` 0, host and unit typecheck 0, eslint and prettier on the
area's files 0. knip at this commit listed `panelEventId` and three
presentation types, read only by lanes this record leaves as remainder;
the follow-up below removes them.

### Area 1 follow-up — no growth in `dist/wire.js`, no dead export

Measured against a production build of int's base (`git archive` of
`fcbd0e3f1f` into the worktree's `temp/base`, `node_modules` joined):
exporting the two raw message schemas from `protocol.ts` grew
`dist/wire.js` from 81,096 to 81,218 bytes. That bundle is already over its
75 KiB budget on int (79.2 KiB); RLM104 raised the budget to 87 KiB, which
this lane may not do. Every lazy Node bundle that imports `protocol.ts`
resolves it to `dist/wire.js` (`sharedWire`), so leaving a name out of
`wire.js` would read as `undefined` there. `wireEntry.ts` now shares
`protocol.ts` by name, everything but the two schemas no Node bundle reads
yet, and `test/unit/wireEntry.test.ts` pins that list against
`protocol.ts`'s real exports (every shared name is the same value; only the
two panel schemas are absent), so the lane that first reads them in Node
meets the budget decision instead of a silent `undefined`. `dist/wire.js`
is byte-identical to int's again (81,096). `panelEventId` and the three
presentation type aliases are removed until their readers land; knip is
green as on int.

| Gate / suite        | Break                                | Result                                             |
| ------------------- | ------------------------------------ | -------------------------------------------------- |
| `wireEntry.test.ts` | `HOST_ACTIONS` dropped from the list | 1 failed (`HOST_ACTIONS` reported missing), exit 1 |

## Area 2 — the VS Code boundary (lane A's move and rule)

Ported: RLM104's move of every module that imports `vscode` into
`src/host/vscode/`, and its `check:host-api` rule that refuses a `vscode`
import (type-only included) anywhere else but `src/extension.ts`. Done on
int's tree, not RLM104's list: int has 56 such modules. RLM104 moved 49;
`voice/dictationHost.ts` no longer imports `vscode` on int and stays; the
seven int modules RLM104 never saw move too (`judgeSetup/judgeSetupPanel`,
`models/lmProvider`, `models/lmProviderBundle`, `tab/tabStatusItem`,
`views/auxWebviewPanel`, `views/devicesPanelTab`, `codeIntel/languageServices`).
RLF-TAB's `tab/tabEligibility.ts` does not move: its one `vscode`-typed
helper (`tabTextChangeEvent`, a projection only the provider calls) moves
into `vscode/tab/tabProvider.ts`, so RLF-TAB's eligibility, ignore and
consent modules stay outside the VS Code tree, as their own header
("Pure: no `vscode` import") already said, for the runtime's Tab later.

55 files moved with `git mv`; every relative import in `src`, `test` and
`scripts` was resolved against the old layout and rewritten for the new
one; live path strings (build entries, `check-bundle-split`, deferred
bundles, cycles roots, knip, the catch baseline's file keys, tests and two
harness builds) follow; the generated host-API record is regenerated; the
lazy registry's 11 rows whose importers moved are set to exactly what the
build gives (the generator refuses to write while int's own
`NODE_WORKSPACE_ASSET` packaging problem stands, so only those rows were
touched). Historical records (`docs/certification`, `docs/plan-archive`)
keep their old paths byte for byte. AGENTS.md's layout names the boundary.

Not ported from lane A: `src/host/vscode/hostServices.ts` and
`src/host/compose/conversationDeps.ts`. They rewrite about 800 lines of
`extension.ts` so the conversation controller's editor services go
through MHP `HostServices`; that is the in-process half of the runtime
panel lane (remainder below), not a move.

| Gate / suite     | Break                                                                                                | Result                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `check:host-api` | `import type { TextDocumentChangeEvent } from 'vscode'` put back in `src/host/tab/tabEligibility.ts` | `vscode imports belong in src/host/vscode/ or src/extension.ts`, exit 1 |

Proof on the moved tree (compared with a production build and the same
gates on int's base, `fcbd0e3f1f`):

- All six typecheck projects 0; eslint 0 on the 113 changed files;
  `format:check` 0 on the whole repository; knip 0; cycles 0;
  `check:host-api` 0 (56 files import `vscode`, all under the boundary).
- `npm run build`: every bundle-size line identical to int's base,
  `dist/wire.js` byte-identical (81,096). Int's own 12 over-budget bundles
  (`modelApi.js`, `modelsPanel.js`, `uiText.js`, `wire.js` and eight more)
  stop it at the size gate on both trees; the later stages, run directly,
  match the base: bundle split shows only int's 11 problems (cc/mcp2's
  three MCP files, cc/rlm95c's `requestHeaders.ts`), the lazy registry only
  int's 7, host globals and notices 0.
- `check:catches` per-area counts identical to the base; jscpd 41 clones on
  both, none in a moved file.
- Unit suites over the moved modules and paths, each in its own process:
  `estimatorSurfaces` 738/738, `tabEligibility` 25, `tabStatusModel` 15,
  `tabActivation` 6, `lazyBundleFiles` 16, `vaultPanelBuild` 4,
  `conversationGitBundle` 3, `modelsImportText` 4, `usageTableFallback` 2,
  `subscriptionCopilot` 2, `nodeBundle` 5, `teamChunkPackaging` 5,
  `teamStartup` 5, `teamWorkerCreateBundle` 1, `acpTeamPackage` 2,
  `ciReference` 1, `cliReference` 2, `paidConsentBundle` 1, `wireEntry` 2,
  `mhpContract` 34, `mhpPanelContract` 26: all green. `manifest` (3) and
  `pathGuardSpawns` (2) fail identically on int's base (walkthrough steps,
  notices without a packaged build, release pins; the M110 spawn sites).
  `judgeP2Delivery` reruns the real split gate in every case (about 29 s
  each here) and needs longer than this lane's 900 s per-file deadline;
  in a 400 s verbose run 42 cases passed and its one failure is int's own
  split drift above.
- Integration suites (`test/integration`, run inside VS Code) typecheck;
  they were not run on this PC.

## Dropped as duplicates of int

- RLM104's Tab extraction (`src/core/tab/tabEligibility.ts`, its rewrite of
  `tabProvider.ts`/`tabBundle.ts`, the deletion of `tabIgnore.ts`):
  RLF-TAB's `host/tab/{tabEligibility,tabIgnore,tabConsent,tabYield,…}.ts`
  is int's single copy. Area 2 made it reachable from portable code
  instead of adding a second one.
- `src/webview/portableTokens.css` (M104D's hand-written `--ms-*` palettes
  and `--vscode-*` aliases for native pages): int's M114 tokens
  (`design/tokens/**`, generated `tokens.css`/`host-roles.css`) and the
  companion/native theme consumer (`src/webview/bridges/theme/**`,
  `loadThemeBridge`) already own exactly this, under the rule that raw
  paint lives only in generated token files.
- `paidGrants.ts`'s per-workspace revocation lane and
  `PaidOwnerReplacedError`: int's `PaidUseConsent` already refuses an
  answer whose question was revoked (`isAnswerCurrent`, revocation
  counters); the panel lane binds to that instead.

## Remaining, with the int-specific design each lane needs

Every lane below was read against int's code, not only RLM104's; each
needs design against what int already has, which is why none is a port.

1. **Runtime panel (lane B: `panel --stdio|--companion`, controller
   registry, settings and storage store, `src/runtime/features/**`,
   `src/runtime/panel/**`, `host/compose`, `host/vscode/hostServices.ts`).**
   About 110 new files; three-way application of its 60 modified files
   conflicts in 16 (`paidConsent`, `paidFeatures`, `resourceGovernorEntry`,
   `mcpJobLaunch`, `modelApiBackendManager`, `conversationController`,
   `judgeBundle`/`judgeEntry`/`judgeUsage`, `runtime/backends`, `cliHelp`,
   `cliOptions`, `companion/page`, `exec/runExec`, `runtime/main`,
   `cliCommands`). Paid use must compose int's `PaidUseConsent` (D48,
   D208: no spending check without a limit the person set) the way
   `src/acp/paid.ts`'s `AcpPaidUse` does, not RLM104's pre-D208 path.
   Its suites must use the real composition: no stand-in store, runtime
   or transport. Owns the four exports area 1 removed (`panelEventId`,
   the presentation types) and `fallbackUi.ts`/`portableAssets.ts`.
2. **ACP on the controller.** Kept int's turn path: RLACP's slash
   handling, resource sessions, outbound error allow-list and
   `acpAccounting` stay exactly as merged; RLM104's
   `createConversation`/`AcpConversation`/`acpComposition.ts` and its
   `this.conversation.submit(...)` turn are not brought in. M104's need
   (the same session visible in every editor's panel) binds when lane B
   lands: the panel's registry observes ACP sessions and their events
   rather than taking over their turns.
3. **Portable webview (lane D).** Bridges, fallbacks, presentation pages
   and `chat.tsx`/`selectionQuote.ts` extractions are reviewed and ready
   to port, with two changes: theme through M114's `loadThemeBridge`
   (a `ThemePort` fed by MHP `theme` frames, mapping the hosts' `--muse-*`
   tokens onto `consumers.json` host roles) instead of
   `portableTokens.css`; and the startup measurement, which RLM104 runs in
   headless Chrome over hand-written native and companion transports
   (`portableStartup.mjs`, `portableBridgeSetup.mjs`), measured instead
   through the real carrier serving the page (or the static closure
   accounting int uses for VS Code). `HOST_ACTIONS`' three new actions need
   VS Code handlers and re-freeze the panel lock.
4. **Companion MHP routes (lane C):** `/panel/message`, `/panel/events`,
   `/host/events`, `/host/message` over int's companion server (whose page
   gained 112 lines on int); depends on lane B's delivery and surfaces.
5. **`lsp`, `supervise`, `stop` (lane H, TypeScript side).** Tab in the
   language server must compose int's keyed consent (`createTabConsent`
   over `PaidUseConsent.askScope`, one key per model and price, D73), the
   person's `tabMaxOutputTokens` or the record maximum
   (`tabRequestMaxOutputTokens` with `recordMaxOutputTokens`; RLM104 used
   the removed `TAB_FAST_MAX_OUTPUT_TOKENS` constants) and the workspace's
   Tab hooks: RLM104's `tabServe.ts` ran none, so a configured
   `beforeTabFileRead` would be bypassed in every LSP editor. Eligibility
   and ignore come from RLF-TAB's modules (portable after area 2). The
   process authority and supervisor need `privateDirectory.ts` (+311),
   `mcpJobLaunch`'s registered/independent launches with the Windows
   helpers (`MuseSparkJob.cs` +177, `MuseSparkMcpJob.cs`,
   `MuseSparkMcpLauncher.cs`) and `Dictation.swift`'s StrictModes walk
   (+152); all applied here (one `mcpJobLaunch` hunk, beside int's
   stale-helper retirement, merged by hand) and were backed out with the
   lane.
   Its suites use `fakeLsp.ts` and a stand-in credential store
   (`runtimeLspParent.ts`): rebuild on the real composition, with no store
   read unless `--tab` is given.
6. **Native hosts (lanes E, F, G, H native code):** `hosts/{jetbrains,
visualstudio,eclipse,xcode,zed,neovim,emacs,sublime,qtcreator}`, about
   25,000 lines; only the two generated error tables landed (area 1).
   Their suites drive hand-written runtimes (`test/fixtures/*runtime*.py`,
   `Test/fake-runtime.mjs`, `test/hosts/xcode/fake-runtime.ts`); under
   int's no-fakes rule they run against the real `panel --stdio` once
   lane B lands. This PC has JDK 21 and .NET 10 for the JetBrains and
   Visual Studio builds; no Maven, Neovim or Emacs.
7. **Distribution (lane I):** `scripts/package-hosts/**`,
   `.github/workflows/hosts-native.yml`, the release workflow's native
   jobs and pins; after the hosts.
8. **Docs (lane J) and text:** README "Every editor", `docs/acp.md`,
   `docs/ide-compatibility/**`, CHANGELOG, and the `xcode*`, `lsp*`,
   `fallback*`, `presentation*` and `panel` CLI keys in all 15 tables:
   each lands with the code it describes and after real use.
9. **PLAN.md:** 434 bytes remain under `check:plan`'s bound. RLM104's M104
   §6/§7/§8 additions and D6 budget rows for the new bundles
   (`runtimePanel.js`, `runtimePanelPorts.js`, `lsp.js`,
   `runtimeWatchdog.js`, `runtimeProcessAuthority.js`, `hostProtocol.js`,
   the portable graph) need a `plan:archive` pass first.

No CHANGELOG entry: nothing here changes what a person sees (a contract
with no carrier yet, a gate, and a file move with every bundle unchanged).

## Commits

| Commit       | Area                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `304c6b6e0a` | int's own host-API record drift, regenerated before any port         |
| `c08ed1b8da` | area 1: the MHP 1.5 contract, D226, `check:mhp`                      |
| `3281752fe6` | area 1 follow-up: `dist/wire.js` unchanged, no export without reader |
| `235e0c0116` | area 2: lane A's `src/host/vscode/` boundary and rule                |

Every commit ran the repository hooks (lint-staged's eslint and prettier,
gitleaks); none was skipped.

## Final gates on this lane's tree

| Gate                                                             | Exit | Against int's base                                                                                          |
| ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `format:check` (prettier)                                        | 0    | 0                                                                                                           |
| `lint` (eslint, stylelint, PS)                                   | 0    | 0                                                                                                           |
| `typecheck` (all six)                                            | 0    | 0                                                                                                           |
| `check:plan`                                                     | 0    | 0 (434 bytes of headroom left)                                                                              |
| `check:mhp`                                                      | 0    | new                                                                                                         |
| `check:host-api`                                                 | 0    | 1 on int (`304c6b6e0a` fixed its drift)                                                                     |
| `deadcode` (knip)                                                | 0    | 0                                                                                                           |
| `cycles`                                                         | 0    | 0                                                                                                           |
| `check:reference`, `check:l10n`, `check:roadmap`, `check:tokens` | 0    | 0                                                                                                           |
| `check:catches`                                                  | 1    | 1, per-area counts identical: this lane adds no SWALLOW, GENERIC or CLEANUP site (two new sites are NARROW) |
| `duplication` (jscpd)                                            | 1    | 1, 41 clones on both, none in a file this lane touched                                                      |
| `build`                                                          | 1    | 1: every size line identical, the same 12 over-budget bundles (int's own)                                   |

Size lines for the bundles this lane touched, identical to int's base:
`dist/wire.js` 79.2 KiB (81,096 bytes; over its 75 KiB budget on int
already), `dist/extension.js` 516.8 KiB, `dist/tab.js` 63.6 KiB,
`dist/prompts.js` 165.6 KiB, `dist/usagePanel.js` 60.4 KiB,
`dist/mediaHost.js` 14.2 KiB, `dist/vault.js` 44.9 KiB, `dist/modelsPanel.js`
160.0 KiB (over its 150 KiB budget on int already). No budget was raised.
