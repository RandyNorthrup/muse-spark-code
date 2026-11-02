# `muse serve` refuses `-c mcpServers.<name>.enabled=false` for a configured server

Status: **ready**. File a new bug. No duplicate found.

Target: <https://github.com/meta-models/muse-code-sdk/issues/new?template=bug_report.yml>

Title: `muse serve` refuses `-c mcpServers.<name>.enabled=false` when that server is already configured

The README Support section limits this tracker to the SDK, the protocol
declarations, and the docs, and the host binary is not in the repository.
The bug form still has "Something else / not sure", blank issues are enabled,
and CLI reports are already on the tracker. File there. `dev.meta.ai` did not
name another public tracker.

## Version and OS

- Muse Code 1.4.14 (1.4.14-R7309.1), measured 2026-11-02.
- macOS 15.7.4 (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.

## Steps

Throwaway `HOME` and `XDG_CONFIG_HOME`. Write
`$XDG_CONFIG_HOME/muse/settings.json`:

```json
{
  "schema_version": 1,
  "mcpServers": {
    "docs": {
      "command": "/bin/true"
    }
  }
}
```

A settings file without `schema_version` fails earlier (`missing field
schema_version`, exit 3) and never reaches this check.

```sh
muse serve --provider echo --no-session-log --disable-shell \
  -c mcpServers.docs.enabled=false
```

`--provider echo` keeps the process off a model provider. Close stdin. Also
try the variants below.

## Expected

One per-run switch starts the host with no user MCP servers, without editing
`settings.json`. Setting `mcpServers.<name>.enabled` to `false` for this
process only would also do it when the caller knows the name.

## Actual

Exit 3. stderr:

```text
muse serve: -c mcpServers.docs.enabled: refusing run: the server name is reserved
```

The same exit and sentence happen for all of these:

- `-c mcpServers.docs.enabled=true` against the same configured name
- a settings file that already has `"enabled": false` on `docs`, plus
  `-c mcpServers.docs.enabled=false`
- a settings file that uses the legacy key `mcp_servers` instead of
  `mcpServers`, plus `-c mcpServers.docs.enabled=false`

`-c mcpServers={}` is a different refusal, exit 2:

```text
muse serve: -c mcpServers: refusing run: address one server (`mcpServers.<name>`) or field, never the whole map (see `--help` for the -c/--config shape)
```

With no settings file at all, `-c mcpServers.docs.enabled=false` is accepted
(exit 0, stderr `muse serve: exit reason recorded: stdin_closed`). The refusal
is for a name that is already configured.

`-c bogus_key=1` exits 2 with `unknown key: no such setting`.

`muse serve --help` describes `-c, --config <KEY=VALUE>` as "Set one setting
for this host (repeatable; values are JSON)." It has no flag that turns off
every user MCP server. The configured server's command did not need to run
for this result: the reserved-name cases exit before stdin closes, and a
serve that exits because stdin closed immediately also left a marker file
untouched. This report does not claim the command would have run during a
turn.

## Ask

Add one per-run switch that starts `muse serve` with no user MCP servers,
without editing `settings.json` and without naming every server. Accepting
`-c mcpServers.<name>.enabled=false` for a configured name would cover the
single-server case. Rejecting `-c mcpServers={}` can stay, as long as some
other switch exists.

## Duplicate search

2026-11-02, public issue search on `meta-models/muse-code-sdk`, open and
closed:

`is:issue "server name is reserved" OR "no user MCP" OR "disable all mcp"`

Result count: 0.

Nearby issues are a different request (adding servers, or enabling and
disabling MCP over the session protocol). They do not describe this
`-c` refusal. No comment is recommended on them.

## Template fields

- Where is the problem? Something else / not sure
- What happened, and what did you expect instead? `muse serve` on 1.4.14
  exits 3 with `refusing run: the server name is reserved` when
  `-c mcpServers.<name>.enabled=false` names a server already in
  `settings.json`. `-c mcpServers={}` exits 2 and refuses the whole map.
  Help has no switch that starts the host with no user MCP servers. Expected:
  a per-run way to do that without editing the settings file.
- Version and environment: Muse Code 1.4.14 (1.4.14-R7309.1). macOS 15.7.4
  (24G517), Darwin 24.6.0 x86_64. Native binary, not a Node SDK build.
  `muse serve --help` on this binary is the reference for the missing flag.
