# Editor parity: research, audit and plan (M104 / D84)

Prepared 2026-10-05 for the owner's ruling of the same day: _"i feel like you
are still focusing very hard on vs code rather than treating all the editors
equally; all of the editors should have equivalent functionality even if we
need to develop it ourselves"_. **The goal is parity, not a reduced tier.**

Read-only audit. Code was read from `origin/main` (8c894b60a, 0.13.0), from
`kubuntu/release/train-0.14.0` (654d77b77; M94 Tab and M71 Git and PRs), and
from the integration branches `kubuntu/m95/int` (M95), `macmini/m96c/int`
(M96/M96c), `macmini/m97/int` (M97), `kubuntu/m98/int` and
`macmini/m98/p2int` (M98), `win11/m93/win` (M93) and `macmini/m94/k`
(M91). The local `main` checkout (749 commits behind) was not used.
Nothing was edited, committed or billed.

---

## 0. Summary

1. **Today only the VS Code family has the product.** Every other editor gets
   one of three things: nothing (Visual Studio; Arduino IDE 2, which our
   VS Code 1.99 floor refuses), a community ACP plugin (Eclipse and
   Espressif), or the ACP agent inside that editor's own chat. Of the 49 features VS Code
   ships, that route covers 5 fully and 20 in part, and misses 23 (one does
   not apply).
2. **Why the ACP route is a lower tier.** The ACP agent drives `AgentHost`
   directly (`src/acp/agent.ts`). It never runs the `ConversationController`
   (`src/host/conversation/conversationController.ts`, 8,815 lines). That is
   where checkpoints, rewind, review, best-of-N, schedules, the daily budget,
   handoff, goals, plans-as-files and the panel's own UI live. It is not
   something the protocol forces.
3. **The seams exist, but they are unfinished.** M60's gate keeps `src/core`,
   `src/shared`, `src/webview`, `src/acp`, `src/runtime` and the controller
   free of `vscode`. M61 built the webview `HostBridge` interface, but VS Code
   is still its only implementation. M61's theme tokens, its editor-services
   contract and its capability detection were never built. M64–M66 (the
   native plugins) were never started.
4. **The plan (D84, M104a–M104h):**
   - **One runtime.** It runs the whole controller outside VS Code
     (`muse-spark-code-acp panel`).
   - **One versioned host protocol (MHP v1).** It replaces the 80-member
     `ConversationDeps` as the editor-services contract, and VS Code becomes
     adapter #1 of it.
   - **One React UI.** It gets three bridges: VS Code, embedded and
     companion. Every editor-native widget gets a React fallback.
   - **Native plugins where a webview can be embedded:** JetBrains (with
     Android Studio), Visual Studio, Eclipse (with Espressif IDE).
   - **A loopback companion UI** (the M98 judge-serve guard, adapted). It is
     paired with ACP and a thin editor shim for Zed, Xcode, Qt Creator,
     Neovim, Emacs and Sublime.
   - **Tab completions** through each editor's own completion API, through
     an LSP 3.18 `inlineCompletion` server we ship, or through an XcodeKit
     command.
   - **A merge gate** (`check:editor-matrix`): a feature PR must update the
     feature × editor registry.

---

## 1. Inventory today (evidence)

### 1.1 What M60–M66 actually built

| Item                                                  | State                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M60 host API inventory**                            | Built, gated                             | Added in `scripts/check-host-api.mjs` (3508f1d44, 2026-09-26). It runs as `npm run check:host-api` in `quality:gates`. The generated record is `docs/ide-compatibility/host-api.md`: on main, 24 files import `vscode` and use 296 VS Code APIs and 25 Node built-ins. `acquireVsCodeApi` appears in 3 files, and 61 `--vscode-*` theme variables are used (host-api.md lines 30–60 and 413–421). On `m95/int` the counts are 23 files and 283 APIs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **M60 portable roots**                                | Built, gated                             | host-api.md §"Portable modules" lists `src/core/`, `src/shared/`, `src/webview/`, `src/acp/` and `src/runtime/`, plus `conversationController.ts`, both backend managers, `toolIo.ts`, `credentialStore.ts`, `authService.ts`, `fileSessionStore.ts`, `modelApiEntry.ts` and `ideMcpServer.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **M61.1 webview host bridge**                         | Interface built; only one implementation | `src/webview/hostBridge.ts:14-20` defines `HostBridge {post, savedState, saveState, messages}`. The only implementation is `vsCodeHostBridge` (`:23-35`), which calls `acquireVsCodeApi()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Does the React UI run without `acquireVsCodeApi`?** | **No, not in production**                | `src/webview/main.tsx:45` hard-wires `vsCodeHostBridge(window)`. The Tasks surface (`main.tsx:26-39`) and What's New (`src/webview/whatsNew/main.ts:7`) call `acquireVsCodeApi()` themselves, outside the bridge. The page HTML is built with `webview.asWebviewUri` and `webview.cspSource` (`src/host/views/webviewSetup.ts:87-94`). The one non-VS Code run is the screenshot harness, which only works because `test/harness/index.html:421` stubs `window.acquireVsCodeApi` and loads captured VS Code theme JSON (`test/harness/themes/*.json`). It does prove that the bundle renders in a plain Chromium.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **M61.2 surface types**                               | Built                                    | `src/host/views/chatSurface.ts` holds `ChatSurface` and `ConversationMessage` with no `vscode` type (3508f1d44).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **M61.3 theme tokens**                                | **Not built**                            | `src/webview/styles.css` has 304 `--vscode-*` references and no `--muse-*` tokens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **M61.4 editor-services contract**                    | **Not built**                            | There is no `EditorServices` or `HostServices` interface in `src/`. The de-facto contract is `ConversationDeps` (`conversationController.ts:298-485`, 80 members, among them `editorContext`, `saveAll`, `unsavedFiles`, `applyCode`, `insertCode`, `openFile`, `openDocument`, `editReview`, `checkpoints`, `dictation`, `allowsPaidUse`, `runGit` and `tasksTab`). It is built once, with VS Code calls, in `src/extension.ts:2111` (2,842 lines).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **M61.5 Node runtime**                                | Built (with M63a)                        | `src/runtime/` (78e3f42c9). It drives `AgentHost` through `src/acp` and never constructs the `ConversationController`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **M61.6 capability detection**                        | **Not built**                            | No capability type exists in `src/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **M62 VS Code family**                                | Built (M62a), part of M62b               | The floor is `engines.vscode ^1.99.0`. `hosts.yml` (32a9e63c2) runs VSCodium 1.99.3 and latest, code-server 4.99.4, Theia 1.75, JupyterLab, Emacs and Neovim on every PR. `forks.yml` (7ac38373c) runs Cursor 3.22.7, Devin Desktop 3.10.35, Kiro 1.1.70 and Positron 2026.09.1 weekly, 9 integration tests each. Open VSX is published from `release.yml:313`. Theia has a known gap: it never fires `onView:`, so the sidebar stays blank until the extension starts (`hosts.md`). Codespaces, Che, Firebase Studio and Antigravity are still Planned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **M63 ACP agent**                                     | Built (M63a/b/c)                         | `src/acp/agent.ts` (1,246 lines). `initialize` (`:1048-1062`) advertises `loadSession`, `promptCapabilities {image: true, audio: false, embeddedContext: true}`, `mcpCapabilities.http` (Muse Code only) and `sessionCapabilities {list, resume, close}`, plus one auth method. Handlers (`:1205-1246`): `initialize`, `authenticate`, `session/new\|load\|resume\|list\|close\|set_mode\|set_config_option\|prompt\|cancel`. Updates: `available_commands_update`, which carries **skills only** (`:269-286`); `config_option_update` (`:327`); `plan` (`:697`); `elicitation/create` where the client has forms (`:445-457`). **Not used:** client `fs/*`, so unsaved buffers stay invisible (`src/runtime/backends.ts:185`: `unsavedFiles: () => []`); `terminal/*`; `session/fork` and `delete`; `logout`; audio. **No checkpoints** (`backends.ts:119-121`, and `docs/acp.md` lines 15–19). Paid features only with `--web-search` or `--image-generation` (`src/acp/paid.ts`). The OS key store is `src/runtime/keyStore.ts`. Published to npm since 0.11.0 (`release.yml:357`). It has run in Zed 1.20.2, Neovim with CodeCompanion v19.25.0, Emacs with agent-shell 0.79.2, and JupyterLab with Jupyter AI 3.2.0 (`hosts.md`). |
| **M80 headless runtime**                              | Built; not yet certified live            | `src/runtime/exec/*` (77e8ccd03). `exec` runs one turn in Plan or acceptEdits and emits text, JSON or JSONL. `scan-secrets`. Editor questions become denials. A hard USD cap applies on the Model API (`docs/acp.md` "Headless execution").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **M64 JetBrains/Visual Studio native**                | **Not started**                          | `hosts.md` rows are "Planned".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **M65 Eclipse, NetBeans, Jupyter native**             | **Not started**                          | "Planned". JupyterLab is reached through ACP instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **M66 constrained hosts**                             | **Not started**                          | "Planned".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Other portability facts that matter for the plan:

- **Two loopback servers with the security pattern to reuse:**
  - **The `ide` MCP server** (`src/host/ide/ideMcpServer.ts`): loopback,
    streamable HTTP, and a bearer token minted for each extension host.
  - **M98's `judge serve`** (`macmini/m98/p2int:src/runtime/judge/serve.ts`):
    - It binds only `127.0.0.1` or `::1` (`:70-71`).
    - It answers 403 unless there is exactly one `Host` header equal to its
      own authority and no `Origin` header (`:89-96`).
    - It checks the bearer token with `timingSafeEqual` (`:26-31`).
    - It keeps the token in an owner-only file, with the Windows ACL checked
      by receipt (`src/runtime/judge/tokenFile.ts`).
- **The webview protocol is already a complete, validated UI contract:**
  about 130 message types (`src/shared/protocol.ts`, 939 lines, zod), 22 host
  actions (`HOST_ACTIONS`, `protocol.ts:158-197`), the Tasks protocol
  (`src/shared/tasksProtocol.ts`), and the Models panel protocol
  (`m95/int:src/shared/modelsPanel.ts`, which shares the bridge).
- **What is bound to VS Code's own UI rather than the panel:**
  - the paid-use popup (`src/host/paid/paidHost.ts:89,124`) and the daily
    budget dialog (`paidDailyBudget.ts`), both `showWarningMessage` modals;
  - quick picks for mentions, skills, MCP, hooks, memory and worktrees
    (`mentionQuickPick.ts`, `quickPick.ts`, `memoryFeatures.ts`,
    `worktreeFeatures.ts`);
  - the Settings editor (47 `museSpark.*` settings) and the walkthrough
    (`contributes.walkthroughs`);
  - the diff editor (`vscode.diff`) and code intelligence through
    `vscode.execute*Provider` (`src/host/codeIntel/languageServices.ts`);
  - diagnostics for the verify loop (`src/host/editor/verifyEditor.ts`);
  - `createTerminal`;
  - on the 0.14 train: Tab's `registerInlineCompletionItemProvider` and status
    item (`src/extension.ts:967`, `src/host/tab/tabBundle.ts:544`), and Git's
    `authentication.getSession('github')`
    (`src/host/git/githubSession.ts:16`).

### 1.2 The VS Code panel's features (the parity checklist)

**Status key:**

- **0.13** means shipped on main.
- **0.14** means on the release train.
- **B** means on an integration branch, being built.
- **P** means planned.

