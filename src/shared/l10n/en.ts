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

export const EN = {
  paidDailyBudgetLine:
    'Shared daily budget for interactive paid extras: {budget}. Tab has its own separate budget.',
  paidDailyLedgerUnavailable:
    'Daily paid budget reached: its ledger is unreadable, incomplete, or cannot admit this request. No paid request was sent.',
  paidDailyStopped: 'Paid extras are stopped until tomorrow.',
  paidDailyReached: 'Daily paid budget reached',
  paidDailyReachedDetail:
    'Today’s limit is {budget}. This request and existing reservations need {needed}. Raise the limit for today, or stop paid extras until tomorrow.',
  paidDailyRaise: 'Raise for today',
  paidDailyStop: 'Stop until tomorrow',
  paidDailyRaisePrompt:
    'Enter today’s limit in USD (0.50–500), enough for the pending reservations.',
  untitledConversation: 'Untitled',
  crashTitle: 'The panel hit an error',
  crashDetail: 'Reload rebuilds the panel; the conversation is kept by the host.',
  crashReload: 'Reload',
  // M25 (PLAN.md D28): webview and UI state.
  toolInterrupted: 'Interrupted',
  thoughtDone: 'Thought',
  quoteCopy: 'Copy',
  snapshotTooLong:
    'This conversation was too long to keep in the panel across the reload; open it from History to see all of it.',
  linkOutsideWorkspace: 'Links to files outside the workspace are not opened from the transcript.',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  // Windows binds Ctrl+Alt+Esc (Ctrl+Esc opens Start there; M26, D29).
  composerPlaceholder: 'ctrl esc (ctrl alt esc on Windows) to focus or unfocus Muse',
  // Shown while a turn runs: Enter then steers the running turn.
  composerQueuePlaceholder: 'Queue another message…',
  composerLabel: 'Message Muse',
  connecting: 'Connecting to the extension host…',
  notSignedIn: 'Not signed in',
  sendDisabledReason: 'Sign in to send messages',
  stopTitle: 'Stop',
  signInTitle: 'Sign in to Muse Spark',
  signInBrowser: 'Sign in with your Meta account',
  signInBrowserDetail: 'Shows an approval code here; open the sign-in page to approve it.',
  signInApiKey: 'Use a Model API key',
  signInApiKeyDetail: 'Paste a key from dev.meta.ai; it is stored in VS Code secret storage.',
  installTitle: 'Muse Code is not installed',
  installDetail:
    'The Muse Code CLI hosts conversations for this extension. Install it here, then sign in.',
  installAction: 'Open install instructions',
  installStartAction: 'Install Muse Code',
  installConfirmDetail:
    'Meta publishes this command. It downloads and runs an installer on this machine:',
  installConfirmAction: 'Run installer',
  installCancelAction: 'Cancel',
  installWaiting: 'Installing Muse Code in the terminal…',
  installTimedOut: 'Muse Code was not found. Check the terminal output, then check again.',
  installStartFailed:
    'The installer terminal could not open. Try again or use the install instructions.',
  deviceCodePrompt: 'Enter this code in your browser:',
  deviceCodeOpenAction: 'Open sign-in page',
  deviceCodeCancelAction: 'Cancel sign-in',
  deviceCodeWaiting: 'Waiting for browser approval…',
  signInCancelled: 'Sign-in cancelled.',
  signInFailed: 'Could not start in-panel sign-in. Check Muse Code and try again.',
  signOutPending:
    'Sign-out is in progress or credentials remain. Finish Muse Code logout or remove META_API_KEY, then check again.',
  signOutTerminalFailed:
    'Extension session ended, but its logout terminal could not open. Run muse logout or remove META_API_KEY, then check again.',
  signOutHoldFailed:
    'Could not save sign-out protection. Extension session ended; remove META_API_KEY and finish muse logout before reopening VS Code.',
  signOutKeyClearFailed:
    'Could not clear the stored Model API key. The extension host stopped; check VS Code secret storage and sign out again.',
  signOutStopFailed:
    'Backend shutdown failed. This window is gated; close VS Code and check credentials before reopening.',
  retryAction: 'Check again',
  apiKeyPrompt: 'Meta Model API key',
  apiKeyPlaceholder: 'LLM_…',
  apiKeyInvalid:
    'A Model API key starts with LLM_ (older keys look like LLM|<numeric id>|<secret>).',
  signInWaiting: 'Waiting for the browser sign-in to finish…',
  signInTimedOut: 'The sign-in did not complete in time. Try again.',
  // How Muse Code ended a browser sign-in (`account/loginCompleted`, D26):
  // `expired`, `denied` and `failed` as captured live; any other ending as
  // Muse Code named it.
  signInExpired: 'The code expired before it was approved. Sign in again to get a new code.',
  signInDenied: 'You denied the sign-in in the browser.',
  signInSaveFailed: 'Muse Code signed in but could not save the credential.',
  signInEnded: 'Sign-in ended: {outcome}. Sign in again to get a new code.',
  // A macOS credential file on Windows or Linux stops `muse serve` (D26):
  // version 2, empty or a Keychain pointer, or the Keychain lane.
  cliCredentialUnsupported:
    'Muse Code cannot start: its sign-in file {path} is in the macOS format, which Muse Code cannot read on this system. Move or rename that file, then sign in again.',
  hostExited: 'Muse Code stopped unexpectedly',
  hostStarting: 'Starting Muse Code…',
  // PLAN.md D25: restarts, crashes and closed sessions continue the conversation.
  hostRestartsOnSend: 'The next message restarts it and continues this conversation.',
  turnStoppedByRestart: 'Stopped: the backend restarted',
  sessionClosedByHost: 'Muse Code closed this session',
  sessionResumesOnSend: 'The next message resumes it.',
  sessionContinued: 'Conversation continued after the restart.',
  sessionNotContinued:
    'The conversation could not be continued after the restart, so this message starts a new one',
  surfaceClosed: 'The panel was closed',
  hostStartFailed: 'The backend could not start',
  decisionErrorNotice:
    'Muse Code reported an error for the decision (the tool may have run anyway)',
  jumpToLatest: 'New messages',
  jumpToLatestTitle: 'Jump to the newest message',
  copyResponse: 'Copy response',
  openOutputTitle: 'Click to open the output in an editor',
  toolOutputTitle: '{tool} tool output ({id})',
  clickToExpand: 'Click to expand',
  openOutputFailed: 'Could not open the output',
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
  bypassNotAllowed:
    'Turn on the "Allow dangerously skip permissions" setting to use Bypass permissions.',
  // PLAN.md D24: the setting turned off while a conversation is in Bypass.
  bypassRevoked:
    'The "Allow dangerously skip permissions" setting was turned off; this conversation is back in Manual.',
  // D24: in a remote window a dev container's settings can switch Bypass on.
  bypassRemoteTitle: 'Run without approvals on a remote machine?',
  bypassRemoteDetail:
    'This window runs on a remote machine or in a container, where a dev container definition can set museSpark.allowDangerouslySkipPermissions without you. Bypass permissions lets Muse edit files and run commands without asking.',
  bypassRemoteConfirm: 'Use Bypass permissions',
  bypassRemoteStartedManual:
    'museSpark.initialPermissionMode asks for Bypass permissions, but this is a remote window; the conversation starts in Manual. Choose Bypass from the Modes menu to confirm it.',
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
  mentionFile: 'Mention file from this project…',
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
  skillsLoading: 'Start a conversation to load skills',
  skillsEmpty: 'No skills available in this workspace',
  // Skills, imports and export (M30, D30).
  manageSkillsItem: 'Manage skills…',
  manageSkillsDetail: 'Turn Muse Code’s skills on or off',
  importSkillsItem: 'Import skills…',
  importSkillsDetail: 'Copy your Claude Code or Codex skills into Muse Code',
  continueClaudeItem: 'Continue a Claude Code session',
  continueCodexItem: 'Continue a Codex session',
  continueDetail: 'Pick up unfinished work in this conversation',
  exportItem: '/export',
  exportDetail: 'Save this conversation as a Markdown file',
  exportLogItem: 'Export session log…',
  exportLogDetail: 'Muse Code’s full JSON record of this conversation',
  skillsCliMissing: 'Managing skills needs the Muse Code CLI, which is not installed.',
  skillsListFailed: 'Muse Code could not list its skills',
  skillsPickTitle: 'Muse Code skills',
  skillsPickPlaceholder: 'Checked skills are on; uncheck one to turn it off',
  skillsUnchanged: 'No skills changed.',
  skillsChanged: 'Skills updated',
  skillsChangeFailed: 'Muse Code could not change {skills}',
  skillsRestartPrompt:
    'Muse Code loads skill changes when it starts. Restart it now? A reply that is running stops.',
  restartNow: 'Restart now',
  restartLater: 'Later',
  restartedNotice:
    'Muse Code restarted with the new skills; your next message continues the conversation.',
  importSourceTitle: 'Import skills from',
  importSourceClaude: 'Claude Code',
  importSourceCodex: 'Codex',
  importConfirm: 'Import these skills into your Muse Code skills?',
  importConfirmAction: 'Import',
  importInvalid: 'not valid, will be skipped',
  importFailed: 'Muse Code could not import skills',
  // Import from Claude Code, Codex and Cursor (M83, D49).
  agentImportItem: 'Import from other agents…',
  agentImportDetail:
    'Copy MCP servers, hooks, agents, commands and rules from Claude Code, Codex or Cursor',
  agentImportSourceTitle: 'Import from',
  agentImportSourceAll: 'All three',
  agentImportSourceCursor: 'Cursor',
  agentImportPickTitle: 'What to import',
  agentImportPickPlaceholder: 'Checked entries are previewed before anything is written',
  // {source}: the tool picked above.
  agentImportNothing: 'Nothing to import from {source}.',
  agentImportUntrusted:
    'This workspace is not trusted, so only your own files were read; grant trust to offer this project’s files.',
  agentImportConfirm: 'Import what the preview shows?',
  agentImportConfirmAction: 'Import',
  agentImportNoneImportable: 'None of the checked entries can be imported; the preview says why.',
  agentImportPersonalToProject: 'this would copy a personal file into the project',
  agentImportIgnoredToTracked: 'this would copy a git-ignored file into a tracked file',
  agentImportEditPrompt:
    'Open converted entries in {path} as an unsaved edit for you to review and save? Save it only to that path, never to another file.',
  agentImportEditAction: 'Edit and open the file',
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
  agentImportSkippedUnmapped: 'maps to no Muse Code event',
  agentImportSkippedDuplicate: 'another checked entry goes to the same place',
  agentImportSkippedDisabled: 'turned off where it came from',
  agentImportSkippedUnsupported: 'uses something Muse Code does not support',
  agentImportSkippedProjectServer:
    'Muse Code reads MCP servers only from your own settings, so a project’s servers are not offered there',
  agentImportSkippedUserRules: 'your own rules: Muse Code’s `/rules import` brings them in',
  agentImportSkippedOutside: 'its source or destination is unsafe or leads outside its folder',
  agentImportSkippedFailed: 'could not be written; the log says why',
  agentImportSkippedUnreadable:
    'its source or destination could not be checked, so it is left alone',
  agentImportSkippedTooLarge: 'it would take AGENTS.md past the size Muse Code loads',
  agentImportSkippedChanged: 'its folder changed after the preview, so it was not written',
  // Shown when some of the other agents' files could not be read during the scan.
  agentImportSkippedFiles: 'Some source files were skipped; the log gives counts and reasons only.',
  // Shown when the import could not start writing at all.
  agentImportNotApplied:
    'Nothing was imported: the window closed, the folder changed after the preview, or the checkpoint could not be kept.',
  // Shown when an import is asked for while another one waits for its answers.
  agentImportBusy: 'An import is already open; answer its questions first.',
  // Shown when the import stopped on an error nothing foresaw.
  agentImportFailed:
    'The import stopped on an unexpected error; what was already written stays. The log has a fixed failure reason.',
  // Shown when the import's own code did not load (a damaged install).
  agentImportUnavailable:
    'The import could not be loaded, so nothing can be imported; reinstall the extension and reload the window. The log has the details.',
  // The read-only preview document, in Markdown.
  agentImportPreviewTitle: 'Import preview',
  agentImportPreviewIntro:
    'Import copies an item only to a place no more exposed than where it was: personal stays personal, a git-ignored file is never copied into a tracked one. It does not look for credentials in what it copies. This preview lists names, scopes and targets only. Config entries open unsaved for you to review and save.',
  // {fields}: field names, comma-separated.
  agentImportPreviewDropped: 'not carried over: {fields}',
  agentImportPreviewLegacyKey:
    'The file uses the legacy `mcp_servers` key. Rename it to `mcpServers` when you add these: Muse Code loads neither when both are there.',
  agentImportPreviewNotImported: 'Not imported',
  // {count}: a number.
  agentImportCountFiles: 'New files: {count}',
  agentImportCountSections: 'Sections for AGENTS.md: {count}',
  agentImportCountCopies: 'Entries offered in the editor: {count}',
  agentImportCountSkipped: 'Not imported: {count}',
  exportNothing: 'There is no conversation to export yet.',
  exportFailed: 'The conversation could not be exported',
  exportSaved: 'Conversation exported to {path}',
  exportLogUnavailable:
    'The session log comes from the Muse Code CLI, which this conversation does not use.',
  exportLogLocalOnly: 'Muse Code writes the session log itself, so pick a folder on this machine.',
  exportWaitForTurn: 'Export once the reply has finished, so the file holds all of it.',
  exportHistoryUnavailable:
    'Muse Code did not return this conversation’s history (it is too long to replay), so there is nothing to write as Markdown. Export session log… saves the whole record.',
  exportCliMissing: 'Exporting the session log needs the Muse Code CLI, which is not installed.',
  exportOpen: 'Open',
  exportDefaultTitle: 'Muse conversation',
  // Session export, import and share (M84, PLAN.md D49).
  exportJsonItem: 'Export session as JSON…',
  exportJsonDetail: 'A portable file you can import or share',
  importSessionItem: 'Import session…',
  importSessionDetail: 'Resume an exported session file on the Model API backend',
  openShareItem: 'Open share file…',
  openShareDetail: 'Read a shared session file, read-only',
  exportPreviewTitle: 'Export session as JSON',
  exportPreviewRedacted: 'Save redacted…',
  exportPreviewFull: 'Save without redaction…',
  exportPreviewOpen:
    'The redacted file is open in the editor. Nothing is written until you choose.',
  exportPreviewMessages: forms({
    one: '{count} message in this conversation',
    other: '{count} messages in this conversation',
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
    other: '{count} credentials or key digests removed',
  }),
  exportPreviewKnownCredentials:
    'Known credential shapes (API keys, tokens, passwords, private keys) and the key digest are always removed. A secret in another shape stays: read the file before you share it.',
  exportTooLarge: 'This conversation is too long for a session export file.',
  importPreviewTitle: 'Import session',
  // {source}: the backend label; {messages}: a message-count line; {model}:
  // the model id; {mode}: Manual or Plan in the display language.
  importPreviewDetail:
    'From {source}: {messages}. It continues on {model} and starts in {mode}; session rules, goals, schedules and patches are dropped, and the imported history is treated as untrusted.',
  importSessionFailed: 'The session could not be imported',
  importSessionUnavailable: 'Sessions can only be imported on the Model API backend.',
  // Adopted into the panel, which appends the session's name.
  importedNotice: 'Session imported',
  // {mode}: Manual or Plan in the display language.
  importedUntrusted:
    'This conversation holds imported history, so it starts in {mode}. Only you can change that.',
  openShareTitle: 'Open share file',
  shareFailed: 'The share file could not be opened',
  // {backend}: the backend label; {time}: a date and time.
  shareMetaLine: 'Shared from {backend} · {time}',
  shareReadOnly: 'Read-only: nothing in this file can act on your workspace.',
  // The file's own `redacted` flag, which anyone can set: reported, never vouched for.
  shareMarkedRedacted:
    'The file says its paths and account ids were redacted; that is not checked here.',
  // In place of one item of a share file that could not be rendered.
  shareSectionFailed: 'This part of the file could not be shown.',
  // {shown}, {total}: counts of the file's items, as numbers.
  shareShownCount: 'Shown: {shown} of {total}',
  shareShowMore: 'Show more',
  // After "could not be imported: ". {size}, {limit}: sizes such as 2.4 MB.
  importReplayTooLarge:
    'It holds {size} of text for the model, and a resumed conversation can start with at most {limit}. Open it as a share file to read it.',
  // Why a picked file was refused, after "could not be imported/opened: ".
  transferTooLarge: 'The file is larger than a session export can be.',
  transferFileMissing: 'The picked file no longer exists.',
  transferEmpty: 'The file holds no conversation.',
  transferNotAnExport: 'The file is not a Muse Spark session export.',
  transferLocalFileOnly: 'Session import and sharing require a local file on the extension host.',
  // {version}: the file's format version, a number.
  transferVersionUnsupported: 'This version of the extension cannot read format version {version}.',
  // {field}: where in the file, as `transcript[2].outputRef`.
  transferUnknownField: 'The file holds a field this version does not know: {field}',
  // {field}: where in the file, as `transcript[2].status`.
  transferInvalidField: 'The file holds a field that is not valid: {field}',
  // MCP servers and hooks, read-only (M31, D30).
  mcpItem: 'MCP servers…',
  mcpItemDetail: 'What Muse Code connects to; sign in to a server',
  hooksItem: 'Hooks…',
  hooksItemDetail: 'Where Muse Code’s hooks come from',
  mcpTitle: 'Muse Code MCP servers',
  mcpNoSettings: 'Muse Code has no settings file yet, so no MCP servers. It would be at {path}',
  mcpUnreadable: 'Muse Code’s settings file could not be read:',
  mcpNone: 'No MCP servers are configured in {path}',
  mcpCount: forms({ one: '{count} MCP server in {path}', other: '{count} MCP servers in {path}' }),
  mcpOptional: 'optional',
  mcpRequired: 'required (Muse Code stops if it fails)',
  mcpDisabled: 'turned off',
  mcpEnv: 'environment:',
  mcpHeaders: 'headers:',
  mcpModeConflict: '“required” and “mode” are both set',
  mcpKeyConflict:
    'Muse Code’s settings hold both “mcpServers” and “mcp_servers”, so it loads no MCP server from either. Keep one key.',
  mcpModeConflictWarning:
    'Muse Code loads no MCP server while a server sets both “required” and “mode”. Keep only “mode” on:',
  mcpOpenSettings: 'Open the settings file',
  mcpRestart: 'Restart Muse Code to load changes',
  mcpRestartDetail:
    'A reply that is running stops; the conversation continues on your next message',
  mcpInvalidUrl: 'an invalid URL',
  mcpNoCommand: 'no command',
  mcpRestarted: 'Muse Code restarted; your next message loads the settings as they are now.',
  mcpDocs: 'MCP servers in Muse Code (documentation)',
  mcpSignIn: 'Sign in',
  mcpSignInDetail: 'Runs muse mcp login in a terminal (OAuth in the browser)',
  mcpSignOut: 'Sign out',
  mcpRemotePlaceholder: 'A remote server: sign in or out, or edit its entry',
  mcpStdioPlaceholder: 'A local server needs no sign-in; edit its entry in the settings file',
  mcpCliMissing: 'Signing in to an MCP server needs the Muse Code CLI, which is not installed.',
  mcpTerminalName: 'Muse Code MCP sign-in',
  // MCP servers on the Model API backend (M50, D42).
  mcpItemDetailModelApi: 'The servers in Muse Code’s settings, run by this window',
  mcpTitleModelApi: 'MCP servers on the Model API backend',
  mcpRequiredModelApi: 'required (a message stops if it is not running)',
  mcpStateNotStarted: 'Starts with your next message',
  mcpStateStarting: 'Starting…',
  mcpStateConnected: forms({ one: 'Connected: {count} tool', other: 'Connected: {count} tools' }),
  mcpStateUnoffered: forms({
    one: '{count} more not offered',
    other: '{count} more not offered',
  }),
  mcpStateFailed: 'Not running: {reason}',
  mcpStateRestricted: 'Not started: this workspace is in Restricted Mode',
  mcpStateNotLoaded: 'Not loaded: see the warning',
  mcpBuiltIn: 'built in',
  mcpBuiltInDetail:
    'The extension’s own getDiagnostics: the errors and warnings in VS Code’s Problems panel',
  mcpRestartModelApi: 'Restart the MCP servers',
  mcpRestartModelApiDetail:
    'A reply that is running stops; the servers start again with your next message, from the settings as they are then',
  mcpRestartedModelApi:
    'The MCP servers stopped; your next message starts them from the settings as they are now.',
  mcpShowLog: 'Show the log',
  mcpShowLogDetail: 'What the server wrote to stderr, and why it stopped',
  mcpModelApiPlaceholder:
    'This window runs the server itself; a sign-in with muse mcp login is for Muse Code only',
  mcpServerUnavailable: 'MCP server {name} is not available: {reason}',
  mcpRequiredFailed:
    'MCP server {name} is required and is not running: {reason}. Fix its entry in Muse Code’s settings, or set "mode": "optional", then restart the MCP servers (MCP servers… in the palette).',
  mcpNoServersKeys:
    'No MCP server is loaded: Muse Code’s settings hold both “mcpServers” and “mcp_servers”. Keep one key.',
  mcpNoServersMode:
    'No MCP server is loaded: {servers} set both “required” and “mode”. Keep only “mode”.',
  mcpNoServersUnreadable:
    'No MCP server is loaded: Muse Code’s settings file could not be read ({reason}).',
  hooksTitle: 'Muse Code hooks',
  hooksTitleModelApi: 'Model API hooks',
  hooksWarning: 'Hooks run through your shell, outside Muse Code’s sandbox and approvals',
  hooksModelApiWarning:
    'Hooks are on by default in trusted workspaces and run through your shell outside tool approvals. Review these sources before trusting the workspace; without a hooks file, nothing runs.',
  hooksProject: 'Project hooks',
  hooksProjectFile: '.muse/hooks.json',
  hooksProjectNone: 'This workspace has no .muse/hooks.json.',
  hooksProjectTrusted: 'Runs in this workspace',
  hooksProjectUntrusted: 'Runs only once you trust this workspace',
  hooksUser: 'Your hooks',
  hooksUserBlock: 'settings.json › hooks',
  hooksUserNone: 'None in your settings',
  hooksUserCount: forms({
    one: '{count} hook in your settings',
    other: '{count} hooks in your settings',
  }),
  hooksManaged: 'Managed hooks',
  hooksManagedKey: 'managed_hooks_path',
  hooksManagedNotSet: 'Not set: no administrator hooks',
  hooksManagedSet: 'Set by your settings; whoever controls this file controls what runs',
  hooksManagedMissing: 'Your settings name this file, but it does not exist.',
  hooksDocs: 'Hooks in Muse Code (documentation)',
  // Memory (M49, D41): the notes Muse Code keeps, on both backends.
  memoryItem: 'Memory…',
  memoryItemDetail: 'The notes Muse keeps for later sessions',
  memoryTitle: 'Muse memory',
  memoryNone: 'No memory notes yet for this workspace',
  memoryCount: forms({ one: '{count} memory note', other: '{count} memory notes' }),
  memoryIndexDetail: 'The index Muse reads at the start of every session',
  memoryNewNote: 'New note…',
  memoryNewNoteDetail: 'A Markdown note Muse reads in later sessions, listed in MEMORY.md',
  memoryDocs: 'Memory in Muse Code (documentation)',
  memoryOpen: 'Open',
  memoryDelete: 'Delete…',
  memoryDeleteDetail: 'Moves the note to the trash and takes its line out of MEMORY.md',
  memoryDeleteIndexDetail: 'Moves the index to the trash; the notes stay',
  memoryDeleteConfirm: 'Delete the memory note {path}?',
  memoryDeleteConfirmDetail:
    'It moves to the trash. Muse no longer sees it from its next session on.',
  memoryDeleteAction: 'Delete',
  memoryDeleted: 'Deleted {path}',
  memoryNewTitle: 'New memory note',
  memoryScopePlaceholder: 'Where the note lives',
  memoryNamePrompt: 'Name the note',
  memoryNamePlaceholder: 'deploy-steps.md',
  memoryNameInvalid: 'Muse Code does not accept that name',
  memoryNameTaken: 'A note with that name already exists.',
  memoryDescriptionPrompt: 'What is the note about? One line for MEMORY.md (optional)',
  memoryDescriptionPlaceholder: 'How we deploy to staging',
  memoryFailed: 'The memory could not be changed',
  // Worktrees (M32, D30).
  newWorktreeItem: 'New worktree…',
  newWorktreeDetail: 'A new branch in its own folder and window; this checkout is untouched',
  removeWorktreeItem: 'Remove a worktree…',
  removeWorktreeDetail: 'Delete a worktree folder; its branch stays',
  worktreeNoWorkspace: 'Open a folder in a git repository first.',
  worktreeUntrusted:
    'Worktrees need git, which does not run in Restricted Mode (a repository’s config can name programs for git to run). Trust this workspace first.',
  worktreeNotRepository: 'This workspace is not in a git repository',
  worktreeBranchPrompt: 'Name the new branch',
  worktreeBranchPlaceholder: 'feature/login-form',
  worktreeBranchEmpty: 'Type a branch name.',
  worktreeBranchInvalid: 'git does not accept that as a branch name.',
  worktreeBranchExists: 'A branch with that name already exists.',
  worktreeBaseTitle: 'Start the branch from',
  worktreeBasePlaceholder: 'The commit the new branch starts at',
  worktreeCurrent: 'current branch:',
  worktreeDetachedHead: 'the commit checked out now',
  worktreeFolderExists: 'That folder already exists:',
  worktreeAddFailed: 'git could not create the worktree',
  worktreeCreated: 'Worktree ready at {path}',
  worktreeOpen: 'Open in New Window',
  worktreeListFailed: 'git could not list the worktrees',
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
  worktreeDirtyConfirm:
    'This worktree has uncommitted changes. Removing it discards them for good. Remove it anyway?',
  worktreeDiscardAction: 'Remove and discard changes',
  worktreeRemoveFailed: 'git could not remove the worktree',
  worktreeRemoved: 'Removed the worktree at {path}',
  compactItem: '/compact',
  compactDetail: 'Summarise older context to free the window',
  clearItem: '/clear',
  logoutItem: '/logout',
  openLog: 'Open output log',
  reportIssue: 'Report an issue…',
  openDocs: 'Muse Code documentation',
  modelListLabel: 'Models',
  thinkingOff: 'No thinking',
  // @-mention menu and attachments.
  mentionMenuLabel: 'Files',
  mentionNoMatches: 'No matching files',
  actionFailed: 'That did not work (the Muse Spark log has the details)',
  slashNoMatches: 'No matching commands; Enter sends the text as it is',
  attachmentsLabel: 'Attachments',
  removeAttachment: 'Remove',
  attachmentTooLarge: 'Images must be 10 MB or smaller.',
  attachmentUnsupported: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  attachmentLimit: 'At most 20 files per message.',
  attachmentUnreadable: 'The file could not be read.',
  documentTooLarge: 'PDFs must be 32 MB or smaller.',
  documentsOverBudget: 'Files must total at most 50 images and PDF pages per message.',
  mediaTotalTooLarge: 'Attached images and PDFs exceed the combined media size limit.',
  olderMediaOmitted:
    'Older images or PDFs were left out of this request to stay within media limits. They remain in local history.',
  pdfNeedsModelApi: 'PDF attachments require the Model API backend.',
  invalidPdf: 'This file is named as a PDF but is not a valid PDF.',
  pdfLabel: 'PDF',
  // Model API read_file rows. The separate MODEL_TEXT result stays English.
  toolReadPdf: 'Read PDF `{path}` ({pages}, {bytes} bytes)',
  toolReadPdfPages: forms({ one: '{count} page', other: '{count} pages' }),
  toolReadPdfPagesUnknown: 'page count unknown',
  toolReadImage: 'Read image `{path}` ({mediaType}, {width}×{height}, {bytes} bytes)',
  toolReadPdfInvalid: 'The file `{path}` has a PDF name but no PDF header.',
  toolReadImageInvalid: 'The file `{path}` is not a supported image.',
  toolVisualFileMissing: 'The file `{path}` was not found.',
  toolVisualReadFailed: 'The file `{path}` could not be read.',
  // M69 (PLAN.md D49): web fetch. The row's line under a fetched page: its
  // size and content type (text/html).
  webFetchSize: 'Fetched {size} ({type})',
  // Before each fetch Muse Code asks the extension for.
  webFetchConfirmTitle: 'Muse Code wants to fetch a page from {host}',
  webFetchConfirmDetail:
    'The extension will download {url} from this computer and give its text to Muse Code. The whole address is sent to {host}, so anything written into it leaves the conversation.',
  // Why a fetch did not happen or did not finish.
  webFetchInvalidUrl: 'That is not a complete web address.',
  webFetchNotHttps: 'Only https:// pages are fetched.',
  webFetchCredentials: 'An address with a user name or password is refused.',
  webFetchUrlTooLong: 'The address is longer than {max} characters.',
  webFetchReservedHost: '{host} is a local or reserved name, not a public site.',
  webFetchPrivateAddress:
    '{host} leads to {address}, which is not a public internet address. Nothing was fetched.',
  webFetchUnresolved: '{host} could not be found from this computer.',
  webFetchWithdrawn:
    'Web fetch is no longer allowed here (the workspace lost its trust, the permission mode changed, or the sandbox network setting became restricted), so the fetch stopped before its next request.',
  webFetchNat64Unknown:
    '{host} has only IPv6 addresses here, and whether this network translates them to IPv4 addresses (NAT64) could not be learned ({detail}), so they could not be checked for a private address. Nothing was fetched.',
  webFetchTooManyRedirects: 'The page redirected more than {max} times.',
  webFetchRedirectWithoutLocation: 'The server answered {status} without saying where to go.',
  webFetchRedirectRefused: 'The page redirected to an address that is refused: {reason}',
  webFetchHttpStatus: 'The server answered {status}.',
  webFetchTooLarge: 'The page is larger than {size}.',
  webFetchNoContentType: 'The server did not say what the page contains.',
  webFetchContentType: 'The page is {type}, not HTML or text.',
  webFetchContentTypeUnnamed: 'The page is not HTML or text.',
  webFetchEncoding: 'The page’s compression ({encoding}) could not be read.',
  webFetchEncodingUnnamed: 'The page’s compression could not be read.',
  webFetchTimeout: 'The page did not arrive within {duration}.',
  webFetchConversionTimeout:
    'The page arrived, but its HTML could not be converted in the time allowed (at most {duration}), so none of it was read.',
  webFetchConversionMemory:
    'The page’s HTML needed more than {max} to convert, so none of it was read.',
  webFetchXhtml:
    'The page is XHTML (application/xhtml+xml), which web fetch does not read: read as HTML, its XML syntax would be misread. Nothing was read.',
  webFetchUndecodable:
    'The page is in the {encoding} encoding, which this computer cannot decode, so none of it was read.',
  webFetchConversionFailed:
    'The page’s HTML could not be converted ({detail}), so none of it was read.',
  // Why no connection gave an answer: the page's host, and the checked
  // address(es) the request went to.
  webFetchCertificate:
    '{host}’s certificate at {address} is not trusted on this computer. Nothing was read. ({detail})',
  webFetchProxyCredentials:
    'The proxy asked for credentials before it would connect to {address} for {host}. Nothing was read.',
  webFetchProxyRefused:
    'A proxy or another machine in the way answered {status} instead of connecting securely to {address} ({host}). Nothing was read.',
  webFetchUnreachable: '{host} could not be reached at {address}. ({detail})',
  webFetchNetwork: 'The request failed: {detail}',
  // Web fetch is its own bundle (dist/webFetch.js, PLAN.md D6): a damaged install.
  webFetchUnavailable:
    'Web fetch could not be loaded, so nothing was fetched; reinstall the extension and reload the window. The log has the details.',
  // A redirect to another host, handed back to the model on the Model API
  // backend; and the refusal in Restricted Mode.
  webFetchMoved:
    'The page redirected to {location}, on another host. Muse can fetch it in a new call, which asks again.',
  webFetchRestrictedMode: 'Web fetch is off in Restricted Mode. Trust the workspace to use it.',
  // Observation packing (M73): a recall_output row's heading above the
  // recalled text (shown as it was), and why a recall read nothing back.
  packRecalled: 'Recalled characters {start} to {end} of {total} from packed output {id}',
  packRecallInvalid: 'The recall request was malformed, so nothing was read back.',
  packRecallUnknownId:
    'No packed output in this conversation has the id {id}, so nothing was read back.',
  packRecallBadOffset:
    'The offset is not a character position in packed output {id} (0 to {last}), so nothing was read back.',
  textFileTooLarge: 'Text files must be 1 MB or smaller.',
  textFilesOverBudget:
    'Attachments fill Muse Code’s message limit. Remove an attachment or shorten the message.',
  textFilesOverModelApiBudget:
    'Text attachments exceed the Model API context allowance. Remove a file or attach a smaller excerpt.',
  textFileInvalid: 'This file is not valid UTF-8 text.',
  textFilePrivate: 'This private file cannot be attached.',
  textFileLabel: 'Text',
  binaryFileUnsupported:
    'This binary file type cannot be attached. Use a PDF, image or UTF-8 text file.',
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
  codeIntelNoService: 'No language service answered for {path}, or it declares no symbols.',
  codeIntelTimedOut: 'The language service did not answer within {seconds} seconds.',
  repoMapNoService: 'No language service answered for the workspace’s symbols.',
  // The paid-use popup before an image, on either backend (M34, M44, M58).
  imageBuyTitle: 'Muse wants to create the image {path}',
  imageBuyEditTitle: 'Muse wants to make the edited image {path}',
  imageBuyPrompt: 'Prompt: {prompt}',
  imageBuySources: 'Starting from: {paths}',
  imageBuyBilling:
    'This costs {price}, billed to your Model API key, not to your Muse Code subscription.',
  approvalStage: 'step {position} of {total}',
  approvalProtectedWrite: 'Protected write',
  approvalJudgeEscalated: 'Escalated by the safety check',
  approvalFeedbackPlaceholder: 'Tell Muse what to do instead (optional)',
  approvalDecided: 'Decided',
  // PLAN.md D26: the approvals waiting, docked above the composer.
  approvalDockLabel: 'Waiting for your approval',
  // {count}: how many approvals wait, this one included.
  approvalDockCount: forms({
    one: 'Approval waiting: {count}',
    other: 'Approvals waiting: {count}',
  }),
  approvalDockedNote: 'Waiting for your approval, in the card above the message box',
  questionSubmit: 'Submit',
  questionCancel: 'Cancel',
  questionFreeTextPlaceholder: 'Type your answer',
  questionOther: 'Other',
  questionOtherPlaceholder: 'Type your own answer…',
  questionAnswered: 'Answered',
  questionCancelled: 'Cancelled',
  questionCancelFailed: 'The question could not be cancelled',
  // M46: an explanation instead of the options (MSP `userInput/clarify`).
  questionExplain: 'Explain instead',
  questionExplainTitle:
    'Answer in your own words instead of choosing; Muse reads it and decides again',
  questionExplainLabel: 'Your explanation',
  questionExplainPlaceholder: 'Say what you mean instead of choosing…',
  questionSendExplanation: 'Send explanation',
  questionBackToChoices: 'Back to the choices',
  questionClarified: 'Explained',
  clarifyNotAccepted: 'The explanation was not accepted',
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
  referenceTitle: 'Goes to the agent with your message as context',
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
  linkSchemeRefused: 'Only http, https and mailto links can be opened from the transcript.',
  sandboxNotice:
    'Muse Code cannot run shell commands until its Windows sandbox is set up. Run "Muse Spark: Set Up Shell Sandbox" (one administrator approval), then start a new conversation.',
  // Windows sandbox setup prompt and its outcomes (OS notifications).
  sandboxOffer:
    'Muse Code needs a one-time administrator setup before it can run shell commands on Windows (it creates the sandbox users and network filter it runs commands under). Set it up now?',
  sandboxSetUpNow: 'Set up now',
  sandboxNotNow: 'Not now',
  sandboxDontAskAgain: "Don't ask again",
  sandboxReady: 'Muse Code sandbox is ready. Start a new conversation to run shell commands in it.',
  sandboxAlreadyReady: 'Muse Code sandbox is already set up.',
  sandboxStillRequired: 'Muse Code sandbox is still not ready',
  sandboxCancelled: 'Muse Code sandbox setup did not complete',
  sandboxExitCode: 'exit code {code}',
  sandboxNotNeeded: 'Muse Code needs no sandbox setup on this platform.',
  sandboxCliMissing: 'Muse Code is not installed, so its sandbox cannot be checked.',
  // Editor integration (M5).
  editorContextTitle: 'Shared with Muse as context; × leaves it out',
  editorContextRemove: 'Leave the open file out',
  editorContextLabel: 'Open file',
  linePrefix: 'L',
  openFileTitle: 'Open the file at this change',
  openFileFailed: 'Could not open the file',
  toggleDetails: 'Show or hide the details',
  applyCode: 'Apply',
  noEditorForApply: 'Open a text editor to apply code into it.',
  diffTitleSuffix: 'Muse edit',
  editNotRebuildable: '{path} cannot be rebuilt: the file changed since this edit.',
  editUnsavedChanges:
    '{path} cannot be reverted: save or discard the unsaved editor changes, then try again.',
  editPathRefused: '{path} refused: the edited path is outside the workspace.',
  editNoPatch: 'This edit left no patch document.',
  // Session history (M6).
  historyLabel: 'History',
  historySearchPlaceholder: 'Search sessions',
  historyEmpty: 'No sessions in this workspace yet.',
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
  resumeDetail: 'Pick a previous conversation in this workspace',
  renameTitle: 'Rename this conversation',
  renamePlaceholder: 'Conversation name',
  // The user card's menu (Claude Code's rewind button): fork, rewind, both.
  rewindMenuLabel: 'Fork or rewind',
  forkFromHere: 'Fork conversation from here',
  rewindConversationToHere: 'Rewind conversation to here',
  rewindCodeToHere: 'Rewind code to here',
  forkAndRewind: 'Fork conversation and rewind code',
  rewindNothing: 'No edits after this message to rewind.',
  rewindDone: forms({
    one: 'Code rewound to this message ({count} edit)',
    other: 'Code rewound to this message ({count} edits)',
  }),
  forkedNotice: 'Forked into a new conversation.',
  rewindImagesUnavailable: 'Some images from this message could not be restored.',
  rewindBeforeCompaction: 'Cannot rewind before the latest compaction.',
  // Turn checkpoints (M86): the user card's menu, the confirmations, the result.
  restoreFilesToHere: 'Restore files to here',
  checkpointsModelApiOnly:
    'File restore and Redo require a connected Model API session. Only the model’s own file-tool edits are undone, while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone.',
  checkpointsLegacyReadOnly:
    'This message was recorded by an earlier version of Muse Spark. Its files cannot be restored.',
  checkpointsNativeUnsafe:
    'File restore and Redo are unavailable while a Muse Code session, or a window that does not record its edits, may still change files. Close or reload that window, then try again.',
  rewindAndRestore: 'Rewind conversation and restore files',
  checkpointsRestricted: 'File checkpoints are off in Restricted Mode',
  checkpointsOff: 'File checkpoints are off in settings',
  checkpointsNoGit: 'File checkpoints need git on PATH',
  conversationRewindUnavailable:
    'Rewinding the conversation is not available with Muse Code on Windows',
  restoreConfirmTitle: 'Restore the files to before this message?',
  restoreConfirmDetail:
    'Only the model’s own file-tool edits from this message on are undone, while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Files with unsaved changes are left as they are and named. Redo puts back what the restore changed.',
  restoreConfirmAction: 'Restore files',
  rewindCodeConfirmTitle: 'Rewind the code to before this message?',
  rewindCodeConfirmDetail:
    'Muse’s recorded edits after this message are undone, newest first; a file changed since is left as it is. What commands changed is not covered, and Restore files does not undo it either: it is left as it is; check version control.',
  rewindCodeConfirmAction: 'Rewind code',
  restoreBothConfirmTitle: 'Restore the files and rewind the conversation to before this message?',
  restoreBothConfirmDetail:
    'Only the model’s own file-tool edits from this message on are undone, while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Then the conversation branches before this message and its prompt returns to the composer. If a file is refused, the conversation is not rewound. The original conversation stays in History.',
  restoreBothConfirmAction: 'Restore and rewind',
  rewindNotDone: 'The conversation was not rewound.',
  restoreDone: forms({
    one: 'Restored {count} file to before this message.',
    other: 'Restored {count} files to before this message.',
  }),
  restoreNothing: 'No file needed restoring.',
  redoNothing: 'Nothing left to put back.',
  redoDone: forms({ one: 'Put {count} file back.', other: 'Put {count} files back.' }),
  redoAction: 'Redo',
  redoLabel: 'Redo: put back the files this restore replaced',
  redoGone: 'This restore can no longer be redone.',
  // PLAN.md D26: a notice said again is one row with a count, not a new row.
  // {count}: how many times it was said in all (2 or more).
  noticeRepeatBadge: '{count}×',
  noticeRepeated: forms({ one: 'Shown {count} time', other: 'Shown {count} times' }),
  restoreRefusedUnsaved: 'Left as they are, with unsaved changes: {files}',
  restoreRefusedChanged: 'Left as they are, changed by something else in the meantime: {files}',
  restoreRefusedBetween:
    'Left as they are, changed by something else between the model’s edits: {files}',
  restoreRefusedOrderUnknown:
    'Left as they are, edited from more than one window in an order that cannot be told: {files}',
  restoreRefusedLinked: 'Left as they are, reached through a link or junction: {files}',
  restoreRefusedNotKept: 'Not restorable, the earlier version was not kept: {files}',
  restoreRefusedTooLarge: 'Not restorable, too large to keep a copy of: {files}',
  restoreRefusedFailed: 'Could not be changed: {files}',
  restoreUnchanged: forms({
    one: 'Already as before: {count} file.',
    other: 'Already as before: {count} files.',
  }),
  restoreWritesIncomplete:
    'Nothing was restored: some of these turns’ edits were not fully recorded (a reload or crash mid-edit, or file checkpoints were off).',
  restoreLegacyInRange:
    'Nothing was restored: some of these turns were recorded by an earlier version, which this one cannot restore.',
  restoreLegacyWindowOpen:
    'Another window runs an older version of Muse Spark; reload it, then try again.',
  restoreCommandsNote:
    'Commands, hooks, MCP tools or background work were active in these turns; files they changed are not undone. Check your version control.',
  namedFilesMore: '{files} (+{count})',
  restoreNoCheckpoint: 'This message has no file checkpoint any more.',
  restoreTurnRunning: 'Wait until no turn is running in this window, then try again.',
  restoreTurnElsewhere:
    'A turn or file restore is running in another VS Code window on this folder. Try again when it has finished.',
  sendMarkFailed:
    'The message was not sent: this window could not tell other windows on this folder that a turn is starting.',
  restoreFailed: 'Could not restore the files',
  checkpointFailed: 'the checkpoint failed',
  childCheckpointFailed:
    'The subagent turn did not run: its file checkpoint could not be created or its inherited recording decision is unknown.',
  resumedNotice: 'Resumed',
  historyUnavailable: 'The conversation history could not be loaded',
  historyNotServed: 'The earlier messages of this conversation could not be shown',
  unreadTooltip: 'Muse needs your attention',
  unreadMark: '● ',
  sessionRequired: 'Start a conversation first.',
  // Account & usage dialog (M8).
  usageItem: 'Account & usage…',
  usageItemDetail: 'Subscription usage, this conversation’s tokens, the backend',
  agentsCommand: '/agents',
  agentsCommandDetail: 'Show the agent map',
  usageCommand: '/usage',
  usageCommandDetail: 'Show account usage',
  costCommand: '/cost',
  costCommandDetail: 'Show this conversation’s token totals',
  usageLabel: 'Account & usage',
  usagePlan: 'Plan',
  usagePlanSubscription: 'Muse Code subscription',
  usageBackend: 'Backend',
  usageWindow: 'Current window',
  usageWeekly: 'This week',
  usagePercentUsed: '{percent} used',
  usageResetsIn: 'resets in {duration}',
  usageAsOf: 'as of {time}',
  usageAwaitingFreshReport: 'Waiting for a fresh Muse Code usage report.',
  usageNoSubscription:
    'No subscription usage reported yet. Muse Code reports it after the first turn of a conversation.',
  usageModelApiNote:
    'This window runs on your Model API key: requests are billed to the key at pay-as-you-go rates and counted on the dev.meta.ai dashboard.',
  usageOpenDashboard: 'Open dev.meta.ai',
  usageSessionTokens: 'This conversation',
  usageInput: 'Input',
  usageOutput: 'Output',
  usageCached: 'Cached',
  usageContext: 'Context',
  usagePackedAvoided: 'Packing saved (estimate)',
  usageNoSession: 'No tokens counted yet in this conversation.',
  usageLoading: 'Reading usage…',
  usageUnavailable: 'Usage could not be read',
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
  notifyApprovalWaiting: 'Muse is waiting for your approval.',
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
  dictationFailed: 'Voice dictation failed',
  dictationUnavailable: 'Voice dictation is not available on this platform.',
  dictationUnavailableLinux:
    'Voice dictation is not available on Linux: no distribution ships a speech recogniser, and this extension adds no third-party engine.',
  dictationUnavailableWindows:
    'Voice dictation needs Windows PowerShell, which was not found (SystemRoot is not set).',
  dictationUnavailableDarwin:
    'Voice dictation needs the macOS helper (native/darwin/muse-dictate), which this build does not include.',
  // After `dictationFailed`, when voice's own code did not load (a damaged install).
  dictationNotLoaded:
    'the dictation code could not be loaded; reinstall the extension and reload the window. The log has the details.',
  announceListening: 'Listening',
  announceStoppedListening: 'Stopped listening',
  // Model API backend (M7).
  allowOnce: 'Allow once',
  allowSessionPrefix: 'Always allow in this session:',
  reject: 'Reject',
  modelApiStalled:
    'The Model API sent nothing for {seconds} s, so the reply was ended; send the message again to retry',
  queuedTurnDropped: 'Not sent: Stop cleared the queued messages',
  compactionStopped: 'the compaction was stopped',
  compactionStoppedNotice: 'Compaction stopped; the conversation is as it was.',
  // PLAN.md D26: a decision or answer that arrived after the prompt had moved.
  promptAlreadySettled: 'That request was already answered, so this choice was not needed.',
  promptMovedOn:
    'That request moved on to its next step before this choice arrived; choose again on the updated card.',
  promptGone: 'That request is no longer waiting for an answer.',
  // PLAN.md D26: Muse Code's own approval faults, and the way on.
  approvalReplayRefused:
    'Muse Code refuses every message in this conversation: a turn stopped while a multi-step command was partly approved, and Muse Code cannot replay that approval (a fault in Muse Code, not in your choices). Restart Muse Code to continue this conversation, or start a new one.',
  approvalLedgerFault:
    'Muse Code applies your approvals in this conversation but reports an error for each one (a fault in its approval record, not in your choices). Each card follows what Muse Code does next; a new conversation does not have the fault.',
  museCodeRestartAsked:
    'Muse Code was stopped. Your next message starts it again and continues this conversation.',
  // CLI recovery (2026-10-03): a steer whose answer never came may still reach the turn.
  steerUnconfirmed:
    'Muse Code did not confirm your message reached the running turn. It may still arrive; check before you send it again.',
  // The watchdog: a command refused at once while Muse Code answers nothing.
  museCodeNotAnswering:
    'Muse Code is not answering. Restart it with "Muse Spark: Restart Muse Code".',
  museCodeRestartedUnresponsive: 'Muse Code stopped answering and was restarted.',
  // Its notice offers Restart now (D26's action).
  museCodeUnresponsiveTurn:
    'Muse Code stopped answering while a turn runs. Restarting it stops that turn; the conversation continues with your next message.',
  // After "Muse Spark: Restart Muse Code".
  museCodeRestarted: 'Muse Code was restarted. Your next message continues this conversation.',
  // A session whose Muse Code event log failed (a CLI fault) takes no new message.
  sessionLogDamaged:
    'This conversation’s Muse Code log is damaged (a fault in Muse Code), so it cannot take new messages. Start a new conversation; this one stays in History.',
  turnUnqueued: 'Not sent: the queued message was withdrawn',
  turnRetracted:
    'Another Muse Code client withdrew a message from this conversation; reopen it from History to see it as stored.',
  modelRouteUnserved:
    'The signed-in account cannot serve this conversation’s model; choose another model from the model menu.',
  viewGapReloaded: 'Some updates from Muse Code were missed, so the conversation was reloaded.',
  viewGapReloadFailed:
    'Some updates from Muse Code were missed and the conversation could not be reloaded',
  commandTooLarge:
    'This message is too large for Muse Code, which accepts up to 10 MiB per message (images count at a third more than their file size). Remove an image or shorten the selection and send again.',
  outputIsBinary: 'The stored output is binary and cannot be shown as text',
  editReviewNeedsFolder: 'Open the folder the edit was made in to review or revert it.',
  unsavedFilesNotice:
    'Muse reads and edits the saved files, not unsaved editor changes (turn on museSpark.autosave to save before each message). Unsaved:',
  sessionEditsUnsupported:
    'Muse Code cannot rename or fork sessions on Windows (meta-models/muse-code-sdk#30, #31).',
  contributorTitle: 'Contributor-tier model',
  contributorDetail:
    'Meta may use prompts and completions sent to a contributor-tier model to train its models, in exchange for the lower price. Use it for this conversation?',
  contributorConfirm: 'Use contributor model',
  contributorBlocked:
    'Contributor-tier models are blocked in this workspace (museSpark.confidentialWorkspace).',
  backendItem: 'Backend',
  backendDetail: 'museSpark.backend: auto / museCode / modelApi',
  backendMuseCode: 'Muse Code (your Muse subscription)',
  backendModelApi: 'Meta Model API (your key, pay as you go)',
  modelApiBackendNotice:
    'This conversation runs on the Meta Model API with the extension’s own tools (read, edit, write, search, list, shell). Its sessions are kept in this workspace’s extension storage.',
  installOrKeyDetail:
    'The Muse Code CLI hosts conversations for this extension; without it you can still use a Meta Model API key.',
  compactionDone: 'Context compacted',
  // The Model API session budget (M82): a request that cannot fit is not
  // sent, and the turn's cost is shown against the cap afterwards.
  sessionBudgetStopped:
    'Stopped: the next request (about {estimate}) would pass the session budget of {cap} ({spent} used). It was not sent.',
  sessionBudgetStoreUnavailable:
    'The session spend ledger could not be read or saved. No new request can be sent until it is available.',
  sessionBudgetLegacyFeesUnknown:
    'The conversation’s spending is not fully verified. Wait for pending requests to finish, or start a new conversation to use a spend cap.',
  sessionBudgetSearchUnavailable:
    'Web search is unavailable under a finite spend cap: its billed query count has no verified limit. Ordinary chat and free web fetch remain available.',
  sessionBudgetRetryUnavailable:
    'The previous request may have been billed. Its full reservation was kept; send a new prompt to retry with a fresh allowance.',
  sessionBudgetUnknownCharge:
    'Usage was not verified. {amount} remains reserved as a possible charge; this is not a confirmed bill.',
  sessionBudgetVoiceUnavailable:
    'Muse Voice is unavailable under a finite spend cap: its billed audio duration has no verified bound. Use free system dictation.',
  sessionBudgetVoiceContextChanged:
    'Muse Voice stopped because the conversation or its permissions changed. Start a new recording in the current conversation.',
  sessionBudgetUnpriced:
    'Stopped: the session budget cannot be kept on {model}, whose price this extension does not know. The request was not sent.',
  sessionBudgetOutputLimited:
    'The response reached the output limit the session budget left it (max_output_tokens {tokens}) and may be cut short.',
  budgetTurnCost: 'This turn cost {cost} ({spent} of {cap} used).',
  resumeFailed: 'Could not resume the conversation',
  forkFailed: 'Could not fork the conversation',
  rewindConversationFailed: 'Could not rewind the conversation',
  sideChatFailed: 'Could not open a side chat',
  sideChatPlanOnly: 'Side chats stay in Plan mode.',
  // M79 (PLAN.md D49): plans as files. {path} is the plan's workspace path.
  planActionsLabel: 'Plan actions',
  savePlan: 'Save plan',
  implementPlan: 'Implement in a fresh conversation',
  planImplementDetail: 'A new conversation with this plan as its brief, out of Plan mode',
  planSaved: 'Plan saved to {path}.',
  planAlreadySaved: 'This plan is already saved in {path}.',
  planSaveFailed: 'Could not save the plan',
  planSaveConfirm: 'Save this plan in .agents/plans?',
  planSaveConfirmDetail:
    '.agents is a protected folder: what is in it guides the agents that work here. The plan is saved as a new file; no file is replaced.',
  planImplementFailed: 'Could not start the plan',
  planRestricted:
    'Plans are not saved or implemented in Restricted Mode. Trust this workspace to use them.',
  planWaitForTurn: 'Wait for the reply to finish, or stop it, first.',
  planReplyNotLatest: 'Only the latest reply in Plan mode can be saved as a plan.',
  planImplementSideChat:
    'Implement a plan from the main conversation; a side chat stays in Plan mode.',
  planBriefText: 'Implement the plan in {path}.',
  planTodosByModel:
    'Muse Code does not let the extension set its todo list, so the brief asks Muse to list the plan’s steps there.',
  planNamesTaken: 'Every file name for this plan is taken in .agents/plans.',
  planFileMissing: 'That plan file no longer exists.',
  // {size}: the limit in KB.
  planTooLarge: 'This plan is larger than {size} KB, the most a plan may be.',
  planSessionGone:
    'That conversation is no longer open in this panel, so this reply can no longer be saved or implemented as a plan.',
  planNotFromPlanTurn:
    'This reply was not written in Plan mode here, so it is not saved or implemented as a plan.',
  planHiddenMarkup:
    'The plan holds HTML that the panel does not show. Open {path} and read all of it before you implement it.',
  planHiddenMarkupNotStarted:
    'Plan saved to {path}, but not started: it holds HTML that the panel does not show. Read the file, then implement it from Plans….',
  planSavedNotStarted:
    'Plan saved to {path}, but not started: the conversation changed in the meantime.',
  planChangedNotStarted: 'The plan was not started: the conversation changed in the meantime.',
  planActionBusy: 'A plan action is still running.',
  planUnshownCharacters:
    'This plan holds a control or format character (such as a direction override or a zero-width character) that makes the panel show it otherwise than the model would read it, so it is not saved or started.',
  planMarkdownUnavailable:
    'The plan reader could not be loaded, so plans are not saved, listed or implemented; reinstall the extension and reload the window. The log has the details.',
  // {mode}: the permission mode's name.
  planFromFileMode:
    'A plan picked from Plans… starts in {mode}: the file comes from the workspace, so the conversation asks before it acts.',
  // M84: a plan written in a conversation that holds imported history.
  planFromImportedMode:
    'A plan from a conversation with imported history starts in {mode}: that history is untrusted, so the new conversation asks before it acts.',
  planOpen: 'Open',
  plansItem: 'Plans…',
  plansItemDetail: 'Saved plans in .agents/plans: open one or implement it',
  plansTitle: 'Plans',
  plansCount: forms({ one: '{count} saved plan', other: '{count} saved plans' }),
  plansNone: 'No saved plans yet. Save one from a reply in Plan mode.',
  plansFailed: 'Could not list the plans',
  // M74 (PLAN.md D49): `/handoff` to a new conversation. {goal} is the goal
  // typed after the command; {size} is the brief size limit in KB.
  handoffItem: '/handoff',
  handoffDetail: 'Distil this conversation into a brief for a fresh one',
  handoffRequestCard: 'Hand off to a new conversation.',
  handoffRequestCardWithGoal: 'Hand off to a new conversation: {goal}.',
  handoffDialogTitle: 'Hand off to a new conversation',
  handoffDialogBody:
    'Review the brief, edit it if you need to, then start the new conversation. Nothing starts until you confirm.',
  handoffConfirm: 'Start new conversation',
  handoffUnavailable: 'Handoff runs on the Model API backend only.',
  handoffEmpty: 'There is nothing to hand off yet.',
  handoffBusy: 'A handoff is already running.',
  handoffWaitTurn: 'Wait for the reply to finish, or stop it, first.',
  handoffSideChat: 'Start a handoff from the main conversation.',
  handoffInterrupted: 'The handoff request did not finish; nothing was started.',
  handoffFailed: 'Could not prepare the handoff',
  // After handoffFailed: the distillation turn ended with no reply text.
  handoffNoBrief: 'The model returned no brief.',
  handoffTooLarge: 'The brief is larger than {size} KB; start the new conversation by hand.',
  handoffChangedNotStarted:
    'The handoff was not started: the conversation changed in the meantime.',
  // {mode}: the permission mode's name. The model wrote the brief, so it
  // starts in the starting mode only when the dialog showed all of it.
  handoffUnshownMode:
    'The new conversation starts in {mode}: the brief holds a control or format character (such as a direction override or a zero-width character) that the dialog does not show, so you did not see all of it.',
  planOpenFailed: 'Could not open the plan',
  sideChatSessionOnly: 'This side chat can open only side-chat conversations.',
  renameFailed: 'Could not rename the conversation',
  sandboxOffProfileNotice:
    "This workspace is under your user profile, where Muse Code's Windows sandbox cannot run commands, so this window runs shell commands without the sandbox, directly as you. Approval prompts still apply. Setting: museSpark.shellSandbox.",
  rulesFileNoWorkspace: 'Open a folder first; AGENTS.md lives in the workspace root.',
  rulesFileExists: 'AGENTS.md already exists in this workspace; opening it.',
  rulesFileCreated: 'AGENTS.md created. Muse reads it as project rules from the next conversation.',
  terminalCliMissing: 'The Muse Code CLI is not installed, so there is no terminal to open.',
  signedOutNotice: 'Signed out of Muse Spark.',
  // The Agent map, the usage modal, the banner and the compact button (M14).
  agentsPillTitle: 'Show the agent map',
  agentsCount: forms({ one: '{count} agent', other: '{count} agents' }),
  // M46: the header pill while background work runs and no agent is shown.
  backgroundTasksPillTitle: 'Show the background tasks',
  agentMapTitle: 'Agent map',
  agentMapHint: 'click an agent for details',
  agentMapEmpty: 'No subagents in this conversation.',
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
  agentTranscriptLoading: 'Reading the agent’s transcript…',
  agentTranscriptFailed: 'Could not read the agent’s transcript',
  /** The Agent map's owner controls (M18). */
  agentInterrupt: 'Interrupt',
  agentStop: 'Stop',
  agentResume: 'Resume',
  agentClose: 'Close agent',
  agentReopen: 'Reopen agent',
  agentReadResult: 'Mark result read',
  agentSendMessage: 'Send message',
  agentFollowup: 'Follow-up task',
  agentMessagePlaceholder: 'A note for this agent, or its next task…',
  agentControlsLabel: 'Agent controls',
  agentControlFailed: 'The agent command was refused',
  agentResultText: 'Result',
  agentNoTranscript: 'No transcript for this agent.',
  agentTranscriptLabel: 'Agent transcript',
  agentDelegationOff:
    'Muse Code’s subagent delegation is off (its default), so the model has no agent tools in this conversation. Set run.subagent_delegation_mode to "auto" in the Muse Code settings file to enable it; the extension never edits that file.',
  agentOpenMuseSettings: 'Open the Muse Code settings file',
  museSettingsMissing: 'Muse Code has not written a settings file yet. It would be at {path}',
  // Workflows (M47, PLAN.md D40): a run's card, its agents and controls, the
  // Workflow tool's row, and Muse Code's trigger setting in the Agent map.
  workflowRowLabel: 'Workflow',
  // A run the model wrote for this task, not a saved one.
  workflowGenerated: 'Written for this task',
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
    auto: 'Muse Code’s workflows are on auto: the model may start one on its own for large work, and starts one when you ask. Each workflow agent makes its own model calls.',
    explicit:
      'Muse Code’s workflows are on explicit: the model starts one only when you ask for it.',
    off: 'Muse Code’s workflows are off: the model has no workflow tool.',
  },
  workflowTriggerOther: 'Muse Code’s workflow setting is {mode}.',
  workflowTriggerHowTo:
    'Set run.workflow_trigger_mode to "auto", "explicit" or "off" in the Muse Code settings file to change it; the extension never edits that file.',
  // The Workflow tool's row.
  workflowLaunched: 'Launched: it runs in the background and reports back to this conversation.',
  workflowScriptSaved: 'Script saved at {path}',
  backgroundTasksCount: forms({
    one: '{count} background task',
    other: '{count} background tasks',
  }),
  backgroundTasksLabel: 'Background tasks',
  backgroundBadge: 'background',
  subagentRowLabel: 'Agent',
  usageAccount: 'Account',
  usageAddModelApiKey: 'Add Model API key',
  usageReplaceModelApiKey: 'Replace Model API key',
  usageAuthMethod: 'Auth method',
  usageAuthCli: 'Meta account (Muse Code CLI)',
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
  usageCostNote:
    'Estimate from Meta’s published per-token prices for this model’s tier; the dev.meta.ai dashboard is the bill. Prices read on {date}.',
  usageContributing: 'What’s contributing to your usage?',
  usageDay: 'Day',
  usageWeek: 'Week',
  usageContributingNote:
    'Approximate, from the Muse Code CLI’s trace logs on this machine; other devices are not included.',
  usageInsightReminders:
    '{percent} of model attempts came from Muse Code’s reminder agents, which run after every reply',
  usageInsightSubagents: '{percent} of model attempts came from subagents',
  usageInsightLong: '{percent} of model attempts came from sessions active for 8+ hours',
  usageInsightNone: 'No CLI activity recorded in this window.',
  usageInsightUnavailable: 'Not available on this backend: the Model API has no local trace logs.',
  usageInsightNoLogs: 'No Muse Code trace logs were found on this machine yet.',
  usageInsightTotals: '{attempts} across {sessions}',
  modelAttemptsCount: forms({ one: '{count} model attempt', other: '{count} model attempts' }),
  sessionsCount: forms({ one: '{count} session', other: '{count} sessions' }),
  durationNow: 'now',
  contextCompactTitle: 'Click to compact now',
  unsupportedFileTitle: 'Unsupported file type:',
  unsupportedFileDetail:
    'Supported as uploads: images (PNG, JPEG, GIF, WebP). Other files go in as @ mentions inside the workspace, or by absolute path in the prompt for files outside it.',
  bannerDismiss: 'Dismiss',
  trustGrantedNotice:
    'Workspace trusted: Muse will load its rules, skills and memory from the next message.',
  sandboxRestartNotice:
    'A Muse Code setting changed; Muse Code restarts with it on the next message and continues this conversation.',
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
    manual: 'Muse will ask before running commands; Muse Code edits workspace files without asking',
    acceptEdits:
      'On Muse Code, the same as Manual: Muse Code edits workspace files without asking and asks before running commands',
    plan: 'Muse will explore the code and present a plan before editing',
    auto: 'Muse Code runs the commands it judges simple without asking and asks before the rest',
    bypassPermissions: 'Muse will edit files and run commands without asking',
  },
  museCodeReviewedAutoDetail:
    'Muse Code runs the commands it judges simple without asking; a reviewer may allow some others once, and you are asked about the rest',
  modelApiPermissionModeDetails: {
    manual: 'Muse will ask for approval before each edit and each command',
    acceptEdits: 'Muse will edit files without asking and ask before running commands',
    auto: 'Muse will edit files without asking, except protected files, and ask before commands',
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
    cron_delete: 'Cancel scheduled prompt',
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
    personal_project: 'Your memory for this project',
    project: 'Project memory, shared with the repository',
    personal: 'Your memory for every project',
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
  goalEditedNotice: 'Goal changed: {objective}',
  goalPausedNotice: 'Goal paused',
  goalResumedNotice: 'Goal resumed',
  goalClearedNotice: 'Goal cleared',
  goalNone: 'There is no goal in this conversation. Set one with /goal <objective>.',
  goalWakeWithdrawn: 'Goal work stopped before it started.',
  goalRequestSuperseded: 'The goal changed while this response was in progress.',
  goalCannotPause: 'Only an active goal can be paused.',
  goalCannotResume: 'Only a paused goal can be resumed.',
  goalCannotEdit:
    'Only an active or paused goal can be changed; set a new one with /goal <objective>.',
  goalObjectiveMissing: 'Type the objective after /goal.',
  // {limit} is the maximum objective length, formatted in the user's locale.
  goalObjectiveTooLong: 'Keep the goal objective within {limit} characters.',
  goalCommandFailed: 'The goal command failed',
  // A goal command the backend already had when a key activation or a
  // backend restart came: whether it took is not known.
  goalOutcomeUnknown:
    'The sign-in changed or the backend restarted while the goal command ran: it may or may not have taken effect. Check the session goal.',
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
  loopItemDetail: 'Schedule a prompt in this Model API conversation',
  loopSyntax:
    'Use /loop 10m <prompt>, /loop "0 9 * * 1-5" <prompt>, /loop list, or /loop cancel <id>.',
  schedulePanelLabel: 'Scheduled prompts for this conversation',
  schedulePanelTitle: 'Scheduled prompts',
  schedulePanelScope: 'Model API · this workspace, conversation and key',
  scheduleEvery: 'Every {duration}',
  schedulePending: 'Due · waiting for you to run it',
  scheduleRun: 'Run now (paid)',
  scheduleCancel: 'Cancel schedule',
  scheduleEnablePaid: 'Enable paid runs',
  scheduleRunJob: 'Run scheduled prompt {id}',
  scheduleEnableJob: 'Enable paid runs for scheduled prompt {id}',
  scheduleCancelJob: 'Cancel scheduled prompt {id}',
  scheduleCreated: 'Scheduled prompt {id} created. It will wait for you when due.',
  scheduleCancelled: 'Scheduled prompt {id} cancelled.',
  scheduleUnknown: 'Scheduled prompt {id} was not found in this conversation and key.',
  scheduleCommandFailed: 'The schedule command failed',
  scheduleModelApiOnly:
    'These schedules belong to the Model API backend. Ask Muse Code to manage its own cron jobs in chat.',
  scheduleAccountMissing: 'Store a Model API key to use schedules.',
  scheduleStorageMissing: 'Workspace storage is unavailable; this schedule cannot be saved.',
  scheduleInvalid: 'The scheduled prompt or cadence is invalid.',
  scheduleTooMany: 'This conversation has reached its scheduled prompt limit.',
  scheduleNoFire: 'This cadence has no run within the seven-day schedule lifetime.',
  schedulePaidOff:
    'Turn on Scheduled prompts (paid) and accept its price before running a due prompt.',
  scheduleBusy: 'Wait for the current turn to finish before running this prompt.',
  scheduleNotDue: 'This scheduled prompt is not due or is no longer available.',
  scheduleAlreadyRun: 'This occurrence was already admitted in another window or before a restart.',
  scheduleRunStarted: 'Started with your permission. Model API tokens are billed to your key.',
  scheduleRunConfirmTitle: 'Run this scheduled prompt with {model}?',
  scheduleRunConfirmPrompt: 'Prompt: {prompt}',
  scheduleRunConfirmPrice: 'Billed to your Model API key: {price}. Total varies with tokens used.',
  scheduleRunConfirmExtras:
    'Other enabled paid tools may add their own charges. Bypass does not skip this confirmation.',
  scheduleConfirmationExpired:
    'The model, conversation or prompt changed during confirmation. Review the schedule and choose Run again.',
  webNoResults: 'No results',
  backgroundRunning: 'Running in the background',
  // M46 (PLAN.md D39): moving a running command to the background, stopping
  // background work, and the user's own `!` shell commands.
  moveToBackground: 'Move to background',
  moveToBackgroundTitle: 'Keep this command running in the background and let Muse carry on',
  moveToBackgroundFailed: 'The command could not be moved to the background',
  nothingToMoveToBackground: 'No command is running that could move to the background',
  stopTask: 'Stop',
  stopTaskTitle: 'Stop this background task',
  stopUserShellTitle: 'Stop this command',
  stopAllTasks: 'Stop all',
  stopAllTasksTitle: 'Stop every background task of this conversation',
  stopTaskFailed: 'The background task could not be stopped',
  taskNotRunning: 'That task is not running any more',
  userShellLabel: 'You ran',
  userShellExitCode: 'Exit code {code}',
  userShellExitSignal: 'Ended by signal {signal}',
  userShellRestricted:
    'Shell commands do not run while the workspace is in Restricted Mode. Trust the workspace to run them.',
  userShellNotGranted: 'This Muse Code did not allow shell commands from the panel',
  userShellFailed: 'The command did not run',
  composerShellMode: 'Shell',
  composerShellModeTitle:
    'Runs this command in the workspace, as you. Muse sees the command and what it printed.',
  runCommandTitle: 'Run command',
  toolImageAlt: 'The image {path}',
  toolImageFailed: 'The image could not be shown',
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
  bundledSkillsOffer:
    'Muse Spark comes with the skills {skills}. Install them for Muse Code? They are copied into your Muse config folder.',
  bundledSkillsUpdateOffer:
    'Muse Spark comes with a newer release of its bundled skills ({tag}). Update the copy Muse Code uses?',
  bundledSkillsInstall: 'Install',
  bundledSkillsUpdate: 'Update',
  bundledSkillsNotNow: 'Not now',
  bundledSkillsInstalled: forms({
    one: 'Installed {count} bundled skill ({tag}) for Muse Code: {skills}',
    other: 'Installed {count} bundled skills ({tag}) for Muse Code: {skills}',
  }),
  bundledSkillsSkipped: forms({
    one: 'Left {count} skill out because a skill of yours has that name: {skills}',
    other: 'Left {count} skills out because skills of yours have those names: {skills}',
  }),
  bundledSkillsRemoved: forms({
    one: 'Removed {count} bundled skill from Muse Code: {skills}',
    other: 'Removed {count} bundled skills from Muse Code: {skills}',
  }),
  bundledSkillsNothingToRemove:
    'No bundled skills are installed for Muse Code, so nothing was removed.',
  bundledSkillsInstallFailed: 'The bundled skills could not be installed at {folder}: {reason}',
  bundledSkillsRemoveFailed: 'The bundled skills could not be removed at {folder}: {reason}',
  // The reason when the folder is there but holds no mark of the extension's install.
  bundledSkillsNotOurs:
    'a folder of that name exists that Muse Spark did not install, so it was left alone',
  bundledSkillsUnavailable:
    'The bundled skills installer could not be loaded; reinstall the extension and reload the window. The log has the details.',
  // The conversation's notices (they were English literals in the controller).
  notSignedInReason: 'Sign in before sending a message.',
  noWorkspaceReason: 'Open a folder first; Muse works inside a workspace.',
  nothingToSendReason: 'Type a message or attach an image first.',
  nothingToCompact: 'Nothing to compact yet.',
  // {reason}: the backend's own id for why, such as `noop`.
  nothingToCompactReason: 'Nothing to compact ({reason}).',
  compactionFailed: 'Compaction failed',
  answerNotAccepted: 'The answer was not accepted',
  outputLoadFailed: 'Could not load the output',
  outputLoadRetry:
    'Muse Code may be busy: collapse and expand the row to try again. Further failures go to the log only.',
  editReviewFailed: 'Could not review the edit',
  modelSwitchFailed: 'Could not switch model',
  effortNotApplied: 'Reasoning effort could not be applied',
  permissionModeNotApplied: 'Could not apply the permission mode',
  permissionModeChangeFailed: 'Could not change the permission mode',
  // {action}: the panel's id for a host command, such as `openSettings`.
  hostActionFailed: '{action} failed',
  contributorResumeFallbackTo:
    'The resumed conversation was on a contributor-tier model; it now uses {model}.',
  // Edit review's outcomes, per file (M5).
  editRevertedPath: 'Reverted {path}.',
  editCreatedRemovedPath: '{path}: Moved to the trash (Muse created it).',
  modelApiNeedsFolder: 'Open a folder first; the Model API backend works inside a workspace.',
  modelApiBundleUnavailable:
    'The Model API backend could not be loaded; reinstall the extension and reload the window. The log has the details.',
  // The same in the ACP agent (D62), whose package ships the bundle.
  acpModelApiBundleUnavailable:
    'The Model API backend could not be loaded; reinstall muse-spark-code-acp and restart the agent. The agent’s log has the details.',
  // Why the Muse Code CLI was not found, on the sign-in page and in warnings.
  cliNotFound: 'Muse Code is not installed in any known location.',
  cliPathNotAbsolute: 'museSpark.museBinaryPath must be an absolute path.',
  cliSearched: 'Searched: {paths}',
  // The ACP agent in other editors (M63, PLAN.md D61, D62): its sign-ins,
  // the key's commands, its errors and its help.
  acpAuthMuseCodeName: 'Sign in to Muse Code',
  acpAuthMuseCodeDetail:
    'Runs Muse Code’s own sign-in in a terminal. Your Muse subscription pays for the conversations.',
  acpAuthKeyName: 'Store a Meta Model API key',
  acpAuthKeyDetail:
    'Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations.',
  // {command}: the sign-in command, for a client that cannot run it itself.
  acpSignInByHand: 'Run “{command}” in a terminal, then try again.',
  acpMuseCodeSignedOut: 'Muse Code is not signed in; sign in and try again.',
  acpNoStoredKey: 'No Meta Model API key is stored; store one and try again.',
  acpKeyPrompt: 'Meta Model API key (not shown as you type): ',
  // {store}: where the key lives (acpStoreNames).
  acpKeyStored: 'The key is stored in {store}.',
  acpKeyNotStored: 'No key was entered, so nothing was stored.',
  acpKeyPresent: 'A Meta Model API key is stored in {store}.',
  acpKeyAbsent: 'No Meta Model API key is stored.',
  acpKeyCleared: 'The Meta Model API key was removed from this computer’s credential store.',
  // {reason}: the operating system's own error.
  acpStoreUnavailable:
    'This computer’s credential store cannot be used ({reason}). On Linux the agent needs a running, unlocked Secret Service, such as GNOME Keyring or KWallet.',
  acpStoreNames: {
    windows: 'Windows Credential Manager',
    macos: 'the macOS Keychain',
    linux: 'the Secret Service keyring',
  },
  acpNoModels: 'The backend offers no model this agent may use.',
  acpPromptBusy: 'A prompt is already running in this session.',
  acpQuestionFormMessage: 'Muse has a question for you.',
  acpQuestionAsked:
    'Muse has a question; this editor cannot show it as a form, so answer in your next message:',
  acpUnknownArgument: 'Unknown argument: {argument}',
  // {argument}: the paid feature's flag as typed.
  acpPaidNeedsModelApi: '{argument} needs --backend modelApi: paid features bill a Model API key.',
  // {command}: the executable's name. The options and values stay as typed.
  acpUsage: [
    'Usage:',
    '  {command} [options]              Serve the Agent Client Protocol on stdin and stdout',
    '  {command} [options] login        Sign in to Muse Code in this terminal',
    '  {command} auth set|status|clear  Store, check or remove the Meta Model API key',
    '  {command} exec [options] <prompt>  Run one headless turn',
    '  {command} scan-secrets <file> [--key-stdin]  Count likely secrets in one file (prints only the number)',
    'Options:',
    '  --backend museCode|modelApi      Who pays: Muse Code (the default) or the Model API key',
    '  --trust-workspace                Load the folder’s rules, skills and memory',
    '  --muse-binary <path>             The Muse Code CLI to run',
    '  --shell-sandbox auto|muse|off    Muse Code’s shell sandbox',
    '  --allow-dangerously-skip-permissions  Offer the Bypass permissions mode',
    '  --allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    '  --web-search                     Offer paid web search (Model API backend; its price is asked first)',
    '  --image-generation               Offer paid image generation (Model API backend; its price is asked first)',
    '  --verbose                        Log every detail on stderr',
    '  --help, --version',
  ].join('\n'),
  // M80 (PLAN.md D65): the headless exec and scan-secrets commands.
  execBudgetRequired: 'Model API requires --max-budget-usd.',
  execNumberInvalid: 'Invalid number or limit; the USD budget accepts at most six decimal places.',
  execTrustRefused: 'Headless runs refuse workspace trust and bypass permissions.',
  execModeRefused: 'Headless runs permit only plan or acceptEdits.',
  execWebSearchUnbounded: 'Hosted web search has no bounded allowance and is refused.',
  execPaidNeedsEdits: 'Image generation requires acceptEdits.',
  execModelApiOnly: 'These options require the Model API backend.',
  execMuseCodeOnly: 'These options require the Muse Code backend.',
  execModelUnpriced: 'This model has no known tariff.',
  execPromptMissing: 'Provide one nonempty prompt.',
  execPromptTwice: 'Choose exactly one prompt source.',
  execStdinTwice: 'Prompt and key cannot both use stdin.',
  execKeyStdinTerminal: 'Read the key from a pipe, not a terminal.',
  execKeyMissing: 'No valid Model API key was provided.',
  execKeyTooLong: 'The key exceeds the byte limit.',
  execFileUnreadable: 'The input file cannot be read.',
  execFileTooLarge: 'The input exceeds the byte limit.',
  execTooManyChunks: 'The input exceeds the chunk limit.',
  execUnknownModel: 'This model is not available for this run.',
  execEffortUnavailable: 'This effort is not available for this model.',
  execTimedOut: 'The run reached its deadline.',
  execBudgetRefused: 'The next request exceeds the remaining budget.',
  execBudgetMinimum: 'This run requires at least {minimum}.',
  execBudgetBreach: 'Observed accounting exceeded its reservation.',
  execIncomplete: 'The response did not complete.',
  execDeniedStop: 'An approval denial stopped this run.',
  execInterrupted: 'The run was interrupted.',
  execOutputStalled: 'Output closed or stalled.',
  execRequestShape: 'The request shape is not permitted.',
  execAccountingInvalid: 'Response accounting is invalid.',
  execAccountingUnverified: 'Response accounting could not be verified.',
  execMessageWithheld: 'message withheld: the response did not complete',
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
    one: 'The request cap of {count} attempt was reached.',
    other: 'The request cap of {count} attempts was reached.',
  }),
  execScanMatches: forms({
    one: '{count} secret match',
    other: '{count} secret matches',
  }),
  execUsage: 'exec [options] <prompt> | exec [options] --prompt-file <path> | exec [options] -',
  execScanUsage: 'scan-secrets <file> [--key-stdin]',
  execSummary:
    '{status}; requests {requests}; settled {settled}; uncertain {uncertain}; image attempts {imageAttempts}; returned {imagesReturned}; uncertain images {imagesUncertain}',
  execSummaryUpperBound:
    '{status}; requests {requests}; settled {settled}; uncertain {uncertain}; image attempts {imageAttempts}; returned {imagesReturned}; uncertain images {imagesUncertain}; Cost is an upper bound.',
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
    one: 'The output ({count} byte) is stored by the backend and not included.',
    other: 'The output ({count} bytes) is stored by the backend and not included.',
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
  insertReferencePanelOpened:
    'Opened the Muse Spark panel. Press Alt+K again to insert the reference.',
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
    palette: 'opens the actions palette: model, effort, permission mode, history',
    cycleMode: 'cycles the permission mode while the composer has focus',
    mentionSelection: 'inserts an @-mention of the editor selection',
    mentionFile: 'mentions a file; drag files or paste images to attach them',
    newTab: 'opens a conversation in a new editor tab',
    dictation: 'records your voice into the composer (tap to toggle, hold to talk)',
    shell:
      'at the start of a message runs it as a shell command in the workspace; Muse sees what it printed',
    moveToBackground: 'moves a running command to the background, so Muse carries on',
  },
  // M26 (PLAN.md D29): dictation in a remote window, and a macOS helper that
  // ends before it is ready.
  dictationUnavailableRemote:
    'Voice dictation is not available in a remote window (SSH, WSL, a container, a tunnel or a codespace): the extension runs on the remote machine, which cannot hear this computer’s microphone. Open the folder in a local window to dictate.',
  dictationDarwinEarlyExit:
    'macOS ended the dictation helper before it was ready. After a permission step, macOS refused that permission (to muse-dictate, or to the app that started it where the helper could not ask under its own name); with no step at all, macOS refused to run the helper itself, which is not notarised. The README’s Voice dictation section explains both.',
  museLoginTerminalName: 'Muse Code sign-in',
  // Muse Code's documented exit codes (SDK `classifyExit`): what each means
  // for the user; whether restarting can help is MUSE_EXIT_PERSISTENT_CODES.
  museExitMeanings: {
    0: 'Muse Code stopped',
    1: 'Muse Code failed with an unhandled error',
    2: 'Muse Code rejected its command line (a usage error)',
    3: 'Muse Code refused its configuration; check its settings.json and museSpark.environmentVariables',
    4: 'another Muse Code client holds this session; it frees once that client exits',
    5: 'this Muse Code build does not serve the SDK surface the extension uses; update Muse Code',
  },
  museExitedWithCode: 'Muse Code exited with code {code}',
  museExitMeaning: '{meaning} (exit code {code})',
  museStoppedBySignal: 'Muse Code was stopped by {signal}',
  museUnknownSignal: 'an unknown signal',
  // The paid Model API features (M33–M35, PLAN.md D30): opt in and loud.
  // {price} is a dollar amount in the display language's money format.
  paidWebSearchName: 'Web search',
  paidImageGenerationName: 'Images',
  paidVoiceName: 'Muse Voice',
  paidScheduledName: 'Scheduled prompts',
  paidSubagentsName: 'Subagents',
  paidSubagentRates:
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; up to {limit} requests per task, including retries.',
  paidSubagentTaskTitle: 'Approve paid task for {role}?',
  paidSubagentTaskDetail:
    '{objective}\n\n{price}\n\nBilled to your Model API key. Actual cost depends on tokens used. Other enabled paid tools are charged separately. Allow once covers this task only.',
  // The popup before each paid use (M58): its buttons, and the two uses that
  // have no popup of their own. "Allow once" is `allowOnce`.
  paidAllowAlways: 'Allow always in this workspace',
  paidDeny: 'Deny',
  paidUseWebSearchTitle: 'Let Muse search the web for this prompt?',
  paidUseWebSearchDetail:
    'Muse may search the web while it answers. Each search is billed to your Model API key at {price}, on top of the tokens its results add. Deny sends the prompt without web search.',
  paidUseVoiceTitle: 'Record with Muse Voice?',
  paidUseVoiceDetail:
    'Muse Voice transcribes this recording, billed to your Model API key at {price}. Deny leaves the microphone off.',
  paidWebSearchPrice: '{price} per 1,000 searches',
  paidImagePrice: '{price} per image',
  paidVoicePrice: '{price} per hour of audio',
  paidScheduledPrice: '{input}/1M input, {cached}/1M cached input, {output}/1M output tokens',
  // The confirmation shown when a paid feature is turned on; {feature} is its name.
  paidConfirmTitle: 'Turn on {feature}?',
  paidConfirmWebSearch:
    'The model may search the web while it answers. Each search is billed to your Model API key at {price}, on top of the tokens its results add. Each prompt asks first, unless you allow web search always in this workspace. Used on the Model API backend only.',
  paidConfirmImage:
    'The model may create image files in the workspace, or edit workspace images into new ones. Each image is billed to your Model API key at {price}, and you are asked before every one, in every permission mode, unless you allow images always in this workspace. Used on the Model API backend, and on the Muse Code backend while a key is stored (never billed to the subscription).',
  paidConfirmVoice:
    'The microphone will send what you record to Meta’s Muse Voice Transcribe instead of your computer’s own recogniser, billed to your Model API key at {price}. Each recording asks first, unless you allow Muse Voice always in this workspace. Used on the Model API backend, and on the Muse Code backend while a key is stored.',
  paidConfirmScheduled:
    'A due scheduled prompt waits for you to run it. Each run asks before any Model API call, unless you allow scheduled runs always in this workspace. {price}. Billed to your Model API key; total varies with tokens used.',
  paidConfirmSubagents:
    'Child agents make additional requests billed to your Model API key. {price} Each new task asks for approval in every permission mode, including Bypass, unless you allow subagents always in this workspace. Actual cost depends on tokens used; other paid tools cost extra. Model API backend only.',
  paidBestOfNName: 'Best of N',
  paidBestOfNRates:
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; {attempts} attempts with up to {limit} requests each, including retries.',
  paidBestOfNTitle: 'Run {attempts} paid attempts?',
  paidBestOfNDetail:
    '{prompt}\n\n{price}\n\nBilled to your Model API key. Actual cost depends on tokens used. Allow once covers this run only.',
  paidConfirmBestOfN:
    'The same prompt runs in separate worktrees, each billed to your Model API key. {price} Each run asks for approval in every permission mode, including Bypass, unless you allow best-of-N always in this workspace. Actual cost depends on tokens used; other paid tools cost extra. Model API backend only.',
  usagePaidBestOfNAttempts: forms({ one: '{count} attempt', other: '{count} attempts' }),
  usagePaidBestOfNIncluded: 'Reported token estimate: {cost}',
  // The session board (M77, PLAN.md D49).
  boardTitle: 'Session board',
  boardUnavailable:
    'The session board and best-of-N could not be loaded. Reinstall the extension and try again.',
  boardEmpty: 'No conversations yet. Send a message to start one.',
  boardStatusRunning: 'Running',
  boardStatusIdle: 'Idle',
  boardAwaitingApproval: forms({
    one: '{count} approval waiting',
    other: '{count} approvals waiting',
  }),
  boardChanges: forms({ one: '{count} changed file', other: '{count} changed files' }),
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
  bestOfNContextChanged: 'The account, conversation or run changed. Start a new run.',
  bestOfNTargetChanged:
    'The checkout changed, has unsaved edits, or contains protected or linked targets. Nothing was applied.',
  bestOfNBudgetUnavailable:
    'Best-of-N cannot start under a session budget until its attempts share the originating budget.',
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
  bestOfNCeilingReached: 'stopped at the request ceiling',
  bestOfNRequests: forms({ one: '{count} request', other: '{count} requests' }),
  bestOfNApprovalsDenied: forms({
    one: '{count} approval declined',
    other: '{count} approvals declined',
  }),
  bestOfNAttemptFailed: 'Failed: {reason}',
  bestOfNTakenMark: 'Took {branch}',
  bestOfNDiffClipped: 'Diff clipped.',
  bestOfNInvalidPrompt: 'Describe what the attempts should do.',
  bestOfNInvalidRequest: 'That best-of-N run is outside the attempt or ceiling bounds.',
  bestOfNInvalidAttempts: 'Attempts must be between {min} and {max}.',
  bestOfNInvalidCeiling: 'Requests per attempt must be between {min} and {max}.',
  bestOfNNeedsTrust:
    'Best-of-N needs a trusted workspace: worktrees run git, which Restricted Mode forbids.',
  bestOfNModelApiOnly:
    'Best-of-N runs on the Model API backend only; each attempt is billed to the key, never to the subscription.',
  bestOfNPaidOff: 'Best-of-N is off. Enable it and accept the price before starting a run.',
  bestOfNNoWorkspace: 'Best-of-N needs an open folder.',
  bestOfNTariffUnknown: 'No verified price is available for this model. The run cannot start.',
  bestOfNConsentDeclined: 'The paid run was not approved.',
  bestOfNAlreadyRunning: 'A best-of-N run is already going in this window.',
  bestOfNAlreadyTaken: 'This run already took {branch}.',
  bestOfNNoRun: 'There is no best-of-N run.',
  bestOfNUnknownAttempt: 'That attempt is not part of this run.',
  bestOfNAttemptNotDone: 'Only a finished attempt can be taken.',
  bestOfNWorktreeFailed: 'Could not create the attempt worktrees: {reason}',
  bestOfNTaken: 'Applied and staged the preview from {branch}.',
  bestOfNTakeFailed:
    'Could not apply and stage {branch}. Check the checkout before retrying: {reason}',
  paidConfirmAccept: 'Turn on',
  // The composer's badge while a paid feature is on; {features} lists their names.
  paidBadge: 'Paid: {features}',
  paidBadgeTitle:
    'Billed to your Model API key: {prices}. Click for this window’s tally in Account & usage.',
  // A paid call's row in the transcript.
  paidRowBadge: 'paid',
  paidRowTitle: 'Billed to your Model API key: {price}',
  // The palette's toggles (Model API backend only); {feature} is the name.
  paidToggleLabel: '{feature} (paid)',
  // The usage dialog's tally.
  usagePaidHeading: 'Paid features in this window',
  usagePaidOn: 'on',
  usagePaidOff: 'off',
  // M58: a feature that no longer asks in this workspace; {features} lists names.
  usagePaidOnAlways: 'on, allowed always in this workspace',
  usagePaidAlwaysNote: 'Allowed always in this workspace, without asking: {features}.',
  usagePaidAskAgain: 'Ask again every time',
  usagePaidSearches: forms({ one: '{count} search', other: '{count} searches' }),
  usagePaidImages: forms({ one: '{count} image', other: '{count} images' }),
  usagePaidAudio: '{duration} of audio',
  usagePaidSubagentRequests: forms({
    one: '{count} child request',
    other: '{count} child requests',
  }),
  usagePaidSubagentUnknown: forms({
    one: '{count} request has no reported cost yet',
    other: '{count} requests have no reported cost yet',
  }),
  usagePaidSubagentSubset:
    'Reported child costs are included in their parent conversations’ token estimates. They are not added to the extra-feature total. Requests without reported usage may still be billed.',
  usagePaidExtraTotal: 'Estimated extra-feature total',
  usagePaidSubagentReported: 'Reported token estimate: {cost}',
  usagePaidTotal: 'Estimated paid total',
  usagePaidScheduled: forms({ one: '{count} scheduled run', other: '{count} scheduled runs' }),
  usageScheduledIncluded: 'token cost included above',
  usagePaidNote:
    'Estimated at Meta’s published prices, read on {date}, for this window since it opened; the dev.meta.ai dashboard is the bill.',
  subagentPaidOff:
    'Paid subagents are off. Enable them and accept the price before starting a child task.',
  agentToolNotOffered:
    'This tool is not in this agent’s allowlist. Use only the tools offered in its instructions.',
  // A custom agent refused because a folder or file of higher precedence did
  // not load (M76 review); {path} is that folder or file.
  agentUnloaded:
    'The agent “{id}” did not start: {path} could not be loaded, and a definition there would take precedence. Fix or remove it, then start a new conversation.',
  subagentConsentDeclined: 'The paid child task was not approved.',
  subagentContributorBlocked:
    'The custom agent names a contributor-tier model, which cannot run while this workspace is confidential (museSpark.confidentialWorkspace).',
  subagentRequestLimit:
    'The child task reached its approved limit of {limit} requests, including retries.',
  subagentKeyChanged:
    'The Model API key changed after approval. Approve a new child task to continue.',
  subagentModelChanged: 'The model changed after approval. Approve a new child task to continue.',
  subagentGoalEnded:
    'The originating goal is no longer active. The child task cannot make another request.',
  subagentTariffUnknown:
    'No verified price is available for this model. The child task cannot start.',
  subagentPlanMode: 'Plan mode refuses paid child tasks; switch mode and approve a new task.',
  subagentWebSearchOff: 'Web search was turned off before this child request; no request was sent.',
  webSearchFailed: 'The search failed',
  // Under a reply that cites web pages (M33).
  citationsHeading: 'Sources',
  // The microphone while Muse Voice is its engine (M35); {price} per hour of audio.
  dictationPaidLabel: 'Record voice with Muse Voice (paid)',
  dictationPaidTitle:
    'Muse Voice, paid: {price}, billed to your Model API key. Tap or hold to record (Ctrl+D)',
  // Why Muse Voice cannot record or transcribe.
  museVoiceNoKey: 'Muse Voice needs a Model API key; sign in with one first.',
  museVoiceNoAnswer: 'Muse Voice did not answer; check the connection and try again.',
  museVoiceNoFinal: 'Muse Voice did not send the transcript in time; try again.',
  museVoiceMalformed: 'Muse Voice sent something that is not JSON, so the recording was dropped.',
  museVoiceRefused: 'Muse Voice refused the recording',
  museVoiceRateLimited: 'Muse Voice is rate-limited for this key; wait a moment and try again.',
  // {code}: the WebSocket close code Meta sent.
  museVoiceClosed: 'Muse Voice closed the connection (code {code})',
  museVoiceNoWebSocket:
    'Muse Voice needs WebSocket support in VS Code’s extension host, which this version does not have.',
  museVoiceNoRecorder:
    'Muse Voice on Linux records with arecord (ALSA) or parec (PulseAudio); neither was found on PATH.',
  // M56 (PLAN.md D43): why a Model API request never reached Meta; the
  // technical detail follows in parentheses.
  networkUntrustedCertificate:
    'The server’s certificate is not trusted. If your network inspects HTTPS, install its root certificate in the operating system’s certificate store (VS Code reads it while http.systemCertificates is on), or turn http.systemCertificates off and name the root’s file in NODE_EXTRA_CA_CERTS before VS Code starts.',
  networkProxyCredentials:
    'The proxy asked for credentials and did not accept the ones it got. Check http.proxy and http.proxyAuthorization, or the credentials VS Code asked you for.',
  // {status}: the HTTP status the proxy answered with.
  networkProxyRefused:
    'The proxy refused the connection (HTTP {status}). Check that it allows api.meta.ai.',
  networkUnreachable:
    'Meta’s server could not be reached. Check the network connection, and http.proxy and http.proxySupport if you use a proxy.',
  // The same three in the ACP agent (PLAN.md D62, Q66), where VS Code's
  // settings do not reach: they name the agent's environment variables.
  acpNetworkUntrustedCertificate:
    'The server’s certificate is not trusted. If your network inspects HTTPS, name its root certificate’s file in NODE_EXTRA_CA_CERTS in the agent’s environment, or add --use-system-ca to NODE_OPTIONS there (Node 22.15 or later) to trust the operating system’s store, then restart the agent.',
  acpNetworkProxyCredentials:
    'The proxy asked for credentials and did not accept the ones it got. Check the user name and password in the proxy’s address in HTTPS_PROXY (http://user:password@host:port) in the agent’s environment, then restart the agent.',
  acpNetworkUnreachable:
    'Meta’s server could not be reached. Check the network connection. Behind a proxy, set HTTPS_PROXY and NODE_USE_ENV_PROXY=1 in the agent’s environment (Node 22.21 or later, or 24) and restart the agent: without NODE_USE_ENV_PROXY the agent does not use the proxy.',
  // Muse Code refused a permission mode above the ceiling its configuration sets.
  approvalModeCeiling:
    'Muse Code’s configuration (its default permission profile, or a policy your administrator manages) does not allow this permission mode. Choose a stricter one, such as Manual, and send again.',
  // M70 (PLAN.md D49): review. The palette's rows.
  groupReview: 'Review',
  reviewItem: '/review',
  reviewItemDetail: 'Review the uncommitted changes, a branch, a commit, or what you describe',
  reviewUncommittedItem: 'Review uncommitted changes',
  reviewUncommittedDetail: 'Staged and unstaged changes, against the last commit',
  reviewBranchItem: 'Review this branch…',
  reviewBranchDetail: 'Every change since it left the base branch you pick',
  reviewCommitItem: 'Review a commit…',
  reviewCommitDetail: 'One of the latest commits, which you pick',
  reviewSecurityItem: 'Security review',
  reviewSecurityDetail:
    'The uncommitted changes, for injection, secrets, authentication and unsafe APIs',
  reviewChangesItem: 'Review this conversation’s changes',
  reviewChangesDetail: 'Accept or revert each change, and comment on a line',
  // The base-branch and commit pickers.
  reviewPickBase: 'The branch to compare this one with',
  reviewPickCommit: 'The commit to review',
  reviewDefaultBase: 'default base',
  // Why a review did not start, on its card.
  reviewBusy: 'A review starts once the current turn has ended.',
  reviewRestricted:
    'Reviewing git’s changes needs git, which does not run in Restricted Mode. Trust this workspace, or say what to review: /review <what to look at>.',
  reviewNotRepository:
    'This folder is not in a git repository, so there are no git changes to review. Say what to review instead: /review <what to look at>.',
  reviewNoChanges: 'There are no changes to review.',
  reviewOnlyPrivate:
    'Only files that may hold secrets changed (environment files, keys, credentials), and they are not sent for review.',
  reviewNoBase: 'No base branch was found to compare with. Name one: /review branch <base>.',
  // {revision}: the branch or commit named after /review.
  reviewUnknownRevision: 'Git does not know {revision} as a branch or commit.',
  reviewNoCommits: 'This repository has no commits to review yet.',
  reviewGitFailed: 'Git could not read the changes to review.',
  reviewCancelled: 'Review cancelled.',
  // The review's own module (dist/review.js) could not be loaded.
  reviewUnavailable:
    'The review could not be loaded, so no review can start; reinstall the extension and reload the window. The log has the details.',
  reviewInstructionsTooLong: 'What to review is too long for one review; say it more briefly.',
  // What went with a review, and the permission mode around a Muse Code review.
  reviewTruncatedNotice:
    'The diff is long, so only its first part went with the review; the reviewer reads the rest of the changed files itself.',
  reviewPrivateLeftOut: forms({
    one: '{count} changed file that may hold secrets was named but not sent for review.',
    other: '{count} changed files that may hold secrets were named but not sent for review.',
  }),
  reviewPlanModeNotice:
    'This review runs in Plan mode, and the permission mode you had comes back when it ends. Muse Code applies its own allow rules in Plan mode, so a review there is not strictly read-only.',
  // {mode}: the permission mode's name.
  reviewModeRestored: 'The review ended: the permission mode is {mode} again.',
  reviewModeNotRestored:
    'The permission mode could not be set back after the review, so the conversation stays in Plan mode',
  reviewAlreadyReverted: 'This change was already reverted.',
  // The review pane.
  reviewPaneTitle: 'Changes in this conversation',
  reviewPaneLoading: 'Reading the changes…',
  reviewPaneEmpty: 'This conversation has not changed any files.',
  reviewPaneFiles: forms({ one: '{count} file', other: '{count} files' }),
  reviewPaneHunks: forms({ one: '{count} change', other: '{count} changes' }),
  reviewPaneAccepted: forms({ one: '{count} accepted', other: '{count} accepted' }),
  reviewPaneReverted: forms({ one: '{count} reverted', other: '{count} reverted' }),
  reviewPaneOmitted: forms({
    one: '{count} edit is not listed here (too many to show, or its change could not be read); its row in the transcript still opens it.',
    other:
      '{count} edits are not listed here (too many to show, or their changes could not be read); their rows in the transcript still open them.',
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
  reviewCommentPlaceholder: 'What should the agent know or change here?',
  reviewSendSteer: 'Send to the running turn',
  reviewSendNext: 'Send as the next message',
  reviewCommentCancel: 'Cancel',
  // {line}: a line number; {text}: that line's code.
  reviewLineOption: 'Line {line}: {text}',
  reviewRemovedLineOption: 'Removed line {line}: {text}',
  reviewOpenFile: 'Open file',
  reviewCommentSent: 'Comment sent to the agent',
  // What the live region says when a change's Revert settles; {name} is reviewHunkName.
  reviewAnnounceReverted: '{name} reverted',
  reviewAnnounceNotReverted: '{name} not reverted: {reason}',
  // The findings list under a review's reply.
  reviewFindingsLabel: 'Review findings',
  reviewFindingsHeading: forms({ one: '{count} finding', other: '{count} findings' }),
  reviewNoFindings: 'The review found nothing to report.',
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
  codeIntelPolicyRefused: 'File permissions refuse this code intelligence operation.',
  // A tool call the permission settings stopped allowing while it was in
  // progress: at its process, its write or its request, or once it was done.
  policyChangedRefused:
    'The permission settings changed while this was in progress and no longer allow it. It was refused, and nothing from it was sent to the model.',
  // The same, for a call whose change was already written by then.
  policyChangedKeptWrite:
    'The permission settings changed while this was in progress and no longer allow it. Its change was already written and stays; nothing from it was sent to the model.',
  approvalAskRuleNote: 'Your command rule asks about this command every time.',
  // {why}: the rule's own justification, as the user wrote it.
  approvalAskRuleWhy: 'Your command rule asks about this command every time: {why}',
  // Who answered a call no card was shown for (the row's "Decided" line).
  autoReviewerResolver: 'Auto reviewer',
  commandRuleResolver: 'Command rule',
  // The Auto reviewer's row and the card it leaves; {reason}: the reviewer's own words.
  autoReviewAllowed: 'Allowed: {reason}',
  autoReviewAsked: 'Asks you: {reason}',
  autoReviewerFailed: 'The Auto reviewer could not answer, so you decide.',
  autoReviewerUnreadable: 'The Auto reviewer’s answer could not be read, so you decide.',
  autoReviewerPaused:
    'The Auto reviewer is paused for this turn after repeated declines or failures, so you decide.',
  autoReviewerTripped:
    'The Auto reviewer stopped for the rest of this turn after repeated declines or failures. Every risky action asks you until you send your next message.',
  // The window's first review on Muse Code (M90, PLAN.md D69).
  museCodeReviewerNotice:
    'On by default. In Auto on Muse Code, only approvals for the running turn that no rule settles are eligible: one short Muse Code turn on your subscription in a hidden Plan session. Protected writes, paid calls, child tasks, questions, replayed or escalated requests, unknown subjects, requests without allow-once and sessions shared by panels are never reviewed. A successful review may allow once; declines, failures, busy sessions, timeouts or a tripped breaker show the approval card. Host exit recreates the side session. Turn it off with museSpark.museCodeAutoReviewer.',
  // The paid feature (D48): its name, confirmation, popup and tally.
  paidAutoReviewerName: 'Auto reviewer',
  paidConfirmAutoReviewer:
    'In Auto mode on the Model API backend, a separate model call judges each risky action that no rule settles, and runs it without asking when it looks safe. It never allows a forbidden command, a command your rules ask about, a protected write or a paid call, and when it declines or fails, you decide. Each review is billed to your Model API key at the conversation model’s token rates:\n{price}\nEvery review asks first, unless you allow reviews always in this workspace.',
  // {tool}: the tool the reviewed call is for; {action}: its command line or arguments.
  paidUseAutoReviewerTitle: 'Let the Auto reviewer judge this {tool} call?',
  paidUseAutoReviewerDetail:
    '{action}\n\nA separate call to {model} judges whether it may run without asking you. Billed to your Model API key: {price}. Total varies with tokens used. Deny shows you the approval card instead.',
  usagePaidAutoReviews: forms({ one: '{count} review', other: '{count} reviews' }),
  // Problems in the permission settings, each said once in the conversation.
  // {setting}: the setting's name; {index}: the rule's place in it, from 1;
  // {pattern}: the rule's words; {detail}: the error, or the failing example.
  commandRuleInvalid: '{setting}: rule {index} is not valid and is not applied ({detail}).',
  commandRuleInvalidKept:
    '{setting}: rule {index} ({pattern}) is not valid ({detail}). It still asks or forbids by its pattern, since that can only tighten.',
  commandRuleExampleFailed:
    '{setting}: allow rule {index} ({pattern}) does not do what its example “{detail}” says, so it is not applied.',
  commandRuleExampleFailedKept:
    '{setting}: rule {index} ({pattern}) does not do what its example “{detail}” says. It still applies, since it can only tighten.',
  commandRuleAllowInRepository:
    '{setting}: rule {index} ({pattern}) is an allow rule, and a repository’s rules can only tighten, so it is not applied.',
  commandRuleAllowsEvaluator:
    '{setting}: allow rule {index} ({pattern}) would allow a command that runs text as code, so it is not applied.',
  commandRulesTooMany:
    '{setting}: {detail} rules is more than are read; rule {index} and those after it are not applied.',
  permissionProfileUnknown:
    '{setting}: no permission profile is named “{name}”. Until one is, every shell command asks and file tools refuse every file.',
  permissionProfileInvalid:
    '{setting}: the profile “{name}” is not valid ({detail}). Until it is fixed, every shell command asks and the file tools refuse every file.',
  permissionProfileInvalidData: 'Invalid or unsupported profile data.',
  permissionGlobInvalid:
    'The deny-read glob “{glob}” cannot be read ({detail}). Until it is fixed, the file tools refuse every file.',
  permissionRootInvalid:
    '{setting}: the extra root “{root}” is not an absolute path, so it is not added.',
  permissionRepositoryInvalid:
    '{setting}: the repository’s rules are not valid ({detail}) and are not applied.',
  // M68 (PLAN.md D49): the verify loop's rows. {count}: the edited files'
  // errors or warnings.
  verifyErrors: forms({ one: '{count} error', other: '{count} errors' }),
  verifyWarnings: forms({ one: '{count} warning', other: '{count} warnings' }),
  verifyClean: 'No errors or warnings',
  // {count}: edited files whose problems were not read (no report in time, …).
  verifyUnchecked: forms({ one: '{count} file not checked', other: '{count} files not checked' }),
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
    refused: 'the permission mode refuses shell commands',
    restricted: 'shell commands are off in Restricted Mode',
    unsafePath: 'a file name cannot be passed to it safely',
    changed: 'the file changed after the edit',
    stopped: 'the checks stopped after failing round after round',
  },
  // An edit's then_run: the command it ran right after the edit.
  thenRunLabel: 'Then ran',
  // {reason}: one of checkSkips, with the user's or the hook's words after it.
  thenRunNotRun: 'Not run: {reason}',
  // After "a hook denied it": the hook rewrote the command into none.
  hookInputNoCommand: 'The hook’s updated input names no command.',
  thenRunTimedOut: 'Stopped at its time limit',
  // The command could not start or ended without an exit code.
  thenRunNoExitCode: 'Failed without an exit code',
  // The fix loop reached its limit. {count}: the failing rounds in a row.
  checksStoppedNotice: forms({
    one: 'The checks still failed after {count} round of fixes, so they will not run again automatically until your next message.',
    other:
      'The checks still failed after {count} rounds of fixes in a row, so they will not run again automatically until your next message.',
  }),
  exportThenRunLabel: 'Then ran:',
  // {command}: the then_run command; {outcome}: why it did not run.
  exportThenRunSkipped: 'then_run `{command}`: {outcome}',
}

/** The shape every table has: English's keys, with any language's plural forms. */
export type UiText = typeof EN
