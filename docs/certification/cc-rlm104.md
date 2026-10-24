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
area's files 0. knip at this commit lists `panelEventId` and three
presentation types, which areas 2 and 3 read.
