# M118 lane P — prompt library, save/use/share/import

Base: `81a5ccfa` (0.14.1). The rig brief stages D98/M118, superseding D67's
unimplemented globalState/workspaceState prompt storage. These are contracts,
not registered commands or a production library. No new provider shapes.

- `src/shared/prompts.ts`: `savedPromptSchema`, `SavedPrompt`,
  `serialisePromptFile`, `parsePromptFile`, `importPromptFile`,
  `promptVariableNames`, `PromptStoragePort`, `mergePromptScopes`,
  `promptLoadSchema`, `promptMenuEntries`, `promptExportName`.
- `src/shared/constants.ts`: `PROMPT_COMMAND_IDS`, `PROMPT_SCHEMA_VERSION`,
  `PROMPT_FILE_EXTENSION`, `PROMPT_USER_FOLDER`, `PROMPT_WORKSPACE_FOLDER`.
- `src/shared/share.ts`: `shareRequestSchema` with prompt sources `saved`,
  `message`, `composer`, `editorSelection`; `shareJsonSchema` prompt branch;
  `confirmedShareSchema`, `admitShareRelease`, `scrubShareText` and privacy port.
- `test/unit/helpers/sharingFixtures.ts`: saved-prompt, transcript and share
  fakes; tests are `prompts.test.ts` and `shareContracts.test.ts`.

The file is `---\n` + JSON metadata + `\n---\n` + exact Markdown body.
JSON is a YAML front-matter subset: no general YAML syntax/tags/anchors are
supported and no YAML dependency is needed. Delimiters may use CRLF; body bytes
are preserved as text, including CRLF and missing trailing newline. Metadata
has exactly schemaVersion/id/title/tags/variables/scope/createdAt/updatedAt/
untrusted. Each `{{selection}}`, `{{file}}`, `{{clipboard}}` has a matching
same-name/source variable; other identifier placeholders use source `input`.
Declarations exactly match unique body placeholders; unused/duplicate variables
are invalid. `promptVariableNames` orders by first use. Import overwrites
untrusted to true, changes only the chosen scope, lists variables, never
resolves them or runs text. Preserve that flag on saves/copies. Prompt-share
JSON is separate from the `.muse-prompt.md` portable file.

Use `src/runtime/dataFolder.ts:agentDataFolder` for every editor, including
VS Code: user files go under its `prompts/<slug>.md`, workspace files under
`.muse/prompts/<slug>.md`. Do not key user storage by workspace or use VS Code
state as the sole store. `PromptStoragePort.list` validates each file and
reports damage explicitly; adapters enforce unique ids per scope and checked
atomic writes. `mergePromptScopes` orders user then workspace, title/id by
stable lexical order; duplicate title/id across scopes stays as two entries.
Repeated same-scope ids keep the first title/id-sorted entry; adapters should
report such conflicting files instead of silently accepting corrupt storage.
Show `promptScopeUser`/`promptScopeWorkspace` labels. Copy to my prompts creates
a user-scope copy with a fresh id on conflict, retaining untrusted status and
the original workspace prompt. User prompts are available in every workspace
and editor without automatic network sync.

Load resolves variables only after the user reviews them, then inserts into
the active composer or creates a chat in the current workspace. The validated
load action is `insert`, `send: false`, chat `active|new`. No auto-send.

Apply P's five command rows from `m118-manifest-patch.json`; C owns shareChat.
Append contributions, do not replace existing arrays. Right-click Save uses
the same command id for own user messages, composer text and editor selection;
composer also offers Use saved prompt. `promptMenuEntries` supplies unique menu
ids, source identities and conditions for shared React and MHP/native hosts.
For VS Code, set `data-vscode-context` on user cards/composer with the stated
`museSpark.*` keys and enough validated source data to identify exact text.
Do not expose own-message Save on assistant/system/tool rows. The editor entry
uses `editorHasSelection` and starts/targets a chat in the selected workspace.
`museSpark.chatAvailable` means a chat surface exists, including an empty
composer that can create its first chat.

`sharingArtifacts.test.ts` also asserts this contract lane registers none of
those commands prematurely. Replace that lane-only assertion with actual
handler/contribution coverage when P/C register the commands; retain the
portable command/menu identity and schema-drift checks.

English keys are the M118 region at the start of en.ts; every UI/manifest table
has real translations. Read UI_TEXT at use time. Integrator removes
`MANIFEST_HANDOFF` from `scripts/check-l10n.mjs` only after all six commands
land in package.json, then removes the patch. Before that, the gate checks the
patch with ordinary literal/reference/translation rules, with no unused-key
ignore. Help reference scripts are absent from this base; update the catalog
when its parallel implementation lands, without claiming unregistered commands.

Keep prompts/share runtime schemas behind a lazy entry; no activation import.
The shared validation runtime currently does not export zod/mini `_default`:
if a Node lazy bundle externalises zod for these contracts, add that real
member to validationEntry and prove its bundle split check. Browser tests use
inline zod. Regenerate `npm run schema:exec`, then check with `-- --check`.
