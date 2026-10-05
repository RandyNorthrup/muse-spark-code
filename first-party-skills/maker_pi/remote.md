# Remote work on a Pi

Use a 64-bit OS and the supported Node/runtime requirements; do not replace
the user's OS as part of a coding task. With Remote-SSH, the extension engine
and USB/GPIO are on the Pi. With ACP in a Pi terminal editor, the runtime and
its device tools are on the Pi too. A local PC's USB device is not attached
to the remote engine. Cloud editors get simulations and offline builds.

The companion page is loopback-only; forward its port over the user's SSH
connection rather than exposing it on the LAN. The host provides the
approval prompt. If it cannot ask, do offline/observe work only. Headless
does not authorize connect, program or actuate; do not generate an allowlist
on the user's behalf. Credentials go through the runtime's auth stdin path
and OS credential store, not environment variables, files or chat.

For local inference, preserve the user's provider and model. A PC or GPU
host can serve the chosen endpoint over an authenticated SSH tunnel; do not
make a model server listen publicly. Check tool and vision capabilities
before requesting those features. Do not assume a Pi can run a model at a
useful agent-loop speed, or add a paid cloud fallback without user consent.

[Remote SSH](https://code.visualstudio.com/docs/remote/ssh),
[Ollama tool support](https://docs.ollama.com/capabilities/tool-calling).
