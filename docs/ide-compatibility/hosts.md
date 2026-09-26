# Editors: route and status

Every editor Muse Spark Code aims at (PLAN.md D60, D62), the route it takes,
and how far it has got. **Status** moves Planned → Prototype → Preview →
Supported, and only on recorded evidence: an install is the first step,
not the claim. **Route**: _VSIX_ (the VS Code extension as it is), _ACP_
(the `muse-spark-code-acp` agent in the editor's own chat), _Native_ (a
plugin that embeds the Muse panel), _External_ (a terminal or adjacent
window with a limited link to the editor).

Where it can be tested: this project's cloud container reaches npm, PyPI,
Maven Central, Gradle, NuGet, Ubuntu's archive and download.eclipse.org,
and not JetBrains, Microsoft's VS Code downloads, Open VSX, Zed's site or
neovim.io (2026-09-26). An editor the container cannot install is
qualified in CI or on the owner's machines.

The ACP agent itself is built (M63a) and certified against the ACP SDK's
own client, over stdio and in process, with the fake backends
(`docs/certification/m63.md`). No editor below has run it yet, so every
ACP row stays Planned until one has.

## The most used

| Editor                                             | Route                                         | Milestone | Status    | Evidence and notes                                                  |
| -------------------------------------------------- | --------------------------------------------- | --------- | --------- | ------------------------------------------------------------------- |
| VS Code (desktop, Remote, WSL)                     | VSIX                                          | —         | Supported | The reference client, on the Marketplace since 0.1.0                |
| Visual Studio (Windows)                            | Native (VSSDK, WebView2)                      | M64       | Planned   | Needs Windows to build and test                                     |
| IntelliJ IDEA, PyCharm, WebStorm, GoLand, PhpStorm | ACP (AI Assistant), then Native (JCEF)        | M63, M64  | Planned   | JetBrains downloads are blocked in the container                    |
| CLion, RustRover, RubyMine, DataGrip               | ACP (AI Assistant), then Native (JCEF)        | M63, M64  | Planned   | As above                                                            |
| Rider                                              | ACP (AI Assistant), then Native (JCEF)        | M63, M64  | Planned   | Deeper C# features would need its ReSharper backend                 |
| Android Studio                                     | Native (the IntelliJ plugin, built for it)    | M64       | Planned   | ACP through AI Assistant not established there                      |
| Cursor                                             | VSIX (Open VSX)                               | M62       | Planned   | Its VS Code version must meet `engines.vscode`, `^1.99.0` since M62 |
| Windsurf / Devin Desktop                           | ACP (documented custom agents), VSIX to check | M62, M63  | Planned   | ACP is plan-dependent there                                         |
| Vim                                                | External (terminal), then a plugin            | M66       | Planned   |                                                                     |
| Neovim                                             | ACP (CodeCompanion first)                     | M63       | Planned   | Other ACP plugins are separate qualifications                       |
| Jupyter (JupyterLab 4, Notebook 7)                 | Native (lab extension and server extension)   | M65       | Planned   | Installable in the container from PyPI                              |
| Sublime Text                                       | ACP (`sublime-acp`)                           | M63       | Planned   | A community package                                                 |
| Eclipse IDE                                        | Native (SWT Browser)                          | M65       | Planned   | Installable in the container from download.eclipse.org              |
| Xcode 27                                           | ACP (Intelligence settings)                   | M63       | Planned   | Needs macOS                                                         |
| Xcode 26.3                                         | External (Xcode's MCP tools)                  | M66       | Planned   |                                                                     |
| Zed                                                | ACP (custom agent, then the ACP Registry)     | M63       | Planned   | The registry wants an npm package (Q65)                             |
| Notepad++                                          | External                                      | M66       | Planned   | Windows only                                                        |

## The VS Code family

| Editor                            | Route                            | Milestone | Status  | Evidence and notes                                                                                                                                  |
| --------------------------------- | -------------------------------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| VSCodium                          | VSIX (Open VSX)                  | M62       | Preview | 2026-09-26: the integration tests pass in 1.99.3 and 1.135 (9 each), installed from the `.vsix`; Open VSX from the next tag                         |
| Kiro IDE                          | VSIX (Open VSX)                  | M62       | Planned |                                                                                                                                                     |
| Positron                          | VSIX (Open VSX)                  | M62       | Planned |                                                                                                                                                     |
| Eclipse Theia IDE                 | VSIX                             | M62       | Planned | Theia implements the API itself; `host-api.md` lists what we use                                                                                    |
| code-server                       | VSIX, in the server's host       | M62       | Preview | 2026-09-26: 4.99.4 (VS Code 1.99.3, Node 20.18.3) installs the `.vsix`, and the panel runs a conversation and an approval in the browser (fake CLI) |
| GitHub Codespaces                 | VSIX, in the remote host         | M62       | Planned |                                                                                                                                                     |
| Eclipse Che, OpenShift Dev Spaces | VSIX with a Code-OSS editor      | M62       | Planned |                                                                                                                                                     |
| Firebase Studio                   | VSIX (Open VSX)                  | M62       | Planned |                                                                                                                                                     |
| Google Antigravity                | VSIX, if it installs extensions  | M62       | Planned | Not established that it takes arbitrary extensions                                                                                                  |
| vscode.dev, github.dev            | A browser entry and remote agent | M66       | Planned | The extension has no `browser` entry today                                                                                                          |

## Through the ACP agent

| Editor                  | Client                      | Milestone | Status  | Evidence and notes                        |
| ----------------------- | --------------------------- | --------- | ------- | ----------------------------------------- |
| Zed                     | Built in                    | M63       | Planned |                                           |
| JetBrains IDEs          | AI Assistant                | M63       | Planned | WSL not supported by JetBrains' ACP       |
| Xcode 27                | Built in                    | M63       | Planned |                                           |
| Qt Creator              | The ACP Client extension    | M63       | Planned |                                           |
| Neovim                  | CodeCompanion               | M63       | Planned |                                           |
| Emacs                   | agent-shell                 | M63       | Planned | Emacs installable from Ubuntu's archive   |
| Sublime Text            | sublime-acp                 | M63       | Planned |                                           |
| Windsurf, Devin Desktop | Custom agents               | M63       | Planned |                                           |
| Kate                    | Its ACP work, once released | M66       | Planned | Still an open merge request when reviewed |

## Native and scientific

| Editor                    | Route                               | Milestone | Status  |
| ------------------------- | ----------------------------------- | --------- | ------- |
| Apache NetBeans           | Native (HTML UI)                    | M65       | Planned |
| Spyder                    | Native (Qt), Conda distribution     | M65       | Planned |
| RStudio (Desktop, Server) | Native (an R addin with a web view) | M65       | Planned |
| MATLAB                    | External (`uihtml` app)             | M66       | Planned |

## Constrained and watched

| Editor                                       | Starting point                             | Milestone | Status  |
| -------------------------------------------- | ------------------------------------------ | --------- | ------- |
| Replit                                       | The agent in the project shell             | M66       | Planned |
| StackBlitz, Codeflow                         | A runtime experiment                       | M66       | Planned |
| CodeSandbox, Ona                             | Remote-editor attachment                   | M66       | Planned |
| Arduino IDE 2, Code::Blocks, CodeLite, Geany | External tool, or a native plugin if asked | M66       | Planned |
