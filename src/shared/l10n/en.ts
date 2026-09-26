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
  signInBrowserDetail: 'Opens a terminal running `muse login`; approve the code in your browser.',
  signInApiKey: 'Use a Model API key',
  signInApiKeyDetail: 'Paste a key from dev.meta.ai; it is stored in VS Code secret storage.',
  installTitle: 'Muse Code is not installed',
  installDetail:
    'The Muse Code CLI hosts conversations for this extension. Install it, then reload.',
  installAction: 'Open install instructions',
  retryAction: 'Check again',
  apiKeyPrompt: 'Meta Model API key',
  apiKeyPlaceholder: 'LLM|1234567890|…',
  apiKeyInvalid: 'A Model API key looks like LLM|<numeric id>|<secret>.',
  signInWaiting: 'Waiting for the browser sign-in to finish…',
  signInTimedOut: 'The sign-in did not complete in time. Try again.',
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
  hooksTitle: 'Muse Code hooks',
  hooksWarning: 'Hooks run through your shell, outside Muse Code’s sandbox and approvals',
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
  attachmentLimit: 'At most 20 images per message.',
  attachmentUnreadable: 'The image could not be read.',
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
  // M34: {action} is the new image's path.
  approvalCreateImage: 'Muse wants to create the image {action}',
  // An image edit's card (M44): {action} is the new file's path.
  approvalEditImage: 'Muse wants to make the edited image {action}',
  // {paths} is the list of images the edit starts from, shown as code.
  approvalImageSources: 'Starting from {paths}',
  // The confirmation before an image the extension makes for Muse Code (M44).
  imageBuyTitle: 'Muse Code wants to create the image {path}',
  imageBuyEditTitle: 'Muse Code wants to make the edited image {path}',
  imageBuyPrompt: 'Prompt: {prompt}',
  imageBuySources: 'Starting from: {paths}',
  imageBuyBilling:
    'This costs {price}, billed to your Model API key, not to your Muse Code subscription.',
  imageBuyAccept: 'Pay {price} and create',
  // M34: on the card of a paid call; {price} as `paidImagePrice` says it.
  approvalPaid: 'Paid: {price}, billed to your Model API key',
  approvalStage: 'step {position} of {total}',
  approvalProtectedWrite: 'Protected write',
  approvalJudgeEscalated: 'Escalated by the safety check',
  approvalFeedbackPlaceholder: 'Tell Muse what to do instead (optional)',
  approvalDecided: 'Decided',
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
  rewindCodeToHere: 'Rewind code to here',
  forkAndRewind: 'Fork conversation and rewind code',
  rewindNothing: 'No edits after this message to rewind.',
  rewindDone: forms({
    one: 'Code rewound to this message ({count} edit)',
    other: 'Code rewound to this message ({count} edits)',
  }),
  forkedNotice: 'Forked into a new conversation.',
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
    'Muse Code 1.3.0 cannot rename or fork sessions on Windows (meta-models/muse-code-sdk#30, #31).',
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
  resumeFailed: 'Could not resume the conversation',
  forkFailed: 'Could not fork the conversation',
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
  agentSendMessage: 'Send message',
  agentFollowup: 'Follow-up task',
  agentMessagePlaceholder: 'A note for this agent, or its next task…',
  agentControlsLabel: 'Agent controls',
  agentControlFailed: 'The agent command was refused',
  agentResultText: 'Result',
  subagentsUnsupported: 'The Model API backend runs no subagents',
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
  workflowCancel: 'Cancel workflow',
  workflowSkip: 'Skip',
  workflowRetry: 'Retry',
  // The same buttons as a screen reader names them; {child} is the agent's label.
  workflowSkipChild: 'Skip {child}',
  workflowRetryChild: 'Retry {child}',
  workflowCancelRefused: 'The workflow was not cancelled: {reason}.',
  workflowChildRefused: 'The workflow agent was not changed: {reason}.',
  // Why Muse Code refused a control, keyed by its own reason.
  workflowRefusals: {
    already_terminal: 'it has already finished',
    missing_run: 'Muse Code has no live run by that id',
    invalid_target: 'that agent is not running',
    stale_attempt: 'that agent has moved on to a new attempt',
  },
  workflowControlFailed: 'The workflow command failed',
  workflowCommandStatusUnexpected: 'Workflow command {method} returned status {status}',
  workflowsUnsupported: 'The Model API backend runs no workflows',
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
  sandboxProfileNotice: String.raw`This workspace is under your user profile, which the Windows sandbox of this Muse Code version cannot enter: shell commands will start in the PowerShell folder instead of the project and take about half a minute each. File reads and edits are unaffected. A workspace outside C:\Users runs commands in place.`,
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
  // D7), per backend where they differ (D24): in Manual Muse Code applies
  // edits inside the workspace without an approval (verified live in M4), and
  // the Model API backend has no safety-check judge behind Auto.
  permissionModeDetails: {
    manual: 'Muse will ask before running commands; Muse Code edits workspace files without asking',
    acceptEdits: 'Muse will edit files without asking and ask before running commands',
    plan: 'Muse will explore the code and present a plan before editing',
    auto: 'Muse will approve actions that pass a safety check and pause for anything risky',
    bypassPermissions: 'Muse will edit files and run commands without asking',
  },
  modelApiPermissionModeDetails: {
    manual: 'Muse will ask for approval before each edit and each command',
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
  // Read out when the goal's status changes; {status} is the status in words.
  announceGoalStatus: 'Goal: {status}',
  scheduleOnce: 'Once',
  scheduleRepeats: 'Repeats',
  // {date} is the local date and time.
  scheduleNextRun: 'Next run {date}',
  scheduleFired: forms({ one: 'Ran {count} time', other: 'Ran {count} times' }),
  scheduleNone: 'No scheduled prompts',
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
  // Why the Muse Code CLI was not found, on the sign-in page and in warnings.
  cliNotFound: 'Muse Code is not installed in any known location.',
  cliPathNotAbsolute: 'museSpark.museBinaryPath must be an absolute path.',
  cliSearched: 'Searched: {paths}',
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
  paidWebSearchPrice: '{price} per 1,000 searches',
  paidImagePrice: '{price} per image',
  paidVoicePrice: '{price} per hour of audio',
  // The confirmation shown when a paid feature is turned on; {feature} is its name.
  paidConfirmTitle: 'Turn on {feature}?',
  paidConfirmWebSearch:
    'The model may search the web while it answers. Each search is billed to your Model API key at {price}, on top of the tokens its results add, and the extension cannot ask before each one. Used on the Model API backend only.',
  paidConfirmImage:
    'The model may create image files in the workspace, or edit workspace images into new ones. Each image is billed to your Model API key at {price}, and you are asked before every one, in every permission mode. Used on the Model API backend, and on the Muse Code backend while a key is stored (never billed to the subscription).',
  paidConfirmVoice:
    'The microphone will send what you record to Meta’s Muse Voice Transcribe instead of your computer’s own recogniser, billed to your Model API key at {price}. Used on the Model API backend, and on the Muse Code backend while a key is stored.',
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
  usagePaidSearches: forms({ one: '{count} search', other: '{count} searches' }),
  usagePaidImages: forms({ one: '{count} image', other: '{count} images' }),
  usagePaidAudio: '{duration} of audio',
  usagePaidTotal: 'Estimated paid total',
  usagePaidNote:
    'Estimated at Meta’s published prices, read on {date}, for this window since it opened; the dev.meta.ai dashboard is the bill.',
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
}

/** The shape every table has: English's keys, with any language's plural forms. */
export type UiText = typeof EN
