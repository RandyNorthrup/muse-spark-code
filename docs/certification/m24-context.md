# M24 certification (context rows) — rules and skills encodings, diagnostics, quoted mentions, the first folder as the root (PLAN.md D27)

Recorded 2026-09-23 on Windows 11 (Node 24.20.0). Four rows of section D of
the deep-scan audit (D24), built on `hardening/m24-context` beside the
editing rows, which another branch builds in `tools.ts`, `patchApply.ts`,
`editReview.ts`, `toolIo.ts`, `searchWorker.ts` and the Revert code of
`extension.ts`; none of those files is touched here. No live model call:
every fact below comes from the code, VS Code's own source (fetched
2026-09-23) and the tests.

## Gate results

| Gate              | Result                                                            |
| ----------------- | ----------------------------------------------------------------- |
| `npm run quality` | green; tail in the branch's report (`scratchpad/quality-m24.log`) |
| Unit + e2e tests  | 113 files, 1140 tests passing, the live drill skipped (M23: 1097) |
| New dependencies  | none                                                              |
| Escape hatches    | none added                                                        |

## Row by row

| Row (audit D)                                                     | Built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Checked by                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L rules.ts / skills.ts: UTF-16 as NUL garbage; linked skills      | `ContextIo` (`src/core/context/contextFiles.ts`): bytes, entries with links, `realPath`. `decodeContextText`: UTF-16LE/BE by the mark, UTF-8 otherwise (mark dropped), fatal decoding, NUL refused. `readContextText` confines a repository file (rules, memory, project skills) with `confineWorkspacePath`. `fileContextIo` (`src/host/backend/contextIo.ts`) lists links and junctions. Personal skill links are followed. A refused `AGENTS.md` does not fall back to `CLAUDE.md`.                                               | `contextFiles.test.ts`; `rules.test.ts`, `memory.test.ts`, `skills.test.ts` D27 cases; `contextIo.test.ts` on the real file system (a UTF-16 `AGENTS.md`, junctions or symlinks inside, out of and from the personal root); `workspaceContext.test.ts`. |
| L diagnostics.ts: absolute paths, no cap, suffix match, a throw   | Entries carry a root-relative path or none (the host's `rootRelativePath`); none is never reported. `DIAGNOSTIC_MESSAGE_MAX_CHARS` (1,000) with a count, never inside a surrogate pair. A request is resolved (`fileURLToPath` with the platform's flavour, or against the root) and matched exactly, case-insensitively on Windows only. A malformed URI or a path outside the root is a rejected call: an MCP error result.                                                                                                        | `diagnostics.test.ts` (Windows and POSIX roots, no root, the MCP error result).                                                                                                                                                                         |
| L mention.ts: no spaces or `#` in mentions                        | `formatMention` (`src/shared/mentions.ts`) quotes a path holding whitespace, `#` or `"` (`@"a b/c#1.md"#5-10`, `\"` and `\\` inside); `mentionQueryAt` reads mentions from the start of the draft, so a quoted one keeps its spaces and the menu searches the name typed inside the quotes; the line range is not part of the query. Alt+K, the menu, the picker, the upload dialog and drops all write through it.                                                                                                                  | `mentions.test.ts` (round trips: spaces, `#`, quotes, backslashes, tabs, unicode, emoji, folders, with and without a range); `mention.test.ts`; `conversationController.test.ts`; `Composer.test.tsx`. `[!x]` and nested braces: `glob.test.ts` (M21).  |
| M extension.ts: multi-root paths resolve against the wrong folder | `rootRelativePath` (`src/core/workspaceRoot.ts`): VS Code's attribution (`getWorkspaceFolder`, `asRelativePath`), a folder nested in the root counted as the root's, one beside it outside. The chip, Alt+K (absolute path outside), the upload dialog, drops, the file-search list (`findRootFiles`, a `RelativePattern` on folder 0) and diagnostics use it; `openFile` resolves against folder 0 (`resolveAgainstRoot`), and refuses a relative path with no folder. `hostSideUri` maps a dropped UI-side URI in a remote window. | `workspaceRoot.test.ts` (folder 0, folder 1, nested, outside, untitled, a `vscode-remote://ssh-remote+host/…` drop in folder 0 and in folder 1, a local file dropped in a remote window); `workspaceFiles.test.ts`; `diagnostics.test.ts`.              |

## Test-fire proofs (broken on purpose, restored after)

`scratchpad/prove-m24.mjs` ran the named tests once (232 passing), then
applied each break to the source, ran the tests that guard it, and restored
the file byte for byte (checked after every break). A break counted only
when at least one test failed with it in place (`scratchpad/prove-m24.log`:
"all 35 breaks caught"; `git status` clean of the breaks afterwards).

