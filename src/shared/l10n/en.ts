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
const ENGLISH_PHRASES = [
  'conversation',
  'Muse Code',
  'not checked',
  'could not be',
  'Model API',
  'requirements have no resolved version',
  'workspace',
  'license',
  'reinstall the extension and reload the',
  'distribution',
  'message',
  'would close the gap',
  'metadata',
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
  'billed to your',
  'Muse Voice',
  'without asking',
  'installed',
  'extension',
  'Restricted Mode',
  'requirements have no locked version in',
  'declares',
  'stopped',
  'scheduled prompt',
  'NOTICES or the equivalent notice file',
  'request',
  'for this',
  'Actual cost depends on tokens used',
  'running',
  'the model',
  'approval',
  'MCP servers',
  'from the',
  'did not',
  'cannot be',
  'background',
  'in Plan mode',
  'unless you allow',
  'the agent',
  'is not available',
  'could not',
  'Muse Spark',
  'project',
  'changes',
  'was not',
  'version',
  'try again',
  'subscription',
  'permissions',
  'no longer',
  'exceeds the',
  'declarations',
  'are not',
  'Voice dictation',
  'Nothing was',
  'the file',
  'packages carry no',
  'unknown',
  'package',
  'bundled skills',
  'Billed to your',
  'omitted past the',
  'evidence',
  'attempts',
  'The page',
  'while each file still holds exactly',
  'obligations',
  'credentials',
  'as they are',
  'your next',
  'setting',
  'reached',
  'nothing',
  'museSpark',
  'from verified ownership',
  'already',
  'SPDX-License-Identifier',
  'so none of it was read',
  'the preview',
  'repository',
  'expression',
  'before this',
  'MCP server',
  'The file',
  'which is not',
  'to review',
]
function expandText(encoded: string): string {
  let text = encoded
  for (let index = ENGLISH_PHRASES.length - 1; index >= 0; index -= 1) {
    text = text.split(`~${String(index).padStart(2, '0')}`).join(ENGLISH_PHRASES[index] ?? '')
  }
  return text
}

