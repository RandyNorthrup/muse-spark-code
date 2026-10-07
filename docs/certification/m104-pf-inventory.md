# M104PF qualification inventory

Generated from the reviewed MHP snapshot at base `74b99c4a`; native checkpoint
`545f2cc18`. The available integration `97d15be17` has not been adopted without
the lead’s merge instruction. Source hash and structured dimensions are in
[m104-pf-inventory.json](m104-pf-inventory.json).

The frozen registry has **56 rows × 25 editor IDs = 1,400 cells, all M**.
The older INT implementation table’s 38 M / 18 P is a different, source-level
inventory. This lane closes **zero complete installed row receipts**. Historical
editor status receipts retain their original scope; no support/registry status
moves. Every row below still needs both backends and applicable capability-gated
provider profiles, including denial/no-dispatch, cancellation and ownership.

## Xcode row-by-row resume inventory

| Row | Feature                     | Shared owner | Native evidence / next step                                                                                                                                         |
| --- | --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | streaming-chat              | A            | Native bootstrap and authenticated fake browser container only; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.           |
| F2  | tool-rows-and-output        | A            | Document reads and native editor navigation. Installed receipt missing.                                                                                             |
| F3  | approval-cards              | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F4  | question-cards              | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F5  | permission-modes            | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F6  | auto-reviewer               | B            | Reviewer and priced native consent binding. Installed receipt missing.                                                                                              |
| F7  | inline-diffs                | C            | Shared diff rendering and navigation. Installed receipt missing.                                                                                                    |
| F8  | hunk-review                 | B            | Dirty buffer edit review and one undo. Installed receipt missing.                                                                                                   |
| F9  | verify-loop                 | B            | Fresh versioned diagnostics and native formatting. Installed receipt missing.                                                                                       |
| F10 | turn-checkpoints            | B            | Checkpoint shadow/reconcile services. Installed receipt missing.                                                                                                    |
| F11 | rewind                      | B            | Guarded rewind and Redo in the actual editor. Installed receipt missing.                                                                                            |
| F12 | history                     | A            | Generation rebinding infrastructure only; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                 |
| F13 | fork-and-side-chat          | A            | Fresh same-origin launch infrastructure only; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                             |
| F14 | slash-palette               | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F15 | mentions-and-selection      | B            | Existing XcodeKit selection and UTF-16/stale edit guards; Shared mentions, native current URI and snapshot handoff. Installed receipt missing.                      |
| F16 | attachments                 | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F17 | subagents-and-map           | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F18 | workflows                   | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F19 | tasks                       | C            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F20 | goals                       | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F21 | plan-files                  | C            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F22 | compaction-and-handoff      | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F23 | background-and-shell        | B            | Native foreground/background terminal services. Installed receipt missing.                                                                                          |
| F24 | best-of-n                   | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F25 | scheduled-and-saved-prompts | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F26 | replies-and-quotes          | C            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F27 | rules-skills-memory-agents  | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F28 | mcp-servers                 | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F29 | hooks                       | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F30 | code-intelligence           | B            | Pinned/consented language services and current snapshots. Installed receipt missing.                                                                                |
| F31 | web-fetch                   | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F32 | paid-search-and-images      | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F33 | browser-check               | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F34 | session-import-export-share | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F35 | worktrees                   | B            | Worktree workspace rebinding and trust transition. Installed receipt missing.                                                                                       |
| F36 | git-and-pull-requests       | B            | Shared Git/PR auth and native navigation. Installed receipt missing.                                                                                                |
| F37 | cli-install-and-login       | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F38 | account-and-usage           | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F39 | paid-use-consent            | B            | Native opaque priced Deny and cancelled sheet tests; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                      |
| F40 | daily-paid-budget           | B            | Native price/budget message display only; runtime ledger pending; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.         |
| F41 | voice                       | B            | Native recording integration, permission denial and priced voice budget. Installed receipt missing.                                                                 |
| F42 | tab-completions             | B            | Command-only snapshot Tab integration, once-only priced consent and cross-editor daily ledger. Installed receipt missing.                                           |
| F43 | settings                    | A            | Default-off native trust metadata and transition tests; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                   |
| F44 | walkthrough                 | C            | Walkthrough surface. Installed receipt missing.                                                                                                                     |
| F45 | whats-new                   | C            | What’s New surface. Installed receipt missing.                                                                                                                      |
| F46 | display-languages           | C            | Native locale metadata and English plus 14 translated resource tables; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.    |
| F47 | accessibility               | C            | App-hosted controls; full accessibility qualification missing; Keyboard/focus/screen-reader and four-theme native receipts. Installed receipt missing.              |
| F48 | logs-and-diagnostics        | C            | Process-group Stop, descriptor/environment and EOF cleanup tests; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.         |
| F49 | commands-and-keybindings    | C            | Five existing XcodeKit command implementations; owner enablement missing; Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing. |
| F50 | problem-report              | C            | Scrubbed report dialog/export surface. Installed receipt missing.                                                                                                   |
| F51 | models-and-providers        | A            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F52 | roles-and-traffic           | C            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F53 | legal-scan                  | B            | Captured legal-scan contract and engine missing. Installed receipt missing.                                                                                         |
| F54 | judge                       | B            | Integrated A/B/C feature binding and installed Xcode scenario. Installed receipt missing.                                                                           |
| F55 | paired-devices              | B            | M100 security-reviewed pairing implementation prerequisite. Installed receipt missing.                                                                              |
| F56 | remote-control              | B            | Captured remote-control broker/authorization contract missing. Installed receipt missing.                                                                           |

