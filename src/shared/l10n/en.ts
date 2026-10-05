// The English table: what the user reads, and the base every translation in
// `l10n/ui.<language>.json` must match key for key (PLAN.md D33). Mirrors the
// Claude Code panel wording where the parity checklist calls for it.
//
// - A plain string is shown as it is.
// - `{name}` marks a slot that `fill` or `plural` fills; a translation keeps
//   every slot and may move it.
// - `forms({ one, other })` is a count-dependent string; `plural` picks the
//   form by the display language's own rules, and a translation carries
//   exactly the forms its language uses.
// - A nested object of strings is a group of labels keyed by an id.
//
// Text the model or Meta reads is not here: it is `MODEL_TEXT` in
// constants.ts and stays English whatever the display language.

import { forms } from './forms'

// Lossless shared phrases keep the English fallback within D6's existing cap.
const SCANNER_PHRASES = [
  'conversation',
  'Muse Code',
  'not checked',
  'could not be',
  'Model API',
  'workspace',
  'reinstall the extension and reload the',
  'license',
  'message',
  'distribution',
  'requirements have no resolved version',
  'does not',
  'in this',
  'permission mode',
  'changed',
  'log has the details',
  'Could not',
  'session',
  'command',
  'backend',
  'settings',
  'metadata',
  'Muse Voice',
  'without asking',
  'billed to your',
  'extension',
  'Restricted Mode',
  'declares',
  'scheduled prompt',
  'NOTICES or the equivalent notice file',
  'would close the gap',
  'installed',
  'for this',
  'Actual cost depends on tokens used',
  'running',
  'the model',
  'approval',
  'stopped',
  'MCP servers',
  'from the',
  'request',
  'did not',
  'cannot be',
  'background',
  'in Plan mode',
  'unless you allow',
  'the agent',
  'is not available',
  'could not',
  'Muse Spark',
  'version',
  'changes',
  'was not',
  'try again',
  'permissions',
  'no longer',
  'exceeds the',
  'declarations',
  'are not',
  'Voice dictation',
  'Nothing was',
  'the file',
  'bundled skills',
  'Billed to your',
  'attempts',
  'The page',
  'while each file still holds exactly',
  'project',
  'package',
  'obligations',
  'credentials',
  'as they are',
  'subscription',
  'your next',
  'setting',
  'nothing',
  'museSpark',
  'from verified ownership',
  'evidence',
  'already',
  'SPDX-License-Identifier',
  'so none of it was read',
  'unknown',
  'the preview',
  'repository',
  'before this',
  'MCP server',
  'The file',
  'which is not',
  'to review',
  'is not valid',
  'sandbox',
  'refused',
  'omitted past the',
  'Confirm',
]
function scannerText(encoded: string): string {
  let text = encoded
  for (let index = SCANNER_PHRASES.length - 1; index >= 0; index -= 1) {
    text = text.split(`~${String(index).padStart(2, '0')}`).join(SCANNER_PHRASES[index] ?? '')
  }
  return text
}

function scannerForms(encoded: string) {
  const text = scannerText(encoded)
  return forms({ one: text, other: text })
}

