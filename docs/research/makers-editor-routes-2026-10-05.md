I found a route for most of these editors. JetBrains/CLion is the only one with built-in ACP. For Arduino IDE 2 a VSIX side-load works in principle, but our current build won't load as-is because of version mismatches. Thonny, Mu and the browser editors need the companion UI.

## 1. Arduino IDE 2.x (Theia)

- **VSIX side-load works.** You unzip the VSIX into `~/.arduinoIDE/plugins/` (it was `extensions/` up to 2.0.4) and restart. https://forum.arduino.cc/t/how-to-install-vscode-color-theme-extensions/990374
- **Arduino only documents themes** and says it doesn't support third-party ones. https://github.com/arduino/arduino-ide/blob/main/docs/advanced-usage.md
- **Full extensions already ship this way:**
  - PJRC's (Teensy) VSIX installer. https://gist.github.com/PaulStoffregen/cd1d36d4b22a3f6f31dbb6c0920a0f44
  - AI.duino 2.7.1, an agentic assistant that drives Claude Code, OpenCode or Gemini CLI. https://github.com/NikolaiRadke/AI.duino
- **No official plugin roadmap found** (unverified). The only maintainer action I found was removing the old `~/.arduinoProIDE/plugins` drop-in folder. https://github.com/arduino/arduino-ide/issues/1851
- **Versions:**
  - Latest release is 2.3.10 (2026-06-09); main is at 2.3.11. https://api.github.com/repos/arduino/arduino-ide/releases
  - Theia 1.57.0 since 2.3.5, Electron 30.1.2. https://github.com/arduino/arduino-ide/blob/main/electron-app/package.json
  - Theia 1.57 supports VS Code API 1.96.0. https://eclipsesource.com/blogs/2024/12/20/eclipse-theia-1-57-release-news-and-noteworthy/
  - Electron 30.1.2 bundles Node 20.14.0 and Chromium 124. https://releases.electronjs.org/release/v30.1.2