## Editor families, versions and rigs

| Registry ID     | Family / variants                                                                               | Availability and qualification gap                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vscode          | VS Code desktop, Remote and WSL                                                                 | 1.139.1; Installed application Info.plist only; no fresh development-extension/VSIX scenario. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                            |
| cursor          | cursor                                                                                          | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| vscodium        | vscodium                                                                                        | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| devin           | Windsurf / Devin Desktop                                                                        | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| kiro            | kiro                                                                                            | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| positron        | positron                                                                                        | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| theia           | theia                                                                                           | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| code-server     | code-server                                                                                     | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| codespaces      | codespaces                                                                                      | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| che             | che                                                                                             | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| firebase-studio | firebase-studio                                                                                 | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| antigravity     | antigravity                                                                                     | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| jetbrains       | IntelliJ IDEA, PyCharm, WebStorm, GoLand, PhpStorm, CLion, RustRover, RubyMine, DataGrip, Rider | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| android-studio  | android-studio                                                                                  | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| visual-studio   | Visual Studio 17/18                                                                             | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| eclipse         | eclipse                                                                                         | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| espressif       | Espressif-IDE (Eclipse family)                                                                  | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| zed             | Zed ACP/native routes                                                                           | 1.22.0; Installed application Info.plist only; no fresh ACP/native scenario. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                             |
| xcode           | Xcode 26.3/26.6/27                                                                              | 26.3 (17C529); XCTest and release build/integrity at native checkpoint; no installed/enabled production plugin scenario. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles. |
| qtcreator       | qtcreator                                                                                       | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| neovim          | neovim                                                                                          | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| emacs           | emacs                                                                                           | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| sublime         | sublime                                                                                         | Build 4200; Installed application Info.plist only; no fresh shim/ACP scenario. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                           |
| arduino         | Arduino IDE                                                                                     | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |
| headless        | ACP and M80 exec/CI applicability                                                               | Not freshly installed/qualified on this rig. Declared editor versions, OS/architecture, exact installable artifact, both backends and applicable provider profiles.                                                                             |

## Backend/provider and channel qualification

The two backend routes are Muse Code CLI and Model API. The eight provider
families are Meta Muse, OpenAI, Anthropic, Gemini, xAI, OpenRouter, Ollama/local
and custom. Model-specific vision, logprobs, cache, reasoning, tools, structured
output, hosted search and context limits must follow captured selected-model
capabilities. Paid admission uses the verified model tariff, one priced question
and a hard shared local-day ledger; a subscription covers none of those calls.
F made zero model attempts. Existing B/C component receipts are prerequisites,
not new installed/provider receipts.

ACP keeps its editor permission prompts, flag defaults and OS credential-store
boundary. Exec/CI keeps M80’s hosted/live support fence and its narrower feature
policy: explicit bounded image admission only; hosted search, voice, subagents
and schedules unavailable. GUI-only row applicability must be recorded by A
before a channel is qualified. No unavailable feature is silently deleted.

Xcode 26.3 was executed on macOS 15.7.4 Intel. Universal release binaries include
arm64, which was compiled and signature-checked, not executed. Xcode 26.6/27,
Apple Silicon, other declared macOS versions and Linux/Windows native jobs are
named gaps. The owner must enable the XcodeKit extension. All four themes and
all installed languages need actual assembled accessibility/focus receipts.

Exact native component bytes are in [the artifact receipt](m104-pf-native-artifact.json).
The local app still selects an external runtime; that ZIP is not a production
bundled-runtime/support receipt. Official Node pins, archive payload verification,
production manifests and actual installed harness observations are release
prerequisites. No signing/notarization, publication, credentials or live calls
were performed. [Cross-lane requests](m104-pf-requests.md) give the owners and
required validation.
