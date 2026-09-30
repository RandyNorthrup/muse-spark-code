# Muse Spark Code — IDE Compatibility Plan

> The owner's plan, kept as handed over on 2026-09-26. The decisions taken
> from it are PLAN.md D60, the work is M60–M66, and the questions it raises
> are Q60–Q64. What the extension asks of its host today is the generated
> record [`ide-compatibility/host-api.md`](ide-compatibility/host-api.md)
> (M60). The links below were not re-read when the plan was filed; each
> target's claim is re-read from its source before its milestone starts.

**Prepared:** September 25, 2026, America/Los_Angeles  
**Project:** [RandyNorthrup/muse-spark-code](https://github.com/RandyNorthrup/muse-spark-code)  
**Reviewed baseline:** manifest version 0.8.0, main commit [`bdaede45417ac8dbcaf5f52aa9b3ff307396ab03`](https://github.com/RandyNorthrup/muse-spark-code/commit/bdaede45417ac8dbcaf5f52aa9b3ff307396ab03)  
**Status:** Proposed roadmap based on repository inspection and current primary documentation. No additional IDE has been installation-tested or certified during this review.

## 1. Recommended direction

Develop Muse Spark Code as one product with a shared agent engine, a reusable React interface, and a small set of integration families:

1. **The VS Code extension family:** qualify the existing extension in compatible editors and remote workspaces.
2. **The ACP agent family:** expose the shared engine through Agent Client Protocol so participating IDEs can provide their own chat and approval interfaces.
3. **Native host plugins:** embed the shared Muse interface and implement editor services where a dedicated plugin offers a better experience or ACP is unavailable.
4. **External integration for constrained hosts:** provide a terminal or adjacent Muse interface with explicitly limited editor integration.

The product name remains **Muse Spark Code** across these distributions. Preserve the project's unofficial branding and keep release numbers below 1.0 until the owner explicitly chooses otherwise, consistent with the existing project decisions. [Project instructions](https://github.com/RandyNorthrup/muse-spark-code/blob/main/AGENTS.md), [PLAN.md, decision D44](https://github.com/RandyNorthrup/muse-spark-code/blob/main/PLAN.md)

The goal is broad coverage of major general-purpose, mobile, scientific, and terminal development environments. A platform can have a credible route without qualifying for identical interface and feature support. This plan therefore specifies both the integration path and the work required to earn a support claim.

## 2. What the repository already provides

The code has useful separation already. This is a portability project built on existing boundaries, with additional work around the editor and runtime services.

| Existing component      | Evidence                                                                                                                                     | Portability implication                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Shared backend contract | `AgentHost` and `AgentSession` represent sessions, turns, approvals, cancellation, history, models, usage, and subagent operations.          | Keep this as the internal backend boundary. Add external protocols around it.                         |
| Two backends            | Muse Code over Muse Session Protocol; Model API with its own tool execution.                                                                 | Each adapter must publish results separately for both backends.                                       |
| React interface         | `src/webview/main.tsx` mounts the app and calls `acquireVsCodeApi()`.                                                                        | Extract a host bridge for messaging and persisted UI state; reuse the React components.               |
| Validated messages      | `src/shared/protocol.ts` intentionally avoids Node, DOM, and VS Code imports.                                                                | Suitable foundation for a versioned shared UI contract.                                               |
| Injected services       | Conversation controller, credential store, edit review, and tool I/O already accept dependencies.                                            | Some code under `src/host` can move or be generalized; it does not all need rewriting.                |
| Desktop/server runtime  | Manifest uses `main`, `extensionKind: ["workspace"]`, VS Code `^1.125.0`, Node `>=22`, no `browser` entry, and no virtual-workspace support. | Compatible desktop/server hosts are the first targets. Pure browser hosts require additional work.    |
| Build assumptions       | Host bundle targets Node 22; webview bundle targets Chrome 128.                                                                              | Check actual runtime/browser engines in every host. A webview alone does not guarantee compatibility. |

Repository evidence: [backend interfaces](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/core/agent/agentBackend.ts), [webview entry](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/webview/main.tsx), [message protocol](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/shared/protocol.ts), [manifest](https://github.com/RandyNorthrup/muse-spark-code/blob/main/package.json), [build configuration](https://github.com/RandyNorthrup/muse-spark-code/blob/main/scripts/build.mjs).

The remaining host work includes active documents and selections, diagnostics, file dialogs, editor diffs, dirty buffers, terminal environments, secrets, settings, persistence, notifications, resource URLs, localization, and native voice helpers. The activation entry point currently wires these services through VS Code. [Extension wiring](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/extension.ts), [webview setup](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/host/views/webviewSetup.ts)

## 3. Compatibility matrix

**Priority meanings:** Early = first expansion waves; Next = dedicated adapter after the foundation; Conditional = investigate a specific restriction before making a commitment. These are roadmap priorities, not current support badges.

### 3.1 Editors and workspaces that can reuse the VS Code adapter

| Target                             | Planned delivery and interface                                           | Priority and qualification                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VS Code desktop                    | Existing extension and full Muse React interface.                        | Reference implementation throughout the migration.                                                                                                                                                                                                                                                           |
| VSCodium                           | Existing adapter; Open VSX and the project's release VSIX.               | Early. Check actual API and Node versions. [Extension documentation](https://github.com/VSCodium/vscodium/blob/master/docs/extensions.md)                                                                                                                                                                    |
| Cursor                             | Existing adapter and full Muse interface; Open VSX distribution.         | Early. Validate coexistence with its built-in AI, shortcuts, authentication, and editor runtime. [Cursor extensions](https://cursor.com/help/customization/extensions)                                                                                                                                       |
| Kiro IDE                           | Existing adapter; Open VSX distribution.                                 | Early. Kiro rebases selectively on VS Code OSS, so its actual version must meet our requirements. This claim concerns Kiro IDE. [Migration guide](https://kiro.dev/docs/upgrade-guides/migrating-from-vscode/), [registry](https://kiro.dev/docs/ide/editor/extension-registry/)                             |
| Positron                           | Existing adapter and React interface; Open VSX catalog or manual VSIX.   | Early. Most VS Code extensions are compatible; qualify Muse specifically. Current default gallery serves the Open VSX catalog through Posit Public Package Manager. [Positron extensions](https://positron.posit.co/extensions.html)                                                                         |
| Eclipse Theia IDE                  | Existing VSIX with targeted compatibility adjustments.                   | Early/Next. Theia implements the VS Code API separately and has documented gaps and stubs. Test behavior, not only method existence. [Install extensions](https://theia-ide.org/docs/user_install_vscode_extensions/), [API comparator](https://eclipse-theia.github.io/vscode-theia-comparator/status.html) |
| code-server                        | Existing adapter in the server extension host; React UI in the browser.  | Early remote target. Agent binaries, files, shell, and credentials belong to the workspace host. [FAQ](https://coder.com/docs/code-server/FAQ)                                                                                                                                                               |
| GitHub Codespaces                  | Existing workspace extension in the remote Node host.                    | Early remote target. Test authentication, server paths, process dependencies, and persistence. [Remote extensions](https://code.visualstudio.com/api/advanced-topics/remote-extensions)                                                                                                                      |
| Eclipse Che / OpenShift Dev Spaces | Existing adapter when the chosen workspace editor is Code-OSS.           | Next remote target. Support depends on the configured workspace image/editor; a JetBrains workspace uses the JetBrains route. [Che architecture](https://eclipse.dev/che/docs/stable/discover/what-is-che/)                                                                                                  |
| Firebase Studio                    | Existing adapter, Open VSX, runtime packages in workspace configuration. | Next remote target. Qualify extension behavior and installation of the agent beside the workspace. [Workspace customization](https://firebase.google.com/docs/studio/customize-workspace)                                                                                                                    |
| Google Antigravity IDE             | Candidate for a VS Code-adapter prototype.                               | Conditional. Current retrieved primary documentation establishes the IDE surface, but did not establish an arbitrary-extension installation contract. Verify before promising a VSIX release. [IDE overview](https://antigravity.google/docs/ide/overview/)                                                  |

Keep the VS Code API minimum at `^1.125.0` unless an audit and real-host tests justify a change. Lowering a manifest requirement does not supply a missing API or upgrade the editor's embedded Node runtime. The existing build also needs a runtime that supports the Node features and dependencies it actually uses. [VS Code manifest reference](https://code.visualstudio.com/api/references/extension-manifest), [current project manifest](https://github.com/RandyNorthrup/muse-spark-code/blob/main/package.json)

### 3.2 IDEs and editors reached through a shared ACP agent

ACP connects an external coding agent to an editor-provided interface. Implementing an ACP adapter would preserve Muse's agent logic while using the client's chat, tools, and approval presentation. Its optional capabilities must be negotiated. [ACP introduction](https://agentclientprotocol.com/get-started/introduction), [protocol overview](https://agentclientprotocol.com/protocol/v1/overview)

| Target                   | Planned route                                                                                     | Interface and conditions                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JetBrains IDEs           | Shared ACP executable through supported AI Assistant versions.                                    | JetBrains AI Chat. Target IntelliJ IDEA, PyCharm, WebStorm, PhpStorm, GoLand, CLion, RustRover, Rider, RubyMine, and DataGrip where the applicable product/version supports this feature. Qualify each product. Current docs say no JetBrains AI service subscription is required and WSL is unsupported for ACP. [JetBrains ACP](https://www.jetbrains.com/help/ai-assistant/acp.html) |
| Zed                      | Shared ACP executable; custom configuration first, registry distribution later.                   | Zed's Agent Panel. Current docs prefer the ACP Registry and deprecate extension-provided agents as the main distribution path. [External agents](https://zed.dev/docs/ai/external-agents)                                                                                                                                                                                               |
| Xcode 27+                | Shared ACP executable added as an agent in Intelligence settings.                                 | Xcode's native coding assistant. Xcode 27 release notes explicitly introduce generic ACP support. [Release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes), [setup](https://developer.apple.com/documentation/xcode/setting-up-coding-intelligence)                                                                                        |
| Qt Creator               | Shared executable configured in the official ACP Client extension.                                | Qt Creator's chat and change-review interface. Optional MCP Server integration supplies builds and compiler output. Qualify a release containing this extension; reviewed docs identify Qt Creator 20.0.2. [ACP Client](https://doc.qt.io/qtcreator/creator-how-to-use-acp-client.html)                                                                                                 |
| Neovim                   | Shared executable through a maintained ACP client; choose CodeCompanion as the first test target. | Native Neovim client UI. Support the exact client/version; other ACP plugins remain separate qualification targets. [CodeCompanion ACP adapters](https://codecompanion.olimorris.dev/configuration/adapters-acp)                                                                                                                                                                        |
| Emacs                    | Shared executable through `agent-shell`.                                                          | Emacs interface. Community-client dependency must appear in support documentation. [agent-shell](https://github.com/xenodium/agent-shell)                                                                                                                                                                                                                                               |
| Sublime Text             | Shared executable through the community `sublime-acp` package.                                    | Package-provided interface. Test that package's actual behavior; this is not a first-party Sublime ACP promise. [sublime-acp](https://github.com/debjan/sublime-acp)                                                                                                                                                                                                                    |
| Windsurf / Devin Desktop | Prefer the documented ACP route; investigate full VSIX coexistence separately.                    | Devin interface. Current ACP availability is plan-dependent; Pro, Max, and Teams are documented. Agent installation is separate, terminal callbacks are absent, and modes use session configuration options. [ACP availability](https://docs.devin.ai/desktop/acp), [custom agents](https://docs.devin.ai/desktop/acp-custom)                                                           |

Windsurf is identified as Devin Desktop in its current documentation. Extension installation guidance is inconsistent across its pages, so the full Muse VSIX remains a qualification task. The documented custom ACP path is a firmer basis for planning. [Rename FAQ](https://docs.devin.ai/desktop/devin-desktop-faq), [extension guidance](https://docs.devin.ai/desktop/recommended-extensions), [getting-started guidance](https://docs.devin.ai/desktop/getting-started)

**Android Studio is tracked separately below.** Sharing the IntelliJ Platform does not by itself prove that the JetBrains AI Assistant ACP entry point is available in Android Studio.

### 3.3 Dedicated native adapters

| Target                                        | Proposed implementation                                                                                                 | Initial scope and priority                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JetBrains full Muse interface                 | Kotlin/Java plugin, JCEF tool window, shared React bundle, shared agent runtime.                                        | Next. Preserve the Muse interface and custom controls. Use common APIs; add product-specific services only where necessary. Check JCEF availability. [JCEF](https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html), [plugin compatibility](https://plugins.jetbrains.com/docs/intellij/plugin-compatibility.html)                                                                               |
| Android Studio                                | Shared IntelliJ plugin code, separately built and tested against Android Studio's platform version and browser runtime. | Next, alongside the JetBrains plugin. Android-aware build or project tools can follow baseline chat/context/edit support. [Android Studio plugin development](https://plugins.jetbrains.com/docs/intellij/android-studio.html)                                                                                                                                                                                   |
| Microsoft Visual Studio, Windows IDE          | C#/.NET host with editor/solution services and a browser-backed tool window. Assess VSSDK plus WPF/WebView2 first.      | Next. Existing VS Code VSIX is not this plugin. Prove the chosen SDK/browser combination before committing. [Tool windows](https://learn.microsoft.com/en-us/visualstudio/extensibility/creating-an-extension-with-a-tool-window?view=visualstudio), [WebView2 WPF](https://learn.microsoft.com/en-us/microsoft-edge/webview2/get-started/wpf)                                                                   |
| Eclipse IDE, classic                          | Java/OSGi plugin; SWT Browser and Java/JavaScript bridge; shared agent runtime.                                         | Next. Prototype React rendering, then editor context, changes, diagnostics, and workspace lifecycle. Distinct from Theia. [SWT Browser](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/swt/browser/Browser.html), [BrowserFunction](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/api/org/eclipse/swt/browser/BrowserFunction.html) |
| Apache NetBeans                               | Java module with editor APIs and HTML UI integration.                                                                   | Next. Prove the real React bundle works in the chosen HTML runtime. [HTML UI API](https://bits.netbeans.org/dev/javadoc/org-netbeans-api-htmlui/org/netbeans/api/htmlui/OpenHTMLRegistration.html)                                                                                                                                                                                                               |
| JupyterLab 4 / Notebook 7+                    | TypeScript frontend with shared React components; Jupyter server extension connecting the agent runtime.                | Next. Use notebook document/cell APIs. Notebook 7 gets its own application tests. [React integration](https://jupyterlab.readthedocs.io/en/stable/extension/virtualdom.html), [server extensions](https://jupyter-server.readthedocs.io/en/latest/developers/extensions.html), [Notebook versions](https://jupyter-notebook.readthedocs.io/en/latest/changelog.html)                                             |
| Spyder                                        | Python/Qt plugin connecting the shared runtime; native interface or validated Qt WebEngine embedding.                   | Later native wave. Confirm distribution for the supported Spyder installation type; current docs recommend Conda for third-party plugins. [Plugin development](https://docs.spyder-ide.org/current/workshops/plugin-development.html), [installation](https://docs.spyder-ide.org/current/installation.html)                                                                                                     |
| RStudio Desktop / Server / Workbench sessions | R addin and `rstudioapi`, with a Shiny Gadget or adjacent shared web interface.                                         | Later native wave. Start with selected code, chat, proposed changes, and document application; account for R-session lifecycle. [RStudio addins](https://docs.posit.co/ide/user/ide/guide/productivity/add-ins.html)                                                                                                                                                                                             |

Rider's baseline chat/editor plugin can use the IntelliJ frontend; deeper C# semantic features may require its ReSharper backend. Visual Studio's newer out-of-process Remote UI model should not be assumed to accept an arbitrary WPF/WebView2 control. Both are specific implementation gates. [IntelliJ and Rider architecture](https://plugins.jetbrains.com/docs/intellij/intellij-platform.html), [VisualStudio.Extensibility tool windows](https://learn.microsoft.com/en-us/visualstudio/extensibility/visualstudio.extensibility/tool-window/tool-window?view=vs-2022)

### 3.4 Constrained, external, and conditional targets

| Target                                                  | Credible starting point                                                                          | Boundary of the current plan                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vscode.dev` / `github.dev` without remote compute      | New browser entry point plus an authorized remote runtime or separately designed local bridge.   | Current main-only Node extension cannot run here. A browser worker cannot launch the Muse CLI. [Web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)                                                                                                                    |
| Xcode 26.3+ without the Xcode 27 ACP route              | External Muse runtime/interface using Xcode MCP tools through `xcrun mcpbridge`.                 | External-agent integration; do not promise an embedded Muse panel. [Xcode external agents](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode), [26.3 announcement](https://www.apple.com/newsroom/2026/02/xcode-26-point-3-unlocks-the-power-of-agentic-coding/) |
| Vim                                                     | Terminal Muse client, then a purpose-built Vim integration if demand warrants it.                | Neovim plugin compatibility does not establish Vim compatibility. No native Muse plugin is established by this research.                                                                                                                                                                              |
| Kate                                                    | External tool/terminal integration first; evaluate a native plugin or released ACP client later. | Reviewed official site still lists its ACP work as an open merge request. [Kate development status](https://kate-editor.org/merge-requests/)                                                                                                                                                          |
| MATLAB                                                  | MATLAB app/add-on with a `uihtml` interface and selected editor workflows.                       | Conditional app integration. `uihtml` is not proof of full IDE-plugin support; its documented desktop media limitations matter. [uihtml](https://www.mathworks.com/help/matlab/ref/uihtml.html)                                                                                                       |
| Replit                                                  | Test the future Muse CLI in the project shell or use an adjacent interface.                      | Current shell/MCP docs do not establish installation of the complete Muse assistant UI. [Shell](https://docs.replit.com/features/workspace-tools/shell), [MCP](https://docs.replit.com/features/mcp/overview)                                                                                         |
| StackBlitz / Codeflow                                   | Runtime experiment or attached supported editor.                                                 | WebContainers running Node does not prove support for Muse's native CLI/process assumptions or arbitrary VSIX installation. [Environments](https://developer.stackblitz.com/guides/user-guide/available-environments)                                                                                 |
| CodeSandbox / Ona, formerly Gitpod                      | Investigate supported remote-editor attachment and runtime execution.                            | Current retrieved sources did not establish a generic embedded Muse extension route. Keep conditional rather than inheriting older product assumptions. [CodeSandbox](https://codesandbox.io/), [Ona](https://ona.com/)                                                                               |
| Arduino IDE 2, Code::Blocks, CodeLite, Geany, Notepad++ | Explicitly scoped external-tool or native-plugin feasibility studies if these become priorities. | Watchlist. This review did not establish a full supported route. A shared toolkit or embedded editor is insufficient evidence.                                                                                                                                                                        |

## 4. Shared architecture

### 4.1 Package boundaries

The following names are proposed boundaries, not files already created in the repository.

| Proposed package/area                                    | Responsibility                                                                                | Starting material                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `core`                                                   | Backends, agent sessions/events, rules, skills, memory, tools, usage, export.                 | `src/core` and neutral shared types.                               |
| `application`                                            | Conversation orchestration, host-independent feature policy, session coordination.            | Reusable portions of `src/host/conversation` and backend managers. |
| `contracts`                                              | Versioned UI messages, editor services, capability definitions, schema validation.            | `src/shared/protocol.ts` and injected host interfaces.             |
| `ui`                                                     | Shared React app, localization, presentation, accessible components, theme tokens.            | `src/webview` and UI localization tables.                          |
| `runtime-node`                                           | Agent process lifecycle, filesystem/search workers, shell, local persistence, backend wiring. | Portable host utilities and existing process helpers.              |
| `adapters/vscode`                                        | VS Code API implementation and existing marketplace package.                                  | `src/extension.ts` and VS Code-specific host code.                 |
| `adapters/acp`                                           | ACP protocol translation, client capability negotiation, client I/O where available.          | New boundary around `AgentHost`/`AgentSession`.                    |
| `adapters/jetbrains`, `visualstudio`, and later adapters | Native UI container and editor integration, connecting shared packages/runtime.               | New host code in each platform's supported language.               |

Preserve the existing VS Code implementation as the reference client while extracting each boundary. Some host files are already structurally portable. For example, the credential store accepts a small injected interface, while `ChatSurface` currently inherits a VS Code type. Remove these incidental type dependencies rather than duplicating the underlying behavior. [Credential store](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/host/auth/credentialStore.ts), [ChatSurface definition](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/host/views/webviewSetup.ts)

### 4.2 Reuse the interface through a host bridge

Replace the direct `acquireVsCodeApi()` dependency with an injected interface for sending/receiving validated messages and saving/restoring view state. Supply host theme tokens, localization, focus/navigation behavior, and resource URLs through adapter boundaries. Keep model credentials outside the React layer.

VS Code can retain its existing postMessage transport. JetBrains can use JCEF callbacks; Visual Studio can use the selected WebView2 messaging mechanism. Shared components should use Muse theme tokens mapped from each editor rather than assuming every host supplies VS Code CSS variables. Browser compatibility testing must include JavaScript, CSS, clipboard/drag-and-drop, accessibility, and lifecycle behavior.

The Node engine can remain in-process where a host already supplies an appropriate Node environment. Native IDE plugins will generally connect to a separate packaged runtime. A shared codebase does not require every host to use an identical process arrangement.

### 4.3 Editor services

Define explicit services for workspace roots; document URI and identity; active selection; content snapshots; dirty/version state; edits; file/diff navigation; diagnostics; commands and terminals; settings; secrets; persistence; and UI actions.

Use URI/document identities at the host boundary and resolve local paths only inside the appropriate workspace runtime. Include expected document versions or content checks in edit operations. Multiple IDE windows editing the same workspace need a defined ownership/conflict policy. Language-specific services, such as Rider C# analysis or notebook cells, should be optional extensions to this contract.

## 5. ACP implementation plan

Add a proposed entry point such as `muse-spark-code acp`. This command does not exist in the reviewed release. Use stable ACP v1 as the initial interoperability baseline and pin the selected SDK after the project's dependency review. Current official guidance describes v2 as a draft and recommends retaining v1 compatibility. [TypeScript SDK](https://agentclientprotocol.com/libraries/typescript), [v2 draft status](https://agentclientprotocol.com/announcements/acp-v2-draft)

Implement the following in dependency order:

1. Initialization, version negotiation, and accurate capability reporting.
2. Authentication handoff to supported Muse credentials and backend selection.
3. Session creation, prompt submission, streamed updates, and cancellation.
4. Tool activity, results, file locations, diffs, and backend approval decisions.
5. Client filesystem/terminal operations where advertised and usable by the selected backend.
6. Session loading/history, available commands, model/mode configuration, usage, and questions where both ends support them.
7. Adapter-specific installation profiles and a tested feature manifest for each client.

Do not reduce Muse permissions merely because ACP permits an agent to choose when to ask. Preserve the product's actual approval policy. Map choice IDs and cancellation precisely; a declined or cancelled operation must not execute because of a translation default.

ACP v1 can carry image/audio content and optional structured elicitation, but the editor controls presentation and supported inputs. Custom subagent maps, detailed usage panels, and the exact Muse attachment interface require either explicit client support or the shared Muse UI. [Content types](https://agentclientprotocol.com/protocol/v1/content), [elicitation](https://agentclientprotocol.com/protocol/v1/elicitation)

Keep protocol responsibilities separate: ACP connects the agent conversation to the editor; MCP supplies tools/resources to the agent; LSP supplies language services. An MCP server does not automatically install Muse as an IDE's coding assistant. Qt Creator demonstrates how an ACP chat and an MCP build/tool service can work together. [ACP introduction](https://agentclientprotocol.com/get-started/introduction), [Qt Creator ACP guide](https://doc.qt.io/qtcreator/creator-how-to-use-acp-client.html)

## 6. Backend-specific editing and credential boundaries

### 6.1 File changes must be qualified separately

The Model API backend accepts injected `ToolIo` services. Muse Code's CLI owns substantial file and command execution itself. Translating an MSP event into an ACP diff reports activity; it does not reroute the original operation through the editor or create an undo transaction. ACP explicitly permits agent-owned execution and makes client filesystem/terminal services optional. [Model API manager](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/host/backend/modelApiBackendManager.ts), [tool I/O](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/host/backend/toolIo.ts), [ACP tool execution](https://agentclientprotocol.com/protocol/v1/tool-calls)

For Model API mode, evaluate client-mediated reads/writes, while auditing shell and other mutation paths that can bypass them. For CLI mode, verify whether the backend provides usable pre-execution controls or delegation. An after-the-fact event cannot prevent overwriting a dirty buffer. Native undo, safe handling of unsaved changes, and change review are separate capabilities that require real-host tests. [ACP filesystem capabilities](https://agentclientprotocol.com/protocol/v1/file-system)

If safe shared-workspace editing cannot be established, use an isolated workspace with explicit patch application and conflict checks, or a genuinely enforced read-only mode. Do not silently save or discard unsaved documents. Do not apply a patch a second time when the backend already performed the change.

A separate checkout stages changes but does not by itself confine a CLI or shell. If isolation is required to prevent changes to the original workspace, enforce that write boundary for backend processes and shell tools, including absolute paths and symlinks. Apply resulting patches through host edits that check current document versions and conflicts.

### 6.2 Preserve authentication policy during extraction

The existing project keeps the pasted Model API key in VS Code SecretStorage and does not pass it to child processes; the Muse Code CLI authenticates independently. A new runtime must not silently turn that key into a launch argument, environment setting, webview message, or general IPC field. [Project credential rules](https://github.com/RandyNorthrup/muse-spark-code/blob/main/AGENTS.md)

The first ACP feasibility build should reuse the CLI's established login. Before adding Model API support to a standalone runtime, record the precise credential ownership design in `PLAN.md`: either the runtime retrieves its own credential from a supported protected OS store, or the key-owning host performs authenticated model requests through a narrowly defined service. Generalizing VS Code-specific storage language to other hosts is an explicit architecture decision, not permission to forward keys to the Muse CLI. Until that decision is implemented and verified, mark Model API support in that adapter as pending.

Preserve existing paid-feature opt-ins, workspace protections, and supported authentication behavior. Protocol or editor support does not grant a model subscription, provider access, or additional billing permissions.

## 7. Support levels and feature reporting

Track **integration type** independently from **release status**.

| Integration type       | User-facing promise                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------- |
| Full Muse interface    | Shared Muse chat interface inside the editor, with the advertised host features.    |
| Native agent interface | Muse engine through ACP in the editor's interface, with listed feature differences. |
| External integration   | Muse terminal/adjacent interface with the specified editor connection.              |

Release status progresses through **Planned → Prototype → Preview → Supported**. A failing regression can move an affected editor version back to Preview or Unsupported without changing every other adapter's status.

For each editor/version/backend/OS, record: installation; authentication; streaming; cancellation; permission enforcement; selected/unsaved context; edit handling; diff presentation; native undo; shell execution; diagnostics; history/resume; subagent presentation/control; images; voice; paid features; and remote-workspace behavior. Use explicit values such as tested, partial, unavailable, and unverified.

A successful installation is the first qualification step. It is not sufficient evidence for editing, credentials, or full feature parity.

## 8. Rollout and acceptance criteria

| Phase                                     | Deliverables                                                                                                                                                         | Completion evidence                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A — Compatibility inventory               | Actual API/runtime requirements; capability matrix; minimal probes for VSCodium, Cursor, Kiro, Positron, Theia; first ACP client and native browser-host prototypes. | Real-host install/activation results; list of concrete blockers; selected runtime/credential design.            |
| B — Shared boundaries                     | Extract contracts, reusable application services, UI bridge, Node runtime entry, and capability detection while preserving VS Code behavior.                         | Existing quality gates pass; unchanged VS Code workflows; shared engine can be driven without loading `vscode`. |
| C — VS Code family                        | Qualify desktop forks; dual marketplace/release packaging; remote Codespaces and code-server profiles.                                                               | Per-host test records, repeatable installs, authentication and editing checks, published limitations.           |
| D — ACP expansion                         | Shared ACP adapter; initially Zed and one JetBrains IDE, then Xcode, Qt Creator, Neovim, Emacs, Sublime, and Devin.                                                  | Backend-specific permission/edit/cancel results; versioned client configs; no unsupported capability calls.     |
| E — Full native interfaces                | Shared IntelliJ plugin including separate Android Studio qualification; Visual Studio host.                                                                          | Native context/diff integration, protected credentials, lifecycle reliability, usable shared React interface.   |
| F — Additional native and scientific IDEs | Eclipse, NetBeans, JupyterLab/Notebook, then Spyder and RStudio.                                                                                                     | Host-specific document tests; notebook cell/metadata preservation; installation route validated.                |
| G — Conditional environments and media    | Browser-only bridge work; additional cloud/embedded targets; shared mobile/desktop media integration.                                                                | Each restricted host has a verified supported route before inclusion in release claims.                         |

Some work can proceed concurrently: VSIX compatibility checks do not need to wait for complete engine extraction, and native browser-container prototypes can run while ACP is developed. Make Zed the first ACP client because it provides a direct documented custom-agent route; use a JetBrains IDE as the second to expose client differences early. Qt Creator should be close behind for this project's C++/Qt development use cases.

These phases describe dependency order and scope rather than calendar promises. The first prototypes should establish whether each remaining port is a small adapter, a substantial native integration, or a restricted environment. Set schedule estimates from those results.

## 9. Verification and maintenance

Reuse the repository's deterministic fake CLI, protocol captures, unit tests, and webview harness as the common test foundation. Add real-host adapter tests for behaviors that mocks cannot prove. Run live model checks only through an explicitly selected, budgeted smoke-test workflow; broad compatibility CI should not consume subscriptions or enable paid extras automatically. [Existing test and release workflow](https://github.com/RandyNorthrup/muse-spark-code/blob/main/README.md#development)

Required release scenarios:

1. Clean install, reload, update, uninstall, and missing/incompatible runtime.
2. Correct authentication, expired credentials, sign-out, and backend isolation.
3. Streaming and cancellation during a response, a pending permission, and a running command.
4. Allowed and refused edits/commands; delayed or already-settled decisions.
5. Saved versus dirty document content, edits made during a running turn, and change-conflict recovery.
6. Exactly-once changes, truthful diff state, and explicitly verified undo/revert behavior.
7. Multi-root/multi-window identity, Unicode paths, line endings, and remote workspace placement.
8. Session restore after UI reload and predictable behavior after runtime restart.
9. Unavailable optional capabilities, inaccessible key storage, and missing system helpers.
10. Shared-UI themes, localization, screen-reader/keyboard operation, attachments, and supported media routes.

Test current stable releases and each declared minimum supported version. Include Windows/macOS/Linux and CPU architectures only where the IDE, agent backend, and native helpers actually support them. Record the exact client plugin version for community ACP integrations. Use JetBrains Plugin Verifier for declared native plugin targets in addition to functional tests. [Plugin compatibility tools](https://plugins.jetbrains.com/docs/intellij/plugin-compatibility.html)

## 10. Packaging and release policy

- Publish the VS Code package to Microsoft Marketplace and Open VSX, and retain an independently downloadable release VSIX. Preserve extension identity where registry ownership allows.
- Ship a versioned ACP executable/runtime with launch profiles that contain no API keys. Start with manual configuration; pursue ACP Registry inclusion after qualification.
- Package native IDE hosts separately, but build their shared engine and UI from the same tested source revision.
- Define a protocol compatibility range between host plugins and runtimes. Refuse incompatible pairings with a clear actionable error.
- Reuse a supported existing Node runtime when appropriate; provide a deliberate managed/bundled runtime route where users should not have to install Node. Verify packaging, licensing, signing, updates, and CPU support before selecting that route.
- Continue existing below-1.0 version policy. New ports do not independently authorize a 1.0 release.

Open VSX distribution is central to reaching several compatible editors. Zed's current distribution documentation instead centers on the ACP Registry. Keep those as separate deliverables. [Open VSX registry FAQ](https://www.eclipse.org/legal/open-vsx-registry-faq/), [Zed agent distribution](https://zed.dev/docs/ai/external-agents)

## 11. Connection to the Muse Spark Code companion app

The same shared UI and application contracts can support the planned phone companion. Keep media capture as an optional host capability: phone camera, desktop microphone, or a future glasses source. Route captured assets to a specifically paired workspace/session.

The reviewed backend turn contract accepts text, images, and skills; it does not establish universal video-input support. Future video/live capture therefore needs its own backend capability and processing plan. ACP's documented media content does not define a universal camera button or live-glasses interface in every editor. [Current turn contract](https://github.com/RandyNorthrup/muse-spark-code/blob/main/src/core/agent/agentBackend.ts), [ACP content types](https://agentclientprotocol.com/protocol/v1/content)

For remote development, capture happens on the user's device while execution occurs beside the workspace. A device's localhost is not the cloud workspace's localhost. Design pairing, authenticated transport, session selection, and attachment delivery explicitly when that feature is implemented. Keep the capture feature independent of an IDE adapter so each new IDE can share the same asset pipeline.

## 12. First implementation backlog

1. Add this scope to the existing `PLAN.md` before implementation, following project instructions; preserve earlier decisions and completed milestones.
2. Inventory actual VS Code and Node API usage and record the supported runtime baseline.
3. Create the capability matrix and common adapter contract, including editing ownership and credential ownership.
4. Extract the webview bridge and remove incidental VS Code types from shared interfaces.
5. Add a standalone runtime entry and deterministic protocol fixtures.
6. Prove one ACP conversation and cancellation path in Zed, then one JetBrains client.
7. Prove safe file changes independently for the Muse Code and Model API backends before marking editing supported.
8. Qualify VSCodium, Cursor, Kiro, and Positron; establish Open VSX packaging alongside existing releases.
9. Add Xcode and Qt Creator profiles; expand community-client coverage with exact versions.
10. Build the IntelliJ/Android Studio and Visual Studio native hosts using the shared React bundle.

The next engineering milestone should deliver a portable runtime/contract foundation plus a small number of verified hosts. The broader matrix defines the expansion path, and each support claim follows measured behavior in the relevant editor.
