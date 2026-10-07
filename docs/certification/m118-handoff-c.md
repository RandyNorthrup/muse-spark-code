# M118 lane C — chat sharing

Entry points: `src/shared/share.ts` (`shareRequestSchema`, `ShareRequest`,
`shareJsonSchema`, `ShareJson`, `confirmedShareSchema`, `admitShareRelease`,
`SharePrivacyPort`, `scrubShareText`). Constants: `SHARE_SCHEMA_VERSION`,
`SHARE_DESTINATIONS`, `SHARE_LOCAL_DESTINATIONS`, `PROMPT_COMMAND_IDS.shareChat`.
Schema: `docs/schemas/share-v1.schema.json`, generated/checked by the existing
`scripts/exec-schema.mjs` / `npm run schema:exec -- --check` command. Runtime
refinements are listed as x-runtime-invariants, as with the existing exec
schemas: consumers must parse with zod, not trust the JSON Schema alone.

Build on `src/host/conversation/exportConversation.ts` and the existing
`museSpark.exportConversation` command/palette. Keep M84 resumable session
JSON distinct from versioned share JSON. Register only C's shareChat row from
`m118-manifest-patch.json`; P owns the other five. No hosted destination in
phase one: requests can describe gist/nodeLink/team/email for future UI, but
`confirmedShareSchema` rejects every release to those destinations.

Chat requests carry sessionId and optional range `{ from, to }` with inclusive
message ids in original order; absent means all. Validate ids and ordering
against that session's snapshot before preview. Refuse missing/reversed
endpoints; never silently expand the range. Prompt message sources use the
same session/message identities. Modes are full/conversation; options default
to code blocks and attachment names on, diffs off, content ids empty. Full
mode still honours every privacy option and excludes live handles/replay.

The allow-lists live next to existing transcript representations:

- `src/shared/agentEvents.ts:isConversationShareItem` admits userMessage and
  agentMessage only; its ItemSnapshot schema intentionally accepts future kinds.
- `src/webview/state/transcriptEntries.ts:isConversationShareEntry` admits user
  and assistant only; the fixture's Record forces coverage of every union kind.

Map user/assistant to userMessage/agentMessage when building share JSON. Do not
copy message objects wholesale: the schema explicitly rejects activity fields
on allowed kinds in conversation mode. Tools/outputs, commands, approvals and
decisions, diffs, checkpoints, notices/errors, reasoning, workflows, subagents,
system/internal and unknown kinds stay excluded. Code blocks are Markdown
within a message; remove fenced/indented blocks when codeBlocks is false using
the existing Markdown parser. Never interpret that toggle as allowing a tool
row or activity embedded in a message. Share JSON uses explicit portable text
fields (`text`, `tool`, `args`, `output`, `command`, `decision`, `diff`,
`reasoning`) with attachment id/name/optional selected content. No opaque
outputRef/patchRef/modelVisibleContent/children, arbitrary objects or binaries.

Implement SharePrivacyPort with current in-memory registered-secret redaction
and path normalisation. `scrubShareText` composes that with existing
`src/shared/redact.ts:redactSecrets`, before and after normalisation. Apply it
to every string, including title, ids, attachment names and selected contents;
maintain a consistent mapping when ids change. Absolute workspace paths become
workspace-relative forward-slash paths, home/user prefixes become `[home]`/
`[user]`, other absolute paths become `[path]`. Cover POSIX/drive/UNC/file URI,
escaped separators and roots/user names with spaces. Review M84's root folding
in `src/core/export/sessionTransfer.ts`, but retain relative workspace paths
instead of replacing those paths wholesale. No normaliser or registered-value
store is implemented by lane 0; the privacy test proves composition only.

Attachment contents are excluded until their ids are explicitly chosen, even
in full mode. Names can be suppressed independently. Diffs require diffs true
and remain excluded in conversation mode. HTML must escape text and keep a
static local document without active scripts or remote asset loads.

Preview exact scrubbed bytes in memory, naming destination/range/toggles.
The host owns the opaque previewId and the exact byte/request association;
any change invalidates it. Only the final Confirm sharing button creates a
`step: confirmed` release. `admitShareRelease` validates that boundary and
rechecks the existing `ConversationDeps.isConfidentialWorkspace` setting;
unknown/unavailable checks refuse. Call it at preview and again immediately
before the local copy/file/browser sink with no asynchronous gap, and verify
previewId against host-owned bytes. A confirmed schema is a contract, not a
trusted capability supplied by the webview. A confidential workspace refuses
all sharing; full mode never disables scrubbing. Opening browser output also
requires confirmation; previews must not create files or open a browser.

Fakes/tests: `test/unit/helpers/sharingFixtures.ts`, `shareContracts.test.ts`.
M118 English keys begin en.ts and exist in all fourteen UI/manifest tables.
Keep runtime contracts lazy. Follow P's validation-runtime note for `_default`.
