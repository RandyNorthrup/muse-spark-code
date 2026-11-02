# Sublime package — Muse Spark Code (Unofficial)

Copy this directory into Sublime's `Packages/MuseSpark` folder. The package
requests the Python 3.14 API environment (Sublime build 4205 or later).
Install `muse-spark-code-acp` separately and open a workspace folder first.
The shim downloads nothing and reads no credential store.

The command palette exposes `muse_panel` and `muse_stop` under
`Muse Spark Code (Unofficial)`. `muse_panel` starts `panel --companion` in
the window's first workspace folder. The runtime opens the shared browser
panel. Set `command` in `MuseSpark.sublime-settings` to an argv list if the
runtime is not on PATH. Paths with spaces are passed as one argument.

For the same session as the community ACP package, use its runtime-issued
fresh `/panel` URL:

```python
window.run_command("muse_panel", {"url": fresh_url})
```

The shim accepts only an IP-literal loopback URL with a launch fragment.
It never exchanges that code, sends HTTP requests, stores URLs or uses
cookies. The companion page holds its bearer token in memory and sends
Authorization on every request, including its fetch-streamed event channel.
No Model API key enters the editor configuration or page.

`muse_stop`, window close and package unload terminate only the companion
processes this package owns. Cancel an ACP turn or a turn opened through a
supplied URL in its ACP client or shared panel. There is no process-wide
kill. A duplicate start in one window is refused; distinct windows are
independent. Browser and runtime children receive sanitized environments
and raw stdout/stderr are discarded. Launch failures show `EPANEL_LAUNCH`;
Stop failures show `EPANEL_STOP`, and unexpected exits show `EPANEL_EXIT`.
Browser exit failures also show only `EPANEL_LAUNCH`. Package unload attempts
every window even when one termination fails and retains failed handles for
retry.

The default opener is `open` on macOS and `xdg-open` on Linux. Set `opener`
to a browser argv list on Windows. Every spawn uses `shell=False`.

The in-editor suite installs this package into a scratch Sublime
profile and drives its commands against the real agent under Xvfb
(run `npm run build` first):

```sh
python3 -m unittest discover -s hosts/sublime/test -v
```

It skips where Sublime Text or Xvfb is absent. On an editor older
than build 4205 the installed copy's Python-version marker is lowered
to the newest plugin host that build ships (the plugin code is
identical); the 3.14 host is qualified on build 4205+. Refusal paths
whose error dialog only a person can dismiss headlessly are listed
in `docs/real-life/unproven.md`. F1–F56 integration remains tracked
in `docs/certification/m104-h.md`.

## LSP and independent workspace Stop

With Sublime's LSP package installed, this package registers
`LSP-muse-spark.sublime-settings`. Its command is the installed agent's `lsp`
route. Add `--tab` and `--trust-workspace` to that command only when opting
into invoked paid Tab; runtime consent and the native-store key are required.
The adapter empties inherited credential variables before LSP launch. Native
GUI qualification is pending.

Companion launch uses `supervise`. `muse_stop` starts a separate bounded,
credential-free workspace Stop process, including on window close. Panel and
review services still require the absent controller composition.
