# M118-X integration bindings

Base `61b1685f` (`m118/l0`), lane `m118/x`, win11. This is the X adapter
handoff, not a claim that the other lanes' stores, renderers or editor UIs have
landed. The authoritative D98/M118 plan is on `plan/m105-m107`. Lane 0's record
is named `m118-l0.md` on this base (the rig brief calls it `m118-0.md`).

## P/C: M118-X-PORTS

Construct `SharingCommands` from `src/runtime/sharing/commands.ts` with:

- `folders`: the existing `DataFolderInput`, the same on every surface.
  `storageFor({ user, workspace })` receives
  `agentDataFolder()/prompts` and `<cwd>/.muse/prompts`, using the platform's
  path module. Bind P's checked `PromptStoragePort`; do not use a workspace
  hash for personal prompts. P's `write` must enforce 200 prompts per scope,
  80 title characters, 10,000 body characters and checked atomic writes.
  Reads are parsed again, wrong scopes and duplicate same-scope ids refuse,
  and errors propagate without changing/removing damaged files.
- `renderPreview(cwd, request, exportedAt)`: bind C's portable history
  projection, registered-value/path/account scrub and deterministic renderer;
  for saved prompts, bind P's prompt lookup/export through the same scrub.
  Return `{ document, content, redactions: [{ start, end }] }`. `document`
  must pass `shareJsonSchema` and match target/mode/options/range/time;
  `content` is the exact string to display and release, never raw history.
  Redaction offsets are UTF-16 positions in that string. Validate the session,
  prompt source and inclusive range against the actual snapshot; unavailable
  history is an explicit error, never an empty successful export. Every string
  is scrubbed, and HTML has no scripts or remote assets. Those renderer proofs
  remain C's; X tests its admission and boundary, not a substitute renderer.
- `isConfidentialWorkspace(cwd)`: the same live confidential setting as the
  host, with `undefined` when unavailable. Admission requires exactly false
  before rendering, before displaying and immediately before the sink.
- `io.realPath`: the existing canonical-path implementation through the nearest
  existing parent, including symlinks/junctions. Follow broken links for an
  output sink that follows them; resolution errors must reject. The adapter
  reuses `confineWorkspacePath` before release; identity functions are test fakes.
- `shareFolder(cwd)` (optional): the trusted configured sharing root; absent
  uses the workspace. Relative paths resolve within this root. This root is
  snapshotted before awaiting UI and bound into the preview digest.
- `release(preview, resolvedOut, allowedRoot)`: dispatch only `preview.content`, to its already
  chosen local destination. No writes, clipboard access or browser open during
  preview. Begin the real sink immediately after admission; a sink that needs
  asynchronous preparation/selection must recheck confidentiality at its actual
  write/open too. Never serialize preview metadata/private output paths into
  the shared document. `resolvedOut` is absolute and has passed textual and
  canonical confinement, including the existing parent of a new file; `..`,
  outside absolute paths and escaping linked parents refuse (exit 7 and an
  `--out` message from the runner). Do not reinterpret this path or replace
  its root after confirmation. Recheck confinement at the actual sink if a
  path/parent can change during asynchronous sink preparation.

`SharingUi` is an injected real UI, never a default success implementation.
Every UI method receives the invocation's `AbortSignal` as its final argument:
preview, confirmation, variable/untrusted review and insert/create-chat.
Close outstanding UI on abort, remove listeners when finished, and check the
signal again before any late side effect. The adapter uses the existing
`unlessAborted` helper to end its wait even if a UI promise never settles.
`showPreview` displays exact content/redaction offsets/options.
`confirmShare` returns `{ step: 'confirmed', previewId, request }` only from the
final button, or returns undefined on cancellation. Approval rules, permission
cards and paid grants are not that button. The adapter clones the UI's copy,
keeps the authoritative preview in memory and validates the returned id and
request against it. Each invocation admits at most one release.
`preparePrompt` shows the complete untrusted text and declared variables before
reading selection/file/clipboard or asking for named inputs; cancellation
returns undefined. `insertPrompt` receives `promptLoadSchema`'s insert-only,
`send: false` request and prepared text; create a chat if requested, never send.
Without a composer, use returns an explicit prepared-text result.

