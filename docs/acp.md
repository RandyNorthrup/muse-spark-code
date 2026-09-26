# Muse Spark in other editors (ACP)

`muse-spark-code-acp` runs Muse Spark as an agent in any editor that speaks
the [Agent Client Protocol](https://agentclientprotocol.com): Zed, the
JetBrains IDEs through AI Assistant, Xcode 27, Qt Creator, Neovim, Emacs,
Sublime Text, Devin Desktop and others. The editor shows the chat, the tool
calls, the plan and the permission prompts; the agent runs Muse Code (or
the Meta Model API) the way the VS Code panel does. It is unofficial and not
endorsed by Meta.

The configuration below names the command and its arguments. Where each
editor keeps its agent settings is in that editor's documentation, linked
from [the compatibility plan](ide-compatibility.md#32-ides-and-editors-reached-through-a-shared-acp-agent);
[hosts.md](ide-compatibility/hosts.md) records which editors have been
tested, at which version, and what was found.

## Install

Node.js 22 or later is required.

- From a GitHub Release, by the package's URL:

  ```sh
  npm install -g https://github.com/RandyNorthrup/muse-spark-code/releases/download/v<version>/muse-spark-code-acp-<version>.tgz
  ```

  or download `muse-spark-code-acp-<version>.tgz` and run
  `npm install -g ./muse-spark-code-acp-<version>.tgz`.

- From npm: not published there yet.

`muse-spark-code-acp --version` confirms the install.

## Choose who pays

The agent runs on one backend, chosen when the editor starts it; it never
switches on its own.

| Backend                             | Arguments            | Who pays                     | Needs                                                    |
| ----------------------------------- | -------------------- | ---------------------------- | -------------------------------------------------------- |
| Muse Code (the default)             | (none)               | Your Muse Code subscription  | The Muse Code CLI, signed in                             |
| Meta Model API (bring your own key) | `--backend modelApi` | Your Model API key, per call | A key stored with `muse-spark-code-acp auth set` (below) |

Configure two agents in the editor if you want both.

## Sign in

Editors that run sign-ins in a terminal offer the right one when the agent
asks for it. Elsewhere, run it yourself once:

- **Muse Code**: `muse-spark-code-acp login` runs Muse Code's own sign-in.
- **Model API key**: `muse-spark-code-acp auth set` asks for the key without
  showing it and keeps it in the operating system's credential store:
  Windows Credential Manager, the macOS Keychain, or on Linux the Secret
  Service (GNOME Keyring, KWallet, KeePassXC). `auth status` says whether
  one is stored; `auth clear` removes it.

The key is never read from an environment variable, a settings file or an
argument, and never passed to Muse Code. On Linux without a running,
unlocked Secret Service the Model API backend is unavailable; there is no
plaintext fallback.

## Configure the editor

Every editor needs the same two things: the command,
`muse-spark-code-acp`, and the arguments. For example, Zed's custom agents
take them in its settings, in the format Zed documented when this was
written (check its current documentation):

```json
{
  "agent_servers": {
    "Muse Spark": {
      "command": "muse-spark-code-acp",
      "args": []
    }
  }
}
```

Other editors take the same command and arguments in their own agent or
ACP settings (JetBrains AI Assistant, Xcode's Intelligence settings, Qt
Creator's ACP Client, CodeCompanion for Neovim, agent-shell for Emacs,
sublime-acp, Devin Desktop's custom agents).

## Options

| Argument                               | Effect                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--backend museCode\|modelApi`         | Which backend, and so who pays (default `museCode`)                                                                     |
| `--trust-workspace`                    | Load the folder's rules, skills and memory, as Muse Code's own flag does. Without it the folder is treated as untrusted |
| `--muse-binary <path>`                 | The Muse Code CLI to run; by default the agent looks where the VS Code extension looks                                  |
| `--shell-sandbox auto\|muse\|off`      | Muse Code's shell sandbox, as the extension's `museSpark.shellSandbox` setting                                          |
| `--allow-dangerously-skip-permissions` | Offer the Bypass permissions mode                                                                                       |
| `--allow-contributor-models`           | List contributor-tier models, whose content Meta may train on; they are hidden otherwise                                |
| `--verbose`                            | Log every detail to stderr (the editor's agent log)                                                                     |

## What the editor sees

- **Modes**: Manual, Edit automatically, Plan, Auto (and Bypass permissions
  with its flag), as in the panel.
- **Settings**: the model and the reasoning effort.
- **Commands**: the session's skills, run as `/name arguments`.
- **Permission prompts**: the backend's own choices (allow once, allow for
  the session, reject). A prompt the editor cancels, or answers with a
  choice it was not offered, is rejected; nothing runs by default.
- **Questions** the agent asks: a form where the editor has forms,
  otherwise the question as text, answered in your next message.
- **Sessions**: listed, loaded with their history, resumed and closed.
- **Prompts**: text, files as @mentions, attached excerpts, and PNG, JPEG,
  GIF and WebP images up to 10 MB.

## Not yet

- Paid features (Model API web search, image generation and Muse Voice)
  are off in the agent until it can name the price and ask first.
- The Model API backend reads and writes files itself, so it does not see
  unsaved changes in the editor; save before asking it to edit a file you
  have open.
- MCP servers the editor offers are not passed on yet.
