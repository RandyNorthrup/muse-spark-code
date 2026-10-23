# Muse Spark for classic Vim (M66)

An ACP client in pure Vimscript for Vim 8.1 and later (`+job`, `+channel`;
check with `vim --version`). It runs the packed `muse-spark-code-acp` agent
beside Vim and holds the conversation in a chat buffer. Neovim keeps its own
route (CodeCompanion); this plugin never loads there.

## Install

Copy this folder beside your Vim packages and restart Vim:

```sh
mkdir -p ~/.vim/pack/musespark/start
cp -r <agent-package>/editors/vim ~/.vim/pack/musespark/start/muse-spark
```

The agent package carries this folder as `editors/vim`. Then `:MuseSpark`
opens the chat and starts the agent.

## Use

Write each prompt below the last `You:` line and run `:MuseSparkSend`.
Answer permission prompts with `:MuseSparkAllow {n}` or `:MuseSparkDeny`.
`:MuseSparkModel` and `:MuseSparkMode` switch the running session;
`:MuseSparkNew`, `:MuseSparkCancel` and `:MuseSparkClose` manage it.
`:help muse_spark` lists everything.

Options (set before `:MuseSpark`):

- `g:muse_spark_command`: the agent (`muse-spark-code-acp`, or a full argv
  list such as `['node', '/path/to/dist/acp.js']`).
- `g:muse_spark_args`: extra agent arguments, e.g. `['--trust-workspace']`
  (the serve options from docs/acp.md; pick the model with `:MuseSparkModel`,
  and list contributor models with `'--allow-contributor-models'`).
- `g:muse_spark_mcp_servers`: MCP servers the session offers the agent,
  e.g. Xcode 26.3's bridge (docs/acp.md, "Xcode 26.3").

## Test

`sh test/hosts/vim.sh <installed-agent-dir>` drives real Vim against the
installed package: the wire helpers over captured agent frames, the
initialize handshake, and — where the Muse Code CLI is installed — a full
session with a locally answered command (no model call). Without the CLI it
proves the refusal surfaces instead of hanging.