## W/runtime: M118-X-ACP and M118-X-CLI

`src/runtime/main.ts` is not X-owned and is deliberately unchanged. It must
install its locale first, supply P/C ports and the real preview/composer bridge,
then bind `AcpAgentDeps.sharing = createAcpSharing(commands, uiFor)` from
`src/acp/sharing.ts`. `uiFor` receives `{ cwd, sessionId, isActive, signal }`;
cancel/close/reload/backend exit abort that signal. ACP ends a local prompt
waiting on sharing UI immediately (`cancelled`, or the backend error on exit) and clears its
busy state without requiring UI resolution; older preparations cannot clear
a newer prompt's state. Close or settle pending UI promises on abort. Late actions
cannot release or insert. ACP uses existing `session/prompt` and
`available_commands_update`; no guessed extension method, elicitation or
ordinary permission prompt was added. Reserved slash commands fail explicitly
without the binding and cannot fall through to skills/model execution.
Both interception and argument parsing use the shared `parseSkillInvocation`
selector parser, including leading spaces, tabs and newlines. Preserve the
original command text for save-body parsing; do not trim its trailing bytes.

For standalone commands, call `parseCommandLine(argv, parseSharingArgs)` and
route its `share`/`prompts` results to `runSharingCommand(command, commands,
context)`. Its result includes `exitCode` (0 on completion; 7 on cancellation
or absent sharing confirmation). Provide bounded stdin reading for save,
the default cwd, `SharingContext.signal` from the command/session lifetime,
output formatting, terminal preview
and the actual local sinks. Handle parse/errors as failures and install the
language before parsing. Do not start a backend or read a key for prompt save,
list or use. Existing one-argument parsing remains compatible and fails these
unbound commands explicitly.

Syntax verified against the injected runner and SDK tests:

| Surface | Command                                                                                |
| ------- | -------------------------------------------------------------------------------------- |
| ACP     | `/share chat [--mode full\|conversation] [--format md\|html\|json]`                    |
| ACP     | `/prompt save --title "Title" [--scope user\|workspace] [--tag TAG] -- exact body`     |
| ACP     | `/prompt list [--search TEXT] [--tag TAG]`                                             |
| ACP     | `/prompt use ID [--scope user\|workspace] [--chat active\|new]`                        |
| ACP     | `/prompt share ID [--scope user\|workspace] [sharing flags]`                           |
| CLI     | `share chat SESSION_ID [sharing flags] [--cwd FOLDER]`                                 |
| CLI     | `prompts save --title "Title" [--scope user\|workspace] [--tag TAG]` (body from stdin) |
| CLI     | `prompts list [--search TEXT] [--tag TAG] [--cwd FOLDER]`                              |
| CLI     | `prompts use ID [--scope user\|workspace] [--chat active\|new] [--cwd FOLDER]`         |
| CLI     | `prompts share ID [--scope user\|workspace] [sharing flags] [--cwd FOLDER]`            |

Sharing flags: `--mode`, `--format`, `--destination copy|save|open`, `--out`,
`--from A --to B` (chat only), `--no-code-blocks`, `--no-attachment-names`,
`--diffs`, repeated `--attachment-content ID`, `--exported-at` and CLI-only
`--confirm`. `save`/`open` map to the existing `file`/`browser` contract values;
the old flag spellings remain accepted. Defaults: conversation/md/copy (file with `--out`), code blocks
and attachment names on, diffs off, no contents. A CLI chat needs a session id;
ACP uses its current session and refuses another session's id or `--cwd`.
Single/double quoted header arguments work; save text after the unquoted `--`
is verbatim, including CRLF/trailing whitespace. ACP requires exactly one text
block and cannot use `--confirm` to bypass the host's final action.