export const EN = {
  untitledConversation: 'Untitled',
  crashTitle: 'The panel hit an error',
  crashDetail: scannerText('Reload rebuilds the panel; the ~00 is kept by the host.'),
  crashReload: 'Reload',
  // M25 (PLAN.md D28): webview and UI state.
  toolInterrupted: 'Interrupted',
  thoughtDone: 'Thought',
  quoteCopy: 'Copy',
  snapshotTooLong: scannerText(
    'This ~00 was too long to keep in the panel across the reload; open it from History to see all of it.',
  ),
  linkOutsideWorkspace: scannerText('Links to files outside the ~05 ~58 opened ~39 transcript.'),
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  // Windows binds Ctrl+Alt+Esc (Ctrl+Esc opens Start there; M26, D29).
  composerPlaceholder: 'ctrl esc (ctrl alt esc on Windows) to focus or unfocus Muse',
  // Shown while a turn runs: Enter then steers the running turn.
  composerQueuePlaceholder: scannerText('Queue another ~08…'),
  composerLabel: 'Message Muse',
  connecting: scannerText('Connecting to the ~25 host…'),
  notSignedIn: 'Not signed in',
  sendDisabledReason: scannerText('Sign in to send ~08s'),
  stopTitle: 'Stop',
  signInTitle: scannerText('Sign in to ~49'),
  signInBrowser: 'Sign in with your Meta account',
  signInBrowserDetail: scannerText('Shows an ~36 code here; open the sign-in page to approve it.'),
  signInApiKey: 'Use a Model API key',
  signInApiKeyDetail: 'Paste a key from dev.meta.ai; it is stored in VS Code secret storage.',
  installTitle: scannerText('~01 is not ~31'),
  installDetail: scannerText('The ~01 CLI hosts ~00s ~32 ~25. Install it here, then sign in.'),
  installAction: 'Open install instructions',
  installStartAction: 'Install Muse Code',
  installConfirmDetail: scannerText(
    'Meta publishes this ~18. It downloads and runs an installer on this machine:',
  ),
  installConfirmAction: 'Run installer',
  installCancelAction: 'Cancel',
  installWaiting: scannerText('Installing ~01 in the terminal…'),
  installTimedOut: scannerText('~01 ~52 found. Check the terminal output, then check again.'),
  installStartFailed: scannerText(
    'The installer terminal ~48 open. Try again or use the install instructions.',
  ),
  deviceCodePrompt: 'Enter this code in your browser:',
  deviceCodeOpenAction: 'Open sign-in page',
  deviceCodeCancelAction: 'Cancel sign-in',
  deviceCodeWaiting: scannerText('Waiting for browser ~36…'),
  signInCancelled: 'Sign-in cancelled.',
  signInFailed: scannerText('~16 start in-panel sign-in. Check ~01 and ~53.'),
  signOutPending: scannerText(
    'Sign-out is in progress or ~70 remain. Finish ~01 logout or remove META_API_KEY, then check again.',
  ),
  signOutTerminalFailed: scannerText(
    'Extension ~17 ended, but its logout terminal ~48 open. Run muse logout or remove META_API_KEY, then check again.',
  ),
  signOutHoldFailed: scannerText(
    '~16 save sign-out protection. Extension ~17 ended; remove META_API_KEY and finish muse logout before reopening VS Code.',
  ),
  signOutKeyClearFailed: scannerText(
    '~16 clear the stored ~04 key. The ~25 host ~37; check VS Code secret storage and sign out again.',
  ),
  signOutStopFailed: scannerText(
    'Backend shutdown failed. This window is gated; close VS Code and check ~70 before reopening.',
  ),
  retryAction: 'Check again',
  apiKeyPrompt: 'Meta Model API key',
  apiKeyPlaceholder: 'LLM_…',
  apiKeyInvalid: scannerText(
    'A ~04 key starts with LLM_ (older keys look like LLM|<numeric id>|<secret>).',
  ),
  signInWaiting: 'Waiting for the browser sign-in to finish…',
  signInTimedOut: scannerText('The sign-in ~41 complete in time. Try again.'),
  // How Muse Code ended a browser sign-in (`account/loginCompleted`, D26):
  // `expired`, `denied` and `failed` as captured live; any other ending as
  // Muse Code named it.
  signInExpired: 'The code expired before it was approved. Sign in again to get a new code.',
  signInDenied: 'You denied the sign-in in the browser.',
  signInSaveFailed: scannerText('~01 signed in but ~48 save the credential.'),
  signInEnded: 'Sign-in ended: {outcome}. Sign in again to get a new code.',
  // A macOS credential file on Windows or Linux stops `muse serve` (D26):
  // version 2, empty or a Keychain pointer, or the Keychain lane.
  cliCredentialUnsupported: scannerText(
    '~01 cannot start: its sign-in file {path} is in the macOS format, which ~01 cannot read on this system. Move or rename that file, then sign in again.',
  ),
  hostExited: scannerText('~01 ~37 unexpectedly'),
  hostStarting: 'Starting Muse Code…',
  // PLAN.md D25: restarts, crashes and closed sessions continue the conversation.
  hostRestartsOnSend: scannerText('The next ~08 restarts it and continues this ~00.'),
  turnStoppedByRestart: scannerText('Stopped: the ~19 restarted'),
  sessionClosedByHost: scannerText('~01 closed this ~17'),
  sessionResumesOnSend: scannerText('The next ~08 resumes it.'),
  sessionContinued: 'Conversation continued after the restart.',
  sessionNotContinued: scannerText(
    'The ~00 ~03 continued after the restart, so this ~08 starts a new one',
  ),
  surfaceClosed: 'The panel was closed',
  hostStartFailed: scannerText('The ~19 ~48 start'),
  decisionErrorNotice: scannerText(
    '~01 reported an error for the decision (the tool may have run anyway)',
  ),
  jumpToLatest: 'New messages',
  jumpToLatestTitle: scannerText('Jump to the newest ~08'),
  copyResponse: 'Copy response',
  openOutputTitle: 'Click to open the output in an editor',
  toolOutputTitle: '{tool} tool output ({id})',
  clickToExpand: 'Click to expand',
  openOutputFailed: scannerText('~16 open the output'),
  working: 'Working…',
  attachTitle: 'Attach',
  attachMenuLabel: 'Attach',
  uploadFromComputer: 'Upload from computer',
  addContext: 'Add context',
  commandsTitle: 'Commands',
  modelPillTitle: 'Model and effort',
  permissionModeTitle: 'Permission mode',
  modesTitle: 'Modes',
  modesHintKeys: '⇧ + tab',
  modesLabel: 'Permission modes',
  bypassNotAllowed: scannerText('Turn on the "Allow dangerously skip ~54" ~74 to use Bypass ~54.'),
  // PLAN.md D24: the setting turned off while a conversation is in Bypass.
  bypassRevoked: scannerText(
    'The "Allow dangerously skip ~54" ~74 was turned off; this ~00 is back in Manual.',
  ),
  // D24: in a remote window a dev container's settings can switch Bypass on.
  bypassRemoteTitle: scannerText('Run without ~36s on a remote machine?'),
  bypassRemoteDetail: scannerText(
    'This window runs on a remote machine or in a container, where a dev container definition can set ~76.allowDangerouslySkipPermissions without you. Bypass ~54 lets Muse edit files and run ~18s ~23.',
  ),
  bypassRemoteConfirm: scannerText('Use Bypass ~54'),
  bypassRemoteStartedManual: scannerText(
    '~76.initialPermissionMode asks for Bypass ~54, but this is a remote window; the ~00 starts in Manual. Choose Bypass ~39 Modes menu to confirm it.',
  ),
  // D24: an edit the "Edit automatically" mode approved on the user's behalf.
  editAutomaticallyResolver: 'Edit automatically',
  focusViewBadge: 'Focus view',
  historyTitle: 'Session history',
  sideChatTitle: 'Side chat',
  openSideChat: 'Side chat',
  newConversationTitle: 'New conversation',
  sendTitle: 'Send',
  // Command palette ("/" menu).
  paletteLabel: 'Actions',
  paletteFilterPlaceholder: 'Filter actions…',
  paletteNoMatches: 'No matching actions',
  paletteBack: 'Back',
  groupContext: 'Context',
  groupModel: 'Model',
  groupCustomize: 'Customize',
  groupAccount: 'Account & usage',
  groupSkills: 'Skills',
  groupSlashCommands: 'Slash commands',
  groupSupport: 'Support',
  attachFile: 'Attach file…',
  mentionFile: scannerText('Mention file from this ~67…'),
  clearConversation: 'Clear conversation',
  switchModel: 'Switch model…',
  effortItem: 'Effort',
  thinkingItem: 'Thinking',
  permissionModeItem: 'Permission mode',
  focusViewItem: 'Focus view',
  ctrlEnterItem: 'Send with Ctrl+Enter',
  openSettings: 'Open settings…',
  openKeybindings: 'Keyboard shortcuts…',
  sessionUsage: 'Session usage',
  sessionUsageValue: '{input} in · {output} out',
  signOutItem: 'Sign out',
  skillsLoading: scannerText('Start a ~00 to load skills'),
  skillsEmpty: scannerText('No skills available ~12 ~05'),
  // Skills, imports and export (M30, D30).
  manageSkillsItem: 'Manage skills…',
  manageSkillsDetail: scannerText('Turn ~01’s skills on or off'),
  importSkillsItem: 'Import skills…',
  importSkillsDetail: scannerText('Copy your Claude Code or Codex skills into ~01'),
  continueClaudeItem: scannerText('Continue a Claude Code ~17'),
  continueCodexItem: scannerText('Continue a Codex ~17'),
  continueDetail: scannerText('Pick up unfinished work ~12 ~00'),
  exportItem: '/export',
  exportDetail: scannerText('Save this ~00 as a Markdown file'),
  exportLogItem: 'Export session log…',
  exportLogDetail: scannerText('~01’s full JSON record of this ~00'),
  skillsCliMissing: scannerText('Managing skills needs the ~01 CLI, ~88 ~31.'),
  skillsListFailed: scannerText('~01 ~48 list its skills'),
  skillsPickTitle: 'Muse Code skills',
  skillsPickPlaceholder: 'Checked skills are on; uncheck one to turn it off',
  skillsUnchanged: 'No skills changed.',
  skillsChanged: 'Skills updated',
  skillsChangeFailed: scannerText('~01 ~48 change {skills}'),
  skillsRestartPrompt: scannerText(
    '~01 loads skill ~51 when it starts. Restart it now? A reply that is ~34 stops.',
  ),
  restartNow: 'Restart now',
  restartLater: 'Later',
  restartedNotice: scannerText('~01 restarted with the new skills; ~73 ~08 continues the ~00.'),
  importSourceTitle: 'Import skills from',
  importSourceClaude: 'Claude Code',
  importSourceCodex: 'Codex',
  importConfirm: scannerText('Import these skills into your ~01 skills?'),
  importConfirmAction: 'Import',
  importInvalid: 'not valid, will be skipped',
  importFailed: scannerText('~01 ~48 import skills'),
  // Import from Claude Code, Codex and Cursor (M83, D49).
  agentImportItem: 'Import from other agents…',
  agentImportDetail: scannerText(
    'Copy ~38, hooks, agents, ~18s and rules from Claude Code, Codex or Cursor',
  ),
  agentImportSourceTitle: 'Import from',
  agentImportSourceAll: 'All three',
  agentImportSourceCursor: 'Cursor',
  agentImportPickTitle: 'What to import',
  agentImportPickPlaceholder: 'Checked entries are previewed before anything is written',
  // {source}: the tool picked above.
  agentImportNothing: 'Nothing to import from {source}.',
  agentImportUntrusted: scannerText(
    'This ~05 is not trusted, so only your own files were read; grant trust to offer this ~67’s files.',
  ),
  agentImportConfirm: scannerText('Import what ~83 shows?'),
  agentImportConfirmAction: 'Import',
  agentImportNoneImportable: scannerText(
    'None of the checked entries can be imported; ~83 says why.',
  ),
  agentImportPersonalToProject: scannerText('this would copy a personal file into the ~67'),
  agentImportIgnoredToTracked: 'this would copy a git-ignored file into a tracked file',
  agentImportEditPrompt: scannerText(
    'Open converted entries in {path} as an unsaved edit for you ~89 and save? Save it only to that path, never to another file.',
  ),
  agentImportEditAction: scannerText('Edit and open ~61'),
  agentImportDone: 'Import finished.',
  agentImportOpenFile: 'Open the file',
  agentImportKindMcp: 'MCP server',
  agentImportKindHook: 'Hook',
  agentImportKindAgent: 'Agent',
  agentImportKindCommand: 'Command',
  agentImportKindRules: 'Rules section',
  agentImportUserFiles: 'your files',
  agentImportProjectFiles: 'this project',
  agentImportSkippedExists: 'already exists',
  agentImportSkippedUnmapped: scannerText('maps to no ~01 event'),
  agentImportSkippedDuplicate: 'another checked entry goes to the same place',
  agentImportSkippedDisabled: 'turned off where it came from',
  agentImportSkippedUnsupported: scannerText('uses something ~01 ~11 support'),
  agentImportSkippedProjectServer: scannerText(
    '~01 reads ~38 only from your own ~20, so a ~67’s servers ~58 offered there',
  ),
  agentImportSkippedUserRules: scannerText('your own rules: ~01’s `/rules import` brings them in'),
  agentImportSkippedOutside: 'its source or destination is unsafe or leads outside its folder',
  agentImportSkippedFailed: scannerText('~03 written; the log says why'),
  agentImportSkippedUnreadable: scannerText(
    'its source or destination ~03 checked, so it is left alone',
  ),
  agentImportSkippedTooLarge: scannerText('it would take AGENTS.md past the size ~01 loads'),
  agentImportSkippedChanged: scannerText('its folder ~14 after ~83, so it ~52 written'),
  // Shown when some of the other agents' files could not be read during the scan.
  agentImportSkippedFiles: 'Some source files were skipped; the log gives counts and reasons only.',
  // Shown when the import could not start writing at all.
  agentImportNotApplied: scannerText(
    '~60 imported: the window closed, the folder ~14 after ~83, or the checkpoint ~03 kept.',
  ),
  // Shown when an import is asked for while another one waits for its answers.
  agentImportBusy: scannerText('An import is ~79 open; answer its questions first.'),
  // Shown when the import stopped on an error nothing foresaw.
  agentImportFailed: scannerText(
    'The import ~37 on an unexpected error; what was ~79 written stays. The log has a fixed failure reason.',
  ),
  // Shown when the import's own code did not load (a damaged install).
  agentImportUnavailable: scannerText(
    'The import ~03 loaded, so ~75 can be imported; ~06 window. The ~15.',
  ),
  // The read-only preview document, in Markdown.
  agentImportPreviewTitle: 'Import preview',
  agentImportPreviewIntro: scannerText(
    'Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It ~11 look for ~70 in what it copies. This preview lists names, scopes and targets only. Config entries open unsaved for you ~89 and save.',
  ),
  // {fields}: field names, comma-separated.
  agentImportPreviewDropped: 'not carried over: {fields}',
  agentImportPreviewLegacyKey: scannerText(
    '~87 uses the legacy `mcp_servers` key. Rename it to `mcpServers` when you add these: ~01 loads neither when both are there.',
  ),
  agentImportPreviewNotImported: 'Not imported',
  // {count}: a number.
  agentImportCountFiles: 'New files: {count}',
  agentImportCountSections: 'Sections for AGENTS.md: {count}',
  agentImportCountCopies: 'Entries offered in the editor: {count}',
  agentImportCountSkipped: 'Not imported: {count}',
  exportNothing: scannerText('There is no ~00 to export yet.'),
  exportFailed: scannerText('The ~00 ~03 exported'),
  exportSaved: 'Conversation exported to {path}',
  exportLogUnavailable: scannerText('The ~17 log comes ~39 ~01 CLI, which this ~00 ~11 use.'),
  exportLogLocalOnly: scannerText(
    '~01 writes the ~17 log itself, so pick a folder on this machine.',
  ),
  exportWaitForTurn: scannerText('Export once the reply has finished, so ~61 holds all of it.'),
  exportHistoryUnavailable: scannerText(
    '~01 ~41 return this ~00’s history (it is too long to replay), so there is ~75 to write as Markdown. Export ~17 log… saves the whole record.',
  ),
  exportCliMissing: scannerText('Exporting the ~17 log needs the ~01 CLI, ~88 ~31.'),
  exportOpen: 'Open',
  exportDefaultTitle: 'Muse conversation',
  // Session export, import and share (M84, PLAN.md D49).
  exportJsonItem: scannerText('Export ~17 as JSON…'),
  exportJsonDetail: 'A portable file you can import or share',
  importSessionItem: 'Import session…',
  importSessionDetail: scannerText('Resume an exported ~17 file on the ~04 ~19'),
  openShareItem: 'Open share file…',
  openShareDetail: scannerText('Read a shared ~17 file, read-only'),
  exportPreviewTitle: scannerText('Export ~17 as JSON'),
  exportPreviewRedacted: 'Save redacted…',
  exportPreviewFull: 'Save without redaction…',
  exportPreviewOpen:
    'The redacted file is open in the editor. Nothing is written until you choose.',
  exportPreviewMessages: forms({
    one: scannerText('{count} ~08 ~12 ~00'),
    other: scannerText('{count} ~08s ~12 ~00'),
  }),
  exportPreviewPaths: forms({
    one: '{count} path redacted',
    other: '{count} paths redacted',
  }),
  exportPreviewAccounts: forms({
    one: '{count} account id redacted',
    other: '{count} account ids redacted',
  }),
  exportPreviewSecrets: forms({
    one: '{count} credential or key digest removed',
    other: scannerText('{count} ~70 or key digests removed'),
  }),
  exportPreviewKnownCredentials: scannerText(
    'Known credential shapes (API keys, tokens, passwords, private keys) and the key digest are always removed. A secret in another shape stays: read ~61 before you share it.',
  ),
  exportTooLarge: scannerText('This ~00 is too long for a ~17 export file.'),
  importPreviewTitle: 'Import session',
  // {source}: the backend label; {messages}: a message-count line; {model}:
  // the model id; {mode}: Manual or Plan in the display language.
  importPreviewDetail: scannerText(
    'From {source}: {~08s}. It continues on {model} and starts in {mode}; ~17 rules, goals, schedules and patches are dropped, and the imported history is treated as untrusted.',
  ),
  importSessionFailed: scannerText('The ~17 ~03 imported'),
  importSessionUnavailable: scannerText('Sessions can only be imported on the ~04 ~19.'),
  // Adopted into the panel, which appends the session's name.
  importedNotice: 'Session imported',
  // {mode}: Manual or Plan in the display language.
  importedUntrusted: scannerText(
    'This ~00 holds imported history, so it starts in {mode}. Only you can change that.',
  ),
  openShareTitle: 'Open share file',
  shareFailed: scannerText('The share file ~03 opened'),
  // {backend}: the backend label; {time}: a date and time.
  shareMetaLine: scannerText('Shared from {~19} · {time}'),
  shareReadOnly: scannerText('Read-only: ~75 ~12 file can act on your ~05.'),
  // The file's own `redacted` flag, which anyone can set: reported, never vouched for.
  shareMarkedRedacted: scannerText(
    '~87 says its paths and account ids were redacted; that is ~02 here.',
  ),
  // In place of one item of a share file that could not be rendered.
  shareSectionFailed: scannerText('This part of ~61 ~03 shown.'),
  // {shown}, {total}: counts of the file's items, as numbers.
  shareShownCount: 'Shown: {shown} of {total}',
  shareShowMore: 'Show more',
  // After "could not be imported: ". {size}, {limit}: sizes such as 2.4 MB.
  importReplayTooLarge: scannerText(
    'It holds {size} of text for ~35, and a resumed ~00 can start with at most {limit}. Open it as a share file to read it.',
  ),
  // Why a picked file was refused, after "could not be imported/opened: ".
  transferTooLarge: scannerText('~87 is larger than a ~17 export can be.'),
  transferFileMissing: scannerText('The picked file ~55 exists.'),
  transferEmpty: scannerText('~87 holds no ~00.'),
  transferNotAnExport: scannerText('~87 is not a ~49 ~17 export.'),
  transferLocalFileOnly: scannerText(
    'Session import and sharing require a local file on the ~25 host.',
  ),
  // {version}: the file's format version, a number.
  transferVersionUnsupported: scannerText('This ~50 of the ~25 cannot read format ~50 {~50}.'),
  // {field}: where in the file, as `transcript[2].outputRef`.
  transferUnknownField: scannerText('~87 holds a field this ~50 ~11 know: {field}'),
  // {field}: where in the file, as `transcript[2].status`.
  transferInvalidField: scannerText('~87 holds a field that ~90: {field}'),
  // MCP servers and hooks, read-only (M31, D30).
  mcpItem: 'MCP servers…',
  mcpItemDetail: scannerText('What ~01 connects to; sign in to a server'),
  hooksItem: 'Hooks…',
  hooksItemDetail: scannerText('Where ~01’s hooks come from'),
  mcpTitle: scannerText('~01 ~38'),
  mcpNoSettings: scannerText('~01 has no ~20 file yet, so no ~38. It would be at {path}'),
  mcpUnreadable: scannerText('~01’s ~20 file ~03 read:'),
  mcpNone: scannerText('No ~38 are configured in {path}'),
  mcpCount: forms({
    one: scannerText('{count} ~86 in {path}'),
    other: scannerText('{count} ~38 in {path}'),
  }),
  mcpOptional: 'optional',
  mcpRequired: scannerText('required (~01 stops if it fails)'),
  mcpDisabled: 'turned off',
  mcpEnv: 'environment:',
  mcpHeaders: 'headers:',
  mcpModeConflict: '“required” and “mode” are both set',
  mcpKeyConflict: scannerText(
    '~01’s ~20 hold both “mcpServers” and “mcp_servers”, so it loads no ~86 from either. Keep one key.',
  ),
  mcpModeConflictWarning: scannerText(
    '~01 loads no ~86 while a server sets both “required” and “mode”. Keep only “mode” on:',
  ),
  mcpOpenSettings: scannerText('Open the ~20 file'),
  mcpRestart: scannerText('Restart ~01 to load ~51'),
  mcpRestartDetail: scannerText('A reply that is ~34 stops; the ~00 continues on ~73 ~08'),
  mcpInvalidUrl: 'an invalid URL',
  mcpNoCommand: 'no command',
  mcpRestarted: scannerText('~01 restarted; ~73 ~08 loads the ~20 ~71 now.'),
  mcpDocs: scannerText('~38 in ~01 (documentation)'),
  mcpSignIn: 'Sign in',
  mcpSignInDetail: 'Runs muse mcp login in a terminal (OAuth in the browser)',
  mcpSignOut: 'Sign out',
  mcpRemotePlaceholder: 'A remote server: sign in or out, or edit its entry',
  mcpStdioPlaceholder: scannerText(
    'A local server needs no sign-in; edit its entry in the ~20 file',
  ),
  mcpCliMissing: scannerText('Signing in to an ~86 needs the ~01 CLI, ~88 ~31.'),
  mcpTerminalName: scannerText('~01 MCP sign-in'),
  // MCP servers on the Model API backend (M50, D42).
  mcpItemDetailModelApi: scannerText('The servers in ~01’s ~20, run by this window'),
  mcpTitleModelApi: scannerText('~38 on the ~04 ~19'),
  mcpRequiredModelApi: scannerText('required (a ~08 stops if it is not ~34)'),
  mcpStateNotStarted: scannerText('Starts with ~73 ~08'),
  mcpStateStarting: 'Starting…',
  mcpStateConnected: forms({ one: 'Connected: {count} tool', other: 'Connected: {count} tools' }),
  mcpStateUnoffered: forms({
    one: '{count} more not offered',
    other: '{count} more not offered',
  }),
  mcpStateFailed: scannerText('Not ~34: {reason}'),
  mcpStateRestricted: scannerText('Not started: this ~05 is in ~26'),
  mcpStateNotLoaded: 'Not loaded: see the warning',
  mcpBuiltIn: 'built in',
  mcpBuiltInDetail: scannerText(
    'The ~25’s own getDiagnostics: the errors and warnings in VS Code’s Problems panel',
  ),
  mcpRestartModelApi: scannerText('Restart the ~38'),
  mcpRestartModelApiDetail: scannerText(
    'A reply that is ~34 stops; the servers start again with ~73 ~08, ~39 ~20 ~71 then',
  ),
  mcpRestartedModelApi: scannerText('The ~38 ~37; ~73 ~08 starts them ~39 ~20 ~71 now.'),
  mcpShowLog: 'Show the log',
  mcpShowLogDetail: scannerText('What the server wrote to stderr, and why it ~37'),
  mcpModelApiPlaceholder: scannerText(
    'This window runs the server itself; a sign-in with muse mcp login is for ~01 only',
  ),
  mcpServerUnavailable: scannerText('~86 {name} ~47: {reason}'),
  mcpRequiredFailed: scannerText(
    '~86 {name} is required and is not ~34: {reason}. Fix its entry in ~01’s ~20, or set "mode": "optional", then restart the ~38 (~38… in the palette).',
  ),
  mcpNoServersKeys: scannerText(
    'No ~86 is loaded: ~01’s ~20 hold both “mcpServers” and “mcp_servers”. Keep one key.',
  ),
  mcpNoServersMode: scannerText(
    'No ~86 is loaded: {servers} set both “required” and “mode”. Keep only “mode”.',
  ),
  mcpNoServersUnreadable: scannerText('No ~86 is loaded: ~01’s ~20 file ~03 read ({reason}).'),
  hooksTitle: 'Muse Code hooks',
  hooksTitleModelApi: 'Model API hooks',
  hooksWarning: scannerText('Hooks run through your shell, outside ~01’s ~91 and ~36s'),
  hooksModelApiWarning: scannerText(
    'Hooks run through your shell outside tool ~36s. Turn on ~76.modelApiHooks only after reviewing these sources.',
  ),
  hooksProject: 'Project hooks',
  hooksProjectFile: '.muse/hooks.json',
  hooksProjectNone: scannerText('This ~05 has no .muse/hooks.json.'),
  hooksProjectTrusted: scannerText('Runs ~12 ~05'),
  hooksProjectUntrusted: scannerText('Runs only once you trust this ~05'),
  hooksUser: 'Your hooks',
  hooksUserBlock: scannerText('~20.json › hooks'),
  hooksUserNone: scannerText('None in your ~20'),
  hooksUserCount: forms({
    one: scannerText('{count} hook in your ~20'),
    other: scannerText('{count} hooks in your ~20'),
  }),
  hooksManaged: 'Managed hooks',
  hooksManagedKey: 'managed_hooks_path',
  hooksManagedNotSet: 'Not set: no administrator hooks',
  hooksManagedSet: scannerText('Set by your ~20; whoever controls this file controls what runs'),
  hooksManagedMissing: scannerText('Your ~20 name this file, but it ~11 exist.'),
  hooksDocs: scannerText('Hooks in ~01 (documentation)'),
  // Memory (M49, D41): the notes Muse Code keeps, on both backends.
  memoryItem: 'Memory…',
  memoryItemDetail: scannerText('The notes Muse keeps for later ~17s'),
  memoryTitle: 'Muse memory',
  memoryNone: scannerText('No memory notes yet ~32 ~05'),
  memoryCount: forms({ one: '{count} memory note', other: '{count} memory notes' }),
  memoryIndexDetail: scannerText('The index Muse reads at the start of every ~17'),
  memoryNewNote: 'New note…',
  memoryNewNoteDetail: scannerText('A Markdown note Muse reads in later ~17s, listed in MEMORY.md'),
  memoryDocs: scannerText('Memory in ~01 (documentation)'),
  memoryOpen: 'Open',
  memoryDelete: 'Delete…',
  memoryDeleteDetail: 'Moves the note to the trash and takes its line out of MEMORY.md',
  memoryDeleteIndexDetail: 'Moves the index to the trash; the notes stay',
  memoryDeleteConfirm: 'Delete the memory note {path}?',
  memoryDeleteConfirmDetail: scannerText(
    'It moves to the trash. Muse ~55 sees it from its next ~17 on.',
  ),
  memoryDeleteAction: 'Delete',
  memoryDeleted: 'Deleted {path}',
  memoryNewTitle: 'New memory note',
  memoryScopePlaceholder: 'Where the note lives',
  memoryNamePrompt: 'Name the note',
  memoryNamePlaceholder: 'deploy-steps.md',
  memoryNameInvalid: scannerText('~01 ~11 accept that name'),
  memoryNameTaken: scannerText('A note with that name ~79 exists.'),
  memoryDescriptionPrompt: 'What is the note about? One line for MEMORY.md (optional)',
  memoryDescriptionPlaceholder: 'How we deploy to staging',
  memoryFailed: scannerText('The memory ~03 ~14'),
  // Worktrees (M32, D30).
  newWorktreeItem: 'New worktree…',
  newWorktreeDetail: 'A new branch in its own folder and window; this checkout is untouched',
  removeWorktreeItem: 'Remove a worktree…',
  removeWorktreeDetail: 'Delete a worktree folder; its branch stays',
  worktreeNoWorkspace: scannerText('Open a folder in a git ~84 first.'),
  worktreeUntrusted: scannerText(
    'Worktrees need git, which ~11 run in ~26 (a ~84’s config can name programs for git to run). Trust this ~05 first.',
  ),
  worktreeNotRepository: scannerText('This ~05 is not in a git ~84'),
  worktreeBranchPrompt: 'Name the new branch',
  worktreeBranchPlaceholder: 'feature/login-form',
  worktreeBranchEmpty: 'Type a branch name.',
  worktreeBranchInvalid: scannerText('git ~11 accept that as a branch name.'),
  worktreeBranchExists: scannerText('A branch with that name ~79 exists.'),
  worktreeBaseTitle: 'Start the branch from',
  worktreeBasePlaceholder: 'The commit the new branch starts at',
  worktreeCurrent: 'current branch:',
  worktreeDetachedHead: 'the commit checked out now',
  worktreeFolderExists: scannerText('That folder ~79 exists:'),
  worktreeAddFailed: scannerText('git ~48 create the worktree'),
  worktreeCreated: 'Worktree ready at {path}',
  worktreeOpen: 'Open in New Window',
  worktreeListFailed: scannerText('git ~48 list the worktrees'),
  worktreeNoneToRemove:
    'There is no other worktree to remove (the main checkout and this window’s own are kept).',
  worktreeRemoveTitle: 'Remove a worktree',
  worktreeRemovePlaceholder: 'The folder is deleted; its branch stays',
  worktreeDetached: '(detached HEAD)',
  worktreeLocked: 'locked',
  worktreePrunable: 'its folder is gone',
  worktreeRemoveConfirm: 'Remove this worktree? Its folder is deleted.',
  worktreeBranchKept: 'The branch stays:',
  worktreeRemoveAction: 'Remove',
  worktreeDirtyConfirm: scannerText(
    'This worktree has uncommitted ~51. Removing it discards them for good. Remove it anyway?',
  ),
  worktreeDiscardAction: scannerText('Remove and discard ~51'),
  worktreeRemoveFailed: scannerText('git ~48 remove the worktree'),
  worktreeRemoved: 'Removed the worktree at {path}',
  compactItem: '/compact',
  compactDetail: 'Summarise older context to free the window',
  clearItem: '/clear',
  logoutItem: '/logout',
  openLog: 'Open output log',
  reportIssue: 'Report an issue…',
  openDocs: scannerText('~01 documentation'),
  modelListLabel: 'Models',
  thinkingOff: 'No thinking',
  // @-mention menu and attachments.
  mentionMenuLabel: 'Files',
  mentionNoMatches: 'No matching files',
  actionFailed: scannerText('That ~41 work (the ~49 ~15)'),
  slashNoMatches: scannerText('No matching ~18s; Enter sends the text as it is'),
  attachmentsLabel: 'Attachments',
  removeAttachment: 'Remove',
  attachmentTooLarge: 'Images must be 10 MB or smaller.',
  attachmentUnsupported: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  attachmentLimit: scannerText('At most 20 files per ~08.'),
  attachmentUnreadable: scannerText('~87 ~03 read.'),
  documentTooLarge: 'PDFs must be 32 MB or smaller.',
  documentsOverBudget: scannerText('Files must total at most 50 images and PDF pages per ~08.'),
  mediaTotalTooLarge: 'Attached images and PDFs exceed the combined media size limit.',
  olderMediaOmitted: scannerText(
    'Older images or PDFs were left out of this ~40 to stay within media limits. They remain in local history.',
  ),
  pdfNeedsModelApi: scannerText('PDF attachments require the ~04 ~19.'),
  invalidPdf: 'This file is named as a PDF but is not a valid PDF.',
  pdfLabel: 'PDF',
  // Model API read_file rows. The separate MODEL_TEXT result stays English.
  toolReadPdf: 'Read PDF `{path}` ({pages}, {bytes} bytes)',
  toolReadPdfPages: forms({ one: '{count} page', other: '{count} pages' }),
  toolReadPdfPagesUnknown: 'page count unknown',
  toolReadImage: 'Read image `{path}` ({mediaType}, {width}×{height}, {bytes} bytes)',
  toolReadPdfInvalid: scannerText('~87 `{path}` has a PDF name but no PDF header.'),
  toolReadImageInvalid: scannerText('~87 `{path}` is not a supported image.'),
  toolVisualFileMissing: scannerText('~87 `{path}` ~52 found.'),
  toolVisualReadFailed: scannerText('~87 `{path}` ~03 read.'),
  // M69 (PLAN.md D49): web fetch. The row's line under a fetched page: its
  // size and content type (text/html).
  webFetchSize: 'Fetched {size} ({type})',
  // Before each fetch Muse Code asks the extension for.
  webFetchConfirmTitle: scannerText('~01 wants to fetch a page from {host}'),
  webFetchConfirmDetail: scannerText(
    'The ~25 will download {url} from this computer and give its text to ~01. The whole address is sent to {host}, so anything written into it leaves the ~00.',
  ),
  // Why a fetch did not happen or did not finish.
  webFetchInvalidUrl: 'That is not a complete web address.',
  webFetchNotHttps: 'Only https:// pages are fetched.',
  webFetchCredentials: scannerText('An address with a user name or password is ~92.'),
  webFetchUrlTooLong: 'The address is longer than {max} characters.',
  webFetchReservedHost: '{host} is a local or reserved name, not a public site.',
  webFetchPrivateAddress: scannerText(
    '{host} leads to {address}, ~88 a public internet address. ~60 fetched.',
  ),
  webFetchUnresolved: scannerText('{host} ~03 found from this computer.'),
  webFetchWithdrawn: scannerText(
    'Web fetch is ~55 allowed here (the ~05 lost its trust, the ~13 ~14, or the ~91 network ~74 became restricted), so the fetch ~37 before its next ~40.',
  ),
  webFetchNat64Unknown: scannerText(
    '{host} has only IPv6 addresses here, and whether this network translates them to IPv4 addresses (NAT64) ~03 learned ({detail}), so they ~03 checked for a private address. ~60 fetched.',
  ),
  webFetchTooManyRedirects: scannerText('~65 redirected more than {max} times.'),
  webFetchRedirectWithoutLocation: 'The server answered {status} without saying where to go.',
  webFetchRedirectRefused: scannerText('~65 redirected to an address that is ~92: {reason}'),
  webFetchHttpStatus: 'The server answered {status}.',
  webFetchTooLarge: scannerText('~65 is larger than {size}.'),
  webFetchNoContentType: scannerText('The server ~41 say what the page contains.'),
  webFetchContentType: scannerText('~65 is {type}, not HTML or text.'),
  webFetchContentTypeUnnamed: scannerText('~65 is not HTML or text.'),
  webFetchEncoding: scannerText('~65’s compression ({encoding}) ~03 read.'),
  webFetchEncodingUnnamed: scannerText('~65’s compression ~03 read.'),
  webFetchTimeout: scannerText('~65 ~41 arrive within {duration}.'),
  webFetchConversionTimeout: scannerText(
    '~65 arrived, but its HTML ~03 converted in the time allowed (at most {duration}), ~81.',
  ),
  webFetchConversionMemory: scannerText('~65’s HTML needed more than {max} to convert, ~81.'),
  webFetchXhtml: scannerText(
    '~65 is XHTML (application/xhtml+xml), which web fetch ~11 read: read as HTML, its XML syntax would be misread. ~60 read.',
  ),
  webFetchUndecodable: scannerText(
    '~65 is in the {encoding} encoding, which this computer cannot decode, ~81.',
  ),
  webFetchConversionFailed: scannerText('~65’s HTML ~03 converted ({detail}), ~81.'),
  // Why no connection gave an answer: the page's host, and the checked
  // address(es) the request went to.
  webFetchCertificate: scannerText(
    '{host}’s certificate at {address} is not trusted on this computer. ~60 read. ({detail})',
  ),
  webFetchProxyCredentials: scannerText(
    'The proxy asked for ~70 before it would connect to {address} for {host}. ~60 read.',
  ),
  webFetchProxyRefused: scannerText(
    'A proxy or another machine in the way answered {status} instead of connecting securely to {address} ({host}). ~60 read.',
  ),
  webFetchUnreachable: scannerText('{host} ~03 reached at {address}. ({detail})'),
  webFetchNetwork: scannerText('The ~40 failed: {detail}'),
  // Web fetch is its own bundle (dist/webFetch.js, PLAN.md D6): a damaged install.
  webFetchUnavailable: scannerText(
    'Web fetch ~03 loaded, so ~75 was fetched; ~06 window. The ~15.',
  ),
  // A redirect to another host, handed back to the model on the Model API
  // backend; and the refusal in Restricted Mode.
  webFetchMoved: scannerText(
    '~65 redirected to {location}, on another host. Muse can fetch it in a new call, which asks again.',
  ),
  webFetchRestrictedMode: scannerText('Web fetch is off in ~26. Trust the ~05 to use it.'),
  // Observation packing (M73): a recall_output row's heading above the
  // recalled text (shown as it was), and why a recall read nothing back.
  packRecalled: 'Recalled characters {start} to {end} of {total} from packed output {id}',
  packRecallInvalid: scannerText('The recall ~40 was malformed, so ~75 was read back.'),
  packRecallUnknownId: scannerText(
    'No packed output ~12 ~00 has the id {id}, so ~75 was read back.',
  ),
  packRecallBadOffset: scannerText(
    'The offset is not a character position in packed output {id} (0 to {last}), so ~75 was read back.',
  ),
  textFileTooLarge: 'Text files must be 1 MB or smaller.',
  textFilesOverBudget: scannerText(
    'Attachments fill ~01’s ~08 limit. Remove an attachment or shorten the ~08.',
  ),
  textFilesOverModelApiBudget: scannerText(
    'Text attachments exceed the ~04 context allowance. Remove a file or attach a smaller excerpt.',
  ),
  textFileInvalid: scannerText('This file ~90 UTF-8 text.'),
  textFilePrivate: scannerText('This private file ~42 attached.'),
  textFileLabel: 'Text',
  binaryFileUnsupported: scannerText(
    'This binary file type ~42 attached. Use a PDF, image or UTF-8 text file.',
  ),
  // Transcript rows.
  thoughtFor: 'Thought for {duration}',
  thinkingNow: 'Thinking',
  addedLines: forms({ one: 'Added {count} line', other: 'Added {count} lines' }),
  removedLines: forms({ one: 'Removed {count} line', other: 'Removed {count} lines' }),
  modified: 'Modified',
  inLabel: 'IN',
  outLabel: 'OUT',
  showMore: 'Show more',
  showLess: 'Show less',
  loadingOutput: 'Loading…',
  toolFailed: 'Failed',
  toolRejected: 'Rejected',
  // M46: a task the user (or Stop) ended.
  toolStopped: 'Stopped',
  copyCode: 'Copy',
  copiedCode: 'Copied',
  insertCode: 'Insert at cursor',
  // {action} is the command, path or tool the card is about, shown as code.
  approvalAction: 'Muse wants to {action}',
  /** A bare tool name (subject kind "tool", e.g. subagent_spawn), M18. */
  approvalUseTool: 'Muse wants to use {action}',
  /** A web fetch on the Model API backend (M69): {action} is the URL, shown as code. */
  approvalFetch: 'Muse wants to fetch {action}',
  // {paths} is the list of images an edit starts from, shown as code.
  approvalImageSources: 'Starting from {paths}',
  // M67: a rename's card names a few of its files ({files}) and counts the rest.
  renameCardMore: forms({
    one: '{files} and {count} more file',
    other: '{files} and {count} more files',
  }),
  // M67: the code intelligence rows when VS Code's language services cannot answer.
  codeIntelNoService: scannerText('No language service answered for {path}, or it ~27 no symbols.'),
  codeIntelTimedOut: scannerText('The language service ~41 answer within {seconds} seconds.'),
  repoMapNoService: scannerText('No language service answered for the ~05’s symbols.'),
  // The paid-use popup before an image, on either backend (M34, M44, M58).
  imageBuyTitle: 'Muse wants to create the image {path}',
  imageBuyEditTitle: 'Muse wants to make the edited image {path}',
  imageBuyPrompt: 'Prompt: {prompt}',
  imageBuySources: 'Starting from: {paths}',
  imageBuyBilling: scannerText('This costs {price}, ~24 ~04 key, not to your ~01 ~72.'),
  approvalStage: 'step {position} of {total}',
  approvalProtectedWrite: 'Protected write',
  approvalJudgeEscalated: 'Escalated by the safety check',
  approvalFeedbackPlaceholder: 'Tell Muse what to do instead (optional)',
  approvalDecided: 'Decided',
  // PLAN.md D26: the approvals waiting, docked above the composer.
  approvalDockLabel: scannerText('Waiting for your ~36'),
  // {count}: how many approvals wait, this one included.
  approvalDockCount: forms({
    one: 'Approval waiting: {count}',
    other: 'Approvals waiting: {count}',
  }),
  approvalDockedNote: scannerText('Waiting for your ~36, in the card above the ~08 box'),
  questionSubmit: 'Submit',
  questionCancel: 'Cancel',
  questionFreeTextPlaceholder: 'Type your answer',
  questionOther: 'Other',
  questionOtherPlaceholder: 'Type your own answer…',
  questionAnswered: 'Answered',
  questionCancelled: 'Cancelled',
  questionCancelFailed: scannerText('The question ~03 cancelled'),
  // M46: an explanation instead of the options (MSP `userInput/clarify`).
  questionExplain: 'Explain instead',
  questionExplainTitle:
    'Answer in your own words instead of choosing; Muse reads it and decides again',
  questionExplainLabel: 'Your explanation',
  questionExplainPlaceholder: 'Say what you mean instead of choosing…',
  questionSendExplanation: 'Send explanation',
  questionBackToChoices: 'Back to the choices',
  questionClarified: 'Explained',
  clarifyNotAccepted: scannerText('The explanation ~52 accepted'),
  /** Replying to an output and quoting a highlighted passage (M17). */
  messageActions: 'Message actions',
  replyToOutput: 'Reply to this output',
  // Tokens and the dollar estimate under a Model API reply (M82).
  replyUsage: '{input} in · {output} out · estimated {cost}',
  quoteMenuLabel: 'Highlighted text',
  askAboutThis: 'Ask about this',
  commentOnThis: 'Comment on this',
  referenceReply: 'Replying to',
  referenceQuestion: 'Asking about',
  referenceComment: 'Commenting on',
  referenceRemove: 'Remove',
  referenceTitle: scannerText('Goes to ~46 with your ~08 as context'),
  todoTitle: 'Tasks',
  showHiddenSteps: forms({
    one: 'Show {count} step hidden by Focus view',
    other: 'Show {count} steps hidden by Focus view',
  }),
  hideHiddenSteps: forms({
    one: 'Hide {count} step hidden by Focus view',
    other: 'Hide {count} steps hidden by Focus view',
  }),
  contextPercent: '{percent} context',
  contextDetail: '{used} of {window} tokens · pressure {pressure}',
  noEditorForInsert: 'Open a text editor to insert code into it.',
  linkSchemeRefused: scannerText('Only http, https and mailto links can be opened ~39 transcript.'),
  sandboxNotice: scannerText(
    '~01 cannot run shell ~18s until its Windows ~91 is set up. Run "~49: Set Up Shell Sandbox" (one administrator ~36), then start a new ~00.',
  ),
  // Windows sandbox setup prompt and its outcomes (OS notifications).
  sandboxOffer: scannerText(
    '~01 needs a one-time administrator setup before it can run shell ~18s on Windows (it creates the ~91 users and network filter it runs ~18s under). Set it up now?',
  ),
  sandboxSetUpNow: 'Set up now',
  sandboxNotNow: 'Not now',
  sandboxDontAskAgain: "Don't ask again",
  sandboxReady: scannerText('~01 ~91 is ready. Start a new ~00 to run shell ~18s in it.'),
  sandboxAlreadyReady: scannerText('~01 ~91 is ~79 set up.'),
  sandboxStillRequired: scannerText('~01 ~91 is still not ready'),
  sandboxCancelled: scannerText('~01 ~91 setup ~41 complete'),
  sandboxExitCode: 'exit code {code}',
  sandboxNotNeeded: scannerText('~01 needs no ~91 setup on this platform.'),
  sandboxCliMissing: scannerText('~01 is not ~31, so its ~91 ~42 checked.'),
  // Editor integration (M5).
  editorContextTitle: 'Shared with Muse as context; × leaves it out',
  editorContextRemove: 'Leave the open file out',
  editorContextLabel: 'Open file',
  linePrefix: 'L',
  openFileTitle: scannerText('Open ~61 at this change'),
  openFileFailed: scannerText('~16 open ~61'),
  toggleDetails: 'Show or hide the details',
  applyCode: 'Apply',
  noEditorForApply: 'Open a text editor to apply code into it.',
  diffTitleSuffix: 'Muse edit',
  editNotRebuildable: scannerText('{path} ~42 rebuilt: ~61 ~14 since this edit.'),
  editUnsavedChanges: scannerText(
    '{path} ~42 reverted: save or discard the unsaved editor ~51, then ~53.',
  ),
  editPathRefused: scannerText('{path} ~92: the edited path is outside the ~05.'),
  editNoPatch: 'This edit left no patch document.',
  // Session history (M6).
  historyLabel: 'History',
  historySearchPlaceholder: 'Search sessions',
  historyEmpty: scannerText('No ~17s ~12 ~05 yet.'),
  historyNoMatches: 'No sessions match.',
  historyToday: 'Today',
  historyYesterday: 'Yesterday',
  historyWeek: 'Previous 7 days',
  historyOlder: 'Older',
  historyShowArchived: 'Show archived',
  historyArchive: 'Archive',
  historyUnarchive: 'Unarchive',
  historyCurrent: 'current',
  historyForkMark: 'fork',
  historyTurns: forms({ one: '{count} turn', other: '{count} turns' }),
  resumeItem: 'Resume',
  resumeDetail: scannerText('Pick a previous ~00 ~12 ~05'),
  renameTitle: scannerText('Rename this ~00'),
  renamePlaceholder: 'Conversation name',
  // The user card's menu (Claude Code's rewind button): fork, rewind, both.
  rewindMenuLabel: 'Fork or rewind',
  forkFromHere: scannerText('Fork ~00 from here'),
  rewindConversationToHere: scannerText('Rewind ~00 to here'),
  rewindCodeToHere: 'Rewind code to here',
  forkAndRewind: scannerText('Fork ~00 and rewind code'),
  rewindNothing: scannerText('No edits after this ~08 to rewind.'),
  rewindDone: forms({
    one: scannerText('Code rewound to this ~08 ({count} edit)'),
    other: scannerText('Code rewound to this ~08 ({count} edits)'),
  }),
  forkedNotice: scannerText('Forked into a new ~00.'),
  rewindImagesUnavailable: scannerText('Some images from this ~08 ~03 restored.'),
  rewindBeforeCompaction: 'Cannot rewind before the latest compaction.',
  // Turn checkpoints (M86): the user card's menu, the confirmations, the result.
  restoreFilesToHere: 'Restore files to here',
  checkpointsModelApiOnly: scannerText(
    'File restore and Redo require a connected ~04 ~17. Only ~35’s own file-tool edits are undone, ~66 what ~35 left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone.',
  ),
  checkpointsLegacyReadOnly: scannerText(
    'This ~08 was recorded by an earlier ~50 of ~49. Its files ~42 restored.',
  ),
  checkpointsNativeUnsafe: scannerText(
    'File restore and Redo are unavailable while a ~01 ~17, or a window that ~11 record its edits, may still change files. Close or reload that window, then ~53.',
  ),
  rewindAndRestore: scannerText('Rewind ~00 and restore files'),
  checkpointsRestricted: scannerText('File checkpoints are off in ~26'),
  checkpointsOff: scannerText('File checkpoints are off in ~20'),
  checkpointsNoGit: 'File checkpoints need git on PATH',
  conversationRewindUnavailable: scannerText('Rewinding the ~00 ~47 with ~01 on Windows'),
  restoreConfirmTitle: scannerText('Restore ~61s to ~85 ~08?'),
  restoreConfirmDetail: scannerText(
    'Only ~35’s own file-tool edits from this ~08 on are undone, ~66 what ~35 left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Files with unsaved ~51 are left ~71 and named. Redo puts back what the restore ~14.',
  ),
  restoreConfirmAction: 'Restore files',
  rewindCodeConfirmTitle: scannerText('Rewind the code to ~85 ~08?'),
  rewindCodeConfirmDetail: scannerText(
    'Muse’s recorded edits after this ~08 are undone, newest first; a file ~14 since is left as it is. What ~18s ~14 is not covered, and Restore files ~11 undo it either: it is left as it is; check ~50 control.',
  ),
  rewindCodeConfirmAction: 'Rewind code',
  restoreBothConfirmTitle: scannerText('Restore ~61s and rewind the ~00 to ~85 ~08?'),
  restoreBothConfirmDetail: scannerText(
    'Only ~35’s own file-tool edits from this ~08 on are undone, ~66 what ~35 left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Then the ~00 branches ~85 ~08 and its prompt returns to the composer. If a file is ~92, the ~00 is not rewound. The original ~00 stays in History.',
  ),
  restoreBothConfirmAction: 'Restore and rewind',
  rewindNotDone: scannerText('The ~00 ~52 rewound.'),
  restoreDone: forms({
    one: scannerText('Restored {count} file to ~85 ~08.'),
    other: scannerText('Restored {count} files to ~85 ~08.'),
  }),
  restoreNothing: 'No file needed restoring.',
  redoNothing: 'Nothing left to put back.',
  redoDone: forms({ one: 'Put {count} file back.', other: 'Put {count} files back.' }),
  redoAction: 'Redo',
  redoLabel: scannerText('Redo: put back ~61s this restore replaced'),
  redoGone: scannerText('This restore can ~55 be redone.'),
  // PLAN.md D26: a notice said again is one row with a count, not a new row.
  // {count}: how many times it was said in all (2 or more).
  noticeRepeatBadge: '{count}×',
  noticeRepeated: forms({ one: 'Shown {count} time', other: 'Shown {count} times' }),
  restoreRefusedUnsaved: scannerText('Left ~71, with unsaved ~51: {files}'),
  restoreRefusedChanged: scannerText('Left ~71, ~14 by something else in the meantime: {files}'),
  restoreRefusedBetween: scannerText(
    'Left ~71, ~14 by something else between ~35’s edits: {files}',
  ),
  restoreRefusedOrderUnknown: scannerText(
    'Left ~71, edited from more than one window in an order that ~42 told: {files}',
  ),
  restoreRefusedLinked: scannerText('Left ~71, reached through a link or junction: {files}'),
  restoreRefusedNotKept: scannerText('Not restorable, the earlier ~50 ~52 kept: {files}'),
  restoreRefusedTooLarge: 'Not restorable, too large to keep a copy of: {files}',
  restoreRefusedFailed: scannerText('~16 be ~14: {files}'),
  restoreUnchanged: forms({
    one: 'Already as before: {count} file.',
    other: 'Already as before: {count} files.',
  }),
  restoreWritesIncomplete: scannerText(
    '~60 restored: some of these turns’ edits were not fully recorded (a reload or crash mid-edit, or file checkpoints were off).',
  ),
  restoreLegacyInRange: scannerText(
    '~60 restored: some of these turns were recorded by an earlier ~50, which this one cannot restore.',
  ),
  restoreLegacyWindowOpen: scannerText(
    'Another window runs an older ~50 of ~49; reload it, then ~53.',
  ),
  restoreCommandsNote: scannerText(
    'Commands, hooks, MCP tools or ~43 work were active in these turns; files they ~14 ~58 undone. Check your ~50 control.',
  ),
  namedFilesMore: '{files} (+{count})',
  restoreNoCheckpoint: scannerText('This ~08 has no file checkpoint any more.'),
  restoreTurnRunning: scannerText('Wait until no turn is ~34 ~12 window, then ~53.'),
  restoreTurnElsewhere: scannerText(
    'A turn or file restore is ~34 in another VS Code window on this folder. Try again when it has finished.',
  ),
  sendMarkFailed: scannerText(
    'The ~08 ~52 sent: this window ~48 tell other windows on this folder that a turn is starting.',
  ),
  restoreFailed: scannerText('~16 restore ~61s'),
  checkpointFailed: 'the checkpoint failed',
  childCheckpointFailed: scannerText(
    'The subagent turn ~41 run: its file checkpoint ~03 created or its inherited recording decision is ~82.',
  ),
  resumedNotice: 'Resumed',
  historyUnavailable: scannerText('The ~00 history ~03 loaded'),
  historyNotServed: scannerText('The earlier ~08s of this ~00 ~03 shown'),
  unreadTooltip: 'Muse needs your attention',
  unreadMark: '● ',
  sessionRequired: scannerText('Start a ~00 first.'),
  // Account & usage dialog (M8).
  usageItem: 'Account & usage…',
  usageItemDetail: scannerText('Subscription usage, this ~00’s tokens, the ~19'),
  agentsCommand: '/agents',
  agentsCommandDetail: 'Show the agent map',
  usageCommand: '/usage',
  usageCommandDetail: 'Show account usage',
  costCommand: '/cost',
  costCommandDetail: scannerText('Show this ~00’s token totals'),
  usageLabel: 'Account & usage',
  usagePlan: 'Plan',
  usagePlanSubscription: scannerText('~01 ~72'),
  usageBackend: 'Backend',
  usageWindow: 'Current window',
  usageWeekly: 'This week',
  usagePercentUsed: '{percent} used',
  usageResetsIn: 'resets in {duration}',
  usageAsOf: 'as of {time}',
  usageAwaitingFreshReport: scannerText('Waiting for a fresh ~01 usage report.'),
  usageNoSubscription: scannerText(
    'No ~72 usage reported yet. ~01 reports it after the first turn of a ~00.',
  ),
  usageModelApiNote: scannerText(
    'This window runs on your ~04 key: ~40s are billed to the key at pay-as-you-go rates and counted on the dev.meta.ai dashboard.',
  ),
  usageOpenDashboard: 'Open dev.meta.ai',
  usageSessionTokens: 'This conversation',
  usageInput: 'Input',
  usageOutput: 'Output',
  usageCached: 'Cached',
  usageContext: 'Context',
  usagePackedAvoided: 'Packing saved (estimate)',
  usageNoSession: scannerText('No tokens counted yet ~12 ~00.'),
  usageLoading: 'Reading usage…',
  usageUnavailable: scannerText('Usage ~03 read'),
  usageClose: 'Close',
  // Onboarding tips on the empty state (M8), hidden by museSpark.hideOnboarding.
  onboardingTitle: 'Getting started',
  onboardingHide: 'Hide these tips',
  // Screen-reader announcements (M8): a polite live region reads these.
  announceTurnCompleted: 'Muse finished responding',
  announceTurnFailed: 'The turn failed',
  announceTurnCancelled: 'The turn was stopped',
  // A turn that needs attention while the VS Code window is unfocused (M82):
  // completed, failed, or ended some other way the backend named.
  notifyTurnDone: 'Muse finished responding.',
  notifyTurnFailed: 'Muse’s turn failed.',
  notifyTurnEnded: 'Muse’s turn ended.',
  notifyApprovalWaiting: scannerText('Muse is waiting for your ~36.'),
  notifyQuestionWaiting: 'Muse asked a question and is waiting for your answer.',
  notifyShowConversation: 'Show conversation',
  announceQuestion: 'Muse asked a question',
  announceResumed: 'Conversation resumed',
  // Voice dictation (M9).
  dictationTitle: 'Tap or hold to record (Ctrl+D)',
  dictationStopTitle: 'Stop recording (Ctrl+D)',
  dictationLabel: 'Record voice',
  dictationStarting: 'Starting the microphone…',
  dictationListening: 'Listening…',
  dictationFailed: scannerText('~59 failed'),
  dictationUnavailable: scannerText('~59 ~47 on this platform.'),
  dictationUnavailableLinux: scannerText(
    '~59 ~47 on Linux: no ~09 ships a speech recogniser, and this ~25 adds no third-party engine.',
  ),
  dictationUnavailableWindows: scannerText(
    '~59 needs Windows PowerShell, which ~52 found (SystemRoot is not set).',
  ),
  dictationUnavailableDarwin: scannerText(
    '~59 needs the macOS helper (native/darwin/muse-dictate), which this build ~11 include.',
  ),
  // After `dictationFailed`, when voice's own code did not load (a damaged install).
  dictationNotLoaded: scannerText('the dictation code ~03 loaded; ~06 window. The ~15.'),
  announceListening: 'Listening',
  announceStoppedListening: 'Stopped listening',
  // Model API backend (M7).
  allowOnce: 'Allow once',
  allowSessionPrefix: scannerText('Always allow ~12 ~17:'),
  reject: 'Reject',
  modelApiStalled: scannerText(
    'The ~04 sent ~75 for {seconds} s, so the reply was ended; send the ~08 again to retry',
  ),
  queuedTurnDropped: scannerText('Not sent: Stop cleared the queued ~08s'),
  compactionStopped: scannerText('the compaction was ~37'),
  compactionStoppedNotice: scannerText('Compaction ~37; the ~00 is as it was.'),
  // PLAN.md D26: a decision or answer that arrived after the prompt had moved.
  promptAlreadySettled: scannerText('That ~40 was ~79 answered, so this choice ~52 needed.'),
  promptMovedOn: scannerText(
    'That ~40 moved on to its next step ~85 choice arrived; choose again on the updated card.',
  ),
  promptGone: scannerText('That ~40 is ~55 waiting for an answer.'),
  // PLAN.md D26: Muse Code's own approval faults, and the way on.
  approvalReplayRefused: scannerText(
    '~01 refuses every ~08 ~12 ~00: a turn ~37 while a multi-step ~18 was partly approved, and ~01 cannot replay that ~36 (a fault in ~01, not in your choices). Restart ~01 to continue this ~00, or start a new one.',
  ),
  approvalLedgerFault: scannerText(
    '~01 applies your ~36s ~12 ~00 but reports an error for each one (a fault in its ~36 record, not in your choices). Each card follows what ~01 does next; a new ~00 ~11 have the fault.',
  ),
  museCodeRestartAsked: scannerText(
    '~01 was ~37. Your next ~08 starts it again and continues this ~00.',
  ),
  // CLI recovery (2026-10-03): a steer whose answer never came may still reach the turn.
  steerUnconfirmed: scannerText(
    '~01 ~41 confirm your ~08 reached the ~34 turn. It may still arrive; check before you send it again.',
  ),
  // The watchdog: a command refused at once while Muse Code answers nothing.
  museCodeNotAnswering: scannerText('~01 is not answering. Restart it with "~49: Restart ~01".'),
  museCodeRestartedUnresponsive: scannerText('~01 ~37 answering and was restarted.'),
  // Its notice offers Restart now (D26's action).
  museCodeUnresponsiveTurn: scannerText(
    '~01 ~37 answering while a turn runs. Restarting it stops that turn; the ~00 continues with ~73 ~08.',
  ),
  // After "Muse Spark: Restart Muse Code".
  museCodeRestarted: scannerText('~01 was restarted. Your next ~08 continues this ~00.'),
  // A session whose Muse Code event log failed (a CLI fault) takes no new message.
  sessionLogDamaged: scannerText(
    'This ~00’s ~01 log is damaged (a fault in ~01), so it cannot take new ~08s. Start a new ~00; this one stays in History.',
  ),
  turnUnqueued: scannerText('Not sent: the queued ~08 was withdrawn'),
  turnRetracted: scannerText(
    'Another ~01 client withdrew a ~08 from this ~00; reopen it from History to see it as stored.',
  ),
  modelRouteUnserved: scannerText(
    'The signed-in account cannot serve this ~00’s model; choose another model from ~35 menu.',
  ),
  viewGapReloaded: scannerText('Some updates from ~01 were missed, so the ~00 was reloaded.'),
  viewGapReloadFailed: scannerText('Some updates from ~01 were missed and the ~00 ~03 reloaded'),
  commandTooLarge: scannerText(
    'This ~08 is too large for ~01, which accepts up to 10 MiB per ~08 (images count at a third more than their file size). Remove an image or shorten the selection and send again.',
  ),
  outputIsBinary: scannerText('The stored output is binary and ~42 shown as text'),
  editReviewNeedsFolder: scannerText('Open the folder the edit was made in ~89 or revert it.'),
  unsavedFilesNotice: scannerText(
    'Muse reads and edits the saved files, not unsaved editor ~51 (turn on ~76.autosave to save before each ~08). Unsaved:',
  ),
  sessionEditsUnsupported: scannerText(
    '~01 cannot rename or fork ~17s on Windows (meta-models/muse-code-sdk#30, #31).',
  ),
  contributorTitle: 'Contributor-tier model',
  contributorDetail: scannerText(
    'Meta may use prompts and completions sent to a contributor-tier model to train its models, in exchange for the lower price. Use it ~32 ~00?',
  ),
  contributorConfirm: 'Use contributor model',
  contributorBlocked: scannerText(
    'Contributor-tier models are blocked ~12 ~05 (~76.confidentialWorkspace).',
  ),
  backendItem: 'Backend',
  backendDetail: scannerText('~76.~19: auto / museCode / modelApi'),
  backendMuseCode: scannerText('~01 (your Muse ~72)'),
  backendModelApi: scannerText('Meta ~04 (your key, pay as you go)'),
  modelApiBackendNotice: scannerText(
    'This ~00 runs on the Meta ~04 with the ~25’s own tools (read, edit, write, search, list, shell). Its ~17s are kept ~12 ~05’s ~25 storage.',
  ),
  installOrKeyDetail: scannerText(
    'The ~01 CLI hosts ~00s ~32 ~25; without it you can still use a Meta ~04 key.',
  ),
  compactionDone: 'Context compacted',
  // The Model API session budget (M82): a request that cannot fit is not
  // sent, and the turn's cost is shown against the cap afterwards.
  sessionBudgetStopped: scannerText(
    'Stopped: the next ~40 (about {estimate}) would pass the ~17 budget of {cap} ({spent} used). It ~52 sent.',
  ),
  sessionBudgetStoreUnavailable: scannerText(
    'The ~17 spend ledger ~03 read or saved. No new ~40 can be sent until it is available.',
  ),
  sessionBudgetLegacyFeesUnknown: scannerText(
    'The ~00’s spending is not fully verified. Wait for pending ~40s to finish, or start a new ~00 to use a spend cap.',
  ),
  sessionBudgetSearchUnavailable: scannerText(
    'Web search is unavailable while the ~17 spend cap is on: its billed query count has no verified limit. Turn the cap off to allow web search.',
  ),
  sessionBudgetRetryUnavailable: scannerText(
    'The previous ~40 may have been billed. Its full reservation was kept; send a new prompt to retry with a fresh allowance.',
  ),
  sessionBudgetUnknownCharge: scannerText(
    'Usage ~52 verified. {amount} remains reserved as a possible charge; this is not a confirmed bill.',
  ),
  sessionBudgetVoiceUnavailable: scannerText(
    '~22 is unavailable while the ~17 spend cap is on: its billed audio duration has no verified bound. Turn the cap off to allow paid voice, or use system dictation.',
  ),
  sessionBudgetVoiceContextChanged: scannerText(
    '~22 ~37 because the ~00 or its ~54 ~14. Start a new recording in the current ~00.',
  ),
  sessionBudgetUnpriced: scannerText(
    'Stopped: the ~17 budget ~42 kept on {model}, whose price this ~25 ~11 know. The ~40 ~52 sent.',
  ),
  sessionBudgetOutputLimited: scannerText(
    'The response reached the output limit the ~17 budget left it (max_output_tokens {tokens}) and may be cut short.',
  ),
  budgetTurnCost: 'This turn cost {cost} ({spent} of {cap} used).',
  resumeFailed: scannerText('~16 resume the ~00'),
  forkFailed: scannerText('~16 fork the ~00'),
  rewindConversationFailed: scannerText('~16 rewind the ~00'),
  sideChatFailed: scannerText('~16 open a side chat'),
  sideChatPlanOnly: scannerText('Side chats stay ~44.'),
  // M79 (PLAN.md D49): plans as files. {path} is the plan's workspace path.
  planActionsLabel: 'Plan actions',
  savePlan: 'Save plan',
  implementPlan: scannerText('Implement in a fresh ~00'),
  planImplementDetail: scannerText('A new ~00 with this plan as its brief, out of Plan mode'),
  planSaved: 'Plan saved to {path}.',
  planAlreadySaved: scannerText('This plan is ~79 saved in {path}.'),
  planSaveFailed: scannerText('~16 save the plan'),
  planSaveConfirm: 'Save this plan in .agents/plans?',
  planSaveConfirmDetail: scannerText(
    '.agents is a protected folder: what is in it guides ~46s that work here. The plan is saved as a new file; no file is replaced.',
  ),
  planImplementFailed: scannerText('~16 start the plan'),
  planRestricted: scannerText('Plans ~58 saved or implemented in ~26. Trust this ~05 to use them.'),
  planWaitForTurn: 'Wait for the reply to finish, or stop it, first.',
  planReplyNotLatest: scannerText('Only the latest reply ~44 can be saved as a plan.'),
  planImplementSideChat: scannerText('Implement a plan ~39 main ~00; a side chat stays ~44.'),
  planBriefText: 'Implement the plan in {path}.',
  planTodosByModel: scannerText(
    '~01 ~11 let the ~25 set its todo list, so the brief asks Muse to list the plan’s steps there.',
  ),
  planNamesTaken: scannerText('Every file name ~32 plan is taken in .agents/plans.'),
  planFileMissing: scannerText('That plan file ~55 exists.'),
  // {size}: the limit in KB.
  planTooLarge: 'This plan is larger than {size} KB, the most a plan may be.',
  planSessionGone: scannerText(
    'That ~00 is ~55 open ~12 panel, so this reply can ~55 be saved or implemented as a plan.',
  ),
  planNotFromPlanTurn: scannerText(
    'This reply ~52 written ~44 here, so it is not saved or implemented as a plan.',
  ),
  planHiddenMarkup: scannerText(
    'The plan holds HTML that the panel ~11 show. Open {path} and read all of it before you implement it.',
  ),
  planHiddenMarkupNotStarted: scannerText(
    'Plan saved to {path}, but not started: it holds HTML that the panel ~11 show. Read ~61, then implement it from Plans….',
  ),
  planSavedNotStarted: scannerText(
    'Plan saved to {path}, but not started: the ~00 ~14 in the meantime.',
  ),
  planChangedNotStarted: scannerText('The plan ~52 started: the ~00 ~14 in the meantime.'),
  planActionBusy: scannerText('A plan action is still ~34.'),
  planUnshownCharacters: scannerText(
    'This plan holds a control or format character (such as a direction override or a zero-width character) that makes the panel show it otherwise than ~35 would read it, so it is not saved or started.',
  ),
  planMarkdownUnavailable: scannerText(
    'The plan reader ~03 loaded, so plans ~58 saved, listed or implemented; ~06 window. The ~15.',
  ),
  // {mode}: the permission mode's name.
  planFromFileMode: scannerText(
    'A plan picked from Plans… starts in {mode}: ~61 comes ~39 ~05, so the ~00 asks before it acts.',
  ),
  // M84: a plan written in a conversation that holds imported history.
  planFromImportedMode: scannerText(
    'A plan from a ~00 with imported history starts in {mode}: that history is untrusted, so the new ~00 asks before it acts.',
  ),
  planOpen: 'Open',
  plansItem: 'Plans…',
  plansItemDetail: 'Saved plans in .agents/plans: open one or implement it',
  plansTitle: 'Plans',
  plansCount: forms({ one: '{count} saved plan', other: '{count} saved plans' }),
  plansNone: scannerText('No saved plans yet. Save one from a reply ~44.'),
  plansFailed: scannerText('~16 list the plans'),
  // M74 (PLAN.md D49): `/handoff` to a new conversation. {goal} is the goal
  // typed after the command; {size} is the brief size limit in KB.
  handoffItem: '/handoff',
  handoffDetail: scannerText('Distil this ~00 into a brief for a fresh one'),
  handoffRequestCard: scannerText('Hand off to a new ~00.'),
  handoffRequestCardWithGoal: scannerText('Hand off to a new ~00: {goal}.'),
  handoffDialogTitle: scannerText('Hand off to a new ~00'),
  handoffDialogBody: scannerText(
    'Review the brief, edit it if you need to, then start the new ~00. Nothing starts until you confirm.',
  ),
  handoffConfirm: scannerText('Start new ~00'),
  handoffUnavailable: scannerText('Handoff runs on the ~04 ~19 only.'),
  handoffEmpty: scannerText('There is ~75 to hand off yet.'),
  handoffBusy: scannerText('A handoff is ~79 ~34.'),
  handoffWaitTurn: 'Wait for the reply to finish, or stop it, first.',
  handoffSideChat: scannerText('Start a handoff ~39 main ~00.'),
  handoffInterrupted: scannerText('The handoff ~40 ~41 finish; ~75 was started.'),
  handoffFailed: scannerText('~16 prepare the handoff'),
  // After handoffFailed: the distillation turn ended with no reply text.
  handoffNoBrief: 'The model returned no brief.',
  handoffTooLarge: scannerText('The brief is larger than {size} KB; start the new ~00 by hand.'),
  handoffChangedNotStarted: scannerText('The handoff ~52 started: the ~00 ~14 in the meantime.'),
  // {mode}: the permission mode's name. The model wrote the brief, so it
  // starts in the starting mode only when the dialog showed all of it.
  handoffUnshownMode: scannerText(
    'The new ~00 starts in {mode}: the brief holds a control or format character (such as a direction override or a zero-width character) that the dialog ~11 show, so you ~41 see all of it.',
  ),
  planOpenFailed: scannerText('~16 open the plan'),
  sideChatSessionOnly: scannerText('This side chat can open only side-chat ~00s.'),
  renameFailed: scannerText('~16 rename the ~00'),
  sandboxOffProfileNotice: scannerText(
    "This ~05 is under your user profile, where ~01's Windows ~91 cannot run ~18s, so this window runs shell ~18s without the ~91, directly as you. Approval prompts still apply. Setting: ~76.shellSandbox.",
  ),
  rulesFileNoWorkspace: scannerText('Open a folder first; AGENTS.md lives in the ~05 root.'),
  rulesFileExists: scannerText('AGENTS.md ~79 exists ~12 ~05; opening it.'),
  rulesFileCreated: scannerText('AGENTS.md created. Muse reads it as ~67 rules ~39 next ~00.'),
  terminalCliMissing: scannerText('The ~01 CLI is not ~31, so there is no terminal to open.'),
  signedOutNotice: scannerText('Signed out of ~49.'),
  // The Agent map, the usage modal, the banner and the compact button (M14).
  agentsPillTitle: 'Show the agent map',
  agentsCount: forms({ one: '{count} agent', other: '{count} agents' }),
  // M46: the header pill while background work runs and no agent is shown.
  backgroundTasksPillTitle: scannerText('Show the ~43 tasks'),
  agentMapTitle: 'Agent map',
  agentMapHint: 'click an agent for details',
  agentMapEmpty: scannerText('No subagents ~12 ~00.'),
  // A subagent's or background task's status as Muse Code reports it; one
  // not listed here is shown as it came.
  agentStatuses: {
    inProgress: 'running',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    interrupted: 'interrupted',
    resultReady: 'result ready',
    queued: 'queued',
    closed: 'closed',
  },
  agentTokens: '{tokens} tokens',
  agentContextTokens: '{tokens} tokens in context',
  agentUntitled: 'Agent',
  agentRole: 'Role:',
  agentBack: 'Back to the map',
  agentTranscriptLoading: scannerText('Reading ~46’s transcript…'),
  agentTranscriptFailed: scannerText('~16 read ~46’s transcript'),
  /** The Agent map's owner controls (M18). */
  agentInterrupt: 'Interrupt',
  agentStop: 'Stop',
  agentResume: 'Resume',
  agentClose: 'Close agent',
  agentReopen: 'Reopen agent',
  agentReadResult: 'Mark result read',
  agentSendMessage: 'Send message',
  agentFollowup: 'Follow-up task',
  agentMessagePlaceholder: scannerText('A note ~32 agent, or its next task…'),
  agentControlsLabel: 'Agent controls',
  agentControlFailed: scannerText('The agent ~18 was ~92'),
  agentResultText: 'Result',
  agentNoTranscript: scannerText('No transcript ~32 agent.'),
  agentTranscriptLabel: 'Agent transcript',
  agentDelegationOff: scannerText(
    '~01’s subagent delegation is off (its default), so ~35 has no agent tools ~12 ~00. Set run.subagent_delegation_mode to "auto" in the ~01 ~20 file to enable it; the ~25 never edits that file.',
  ),
  agentOpenMuseSettings: scannerText('Open the ~01 ~20 file'),
  museSettingsMissing: scannerText('~01 has not written a ~20 file yet. It would be at {path}'),
  // Workflows (M47, PLAN.md D40): a run's card, its agents and controls, the
  // Workflow tool's row, and Muse Code's trigger setting in the Agent map.
  workflowRowLabel: 'Workflow',
  // A run the model wrote for this task, not a saved one.
  workflowGenerated: scannerText('Written ~32 task'),
  // What started a run (Muse Code's `triggerSource`); one not listed shows as it came.
  workflowTriggerSources: {
    guidanceAuto: 'started by the model',
  },
  workflowAgentsLabel: 'Workflow agents',
  // A workflow agent's status before it ends; one not listed shows as it came.
  workflowChildStatuses: {
    scheduled: 'queued',
    started: 'running',
    usage: 'running',
    completed: 'completed',
    terminal: 'finished',
  },
  // An agent the workflow gave no label; {number} counts from 1.
  workflowChildUntitled: 'Agent {number}',
  workflowAttempt: 'attempt {attempt}',
  workflowsCount: forms({ one: '{count} workflow', other: '{count} workflows' }),
  workflowsLabel: 'Workflows',
  // Muse Code's `run.workflow_trigger_mode`, one sentence per value.
  workflowTriggerModes: {
    auto: scannerText(
      '~01’s workflows are on auto: ~35 may start one on its own for large work, and starts one when you ask. Each workflow agent makes its own model calls.',
    ),
    explicit: scannerText(
      '~01’s workflows are on explicit: ~35 starts one only when you ask for it.',
    ),
    off: scannerText('~01’s workflows are off: ~35 has no workflow tool.'),
  },
  workflowTriggerOther: scannerText('~01’s workflow ~74 is {mode}.'),
  workflowTriggerHowTo: scannerText(
    'Set run.workflow_trigger_mode to "auto", "explicit" or "off" in the ~01 ~20 file to change it; the ~25 never edits that file.',
  ),
  // The Workflow tool's row.
  workflowLaunched: scannerText('Launched: it runs in the ~43 and reports back to this ~00.'),
  workflowScriptSaved: 'Script saved at {path}',
  backgroundTasksCount: forms({
    one: scannerText('{count} ~43 task'),
    other: scannerText('{count} ~43 tasks'),
  }),
  backgroundTasksLabel: 'Background tasks',
  backgroundBadge: 'background',
  subagentRowLabel: 'Agent',
  usageAccount: 'Account',
  usageAddModelApiKey: 'Add Model API key',
  usageReplaceModelApiKey: scannerText('Replace ~04 key'),
  usageAuthMethod: 'Auth method',
  usageAuthCli: scannerText('Meta account (~01 CLI)'),
  usageAuthKey: 'Model API key',
  usageAuthNone: 'Not signed in',
  usagePlanPayAsYouGo: 'Pay as you go',
  usagePlanUnknown: 'Not reported yet',
  usageCliVersion: 'Muse Code',
  usageModel: 'Model',
  usageHeading: 'Usage',
  usageCost: 'Estimated cost',
  usageCacheHits: 'Cache hits',
  // What the prompt cache saved, in dollars (M82, Model API only).
  usageCacheSavings: 'Cache savings',
  usageCacheSavingsValue: '{amount} ({percent})',
  usageCostNote: scannerText(
    'Estimate from Meta’s published per-token prices ~32 model’s tier; the dev.meta.ai dashboard is the bill. Prices read on {date}.',
  ),
  usageContributing: 'What’s contributing to your usage?',
  usageDay: 'Day',
  usageWeek: 'Week',
  usageContributingNote: scannerText(
    'Approximate, ~39 ~01 CLI’s trace logs on this machine; other devices ~58 included.',
  ),
  usageInsightReminders: scannerText(
    '{percent} of model ~64 came from ~01’s reminder agents, which run after every reply',
  ),
  usageInsightSubagents: scannerText('{percent} of model ~64 came from subagents'),
  usageInsightLong: scannerText('{percent} of model ~64 came from ~17s active for 8+ hours'),
  usageInsightNone: scannerText('No CLI activity recorded ~12 window.'),
  usageInsightUnavailable: scannerText(
    'Not available on this ~19: the ~04 has no local trace logs.',
  ),
  usageInsightNoLogs: scannerText('No ~01 trace logs were found on this machine yet.'),
  usageInsightTotals: scannerText('{~64} across {~17s}'),
  modelAttemptsCount: forms({
    one: '{count} model attempt',
    other: scannerText('{count} model ~64'),
  }),
  sessionsCount: forms({ one: '{count} session', other: '{count} sessions' }),
  durationNow: 'now',
  contextCompactTitle: 'Click to compact now',
  unsupportedFileTitle: 'Unsupported file type:',
  unsupportedFileDetail: scannerText(
    'Supported as uploads: images (PNG, JPEG, GIF, WebP). Other files go in as @ mentions inside the ~05, or by absolute path in the prompt for files outside it.',
  ),
  bannerDismiss: 'Dismiss',
  trustGrantedNotice: scannerText(
    'Workspace trusted: Muse will load its rules, skills and memory ~39 next ~08.',
  ),
  sandboxRestartNotice: scannerText(
    'A ~01 ~74 ~14; ~01 restarts with it on the next ~08 and continues this ~00.',
  ),
  sandboxProfileNotice: String.raw`This workspace is under your user profile, which Muse Code's Windows sandbox cannot enter: shell commands will start in the PowerShell folder instead of the project. File reads and edits are unaffected. A workspace outside C:\Users runs commands in place.`,
  // Label groups keyed by id (they were records in constants.ts before M40).
  permissionModes: {
    manual: 'Manual',
    acceptEdits: 'Edit automatically',
    plan: 'Plan',
    auto: 'Auto',
    bypassPermissions: 'Bypass permissions',
  },
  // One line under each mode in the Modes menu (the Claude Code wording, with
  // Muse in place of Claude and the MSP behaviour behind each mode, PLAN.md
  // D7, D69), per backend where they differ (D24). On Muse Code (the default
  // lines): in Manual it applies edits inside the workspace without an
  // approval (verified live in M4), so Edit automatically is Manual there,
  // and under `muse serve` Auto skips only the commands Muse Code judges
  // simple, with no safety-check judge (D69); the panel's reviewer checks the
  // rest while its setting is on (museCodeReviewedAutoDetail). The Model API
  // backend has no safety-check judge behind Auto either.
  permissionModeDetails: {
    manual: scannerText('Muse will ask before ~34 ~18s; ~01 edits ~05 files ~23'),
    acceptEdits: scannerText(
      'On ~01, the same as Manual: ~01 edits ~05 files ~23 and asks before ~34 ~18s',
    ),
    plan: 'Muse will explore the code and present a plan before editing',
    auto: scannerText('~01 runs the ~18s it judges simple ~23 and asks before the rest'),
    bypassPermissions: scannerText('Muse will edit files and run ~18s ~23'),
  },
  museCodeReviewedAutoDetail: scannerText(
    '~01 runs the ~18s it judges simple ~23; a reviewer may allow some others once, and you are asked about the rest',
  ),
  modelApiPermissionModeDetails: {
    manual: scannerText('Muse will ask for ~36 before each edit and each ~18'),
    acceptEdits: scannerText('Muse will edit files ~23 and ask before ~34 ~18s'),
    auto: scannerText('Muse will edit files ~23, except protected files, and ask before ~18s'),
  },
  effortLevels: {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
  },
  // Tool names seen on the wire (Muse Code 1.3.0, live captures 2026-09-21/22)
  // and the label the row shows; unknown tools show their raw name. The IDE
  // tool is named by the CLI's MCP catalog: `mcp__<server>__<tool>`.
  toolLabels: {
    write_file: 'Write',
    edit_file: 'Edit',
    read_file: 'Read',
    search: 'Search',
    bash: 'Bash',
    powershell: 'PowerShell',
    request_user_input: 'Question',
    mcp__ide__getDiagnostics: 'Diagnostics',
    list_files: 'List',
    ask_user: 'Question',
    todo_write: 'Tasks',
    // Muse Code's native subagent tools (M14; seen live 2026-09-23).
    subagent_spawn: 'Spawn agent',
    subagent_wait: 'Wait for agents',
    subagent_status: 'Agent status',
    subagent_send_message: 'Message agent',
    subagent_read_result: 'Agent result',
    subagent_cancel: 'Cancel agent',
    // Meta's hosted search on the Model API backend (M33).
    web_search: 'Web search',
    // Paid image generation on the Model API backend (M34) and image edits (M44).
    generate_image: 'Image',
    edit_image: 'Edit image',
    // The same, made by the extension's ide server for Muse Code (M44).
    mcp__ide__generateImage: 'Image',
    mcp__ide__editImage: 'Edit image',
    // The extension's web fetch for Muse Code, through the ide server (M69).
    mcp__ide__webFetch: 'Fetch page',
    // Muse Code's own tools (M43): captured live 2026-09-25, the rest named
    // from the CLI's tool list (PLAN.md D36).
    read_memory: 'Read memory',
    add_memory: 'Save memory',
    edit_memory: 'Edit memory',
    create_goal: 'Set goal',
    get_goal: 'Check goal',
    update_goal: 'Update goal',
    report_progress: 'Goal progress',
    cron_create: 'Schedule prompt',
    cron_list: 'Scheduled prompts',
    cron_delete: scannerText('Cancel ~28'),
    scheduled_prompt: 'Run scheduled prompt',
    web_fetch: 'Fetch page',
    work_stop: 'Stop work',
    work_status: 'Work status',
    powershell_input: 'PowerShell input',
    bash_input: 'Bash input',
    shell: 'Shell',
    apply_patch: 'Patch',
    monitor: 'Monitor',
    artifact: 'Artifact',
    image_generation: 'Image',
    workflow: 'Workflow',
    code_exec: 'Run code',
    code_wait: 'Wait for code',
    tool_search: 'Find tools',
    read_skill: 'Skill',
    send_session_message: 'Message session',
    list_peer_sessions: 'Other sessions',
    write_todos: 'Tasks',
    update_plan: 'Tasks',
    TodoWrite: 'Tasks',
    snooze_reminder: 'Snooze reminder',
    submit_reminder_decision: 'Reminder',
    submit_result: 'Result',
    // The Auto reviewer's own row (M78): one review, marked paid.
    auto_review: 'Auto review',
    // M68 (PLAN.md D49): the verify loop on the Model API backend: the
    // model's own call, and the automatic check after a round of edits.
    run_checks: 'Run checks',
    verify_edits: 'Check edits',

    // M67: code intelligence, native on the Model API and on the ide server.
    find_definition: 'Definition',
    find_references: 'References',
    workspace_symbols: 'Symbols',
    document_symbols: 'Outline',
    hover: 'Hover',
    call_hierarchy: 'Calls',
    repo_map: 'Repo map',
    rename_symbol: 'Rename',
    mcp__ide__findDefinition: 'Definition',
    mcp__ide__findReferences: 'References',
    mcp__ide__workspaceSymbols: 'Symbols',
    mcp__ide__documentSymbols: 'Outline',
    mcp__ide__hover: 'Hover',
    mcp__ide__callHierarchy: 'Calls',
    mcp__ide__repoMap: 'Repo map',
    mcp__ide__renameSymbol: 'Rename',
  },
  // A tool from an MCP server the table does not name (`mcp__<server>__<tool>`).
  mcpToolLabel: '{tool} ({server})',
  // Where a memory note lives: Muse Code's `scope` (M43).
  memoryScopes: {
    personal_project: scannerText('Your memory ~32 ~67'),
    project: scannerText('Project memory, shared with the ~84'),
    personal: scannerText('Your memory for every ~67'),
  },
  // A session goal's status (M43); one Muse Code adds later shows as it comes.
  goalStatuses: {
    active: 'Active',
    paused: 'Paused',
    complete: 'Complete',
    blocked: 'Blocked',
    // M45: the rest of Muse Code 1.3.0's list; a goal stopped by a limit.
    usage_limited: 'Usage limit reached',
    budget_limited: 'Token budget spent',
  },
  // {percent} is already formatted ("50%").
  goalPercent: '{percent} done',
  goalProgress: 'Goal progress',
  goalNow: 'Now',
  goalNext: 'Next',
  goalTokens: 'Tokens',
  goalTokensOfBudget: '{used} of {budget}',
  // The session goal (M45, PLAN.md D38): the strip above the composer, its
  // controls, `/goal` in the prompt and what the conversation says of them.
  goalItem: '/goal',
  goalItemDetail: 'Set a goal Muse keeps working toward: /goal <objective>',
  goalStripLabel: 'Session goal',
  goalTitle: 'Goal',
  goalPause: 'Pause',
  goalResume: 'Resume',
  goalEdit: 'Edit',
  goalClear: 'Clear',
  goalPauseTitle: 'Pause the goal: Muse stops working toward it until you resume it',
  goalResumeTitle: 'Resume the goal: Muse starts working toward it again',
  goalEditTitle: 'Change the goal’s objective',
  goalClearTitle: 'Remove the goal',
  goalEditLabel: 'Goal objective',
  goalEditSave: 'Save',
  goalEditCancel: 'Cancel',
  // {objective} is the goal as the user typed it.
  goalSetNotice: 'Goal set: {objective}',
  goalEditedNotice: scannerText('Goal ~14: {objective}'),
  goalPausedNotice: 'Goal paused',
  goalResumedNotice: 'Goal resumed',
  goalClearedNotice: 'Goal cleared',
  goalNone: scannerText('There is no goal ~12 ~00. Set one with /goal <objective>.'),
  goalWakeWithdrawn: scannerText('Goal work ~37 before it started.'),
  goalRequestSuperseded: scannerText('The goal ~14 while this response was in progress.'),
  goalCannotPause: 'Only an active goal can be paused.',
  goalCannotResume: 'Only a paused goal can be resumed.',
  goalCannotEdit: scannerText(
    'Only an active or paused goal can be ~14; set a new one with /goal <objective>.',
  ),
  goalObjectiveMissing: 'Type the objective after /goal.',
  // {limit} is the maximum objective length, formatted in the user's locale.
  goalObjectiveTooLong: 'Keep the goal objective within {limit} characters.',
  goalCommandFailed: scannerText('The goal ~18 failed'),
  // A goal command the backend already had when a key activation or a
  // backend restart came: whether it took is not known.
  goalOutcomeUnknown: scannerText(
    'The sign-in ~14 or the ~19 restarted while the goal ~18 ran: it may or may not have taken effect. Check the ~17 goal.',
  ),
  // Read out when the goal's status changes; {status} is the status in words.
  announceGoalStatus: 'Goal: {status}',
  scheduleOnce: 'Once',
  scheduleRepeats: 'Repeats',
  // {date} is the local date and time.
  scheduleNextRun: 'Next run {date}',
  scheduleFired: forms({ one: 'Ran {count} time', other: 'Ran {count} times' }),
  scheduleNone: 'No scheduled prompts',
  // M52: extension-owned schedules on the Model API backend. Muse Code's cron
  // jobs stay model-mediated until its MSP exposes scheduler verbs.
  loopItem: '/loop',
  loopItemDetail: scannerText('Schedule a prompt ~12 ~04 ~00'),
  loopSyntax:
    'Use /loop 10m <prompt>, /loop "0 9 * * 1-5" <prompt>, /loop list, or /loop cancel <id>.',
  schedulePanelLabel: scannerText('Scheduled prompts ~32 ~00'),
  schedulePanelTitle: 'Scheduled prompts',
  schedulePanelScope: scannerText('~04 · this ~05, ~00 and key'),
  scheduleEvery: 'Every {duration}',
  schedulePending: 'Due · waiting for you to run it',
  scheduleRun: 'Run now (paid)',
  scheduleCancel: 'Cancel schedule',
  scheduleEnablePaid: 'Enable paid runs',
  scheduleRunJob: scannerText('Run ~28 {id}'),
  scheduleEnableJob: scannerText('Enable paid runs for ~28 {id}'),
  scheduleCancelJob: scannerText('Cancel ~28 {id}'),
  scheduleCreated: 'Scheduled prompt {id} created. It will wait for you when due.',
  scheduleCancelled: 'Scheduled prompt {id} cancelled.',
  scheduleUnknown: scannerText('Scheduled prompt {id} ~52 found ~12 ~00 and key.'),
  scheduleCommandFailed: scannerText('The schedule ~18 failed'),
  scheduleModelApiOnly: scannerText(
    'These schedules belong to the ~04 ~19. Ask ~01 to manage its own cron jobs in chat.',
  ),
  scheduleAccountMissing: scannerText('Store a ~04 key to use schedules.'),
  scheduleStorageMissing: scannerText('Workspace storage is unavailable; this schedule ~42 saved.'),
  scheduleInvalid: scannerText('The ~28 or cadence is invalid.'),
  scheduleTooMany: scannerText('This ~00 has reached its ~28 limit.'),
  scheduleNoFire: 'This cadence has no run within the seven-day schedule lifetime.',
  schedulePaidOff: scannerText(
    'Turn on Scheduled prompts (paid) and accept its price before ~34 a due prompt.',
  ),
  scheduleBusy: scannerText('Wait for the current turn to finish before ~34 this prompt.'),
  scheduleNotDue: scannerText('This ~28 is not due or is ~55 available.'),
  scheduleAlreadyRun: scannerText(
    'This occurrence was ~79 admitted in another window or before a restart.',
  ),
  scheduleRunStarted: scannerText('Started with your permission. ~04 tokens are ~24 key.'),
  scheduleRunConfirmTitle: scannerText('Run this ~28 with {model}?'),
  scheduleRunConfirmPrompt: 'Prompt: {prompt}',
  scheduleRunConfirmPrice: scannerText('~63 ~04 key: {price}. Total varies with tokens used.'),
  scheduleRunConfirmExtras: scannerText(
    'Other enabled paid tools may add their own charges. Bypass ~11 skip this confirmation.',
  ),
  scheduleConfirmationExpired: scannerText(
    'The model, ~00 or prompt ~14 during confirmation. Review the schedule and choose Run again.',
  ),
  webNoResults: 'No results',
  backgroundRunning: scannerText('Running in the ~43'),
  // M46 (PLAN.md D39): moving a running command to the background, stopping
  // background work, and the user's own `!` shell commands.
  moveToBackground: 'Move to background',
  moveToBackgroundTitle: scannerText('Keep this ~18 ~34 in the ~43 and let Muse carry on'),
  moveToBackgroundFailed: scannerText('The ~18 ~03 moved to the ~43'),
  nothingToMoveToBackground: scannerText('No ~18 is ~34 that could move to the ~43'),
  stopTask: 'Stop',
  stopTaskTitle: scannerText('Stop this ~43 task'),
  stopUserShellTitle: 'Stop this command',
  stopAllTasks: 'Stop all',
  stopAllTasksTitle: scannerText('Stop every ~43 task of this ~00'),
  stopTaskFailed: scannerText('The ~43 task ~03 ~37'),
  taskNotRunning: scannerText('That task is not ~34 any more'),
  userShellLabel: 'You ran',
  userShellExitCode: 'Exit code {code}',
  userShellExitSignal: 'Ended by signal {signal}',
  userShellRestricted: scannerText(
    'Shell ~18s do not run while the ~05 is in ~26. Trust the ~05 to run them.',
  ),
  userShellNotGranted: scannerText('This ~01 ~41 allow shell ~18s ~39 panel'),
  userShellFailed: scannerText('The ~18 ~41 run'),
  composerShellMode: 'Shell',
  composerShellModeTitle: scannerText(
    'Runs this ~18 in the ~05, as you. Muse sees the ~18 and what it printed.',
  ),
  runCommandTitle: 'Run command',
  toolImageAlt: 'The image {path}',
  toolImageFailed: scannerText('The image ~03 shown'),
  // A CLI run that failed without saying why; {code} is the process's own number.
  processExitCode: 'exit code {code}',
  // Where a skill in the Manage Skills pick comes from, keyed by the CLI's scope.
  skillScopes: {
    bundled: 'built-in',
    user: 'yours',
    project: 'this project',
    plugin: 'plugin',
  },
  importNothingFrom: 'No skills to import from {source}.',
  // The import's outcome, one sentence per kind; {skills} lists the ids.
  importInstalledSummary: forms({
    one: 'Imported {count}: {skills}',
    other: 'Imported {count}: {skills}',
  }),
  importSkippedSummary: forms({
    one: '{count} skipped: {skills}',
    other: '{count} skipped: {skills}',
  }),
  importQuarantinedSummary: forms({
    one: '{count} quarantined: {skills}',
    other: '{count} quarantined: {skills}',
  }),
  importFailedSummary: forms({
    one: '{count} failed: {skills}',
    other: '{count} failed: {skills}',
  }),
  // The bundled skills for Muse Code (M89, PLAN.md D68): the panel's one-time
  // offer and its buttons, then what Install, Update and Remove did. {skills}
  // lists skill ids, {tag} is the package's release (v0.7.0), {folder} a path.
  bundledSkillsOffer: scannerText(
    '~49 comes with the skills {skills}. Install them for ~01? They are copied into your Muse config folder.',
  ),
  bundledSkillsUpdateOffer: scannerText(
    '~49 comes with a newer release of its ~62 ({tag}). Update the copy ~01 uses?',
  ),
  bundledSkillsInstall: 'Install',
  bundledSkillsUpdate: 'Update',
  bundledSkillsNotNow: 'Not now',
  bundledSkillsInstalled: forms({
    one: scannerText('Installed {count} bundled skill ({tag}) for ~01: {skills}'),
    other: scannerText('Installed {count} ~62 ({tag}) for ~01: {skills}'),
  }),
  bundledSkillsSkipped: forms({
    one: 'Left {count} skill out because a skill of yours has that name: {skills}',
    other: 'Left {count} skills out because skills of yours have those names: {skills}',
  }),
  bundledSkillsRemoved: forms({
    one: scannerText('Removed {count} bundled skill from ~01: {skills}'),
    other: scannerText('Removed {count} ~62 from ~01: {skills}'),
  }),
  bundledSkillsNothingToRemove: scannerText('No ~62 are ~31 for ~01, so ~75 was removed.'),
  bundledSkillsInstallFailed: scannerText('The ~62 ~03 ~31 at {folder}: {reason}'),
  bundledSkillsRemoveFailed: scannerText('The ~62 ~03 removed at {folder}: {reason}'),
  // The reason when the folder is there but holds no mark of the extension's install.
  bundledSkillsNotOurs: scannerText(
    'a folder of that name exists that ~49 ~41 install, so it was left alone',
  ),
  bundledSkillsUnavailable: scannerText('The ~62 installer ~03 loaded; ~06 window. The ~15.'),
  // The conversation's notices (they were English literals in the controller).
  notSignedInReason: scannerText('Sign in before sending a ~08.'),
  noWorkspaceReason: scannerText('Open a folder first; Muse works inside a ~05.'),
  nothingToSendReason: scannerText('Type a ~08 or attach an image first.'),
  nothingToCompact: 'Nothing to compact yet.',
  // {reason}: the backend's own id for why, such as `noop`.
  nothingToCompactReason: 'Nothing to compact ({reason}).',
  compactionFailed: 'Compaction failed',
  answerNotAccepted: scannerText('The answer ~52 accepted'),
  outputLoadFailed: scannerText('~16 load the output'),
  outputLoadRetry: scannerText(
    '~01 may be busy: collapse and expand the row to ~53. Further failures go to the log only.',
  ),
  editReviewFailed: scannerText('~16 review the edit'),
  modelSwitchFailed: scannerText('~16 switch model'),
  effortNotApplied: scannerText('Reasoning effort ~03 applied'),
  permissionModeNotApplied: scannerText('~16 apply the ~13'),
  permissionModeChangeFailed: scannerText('~16 change the ~13'),
  // {action}: the panel's id for a host command, such as `openSettings`.
  hostActionFailed: '{action} failed',
  contributorResumeFallbackTo: scannerText(
    'The resumed ~00 was on a contributor-tier model; it now uses {model}.',
  ),
  // Edit review's outcomes, per file (M5).
  editRevertedPath: 'Reverted {path}.',
  editCreatedRemovedPath: '{path}: Moved to the trash (Muse created it).',
  modelApiNeedsFolder: scannerText('Open a folder first; the ~04 ~19 works inside a ~05.'),
  modelApiBundleUnavailable: scannerText('The ~04 ~19 ~03 loaded; ~06 window. The ~15.'),
  // The same in the ACP agent (D62), whose package ships the bundle.
  acpModelApiBundleUnavailable: scannerText(
    'The ~04 ~19 ~03 loaded; reinstall muse-spark-code-acp and restart ~46. The agent’s ~15.',
  ),
  // Why the Muse Code CLI was not found, on the sign-in page and in warnings.
  cliNotFound: scannerText('~01 is not ~31 in any known location.'),
  cliPathNotAbsolute: scannerText('~76.museBinaryPath must be an absolute path.'),
  cliSearched: 'Searched: {paths}',
  // The ACP agent in other editors (M63, PLAN.md D61, D62): its sign-ins,
  // the key's commands, its errors and its help.
  acpAuthMuseCodeName: 'Sign in to Muse Code',
  acpAuthMuseCodeDetail: scannerText(
    'Runs ~01’s own sign-in in a terminal. Your Muse ~72 pays for the ~00s.',
  ),
  acpAuthKeyName: scannerText('Store a Meta ~04 key'),
  acpAuthKeyDetail: scannerText(
    'Reads your key in a terminal and keeps it ~12 computer’s credential store. The key is billed for the ~00s.',
  ),
  // {command}: the sign-in command, for a client that cannot run it itself.
  acpSignInByHand: scannerText('Run “{~18}” in a terminal, then ~53.'),
  acpMuseCodeSignedOut: scannerText('~01 is not signed in; sign in and ~53.'),
  acpNoStoredKey: scannerText('No Meta ~04 key is stored; store one and ~53.'),
  acpKeyPrompt: scannerText('Meta ~04 key (not shown as you type): '),
  // {store}: where the key lives (acpStoreNames).
  acpKeyStored: 'The key is stored in {store}.',
  acpKeyNotStored: scannerText('No key was entered, so ~75 was stored.'),
  acpKeyPresent: scannerText('A Meta ~04 key is stored in {store}.'),
  acpKeyAbsent: scannerText('No Meta ~04 key is stored.'),
  acpKeyCleared: scannerText('The Meta ~04 key was removed from this computer’s credential store.'),
  // {reason}: the operating system's own error.
  acpStoreUnavailable: scannerText(
    'This computer’s credential store ~42 used ({reason}). On Linux ~46 needs a ~34, unlocked Secret Service, such as GNOME Keyring or KWallet.',
  ),
  acpStoreNames: {
    windows: 'Windows Credential Manager',
    macos: 'the macOS Keychain',
    linux: 'the Secret Service keyring',
  },
  acpNoModels: scannerText('The ~19 offers no model this agent may use.'),
  acpPromptBusy: scannerText('A prompt is ~79 ~34 ~12 ~17.'),
  acpQuestionFormMessage: 'Muse has a question for you.',
  acpQuestionAsked: scannerText(
    'Muse has a question; this editor cannot show it as a form, so answer in ~73 ~08:',
  ),
  acpUnknownArgument: 'Unknown argument: {argument}',
  // {argument}: the paid feature's flag as typed.
  acpPaidNeedsModelApi: scannerText(
    '{argument} needs --~19 modelApi: paid features bill a ~04 key.',
  ),
  // {command}: the executable's name. The options and values stay as typed.
  acpUsage: [
    'Usage:',
    scannerText(
      '  {~18} [options]              Serve the Agent Client Protocol on stdin and stdout',
    ),
    scannerText('  {~18} [options] login        Sign in to ~01 ~12 terminal'),
    scannerText('  {~18} auth set|status|clear  Store, check or remove the Meta ~04 key'),
    scannerText('  {~18} exec [options] <prompt>  Run one headless turn'),
    scannerText(
      '  {~18} scan-secrets <file> [--key-stdin]  Count likely secrets in one file (prints only the number)',
    ),
    scannerText('  {~18} legal [options]  Run the read-only legal scan (no ~19, no sign-in)'),
    'Options:',
    scannerText('  --~19 museCode|modelApi      Who pays: ~01 (the default) or the ~04 key'),
    scannerText('  --trust-~05                Load the folder’s rules, skills and memory'),
    scannerText('  --muse-binary <path>             The ~01 CLI to run'),
    scannerText('  --shell-~91 auto|muse|off    ~01’s shell ~91'),
    scannerText('  --allow-dangerously-skip-~54  Offer the Bypass ~54 mode'),
    '  --allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    scannerText(
      '  --web-search                     Offer paid web search (~04 ~19; its price is asked first)',
    ),
    scannerText(
      '  --image-generation               Offer paid image generation (~04 ~19; its price is asked first)',
    ),
    '  --verbose                        Log every detail on stderr',
    '  --help, --version',
  ].join('\n'),
  // M80 (PLAN.md D65): the headless exec and scan-secrets commands.
  execBudgetRequired: scannerText('~04 requires --max-budget-usd.'),
  execNumberInvalid: 'Invalid number or limit; the USD budget accepts at most six decimal places.',
  execTrustRefused: scannerText('Headless runs refuse ~05 trust and bypass ~54.'),
  execModeRefused: 'Headless runs permit only plan or acceptEdits.',
  execWebSearchUnbounded: scannerText('Hosted web search has no bounded allowance and is ~92.'),
  execPaidNeedsEdits: 'Image generation requires acceptEdits.',
  execModelApiOnly: scannerText('These options require the ~04 ~19.'),
  execMuseCodeOnly: scannerText('These options require the ~01 ~19.'),
  execModelUnpriced: 'This model has no known tariff.',
  execPromptMissing: 'Provide one nonempty prompt.',
  execPromptTwice: 'Choose exactly one prompt source.',
  execStdinTwice: 'Prompt and key cannot both use stdin.',
  execKeyStdinTerminal: 'Read the key from a pipe, not a terminal.',
  execKeyMissing: scannerText('No valid ~04 key was provided.'),
  execKeyTooLong: scannerText('The key ~56 byte limit.'),
  execFileUnreadable: scannerText('The input file ~42 read.'),
  execFileTooLarge: scannerText('The input ~56 byte limit.'),
  execTooManyChunks: scannerText('The input ~56 chunk limit.'),
  execUnknownModel: scannerText('This model ~47 ~32 run.'),
  execEffortUnavailable: scannerText('This effort ~47 ~32 model.'),
  execTimedOut: 'The run reached its deadline.',
  execBudgetRefused: scannerText('The next ~40 ~56 remaining budget.'),
  execBudgetMinimum: 'This run requires at least {minimum}.',
  execBudgetBreach: 'Observed accounting exceeded its reservation.',
  execIncomplete: scannerText('The response ~41 complete.'),
  execDeniedStop: scannerText('An ~36 denial ~37 this run.'),
  execInterrupted: 'The run was interrupted.',
  execOutputStalled: 'Output closed or stalled.',
  execRequestShape: scannerText('The ~40 shape is not permitted.'),
  execAccountingInvalid: 'Response accounting is invalid.',
  execAccountingUnverified: scannerText('Response accounting ~03 verified.'),
  execMessageWithheld: scannerText('~08 withheld: the response ~41 complete'),
  execStatus: {
    completed: 'Completed',
    incomplete: 'Incomplete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    timeout: 'Timed out',
    budget_exceeded: 'Budget exceeded',
    request_cap: 'Request cap reached',
    denied: 'Denied',
    auth_required: 'Authentication required',
    backend_unavailable: 'Backend unavailable',
    internal: 'Internal error',
    accounting_unverified: 'Accounting unverified',
  },
  execTooManyFiles: forms({
    one: 'At most {count} input file is allowed.',
    other: 'At most {count} input files are allowed.',
  }),
  execRequestCapReached: forms({
    one: scannerText('The ~40 cap of {count} attempt was reached.'),
    other: scannerText('The ~40 cap of {count} ~64 was reached.'),
  }),
  execScanMatches: forms({
    one: '{count} secret match',
    other: '{count} secret matches',
  }),
  execUsage: 'exec [options] <prompt> | exec [options] --prompt-file <path> | exec [options] -',
  execScanUsage: 'scan-secrets <file> [--key-stdin]',
  execSummary: scannerText(
    '{status}; ~40s {~40s}; settled {settled}; uncertain {uncertain}; image ~64 {imageAttempts}; returned {imagesReturned}; uncertain images {imagesUncertain}',
  ),
  execSummaryUpperBound: scannerText(
    '{status}; ~40s {~40s}; settled {settled}; uncertain {uncertain}; image ~64 {imageAttempts}; returned {imagesReturned}; uncertain images {imagesUncertain}; Cost is an upper bound.',
  ),
  // The exported Markdown's own words (M30); what was said and run is copied as it was.
  exportSessionLine: 'Session: `{id}`',
  exportBackendLine: 'Backend: {backend}',
  exportModelLine: 'Model: {model}',
  // {time}: ISO 8601.
  exportTimeLine: 'Exported: {time}',
  exportUserHeading: 'You',
  exportAgentHeading: 'Muse',
  exportThinkingHeading: 'Thinking',
  // {tool}: the tool's own name, as the model called it.
  exportToolHeading: 'Tool: {tool}',
  exportToolNoName: 'tool',
  exportShellHeading: 'Shell command',
  exportSubagentHeading: 'Subagent: {role}',
  exportSubagentNoRole: 'agent',
  exportArgumentsLabel: 'Arguments:',
  exportOutputLabel: 'Output:',
  exportOutputStored: forms({
    one: scannerText('The output ({count} byte) is stored by the ~19 and not included.'),
    other: scannerText('The output ({count} bytes) is stored by the ~19 and not included.'),
  }),
  exportFilesChanged: forms({
    one: 'Changed {count} file: +{added} −{removed}.',
    other: 'Changed {count} files: +{added} −{removed}.',
  }),
  exportFailure: 'Failed: {reason}',
  exportImagesAttached: forms({
    one: '{count} image attached.',
    other: '{count} images attached.',
  }),
  // Alt+K, "Insert @-mention reference".
  insertReferenceNoEditor: 'Open a file in an editor to insert a reference to it.',
  insertReferencePanelOpened: scannerText(
    'Opened the ~49 panel. Press Alt+K again to insert the reference.',
  ),
  // Names the webview gave its controls outside the table before M40.
  transcriptLabel: 'Conversation',
  modelPillLabel: 'Model',
  menuCurrent: 'Current',
  toggleOn: 'On',
  toggleOff: 'Off',
  // The Modes menu's header hint; `{keys}` is shown as a key cap.
  modesSwitchHint: '{keys} to switch',
  modelContextWindow: '{tokens} context',
  removeAttachmentNamed: 'Remove {name}',
  announceApprovalFor: 'Approval needed for {tool}',
  // A failed turn's card when the backend gave no reason.
  turnFailed: 'The turn failed.',
  turnRetrying: 'Attempt {attempt}/{maxAttempts} failed ({reason}); retrying in {seconds} s.',
  // The subscription window's length (English writes the unit singular here).
  usageWindowHours: forms({ one: '{count}-hour window', other: '{count}-hour window' }),
  usageWindowMinutes: forms({ one: '{count}-minute window', other: '{count}-minute window' }),
  // The spinner line's verbs, cycled while a turn runs.
  statusVerbs: {
    thinking: 'Thinking…',
    working: 'Working…',
    calculating: 'Calculating…',
    composing: 'Composing…',
  },
  // The getting-started tips (M8): the default keybindings, named for both
  // platforms since the webview does not know which one it runs on (M26,
  // D29), and what each does.
  onboardingShortcuts: {
    focus: 'Ctrl+Esc (Ctrl+Alt+Esc on Windows)',
    palette: '/',
    cycleMode: 'Shift+Tab',
    mentionSelection: 'Alt+K',
    mentionFile: '@',
    newTab: 'Ctrl+Shift+Esc (Ctrl+Shift+Alt+Esc on Windows)',
    dictation: 'Ctrl+D',
    // M46.
    shell: '!',
    moveToBackground: 'Ctrl+B',
  },
  onboardingTips: {
    focus: 'focuses or unfocuses Muse from anywhere in VS Code',
    palette: scannerText('opens the actions palette: model, effort, ~13, history'),
    cycleMode: scannerText('cycles the ~13 while the composer has focus'),
    mentionSelection: 'inserts an @-mention of the editor selection',
    mentionFile: 'mentions a file; drag files or paste images to attach them',
    newTab: scannerText('opens a ~00 in a new editor tab'),
    dictation: 'records your voice into the composer (tap to toggle, hold to talk)',
    shell: scannerText(
      'at the start of a ~08 runs it as a shell ~18 in the ~05; Muse sees what it printed',
    ),
    moveToBackground: scannerText('moves a ~34 ~18 to the ~43, so Muse carries on'),
  },
  // M26 (PLAN.md D29): dictation in a remote window, and a macOS helper that
  // ends before it is ready.
  dictationUnavailableRemote: scannerText(
    '~59 ~47 in a remote window (SSH, WSL, a container, a tunnel or a codespace): the ~25 runs on the remote machine, which cannot hear this computer’s microphone. Open the folder in a local window to dictate.',
  ),
  dictationDarwinEarlyExit: scannerText(
    'macOS ended the dictation helper before it was ready. After a permission step, macOS ~92 that permission (to muse-dictate, or to the app that started it where the helper ~48 ask under its own name); with no step at all, macOS ~92 to run the helper itself, ~88 notarised. The README’s ~59 section explains both.',
  ),
  museLoginTerminalName: 'Muse Code sign-in',
  // Muse Code's documented exit codes (SDK `classifyExit`): what each means
  // for the user; whether restarting can help is MUSE_EXIT_PERSISTENT_CODES.
  museExitMeanings: {
    0: 'Muse Code stopped',
    1: scannerText('~01 failed with an unhandled error'),
    2: scannerText('~01 rejected its ~18 line (a usage error)'),
    3: scannerText('~01 ~92 its configuration; check its ~20.json and ~76.environmentVariables'),
    4: scannerText('another ~01 client holds this ~17; it frees once that client exits'),
    5: scannerText('this ~01 build ~11 serve the SDK surface the ~25 uses; update ~01'),
  },
  museExitedWithCode: scannerText('~01 exited with code {code}'),
  museExitMeaning: '{meaning} (exit code {code})',
  museStoppedBySignal: scannerText('~01 was ~37 by {signal}'),
  museUnknownSignal: 'an unknown signal',
  // The paid Model API features (M33–M35, PLAN.md D30): opt in and loud.
  // {price} is a dollar amount in the display language's money format.
  paidWebSearchName: 'Web search',
  paidImageGenerationName: 'Images',
  paidVoiceName: 'Muse Voice',
  paidScheduledName: 'Scheduled prompts',
  paidSubagentsName: 'Subagents',
  paidSubagentRates: scannerText(
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; up to {limit} ~40s per task, including retries.',
  ),
  paidSubagentTaskTitle: 'Approve paid task for {role}?',
  paidSubagentTaskDetail: scannerText(
    '{objective}\n\n{price}\n\n~63 ~04 key. ~33. Other enabled paid tools are charged separately. Allow once covers this task only.',
  ),
  // The popup before each paid use (M58): its buttons, and the two uses that
  // have no popup of their own. "Allow once" is `allowOnce`.
  paidAllowAlways: scannerText('Allow always ~12 ~05'),
  paidDeny: 'Deny',
  paidUseWebSearchTitle: scannerText('Let Muse search the web ~32 prompt?'),
  paidUseWebSearchDetail: scannerText(
    'Muse may search the web while it answers. Each search is ~24 ~04 key at {price}, on top of the tokens its results add. Deny sends the prompt without web search.',
  ),
  paidUseVoiceTitle: scannerText('Record with ~22?'),
  paidUseVoiceDetail: scannerText(
    '~22 transcribes this recording, ~24 ~04 key at {price}. Deny leaves the microphone off.',
  ),
  paidWebSearchPrice: '{price} per 1,000 searches',
  paidImagePrice: '{price} per image',
  paidVoicePrice: '{price} per hour of audio',
  paidScheduledPrice: '{input}/1M input, {cached}/1M cached input, {output}/1M output tokens',
  // The confirmation shown when a paid feature is turned on; {feature} is its name.
  paidConfirmTitle: 'Turn on {feature}?',
  paidConfirmWebSearch: scannerText(
    'The model may search the web while it answers. Each search is ~24 ~04 key at {price}, on top of the tokens its results add. Each prompt asks first, ~45 web search always ~12 ~05. Used on the ~04 ~19 only.',
  ),
  paidConfirmImage: scannerText(
    'The model may create image files in the ~05, or edit ~05 images into new ones. Each image is ~24 ~04 key at {price}, and you are asked before every one, in every ~13, ~45 images always ~12 ~05. Used on the ~04 ~19, and on the ~01 ~19 while a key is stored (never billed to the ~72).',
  ),
  paidConfirmVoice: scannerText(
    'The microphone will send what you record to Meta’s ~22 Transcribe instead of your computer’s own recogniser, ~24 ~04 key at {price}. Each recording asks first, ~45 ~22 always ~12 ~05. Used on the ~04 ~19, and on the ~01 ~19 while a key is stored.',
  ),
  paidConfirmScheduled: scannerText(
    'A due ~28 waits for you to run it. Each run asks before any ~04 call, ~45 scheduled runs always ~12 ~05. {price}. ~63 ~04 key; total varies with tokens used.',
  ),
  paidConfirmSubagents: scannerText(
    'Child agents make additional ~40s ~24 ~04 key. {price} Each new task asks for ~36 in every ~13, including Bypass, ~45 subagents always ~12 ~05. ~33; other paid tools cost extra. ~04 ~19 only.',
  ),
  paidBestOfNName: 'Best of N',
  paidBestOfNRates: scannerText(
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; {~64} ~64 with up to {limit} ~40s each, including retries.',
  ),
  paidBestOfNTitle: scannerText('Run {~64} paid ~64?'),
  paidBestOfNDetail: scannerText(
    '{prompt}\n\n{price}\n\n~63 ~04 key. ~33. Allow once covers this run only.',
  ),
  paidConfirmBestOfN: scannerText(
    'The same prompt runs in separate worktrees, each ~24 ~04 key. {price} Each run asks for ~36 in every ~13, including Bypass, ~45 best-of-N always ~12 ~05. ~33; other paid tools cost extra. ~04 ~19 only.',
  ),
  usagePaidBestOfNAttempts: forms({ one: '{count} attempt', other: '{count} attempts' }),
  usagePaidBestOfNIncluded: 'Reported token estimate: {cost}',
  // The session board (M77, PLAN.md D49).
  boardTitle: 'Session board',
  boardUnavailable: scannerText(
    'The ~17 board and best-of-N ~03 loaded. Reinstall the ~25 and ~53.',
  ),
  boardEmpty: scannerText('No ~00s yet. Send a ~08 to start one.'),
  boardStatusRunning: 'Running',
  boardStatusIdle: 'Idle',
  boardAwaitingApproval: forms({
    one: scannerText('{count} ~36 waiting'),
    other: scannerText('{count} ~36s waiting'),
  }),
  boardChanges: forms({ one: '{count} changed file', other: scannerText('{count} ~14 files') }),
  boardChangesUnknown: 'changes unknown',
  boardStartBestOfN: 'Best of N…',
  // Best-of-N on the Model API (M77, PLAN.md D49).
  bestOfNTitle: 'Best of N',
  bestOfNPromptLabel: 'Prompt',
  bestOfNAttemptsLabel: 'Attempts',
  bestOfNCeilingLabel: 'Requests per attempt',
  bestOfNStart: 'Start',
  bestOfNCancelRun: 'Cancel run',
  bestOfNTake: 'Apply and stage',
  bestOfNTakeExplanation:
    'Apply and stage exactly the selected preview. No commit is created; ignored files are excluded.',
  bestOfNContextChanged: scannerText('The account, ~00 or run ~14. Start a new run.'),
  bestOfNTargetChanged: scannerText(
    'The checkout ~14, has unsaved edits, or contains protected or linked targets. ~60 applied.',
  ),
  bestOfNBudgetUnavailable: scannerText(
    'Best-of-N cannot start under a ~17 budget until its ~64 share the originating budget.',
  ),
  bestOfNGitProgramsUnavailable:
    'Best-of-N requires Git 2.36 or newer and cannot run with configured filter or hook programs.',
  bestOfNLeftPane: 'Left',
  bestOfNRightPane: 'Right',
  bestOfNStatusQueued: 'Queued',
  bestOfNStatusRunning: 'Running',
  bestOfNStatusCompleted: 'Done',
  bestOfNStatusFailed: 'Failed',
  bestOfNStatusCancelled: 'Cancelled',
  bestOfNRunStatusRunning: 'Running…',
  bestOfNRunStatusCompleted: 'Done',
  bestOfNRunStatusFailed: 'Failed',
  bestOfNRunStatusCancelled: 'Cancelled',
  bestOfNCeilingReached: scannerText('~37 at the ~40 ceiling'),
  bestOfNRequests: forms({ one: '{count} request', other: '{count} requests' }),
  bestOfNApprovalsDenied: forms({
    one: scannerText('{count} ~36 declined'),
    other: scannerText('{count} ~36s declined'),
  }),
  bestOfNAttemptFailed: 'Failed: {reason}',
  bestOfNTakenMark: 'Took {branch}',
  bestOfNDiffClipped: 'Diff clipped.',
  bestOfNInvalidPrompt: scannerText('Describe what the ~64 should do.'),
  bestOfNInvalidRequest: 'That best-of-N run is outside the attempt or ceiling bounds.',
  bestOfNInvalidAttempts: 'Attempts must be between {min} and {max}.',
  bestOfNInvalidCeiling: 'Requests per attempt must be between {min} and {max}.',
  bestOfNNeedsTrust: scannerText(
    'Best-of-N needs a trusted ~05: worktrees run git, which ~26 forbids.',
  ),
  bestOfNModelApiOnly: scannerText(
    'Best-of-N runs on the ~04 ~19 only; each attempt is billed to the key, never to the ~72.',
  ),
  bestOfNPaidOff: 'Best-of-N is off. Enable it and accept the price before starting a run.',
  bestOfNNoWorkspace: 'Best-of-N needs an open folder.',
  bestOfNTariffUnknown: scannerText(
    'No verified price is available ~32 model. The run cannot start.',
  ),
  bestOfNConsentDeclined: scannerText('The paid run ~52 approved.'),
  bestOfNAlreadyRunning: scannerText('A best-of-N run is ~79 going ~12 window.'),
  bestOfNAlreadyTaken: scannerText('This run ~79 took {branch}.'),
  bestOfNNoRun: 'There is no best-of-N run.',
  bestOfNUnknownAttempt: 'That attempt is not part of this run.',
  bestOfNAttemptNotDone: 'Only a finished attempt can be taken.',
  bestOfNWorktreeFailed: scannerText('~16 create the attempt worktrees: {reason}'),
  bestOfNTaken: scannerText('Applied and staged ~83 from {branch}.'),
  bestOfNTakeFailed: scannerText(
    '~16 apply and stage {branch}. Check the checkout before retrying: {reason}',
  ),
  paidConfirmAccept: 'Turn on',
  // The composer's badge while a paid feature is on; {features} lists their names.
  paidBadge: 'Paid: {features}',
  paidBadgeTitle: scannerText(
    '~63 ~04 key: {prices}. Click ~32 window’s tally in Account & usage.',
  ),
  // A paid call's row in the transcript.
  paidRowBadge: 'paid',
  paidRowTitle: scannerText('~63 ~04 key: {price}'),
  // The palette's toggles (Model API backend only); {feature} is the name.
  paidToggleLabel: '{feature} (paid)',
  // The usage dialog's tally.
  usagePaidHeading: scannerText('Paid features ~12 window'),
  usagePaidOn: 'on',
  usagePaidOff: 'off',
  // M58: a feature that no longer asks in this workspace; {features} lists names.
  usagePaidOnAlways: scannerText('on, allowed always ~12 ~05'),
  usagePaidAlwaysNote: scannerText('Allowed always ~12 ~05, ~23: {features}.'),
  usagePaidAskAgain: 'Ask again every time',
  usagePaidSearches: forms({ one: '{count} search', other: '{count} searches' }),
  usagePaidImages: forms({ one: '{count} image', other: '{count} images' }),
  usagePaidAudio: '{duration} of audio',
  usagePaidSubagentRequests: forms({
    one: scannerText('{count} child ~40'),
    other: scannerText('{count} child ~40s'),
  }),
  usagePaidSubagentUnknown: forms({
    one: scannerText('{count} ~40 has no reported cost yet'),
    other: scannerText('{count} ~40s have no reported cost yet'),
  }),
  usagePaidSubagentSubset: scannerText(
    'Reported child costs are included in their parent ~00s’ token estimates. They ~58 added to the extra-feature total. Requests without reported usage may still be billed.',
  ),
  usagePaidExtraTotal: 'Estimated extra-feature total',
  usagePaidSubagentReported: 'Reported token estimate: {cost}',
  usagePaidTotal: 'Estimated paid total',
  usagePaidScheduled: forms({ one: '{count} scheduled run', other: '{count} scheduled runs' }),
  usageScheduledIncluded: 'token cost included above',
  usagePaidNote: scannerText(
    'Estimated at Meta’s published prices, read on {date}, ~32 window since it opened; the dev.meta.ai dashboard is the bill.',
  ),
  subagentPaidOff:
    'Paid subagents are off. Enable them and accept the price before starting a child task.',
  agentToolNotOffered: scannerText(
    'This tool is not ~12 agent’s allowlist. Use only the tools offered in its instructions.',
  ),
  // A custom agent refused because a folder or file of higher precedence did
  // not load (M76 review); {path} is that folder or file.
  agentUnloaded: scannerText(
    'The agent “{id}” ~41 start: {path} ~03 loaded, and a definition there would take precedence. Fix or remove it, then start a new ~00.',
  ),
  subagentConsentDeclined: scannerText('The paid child task ~52 approved.'),
  subagentContributorBlocked: scannerText(
    'The custom agent names a contributor-tier model, which cannot run while this ~05 is confidential (~76.confidentialWorkspace).',
  ),
  subagentRequestLimit: scannerText(
    'The child task reached its approved limit of {limit} ~40s, including retries.',
  ),
  subagentKeyChanged: scannerText(
    'The ~04 key ~14 after ~36. Approve a new child task to continue.',
  ),
  subagentModelChanged: scannerText(
    'The model ~14 after ~36. Approve a new child task to continue.',
  ),
  subagentGoalEnded: scannerText(
    'The originating goal is ~55 active. The child task cannot make another ~40.',
  ),
  subagentTariffUnknown: scannerText(
    'No verified price is available ~32 model. The child task cannot start.',
  ),
  subagentPlanMode: 'Plan mode refuses paid child tasks; switch mode and approve a new task.',
  subagentWebSearchOff: scannerText('Web search was turned off ~85 child ~40; no ~40 was sent.'),
  webSearchFailed: 'The search failed',
  // Under a reply that cites web pages (M33).
  citationsHeading: 'Sources',
  // The microphone while Muse Voice is its engine (M35); {price} per hour of audio.
  dictationPaidLabel: scannerText('Record voice with ~22 (paid)'),
  dictationPaidTitle: scannerText(
    '~22, paid: {price}, ~24 ~04 key. Tap or hold to record (Ctrl+D)',
  ),
  // Why Muse Voice cannot record or transcribe.
  museVoiceNoKey: scannerText('~22 needs a ~04 key; sign in with one first.'),
  museVoiceNoAnswer: scannerText('~22 ~41 answer; check the connection and ~53.'),
  museVoiceNoFinal: scannerText('~22 ~41 send the transcript in time; ~53.'),
  museVoiceMalformed: scannerText(
    '~22 sent something that is not JSON, so the recording was dropped.',
  ),
  museVoiceRefused: scannerText('~22 ~92 the recording'),
  museVoiceRateLimited: scannerText('~22 is rate-limited ~32 key; wait a moment and ~53.'),
  // {code}: the WebSocket close code Meta sent.
  museVoiceClosed: scannerText('~22 closed the connection (code {code})'),
  museVoiceNoWebSocket: scannerText(
    '~22 needs WebSocket support in VS Code’s ~25 host, which this ~50 ~11 have.',
  ),
  museVoiceNoRecorder: scannerText(
    '~22 on Linux records with arecord (ALSA) or parec (PulseAudio); neither was found on PATH.',
  ),
  // M56 (PLAN.md D43): why a Model API request never reached Meta; the
  // technical detail follows in parentheses.
  networkUntrustedCertificate:
    'The server’s certificate is not trusted. If your network inspects HTTPS, install its root certificate in the operating system’s certificate store (VS Code reads it while http.systemCertificates is on), or turn http.systemCertificates off and name the root’s file in NODE_EXTRA_CA_CERTS before VS Code starts.',
  networkProxyCredentials: scannerText(
    'The proxy asked for ~70 and ~41 accept the ones it got. Check http.proxy and http.proxyAuthorization, or the ~70 VS Code asked you for.',
  ),
  // {status}: the HTTP status the proxy answered with.
  networkProxyRefused: scannerText(
    'The proxy ~92 the connection (HTTP {status}). Check that it allows api.meta.ai.',
  ),
  networkUnreachable: scannerText(
    'Meta’s server ~03 reached. Check the network connection, and http.proxy and http.proxySupport if you use a proxy.',
  ),
  // The same three in the ACP agent (PLAN.md D62, Q66), where VS Code's
  // settings do not reach: they name the agent's environment variables.
  acpNetworkUntrustedCertificate: scannerText(
    'The server’s certificate is not trusted. If your network inspects HTTPS, name its root certificate’s file in NODE_EXTRA_CA_CERTS in ~46’s environment, or add --use-system-ca to NODE_OPTIONS there (Node 22.15 or later) to trust the operating system’s store, then restart ~46.',
  ),
  acpNetworkProxyCredentials: scannerText(
    'The proxy asked for ~70 and ~41 accept the ones it got. Check the user name and password in the proxy’s address in HTTPS_PROXY (http://user:password@host:port) in ~46’s environment, then restart ~46.',
  ),
  acpNetworkUnreachable: scannerText(
    'Meta’s server ~03 reached. Check the network connection. Behind a proxy, set HTTPS_PROXY and NODE_USE_ENV_PROXY=1 in ~46’s environment (Node 22.21 or later, or 24) and restart ~46: without NODE_USE_ENV_PROXY ~46 ~11 use the proxy.',
  ),
  // Muse Code refused a permission mode above the ceiling its configuration sets.
  approvalModeCeiling: scannerText(
    '~01’s configuration (its default permission profile, or a policy your administrator manages) ~11 allow this ~13. Choose a stricter one, such as Manual, and send again.',
  ),
  // M70 (PLAN.md D49): review. The palette's rows.
  groupReview: 'Review',
  reviewItem: '/review',
  reviewItemDetail: scannerText(
    'Review the uncommitted ~51, a branch, a commit, or what you describe',
  ),
  reviewUncommittedItem: scannerText('Review uncommitted ~51'),
  reviewUncommittedDetail: scannerText('Staged and unstaged ~51, against the last commit'),
  reviewBranchItem: 'Review this branch…',
  reviewBranchDetail: 'Every change since it left the base branch you pick',
  reviewCommitItem: 'Review a commit…',
  reviewCommitDetail: 'One of the latest commits, which you pick',
  reviewSecurityItem: 'Security review',
  reviewSecurityDetail: scannerText(
    'The uncommitted ~51, for injection, secrets, authentication and unsafe APIs',
  ),
  reviewChangesItem: scannerText('Review this ~00’s ~51'),
  reviewChangesDetail: 'Accept or revert each change, and comment on a line',
  // The base-branch and commit pickers.
  reviewPickBase: 'The branch to compare this one with',
  reviewPickCommit: 'The commit to review',
  reviewDefaultBase: 'default base',
  // Why a review did not start, on its card.
  reviewBusy: 'A review starts once the current turn has ended.',
  reviewRestricted: scannerText(
    'Reviewing git’s ~51 needs git, which ~11 run in ~26. Trust this ~05, or say what ~89: /review <what to look at>.',
  ),
  reviewNotRepository: scannerText(
    'This folder is not in a git ~84, so there are no git ~51 ~89. Say what ~89 instead: /review <what to look at>.',
  ),
  reviewNoChanges: scannerText('There are no ~51 ~89.'),
  reviewOnlyPrivate: scannerText(
    'Only files that may hold secrets ~14 (environment files, keys, ~70), and they ~58 sent for review.',
  ),
  reviewNoBase: 'No base branch was found to compare with. Name one: /review branch <base>.',
  // {revision}: the branch or commit named after /review.
  reviewUnknownRevision: scannerText('Git ~11 know {revision} as a branch or commit.'),
  reviewNoCommits: scannerText('This ~84 has no commits ~89 yet.'),
  reviewGitFailed: scannerText('Git ~48 read the ~51 ~89.'),
  reviewCancelled: 'Review cancelled.',
  // The review's own module (dist/review.js) could not be loaded.
  reviewUnavailable: scannerText(
    'The review ~03 loaded, so no review can start; ~06 window. The ~15.',
  ),
  reviewInstructionsTooLong: scannerText(
    'What ~89 is too long for one review; say it more briefly.',
  ),
  // What went with a review, and the permission mode around a Muse Code review.
  reviewTruncatedNotice: scannerText(
    'The diff is long, so only its first part went with the review; the reviewer reads the rest of the ~14 files itself.',
  ),
  reviewPrivateLeftOut: forms({
    one: scannerText('{count} ~14 file that may hold secrets was named but not sent for review.'),
    other: scannerText(
      '{count} ~14 files that may hold secrets were named but not sent for review.',
    ),
  }),
  reviewPlanModeNotice: scannerText(
    'This review runs ~44, and the ~13 you had comes back when it ends. ~01 applies its own allow rules ~44, so a review there is not strictly read-only.',
  ),
  // {mode}: the permission mode's name.
  reviewModeRestored: scannerText('The review ended: the ~13 is {mode} again.'),
  reviewModeNotRestored: scannerText('The ~13 ~03 set back after the review, so the ~00 stays ~44'),
  reviewAlreadyReverted: scannerText('This change was ~79 reverted.'),
  // The review pane.
  reviewPaneTitle: scannerText('Changes ~12 ~00'),
  reviewPaneLoading: 'Reading the changes…',
  reviewPaneEmpty: scannerText('This ~00 has not ~14 any files.'),
  reviewPaneFiles: forms({ one: '{count} file', other: '{count} files' }),
  reviewPaneHunks: forms({ one: '{count} change', other: '{count} changes' }),
  reviewPaneAccepted: forms({ one: '{count} accepted', other: '{count} accepted' }),
  reviewPaneReverted: forms({ one: '{count} reverted', other: '{count} reverted' }),
  reviewPaneOmitted: forms({
    one: scannerText(
      '{count} edit is not listed here (too many to show, or its change ~03 read); its row in the transcript still opens it.',
    ),
    other: scannerText(
      '{count} edits ~58 listed here (too many to show, or their ~51 ~03 read); their rows in the transcript still open them.',
    ),
  }),
  // {index}: the change's number in its file; {start}, {end}: line numbers.
  reviewHunkLines: 'Change {index}, lines {start}–{end}',
  reviewHunkLine: 'Change {index}, line {start}',
  // {path}: the file; names each change's buttons for a screen reader.
  reviewHunkName: 'change {index} of {path}',
  reviewAccept: 'Accept',
  reviewAccepted: 'Accepted',
  reviewRevert: 'Revert',
  reviewReverting: 'Reverting…',
  reviewReverted: 'Reverted',
  reviewNotReverted: 'Not reverted',
  reviewComment: 'Comment on a line…',
  reviewCommentLine: 'Line',
  reviewCommentLabel: 'Comment',
  reviewCommentPlaceholder: scannerText('What should ~46 know or change here?'),
  reviewSendSteer: scannerText('Send to the ~34 turn'),
  reviewSendNext: scannerText('Send as the next ~08'),
  reviewCommentCancel: 'Cancel',
  // {line}: a line number; {text}: that line's code.
  reviewLineOption: 'Line {line}: {text}',
  reviewRemovedLineOption: 'Removed line {line}: {text}',
  reviewOpenFile: 'Open file',
  reviewCommentSent: scannerText('Comment sent to ~46'),
  // What the live region says when a change's Revert settles; {name} is reviewHunkName.
  reviewAnnounceReverted: '{name} reverted',
  reviewAnnounceNotReverted: '{name} not reverted: {reason}',
  // The findings list under a review's reply.
  reviewFindingsLabel: 'Review findings',
  reviewFindingsHeading: forms({ one: '{count} finding', other: '{count} findings' }),
  reviewNoFindings: scannerText('The review found ~75 to report.'),
  reviewSeverities: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
  },
  // {location}: a file and line, such as src/a.ts:12.
  reviewOpenFinding: 'Open {location}',
  // M78 (PLAN.md D49): command rules, permission profiles and the Auto
  // reviewer on the Model API backend. Why a card asks beyond the mode:
  approvalProfileNote: 'A permission profile is on. Calls outside its file rules ask.',
  codeIntelPolicyRefused: scannerText('File ~54 refuse this code intelligence operation.'),
  // A tool call the permission settings stopped allowing while it was in
  // progress: at its process, its write or its request, or once it was done.
  policyChangedRefused: scannerText(
    'The permission ~20 ~14 while this was in progress and ~55 allow it. It was ~92, and ~75 from it was sent to ~35.',
  ),
  // The same, for a call whose change was already written by then.
  policyChangedKeptWrite: scannerText(
    'The permission ~20 ~14 while this was in progress and ~55 allow it. Its change was ~79 written and stays; ~75 from it was sent to ~35.',
  ),
  approvalAskRuleNote: scannerText('Your ~18 rule asks about this ~18 every time.'),
  // {why}: the rule's own justification, as the user wrote it.
  approvalAskRuleWhy: scannerText('Your ~18 rule asks about this ~18 every time: {why}'),
  // Who answered a call no card was shown for (the row's "Decided" line).
  autoReviewerResolver: 'Auto reviewer',
  commandRuleResolver: 'Command rule',
  // The Auto reviewer's row and the card it leaves; {reason}: the reviewer's own words.
  autoReviewAllowed: 'Allowed: {reason}',
  autoReviewAsked: 'Asks you: {reason}',
  autoReviewerFailed: scannerText('The Au~89er ~48 answer, so you decide.'),
  autoReviewerUnreadable: scannerText('The Au~89er’s answer ~03 read, so you decide.'),
  autoReviewerPaused: scannerText(
    'The Au~89er is paused ~32 turn after repeated declines or failures, so you decide.',
  ),
  autoReviewerTripped: scannerText(
    'The Au~89er ~37 for the rest of this turn after repeated declines or failures. Every risky action asks you until you send ~73 ~08.',
  ),
  // The window's first review on Muse Code (M90, PLAN.md D69).
  museCodeReviewerNotice: scannerText(
    'On by default. In Auto on ~01, only ~36s for the ~34 turn that no rule settles are eligible: one short ~01 turn on your ~72 in a hidden Plan ~17. Protected writes, paid calls, child tasks, questions, replayed or escalated ~40s, ~82 subjects, ~40s without allow-once and ~17s shared by panels are never reviewed. A successful review may allow once; declines, failures, busy ~17s, timeouts or a tripped breaker show the ~36 card. Host exit recreates the side ~17. Turn it off with ~76.museCodeAutoReviewer.',
  ),
  // The paid feature (D48): its name, confirmation, popup and tally.
  paidAutoReviewerName: 'Auto reviewer',
  paidConfirmAutoReviewer: scannerText(
    'In Auto mode on the ~04 ~19, a separate model call judges each risky action that no rule settles, and runs it ~23 when it looks safe. It never allows a forbidden ~18, a ~18 your rules ask about, a protected write or a paid call, and when it declines or fails, you decide. Each review is ~24 ~04 key at the ~00 model’s token rates:\n{price}\nEvery review asks first, ~45 reviews always ~12 ~05.',
  ),
  // {tool}: the tool the reviewed call is for; {action}: its command line or arguments.
  paidUseAutoReviewerTitle: scannerText('Let the Au~89er judge this {tool} call?'),
  paidUseAutoReviewerDetail: scannerText(
    '{action}\n\nA separate call to {model} judges whether it may run ~23 you. ~63 ~04 key: {price}. Total varies with tokens used. Deny shows you the ~36 card instead.',
  ),
  usagePaidAutoReviews: forms({ one: '{count} review', other: '{count} reviews' }),
  // Problems in the permission settings, each said once in the conversation.
  // {setting}: the setting's name; {index}: the rule's place in it, from 1;
  // {pattern}: the rule's words; {detail}: the error, or the failing example.
  commandRuleInvalid: scannerText('{~74}: rule {index} ~90 and is not applied ({detail}).'),
  commandRuleInvalidKept: scannerText(
    '{~74}: rule {index} ({pattern}) ~90 ({detail}). It still asks or forbids by its pattern, since that can only tighten.',
  ),
  commandRuleExampleFailed: scannerText(
    '{~74}: allow rule {index} ({pattern}) ~11 do what its example “{detail}” says, so it is not applied.',
  ),
  commandRuleExampleFailedKept: scannerText(
    '{~74}: rule {index} ({pattern}) ~11 do what its example “{detail}” says. It still applies, since it can only tighten.',
  ),
  commandRuleAllowInRepository: scannerText(
    '{~74}: rule {index} ({pattern}) is an allow rule, and a ~84’s rules can only tighten, so it is not applied.',
  ),
  commandRuleAllowsEvaluator: scannerText(
    '{~74}: allow rule {index} ({pattern}) would allow a ~18 that runs text as code, so it is not applied.',
  ),
  commandRulesTooMany: scannerText(
    '{~74}: {detail} rules is more than are read; rule {index} and those after it ~58 applied.',
  ),
  permissionProfileUnknown: scannerText(
    '{~74}: no permission profile is named “{name}”. Until one is, every shell ~18 asks and file tools refuse every file.',
  ),
  permissionProfileInvalid: scannerText(
    '{~74}: the profile “{name}” ~90 ({detail}). Until it is fixed, every shell ~18 asks and ~61 tools refuse every file.',
  ),
  permissionProfileInvalidData: 'Invalid or unsupported profile data.',
  permissionGlobInvalid: scannerText(
    'The deny-read glob “{glob}” ~42 read ({detail}). Until it is fixed, ~61 tools refuse every file.',
  ),
  permissionRootInvalid: scannerText(
    '{~74}: the extra root “{root}” is not an absolute path, so it is not added.',
  ),
  permissionRepositoryInvalid: scannerText(
    '{~74}: the ~84’s rules ~58 valid ({detail}) and ~58 applied.',
  ),
  // M68 (PLAN.md D49): the verify loop's rows. {count}: the edited files'
  // errors or warnings.
  verifyErrors: forms({ one: '{count} error', other: '{count} errors' }),
  verifyWarnings: forms({ one: '{count} warning', other: '{count} warnings' }),
  verifyClean: 'No errors or warnings',
  // {count}: edited files whose problems were not read (no report in time, …).
  verifyUnchecked: forms({
    one: scannerText('{count} file ~02'),
    other: scannerText('{count} files ~02'),
  }),
  // {name}: a check's name from museSpark.checkCommands, as the user wrote it.
  checkOutcomes: {
    passed: '{name} passed',
    failed: '{name} failed',
    timedOut: '{name} timed out',
    cancelled: '{name} stopped',
    notRun: '{name} not run',
  },
  // Why a check or a then_run command did not run.
  checkSkips: {
    rejected: 'rejected',
    hookDenied: 'a hook denied it',
    refused: scannerText('the ~13 refuses shell ~18s'),
    restricted: scannerText('shell ~18s are off in ~26'),
    unsafePath: scannerText('a file name ~42 passed to it safely'),
    changed: scannerText('~61 ~14 after the edit'),
    stopped: scannerText('the checks ~37 after failing round after round'),
  },
  // An edit's then_run: the command it ran right after the edit.
  thenRunLabel: 'Then ran',
  // {reason}: one of checkSkips, with the user's or the hook's words after it.
  thenRunNotRun: 'Not run: {reason}',
  // After "a hook denied it": the hook rewrote the command into none.
  hookInputNoCommand: scannerText('The hook’s updated input names no ~18.'),
  thenRunTimedOut: 'Stopped at its time limit',
  // The command could not start or ended without an exit code.
  thenRunNoExitCode: 'Failed without an exit code',
  // The fix loop reached its limit. {count}: the failing rounds in a row.
  checksStoppedNotice: forms({
    one: scannerText(
      'The checks still failed after {count} round of fixes, so they will not run again automatically until ~73 ~08.',
    ),
    other: scannerText(
      'The checks still failed after {count} rounds of fixes in a row, so they will not run again automatically until ~73 ~08.',
    ),
  }),
  exportThenRunLabel: 'Then ran:',
  // {command}: the then_run command; {outcome}: why it did not run.
  exportThenRunSkipped: scannerText('then_run `{~18}`: {outcome}'),
  // The read-only legal scan (M97, PLAN.md D76): the report's title and
  // counts, the severity and category names, the uncertainty and fixability
  // markers, the disclaimer every surface shows, and why a scan is missing
  // or partial. {count} is a number; {checks} lists the incomplete checks;
  // {reason} and {evidence} are the scanner's own words.
  legalRegistryNotice: scannerText(
    'Before the first lookup: {hosts}. Only ~68 names and ~50s are sent over HTTPS; no source, paths or lockfile contents are uploaded. Turn off Legal Registry Lookups for offline scans.',
  ),
  legalRegistryOfflineUnknown: scannerText(
    'Offline: missing dependency ~07 findings remain ~82 because registry lookups are disabled or declined.',
  ),
  legalRegistryFact: scannerText('{name}@{~50}: the registry ~27 {~07}.'),
  legalRegistryRecommendation: scannerText(
    'Verify the original terms and ~09 ~69; registry ~21 ~11 prove rights.',
  ),
  legalRegistryMetadataOnly: scannerText(
    'Registry ~21 is supplemental; original ~07 terms and local incomplete findings still require review.',
  ),
  legalScanTitle: 'Legal scan',
  legalScanDisclaimer: scannerText('Not legal advice; for ~09 decisions consult a lawyer.'),
  legalScanEmpty: 'The scan completed with no findings.',
  legalFindingsCount: forms({
    one: '{count} finding',
    other: '{count} findings',
  }),
  legalFilesScanned: 'Files scanned: {count}',
  legalScanIncomplete: 'Incomplete: {checks}',
  legalScanFailed: 'The legal scan failed: {reason}',
  legalScanUnavailable: scannerText('The legal scanner ~03 loaded; ~06 window. The ~15.'),
  legalSeverities: {
    blocker: 'Blocker',
    'should-fix': 'Should fix',
    advice: 'Advice',
  },
  legalCategories: {
    license: 'License',
    copyrightHeader: 'Copyright header',
    spdxIdentifier: 'SPDX identifier',
    noticeFile: 'Notice file',
    dependencyLicense: 'Dependency license',
    distribution: 'Distribution',
    codeQualityHeader: 'Code quality header',
  },
  legalHeaderPolicies: {
    required: 'Required',
    optional: 'Optional',
    off: 'Off',
  },
  legalFixable: 'Fixable',
  legalNotFixable: 'Recommendation only',
  legalEvidenceLabel: 'Evidence: {evidence}',
  legalConfidenceLabel: 'Confidence: {confidence}',
  // `/legal` in the prompt and its palette row (M97, lane B): the command
  // reads the same in every language; the detail says what it does.
  legalScanItem: '/legal',
  legalCommandUsage: scannerText('Usage: /legal [~05-relative path …]. Options ~58 supported.'),
  legalScanItemDetail: scannerText('Scan the ~05 for licensing, attribution and header findings'),
  // Why a scan did not start, as a notice (lane B; lane W renders the report).
  legalScanBusy: 'A legal scan starts once the current turn has ended.',
  legalScanUntrusted: scannerText(
    'The legal scan reads the ~05, which ~26 ~11 allow. Trust this ~05 to use it.',
  ),
  // A scan on Muse Code holds a live conversation in Plan mode (M70's hold, D76).
  legalScanPlanModeNotice: scannerText(
    'This legal scan holds the ~00 ~44 while it reads the ~05, and the ~13 you had comes back when it ends.',
  ),
  // M97 lane R: the headless `legal` command's own lines. {distribution} is
  // the scanner's one-sentence assumption; {detail} is the registry
  // disclosure (hosts, queries, bytes); {path} stays as typed; {reason} is
  // the scanner's own words.
  legalDistributionLine: scannerText('Distribution: {~09}'),
  // {hosts} are the registries asked; the counts are pre-formatted numbers.
  legalRegistryLine:
    'Registry ({hosts}): {queried} queried, {found} found, {skipped} skipped, {bytes} received.',
  legalRegistryOff: scannerText(
    'Registry enrichment off. Rerun with --registry to enrich missing ~07s.',
  ),
  legalWroteFile: 'Legal scan report written to {path}.',
  legalFormatInvalid: 'The format must be text or json.',
  // {exclusions} lists the scanner's workspace-relative exclusion globs.
  legalExclusionsLine: 'Excluded: {exclusions}',
  legalScanNoDistribution: scannerText('The scan ~41 complete, so no ~09 was assumed.'),
  // Command syntax stays English (l10n/untranslated.json).
  legalUsage: 'legal [--format text|json] [--out <file>] [--registry]',
  // The selected-fix handoff (M97 lane W, PLAN.md D76): the report's
  // selection, preview and refusal words. {id} is a finding id, {count} a
  // number; every refusal names why no write happened.
  legalReportFindings: 'Legal findings',
  legalFixSelect: 'Fix {id}',
  legalSelectedCount: forms({ one: '{count} selected', other: '{count} selected' }),
  legalFixAllSafe: 'Fix all safe ones',
  legalPreviewFixes: 'Preview fixes',
  legalFixPreviewTitle: 'Fix preview',
  legalFixApply: 'Apply fixes',
  legalFixOwnership: scannerText(
    '~94 that these files are ~67-owned and that the ~07 and copyright in ~83 apply to them: {paths}',
  ),
  legalFixDenied: 'The edits were not approved.',
  legalExportMarkdown: 'Export Markdown…',
  legalFixFiles: 'Files to change',
  legalFixExcluded: 'Not included',
  legalFixReasonNotFixable: 'No safe fix; recommendation only.',
  legalFixReasonProjectLicense: scannerText('Project ~07 ~51 need separate confirmation.'),
  legalFixReasonUnknown: 'Not part of this scan.',
  legalFixReasonTooLarge: 'Too large to guard; fix it by hand.',
  legalFixNothingSelected:
    'Select at least one finding to fix, even in Bypass mode. Nothing is pre-authorized by the scan.',
  legalFixSeparateConfirm: scannerText('I separately confirm the ~67 ~07 change.'),
  legalFixRefusedPlan: scannerText('Fixes are ~92 ~44, which never writes.'),
  legalFixRefusedTrust: scannerText('Fixes are ~92 while the ~05 is untrusted.'),
  legalFixRefusedWorkspace: scannerText('The ~05 ~14 since ~83. Ask for a fresh preview.'),
  legalFixRefusedStale: scannerText('The ~78 ~14 since ~83. Run a fresh scan.'),
  legalFixRefusedExpired: 'The preview expired. Ask for a fresh preview.',
  legalFixRefusedUnavailable: scannerText('Applying fixes is unavailable ~12 build.'),
  legalFixRescanHint: 'Run a fresh scan to confirm what remains.',
  legalScanner: {
    m001: scannerText('compatibility reader over {v0}'),
    m002: scannerText(
      '{v0} is dual-~07d; {v1} is a clean choice beside {v2}. ~94 the chosen terms before shipping.',
    ),
    m003: scannerText('Record which ~07 branch the ~09 complies with.'),
    m004: scannerText(
      '{v0} ~27 {v1} as alternative copyleft terms; ~09 requires choosing and satisfying the applicable source and linking ~69.',
    ),
    m005: scannerText('~94 the chosen ~07 branch and its ~69 with a lawyer.'),
    m006: scannerText(
      '{v0} ships under {v1} while the ~67 ~27 {v2}: distributing the combination may oblige source disclosure of the combined work. This is a question, not a verdict.',
    ),
    m007: scannerText(
      '~94 with a lawyer whether this ~09 triggers the copyleft ~69, and on which code.',
    ),
    m008: scannerText('{v0} ~27 {v1} in development scope only.'),
    m009: scannerText(
      '~94 it never ships; a shipped strong-copyleft dependency may oblige source disclosure.',
    ),
    m010: scannerText(
      '{v0} ~27 {v1} with ~09 ~82: if this combination ships, source disclosure may be obliged.',
    ),
    m011: scannerText(
      'Establish whether the dependency ships, then confirm the ~69 with a lawyer.',
    ),
    m012: scannerText(
      '{v0} ~27 {v1}{v2}: file-level copyleft stays with its covered files, and LGPL linking needs its source and relinking terms.',
    ),
    m013: scannerText(
      'Keep covered files under their terms, preserve their notices, and confirm LGPL linkage ~78.',
    ),
    m014: scannerText(
      '{v0} ~27 {v1}{v2}: source-available or restricted terms, not an open-source grant. Recognition is not ~36.',
    ),
    m015: scannerText(
      'Review the terms against this exact ~09 with a lawyer; confirm a BUSL change date or Commons Clause scope where one applies.',
    ),
    m016: scannerText('{v0} ~27 {v1}, which this reader ~11 classify: confirm the terms by hand.'),
    m017: scannerText('Review the ~07 text against this ~09.'),
    m018: scannerText('{v0} ships under {v1} terms: no ~07 grant travels with it.'),
    m019: scannerText('~94 private ownership of this exact ~50, or remove it ~39 shipment.'),
    m020: scannerText('{v0} ~27 {v1} terms outside the shipped set.'),
    m021: scannerText(
      '~94 it never ships; a shipped proprietary dependency needs ownership proof.',
    ),
    m022: scannerText('~02: {v0} ~68 {v1}@{v2} has no ~07 ~78'),
    m023: scannerText('{v0} ~27 the ~07 {v1}, ~88 a well-formed SPDX expression: {v2}.'),
    m024: scannerText('Correct the declaration ~39 ~68 ~21, or confirm the terms by hand.'),
    m025: scannerText('{v0} ~27 the custom reference {v1}: its terms need a human read.'),
    m026: scannerText('~94 the referenced ~07 text and its compatibility with the ~09.'),
    m027: scannerText(
      '{v0} ~27 {v1}, a deprecated SPDX identifier form; a trailing + ~55 names which later ~50s apply.',
    ),
    m028: scannerText('Use the current -only or -or-later identifier the ~68 intends.'),
    m029: scannerText('{v0} ~27 the exception {v1}, ~88 on the SPDX exception list.'),
    m030: scannerText('~94 the exception text; an exception ~51 the analysis.'),
    m031: scannerText(
      'License ~78 conflict for {v0}: {v1}. No source silently settles the conflict.',
    ),
    m032: scannerText(
      'Review the original ~07 and ~57 together before deciding which terms apply.',
    ),
    m033: scannerText('~02: conflicting ~07 ~78 for {v0} needs human review'),
    m034: scannerText('{v0} ~31 at {v1}'),
    m035: scannerText('~02: artifact freshness is not established by file-name ~78 alone'),
    m036: scannerText('~02: bundle inputs are absent or stale against the ~05 inventory'),
    m037: scannerForms('~09 read from {v0} known bundle inputs'),
    m038: scannerText('source checkout, ~09 ~82: no bundle inputs or ~68 inventory ~78'),
    m039: scannerText(
      '~02: ~09 set ~82 (no bundle metafile or ~68 files ~78); shipped ~69 assume ~75 ships',
    ),
    m040: scannerText('~02: ~68 pattern count ~56 bounded inventory'),
    m041: scannerText('~02: ~68 files contains unsupported patterns; ~09 is approximate'),
    m042: scannerText(
      '~02: .vscodeignore pattern {v0} uses unsupported syntax, so the shipped set is approximate',
    ),
    m043: scannerText(
      '~02: ~68 inventories do not establish embedded bundle inputs or artifact freshness',
    ),
    m044: scannerText(
      '~09 approximated from ~68 files and .vscodeignore; unbuilt artifacts may differ',
    ),
    m045: scannerText('~02 ~31'),
    m046: scannerForms('{v0} dependencies may ship with no notice file present to attribute them.'),
    m047: scannerText('Add THIRD_PARTY_~29 covering the shipped set.'),
    m048: scannerText('{v0} may ship but no present notice file names it.'),
    m049: scannerText('Attribute the ~68 in THIRD_PARTY_~29.'),
    m050: scannerText('~02: {v0} has no readable NOTICE attribution'),
    m051: scannerText('~02 ~31 at {v0}'),
    m052: scannerText(
      '{v0} carries an upstream NOTICE file with no attribution in the present notices.',
    ),
    m053: scannerText('Preserve the applicable NOTICE attribution in THIRD_PARTY_~29.'),
    m054: scannerText('Refused path outside the ~05 or beyond its bounds'),
    m055: scannerText(
      '~02: complex REUSE patterns, precedence and ownership relationships; only complete exact-path annotations are honored',
    ),
    m056: scannerText('asset ~45 at {v0}'),
    m057: scannerText(
      '{v0} has no observed per-file provenance declaration; its filename alone cannot establish ownership or ~09 rights.',
    ),
    m058: scannerText(
      'Record the asset source, author and applicable terms ~77 in a sidecar or REUSE declaration.',
    ),
    m059: scannerText('~26 ~62 at {v0}'),
    m060: scannerText(
      '{v0} contains a source reference whose provenance and applicable terms need review; a reference alone ~11 prove copying or infringement.',
    ),
    m061: scannerText(
      'Verify the original source, author, date, ~07 and attribution for any copied material; keep legitimate upstream headers.',
    ),
    m062: scannerText('~02: copyright header checks are off by policy'),
    m063: scannerText('~02: {v0} is unreadable or binary header material'),
    m064: scannerText('~65 ~31 at {v0}'),
    m065: scannerText(
      '{v0} has no copyright line in its first lines, but the header policy requires one.',
    ),
    m066: scannerText('Add the ~67 copyright line ~77; never replace a third-party header.'),
    m067: scannerText('{v0} has no ~80 line, but the header policy requires one.'),
    m068: scannerText('Add the SPDX identifier matching the applicable ~07.'),
    m069: '{v0} has no {v1} in its first lines.',
    m070: scannerText('Add the ~67 copyright header for hygiene; the policy leaves it optional.'),
    m071: scannerText('{v0} has a copyright line, but {v1}.'),
    m072: 'Correct the date with the holder; an earlier year alone is never stale.',
    m073: scannerText('{v0} ~27 ~80 {v1}, which ~11 parse: {v2}.'),
    m074: scannerText(
      'Write the identifier as an SPDX expression (AND, OR and WITH in uppercase).',
    ),
    m075: scannerText('~94 the referenced text exists beside ~61 or in REUSE.toml.'),
    m076: scannerText('{v0} ~27 {v1}, a deprecated SPDX identifier form.'),
    m077: scannerText('Use the current identifier ~39 SPDX License List.'),
    m078: scannerText('{v0} carries distinct SPDX ~57 {v1} and {v2}.'),
    m079: scannerText(
      '~94 the applicable terms for each declaration; preserve legitimate upstream ~07s.',
    ),
    m080: scannerText('{v0} ~27 {v1}, outside the ~67 ~07s {v2}.'),
    m081: scannerText(
      '~94 ~61 carries third-party terms (keep its header) or correct the identifier.',
    ),
    m082: scannerText('~69 ~01 ~31 at {v0}'),
    m083: scannerText(
      'Write the ~07 as an SPDX expression (AND, OR and WITH in uppercase, parentheses where needed).',
    ),
    m084: scannerText(
      '~02: full SPDX text matching and modified terms; title and clause matching is heuristic',
    ),
    m085: scannerText('{v0} reads as no recognized ~07 text; its terms need a human read.'),
    m086: scannerText('~94 what ~07 ~61 grants and declare it in the manifest.'),
    m087: scannerText('{v0} points at {v1}, which is absent ~39 ~05.'),
    m088: scannerText('Add the referenced ~07 file or correct the manifest field.'),
    m089: scannerText(
      '{v0} marks the ~67 UNLICENSED: proprietary, all rights reserved by default.',
    ),
    m090: scannerText('Ship it only to its intended recipients; a public ~09 needs a ~07 grant.'),
    m091: scannerText('~67 ~07 reader at {v0} and {v1}'),
    m092: scannerText('{v0} ~27 {v1} but the ~07 file reads as {v2}.'),
    m093: scannerText(
      'Reconcile the two before shipping: fix the ~21 or replace the ~07 file, with explicit confirmation for a ~07 change.',
    ),
    m094: scannerText('~69 ~01 ~31'),
    m095: scannerText('The manifests disagree with no ~07 file to settle it: {v0}.'),
    m096: scannerText(
      'Reconcile the manifests before shipping, with explicit confirmation for a ~07 change.',
    ),
    m097: scannerText('The manifest ~27 terms but no root ~07 file was found.'),
    m098: scannerText('Add the applicable ~07 text ~77 before ~09.'),
    m099: scannerText('The README ~27 {v0} but the ~67 ~27 {v1}.'),
    m100: scannerText('Reconcile the README with the ~07 file and manifest before shipping.'),
    m101: scannerText(
      'The ~07 {v0} is declared only in the README; there is no ~07 file or manifest field.',
    ),
    m102: scannerText('Add a LICENSE file and a manifest ~07 field ~77.'),
    m103: scannerText(
      'No LICENSE file, manifest ~07 field or README declaration found: undistributed code is all rights reserved by default.',
    ),
    m104: scannerText(
      'Choose a ~07 with explicit confirmation and declare it in a LICENSE file and the manifest.',
    ),
    m105: scannerText(
      '{v0} carries ~07-like text the reader ~11 recognize: vendored code needs attribution in the notices.',
    ),
    m106: scannerText(
      '{v0} carries {v1} terms inside the ~05: vendored code needs attribution in the notices.',
    ),
    m107: scannerText('~94 the vendored code is attributed in THIRD_PARTY_~29.'),
    m108: scannerText('Unknown ~65 policy'),
    m109: 'Too many selected paths',
    m110: scannerText(
      '~02: assets, copied code provenance, proprietary terms and complete ~07-text matching require human review',
    ),
    m111: 'Legal scan cancelled',
    m112: scannerText('~14: elapsed time'),
    m113: scannerText('~02: {v0} ~42 read as text'),
    m114: scannerText('scan ~37 at limit: {v0} ~56 bounded text read budget'),
    m115: scannerForms('~02: the scan ~37 after reading {v0} files; {v1} more not read'),
    m116: scannerForms('~02: dependency ~78 bound reached; {v0} entries omitted'),
    m117: scannerText('~02: ~07 text for {v0} at {v1} is unrecognized'),
    m118: scannerText('~01 text ~31 at {v0}'),
    m119: forms({
      one: scannerText(
        'The ~09 set is ~82 and {v0} production dependencies exist: ~69 are read against an undistributed source checkout.',
      ),
      other: scannerText(
        'The ~09 set is ~82 and {v0} production dependencies exist: ~69 are read against an undistributed source checkout.',
      ),
    }),
    m120: scannerText('Supply bundle inputs or ~68 inventory ~78 so shipped ~69 are exact.'),
    m121: scannerText('~14: ~40 for {v0}'),
    m122: forms({
      one: scannerText(
        'report truncated: {v0} findings ~93 {v1}-finding bound; blockers and should-fix findings kept first',
      ),
      other: scannerText(
        'report truncated: {v0} findings ~93 {v1}-finding bound; blockers and should-fix findings kept first',
      ),
    }),
    m123: scannerForms('report truncated: {v0} generated exclusions ~93 bound'),
    m124: 'The scan built an invalid result: {v0}',
    m125: scannerText('~02: an ~78 field ~56 report bound and was truncated'),
    m126: scannerText('~51 character {v0}'),
    m127: scannerText('WITH must name a ~07 exception'),
    m128: scannerText('~51 end of the ~11'),
    m129: 'Missing closing parenthesis',
    m130: scannerText('Unexpected operator without a ~07 beside it'),
    m131: scannerText('Empty ~01 ~11'),
    m132: scannerText('Unexpected text after the expression'),
    m133: scannerText('License expression ~56 text bound'),
    m134: scannerText('License expression nesting ~56 bound'),
    m135: scannerText('Malformed ~01 ~15'),
    m136: scannerText('License expression alternatives exceed the bound'),
    m137: scannerText('Legal scan root is not a directory'),
    m138: scannerText('~02: {v0} is a link or escaped directory'),
    m139: scannerText(
      'scan ~37 at limit: directory-entry budget reached; remaining tree not enumerated',
    ),
    m140: scannerText('~02: {v0} ~14 during enumeration'),
    m141: scannerText('~02: {v0} is ~84 internals'),
    m142: scannerText('~00: {v0} is a link'),
    m143: scannerText('~02: {v0} is a special file'),
    m144: scannerText('~02: {v0} ~03 admitted'),
    m145: scannerText('~02: {v0} contains path crates whose ownership and resolved ~21 are ~82'),
    m146: scannerText('~02: {v0} contains inherited or nested Cargo ~57 not resolved statically'),
    m147: forms({
      one: scannerText(
        '~02: {v0} Cargo lock entries carry no ~07 ~21 in the lock and no vendored crate manifest covers them',
      ),
      other: scannerText(
        '~02: {v0} Cargo lock entries carry no ~07 ~21 in the lock and no vendored crate manifest covers them',
      ),
    }),
    m148: scannerForms('~02: {v0} Cargo ~10 in any Cargo.lock'),
    m149: scannerText('~02: no Cargo manifests or locks found'),
    m150: scannerText('~02: {v0} ~90 JSON, so its requirements and ~07 are ~82'),
    m151: scannerText('~02: {v0} ~90 JSON, so its locked ~50s are ~82'),
    m152: scannerText('~02: ~07 ~78 conflict for {v0} between {v1} and {v2}'),
    m153: scannerForms('~02: {v0} Composer requirements have no locked ~50 in any composer.lock'),
    m154: scannerForms('~02: {v0} Composer ~68s carry no ~07 ~21 in the lock or ~31 data'),
    m155: scannerText('~02: no composer.json, composer.lock or ~31.json found'),
    m156: scannerText(
      '~02: {v0} uses executable code, which never runs; only its static assignments are read',
    ),
    m157: scannerText(
      '~02: {v0} is read statically; computed Ruby ~21 and conditional assignments ~58 evaluated',
    ),
    m158: scannerForms('~02: {v0} gem requirements have no locked ~50 in any Gemfile.lock'),
    m159: scannerForms('~02: {v0} gems carry no ~07 ~21; present gem specifications ~30'),
    m160: scannerText('~02: no Gemfile, Gemfile.lock or gemspec files found'),
    m161: scannerText(
      '~02: Go replacement targets, tool-~68 module mapping and non-vendored transitive selection require review; checksums can include unused ~50s',
    ),
    m162: forms({
      one: scannerText(
        '~02: {v0} Go modules carry no ~07 ~21; checksums and module paths alone ~58 ~07s, so vendored ~07 text ~30',
      ),
      other: scannerText(
        '~02: {v0} Go modules carry no ~07 ~21; checksums and module paths alone ~58 ~07s, so vendored ~07 text ~30',
      ),
    }),
    m163: scannerForms('~02: {v0} Go tool ~10; their ~07s are ~82'),
    m164: scannerText('~02: no go.mod, go.sum or vendor/modules.txt found'),
    m165: scannerText('~02: ~07 ~21 conflict for {v0} between {v1} and {v2}: {v3} versus {v4}'),
    m166: scannerText(
      '~02: {v0} is read statically; executable logic, catalogs and computed ~57 ~58 evaluated',
    ),
    m167: scannerText(
      '~02: Maven transitive graph, parent properties and profiles ~58 resolved by static POM ~57',
    ),
    m168: scannerForms('~02: {v0} Maven/Gradle ~10 in any lockfile or catalog'),
    m169: scannerForms('~02: {v0} Maven/Gradle ~68s carry no ~07 ~21; present artifact POMs ~30'),
    m170: scannerText('~02: no POMs, Gradle ~57, locks or catalogs found'),
    m171: scannerText('~02: {v0} has unreadable npm lock ~21'),
    m172: scannerText('~02: {v0} uses an unsupported npm lock ~50'),
    m173: scannerText('~02: {v0} ~56 npm nested lock depth bound'),
    m174: forms({
      one: scannerText(
        '~02: {v0} npm lock entries in {v1} carry no ~07 ~21 and no ~31 ~68 data covers them',
      ),
      other: scannerText(
        '~02: {v0} npm lock entries in {v1} carry no ~07 ~21 and no ~31 ~68 data covers them',
      ),
    }),
    m175: scannerText('~02: {v0} has no readable Yarn ~68 entries'),
    m176: scannerForms('~02: {v0} records ~50s but no ~07 ~21 for {v1} ~68s; ~31 ~68 data ~30'),
    m177: scannerText(
      '~02: {v0} uses an unsupported pnpm lock ~50 or has no readable ~68s section',
    ),
    m178: scannerText('~02: ~07 ~78 conflict for {v0}@{v1} between {v2} and {v3}'),
    m179: scannerForms('~02: {v0} npm ~10 in any lockfile; their transitive ~07s are ~82'),
    m180: scannerText('~02: no npm manifests, locks or ~31 ~21 found'),
    m181: scannerText(
      '~02: NuGet conditional or dynamic ~67 ~57, ~50 ranges and multi-framework conflicts require review',
    ),
    m182: scannerForms('~02: {v0} NuGet ~10 in any lock, asset or central ~50 file'),
    m183: scannerForms('~02: {v0} NuGet ~68s carry no ~07 ~21; present .nuspec files ~30'),
    m184: scannerText('~02: no NuGet ~57, locks or asset files found'),
    m185: scannerText('~02: {v0} includes {v1}; arbitrary include names ~58 recursively resolved'),
    m186: scannerText('~02: {v0} includes {v1}, which is absent ~39 ~05'),
    m187: scannerText(
      '~02: {v0} contains a requirements option or editable source not resolved statically',
    ),
    m188: scannerForms('~02: {v0} requirement lines in {v1} use a form the reader ~11 parse'),
    m189: scannerText('~02: {v0} names no ~67, so its requirements are unattributed'),
    m190: scannerText('~02: {v0} has no readable ~68 stanzas'),
    m191: scannerForms('~02: {v0} records ~50s but no ~07 ~21 for {v1} ~68s; present ~09 ~21 ~30'),
    m192: scannerText('~02: ~31 ~21 ~50 differs for {v0}; locked ~07 ~82'),
    m193: scannerText(
      '~02: Python static ~57 do not establish complete transitive coverage without lock and ~31 ~21; dynamic build ~21 is never evaluated',
    ),
    m194: scannerForms('~02: {v0} Python ~68s have no matching ~07 ~21'),
    m195: scannerForms('~02: {v0} Python ~10; their transitive ~07s are ~82'),
    m196: scannerText('~02: no Python manifests, locks or ~09 ~21 found'),
    unknown: 'unknown',
    unresolved: 'unresolved',
    noLicense: 'no license',
    shipment: ' in the shipment',
    copyrightSpdxLines: scannerText('copyright or ~80 lines'),
    spdxLine: scannerText('an ~80 line'),
    copyrightLine: 'a copyright line',
    invalidYear: 'the year {value} is not a four-digit year',
    impossibleYear: 'the year {value} is impossible',
    reversedYears: 'the range {value} ends before it starts',
    selectedPaths: forms({ one: '{count} selected paths', other: '{count} selected paths' }),
    moreUnchecked: forms({
      one: scannerText('and {count} more unchecked items ~93 bound'),
      other: scannerText('and {count} more unchecked items ~93 bound'),
    }),
    declaration: scannerText('{file} ~27 {~07}'),
    licenseFile: 'a license file',
    bundleLoad: scannerText('{file} ~03 loaded'),
    bundleShape: '{file} has an unexpected shape',
    invalidResult: 'the scanner returned an invalid result',
  },
  legalScanAgain: 'Scan again',
}

/** The shape every table has: English's keys, with any language's plural forms. */
export type UiText = typeof EN