- **Why our build won't load as-is:**
  - We declare `^1.99.0`, but the IDE reports API 1.96.0.
  - The extension host is Node 20.14 (my inference from Electron's Node), and we require Node 22.
  - In 2019 Theia rejected plugins that asked for a newer API. https://github.com/eclipse-theia/theia/issues/4124
  - The 1.57 scanner I read only records the engine field and doesn't check it. Whether something else checks it is unverified. https://raw.githubusercontent.com/eclipse-theia/theia/v1.57.0/packages/plugin-ext-vscode/src/node/scanner-vscode.ts
  - Libraries that check `vscode.version` themselves do fail. https://github.com/redhat-developer/vscode-yaml/issues/509
- **No in-app extension store and no Theia AI packages** in the dependency list (my reading of package.json).
- **Arduino board API:** the IDE has a built-in provider that tells extensions the sketch path, board and port. https://github.com/dankeboy36/vscode-arduino-api
- **Terminal:** `@theia/terminal` ships, and Arduino's override only removes the split button. Whether a menu entry is visible to users is unverified. https://raw.githubusercontent.com/arduino/arduino-ide/main/arduino-ide-extension/src/browser/theia/terminal/terminal-frontend-contribution.ts
- **Serial port:** only one app can hold it. The IDE closes the Serial Monitor for an upload, but this fails across several windows. https://forum.arduino.cc/t/bug-serial-monitor-blocks-upload/894777
- **AI:**
  - The IDE itself has none.
  - Arduino's Claude-based AI Assistant is in the Cloud Editor only. https://www.cnx-software.com/2025/04/28/arduino-cloud-editor-gets-claude-powered-ai-assistant-trained-on-arduino-docs-and-libraries/
  - App Lab 0.10 (August 2026) added an "Agentic Mode" built on MCP through its App CLI. Claude is the first provider, you bring your own key, and it targets the UNO Q board. No ACP. https://blog.arduino.cc/2026/08/12/arduino-app-lab-0-10-meet-agentic-mode/

## 2. Thonny

- **Current version:** 5.0.0, released 2026-04-25. https://api.github.com/repos/thonny/thonny/releases
- **Plugins:**
  - A plugin is a module in the `thonnycontrib` namespace (or `thonnycontrib.backend` for the backend) that exposes `load_plugin()`.
  - Users install it with pip or Tools > Manage plug-ins.
  - The API is undocumented ("read the code"). https://github.com/thonny/thonny/wiki/Plugins
- **Panels are Tk only.** `add_view(cls: Type[tk.Widget], …)` takes a Tk widget class. https://raw.githubusercontent.com/thonny/thonny/master/thonny/workbench.py
  - The closest thing to a web view is tkinterweb, an HTML renderer, which thonny-codemate uses. It isn't a full browser, so our React panel won't run inside Thonny (my inference). https://github.com/tokoroten/thonny-codemate
- **Device access:**
  - `get_runner()` gives access to the backend, including restart and a disconnect check (same workbench.py source).
  - Plugins call `get_runner().send_command_and_wait(InlineCommand("read_file", …))`. https://github.com/thonny/thonny/issues/3938
  - Thonny owns the port while connected. Other programs must disconnect, and "Stop/Restart backend" reconnects. https://randomnerdtutorials.com/getting-started-thonny-micropython-python-ide-esp32-esp8266/
- **Existing AI plugins:**
  - **thonny-ai (fatihcvs).** An MCP server talks over loopback HTTP (127.0.0.1:47821) to a Thonny plugin and goes through Thonny's backend. When Thonny is closed it uses raw serial. https://github.com/fatihcvs/thonny-ai
  - **thonny-ai (AstroQuestStudio).** https://github.com/AstroQuestStudio/thonny-ai
  - **thonny-ai-helper 0.1.3.** OpenAI-compatible chat in the sidebar. https://pypi.org/project/thonny-ai-helper/
  - **thonny-codemate.** Local models via llama.cpp plus API providers. https://github.com/tokoroten/thonny-codemate

## 3. Eclipse-based vendor IDEs

- **Espressif-IDE:**
  - v4.4.0 (2026-08-11); v4.2.0 moved to Eclipse 2026-03 (4.39). https://github.com/espressif/idf-eclipse-plugin/releases/tag/v4.2.0
  - No AI in the 4.1–4.4 release notes; 4.4.0 adds anonymous telemetry. https://github.com/espressif/idf-eclipse-plugin/releases/tag/v4.4.0
  - Third-party plugins install: Espressif itself installs Copilot4Eclipse from the Marketplace. https://developer.espressif.com/blog/2025/02/github-copilot-in-espressif-ide/
  - ESP-IDF 6.0+ has a stdio MCP server, `idf.py mcp-server`, with set_target, build, flash and clean (no monitor). https://developer.espressif.com/blog/2026/04/esp-idf-tools-mcp-server/
- **STM32CubeIDE:**
  - 2.2.0 (2026-06-30) runs on Eclipse 2025-12, CDT 12.3.0 and JRE 21. https://community.st.com/stm32-mpus-software-development-tools-138/stm32cubeide-2-2-0-released-166535
  - 2.0.0 ran on Eclipse 4.33. https://community.st.com/t5/developer-news/what-s-new-in-stm32cubeide-2-0-0/ba-p/856658
  - Marketplace and Install New Software both work. https://community.st.com/t5/stm32cubeide-mcus/stm32cubeide-1-14-1-marketplace-amp-install-new-software-broken/td-p/642515
  - Plugins with dependencies may need an Eclipse release update site added first. https://github.com/Genuitec/Copilot4Eclipse-community/discussions/116
- **STM32CubeIDE for VS Code:** now an extension pack (3.x, official since 2025-10-13) with a bundle manager. https://community.st.com/t5/developer-news/new-stm32cubeide-for-visual-studio-code-from-prerelease-to/ba-p/846896
- **MCUXpresso IDE:**
  - v25.06 (2025-06-30) is still current. https://www.nxp.com/design/design-center/software/development-software/mcuxpresso-software-and-tools-/mcuxpresso-integrated-development-environment-ide:MCUXpresso-IDE
  - Marketplace client is bundled. https://mcuoneclipse.com/2017/03/30/mcuxpresso-ide-adding-the-eclipse-marketplace-client/
  - Its Eclipse base version is unverified.
- **MCUXpresso for VS Code:** has experimental AI: language-model tools plus MCP servers for Copilot agents. This comes from a search snippet; the page returned 403. https://community.nxp.com/t5/Agentic-AI-Development/Getting-Started-MCUXpresso-for-VS-Code-Installation-amp-Setup/ta-p/2415479
- **Web views in Eclipse:** the SWT Browser uses Edge (WebView2) by default only from Eclipse 4.35. Older bases (CubeIDE 2.0/2.1, possibly MCUXpresso) default to Internet Explorer, so request Edge explicitly. https://eclipse.dev/eclipse/news/4.35/platform.html

## 4. JetBrains / CLion

- **ACP:**
  - In IDEs 2025.3 and later; the registry needs 2025.3.2+ with AI plugin 253.30387.147. https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/
  - No JetBrains AI subscription needed. Custom agents go in `~/.jetbrains/acp.json`. Not on WSL. https://www.jetbrains.com/help/ai-assistant/acp.html
  - Registry listing is open to anyone, but the agent must support Agent Auth or Terminal Auth (same blog post).
  - CLion 2026.1 supports ACP agents. https://blog.jetbrains.com/clion/2026/03/2026-1-release/
- **Licensing:** CLion is free for non-commercial use since May 2025. https://blog.jetbrains.com/clion/2025/05/clion-is-now-free-for-non-commercial-use/
- **Serial Port Monitor plugin:** owned by JetBrains, open source. https://blog.jetbrains.com/clion/2024/04/serial-port-monitor-for-embedded-developers/
- **PlatformIO for CLion:** bundled with the IDE. https://www.jetbrains.com/help/clion/platformio.html
- **JCEF:** guard with `JBCefApp.isSupported()`; it's missing when the IDE runs on another JDK. https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html

## 5. Visual Studio

- **VisualGDB 6.1** (2026-01-29): VS 2012–2026, AI edits, Smart Terminal. https://visualgdb.com/history/
- **Visual Micro:** supports VS 2026; build 2026.0708.4 covers VS 2017–2026 (from a search snippet). https://marketplace.visualstudio.com/items?itemName=VisualMicro.ArduinoIDEforVisualStudio
- **MCP:** agent mode and MCP have been generally available since VS 2022 17.14. https://devblogs.microsoft.com/visualstudio/agent-mode-is-now-generally-available-with-mcp-support/
- **No built-in ACP.** VS has Copilot custom agents (`.agent.md`, 18.4+) instead. https://learn.microsoft.com/en-us/visualstudio/ide/copilot-specialized-agents?view=visualstudio
  - ACP arrives only through ReSharper 2026.2 (2026-07-22): Junie only, preview, uses JetBrains AI quota. https://blog.jetbrains.com/dotnet/2026/07/22/resharper-2026-2-release/
- **WebView2** works inside VisualStudio.Extensibility tool windows, but Remote UI allows no code-behind. https://learn.microsoft.com/en-us/answers/questions/2149139/how-to-add-webview2-to-a-visualstudio-extensibilit

## 6. Mu and code.circuitpython.org

- **Mu is retired.** The sunset was announced December 2024 and the repo was archived 2025-08-31. https://github.com/mu-editor/mu/discussions/2535
- **code.circuitpython.org:** a web app that connects over USB (Web Serial), BLE (Web Bluetooth) or Wi-Fi web workflow (ESP boards on CircuitPython 8.0.0-beta.6+). Chromium browsers only. https://learn.adafruit.com/getting-started-with-web-workflow-using-the-code-editor/overview
  - CircuitPython 10.3.1 came out 2026-09-14. https://blog.adafruit.com/2026/09/14/circuitpython-10-3-1-released

## 7. Who speaks ACP or MCP natively

- **ACP built in:** JetBrains and Zed. Qt Creator has an ACP Client plugin. Visual Studio only through extensions (Poolside Assistant, ReSharper). https://agentclientprotocol.com/get-started/clients
- **Eclipse ACP, third-party only:**
  - Eclipse ACP Connector: beta, Eclipse 4.39–4.42, 3 installs. https://marketplace.eclipse.org/content/eclipse-acp-connector
  - eclipse-agents: a prototype. https://github.com/eclipse-agents/eclipse-agents
- **MCP clients:** Visual Studio, GitHub Copilot for Eclipse (https://github.blog/changelog/2025-08-13-model-context-protocol-mcp-support-for-jetbrains-eclipse-and-xcode-is-now-generally-available/), and Arduino App Lab internally.
- **No ACP or MCP at all:** Arduino IDE 2, Thonny, Mu, and the stock vendor Eclipse IDEs.

| Editor                  | Best route                                           | Caveats                                                                         |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Arduino IDE 2.3.x       | VSIX side-load (separate Theia build)                | API 1.96, Node 20.14, Chromium 124; no store; serial port exclusive             |
| Arduino App Lab         | Not reachable                                        | MCP-only Agentic Mode, closed provider list                                     |
| Thonny 5                | Small plugin + companion UI                          | Tk panels only; route device I/O through Thonny's backend                       |
| Mu                      | Not reachable                                        | Archived                                                                        |
| code.circuitpython.org  | Companion UI only                                    | Web app; port contention                                                        |
| Espressif-IDE 4.x       | Native Eclipse plugin (or third-party ACP connector) | Edge web view; self-contained update site                                       |
| STM32CubeIDE 2.2        | Native Eclipse plugin; VSIX for the VS Code variant  | Eclipse 4.38 is outside the ACP connector's range; dependency resolution issues |
| MCUXpresso IDE 25.06    | Native Eclipse plugin; VSIX for VS Code variant      | Old base: force Edge; unverified Eclipse version                                |
| CLion / JetBrains       | ACP (registry + acp.json); JCEF plugin optional      | Registry needs Agent/Terminal Auth; no WSL                                      |
| Visual Studio 2022/2026 | Native extension (WebView2)                          | No native ACP; MCP-only for Copilot                                             |
| Qt Creator 20           | ACP                                                  | Released June 2026; a plugin, not core                                          |

For Arduino IDE, the practical step is a second VSIX build that targets API 1.96 and Node 20.