export const EN = {
  untitledConversation: 'Untitled',
  crashTitle: 'The panel hit an error',
  crashDetail: expandText('Reload rebuilds the panel; the ~00 is kept by the host.'),
  crashReload: 'Reload',
  // M25 (PLAN.md D28): webview and UI state.
  toolInterrupted: 'Interrupted',
  thoughtDone: 'Thought',
  quoteCopy: 'Copy',
  snapshotTooLong: expandText(
    'This ~00 was too long to keep in the panel across the reload; open it from History to see all of it.',
  ),
  linkOutsideWorkspace: expandText('Links to files outside the ~06 ~61 opened ~41 transcript.'),
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  // Windows binds Ctrl+Alt+Esc (Ctrl+Esc opens Start there; M26, D29).
  composerPlaceholder: 'ctrl esc (ctrl alt esc on Windows) to focus or unfocus Muse',
  // Shown while a turn runs: Enter then steers the running turn.
  composerQueuePlaceholder: expandText('Queue another ~10…'),
  composerLabel: 'Message Muse',
  connecting: expandText('Connecting to the ~27 host…'),
  notSignedIn: 'Not signed in',
  sendDisabledReason: expandText('Sign in to send ~10s'),
  stopTitle: 'Stop',
  signInTitle: expandText('Sign in to ~50'),
  signInBrowser: 'Sign in with your Meta account',
  signInBrowserDetail: expandText('Shows an ~39 code here; open the sign-in page to approve it.'),
  signInApiKey: 'Use a Model API key',
  signInApiKeyDetail: 'Paste a key from dev.meta.ai; it is stored in VS Code secret storage.',
  installTitle: expandText('~01 is not ~26'),
  installDetail: expandText('The ~01 CLI hosts ~00s ~35 ~27. Install it here, then sign in.'),
  installAction: 'Open install instructions',
  installStartAction: 'Install Muse Code',
  installConfirmDetail: expandText(
    'Meta publishes this ~20. It downloads and runs an installer on this machine:',
  ),
  installConfirmAction: 'Run installer',
  installCancelAction: 'Cancel',
  installWaiting: expandText('Installing ~01 in the terminal…'),
  installTimedOut: expandText('~01 ~53 found. Check the terminal output, then check again.'),
  installStartFailed: expandText(
    'The installer terminal ~49 open. Try again or use the install instructions.',
  ),
  deviceCodePrompt: 'Enter this code in your browser:',
  deviceCodeOpenAction: 'Open sign-in page',
  deviceCodeCancelAction: 'Cancel sign-in',
  deviceCodeWaiting: expandText('Waiting for browser ~39…'),
  signInCancelled: 'Sign-in cancelled.',
  signInFailed: expandText('~18 start in-panel sign-in. Check ~01 and ~55.'),
  signOutPending: expandText(
    'Sign-out is in progress or ~76 remain. Finish ~01 logout or remove META_API_KEY, then check again.',
  ),
  signOutTerminalFailed: expandText(
    'Extension ~19 ended, but its logout terminal ~49 open. Run muse logout or remove META_API_KEY, then check again.',
  ),
  signOutHoldFailed: expandText(
    '~18 save sign-out protection. Extension ~19 ended; remove META_API_KEY and finish muse logout before reopening VS Code.',
  ),
  signOutKeyClearFailed: expandText(
    '~18 clear the stored ~04 key. The ~27 host ~31; check VS Code secret storage and sign out again.',
  ),
  signOutStopFailed: expandText(
    'Backend shutdown failed. This window is gated; close VS Code and check ~76 before reopening.',
  ),
  retryAction: 'Check again',
  apiKeyPrompt: 'Meta Model API key',
  apiKeyPlaceholder: 'LLM_…',
  apiKeyInvalid: expandText(
    'A ~04 key starts with LLM_ (older keys look like LLM|<numeric id>|<secret>).',
  ),
  signInWaiting: 'Waiting for the browser sign-in to finish…',
  signInTimedOut: expandText('The sign-in ~42 complete in time. Try again.'),
  // How Muse Code ended a browser sign-in (`account/loginCompleted`, D26):
  // `expired`, `denied` and `failed` as captured live; any other ending as
  // Muse Code named it.
  signInExpired: 'The code expired before it was approved. Sign in again to get a new code.',
  signInDenied: 'You denied the sign-in in the browser.',
  signInSaveFailed: expandText('~01 signed in but ~49 save the credential.'),
  signInEnded: 'Sign-in ended: {outcome}. Sign in again to get a new code.',
  // A macOS credential file on Windows or Linux stops `muse serve` (D26):
  // version 2, empty or a Keychain pointer, or the Keychain lane.
  cliCredentialUnsupported: expandText(
    '~01 cannot start: its sign-in file {path} is in the macOS format, which ~01 cannot read on this system. Move or rename that file, then sign in again.',
  ),
  hostExited: expandText('~01 ~31 unexpectedly'),
  hostStarting: 'Starting Muse Code…',
  // PLAN.md D25: restarts, crashes and closed sessions continue the conversation.
  hostRestartsOnSend: expandText('The next ~10 restarts it and continues this ~00.'),
  turnStoppedByRestart: expandText('Stopped: the ~21 restarted'),
  sessionClosedByHost: expandText('~01 closed this ~19'),
  sessionResumesOnSend: expandText('The next ~10 resumes it.'),
  sessionContinued: 'Conversation continued after the restart.',
  sessionNotContinued: expandText(
    'The ~00 ~03 continued after the restart, so this ~10 starts a new one',
  ),
  surfaceClosed: 'The panel was closed',
  hostStartFailed: expandText('The ~21 ~49 start'),
  decisionErrorNotice: expandText(
    '~01 reported an error for the decision (the tool may have run anyway)',
  ),
  jumpToLatest: 'New messages',
  jumpToLatestTitle: expandText('Jump to the newest ~10'),
  copyResponse: 'Copy response',
  openOutputTitle: 'Click to open the output in an editor',
  toolOutputTitle: '{tool} tool output ({id})',
  clickToExpand: 'Click to expand',
  openOutputFailed: expandText('~18 open the output'),
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
  bypassNotAllowed: expandText('Turn on the "Allow dangerously skip ~57" ~79 to use Bypass ~57.'),
  // PLAN.md D24: the setting turned off while a conversation is in Bypass.
  bypassRevoked: expandText(
    'The "Allow dangerously skip ~57" ~79 was turned off; this ~00 is back in Manual.',
  ),
  // D24: in a remote window a dev container's settings can switch Bypass on.
  bypassRemoteTitle: expandText('Run without ~39s on a remote machine?'),
  bypassRemoteDetail: expandText(
    'This window runs on a remote machine or in a container, where a dev container definition can set ~82.allowDangerouslySkipPermissions without you. Bypass ~57 lets Muse edit files and run ~20s ~25.',
  ),
  bypassRemoteConfirm: expandText('Use Bypass ~57'),
  bypassRemoteStartedManual: expandText(
    '~82.initialPermissionMode asks for Bypass ~57, but this is a remote window; the ~00 starts in Manual. Choose Bypass ~41 Modes menu to confirm it.',
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
  mentionFile: expandText('Mention file from this ~51…'),
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
  skillsLoading: expandText('Start a ~00 to load skills'),
  skillsEmpty: expandText('No skills available ~14 ~06'),
  // Skills, imports and export (M30, D30).
  manageSkillsItem: 'Manage skills…',
  manageSkillsDetail: expandText('Turn ~01’s skills on or off'),
  importSkillsItem: 'Import skills…',
  importSkillsDetail: expandText('Copy your Claude Code or Codex skills into ~01'),
  continueClaudeItem: expandText('Continue a Claude Code ~19'),
  continueCodexItem: expandText('Continue a Codex ~19'),
  continueDetail: expandText('Pick up unfinished work ~14 ~00'),
  exportItem: '/export',
  exportDetail: expandText('Save this ~00 as a Markdown file'),
  exportLogItem: 'Export session log…',
  exportLogDetail: expandText('~01’s full JSON record of this ~00'),
  skillsCliMissing: expandText('Managing skills needs the ~01 CLI, ~93 ~26.'),
  skillsListFailed: expandText('~01 ~49 list its skills'),
  skillsPickTitle: 'Muse Code skills',
  skillsPickPlaceholder: 'Checked skills are on; uncheck one to turn it off',
  skillsUnchanged: 'No skills changed.',
  skillsChanged: 'Skills updated',
  skillsChangeFailed: expandText('~01 ~49 change {skills}'),
  skillsRestartPrompt: expandText(
    '~01 loads skill ~52 when it starts. Restart it now? A reply that is ~37 stops.',
  ),
  restartNow: 'Restart now',
  restartLater: 'Later',
  restartedNotice: expandText('~01 restarted with the new skills; ~78 ~10 continues the ~00.'),
  importSourceTitle: 'Import skills from',
  importSourceClaude: 'Claude Code',
  importSourceCodex: 'Codex',
  importConfirm: expandText('Import these skills into your ~01 skills?'),
  importConfirmAction: 'Import',
  importInvalid: 'not valid, will be skipped',
  importFailed: expandText('~01 ~49 import skills'),
  // Import from Claude Code, Codex and Cursor (M83, D49).
  agentImportItem: 'Import from other agents…',
  agentImportDetail: expandText(
    'Copy ~40, hooks, agents, ~20s and rules from Claude Code, Codex or Cursor',
  ),
  agentImportSourceTitle: 'Import from',
  agentImportSourceAll: 'All three',
  agentImportSourceCursor: 'Cursor',
  agentImportPickTitle: 'What to import',
  agentImportPickPlaceholder: 'Checked entries are previewed before anything is written',
  // {source}: the tool picked above.
  agentImportNothing: 'Nothing to import from {source}.',
  agentImportUntrusted: expandText(
    'This ~06 is not trusted, so only your own files were read; grant trust to offer this ~51’s files.',
  ),
  agentImportConfirm: expandText('Import what ~87 shows?'),
  agentImportConfirmAction: 'Import',
  agentImportNoneImportable: expandText(
    'None of the checked entries can be imported; ~87 says why.',
  ),
  agentImportPersonalToProject: expandText('this would copy a personal file into the ~51'),
  agentImportIgnoredToTracked: 'this would copy a git-ignored file into a tracked file',
  agentImportEditPrompt: expandText(
    'Open converted entries in {path} as an unsaved edit for you ~94 and save? Save it only to that path, never to another file.',
  ),
  agentImportEditAction: expandText('Edit and open ~64'),
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
  agentImportSkippedUnmapped: expandText('maps to no ~01 event'),
  agentImportSkippedDuplicate: 'another checked entry goes to the same place',
  agentImportSkippedDisabled: 'turned off where it came from',
  agentImportSkippedUnsupported: expandText('uses something ~01 ~13 support'),
  agentImportSkippedProjectServer: expandText(
    '~01 reads ~40 only from your own ~22, so a ~51’s servers ~61 offered there',
  ),
  agentImportSkippedUserRules: expandText('your own rules: ~01’s `/rules import` brings them in'),
  agentImportSkippedOutside: 'its source or destination is unsafe or leads outside its folder',
  agentImportSkippedFailed: expandText('~03 written; the log says why'),
  agentImportSkippedUnreadable: expandText(
    'its source or destination ~03 checked, so it is left alone',
  ),
  agentImportSkippedTooLarge: expandText('it would take AGENTS.md past the size ~01 loads'),
  agentImportSkippedChanged: expandText('its folder ~16 after ~87, so it ~53 written'),
  // Shown when some of the other agents' files could not be read during the scan.
  agentImportSkippedFiles: 'Some source files were skipped; the log gives counts and reasons only.',
  // Shown when the import could not start writing at all.
  agentImportNotApplied: expandText(
    '~63 imported: the window closed, the folder ~16 after ~87, or the checkpoint ~03 kept.',
  ),
  // Shown when an import is asked for while another one waits for its answers.
  agentImportBusy: expandText('An import is ~84 open; answer its questions first.'),
  // Shown when the import stopped on an error nothing foresaw.
  agentImportFailed: expandText(
    'The import ~31 on an unexpected error; what was ~84 written stays. The log has a fixed failure reason.',
  ),
  // Shown when the import's own code did not load (a damaged install).
  agentImportUnavailable: expandText(
    'The import ~03 loaded, so ~81 can be imported; ~08 window. The ~17.',
  ),
  // The read-only preview document, in Markdown.
  agentImportPreviewTitle: 'Import preview',
  agentImportPreviewIntro: expandText(
    'Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It ~13 look for ~76 in what it copies. This preview lists names, scopes and targets only. Config entries open unsaved for you ~94 and save.',
  ),
  // {fields}: field names, comma-separated.
  agentImportPreviewDropped: 'not carried over: {fields}',
  agentImportPreviewLegacyKey: expandText(
    '~92 uses the legacy `mcp_servers` key. Rename it to `mcpServers` when you add these: ~01 loads neither when both are there.',
  ),
  agentImportPreviewNotImported: 'Not imported',
  // {count}: a number.
  agentImportCountFiles: 'New files: {count}',
  agentImportCountSections: 'Sections for AGENTS.md: {count}',
  agentImportCountCopies: 'Entries offered in the editor: {count}',
  agentImportCountSkipped: 'Not imported: {count}',
  exportNothing: expandText('There is no ~00 to export yet.'),
  exportFailed: expandText('The ~00 ~03 exported'),
  exportSaved: 'Conversation exported to {path}',
  exportLogUnavailable: expandText('The ~19 log comes ~41 ~01 CLI, which this ~00 ~13 use.'),
  exportLogLocalOnly: expandText(
    '~01 writes the ~19 log itself, so pick a folder on this machine.',
  ),
  exportWaitForTurn: expandText('Export once the reply has finished, so ~64 holds all of it.'),
  exportHistoryUnavailable: expandText(
    '~01 ~42 return this ~00’s history (it is too long to replay), so there is ~81 to write as Markdown. Export ~19 log… saves the whole record.',
  ),
  exportCliMissing: expandText('Exporting the ~19 log needs the ~01 CLI, ~93 ~26.'),
  exportOpen: 'Open',
  exportDefaultTitle: 'Muse conversation',
  // Session export, import and share (M84, PLAN.md D49).
  exportJsonItem: expandText('Export ~19 as JSON…'),
  exportJsonDetail: 'A portable file you can import or share',
  importSessionItem: 'Import session…',
  importSessionDetail: expandText('Resume an exported ~19 file on the ~04 ~21'),
  openShareItem: 'Open share file…',
  openShareDetail: expandText('Read a shared ~19 file, read-only'),
  exportPreviewTitle: expandText('Export ~19 as JSON'),
  exportPreviewRedacted: 'Save redacted…',
  exportPreviewFull: 'Save without redaction…',
  exportPreviewOpen:
    'The redacted file is open in the editor. Nothing is written until you choose.',
  exportPreviewMessages: forms({
    one: expandText('{count} ~10 ~14 ~00'),
    other: expandText('{count} ~10s ~14 ~00'),
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
    other: expandText('{count} ~76 or key digests removed'),
  }),
  exportPreviewKnownCredentials: expandText(
    'Known credential shapes (API keys, tokens, passwords, private keys) and the key digest are always removed. A secret in another shape stays: read ~64 before you share it.',
  ),
  exportTooLarge: expandText('This ~00 is too long for a ~19 export file.'),
  importPreviewTitle: 'Import session',
  // {source}: the backend label; {messages}: a message-count line; {model}:
  // the model id; {mode}: Manual or Plan in the display language.
  importPreviewDetail: expandText(
    'From {source}: {~10s}. It continues on {model} and starts in {mode}; ~19 rules, goals, schedules and patches are dropped, and the imported history is treated as untrusted.',
  ),
  importSessionFailed: expandText('The ~19 ~03 imported'),
  importSessionUnavailable: expandText('Sessions can only be imported on the ~04 ~21.'),
  // Adopted into the panel, which appends the session's name.
  importedNotice: 'Session imported',
  // {mode}: Manual or Plan in the display language.
  importedUntrusted: expandText(
    'This ~00 holds imported history, so it starts in {mode}. Only you can change that.',
  ),
  openShareTitle: 'Open share file',
  shareFailed: expandText('The share file ~03 opened'),
  // {backend}: the backend label; {time}: a date and time.
  shareMetaLine: expandText('Shared from {~21} · {time}'),
  shareReadOnly: expandText('Read-only: ~81 ~14 file can act on your ~06.'),
  // The file's own `redacted` flag, which anyone can set: reported, never vouched for.
  shareMarkedRedacted: expandText(
    '~92 says its paths and account ids were redacted; that is ~02 here.',
  ),
  // In place of one item of a share file that could not be rendered.
  shareSectionFailed: expandText('This part of ~64 ~03 shown.'),
  // {shown}, {total}: counts of the file's items, as numbers.
  shareShownCount: 'Shown: {shown} of {total}',
  shareShowMore: 'Show more',
  // After "could not be imported: ". {size}, {limit}: sizes such as 2.4 MB.
  importReplayTooLarge: expandText(
    'It holds {size} of text for ~38, and a resumed ~00 can start with at most {limit}. Open it as a share file to read it.',
  ),
  // Why a picked file was refused, after "could not be imported/opened: ".
  transferTooLarge: expandText('~92 is larger than a ~19 export can be.'),
  transferFileMissing: expandText('The picked file ~58 exists.'),
  transferEmpty: expandText('~92 holds no ~00.'),
  transferNotAnExport: expandText('~92 is not a ~50 ~19 export.'),
  transferLocalFileOnly: expandText(
    'Session import and sharing require a local file on the ~27 host.',
  ),
  // {version}: the file's format version, a number.
  transferVersionUnsupported: expandText('This ~54 of the ~27 cannot read format ~54 {~54}.'),
  // {field}: where in the file, as `transcript[2].outputRef`.
  transferUnknownField: expandText('~92 holds a field this ~54 ~13 know: {field}'),
  // {field}: where in the file, as `transcript[2].status`.
  transferInvalidField: expandText('~92 holds a field that is not valid: {field}'),
  // MCP servers and hooks, read-only (M31, D30).
  mcpItem: 'MCP servers…',
  mcpItemDetail: expandText('What ~01 connects to; sign in to a server'),
  hooksItem: 'Hooks…',
  hooksItemDetail: expandText('Where ~01’s hooks come from'),
  mcpTitle: expandText('~01 ~40'),
  mcpNoSettings: expandText('~01 has no ~22 file yet, so no ~40. It would be at {path}'),
  mcpUnreadable: expandText('~01’s ~22 file ~03 read:'),
  mcpNone: expandText('No ~40 are configured in {path}'),
  mcpCount: forms({
    one: expandText('{count} ~91 in {path}'),
    other: expandText('{count} ~40 in {path}'),
  }),
  mcpOptional: 'optional',
  mcpRequired: expandText('required (~01 stops if it fails)'),
  mcpDisabled: 'turned off',
  mcpEnv: 'environment:',
  mcpHeaders: 'headers:',
  mcpModeConflict: '“required” and “mode” are both set',
  mcpKeyConflict: expandText(
    '~01’s ~22 hold both “mcpServers” and “mcp_servers”, so it loads no ~91 from either. Keep one key.',
  ),
  mcpModeConflictWarning: expandText(
    '~01 loads no ~91 while a server sets both “required” and “mode”. Keep only “mode” on:',
  ),
  mcpOpenSettings: expandText('Open the ~22 file'),
  mcpRestart: expandText('Restart ~01 to load ~52'),
  mcpRestartDetail: expandText('A reply that is ~37 stops; the ~00 continues on ~78 ~10'),
  mcpInvalidUrl: 'an invalid URL',
  mcpNoCommand: 'no command',
  mcpRestarted: expandText('~01 restarted; ~78 ~10 loads the ~22 ~77 now.'),
  mcpDocs: expandText('~40 in ~01 (documentation)'),
  mcpSignIn: 'Sign in',
  mcpSignInDetail: 'Runs muse mcp login in a terminal (OAuth in the browser)',
  mcpSignOut: 'Sign out',
  mcpRemotePlaceholder: 'A remote server: sign in or out, or edit its entry',
  mcpStdioPlaceholder: expandText(
    'A local server needs no sign-in; edit its entry in the ~22 file',
  ),
  mcpCliMissing: expandText('Signing in to an ~91 needs the ~01 CLI, ~93 ~26.'),
  mcpTerminalName: expandText('~01 MCP sign-in'),
  // MCP servers on the Model API backend (M50, D42).
  mcpItemDetailModelApi: expandText('The servers in ~01’s ~22, run by this window'),
  mcpTitleModelApi: expandText('~40 on the ~04 ~21'),
  mcpRequiredModelApi: expandText('required (a ~10 stops if it is not ~37)'),
  mcpStateNotStarted: expandText('Starts with ~78 ~10'),
  mcpStateStarting: 'Starting…',
  mcpStateConnected: forms({ one: 'Connected: {count} tool', other: 'Connected: {count} tools' }),
  mcpStateUnoffered: forms({
    one: '{count} more not offered',
    other: '{count} more not offered',
  }),
  mcpStateFailed: expandText('Not ~37: {reason}'),
  mcpStateRestricted: expandText('Not started: this ~06 is in ~28'),
  mcpStateNotLoaded: 'Not loaded: see the warning',
  mcpBuiltIn: 'built in',
  mcpBuiltInDetail: expandText(
    'The ~27’s own getDiagnostics: the errors and warnings in VS Code’s Problems panel',
  ),
  mcpRestartModelApi: expandText('Restart the ~40'),
  mcpRestartModelApiDetail: expandText(
    'A reply that is ~37 stops; the servers start again with ~78 ~10, ~41 ~22 ~77 then',
  ),
  mcpRestartedModelApi: expandText('The ~40 ~31; ~78 ~10 starts them ~41 ~22 ~77 now.'),
  mcpShowLog: 'Show the log',
  mcpShowLogDetail: expandText('What the server wrote to stderr, and why it ~31'),
  mcpModelApiPlaceholder: expandText(
    'This window runs the server itself; a sign-in with muse mcp login is for ~01 only',
  ),
  mcpServerUnavailable: expandText('~91 {name} ~48: {reason}'),
  mcpRequiredFailed: expandText(
    '~91 {name} is required and is not ~37: {reason}. Fix its entry in ~01’s ~22, or set "mode": "optional", then restart the ~40 (~40… in the palette).',
  ),
  mcpNoServersKeys: expandText(
    'No ~91 is loaded: ~01’s ~22 hold both “mcpServers” and “mcp_servers”. Keep one key.',
  ),
  mcpNoServersMode: expandText(
    'No ~91 is loaded: {servers} set both “required” and “mode”. Keep only “mode”.',
  ),
  mcpNoServersUnreadable: expandText('No ~91 is loaded: ~01’s ~22 file ~03 read ({reason}).'),
  hooksTitle: 'Muse Code hooks',
  hooksTitleModelApi: 'Model API hooks',
  hooksWarning: expandText('Hooks run through your shell, outside ~01’s sandbox and ~39s'),
  hooksModelApiWarning: expandText(
    'Hooks run through your shell outside tool ~39s. Turn on ~82.modelApiHooks only after reviewing these sources.',
  ),
  hooksProject: 'Project hooks',
  hooksProjectFile: '.muse/hooks.json',
  hooksProjectNone: expandText('This ~06 has no .muse/hooks.json.'),
  hooksProjectTrusted: expandText('Runs ~14 ~06'),
  hooksProjectUntrusted: expandText('Runs only once you trust this ~06'),
  hooksUser: 'Your hooks',
  hooksUserBlock: expandText('~22.json › hooks'),
  hooksUserNone: expandText('None in your ~22'),
  hooksUserCount: forms({
    one: expandText('{count} hook in your ~22'),
    other: expandText('{count} hooks in your ~22'),
  }),
  hooksManaged: 'Managed hooks',
  hooksManagedKey: 'managed_hooks_path',
  hooksManagedNotSet: 'Not set: no administrator hooks',
  hooksManagedSet: expandText('Set by your ~22; whoever controls this file controls what runs'),
  hooksManagedMissing: expandText('Your ~22 name this file, but it ~13 exist.'),
  hooksDocs: expandText('Hooks in ~01 (documentation)'),
  // Memory (M49, D41): the notes Muse Code keeps, on both backends.
  memoryItem: 'Memory…',
  memoryItemDetail: expandText('The notes Muse keeps for later ~19s'),
  memoryTitle: 'Muse memory',
  memoryNone: expandText('No memory notes yet ~35 ~06'),
  memoryCount: forms({ one: '{count} memory note', other: '{count} memory notes' }),
  memoryIndexDetail: expandText('The index Muse reads at the start of every ~19'),
  memoryNewNote: 'New note…',
  memoryNewNoteDetail: expandText('A Markdown note Muse reads in later ~19s, listed in MEMORY.md'),
  memoryDocs: expandText('Memory in ~01 (documentation)'),
  memoryOpen: 'Open',
  memoryDelete: 'Delete…',
  memoryDeleteDetail: 'Moves the note to the trash and takes its line out of MEMORY.md',
  memoryDeleteIndexDetail: 'Moves the index to the trash; the notes stay',
  memoryDeleteConfirm: 'Delete the memory note {path}?',
  memoryDeleteConfirmDetail: expandText(
    'It moves to the trash. Muse ~58 sees it from its next ~19 on.',
  ),
  memoryDeleteAction: 'Delete',
  memoryDeleted: 'Deleted {path}',
  memoryNewTitle: 'New memory note',
  memoryScopePlaceholder: 'Where the note lives',
  memoryNamePrompt: 'Name the note',
  memoryNamePlaceholder: 'deploy-steps.md',
  memoryNameInvalid: expandText('~01 ~13 accept that name'),
  memoryNameTaken: expandText('A note with that name ~84 exists.'),
  memoryDescriptionPrompt: 'What is the note about? One line for MEMORY.md (optional)',
  memoryDescriptionPlaceholder: 'How we deploy to staging',
  memoryFailed: expandText('The memory ~03 ~16'),
  // Worktrees (M32, D30).
  newWorktreeItem: 'New worktree…',
  newWorktreeDetail: 'A new branch in its own folder and window; this checkout is untouched',
  removeWorktreeItem: 'Remove a worktree…',
  removeWorktreeDetail: 'Delete a worktree folder; its branch stays',
  worktreeNoWorkspace: expandText('Open a folder in a git ~88 first.'),
  worktreeUntrusted: expandText(
    'Worktrees need git, which ~13 run in ~28 (a ~88’s config can name programs for git to run). Trust this ~06 first.',
  ),
  worktreeNotRepository: expandText('This ~06 is not in a git ~88'),
  worktreeBranchPrompt: 'Name the new branch',
  worktreeBranchPlaceholder: 'feature/login-form',
  worktreeBranchEmpty: 'Type a branch name.',
  worktreeBranchInvalid: expandText('git ~13 accept that as a branch name.'),
  worktreeBranchExists: expandText('A branch with that name ~84 exists.'),
  worktreeBaseTitle: 'Start the branch from',
  worktreeBasePlaceholder: 'The commit the new branch starts at',
  worktreeCurrent: 'current branch:',
  worktreeDetachedHead: 'the commit checked out now',
  worktreeFolderExists: expandText('That folder ~84 exists:'),
  worktreeAddFailed: expandText('git ~49 create the worktree'),
  worktreeCreated: 'Worktree ready at {path}',
  worktreeOpen: 'Open in New Window',
  worktreeListFailed: expandText('git ~49 list the worktrees'),
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
  worktreeDirtyConfirm: expandText(
    'This worktree has uncommitted ~52. Removing it discards them for good. Remove it anyway?',
  ),
  worktreeDiscardAction: expandText('Remove and discard ~52'),
  worktreeRemoveFailed: expandText('git ~49 remove the worktree'),
  worktreeRemoved: 'Removed the worktree at {path}',
  compactItem: '/compact',
  compactDetail: 'Summarise older context to free the window',
  clearItem: '/clear',
  logoutItem: '/logout',
  openLog: 'Open output log',
  reportIssue: 'Report an issue…',
  openDocs: expandText('~01 documentation'),
  modelListLabel: 'Models',
  thinkingOff: 'No thinking',
  // @-mention menu and attachments.
  mentionMenuLabel: 'Files',
  mentionNoMatches: 'No matching files',
  actionFailed: expandText('That ~42 work (the ~50 ~17)'),
  slashNoMatches: expandText('No matching ~20s; Enter sends the text as it is'),
  attachmentsLabel: 'Attachments',
  removeAttachment: 'Remove',
  attachmentTooLarge: 'Images must be 10 MB or smaller.',
  attachmentUnsupported: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  attachmentLimit: expandText('At most 20 files per ~10.'),
  attachmentUnreadable: expandText('~92 ~03 read.'),
  documentTooLarge: 'PDFs must be 32 MB or smaller.',
  documentsOverBudget: expandText('Files must total at most 50 images and PDF pages per ~10.'),
  mediaTotalTooLarge: 'Attached images and PDFs exceed the combined media size limit.',
  olderMediaOmitted: expandText(
    'Older images or PDFs were left out of this ~34 to stay within media limits. They remain in local history.',
  ),
  pdfNeedsModelApi: expandText('PDF attachments require the ~04 ~21.'),
  invalidPdf: 'This file is named as a PDF but is not a valid PDF.',
  pdfLabel: 'PDF',
  // Model API read_file rows. The separate MODEL_TEXT result stays English.
  toolReadPdf: 'Read PDF `{path}` ({pages}, {bytes} bytes)',
  toolReadPdfPages: forms({ one: '{count} page', other: '{count} pages' }),
  toolReadPdfPagesUnknown: 'page count unknown',
  toolReadImage: 'Read image `{path}` ({mediaType}, {width}×{height}, {bytes} bytes)',
  toolReadPdfInvalid: expandText('~92 `{path}` has a PDF name but no PDF header.'),
  toolReadImageInvalid: expandText('~92 `{path}` is not a supported image.'),
  toolVisualFileMissing: expandText('~92 `{path}` ~53 found.'),
  toolVisualReadFailed: expandText('~92 `{path}` ~03 read.'),
  // M69 (PLAN.md D49): web fetch. The row's line under a fetched page: its
  // size and content type (text/html).
  webFetchSize: 'Fetched {size} ({type})',
  // Before each fetch Muse Code asks the extension for.
  webFetchConfirmTitle: expandText('~01 wants to fetch a page from {host}'),
  webFetchConfirmDetail: expandText(
    'The ~27 will download {url} from this computer and give its text to ~01. The whole address is sent to {host}, so anything written into it leaves the ~00.',
  ),
  // Why a fetch did not happen or did not finish.
  webFetchInvalidUrl: 'That is not a complete web address.',
  webFetchNotHttps: 'Only https:// pages are fetched.',
  webFetchCredentials: expandText('An address with a user name or password is refused.'),
  webFetchUrlTooLong: 'The address is longer than {max} characters.',
  webFetchReservedHost: '{host} is a local or reserved name, not a public site.',
  webFetchPrivateAddress: expandText(
    '{host} leads to {address}, ~93 a public internet address. ~63 fetched.',
  ),
  webFetchUnresolved: expandText('{host} ~03 found from this computer.'),
  webFetchWithdrawn: expandText(
    'Web fetch is ~58 allowed here (the ~06 lost its trust, the ~15 ~16, or the sandbox network ~79 became restricted), so the fetch ~31 before its next ~34.',
  ),
  webFetchNat64Unknown: expandText(
    '{host} has only IPv6 addresses here, and whether this network translates them to IPv4 addresses (NAT64) ~03 learned ({detail}), so they ~03 checked for a private address. ~63 fetched.',
  ),
  webFetchTooManyRedirects: expandText('~73 redirected more than {max} times.'),
  webFetchRedirectWithoutLocation: 'The server answered {status} without saying where to go.',
  webFetchRedirectRefused: expandText('~73 redirected to an address that is refused: {reason}'),
  webFetchHttpStatus: 'The server answered {status}.',
  webFetchTooLarge: expandText('~73 is larger than {size}.'),
  webFetchNoContentType: expandText('The server ~42 say what the page contains.'),
  webFetchContentType: expandText('~73 is {type}, not HTML or text.'),
  webFetchContentTypeUnnamed: expandText('~73 is not HTML or text.'),
  webFetchEncoding: expandText('~73’s compression ({encoding}) ~03 read.'),
  webFetchEncodingUnnamed: expandText('~73’s compression ~03 read.'),
  webFetchTimeout: expandText('~73 ~42 arrive within {duration}.'),
  webFetchConversionTimeout: expandText(
    '~73 arrived, but its HTML ~03 converted in the time allowed (at most {duration}), ~86.',
  ),
  webFetchConversionMemory: expandText('~73’s HTML needed more than {max} to convert, ~86.'),
  webFetchXhtml: expandText(
    '~73 is XHTML (application/xhtml+xml), which web fetch ~13 read: read as HTML, its XML syntax would be misread. ~63 read.',
  ),
  webFetchUndecodable: expandText(
    '~73 is in the {encoding} encoding, which this computer cannot decode, ~86.',
  ),
  webFetchConversionFailed: expandText('~73’s HTML ~03 converted ({detail}), ~86.'),
  // Why no connection gave an answer: the page's host, and the checked
  // address(es) the request went to.
  webFetchCertificate: expandText(
    '{host}’s certificate at {address} is not trusted on this computer. ~63 read. ({detail})',
  ),
  webFetchProxyCredentials: expandText(
    'The proxy asked for ~76 before it would connect to {address} for {host}. ~63 read.',
  ),
  webFetchProxyRefused: expandText(
    'A proxy or another machine in the way answered {status} instead of connecting securely to {address} ({host}). ~63 read.',
  ),
  webFetchUnreachable: expandText('{host} ~03 ~80 at {address}. ({detail})'),
  webFetchNetwork: expandText('The ~34 failed: {detail}'),
  // Web fetch is its own bundle (dist/webFetch.js, PLAN.md D6): a damaged install.
  webFetchUnavailable: expandText('Web fetch ~03 loaded, so ~81 was fetched; ~08 window. The ~17.'),
  // A redirect to another host, handed back to the model on the Model API
  // backend; and the refusal in Restricted Mode.
  webFetchMoved: expandText(
    '~73 redirected to {location}, on another host. Muse can fetch it in a new call, which asks again.',
  ),
  webFetchRestrictedMode: expandText('Web fetch is off in ~28. Trust the ~06 to use it.'),
  // Observation packing (M73): a recall_output row's heading above the
  // recalled text (shown as it was), and why a recall read nothing back.
  packRecalled: 'Recalled characters {start} to {end} of {total} from packed output {id}',
  packRecallInvalid: expandText('The recall ~34 was malformed, so ~81 was read back.'),
  packRecallUnknownId: expandText(
    'No packed output ~14 ~00 has the id {id}, so ~81 was read back.',
  ),
  packRecallBadOffset: expandText(
    'The offset is not a character position in packed output {id} (0 to {last}), so ~81 was read back.',
  ),
  textFileTooLarge: 'Text files must be 1 MB or smaller.',
  textFilesOverBudget: expandText(
    'Attachments fill ~01’s ~10 limit. Remove an attachment or shorten the ~10.',
  ),
  textFilesOverModelApiBudget: expandText(
    'Text attachments exceed the ~04 context allowance. Remove a file or attach a smaller excerpt.',
  ),
  textFileInvalid: expandText('This file is not valid UTF-8 text.'),
  textFilePrivate: expandText('This private file ~43 attached.'),
  textFileLabel: 'Text',
  binaryFileUnsupported: expandText(
    'This binary file type ~43 attached. Use a PDF, image or UTF-8 text file.',
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
  codeIntelNoService: expandText('No language service answered for {path}, or it ~30 no symbols.'),
  codeIntelTimedOut: expandText('The language service ~42 answer within {seconds} seconds.'),
  repoMapNoService: expandText('No language service answered for the ~06’s symbols.'),
  // The paid-use popup before an image, on either backend (M34, M44, M58).
  imageBuyTitle: 'Muse wants to create the image {path}',
  imageBuyEditTitle: 'Muse wants to make the edited image {path}',
  imageBuyPrompt: 'Prompt: {prompt}',
  imageBuySources: 'Starting from: {paths}',
  imageBuyBilling: expandText('This costs {price}, ~23 ~04 key, not to your ~01 ~56.'),
  approvalStage: 'step {position} of {total}',
  approvalProtectedWrite: 'Protected write',
  approvalJudgeEscalated: 'Escalated by the safety check',
  approvalFeedbackPlaceholder: 'Tell Muse what to do instead (optional)',
  approvalDecided: 'Decided',
  // PLAN.md D26: the approvals waiting, docked above the composer.
  approvalDockLabel: expandText('Waiting for your ~39'),
  // {count}: how many approvals wait, this one included.
  approvalDockCount: forms({
    one: 'Approval waiting: {count}',
    other: 'Approvals waiting: {count}',
  }),
  approvalDockedNote: expandText('Waiting for your ~39, in the card above the ~10 box'),
  questionSubmit: 'Submit',
  questionCancel: 'Cancel',
  questionFreeTextPlaceholder: 'Type your answer',
  questionOther: 'Other',
  questionOtherPlaceholder: 'Type your own answer…',
  questionAnswered: 'Answered',
  questionCancelled: 'Cancelled',
  questionCancelFailed: expandText('The question ~03 cancelled'),
  // M46: an explanation instead of the options (MSP `userInput/clarify`).
  questionExplain: 'Explain instead',
  questionExplainTitle:
    'Answer in your own words instead of choosing; Muse reads it and decides again',
  questionExplainLabel: 'Your explanation',
  questionExplainPlaceholder: 'Say what you mean instead of choosing…',
  questionSendExplanation: 'Send explanation',
  questionBackToChoices: 'Back to the choices',
  questionClarified: 'Explained',
  clarifyNotAccepted: expandText('The explanation ~53 accepted'),
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
  referenceTitle: expandText('Goes to ~47 with your ~10 as context'),
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
  linkSchemeRefused: expandText('Only http, https and mailto links can be opened ~41 transcript.'),
  sandboxNotice: expandText(
    '~01 cannot run shell ~20s until its Windows sandbox is set up. Run "~50: Set Up Shell Sandbox" (one administrator ~39), then start a new ~00.',
  ),
  // Windows sandbox setup prompt and its outcomes (OS notifications).
  sandboxOffer: expandText(
    '~01 needs a one-time administrator setup before it can run shell ~20s on Windows (it creates the sandbox users and network filter it runs ~20s under). Set it up now?',
  ),
  sandboxSetUpNow: 'Set up now',
  sandboxNotNow: 'Not now',
  sandboxDontAskAgain: "Don't ask again",
  sandboxReady: expandText('~01 sandbox is ready. Start a new ~00 to run shell ~20s in it.'),
  sandboxAlreadyReady: expandText('~01 sandbox is ~84 set up.'),
  sandboxStillRequired: expandText('~01 sandbox is still not ready'),
  sandboxCancelled: expandText('~01 sandbox setup ~42 complete'),
  sandboxExitCode: 'exit code {code}',
  sandboxNotNeeded: expandText('~01 needs no sandbox setup on this platform.'),
  sandboxCliMissing: expandText('~01 is not ~26, so its sandbox ~43 checked.'),
  // Editor integration (M5).
  editorContextTitle: 'Shared with Muse as context; × leaves it out',
  editorContextRemove: 'Leave the open file out',
  editorContextLabel: 'Open file',
  linePrefix: 'L',
  openFileTitle: expandText('Open ~64 at this change'),
  openFileFailed: expandText('~18 open ~64'),
  toggleDetails: 'Show or hide the details',
  applyCode: 'Apply',
  noEditorForApply: 'Open a text editor to apply code into it.',
  diffTitleSuffix: 'Muse edit',
  editNotRebuildable: expandText('{path} ~43 rebuilt: ~64 ~16 since this edit.'),
  editUnsavedChanges: expandText(
    '{path} ~43 reverted: save or discard the unsaved editor ~52, then ~55.',
  ),
  editPathRefused: expandText('{path} refused: the edited path is outside the ~06.'),
  editNoPatch: 'This edit left no patch document.',
  // Session history (M6).
  historyLabel: 'History',
  historySearchPlaceholder: 'Search sessions',
  historyEmpty: expandText('No ~19s ~14 ~06 yet.'),
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
  resumeDetail: expandText('Pick a previous ~00 ~14 ~06'),
  renameTitle: expandText('Rename this ~00'),
  renamePlaceholder: 'Conversation name',
  // The user card's menu (Claude Code's rewind button): fork, rewind, both.
  rewindMenuLabel: 'Fork or rewind',
  forkFromHere: expandText('Fork ~00 from here'),
  rewindConversationToHere: expandText('Rewind ~00 to here'),
  rewindCodeToHere: 'Rewind code to here',
  forkAndRewind: expandText('Fork ~00 and rewind code'),
  rewindNothing: expandText('No edits after this ~10 to rewind.'),
  rewindDone: forms({
    one: expandText('Code rewound to this ~10 ({count} edit)'),
    other: expandText('Code rewound to this ~10 ({count} edits)'),
  }),
  forkedNotice: expandText('Forked into a new ~00.'),
  rewindImagesUnavailable: expandText('Some images from this ~10 ~03 restored.'),
  rewindBeforeCompaction: 'Cannot rewind before the latest compaction.',
  // Turn checkpoints (M86): the user card's menu, the confirmations, the result.
  restoreFilesToHere: 'Restore files to here',
  checkpointsModelApiOnly: expandText(
    'File restore and Redo require a connected ~04 ~19. Only ~38’s own file-tool edits are undone, ~74 what ~38 left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone.',
  ),
  checkpointsLegacyReadOnly: expandText(
    'This ~10 was recorded by an earlier ~54 of ~50. Its files ~43 restored.',
  ),
  checkpointsNativeUnsafe: expandText(
    'File restore and Redo are unavailable while a ~01 ~19, or a window that ~13 record its edits, may still change files. Close or reload that window, then ~55.',
  ),
  rewindAndRestore: expandText('Rewind ~00 and restore files'),
  checkpointsRestricted: expandText('File checkpoints are off in ~28'),
  checkpointsOff: expandText('File checkpoints are off in ~22'),
  checkpointsNoGit: 'File checkpoints need git on PATH',
  conversationRewindUnavailable: expandText('Rewinding the ~00 ~48 with ~01 on Windows'),
  restoreConfirmTitle: expandText('Restore ~64s to ~90 ~10?'),
  restoreConfirmDetail: expandText(
    'Only ~38’s own file-tool edits from this ~10 on are undone, ~74 what ~38 left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Files with unsaved ~52 are left ~77 and named. Redo puts back what the restore ~16.',
  ),
  restoreConfirmAction: 'Restore files',
  rewindCodeConfirmTitle: expandText('Rewind the code to ~90 ~10?'),
  rewindCodeConfirmDetail: expandText(
    'Muse’s recorded edits after this ~10 are undone, newest first; a file ~16 since is left as it is. What ~20s ~16 is not covered, and Restore files ~13 undo it either: it is left as it is; check ~54 control.',
  ),
  rewindCodeConfirmAction: 'Rewind code',
  restoreBothConfirmTitle: expandText('Restore ~64s and rewind the ~00 to ~90 ~10?'),
  restoreBothConfirmDetail: expandText(
    'Only ~38’s own file-tool edits from this ~10 on are undone, ~74 what ~38 left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Then the ~00 branches ~90 ~10 and its prompt returns to the composer. If a file is refused, the ~00 is not rewound. The original ~00 stays in History.',
  ),
  restoreBothConfirmAction: 'Restore and rewind',
  rewindNotDone: expandText('The ~00 ~53 rewound.'),
  restoreDone: forms({
    one: expandText('Restored {count} file to ~90 ~10.'),
    other: expandText('Restored {count} files to ~90 ~10.'),
  }),
  restoreNothing: 'No file needed restoring.',
  redoNothing: 'Nothing left to put back.',
  redoDone: forms({ one: 'Put {count} file back.', other: 'Put {count} files back.' }),
  redoAction: 'Redo',
  redoLabel: expandText('Redo: put back ~64s this restore replaced'),
  redoGone: expandText('This restore can ~58 be redone.'),
  // PLAN.md D26: a notice said again is one row with a count, not a new row.
  // {count}: how many times it was said in all (2 or more).
  noticeRepeatBadge: '{count}×',
  noticeRepeated: forms({ one: 'Shown {count} time', other: 'Shown {count} times' }),
  restoreRefusedUnsaved: expandText('Left ~77, with unsaved ~52: {files}'),
  restoreRefusedChanged: expandText('Left ~77, ~16 by something else in the meantime: {files}'),
  restoreRefusedBetween: expandText('Left ~77, ~16 by something else between ~38’s edits: {files}'),
  restoreRefusedOrderUnknown: expandText(
    'Left ~77, edited from more than one window in an order that ~43 told: {files}',
  ),
  restoreRefusedLinked: expandText('Left ~77, ~80 through a link or junction: {files}'),
  restoreRefusedNotKept: expandText('Not restorable, the earlier ~54 ~53 kept: {files}'),
  restoreRefusedTooLarge: 'Not restorable, too large to keep a copy of: {files}',
  restoreRefusedFailed: expandText('~18 be ~16: {files}'),
  restoreUnchanged: forms({
    one: 'Already as before: {count} file.',
    other: 'Already as before: {count} files.',
  }),
  restoreWritesIncomplete: expandText(
    '~63 restored: some of these turns’ edits were not fully recorded (a reload or crash mid-edit, or file checkpoints were off).',
  ),
  restoreLegacyInRange: expandText(
    '~63 restored: some of these turns were recorded by an earlier ~54, which this one cannot restore.',
  ),
  restoreLegacyWindowOpen: expandText(
    'Another window runs an older ~54 of ~50; reload it, then ~55.',
  ),
  restoreCommandsNote: expandText(
    'Commands, hooks, MCP tools or ~44 work were active in these turns; files they ~16 ~61 undone. Check your ~54 control.',
  ),
  namedFilesMore: '{files} (+{count})',
  restoreNoCheckpoint: expandText('This ~10 has no file checkpoint any more.'),
  restoreTurnRunning: expandText('Wait until no turn is ~37 ~14 window, then ~55.'),
  restoreTurnElsewhere: expandText(
    'A turn or file restore is ~37 in another VS Code window on this folder. Try again when it has finished.',
  ),
  sendMarkFailed: expandText(
    'The ~10 ~53 sent: this window ~49 tell other windows on this folder that a turn is starting.',
  ),
  restoreFailed: expandText('~18 restore ~64s'),
  checkpointFailed: 'the checkpoint failed',
  childCheckpointFailed: expandText(
    'The subagent turn ~42 run: its file checkpoint ~03 created or its inherited recording decision is ~66.',
  ),
  resumedNotice: 'Resumed',
  historyUnavailable: expandText('The ~00 history ~03 loaded'),
  historyNotServed: expandText('The earlier ~10s of this ~00 ~03 shown'),
  unreadTooltip: 'Muse needs your attention',
  unreadMark: '● ',
  sessionRequired: expandText('Start a ~00 first.'),
  // Account & usage dialog (M8).
  usageItem: 'Account & usage…',
  usageItemDetail: expandText('Subscription usage, this ~00’s tokens, the ~21'),
  agentsCommand: '/agents',
  agentsCommandDetail: 'Show the agent map',
  usageCommand: '/usage',
  usageCommandDetail: 'Show account usage',
  costCommand: '/cost',
  costCommandDetail: expandText('Show this ~00’s token totals'),
  usageLabel: 'Account & usage',
  usagePlan: 'Plan',
  usagePlanSubscription: expandText('~01 ~56'),
  usageBackend: 'Backend',
  usageWindow: 'Current window',
  usageWeekly: 'This week',
  usagePercentUsed: '{percent} used',
  usageResetsIn: 'resets in {duration}',
  usageAsOf: 'as of {time}',
  usageAwaitingFreshReport: expandText('Waiting for a fresh ~01 usage report.'),
  usageNoSubscription: expandText(
    'No ~56 usage reported yet. ~01 reports it after the first turn of a ~00.',
  ),
  usageModelApiNote: expandText(
    'This window runs on your ~04 key: ~34s are billed to the key at pay-as-you-go rates and counted on the dev.meta.ai dashboard.',
  ),
  usageOpenDashboard: 'Open dev.meta.ai',
  usageSessionTokens: 'This conversation',
  usageInput: 'Input',
  usageOutput: 'Output',
  usageCached: 'Cached',
  usageContext: 'Context',
  usagePackedAvoided: 'Packing saved (estimate)',
  usageNoSession: expandText('No tokens counted yet ~14 ~00.'),
  usageLoading: 'Reading usage…',
  usageUnavailable: expandText('Usage ~03 read'),
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
  notifyApprovalWaiting: expandText('Muse is waiting for your ~39.'),
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
  dictationFailed: expandText('~62 failed'),
  dictationUnavailable: expandText('~62 ~48 on this platform.'),
  dictationUnavailableLinux: expandText(
    '~62 ~48 on Linux: no ~09 ships a speech recogniser, and this ~27 adds no third-party engine.',
  ),
  dictationUnavailableWindows: expandText(
    '~62 needs Windows PowerShell, which ~53 found (SystemRoot is not set).',
  ),
  dictationUnavailableDarwin: expandText(
    '~62 needs the macOS helper (native/darwin/muse-dictate), which this build ~13 include.',
  ),
  // After `dictationFailed`, when voice's own code did not load (a damaged install).
  dictationNotLoaded: expandText('the dictation code ~03 loaded; ~08 window. The ~17.'),
  announceListening: 'Listening',
  announceStoppedListening: 'Stopped listening',
  // Model API backend (M7).
  allowOnce: 'Allow once',
  allowSessionPrefix: expandText('Always allow ~14 ~19:'),
  reject: 'Reject',
  modelApiStalled: expandText(
    'The ~04 sent ~81 for {seconds} s, so the reply was ended; send the ~10 again to retry',
  ),
  queuedTurnDropped: expandText('Not sent: Stop cleared the queued ~10s'),
  compactionStopped: expandText('the compaction was ~31'),
  compactionStoppedNotice: expandText('Compaction ~31; the ~00 is as it was.'),
  // PLAN.md D26: a decision or answer that arrived after the prompt had moved.
  promptAlreadySettled: expandText('That ~34 was ~84 answered, so this choice ~53 needed.'),
  promptMovedOn: expandText(
    'That ~34 moved on to its next step ~90 choice arrived; choose again on the updated card.',
  ),
  promptGone: expandText('That ~34 is ~58 waiting for an answer.'),
  // PLAN.md D26: Muse Code's own approval faults, and the way on.
  approvalReplayRefused: expandText(
    '~01 refuses every ~10 ~14 ~00: a turn ~31 while a multi-step ~20 was partly approved, and ~01 cannot replay that ~39 (a fault in ~01, not in your choices). Restart ~01 to continue this ~00, or start a new one.',
  ),
  approvalLedgerFault: expandText(
    '~01 applies your ~39s ~14 ~00 but reports an error for each one (a fault in its ~39 record, not in your choices). Each card follows what ~01 does next; a new ~00 ~13 have the fault.',
  ),
  museCodeRestartAsked: expandText(
    '~01 was ~31. Your next ~10 starts it again and continues this ~00.',
  ),
  // CLI recovery (2026-10-03): a steer whose answer never came may still reach the turn.
  steerUnconfirmed: expandText(
    '~01 ~42 confirm your ~10 ~80 the ~37 turn. It may still arrive; check before you send it again.',
  ),
  // The watchdog: a command refused at once while Muse Code answers nothing.
  museCodeNotAnswering: expandText('~01 is not answering. Restart it with "~50: Restart ~01".'),
  museCodeRestartedUnresponsive: expandText('~01 ~31 answering and was restarted.'),
  // Its notice offers Restart now (D26's action).
  museCodeUnresponsiveTurn: expandText(
    '~01 ~31 answering while a turn runs. Restarting it stops that turn; the ~00 continues with ~78 ~10.',
  ),
  // After "Muse Spark: Restart Muse Code".
  museCodeRestarted: expandText('~01 was restarted. Your next ~10 continues this ~00.'),
  // A session whose Muse Code event log failed (a CLI fault) takes no new message.
  sessionLogDamaged: expandText(
    'This ~00’s ~01 log is damaged (a fault in ~01), so it cannot take new ~10s. Start a new ~00; this one stays in History.',
  ),
  turnUnqueued: expandText('Not sent: the queued ~10 was withdrawn'),
  turnRetracted: expandText(
    'Another ~01 client withdrew a ~10 from this ~00; reopen it from History to see it as stored.',
  ),
  modelRouteUnserved: expandText(
    'The signed-in account cannot serve this ~00’s model; choose another model from ~38 menu.',
  ),
  viewGapReloaded: expandText('Some updates from ~01 were missed, so the ~00 was reloaded.'),
  viewGapReloadFailed: expandText('Some updates from ~01 were missed and the ~00 ~03 reloaded'),
  commandTooLarge: expandText(
    'This ~10 is too large for ~01, which accepts up to 10 MiB per ~10 (images count at a third more than their file size). Remove an image or shorten the selection and send again.',
  ),
  outputIsBinary: expandText('The stored output is binary and ~43 shown as text'),
  editReviewNeedsFolder: expandText('Open the folder the edit was made in ~94 or revert it.'),
  unsavedFilesNotice: expandText(
    'Muse reads and edits the saved files, not unsaved editor ~52 (turn on ~82.autosave to save before each ~10). Unsaved:',
  ),
  sessionEditsUnsupported: expandText(
    '~01 cannot rename or fork ~19s on Windows (meta-models/muse-code-sdk#30, #31).',
  ),
  contributorTitle: 'Contributor-tier model',
  contributorDetail: expandText(
    'Meta may use prompts and completions sent to a contributor-tier model to train its models, in exchange for the lower price. Use it ~35 ~00?',
  ),
  contributorConfirm: 'Use contributor model',
  contributorBlocked: expandText(
    'Contributor-tier models are blocked ~14 ~06 (~82.confidentialWorkspace).',
  ),
  backendItem: 'Backend',
  backendDetail: expandText('~82.~21: auto / museCode / modelApi'),
  backendMuseCode: expandText('~01 (your Muse ~56)'),
  backendModelApi: expandText('Meta ~04 (your key, pay as you go)'),
  modelApiBackendNotice: expandText(
    'This ~00 runs on the Meta ~04 with the ~27’s own tools (read, edit, write, search, list, shell). Its ~19s are kept ~14 ~06’s ~27 storage.',
  ),
  installOrKeyDetail: expandText(
    'The ~01 CLI hosts ~00s ~35 ~27; without it you can still use a Meta ~04 key.',
  ),
  compactionDone: 'Context compacted',
  // The Model API session budget (M82): a request that cannot fit is not
  // sent, and the turn's cost is shown against the cap afterwards.
  sessionBudgetStopped: expandText(
    'Stopped: the next ~34 (about {estimate}) would pass the ~19 budget of {cap} ({spent} used). It ~53 sent.',
  ),
  sessionBudgetStoreUnavailable: expandText(
    'The ~19 spend ledger ~03 read or saved. No new ~34 can be sent until it is available.',
  ),
  sessionBudgetLegacyFeesUnknown: expandText(
    'The ~00’s spending is not fully verified. Wait for pending ~34s to finish, or start a new ~00 to use a spend cap.',
  ),
  sessionBudgetSearchUnavailable: expandText(
    'Web search is unavailable while the ~19 spend cap is on: its billed query count has no verified limit. Turn the cap off to allow web search.',
  ),
  sessionBudgetRetryUnavailable: expandText(
    'The previous ~34 may have been billed. Its full reservation was kept; send a new prompt to retry with a fresh allowance.',
  ),
  sessionBudgetUnknownCharge: expandText(
    'Usage ~53 verified. {amount} remains reserved as a possible charge; this is not a confirmed bill.',
  ),
  sessionBudgetVoiceUnavailable: expandText(
    '~24 is unavailable while the ~19 spend cap is on: its billed audio duration has no verified bound. Turn the cap off to allow paid voice, or use system dictation.',
  ),
  sessionBudgetVoiceContextChanged: expandText(
    '~24 ~31 because the ~00 or its ~57 ~16. Start a new recording in the current ~00.',
  ),
  sessionBudgetUnpriced: expandText(
    'Stopped: the ~19 budget ~43 kept on {model}, whose price this ~27 ~13 know. The ~34 ~53 sent.',
  ),
  sessionBudgetOutputLimited: expandText(
    'The response ~80 the output limit the ~19 budget left it (max_output_tokens {tokens}) and may be cut short.',
  ),
  budgetTurnCost: 'This turn cost {cost} ({spent} of {cap} used).',
  resumeFailed: expandText('~18 resume the ~00'),
  forkFailed: expandText('~18 fork the ~00'),
  rewindConversationFailed: expandText('~18 rewind the ~00'),
  sideChatFailed: expandText('~18 open a side chat'),
  sideChatPlanOnly: expandText('Side chats stay ~45.'),
  // M79 (PLAN.md D49): plans as files. {path} is the plan's workspace path.
  planActionsLabel: 'Plan actions',
  savePlan: 'Save plan',
  implementPlan: expandText('Implement in a fresh ~00'),
  planImplementDetail: expandText('A new ~00 with this plan as its brief, out of Plan mode'),
  planSaved: 'Plan saved to {path}.',
  planAlreadySaved: expandText('This plan is ~84 saved in {path}.'),
  planSaveFailed: expandText('~18 save the plan'),
  planSaveConfirm: 'Save this plan in .agents/plans?',
  planSaveConfirmDetail: expandText(
    '.agents is a protected folder: what is in it guides ~47s that work here. The plan is saved as a new file; no file is replaced.',
  ),
  planImplementFailed: expandText('~18 start the plan'),
  planRestricted: expandText('Plans ~61 saved or implemented in ~28. Trust this ~06 to use them.'),
  planWaitForTurn: 'Wait for the reply to finish, or stop it, first.',
  planReplyNotLatest: expandText('Only the latest reply ~45 can be saved as a plan.'),
  planImplementSideChat: expandText('Implement a plan ~41 main ~00; a side chat stays ~45.'),
  planBriefText: 'Implement the plan in {path}.',
  planTodosByModel: expandText(
    '~01 ~13 let the ~27 set its todo list, so the brief asks Muse to list the plan’s steps there.',
  ),
  planNamesTaken: expandText('Every file name ~35 plan is taken in .agents/plans.'),
  planFileMissing: expandText('That plan file ~58 exists.'),
  // {size}: the limit in KB.
  planTooLarge: 'This plan is larger than {size} KB, the most a plan may be.',
  planSessionGone: expandText(
    'That ~00 is ~58 open ~14 panel, so this reply can ~58 be saved or implemented as a plan.',
  ),
  planNotFromPlanTurn: expandText(
    'This reply ~53 written ~45 here, so it is not saved or implemented as a plan.',
  ),
  planHiddenMarkup: expandText(
    'The plan holds HTML that the panel ~13 show. Open {path} and read all of it before you implement it.',
  ),
  planHiddenMarkupNotStarted: expandText(
    'Plan saved to {path}, but not started: it holds HTML that the panel ~13 show. Read ~64, then implement it from Plans….',
  ),
  planSavedNotStarted: expandText(
    'Plan saved to {path}, but not started: the ~00 ~16 in the meantime.',
  ),
  planChangedNotStarted: expandText('The plan ~53 started: the ~00 ~16 in the meantime.'),
  planActionBusy: expandText('A plan action is still ~37.'),
  planUnshownCharacters: expandText(
    'This plan holds a control or format character (such as a direction override or a zero-width character) that makes the panel show it otherwise than ~38 would read it, so it is not saved or started.',
  ),
  planMarkdownUnavailable: expandText(
    'The plan reader ~03 loaded, so plans ~61 saved, listed or implemented; ~08 window. The ~17.',
  ),
  // {mode}: the permission mode's name.
  planFromFileMode: expandText(
    'A plan picked from Plans… starts in {mode}: ~64 comes ~41 ~06, so the ~00 asks before it acts.',
  ),
  // M84: a plan written in a conversation that holds imported history.
  planFromImportedMode: expandText(
    'A plan from a ~00 with imported history starts in {mode}: that history is untrusted, so the new ~00 asks before it acts.',
  ),
  planOpen: 'Open',
  plansItem: 'Plans…',
  plansItemDetail: 'Saved plans in .agents/plans: open one or implement it',
  plansTitle: 'Plans',
  plansCount: forms({ one: '{count} saved plan', other: '{count} saved plans' }),
  plansNone: expandText('No saved plans yet. Save one from a reply ~45.'),
  plansFailed: expandText('~18 list the plans'),
  // M74 (PLAN.md D49): `/handoff` to a new conversation. {goal} is the goal
  // typed after the command; {size} is the brief size limit in KB.
  handoffItem: '/handoff',
  handoffDetail: expandText('Distil this ~00 into a brief for a fresh one'),
  handoffRequestCard: expandText('Hand off to a new ~00.'),
  handoffRequestCardWithGoal: expandText('Hand off to a new ~00: {goal}.'),
  handoffDialogTitle: expandText('Hand off to a new ~00'),
  handoffDialogBody: expandText(
    'Review the brief, edit it if you need to, then start the new ~00. Nothing starts until you confirm.',
  ),
  handoffConfirm: expandText('Start new ~00'),
  handoffUnavailable: expandText('Handoff runs on the ~04 ~21 only.'),
  handoffEmpty: expandText('There is ~81 to hand off yet.'),
  handoffBusy: expandText('A handoff is ~84 ~37.'),
  handoffWaitTurn: 'Wait for the reply to finish, or stop it, first.',
  handoffSideChat: expandText('Start a handoff ~41 main ~00.'),
  handoffInterrupted: expandText('The handoff ~34 ~42 finish; ~81 was started.'),
  handoffFailed: expandText('~18 prepare the handoff'),
  // After handoffFailed: the distillation turn ended with no reply text.
  handoffNoBrief: 'The model returned no brief.',
  handoffTooLarge: expandText('The brief is larger than {size} KB; start the new ~00 by hand.'),
  handoffChangedNotStarted: expandText('The handoff ~53 started: the ~00 ~16 in the meantime.'),
  // {mode}: the permission mode's name. The model wrote the brief, so it
  // starts in the starting mode only when the dialog showed all of it.
  handoffUnshownMode: expandText(
    'The new ~00 starts in {mode}: the brief holds a control or format character (such as a direction override or a zero-width character) that the dialog ~13 show, so you ~42 see all of it.',
  ),
  planOpenFailed: expandText('~18 open the plan'),
  sideChatSessionOnly: expandText('This side chat can open only side-chat ~00s.'),
  renameFailed: expandText('~18 rename the ~00'),
  sandboxOffProfileNotice: expandText(
    "This ~06 is under your user profile, where ~01's Windows sandbox cannot run ~20s, so this window runs shell ~20s without the sandbox, directly as you. Approval prompts still apply. Setting: ~82.shellSandbox.",
  ),
  rulesFileNoWorkspace: expandText('Open a folder first; AGENTS.md lives in the ~06 root.'),
  rulesFileExists: expandText('AGENTS.md ~84 exists ~14 ~06; opening it.'),
  rulesFileCreated: expandText('AGENTS.md created. Muse reads it as ~51 rules ~41 next ~00.'),
  terminalCliMissing: expandText('The ~01 CLI is not ~26, so there is no terminal to open.'),
  signedOutNotice: expandText('Signed out of ~50.'),
  // The Agent map, the usage modal, the banner and the compact button (M14).
  agentsPillTitle: 'Show the agent map',
  agentsCount: forms({ one: '{count} agent', other: '{count} agents' }),
  // M46: the header pill while background work runs and no agent is shown.
  backgroundTasksPillTitle: expandText('Show the ~44 tasks'),
  agentMapTitle: 'Agent map',
  agentMapHint: 'click an agent for details',
  agentMapEmpty: expandText('No subagents ~14 ~00.'),
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
  agentTranscriptLoading: expandText('Reading ~47’s transcript…'),
  agentTranscriptFailed: expandText('~18 read ~47’s transcript'),
  /** The Agent map's owner controls (M18). */
  agentInterrupt: 'Interrupt',
  agentStop: 'Stop',
  agentResume: 'Resume',
  agentClose: 'Close agent',
  agentReopen: 'Reopen agent',
  agentReadResult: 'Mark result read',
  agentSendMessage: 'Send message',
  agentFollowup: 'Follow-up task',
  agentMessagePlaceholder: expandText('A note ~35 agent, or its next task…'),
  agentControlsLabel: 'Agent controls',
  agentControlFailed: expandText('The agent ~20 was refused'),
  agentResultText: 'Result',
  agentNoTranscript: expandText('No transcript ~35 agent.'),
  agentTranscriptLabel: 'Agent transcript',
  agentDelegationOff: expandText(
    '~01’s subagent delegation is off (its default), so ~38 has no agent tools ~14 ~00. Set run.subagent_delegation_mode to "auto" in the ~01 ~22 file to enable it; the ~27 never edits that file.',
  ),
  agentOpenMuseSettings: expandText('Open the ~01 ~22 file'),
  museSettingsMissing: expandText('~01 has not written a ~22 file yet. It would be at {path}'),
  // Workflows (M47, PLAN.md D40): a run's card, its agents and controls, the
  // Workflow tool's row, and Muse Code's trigger setting in the Agent map.
  workflowRowLabel: 'Workflow',
  // A run the model wrote for this task, not a saved one.
  workflowGenerated: expandText('Written ~35 task'),
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
    auto: expandText(
      '~01’s workflows are on auto: ~38 may start one on its own for large work, and starts one when you ask. Each workflow agent makes its own model calls.',
    ),
    explicit: expandText(
      '~01’s workflows are on explicit: ~38 starts one only when you ask for it.',
    ),
    off: expandText('~01’s workflows are off: ~38 has no workflow tool.'),
  },
  workflowTriggerOther: expandText('~01’s workflow ~79 is {mode}.'),
  workflowTriggerHowTo: expandText(
    'Set run.workflow_trigger_mode to "auto", "explicit" or "off" in the ~01 ~22 file to change it; the ~27 never edits that file.',
  ),
  // The Workflow tool's row.
  workflowLaunched: expandText('Launched: it runs in the ~44 and reports back to this ~00.'),
  workflowScriptSaved: 'Script saved at {path}',
  backgroundTasksCount: forms({
    one: expandText('{count} ~44 task'),
    other: expandText('{count} ~44 tasks'),
  }),
  backgroundTasksLabel: 'Background tasks',
  backgroundBadge: 'background',
  subagentRowLabel: 'Agent',
  usageAccount: 'Account',
  usageAddModelApiKey: 'Add Model API key',
  usageReplaceModelApiKey: expandText('Replace ~04 key'),
  usageAuthMethod: 'Auth method',
  usageAuthCli: expandText('Meta account (~01 CLI)'),
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
  usageCostNote: expandText(
    'Estimate from Meta’s published per-token prices ~35 model’s tier; the dev.meta.ai dashboard is the bill. Prices read on {date}.',
  ),
  usageContributing: 'What’s contributing to your usage?',
  usageDay: 'Day',
  usageWeek: 'Week',
  usageContributingNote: expandText(
    'Approximate, ~41 ~01 CLI’s trace logs on this machine; other devices ~61 included.',
  ),
  usageInsightReminders: expandText(
    '{percent} of model ~72 came from ~01’s reminder agents, which run after every reply',
  ),
  usageInsightSubagents: expandText('{percent} of model ~72 came from subagents'),
  usageInsightLong: expandText('{percent} of model ~72 came from ~19s active for 8+ hours'),
  usageInsightNone: expandText('No CLI activity recorded ~14 window.'),
  usageInsightUnavailable: expandText(
    'Not available on this ~21: the ~04 has no local trace logs.',
  ),
  usageInsightNoLogs: expandText('No ~01 trace logs were found on this machine yet.'),
  usageInsightTotals: expandText('{~72} across {~19s}'),
  modelAttemptsCount: forms({
    one: '{count} model attempt',
    other: expandText('{count} model ~72'),
  }),
  sessionsCount: forms({ one: '{count} session', other: '{count} sessions' }),
  durationNow: 'now',
  contextCompactTitle: 'Click to compact now',
  unsupportedFileTitle: 'Unsupported file type:',
  unsupportedFileDetail: expandText(
    'Supported as uploads: images (PNG, JPEG, GIF, WebP). Other files go in as @ mentions inside the ~06, or by absolute path in the prompt for files outside it.',
  ),
  bannerDismiss: 'Dismiss',
  trustGrantedNotice: expandText(
    'Workspace trusted: Muse will load its rules, skills and memory ~41 next ~10.',
  ),
  sandboxRestartNotice: expandText(
    'A ~01 ~79 ~16; ~01 restarts with it on the next ~10 and continues this ~00.',
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
    manual: expandText('Muse will ask before ~37 ~20s; ~01 edits ~06 files ~25'),
    acceptEdits: expandText(
      'On ~01, the same as Manual: ~01 edits ~06 files ~25 and asks before ~37 ~20s',
    ),
    plan: 'Muse will explore the code and present a plan before editing',
    auto: expandText('~01 runs the ~20s it judges simple ~25 and asks before the rest'),
    bypassPermissions: expandText('Muse will edit files and run ~20s ~25'),
  },
  museCodeReviewedAutoDetail: expandText(
    '~01 runs the ~20s it judges simple ~25; a reviewer may allow some others once, and you are asked about the rest',
  ),
  modelApiPermissionModeDetails: {
    manual: expandText('Muse will ask for ~39 before each edit and each ~20'),
    acceptEdits: expandText('Muse will edit files ~25 and ask before ~37 ~20s'),
    auto: expandText('Muse will edit files ~25, except protected files, and ask before ~20s'),
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
    cron_delete: expandText('Cancel ~32'),
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
    personal_project: expandText('Your memory ~35 ~51'),
    project: expandText('Project memory, shared with the ~88'),
    personal: expandText('Your memory for every ~51'),
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
  goalEditedNotice: expandText('Goal ~16: {objective}'),
  goalPausedNotice: 'Goal paused',
  goalResumedNotice: 'Goal resumed',
  goalClearedNotice: 'Goal cleared',
  goalNone: expandText('There is no goal ~14 ~00. Set one with /goal <objective>.'),
  goalWakeWithdrawn: expandText('Goal work ~31 before it started.'),
  goalRequestSuperseded: expandText('The goal ~16 while this response was in progress.'),
  goalCannotPause: 'Only an active goal can be paused.',
  goalCannotResume: 'Only a paused goal can be resumed.',
  goalCannotEdit: expandText(
    'Only an active or paused goal can be ~16; set a new one with /goal <objective>.',
  ),
  goalObjectiveMissing: 'Type the objective after /goal.',
  // {limit} is the maximum objective length, formatted in the user's locale.
  goalObjectiveTooLong: 'Keep the goal objective within {limit} characters.',
  goalCommandFailed: expandText('The goal ~20 failed'),
  // A goal command the backend already had when a key activation or a
  // backend restart came: whether it took is not known.
  goalOutcomeUnknown: expandText(
    'The sign-in ~16 or the ~21 restarted while the goal ~20 ran: it may or may not have taken effect. Check the ~19 goal.',
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
  loopItemDetail: expandText('Schedule a prompt ~14 ~04 ~00'),
  loopSyntax:
    'Use /loop 10m <prompt>, /loop "0 9 * * 1-5" <prompt>, /loop list, or /loop cancel <id>.',
  schedulePanelLabel: expandText('Scheduled prompts ~35 ~00'),
  schedulePanelTitle: 'Scheduled prompts',
  schedulePanelScope: expandText('~04 · this ~06, ~00 and key'),
  scheduleEvery: 'Every {duration}',
  schedulePending: 'Due · waiting for you to run it',
  scheduleRun: 'Run now (paid)',
  scheduleCancel: 'Cancel schedule',
  scheduleEnablePaid: 'Enable paid runs',
  scheduleRunJob: expandText('Run ~32 {id}'),
  scheduleEnableJob: expandText('Enable paid runs for ~32 {id}'),
  scheduleCancelJob: expandText('Cancel ~32 {id}'),
  scheduleCreated: 'Scheduled prompt {id} created. It will wait for you when due.',
  scheduleCancelled: 'Scheduled prompt {id} cancelled.',
  scheduleUnknown: expandText('Scheduled prompt {id} ~53 found ~14 ~00 and key.'),
  scheduleCommandFailed: expandText('The schedule ~20 failed'),
  scheduleModelApiOnly: expandText(
    'These schedules belong to the ~04 ~21. Ask ~01 to manage its own cron jobs in chat.',
  ),
  scheduleAccountMissing: expandText('Store a ~04 key to use schedules.'),
  scheduleStorageMissing: expandText('Workspace storage is unavailable; this schedule ~43 saved.'),
  scheduleInvalid: expandText('The ~32 or cadence is invalid.'),
  scheduleTooMany: expandText('This ~00 has ~80 its ~32 limit.'),
  scheduleNoFire: 'This cadence has no run within the seven-day schedule lifetime.',
  schedulePaidOff: expandText(
    'Turn on Scheduled prompts (paid) and accept its price before ~37 a due prompt.',
  ),
  scheduleBusy: expandText('Wait for the current turn to finish before ~37 this prompt.'),
  scheduleNotDue: expandText('This ~32 is not due or is ~58 available.'),
  scheduleAlreadyRun: expandText(
    'This occurrence was ~84 admitted in another window or before a restart.',
  ),
  scheduleRunStarted: expandText('Started with your permission. ~04 tokens are ~23 key.'),
  scheduleRunConfirmTitle: expandText('Run this ~32 with {model}?'),
  scheduleRunConfirmPrompt: 'Prompt: {prompt}',
  scheduleRunConfirmPrice: expandText('~69 ~04 key: {price}. Total varies with tokens used.'),
  scheduleRunConfirmExtras: expandText(
    'Other enabled paid tools may add their own charges. Bypass ~13 skip this confirmation.',
  ),
  scheduleConfirmationExpired: expandText(
    'The model, ~00 or prompt ~16 during confirmation. Review the schedule and choose Run again.',
  ),
  webNoResults: 'No results',
  backgroundRunning: expandText('Running in the ~44'),
  // M46 (PLAN.md D39): moving a running command to the background, stopping
  // background work, and the user's own `!` shell commands.
  moveToBackground: 'Move to background',
  moveToBackgroundTitle: expandText('Keep this ~20 ~37 in the ~44 and let Muse carry on'),
  moveToBackgroundFailed: expandText('The ~20 ~03 moved to the ~44'),
  nothingToMoveToBackground: expandText('No ~20 is ~37 that could move to the ~44'),
  stopTask: 'Stop',
  stopTaskTitle: expandText('Stop this ~44 task'),
  stopUserShellTitle: 'Stop this command',
  stopAllTasks: 'Stop all',
  stopAllTasksTitle: expandText('Stop every ~44 task of this ~00'),
  stopTaskFailed: expandText('The ~44 task ~03 ~31'),
  taskNotRunning: expandText('That task is not ~37 any more'),
  userShellLabel: 'You ran',
  userShellExitCode: 'Exit code {code}',
  userShellExitSignal: 'Ended by signal {signal}',
  userShellRestricted: expandText(
    'Shell ~20s do not run while the ~06 is in ~28. Trust the ~06 to run them.',
  ),
  userShellNotGranted: expandText('This ~01 ~42 allow shell ~20s ~41 panel'),
  userShellFailed: expandText('The ~20 ~42 run'),
  composerShellMode: 'Shell',
  composerShellModeTitle: expandText(
    'Runs this ~20 in the ~06, as you. Muse sees the ~20 and what it printed.',
  ),
  runCommandTitle: 'Run command',
  toolImageAlt: 'The image {path}',
  toolImageFailed: expandText('The image ~03 shown'),
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
  bundledSkillsOffer: expandText(
    '~50 comes with the skills {skills}. Install them for ~01? They are copied into your Muse config folder.',
  ),
  bundledSkillsUpdateOffer: expandText(
    '~50 comes with a newer release of its ~68 ({tag}). Update the copy ~01 uses?',
  ),
  bundledSkillsInstall: 'Install',
  bundledSkillsUpdate: 'Update',
  bundledSkillsNotNow: 'Not now',
  bundledSkillsInstalled: forms({
    one: expandText('Installed {count} bundled skill ({tag}) for ~01: {skills}'),
    other: expandText('Installed {count} ~68 ({tag}) for ~01: {skills}'),
  }),
  bundledSkillsSkipped: forms({
    one: 'Left {count} skill out because a skill of yours has that name: {skills}',
    other: 'Left {count} skills out because skills of yours have those names: {skills}',
  }),
  bundledSkillsRemoved: forms({
    one: expandText('Removed {count} bundled skill from ~01: {skills}'),
    other: expandText('Removed {count} ~68 from ~01: {skills}'),
  }),
  bundledSkillsNothingToRemove: expandText('No ~68 are ~26 for ~01, so ~81 was removed.'),
  bundledSkillsInstallFailed: expandText('The ~68 ~03 ~26 at {folder}: {reason}'),
  bundledSkillsRemoveFailed: expandText('The ~68 ~03 removed at {folder}: {reason}'),
  // The reason when the folder is there but holds no mark of the extension's install.
  bundledSkillsNotOurs: expandText(
    'a folder of that name exists that ~50 ~42 install, so it was left alone',
  ),
  bundledSkillsUnavailable: expandText('The ~68 installer ~03 loaded; ~08 window. The ~17.'),
  // The conversation's notices (they were English literals in the controller).
  notSignedInReason: expandText('Sign in before sending a ~10.'),
  noWorkspaceReason: expandText('Open a folder first; Muse works inside a ~06.'),
  nothingToSendReason: expandText('Type a ~10 or attach an image first.'),
  nothingToCompact: 'Nothing to compact yet.',
  // {reason}: the backend's own id for why, such as `noop`.
  nothingToCompactReason: 'Nothing to compact ({reason}).',
  compactionFailed: 'Compaction failed',
  answerNotAccepted: expandText('The answer ~53 accepted'),
  outputLoadFailed: expandText('~18 load the output'),
  outputLoadRetry: expandText(
    '~01 may be busy: collapse and expand the row to ~55. Further failures go to the log only.',
  ),
  editReviewFailed: expandText('~18 review the edit'),
  modelSwitchFailed: expandText('~18 switch model'),
  effortNotApplied: expandText('Reasoning effort ~03 applied'),
  permissionModeNotApplied: expandText('~18 apply the ~15'),
  permissionModeChangeFailed: expandText('~18 change the ~15'),
  // {action}: the panel's id for a host command, such as `openSettings`.
  hostActionFailed: '{action} failed',
  contributorResumeFallbackTo: expandText(
    'The resumed ~00 was on a contributor-tier model; it now uses {model}.',
  ),
  // Edit review's outcomes, per file (M5).
  editRevertedPath: 'Reverted {path}.',
  editCreatedRemovedPath: '{path}: Moved to the trash (Muse created it).',
  modelApiNeedsFolder: expandText('Open a folder first; the ~04 ~21 works inside a ~06.'),
  modelApiBundleUnavailable: expandText('The ~04 ~21 ~03 loaded; ~08 window. The ~17.'),
  // The same in the ACP agent (D62), whose package ships the bundle.
  acpModelApiBundleUnavailable: expandText(
    'The ~04 ~21 ~03 loaded; reinstall muse-spark-code-acp and restart ~47. The agent’s ~17.',
  ),
  // Why the Muse Code CLI was not found, on the sign-in page and in warnings.
  cliNotFound: expandText('~01 is not ~26 in any known location.'),
  cliPathNotAbsolute: expandText('~82.museBinaryPath must be an absolute path.'),
  cliSearched: 'Searched: {paths}',
  // The ACP agent in other editors (M63, PLAN.md D61, D62): its sign-ins,
  // the key's commands, its errors and its help.
  acpAuthMuseCodeName: 'Sign in to Muse Code',
  acpAuthMuseCodeDetail: expandText(
    'Runs ~01’s own sign-in in a terminal. Your Muse ~56 pays for the ~00s.',
  ),
  acpAuthKeyName: expandText('Store a Meta ~04 key'),
  acpAuthKeyDetail: expandText(
    'Reads your key in a terminal and keeps it ~14 computer’s credential store. The key is billed for the ~00s.',
  ),
  // {command}: the sign-in command, for a client that cannot run it itself.
  acpSignInByHand: expandText('Run “{~20}” in a terminal, then ~55.'),
  acpMuseCodeSignedOut: expandText('~01 is not signed in; sign in and ~55.'),
  acpNoStoredKey: expandText('No Meta ~04 key is stored; store one and ~55.'),
  acpKeyPrompt: expandText('Meta ~04 key (not shown as you type): '),
  // {store}: where the key lives (acpStoreNames).
  acpKeyStored: 'The key is stored in {store}.',
  acpKeyNotStored: expandText('No key was entered, so ~81 was stored.'),
  acpKeyPresent: expandText('A Meta ~04 key is stored in {store}.'),
  acpKeyAbsent: expandText('No Meta ~04 key is stored.'),
  acpKeyCleared: expandText('The Meta ~04 key was removed from this computer’s credential store.'),
  // {reason}: the operating system's own error.
  acpStoreUnavailable: expandText(
    'This computer’s credential store ~43 used ({reason}). On Linux ~47 needs a ~37, unlocked Secret Service, such as GNOME Keyring or KWallet.',
  ),
  acpStoreNames: {
    windows: 'Windows Credential Manager',
    macos: 'the macOS Keychain',
    linux: 'the Secret Service keyring',
  },
  acpNoModels: expandText('The ~21 offers no model this agent may use.'),
  acpPromptBusy: expandText('A prompt is ~84 ~37 ~14 ~19.'),
  acpQuestionFormMessage: 'Muse has a question for you.',
  acpQuestionAsked: expandText(
    'Muse has a question; this editor cannot show it as a form, so answer in ~78 ~10:',
  ),
  acpUnknownArgument: 'Unknown argument: {argument}',
  // {argument}: the paid feature's flag as typed.
  acpPaidNeedsModelApi: expandText(
    '{argument} needs --~21 modelApi: paid features bill a ~04 key.',
  ),
  // {command}: the executable's name. The options and values stay as typed.
  acpUsage: [
    'Usage:',
    expandText(
      '  {~20} [options]              Serve the Agent Client Protocol on stdin and stdout',
    ),
    expandText('  {~20} [options] login        Sign in to ~01 ~14 terminal'),
    expandText('  {~20} auth set|status|clear  Store, check or remove the Meta ~04 key'),
    expandText('  {~20} exec [options] <prompt>  Run one headless turn'),
    expandText(
      '  {~20} scan-secrets <file> [--key-stdin]  Count likely secrets in one file (prints only the number)',
    ),
    expandText('  {~20} legal [options]  Run the read-only legal scan (no ~21, no sign-in)'),
    'Options:',
    expandText('  --~21 museCode|modelApi      Who pays: ~01 (the default) or the ~04 key'),
    expandText('  --trust-~06                Load the folder’s rules, skills and memory'),
    expandText('  --muse-binary <path>             The ~01 CLI to run'),
    expandText('  --shell-sandbox auto|muse|off    ~01’s shell sandbox'),
    expandText('  --allow-dangerously-skip-~57  Offer the Bypass ~57 mode'),
    '  --allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    expandText(
      '  --web-search                     Offer paid web search (~04 ~21; its price is asked first)',
    ),
    expandText(
      '  --image-generation               Offer paid image generation (~04 ~21; its price is asked first)',
    ),
    '  --verbose                        Log every detail on stderr',
    '  --help, --version',
  ].join('\n'),
  // M80 (PLAN.md D65): the headless exec and scan-secrets commands.
  execBudgetRequired: expandText('~04 requires --max-budget-usd.'),
  execNumberInvalid: 'Invalid number or limit; the USD budget accepts at most six decimal places.',
  execTrustRefused: expandText('Headless runs refuse ~06 trust and bypass ~57.'),
  execModeRefused: 'Headless runs permit only plan or acceptEdits.',
  execWebSearchUnbounded: expandText('Hosted web search has no bounded allowance and is refused.'),
  execPaidNeedsEdits: 'Image generation requires acceptEdits.',
  execModelApiOnly: expandText('These options require the ~04 ~21.'),
  execMuseCodeOnly: expandText('These options require the ~01 ~21.'),
  execModelUnpriced: 'This model has no known tariff.',
  execPromptMissing: 'Provide one nonempty prompt.',
  execPromptTwice: 'Choose exactly one prompt source.',
  execStdinTwice: 'Prompt and key cannot both use stdin.',
  execKeyStdinTerminal: 'Read the key from a pipe, not a terminal.',
  execKeyMissing: expandText('No valid ~04 key was provided.'),
  execKeyTooLong: expandText('The key ~59 byte limit.'),
  execFileUnreadable: expandText('The input file ~43 read.'),
  execFileTooLarge: expandText('The input ~59 byte limit.'),
  execTooManyChunks: expandText('The input ~59 chunk limit.'),
  execUnknownModel: expandText('This model ~48 ~35 run.'),
  execEffortUnavailable: expandText('This effort ~48 ~35 model.'),
  execTimedOut: expandText('The run ~80 its deadline.'),
  execBudgetRefused: expandText('The next ~34 ~59 remaining budget.'),
  execBudgetMinimum: 'This run requires at least {minimum}.',
  execBudgetBreach: 'Observed accounting exceeded its reservation.',
  execIncomplete: expandText('The response ~42 complete.'),
  execDeniedStop: expandText('An ~39 denial ~31 this run.'),
  execInterrupted: 'The run was interrupted.',
  execOutputStalled: 'Output closed or stalled.',
  execRequestShape: expandText('The ~34 shape is not permitted.'),
  execAccountingInvalid: 'Response accounting is invalid.',
  execAccountingUnverified: expandText('Response accounting ~03 verified.'),
  execMessageWithheld: expandText('~10 withheld: the response ~42 complete'),
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
    one: expandText('The ~34 cap of {count} attempt was ~80.'),
    other: expandText('The ~34 cap of {count} ~72 was ~80.'),
  }),
  execScanMatches: forms({
    one: '{count} secret match',
    other: '{count} secret matches',
  }),
  execUsage: 'exec [options] <prompt> | exec [options] --prompt-file <path> | exec [options] -',
  execScanUsage: 'scan-secrets <file> [--key-stdin]',
  execSummary: expandText(
    '{status}; ~34s {~34s}; settled {settled}; uncertain {uncertain}; image ~72 {imageAttempts}; returned {imagesReturned}; uncertain images {imagesUncertain}',
  ),
  execSummaryUpperBound: expandText(
    '{status}; ~34s {~34s}; settled {settled}; uncertain {uncertain}; image ~72 {imageAttempts}; returned {imagesReturned}; uncertain images {imagesUncertain}; Cost is an upper bound.',
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
    one: expandText('The output ({count} byte) is stored by the ~21 and not included.'),
    other: expandText('The output ({count} bytes) is stored by the ~21 and not included.'),
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
  insertReferencePanelOpened: expandText(
    'Opened the ~50 panel. Press Alt+K again to insert the reference.',
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
    palette: expandText('opens the actions palette: model, effort, ~15, history'),
    cycleMode: expandText('cycles the ~15 while the composer has focus'),
    mentionSelection: 'inserts an @-mention of the editor selection',
    mentionFile: 'mentions a file; drag files or paste images to attach them',
    newTab: expandText('opens a ~00 in a new editor tab'),
    dictation: 'records your voice into the composer (tap to toggle, hold to talk)',
    shell: expandText(
      'at the start of a ~10 runs it as a shell ~20 in the ~06; Muse sees what it printed',
    ),
    moveToBackground: expandText('moves a ~37 ~20 to the ~44, so Muse carries on'),
  },
  // M26 (PLAN.md D29): dictation in a remote window, and a macOS helper that
  // ends before it is ready.
  dictationUnavailableRemote: expandText(
    '~62 ~48 in a remote window (SSH, WSL, a container, a tunnel or a codespace): the ~27 runs on the remote machine, which cannot hear this computer’s microphone. Open the folder in a local window to dictate.',
  ),
  dictationDarwinEarlyExit: expandText(
    'macOS ended the dictation helper before it was ready. After a permission step, macOS refused that permission (to muse-dictate, or to the app that started it where the helper ~49 ask under its own name); with no step at all, macOS refused to run the helper itself, ~93 notarised. The README’s ~62 section explains both.',
  ),
  museLoginTerminalName: 'Muse Code sign-in',
  // Muse Code's documented exit codes (SDK `classifyExit`): what each means
  // for the user; whether restarting can help is MUSE_EXIT_PERSISTENT_CODES.
  museExitMeanings: {
    0: 'Muse Code stopped',
    1: expandText('~01 failed with an unhandled error'),
    2: expandText('~01 rejected its ~20 line (a usage error)'),
    3: expandText('~01 refused its configuration; check its ~22.json and ~82.environmentVariables'),
    4: expandText('another ~01 client holds this ~19; it frees once that client exits'),
    5: expandText('this ~01 build ~13 serve the SDK surface the ~27 uses; update ~01'),
  },
  museExitedWithCode: expandText('~01 exited with code {code}'),
  museExitMeaning: '{meaning} (exit code {code})',
  museStoppedBySignal: expandText('~01 was ~31 by {signal}'),
  museUnknownSignal: 'an unknown signal',
  // The paid Model API features (M33–M35, PLAN.md D30): opt in and loud.
  // {price} is a dollar amount in the display language's money format.
  paidWebSearchName: 'Web search',
  paidImageGenerationName: 'Images',
  paidVoiceName: 'Muse Voice',
  paidScheduledName: 'Scheduled prompts',
  paidSubagentsName: 'Subagents',
  paidSubagentRates: expandText(
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; up to {limit} ~34s per task, including retries.',
  ),
  paidSubagentTaskTitle: 'Approve paid task for {role}?',
  paidSubagentTaskDetail: expandText(
    '{objective}\n\n{price}\n\n~69 ~04 key. ~36. Other enabled paid tools are charged separately. Allow once covers this task only.',
  ),
  // The popup before each paid use (M58): its buttons, and the two uses that
  // have no popup of their own. "Allow once" is `allowOnce`.
  paidAllowAlways: expandText('Allow always ~14 ~06'),
  paidDeny: 'Deny',
  paidUseWebSearchTitle: expandText('Let Muse search the web ~35 prompt?'),
  paidUseWebSearchDetail: expandText(
    'Muse may search the web while it answers. Each search is ~23 ~04 key at {price}, on top of the tokens its results add. Deny sends the prompt without web search.',
  ),
  paidUseVoiceTitle: expandText('Record with ~24?'),
  paidUseVoiceDetail: expandText(
    '~24 transcribes this recording, ~23 ~04 key at {price}. Deny leaves the microphone off.',
  ),
  paidWebSearchPrice: '{price} per 1,000 searches',
  paidImagePrice: '{price} per image',
  paidVoicePrice: '{price} per hour of audio',
  paidScheduledPrice: '{input}/1M input, {cached}/1M cached input, {output}/1M output tokens',
  // The confirmation shown when a paid feature is turned on; {feature} is its name.
  paidConfirmTitle: 'Turn on {feature}?',
  paidConfirmWebSearch: expandText(
    'The model may search the web while it answers. Each search is ~23 ~04 key at {price}, on top of the tokens its results add. Each prompt asks first, ~46 web search always ~14 ~06. Used on the ~04 ~21 only.',
  ),
  paidConfirmImage: expandText(
    'The model may create image files in the ~06, or edit ~06 images into new ones. Each image is ~23 ~04 key at {price}, and you are asked before every one, in every ~15, ~46 images always ~14 ~06. Used on the ~04 ~21, and on the ~01 ~21 while a key is stored (never billed to the ~56).',
  ),
  paidConfirmVoice: expandText(
    'The microphone will send what you record to Meta’s ~24 Transcribe instead of your computer’s own recogniser, ~23 ~04 key at {price}. Each recording asks first, ~46 ~24 always ~14 ~06. Used on the ~04 ~21, and on the ~01 ~21 while a key is stored.',
  ),
  paidConfirmScheduled: expandText(
    'A due ~32 waits for you to run it. Each run asks before any ~04 call, ~46 scheduled runs always ~14 ~06. {price}. ~69 ~04 key; total varies with tokens used.',
  ),
  paidConfirmSubagents: expandText(
    'Child agents make additional ~34s ~23 ~04 key. {price} Each new task asks for ~39 in every ~15, including Bypass, ~46 subagents always ~14 ~06. ~36; other paid tools cost extra. ~04 ~21 only.',
  ),
  paidBestOfNName: 'Best of N',
  paidBestOfNRates: expandText(
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; {~72} ~72 with up to {limit} ~34s each, including retries.',
  ),
  paidBestOfNTitle: expandText('Run {~72} paid ~72?'),
  paidBestOfNDetail: expandText(
    '{prompt}\n\n{price}\n\n~69 ~04 key. ~36. Allow once covers this run only.',
  ),
  paidConfirmBestOfN: expandText(
    'The same prompt runs in separate worktrees, each ~23 ~04 key. {price} Each run asks for ~39 in every ~15, including Bypass, ~46 best-of-N always ~14 ~06. ~36; other paid tools cost extra. ~04 ~21 only.',
  ),
  usagePaidBestOfNAttempts: forms({ one: '{count} attempt', other: '{count} attempts' }),
  usagePaidBestOfNIncluded: 'Reported token estimate: {cost}',
  // The session board (M77, PLAN.md D49).
  boardTitle: 'Session board',
  boardUnavailable: expandText(
    'The ~19 board and best-of-N ~03 loaded. Reinstall the ~27 and ~55.',
  ),
  boardEmpty: expandText('No ~00s yet. Send a ~10 to start one.'),
  boardStatusRunning: 'Running',
  boardStatusIdle: 'Idle',
  boardAwaitingApproval: forms({
    one: expandText('{count} ~39 waiting'),
    other: expandText('{count} ~39s waiting'),
  }),
  boardChanges: forms({ one: '{count} changed file', other: expandText('{count} ~16 files') }),
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
  bestOfNContextChanged: expandText('The account, ~00 or run ~16. Start a new run.'),
  bestOfNTargetChanged: expandText(
    'The checkout ~16, has unsaved edits, or contains protected or linked targets. ~63 applied.',
  ),
  bestOfNBudgetUnavailable: expandText(
    'Best-of-N cannot start under a ~19 budget until its ~72 share the originating budget.',
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
  bestOfNCeilingReached: expandText('~31 at the ~34 ceiling'),
  bestOfNRequests: forms({ one: '{count} request', other: '{count} requests' }),
  bestOfNApprovalsDenied: forms({
    one: expandText('{count} ~39 declined'),
    other: expandText('{count} ~39s declined'),
  }),
  bestOfNAttemptFailed: 'Failed: {reason}',
  bestOfNTakenMark: 'Took {branch}',
  bestOfNDiffClipped: 'Diff clipped.',
  bestOfNInvalidPrompt: expandText('Describe what the ~72 should do.'),
  bestOfNInvalidRequest: 'That best-of-N run is outside the attempt or ceiling bounds.',
  bestOfNInvalidAttempts: 'Attempts must be between {min} and {max}.',
  bestOfNInvalidCeiling: 'Requests per attempt must be between {min} and {max}.',
  bestOfNNeedsTrust: expandText(
    'Best-of-N needs a trusted ~06: worktrees run git, which ~28 forbids.',
  ),
  bestOfNModelApiOnly: expandText(
    'Best-of-N runs on the ~04 ~21 only; each attempt is billed to the key, never to the ~56.',
  ),
  bestOfNPaidOff: 'Best-of-N is off. Enable it and accept the price before starting a run.',
  bestOfNNoWorkspace: 'Best-of-N needs an open folder.',
  bestOfNTariffUnknown: expandText(
    'No verified price is available ~35 model. The run cannot start.',
  ),
  bestOfNConsentDeclined: expandText('The paid run ~53 approved.'),
  bestOfNAlreadyRunning: expandText('A best-of-N run is ~84 going ~14 window.'),
  bestOfNAlreadyTaken: expandText('This run ~84 took {branch}.'),
  bestOfNNoRun: 'There is no best-of-N run.',
  bestOfNUnknownAttempt: 'That attempt is not part of this run.',
  bestOfNAttemptNotDone: 'Only a finished attempt can be taken.',
  bestOfNWorktreeFailed: expandText('~18 create the attempt worktrees: {reason}'),
  bestOfNTaken: expandText('Applied and staged ~87 from {branch}.'),
  bestOfNTakeFailed: expandText(
    '~18 apply and stage {branch}. Check the checkout before retrying: {reason}',
  ),
  paidConfirmAccept: 'Turn on',
  // The composer's badge while a paid feature is on; {features} lists their names.
  paidBadge: 'Paid: {features}',
  paidBadgeTitle: expandText('~69 ~04 key: {prices}. Click ~35 window’s tally in Account & usage.'),
  // A paid call's row in the transcript.
  paidRowBadge: 'paid',
  paidRowTitle: expandText('~69 ~04 key: {price}'),
  // The palette's toggles (Model API backend only); {feature} is the name.
  paidToggleLabel: '{feature} (paid)',
  // The usage dialog's tally.
  usagePaidHeading: expandText('Paid features ~14 window'),
  usagePaidOn: 'on',
  usagePaidOff: 'off',
  // M58: a feature that no longer asks in this workspace; {features} lists names.
  usagePaidOnAlways: expandText('on, allowed always ~14 ~06'),
  usagePaidAlwaysNote: expandText('Allowed always ~14 ~06, ~25: {features}.'),
  usagePaidAskAgain: 'Ask again every time',
  usagePaidSearches: forms({ one: '{count} search', other: '{count} searches' }),
  usagePaidImages: forms({ one: '{count} image', other: '{count} images' }),
  usagePaidAudio: '{duration} of audio',
  usagePaidSubagentRequests: forms({
    one: expandText('{count} child ~34'),
    other: expandText('{count} child ~34s'),
  }),
  usagePaidSubagentUnknown: forms({
    one: expandText('{count} ~34 has no reported cost yet'),
    other: expandText('{count} ~34s have no reported cost yet'),
  }),
  usagePaidSubagentSubset: expandText(
    'Reported child costs are included in their parent ~00s’ token estimates. They ~61 added to the extra-feature total. Requests without reported usage may still be billed.',
  ),
  usagePaidExtraTotal: 'Estimated extra-feature total',
  usagePaidSubagentReported: 'Reported token estimate: {cost}',
  usagePaidTotal: 'Estimated paid total',
  usagePaidScheduled: forms({ one: '{count} scheduled run', other: '{count} scheduled runs' }),
  usageScheduledIncluded: 'token cost included above',
  usagePaidNote: expandText(
    'Estimated at Meta’s published prices, read on {date}, ~35 window since it opened; the dev.meta.ai dashboard is the bill.',
  ),
  subagentPaidOff:
    'Paid subagents are off. Enable them and accept the price before starting a child task.',
  agentToolNotOffered: expandText(
    'This tool is not ~14 agent’s allowlist. Use only the tools offered in its instructions.',
  ),
  // A custom agent refused because a folder or file of higher precedence did
  // not load (M76 review); {path} is that folder or file.
  agentUnloaded: expandText(
    'The agent “{id}” ~42 start: {path} ~03 loaded, and a definition there would take precedence. Fix or remove it, then start a new ~00.',
  ),
  subagentConsentDeclined: expandText('The paid child task ~53 approved.'),
  subagentContributorBlocked: expandText(
    'The custom agent names a contributor-tier model, which cannot run while this ~06 is confidential (~82.confidentialWorkspace).',
  ),
  subagentRequestLimit: expandText(
    'The child task ~80 its approved limit of {limit} ~34s, including retries.',
  ),
  subagentKeyChanged: expandText(
    'The ~04 key ~16 after ~39. Approve a new child task to continue.',
  ),
  subagentModelChanged: expandText(
    'The model ~16 after ~39. Approve a new child task to continue.',
  ),
  subagentGoalEnded: expandText(
    'The originating goal is ~58 active. The child task cannot make another ~34.',
  ),
  subagentTariffUnknown: expandText(
    'No verified price is available ~35 model. The child task cannot start.',
  ),
  subagentPlanMode: 'Plan mode refuses paid child tasks; switch mode and approve a new task.',
  subagentWebSearchOff: expandText('Web search was turned off ~90 child ~34; no ~34 was sent.'),
  webSearchFailed: 'The search failed',
  // Under a reply that cites web pages (M33).
  citationsHeading: 'Sources',
  // The microphone while Muse Voice is its engine (M35); {price} per hour of audio.
  dictationPaidLabel: expandText('Record voice with ~24 (paid)'),
  dictationPaidTitle: expandText('~24, paid: {price}, ~23 ~04 key. Tap or hold to record (Ctrl+D)'),
  // Why Muse Voice cannot record or transcribe.
  museVoiceNoKey: expandText('~24 needs a ~04 key; sign in with one first.'),
  museVoiceNoAnswer: expandText('~24 ~42 answer; check the connection and ~55.'),
  museVoiceNoFinal: expandText('~24 ~42 send the transcript in time; ~55.'),
  museVoiceMalformed: expandText(
    '~24 sent something that is not JSON, so the recording was dropped.',
  ),
  museVoiceRefused: expandText('~24 refused the recording'),
  museVoiceRateLimited: expandText('~24 is rate-limited ~35 key; wait a moment and ~55.'),
  // {code}: the WebSocket close code Meta sent.
  museVoiceClosed: expandText('~24 closed the connection (code {code})'),
  museVoiceNoWebSocket: expandText(
    '~24 needs WebSocket support in VS Code’s ~27 host, which this ~54 ~13 have.',
  ),
  museVoiceNoRecorder: expandText(
    '~24 on Linux records with arecord (ALSA) or parec (PulseAudio); neither was found on PATH.',
  ),
  // M56 (PLAN.md D43): why a Model API request never reached Meta; the
  // technical detail follows in parentheses.
  networkUntrustedCertificate:
    'The server’s certificate is not trusted. If your network inspects HTTPS, install its root certificate in the operating system’s certificate store (VS Code reads it while http.systemCertificates is on), or turn http.systemCertificates off and name the root’s file in NODE_EXTRA_CA_CERTS before VS Code starts.',
  networkProxyCredentials: expandText(
    'The proxy asked for ~76 and ~42 accept the ones it got. Check http.proxy and http.proxyAuthorization, or the ~76 VS Code asked you for.',
  ),
  // {status}: the HTTP status the proxy answered with.
  networkProxyRefused: expandText(
    'The proxy refused the connection (HTTP {status}). Check that it allows api.meta.ai.',
  ),
  networkUnreachable: expandText(
    'Meta’s server ~03 ~80. Check the network connection, and http.proxy and http.proxySupport if you use a proxy.',
  ),
  // The same three in the ACP agent (PLAN.md D62, Q66), where VS Code's
  // settings do not reach: they name the agent's environment variables.
  acpNetworkUntrustedCertificate: expandText(
    'The server’s certificate is not trusted. If your network inspects HTTPS, name its root certificate’s file in NODE_EXTRA_CA_CERTS in ~47’s environment, or add --use-system-ca to NODE_OPTIONS there (Node 22.15 or later) to trust the operating system’s store, then restart ~47.',
  ),
  acpNetworkProxyCredentials: expandText(
    'The proxy asked for ~76 and ~42 accept the ones it got. Check the user name and password in the proxy’s address in HTTPS_PROXY (http://user:password@host:port) in ~47’s environment, then restart ~47.',
  ),
  acpNetworkUnreachable: expandText(
    'Meta’s server ~03 ~80. Check the network connection. Behind a proxy, set HTTPS_PROXY and NODE_USE_ENV_PROXY=1 in ~47’s environment (Node 22.21 or later, or 24) and restart ~47: without NODE_USE_ENV_PROXY ~47 ~13 use the proxy.',
  ),
  // Muse Code refused a permission mode above the ceiling its configuration sets.
  approvalModeCeiling: expandText(
    '~01’s configuration (its default permission profile, or a policy your administrator manages) ~13 allow this ~15. Choose a stricter one, such as Manual, and send again.',
  ),
  // M70 (PLAN.md D49): review. The palette's rows.
  groupReview: 'Review',
  reviewItem: '/review',
  reviewItemDetail: expandText(
    'Review the uncommitted ~52, a branch, a commit, or what you describe',
  ),
  reviewUncommittedItem: expandText('Review uncommitted ~52'),
  reviewUncommittedDetail: expandText('Staged and unstaged ~52, against the last commit'),
  reviewBranchItem: 'Review this branch…',
  reviewBranchDetail: 'Every change since it left the base branch you pick',
  reviewCommitItem: 'Review a commit…',
  reviewCommitDetail: 'One of the latest commits, which you pick',
  reviewSecurityItem: 'Security review',
  reviewSecurityDetail: expandText(
    'The uncommitted ~52, for injection, secrets, authentication and unsafe APIs',
  ),
  reviewChangesItem: expandText('Review this ~00’s ~52'),
  reviewChangesDetail: 'Accept or revert each change, and comment on a line',
  // The base-branch and commit pickers.
  reviewPickBase: 'The branch to compare this one with',
  reviewPickCommit: 'The commit to review',
  reviewDefaultBase: 'default base',
  // Why a review did not start, on its card.
  reviewBusy: 'A review starts once the current turn has ended.',
  reviewRestricted: expandText(
    'Reviewing git’s ~52 needs git, which ~13 run in ~28. Trust this ~06, or say what ~94: /review <what to look at>.',
  ),
  reviewNotRepository: expandText(
    'This folder is not in a git ~88, so there are no git ~52 ~94. Say what ~94 instead: /review <what to look at>.',
  ),
  reviewNoChanges: expandText('There are no ~52 ~94.'),
  reviewOnlyPrivate: expandText(
    'Only files that may hold secrets ~16 (environment files, keys, ~76), and they ~61 sent for review.',
  ),
  reviewNoBase: 'No base branch was found to compare with. Name one: /review branch <base>.',
  // {revision}: the branch or commit named after /review.
  reviewUnknownRevision: expandText('Git ~13 know {revision} as a branch or commit.'),
  reviewNoCommits: expandText('This ~88 has no commits ~94 yet.'),
  reviewGitFailed: expandText('Git ~49 read the ~52 ~94.'),
  reviewCancelled: 'Review cancelled.',
  // The review's own module (dist/review.js) could not be loaded.
  reviewUnavailable: expandText(
    'The review ~03 loaded, so no review can start; ~08 window. The ~17.',
  ),
  reviewInstructionsTooLong: expandText(
    'What ~94 is too long for one review; say it more briefly.',
  ),
  // What went with a review, and the permission mode around a Muse Code review.
  reviewTruncatedNotice: expandText(
    'The diff is long, so only its first part went with the review; the reviewer reads the rest of the ~16 files itself.',
  ),
  reviewPrivateLeftOut: forms({
    one: expandText('{count} ~16 file that may hold secrets was named but not sent for review.'),
    other: expandText(
      '{count} ~16 files that may hold secrets were named but not sent for review.',
    ),
  }),
  reviewPlanModeNotice: expandText(
    'This review runs ~45, and the ~15 you had comes back when it ends. ~01 applies its own allow rules ~45, so a review there is not strictly read-only.',
  ),
  // {mode}: the permission mode's name.
  reviewModeRestored: expandText('The review ended: the ~15 is {mode} again.'),
  reviewModeNotRestored: expandText('The ~15 ~03 set back after the review, so the ~00 stays ~45'),
  reviewAlreadyReverted: expandText('This change was ~84 reverted.'),
  // The review pane.
  reviewPaneTitle: expandText('Changes ~14 ~00'),
  reviewPaneLoading: 'Reading the changes…',
  reviewPaneEmpty: expandText('This ~00 has not ~16 any files.'),
  reviewPaneFiles: forms({ one: '{count} file', other: '{count} files' }),
  reviewPaneHunks: forms({ one: '{count} change', other: '{count} changes' }),
  reviewPaneAccepted: forms({ one: '{count} accepted', other: '{count} accepted' }),
  reviewPaneReverted: forms({ one: '{count} reverted', other: '{count} reverted' }),
  reviewPaneOmitted: forms({
    one: expandText(
      '{count} edit is not listed here (too many to show, or its change ~03 read); its row in the transcript still opens it.',
    ),
    other: expandText(
      '{count} edits ~61 listed here (too many to show, or their ~52 ~03 read); their rows in the transcript still open them.',
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
  reviewCommentPlaceholder: expandText('What should ~47 know or change here?'),
  reviewSendSteer: expandText('Send to the ~37 turn'),
  reviewSendNext: expandText('Send as the next ~10'),
  reviewCommentCancel: 'Cancel',
  // {line}: a line number; {text}: that line's code.
  reviewLineOption: 'Line {line}: {text}',
  reviewRemovedLineOption: 'Removed line {line}: {text}',
  reviewOpenFile: 'Open file',
  reviewCommentSent: expandText('Comment sent to ~47'),
  // What the live region says when a change's Revert settles; {name} is reviewHunkName.
  reviewAnnounceReverted: '{name} reverted',
  reviewAnnounceNotReverted: '{name} not reverted: {reason}',
  // The findings list under a review's reply.
  reviewFindingsLabel: 'Review findings',
  reviewFindingsHeading: forms({ one: '{count} finding', other: '{count} findings' }),
  reviewNoFindings: expandText('The review found ~81 to report.'),
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
  codeIntelPolicyRefused: expandText('File ~57 refuse this code intelligence operation.'),
  // A tool call the permission settings stopped allowing while it was in
  // progress: at its process, its write or its request, or once it was done.
  policyChangedRefused: expandText(
    'The permission ~22 ~16 while this was in progress and ~58 allow it. It was refused, and ~81 from it was sent to ~38.',
  ),
  // The same, for a call whose change was already written by then.
  policyChangedKeptWrite: expandText(
    'The permission ~22 ~16 while this was in progress and ~58 allow it. Its change was ~84 written and stays; ~81 from it was sent to ~38.',
  ),
  approvalAskRuleNote: expandText('Your ~20 rule asks about this ~20 every time.'),
  // {why}: the rule's own justification, as the user wrote it.
  approvalAskRuleWhy: expandText('Your ~20 rule asks about this ~20 every time: {why}'),
  // Who answered a call no card was shown for (the row's "Decided" line).
  autoReviewerResolver: 'Auto reviewer',
  commandRuleResolver: 'Command rule',
  // The Auto reviewer's row and the card it leaves; {reason}: the reviewer's own words.
  autoReviewAllowed: 'Allowed: {reason}',
  autoReviewAsked: 'Asks you: {reason}',
  autoReviewerFailed: expandText('The Au~94er ~49 answer, so you decide.'),
  autoReviewerUnreadable: expandText('The Au~94er’s answer ~03 read, so you decide.'),
  autoReviewerPaused: expandText(
    'The Au~94er is paused ~35 turn after repeated declines or failures, so you decide.',
  ),
  autoReviewerTripped: expandText(
    'The Au~94er ~31 for the rest of this turn after repeated declines or failures. Every risky action asks you until you send ~78 ~10.',
  ),
  // The window's first review on Muse Code (M90, PLAN.md D69).
  museCodeReviewerNotice: expandText(
    'On by default. In Auto on ~01, only ~39s for the ~37 turn that no rule settles are eligible: one short ~01 turn on your ~56 in a hidden Plan ~19. Protected writes, paid calls, child tasks, questions, replayed or escalated ~34s, ~66 subjects, ~34s without allow-once and ~19s shared by panels are never reviewed. A successful review may allow once; declines, failures, busy ~19s, timeouts or a tripped breaker show the ~39 card. Host exit recreates the side ~19. Turn it off with ~82.museCodeAutoReviewer.',
  ),
  // The paid feature (D48): its name, confirmation, popup and tally.
  paidAutoReviewerName: 'Auto reviewer',
  paidConfirmAutoReviewer: expandText(
    'In Auto mode on the ~04 ~21, a separate model call judges each risky action that no rule settles, and runs it ~25 when it looks safe. It never allows a forbidden ~20, a ~20 your rules ask about, a protected write or a paid call, and when it declines or fails, you decide. Each review is ~23 ~04 key at the ~00 model’s token rates:\n{price}\nEvery review asks first, ~46 reviews always ~14 ~06.',
  ),
  // {tool}: the tool the reviewed call is for; {action}: its command line or arguments.
  paidUseAutoReviewerTitle: expandText('Let the Au~94er judge this {tool} call?'),
  paidUseAutoReviewerDetail: expandText(
    '{action}\n\nA separate call to {model} judges whether it may run ~25 you. ~69 ~04 key: {price}. Total varies with tokens used. Deny shows you the ~39 card instead.',
  ),
  usagePaidAutoReviews: forms({ one: '{count} review', other: '{count} reviews' }),
  // Problems in the permission settings, each said once in the conversation.
  // {setting}: the setting's name; {index}: the rule's place in it, from 1;
  // {pattern}: the rule's words; {detail}: the error, or the failing example.
  commandRuleInvalid: expandText('{~79}: rule {index} is not valid and is not applied ({detail}).'),
  commandRuleInvalidKept: expandText(
    '{~79}: rule {index} ({pattern}) is not valid ({detail}). It still asks or forbids by its pattern, since that can only tighten.',
  ),
  commandRuleExampleFailed: expandText(
    '{~79}: allow rule {index} ({pattern}) ~13 do what its example “{detail}” says, so it is not applied.',
  ),
  commandRuleExampleFailedKept: expandText(
    '{~79}: rule {index} ({pattern}) ~13 do what its example “{detail}” says. It still applies, since it can only tighten.',
  ),
  commandRuleAllowInRepository: expandText(
    '{~79}: rule {index} ({pattern}) is an allow rule, and a ~88’s rules can only tighten, so it is not applied.',
  ),
  commandRuleAllowsEvaluator: expandText(
    '{~79}: allow rule {index} ({pattern}) would allow a ~20 that runs text as code, so it is not applied.',
  ),
  commandRulesTooMany: expandText(
    '{~79}: {detail} rules is more than are read; rule {index} and those after it ~61 applied.',
  ),
  permissionProfileUnknown: expandText(
    '{~79}: no permission profile is named “{name}”. Until one is, every shell ~20 asks and file tools refuse every file.',
  ),
  permissionProfileInvalid: expandText(
    '{~79}: the profile “{name}” is not valid ({detail}). Until it is fixed, every shell ~20 asks and ~64 tools refuse every file.',
  ),
  permissionProfileInvalidData: 'Invalid or unsupported profile data.',
  permissionGlobInvalid: expandText(
    'The deny-read glob “{glob}” ~43 read ({detail}). Until it is fixed, ~64 tools refuse every file.',
  ),
  permissionRootInvalid: expandText(
    '{~79}: the extra root “{root}” is not an absolute path, so it is not added.',
  ),
  permissionRepositoryInvalid: expandText(
    '{~79}: the ~88’s rules ~61 valid ({detail}) and ~61 applied.',
  ),
  // M68 (PLAN.md D49): the verify loop's rows. {count}: the edited files'
  // errors or warnings.
  verifyErrors: forms({ one: '{count} error', other: '{count} errors' }),
  verifyWarnings: forms({ one: '{count} warning', other: '{count} warnings' }),
  verifyClean: 'No errors or warnings',
  // {count}: edited files whose problems were not read (no report in time, …).
  verifyUnchecked: forms({
    one: expandText('{count} file ~02'),
    other: expandText('{count} files ~02'),
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
    refused: expandText('the ~15 refuses shell ~20s'),
    restricted: expandText('shell ~20s are off in ~28'),
    unsafePath: expandText('a file name ~43 passed to it safely'),
    changed: expandText('~64 ~16 after the edit'),
    stopped: expandText('the checks ~31 after failing round after round'),
  },
  // An edit's then_run: the command it ran right after the edit.
  thenRunLabel: 'Then ran',
  // {reason}: one of checkSkips, with the user's or the hook's words after it.
  thenRunNotRun: 'Not run: {reason}',
  // After "a hook denied it": the hook rewrote the command into none.
  hookInputNoCommand: expandText('The hook’s updated input names no ~20.'),
  thenRunTimedOut: 'Stopped at its time limit',
  // The command could not start or ended without an exit code.
  thenRunNoExitCode: 'Failed without an exit code',
  // The fix loop reached its limit. {count}: the failing rounds in a row.
  checksStoppedNotice: forms({
    one: expandText(
      'The checks still failed after {count} round of fixes, so they will not run again automatically until ~78 ~10.',
    ),
    other: expandText(
      'The checks still failed after {count} rounds of fixes in a row, so they will not run again automatically until ~78 ~10.',
    ),
  }),
  exportThenRunLabel: 'Then ran:',
  // {command}: the then_run command; {outcome}: why it did not run.
  exportThenRunSkipped: expandText('then_run `{~20}`: {outcome}'),
  // The read-only legal scan (M97, PLAN.md D76): the report's title and
  // counts, the severity and category names, the uncertainty and fixability
  // markers, the disclaimer every surface shows, and why a scan is missing
  // or partial. {count} is a number; {checks} lists the incomplete checks;
  // {reason} and {evidence} are the scanner's own words.
  legalRegistryNotice: expandText(
    'Before the first lookup: {hosts}. Only ~67 names and ~54s are sent over HTTPS; no source, paths or lockfile contents are uploaded. Turn off Legal Registry Lookups for offline scans.',
  ),
  legalRegistryOfflineUnknown: expandText(
    'Offline: missing dependency ~07 findings remain ~66 because registry lookups are disabled or declined.',
  ),
  legalRegistryFact: expandText('{name}@{~54}: the registry ~30 {~07}.'),
  legalRegistryRecommendation: expandText(
    'Verify the original terms and ~09 ~75; registry ~12 ~13 prove rights.',
  ),
  legalRegistryMetadataOnly: expandText(
    'Registry ~12 is supplemental; original ~07 terms and local incomplete findings still require review.',
  ),
  legalScanTitle: 'Legal scan',
  legalScanDisclaimer: expandText('Not legal advice; for ~09 decisions consult a lawyer.'),
  legalScanEmpty: 'The scan completed with no findings.',
  legalFindingsCount: forms({
    one: '{count} finding',
    other: '{count} findings',
  }),
  legalFilesScanned: 'Files scanned: {count}',
  legalScanIncomplete: 'Incomplete: {checks}',
  legalScanFailed: 'The legal scan failed: {reason}',
  legalScanUnavailable: expandText('The legal scanner ~03 loaded; ~08 window. The ~17.'),
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
  legalCommandUsage: expandText('Usage: /legal [~06-relative path …]. Options ~61 supported.'),
  legalScanItemDetail: expandText('Scan the ~06 for licensing, attribution and header findings'),
  // Why a scan did not start, as a notice (lane B; lane W renders the report).
  legalScanBusy: 'A legal scan starts once the current turn has ended.',
  legalScanUntrusted: expandText(
    'The legal scan reads the ~06, which ~28 ~13 allow. Trust this ~06 to use it.',
  ),
  // A scan on Muse Code holds a live conversation in Plan mode (M70's hold, D76).
  legalScanPlanModeNotice: expandText(
    'This legal scan holds the ~00 ~45 while it reads the ~06, and the ~15 you had comes back when it ends.',
  ),
  // M97 lane R: the headless `legal` command's own lines. {distribution} is
  // the scanner's one-sentence assumption; {detail} is the registry
  // disclosure (hosts, queries, bytes); {path} stays as typed; {reason} is
  // the scanner's own words.
  legalDistributionLine: expandText('Distribution: {~09}'),
  // {hosts} are the registries asked; the counts are pre-formatted numbers.
  legalRegistryLine:
    'Registry ({hosts}): {queried} queried, {found} found, {skipped} skipped, {bytes} received.',
  legalRegistryOff: expandText(
    'Registry enrichment off. Rerun with --registry to enrich missing ~07s.',
  ),
  legalWroteFile: 'Legal scan report written to {path}.',
  legalFormatInvalid: 'The format must be text or json.',
  // {exclusions} lists the scanner's workspace-relative exclusion globs.
  legalExclusionsLine: 'Excluded: {exclusions}',
  legalScanNoDistribution: expandText('The scan ~42 complete, so no ~09 was assumed.'),
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
  legalFixOwnership: expandText(
    'Confirm that these files are ~51-owned and that the ~07 and copyright in ~87 apply to them: {paths}',
  ),
  legalFixDenied: 'The edits were not approved.',
  legalExportMarkdown: 'Export Markdown…',
  legalFixFiles: 'Files to change',
  legalFixExcluded: 'Not included',
  legalFixReasonNotFixable: 'No safe fix; recommendation only.',
  legalFixReasonProjectLicense: expandText('Project ~07 ~52 need separate confirmation.'),
  legalFixReasonUnknown: 'Not part of this scan.',
  legalFixReasonTooLarge: 'Too large to guard; fix it by hand.',
  legalFixNothingSelected:
    'Select at least one finding to fix, even in Bypass mode. Nothing is pre-authorized by the scan.',
  legalFixSeparateConfirm: expandText('I separately confirm the ~51 ~07 change.'),
  legalFixRefusedPlan: expandText('Fixes are refused ~45, which never writes.'),
  legalFixRefusedTrust: expandText('Fixes are refused while the ~06 is untrusted.'),
  legalFixRefusedWorkspace: expandText('The ~06 ~16 since ~87. Ask for a fresh preview.'),
  legalFixRefusedStale: expandText('The ~71 ~16 since ~87. Run a fresh scan.'),
  legalFixRefusedExpired: 'The preview expired. Ask for a fresh preview.',
  legalFixRefusedUnavailable: expandText('Applying fixes is unavailable ~14 build.'),
  legalFixRescanHint: 'Run a fresh scan to confirm what remains.',
  paidDailyBudgetLine: 'Shared daily budget for interactive paid extras: {budget}.',
  paidDailyLedgerUnavailable: expandText(
    'Daily paid budget ~80: its ledger is unreadable, incomplete, or cannot admit this ~34. No paid ~34 was sent.',
  ),
  paidDailyStopped: expandText('Paid extras are ~31 until tomorrow.'),
  paidDailyReached: expandText('Daily paid budget ~80'),
  paidDailyReachedDetail: expandText(
    'Today’s limit is {budget}. This ~34 and existing reservations need {needed}. Raise the limit for today, or stop paid extras until tomorrow.',
  ),
  paidDailyRaise: 'Raise for today',
  paidDailyStop: 'Stop until tomorrow',
  paidDailyRaisePrompt:
    'Enter today’s limit in USD (0.50–500), enough for the pending reservations.',
  legalExplainPaid: 'Explain findings (paid)',
  legalExplainConsent: expandText(
    'Explain these findings on {model}, ~23 ~04 key at {price}. The ~56 pays none. Only finding IDs, categories, severity and recognized ~07 IDs are sent; no source, paths or excerpts.',
  ),
  legalExplainConfirm: expandText(
    'Optional ~04 explanation: {price}. Each use asks for consent and shares the daily paid budget.',
  ),
  legalExplainUnavailable: expandText(
    'Enable paid legal explanations in Account & usage and store a ~04 key first.',
  ),
  legalScanner: {
    m001: 'compatibility reader over {v0}',
    m002: expandText(
      '{v0} is dual-~07d; {v1} is a clean choice beside {v2}. Confirm the chosen terms before shipping.',
    ),
    m003: expandText('Record which ~07 branch the ~09 complies with.'),
    m004: expandText(
      '{v0} ~30 {v1} as alternative copyleft terms; ~09 requires choosing and satisfying the applicable source and linking ~75.',
    ),
    m005: expandText('Confirm the chosen ~07 branch and its ~75 with a lawyer.'),
    m006: expandText(
      '{v0} ships under {v1} while the ~51 ~30 {v2}: distributing the combination may oblige source disclosure of the combined work. This is a question, not a verdict.',
    ),
    m007: expandText(
      'Confirm with a lawyer whether this ~09 triggers the copyleft ~75, and on which code.',
    ),
    m008: expandText('{v0} ~30 {v1} in development scope only.'),
    m009: 'Confirm it never ships; a shipped strong-copyleft dependency may oblige source disclosure.',
    m010: expandText(
      '{v0} ~30 {v1} with ~09 ~66: if this combination ships, source disclosure may be obliged.',
    ),
    m011: expandText('Establish whether the dependency ships, then confirm the ~75 with a lawyer.'),
    m012: expandText(
      '{v0} ~30 {v1}{v2}: file-level copyleft stays with its covered files, and LGPL linking needs its source and relinking terms.',
    ),
    m013: expandText(
      'Keep covered files under their terms, preserve their notices, and confirm LGPL linkage ~71.',
    ),
    m014: expandText(
      '{v0} ~30 {v1}{v2}: source-available or restricted terms, not an open-source grant. Recognition is not ~39.',
    ),
    m015: expandText(
      'Review the terms against this exact ~09 with a lawyer; confirm a BUSL change date or Commons Clause scope where one applies.',
    ),
    m016: expandText('{v0} ~30 {v1}, which this reader ~13 classify: confirm the terms by hand.'),
    m017: expandText('Review the ~07 text against this ~09.'),
    m018: expandText('{v0} ships under {v1} terms: no ~07 grant travels with it.'),
    m019: expandText('Confirm private ownership of this exact ~54, or remove it ~41 shipment.'),
    m020: expandText('{v0} ~30 {v1} terms outside the shipped set.'),
    m021: 'Confirm it never ships; a shipped proprietary dependency needs ownership proof.',
    m022: expandText('~02: {v0} ~67 {v1}@{v2} has no ~07 ~71'),
    m023: expandText('{v0} ~30 the ~07 {v1}, ~93 a well-formed SPDX ~89: {v2}.'),
    m024: expandText('Correct the declaration ~41 ~67 ~12, or confirm the terms by hand.'),
    m025: expandText('{v0} ~30 the custom reference {v1}: its terms need a human read.'),
    m026: expandText('Confirm the referenced ~07 text and its compatibility with the ~09.'),
    m027: expandText(
      '{v0} ~30 {v1}, a deprecated SPDX identifier form; a trailing + ~58 names which later ~54s apply.',
    ),
    m028: expandText('Use the current -only or -or-later identifier the ~67 intends.'),
    m029: expandText('{v0} ~30 the exception {v1}, ~93 on the SPDX exception list.'),
    m030: expandText('Confirm the exception text; an exception ~52 the analysis.'),
    m031: expandText(
      'License ~71 conflict for {v0}: {v1}. No source silently settles the conflict.',
    ),
    m032: expandText('Review the original ~07 and ~60 together before deciding which terms apply.'),
    m033: expandText('~02: conflicting ~07 ~71 for {v0} needs human review'),
    m034: '{v0} reader at {v1}',
    m035: expandText('~02: artifact freshness is not established by file-name ~71 alone'),
    m036: expandText('~02: bundle inputs are absent or stale against the ~06 inventory'),
    m037: forms({
      one: expandText('~09 read from {v0} known bundle inputs'),
      other: expandText('~09 read from {v0} known bundle inputs'),
    }),
    m038: expandText('source checkout, ~09 ~66: no bundle inputs or ~67 inventory ~71'),
    m039: expandText(
      '~02: ~09 set ~66 (no bundle metafile or ~67 files ~71); shipped ~75 assume ~81 ships',
    ),
    m040: expandText('~02: ~67 pattern count ~59 bounded inventory'),
    m041: expandText('~02: ~67 files contains unsupported patterns; ~09 is approximate'),
    m042: expandText(
      '~02: .vscodeignore pattern {v0} uses unsupported syntax, so the shipped set is approximate',
    ),
    m043: expandText(
      '~02: ~67 inventories do not establish embedded bundle inputs or artifact freshness',
    ),
    m044: expandText(
      '~09 approximated from ~67 files and .vscodeignore; unbuilt artifacts may differ',
    ),
    m045: 'distribution reader',
    m046: forms({
      one: '{v0} dependency may ship with no notice file present to attribute them.',
      other: '{v0} dependencies may ship with no notice file present to attribute them.',
    }),
    m047: expandText('Add THIRD_PARTY_~33 covering the shipped set.'),
    m048: '{v0} may ship but no present notice file names it.',
    m049: expandText('Attribute the ~67 in THIRD_PARTY_~33.'),
    m050: expandText('~02: {v0} has no readable NOTICE attribution'),
    m051: expandText('~09 reader at {v0}'),
    m052: '{v0} carries an upstream NOTICE file with no attribution in the present notices.',
    m053: expandText('Preserve the applicable NOTICE attribution in THIRD_PARTY_~33.'),
    m054: expandText('Refused path outside the ~06 or beyond its bounds'),
    m055: expandText(
      '~02: complex REUSE patterns, precedence and ownership relationships; only complete exact-path annotations are honored',
    ),
    m056: 'asset inventory at {v0}',
    m057: expandText(
      '{v0} has no observed per-file provenance declaration; its filename alone cannot establish ownership or ~09 rights.',
    ),
    m058: expandText(
      'Record the asset source, author and applicable terms ~83 in a sidecar or REUSE declaration.',
    ),
    m059: 'source reference at {v0}',
    m060: expandText(
      '{v0} contains a source reference whose provenance and applicable terms need review; a reference alone ~13 prove copying or infringement.',
    ),
    m061: expandText(
      'Verify the original source, author, date, ~07 and attribution for any copied material; keep legitimate upstream headers.',
    ),
    m062: expandText('~02: copyright header checks are off by policy'),
    m063: expandText('~02: {v0} is unreadable or binary header material'),
    m064: 'header reader at {v0}',
    m065: '{v0} has no copyright line in its first lines, but the header policy requires one.',
    m066: expandText('Add the ~51 copyright line ~83; never replace a third-party header.'),
    m067: expandText('{v0} has no ~85 line, but the header policy requires one.'),
    m068: expandText('Add the SPDX identifier matching the applicable ~07.'),
    m069: '{v0} has no {v1} in its first lines.',
    m070: expandText('Add the ~51 copyright header for hygiene; the policy leaves it optional.'),
    m071: '{v0} has a copyright line, but {v1}.',
    m072: 'Correct the date with the holder; an earlier year alone is never stale.',
    m073: expandText('{v0} ~30 ~85 {v1}, which ~13 parse: {v2}.'),
    m074: expandText('Write the identifier as an SPDX ~89 (AND, OR and WITH in uppercase).'),
    m075: expandText('Confirm the referenced text exists beside ~64 or in REUSE.toml.'),
    m076: expandText('{v0} ~30 {v1}, a deprecated SPDX identifier form.'),
    m077: expandText('Use the current identifier ~41 SPDX License List.'),
    m078: expandText('{v0} carries distinct SPDX ~60 {v1} and {v2}.'),
    m079: expandText(
      'Confirm the applicable terms for each declaration; preserve legitimate upstream ~07s.',
    ),
    m080: expandText('{v0} ~30 {v1}, outside the ~51 ~07s {v2}.'),
    m081: expandText(
      'Confirm ~64 carries third-party terms (keep its header) or correct the identifier.',
    ),
    m082: expandText('~51 ~07 reader at {v0}'),
    m083: expandText(
      'Write the ~07 as an SPDX ~89 (AND, OR and WITH in uppercase, parentheses where needed).',
    ),
    m084: expandText(
      '~02: full SPDX text matching and modified terms; title and clause matching is heuristic',
    ),
    m085: expandText('{v0} reads as no recognized ~07 text; its terms need a human read.'),
    m086: expandText('Confirm what ~07 ~64 grants and declare it in the manifest.'),
    m087: expandText('{v0} points at {v1}, which is absent ~41 ~06.'),
    m088: expandText('Add the referenced ~07 file or correct the manifest field.'),
    m089: expandText('{v0} marks the ~51 UNLICENSED: proprietary, all rights reserved by default.'),
    m090: expandText('Ship it only to its intended recipients; a public ~09 needs a ~07 grant.'),
    m091: expandText('~51 ~07 reader at {v0} and {v1}'),
    m092: expandText('{v0} ~30 {v1} but the ~07 file reads as {v2}.'),
    m093: expandText(
      'Reconcile the two before shipping: fix the ~12 or replace the ~07 file, with explicit confirmation for a ~07 change.',
    ),
    m094: expandText('~51 ~07 reader'),
    m095: expandText('The manifests disagree with no ~07 file to settle it: {v0}.'),
    m096: expandText(
      'Reconcile the manifests before shipping, with explicit confirmation for a ~07 change.',
    ),
    m097: expandText('The manifest ~30 terms but no root ~07 file was found.'),
    m098: expandText('Add the applicable ~07 text ~83 before ~09.'),
    m099: expandText('The README ~30 {v0} but the ~51 ~30 {v1}.'),
    m100: expandText('Reconcile the README with the ~07 file and manifest before shipping.'),
    m101: expandText(
      'The ~07 {v0} is declared only in the README; there is no ~07 file or manifest field.',
    ),
    m102: expandText('Add a LICENSE file and a manifest ~07 field ~83.'),
    m103: expandText(
      'No LICENSE file, manifest ~07 field or README declaration found: undistributed code is all rights reserved by default.',
    ),
    m104: expandText(
      'Choose a ~07 with explicit confirmation and declare it in a LICENSE file and the manifest.',
    ),
    m105: expandText(
      '{v0} carries ~07-like text the reader ~13 recognize: vendored code needs attribution in the notices.',
    ),
    m106: expandText(
      '{v0} carries {v1} terms inside the ~06: vendored code needs attribution in the notices.',
    ),
    m107: expandText('Confirm the vendored code is attributed in THIRD_PARTY_~33.'),
    m108: 'Unknown header policy',
    m109: 'Too many selected paths',
    m110: expandText(
      '~02: assets, copied code provenance, proprietary terms and complete ~07-text matching require human review',
    ),
    m111: 'Legal scan cancelled',
    m112: expandText('scan ~31 at limit: elapsed time'),
    m113: expandText('~02: {v0} ~43 read as text'),
    m114: expandText('scan ~31 at limit: {v0} ~59 bounded text read budget'),
    m115: forms({
      one: 'not checked: the scan stopped after reading {v0} file; {v1} more not read',
      other: expandText('~02: the scan ~31 after reading {v0} files; {v1} more not read'),
    }),
    m116: forms({
      one: 'not checked: dependency evidence bound reached; {v0} entry omitted',
      other: expandText('~02: dependency ~71 bound ~80; {v0} entries omitted'),
    }),
    m117: expandText('~02: ~07 text for {v0} at {v1} is unrecognized'),
    m118: expandText('~07 text reader at {v0}'),
    m119: forms({
      one: 'The distribution set is unknown and {v0} production dependency exist: obligations are read against an undistributed source checkout.',
      other: expandText(
        'The ~09 set is ~66 and {v0} production dependencies exist: ~75 are read against an undistributed source checkout.',
      ),
    }),
    m120: expandText('Supply bundle inputs or ~67 inventory ~71 so shipped ~75 are exact.'),
    m121: expandText('scan ~31 at limit: report truncated for {v0}'),
    m122: forms({
      one: 'report truncated: {v0} finding omitted past the {v1}-finding bound; blockers and should-fix findings kept first',
      other: expandText(
        'report truncated: {v0} findings ~70 {v1}-finding bound; blockers and should-fix findings kept first',
      ),
    }),
    m123: forms({
      one: expandText('report truncated: {v0} generated exclusions ~70 bound'),
      other: expandText('report truncated: {v0} generated exclusions ~70 bound'),
    }),
    m124: 'The scan built an invalid result: {v0}',
    m125: expandText('~02: an ~71 field ~59 report bound and was truncated'),
    m126: 'Unexpected character {v0}',
    m127: expandText('WITH must name a ~07 exception'),
    m128: expandText('Unexpected end of the ~89'),
    m129: 'Missing closing parenthesis',
    m130: expandText('Unexpected operator without a ~07 beside it'),
    m131: expandText('Empty ~07 ~89'),
    m132: expandText('Unexpected text after the ~89'),
    m133: expandText('License ~89 ~59 text bound'),
    m134: expandText('License ~89 nesting ~59 bound'),
    m135: expandText('Malformed ~07 identifier'),
    m136: expandText('License ~89 alternatives exceed the bound'),
    m137: 'Legal scan root is not a directory',
    m138: expandText('~02: {v0} is a link or escaped directory'),
    m139: expandText(
      'scan ~31 at limit: directory-entry budget ~80; remaining tree not enumerated',
    ),
    m140: expandText('~02: {v0} ~16 during enumeration'),
    m141: expandText('~02: {v0} is ~88 internals'),
    m142: expandText('~02: {v0} is a link'),
    m143: expandText('~02: {v0} is a special file'),
    m144: expandText('~02: {v0} ~03 admitted'),
    m145: expandText('~02: {v0} contains path crates whose ownership and resolved ~12 are ~66'),
    m146: expandText('~02: {v0} contains inherited or nested Cargo ~60 not resolved statically'),
    m147: forms({
      one: 'not checked: {v0} Cargo lock entry carry no license metadata in the lock and no vendored crate manifest covers them',
      other: expandText(
        '~02: {v0} Cargo lock entries carry no ~07 ~12 in the lock and no vendored crate manifest covers them',
      ),
    }),
    m148: forms({
      one: expandText('~02: {v0} Cargo ~05 in any Cargo.lock'),
      other: expandText('~02: {v0} Cargo ~05 in any Cargo.lock'),
    }),
    m149: expandText('~02: no Cargo manifests or locks found'),
    m150: expandText('~02: {v0} is not valid JSON, so its requirements and ~07 are ~66'),
    m151: expandText('~02: {v0} is not valid JSON, so its locked ~54s are ~66'),
    m152: expandText('~02: ~07 ~71 conflict for {v0} between {v1} and {v2}'),
    m153: forms({
      one: expandText('~02: {v0} Composer ~29 any composer.lock'),
      other: expandText('~02: {v0} Composer ~29 any composer.lock'),
    }),
    m154: forms({
      one: expandText('~02: {v0} Composer ~65 ~07 ~12 in the lock or ~26 data'),
      other: expandText('~02: {v0} Composer ~65 ~07 ~12 in the lock or ~26 data'),
    }),
    m155: expandText('~02: no composer.json, composer.lock or ~26.json found'),
    m156: expandText(
      '~02: {v0} uses executable code, which never runs; only its static assignments are read',
    ),
    m157: expandText(
      '~02: {v0} is read statically; computed Ruby ~12 and conditional assignments ~61 evaluated',
    ),
    m158: forms({
      one: expandText('~02: {v0} gem ~29 any Gemfile.lock'),
      other: expandText('~02: {v0} gem ~29 any Gemfile.lock'),
    }),
    m159: forms({
      one: expandText('~02: {v0} gems carry no ~07 ~12; present gem specifications ~11'),
      other: expandText('~02: {v0} gems carry no ~07 ~12; present gem specifications ~11'),
    }),
    m160: expandText('~02: no Gemfile, Gemfile.lock or gemspec files found'),
    m161: expandText(
      '~02: Go replacement targets, tool-~67 module mapping and non-vendored transitive selection require review; checksums can include unused ~54s',
    ),
    m162: forms({
      one: 'not checked: {v0} Go modules carry no license metadata; checksums and module path alone are not licenses, so vendored license text would close the gap',
      other: expandText(
        '~02: {v0} Go modules carry no ~07 ~12; checksums and module paths alone ~61 ~07s, so vendored ~07 text ~11',
      ),
    }),
    m163: forms({
      one: expandText('~02: {v0} Go tool ~05; their ~07s are ~66'),
      other: expandText('~02: {v0} Go tool ~05; their ~07s are ~66'),
    }),
    m164: expandText('~02: no go.mod, go.sum or vendor/modules.txt found'),
    m165: expandText('~02: ~07 ~12 conflict for {v0} between {v1} and {v2}: {v3} versus {v4}'),
    m166: expandText(
      '~02: {v0} is read statically; executable logic, catalogs and computed ~60 ~61 evaluated',
    ),
    m167: expandText(
      '~02: Maven transitive graph, parent properties and profiles ~61 resolved by static POM ~60',
    ),
    m168: forms({
      one: expandText('~02: {v0} Maven/Gradle ~05 in any lockfile or catalog'),
      other: expandText('~02: {v0} Maven/Gradle ~05 in any lockfile or catalog'),
    }),
    m169: forms({
      one: expandText('~02: {v0} Maven/Gradle ~65 ~07 ~12; present artifact POMs ~11'),
      other: expandText('~02: {v0} Maven/Gradle ~65 ~07 ~12; present artifact POMs ~11'),
    }),
    m170: expandText('~02: no POMs, Gradle ~60, locks or catalogs found'),
    m171: expandText('~02: {v0} has unreadable npm lock ~12'),
    m172: expandText('~02: {v0} uses an unsupported npm lock ~54'),
    m173: expandText('~02: {v0} ~59 npm nested lock depth bound'),
    m174: forms({
      one: 'not checked: {v0} npm lock entry in {v1} carry no license metadata and no installed package data covers them',
      other: expandText(
        '~02: {v0} npm lock entries in {v1} carry no ~07 ~12 and no ~26 ~67 data covers them',
      ),
    }),
    m175: expandText('~02: {v0} has no readable Yarn ~67 entries'),
    m176: forms({
      one: expandText('~02: {v0} records ~54s but no ~07 ~12 for {v1} ~67s; ~26 ~67 data ~11'),
      other: expandText('~02: {v0} records ~54s but no ~07 ~12 for {v1} ~67s; ~26 ~67 data ~11'),
    }),
    m177: expandText('~02: {v0} uses an unsupported pnpm lock ~54 or has no readable ~67s section'),
    m178: expandText('~02: ~07 ~71 conflict for {v0}@{v1} between {v2} and {v3}'),
    m179: forms({
      one: expandText('~02: {v0} npm ~05 in any lockfile; their transitive ~07s are ~66'),
      other: expandText('~02: {v0} npm ~05 in any lockfile; their transitive ~07s are ~66'),
    }),
    m180: expandText('~02: no npm manifests, locks or ~26 ~12 found'),
    m181: expandText(
      '~02: NuGet conditional or dynamic ~51 ~60, ~54 ranges and multi-framework conflicts require review',
    ),
    m182: forms({
      one: expandText('~02: {v0} NuGet ~05 in any lock, asset or central ~54 file'),
      other: expandText('~02: {v0} NuGet ~05 in any lock, asset or central ~54 file'),
    }),
    m183: forms({
      one: 'not checked: {v0} NuGet packages carry no license metadata; present .nuspec file would close the gap',
      other: expandText('~02: {v0} NuGet ~65 ~07 ~12; present .nuspec files ~11'),
    }),
    m184: expandText('~02: no NuGet ~60, locks or asset files found'),
    m185: expandText('~02: {v0} includes {v1}; arbitrary include names ~61 recursively resolved'),
    m186: expandText('~02: {v0} includes {v1}, which is absent ~41 ~06'),
    m187: expandText(
      '~02: {v0} contains a requirements option or editable source not resolved statically',
    ),
    m188: forms({
      one: 'not checked: {v0} requirement line in {v1} use a form the reader does not parse',
      other: expandText('~02: {v0} requirement lines in {v1} use a form the reader ~13 parse'),
    }),
    m189: expandText('~02: {v0} names no ~51, so its requirements are unattributed'),
    m190: expandText('~02: {v0} has no readable ~67 stanzas'),
    m191: forms({
      one: expandText('~02: {v0} records ~54s but no ~07 ~12 for {v1} ~67s; present ~09 ~12 ~11'),
      other: expandText('~02: {v0} records ~54s but no ~07 ~12 for {v1} ~67s; present ~09 ~12 ~11'),
    }),
    m192: expandText('~02: ~26 ~12 ~54 differs for {v0}; locked ~07 ~66'),
    m193: expandText(
      '~02: Python static ~60 do not establish complete transitive coverage without lock and ~26 ~12; dynamic build ~12 is never evaluated',
    ),
    m194: forms({
      one: expandText('~02: {v0} Python ~67s have no matching ~07 ~12'),
      other: expandText('~02: {v0} Python ~67s have no matching ~07 ~12'),
    }),
    m195: forms({
      one: expandText('~02: {v0} Python ~05; their transitive ~07s are ~66'),
      other: expandText('~02: {v0} Python ~05; their transitive ~07s are ~66'),
    }),
    m196: expandText('~02: no Python manifests, locks or ~09 ~12 found'),
    unknown: 'unknown',
    unresolved: 'unresolved',
    noLicense: 'no license',
    shipment: ' in the shipment',
    copyrightSpdxLines: expandText('copyright or ~85 lines'),
    spdxLine: expandText('an ~85 line'),
    copyrightLine: 'a copyright line',
    invalidYear: 'the year {value} is not a four-digit year',
    impossibleYear: 'the year {value} is impossible',
    reversedYears: 'the range {value} ends before it starts',
    selectedPaths: forms({ one: '{count} selected path', other: '{count} selected paths' }),
    moreUnchecked: forms({
      one: 'and {count} more unchecked item omitted past the bound',
      other: expandText('and {count} more unchecked items ~70 bound'),
    }),
    declaration: expandText('{file} ~30 {~07}'),
    licenseFile: 'a license file',
    bundleLoad: expandText('{file} ~03 loaded'),
    bundleShape: '{file} has an unexpected shape',
    invalidResult: 'the scanner returned an invalid result',
  },
  legalScanAgain: 'Scan again',
}

/** The shape every table has: English's keys, with any language's plural forms. */
export type UiText = typeof EN