Noninteractive sharing first returns a cancelled preview (nonzero), its
`previewId` and `document.createdAt`. After reviewing it, explicitly invoke the
same command with an explicit `--destination`, the same `--exported-at`,
`--out` and `--confirm PREVIEW_ID`. Confirmed headless release refuses absent
`--destination`, including an implicit file from `--out`; save/file also
requires `--out`. Both return exit 7 and `message` naming the missing flag.
Surface the runner's refusal message. Interactive defaults are unchanged.
The SHA-256 digest binds cwd, destination/path, the entire request, time and
exact rendered bytes and allowed root. Changed content/options/path/root require a new confirmation.
There is no broad `--yes`, remembered grant or implicit noninteractive success.
The CLI renderer must not change its output merely to display the digest.

## M104/M110a0: M118-X-MHP and M118-X-TUI

`src/runtime/sharing/bridge.ts` supplies `nativePromptMenus` and
`invokeNativePromptMenu`, with lane 0's exact command/menu/source ids and runtime
localized labels. Bind these through each host's existing validated envelope;
these local DTOs are not a new MHP/ACP wire method.

The trusted native `snapshot` returns a strict context with a host-owned
`contextId` that changes whenever its source identity/view changes:

- Own message: `{ contextId, source: 'userMessage', sessionId, messageId,
role: 'user', own: true, text }`. Assistant/tool/system/foreign/empty rows
  have no Save entry and cannot invoke it by forging the menu id.
- Composer: `{ contextId, source: 'composer', text, chatAvailable }`.
  Nonempty text has Save; an available chat has Use even with empty text.
- Selection: `{ contextId, source: 'editorSelection', text }`.
  The native editor snapshots the exact current selected text.

An invocation is `{ menuId, contextId }`, without claimed text/role/ownership.
The adapter re-reads its trusted current snapshot. `choosePrompt` uses P's
shared user/current-workspace picker and returns a `promptLoadSchema` request
or undefined; stale/replaced/unavailable composers and send/run requests refuse.
The host's load handler resolves/reviews variables, then inserts into the
active/new chat; no model send method belongs on these ports.
Supply `NativePromptPorts.signal`, abort it on view closure/cancel/replacement,
and observe the final signal parameter on `savePrompt`, `choosePrompt` and
`loadPrompt`. Their pending adapter waits end on abort without manually
resolving a picker. The actual handlers must stop late saves/inserts too.

M104 must mount this on JetBrains, Visual Studio, Eclipse, Zed, Xcode,
Neovim/Emacs/Sublime and the companion page. M110a0 lane T must mount the same
prompt picker/insert and exact-preview final-action UI on the TUI. Neither
dependency exists on this base; the owning acceptance explicitly allows the
TUI to be named as waiting. X's fake bridge tests prove the portable adapter
contract, not installed-editor or mounted-view parity. Real host/menu,
accessibility and TUI checks remain pending these bindings.

## W: M118-X-HELP/DOCS/BUNDLE

`featureCatalog.ts` and `scripts/gen-reference.mjs`/`check:reference` are absent
on this base. Add accurate entries for both ACP commands and both CLI roots,
including scope-labelled user prompts in every workspace, Insert/Use never
submitting, variables/untrusted review, conversation/full selection and local
preview confirmation. The table above is the tested help inventory. New
settings: none. Gists/node/team/email remain phase 2/3, unavailable for release.

Add README and `docs/acp.md` examples only after running the actually bound
installed commands; the injected runner/SDK tests alone are not an installation
receipt. Add the `[Unreleased]` changelog entry describing ACP/CLI saved prompts,
chat/prompt sharing with exact preview confirmation and native-menu adapters;
list the real editor/TUI availability accurately. Those files are W-owned.
All visible labels/errors reuse lane 0's existing English and fourteen real
translations; technical command syntax/id lists remain literal. No table or
manifest contribution outside X's ownership was changed.

X's schema/renderer/bridge implementation modules remain outside activation
and the default ACP bundle until W binds them. Keep the implementation lazy;
the existing split guard must continue excluding contracts from activation.
If Node lazy bundles externalize zod/mini, extend `validationEntry`'s real
exports for `_default` (lane 0's existing warning) and any newly used members,
then drill the split guard. Do not raise the 850 KiB ACP/other caps or the
50 KiB deferred-webview total. X's tests consume the unbound ports; after
integration, confirm actual production consumers and remove unused seams.
Full integrated quality, coverage, accessibility, packaged-command and native
editor receipts remain with W. No paid/live calls are needed.