| #   | Feature (milestone)                                                                 | Status                             | VS Code-only dependency today                 |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------- |
| F1  | Streaming chat, Markdown, code blocks, thinking rows (M1–M4, M16)                   | 0.13                               | none (React)                                  |
| F2  | Tool rows with status colours; outputs open in an editor tab (M4, M15, M43)         | 0.13                               | `openDocument` and `showTextDocument`         |
| F3  | Approval cards with the backend's own choices (M2, M7)                              | 0.13                               | none                                          |
| F4  | Question cards: radios, checkboxes, tabs, "Other" (M46)                             | 0.13                               | none                                          |
| F5  | Permission modes Manual / Edit auto / Plan / Auto / Bypass; `Shift+Tab` (D7)        | 0.13                               | keybinding                                    |
| F6  | Auto reviewer on Muse Code (M90)                                                    | 0.13                               | none (controller)                             |
| F7  | Inline edit diffs; **Click to expand** opens the editor diff (M5)                   | 0.13                               | `vscode.diff`                                 |
| F8  | `/review` pane and hunk review/revert (M70)                                         | 0.13                               | `editReview`, `revertIo`                      |
| F9  | Checking edits: verify loop with diagnostics (M68)                                  | 0.13                               | `languages.getDiagnostics`                    |
| F10 | Turn checkpoints, Restore/Redo (M72, M86)                                           | 0.13                               | dirty-buffer checks, window presence          |
| F11 | Rewind code and conversation (M6, M20, M53)                                         | 0.13                               | none                                          |
| F12 | History: search, resume, archive, rename (M6)                                       | 0.13                               | `globalState`                                 |
| F13 | Fork; side chat (M6, M53)                                                           | 0.13                               | none                                          |
| F14 | `/` palette and slash commands (M38); gooey menu, heartbeat (M87)                   | 0.13                               | none                                          |
| F15 | `@` mentions, selection chip, `Alt+K` (M3)                                          | 0.13                               | `workspace.findFiles` fallback, active editor |
| F16 | Attachments: images, PDFs and files, paste or drop (M44, M54)                       | 0.13                               | `showOpenDialog`, dropped URIs                |
| F17 | Subagents and the Agent map (M14, M48)                                              | 0.13                               | none                                          |
| F18 | Workflow run card (M47)                                                             | 0.13                               | none                                          |
| F19 | Task list and Tasks tab (M87)                                                       | 0.13                               | second webview panel                          |
| F20 | Session goals `/goal` (M45)                                                         | 0.13                               | none                                          |
| F21 | Plan mode and plans as files (M79)                                                  | 0.13                               | `openTextDocument`                            |
| F22 | Compaction and handoff (M74)                                                        | 0.13                               | none                                          |
| F23 | Background work, stop, `!` user shell (M46)                                         | 0.13                               | none                                          |
| F24 | Best-of-N and the session board (M77)                                               | 0.13                               | `vscode.openFolder` for an attempt            |
| F25 | Scheduled prompts `/loop`, timed sends, saved prompts, bookmarks (M52, M88)         | 0.13                               | `globalState.setKeysForSync` (optional)       |
| F26 | Reply to an output; ask about or comment on a quote (M17)                           | 0.13                               | none                                          |
| F27 | Rules, skills (and bundled skills, M89), memory, custom agents (M10, M30, M49, M76) | 0.13                               | quick picks, `openTextDocument`               |
| F28 | MCP servers (M31, M50)                                                              | 0.13                               | quick pick                                    |
| F29 | Hooks (M51; M91 parity)                                                             | 0.13 / B                           | quick pick                                    |
| F30 | Code intelligence tools (M67)                                                       | 0.13                               | `vscode.execute*Provider`                     |
| F31 | Web fetch (M69)                                                                     | 0.13                               | modal confirm                                 |
| F32 | Web search and image generation, paid (M33, M34, M44)                               | 0.13                               | none                                          |
| F33 | Browser check (M81)                                                                 | 0.13                               | modal consent, runtime download               |
| F34 | Import from other agents; session export, import, share (M83, M84)                  | 0.13                               | open and save dialogs                         |
| F35 | Worktrees (M32)                                                                     | 0.13                               | `vscode.openFolder`                           |
| F36 | Git commit, push and PR (M71)                                                       | 0.14                               | `authentication.getSession('github')`         |
| F37 | Install Muse Code and sign in from the panel (M55)                                  | 0.13                               | `createTerminal`                              |
| F38 | Account & usage (M8, M14, M82)                                                      | 0.13                               | none                                          |
| F39 | Paid-use popup Allow once / always / Deny (M58, D48)                                | 0.13                               | modal `showWarningMessage`                    |
| F40 | Shared daily paid budget (D78)                                                      | 0.13                               | modal                                         |
| F41 | Voice: OS recogniser (M9); Muse Voice (M35)                                         | 0.13                               | host spawns helpers; `WebSocket`              |
| F42 | Tab completions with their own daily budget (M94)                                   | 0.14                               | `InlineCompletionItemProvider`, status item   |
| F43 | Settings (47 `museSpark.*`)                                                         | 0.13                               | Settings editor                               |
| F44 | Get Started walkthrough                                                             | 0.13                               | `contributes.walkthroughs`                    |
| F45 | What's New after an update (M99)                                                    | 0.13                               | third webview                                 |
| F46 | 15 display languages (M40)                                                          | 0.13                               | `env.language`                                |
| F47 | Accessibility gate, WCAG 2.2 AA in VS Code's themes (M37)                           | 0.13                               | `--vscode-*` theme variables                  |
| F48 | Logs and Diagnostics (M39)                                                          | 0.13                               | `LogOutputChannel`                            |
| F49 | 34 commands, 7 keybindings                                                          | 0.13                               | `contributes`                                 |
| F50 | Report a problem (M93)                                                              | B                                  | `globalStorageUri`                            |
| F51 | Models & Agents panel, BYO providers and sign-ins (M95)                             | B                                  | fourth webview, key prompts                   |
| F52 | Roles, team, Traffic board (M96, M96c)                                              | B                                  | none (React)                                  |
| F53 | `/legal` scan (M97)                                                                 | B                                  | none                                          |
| F54 | Muse Judge (M98)                                                                    | B                                  | status line                                   |
| F55 | Paired devices (M100)                                                               | P                                  | —                                             |
| F56 | Remote Control                                                                      | waits on Meta; nothing built (D30) | —                                             |

### 1.3 Feature × editor matrix (today)

**Columns:**

- **VSC**: VS Code.
- **Fam**: the VS Code family (Cursor, VSCodium, Windsurf/Devin, Kiro,
  Positron, Theia, code-server).
- **JB**: JetBrains IDEs, through AI Assistant's ACP.
- **VS**: Visual Studio 2022 and later.
- **Ecl**: Eclipse and Espressif IDE, through the community Eclipse ACP
  Connector.
- **Zed**, **Xc** (Xcode 26.6 and later, ACP), **Qt** (Qt Creator 20,
  ACP), **Nvim** (CodeCompanion), **Emx** (agent-shell), **Subl**
  (sublime-acp).
- **Ard**: Arduino IDE 2.
- **CLI**: headless `exec` or a bare ACP client.

**Cell key:**

- **W**: works.
- **P**: partial (what is missing is in the Notes column).
- **M**: missing.
- **B**: being built on a branch.
- **—**: not applicable.

- **VS** is M throughout: Visual Studio has no general ACP client (§2.4).
- **Ard** is M throughout: Arduino IDE 2.3.10 runs Theia 1.57, which offers
  VS Code API 1.96. That is below our `^1.99.0` floor, so the VSIX is
  refused.
- **Ecl** uses the same inferred ACP values as JB, through the community
  **Eclipse ACP Connector** (2026-10-01). Nobody has run it with our agent.
- **Zed, Nvim and Emx** ACP cells have been run against the fake CLI.
- **JB, Xc, Qt and Subl** cells are inferred from our agent's capabilities
  plus each client's documented features, because those editors are still
  "Planned" in `hosts.md`.

| #   | Feature                               | VSC  | Fam | JB  | VS  | Ecl | Zed | Xc  | Qt  | Nvim | Emx | Subl | Ard | CLI | Notes on P and M (ACP unless named)                                                                                                                    |
| --- | ------------------------------------- | ---- | --- | --- | --- | --- | --- | --- | --- | ---- | --- | ---- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Chat streaming, thinking              | W    | W   | W   | M   | W   | W   | W   | W   | W    | W   | W    | M   | P   | CLI: one turn per exec. Ard: see §2.4.                                                                                                                 |
| F2  | Tool rows, outputs in a tab           | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | The client's own tool cards. There is no "open output in an editor" from us.                                                                           |
| F3  | Approval cards                        | W    | W   | W   | M   | W   | W   | W   | W   | W    | W   | W    | M   | P   | `session/request_permission` with the backend's choices. CLI turns every question into a denial.                                                       |
| F4  | Question cards                        | W    | W   | P   | M   | P   | P   | P   | W   | P    | P   | P    | M   | M   | A form only where the client has `elicitation.form` (Qt Creator has a handler). Otherwise text, then declined (`agent.ts:445`).                        |
| F5  | Permission modes                      | W    | W   | W   | M   | W   | W   | P   | W   | W    | W   | W    | M   | P   | Xc: Devin's docs say Xcode shows no model or slash UI for agents. CLI: Plan or acceptEdits only.                                                       |
| F6  | Auto reviewer                         | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | "Auto runs without the panel's Auto reviewers" (`docs/acp.md`).                                                                                        |
| F7  | Diffs, editor diff view               | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | M   | A diff appears in the tool card. Our agent writes files itself (no `fs/*`), so the client's accept/reject review and native undo never see the change. |
| F8  | `/review`, hunk review                | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | The controller only.                                                                                                                                   |
| F9  | Verify loop and diagnostics           | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | The runtime has no editor diagnostics and no `ide` tool server.                                                                                        |
| F10 | Checkpoints, Restore/Redo             | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | VS Code only (`backends.ts:119`).                                                                                                                      |
| F11 | Rewind                                | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F12 | History, resume                       | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | M   | list, load, resume and close work. Search, archive and rename are missing. The UI depends on the client.                                               |
| F13 | Fork, side chat                       | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | P    | M   | M   | `session/fork` is still an RFD. sublime-acp forks on its own side.                                                                                     |
| F14 | `/` palette, gooey                    | W    | W   | P   | M   | P   | P   | M   | P   | P    | P   | P    | M   | M   | Skills only (`agent.ts:269-286`). No palette actions.                                                                                                  |
| F15 | `@` mentions, selection               | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | M   | The client's own `@`, sent as resource links. Qt Creator attaches editor context.                                                                      |
| F16 | Attachments                           | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | M   | Images only. No PDFs or binary files.                                                                                                                  |
| F17 | Subagents, Agent map                  | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | Paid, and denied in the agent. No map.                                                                                                                 |
| F18 | Workflow card                         | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | M   | Shown as tool calls only.                                                                                                                              |
| F19 | Task list                             | W    | W   | W   | M   | W   | W   | W   | W   | W    | W   | P    | M   | P   | `plan` updates. Zed pins the list in its sidebar.                                                                                                      |
| F20 | Goals                                 | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F21 | Plan mode, plans as files             | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | The mode works. Plan files are missing.                                                                                                                |
| F22 | Compaction, handoff                   | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | Automatic compaction (core) runs. The UI and handoff are missing.                                                                                      |
| F23 | Background, `!` shell                 | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F24 | Best-of-N, board                      | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F25 | Schedules, timed sends, saved prompts | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | The agent denies schedules (D62).                                                                                                                      |
| F26 | Reply and quote                       | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F27 | Rules, skills, memory, custom agents  | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | They work with `--trust-workspace`. There is no skills, memory or bundled-skills UI.                                                                   |
| F28 | MCP servers                           | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | M   | The editor's servers go to Muse Code. None run on the Model API.                                                                                       |
| F29 | Hooks                                 | W/B  | W/B | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | Muse Code runs its own hooks. Model API hooks are not wired in the runtime.                                                                            |
| F30 | Code intelligence                     | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | Through VS Code's language services only.                                                                                                              |
| F31 | Web fetch                             | W    | W   | W   | M   | W   | W   | W   | W   | W    | W   | W    | M   | P   | Model API, trusted folder.                                                                                                                             |
| F32 | Paid web search and images            | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | Needs the launch flags. Each use asks. Images only in CLI.                                                                                             |
| F33 | Browser check                         | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F34 | Agent import, export, share           | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F35 | Worktrees                             | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F36 | Git, push, PR                         | 0.14 | P   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | Fam: depends on the fork's GitHub auth provider (unverified).                                                                                          |
| F37 | Install and sign in                   | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | Through the terminal auth method, or by hand. No installer.                                                                                            |
| F38 | Account & usage                       | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | `usage_update` context only.                                                                                                                           |
| F39 | Paid-use popup                        | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | Through permission prompts, with flags only. CLI admits by policy.                                                                                     |
| F40 | Daily paid budget                     | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | P   | CLI: a hard per-run cap.                                                                                                                               |
| F41 | Voice                                 | W    | P   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | —   | Fam: on code-server and Codespaces the OS helper runs on the remote host. Muse Voice before VS Code 1.112 goes around VS Code's proxy.                 |
| F42 | Tab completions                       | 0.14 | P   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | —   | Fam: coexistence with Cursor Tab and Copilot is unverified. ACP is dropping its NES proposal (§2.1).                                                   |
| F43 | Settings                              | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | Launch flags only. Every other setting stays at its default.                                                                                           |
| F44 | Walkthrough                           | W    | P   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | —   | Theia's walkthrough is unverified.                                                                                                                     |
| F45 | What's New                            | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | —   |                                                                                                                                                        |
| F46 | Languages                             | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | The agent's text uses `runtime/locale.ts`. The chrome is the client's.                                                                                 |
| F47 | Accessibility (our UI)                | W    | W   | —   | M   | —   | —   | —   | —   | —    | —   | —    | M   | —   | Not ours to certify inside a client's UI.                                                                                                              |
| F48 | Logs, Diagnostics                     | W    | W   | P   | M   | P   | P   | P   | P   | P    | P   | P    | M   | P   | stderr to the editor's agent log.                                                                                                                      |
| F49 | Commands, keybindings                 | W    | W   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | —   |                                                                                                                                                        |
| F50 | Report a problem                      | B    | B   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F51 | Models & Agents, BYO                  | B    | B   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F52 | Roles, team, board                    | B    | B   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F53 | `/legal`                              | B    | B   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F54 | Judge                                 | B    | B   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | P   | `judge serve` (M98 phase 2) is agent-neutral but not yet merged.                                                                                       |
| F55 | Paired devices                        | P    | P   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   |                                                                                                                                                        |
| F56 | Remote Control                        | M    | M   | M   | M   | M   | M   | M   | M   | M    | M   | M    | M   | M   | Waits on Meta (D30).                                                                                                                                   |

**Totals.** Of the 49 features VS Code ships (F1–F49), the best ACP editor
(the Zed column) has 5 W, 20 P, 23 M and 1 n/a (F47). Each of the seven
features still being built or planned (F50–F56) is M outside the VS Code
family. **Visual Studio and Arduino IDE 2 have no route at all** (every
cell M). Eclipse and Espressif get at most the ACP column, through a
community plugin.

---

## 2. Per-host research (primary sources, read 2026-10-05)

For each host, **"UI route"** says how the Muse React UI, or an
equivalent, can be shown there. There are three options:

- **E (embedded webview):** the host can show a browser panel inside the
  editor.
- **C (companion):** our runtime serves the panel on loopback with a token.
  It opens in a browser, an app window or a small native shell.
- **N (native):** the UI is rebuilt in the host's own toolkit.

### 2.1 Agent Client Protocol: what it can and cannot carry