| Break                                                               | Failing tests (first)                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A UTF-16 never detected                                             | `contextFiles`, `rules`, `skills`, `memory`, `contextIo` (7)                                  |
| B UTF-16BE decoded unswapped                                        | `contextFiles` "reads UTF-8 … and UTF-16 in either byte order"; `rules` "reads a UTF-16 file" |
| C NUL characters accepted                                           | `contextFiles`, `rules`, `skills`, `memory` (4)                                               |
| D lossy UTF-8                                                       | `contextFiles` "refuses bytes that are not valid"; `rules` "skips a file that is not text"    |
| E the UTF-8 mark kept                                               | `contextFiles`; `rules` "drops a UTF-8 one"                                                   |
| F workspace files not confined                                      | `contextFiles`, `rules`, `memory`, `skills`, `contextIo` (5)                                  |
| G links and junctions not listed (the pre-fix filter)               | `contextIo` (2, real junctions)                                                               |
| H one unreadable skill fails the catalogue                          | `skills` "skips a skill whose read throws"                                                    |
| I personal skills confined                                          | `contextIo` "gives the workspace context … the linked skills"                                 |
| J a refused `AGENTS.md` falls back to `CLAUDE.md`                   | `rules` (2)                                                                                   |
| K a refused memory index read as none                               | `memory` "reads a UTF-16 index and refuses …"                                                 |
| L diagnostics outside the root reported                             | `diagnostics` (4)                                                                             |
| M no per-message cap                                                | `diagnostics` "clips a long message"                                                          |
| N the cap splits a surrogate pair                                   | `diagnostics` "clips a long message"                                                          |
| O the requested file matched by suffix                              | `diagnostics` "never matches by suffix", "scopes to the one file"                             |
| P a malformed URI throws out of the tool                            | `diagnostics` "answers a malformed URI … with an error"                                       |
| Q Windows paths compared case-sensitively                           | `diagnostics` "scopes … case-insensitively on Windows"                                        |
| R POSIX paths compared case-insensitively                           | `diagnostics` "compares paths case-sensitively where the file system does"                    |
| S paths never quoted                                                | `mentions`, `mention`, `conversationController`, `Composer` (8)                               |
| T quotes not read back                                              | `mentions`, `Composer` (6)                                                                    |
| U escapes read literally                                            | `mentions` round trips (2)                                                                    |
| V a bare path runs through its line range                           | `mentions` "reads the path back from a mention with a line range"                             |
| W an open quote crosses line breaks                                 | `mentions` "ends an open quote at a line break"                                               |
| X the menu inserts unquoted                                         | `mentions` "writes what the menu picked"; `Composer` "inserts a spaced path quoted"           |
| Y the host inserts unquoted                                         | `conversationController` (2)                                                                  |
| Z glob `[!x]` negation ignored (M21, confirmed)                     | `glob` "classes with brackets"                                                                |
| AA glob nested braces split at every comma (M21, confirmed)         | `glob` "alternates with braces, nested too"                                                   |
| AB a second folder counts as the root                               | `workspaceRoot`, `workspaceFiles` (5)                                                         |
| AC a folder nested in the root counts as outside                    | `workspaceRoot` "counts a folder added inside the first"                                      |
| AD the walk up never stops at a self-attributed folder              | `workspaceRoot` "stops where the folder around a folder is the folder itself"                 |
| AE a dropped `vscode-remote` URI kept as it is (Claude Code #92403) | `workspaceRoot` "reads the UI side vscode-remote URI of a first-folder file"                  |
| AF a local file dropped in a remote window read as a remote one     | `workspaceRoot` "keeps a second-folder file, and a file of the local machine, outside"        |
| AG a relative path without a folder resolved against the cwd        | `workspaceRoot`, `diagnostics` (2)                                                            |
| AH the file search lists files outside the root                     | `workspaceFiles` "lists the first folder files … nothing of a second folder"                  |
| AI a folder's own URI read as a path inside itself                  | `workspaceRoot` "places a folder URI itself where it sits"                                    |

## Findings recorded during the milestone

- `ToolIo.readFile` returns text already decoded as UTF-8, from which a
  UTF-16 file cannot be recovered, and `ToolIo.listDirectory` keeps only
  `Dirent.isDirectory()` entries: a symbolic link, and on Windows a junction
  (probed: `isSymbolicLink()` true, `isDirectory()` false, Node 24.20), is
  neither. The loaders therefore read through their own `ContextIo`; after
  this branch `ToolIo.listDirectory` has no caller.
- The rules loader read `AGENTS.md`, `CLAUDE.md` and `MEMORY.md` by their
  textual path: a committed symbolic link named `AGENTS.md` sent whatever it
  pointed at to the model in a trusted workspace. D24 confined the tools and
  the rules `touch`, not the files the loaders open. Now confined.
- A dropped editor URI in a remote window is the UI side's
  `vscode-remote://<authority>/path`, while this workspace extension, on the
  remote side, sees its folders as `file:///path` (microsoft/vscode
  `src/vs/base/common/uriTransformer.ts`), and `getWorkspaceFolder` is keyed
  by scheme and authority (`TernarySearchTree.forUris` in
  `extHostWorkspace.ts`): folder identity alone would not recognise the drop.
  `hostSideUri` applies the transformer's own mapping first.
- `vscode.workspace.asRelativePath` attributes a file to the innermost
  folder; a folder added inside the root is therefore walked up to the root
  (`rootRelativePath`), so its files keep root-relative paths, as `git
ls-files` in the root already lists them.
- Claude Code's own `@path` stops at the first space
  (anthropics/claude-code#4012, closed as not planned); its extension's
  changelog records a fix for "@-mentions dropping files whose paths contain
  spaces" without naming a syntax. The quoted form here is documented in
  `src/shared/mentions.ts`.
