# Codex CLI `-c mcp_servers={}` still does not clear configured MCP servers

Status: **duplicate**. Do not open a new issue. Comment on
<https://github.com/openai/codex/issues/16045>.

The behaviour belongs to the Codex CLI (`codex mcp list` and `-c`), not to an
ACP adapter. `@agentclientprotocol/codex-acp` was not installed for this
check. `@zed-industries/codex-acp` is a different, older package and does not
own this flag. The CLI issue template says to add a thumbs-up on an existing
issue and not open another one. A short comment is still worth posting: the
last confirmation on #16045 is 0.158.0, and 0.166.0 still no-ops.

## Version and OS

- `codex-cli 0.166.0` from npm package `@openai/codex` (npm `latest` on
  2026-11-02 was `0.166.0`).
- macOS 15.7.4 (24G517). `uname -mprs` prints `Darwin 24.6.0 x86_64 i386`.
- Terminal: an SSH session. `launchctl managername` prints `Background`. No
  multiplexer.

## Steps

Use a throwaway `CODEX_HOME` and a throwaway `HOME`. Do not sign in.

`$CODEX_HOME/config.toml`:

```toml
[mcp_servers.docs]
command = "/bin/true"

[mcp_servers.other]
command = "/bin/true"
```

```sh
codex mcp list --json
codex mcp list --json -c 'mcp_servers={}'
codex mcp list --json -c 'mcp_servers.docs.enabled=false'
```

Then `grep` the headings in `config.toml`. Also read `codex mcp --help` and
`codex exec --help` for an all-off flag. This check did not run `codex exec`
and did not run `codex doctor` (doctor can read local auth state).

## Expected

`-c 'mcp_servers={}'` disables every configured MCP server for that
invocation, or the CLI offers one flag that does the same. The per-server
form can stay as the way to turn one server off.

## Actual

Both `codex mcp list --json` and `codex mcp list --json -c 'mcp_servers={}'`
exit 0 and list the same two servers, each with `"enabled": true` and
`"disabled_reason": null`. Each transport is stdio, `command` `/bin/true`,
`auth_status` `unsupported`. `config.toml` still has both headings afterwards.

`codex mcp list --json -c 'mcp_servers.docs.enabled=false'` lists `docs` with
`"enabled": false` and `other` with `"enabled": true`.

`codex mcp --help` has `list`, `get`, `add`, `remove`, `login`, and `logout`,
plus `-c/--config` and `--enable` / `--disable <FEATURE>`. Those feature
flags are not MCP servers. `codex features list` has no feature that turns
the MCP roster off (the MCP-related names are a removed path override, several
flags still under development, and stable flags for OAuth refresh, skills,
and tool-call elicitation).

`codex exec --help` documents:

```text
--ignore-user-config
    Do not load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`
```

`codex mcp list --json --ignore-user-config` exits 2:

```text
error: unexpected argument '--ignore-user-config' found
```

The flag is not on `codex --help` or `codex mcp --help`. This pass did not
run `codex exec`, so it does not claim that `--ignore-user-config` drops MCP
servers. It is also broader than an MCP switch: it skips the whole user
config file. There is still no `--no-mcp` or `--disable-all-mcp`.

## Ask

Make `-c 'mcp_servers={}'` clear the table for that invocation, or add one
flag that disables every MCP server for one run. Per-server
`mcp_servers.<name>.enabled=false` already works on `codex mcp list` in
0.166.0 and can stay.

## Recommended comment

```text
Still reproduced on codex-cli 0.166.0 (npm @openai/codex latest on
2026-11-02), macOS 15.7.4 (24G517), uname -mprs: Darwin 24.6.0 x86_64 i386.
Throwaway CODEX_HOME, not signed in. No model was selected.

config.toml had two stdio servers, command /bin/true:

[mcp_servers.docs]
[mcp_servers.other]

codex mcp list --json
and
codex mcp list --json -c 'mcp_servers={}'
both exit 0 and list docs and other with "enabled": true. The file's
headings are unchanged.

codex mcp list --json -c 'mcp_servers.docs.enabled=false'
lists docs enabled false and other enabled true.

codex mcp --help and codex exec --help still have no --no-mcp flag.
codex exec --help does document --ignore-user-config ("Do not load
$CODEX_HOME/config.toml"). codex mcp list --ignore-user-config exits 2
with "unexpected argument '--ignore-user-config'". I did not run
codex exec, so I have not checked whether that flag drops MCP servers.
It also skips the whole user config, which is wider than an MCP switch.

Please make mcp_servers={} clear the table for one invocation, or add
a single flag that disables every MCP server for one run.
```

## Duplicate search

- [openai/codex#16045](https://github.com/openai/codex/issues/16045) is open.
  Title: `bug: -c 'mcp_servers={}' silently no-ops instead of clearing MCP
servers`. Filed against 0.117.0. Comments confirm 0.149.1, 0.157.1, and
  0.158.0. Same command, same silent success, same per-server workaround.
  One comment on 0.149.1 also saw per-server `enabled=false` fail to change
  an `exec` roster that included plugin servers. This 0.166.0 check only
  ran `mcp list`, where the per-server form works.
- [openai/codex#16686](https://github.com/openai/codex/issues/16686) is about
  an empty `[mcp_servers]` table in a layered role file, not the CLI `-c`
  override. Leave it alone.
- The ACP adapter repositories were not the owner of `-c`. No adapter issue
  needs a comment from this run.

## Template fields

The CLI bug template
(<https://github.com/openai/codex/blob/main/.github/ISSUE_TEMPLATE/3-cli.yml>)
says to react on the existing issue. These are the fields the comment covers.

- What version of Codex CLI is running? `codex-cli 0.166.0`
- What subscription do you have? none / not signed in
- Which model were you using? none (no session, no model)
- What platform is your computer? `Darwin 24.6.0 x86_64 i386`
- What terminal emulator and version are you using? SSH session, launchd
  manager name `Background`. No multiplexer.
- Codex doctor report: not run. `codex doctor` can read local auth and
  config. This check used only `mcp list` against a throwaway `CODEX_HOME`.
- What issue are you seeing? `-c 'mcp_servers={}'` exits 0 and leaves both
  configured servers enabled. Output is the `mcp list --json` arrays
  described above.
- What steps can reproduce the bug? The steps section.
- What is the expected behavior? The empty override clears every MCP server
  for that invocation, or one flag does.
- Additional information: `--ignore-user-config` exists on `codex exec --help`
  only. `codex mcp list` rejects it. Not measured under `codex exec`.