- **Versions.** v1 is current. `protocolVersion` is a single integer, and
  v2 has been a draft since 2026-07-20.
  - `@agentclientprotocol/sdk` is at **1.7.0**; we pin 1.5.0 (Q61).
  - Stabilised since our pin:
    - `session/delete`, `logout`, `session.additionalDirectories`;
    - message IDs and `usage_update`;
    - boolean config options (2026-07-06) and `elicitation` (2026-07-22);
    - tool call `name` (2026-09-17).
  - `session/fork` is still an RFD.
  - Sources: [initialization](https://agentclientprotocol.com/protocol/v1/initialization),
    [v2 draft](https://agentclientprotocol.com/announcements/acp-v2-draft),
    [updates](https://agentclientprotocol.com/updates),
    [session fork RFD](https://agentclientprotocol.com/rfds/session-fork).
- **There is no inline-completion route.** The Next Edit Suggestions RFD
  (`nes/*`) was marked for removal on 2026-09-30
  ([RFD](https://agentclientprotocol.com/rfds/next-edit-suggestions)).
  Tab parity therefore needs each editor's own completion API, or an LSP
  3.18 `textDocument/inlineCompletion` server.
- **Extensions are allowed.** `_meta` can go on any object, and custom
  methods are prefixed `_`. An unknown request answers -32601 and an unknown
  notification is ignored
  ([extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)).
  This gives us room to advertise the panel (for example
  `_meta.museSpark.panel`, or a `_museSpark/openPanel` request) without
  breaking any client.
- **Config options** are of two kinds, select and boolean. The reserved
  categories are `mode`, `model`, `model_config` and `thought_level`, and
  custom ones take a `_` prefix
  ([session config options](https://agentclientprotocol.com/protocol/v1/session-config-options)).
  Thinking, paid features and the Auto reviewer can be carried here as
  booleans.
- **The registry.** Fork [agentclientprotocol/registry](https://github.com/agentclientprotocol/registry)
  and add `<id>/agent.json` plus an optional 16×16 `currentColor` SVG.
  - `distribution` can be `npx` (`muse-spark-code-acp@x.y.z`).
  - CI requires an `agent` or `terminal` auth method.
  - Versions refresh hourly from npm.
  - Zed, JetBrains and Qt Creator read the feed
    ([registry docs](https://agentclientprotocol.com/get-started/registry)).
- **Other ACP clients we would reach for free** ([clients page](https://agentclientprotocol.com/get-started/clients)):
  - editors: Pulsar, Poolside Assistant for VS Code and Visual Studio, Unity;
  - notebooks and note-taking: Obsidian (4 clients), marimo, Jupyter;
  - terminals: Toad, acpx;
  - Devin Desktop and others.
- **Conclusion.** ACP is a second view of a session, and a good one. It can
  never carry the panel: it has no UI surface, no completions and no
  host-side editor services beyond `fs/*` and `terminal/*`. It should still
  carry everything it can (§3.6).

### 2.2 Zed (stable 1.22.0, 2026-09-30) — UI route C

- **Extensions** are Rust built to WASM (`zed_extension_api`). They can
  provide:
  - languages (Tree-sitter and language servers), themes, icon themes and
    snippets;
  - debug adapters;
  - MCP servers (`context_servers`).
  - Extension slash commands were removed, and extension-provided agent
    servers are deprecated in favour of the registry.
  - Sources: [developing extensions](https://github.com/zed-industries/zed/blob/main/docs/src/extensions/developing-extensions.md),
    [agent servers](https://zed.dev/docs/extensions/agent-servers),
    [slash commands](https://zed.dev/docs/extensions/slash-commands).
- **No custom UI and no webviews.** The Visual Extension API RFC is
  GPUI-only and excludes webviews. A maintainer said on 2026-05-21 it is
  "not something we're likely to get to in the near future"
  ([discussion #53403](https://github.com/zed-industries/zed/discussions/53403)),
  and side panels were closed as not planned
  ([#21400](https://github.com/zed-industries/zed/issues/21400)).
- **External agents.** A custom agent is configured as
  `agent_servers.<name> = {type: "custom", …}`.
  - Config options appear as dropdowns, and booleans since 1.11.3.
  - Other documented features: agent terminals, follow-along, threads
    imported from the agent's history, and Zed's MCP servers forwarded to
    the agent.
  - Zed's Claude Code post shows multibuffer review with per-hunk
    accept/reject.
  - The docs warn: "Restoring threads from history, checkpoints, token usage
    display… depend on the agent integration."
  - Sources: [external agents](https://github.com/zed-industries/zed/blob/main/docs/src/ai/external-agents.md),
    [agent panel](https://github.com/zed-industries/zed/blob/main/docs/src/ai/agent-panel.md),
    [Claude Code via ACP](https://zed.dev/blog/claude-code-via-acp),
    [1.11.3](https://zed.dev/releases/stable/1.11.3).
- **Edit predictions.** The providers are `zed`, `copilot`, `mercury`,
  `codestral`, `ollama` and `open_ai_compatible_api` (an `api_url` with
  `/v1/completions`), and extensions cannot add one
  ([edit prediction](https://github.com/zed-industries/zed/blob/main/docs/src/ai/edit-prediction.md)).
  Tab parity therefore means **our runtime serving an OpenAI-compatible
  completions endpoint on loopback**, behind Tab's own consent and its
  $1/day budget.
- **Upstream.** A CLA is required, and features start as a GitHub
  Discussion. Zed does **"not accept contributions from autonomous
  agents"** ([CONTRIBUTING](https://github.com/zed-industries/zed/blob/main/CONTRIBUTING.md)).
  A request for agent-provided panels must therefore come from the owner,
  as a Discussion. Extensions are published by PR to
  [zed-industries/extensions](https://github.com/zed-industries/extensions);
  the ID may not contain "zed" or "extension".
- **Parity route:**
  - the ACP agent in the Agent Panel, with registry install;
  - the companion panel, opened from a `/panel` command or a link in the
    thread;
  - a Zed extension that adds our MCP server, so Zed's agent tools can
    reach the panel's features;
  - `zed path:line` to open files;
  - the loopback completions endpoint for Tab.
  - Diagnostics and code intelligence come from the runtime's own LSP
    broker (§3.5), because Zed shows diagnostics only to its own agent.

### 2.3 Xcode — UI route C (a native WKWebView shell)

- **XcodeKit source editor extensions** can only add Editor-menu commands
  (`XCSourceEditorCommand.perform`). They see only the current buffer and
  its selections, have no UI, and must be embedded in a signed macOS app
  ([XcodeKit](https://developer.apple.com/documentation/xcodekit),
  [creating an extension](https://developer.apple.com/documentation/xcodekit/creating-a-source-editor-extension)).
- **ACP is supported since Xcode 26.6**, not only Xcode 27. The release
  notes say "Xcode adds support for the Agent Client protocol" (178294840).
  - An agent is added under Settings > Intelligence > Agents > Add an Agent.
    The command must be an **absolute path**, with no `~` and no `PATH`
    lookup.
  - Devin's docs report that Xcode has no model switcher for agents and does
    not show agents' slash commands.
  - Sources: [26.6 notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_6-release-notes),
    [setting up coding intelligence](https://developer.apple.com/documentation/xcode/setting-up-coding-intelligence),
    [Devin on Xcode](https://docs.devin.ai/cli/acp/xcode).
- **Xcode 27** (2026-09-14, Apple silicon only) adds **plugins**: skills, MCP
  servers and ACP agent configurations, installed from a git URL. It also
  adds plans as editable artifacts, diff and preview artifacts beside the
  transcript, and an agent sandbox
  ([27 notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes),
  [extending agents](https://developer.apple.com/documentation/xcode/extending-and-customizing-agents)).
  The plugin field that names an ACP agent was not found in the docs;
  confirm it on the Mac mini.
- **`xcrun mcpbridge`** gives outside agents Xcode's own tools: builds,
  diagnostics and more ([external agents](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode)).
  This is how F9 (the verify loop) and F30 get Xcode's real compiler
  output.
- **Signing.** An app that bundles a source editor extension needs
  Developer ID signing, App Sandbox for the extension, and notarization
  ([notarizing](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)).
- **Parity route: "Muse Spark Code for Xcode.app".** It is one signed and
  notarized container app that holds:
  - a WKWebView window running the companion panel;
  - the XcodeKit extension, with commands such as Send selection to Muse,
    Apply the last code block, and **Complete here**. Tab's default trigger
    is already Invoke (`Alt+\`, D73), so a key-bound command is an honest
    equivalent.
  - an Xcode 27 plugin (skills, MCP and the ACP agent);
  - `xed -l <line> <path>` to open files.

### 2.4 JetBrains, Visual Studio, Eclipse, Arduino IDE 2

#### JetBrains IntelliJ Platform (and Android Studio) — UI route E (JCEF)

- **JCEF.**
  - Check `JBCefApp.isSupported()` first: it is false on a JDK without JCEF.
  - The bridge: `JBCefBrowser` (or `createBuilder()`), `JBCefJSQuery.create`
    with `inject()` (asynchronous) for JS → Kotlin, and `executeJavaScript`
    for Kotlin → JS.
  - **Plugin resources are not reachable by default.** Serve them through
    `CefRequestHandler` / `CefResourceRequestHandler` on fixed URLs
    (`JCefImageViewer` is the reference).
  - Dispose the browser, the client and every query.
  - Source: [JCEF](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html).
- **Remote development, "Split Mode" (2025.3+).** `JBCefClient` and
  `ToolWindowFactory` are frontend APIs.
  - The documented pattern matches ours: the tool window on the frontend,
    the external CLI process on the backend, joined by `@Rpc` interfaces.
  - `VirtualFileManager` and `VfsUtil` are backend APIs. `Configurable`,
    `NotificationGroup` and `StatusBarWidgetFactory` are frontend APIs.
  - Sources: [split mode](https://plugins.jetbrains.com/docs/intellij/split-mode-and-remote-development.html),
    [shared APIs](https://plugins.jetbrains.com/docs/intellij/frontend-backend-shared-apis.html).
- **Tool windows**: `com.intellij.toolWindow` with a `ToolWindowFactory`
  and `ContentManager` tabs ([tool windows](https://plugins.jetbrains.com/docs/intellij/tool-windows.html)).
- **Editor**:
  - `Document`, `Editor` (`CaretModel`, `SelectionModel`) and
    `WriteCommandAction`, which takes the write lock and gives one undo.
  - VFS refresh: `refreshAndFindFileByPath` or `markDirtyAndRefresh`.
  - Sources: [documents](https://plugins.jetbrains.com/docs/intellij/documents.html),
    [editor basics](https://plugins.jetbrains.com/docs/intellij/editor-basics.html),
    [VFS](https://plugins.jetbrains.com/docs/intellij/virtual-file-system.html).
- **Diff**:
  - Two-way: `DiffContentFactory`, `SimpleDiffRequest` and
    `DiffManager.showDiff`. `createRequestPanel()` embeds it in our own UI.
  - Three-way: `DiffRequestFactory.createMergeRequest` and `showMerge`.
  - A side backed by a real `Document` gets the built-in per-chunk apply
    arrows: hunk review, natively.
  - Source: [diff-api source](https://github.com/JetBrains/intellij-community/tree/master/platform/diff-api/src/com/intellij/diff).
- **Diagnostics**:
  - `WolfTheProblemSolver` works at file level.
  - `DaemonCodeAnalyzerEx.processHighlights` iterates `HighlightInfo`, but
    it is an `impl` API, partly experimental, and covers only files the
    daemon has analysed.
  - `DAEMON_EVENT_TOPIC` signals when analysis finishes.
  - Plan for this: open the edited files, wait on the daemon event, read
    the highlights, and track the API in the Plugin Verifier.
- **Inline completion.** `InlineCompletionProvider` at
  `com.intellij.inline.completion.provider`.
  - Debouncing is built in, suggestions stream as a `Flow`, and 2024.1
    added multiple variants.
  - Tests use `CodeInsightTestFixture.testInlineCompletion`.
  - Sources: [source](https://github.com/JetBrains/intellij-community/blob/idea/241.18034.62/platform/platform-impl/src/com/intellij/codeInsight/inline/completion/InlineCompletionProvider.kt),
    [migration](https://github.com/orgs/community/discussions/116679).
  - F42 is native here.
- **Terminal.** The Reworked terminal API (2025.3+, **experimental**):
  - `TerminalToolWindowTabsManager` and `sendText`;
  - shell integration gives command blocks with the exit code.
  - Source: [terminal](https://plugins.jetbrains.com/docs/intellij/embedded-terminal.html).
- **PasswordSafe** is backed by the OS stores (Windows uses a KeePass file).
  - Before 2025.3 it stored credentials in plain text on a remote backend
    ([sensitive data](https://plugins.jetbrains.com/docs/intellij/persisting-sensitive-data.html)).
  - **We do not use it for the key**: D61's OS entry stays the single
    store.
- **Persistence, settings and the rest**: `PersistentStateComponent`,
  `Configurable`, notification groups, `AnAction` and status bar widgets
  ([settings](https://plugins.jetbrains.com/docs/intellij/settings-guide.html),
  [notifications](https://plugins.jetbrains.com/docs/intellij/notifications.html),
  [status bar](https://plugins.jetbrains.com/docs/intellij/status-bar-widgets.html)).
- **Build.** IntelliJ Platform Gradle Plugin **2.19.0** (needs Gradle 9 and
  Java 17 or later to run). Its tasks:
  - `runIde`, `verifyPlugin` (Plugin Verifier) and `signPlugin`;
  - `publishPlugin`, with a token;
  - `testIde` and `testIdeUi`;
  - **`buildPluginVariants`, six per-OS/arch zips**, which lets us bundle
    the official Node per platform.
  - Tests:
    - `BasePlatformTestCase` runs headless;
    - the Starter and Driver integration framework (JUnit 5) has
      experimental UI parts.
  - Sources: [Gradle plugin](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin.html),
    [tasks](https://plugins.jetbrains.com/docs/intellij/tools-intellij-platform-gradle-plugin-tasks.html),
    [integration tests](https://plugins.jetbrains.com/docs/intellij/integration-tests-intro.html),
    [signing](https://plugins.jetbrains.com/docs/intellij/plugin-signing.html).
- **JDK and Kotlin.**
  - **Java 21** for 2024.2–2026.1, **Java 25 for 2026.2**.
  - Use the IDE's bundled Kotlin and coroutines; a plugin must not ship its
    own.
  - Source: [build numbers](https://plugins.jetbrains.com/docs/intellij/build-number-ranges.html).
- **Marketplace.**
  - Steps: a JetBrains Account, the Developer Agreement, a vendor profile
    and an EULA.
  - **The first upload is manual, and every update is reviewed by hand.**
  - The name has at most 30 characters and no "Plugin", "IntelliJ" or
    product names. "Muse Spark Code (Unofficial)" is 28.
  - Signing is optional, but an unsigned plugin warns on install.
  - Sources: [uploading](https://plugins.jetbrains.com/docs/marketplace/uploading-a-new-plugin.html),
    [approval guidelines](https://plugins.jetbrains.com/docs/marketplace/jetbrains-marketplace-approval-guidelines.html).
- **ACP in JetBrains (2025.3+).**
  - Custom agents go in `~/.jetbrains/acp.json`, or come from the registry,
    with no AI subscription needed.
  - Changed-file diffs open in the editor beside the chat.
  - The IDE can pass its own IntelliJ MCP server to the agent.
  - WSL is not supported.
  - Sources: [ACP](https://www.jetbrains.com/help/ai-assistant/acp.html),
    [ACP registry](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/).
- **Android Studio.** Rabbit 1 (2026.2.1, stable 2026-10-01) runs on
  platform 262, so it builds with Java 25.
  - Build it with `androidStudio("<ver>")`.
  - Depend only on `com.intellij.modules.platform`, to stay portable.
  - Unverified: whether AI Assistant's ACP is available inside it.
  - Sources: [Android Studio](https://plugins.jetbrains.com/docs/intellij/android-studio.html),
    [releases](https://jb.gg/android-studio-releases-list.json).

#### Visual Studio 2022 / 2026 — UI route E (WebView2, in-process)

- **The extension model.**
  - VisualStudio.Extensibility runs out of process (.NET 8, moving to .NET
    10). Its tool windows are **Remote UI**: one XAML `DataTemplate` with
    no code-behind or event handlers.
  - WebView2 can be placed in that XAML, but `WebMessageReceived` and
    `ExecuteScriptAsync` cannot be wired up there (inferred from the docs
    and Q&A).
  - **So the extension is a VSSDK-compatible in-process one**:
    `RequiresInProcessHosting=true`, .NET Framework 4.7.2,
    `ExtensionType="VSSDK+VisualStudio.Extensibility"`, with a classic
    `ToolWindowPane` hosting the WPF WebView2 control.
  - Sources: [Remote UI](https://learn.microsoft.com/en-us/visualstudio/extensibility/visualstudio.extensibility/inside-the-sdk/remote-ui),
    [in-proc extensions](https://learn.microsoft.com/en-us/visualstudio/extensibility/visualstudio.extensibility/get-started/in-proc-extensions),
    [Q&A](https://learn.microsoft.com/en-us/answers/questions/2149139/how-to-add-webview2-to-a-visualstudio-extensibilit).
- **Editor.** `EditAsync` batches over `ITextViewSnapshot`, plus listeners
  ([editor](https://learn.microsoft.com/en-us/visualstudio/extensibility/visualstudio.extensibility/editor/editor)).
  **There is no diff API in the new model**, so diffs use
  `IVsDifferenceService.OpenComparisonWindow2`
  ([API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualstudio.shell.interop.ivsdifferenceservice.opencomparisonwindow2)).
  Hunk accept/reject is our `DiffPage`.
- **Diagnostics.**
  - Read: the classic `IErrorList`.
  - Write: the new model's diagnostics.
  - Sources: [IErrorList](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualstudio.shell.ierrorlist),
    [MarkdownLinter sample](https://github.com/microsoft/VSExtensibility/tree/main/New_Extensibility_Model/Samples/MarkdownLinter).
- **Code intelligence.** There is no cross-language public API. Use Roslyn's
  `VisualStudioWorkspace` and `SymbolFinder` for C# and VB, and the
  runtime's LSP broker (clangd and others) for the rest. This is an
  inference to check during the prototype.
- **Terminal.** No public integrated-terminal API in either model. Use the
  OS terminal (Windows Terminal) plus the panel's `TerminalOutput`.
- **Settings.** The new model's Settings API (17.11+) is still
  experimental. Use our React `SettingsPage` and the runtime store, plus a
  classic options page that hosts it
  ([settings](https://learn.microsoft.com/en-us/visualstudio/extensibility/visualstudio.extensibility/settings/settings)).
- **Notifications.** `ShowPromptAsync` in the new model, or the classic
  InfoBar ([InfoBar](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualstudio.shell.interop.ivsinfobaruifactory)).
- **Credentials.** The classic `IVsCredentialStorageService`. **Not used
  for the key** (D61).
- **Inline completion.** `Microsoft.VisualStudio.Language.Proposals` exists,
  but Microsoft says "the API has not been finalized"
  ([API](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualstudio.language.proposals),
  [Q&A](https://learn.microsoft.com/en-us/answers/questions/1331998/questions-about-the-visual-studio-proposals-api)).
  **F42 here is ours to build**: an `IWpfTextView` adornment layer for ghost
  text, with Tab and Esc command filters. The Proposals API is used only
  when detected, and stays behind a version check.
- **Agents.** Copilot agent mode reads **MCP** from `.mcp.json` and
  `.vs\mcp.json`. **There is no native ACP**; the ACP list names only
  Poolside Assistant, and ReSharper 2026.2 runs Junie only
  ([MCP in VS](https://learn.microsoft.com/en-us/visualstudio/ide/mcp-servers),
  [ReSharper 2026.2](https://blog.jetbrains.com/dotnet/2026/07/22/resharper-2026-2-release/)).
  The native extension is therefore the only full route.
- **Packaging.**
  - A `.vsix` with `source.extension.vsixmanifest`. The range
    `[17.0,18.0)` installs in both VS 2022 and VS 2026
    ([compatibility](https://learn.microsoft.com/en-us/visualstudio/extensibility/migration/extension-compatibility)).
  - Published with `VsixPublisher.exe` and a `publishManifest.json`, using
    an Azure DevOps PAT with Marketplace scope.
  - Publishers live in the same portal as VS Code's
    ([publishing](https://learn.microsoft.com/en-us/visualstudio/extensibility/walkthrough-publishing-a-visual-studio-extension-via-command-line)).
  - Signing is optional, with the `sign` dotnet tool, and **self-signed
    certificates are not accepted**
    ([signing](https://learn.microsoft.com/en-us/visualstudio/extensibility/signing-vsix-packages)).
- **Tests.**
  - The experimental instance (`/rootsuffix Exp`).
  - `Microsoft.VisualStudio.Extensibility.Testing.Xunit` (`[IdeFact]`) is
    **archived**; its development moved into dotnet/roslyn
    ([vs-extension-testing](https://github.com/microsoft/vs-extension-testing)).
  - `windows-latest` moved to **VS 2026 18.5** in June 2026
    ([runner images](https://github.com/actions/runner-images/issues/14016)).
  - The plan:
    - unit tests of the adapter against an MHP fake;
    - `[IdeFact]` tests at a pinned version, on the Win11 VM and on
      `windows-latest`;
    - hosted-runner UI reliability treated as unverified until measured.

#### Eclipse (and Espressif-IDE) — UI route E (SWT Browser)

- **SWT Browser.**
  - **Edge (WebView2) is the default on Windows since 4.35** (2025-03). The
    WebView2 Runtime must be present; Windows 11 ships it.
  - WebKitGTK on Linux, WebKit on macOS. Chromium was removed from SWT.
  - JS → Java: `BrowserFunction`.
  - Java → JS: `execute()` (asynchronous on Edge) or `evaluate()`.
  - Sources: [4.35 news](https://eclipse.dev/eclipse/news/4.35/platform.html),
    [SWT FAQ](https://eclipse.dev/eclipse/swt/faq.html),
    [BrowserFunction](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/swt/browser/BrowserFunction.html).
- **Workbench APIs:**
  - **Compare:** `CompareEditorInput` and `CompareUI.openCompareEditor`;
    three-way merge with an ancestor.
  - **Editors:** `ITextEditor`, then `IDocument`.
  - **Problems:** `IResource.findMarkers(IMarker.PROBLEM, …)`.
  - **Secure storage:** `ISecurePreferences`. Not used for the key.
  - **Terminal:** moved into the Platform in **4.37** (2025-09) as the
    `org.eclipse.terminal.*` bundles (`ITerminalService.openConsole`).
  - **Preferences and views:** preference pages, plus `ViewPart` or e4
    parts.
  - Sources: [compare](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/compare_beyond.htm),
    [markers](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/resAdv_markers.htm),
    [secure storage](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/guide/secure_storage_dev.htm),
    [terminal](https://github.com/eclipse-platform/eclipse.platform/tree/master/terminal).
- **Code intelligence**: JDT for Java and CDT for C/C++ (which matters for
  Espressif). LSP4E-backed editors, or the runtime's LSP broker, for the
  rest.
- **Ghost text.** There is no platform API. Copilot for Eclipse uses **JFace
  code minings** (`LineContentGhostText`, `BlockGhostText`), and falls back
  to painting on `StyledText`
  ([source](https://github.com/microsoft/copilot-for-eclipse/tree/main/com.microsoft.copilot.eclipse.ui/src/com/microsoft/copilot/eclipse/ui/completion),
  [ICodeMiningProvider](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/jface/text/codemining/ICodeMiningProvider.html)).
  F42 is ours to build, in the same way.
- **Build.**
  - **Tycho 5.0.4 needs Java 21 and Maven 3.9.9 or later.**
  - Packaging types: `eclipse-plugin`, `-feature`, `-repository` (the p2
    site) and `eclipse-test-plugin` (tycho-surefire, Xvfb for UI tests).
  - Signing: jarsigner, or PGP through `tycho-gpg-plugin`. Unsigned content
    raises the "Trust Artifacts" dialog.
  - Sources: [Tycho release notes](https://github.com/eclipse-tycho/tycho/blob/tycho-5.0.x/RELEASE_NOTES.md),
    [PGP signing](https://tycho.eclipseprojects.io/doc/latest/tycho-gpg-plugin/sign-p2-artifacts-mojo.html),
    [p2 trust](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.user/reference/ref-p2-trust.htm).
  - p2 fragments with OS and arch filters can carry Node per platform.
- **Marketplace.**
  - An Eclipse account, then "Add Content". **A p2 update-site URL is
    required.** Moderation takes about 24 business hours
    ([quickstart](https://marketplace.eclipse.org/content/eclipse-marketplace-quickstart)).
- **Espressif-IDE 4.4.0** (2026-08-11) targets **Eclipse 2026-03 (4.39)**.
  - It bundles CDT and the IDF plugins, and needs Java on `PATH`.
  - It is a standard Eclipse, so Help > Install New Software should take
    our update site (inferred; Espressif does not say).
  - Sources: [releases](https://github.com/espressif/idf-eclipse-plugin/releases),
    [Marketplace update](https://docs.espressif.com/projects/espressif-ide/en/latest/marketplaceupdate.html).
- **ACP in Eclipse.**
  - There is no Foundation client.
  - The community **Eclipse ACP Connector** (Apache-2.0, updated
    2026-10-01, Eclipse 2026-03 through 2026-12) has a chat view,
    permissions and auth, and mode, model and reasoning selectors
    ([Marketplace](https://marketplace.eclipse.org/content/eclipse-acp-connector)).
  - IBM's eclipse-agents is a prototype
    ([GitHub](https://github.com/eclipse-agents/eclipse-agents)).
  - These give the inferred Ecl column today. The native plugin is the
    parity route.

#### Arduino IDE 2 — UI route E (it is Theia: the VSIX), after a floor check

- **Arduino IDE 2.3.10** (2026-06-09) runs `@theia/plugin-ext-vscode`
  **1.57**, which declares `DEFAULT_SUPPORTED_API_VERSION = '1.96.0'`.
- There is no gallery UI. Plugins come from Open VSX at build time, and
  users drop a `.vsix` into `~/.arduinoIDE/plugins` (Theia's convention, not
  documented by Arduino).
- Sources: [package.json](https://github.com/arduino/arduino-ide/blob/main/electron-app/package.json),
  [Theia api.ts](https://github.com/eclipse-theia/theia/blob/v1.57.0/dev-packages/application-package/src/api.ts),
  [comparator](https://eclipse-theia.github.io/vscode-theia-comparator/status.html).
- **The parity route:**
  - M62a's audit, repeated at 1.96: typecheck against `@types/vscode` 1.96,
    and check the Electron and Node version Arduino ships against our
    `node20.18` and `chrome128` targets;
  - then lower the floor to `^1.96.0` if both pass;
  - otherwise a separate Arduino build of the VSIX;
  - qualified in `hosts.yml` from the Linux AppImage.

### 2.5 Qt Creator (20.0.2) — UI route C, plus a Lua shim

- **ACP client.** Qt Creator 20 has an ACP client built in, as a C++ plugin
  in `src/plugins/acpclient`. It has:
  - v1 and v2 adapters;
  - handlers for permissions, `fs`, terminals and **elicitation**;
  - a session picker, config options, a tool-call detail view and an ACP
    inspector;
  - a Plan / Default / Accept Edits mode selector, `/` commands, and the
    editor context attached to prompts.
  - A separate **MCP Server** extension lets agents run builds and other IDE
    actions.
  - Qt AI Assistant retires (end of support 2026-12-31).
  - Sources: [ACP client](https://doc.qt.io/qtcreator/creator-how-to-use-acp-client.html),
    [Qt Creator 20](https://www.qt.io/blog/qt-creator-20-released),
    [source](https://github.com/qt-creator/qt-creator/tree/master/src/plugins/acpclient),
    [AI Assistant retirement](https://www.qt.io/blog/qt-ai-assistant-retires-as-we-invest-in-agentic-development-tools).
- **Plugin API.** C++ plugins must match Qt Creator's exact version.
  - **Lua extensions** (since 14, Lua 5.4) have modules for actions, async,
    fetch, gui, lsp, process, settings and the text editor.
  - The `gui` module has no web view and no dock widget
    ([Lua extensions](https://doc.qt.io/qtcreator-extending/lua-extensions.html),
    [gui](https://doc.qt.io/qtcreator-extending/lua-extension-meta-gui.html)).
  - Whether the official builds ship QtWebEngine for third-party plugins is
    unverified, so assume they do not.
- **Distribution.** By PR to
  [qt-creator/extension-registry](https://github.com/qt-creator/extension-registry)
  ([distributing](https://doc.qt.io/qtcreator-extending/distributing-plugins.html)).
- **Parity route:**
  - ACP through the built-in client, with our agent routing Model API reads
    and writes through `fs/*`;
  - Qt Creator's MCP Server passed to the agent, for builds and diagnostics;
  - a **Lua extension shim** that speaks MHP through `process`: editor
    context, applying edits, Muse actions, and opening the companion panel;
  - its `lsp` module to register `muse-spark-code-acp lsp` for Tab, provided
    Qt Creator's LSP client takes `inlineCompletion` (unverified; otherwise
    an Invoke action that inserts the completion).

### 2.6 Neovim (0.12.5) — UI route C, plus a Lua shim

- **ACP clients.** CodeCompanion (custom adapters; config options for model,
  reasoning and mode), agentic.nvim (diff preview, numbered permission
  choices, mode and model, `/` completion, session restore) and avante.nvim
  ([CodeCompanion ACP](https://codecompanion.olimorris.dev/configuration/adapters-acp),
  [agentic.nvim](https://github.com/carlos-algms/agentic.nvim),
  [avante.nvim](https://github.com/yetone/avante.nvim)).
- **Lua API.** Floating windows; extmarks with `virt_text_pos="inline"` and
  `virt_lines` for ghost text; `vim.text.diff`; `jobstart`; terminals;
  `vim.ui.select`.
  - **`vim.lsp.inline_completion`** (LSP 3.18) is built in, so any LSP server
    can supply ghost text
    ([0.12 news](https://github.com/neovim/neovim/blob/release-0.12/runtime/doc/news.txt),
    [PR #33972](https://github.com/neovim/neovim/pull/33972)).
- **No webview.** Rich display opens a browser against localhost, as
  [markdown-preview.nvim](https://github.com/iamcco/markdown-preview.nvim)
  does.
- **Distribution.** lazy.nvim specs, `vim.pack` (0.12), and luarocks /
  rocks.nvim ([lazy packages](https://lazy.folke.io/packages)).
- **Parity route: the `muse.nvim` shim.** It implements MHP:
  - buffers with `changedtick` as the version, `nvim_buf_set_text` with
    undojoin, and `vim.diagnostic.get`;
  - a diff tab with `diffthis`, terminals, and `vim.ui` pickers;
  - the `muse-spark-code-acp lsp` server for Tab;
  - the companion panel in the browser.
  - The ACP clients stay supported as a second view.

### 2.7 Emacs — UI route E (xwidget-webkit) where built, otherwise C; plus an elisp shim

- **ACP clients.** agent-shell on acp.el, both on MELPA. It has permission
  prompts, diffs, mode, model and effort, `/` commands, session resume and
  list, and images ([agent-shell](https://github.com/xenodium/agent-shell),
  [acp.el](https://github.com/xenodium/acp.el)).
- **xwidget-webkit** needs `--with-xwidgets`: WebKitGTK on GTK3/X, or macOS.
  There is no Windows backend, so treat it as optional
  ([manual](https://www.gnu.org/software/emacs/manual/html_node/emacs/Embedded-WebKit-Widgets.html)).
- **MELPA** requires one recipe per PR, a GPL-compatible licence,
  package-lint, checkdoc and a clean byte-compile. **It now asks AI-assisted
  code to carry an "Assisted-by: AGENT_NAME:MODEL_VERSION" header**
  ([CONTRIBUTING](https://github.com/melpa/melpa/blob/master/CONTRIBUTING.org)).
- **Building blocks.** auth-source, overlays (`after-string`) for ghost text,
  ediff and smerge for diffs, flymake for diagnostics, and `make-process`
  pipes.
- **Parity route: the `muse-spark.el` shim.** It implements MHP:
  - buffers through `buffer-chars-modified-tick`, edits in an
    `atomic-change-group` (one undo), flymake or flycheck diagnostics, and
    ediff;
  - overlay ghost text for Tab, or LSP `inlineCompletion` through eglot or
    lsp-mode where supported (unverified);
  - the companion panel inside an xwidget buffer when available, else in
    the browser.

### 2.8 Sublime Text 4 — UI route C, plus a Python shim

- **Python.** The 3.3 host is deprecated ("removed in 2026"). **Since build
  4205 the 3.8 host is replaced by 3.14**
  ([API environments](https://www.sublimetext.com/docs/api_environments.html)).
- **UI.** minihtml (no JavaScript) in popups, phantoms and HTML sheets;
  output panels; regions. There is no ghost-text API; LSP-copilot draws
  phantoms ([API reference](https://www.sublimetext.com/docs/api_reference.html),
  [minihtml](https://www.sublimetext.com/docs/minihtml.html)).
- **ACP.** The community package "ACP" (debjan, v1.8.1) has a chat tab,
  model and mode switching, `/` commands, and session switch, rename and
  fork ([sublime-acp](https://github.com/debjan/sublime-acp)).
- **Publishing.** By PR to
  [sublimehq/package_control_channel](https://github.com/sublimehq/package_control_channel);
  the docs still name the old wbond repo
  ([submitting](https://packagecontrol.io/docs/submitting_a_package)).
- **Parity route: a Sublime package shim** (Python 3.14 host). It speaks MHP
  over subprocess pipes in a thread:
  - views, versions (`change_count`), `TextCommand` edits, and an output
    panel;
  - phantom ghost text for Tab;
  - diagnostics from the runtime's LSP broker, since Sublime has no native
    diagnostics API;
  - the companion panel in the browser.

### 2.9 Precedent for a companion UI on loopback

- **OpenCode.** `opencode web` serves on 127.0.0.1 at a random port and
  opens the browser. A password can be set with `OPENCODE_SERVER_PASSWORD`,
  and `opencode attach` connects the TUI to the same sessions
  ([web](https://opencode.ai/docs/web/), [server](https://opencode.ai/docs/server/)).
- **Others with a loopback UI:** `aider --browser`
  ([Aider](https://aider.chat/docs/usage/browser.html)) and `openhands
serve` ([OpenHands](https://docs.openhands.dev/openhands/usage/cli/gui-server)).
- **Codex App Server.** One JSON-RPC agent process serves every front end:
  VS Code, JetBrains, Xcode, desktop and web
  ([OpenAI](https://openai.com/index/unlocking-the-codex-harness/)). This is
  the architecture proposed in §3.

---

## 3. Proposed architecture: one core, one UI, a host adapter per editor

### 3.1 Principles

1. **Parity is defined by the feature registry, not by the protocol a host
   speaks.**
   - Every feature F1–F56, and every later one, has one row per editor.
   - An editor is "Supported" only when every row is W, with test evidence.
   - What the host lacks, we build: a host-native implementation first, our
     own fallback second, and never "not available".
   - The only exception is a capability the host makes physically impossible
     (for example Zed's lack of webviews). Each one is named, has an
     equivalent in our companion panel, and has an upstream request filed.
2. **One controller.**
   - The `ConversationController`, and every feature module the panel uses,
     runs in VS Code's extension host _and_ in the standalone runtime.
   - The ACP agent stops being a second, smaller product. It becomes one
     more view of the same sessions.
3. **One contract.** The **Muse Host Protocol (MHP) v1** is a versioned,
   zod-validated JSON-RPC protocol. It replaces `ConversationDeps` as the
   editor-services contract (M61 step 4, finally).
   - VS Code implements it in-process, so its behaviour does not change.
   - Every other editor implements it over stdio.
4. **One UI.** One React bundle with three bridges:
   - VS Code;
   - embedded (JCEF, WebView2, SWT Browser, Emacs xwidget, WKWebView);
   - companion (loopback HTTP and SSE).
     Every editor-native widget the panel uses today (modals, quick picks,
     the Settings editor, the walkthrough, the diff editor, the status item,
     notifications) gets a React fallback, so a host without one still has
     the feature.
5. **The rules hold everywhere.**
   - Rule 8: the Model API key lives in the runtime's OS store (D61), and
     never crosses MHP, the UI or the companion.
   - Rule 12: paid consent is our own popup, decided in the runtime. Paid
     features therefore become available in every editor, not just behind
     ACP launch flags.
   - Rule 7: zod both ways.
   - Rule 11 (the name) and D44 (below 1.0).

### 3.2 Processes and transports

```text
 Editor                                    Muse runtime (Node 22; one per editor window)
 ┌───────────────────────────────┐  MHP   ┌──────────────────────────────────────────────┐
 │ Host adapter                  │◄──────►│ ConversationController + feature modules      │
 │  T1 VS Code: in-process       │ stdio  │  (checkpoints, review, best-of-N, schedules,  │
 │  T2 JetBrains / VS / Eclipse: │        │   paid ledger, Tab engine, judge, roles, …)   │
 │     native plugin             │        │ AgentHost: Muse Code | Model API (+ M95)      │
 │  T3 Nvim / Emacs / Sublime /  │        │ OS key store (D61) · data folder · LSP broker │
 │     Qt (Lua) / Xcode app:     │  ui/*  │ ACP endpoint (stdio; existing, re-based)      │
 │     thin shim                 │◄──────►│ Companion server (loopback, T3 only)          │
 │ UI container: webview · JCEF ·│        └──────────────────────────────────────────────┘
 │  WebView2 · SWT · xwidget —   │                     ▲ HTTP + SSE, token, Host/Origin
 │  or none (companion)          │                     │
 └───────────────────────────────┘           browser tab · `--app` window · WKWebView
```

- **T1, in-process (the VS Code family).**
  - `src/extension.ts` builds the controller from a `HostServices` object
    implemented with `vscode` (`src/host/vscode/**`).
  - The webview keeps `postMessage`, so there is no visible change.
- **T2, embedded (JetBrains, Visual Studio, Eclipse).**
  - The plugin spawns `muse-spark-code-acp panel --stdio --host <id>`.
  - One JSON-RPC stream, framed as ACP's (NDJSON), carries:
    - `host/*`: runtime → plugin requests;
    - `editor/*`: plugin → runtime events;
    - `ui/*`: webview messages relayed both ways.
  - UI assets come from the plugin's own resources through a custom scheme
    or virtual host, so **no listening socket is opened**.
  - The webview's bridge is `embeddedHostBridge`. It reads a 30-line
    `window.museHost` shim that each plugin injects, mapped to
    `JBCefJSQuery`, `chrome.webview` or `BrowserFunction`.
- **T3, companion (Zed, Xcode, Qt Creator, Neovim, Emacs without xwidgets,
  Sublime).**
  - `panel --companion` binds `127.0.0.1:0` and serves:
    - `/`, the UI;
    - `/events`, SSE from host to UI;
    - `/post`, UI to host;
    - `/session`, which exchanges the launch code.
  - It opens in the default browser, in a Chrome or Edge `--app` window when
    one is found, in an Emacs xwidget, or in the Xcode app's WKWebView.
  - Editor actions take the first route that exists, in this order:
    1. the editor's thin shim over MHP (stdio);
    2. ACP client capabilities (`fs/*`, `terminal/*`) when the same process
       is the editor's ACP agent;
    3. the editor's CLI launcher to open at a line: `zed`, `xed -l`, `subl`,
       `emacsclient +N`, `nvim --server … --remote`, `qtcreator -client`;
    4. otherwise the cell is M, and named.
- **ACP pairing.** When an editor starts `muse-spark-code-acp` as its ACP
  agent:
  - The agent's sessions run through the runtime's controller registry
    rather than straight on `AgentHost`. D62's translation rules are
    unchanged.
  - A `/panel` command (and `_meta.museSpark.panel` on `initialize` and
    `session_info_update`) opens the companion panel **on the same
    session**.
  - The editor's chat and our panel are then two views of one conversation.
  - Checkpoints, review, schedules and the budget apply to ACP sessions too.
    This closes `docs/acp.md` lines 15–19, where the ACP agent is outside the
    checkpoint namespace.

### 3.3 MHP v1: the editor-services contract

MHP lives in `src/shared/hostApi/` (zod schemas, method table, capability
names), with a client in `src/runtime/panel/` and an in-process VS Code
implementation. Every method has a capability flag, which is negotiated at
`initialize` (M61 step 6). The runtime picks the native route when the host
offers it and its fallback otherwise.

| Group       | Methods (direction runtime→host unless noted)                                                                                                                                                                             | Today's source (`ConversationDeps` / VS Code)                                          | Fallback when the host lacks it                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| lifecycle   | `initialize` (host id and version, MHP range, capabilities, locale, theme tokens, folders, trust), `shutdown`, `$/cancelRequest`                                                                                          | `activate`, `env.language`                                                             | — (required)                                                                                                                     |
| workspace   | `folders`, `trust` + `didGrantTrust`, `findFiles`, `openFolder` (new window)                                                                                                                                              | `workspaceFolders`, `isTrusted`, `findFiles`, `vscode.openFolder`                      | `git ls-files` or the walker (`runtime/fileWalk.ts`); CLI launcher                                                               |
| documents   | `list` (uri, version, dirty, languageId), `read` (buffer text, unsaved included), `applyEdits` (uri, **expected version**, edits, undo label; atomic), `save`, `saveAll`; host→runtime `didChange`, `didSave`, `didClose` | `unsavedFiles`, `saveAll`, `isAutosaveEnabled`, `workspace.applyEdit`, `textDocuments` | disk only, with a dirty-buffer refusal (M72's rule)                                                                              |
| editor      | `active`, `didChangeSelection` (bounded excerpt), `open` (uri, range), `insertAtCursor`, `replaceSelection`                                                                                                               | `editorContext`, `openFile`, `insertCode`, `applyCode`                                 | CLI launcher (open only); copy to the clipboard plus a notice                                                                    |
| diff        | `open` (left and right, title), `review` (hunks; host→runtime accept/reject)                                                                                                                                              | `vscode.diff`, `editReview`                                                            | **React `DiffPage`** (side by side, hunk accept/reject, reusing `src/webview/diff.ts`)                                           |
| diagnostics | `get`, host→runtime `didChange`                                                                                                                                                                                           | `languages.getDiagnostics` (`verifyEditor.ts`)                                         | **runtime LSP broker** (§3.5); the verify loop's check commands                                                                  |
| codeIntel   | `definition`, `references`, `documentSymbols`, `workspaceSymbols`, `hover`, `prepareRename`, `rename`, `callHierarchy`, `format`                                                                                          | `LanguageServiceHost` (`src/core/codeIntel/languageService.ts:88`)                     | runtime LSP broker                                                                                                               |
| terminal    | `create` (cwd, command, allowlisted env), `show`, `sendText`                                                                                                                                                              | `createTerminal`                                                                       | OS terminal (`wt`, `open -a Terminal`, `x-terminal-emulator`)                                                                    |
| ui          | `notify`, `confirm` (modal), `pick`, `input` (**never a secret**), `openExternal`, `clipboard`, `status`, `progress`                                                                                                      | `showWarningMessage` and similar, quick picks, `withProgress`, the status item         | **React** `ConfirmDialog`, `PickerDialog`, `InputDialog`, `Toasts`, `StatusStrip`; `open`                                        |
| surfaces    | `open` (chat, tasks, whatsNew, models, traffic, settings, walkthrough, diff; side, tab or window), `focus`, `state`                                                                                                       | `createWebviewPanel`, view provider, `moveEditorToNewWindow`                           | companion tabs                                                                                                                   |
| settings    | `get`, `update`, `didChange`, over the **one schema** (`package.json` `contributes.configuration`)                                                                                                                        | `getConfiguration`                                                                     | runtime settings store in the data folder (per user, per workspace hash)                                                         |
| storage     | `global.get/set`, `workspace.get/set`                                                                                                                                                                                     | `globalState`, `workspaceState`                                                        | runtime data folder (default for every non-VS Code host)                                                                         |
| commands    | `register` (id, title, suggested key); host→runtime `execute`                                                                                                                                                             | `registerCommand`, `keybindings`                                                       | panel palette                                                                                                                    |
| tab         | `register` (languages, trigger); host→runtime `complete` (uri, version, position, context), `accepted`, `rejected`                                                                                                        | `registerInlineCompletionItemProvider` (0.14)                                          | `muse-spark-code-acp lsp` (`inlineCompletion`); loopback `/v1/completions` (Zed); an Invoke command that inserts (Xcode)         |
| voice       | `capture` (optional host microphone)                                                                                                                                                                                      | dictation helpers spawned by the host                                                  | runtime spawns the same OS helpers (M9); Muse Voice through `getUserMedia` on the companion page (127.0.0.1 is a secure context) |
| auth        | `github` (token provider for M71)                                                                                                                                                                                         | `authentication.getSession('github')`                                                  | runtime runs `gh` (its own credential store; we never read the token)                                                            |
| window      | `state` (focused), `attention`                                                                                                                                                                                            | `window.state`, `notifyAttention`                                                      | companion `Notification` API                                                                                                     |

**There is no `secrets/*` method in v1, by design.** The key is entered
with `auth set` in a terminal (`terminal/create`, or an OS terminal), which
is D61 unchanged.

### 3.4 UI: bridges, tokens and fallbacks

- `src/webview/bridges/{vscode,embedded,companion}.ts` implement
  `HostBridge`. `main.tsx` picks one from `document.body.dataset.host`.
  The Tasks, What's New, Models and Traffic surfaces move onto the bridge;
  that fixes `main.tsx:26-39` and `whatsNew/main.ts:7`.
- **Theme tokens (M61.3).** About 61 `--muse-*` tokens, each host mapping
  its own colours onto them:
  - **VS Code** maps them once from its `--vscode-*` variables.
  - **JetBrains** sends `JBColor` / `UIManager` colours and **Visual Studio**
    its `EnvironmentColors`.
  - **Eclipse** sends its `ColorRegistry`.
  - **The companion** has light, dark and high-contrast presets, plus
    colours the shim reads from the editor (`nvim_get_hl`, `face-attribute`,
    Sublime's colour scheme).
  - M37's axe gate runs over every token set.
- **The page HTML** (CSP, nonce, the embedded string table) moves from
  `webviewSetup.ts` and `src/host/html.ts` into a portable
  `src/host/ui/pageHtml.ts`, with a host-specific `resourceUrl()`.
- **React fallback components:**
  - `ConfirmDialog`, which carries D48's paid popup and D78's budget dialog
    with the same text as VS Code's modal;
  - `PickerDialog`, `InputDialog`, `Toasts` and `StatusStrip` (Tab, judge);
  - `SettingsPage`, generated from the manifest schema;
  - `Walkthrough`, from `resources/walkthrough`;
  - `DiffPage` and `TerminalOutput`.
  - The skills, MCP, hooks, memory and worktree managers, today quick
    picks, become panel pages that VS Code may keep as quick picks.

### 3.5 Runtime: the panel mode

- **A shared composition module.** `src/host/compose/conversationDeps.ts`
  builds `ConversationDeps` from `HostServices`, and is shared by
  `extension.ts` and `src/runtime/panel/main.ts`.
  - The feature wiring now in `extension.ts` (2,842 lines) and the 24
    `vscode`-importing files moves into portable `src/host/features/**`.
  - Only `src/host/vscode/**` and `src/extension.ts` may import `vscode`
    (the M60 gate, tightened).
- **The lazy bundles** (`modelApi.js`, checkpoints, review, best-of-N,
  `tab.js`, judge, providers) load from the same `dist/` in both hosts.
- **The LSP broker** (`src/runtime/lsp/`) is new. It backs code intelligence
  and diagnostics wherever the host has no language API (Zed, Sublime,
  terminal editors):
  - It drives the language servers already on the machine
    (`typescript-language-server`, `pyright`, `clangd`, `rust-analyzer`,
    `gopls`, …).
  - Servers are configured per workspace, in a trusted folder only, under
    the same process-tree and environment rules as hooks.
  - It implements the existing `LanguageServiceHost`, so M67's tools do not
    change.
- **`muse-spark-code-acp lsp`** is an LSP server that offers
  `textDocument/inlineCompletion`, backed by M94's engine and its daily
  ledger. It serves Neovim 0.12, and Emacs, Sublime and Qt Creator where
  their LSP clients take it.
- **Node for native plugins.**
  - Each plugin carries the platform-neutral `dist/` JS and
    `@napi-rs/keyring`'s prebuilt `.node` files.
  - **Where the channel has per-platform artifacts, it also bundles the
    official Node 22 LTS binary for that platform:**
    - JetBrains' `buildPluginVariants` (six OS/arch zips);
    - Visual Studio (Windows x64 and arm64 only);
    - Eclipse p2 fragments with OS and arch filters.
  - The companion shims (Neovim, Emacs, Sublime, Qt Creator) use a Node 22
    or later found on `PATH`. Failing that, they offer a **pinned, consented
    download of the official Node archive**, with SHA-256 checked per
    platform. This is the M81 pattern: `src/host/browser/runtime/browserRuntime.json`
    and `runtimeStore.ts`.
  - Node's own builds are signed, so we re-sign nothing.
  - Node is MIT-licensed. Its notices go in our NOTICE file, as rule 9's
    record.
- **Shared state across editors.** One runtime per editor window, like
  VS Code's extension host. Checkpoint presence (`windowPresence.ts`), the
  daily ledgers and the paid grants are file-based, so VS Code, JetBrains
  and the ACP agent in one folder coordinate as one namespace.

### 3.6 The ACP agent carries everything ACP can

These changes help every ACP client, including Pulsar, Obsidian, marimo and
Toad, which get no shim:

- `available_commands_update` carries **every palette slash command**
  (compact, review, plan, goal, loop, checkpoint restore, best-of-N,
  handoff, panel, …), not just skills.
- **Booleans** (thinking, Auto reviewer, each paid feature) become
  `_`-prefixed config options. This replaces the launch-only paid flags,
  and paid uses still ask every time.
- **Model API reads and writes go through `fs/read_text_file` and
  `fs/write_text_file`** when the client offers them. Unsaved buffers are
  then seen, and the client's own review and undo track the change. This is
  M63c's open item. Muse Code's CLI owns its own file I/O, so on that
  backend the tool row stays the report.
- **`!` shell and background commands** run in the client's terminal
  (`terminal/create`) when offered.
- **SDK 1.7.0**: `session/delete`, `logout` and `additionalDirectories`,
  plus `session/fork` once it is stable.
- **A registry listing** (an `npx` distribution).

### 3.7 Native plugins

See §2.4 for the APIs.

- **JetBrains** (Kotlin; IntelliJ Platform Gradle Plugin 2.19, Gradle 9).
  - **UI**: a `ToolWindowFactory` with a `JBCefBrowser`.
    - Assets are served from the jar through `CefRequestHandler` /
      `CefResourceRequestHandler` on a fixed URL; all other navigation is
      blocked.
    - The bridge is `JBCefJSQuery` plus `executeJavaScript`.
    - When `JBCefApp.isSupported()` is false, the plugin falls back to the
      companion panel in the browser.
  - **The host services:**
    - `Document`, `Editor`, `FileEditorManager` and `WriteCommandAction`
      (one undo), checking against the document's modification stamp;
    - `DiffManager` with a `Document`-backed side, whose per-chunk apply
      arrows give native hunk review;
    - `DaemonCodeAnalyzerEx.processHighlights` after `DAEMON_EVENT_TOPIC`,
      and `WolfTheProblemSolver`, for diagnostics;
    - PSI, `GotoDeclaration` and `ReferencesSearch` for code intelligence;
    - the Reworked terminal API (2025.3+, experimental; older builds use
      the OS terminal);
    - `NotificationGroup` and `Messages`;
    - a `Configurable` that hosts the React settings page;
    - a status bar widget;
    - **`InlineCompletionProvider` for Tab**.
  - **Split Mode / remote development**: the tool window and JCEF run on the
    frontend, the runtime on the backend, joined by `@Rpc`, as the SDK
    documents.
  - **Android Studio**: the same plugin (platform-only dependencies), built
    with `androidStudio(…)`, with its own verifier run and qualification.
- **Visual Studio** (C#; a **VSSDK-compatible in-process** extension,
  `RequiresInProcessHosting`, .NET Framework 4.7.2; install range
  `[17.0,18.0)` for VS 2022 and 2026).
  - **UI**: a `ToolWindowPane` hosting the WPF WebView2 control.
    - `SetVirtualHostNameToFolderMapping` serves the assets.
    - The bridge is `chrome.webview.postMessage` and `WebMessageReceived`.
    - DevTools and the default context menus are off in release builds.
  - **The host services:**
    - `ITextBuffer` edits (one undo transaction);
    - `IVsDifferenceService.OpenComparisonWindow2` for diffs, with hunk
      review in our `DiffPage`;
    - `IErrorList` for diagnostics;
    - Roslyn `SymbolFinder` for C# and VB, and the LSP broker for the rest;
    - the OS terminal;
    - InfoBar and `ShowPromptAsync`;
    - a classic options page that hosts the React settings page;
    - the status bar.
  - **Tab is ours to build**: an `IWpfTextView` adornment layer for ghost
    text with Tab and Esc command filters. The Proposals API is used only
    once it is finalized, behind detection.
- **Eclipse** (Java; Tycho 5.0.4, Java 21, Maven 3.9.9 or later).
  - **UI**: a `ViewPart` with an SWT `Browser` (Edge/WebView2 by default on
    Windows since 4.35; WebKit on macOS; WebKitGTK on Linux).
    - The bridge is `BrowserFunction` plus `execute()`.
    - Assets are served from the bundle; navigation elsewhere is blocked.
  - **The host services:**
    - `IDocument` / `ITextEditor` edits (`IRewriteTarget` undo grouping);
    - the Compare framework (`CompareEditorInput`) for diffs;
    - `IMarker` problems for diagnostics;
    - JDT, CDT or LSP4E for code intelligence, with the broker otherwise;
    - the Platform terminal (`org.eclipse.terminal.*`, 4.37+; the OS
      terminal on older builds);
    - preference pages that host the React settings page;
    - the status line.
  - **Tab** uses JFace code minings, falling back to `StyledText` painting:
    Copilot for Eclipse's technique.
  - **Espressif-IDE 4.4.0** (Eclipse 2026-03) installs it from the same p2
    update site.

### 3.8 Companion server security (the M98 `judge serve` guard, adapted for a browser)

1. **Binding.** It binds only `127.0.0.1` (or `::1` when asked) on a random
   port. Any other bind is refused (`EPANEL_BIND`, as at `serve.ts:70-71`).
2. **Launch code.** Each window receives a fresh 256-bit **one-time launch
   code**. Each exchange mints an independent per-window bearer.
   - The editor opens `http://127.0.0.1:<port>/#k=<code>`. A fragment never
     reaches server logs or `Referer`.
   - The page POSTs the code to `/session` with `X-Muse-Panel: 1`, and gets
     back a per-window `Authorization: Bearer <id>` response header and the
     trusted packaged HTML. No cookie is set. The bearer stays only in a
     page-local fetch closure; no browser storage or URL carries it.
   - The code is burnt on first use. A second window asks the editor for a
     fresh code (`/panel`).
   - The URL travels over the shim's pipe, or an OS launcher's arguments,
     **never through a file or an environment variable**. When a token file
     is needed for tooling, M98's `tokenFile.ts` already owns that pattern
     (owner-only mode, a Windows ACL receipt).
3. **Every request is checked:**
   - exactly one `Host` header, equal to `127.0.0.1:<port>` (against DNS
     rebinding, as at `serve.ts:89-96`);
   - `Origin` equal to the panel's own origin on every POST and on `/events`;
   - `Sec-Fetch-Site: same-origin` whenever the browser sends it;
   - exactly one `Authorization: Bearer <id>` on every authenticated
     request, including packaged assets and fetch-based streaming `/events`;
     EventSource is not used because it cannot carry that header;
   - the custom header on POSTs, which forces a CORS preflight that we never
     answer;
   - **no `Access-Control-Allow-*` header, ever.**
4. **Response headers:**
   - a CSP the same as the webview's (`default-src 'none'`, nonce scripts,
     `connect-src 'self'`, `frame-ancestors 'none'`, `form-action 'none'`,
     `base-uri 'none'`);
   - `nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control:
no-store`;
   - `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy:
same-origin`.
5. **Inbound limits.** Every inbound message is parsed with the webview's
   own zod schemas (rule 7), under body caps, request and idle timeouts, and
   one SSE stream per session. The server dies with the runtime.
6. **Rule 8: the key never enters the browser.** Key entry stays `auth set`
   in a terminal. **Rule 12:** the popup is rendered by our UI, but the
   decision is `PaidUseConsent` in the runtime, bound to the price
   generation, so a forged POST can grant nothing that the window bearer
   and the pending request id do not already name.
7. **Threat model, recorded in PLAN §9:**
   - **Other local users and other loopback services are in scope:** they
     cannot read owner-only token files or obtain a browser bearer through
     ambient cookies. Ports do not scope cookies, so none are used. Visiting
     a second loopback service sends neither bearer nor launch code to it;
     forging Host/Origin without the bearer cannot authorize a command.
   - **Hostile web pages in the user's browser:** stopped by the Host,
     Origin and Fetch-Metadata checks, explicit bearer authorization, no CORS, and the
     custom header.
   - **The same user's own processes are outside the boundary,** as for the
     `ide` MCP server: they can read the data folder anyway. The one-time
     code limits replay of a launch URL seen in a process list.
8. **The JSON tool endpoints for M98, Zed's completions and the `lsp`
   server** reuse the judge guard unchanged: a bearer token and no `Origin`
   allowed.

### 3.9 Packaging, signing and channels

| Channel                        | Artifact                                                           | Toolchain (rig, CI)                                                                                                                 | Signing                                                                             | Owner needs                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| VS Code Marketplace, Open VSX  | `.vsix` (exists)                                                   | Node (all)                                                                                                                          | none (vsce-sign optional)                                                           | — (`VSCE_PAT`, `OVSX_PAT` exist)                                                                            |
| npm `muse-spark-code-acp`      | adds `panel` and `lsp`                                             | Node                                                                                                                                | npm provenance (trusted publishing exists)                                          | —                                                                                                           |
| ACP Registry                   | `agent.json` (npx)                                                 | —                                                                                                                                   | —                                                                                   | GitHub PR (exists)                                                                                          |
| JetBrains Marketplace          | six per-OS/arch plugin zips (`buildPluginVariants`)                | JDK 21, plus **JDK 25 for 2026.2 / Android Studio Rabbit**; Gradle 9; IntelliJ Platform Gradle Plugin 2.19 (Kubuntu, ubuntu-latest) | `signPlugin` (self-generated RSA key and chain; Marketplace counter-signs)          | JetBrains Account, Developer Agreement, vendor, EULA, first upload by hand, token                           |
| VS Marketplace (Visual Studio) | VS `.vsix` (x64, arm64)                                            | VS SDK workload, .NET Framework 4.7.2 targeting, MSBuild (Win11 VM; `windows-latest` is VS 2026 18.5)                               | optional, `sign` dotnet tool; **self-signed certificates are not accepted**         | publisher `RandyNorthrup` exists (Q2); confirm a Marketplace-scope PAT; code-signing certificate (optional) |
| Eclipse Marketplace, p2 site   | p2 repository with per-OS/arch fragments (GitHub Pages or Release) | JDK 21, Maven 3.9.9 or later, Tycho 5.0.4, Xvfb (Kubuntu, ubuntu-latest)                                                            | `jarsigner` or PGP (`tycho-gpg-plugin`); unsigned content asks to "Trust Artifacts" | Eclipse account (exists for Open VSX); a listing with the p2 URL (moderated, about 24 business hours)       |
| Zed                            | registry entry; extension (MCP)                                    | Rust `wasm32-wasip2` (Kubuntu)                                                                                                      | —                                                                                   | PR to zed-industries/extensions                                                                             |
| Xcode                          | `Muse Spark Code for Xcode.app` (DMG); Xcode 27 plugin (git URL)   | Xcode (Mac mini, macos-latest)                                                                                                      | **Developer ID and notarization**                                                   | Apple Developer Program, Developer ID certificate, notary credentials                                       |
| Qt Creator                     | Lua extension                                                      | Qt Creator (Kubuntu)                                                                                                                | —                                                                                   | PR to qt-creator/extension-registry                                                                         |
| Neovim                         | `muse.nvim` (GitHub, luarocks)                                     | Neovim 0.12 (Kubuntu)                                                                                                               | —                                                                                   | luarocks API key (optional)                                                                                 |
| Emacs                          | `muse-spark.el` (MELPA)                                            | Emacs 29 and 30 (Kubuntu)                                                                                                           | —                                                                                   | MELPA PR (with an Assisted-by header)                                                                       |
| Sublime                        | package (Package Control)                                          | Sublime Text build ≥ 4205 (Kubuntu)                                                                                                 | —                                                                                   | PR to sublimehq/package_control_channel                                                                     |
| Arduino IDE 2                  | the same `.vsix` (§2.4)                                            | —                                                                                                                                   | —                                                                                   | —                                                                                                           |

Every artifact is built from one tag in `release.yml` and attached to the
GitHub Release, **before** any registry publish. A missing registry account
therefore never blocks building or shipping (the GitHub Release is always a
channel). MHP compatibility is declared per artifact (`mhp: "1.x"`), and an
incompatible pairing refuses with a clear message (`docs/ide-compatibility.md`
§10).

### 3.10 How every future feature lands in all editors at once

1. **Features are written against `HostServices` and React only.** The
   tightened M60 gate fails a `vscode` import outside `src/host/vscode/**`
   and `src/extension.ts`. A feature that needs a new editor service adds an
   MHP method **with a fallback**, so it can never be "missing" anywhere.
2. **Registry gate: `npm run check:editor-matrix`**, run in `quality:gates`.
   - **The registry** is `src/shared/hostApi/features.ts`: feature id, the
     MHP capabilities it needs, its fallback, and per editor a status (W, P,
     M, B) with evidence ids.
   - **The gate fails when:**
     - a palette action, `HOST_ACTIONS` entry, protocol message type,
       manifest command, setting, `ConversationDeps` member or MHP method
       maps to no feature id;
     - a feature has no status for some editor;
     - an editor marked Supported has a non-W row without an approved
       exception;
     - an evidence id names no existing conformance test;
     - the generated `docs/ide-compatibility/matrix.md` differs from the
       registry.
3. **Conformance suite.** One set of scripted host scenarios
   (`test/hostApi/scenarios/*.json`) runs against every adapter:
   - VS Code: the integration tests;
   - JetBrains: the IntelliJ test framework;
   - Visual Studio: the experimental instance;
   - Eclipse: tycho-surefire under Xvfb;
   - Neovim: headless with plenary;
   - Emacs: batch ERT;
   - Sublime: UnitTesting;
   - Qt Creator: Lua tests;
   - Xcode: XCTest.
     Each scenario runs against the fake CLI and the fake Model API server. A
     feature PR that adds a scenario gets it run everywhere by
     `hosts-native.yml`.
4. **AGENTS.md rule 14, "Every editor at once":** a feature PR updates the
   registry, the matrix and every adapter, or declares the fallback. The PR
   template gets the same checkbox, and "Docs land with changes" now
   includes the matrix.

---

## 4. Proposed PLAN.md text

### D84 — Equal functionality in every editor (2026-10-05)

The owner (2026-10-05): "i feel like you are still focusing very hard on vs
code rather than treating all the editors equally; all of the editors should
have equivalent functionality even if we need to develop it ourselves".

- **Parity, not tiers.** This supersedes D60's "integration type" tiers and
  D62's "the editor's own chat is the interface" as the product promise.
  - Every editor gets the full Muse panel and every feature in the
    registry, through native APIs where the host has them and through our
    own implementation where it does not.
  - ACP stays, as a second view of the same sessions, and as the route for
    clients we do not ship a shim for.
  - D60's status ladder (Planned → Prototype → Preview → Supported) still
    applies. **Supported now means every registry row is W** with evidence.
    An exception is allowed only where the host makes a capability
    impossible; it is named, given an equivalent in our panel, and gets an
    upstream request (the owner files Zed's, since Zed refuses agent-written
    contributions).
- **One controller, one UI, one contract.**
  - The `ConversationController` and every panel feature run in VS Code's
    extension host and in the standalone runtime
    (`muse-spark-code-acp panel`).
  - The React UI runs behind three bridges: VS Code, embedded and
    companion.
  - The editor-services contract is **MHP v1** (`src/shared/hostApi/`).
    VS Code implements it in-process first, and its behaviour does not
    change.
  - The ACP agent's sessions move onto the controller.
- **The routes:**
  - **Embedded native plugins:** JetBrains (with Android Studio), Visual
    Studio and Eclipse (with Espressif IDE).
  - **A loopback companion panel**, paired with ACP and a thin shim: Zed,
    Xcode (a signed WKWebView container app with XcodeKit commands), Qt
    Creator (Lua), Neovim (Lua), Emacs (elisp, in an xwidget where built)
    and Sublime (Python).
  - **Tab completions** through each host's completion API, an LSP 3.18
    `inlineCompletion` server, Zed's OpenAI-compatible provider, or an
    Invoke command.
  - **Code intelligence and diagnostics** through each host's API, or the
    runtime's LSP broker.
- **Rulings carried.**
  - Rule 8: the key stays in the runtime's OS store and is entered only
    through `auth set`. There is no `secrets/*` in MHP, and the key never
    reaches the UI or the companion.
  - Rule 12: our popup and the shared ledger in every editor. The ACP
    launch flags become per-session options, still asked at each use.
  - Rule 7: zod on MHP and on the companion.
  - The companion follows M98's loopback guard, adapted for a browser
    (§3.8 of the research).
  - Nothing is installed unasked: Node and the language servers are found
    or downloaded only with consent and a pinned SHA-256.
- **Merge-gate rule.** `check:editor-matrix` in `quality:gates`, with
  AGENTS.md rule 14: a feature PR updates the feature × editor registry.
- **Order.** Foundation first (M104a). Then the three native plugins and the
  companion-paired hosts in parallel (M104b–e), distribution (M104f), and
  qualification (M104g). The research is
  `docs/certification/m104-research.md` (this file, moved in).

### M104 — Every editor, every feature (D84)

**M104 is split** because it is large: a foundation and seven parallel
parts. All of them build against the MHP v1 contract frozen at the end of
lane A's first step.

| Milestone | Delivers                                                                                                                                  | Depends on                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| M104a     | MHP v1; the VS Code adapter refactor; the runtime `panel` mode; UI bridges, tokens and fallbacks; the companion server; the registry gate | M95, M96c, M98 merged (or rebased onto them) |
| M104b     | JetBrains plugin (IntelliJ-based IDEs and Android Studio)                                                                                 | M104a contract freeze                        |
| M104c     | Visual Studio extension                                                                                                                   | M104a contract freeze                        |
| M104d     | Eclipse plugin (with Espressif IDE)                                                                                                       | M104a contract freeze                        |
| M104e     | ACP on the controller, plus the shims: Zed, Xcode app, Qt Creator, Neovim, Emacs, Sublime; LSP broker; `lsp` server                       | M104a contract freeze; companion server      |
| M104f     | Distribution: the release workflow for every channel; signing; registries                                                                 | M104b–e artifacts                            |
| M104g     | Qualification: the conformance suite green per editor; Arduino IDE 2 and the remaining VS Code-family rows                                | all                                          |
| M104h     | Docs and certification (runs throughout)                                                                                                  | —                                            |

- **Goal.** Every feature in the registry (F1–F56, and every one added
  later) works in every editor in §1.3, through the editor's own APIs or
  our own implementation. Every future feature lands in all of them in the
  PR that adds it.
- **Depends on.**
  - D84.
  - The M60 gate and the M61 steps.
  - M98's `tokenFile.ts` and its serve guard (merged, or this milestone
    takes ownership of a copy).
  - M95 (providers) and M96c (Traffic), so their webviews join the bridge
    at once.
  - Toolchains on the rigs, all installs authorised:
    - Kubuntu: JDK 21 and 25, Gradle 9, Maven 3.9.9, Tycho 5.0.4, Xvfb,
      Neovim 0.12, Emacs 29 and 30, Sublime build 4205 or later, Qt
      Creator 20;
    - Win11 VM: VS 2022 (17.14) and VS 2026 with the VSSDK workload;
    - Mac mini: Xcode 26.6 and 27.
- **Lanes and file ownership.** One integration branch, `feature/m104`.
  Lane 0 lands the contract skeleton (one day). Then lanes A–J run in
  parallel, and the lead integrates.

| Lane     | Items                                                                                                                                                                                                                                                                            | Files it owns                                                                                                                                                     | Its regions in shared files                                                      | Starts                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------- |
| 0 (lead) | MHP v1 skeleton: method table, zod schemas, capability names, error codes, version range; feature registry skeleton (F1–F56)                                                                                                                                                     | `src/shared/hostApi/**`, `src/shared/hostApi/features.ts`                                                                                                         | `src/shared/constants.ts` (MHP block)                                            | day 0                       |
| A        | VS Code adapter: `HostServices` implemented with `vscode`; `extension.ts` composes from it; the 24 `vscode` files moved to `src/host/vscode/**`; behaviour unchanged                                                                                                             | `src/host/vscode/**`, `src/host/compose/**`, `src/extension.ts`                                                                                                   | `scripts/check-host-api.mjs` (new allowed roots)                                 | after 0                     |
| B        | Runtime panel: `panel --stdio` and `--companion`; controller registry; ACP sessions on the controller (re-basing `src/acp/agent.ts` on the registry); settings and storage stores                                                                                                | `src/runtime/panel/**`, `src/runtime/settingsStore.ts`, `src/acp/**`                                                                                              | `src/runtime/main.ts`, `src/runtime/cliArgs.ts` (the `panel` and `lsp` commands) | after 0                     |
| C        | Companion server: launch code, cookie, Host/Origin/Fetch-Metadata guard, SSE, CSP, static assets, idle exit; shared token-file module                                                                                                                                            | `src/runtime/companion/**`, `src/runtime/tokenFile.ts` (moved from `judge/`, coordinated with the M98 owner)                                                      | —                                                                                | after 0                     |
| D        | UI: the three bridges; `main.tsx`, Tasks and What's New on the bridge; `--muse-*` tokens (M61.3); React fallbacks (Confirm, Picker, Input, Toasts, StatusStrip, SettingsPage, Walkthrough, DiffPage, TerminalOutput); manager pages for skills, MCP, hooks, memory and worktrees | `src/webview/bridges/**`, `src/webview/fallbacks/**`, `src/webview/main.tsx`, `src/webview/whatsNew/main.ts`, `src/webview/tokens.css`, `src/host/ui/pageHtml.ts` | `src/webview/styles.css` (variables only), `l10n/*` (new keys, all 15 tables)    | after 0                     |
| E        | JetBrains plugin (M104b)                                                                                                                                                                                                                                                         | `hosts/jetbrains/**`                                                                                                                                              | —                                                                                | after the contract freeze   |
| F        | Visual Studio extension (M104c)                                                                                                                                                                                                                                                  | `hosts/visualstudio/**`                                                                                                                                           | —                                                                                | after the contract freeze   |
| G        | Eclipse plugin (M104d)                                                                                                                                                                                                                                                           | `hosts/eclipse/**`                                                                                                                                                | —                                                                                | after the contract freeze   |
| H        | Shims and editor routes (M104e): Zed extension, Xcode app and XcodeKit, Qt Creator Lua, `muse.nvim`, `muse-spark.el`, Sublime package; the LSP broker and the `lsp` server; the Zed completions endpoint                                                                         | `hosts/{zed,xcode,qtcreator,neovim,emacs,sublime}/**`, `src/runtime/lsp/**`, `src/runtime/tabServe.ts`                                                            | —                                                                                | after lane C's first commit |
| I        | Distribution and CI (M104f): `hosts-native.yml` (path-filtered on PRs, weekly full), release jobs per channel, packaging scripts, the Node runtime pin manifest, the conformance runner                                                                                          | `.github/workflows/hosts-native.yml`, `scripts/package-hosts/**`, `src/runtime/nodeRuntime.json`, `test/hostApi/**`                                               | `.github/workflows/release.yml` (new jobs after `npm`), `package.json` scripts   | after 0                     |
| J        | Docs (M104h): README "Every editor", `docs/ide-compatibility/{hosts,matrix,host-api-v1}.md`, `docs/acp.md`, CONTRIBUTING, AGENTS.md rule 14, CHANGELOG, PLAN, certification                                                                                                      | `docs/ide-compatibility/**`, `docs/certification/m104*.md`                                                                                                        | README, AGENTS.md, CHANGELOG, PLAN (M104 and D84 only)                           | throughout                  |

- **Acceptance (all with fakes, no model calls).** Fakes: the fake Muse Code
  CLI and the fake Model API server.
  1. **VS Code unchanged.** Every existing gate and integration test passes,
     and the harness screenshots are pixel-identical before and after lanes
     A and D. The host API record lists only `src/host/vscode/**` and
     `src/extension.ts` as importing `vscode`.
  2. **MHP conformance.** The scenario suite passes against:
     - (a) the in-process VS Code adapter;
     - (b) a fake host in `test/hostApi/fakeHost.ts`;
     - (c) each native plugin, in its own headless harness: IntelliJ's
       `BasePlatformTestCase` and `HeavyPlatformTestCase` plus the
       Starter/Driver UI tests, plus `CodeInsightTestFixture.testInlineCompletion`;
       the VS experimental instance, with `[IdeFact]` tests pinned (the
       harness is archived upstream, so hosted-runner reliability is measured
       before it gates); tycho-surefire
       with the UI harness under Xvfb; headless Neovim with plenary; Emacs
       batch ERT; Sublime UnitTesting; Qt Creator Lua tests; XCTest.
     - The scenarios cover:
       - a conversation;
       - an approval allowed, denied and cancelled;
       - a dirty-buffer edit refused, and an edit applied once with one
         undo;
       - a diff reviewed hunk by hunk;
       - diagnostics read by the verify loop;
       - a checkpoint restore;
       - the paid popup (Allow once, Always, Deny) and the budget limit;
       - a Tab completion accepted;
       - settings changed and seen;
       - a session resumed after a reload.
  3. **Matrix.** Every row is W for every editor's adapter in the registry,
     or an exception is recorded with an approved reason and an equivalent.
  4. **Companion security.** These are refused:
     - a wrong `Host`;
     - a foreign `Origin`, including a Playwright page served from another
       port that tries a form POST, a fetch, an EventSource and a WebSocket;
     - a missing cookie or a missing custom header;
     - a replayed launch code;
     - a non-loopback bind;
     - an over-cap body.
       Also: no CORS header in any response, and the CSP present on every
       page.
  5. **ACP.** M63's acceptance re-runs unchanged on the controller-based
     agent, and the new slash commands, boolean options and `fs/*` routing
     are tested against the SDK client. In Zed, Neovim and Emacs (hosts.yml)
     a `/panel` command opens the same session in the companion.
  6. **Rule 8 drills.** The key is absent from every MHP frame, every
     companion response, the logs and every child environment, checked by
     a grep test.
- **Tests.**
  - Unit tests: MHP schemas (round trip, rejection), capability selection
    and fallback, the registry gate, the companion guard (each header case),
    the launch-code lifecycle, the bridges, the token mapping, every React
    fallback (including axe), the LSP broker against a fake LSP server, the
    `lsp` server's `inlineCompletion`, and the Node runtime pin's checksum.
  - Per plugin: unit tests in its own language (JUnit 5, MSTest or xUnit,
    JUnit with Tycho, busted or plenary, ERT, Python `unittest`, XCTest).
  - Integration: `test/e2e` drives `panel --stdio` with the fake host, and
    `--companion` with Playwright.
- **Gates.**
  - New: `check:editor-matrix`; the tightened M60 import gate; the MHP
    schema snapshot (a breaking change needs a version bump); Plugin
    Verifier for the declared IDE range (IC, IU, PC, WS, GO, CL, RR, RD,
    AS); `verifyPlugin`; ktlint and detekt; `dotnet format` and analyzers;
    Checkstyle or SpotBugs for Eclipse; luacheck and stylua; `package-lint`
    and checkdoc; ruff for the Sublime package; SwiftLint; actionlint for
    the new workflows.
  - Every new gate gets a red drill (CLAUDE.md), recorded in
    `docs/certification/m104*.md`.
  - D6 bundle budgets: the runtime `panel` entry is new (measured plus 15%).
    The VSIX budget does not grow, because the plugins carry the bundle and
    the VSIX does not.
- **Security.**
  - Covered by §3.8: the companion guard, launch codes, CSP, rule 8 (no key
    over MHP, the UI or the companion), and rule 12 (decision in the
    runtime).
  - Node and language-server downloads only with consent and a pinned
    SHA-256.
  - The plugins never spawn with the key in their environment, and the
    runtime strips credential variables as today
    (`credentialVariables.ts`).
  - JCEF, WebView2 and SWT pages get the same CSP and no remote origins:
    `JBCefBrowser` with no devtools in release builds, WebView2 with
    `AreDevToolsEnabled=false` and `AreDefaultContextMenusEnabled=false`,
    and navigation outside the asset scheme blocked.
  - PLAN §9 records the residual risks for same-user processes.
- **Docs.**
  - README: an "Every editor" section, plus install sections per editor.
  - `docs/ide-compatibility/matrix.md` (generated), `hosts.md` (routes and
    statuses updated: Xcode ACP from 26.6, Qt Creator's built-in client) and
    `host-api-v1.md` (generated from the schemas).
  - `docs/acp.md` (`/panel`, the options, `fs/*`), CONTRIBUTING (the
    toolchains, how to run each harness), AGENTS.md rule 14, CHANGELOG, and
    PLAN D84, M104 and §8/§9 rows.
- **Size.** L overall. Rough sizes:
  - M104a, 9–12k lines of TypeScript including tests (A about 3k of moves,
    B 3k, C 1.5k, D 3k);
  - JetBrains 7–9k Kotlin;
  - Visual Studio 6–8k C#;
  - Eclipse 6–8k Java;
  - shims 1–2.5k each;
  - LSP broker 2k;
  - workflows and packaging 1.5k.
    With 8–10 lanes in parallel, the critical path is lane A plus one plugin
    (M104b).
- **Certification checklist** (§6.0, plus):
  - [ ] Lane 0's contract is frozen and versioned (`mhp/1.0.0`), with a
        schema snapshot committed.
  - [ ] VS Code is pixel-identical (harness) and every integration test
        passes.
  - [ ] Conformance is green per adapter, with a receipt per editor and
        version, filed in `docs/certification/m104-<host>.md`.
  - [ ] `matrix.md` is generated, and each editor's status is moved only on
        that evidence.
  - [ ] Companion security tests pass, including the Playwright
        cross-origin drill.
  - [ ] Red drills for `check:editor-matrix`, the tightened import gate,
        the schema snapshot and the companion guard.
  - [ ] Rule 8 grep tests and rule 12 popup tests pass in every host.
  - [ ] Every artifact is built from one tag and attached to the GitHub
        Release. Registry publishes run where the owner's accounts exist, and
        each one missing is listed at the top of the report (loud failures).
  - [ ] No live or paid call. Any live smoke follows CLAUDE.md: state the
        count first, use an empty workspace, count from the trace log.
  - [ ] Codex review in one pass per lane class before push.

---

## 5. What needs the owner (nothing here blocks building)

Every item below is a **listing or signing** step. All artifacts build,
test and attach to the GitHub Release without them.

1. **JetBrains Marketplace.**
   - **Account setup:** sign in with a JetBrains Account, accept the
     Developer Agreement, create the vendor profile (`RandyNorthrup`) and
     supply an EULA. The plugin is open source, so the EULA carries a
     source link.
   - **The first upload is by hand.** Every update is then reviewed by hand,
     with no promised turnaround.
   - **Publishing:** a permanent Marketplace token goes in the `marketplace`
     environment (`JETBRAINS_MARKETPLACE_TOKEN`).
   - **Signing:** the key pair is self-generated with `openssl` and stored
     as `JETBRAINS_CERTIFICATE_CHAIN`, `JETBRAINS_PRIVATE_KEY` and
     `JETBRAINS_PRIVATE_KEY_PASSWORD`. Signing is optional, but an unsigned
     plugin warns on install.
2. **Visual Studio Marketplace.**
   - **Publisher:** `RandyNorthrup` exists (Q2), in the same portal as
     VS Code's.
   - **Token:** confirm that `VSCE_PAT` (Marketplace scope, all accessible
     organisations) also works with `VsixPublisher.exe`. If it does not,
     mint a second PAT (Chrome Control, value-blind, as before).
   - **Signing:** optional, but it needs a real code-signing certificate,
     because the Marketplace does not accept self-signed ones.
3. **Eclipse Marketplace.**
   - **Account:** the Eclipse Foundation account exists (the Open VSX
     publisher agreement, Q60).
   - **Listing:** "Add Content" on marketplace.eclipse.org, with our p2
     update-site URL (GitHub Pages). Moderation takes about 24 business
     hours.
   - **Signing:** jarsigner or PGP signing is optional. Without it, Eclipse
     asks the user to "Trust Artifacts".
4. **ACP Registry and Zed.** These are GitHub PRs (the account exists). A
   request upstream for agent-provided panels in Zed must be **written by
   the owner**, because Zed does not accept contributions from autonomous
   agents. The Zed CLA is signed by the owner if we ever send code.
5. **Apple.** The Apple Developer Program ($99/year), a Developer ID
   Application certificate and notary credentials (an App Store Connect API
   key) are needed for the Xcode container app. Without them, the app ships
   unsigned for local builds only.
6. **Windows code signing (optional).** A certificate (for example Azure
   Trusted Signing) for the VS VSIX and for any `.exe` we might ship. Node's
   own official binaries are already signed.
7. **Community registries.** MELPA (a GitHub PR, with the Assisted-by
   header), Package Control (a GitHub PR), luarocks (an API key, optional)
   and the Qt Creator extension registry (a GitHub PR). No new accounts
   beyond GitHub, except luarocks.
8. **Two rulings worth one line each (defaults in brackets):**
   - (a) Should the native plugins offer a one-click consented download of
     the official Node runtime when no Node 22 or later is found? [yes, with
     a pinned SHA-256, as for the browser-check runtime]
   - (b) Should `muse-spark-code-acp panel --companion` open in the default
     browser, or in a Chrome or Edge `--app` window when one is installed?
     [the `--app` window when found, else the default browser]

---

## 6. Corrections to existing records found during this audit

- **`hosts.md`:**
  - Xcode reaches ACP from **26.6**, not only 27; the 26.3 row is the
    built-in Claude Agent and Codex plus `xcrun mcpbridge`.
  - Qt Creator 20 ships the ACP client **built in**, not as a separate
    extension.
  - Sublime's channel repository moved to `sublimehq`.
- **`docs/ide-compatibility.md` §8** names "Xcode 27" for ACP. Same
  correction.
- **Q61's pin (SDK 1.5.0)** is two minors behind (1.7.0). The stable
  `session/delete`, `logout`, boolean options and `additionalDirectories`
  need the newer SDK. This is a rule 9 review, part of lane B.
- **The `hosts.md` rows "Arduino IDE 2 … External tool"** should record the
  real blocker: it is Theia 1.57 (VS Code API 1.96), below our 1.99 floor.
  It is a VSIX route after a floor audit, not an external one.
- **Eclipse in `hosts.md`** should list the community Eclipse ACP Connector
  as an ACP route beside the planned native plugin. JetBrains' ACP (2025.3+,
  `~/.jetbrains/acp.json`, the registry) should replace "AI Assistant" as
  the client's name.
- **M61's status line** says steps 3, 4 and 6 wait on M56. M56 merged
  2026-09-27, and those steps were never done. M104a lanes A and D take them
  over.
