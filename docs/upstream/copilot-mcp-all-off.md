# Copilot CLI has no per-run switch that disables every user MCP server

Status: **ready**. File a feature request. No duplicate found.

Target: <https://github.com/github/copilot-cli/issues/new?template=feature_request.yml>

The CLI needs a GitHub Copilot subscription for a signed-in session. This
check did not sign in.

## Version and OS

- GitHub Copilot CLI 1.0.105 (`@github/copilot`, npm `latest` on 2026-11-02).
  The `prerelease` dist-tag was `1.0.106-2` and was not installed.
- macOS 15.7.4 (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- Terminal: an SSH session. `launchctl managername` prints `Background`.

## Steps

Throwaway `HOME` so the real `~/.copilot` is untouched. Write
`$HOME/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "docs": {
      "command": "/bin/true"
    }
  }
}
```

```sh
copilot mcp list
copilot --help
copilot --acp --help
```

`--no-auto-update` avoids an update check. Do not sign in.

## Expected

One flag starts the process with no user MCP servers (the servers in the user
`mcp-config.json`), without naming each server and without editing the file.
The same flag works on `copilot --acp`.

## Actual

`copilot mcp list` prints:

```text
User servers:
  docs (local)
```

`copilot --help` and `copilot --acp --help` (same option list, `--acp --help`
exits 0) expose:

- `--disable-mcp-server <server-name>` — one named server, repeatable
- `--disable-builtin-mcps` — built-ins only, help text says currently
  `github-mcp-server` and `githubiq`
- `--enable-mcp-server <server-name>` — re-enable one server that settings
  already disabled, for this run
- `--additional-mcp-config <json>` — add servers for this session

There is no `--no-mcp`, `--disable-all-mcp`, or other flag that turns off
every user server. `copilot mcp` has `enable` and `disable` subcommands; those
persist a per-server setting. They are not a per-run all-off switch.

### `copilot --acp` and the per-server flag

`--acp --help` lists `--disable-mcp-server`, so the flag is on the ACP
process, not only on the interactive CLI.

Whether a user server process actually starts under `--acp` was not observed,
because the unsigned-in CLI never got past login:

- `copilot --acp --disable-builtin-mcps --no-auto-update`, with the user
  server above pointed at a command that appends a word to a file in the
  throwaway home: `initialize` returned `protocolVersion` 1 and `agentInfo`
  name `Copilot` version `1.0.105`, with `mcpCapabilities` for http and sse,
  and an auth method id `copilot-login`. The next call, `session/new`,
  returned `{"code":-32000,"message":"Authentication required"}`. The marker
  file stayed empty.
- The same command plus `--disable-mcp-server docs` wrote no stdout and no
  stderr for 7 seconds and was then killed. The marker file stayed empty.

So this pass does not say the per-server flag is honoured at runtime, and it
does not say it is ignored. Help accepts it for `--acp`. A signed-in run
would be required to watch the server process, and this check did not sign in.

## Ask

Add one per-run switch that starts the CLI with no user MCP servers, and
document that it applies to `copilot --acp` the same way as to the
interactive CLI. Keep `--disable-mcp-server` for a single named server and
`--disable-builtin-mcps` for the two built-ins.

## Duplicate search

2026-11-02, public issues on `github/copilot-cli`. No open or closed issue
asks for a per-run all-off of user MCP servers.

Nearby, and not this request:

- [#3380](https://github.com/github/copilot-cli/issues/3380) (open) asks for
  `--disable-repo-mcps` so repo files (`.mcp.json`, `.github/mcp-config.json`)
  are skipped. User servers in `~/.copilot/mcp-config.json` would still load.
- [#768](https://github.com/github/copilot-cli/issues/768) asked for a
  persisted per-server disabled default. Comments say `/mcp disable` persists
  as of v1.0.19. That is a saved setting for one name.
- [#30](https://github.com/github/copilot-cli/issues/30) (closed) asked to
  disable the GitHub built-in. The thread points at `--disable-mcp-server`
  and, later, `/mcp disable`.
- [#3582](https://github.com/github/copilot-cli/issues/3582) is about a
  `"disabled": true` property inside `mcp-config.json` being ignored. The
  supported store is a separate disabled-name list. That is not a per-run
  all-off flag.

## Template fields

Form: `.github/ISSUE_TEMPLATE/feature_request.yml` (type Feature, label
`triage`).

- Describe the feature or problem you'd like to solve: Starting Copilot CLI,
  including `copilot --acp`, with every user MCP server off for that process
  only, without listing each server name and without editing
  `mcp-config.json`.
- Proposed solution: One repeatable-free flag, for example `--disable-user-mcps`
  or `--no-mcp`, that skips every server from the user MCP config for that
  invocation. `--disable-builtin-mcps` already covers the built-ins and is the
  pattern to copy. State in `--help` that `--acp` honours it.
- Example prompts or workflows:
  1. `copilot --disable-user-mcps` in a directory whose user config has many
     local servers, when this run should not start them.
  2. `copilot --acp --disable-user-mcps` from a client that speaks ACP and
     wants the same empty user roster.
  3. `copilot --disable-mcp-server docs` remains the way to drop one named
     server and keep the others.
  4. `copilot mcp disable docs` remains the way to persist that one server as
     off across later runs.
- Additional context: Measured on GitHub Copilot CLI 1.0.105, macOS 15.7.4
  (24G517), Darwin 24.6.0 x86_64, throwaway `HOME`, not signed in.
  `copilot mcp list` showed `docs (local)`. Help has only the per-server and
  built-in flags listed above. An unsigned-in `copilot --acp` reached
  `initialize` and then `session/new` failed with `Authentication required`
  before the user server command ran. Adding `--disable-mcp-server docs`
  produced no ACP frame within 7 seconds. Please confirm runtime behaviour
  of both the new switch and `--disable-mcp-server` under `--acp` in a
  signed-in session. npm `prerelease` `1.0.106-2` was not installed.
