# Upstream reports

Measured 2026-11-02. These notes are for a person to file or to paste as a
comment. This pass did not open or comment on any issue, and it sent no
model request.

Status values:

- `ready` — file the report.
- `duplicate (comment)` — an issue already exists. Paste the comment in the
  report, unless the report says the comment is already posted or that no
  comment is recommended.
- `fixed upstream` — leave it unfiled.
- `needs live check` — do not file or comment until the request in the
  report has been run. A doc page or a schema is not a capture.

| Report                                                                       | Status              | Where it goes                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [muse-code-keychain-noninteractive.md](muse-code-keychain-noninteractive.md) | fixed upstream      | Nothing to file. `muse serve` on 1.4.14 answers `initialize` in a headless session and writes no Keychain item.                                                                                                                                                                                                              |
| [muse-code-session-delete.md](muse-code-session-delete.md)                   | duplicate (comment) | Comment already on [muse-code-sdk#51](https://github.com/meta-models/muse-code-sdk/issues/51) (2026-11-02). Do not post it again. `session/delete` is still method-not-found. The stdio one-client shape stays unfiled.                                                                                                      |
| [muse-code-mcp-reserved-name.md](muse-code-mcp-reserved-name.md)             | duplicate (comment) | Already filed as [muse-code-sdk#134](https://github.com/meta-models/muse-code-sdk/issues/134). No second issue. No comment.                                                                                                                                                                                                  |
| [codex-mcp-servers-override.md](codex-mcp-servers-override.md)               | duplicate (comment) | Comment on [openai/codex#16045](https://github.com/openai/codex/issues/16045). The CLI owns the override. Leave the ACP adapters unfiled.                                                                                                                                                                                    |
| [copilot-mcp-all-off.md](copilot-mcp-all-off.md)                             | ready               | New feature request on [github/copilot-cli](https://github.com/github/copilot-cli/issues/new?template=feature_request.yml).                                                                                                                                                                                                  |
| [muse-code-spawn-contract.md](muse-code-spawn-contract.md)                   | duplicate (comment) | Already [muse-code-sdk#90](https://github.com/meta-models/muse-code-sdk/issues/90). The draft and the issue are the same text. No new comment. The 1.4.14 schema has no pre-exec method. Not re-measured live.                                                                                                               |
| [model-api-input-tokens.md](model-api-input-tokens.md)                       | needs live check    | Already [meta-model-cookbook#58](https://github.com/meta-models/meta-model-cookbook/issues/58). The count reference now says media is included. The 2026-10-05 capture says it is not. Comment on #58 after the check. No second issue.                                                                                      |
| [model-api-input-audio.md](model-api-input-audio.md)                         | needs live check    | Already [meta-model-cookbook#59](https://github.com/meta-models/meta-model-cookbook/issues/59). The video page now shows `input_audio` on `muse-spark-1.2`. The capture says `muse-spark-1.2-contributor` dropped it. Comment on #59 after the check.                                                                        |
| [model-api-mov-compaction.md](model-api-mov-compaction.md)                   | needs live check    | Already [meta-model-cookbook#60](https://github.com/meta-models/meta-model-cookbook/issues/60). The formats table still lists mp4 only. `compact_threshold` was not found in the public docs. Comment on #60 after the check.                                                                                                |
| [model-api-video-soundtrack.md](model-api-video-soundtrack.md)               | needs live check    | Not filed. Not #59 and not cookbook #29. File a cookbook bug only if `muse-spark-1.3-contributor` still misses the spoken line. The video page currently says both that one upload returns a transcript and that 1.3 audio is degraded.                                                                                      |
| [muse-code-feedback-receipt.md](muse-code-feedback-receipt.md)               | fixed upstream      | Nothing to file. The 1.4.14 `feedback/submit` schema documents the receipt. The local refusal of an attached session record stays until a capture.                                                                                                                                                                           |
| [muse-code-subagent-admission.md](muse-code-subagent-admission.md)           | needs live check    | No matching issue (#49, #39, #43, #80 and #90 are different). The 1.4.14 schema has control methods and no admission method. File only if a live serve capture still shows no `approval/requested` before the child starts.                                                                                                  |
| [followups.md](followups.md)                                                 |                     | One comment to post on [#80](https://github.com/meta-models/muse-code-sdk/issues/80) (fixed in 1.4.6) and a status note on [#48](https://github.com/meta-models/muse-code-sdk/issues/48) (video is in the schema; audio and documents are not). Every other open issue from #26 through #96, plus #134, gets no new comment. |

## Dropped

- `session/listChanged` (`docs/research/m106-s1-upstream.md`, request 3).
  The method is in the 1.4.14 schema. The missing piece is a capture. Do
  not file.
- `docs/research/m106-s1-upstream.md` request 1 is
  [muse-code-session-delete.md](muse-code-session-delete.md). Request 2 is
  [muse-code-feedback-receipt.md](muse-code-feedback-receipt.md).
- `docs/research/m106-sdk-media-parts.md` is the #48 note in
  [followups.md](followups.md). Video is in the 1.4.14 schema. Audio and
  documents are not. Do not open a new issue.
- `docs/research/muse-1.4.3-upstream.md` drafted retests of #26, #30 and
  #31. Those comments are already on the issues. SDK #29 is closed. Do not
  re-open it.
- Cookbook #56, #57 and #61 are open from the same author and are not the
  drafts this pass was asked to finish. They were not re-reviewed.
- ACP SDK, MCP SDK, Electron, VS Code APIs, Hyprland, Zed, JetBrains,
  Neovim: nothing in `docs/research/` or `docs/certification/` names an
  unfiled defect in those projects that current users hit. The Codex and
  Copilot reports above are the ones that do.

`docs/research/makers-2026-10-05.md` is a design draft. It is not an
upstream bug report.
