# Upstream reports

Measured 2026-11-02. These notes are for a person to file or to paste as a
comment. This pass did not open or comment on any issue.

Status values: `ready` (file the report), `duplicate` (comment on the open
issue named in the report), `fixed upstream` (leave it unfiled). The spawn
contract note was already in this folder and was not rechecked.

| Report                                                                       | Status               | Where it goes                                                                                                                                                          |
| ---------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [muse-code-keychain-noninteractive.md](muse-code-keychain-noninteractive.md) | fixed upstream       | Nothing to file. `muse serve` on 1.4.14 answers `initialize` in a headless session and writes no Keychain item.                                                        |
| [muse-code-session-delete.md](muse-code-session-delete.md)                   | duplicate            | Comment on [muse-code-sdk#51](https://github.com/meta-models/muse-code-sdk/issues/51). The stdio one-client shape is the documented contract; leave that half unfiled. |
| [muse-code-mcp-reserved-name.md](muse-code-mcp-reserved-name.md)             | ready                | New bug on [meta-models/muse-code-sdk](https://github.com/meta-models/muse-code-sdk/issues/new?template=bug_report.yml), area "Something else / not sure".             |
| [codex-mcp-servers-override.md](codex-mcp-servers-override.md)               | duplicate            | Comment on [openai/codex#16045](https://github.com/openai/codex/issues/16045). The CLI owns the override. Leave the ACP adapters unfiled.                              |
| [copilot-mcp-all-off.md](copilot-mcp-all-off.md)                             | ready                | New feature request on [github/copilot-cli](https://github.com/github/copilot-cli/issues/new?template=feature_request.yml).                                            |
| [muse-code-spawn-contract.md](muse-code-spawn-contract.md)                   | draft, not rechecked | Already in the tree from an earlier pass. Not one of the five items above.                                                                                             |
