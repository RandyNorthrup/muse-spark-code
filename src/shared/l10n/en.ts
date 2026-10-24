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
  nodeWorkspace: {
    controlCharacter: 'Control character',
    selectionDeleted: 'Selection deleted',
    currentBranch: 'Current branch',
    refresh: 'Refresh',
    search: 'Search files',
    path: 'File path',
    save: 'Save file',
    saved: 'File saved.',
    diff: 'Review changes',
    original: 'Saved version',
    modified: 'Edited version',
    stage: 'Stage file',
    fetch: 'Fetch',
    pull: 'Pull',
    branches: 'Branches',
    branchName: 'New branch name',
    createBranch: 'Create branch',
    noFiles: 'No files found.',
    discard: 'Discard edits',
    unsaved: 'Save or discard your edits before opening another file.',
    truncated: 'This diff is truncated. Refresh for the current changes.',
    destination: 'SSH destination',
    hostKey: 'Verified host key',
    head: 'Current commit',
    networkConfirm: 'Verify {action} to {remote} on {ref} at {head}.',
    binaryReplaced:
      'The upload replaced the open file with bytes that are not UTF-8 text. The editor was closed.',
  },
  // M110a0: node labels and messages; consumers read UI_TEXT at runtime.
  // M110-A1: console recovery and browser trust instructions.
  nodeAuth: {
    lockout:
      'Passkey sign-in is locked. Use the local node console to issue a new one-time setup code and enroll a replacement passkey.',
    windows:
      'Windows: import the compared certificate into your user certificate store, then restart the browser.',
    macos:
      'macOS: import the compared certificate in Keychain Access, trust it for this node, then restart the browser.',
    linux:
      'Linux: import the compared certificate using your browser’s certificate manager, then restart the browser.',
    firefox:
      'Firefox uses its own certificate manager. If it cannot trust this non-CA certificate, pairing is unavailable pending platform qualification.',
    verified:
      'I compared the downloaded certificate’s full SHA-256 fingerprint with the node console and installed that certificate.',
    download: 'Download node certificate',
    trustRequired:
      'Install the compared certificate before creating or using a passkey. Clicking through a warning does not establish trust.',
  },
  nodeLabels: {
    title: 'Muse Spark Code Node (Unofficial)',
    files: 'Workspace files',
    editor: 'File editor',
    terminal: 'Workspace terminal',
    git: 'Git changes',
    dashboard: 'Node dashboard',
    audit: 'Audit log',
    cpu: 'CPU usage',
    memory: 'Memory usage',
    disk: 'Disk space',
    uptime: 'Uptime',
    sharedSandbox: 'Shared sandbox',
    attended: 'Attended',
    unattended: 'Unattended',
    sealed: 'Key store sealed',
    unsealed: 'Key store unlocked',
    fingerprint: 'Certificate fingerprint',
    pairBrowser: 'Pair this browser',
    signin: 'Sign in with a passkey',
    enroll: 'Create owner passkey',
    stepUp: 'Verify your identity',
    setupCode: 'One-time setup code',
    name: 'Node name',
    address: 'LAN interface',
    deployKey: 'SSH deploy public key',
    lock: 'Lock node',
    unlock: 'Unlock key store',
    wipe: 'Wipe node',
    stopAll: 'Stop everything',
    screenReader: 'Screen-reader mode',
    terminalPerson: 'Your terminal',
    terminalModel: 'Model terminal',
    terminalShared: 'Shared terminal',
    newTerminal: 'New terminal',
    attachTerminal: 'Attach terminal',
    terminalId: 'Terminal ID',
    close: 'Close',
    sessions: 'Sessions',
    workspaces: 'Workspaces',
    version: 'Version',
    challenges: 'Pending sign-in challenges',
    help: 'Node help',
    whatsNew: "What's new",
    upload: 'Upload file',
    download: 'Download file',
    trustWorkspace: 'Trust workspace',
  },
  nodeMessages: {
    sharedSandbox: 'All workspaces share one sandbox. Tools run as a separate user.',
    trustCertificate:
      'Compare {fingerprint} with the node console before trusting this certificate on this PC.',
    changedCertificate:
      'The node certificate changed. Compare its fingerprint and pair this browser again.',
    nameRequired: 'Passkeys require a trusted HTTPS domain name. Connect using {name}.',
    nameUnresolved:
      'The node name {name} does not resolve. Configure LAN DNS or a hosts-file entry on this PC.',
    setupExpires: 'This setup code expires at {time} and can enroll one owner passkey.',
    reloadSignsIn: 'This page keeps its session in memory. Reloading requires sign-in again.',
    stepUpFor: 'Verify your identity to {action}.',
    locked: 'The node is locked. All sessions and terminals ended; the key store is sealed.',
    sealedAtBoot: 'The key store starts sealed after every restart. Unlock it to use stored keys.',
    noObserver: 'No person is attached. Approval requests wait and expire as refusals.',
    paidConsent:
      'Paid extras ask before the first charge, show the price, and share the daily budget {budget}.',
    deployKey:
      'Add this public deploy key to your git host. Only the git page can use its private key.',
    wipeConfirm: 'Wipe {name}? This removes the node’s keys, state and workspaces.',
    listenChoice: 'The node will listen only on the LAN interface you choose.',
    museCodeUnavailable:
      'Muse Code is unavailable until container sandbox and headless sign-in checks pass.',
    terminalOpened: 'Opened terminal {id} in {workspace}.',
    terminalEnded: 'Terminal {id} ended with exit code {code}.',
    auditRetention: 'Audit storage is capped at {size} and retained for {days}.',
    unofficial: 'This node is unofficial and is not endorsed by Meta.',
    unexpectedFailure: 'The node hit an unexpected failure and kept running.',
  },
  nodeTerminal: {
    connecting: 'Connecting…',
    ended: 'Terminal ended.',
    chunkFailed: 'The terminal could not be loaded.',
    retry: 'Retry',
  },
  nodeDashboard: {
    noSessions: 'No sessions.',
    noWorkspaces: 'No workspaces.',
    pendingChallenges: 'Pending challenges',
    nodeId: 'Node ID',
    sessionWeb: 'Web',
    sessionTui: 'TUI',
    sessionEditor: 'Editor',
    trusted: 'Trusted',
    untrusted: 'Untrusted',
  },
  nodeAudit: {
    filterAll: 'All events',
    filterSignin: 'Sign-ins',
    filterSignup: 'Enrollments',
    filterTerminal: 'Terminals',
    filterKeys: 'Keys',
    filterNode: 'Node',
    filterGit: 'Git',
    filterApproval: 'Approvals',
    allowed: 'Allowed',
    refused: 'Refused',
    noEntries: 'No audit entries.',
    more: 'Show more',
    signinEnroll: 'Enrolled',
    signinSignin: 'Signed in',
    signinSignout: 'Signed out',
    signinLockout: 'Locked out',
    terminalStart: 'Started',
    terminalEnd: 'Ended',
    terminalSizes: '{input} received, {output} sent',
    keySet: 'Stored',
    keyUnlock: 'Unlocked',
    keyUse: 'Used',
    keySeal: 'Sealed',
    keyProvider: 'Provider key',
    keyDeploy: 'Deploy key',
    gitStage: 'Staged',
    gitCommit: 'Committed',
    gitBranch: 'Branched',
    gitFetch: 'Fetched',
    gitPull: 'Pulled',
    gitPush: 'Pushed',
    approvalPaid: 'Paid',
    kindStepUp: 'Verification',
  },
  nodeHelp: {
    title: 'Node help',
    files: 'Workspace files: browse, edit, upload and download this workspace.',
    terminal: 'Terminal: a shell in this workspace. Opening one verifies your identity.',
    dashboard: 'Dashboard: readings, sessions and workspaces on this node.',
    audit: 'Audit log: sign-ins and every audited event, newest first.',
    git: 'Git changes: status, stage, commit and branch; network moves verify your identity.',
    sandbox: 'All workspaces share one sandbox until workspace sandboxes land.',
  },
  nodeWhatsNew: {
    title: "What's new on this node",
    terminal: 'Terminal: a shell in the workspace, with sign-in audit for every session.',
    dashboard: 'Dashboard: CPU, memory and disk readings with sessions and workspaces.',
    audit: 'Audit log: sign-ins and node events, newest first.',
    sandbox: 'Two-user preview: every workspace shares one sandbox for now.',
  },
  nodeErrors: {
    invalidRequest: 'The request is invalid.',
    unavailable: 'The node feature is unavailable.',
    unauthenticated: 'Sign in to continue.',
    forbidden: 'This session cannot perform that action.',
    stepUpRequired: 'Verify your identity before this action.',
    expired: 'This request or session expired.',
    locked: 'The node is locked.',
    conflict: 'The file or branch changed. Refresh before retrying.',
    tooLarge: 'The request exceeds the size limit.',
    rateLimited: 'Too many requests. Wait before retrying.',
    notText: 'This file is not UTF-8 text.',
    noSuchWorkspace: 'The workspace does not exist.',
    notFound: 'The requested item was not found.',
    cancelled: 'The action was cancelled.',
    untrusted: 'Trust the workspace before running repository code.',
    unsupported: 'This operation is not supported on this node.',
    running: 'The node is running. Stop it before wiping.',
    failed: 'The node command failed.',
  },
  // M110 T: terminal surface, read only at render/dispatch time.
  tuiInvalidFrame: 'The node sent an invalid or oversized frame.',
  tuiConnecting: 'Connecting to the node…',
  tuiAttended: 'Attended',
  tuiUnattended: 'Unattended',
  tuiResources: 'CPU {cpu}; memory {memory}',
  tuiSealed: 'Key store sealed',
  tuiUnlocked: 'Key store unlocked',
  tuiPaidCost: 'Paid: {price}. Shared daily budget: {budget}.',
  tuiFingerprint: 'Certificate SHA-256: {fingerprint}',
  tuiSetupCode: 'One-time setup code: {code}',
  tuiYou: 'You',
  tuiAgent: 'Agent',
  tuiAnswered: 'Request answered.',
  tuiUnsafeSocket: 'The local socket and its folder must be private and owned by this user.',
  tuiDisconnected: 'The node connection ended or could not be opened.',
  tuiStopRequested: 'Stop everything requested.',
  tuiInputTooLong: 'The message is too long.',
  tuiApprovalFocus:
    'Press Tab to focus this request, then press its number. Pasted choices are ignored.',
  tuiApprovalTooLarge: 'The full request does not fit. Enlarge the terminal; choices are disabled.',
  tuiKeys: 'Esc: Stop all | Tab: views | ↑/↓: scroll | Enter: send | numbers: choose',
  tuiUsage:
    'Usage: muse-spark-code-acp tui [--screen-reader] [--no-color] [--reduced-motion] [--nerd-font]',
  tuiRendererMissing: 'The terminal renderer is not installed.',
  tuiLineKeys:
    'Esc: Stop all. /stop /chat /diff /tasks /status. Enter sends. Choose an approval by number; Enter alone never approves.',
  tuiUnexpectedFailure: 'The terminal hit an unexpected failure and stopped.',
  companionVoiceCancel: 'Cancel',
  companionVoiceFailed:
    'Dictation failed or was refused. Check microphone permission, the selected engine and the daily budget, then record again. A paid request already sent may still be charged.',
  companionVoiceFree: 'Operating system (free)',
  companionVoiceLimit: '{seconds} seconds maximum. Audio is removed after transcription.',
  companionVoiceOpen: 'Open dictation companion',
  companionVoicePaidSummary: 'Paid audio: {duration}.',
  companionVoiceReference:
    'Dictate in the browser and review before sending to your owning ACP session or terminal. System recognition is free on Windows and macOS; paid Muse Voice asks for consent and shares the daily budget.',
  companionVoiceReview: 'Review transcript before sending',
  companionVoiceTitle: 'Dictate',
  editorChatTitle: 'Editor chat',
  editorChatModel: 'Offer {model} to editor chat',
  editorChatRefused:
    'Editor chat request refused. Check model opt-in, known prices, token limits and workspace trust.',
  editorChatEnable: 'Enable',
  editorChatRates:
    '{input} input / {output} output (including reasoning) per million tokens; {cached} cache read / {write} cache write / {write1h} 1-hour cache write per million tokens',
  editorChatFees: '{request} per request / {image} per image',
  editorChatTier: 'From {tokens} input tokens: {rates}',
  editorChatConsent:
    'Offer {model} to editor chat? {rates}. All installed extensions can call this model using your key. The subscription pays none of this.',
  referenceEditorChat:
    'Opt chosen priced or local models into VS Code chat; calls appear in Usage & cost. Requires VS Code 1.104+ and a trusted, non-confidential workspace. Native Muse needs no BYO provider; recorded confirmation covers all rates before spending.',
  // M107 / D87: resource surfaces and manifest-ready settings text.
  resourceTitle: 'Resources',
  resourceHarnessInTree:
    'Stop paused: the harness is still in this tree. Ownership is retained; retry Stop.',
  resourceCgroupChanged:
    'Stop refused: this tree’s cgroup was removed or replaced. Ownership is retained.',
  resourceNormal: 'Normal',
  resourceThrottle: 'Throttling',
  resourceRelocate: 'Relocating',
  resourcePause: 'Paused',
  resourceUnknown: 'Unknown',
  resourceWaiting: 'Waiting: machine busy',
  resourceResumeNow: 'Resume Now',
  resourceRunNow: 'Run Now',
  resourceShow: 'Show Resources',
  resourceMoveTo: 'Move to {device}',
  resourceKeepHere: 'Keep Here',
  resourcePauseNotice:
    'Machine busy: {metric} is {reading} (limit {threshold}). New background work is paused.',
  resourceOverrideNotice: 'Work resumed until {time}.',
  resourceRelocatedNotice: 'Queued work moved to {device} because this machine is busy.',
  resourceRelocationNoRoute:
    'Relocation requires a paired device or runner route. Work stays on this machine.',
  resourceRelocationNoTarget:
    'No approved runner route is active. Work stays on this machine. Paired-device relocation is unavailable.',
  resourceUnavailable: 'This reading is unavailable on this machine.',
  resourceGovernorOff: 'Resource limits are off on this machine.',
  resourceStatusRefused: 'The latest resource status could not be read, so no readings are shown.',
  resourceTransport: 'Transport Failures',
  resourceOsService: 'OS Service Pressure',
  resourceCpu: 'CPU Use',
  resourceMemory: 'Memory in Use',
  resourceAvailableMemory: 'Available Memory',
  resourceGpu: 'GPU Use',
  resourceDisk: 'Disk Busy',
  resourceDiskFree: 'Free Disk Space',
  resourceDiskWriteRefused:
    'Cannot write to {volume}: free space is below the disk floor set in settings.',
  resourceDiskMinFreeGiBDescription:
    'Free disk space floor in GiB. Unset means no floor; a set floor of zero or more is honoured as set.',
  resourceHistory: 'Resource History',
  resourceHarness: 'Harness Work',
  resourceCpuTime: 'CPU Time',
  resourcePeakMemory: 'Peak Memory',
  resourceHistoryEmpty: 'No resource history recorded yet.',
  resourceHistoryInvalid: 'Resource history could not be read.',
  // A damaged usage-history choice (CATCHMONEY R3): one sentence per damaged
  // thing, saying what is damaged, what the product does because of it, and
  // what to do. Shown as a notice in the editor, on stderr once in the
  // terminal, and as a session notification on the editor protocol.
  resourceHistoryChoiceUnreadable:
    'Usage-history recording is off: usage-settings.json could not be read. Check its permissions, or delete it and set your choice again.',
  resourceHistoryChoiceInvalid:
    'Usage-history recording is off: usage-settings.json is not valid. Delete it and set your choice again.',
  resourceHistoryObserved:
    'Minute averages and observed harness work. Missing readings stay unknown; unobserved work is not estimated.',
  resourceHistoryThreshold: 'Limit',
  resourceHistoryLevel: 'Level',
  resourceHistoryEvents: 'Resource Events',
  resourceHistoryTime: 'Time',
  resourceHistoryKind: 'Work Kind',
  resourceHistoryCount: 'Event Totals',
  resourceHistoryLevelChanged: 'Level Changed',
  resourceHistoryDeferred: 'Deferred',
  resourceHistoryRelocated: 'Relocated',
  resourceHistoryPaused: 'Paused Work',
  resourceHistoryOverrides: 'Resume Override',
  resourceHistoryOlder: 'Older',
  resourceHistoryNewer: 'Newer',
  resourceHistoryPage: 'Page {page} of {pages}',
  resourceHistoryDetailNotice:
    'Detail is limited to recent history. Totals include all retained journal records.',
  resourceHistoryCurrentMinute: 'This Minute So Far',
  resourceHistoryDaily: 'Earlier Days',
  resourceHistoryDailyNotice:
    'Each completed day keeps its averages, minutes at each level, event count and harness work for the usage-history days.',
  resourceHistoryDay: 'Day (UTC)',
  resourceHistoryAverage: 'Average',
  resourceHistoryMinutes: 'Minutes Recorded',
  resourceHistoryLevelMinutes: 'Minutes by Level',
  resourceMemoryBelowFloor: 'Below the Memory Floor',
  resourceMemoryLow: 'Low Headroom',
  resourceMemoryAmple: 'Ample Headroom',
  referenceResources:
    'Resource, service and transport pressure reduce admission. Each job has observed process and birth limits; cleanup removes only recorded temp roots.',
  referenceResourceMemory:
    'On macOS, memory headroom includes free, inactive and purgeable pages. Older runtimes use the signed helper; a failed reading stays unknown.',
  resourceGovernorDescription:
    'Keep this machine responsive by slowing or deferring work started by the harness. On by default.',
  resourceCpuMaxPercentDescription:
    'Throttle when machine CPU use stays above this percentage for 30 seconds. Unset means no CPU limit.',
  resourceMemoryMaxPercentDescription:
    'Throttle when memory in use stays above this percentage for two samples. Unset means no memory-use limit.',
  resourceMemoryMinFreeGiBDescription:
    'Minimum available memory in GiB, capped at 15% of this machine’s RAM. Unset means no memory floor.',
  resourceGpuMaxPercentDescription: 'Optional GPU use limit in percent. Unset means no GPU probe.',
  resourceDiskBusyMaxPercentDescription:
    'Optional disk busy limit in percent. Unset means no disk probe.',
  resourceRelocateDescription:
    'Relocation requires a paired device or runner route. Work stays on this machine.',
  resourceRelocatePairedDescription:
    'Use an approved paired device with normal resource load once relocation is available.',
  resourceRelocateAskDescription: 'Ask before moving queued work.',
  resourceRelocateOffDescription: 'Keep work on this machine.',
  // M106: loop previews, structured answers, health and explicit feedback.
  toolArgumentPreviewLabel: 'Argument Preview',
  toolArgumentPreviewDescription:
    'Show validated, scrubbed tool arguments as they arrive, before the tool runs.',
  toolArgumentPreviewTruncated: 'Preview truncated.',
  toolArgumentPreviewPending: 'Waiting for complete arguments…',
  toolArgumentPreviewPreparing: 'Preparing arguments…',
  modelApiContinuing: 'The output limit was reached. Continuing (part {count})…',
  modelApiToolRepeating:
    'The model is repeating the same {tool} call with an unchanged result ({count} in a row). The call runs again — Stop ends the turn.',
  structuredOutputRepair:
    'The structured answer was not valid. Repairing it again (repair {count})…',
  structuredOutputRetry: 'The structured request failed. Trying again (attempt {count})…',
  structuredOutputFallback:
    'The structured answer could not be validated. Using the text fallback.',
  outputSchemaInvalid: 'The output schema is outside the supported strict subset: {detail}',
  outputSchemaMismatch: 'The final answer does not match the output schema: {detail}',
  outputSchemaTooComplex: 'Output schema too complex: {count} expanded nodes.',
  outputSchemaWorkBudget: 'Output schema validation work budget exceeded: {count} steps.',
  outputSchemaOutsideRefused:
    'The output schema resolves outside the workspace. Use --output-schema-outside to authorise this read.',
  outputSchemaOutsideAllowed:
    'Reading an output schema outside the workspace (--output-schema-outside).',
  outputSchemaLocalValidation:
    'Output schema validation: local (the selected model has no structured-output format).',
  outputSchemaReadFailed: 'Could not read the output schema: {detail}',
  modelApiPacingWaiting: 'Waiting for rate limit headroom…',
  modelApiPacingConcurrencyWaiting:
    'Waiting for a DeepSeek request slot (account concurrency {limit})…',
  modelApiPacingBurstWaiting: "Spreading requests evenly for Azure's small-window rate evaluation…",
  modelApiStatusLabel: 'Meta API Status',
  modelApiStatusUnavailable: 'Status unavailable',
  modelApiStatusOpen: 'Open Service Status',
  modelApiServiceFailure: 'The service returned an error. Check its status or try again.',
  modelApiSendFailed:
    'The model request failed before a response arrived ({detail}). It was not sent again: a request over a pinned connection may already have reached the provider.',
  // C-M95-SUB: the Model API backend on the Muse Code subscription. The
  // refusals name the fix and never carry the key. (The opt-in's Title Case
  // label comes from its setting id, `museSpark.useMuseCodeSubscription`.)
  subscriptionKey: {
    paidSearch: 'This response’s model tokens also bill your stored Model API key at {price}.',
    billingChanged: 'The billing account changed. This attempt was refused; try again.',
    signInAgain:
      'Muse Code subscription is on, but the Muse Code CLI holds no subscription sign-in here. A pay-as-you-go key (`muse auth set`) does not count. Sign in with your Muse account (`muse login`), then try again — or use a Model API key instead.',
    cannotRead:
      'Muse Code subscription is on, but the Muse Code sign-in file cannot be read. Sign the Muse Code CLI in again, then try again — or use a Model API key instead.',
    keychainBacked:
      'Muse Code subscription is on, but this sign-in lives in the login keychain, which cannot be read here. Use a Model API key instead.',
    paidNeedsKey:
      'Muse Code subscription covers chat. This paid extra needs a stored Model API key: store one and try again.',
  },
  feedbackFailed: 'Could not submit feedback.',
  feedbackUploaded: 'Feedback uploaded.',
  // C-M106-3R2: the restored feedback dialog offers exactly what the 1.4.4
  // capture certifies: a note with its classification. Files and the session
  // record are never offered (record-attached receipts keep refusing), so
  // the privacy line promises a note-only upload. Read only by the lazy
  // dialog chunk, except the title, which also labels the turn-menu entry.
  feedbackTitle: 'Send feedback to Muse Code',
  feedbackClassification: 'Classification',
  feedbackNote: 'Note',
  feedbackPrivacy:
    'Muse Code uploads your classification and note. No files or session record are attached.',
  feedbackSend: 'Send feedback',
  feedbackSending: 'Sending feedback…',
  feedbackClassificationBug: 'Bug',
  feedbackClassificationBadResult: 'Bad result',
  feedbackClassificationGoodResult: 'Good result',
  feedbackClassificationOther: 'Other',
  // C-M106-3: the 1.4.4 capture certifies the note-only receipt only; a
  // record-attached receipt refuses with this upstream request instead of
  // reporting an uncertified outcome.
  feedbackRecordUnsupported:
    'This Muse Code version cannot verify a session-record feedback upload (upstream SDK request pending). The outcome is unknown.',
  // C-M106-3R3 (RVCM1063 #1/#8): every outcome the receipt type can carry
  // (the SDK's FeedbackSubmitOutcome taxonomy) gets its own sentence. Only
  // `uploaded` reads as success; anything else settles the dialog as a
  // failure with the sentence for what actually happened.
  feedbackRecorded:
    'Feedback was recorded without an upload receipt, so the upload is unconfirmed.',
  feedbackAcceptedWithoutReceipt:
    'Feedback was accepted but no receipt was returned, so the upload is unconfirmed.',
  feedbackTrackingFailed: 'Feedback was sent but its delivery could not be tracked.',
  feedbackTrackingUncertain: 'Feedback was sent but its delivery is uncertain.',
  feedbackDark: 'Feedback is switched off in this version of Muse Code, so nothing was sent.',
  feedbackDisabled: 'Feedback is disabled, so nothing was sent.',
  feedbackNoCredential:
    'No credential is stored, so the feedback was not sent. Sign in and try again.',
  feedbackAuthRejected:
    'The sign-in was rejected, so the feedback was not sent. Sign in again and retry.',
  feedbackRateLimited: 'The feedback service is rate limited. Try again later.',
  feedbackUnknownOutcome: 'The feedback upload ended with an unrecognized outcome ({outcome}).',
  // C-M106-3R3 (RVCM1063 #2): the note stops at the protocol maximum, with
  // a counter; a refused preview or submit settles the dialog with why.
  feedbackNoteTooLong: 'The note is over the {max}-character limit. Shorten it and try again.',
  feedbackNoteCounter: '{used} of {max}',
  // M102: the shared usage page; its full table is a separate lazy family.
  usagePageTitle: 'Usage & Cost',
  uploadsName: 'Uploaded Files',
  paletteUsagePage: 'Track cost, tokens and limits across editors.',
  openUsagePage: 'Open Usage Page',
  acpUsageDescription: 'Show usage and cost across models, or open the usage page.',
  companionLaunchFailed:
    'Could not open the panel. Return to your editor and open Muse Spark Code again to get a fresh launch link.',
  // M118: prompt library and local sharing; read UI_TEXT at use time.
  promptLimits: 'The prompt exceeds the size limit, or this scope has too many prompts.',
  promptWorkspaceRequired: 'Open a workspace to save workspace prompts.',
  promptScopeDamaged:
    '{scope}: The prompt store is unreadable or damaged. Its files were kept unchanged.',
  promptImportConfirmScope: 'Save Imported Prompt in {scope}',
  promptStoreDamaged: 'The prompt store is unreadable or damaged. Its files were kept unchanged.',
  promptStoreBusy: 'The prompt store is busy or changed. Try again.',
  promptSecretsNote: 'Prompts are stored as plain text. Do not save passwords or keys.',
  promptSearch: 'Search Prompts and Tags',
  promptEmpty: 'No saved prompts match.',
  promptDuplicate: 'Duplicate',
  promptRun: 'Review Variables and Insert',
  promptEdit: 'Edit Prompt',
  promptDelete: 'Delete Prompt',
  promptDeleteConfirm: 'Delete this prompt?',
  promptLink: 'Import From Link or Raw Gist URL',
  promptFromFile: 'Import From File',
  promptImportConfirm: 'Save Imported Prompt',
  promptSave: 'Save Prompt',
  promptUseSaved: 'Use Saved Prompt…',
  promptLibrary: 'Prompt Library',
  referencePromptMenu:
    'Composer toolbar or right-click: Save, Share, Use saved. Outside VS Code, Shift-right-click keeps native clipboard actions. Prompts are plain text; save no secrets.',
  promptCopyToUser: 'Copy to My Prompts',
  promptTitle: 'Title',
  // NOLIMITS1FIX: the only prompt refusal left — a blank title. The removed
  // size/count bounds were invented.
  promptTitleRequired: 'A title is required.',
  promptBody: 'Prompt Text',
  promptTags: 'Tags',
  promptVariables: 'Variables',
  promptScopeUser: 'All Workspaces',
  promptScopeWorkspace: 'This Workspace',
  promptImport: 'Import Prompt…',
  promptUntrusted:
    'Imported prompt: untrusted text. Review the text and variables before inserting.',
  promptInsert: 'Insert Into Chat',
  promptPrintConfirm: 'Print prepared text',
  promptFileInvalid: 'The prompt file is invalid or unsupported.',
  // M88: prompt sequences; read UI_TEXT at use time.
  sequenceLibrary: 'Prompt Sequences',
  sequenceEmpty: 'No prompt sequences yet.',
  sequenceNew: 'New Sequence',
  sequenceEdit: 'Edit Sequence',
  sequenceSave: 'Save Sequence',
  sequenceDelete: 'Delete Sequence',
  sequenceDeleteConfirm: 'Delete this sequence?',
  sequenceScope: 'Available in',
  sequenceStep: 'Step {index}',
  sequenceSteps: 'Steps',
  sequenceStepCount: forms({ one: '{count} step', other: '{count} steps' }),
  sequenceAddStep: 'Add Step',
  sequenceRemoveStep: 'Remove Step',
  sequenceRun: 'Run',
  sequenceStop: 'Stop',
  sequenceStartTitle: 'Run “{name}”?',
  sequenceStartConversation: 'Conversation',
  sequenceStartDetail: forms({
    one: '{count} message is sent to this conversation, each after the previous turn completes.',
    other:
      '{count} messages are sent to this conversation, each after the previous turn completes.',
  }),
  sequenceStartBilled: 'On the Model API, each message is billed as a normal turn.',
  sequenceModeWarning: 'This conversation is in {mode} mode: steps run without asking.',
  sequenceRunning: 'Sequence “{name}”: step {step} of {total}',
  sequenceStopped: 'Sequence stopped after step {step}: {reason}',
  sequenceDone: 'Sequence “{name}” finished.',
  sequenceReasonStopped: 'stopped',
  sequenceReasonFailed: 'the turn failed',
  sequenceReasonCancelled: 'the turn was cancelled',
  sequenceReasonSwitched: 'the conversation changed',
  sequenceStepRequired: 'Every step needs text.',
  sequenceNeedsStep: 'A sequence needs at least one step.',
  sequenceAlreadyRunning: 'A prompt sequence is already running in this conversation.',
  sequenceNoSession: 'Open a conversation before running a sequence.',
  referenceSequences:
    'Run saved prompts in order from the palette: each step is sent after the previous turn completes. A failed turn, Stop or a session switch ends the run.',
  shareChat: 'Share Chat…',
  sharePrompt: 'Share Prompt…',
  shareFull: 'Full Transcript',
  shareConversation: 'Conversation Only',
  shareCodeBlocks: 'Include Code Blocks',
  shareAttachmentNames: 'Include Attachment Names',
  shareDiffs: 'Include Diffs',
  sharePreview: 'Preview',
  shareConfirm: 'Confirm Sharing',
  // The Share Chat dialog's destination group (F71): what the choice picks,
  // not the button's own words.
  shareDestination: 'Share as',
  shareCopy: 'Copy',
  shareFile: 'Save File…',
  shareBrowser: 'Open in Browser',
  shareConfidential: 'Sharing is blocked while this workspace is confidential.',
  shareReviewPrivacy:
    'Review the exact preview for private text before confirming. Known and registered secrets are removed; other private text may remain.',
  shareCancelled: 'Sharing cancelled',
  shareMode: 'Sharing Mode',
  shareDecision: 'Decision',
  shareFormat: 'File Format',
  shareRangeFrom: 'From Message',
  shareRangeTo: 'Through Message',
  shareAllMessages: 'All Messages',
  shareAttachmentContents: 'Include Selected Attachment Contents',
  shareRangeInvalid: 'Choose an ordered range of messages from this conversation.',
  shareTooLarge: 'This share exceeds the file size or transcript limit.',
  shareAttachmentUnavailable: 'Selected attachment content is unavailable in this range.',
  sharePreviewExpired: 'The preview changed or expired. Preview again before sharing.',
  // M100/D80: lazy Devices setup, observations and recovery.
  devices: {
    desktopHeap:
      'Windows could not initialize the worker (STATUS_DLL_INIT_FAILED). Run fewer concurrent workers, run the receiver in the interactive session, or ask an administrator to raise the desktop heap and reboot. No retry or registry change was made.',
    pool: 'Pool',
    entry: 'Entry',
    usageKinds: {
      known: 'Known usage',
      estimated: 'Estimated usage',
      uncertain: 'Uncertain usage',
    },
    offHelp:
      'Devices is off by default. Pairing and offering work each require an explicit local choice.',
    importInvitation: 'Import invitation',
    importConfirmation: 'Import confirmation',
    peerFingerprint: 'Peer fingerprint',
    fingerprintMatches: 'I compared both screens and the fingerprint matches',
    confirmFingerprint: 'Confirm fingerprint',
    invalidMessage:
      'The device message is invalid or the request failed. Existing work and liability are kept.',
    retry: 'Retry',
    renderUnavailable: 'Devices could not display the latest observation. Reload to recover.',
    unpairedHelp: 'This device is not paired. Pair both devices before offering work.',
    revokedHelp: 'This pair was revoked. Pair again; previous unresolved work remains blocked.',
    localApprovalHelp:
      'Approvals and paid consent are requested on the executing device. Open that device to answer; pairing grants no approval.',
    capacityHelp:
      'The receiving pool is at capacity. Wait for locally proved retirement; do not reassign uncertain work.',
    grantHelp:
      'The receiving device must approve the repository mapping, base snapshot and local offer.',
    unknown: 'Unknown',
    observationHelp: 'Status is the last observation, not proof that work has stopped.',
    noOffers: 'No approved offers',
    payer: 'Payer',
    readiness: 'Model readiness',
    address: 'Private address',
    port: 'TCP port',
    retryAddress: 'Save address and retry paired identity',
    capHelp:
      'Caps apply to this offered window only. Narrowing a cap takes effect at the next controlled boundary.',
    saveOffer: 'Review and save local offer',
    confirmUnlink: 'Confirm unlink',
    cancel: 'Cancel',
    costOwnership:
      'Each device keeps its own sign-ins and charges. Its local paid modal asks before the first charge, showing the model price and shared daily budget. No fleet budget or subscription entitlement is transferred.',
    working: 'Waiting for local host…',
    retainedLiability: 'Retained spending liability: {amount}',
    payers: { subscription: 'Subscription', apiKey: 'API key', local: 'Local', unknown: 'Unknown' },
    readinessStates: { ready: 'Ready', unavailable: 'Unavailable', unknown: 'Unknown' },
    unresolvedCount: forms({
      one: '{count} unresolved attempt',
      other: '{count} unresolved attempts',
    }),
    title: 'Devices',
    pair: 'Pair device',
    offer: 'Offer lanes',
    offerChecks: 'Offer checks',
    pause: 'Pause offers',
    unlink: 'Unlink',
    resume: 'Resume queue',
    manualAddress: 'Manual address',
    discovery: 'Discover on this LAN',
    fingerprint: 'Fingerprint',
    copyInvitation: 'Copy public invitation',
    copyConfirmation: 'Copy confirmation',
    scan: 'Scan QR or paste text',
    compare: 'Compare this fingerprint on both screens before confirming.',
    pairingHelp: 'Both devices must confirm. A public invitation alone grants no access.',
    scopeHelp:
      'Only the approved repository snapshot, task brief and result go to this device. Its own model receives the context.',
    paidHelp:
      'This device uses its own sign-ins and pays its own charges. Before the first paid use, local consent names the price {price} and shared daily budget {budget}.',
    blockedHelp:
      'Check {application} on {interface} at {address}:{port}: receiver offer, route and OS firewall permission. Ask an administrator for scoped access if needed. A timeout does not prove a firewall denial.',
    unresolvedHelp:
      'Reconnect and reconcile before resuming. Uncertain work keeps its occupied slots and spending liability; a timeout or retry cannot release it.',
    unlinkHelp:
      'Unlink removes this pair’s local key and connections. It cannot recall code or stop work already admitted on an offline peer.',
    unsupportedHost:
      'Pairing requires a qualified local desktop host. This host cannot offer lanes.',
    waitingApproval: 'Waiting for approval on {device}',
    lastObservation: 'Last observation',
    taskBranch: 'Task branch',
    rolesModels: 'Offered roles and models',
    workers: 'Worker limit',
    processes: 'Process limit',
    heavyChecks: 'Heavy-check slots',
    tokens: 'Token limit',
    spend: 'Spend limit',
    artifact: 'Result size limit',
    offerScope: 'Repository mapping and exact base snapshot',
    local: 'Local',
    connected: 'Connected',
    paused: 'Paused',
    offline: 'Offline',
    uncertain: 'Uncertain',
    incompatible: 'Incompatible',
    blocked: 'Blocked or unreachable',
    bundleUnavailable: 'Devices could not load. Retry setup or reinstall the extension.',
    protocolMismatch: 'Device protocol mismatch. Upgrade both devices and pair again.',
    storageUnavailable:
      'Device state cannot be saved or read. New work is blocked; preserve unresolved work and repair local storage.',
    fingerprintChanged:
      'Device fingerprint changed. Pair again; previous unresolved work remains blocked.',
    settingsDescription:
      'Enable paired LAN devices after mutual fingerprint confirmation and an explicit local offer. Off by default. Each executing device keeps its own credentials, approvals and charges.',
    discoveryDescription:
      'Enable optional LAN discovery for paired receivers that are offering work. Off by default. Advertises only an opaque service id, port and protocol version; discovery grants no trust.',
    throttled: 'Throttled',
    throttledHelp:
      'New attempts are throttled. Admitted work keeps running; nothing is duplicated or lost.',
    unknownSince: 'Unknown since {time}',
    grantExpired: 'This grant expired. Ask the receiving device for a new grant.',
    resultQuarantined:
      'A late result arrived after its lease and is quarantined instead of applied.',
    ownerMismatch: 'This pair key belongs to a different owner. Pair again as the right owner.',
    stepUpWaiting: 'Waiting for step-up approval on {device}.',
    qrCodeName: 'QR code of the public invitation',
    qrReload:
      'The QR code could not load; the text invitation works on its own. Try again reloads this panel: pasted text is kept, and Pair device shows your invitation again.',
    discoveryAdvertises:
      'Discovery advertises {service} on port {port} (protocol version {version}). Discovery grants no trust.',
    owners: 'Owners and grants',
    grantRepository: 'Repository',
    grantQuota: 'Quota',
    grantExpiry: 'Expires',
    revokeGrant: 'Revoke grant',
    power: 'Power',
    powerAc: 'AC power',
    powerBattery: 'Battery',
    powerUnknown: 'Unknown',
    sleepInhibited: 'Sleep inhibited',
    cpuPressure: 'CPU',
    memoryPressure: 'Memory',
    diskPressure: 'Disk',
    transportResets: 'Transport resets',
    blockedRecovery:
      'If the listening application is running, allow {application} through the operating-system firewall for {interface}, or ask an administrator for scoped access to {address}:{port}. Nothing here changes the firewall, and access may still need approval.',
    // RLF-DEVICES: the exact-payload approval dialog.
    makerApprovalTitle: 'Approve machine send',
    makerSendOnce: 'Send once',
    makerReject: 'Reject',
    makerTarget: 'Target',
    makerOperation: 'Action',
    makerOperationConnect: 'Open connection',
    makerOperationProgram: 'Program firmware',
    makerOperationActuate: 'Send commands',
    makerKindPrinter: '3D printer',
    makerKindCnc: 'CNC machine',
    makerKindMcu: 'Microcontroller',
    makerSimulator: 'Simulator',
    makerSimNote: 'Simulator receipts never qualify real hardware.',
    makerPayload: 'Exact payload',
    makerPayloadEmpty: 'No bytes: opening the port only.',
    makerDigest: 'SHA-256',
    makerAnalysis: 'Analysis',
    makerBounds: 'Bounds (mm)',
    makerMaxTemp: 'Maximum temperature',
    makerMaxFeed: 'Maximum feed',
    makerUnknownCommands: 'Unknown commands',
    makerWarningPortReset: 'Opening a port may reset the board.',
    makerExpires: 'Expires {expiry}',
    makerApprovalClosed: 'Closing rejects the send.',
  },

  // M117 / D97: portable estimator surfaces, help and future manifest copy.
  estimateTitle: 'Estimator',
  estimateGoal: 'Goal',
  estimateDeadline: 'Deadline',
  estimateCurrent: 'Current Fleet',
  estimateMinimum: 'Minimum Setup',
  estimateOptimum: 'Optimum Setup',
  estimateCost: 'Lowest Cost',
  estimateSpeed: 'Fastest Finish',
  estimateRun: 'Estimate',
  estimateRefresh: 'Re-Estimate',
  estimateSpinUp: 'Spin It Up',
  estimateP50: 'P50 Finish Date',
  estimateP90: 'P90 Finish Date',
  estimateCriticalPath: 'Critical Path',
  estimateCriticalBound: 'More agents would not finish sooner.',
  estimateBottleneck: 'Limiting Resource',
  estimateMachines: 'Machines',
  estimateSlots: 'Agent Slots',
  estimateAccounts: 'Accounts',
  estimateCi: 'CI Jobs',
  estimateInputs: 'Inputs',
  estimateCalibration: 'Calibration',
  estimateSampleSize: 'Calibration Sample Size',
  estimatePrior: 'Uncalibrated Prior',
  estimateFitted: 'Calibrated From History',
  estimateHistory: 'Lane History',
  estimateHistoryPrivacy: 'History keeps lane IDs, hours and counts, never conversation content.',
  estimateSeed: 'Simulation Seed',
  estimateAsOf: 'Snapshot Time',
  estimateMarginal: 'Time Saved by This Added Machine',
  estimateHourly: 'Hourly Price',
  estimateCatalog: 'A catalog price on {date}, not a quote.',
  estimateNoPrice: 'No public catalog price available.',
  estimateAdvice: 'Rented-server advice only; installation and pairing are unavailable.',
  estimateBudget: 'Provisioning Budget (USD)',
  estimateBudgetRequired:
    'Set a hard budget for this run before provisioning; there is no default.',
  estimateConfirmServer: 'Create {server} for {price}? Total: {total}; run budget: {budget}.',
  estimateSpendRule:
    'Confirm each server separately. The estimator never pays or creates provider accounts.',
  estimateIdleNotice: '{server} has been idle for {duration}. Keep it or tear it down and wipe it.',
  estimateKeep: 'Keep',
  estimateTeardown: 'Tear Down and Wipe',
  estimateProvider: 'Connected Provider',
  estimateStartExisting: 'Start Lanes on the Existing Fleet',
  estimatePrerequisites:
    'Contracts must be reviewed and prerequisites merged before the first wave starts.',
  estimateDrift: 'Drift Since the Previous Estimate',
  estimateEmpty: 'No remaining lanes',
  estimateInvalidGoal:
    'Invalid goal. Use a milestone, pr:<number>, issues:<numbers>, label:<label>, release:<tag>, or M112:Q,U.',
  estimateNotFound: 'Goal not found: {goal}',
  estimateNoCapacity: 'No compatible fleet capacity is available.',
  estimateCycle: 'Lane dependencies contain a cycle.',
  estimateEndpointRefused: 'Provider operation refused: {operation}',
  estimateCapExceeded: 'This server would exceed the run budget.',
  estimateDenied: 'Server creation was denied.',
  estimateWaiting: 'Waiting for {dependency}.',
  estimateRunning: 'Estimating…',
  referenceEstimateFacts:
    'Forecasts retain observed account blocks, name unread capacity and distinguish default from configured thresholds. Future refill rates remain unknown unless reported. Observations belong to their account and sign-in generation; known balances and percentage allowances constrain current work with unknown renewal.',
  estimateFailed: 'Estimate failed: {detail}',
  estimateCredentialChanged: 'The provider credential changed: estimate again.',
  // A refused estimate's omitted lanes: {count} is the lanes the estimator
  // did not name, rendered in the report's language from that number.
  estimateMissingMore: forms({ one: 'and {count} more', other: 'and {count} more' }),
  estimateNoAccountReader: 'Unknown account limits on {source}.',
  estimateLimitsUnread: 'Unknown: limits unread for {source}.',
  estimateRefillUnknown: 'Future refill period and rate unknown: {source}.',
  estimatePlanWindowUnknown:
    '{source}: {percent} used; {reset}; window period and lane demand unknown.',
  estimatePercentDemandUnknown: 'Percent demand of these lanes unknown: {source}; resets {reset}.',
  estimateResetUnknown: 'reset unknown',
  estimateCiUnread: 'CI capacity unknown: no reader.',
  estimateSettingsDefault: 'Default settings: {source}.',
  estimateSettingsConfigured: 'Configured settings: {source}.',
  estimateSchedule: 'Lane Schedule',
  estimateGantt: 'Schedule for {goal}, with the critical path and P50 and P90 finish marks.',
  estimateOptimizeDescription:
    'Choose the cheapest setup meeting the deadline at P90, or the fastest setup with worthwhile marginal savings.',
  estimatePriceLookupDescription:
    'Look up public catalog prices when the Reports network policy permits; each price shows its date.',
  estimateCostDescription: 'Cheapest setup meeting the deadline at P90.',
  estimateSpeedDescription: 'Fastest setup while another machine still saves enough time.',
  estimateCommandTitle: 'Open Estimator',
  estimateUsage: 'Usage: /estimate <goal> [--by <date>] [--fleet current|minimum|optimum]',
  estimateCliHelp: 'In progress.',
  estimateCiUnavailable: 'CI minutes unavailable',
  estimateInstalling: 'Installing node',
  estimatePairing: 'Pairing node',
  estimateReady: 'Server ready',
  estimateDeleting: 'Tearing down server',
  estimateKept: 'Server kept',
  estimateLocalBudget: 'The estimate exceeded its local time budget.',
  estimateFormat: 'Output Format',
  estimatePriceLookup: 'Public Price Lookup',
  estimateOptimization: 'Optimization',
  estimateTotal: 'Total Price',
  estimateWindowRolling: 'Rolling Window',
  estimateWindowCalendar: 'Calendar Window',
  estimateWindowPeriod: 'Window Period',
  estimateWindowRenewal: 'Quota Renewal',
  estimateWindowTimeZone: 'Time Zone',
  estimateAllowance: 'Full Allowance',
  estimateDisk: 'Disk Space',
  estimateDiskPeak: 'Peak Disk Demand',
  estimateDiskSteady: 'Retained Disk Demand',
  estimateDiskHeadroom: 'Usable Disk Headroom',
  estimateDiskFloor: 'Disk Free-Space Floor',
  estimateBasis: 'Measurement Basis',
  estimateBasisHistory: 'Historical Measurement',
  estimateBasisCalibration: 'Calibration',
  estimateBasisAssumption: 'Assumption',
  estimateUnknown: 'Unknown',
  estimateUncertainty: 'Uncertainty',
  estimateReviewRounds: 'Lane Review Rounds',
  estimateModuleStrikes: 'Module-Family Strikes',
  estimateClassStrikes: 'Finding-Class Strikes',
  estimateRedesigns: 'Redesign Events',
  estimateDisclosureMissing: 'Numeric calibration disclosures are incomplete.',
  estimateRuntimeUnavailable: 'Estimates are unavailable in this host. No plan snapshot is bound.',
  // The estimator's own module (dist/estimator.js) could not be loaded.
  estimateUnavailable:
    'The estimator could not be loaded, so no estimate can run; reinstall the extension and reload the window. The log has the details.',
  // The webview's solid archive (dist/webview.json.br, VSIXWEB A) is
  // missing, damaged or unwritable: the panel shows this instead of
  // unverified files, and the cause goes to the log.
  webviewBundleUnavailable:
    'The panel could not be loaded, so it cannot be shown; reinstall the extension and reload the window. The log has the details.',
  // M117 W (PLAN.md D100, gotcha G4): {lanes} is the stale-base lane list.
  estimateStaleBase: 'Stale base ({lanes}): rebase before starting.',
  // M117 W: {lanes} is the submitted first wave.
  estimateWaveStarted: 'Started {lanes}.',
  referenceAgentControls:
    'Agent controls; Interrupt; Stop; Resume; Close agent; Reopen agent; Mark result read; Send message; Follow-up task',
  referenceMuseCodeSubscriptionName: 'Muse Code subscription',
  referenceMuseCodeSubscriptionSummary:
    'Meta chat uses the Muse Code plan; enabled paid extras require a stored Model API key and consent.',

  referenceBestOfNRequirements:
    'Candidates require Model API, the paid feature enabled, a trusted Git workspace, Git 2.36 or newer, and no configured Git filter or hook programs. A finite session budget requires an owned parent budget scope shared by candidates. Set attempt and request limits, compare results or cancel, then take selected changes by applying and staging without a commit.',
  referenceWindowsSessions:
    'Muse Code cannot rename or fork sessions on Windows (meta-models/muse-code-sdk#30, #31).',
  referenceWindowsPaths: 'Safer Windows paths',
  referenceWindowsPathsDetail:
    'On Windows, ambiguous spellings — device paths and namespaces, alternate streams, drive-relative paths, trailing dots or spaces, and reserved names — are refused at admission, or need a one-time manual answer for flagged writes. Ordinary workspaces on any drive keep working; schedules, helpers, and vault paths verify against the folder their caller owns.',
  referencePaletteKeys:
    'Navigate items, choose or complete a selection, or close the list. Choose how much effort Muse puts into each reply.',
  referenceServe:
    '{command} [options]              Serve the Agent Client Protocol on stdin and stdout',
  referenceTabSnooze: 'Snooze for 15 Minutes; Snooze for an Hour; Snooze Until Restart.',
  referenceElicitationKeys: 'Cancel',
  referenceGoalKeys: 'Cancel',
  referenceMicKeys: 'records your voice into the composer (tap to toggle, hold to talk)',
  referenceOutputKeys: 'Open Output',
  referenceAgentKeys: 'Send Message',
  referenceDialogKeys: 'Browse matches, activate the selected conversation or close the dialog.',
  referencePopoverKeys: 'Navigate options, adjust a value, choose an option or close the popover.',
  referenceExecImages:
    'Headless images require --image-generation, acceptEdits and an affordable hard budget. No price question is shown; requests requiring permission are refused.',
  referenceProviders:
    'List, add, test, refresh or remove model providers. Keys use the credential store. Paid token probes require the editor; the CLI refuses them.',
  referenceProvidersUsage:
    'Show what the provider itself reports was spent, next to our own estimate. Admin report keys use the credential store and never pay for model requests.',
  referenceCliOptions: {
    'context-window':
      '--context-window <tokens>: Enter the context window loaded on the local server. Manual values override scanned limits.',
    'resource-governor':
      '--resource-governor on|off: Keep this machine responsive by throttling or deferring harness work. On by default.',
    'cpu-max': '--cpu-max <percent>: Throttle when CPU stays above this percentage for 30 seconds.',
    'memory-max':
      '--memory-max <percent>: Throttle when used memory stays above this percentage for two samples.',
    'usage-history': '--usage-history: Track cost, tokens and limits across editors.',
    preset: '--preset: Provider',
    as: '--as: Provider',
    address: '--address: Address',
    days: '--days <n>: Spend report period in days',
    admin: '--admin: Use the admin report key instead of the inference key',
    format: '--format <format>: Export',
    privacy: '--privacy: Any provider may be used, including ones that train on data.',
    'private-ok':
      '--private-ok: {origin} is on a private network; re-run with --private-ok to confirm.',
    range: '--range today|7d|30d|90d|custom: Range',
    by: '--by provider|model|kind|client: Group by',
    from: '--from <value>: From',
    to: '--to YYYY-MM-DD: To',
    json: '--json: Versioned JSON',
    csv: '--csv: Summary CSV',
    stdio: 'usage serve --stdio: Serve usage over standard input and standard output',
    registry:
      '--registry: Before the first lookup: {hosts}. Only package names and versions are sent over HTTPS; no source, paths or lockfile contents are uploaded. Turn off Legal Registry Lookups for offline scans.',
    backend:
      '--backend museCode|modelApi      Who pays: Muse Code (the default) or the Model API key',
    'trust-workspace':
      '--trust-workspace                Load the folder’s rules, skills and memory',
    maintenance: 'Run the Setup maintenance event instead of init.',
    'muse-binary': '--muse-binary <path>             The Muse Code CLI to run',
    subscription:
      '--subscription                 Drive the Model API backend with the Muse Code subscription instead of a key (its calls count against the plan)',
    'shell-sandbox': '--shell-sandbox auto|muse|off    Muse Code’s shell sandbox',
    'allow-dangerously-skip-permissions':
      '--allow-dangerously-skip-permissions  Offer the Bypass permissions mode',
    'allow-contributor-models':
      '--allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    'web-search':
      '--web-search                     Offer paid web search (Model API backend; its price is asked first)',
    'image-generation':
      '--image-generation               Offer paid image generation (Model API backend; its price is asked first)',
    'muse-voice':
      '--muse-voice                     Offer paid Muse Voice transcription of attached sound (Model API backend; its price is asked first)',
    'scheduled-prompts':
      '--scheduled-prompts              Offer paid scheduled prompts (Model API backend; its price is asked first)',
    verbose: '--verbose                        Log every detail on stderr',
    'questions-defer-after':
      '--questions-defer-after <seconds>  Defer questions after this many seconds; no limit unless you set one (0, the default, never defers)',
    help: 'help / --help / -h: ACP / CLI. help --all: Commands, settings and features, with descriptions and documentation.',
    version: 'Print the installed agent version.',
    cwd: 'Use this directory as the workspace.',
    'prompt-file': 'Read the prompt from this file.',
    'untrusted-file': 'Attach this file as untrusted data; repeat the option for more files.',
    attach: 'Attach this media file; repeat the option for more files.',
    record: 'Refused for headless runs: nobody is there to preview a recording.',
    'permission-mode': 'Choose how Muse asks before it acts.',
    model: 'Choose the model for this run.',
    engine: 'Which judge answers: auto, same, separate or both.',
    separate: 'The separate source id, without a credential.',
    'budget-usd': 'Run cap in USD, exact to nine decimals.',
    'timeout-ms': 'Request timeout in milliseconds.',
    add: '--add <model>: Offer this model on the entry; repeat the option for more models.',
    remove:
      '--remove <model>: Stop offering this model on the entry; repeat the option for more models.',
    force:
      '--force <reason>: Add a model the provider does not list; the reason is stored on the entry.',
    provider:
      '--provider <id>                   The provider the account belongs to (auth set/status/clear).',
    account: '--account <id>                    The account to use (auth set, exec).',
    'account-pool':
      '--account-pool                  Model API: pool at request boundaries; existing budgets still bind. Excludes key-stdin in CI.',
    effort: 'Choose how much effort Muse puts into each reply.',
    output: 'Choose the result format: text, json or jsonl.',
    'max-budget-usd': 'Set the spending reservation limit in USD for this run.',
    team: '--team: Run engine teams with Model API, acceptEdits and a hard budget shared by every worker; prompts deny, merges enter the run working tree.',
    'max-requests':
      'Set the maximum number of model requests; without it, there is no request limit.',
    'max-tool-output-bytes': 'Raise the per-tool-result byte guard for this run.',
    'max-output-tokens':
      'Lower the run’s output cap in tokens; absent is the model’s policy cap, never above it.',
    timeout:
      'Set the run deadline in seconds (any positive integer); without it the run has no deadline of its own.',
    'fail-on-denial': 'Stop the run when a permission request is denied.',
    ephemeral: 'Keep the session in memory without saving it.',
    'key-stdin':
      'auth set: Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations. exec / scan-secrets --key-stdin: Read the key from a pipe, not a terminal. stdin → memory; prompt stdin + key stdin = Prompt and key cannot both use stdin.',
    vault:
      '--vault                          Allow headless exec to use vault items covered by unattended grants',
    out: '--out <file>         Write the report to a file instead of stdout',
    description: '--description <text>  What was happening, in your own words',
    'no-facts': '--no-facts           Leave the support facts out',
    'no-events': '--no-events          Leave the recent events out',
    'auto-compaction':
      'Offer paid automatic compaction; where the host can ask, it asks once before its first charge, with model rates and the daily budget. Headless exec never asks and needs --max-budget-usd.',
    'no-auto-compaction': 'Disable automatic compaction',
    'output-schema':
      'Validate the final answer against a bounded JSON schema file (Model API only).',
    'output-schema-outside': 'Allow the output schema file to resolve outside the workspace.',
    'estimate-by': '--by <date>: Deadline',
    fleet: '--fleet current|minimum|optimum: Current / Minimum / Optimum',
    'estimate-format': '--format md|html|json|text: Output format',
    'estimate-check-plan': '--check-plan: List every plan problem instead of estimating',
    seed: '--seed <seed>: Simulation seed',
    mode: '--mode full|conversation: Share the full session or the conversation only.',
    destination:
      '--destination copy|file|browser: Copy to the clipboard, write a file, or open a browser.',
    scope: '--scope user|workspace: Save the prompt for this user or this workspace.',
    search: '--search <text>: List only prompts matching this text.',
    tag: '--tag <tag>: Filter by tag, or tag the saved prompt.',
    title: '--title <title>: Title for the saved prompt.',
    var: '--var <name=value>: Set a prompt variable; repeat for more.',
    chat: '--chat active|new: Use the prompt in the active chat or a new one.',
    confirm: '--confirm: Confirm without asking.',
    diffs: '--diffs: Include the session diff in the shared text.',
    'no-code-blocks': '--no-code-blocks: Omit code blocks from the shared text.',
    'no-attachment-names': '--no-attachment-names: Omit attachment names from the shared text.',
    'attachment-content':
      '--attachment-content <kind>: Include attachment contents; repeat for more.',
    'exported-at': '--exported-at <time>: Timestamp of the confirmed export.',
    'share-from': '--from <message>: First message to include.',
    'share-to': '--to <message>: Last message to include.',
    'share-out': '--out <file>: Write the shared text to a file instead of stdout.',
    'sharing-json': '--json: Print the machine-readable result instead of the human preview.',
    fast: '--fast: Use the plan catalogue’s Fast tier (2x speed, increased usage). Off by default: it uses more of your plan allowance.',
    'exec-provider':
      'Run on this provider (Model API backend); --model is then <provider>/<model>.',
    'scan-timeout': 'Set the scan deadline in seconds; without it the scan runs until it finishes.',
    'lsp-trust-workspace':
      'Trust this folder: Tab reads its files, its hooks run, and Allow Always is offered.',
    tab: 'Offer paid Tab completions on the stored Model API key; the editor asks first, naming the price.',
    'tab-model': 'The model Tab completions use.',
    'tab-daily-budget-usd':
      'Stop Tab for the day at this many US dollars; 0, the default, sets no budget.',
    'tab-max-output-tokens':
      'Cap each Tab request at this many output tokens; 0, the default, is the model’s own maximum.',
    'tab-trigger': 'Serve Tab as you type (automatic) or only on request (onInvoke).',
    'panel-stdio': 'Speak MHP on standard input and output, one JSON message per line.',
  },
  referenceScanSecrets:
    'Scan a UTF-8 patch file for secrets and fail on detection. --key-stdin also checks for the exact in-memory Model API key; no key is stored.',
  referenceVault:
    'Work with the per-user credential vault from a terminal: setup, recover, reset, status, unlock, lock, list, add, grants, audit, import and watch. Values never print; the broker holds them. Reset can also replace unknown writer ownership after explicit confirmation.',
  referenceVaultHelp: 'Show the per-user credential vault command usage.',
  referenceNode:
    'Serve this machine as the home node: init, serve, status, stop, lock, unlock and wipe.',
  referenceVaultPanel:
    'Open the per-user credential vault in the Models & Agents panel: set it up or unlock it, manage items and grants, and lock it. Not yet available on Windows.',
  referenceVaultLock: 'Lock the per-user credential vault now, ending every use in every window.',
  referenceAuthClear: 'Remove the stored Model API key.',
  referenceAuthStatus:
    'List the stored keys (the Model API key and every configured provider key); the exit code reports whether any key is stored.',
  referenceAuthGitHub:
    'Sign in to GitHub for pull requests with GitHub’s device flow: enter the printed code at github.com/login/device; the token stays in this computer’s credential store. logout deletes it, status says whether one is stored.',
  referenceAccountRequests:
    'ACP native Meta requests select accounts at request boundaries. Headless --account-pool opts into pooling; account caps and shared budgets still bind.',
  referenceAccountsTitle: 'Several Accounts per Provider',
  referenceAccounts:
    'Manage the accounts of one provider: list, add, remove, order and thresholds. Credentials come only from standard input. Paid uses billed to the default account keep this workspace’s consent; another account’s first paid use asks for that account, naming its price and the shared daily budget.',
  referenceDeveloper:
    'Show or unlock machine-local developer options. Profile operations require a connected resource owner.',
  referenceTabLanguages: 'Choose a language to switch Tab suggestions on or off for it.',
  referenceTabMenu:
    'Turn Tab Off; Snooze for 15 Minutes; Snooze for an Hour; Snooze Until Restart; Tab Languages…; Multi-Line Mode…; Account & Usage. When Copilot causes Tab to yield, the menu also offers disabling Copilot for the current language or running both.',
  referenceTabOff: 'Turn Tab Off: museSpark.modelApiTab=false.',
  referenceTabOn:
    'museSpark.modelApiTab=true. Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic.',
  referenceBrowserDownload:
    'Chrome for Testing: Download (Settings: museSpark.browserCheckRuntime).',
  referenceRemoveSkills:
    'Remove only the extension-managed Muse Code skill copy and its links; leave other skills untouched.',
  referenceInstallSkills:
    "Copy project_setup, feature_delivery and quality_retrofit into Muse Code's configuration and link them as skills.",
  referenceExecContract:
    'Headless runs refuse workspace trust and bypass permissions. Headless runs permit only plan or acceptEdits. Hosted web search has no bounded allowance and is refused. Image generation requires acceptEdits. Choose exactly one prompt source. Prompt and key cannot both use stdin. Model API requires --max-budget-usd. modelApi: --max-budget-usd / --max-requests / --max-output-tokens / --ephemeral / --key-stdin / --subscription / --image-generation / --auto-compaction; museCode: --muse-binary / --shell-sandbox; --untrusted-file: data; --fail-on-denial; --ephemeral: memory-only; --output: text/json/jsonl; --cwd: workspace. Automatic compaction runs only with --auto-compaction under --max-budget-usd.',
  referenceBriefHelp:
    'help / --help / -h: ACP / CLI. help <command> / <command> --help: Usage, options and examples for one command. help --all: Commands, settings and features, with descriptions and documentation.',
  referenceJudgeUsage:
    'Usage: {command} judge ask|calibrate|report|mcp [options] < request.json; {command} judge serve|lint|scan|setup|remove [options]. Setup and removal change nothing without --yes. Exit codes: 0 done, 2 usage, 4 failed.',
  referenceKeyStdin:
    'auth set: Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations. exec / scan-secrets --key-stdin: Read the key from a pipe, not a terminal. stdin → memory; prompt stdin + key stdin = Prompt and key cannot both use stdin.',
  referenceModalKeys: 'Close the dialog or move focus within it.',
  referenceRenameKeys: 'Confirm or cancel renaming this conversation.',
  referenceRadialKeys:
    'Navigate actions, jump to the first or last, activate an action, or close or return to the parent menu.',
  referenceRowKeys: 'ContextMenu / Shift+F10: More Actions',
  referenceEffortKeys: 'Choose how much effort Muse puts into each reply.',
  referenceMenuKeys: 'Navigate items, choose or complete a selection, or close the list.',
  referenceArchiveKeys: 'Archive / Unarchive',
  referenceModeKeys: 'cycles the permission mode while the composer has focus',
  referenceDictationKeys: 'records your voice into the composer (tap to toggle, hold to talk)',
  referenceNewlineKeys: 'Insert a new line in the draft.',
  referenceSendKeys: 'Send the draft using the gesture selected by useCtrlEnterToSend.',
  referenceNodeTreeKeys:
    'Move between files, expand or collapse a folder, or open the active file.',
  referenceNodeEditorKeys: 'Save the open file.',
  referenceThinking:
    'Choose how much effort Muse puts into each reply. Thinking: On = effort; Off = museCode:none / modelApi:minimal.',
  referenceSandbox:
    'On Windows, when this window uses the Muse Code shell sandbox, set it up with one administrator approval, then start a new conversation. shellSandbox="off" does not require setup.',
  referenceSetup: 'Run Setup hooks for init from spark-hooks.json in a trusted workspace.',
  referenceSkills: "SKILL.md. museCode: Turn Muse Code's skills on or off. modelApi: SKILL.md.",
  referenceDictation:
    'Free dictation uses the OS engine on Windows and macOS. Local Linux x64/arm64 uses offline English Whisper tiny.en after consent to download its model; linuxDictationModel=false removes it. Remote workspace hosts cannot hear the local microphone.',
  referenceVoice:
    'Paid Muse Voice works on both backends in a local window with a stored Model API key; Muse Code requires explicit opt-in. Recordings stop at three minutes and reserve the daily budget before connecting. A set conversation cap refuses microphone recordings; attached audio is transcribed only when its bounded cost still fits the cap. Linux needs arecord or parec. Final reported seconds determine the estimate; the provider’s bill cannot be read back.',
  referenceBestOfN:
    'Best of N Apply and stage exactly the selected preview. No commit is created; ignored files are excluded.',
  referenceNativeAgentsConditions:
    'When run.subagent_delegation_mode="auto", Muse Code can delegate to agents. When it is "off", delegation tools are unavailable. run.workflow_trigger_mode: auto / explicit / off.',
  referenceNativeAgents:
    'run.workflow_trigger_mode: auto / explicit / off. Muse Code agent delegation controls.',
  referenceAttachments:
    'Attach files by selecting or dropping them, and paste images into the composer. PNG, JPEG, GIF and WebP images require a selected model with vision. PDF attachments require Model API. Trusted indexed workspace text files can be attached; protected or confidential files are refused. The limits below apply before sending.',
  referenceScreenRecording:
    'Direct screen recording is unavailable in this build. Choose an existing recording file.',
  referenceLatestRecording:
    'Attach the most recent screen recording again without recording a new one. Requires a readable recording and verified video upload support.',
  referenceUploadedFiles:
    'List the uploaded files of this account and delete them before they expire. Deleting a file another app also uses asks first. Requires provider/account upload storage integration.',
  referenceConversationActions:
    'Rename, fork or rewind a conversation. Rewind can restore recorded edits as well as history; changed files are left alone, and shell changes are not covered. While a turn runs, new messages steer it. Model API messages can be withdrawn before the next request; Muse Code permits withdrawal only while queued, because steering is delivered immediately. Side chat copies completed turns, clears the goal and stays in Plan; Muse Code file tools may still edit in Plan. Select transcript text to reply, ask, comment or copy.',
  referenceQuestions:
    'Choose and Submit an answer, explain in your own words, or Cancel. Muse receives submitted answers and explanations in the conversation.',
  referenceQuestionsDeferral:
    'Each question or MCP form has one card pinned above the composer. Answer on its Open question transcript marker opens or expands the card and focuses its first control, even after deferral. Muse receives submitted answers and explanations in the conversation. After museSpark.questions.deferAfterSeconds (no limit unless you set one; 0, the default, waits indefinitely), Muse resumes independent work; answer or dismiss the card later. Late answers are your messages and approve nothing. Next open question / Previous open question navigate cards. Scheduled prompts defer immediately; headless exec declines questions. ACP: --questions-defer-after sets the deadline; /questions lists open questions; /answer <n> <text> answers one.',
  referencePermissionLimits:
    'museCode:manual: Muse asks before running each command, unless a permission rule allows it; Muse Code edits workspace files without asking\nmuseCode:acceptEdits: On Muse Code, the same as Manual: Muse Code edits workspace files without asking, and asks before running each command, unless a permission rule allows it\nmuseCode:plan: Muse plans first; Muse Code refuses commands, but its file tools can still edit files without asking\nmuseCode:bypassPermissions: Muse will edit files and run commands without asking\nmodelApi:manual: Muse will ask for approval before each edit and each command\nmodelApi:acceptEdits: Muse will edit files without asking and ask before running commands\nmodelApi:plan: Muse will explore the code and present a plan before editing\nmuseCode (museSpark.museCodeAutoReviewer=false): Muse Code runs the commands it judges simple without asking and asks before the rest\nmuseCode (museSpark.museCodeAutoReviewer=true): Muse Code runs the commands it judges simple without asking; a reviewer may allow some others once, and you are asked about the rest\nmodelApi (museSpark.modelApiAutoReviewer=false): Muse will edit files without asking, except protected files, and ask before commands\nmodelApi (museSpark.modelApiAutoReviewer=true): Muse will edit files without asking, except protected files; a paid reviewer may allow some commands once, and you are asked about the rest\nThese Auto descriptions concern requests not settled by rules. The Model API reviewer additionally requires paid consent and budget admission. A declined or failed review leaves the decision to you. Ordinary ACP has neither reviewer.',
  referenceElicitationTitle: 'MCP Elicitation',
  referenceElicitation:
    'MCP forms ask for information for the requesting MCP server. Submitted form values go to that server, outside the model conversation and transcript. A server can include them in later tool output. Never enter a password or key.',
  referenceSecretPrompt:
    'When a prompt contains a detected secret, the transcript redacts it and asks whether to send it anyway or return to editing.',
  referenceCodeIntelExtra:
    'Use editor language services for definitions, references, symbols, calls and safe renames. Hover Repo map (mcp__ide__repoMap / repo_map).',
  referenceContext:
    'Click to compact now Summarise older context to free the context window Cannot rewind before the latest compaction.',
  referenceBundled:
    'Bundled skills: project_setup, feature_delivery, quality_retrofit. muse_gadgets is available on Model API only.',
  referenceExports:
    'A portable file you can import or share Muse Code’s full JSON record of this conversation Resume an exported session file on the Model API backend',
  referenceResumeAgents:
    'Pick up unfinished Claude Code work in this conversation. Pick up unfinished Codex work in this conversation.',
  referencePlanModes:
    'Only the latest reply in Plan mode can be saved as a plan. A new conversation with this plan as its brief, out of Plan mode Implement a plan from the main conversation; a side chat stays in Plan mode.',
  referenceBrowser:
    'The page loads in a fresh private browser profile that is deleted afterwards. All its traffic goes through the extension’s own proxy, which lets through only plain http to this computer and the hosts in museSpark.browserCheckExtraHosts. The browser check is off in Restricted Mode. Trust the workspace to use it.',
  referenceBudget:
    'Shared daily budget: museSpark.paidDailyBudgetUsd, a limit you set (none by default); a session limit you set also applies. Tab has its own separate budget. Nothing is held for a request in flight: a request without reported usage counts as cost unknown, never as its estimate. A response can cost more than its estimate; the next request is then stopped.',
  referenceCache: 'Settings (modelApiPromptCacheRetention).',
  referenceMcp:
    'MCP servers: Muse Code runs its own servers; on Model API this window runs configured servers. ACP Model API has no editor MCP servers.',
  referenceTab:
    'Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic. Consent covers the model and price shown; changing either asks again. A legacy Allow always grant asks a migration question. Only Allow always in this workspace saves the model and price; Allow once saves nothing, stays in this window, and each new window asks again.',
  referenceNativeSearch:
    'Muse Code web search and native cron use the subscription. Native cron has no MSP schedule controls; extension search and schedules are separate paid Model API features.',
  referenceCustomAgents:
    'Define custom agents in project or personal AGENT.md files. Select an agent or ask for explore or second-opinion; tool allowlists narrow its abilities. Model API child tasks require paid subagent consent.',
  referenceCodeOutput:
    'Copy copies code; Insert writes at the editor cursor; Apply replaces the editor selection. Open tool output to read the full result; clipped output can be paged. Select transcript text to quote it in the composer, ask about it, add a comment or copy it.',
  referencePaidContexts:
    'Interactive Model API extras ask before spending and share the daily budget. Muse Code images need a stored Model API key and explicit opt-in; their spending is outside that daily ledger. Muse Voice reserves the shared daily budget on both backends. ACP paid features default off and require Model API flags and editor permission. ACP and headless Model API requests reserve against the runtime daily budget; headless also requires a hard run budget. Headless images require acceptEdits and the image flag. Account & usage can forget workspace paid-use grants.',
  referenceAcp:
    'Installed skills add dynamic slash commands. This static reference does not list them. ACP handles local /help, /report, /playbook, /compact, /legal, /playback, /usage, /resources, /resources resume, /usage resources, /questions, /answer, /prompt, /share, /whatsnew and /agents plus installed skills; /playbook answers locally in every editor; panel slash commands, settings and editor dialogs in the linked reference are extension workflows.',
  referenceCiOtherTitle: 'Other CI systems',
  referenceCiOther:
    'Digest-pinned headless review/fix templates for GitLab, Azure, Jenkins and Bitbucket. Node reads the key and publishes outside the checkout; every template uploads those files. GitLab/Bitbucket external-temp copies and Bitbucket process isolation remain unqualified. Declare extra key binding names in MUSE_CI_KEY_ALIASES. Fake tests only; see docs/ci-other-systems.md.',
  referenceWebFetchTitle: 'Web Fetch',
  referenceWebFetchDetail:
    'Fetch public web pages as readable text, with permission and network checks.',
  referenceCodeIntelTitle: 'Code Intelligence',
  referenceCodeIntelDetail:
    'Use editor language services for definitions, references, symbols, calls and safe renames.',
  referenceShellDetail:
    'Run your own !commands, or let the agent run commands under your permission mode.',
  referenceBoardDetail:
    'Filter conversations by title or branch, inspect their state, changes and approvals, and activate a conversation.',
  helpReferenceTitle: 'Help & Reference',
  referenceIntro: 'Commands, settings and features, with descriptions and documentation.',
  referenceSearch: 'Search the Reference',
  referenceFeatures: 'Features',
  referenceCommands: 'Commands',
  referenceSettings: 'Settings',
  referenceShortcuts: 'Keyboard Shortcuts',
  referenceCurrent: 'Current Value',
  referenceDefault: 'Default',
  referenceOpenSetting: 'Open Setting',
  referenceRun: 'Run',
  referenceDocs: 'Documentation',
  referenceNoMatches: 'No matching entries.',
  referenceUnavailable: 'Current values are unavailable in this host.',
  referenceHidden: 'Hidden to protect sensitive values',
  referenceApplies: 'Editors: {editors}. Backends: {backends}.',
  referencePaid:
    'Meta Model API (Your Key, Pay as You Go): Allow Once / Allow Always in This Workspace',
  referenceVersion: 'Print the installed agent version.',
  referenceSidebar: 'Open the Muse Spark chat in the sidebar.',
  referenceNewTab: 'Open a new Muse Spark conversation in an editor tab.',
  referenceFocus: 'Move keyboard focus between the chat input and editor.',
  referenceTasks: 'Open this conversation’s task list in a separate editor tab.',
  referenceDevices: 'Open the Devices tab to link this editor with your other devices.',
  referenceDiagnostics: 'Show local backend and extension diagnostics.',
  referenceReport: 'Preview a scrubbed problem report before saving or sending it.',
  referenceInProgress: 'In progress.',
  estimateDiagnosticHelp:
    'Plan and engine refusals show the same named diagnostic in the panel, CLI and ACP; external errors hide private details. A refused estimate, refresh or start replaces the previous forecast with that diagnostic.',
  referenceEstimate:
    'Ship-date forecast for a goal from the current fleet, or the setup a target date needs.',
  referenceTerminal: 'Open the Muse Code CLI in the editor’s terminal.',
  referenceRules: 'Create or open AGENTS.md in the workspace root.',
  referenceWalkthrough: 'Open the Getting Started walkthrough.',
  referenceRetry: 'Retry preparation of the Windows job for plugin hooks.',
  referencePlaybookCommand:
    'Show or change the orchestrator playbook journal for this workspace (starts no backend).',

  sessionDeleteConnectionClosed:
    'The connection closed before deletion was confirmed. The session remains in History.',
  sessionDeleteHostExited:
    'Muse Code exited before deletion was confirmed. The session remains in History.',
  sessionDeleteHostClosed:
    'The host closed before deletion was confirmed. The session remains in History.',
  sessionDeleteUnsupported: 'Muse Code {version} cannot delete conversations.',
  // M116 / D96: shared panel, Agent map, ACP, CLI and report wording.
  playbookTitle: 'Orchestrator Playbook',
  playbookStatus: 'Status',
  playbookRecord: 'Record',
  playbookSettings: 'Playbook Settings',
  playbookEmpty: 'No playbook decisions recorded yet.',
  playbookEnabled: 'On',
  playbookDisabled: 'Off',
  playbookReasonLabel: 'Reason for Turning This Rule Off',
  playbookReasonRequired: 'Give a reason before turning a rule off.',
  playbookDisabledDetail: 'Turned off by {actor} on {date}: {reason}',
  playbookSafetyAlwaysOn: 'Safety checks always apply. This rule cannot be turned off.',
  playbookPatchRoundsLabel: 'Fix Rounds Before Redesign',
  playbookPatchRoundsHelp:
    '0 means fix rounds continue until the work converges or you stop it. Set a number to require a design decision and a redesign lane after that many fix rounds.',
  playbookPatchRoundsInvalid: 'Enter 0 for unlimited fix rounds, or a whole number of 1 or more.',
  playbookFallbackReviewer: 'Fallback reviewer for classifier-blocked reviews: {reviewer}',
  playbookFallbackNone: 'No fallback reviewer named',
  playbookResidualAccepted: 'Residual Accepted',
  playbookRecordHelp:
    'Show review strikes, design decisions, safety refusals, settings and unbound acceptance reasons.',
  playbookResidualUnbound: 'Unbound Residual Acceptance',
  playbookResidualUnboundReason:
    'No earlier residual matches this acceptance’s time and evidence. It covers no residual.',
  playbookLeaseRecord: 'Patch lease {status}: {module} ({lane})',
  playbookWorkRecord: 'Work {id} on {module}: {commits} baseline commits',
  playbookVerificationRecord: 'Hook verification {result} for {commit} ({scope})',
  playbookPlanRedesign: 'Plan a Redesign',
  playbookDesignDecision: 'Design Decision',
  playbookDesignPending: 'Awaiting Redesign Review',
  playbookCoverageLabel: 'Review Coverage',
  playbookModuleLabel: 'Module',
  playbookClassLabel: 'Finding Class',
  playbookOutcomeLabel: 'Redesign Outcome',
  playbookUnavailable: 'The playbook is unavailable in this session.',
  playbookCommandFailed: 'The playbook command could not be completed.',
  playbookHelpDescription:
    'Show review strikes, design decisions, safety refusals and rule settings.',
  playbookCommandUsage: 'Use `playbook status|record|settings|run <name> [--heavy] [--full-gate]`.',
  // `playbook run`: no check commands in the workspace settings.
  playbookNoChecks:
    'No check commands are configured; name them in the museSpark.checkCommands setting.',
  // {name}: the check name as typed; {checks}: the configured names, comma-separated.
  playbookUnknownCheck: 'Unknown check {name} (known checks: {checks}).',
  // `playbook run`: the workspace settings file exists but does not parse.
  playbookSettingsInvalid: 'The workspace .vscode/settings.json is not valid.',
  // `playbook run`: the file parses but its check commands fail the setting's schema.
  playbookChecksInvalid:
    'The museSpark.checkCommands setting is invalid, so no check commands are available.',
  playbookSave: 'Save Settings',
  playbookSaved: 'Playbook settings saved.',
  // C-M116-6: the panel's answers to findings, and what a conversation is told.
  playbookAnswerReason: 'Reason',
  playbookAnswerWhySafe: 'Why It Is Safe for Now',
  playbookAnswerFollowUp: 'Follow-up',
  playbookNotCertified:
    'Playbook: this round could not be certified, so it does not count as passed.',
  playbookEvidenceUnreadable:
    'Playbook: a reviewed file, or what a subagent changed, could not be read, so the playbook cannot tell whether this review is its own. The review was not sent.',
  playbookRecordStale: 'The playbook record could not be read. What is shown may be out of date.',
  playbookMuseCodeStarts:
    'Muse Code starts subagents without asking. The playbook counts their rounds and reviews their work, and cannot stop a start.',
  playbookStrikeBadge: forms({ one: '{count} review round', other: '{count} review rounds' }),
  playbookRules: {
    threeStrikes: 'Redesign After Fix Rounds',
    onePassReview: 'Review Every Class in One Pass',
    contractsFirst: 'Contracts and Prerequisites First',
    smallFirst: 'Small Work First, After Dependencies',
    offload: 'Offload Heavy Checks to Workers',
    continuousIntegration: 'Integrate on One Rolling Trunk',
    breakOnPurpose: 'Prove Tests and Gates Fail',
    loudFailures: 'User Items and Failures First',
    neverAround: 'Never Route Around a Safety Check',
  },
  playbookClasses: {
    validation: 'Validation',
    security: 'Security',
    failure: 'Failure Paths',
    honesty: 'Honesty',
    concurrency: 'Concurrency',
    lifecycle: 'Lifecycle',
    tests: 'Tests and Gates',
    docs: 'Documentation',
  },
  playbookResolutions: {
    impossible: 'Structurally Impossible',
    caught: 'Caught by a Check',
    remains: 'Still Present',
  },
  playbookDispositions: {
    fixed: 'Fixed',
    disputed: 'Disputed',
    residual: 'Named Residual',
    override: 'Lead or Owner Override',
  },
  playbookDesignFields: {
    failureClass: 'Class of Failure',
    whyPatchesFailed: 'Why the patches did not end it',
    structuralChange: 'Structural Change That Removes the Failure',
    planLocation: 'Decision in the Plan',
    redesignLane: 'Redesign Lane',
  },
  playbookNotes: {
    checksPassed: 'Playbook checks passed.',
    redesignRequired: 'Playbook: round {round} in {module} requires a redesign ({classes}).',
    designRequired:
      'Playbook: write a design decision for {module} before dispatching its redesign.',
    redesignOpen: 'Playbook: {module} stays open; catching a finding does not remove its cause.',
    redesignEscalated: 'Needs you: the redesign of {module} still has findings.',
    coverageIncomplete:
      'Playbook: review coverage is incomplete ({classes}); this review was not counted.',
    answersPending: 'Playbook: answer every finding in {module} before another review.',
    lineageRequired:
      'Playbook: {module} needs recorded module lineage or a lead or owner override.',
    reviewerConflict: 'Playbook: {module} needs a reviewer with a different agent id and session.',
    contractsPending: 'Playbook: lane {lane} waits for its reviewed, merged contracts lane.',
    prerequisiteMissing: 'Playbook: lane {lane} waits for {missing}.',
    reordered: 'Playbook: queued by dependency, estimate, then id.',
    offloaded: 'Playbook: heavy check assigned to worker {worker}.',
    localCheck: 'Playbook: no worker is offered; run locally under the resource governor.',
    ciGate: 'Playbook: run the full gate in CI.',
    integrationRequired:
      'Playbook: lane {lane} must include the rolling integration trunk before merging.',
    drillMissing:
      'Playbook: lane {lane} needs a failing drill and a byte-exact restore for each new test or gate.',
    ownerFirst: 'Playbook: user items and failures are shown first.',
    hookTampering:
      'Early warning: this command appears to bypass or change hooks. Commit verification controls push and completion.',
    hookVerificationFailed:
      'Needs you: repository hook verification failed. Push and completion are blocked.',
    unverifiedCommit:
      'Safety check: every new commit needs a passing hook receipt before push or completion.',
    gateSkipped: 'Safety check: skipping a gate is refused.',
    permissionLaundering:
      'Needs you: this action was already refused; another agent cannot re-ask it within {duration}.',
    classifierBlocked:
      'Needs you: a safety classifier blocked this action; it cannot be retried or rerouted.',
    ruleDisabled: 'Playbook: {rule} was turned off by {actor}: {reason}',
    briefRecorded: 'Playbook: brief for {module} recorded ({reason}).',
    configDrift: 'Needs you: shared repository configuration drifted for {module} ({reason}).',
    fallbackReviewer:
      'Playbook: {actor} reviews {module} as the recorded fallback reviewer ({reason}).',
    residualOpen: 'Needs you: {lane} has open residuals: {missing}.',
    contributionBlocked: '{reason}',
  },
  playbookBlockedName:
    'Playbook finding for {child}: a file whose name is withheld reads as a secret. This child’s round was counted.',
  playbookBlockedLarge:
    'Playbook finding for {child}: the patch is {size}, above the {bound} bound. This child’s round was counted.',
  playbookBlockedUnreadable:
    'Playbook finding for {child}: the contribution could not be read. This child’s round was counted.',
  playbookBlockedMany:
    'Playbook finding for {child}: changed-file count: {count}; bound: {bound}. This child’s round was counted.',
  // STARTUP017: a restored settlement row's words paint with chat startup;
  // the rest of the schedule English loads with the schedule surfaces.
  scheduleSettlement: {
    sent: 'Sent on schedule',
    outcomes: {
      ran: 'Ran',
      refused: 'Refused',
      missed: 'Missed',
      skipped: 'Skipped',
      failed: 'Failed',
      uncertain: 'Uncertain',
    },
  },
  // M115 lane 0: strings for the lazy schedule surfaces and adapters.
  scheduleV2: {
    editor: {
      tips: {
        list: 'Review schedules and their standing grants in this workspace.',
        create: 'Choose when, where and with which permissions to send this prompt.',
        timeline: 'See upcoming fires and collisions on the same target.',
      },
      user: 'You',
      liability: 'Retained Liability',
      certainty: { exact: 'Exact', estimated: 'Estimated', unknown: 'Unknown' },
      edit: 'Edit Schedule',
      audit: 'Grant Audit',
      invalid: 'Check the schedule fields, target availability and standing grant before saving.',
      loadFailed: 'Schedules could not be loaded. Try again.',
      empty: 'No schedules in this workspace.',
      defaultName: 'Scheduled Prompt',
      defaultPrompt: 'Describe what the schedule should do.',
      stateUnknown: 'State unknown — Retry',
      retry: 'Retry',
      dateTimeUtc: 'Date and Time (UTC)',
      anchorDate: 'Anchor Date (in the Schedule’s Time Zone)',
      minutes: 'Interval in Minutes',
      everyDays: 'Every N Days',
      times: 'Times (HH:MM, Comma Separated)',
      cronExpression: 'Five-Field Cron Expression',
      source: 'Event Source',
      conditions: 'Conditions (field=value, One per Line)',
      endDate: 'End Date and Time (UTC)',
      afterRuns: 'End After N Runs',
      cost: 'Cost',
      grantHelp:
        'One entry per line. Paths stay inside this workspace; protected paths and tools that require a person are always refused.',
      paidCapHelp:
        'A new schedule starts at zero and never spends; set a cap to let it spend up to that amount.',
      auditKinds: {
        created: 'Created',
        changed: 'Changed',
        revoked: 'Revoked',
        used: 'Used',
      },
    },
    reportAction: {
      formats: {
        markdown: 'Markdown Document',
        html: 'HTML Document',
        json: 'JSON Document',
        text: 'Plain Text',
      },
      unavailable:
        'Report delivery is unavailable in this host. The deterministic report runner is required.',
      grantRequired: 'This report destination is outside the schedule’s current grant.',
      failed: 'Report delivery failed or its outcome is uncertain.',
      invalidResult: 'The report runner returned an invalid destination receipt.',
      kind: 'Report Kind',
      format: 'Format',
      args: 'Arguments',
      destinations: 'Destinations',
    },
    runtime: {
      usage:
        'Usage: schedule add --draft <JSON> [--scheduled-prompts --max-budget-usd <USD>] [--report <kind> --to save:<path>|browser|email:<address> ... --format md|html|json|text] [-- <report args>] | list | remove|run-now|pause|resume|fire <id> | timeline [--hours 24|168] [--cwd <path>] [--json]; schedule run-due [--json]; schedule background off|status [--json]. Exit codes: 0 success, 1 refusal, 2 usage, 3 cleanup warning.',
      accepted: 'Schedule request accepted',
      empty: 'No schedules or upcoming fires.',
      unavailable:
        'Schedules are unavailable in this host. The runtime scheduler binding is required.',
      invalidRequest: 'Invalid schedule request. Check the draft, identifier and options.',
      invalidResponse: 'The scheduler returned an invalid response.',
      consentRequired: 'Background scheduling requires your explicit Yes.',
      backgroundUnavailable: 'Background scheduling is unavailable on this host.',
      unsafeLauncher: 'Unsafe schedule launcher path: {path}',
      paidAuthorizationRequired:
        'Paid schedules require --scheduled-prompts and an explicit --max-budget-usd covering both paid caps.',
      cleanupFailed:
        'Schedule request finished, but cleanup failed. Keep the accepted id; exit code 3 means cleanup needs attention.',
      hostUnavailable:
        'The schedule host could not start for this workspace. Schedule controls are unavailable; ordinary chat remains available.',
      backgroundRearmUnavailable:
        'Background scheduling is waiting for a wake to finish or for its retirement interval. Try again shortly.',
      wakeBarrierTimeout:
        'The schedule wake timed out waiting for background reconciliation. No scheduled work started.',
    },
    settings: {
      enabled:
        'Enable schedules on available backends. On by default; each fire runs unattended within its standing grant.',
      defaultDelivery: 'Default delivery for new schedules: a new turn starts on idle by default.',
      agentCreation:
        'Default permission for agents to create schedules: ask, always within caps, or never. Ask by default.',
    },
    labels: {
      title: 'Schedules',
      name: 'Name',
      action: 'Action',
      prompt: 'Prompt',
      report: 'Report',
      trigger: 'Trigger',
      timeZone: 'Time Zone',
      preview: 'Next Five Fires',
      end: 'End Condition',
      target: 'Target',
      delivery: 'Delivery',
      mode: 'Permission Mode',
      grant: 'Standing Grant',
      paidCap: 'Daily Schedule Cap',
      parallel: 'Run in Parallel',
      paused: 'Paused',
      pause: 'Pause Schedule',
      resume: 'Resume Schedule',
      remove: 'Remove Schedule',
      revoke: 'Revoke Grant',
      pin: 'Pin Schedule',
      timeline: 'Schedule Timeline',
      schedulePrompt: 'Schedule This Prompt…',
      runNow: 'Run Now',
      save: 'Save Schedule',
      tools: 'Allowed Tools',
      commands: 'Command Prefixes',
      paths: 'Workspace Paths',
      creator: 'Creator',
      depth: 'Scheduling Depth',
      background: 'Background Entry',
      whenClosed: 'Closed Target',
      catchUp: 'Missed Fires',
      unavailable: 'Unavailable',
    },
    delivery: {
      steer: 'Steer the Running Turn',
      interrupt: 'Interrupt and Run',
      queue: 'Queue After This Turn',
      whenIdle: 'New Turn When Idle',
      newConversation: 'New Conversation',
    },
    triggers: {
      once: 'Once at a Date and Time',
      interval: 'Every N Minutes or Hours',
      daily: 'Every N Days',
      weekdays: 'On Weekdays',
      weekly: 'Weekly Days and Times',
      cron: 'Custom Cron',
      event: 'On an Event',
      afterEvent: 'After an Event, at a Time',
    },
    targets: {
      conversation: 'This Conversation',
      namedConversation: 'Named Conversation',
      newConversation: 'New Conversation Each Fire',
      worker: 'Worker',
      role: 'Team Role',
      team: 'Team',
      node: 'Muse Node',
    },
    destinations: {
      save: 'Save to a Folder',
      browser: 'Open in Browser',
      email: 'Email to the User',
      post: 'Post to a Repository',
      cloud: 'Cloud Save (Planned)',
      sms: 'Text Message (Planned)',
    },
    policies: {
      open: 'Open in the Background',
      skip: 'Skip the Fire',
      runOnce: 'Run Once to Catch Up',
    },
    events: {
      pullRequestOpened: 'Pull Request Opened',
      pullRequestClosed: 'Pull Request Closed',
      pullRequestMerged: 'Pull Request Merged',
      reviewRequested: 'Review Requested',
      ciFinished: 'CI Run Finished',
      releasePublished: 'Release Published',
      issueLabelled: 'Issue Labelled',
      issueOpened: 'Issue Opened',
      issueReplied: 'Issue Reply Received',
      branchUpdated: 'Branch Updated',
      tagCreated: 'Tag Created',
      milestoneStatusChanged: 'Milestone Status Changed',
      milestoneCertified: 'Milestone Certified',
      turnFinished: 'Turn Finished',
      laneFinished: 'Lane Finished',
      taskFinished: 'Task Finished',
      teamFinished: 'Team Finished',
      questionAnswered: 'Question Answered',
      usageThresholdCrossed: 'Usage Threshold Crossed',
      resourceLevelChanged: 'Resource Level Changed',
      filesChanged: 'Watched Files Changed',
      versionPublished: 'Store Version Published',
      manual: 'Manual Trigger',
    },
    messages: {
      dispatchUncertain:
        'Dispatch started, but its final result is unknown. This fire will not be sent again; its reserved amount remains counted.',
      costUnknown:
        'The prompt was delivered, but its actual cost could not be read. Its reserved amount remains counted.',
      targetUnavailable: 'This schedule’s target is unavailable in this host.',
      targetClosed: 'The target closed.',
      deliveryFailed: 'Delivery failed: {reason}',
      schedulePaused: 'The schedule was paused before delivery.',
      scheduleDeleted: 'The schedule was deleted before delivery.',
      scheduleEdited: 'The schedule’s timing, target or delivery mode changed.',
      scheduleEnded: 'The schedule reached its end before delivery.',
      admissionLost: 'This fire no longer has an admission.',
      workspaceNotHeld: 'This process no longer holds the workspace.',
      catchUpSkipped: 'Missed fire skipped by this schedule’s catch-up policy.',
      backgroundNotice: 'Schedule {name} opened a conversation in the background.',
      conversationTitle: 'Schedule {name} · {date}',
      interruptWarning: 'Interrupt can stop your own running turn.',
      unattendedRefusal:
        'Refused on schedule: {action} needs approval and is not in this schedule’s grant.',
      deferredQuestions: 'Questions defer immediately and remain open for your answer.',
      allowAlways: 'Allow always for this schedule',
      paidConsent:
        'Schedule {prompt} on {model}: {price}. Cadence: {cadence}. Schedule cap: {cap} per local day; shared daily budget: {budget}. Consent covers only the selected paid extras. Charges are billed to your Model API key; your subscription does not pay for them.',
      changedPayer: 'The payer kind changed. Renew this schedule’s paid consent.',
      changedModel: 'The selected model changed. Renew this schedule’s paid consent.',
      changedKey: 'The paying account or key changed. Renew this schedule’s paid consent.',
      changedTariff: 'The verified tariff changed. Renew this schedule’s paid consent.',
      changedSharedCap: 'The shared daily budget changed. Renew this schedule’s paid consent.',
      pausedPaid: 'This schedule is paused. Resume it before another paid fire.',
      changedGrant: 'This schedule’s permission grant changed. Review its grant and renew consent.',
      changedRevision:
        'The schedule or its running session changed. Reload it before another paid fire.',
      lostOnceClaim:
        'This fire no longer owns the once-only consent. Renew consent for another fire.',
      capReached: 'The schedule or shared daily cap does not admit this paid fire.',
      paidUnavailable: 'This paid operation is unavailable or was not approved for this schedule.',
      changedConsent:
        'This schedule’s paid consent is missing or changed. Renew it before another paid fire.',
      setBy: 'Set by {agent} in {session}',
      migrationConsent:
        'Migrated schedule paused. Review its mode, grant and paid consent before resuming.',
      collision: 'Fires on this target collide; they run in creation order.',
      historyUnavailable: 'No history to preview.',
      eventUntrusted: 'Event content is untrusted data and cannot change grants, tools or targets.',
      backgroundQuestion: 'Run schedules while editors are closed?',
      backgroundYes: 'Yes',
      backgroundNotNow: 'Not Now',
      backgroundNever: 'Never',
      backgroundRemove: 'Remove the Background Entry',
      backgroundRemoved: 'Background entry removed.',
      agentConsent: 'Allow {agent} to create this schedule within its own permissions and budget?',
      agentAlways: 'Always for This Orchestrator',
      agentNever: 'Never for This Orchestrator',
      grantRevoked: 'This schedule’s grant was revoked.',
      waitingBusy: 'Waiting: machine busy',
      saveRoot: 'Save only within this schedule’s approved root.',
      openWhenBack: 'Open When I’m Back',
      plannedDestination: 'This destination is planned and unavailable.',
      expiredOwner: 'This schedule ended with its creator’s session or team.',
    },
    endAfterRuns: forms({
      one: 'End after {count} run',
      other: 'End after {count} runs',
    }),
    historyPreview: forms({
      one: 'Would have fired {count} time in {days} days',
      other: 'Would have fired {count} times in {days} days',
    }),
  },
  // M105 / D85: read UI_TEXT.media at use time. Lane W isolates this region.
  // Version-scoped capability words: the reference catalogue lint rejects
  // conditional-state notices (scripts/lib/reference.mjs), so this names what
  // scheduled turns support instead of what billing verified.
  scheduledMediaSupport:
    'Scheduled turns support text and image inputs; video and audio inputs are unsupported in this version.',
  referenceSchedulesCertified:
    'Certified scheduled prompts deliver in VS Code, ACP and the terminal. /loop remains manual.',
  referenceRuntimeSchedulesCertified:
    'Scheduled prompts use session-owned output, durable fire records and background targets in ACP and the terminal.',
  referenceSchedulePaidConsentCertified:
    'Each paid schedule needs its own current consent and shares one schedule cap and daily budget across hosts.',
  referenceSchedules:
    'The v2 schedule editor, list and timeline manage durable records. Automatic VS Code v2 prompt delivery is disabled. Model API /loop jobs run when you choose Run now.',
  runtimeSchedulesItem: 'Runtime schedules',
  runtimeSchedulesItemDetail: 'Schedule unattended Muse Code prompts in ACP or the terminal',
  referenceRuntimeSchedules:
    'Automatic v2 delivery in VS Code, ACP and the terminal is disabled pending certification. The candidate runs unattended Muse Code prompts with standing grants, persistent fire records and background conversation targets.',
  referenceSchedulePaidConsent:
    'Automatic delivery is disabled; the running editor neither asks for v2 schedule consent nor reserves its paid caps. The candidate billing port binds consent to payer kind, model, key, verified tariff and shared daily budget; changing any requires renewal. Allow once covers one fire; Allow always covers this schedule.',
  media: {
    recordingScreenPermissionRequired: 'Screen Recording permission has not been granted.',
    recordingMicrophonePermissionDenied: 'Microphone permission was denied.',
    recordingMicrophonePermissionRestricted: 'Microphone access is restricted by system policy.',
    recordingMicrophonePermissionPending:
      'Microphone permission is undecided. Start a recording to request access.',

    nativeMicrophonePurpose:
      "Muse Spark Code uses the microphone to type your speech into the composer. With paid Muse Voice enabled, it sends the audio to Meta's Muse Voice Transcribe; otherwise macOS recognizes it. Screen recordings include microphone audio only when you select it. You preview each screen recording before attaching it.",
    nativeScreenPurpose:
      'Muse Spark Code records your screen only when you start a screen recording. It may include anything on the selected display. You preview the recording and choose Attach or Discard before anything is sent.',
    nativeSpeechPurpose:
      'Muse Spark Code turns what you say into text with the speech recogniser built into macOS.',

    durationUnknown: 'Duration unknown',
    durationUnknownLabel: 'Duration Unknown',
    sound: 'Sound',
    noSound: 'No Sound',
    soundUnknown: 'Sound Unknown',
    estimateTokens: forms({ one: '{count} token (est.)', other: '{count} tokens (est.)' }),
    estimatePrices: '{standard} Standard / {contributor} Contributor',
    videoUnsupported: '{model} does not take video.',
    videoUnknown: '{model} is not known to take video.',
    audioUnsupported: '{model} does not take audio.',
    audioUnknown: '{model} is not known to take audio.',
    soundtrackUnsupported: '{model} does not hear this video’s sound.',
    formatUnsupported: '{model} does not take {format}.',
    durationExceeded: 'This file exceeds {duration}.',
    sizeExceeded: 'This file exceeds {size}.',
    convertToMp4: 'Convert to mp4',
    converterUnavailable: 'No converter is available. Choose an mp4 file.',
    converterConfiguredRefused: 'The configured converter was refused: {reason}',
    converterSharedFolder:
      'A converter was found, but a folder above it can be changed by other users ({reason}). Set the converter path to one in a folder only you or the system can change.',
    transcribeSound: 'Transcribe the Sound',
    transcribe: 'Transcribe',
    useSoundtrackModel: 'Use {model} for This Message',
    sendWithoutSound: 'Send Without Sound',
    wrapAsVideo: 'Send to {model} as a Video',
    transcript: 'Transcript of {name}',
    museCodeRefusal: 'This media needs the Model API backend.',
    cappedDurationUnknown: 'This capped session needs a known duration before sending media.',
    cappedRateUnknown: 'This capped session needs a calibrated media rate for {model}.',
    contributorWarning: 'Contributor models may use this media for training.',
    contributorQuestion: 'Send {name} to a Contributor model? It may be used for training.',
    contributorDeclined: '{name} was not attached.',
    audioWillTranscribe:
      '{model} does not hear audio, so Muse Voice will transcribe it before sending. Transcription is a paid extra and asks first.',
    useStandardThenAttach: 'Switch to {model}, then attach {name} again.',
    uploadUnavailable:
      'This session has no file upload service, so video and audio cannot be sent. Use the Model API backend with a Meta key.',
    recordingWarning: 'This recording includes whatever was on your screen.',
    send: 'Send',
    useStandard: 'Use the Standard Model',
    uploadPending: 'Waiting to upload',
    uploadProgress: 'Uploaded {uploaded} of {total}',
    uploadStop: 'Stop upload',
    uploadStopLabel: 'Stop Upload',
    uploadFailed: 'Upload failed: {reason}',
    uploadExpired: 'The upload expired. Attach {name} again.',
    sourceChanged: '{name} changed since upload. Attach it again.',
    uploadedFiles: 'Uploaded Files',
    filesOurs: 'Uploaded by This App',
    filesOtherApp: 'From Another App',
    filesEmpty: 'No uploaded files.',
    fileNoExpiry: 'No expiry set',
    fileSessions: 'Sessions: {sessions}',
    filesInUse: 'Remove this file from its sessions before deleting it.',
    filesInUseRequest:
      'This file is in use by a running request. Try again when the reply finishes.',
    deleteUploadedFiles: 'Delete Uploaded Files…',
    deleteAllOurs: 'Delete All Ours',
    otherAppFileConfirmation: 'Another app may still use {name}. Delete it anyway?',
    filesReadOnly: 'The key was removed. Uploaded files are read-only until their expiry.',
    fileExpiry: 'Expires {expiry}',
    poolUsage: '{used} of {pool} stored',
    replayOmitted: '{name} ({duration}) was left out: {model} does not take {kind}.',
    attachRecording: 'Attach Screen Recording…',
    recordingDiscarded: 'The recording was discarded; nothing was attached.',
    attachLatestRecording: 'Attach Latest Screen Recording',
    recordingCountdown: 'Recording: {remaining} remaining',
    recordingElapsed: 'Recording: {elapsed} elapsed',
    recordingMicrophone: 'Microphone',
    recordingSystemAudio: 'System Audio',
    recordingPreview: 'Preview Screen Recording',
    recordingAttach: 'Attach',
    recordingDiscard: 'Discard',
    recordingPermissionDenied:
      'Screen recording permission was denied. Allow it in system settings and try again.',
    recordingAccessDenied:
      'Access to the screen recording was denied. Check permissions and try again.',
    recordingFailed:
      'Screen recording failed. Check available storage and recording support, then try again.',
    recordingOpenPermissions: 'Open Screen Recording Settings',
    recordingUnavailable: 'Screen recording is unavailable: {reason}',
    recordingRemote:
      'This window runs on a remote host with no local screen. Use the companion page or choose a recording file.',
    recordingBrowserUnsupported: '{browser} cannot record mp4. Choose an mp4 recording file.',
    recordingUserOnly: 'Only an interactive user can start a screen recording.',
    recordingNotFound: 'No screen recording was found in {folders}.',
    recorderUnavailable: 'No screen recorder is available on this host.',
    attachHeadless: 'Refused for headless runs: pass the file with --attach instead.',
    // D85.6 records the not-billed decision, so this names what is still
    // missing instead: the production upload and transcription bindings.
    uploadStorageUnknown:
      'Video and audio uploads are not available in this version: the production upload and transcription bindings are still missing.',
    attachmentUnknownType: 'Unsupported attachment type: {type}',
    recordingStart: 'Start Recording',
    recordingStop: 'Stop Recording',
    uploadDeleteFailed: 'Could not delete {name}: {reason}',
    deleteUploadedFilesPick: 'Checked files are deleted from the provider',
    uploadsDescription: 'List uploaded files and delete them early',
    uploadsUsage: '/uploads [delete <file> | delete-all]',
    uploadNotFound: 'No uploaded file {id} is listed.',
    uploadForeignKept: 'Kept {name}: another app may still use it.',
    uploadDeleteProviderRefused: 'the provider refused the deletion',
    uploadDeleteBacklog: forms({
      one: '{count} uploaded file could not be deleted from {provider}. Deletion will be retried.',
      other:
        '{count} uploaded files could not be deleted from {provider}. Deletion will be retried.',
    }),
    conversionFailed: 'Conversion failed: {reason}',
    replayMetadata: 'Media: {name} ({duration}, {size})',
    replayMetadataNoDuration: 'Media: {name} ({size})',
  },
  paidDailyBudgetLine:
    'Shared daily budget for interactive paid extras: {budget}. Tab has its own separate budget.',
  // D208: a daily budget shown where none is set; the person sets one, none by default.
  paidDailyBudgetNone: 'none set',
  paidDailyLedgerUnavailable:
    'The daily paid spend ledger is unavailable. Repair it before another paid request.',
  paidDailyStopped: 'Paid extras are stopped until tomorrow.',
  paidDailyReached: 'Daily paid budget reached',
  paidDailyReachedDetail:
    'Today’s limit is {budget}. What is spent today plus this request’s estimate comes to {needed}. Raise the limit for today, or stop paid extras until tomorrow.',
  paidDailyRaise: 'Raise for Today',
  paidDailyStop: 'Stop Until Tomorrow',
  paidDailyRaisePrompt:
    'Enter today’s limit in USD, at least what is spent today plus this request’s estimate.',
  planUi: {
    copilotConnect: 'Use My Copilot Models',
    copilotUnavailable: 'Copilot models are unavailable. Enable Copilot and try again.',
    copilotQuota: 'Your Copilot quota is exhausted. Manage usage or choose another model.',
    copilotRateLimit: 'Copilot is rate limited. Try again later.',
    copilotConsent: 'Allow access to Copilot in its consent dialog to continue.',
    // Said when a confidential workspace refuses Copilot sign-in.
    copilotConfidential: 'Copilot is unavailable while this workspace is confidential.',
    // Said where the Copilot dispatch adapter cannot be reached (the
    // terminal): the grant lives in VS Code, so no terminal can use it.
    copilotTerminalGrant:
      'Copilot models run only in VS Code, through the Copilot extension; this terminal cannot reach that grant.',
    // Said where the adapter is absent on a non-terminal host: same source.
    copilotHostGrant:
      'Copilot models run only in VS Code, through the Copilot extension, which this host cannot reach.',
    // What Copilot uses and who bills it: VS Code's granted models, the Copilot plan.
    copilotNotice: 'Copilot models granted to VS Code, billed to your Copilot plan or AI credits.',
    expired: 'ChatGPT granted too little time to finish this request. Sign in again.',
    retry: 'ChatGPT is temporarily unavailable. Try again.',
    // M95b: plan billing, allowance recovery and Copilot's required content note.
    chatGptMark: 'Using ChatGPT Plan',
    providerMark: 'Using {provider} Plan',
    manage: 'Manage Usage',
    noticeTitle: 'You’re Using Your ChatGPT Plan',
    noticeDetail: 'ChatGPT Plus/Pro requests share your allowance; they add none.',
    credits:
      'Apps may spend credits after plan limits if enabled. Check ChatGPT’s Manage usage settings.',
    understood: 'Got It',
    limitTitle: 'ChatGPT Plan Usage Limit Reached',
    limitDetail:
      'Wait for a reset or choose an API-key model. Reset time is unknown. You choose billing changes.',
    chooseModel: 'Choose Another Model',
    usageHeading: 'Plan Usage',
    usageDetail:
      'Plan allowance or credits pay, outside this app’s dollar cap. Quota and reset time are unknown.',
    requests: 'Requests',
    reportedTokens: 'Reported Tokens',
    estimatedTokens: 'Estimated Tokens',
    unknownTokens: 'Unknown Tokens (Requests)',
    // {input}, {output}, {requests}: localized counts, including the sampled requests.
    tokenCounts: '{input} input · {output} output · requests: {requests}',
    reduced: 'Reduced',
    aiContent:
      'AI content can be inaccurate. Copilot adds rules and uses AI credits. Unreported token usage is estimated.',
    reportContent: 'Report Harmful Content',
    // {description}: the catalogue's own words for the priority tier.
    fastDetail: '{description}. Off by default: it uses more of your plan allowance.',
    // {message}: OpenAI's own error message for the failed plan request,
    // or the HTTP status where it sent none.
    requestFailed: 'The ChatGPT plan request failed: {message}',
    // OpenAI's 403 subscription_sharing_user_not_eligible: retrying or signing in again cannot fix it.
    notEligible:
      'OpenAI does not allow ChatGPT plan use for this account, workspace or policy. Choose an API-key model.',
    // OpenAI answered with no body at all.
    noReply: 'OpenAI answered the ChatGPT plan request without a reply. Try again.',
    // {reason}: this app's own word for what it could not build or read.
    requestNotBuilt:
      'This app could not prepare the ChatGPT plan request ({reason}). Nothing was sent.',
    grokNoticeTitle: 'You’re Using Your Grok Subscription',
    grokNoticeDetail:
      'SuperGrok or X Premium requests share your subscription allowance; they add none.',
    // OPENAI-G27: one true sentence per documented plan refusal.
    chatGptNotEligible:
      'Your ChatGPT plan cannot be used for this account. Sign in with an eligible account, or choose an API-key model.',
    chatGptUsageUnavailable:
      'ChatGPT could not check plan usage. Your sign-in is kept. Try again later.',
    // {detail}: the provider's error.param (or message), a technical name.
    chatGptUnsupportedCapability:
      'ChatGPT refused this request ({detail}). Change the request and try again.',
    chatGptRouteNotSupported:
      'This ChatGPT request used an unsupported route. Try again, and report it if it persists.',
    chatGptInvalidUser: 'ChatGPT could not confirm this account. Sign in again.',
    chatGptGrantNotAuthorized:
      'ChatGPT did not permit this request for the current sign-in. Sign in again, or choose an API-key model.',
    // OPENAI-G28: the plan's reported limit windows; absent when unreported.
    planPrimaryWindow: 'Primary window',
    planSecondaryWindow: 'Secondary window',
    // {percent}: the used share, already formatted.
    planLimitUsed: '{percent} used',
    // {minutes}: the window length, already formatted.
    planLimitWindow: '{minutes}-minute window',
    // {when}: the reset moment, already formatted.
    planLimitResets: 'Resets {when}',
  },
  untitledConversation: 'Untitled',
  crashTitle: 'The Panel Hit an Error',
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
  // The empty composer's invitation (F67): a message first, then only this
  // machine's shortcut, in one line. The host fills `shortcut` for its own
  // platform (webviewSetup); the all-platform tip stays in Getting Started
  // (M26, D29).
  composerPlaceholder: 'Ask Muse…',
  // {shortcut}: this machine's focus key (Ctrl+Esc, Cmd+Esc or Ctrl+Alt+Esc).
  composerPlaceholderWithShortcut: 'Ask Muse… ({shortcut} to focus)',
  // Shown while a turn runs: Enter then steers the running turn.
  composerQueuePlaceholder: 'Queue another message…',
  queuedLabel: 'Queued',
  queuedMenuLabel: 'Queued Message Actions',
  queuedEdit: 'Edit',
  queuedEditTitle: 'Take the message out of the queue and back into the prompt box',
  queuedDelivered: 'Already Delivered to the Running Turn',
  queuedTooLate: 'This message already reached the model, so it can no longer be edited.',
  queuedEditUnsupported:
    'This conversation cannot take a queued message back, so it cannot be edited.',
  queuedImagesNotReturned:
    'The message is back in the prompt box, but its images could not be returned. Attach them again before sending.',
  composerLabel: 'Message Muse',
  connecting: 'Connecting to the extension host…',
  notSignedIn: 'Not signed in',
  sendDisabledReason: 'Sign in to send messages',
  stopTitle: 'Stop',
  signInTitle: 'Sign In to Muse Spark',
  signInBrowser: 'Sign In With Your Meta Account',
  signInBrowserDetail: 'Shows an approval code here; open the sign-in page to approve it.',
  signInApiKey: 'Use a Model API Key',
  signInApiKeyDetail: 'Paste a key from dev.meta.ai; it is stored in VS Code secret storage.',
  installTitle: 'Muse Code Is Not Installed',
  installDetail:
    'The Muse Code CLI hosts conversations for this extension. Install it here, then sign in.',
  installAction: 'Open Install Instructions',
  installStartAction: 'Install Muse Code',
  installConfirmDetail:
    'Meta publishes this command. It downloads and runs an installer on this machine:',
  installConfirmAction: 'Run Installer',
  installCancelAction: 'Cancel',
  installWaiting: 'Installing Muse Code in the terminal…',
  installTimedOut: 'Muse Code was not found. Check the terminal output, then check again.',
  installStartFailed:
    'The installer terminal could not open. Try again or use the install instructions.',
  deviceCodePrompt: 'Enter this code in your browser:',
  deviceCodeOpenAction: 'Open Sign-In Page',
  deviceCodeCancelAction: 'Cancel Sign-In',
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
  // A credential store that cannot be read (CATCHMONEY R3): the sentence says
  // what happened, what the product does because of it, and the next step.
  // `{reason}` is one of the credentialStoreReason* kind words below, never
  // an errno or an internal name.
  credentialStoreUnreadable:
    'Saved credentials could not be read: {reason}. The safe state is kept: nothing was signed out or released. Check keychain access and try again.',
  credentialStoreReasonCrypto: 'a stored entry cannot be decoded',
  credentialStoreReasonLocked: 'the keychain is locked',
  credentialStoreReasonNoService: 'no keychain answered',
  credentialStoreReasonDenied: 'access to the keychain was refused',
  credentialStoreReasonTimeout: 'reading the keychain timed out',
  credentialStoreReasonOther: 'the cause is unknown',
  retryAction: 'Check Again',
  apiKeyPrompt: 'Meta Model API Key',
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
  // The pill while the sign-in facts are still being read (F60): what the
  // panel waits for, not the backend starting.
  checkingSignIn: 'Checking sign-in…',
  // PLAN.md D25: restarts, crashes and closed sessions continue the conversation.
  hostRestartsOnSend: 'The next message restarts it and continues this conversation.',
  turnStoppedByRestart: 'Stopped: the backend restarted',
  sessionClosedByHost: 'Muse Code closed this session',
  sessionResumesOnSend: 'The next message resumes it.',
  sessionContinued: 'Conversation continued after the restart.',
  sessionNotContinued:
    'The conversation could not be continued after the restart, so this message starts a new one',
  // After a restart the resumed conversation runs on {active} instead of the
  // chosen {wanted}: the message is not sent, and the conversation stays
  // resumable, so choosing the reported model and resending continues it.
  modelNotKeptAfterRestart:
    'Muse Code reports this conversation runs on {active} instead of {wanted}, so the message was not sent. Choose the model again and resend to continue it.',
  surfaceClosed: 'The panel was closed',
  hostStartFailed: 'The backend could not start',
  decisionErrorNotice:
    'Muse Code reported an error for the decision (the tool may have run anyway)',
  jumpToLatest: 'New Messages',
  jumpToLatestTitle: 'Jump to the newest message',
  copyResponse: 'Copy Response',
  messageSentAt: 'Sent {time}',
  messageReceivedAt: 'Received {time}',
  openOutputTitle: 'Click to open the output in an editor',
  toolOutputTitle: '{tool} Tool Output ({id})',
  clickToExpand: 'Click to Expand',
  openOutputFailed: 'Could not open the output',
  working: 'Working…',
  attachTitle: 'Attach',
  attachMenuLabel: 'Attach',
  uploadFromComputer: 'Upload From Computer',
  addContext: 'Add Context',
  commandsTitle: 'Commands',
  modelPillTitle: 'Model and Effort',
  permissionModeTitle: 'Permission Mode',
  modesTitle: 'Modes',
  modesHintKeys: '⇧ + Tab',
  modesLabel: 'Permission Modes',
  bypassNotAllowed:
    'Turn on the "Allow dangerously skip permissions" setting to use Bypass permissions.',
  // PLAN.md D24: the setting turned off while a conversation is in Bypass.
  bypassRevoked:
    'The "Allow dangerously skip permissions" setting was turned off; this conversation is back in Manual.',
  // D24: in a remote window a dev container's settings can switch Bypass on.
  bypassRemoteTitle: 'Run without approvals on a remote machine?',
  bypassRemoteDetail:
    'This window runs on a remote machine or in a container, where a dev container definition can set museSpark.allowDangerouslySkipPermissions without you. Bypass permissions lets Muse edit files and run commands without asking.',
  bypassRemoteConfirm: 'Use Bypass Permissions',
  bypassRemoteStartedManual:
    'museSpark.initialPermissionMode asks for Bypass permissions, but this is a remote window; the conversation starts in Manual. Choose Bypass from the Modes menu to confirm it.',
  // D24: an edit the "Edit automatically" mode approved on the user's behalf.
  editAutomaticallyResolver: 'Edit Automatically',
  focusViewBadge: 'Focus View',
  historyTitle: 'Session History',
  sideChatTitle: 'Side Chat',
  openSideChat: 'Side Chat',
  newConversationTitle: 'New Conversation',
  sendTitle: 'Send',
  // Command palette ("/" menu).
  paletteLabel: 'Actions',
  paletteFilterPlaceholder: 'Filter actions…',
  paletteNoMatches: 'No matching actions',
  paletteBack: 'Back',
  paletteTips: {
    attachFile: 'Attach a file to your next message.',
    mentionFile: 'Mention a file from this project in your message.',
    clear: 'Clear this conversation and start a new one.',
    resume: 'Pick a previous conversation in this workspace.',
    'continue:claude': 'Pick up unfinished Claude Code work in this conversation.',
    'continue:codex': 'Pick up unfinished Codex work in this conversation.',
    plans: 'Saved plans in .agents/plans: open one or implement it.',
    newWorktree: 'A new branch in its own folder and window; this checkout is untouched.',
    removeWorktree: 'Delete a worktree folder; its branch stays.',
    switchModel: 'Choose the model for this conversation.',
    effort: 'Choose how much effort Muse puts into each reply.',
    thinking: 'Show or hide the thinking behind replies.',
    permissionMode: 'Choose how Muse asks before it acts.',
    focusView: 'Hide the steps outside your focus.',
    ctrlEnter: 'Send messages with Ctrl+Enter instead of Enter.',
    importFromAgents:
      'Copy MCP servers, hooks, agents, commands and rules from Claude Code, Codex or Cursor.',
    memory: 'The notes Muse keeps for later sessions.',
    settings: 'Open settings.',
    keybindings: 'Keyboard shortcuts.',
    accountUsage: "Subscription usage, this conversation's tokens, the backend.",
    usage: 'Show this conversation’s input and output token counts.',
    backend: 'Choose which backend runs this conversation.',
    signOut: 'Sign out of Muse Spark on this computer.',
    agents: 'Show the agent map.',
    compact: 'Summarise the conversation so far to free context.',
    handoff: 'Distil this conversation into a brief for a fresh one.',
    goal: 'Set a goal Muse keeps working toward: /goal <objective>.',
    export: 'Save this conversation as a Markdown file.',
    exportJson: 'A portable file you can import or share.',
    openShare: 'Read a shared session file, read-only.',
    clearCommand: 'Clear this conversation and start a new one.',
    logout: 'Sign out of Muse Code.',
    usageCommand: 'Show account usage.',
    costCommand: 'Show this conversation’s token totals.',
    log: 'Open output log.',
    whatsNew: 'Open this version’s release highlights and full notes.',
    issue: 'Report an issue.',
    docs: 'Open the Muse Code documentation.',
    mcpServers: 'What Muse Code connects to; sign in to a server.',
    hooks:
      'Inspect project, user, managed and spark-hooks.json hook sources for the selected backend.',
    'paid:imageGeneration': 'Turn paid image generation on or off.',
    'paid:voice': 'Turn paid Muse Voice on or off.',
    manageSkills: "Turn Muse Code's skills on or off.",
    importSkills: 'Copy your Claude Code or Codex skills into Muse Code.',
    exportLog: "Muse Code's full JSON record of this conversation.",
    'paid:webSearch': 'Turn paid web search on or off.',
    'paid:subagents': 'Turn paid subagents on or off.',
    'paid:scheduledPrompts': 'Turn paid scheduled prompts on or off.',
    'paid:autoCompaction': 'Turn paid automatic compaction on or off.',
    'paid:autoReviewer': 'Turn the paid Auto reviewer on or off.',
    'paid:bestOfN': 'Turn paid Best of N on or off.',
    'paid:tab': 'Turn paid Tab completions on or off.',
    'paid:legalExplanation':
      'Turn paid explanations of legal findings on or off. The stored Model API key is billed.',
    'paid:judge': 'Turn paid Judge advice on or off.',
    'paid:hookModels': 'Turn paid model hooks on or off.',
    // M91: `/hook run`, a Manual hook from spark-hooks.json.
    hookRun: 'Run one of your Manual hooks from spark-hooks.json now.',
    loop: 'Schedule a prompt in this Model API conversation.',
    sequences: 'Run saved prompts in order, each after the previous turn completes.',
    importSession: 'Resume an exported session file on the Model API backend.',
    review: 'Ask Muse to review your changes, or what you describe.',
    reviewUncommitted: 'Muse reviews your staged and unstaged changes.',
    reviewBranch: 'Muse reviews this branch against a base branch you pick.',
    reviewCommit: 'Muse reviews one recent commit you pick.',
    reviewSecurity: 'Muse checks your uncommitted changes for security problems.',
    reviewChanges: 'Accept or revert each edit this conversation made.',
    playback: 'Muse states its own understanding of the goal, from memory only, with no tools.',
    // Scheduled prompts v2 (M115): the reference reuses these; the palette
    // rows keep their translated editor tips until these are translated.
    schedule: 'Review schedules and their standing grants in this workspace.',
    schedulePrompt: 'Pick the time, target and permissions for this prompt.',
    scheduleTimeline: 'See upcoming fires and collisions on the same target.',
  },
  paletteSkillTip: 'Run the {name} skill.',
  groupContext: 'Context',
  groupModel: 'Model',
  groupCustomize: 'Customize',
  groupAccount: 'Account & Usage',
  groupSkills: 'Skills',
  groupSlashCommands: 'Slash Commands',
  groupSupport: 'Support',
  attachFile: 'Attach File…',
  mentionFile: 'Mention File From This Project…',
  clearConversation: 'Clear Conversation',
  switchModel: 'Switch Model…',
  effortItem: 'Effort',
  thinkingItem: 'Thinking',
  permissionModeItem: 'Permission Mode',
  focusViewItem: 'Focus View',
  ctrlEnterItem: 'Send With Ctrl+Enter',
  openSettings: 'Open Settings…',
  openKeybindings: 'Keyboard Shortcuts…',
  sessionUsage: 'Session Usage',
  sessionUsageValue: '{input} in · {output} out',
  signOutItem: 'Sign Out',
  skillsLoading: 'Start a conversation to load skills',
  skillsEmpty: 'No skills available in this workspace',
  // Skills, imports and export (M30, D30).
  manageSkillsItem: 'Manage Skills…',
  manageSkillsDetail: 'Turn Muse Code’s skills on or off',
  importSkillsItem: 'Import Skills…',
  importSkillsDetail: 'Copy your Claude Code or Codex skills into Muse Code',
  continueClaudeItem: 'Continue a Claude Code Session',
  continueCodexItem: 'Continue a Codex Session',
  continueDetail: 'Pick up unfinished work in this conversation',
  exportItem: '/export',
  exportDetail: 'Save this conversation as a Markdown file',
  exportLogItem: 'Export Session Log…',
  exportLogDetail: 'Muse Code’s full JSON record of this conversation',
  skillsCliMissing: 'Managing skills needs the Muse Code CLI, which is not installed.',
  skillsListFailed: 'Muse Code could not list its skills',
  skillsPickTitle: 'Muse Code Skills',
  skillsPickPlaceholder: 'Checked skills are on; uncheck one to turn it off',
  skillsUnchanged: 'No skills changed.',
  skillsChanged: 'Skills updated',
  skillsChangeFailed: 'Muse Code could not change {skills}',
  skillsRestartPrompt:
    'Muse Code loads skill changes when it starts. Restart it now? A reply that is running stops.',
  restartNow: 'Restart Now',
  restartLater: 'Later',
  restartedNotice:
    'Muse Code restarted with the new skills; your next message continues the conversation.',
  importSourceTitle: 'Import Skills From',
  importSourceClaude: 'Claude Code',
  importSourceCodex: 'Codex',
  importConfirm: 'Import these skills into your Muse Code skills?',
  importConfirmAction: 'Import',
  importInvalid: 'not valid, will be skipped',
  importFailed: 'Muse Code could not import skills',
  // Import from Claude Code, Codex and Cursor (M83, D49).
  agentImportItem: 'Import From Other Agents…',
  agentImportSourceTitle: 'Import From',
  agentImportSourceCursor: 'Cursor',
  agentImportPickTitle: 'What to Import',
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
  agentImportEditAction: 'Edit and Open the File',
  agentImportDone: 'Import finished.',
  agentImportOpenFile: 'Open the File',
  agentImportKindMcp: 'MCP Server',
  agentImportKindHook: 'Hook',
  agentImportKindAgent: 'Agent',
  agentImportKindCommand: 'Command',
  agentImportKindRules: 'Rules Section',
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
  agentImportPreviewTitle: 'Import Preview',
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
  // Hooks from every popular agent (M91, PLAN.md D70): the new sources.
  agentImportSourceGemini: 'Gemini CLI',
  agentImportSourceCopilot: 'Copilot and VS Code',
  agentImportSourceWindsurf: 'Windsurf',
  agentImportSourceKiro: 'Kiro',
  agentImportSourceCline: 'Cline',
  agentImportSourceAmp: 'Amp',
  agentImportSourceOpenCode: 'OpenCode',
  agentImportSourceEvery: 'All of Them',
  agentImportDetailEvery:
    'Copy MCP servers, hooks, agents, commands and rules from Claude Code, Codex or Cursor, and hooks and plugins from Gemini CLI, Copilot, Windsurf, Kiro, Cline, Amp and OpenCode',
  agentImportKindPlugin: 'Plugin',
  // Why an entry is not imported, after "Not imported:".
  agentImportSkippedWeaker:
    'here it could not block as it does where it came from, so the guard would be weaker',
  agentImportSkippedChooses: 'it chooses a path, a model or a tool, which no hook may do here',
  // {field}: a field name as the source writes it.
  agentImportSkippedField: 'it sets {field}, which has no equivalent here',
  agentImportSkippedNotify: 'Codex’s notify program is not a hook, so it is listed, not converted',
  agentImportSkippedNeedsMatcher: 'FileChanged needs a matcher naming the files to watch',
  agentImportSkippedUnknownFormat: 'its file is in a format this version does not read',
  agentImportKeptWaiting:
    'kept, waiting for inline completions, which this extension does not have yet',
  // Kiro's spec-task triggers map to the todo-item events (M91, PLAN.md D70):
  // the preview says so in plain words.
  agentImportKiroTaskNote: 'Kiro spec-task triggers run on todo items here',
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
  exportDefaultTitle: 'Muse Conversation',
  // Session export, import and share (M84, PLAN.md D49).
  exportJsonItem: 'Export Session as JSON…',
  exportJsonDetail: 'A portable file you can import or share',
  importSessionItem: 'Import Session…',
  importSessionDetail: 'Resume an exported session file on the Model API backend',
  openShareItem: 'Open Share File…',
  openShareDetail: 'Read a shared session file, read-only',
  exportPreviewTitle: 'Export Session as JSON',
  exportPreviewRedacted: 'Save Redacted…',
  exportPreviewFull: 'Save Without Redaction…',
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
  importPreviewTitle: 'Import Session',
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
  openShareTitle: 'Open Share File',
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
  shareShowMore: 'Show More',
  // After "could not be imported: ". {size}, {limit}: sizes such as 2.4 MB.
  importReplayTooLarge:
    'It holds {size} of text for the model, and a resumed conversation can start with at most {limit}. Open it as a share file to read it.',
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
  mcpItem: 'MCP Servers…',
  mcpItemDetail: 'What Muse Code connects to; sign in to a server',
  hooksItem: 'Hooks…',
  hooksItemDetail:
    'Inspect project, user, managed and spark-hooks.json hook sources for the selected backend.',
  mcpTitle: 'Muse Code MCP Servers',
  mcpNoSettings: 'Muse Code has no settings file yet, so no MCP servers. It would be at {path}',
  mcpUnreadable: 'Muse Code’s settings file could not be read:',
  mcpNone: 'No MCP servers are configured in {path}',
  mcpCount: forms({
    one: '{count} MCP server in {path}',
    other: '{count} MCP servers in {path}',
  }),
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
  mcpOpenSettings: 'Open the Settings File',
  mcpRestart: 'Restart Muse Code to Load Changes',
  mcpRestartDetail:
    'A reply that is running stops; the conversation continues on your next message',
  mcpInvalidUrl: 'an invalid URL',
  mcpNoCommand: 'no command',
  mcpInvalidJson: 'the file is not valid JSON',
  mcpRestarted: 'Muse Code restarted; your next message loads the settings as they are now.',
  mcpDocs: 'MCP Servers in Muse Code (Documentation)',
  mcpSignIn: 'Sign In',
  mcpSignInDetail: 'Runs muse mcp login in a terminal (OAuth in the browser)',
  mcpSignOut: 'Sign Out',
  mcpRemotePlaceholder: 'A remote server: sign in or out, or edit its entry',
  mcpStdioPlaceholder: 'A local server needs no sign-in; edit its entry in the settings file',
  mcpCliMissing: 'Signing in to an MCP server needs the Muse Code CLI, which is not installed.',
  mcpTerminalName: 'Muse Code MCP Sign-In',
  // MCP servers on the Model API backend (M50, D42).
  mcpItemDetailModelApi: 'The servers in Muse Code’s settings, run by this window',
  mcpTitleModelApi: 'MCP Servers on the Model API Backend',
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
  mcpBuiltIn: 'Built In',
  mcpBuiltInDetail:
    'The extension’s own getDiagnostics: the errors and warnings in VS Code’s Problems panel',
  mcpRestartModelApi: 'Restart the MCP Servers',
  mcpRestartModelApiDetail:
    'A reply that is running stops; the servers start again with your next message, from the settings as they are then',
  mcpRestartedModelApi:
    'The MCP servers stopped; your next message starts them from the settings as they are now.',
  mcpShowLog: 'Show the Log',
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
  // Shared resources (M96 lane B, D75): the registry, the leases and the bridge.
  // M96b (PLAN.md D75): a worker approval's title starts with the role and
  // the agent. {role}: the worker's role; {agent}: the agent running it;
  // {detail}: what the approval is about.
  acpTeamPermissionTitle: '{role} · {agent}: {detail}',
  // Shared resources (M96 lane B, D75): the registry, the leases and the bridge.
  teamResourcesTitle: 'Tools and Devices',
  teamResourcesDetail: 'Which MCP servers and devices the team shares, and who may use them',
  teamResourcesKindLabel: 'Kind',
  teamResourcesKindExclusive: 'Exclusive',
  teamResourcesKindExclusiveDetail:
    'One at a time: a browser, a device or a fixed port. Calls wait for the lease.',
  teamResourcesKindShared: 'Shared',
  teamResourcesKindSharedDetail: 'Up to its limit at once. Further calls wait in its queue.',
  teamResourcesKindFree: 'Free',
  teamResourcesKindFreeDetail: 'No lease. Any worker calls it any time.',
  teamResourcesRolesLabel: 'Roles That May Use It',
  // {count}: the shared resource's concurrency limit, a number.
  teamResourcesLimitLabel: 'At most {count} at once',
  // {role}: the holding role's name; {taskId}: the holding task's id.
  teamResourceBusy: 'resource busy, held by {role} task {taskId}',
  teamToolBindingChanged:
    'The tool or its permissions changed while waiting, or its lease is no longer held. The call was refused; list the tools again before retrying.',
  teamLeaseTakeBack: 'Take Back',
  teamLeaseTakeBackDetail:
    'The lease moves to the orchestrator; the holder’s next call is told the resource is busy.',
  teamLeaseRestartServer: 'Restart Server',
  teamLeaseRestartServerDetail:
    'Ends the server the window started; the lease is released once its process has exited.',
  teamLeaseReleaseAnyway: 'Release Anyway',
  teamLeaseReleaseAnywayDetail:
    'Releases the lease as your decision. The earlier call may still be acting on the resource.',
  // {server}: the exclusive server's name.
  teamLeaseElsewhereTitle: 'Another window runs {server}',
  // {window}: the other window's name; {server}: the exclusive server's name.
  teamLeaseElsewhereDetail:
    '{window} is using {server}. Starting it here too can take it from that window.',
  teamLeaseStartAnyway: 'Start Here Anyway',
  teamLeaseWait: 'Wait',
  teamLeaseOpenWindow: 'Open That Window',
  // {server}: the exclusive server's name.
  teamMoveToBridgeDetail:
    'Remove {server} from Muse Code’s settings file (the extension never writes it), and add it to the extension’s own MCP configuration, where the bridge serves it to every worker.',
  hooksTitle: 'Muse Code Hooks',
  hooksTitleModelApi: 'Model API Hooks',
  hooksWarning: 'Hooks run through your shell, outside Muse Code’s sandbox and approvals',
  hooksModelApiWarning:
    'Hooks are on by default in trusted workspaces and run through your shell outside tool approvals. Review these sources before trusting the workspace; without a hooks file, nothing runs.',
  hooksProject: 'Project Hooks',
  hooksProjectFile: '.muse/hooks.json',
  hooksProjectNone: 'This workspace has no .muse/hooks.json.',
  hooksProjectTrusted: 'Runs in this workspace',
  hooksProjectUntrusted: 'Runs only once you trust this workspace',
  hooksUser: 'Your Hooks',
  hooksUserBlock: 'settings.json › hooks',
  hooksUserNone: 'None in your settings',
  hooksUserCount: forms({
    one: '{count} hook in your settings',
    other: '{count} hooks in your settings',
  }),
  hooksManaged: 'Managed Hooks',
  hooksManagedKey: 'managed_hooks_path',
  hooksManagedNotSet: 'Not set: no administrator hooks',
  hooksManagedSet: 'Set by your settings; whoever controls this file controls what runs',
  hooksManagedMissing: 'Your settings name this file, but it does not exist.',
  hooksDocs: 'Hooks in Muse Code (Documentation)',
  // Hooks from every popular agent (M91, PLAN.md D70). The Hooks picker's
  // rows for spark-hooks.json, the extension's own hook file, which Muse Code
  // never reads.
  hooksSparkProject: 'Extension Hooks for This Project',
  hooksSparkProjectFile: '.muse/spark-hooks.json',
  hooksSparkProjectNone: 'This workspace has no .muse/spark-hooks.json.',
  hooksSparkUser: 'Your Extension Hooks',
  hooksSparkUserNone: 'You have no spark-hooks.json.',
  // {file}: the file's name or path.
  hooksSparkCount: forms({
    one: '{count} hook in {file}',
    other: '{count} hooks in {file}',
  }),
  hooksSparkAbout:
    'Muse Code never reads this file. It holds the events only this extension runs, and hooks imported from other agents.',
  hooksFileUnreadable: 'This file could not be read:',
  // Which backend runs a file's hooks, under its row.
  hooksBackendMuseCode: 'Run by Muse Code',
  hooksBackendBoth: 'Run by Muse Code, and by this window on the Model API backend',
  hooksBackendSpark:
    'Run by this window: on the Model API backend, and on both backends for the events the extension itself handles',
  hooksFormatModelApiOnly: 'Hooks in another agent’s format run only on the Model API backend.',
  // {format}: the source agent's name, such as Cursor.
  hooksFormatTag: '{format} Format',
  // {event}: a hook event's name as the file writes it.
  hooksMuseEventRefused:
    '{event} is a Muse Code event: configure it in .muse/hooks.json, so it runs once.',
  hooksExtensionEventSkipped:
    '{event} runs only from spark-hooks.json; Muse Code skips it in this file.',
  hooksStopFailureNote:
    'Muse Code 1.4.2 does not run StopFailure hooks; this window runs them on the Model API backend.',
  hooksSessionForkNote:
    'Muse Code 1.4.2 accepts SessionFork hooks but never runs them, so this window does not run them either.',
  hooksTabWaiting:
    'Waiting for inline completions, which this extension does not have yet, so it never runs.',
  hooksNotRunnable: 'Hooks run only in a trusted workspace, once museSpark.modelApiHooks is on.',
  // What a hook refused, with the hook's own words as {reason}.
  // {name}: the slash command or skill.
  hookRefusedExpansion: 'A hook refused {name}: {reason}',
  // {model}: the model id the conversation stays on.
  hookRefusedModelSwitch: 'A hook kept the model on {model}: {reason}',
  // {subject}: the task's subject.
  hookRefusedTaskCreated: 'A hook refused the task “{subject}”: {reason}',
  hookRefusedTaskCompleted: 'A hook kept the task “{subject}” open: {reason}',
  hookWorktreeCreateFailed: 'A WorktreeCreate hook failed, so this attempt did not run: {reason}',
  // {name}: a Best-of-N attempt's or a subagent's label.
  hookTeammateKept: 'A hook kept {name} working: {reason}',
  hookFileChangedPaused: forms({
    one: 'FileChanged hooks are paused for a minute: more than {count} change arrived.',
    other: 'FileChanged hooks are paused for a minute: more than {count} changes arrived.',
  }),
  // A PostToolUseFailure hook's corrected call; {reason}: one of the three below.
  hookCorrectionRefused: 'A hook’s corrected call was refused: {reason}',
  hookCorrectionOtherTool: 'it names a different tool',
  hookCorrectionOutside: 'it reaches outside the workspace',
  hookCorrectionTooDeep: forms({
    one: 'it went past {count} correction in a row',
    other: 'it went past {count} corrections in a row',
  }),
  // Why a call was not run: a BeforeToolSelection hook took its tool away.
  hookToolRemoved: 'a hook removed this tool for this turn',
  // A MessageDisplay hook's display-only rewrite: its marker and the switch.
  hookMessageEdited: 'Edited by a Hook',
  hookMessageShowOriginal: 'Show the Original',
  hookMessageShowEdited: 'Show the Hook’s Version',
  // Setup and Manual hooks, which run only when the user starts them.
  setupHooksNone: 'No Setup hooks are configured in spark-hooks.json.',
  setupHooksRan: forms({ one: 'Ran {count} Setup hook.', other: 'Ran {count} Setup hooks.' }),
  setupHooksFailed: 'A Setup hook failed: {reason}',
  manualHookPick: 'Run which hook?',
  manualHookNone: 'No Manual hooks are configured in spark-hooks.json.',
  // {name}: the name `/hook run` was given.
  manualHookNoneNamed: 'No Manual hook is named {name}.',
  // {name}: the hook's name in spark-hooks.json.
  manualHookDone: 'Hook {name} finished.',
  manualHookFailed: 'Hook {name} failed: {reason}',
  manualHookSlashDetail: 'Run a Manual hook from spark-hooks.json',
  // dist/extensionHooks.js failed to load.
  extensionHooksUnavailable:
    'The extension hooks could not be loaded, so no hook ran; reinstall the extension and reload the window. The log has the details.',
  // dist/modelApiTools.js failed to load.
  modelApiToolsUnavailable:
    'The model call helpers could not be loaded, so hook call fields are unavailable; reinstall the extension and reload the window. The log has the details.',
  modelApiToolsPreviewUnavailable:
    'The model call helpers could not be loaded, so argument previews are unavailable; reinstall the extension and reload the window. The log has the details.',
  // dist/toolRange.js failed to load.
  toolRangeUnavailable:
    'The file range helpers could not be loaded, so files cannot be read or edited by byte range; reinstall the extension and reload the window. The log has the details.',
  // The Model API shell's kept working directory. {path}: workspace-relative.
  shellDirectory: 'In {path}',
  shellDirectoryReset:
    'The shell went back to the workspace root: {path} is outside the workspace.',
  // MCP elicitation on the Model API backend. {server}: the MCP server's name.
  elicitationTitle: '{server} asks for information',
  elicitationNote: 'Your answer goes to {server}, not to Muse. Never enter a password or a key.',
  elicitationSend: 'Send',
  elicitationDecline: 'Decline',
  elicitationCancel: 'Cancel',
  elicitationRequired: 'Required',
  // {field}: the field's title, or its name when it has none.
  elicitationInvalid: '{field} does not fit what {server} asked for.',
  elicitationDeclinedByHook: 'A hook declined this request from {server}: {reason}',
  elicitationAnsweredByHook: 'One of your hooks answered this request from {server}.',
  elicitationExpired: 'The request from {server} is no longer waiting.',
  mcpElicitationTimedOut:
    'The request from {server} went unanswered for {seconds} seconds, so it settled as cancelled. No answer was sent.',
  // The http and mcp_tool hook handlers. {host}: a host name; {tool}: a tool name.
  hookHttpHostRefused: 'An http hook was refused: {host} is not an allowed host.',
  hookHttpSchemeRefused: 'An http hook was refused: only HTTPS is allowed.',
  hookHttpRedirectRefused: 'An http hook was refused: it redirected to {host}.',
  hookHttpProjectRefused:
    'An http hook in a project file was refused: http hooks run only from your own files.',
  hookHttpNetworkRefused:
    'An http hook was refused: this window’s network setting blocks the network.',
  hookMcpToolMissing: 'An mcp_tool hook was refused: {tool} is not a tool of a running MCP server.',
  // The prompt and agent handlers on Muse Code: one side-session turn each.
  hookModelMuseCodeNotice:
    'Prompt and agent hooks each run one short turn of your Muse subscription, in a hidden side session that History does not list.',
  // Amp and OpenCode plugins in the plugin host. {name}: the plugin's name;
  // {api}: the plugin API it called, as written.
  pluginStopped: 'The {name} plugin stopped: {reason}',
  pluginApiUnavailable:
    'The {name} plugin called {api}, which the plugin host does not offer, so that hook failed.',
  // Hooks in another agent's format. {format}: the source agent's name.
  hookAdapterUnreadable:
    'A {format}-format hook gave an answer this window cannot read, so it counts as a failure.',
  hookAdapterFailClosed:
    'A {format}-format guard failed, so the call was blocked, as {format} itself would block it.',
  // A hook in another agent's format replaced a tool's output for the model.
  hookOutputReplaced:
    'A hook replaced what the model sees of this tool’s output; the row shows the real output.',
  // Amp and OpenCode plugin hooks on Windows without their job (M91b): the
  // notice, and what Retry Plugin Hooks says once it forgot the failure.
  pluginHooksNoJob:
    'Amp and OpenCode plugin hooks did not run: Windows could not prepare the job that contains them. Run “Retry Plugin Hooks” to try again.',
  pluginHooksRetried: 'Plugin hooks will prepare their Windows job again the next time one runs.',
  // Memory (M49, D41): the notes Muse Code keeps, on both backends.
  memoryItem: 'Memory…',
  memoryItemDetail: 'The notes Muse keeps for later sessions',
  memoryTitle: 'Muse Memory',
  memoryNone: 'No memory notes yet for this workspace',
  memoryCount: forms({ one: '{count} memory note', other: '{count} memory notes' }),
  memoryIndexDetail: 'The index Muse reads at the start of every session',
  memoryNewNote: 'New Note…',
  memoryNewNoteDetail: 'A Markdown note Muse reads in later sessions, listed in MEMORY.md',
  memoryDocs: 'Memory in Muse Code (Documentation)',
  memoryOpen: 'Open',
  memoryDelete: 'Delete…',
  memoryDeleteDetail: 'Moves the note to the trash and takes its line out of MEMORY.md',
  memoryDeleteIndexDetail: 'Moves the index to the trash; the notes stay',
  memoryDeleteConfirm: 'Delete the memory note {path}?',
  memoryDeleteConfirmDetail:
    'It moves to the trash. Muse no longer sees it from its next session on.',
  memoryDeleteAction: 'Delete',
  memoryDeleted: 'Deleted {path}',
  memoryNewTitle: 'New Memory Note',
  memoryScopePlaceholder: 'Where the note lives',
  memoryNamePrompt: 'Name the note',
  memoryNamePlaceholder: 'deploy-steps.md',
  memoryNameInvalid: 'Muse Code does not accept that name',
  memoryNameTaken: 'A note with that name already exists.',
  memoryDescriptionPrompt: 'What is the note about? One line for MEMORY.md (optional)',
  memoryDescriptionPlaceholder: 'How we deploy to staging',
  memoryFailed: 'The memory could not be changed',
  // Worktrees (M32, D30).
  newWorktreeItem: 'New Worktree…',
  newWorktreeDetail: 'A new branch in its own folder and window; this checkout is untouched',
  removeWorktreeItem: 'Remove a Worktree…',
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
  worktreeBaseTitle: 'Start the Branch From',
  worktreeBasePlaceholder: 'The commit the new branch starts at',
  worktreeCurrent: 'current branch:',
  worktreeDetachedHead: 'the commit checked out now',
  worktreeFolderExists: 'That folder already exists:',
  worktreeAddFailed: 'git could not create the worktree',
  worktreeRecordsWriteUnknown: 'The worktree records may have been written',
  worktreeCreated: 'Worktree ready at {path}',
  worktreeOpen: 'Open in New Window',
  worktreeListFailed: 'git could not list the worktrees',
  worktreeNoneToRemove:
    'There is no other worktree to remove (the main checkout and this window’s own are kept).',
  worktreeRemoveTitle: 'Remove a Worktree',
  worktreeRemovePlaceholder: 'The folder is deleted; its branch stays',
  worktreeDetached: '(detached HEAD)',
  worktreeLocked: 'Locked',
  worktreePrunable: 'its folder is gone',
  worktreeRemoveConfirm: 'Remove this worktree? Its folder is deleted.',
  worktreeBranchKept: 'The branch stays:',
  worktreeRemoveAction: 'Remove',
  worktreeDirtyConfirm:
    'This worktree has uncommitted changes. Removing it discards them for good. Remove it anyway?',
  worktreeDiscardAction: 'Remove and Discard Changes',
  worktreeRemoveFailed: 'git could not remove the worktree',
  worktreeRemoved: 'Removed the worktree at {path}',
  // M71 (PLAN.md D49): git and pull requests, conversations in a worktree.
  groupGit: 'Git and Pull Requests',
  gitCommitItem: 'Commit…',
  gitCommitItemDetail:
    'Commit the changes in this workspace; a message is written only when you ask',
  gitPushItem: 'Push…',
  gitPushItemDetail: 'Push this branch; always asks, never forces',
  gitPullRequestItem: 'Open a Pull Request…',
  gitPullRequestItemDetail: 'On GitHub, as a draft or ready, linked to this conversation',
  gitCheckoutItem: 'Open a Pull Request in a Conversation…',
  gitCheckoutItemDetail: 'Check a pull request out in its own worktree and window',
  gitHubSignInWithCodeItem: 'Sign In to GitHub With a Code',
  gitHubSignInWithCodeDetail:
    'Sign in to GitHub with a code you enter on github.com/login/device; the token stays in this computer’s credential store',
  gitHubSignOutItem: 'Sign Out of GitHub',
  gitHubSignOutItemDetail:
    'Delete Muse Spark’s GitHub sign-in from this computer and open GitHub’s page where you revoke it',
  gitRestricted:
    'Git and pull requests are unavailable in Restricted Mode: git can run programs a repository’s configuration names. Trust the workspace to use them.',
  gitHeld: 'Git and pull requests wait until you trust this worktree in the card above.',
  gitUnavailable: 'VS Code’s Git is not available here',
  gitExtensionMissing: 'VS Code’s built-in Git extension is not available in this window.',
  gitExtensionDisabled: 'VS Code’s Git is turned off (git.enabled).',
  gitNoRepository: 'This workspace is not in a git repository that VS Code’s Git has open.',
  gitWorkspaceNotRepository: 'This workspace is not in a git repository.',
  gitProgramMissing: 'Git is not installed on this computer, or it is not on the PATH.',
  signOutInTerminal:
    'To sign out, run “muse-spark-code-acp auth clear” (Model API) or “muse logout” (Muse Code) in a terminal, then check again.',
  gitNothingToCommit: 'There is nothing to commit.',
  gitNothingStaged:
    'Nothing is staged. Tick “Include unstaged changes and new files”, or stage some first.',
  gitCommitMessageEmpty: 'Write a commit message first.',
  gitCredentialMasked:
    'A credential-shaped string in the text was masked. Check the text, then send it again.',
  gitCommitFailed: 'The commit failed',
  gitCommitted: 'Committed “{subject}” on {branch}',
  gitPushDetached: 'HEAD is detached: create a branch first.',
  gitPushUnsafeName:
    'This branch’s name would change what git pushes (it starts with + or -, or holds : or a space), so it is not pushed.',
  gitPushBehind: 'This branch is behind its upstream. Pull first: Muse Spark never force-pushes.',
  gitPushUpToDate: 'The branch is up to date with its upstream: there is nothing to push.',
  gitPushNoRemote: 'This repository has no remote to push to.',
  gitPushDeclined: 'Nothing was pushed.',
  gitPushFailed: 'The push failed',
  gitPushed: 'Pushed {branch} to {remote}',
  gitPushConfirm: 'Push {branch} to {remote}?',
  gitPushRemoteLine: 'Remote: {remote} ({url})',
  gitPushNoUrl: 'no URL known',
  gitPushBranchLine: 'Branch: {branch} → {target}',
  gitPushFirstPush: 'A first push: the branch is created there and tracked from now on.',
  gitPushCommits: forms({ one: '{count} commit goes up.', other: '{count} commits go up.' }),
  gitPushNeverForce: 'Never a force push: a branch that has diverged is refused.',
  gitPushAction: 'Push',
  gitPickRemoteTitle: 'Push to which remote?',
  gitPickRemotePlaceholder: 'This branch has no upstream yet',
  gitHubOnly: 'Pull requests open on github.com only, and the remote “{remote}” is not there.',
  gitHubSignInDeclined: 'GitHub sign-in was not given, so nothing was sent to GitHub.',
  gitHubFailed: 'The GitHub request failed',
  gitHubAnswered: 'GitHub answered {status}',
  gitHubResponseInvalid: 'GitHub returned a response in an unexpected format.',
  gitHubCommitInvalid: 'Not a commit ID: {sha}',
  gitDestinationBaseUnavailable:
    'The destination repository’s base branch could not be found. Add its fetch remote and fetch the base, then try again.',
  gitPullRequestExists:
    'Pull request #{number} is already open for this branch; it is now linked to this conversation.',
  gitPullRequestOpened: 'Opened pull request #{number}: {url}',
  gitDraftPullRequestOpened: 'Opened draft pull request #{number}: {url}',
  gitTitleEmpty: 'Give the pull request a title.',
  gitTextTooLong: 'The title or the description is longer than GitHub accepts.',
  gitBaseInvalid: 'That base branch name would not mean only itself to git.',
  gitBranchChanged: 'The branch changed since the form opened. Open the form again.',
  gitOpenPullRequestFirst: 'Open the pull request form first, so the draft knows its branches.',
  gitDraftFailed: 'No draft came back; the form is as it was.',
  gitAskCommitMessage: 'Write a commit message for my changes.',
  gitAskPullRequest: 'Write the title and description of a pull request for this branch.',
  gitCommitFormLabel: 'Commit',
  gitCommitTitle: 'Commit',
  gitOnBranch: 'on {branch}',
  gitChangeCounts: '{staged}, {unstaged}',
  gitStagedCount: forms({ one: '{count} staged', other: '{count} staged' }),
  gitUnstagedCount: forms({ one: '{count} not staged', other: '{count} not staged' }),
  gitFileStaged: 'Staged',
  gitFileUnstaged: 'Not Staged',
  gitMoreFiles: forms({ one: 'and {count} more file', other: 'and {count} more files' }),
  gitMessageLabel: 'Commit Message',
  gitIncludeUnstaged: 'Include Unstaged Changes and New Files',
  gitGenerate: 'Write With Muse',
  gitGenerateTitle: 'Asks the model in this conversation, as your own message',
  gitGenerating: 'Writing…',
  gitCommitAction: 'Commit',
  gitCommitConfirm: 'Commit these changes?',
  gitOperationChanged: 'Repository, conversation or trust changed. Open the form again.',
  gitMachineBusy: 'Git could not run because the machine is busy. Try again.',
  gitResourceUnavailable:
    'Git could not run because resource admission or the process helper is unavailable.',
  gitMemoryLimit: 'Git was stopped because its process tree reached the memory limit.',
  gitCommandConsequences:
    'Git may run repository hooks, signing programs or credential helpers. Cancellation stops later steps; a Git or GitHub call already started may finish.',
  gitCommitting: 'Committing…',
  gitCancel: 'Cancel',
  gitPullRequestFormLabel: 'Pull Request',
  gitPrTitle: 'Pull Request on {repository}',
  gitPrRemote: 'Remote',
  gitPrHead: 'Branch',
  gitPrBase: 'Into',
  gitPrTitleLabel: 'Title',
  gitPrBodyLabel: 'Description',
  gitPrDraft: 'Open as a Draft',
  gitPrMasked: 'Credential-shaped text is masked before anything is sent.',
  gitPrCreate: 'Create Pull Request',
  gitPrCreateDraft: 'Create Draft Pull Request',
  gitPrPushFirst: 'The branch goes to {remote} first, a first push; you will be asked.',
  gitPrPushCommits: forms({
    one: '{count} commit goes to {remote} first; you will be asked.',
    other: '{count} commits go to {remote} first; you will be asked.',
  }),
  gitPrBehind: 'The branch is behind its upstream: the pull request shows what is already pushed.',
  gitPullRequestLabel: 'This Conversation’s Pull Request',
  gitPullRequestName: '#{number} {title}',
  gitStateOpen: 'Open',
  gitStateDraft: 'Draft',
  gitStateMerged: 'Merged',
  gitStateClosed: 'Closed',
  gitChecksLine: 'Checks: {checks}',
  gitChecksNone: 'none reported',
  gitChecksPassed: forms({ one: '{count} passed', other: '{count} passed' }),
  gitChecksFailed: forms({ one: '{count} failed', other: '{count} failed' }),
  gitChecksRunning: forms({ one: '{count} running', other: '{count} running' }),
  gitChecksSkipped: forms({ one: '{count} skipped', other: '{count} skipped' }),
  gitChecksCancelled: forms({ one: '{count} cancelled', other: '{count} cancelled' }),

  gitStatusNeedsSignIn: 'Sign in to GitHub to see its status.',
  gitCheckedAt: 'as of {time}',
  gitSignInGitHub: 'Sign In to GitHub',
  // M123 (PLAN.md D104 §2): the panel's GitHub card.
  gitHubCardLabel: 'GitHub sign-in',
  // {url}: GitHub's https://github.com/login/device.
  gitHubCardCode: 'Open {url} and enter this code:',
  // {time}: when the code expires, in the user's locale.
  gitHubCardExpires: 'The code expires at {time}.',
  gitHubCopyCode: 'Copy Code',
  gitHubOpenPage: 'Open GitHub',
  // {login}: the GitHub account; {source}: one of gitHubSources.
  gitHubAccount: 'GitHub: {login}, through {source}',
  gitHubAccountNoLogin: 'GitHub: signed in through {source}',
  gitHubSources: {
    editorLease: 'the editor’s GitHub sign-in',
    deviceFlow: 'Muse Spark’s GitHub sign-in',
    ghLogin: 'the GitHub CLI (gh)',
  },
  gitHubSignOut: 'Sign Out',
  gitHubSignOutFailed: 'GitHub sign-out could not finish. Try again.',
  gitRefresh: 'Refresh',
  gitOpenOnGitHub: 'Open on GitHub',
  gitWorktreeBranch: 'Worktree on {branch}, of {repository}',
  gitWorktreePullRequest: 'Worktree of pull request #{number}, of {repository}',
  worktreeHoldLabel: 'Held Pull Request Worktree',
  worktreeHoldTitle: 'Someone else’s code: held until you trust it',
  worktreeHoldPullRequest: 'Pull request #{number} by {author}: held until you trust it',
  worktreeHoldDetail:
    'This conversation stays in Plan mode, and this worktree’s project rules, skills, hooks and MCP servers stay off, until you trust the worktree here. VS Code’s own trust does not change that.',
  worktreeHoldRestricted:
    'VS Code also opened this folder in Restricted Mode, which applies as well.',
  worktreeHoldOtherExtensions:
    'Other extensions follow VS Code’s own workspace trust, which Muse Spark cannot lower.',
  worktreeTrustButton: 'Trust This Worktree…',
  worktreeTrustConfirm: 'Trust the code in this worktree?',
  worktreeTrustPullRequest: 'Pull request #{number} by {author}.',
  worktreeTrustDetail:
    'Muse Spark will load this worktree’s project rules, skills, hooks and MCP servers, and the conversation may leave Plan mode. Its code can then run through the agent’s tools, asking as the mode says.',
  worktreeTrustOtherExtensions: 'Other extensions follow VS Code’s own workspace trust.',
  worktreeTrustAction: 'Trust',
  worktreeHeldPlanOnly:
    'This window is held on someone else’s pull request: the conversation stays in Plan mode until you trust the worktree in the card.',
  worktreeHeldShell:
    'Held until you trust this worktree in the card: no command runs here before that.',
  openPullRequestTitle: 'Open a Pull Request in a Conversation',
  openPullRequestPlaceholder: 'A number, like 51, or the pull request’s GitHub address',
  openPullRequestInvalid: 'Type a pull request number, or its github.com address.',
  openPullRequestNoRemote:
    'There is no GitHub remote to read the pull request from (upstream, the tracked one, origin, or the only one).',
  openPullRequestOtherRepository: 'No remote of this repository points at {repository}.',
  openPullRequestConfirm: 'Open pull request #{number} in a new window?',
  openPullRequestBy: 'By {author}',
  openPullRequestBranches: 'From {head} into {base}',
  openPullRequestRepository: 'Repository: {repository}',
  openPullRequestOwnDetail:
    'Your own pull request: checked out at its head commit in a worktree beside the repository.',
  openPullRequestHeldDetail:
    'Someone else wrote it: it is checked out under Muse Spark’s own storage, and the new window holds the conversation in Plan mode, with this worktree’s project rules, skills, hooks and MCP servers off, until you trust it there.',
  openPullRequestUnfilteredDetail:
    'Git does not check it out: its files are written exactly as the commit stores them, so no Git filter, hook or conversion runs. LFS files stay pointers and line endings stay as committed; links become files holding their target, and submodules empty folders. Trusting the worktree does not rewrite them.',
  openPullRequestFiltersUnavailable:
    'Safe pull request checkout cannot disable repository programs with this Git version or configuration. Git 2.36 or newer is required. Nothing was checked out.',
  openPullRequestUnsafePath:
    'The pull request has a path a held checkout does not write: {path}. Nothing was checked out.',
  openPullRequestPathCollision:
    '{first} and {second} would be the same file or folder here. Nothing was checked out.',
  openPullRequestUnreadable:
    'Git did not give back the pull request’s files as its tree lists them.',
  openPullRequestAction: 'Open',
  openPullRequestExisting:
    'Pull request #{number} is already checked out. Open it, at the commit it was checked out at?',
  openPullRequestFetchFailed: 'The pull request could not be fetched',
  openPullRequestOpened: 'Pull request #{number} opened in a new window.',
  openPullRequestOpenedHeld:
    'Pull request #{number} opened in a new window, held until you trust it there.',
  compactItem: '/compact',
  compactDetail: 'Summarise older context to free the context window',
  clearItem: '/clear',
  logoutItem: '/logout',
  openLog: 'Open Output Log',
  // M113 / D93: regional report table until M102 supplies separate families.
  reportShowCommand: 'Show Report…',
  reportShowItem: 'Show Report…',
  reportSlashDescription:
    'Generate a deterministic report from named sources, without a model call.',
  reportUsageAction: 'Usage Report',
  reportLabels: {
    needsYou: 'Needs You',
    releases: 'Releases',
    milestones: 'Milestones',
    lanes: 'Lanes',
    pullRequests: 'Pull Requests',
    ci: 'Continuous Integration',
    usage: 'Usage',
    risks: 'Risks',
    nextSteps: 'Next Steps',
    status: 'Status',
    date: 'Date',
    goal: 'Goal',
    dependencies: 'Dependencies',
    certification: 'Certification',
    gates: 'Gates',
    residuals: 'Residuals',
    questions: 'Questions',
    changelog: 'Changelog',
    tag: 'Tag',
    channels: 'Channels',
    releaseRecord: 'Release Record',
    totals: 'Totals',
    breakdown: 'Breakdown',
    limits: 'Limits',
    model: 'Model',
    backend: 'Backend',
    turns: 'Turns',
    tokens: 'Tokens',
    inputTokens: 'Input Tokens',
    outputTokens: 'Output Tokens',
    cachedTokens: 'Cached Tokens',
    cost: 'Cost',
    tools: 'Tools',
    files: 'Files',
    approvals: 'Approvals',
    checks: 'Checks',
    paidUses: 'Paid Uses',
    commits: 'Commits',
    agents: 'Agents',
    workers: 'Workers',
    devices: 'Devices',
    nodes: 'Nodes',
    vault: 'Vault',
    grants: 'Grants',
    denials: 'Denials',
    locks: 'Locks',
    developerAudit: 'Developer Audit',
    accounts: 'Accounts',
    swaps: 'Swaps',
    confirmations: 'Confirmations',
    criticalPath: 'Critical Path',
    limitingResource: 'Limiting Resource',
    setups: 'Setups',
    inputs: 'Inputs',
    calibration: 'Calibration',
    decisions: 'Decisions',
    drills: 'Drills',
    disabledRules: 'Disabled Rules',
    refusals: 'Refusals',
    issues: 'Issues',
    timeline: 'Timeline',
    schedules: 'Schedules',
    fires: 'Fires',
    keybindings: 'Key Bindings',
    conflicts: 'Conflicts',
    shortcut: 'Shortcut',
    command: 'Command',
    diff: 'Difference',
    sources: 'Sources',
    planFormat: 'Plan Format',
    name: 'Name',
    scope: 'Scope',
    version: 'Version',
    commit: 'Commit',
    branch: 'Branch',
    outcome: 'Outcome',
    duration: 'Duration',
    count: 'Count',
    provider: 'Provider',
    kind: 'Kind',
    tool: 'Tool',
    session: 'Session',
    client: 'Client',
    account: 'Account',
    certainty: 'Certainty',
    reported: 'Reported',
    estimated: 'Estimated',
    unknown: 'Unknown',
    freshness: 'Freshness',
    observedAt: 'Observed At',
    reason: 'Reason',
    ok: 'Available',
    partial: 'Partial',
    unavailable: 'Unavailable',
    notApplicable: 'Not Applicable',
    fresh: 'Fresh',
    stale: 'Stale',
    current: 'Current',
    lagging: 'Lagging',
    planned: 'Planned',
    building: 'Building',
    built: 'Built',
    certified: 'Certified',
    merged: 'Merged',
    released: 'Released',
    complete: 'Complete',
    ended: 'Ended',
    superseded: 'Superseded',
    waiting: 'Waiting',
    blocked: 'Blocked',
    inReview: 'In Review',
    inProgress: 'In Progress',
    passed: 'Passed',
    failed: 'Failed',
    running: 'Running',
    skipped: 'Skipped',
    cancelled: 'Cancelled',
    answered: 'Answered',
    open: 'Open',
    dismissed: 'Dismissed',
    added: 'Added',
    removed: 'Removed',
    changed: 'Changed',
    unchanged: 'Unchanged',
    paused: 'Paused',
    active: 'Active',
    all: 'All',
    total: 'Total',
    once: 'Once',
    user: 'User',
    hookVerification: 'Hook verification',
  },
  reportScheduleCells: {
    triggerInterval: 'every {everyMs} ms',
    triggerDaily: 'every {everyDays}d {times}x daily',
    triggerWeekdays: '{times}x on weekdays',
    triggerWeekly: '{days}d weekly',
    scheduleGrant: '{rules} rules, {destinations} destinations, cap {cap}',
  },
  reportKinds: {
    project: 'Project',
    milestone: 'Milestones',
    release: 'Releases',
    usage: 'Usage',
    session: 'Session',
    changes: 'Changelog',
    quality: 'Quality',
    fleet: 'Fleet',
    security: 'Security',
    accounts: 'Accounts',
    estimate: 'Estimate',
    playbook: 'Engineering Playbook',
    issues: 'Issues',
    schedules: 'Schedules',
    keybindings: 'Key Bindings',
  },
  reportUi: {
    invalidArguments: 'Invalid report arguments. Choose a report kind and its scope.',
    problem: 'Report a Problem…',
    scope: 'Enter the milestone id or release version.',
    historyRequired: 'Save this report in history before comparing it.',
    format: 'Format',
    show: 'Show Report…',
    description: 'Generate a deterministic report from named sources, without a model call.',
    usageAction: 'Usage Report',
    title: 'Reports',
    saveAs: 'Save As…',
    copyMarkdown: 'Copy as Markdown',
    attach: 'Attach to Message',
    history: 'History',
    diffPrevious: 'Diff With Previous',
    refresh: 'Refresh',
    noChange: 'No change since {asOf}',
    unavailableReason: 'Unavailable: {reason}',
    rateLimitedUntil: 'Rate-limited until {time}',
    sourceFile: 'Source: {file}',
    lastReport: 'Last report: {age}',
    footer: 'Renderer {version}; ICU {icu}; locale {locale}',
    notFound: 'Not found: {id}. Nearest matches: {nearest}',
    generationFailed: 'The report could not be generated.',
    gitXcodeStub:
      'Git cannot run on this Mac: it resolves to Apple’s Xcode stub, whose developer tools cannot start. Install the Command Line Tools (xcode-select --install), or switch to the installed tools (sudo xcode-select --switch /Library/Developer/CommandLineTools), then try again.',
    noHistory: 'No report history yet.',
    networkOff: 'Report network sources are off.',
    signInRequired: 'Sign in to GitHub to read this source.',
    noPlan: 'This project has no structured plan.',
    noCustomKeybindings: 'There are no custom keybindings.',
    noCheckRuns: 'No check runs have been recorded yet.',
    planDrift: 'Plan format at line {line}: {detail}',
    automatedNote: 'This report was generated automatically.',
    post: 'Post',
    previewPost: 'Preview the full report before posting.',
    reportAction: 'Action: Report',
    verificationMessage: 'Your report email verification code is {code}.',
    nameTemplate: 'File Name Template',
    retention: 'Reports to Keep',
    verifyRecipient: 'Verify Recipient',
    saveDestination: 'Save to Folder',
    browserDestination: 'Open in Browser',
    emailDestination: 'Email to You',
    openWhenBack: 'Open When I’m Back',
    recipientUnverified: 'Verify this recipient before sending.',
    tlsRequired: 'Email requires TLS with a valid certificate.',
    deliveryLimit: 'The delivery limit has been reached.',
    saved: 'Report saved to {path}',
    copied: 'Report copied.',
    attached: 'Report attached to the message.',
    saveFailed: 'The report could not be saved.',
    copyFailed: 'The report could not be copied.',
    unsupportedKind: 'Report kind {kind} is unavailable.',
    localBudgetExceeded: 'The local report exceeded {duration}.',
    confirmFirstSend: 'Confirm the first email to this recipient.',
    destinations: 'Destinations',
    recipient: 'Recipient',
    verifyCode: 'Verification Code',
    allowList: 'Recipient Allow-List',
    schedule: 'Schedule Report…',
    cloud: 'Save to Cloud',
    sms: 'Text Message',
    privateLink: 'Private Link',
    paidSms: 'Text messages cost {price} each. Shared daily budget: {budget}.',
    generatedAsOf: 'Generated as of {asOf}',
  },
  reportSourceReasons: {
    missing: 'The source file or repository is missing.',
    invalid: 'The source has an unsupported format or invalid data.',
    limit: 'The source exceeds the report read limit.',
    cancelled: 'The source read was cancelled.',
    failed: 'The source could not be read completely.',
    refused: 'The source path is private or outside its allowed folder.',
    disabled: 'This agent usage source is not enabled.',
    unbound: 'This source integration is unavailable.',
    history: 'History for the selected session is unavailable.',
  },
  reportDetailReasons: {
    journalIncomplete:
      'The usage journal contains damaged, incomplete or newer-version entries; totals exclude them.',
    sessionUsageUnavailable:
      'Usage for this session is not attributable in the retained journal; token and cost totals are unavailable.',
    budgetsUnavailable: 'Budget snapshots for the selected period are unavailable.',
    sessionModelUnavailable:
      'The session catalogue names no active model, so the model is reported as unknown.',

    sessionTurnsUnavailable:
      'The session history records no turn identifiers, so turns cannot be counted.',
    sessionApprovalsUnavailable: 'The session history records no approval decisions.',
    toolBreakdownUnavailable: 'Per-tool usage is not recorded in the usage journal.',
    rolledUpBreakdownExcluded: 'Rolled-up history is included in totals but not in this breakdown.',
    rolledUpSessionExcluded:
      'Rolled-up history is excluded from this session’s totals and breakdown.',
    accountsFacetsUnavailable: 'Unavailable account details: {facets}.',
    securityVaultUnavailable: 'The vault is locked or unavailable.',
    securityDeveloperAuditUnavailable: 'The developer audit is unavailable.',
  },
  reportRowsMore: forms({ one: '{count} more', other: '{count} more' }),
  reportProblemsMore: forms({ one: '{count} more problem', other: '{count} more problems' }),
  checkRunsUnreadable: forms({
    one: '{count} check run could not be read.',
    other: '{count} check runs could not be read.',
  }),
  reportCliUsage:
    'Generate a deterministic report from named sources, without a model call.\n  {command} report <kind> [args] [--format md|html|json|text] [--out <file>]\n  [--as-of <ISO>] [--lang <locale>] [--network] [--from <file.json>]\n  [--diff previous|<file.json>] [--full] [--strict] [--fail-on <conditions>]\n  {command} report history\n  {command} report problem\n',
  reportCliKinds:
    'Kinds: project, milestone <id>, release <version|latest>, changes [since <ref>], quality, usage [period], session, keybindings, accounts, security, estimate <milestone>, playbook, schedules.\n',
  reportIssue: 'Report an Issue…',
  // Report a problem (M93, PLAN.md D72): the crash offer, the report
  // dialog's labels and actions, and the export outcomes. The preview shows
  // exactly what Copy, Save and the issue page carry.
  reportCrashOffer: 'Muse Spark Code stopped unexpectedly last time — report it?',
  reportCrashAction: 'Report a Problem',
  reportCrashDismiss: 'Not Now',
  reportThisAction: 'Report This',
  reportTitle: 'Report a Problem',
  reportDescriptionLabel: 'What were you doing when it happened?',
  reportIncludeFacts: 'Include Support Facts',
  reportIncludeEvents: 'Include Recent Events',
  reportPreviewLabel: 'Preview',
  reportCopyAction: 'Copy Report',
  reportOpenIssueAction: 'Open Issue Page',
  reportSaveAction: 'Save to a File',
  reportVscodeReporterAction: 'Use the VS Code Issue Reporter',
  reportCancelAction: 'Cancel',
  reportCopied: 'The report was copied to the clipboard.',
  reportCopyFailed: 'The report could not be copied. Copy it from the preview instead.',
  reportSaved: 'The report was saved.',
  reportSaveFailed: 'The report could not be saved.',
  reportBuildFailed: 'The report could not be built.',
  reportUrlTooLong:
    'The report is too long to open in a browser address. Copy it instead, then paste it into the new-issue form.',
  reportRecordingUnavailable:
    'Event recording was unavailable, so this report has no recent events.',
  reportDescriptionWarning:
    'Review the scrubbed preview before sharing. Your description can still disclose confidential information; do not include passwords or keys.',
  reportVscodeReporterNote:
    'The VS Code issue reporter adds its own data, may search GitHub for similar issues, and controls sign-in and submission.',
  // Report a problem (M93 lane W): the preview dialog's item list, its
  // export outcomes and its updating state. Item labels stay identifiers
  // (an event kind, a relative age), so the preview matches the export.
  reportItemsLabel: 'What This Report Contains',
  reportRemoveItem: 'Remove {item}',
  reportFactsItem: 'Support Facts',
  reportEventItem: '{kind} · {age}',
  reportUpdating: 'Updating the preview…',
  reportStaleDraft:
    'The report changed while exporting. The preview below is current — export again.',
  reportIssueOpened: 'The issue page was opened in the browser.',
  reportIssueOpenFailed: 'The issue page could not be opened. Copy the report instead.',
  reportVscodeReporterOpened: 'The VS Code issue reporter was opened.',
  reportVscodeReporterFailed: 'The VS Code issue reporter could not be opened.',
  openDocs: 'Muse Code Documentation',
  modelListLabel: 'Models',
  thinkingOff: 'No Thinking',
  // @-mention menu and attachments.
  mentionMenuLabel: 'Files',
  mentionNoMatches: 'No matching files',
  actionFailed: 'That did not work (the Muse Spark log has the details)',
  slashNoMatches: 'No matching commands; Enter sends the text as it is',
  attachmentsLabel: 'Attachments',
  removeAttachment: 'Remove',
  modelAttachmentUnsupported: 'This model does not support this attachment.',
  providerCapabilityUnsupported: 'Selected model does not support these request settings.',
  modelAttachmentOverLimit: "This attachment exceeds the model's limits.",
  attachmentUnsupported: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  attachmentUnreadable: 'The file could not be read.',
  documentsOverBudget: 'Files must total at most 50 images and PDF pages per message.',
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
  toolEditInvalid: 'Use a nonempty find/replace pair or a nonempty edits list, never both.',
  toolEditNoChange: 'Find and replace are identical; nothing would change.',
  toolEditNotFound: 'Find text was not found in {path}.',
  toolEditAmbiguous: 'Find text occurs more than once in {path}; include more context.',
  toolEditOverlap: 'Edits overlap; no two entries may change the same text.',
  toolReadPastEnd: 'Offset {offset} is beyond the end of {path}.',
  toolReadText: 'Read text file `{path}`.',
  toolReadRange: 'Lines {start}–{end} of {total}; offset={offset}',
  incompleteToolCallsNotRun: 'The model reply was cut short. No tool calls were run; please retry.',
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
  webFetchRedirectWithoutLocation: 'The server answered {status} without saying where to go.',
  webFetchRedirectRefused: 'The page redirected to an address that is refused: {reason}',
  webFetchHttpStatus: 'The server answered {status}.',
  webFetchTooLarge: 'The page is larger than {size}.',
  webFetchNoContentType: 'The server did not say what the page contains.',
  webFetchContentType: 'The page is {type}, not HTML or text.',
  webFetchContentTypeUnnamed: 'The page is not HTML or text.',
  webFetchEncoding: 'The page’s compression ({encoding}) could not be read.',
  webFetchEncodingUnnamed: 'The page’s compression could not be read.',
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
  // M81 (PLAN.md D49): the browser check. Before each check Muse Code asks
  // the extension for; the second sentence when the host is beyond loopback.
  browserCheckConfirmTitle: 'Muse Code wants to open {url} in a headless browser',
  browserCheckConfirmDetail:
    'The page loads in a fresh private browser profile that is deleted afterwards. All its traffic goes through the extension’s own proxy, which lets through only plain http to this computer and the hosts in museSpark.browserCheckExtraHosts.',
  browserCheckConfirmDetailWiden:
    '{host} is not this computer. Allowing lets this one check reach it, over https and WebSockets too. That traffic is encrypted, so the extension cannot inspect it, and a site there may sign in as you with this computer’s account (on Windows in particular).',
  // M81 A1: the question before the browser check's runtime is downloaded,
  // the Download command's progress and outcome.
  browserRuntimeConsentTitle: 'Download the browser for browser checks ({size})?',
  browserRuntimeConsentDetail:
    'Muse Spark Code will download Google’s Chrome for Testing headless shell {version} ({size}) from storage.googleapis.com and keep it in {location}. It is used only for browser checks, and each new version an extension update pins is downloaded again. Set museSpark.browserCheckRuntime to download to stop asking, or to off to turn the browser check off.',
  browserRuntimeDownload: 'Download',
  browserRuntimeNotNow: 'Not Now',
  browserRuntimePreparing: 'Getting the browser check’s browser ready…',
  browserRuntimeReady: 'The browser check’s browser {version} is ready.',
  // The Model API row: what the check found, then each entry under its count.
  browserCheckDone: 'Checked {url}: {errors}, {failed}, {blocked}',
  browserCheckConsoleErrors: forms({
    one: '{count} console error',
    other: '{count} console errors',
  }),
  browserCheckFailedRequests: forms({
    one: '{count} failed request',
    other: '{count} failed requests',
  }),
  browserCheckBlockedRequests: forms({
    one: '{count} request blocked beyond this computer',
    other: '{count} requests blocked beyond this computer',
  }),
  // Why a check did not happen or did not finish.
  browserCheckUrlRefused:
    'Only an http:// or https:// address with a plain host name or IP address, and no user name or password, can be opened.',
  browserCheckInvalidArguments:
    'The browser check was asked for with arguments that are not valid, so nothing was opened.',
  // The runtime's preparation (M81 A1): why no verified browser was ready.
  browserCheckRuntimeMissing:
    'The browser check’s browser is not installed and could not be downloaded now. Check the connection and try again.',
  browserCheckRuntimeUnsupported:
    'The browser check is not available on this computer. It supports Windows x64, Linux x64/ARM64 and macOS.',
  browserCheckRuntimeOutdated:
    'The browser check’s browser is more than 45 days old. Update Muse Spark Code to use the browser check again.',
  browserCheckRuntimeIntegrity:
    'The browser check’s browser does not match the version this extension pins, so it was not started.',
  browserCheckRuntimeBlocked:
    'This computer did not allow the browser check’s browser to run (application control or code signing).',
  browserCheckRuntimeDeclined:
    'The browser check’s browser was not downloaded, so nothing was opened.',
  browserCheckPreparationTimedOut:
    'Getting the browser check’s browser ready took longer than {duration}, so it stopped.',
  browserCheckScopeChanged:
    'The hosts the browser check may reach changed while it was getting ready, so nothing was opened. Ask again to check with the new hosts.',
  browserCheckNotOffered:
    'The browser check is no longer available here (workspace trust, the permission mode, the network setting or the runtime setting changed), so nothing was opened.',
  // Its confinement: nothing from the page is shown after any of these.
  browserCheckLaunch: 'The browser check’s browser could not be started.',
  browserCheckSystemDirectoryUnavailable:
    'The Windows system directory is unavailable; set SystemRoot to its actual path.',
  browserCheckUnrecognized:
    'The browser check stopped: the browser did not match the exact version and setup it expects.',
  browserCheckProfile:
    'The browser check stopped: it could not set up a fresh private browser profile.',
  browserCheckRouteUnconfirmed:
    'The browser check stopped: it could not confirm that the page’s traffic goes only through its own proxy.',
  browserCheckResolverUnconfirmed:
    'The browser check stopped: it could not confirm that the browser looks up no host names itself.',
  browserCheckSignIn:
    'The browser check stopped: in its own test, a sign-in challenge or credential got past its proxy.',
  browserCheckWebrtc:
    'The browser check stopped: it could not confirm that WebRTC stays inside its proxy.',
  browserCheckTransport:
    'The browser check stopped: it could not confirm that WebTransport is refused.',
  browserCheckUnverifiable:
    'The browser check stopped: it could not run one of its own confinement tests on this computer (for example, it found no network address to test against).',
  browserCheckUnwatchable:
    'The browser check stopped: the page started a frame or worker it could not watch.',
  browserCheckAuditFailed:
    'The browser check discarded the page’s results: its tests after the page ran did not pass.',
  browserCheckRestartObserved:
    'The browser check discarded the page’s results: the browser’s network service restarted during the check.',
  // The page run.
  browserCheckBrowserFailed: 'The browser stopped responding during the check.',
  browserCheckPageFailed: 'The page did not load ({error}).',
  browserCheckPageFailedUnknown: 'The page did not load.',
  browserCheckPageBlocked:
    'The page did not load: it went to an address beyond this computer, which the browser check blocks.',
  browserCheckTimedOut: 'The browser check did not finish within {duration}.',
  browserCheckNoElement: 'No element on the page matches {selector}, or it takes no text.',
  browserCheckLeaked:
    'The page reached, or tried to reach, beyond this computer in a way the check cannot block, so the browser check was stopped and returned nothing.',
  browserCheckRestrictedMode:
    'The browser check is off in Restricted Mode. Trust the workspace to use it.',
  // Observation packing (M73): a recall_output row's heading above the
  // recalled text (shown as it was), and why a recall read nothing back.
  packRecalled: 'Recalled characters {start} to {end} of {total} from packed output {id}',
  packRecallNotFound: 'No literal match in packed output {id} from character {offset}.',
  promptCacheMiss: 'Prompt cache missed {tokens} reusable input tokens.',
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
  showMore: 'Show More',
  showLess: 'Show Less',
  loadingOutput: 'Loading…',
  surfaceLoadFailed: 'This panel could not load.',
  surfaceLoadRetry: 'Try Again',
  moneyLoadFailed: 'Prices could not load.',
  toolFailed: 'Failed',
  toolRejected: 'Rejected',
  // M46: a task the user (or Stop) ended.
  toolStopped: 'Stopped',
  copyCode: 'Copy',
  copiedCode: 'Copied',
  insertCode: 'Insert at Cursor',
  // {action} is the command, path or tool the card is about, shown as code.
  approvalAction: 'Muse wants to {action}',
  /** A bare tool name (subject kind "tool", e.g. subagent_spawn), M18. */
  approvalUseTool: 'Muse wants to use {action}',
  /** A web fetch on the Model API backend (M69): {action} is the URL, shown as code. */
  approvalFetch: 'Muse wants to fetch {action}',
  /**
  A browser check on the Model API backend (M81): {action} is the URL. The
  second when its host is beyond loopback and the setting: allowing it
  widens the check to that host.
  */
  approvalBrowserCheck: 'Muse wants to open {action} in a headless browser',
  approvalBrowserCheckWiden:
    'Muse wants to open {action} in a headless browser, beyond this computer',
  // M81 A1: what widening a host also allows, shown under that card.
  approvalBrowserCheckWidenResidual:
    'Allowing also lets this check reach the host over https and WebSockets. That traffic is encrypted, so the extension cannot inspect it, and a site there may sign in as you with this computer’s account (on Windows in particular).',
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
  approvalProtectedWrite: 'Protected Write',
  approvalJudgeEscalated: 'Escalated by the Safety Check',
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
  questionExplain: 'Explain Instead',
  questionExplainTitle:
    'Answer in your own words instead of choosing; Muse reads it and decides again',
  questionExplainLabel: 'Your Explanation',
  questionExplainPlaceholder: 'Say what you mean instead of choosing…',
  questionSendExplanation: 'Send Explanation',
  questionBackToChoices: 'Back to the Choices',
  questionClarified: 'Explained',
  // M112: the attention dock, durable open questions and late answers.
  questionOpen: 'Open Question',
  questionNoLongerOpen: 'No Longer Open',
  questionDeferred: 'Deferred',
  questionAnsweredLater: 'Answered Later',
  questionAnsweredOnReask: 'Answered When Asked Again',
  questionDeclined: 'Declined',
  questionDismissed: 'Dismissed',
  questionExpired: 'Expired',
  questionsExpiredNotice: forms({
    one: 'One older question expired unanswered: only the newest {max} questions stay open. Its text is kept on its card.',
    other:
      '{count} older questions expired unanswered: only the newest {max} questions stay open. Their text is kept on their cards.',
  }),
  questionAnswer: 'Answer',
  questionDismiss: 'Dismiss',
  questionExpand: 'Expand Question',
  questionCollapse: 'Collapse Question',
  questionNextOpen: 'Next Open Question',
  questionPreviousOpen: 'Previous Open Question',
  questionCountdown: 'Muse keeps working in {seconds} s if you don’t answer',
  questionLateAnswerDisplay: 'Answer to your earlier question: {header}',
  announceQuestionDeferred: 'Moved to open questions; you can answer any time',
  announceQuestionReminder: 'You still have an open question: {header}',
  announceLateAnswerSent: 'Your answer to the earlier question was sent',
  notifyOpenQuestions: 'Muse has open questions you can answer at any time.',
  questionNoOpen: 'No open questions.',
  questionAnswerFailed: 'Your answer could not be sent. Try again.',
  questionAnswerUncertain: 'Your answer may have reached Muse. It will not be sent again.',
  questionQueueLeaseFailed:
    'Queued-answer ownership changed. Retry after the current prompt finishes.',
  questionQueueCommitFailed:
    'The prompt was sent, but its answers could not be saved as delivered. They remain queued and may be repeated.',
  questionDismissFailed: 'The question could not be dismissed.',
  acpOpenQuestionAsked:
    'Muse has a question; this editor cannot show a form. You can answer later with /answer.',
  acpQuestionDeferred: 'Question {number} is open. Answer with /answer {number} <text>.',
  acpQuestionListEntry: 'Question {number}: {header} — {question}',
  acpQuestionAnswerUsage: 'Usage: /answer <n> <text>',
  acpQuestionNotFound: 'No open question has number {number}.',
  acpQuestionAnswerQueued: 'Your answer will reach Muse with your next message.',
  acpAnswerHelp: 'Answer an earlier open question: /answer <n> <text>',
  acpQuestionsHelp: 'List the open questions in this conversation.',
  openQuestionsCount: forms({ one: '{count} open question', other: '{count} open questions' }),
  openQuestionsTabCount: forms({ one: '{count} Open', other: '{count} Open' }),
  clarifyNotAccepted: 'The explanation was not accepted',
  /** Replying to an output and quoting a highlighted passage (M17). */
  messageActions: 'Message Actions',
  rowMoreActions: 'More Actions',
  rowRewindGroup: 'Rewind',
  rowOpenOutput: 'Open Output',
  // An edit row's Revert (M87, D66 item 17): its label, and the confirmation before it writes.
  rowRevertEdit: 'Revert',
  revertEditConfirmTitle: 'Revert this edit?',
  revertEditConfirmDetail:
    'The lines this edit changed are put back as they were. A file where those lines changed since is left as it is and named. Later edits, and what commands changed, are not undone.',
  replyToOutput: 'Reply to This Output',
  // Tokens and the dollar estimate under a Model API reply (M82).
  replyUsage: '{input} in · {output} out · estimated {cost}',
  quoteMenuLabel: 'Highlighted Text',
  askAboutThis: 'Ask About This',
  commentOnThis: 'Comment on This',
  referenceReply: 'Replying To',
  referenceQuestion: 'Asking About',
  referenceComment: 'Commenting On',
  referenceRemove: 'Remove',
  referenceTitle: 'Goes to the agent with your message as context',
  todoTitle: 'Tasks',
  todoProgress: '{done} of {total} done',
  todoOpenInTab: 'Open in a Tab',
  todoOpenInTabTitle: 'Open the task list in an editor tab, which you can move into its own window',
  tasksTabTitle: 'Tasks: {conversation}',
  tasksTabMoveToWindow: 'Move Into New Window',
  tasksTabEmpty: 'No tasks yet.',
  tasksTabEnded: 'The conversation this list belongs to was closed.',
  stepSummary: {
    edited: forms({
      one: 'edited a file',
      other: 'edited {count} files',
    }),
    read: forms({
      one: 'read a file',
      other: 'read {count} files',
    }),
    searched: forms({
      one: 'searched a folder',
      other: 'searched {count} folders',
    }),
    ran: forms({
      one: 'ran a command',
      other: 'ran {count} commands',
    }),
    fetched: forms({
      one: 'fetched a page',
      other: 'fetched {count} pages',
    }),
    searchedWeb: forms({
      one: 'searched the web',
      other: 'searched the web {count} times',
    }),
    used: forms({
      one: 'used a tool',
      other: 'used {count} tools',
    }),
    failed: forms({
      one: '{count} failed',
      other: '{count} failed',
    }),
  },
  contextMeterLabel: 'Context {percent} used',
  contextMeterOver: 'Over the context window',
  contextMeterUnderOne: '<1',
  contextDetail: '{used} of {window} tokens · pressure {pressure}',
  noEditorForInsert: 'Open a text editor to insert code into it.',
  linkSchemeRefused: 'Only http, https and mailto links can be opened from the transcript.',
  sandboxNotice:
    'Muse Code cannot run shell commands until its Windows sandbox is set up. Run "Muse Spark: Set Up Shell Sandbox" (one administrator approval), then start a new conversation.',
  // Windows sandbox setup prompt and its outcomes (OS notifications).
  sandboxOffer:
    'Muse Code needs a one-time administrator setup before it can run shell commands on Windows (it creates the sandbox users and network filter it runs commands under). Set it up now?',
  sandboxSetUpNow: 'Set Up Now',
  sandboxNotNow: 'Not Now',
  sandboxDontAskAgain: "Don't Ask Again",
  sandboxReady: 'Muse Code sandbox is ready. Start a new conversation to run shell commands in it.',
  sandboxAlreadyReady: 'Muse Code sandbox is already set up.',
  sandboxStillRequired: 'Muse Code sandbox is still not ready',
  sandboxCancelled: 'Muse Code sandbox setup did not complete',
  sandboxExitCode: 'exit code {code}',
  sandboxNotNeeded: 'Muse Code needs no sandbox setup on this platform.',
  sandboxCliMissing: 'Muse Code is not installed, so its sandbox cannot be checked.',
  // Editor integration (M5).
  editorContextTitle: 'Shared with Muse as context; × leaves it out',
  editorContextRemove: 'Leave the Open File Out',
  editorContextLabel: 'Open File',
  linePrefix: 'L',
  openFileTitle: 'Open the file at this change',
  openFileFailed: 'Could not open the file',
  toggleDetails: 'Show or hide the details',
  applyCode: 'Apply',
  noEditorForApply: 'Open a text editor to apply code into it.',
  diffTitleSuffix: 'Muse Edit',
  diffTallyFiles: forms({
    one: '{count} file changed',
    other: '{count} files changed',
  }),
  diffTallyLines: '+{added} −{removed}',
  diffTallyLabel: 'Changes in This Conversation',
  diffTallyTitle:
    "Lines added and removed by this conversation's edits, added up edit by edit. Changes made by shell commands or by you are not counted.",
  diffTallyReview: 'Review',
  diffTallyReviewTitle: 'Open the review pane on these changes',
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
  historyWeek: 'Previous 7 Days',
  historyOlder: 'Older',
  historyShowArchived: 'Show Archived',
  historyArchive: 'Archive',
  historyUnarchive: 'Unarchive',
  historyRecap: 'Recap',
  historyRecapLoading: 'Reading the recap…',
  recapUnsupported: 'Recaps need the Muse Code backend.',
  recapFailed: 'The recap could not be read',
  sessionListsTitle: 'Session lists',
  sessionListsTasks: 'Background tasks',
  sessionListsHooks: 'Hooks',
  sessionListsPlugins: 'Plugins',
  sessionListsEmpty: 'Nothing here.',
  sessionListsDisabled: 'Off',
  sessionListsUnavailable: 'Not available on this backend.',
  sessionListsFailed: 'The session lists could not be read',
  sessionListsRefresh: 'Refresh',
  historyDeleteConfirm: 'Delete the conversation {name}?',
  historyDeleteConfirmDetail: 'It leaves History for good. This cannot be undone.',
  historyDeleted: 'Deleted {name}',
  historyDeleteFailed: 'Could not delete the conversation',
  historyDeleteCleanupFailed: 'Deleted {name}, but finishing the cleanup failed: {reason}',
  historyCurrent: 'Current',
  historyForkMark: 'Fork',
  historyTurns: forms({ one: '{count} turn', other: '{count} turns' }),
  // M88: bookmarks; read UI_TEXT at use time.
  bookmarkAdd: 'Bookmark',
  bookmarkRemove: 'Remove bookmark',
  bookmarkCurrentTitle: 'Bookmark this conversation',
  historyGroupBookmarked: 'Bookmarked',
  bookmarkedState: 'Bookmarked',
  bookmarkUnavailable: 'Not available here',
  bookmarkNoWorkspace: 'Bookmarks need an open folder.',
  bookmarksUnavailable: 'Bookmarks are unavailable.',
  sequencesUnavailable: 'Prompt sequences are unavailable.',
  referenceBookmarks:
    'Bookmark conversations from History or the header star. A bookmarked Model API session is kept past cleanup; bookmarks sync only with saved prompts sync on.',
  resumeItem: 'Resume',
  resumeDetail: 'Pick a previous conversation in this workspace',
  renameTitle: 'Rename This Conversation',
  renamePlaceholder: 'Conversation name',
  // The user card's menu (Claude Code's rewind button): fork, rewind, both.
  rewindMenuLabel: 'Fork or Rewind',
  forkFromHere: 'Fork Conversation',
  rewindConversationToHere: 'Rewind Conversation to Here',
  rewindCodeToHere: 'Rewind Code to Here',
  forkAndRewind: 'Fork and Rewind',
  rewindNothing: 'No edits after this message to rewind.',
  rewindDone: forms({
    one: 'Code rewound to this message ({count} edit)',
    other: 'Code rewound to this message ({count} edits)',
  }),
  forkedNotice: 'Forked into a new conversation.',
  rewindImagesUnavailable: 'Some images from this message could not be restored.',
  rewindBeforeCompaction: 'Cannot rewind before the latest compaction.',
  // Turn checkpoints (M86): the user card's menu, the confirmations, the result.
  restoreFilesToHere: 'Restore Files to Here',
  checkpointsModelApiOnly:
    'File restore and Redo require a connected Model API session. Only the model’s own file-tool edits are undone, while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone.',
  checkpointsLegacyReadOnly:
    'This message was recorded by an earlier version of Muse Spark. Its files cannot be restored.',
  checkpointsNativeUnsafe:
    'File restore and Redo are unavailable while a Muse Code session, or a window that does not record its edits, may still change files. Close or reload that window, then try again.',
  rewindAndRestore: 'Rewind Conversation and Restore Files',
  checkpointsRestricted: 'File checkpoints are off in Restricted Mode',
  checkpointsOff: 'File checkpoints are off in settings',
  checkpointsNoGit: 'File checkpoints need git on PATH',
  windowsPathRefused:
    "This path uses a Windows spelling the extension doesn't accept; use the normal path.",
  checkpointStorageUncertain:
    'The extension cannot verify that this path is outside checkpoint storage; tools cannot edit it.',
  windowsSystemRootMissing:
    'The Windows system directory is unavailable; set SystemRoot to its actual path.',
  conversationRewindUnavailable:
    'Rewinding the conversation is not available with Muse Code on Windows',
  restoreConfirmTitle: 'Restore the files to before this message?',
  restoreConfirmDetail:
    'Only the model’s own file-tool edits from this message on are undone, while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Files with unsaved changes are left as they are and named. Redo puts back what the restore changed.',
  restoreConfirmAction: 'Restore Files',
  rewindCodeConfirmTitle: 'Rewind the code to before this message?',
  rewindCodeConfirmDetail:
    'Muse’s recorded edits after this message are undone, newest first; a file changed since is left as it is. What commands changed is not covered, and Restore files does not undo it either: it is left as it is; check version control.',
  rewindCodeConfirmAction: 'Rewind Code',
  restoreBothConfirmTitle: 'Restore the files and rewind the conversation to before this message?',
  restoreBothConfirmDetail:
    'Only the model’s own file-tool edits from this message on are undone, while each file still holds exactly what the model left. Commands, hooks, MCP tools, your edits and other windows’ writes are never undone. Then the conversation branches before this message and its prompt returns to the composer. If a file is refused, the conversation is not rewound. The original conversation stays in History.',
  restoreBothConfirmAction: 'Restore and Rewind',
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
  usageItem: 'Account & Usage…',
  usageItemDetail: 'Subscription usage, this conversation’s tokens, the backend',
  agentsCommand: '/agents',
  agentsCommandDetail: 'Show the agent map',
  usageCommand: '/usage',
  usageCommandDetail: 'Show account usage',
  costCommand: '/cost',
  costCommandDetail: 'Show this conversation’s token totals',
  usageLabel: 'Account & Usage',
  usagePlan: 'Plan',
  usagePlanSubscription: 'Muse Code Subscription',
  usageBackend: 'Backend',
  usageWindow: 'Current Window',
  usageWeekly: 'This Week',
  usagePercentUsed: '{percent} used',
  usageResetsIn: 'resets in {duration}',
  usageAsOf: 'as of {time}',
  usageAwaitingFreshReport: 'Waiting for a fresh Muse Code usage report.',
  usageNoSubscription:
    'No subscription usage reported yet. Muse Code reports it after the first turn of a conversation.',
  usageModelApiNote:
    'This window runs on your Model API key: requests are billed to the key at pay-as-you-go rates and counted on the dev.meta.ai dashboard.',
  usageOpenDashboard: 'Open dev.meta.ai',
  usageSessionTokens: 'This Conversation',
  usageInput: 'Input',
  usageOutput: 'Output',
  usageCached: 'Cached',
  usageContext: 'Context',
  usagePackedAvoided: 'Packing Saved (Estimate)',
  // Tokens hooks added, never netted against the savings (M91, SoL-Pi rule 6).
  usageAddedByHooks: 'Added by Hooks (Estimate)',
  usageNoSession: 'No tokens counted yet in this conversation.',
  usageLoading: 'Reading usage…',
  usageUnavailable: 'Usage could not be read',
  usageClose: 'Close',
  // Onboarding tips on the empty state (M8), hidden by museSpark.hideOnboarding.
  onboardingTitle: 'Getting Started',
  onboardingHide: 'Hide These Tips',
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
  notifyShowConversation: 'Show Conversation',
  announceQuestion: 'Muse asked a question',
  announceResumed: 'Conversation resumed',
  // Voice dictation (M9).
  linuxDictationDownloadTitle:
    'Download the offline English dictation helper ({helperSize}) and model ({size})?',
  linuxDictationDownloadDetail:
    'Whisper tiny.en is free and recognizes English on this computer, using only the CPU. Download the helper from the extension release assets and the model from huggingface.co into {location}. Audio stays in memory. Turn linuxDictationModel off to stop dictation and remove the helper and model.',
  linuxDictationIntegrity:
    'The dictation helper or model failed its size or SHA-256 check. No recognition started.',
  linuxDictationBusy:
    'Another window is using the dictation helper or model. Stop its recording or download and try again.',
  linuxDictationRemoved:
    'Linux dictation is off and its helper and model are removed. Turn linuxDictationModel on and reload the window to enable it.',
  linuxDictationRemovalPending:
    'Linux dictation is off and its helper and model are being removed. Reload the window to retry removal, or turn linuxDictationModel on and reload the window to enable it.',
  linuxDictationDisabled:
    'Linux dictation is off. Turn linuxDictationModel on and reload the window to enable it.',
  linuxDictationRemoveFailed:
    'The offline dictation helper or model could not be removed. Check storage permissions and stop downloads in other windows, then reload this window to retry.',
  linuxDictationFailed: 'Linux dictation failed',
  linuxDictationDownloadFailed:
    'The dictation helper or model could not be downloaded. Press the microphone to retry; an interrupted download can resume.',
  dictationTitle: 'Tap or hold to record (Ctrl+D)',
  dictationStopTitle: 'Stop recording (Ctrl+D)',
  dictationLabel: 'Record Voice',
  dictationStarting: 'Starting the microphone…',
  dictationListening: 'Listening…',
  dictationFailed: 'Voice dictation failed',
  dictationUnavailable: 'Voice dictation is not available on this platform.',
  dictationUnavailableLinux:
    'Linux dictation needs an x64 or arm64 computer with PulseAudio or PipeWire running.',
  dictationUnavailableWindows:
    'Voice dictation needs Windows PowerShell, which was not found (SystemRoot is not set).',
  dictationUnavailableDarwin:
    'Voice dictation needs the macOS helper (native/darwin/{app}/Contents/MacOS/muse-dictate), which this build does not include.',
  // After `dictationFailed`, when voice's own code did not load (a damaged install).
  dictationNotLoaded:
    'the dictation code could not be loaded; reinstall the extension and reload the window. The log has the details.',
  announceListening: 'Listening',
  announceStoppedListening: 'Stopped listening',
  // Model API backend (M7).
  allowOnce: 'Allow Once',
  // A separate judge route's grant: it covers that route until the window closes.
  paidAllowInWindow: 'Allow in this window',
  allowSessionPrefix: 'Always allow in this session:',
  reject: 'Reject',
  modelApiStalled:
    'The Model API sent nothing for {seconds} s, so the reply was ended; send the message again to retry',
  // Lane PR225W1: the person's own retry cap stopped the turn, not the
  // provider. The orchestrator reads this notice off its feed.
  modelApiRetryCapReached:
    'Retry limit reached (museSpark.modelApiMaxRetries: {count}): the request was not sent again. Raise the limit to allow more retries.',
  queuedTurnDropped: 'Not sent: Stop cleared the queued messages',
  compactionStopped: 'the compaction was stopped',
  compactionEmpty: 'The summary was empty; the conversation is unchanged.',
  compactionToolCall: 'The summary requested a tool; the conversation is unchanged.',
  summaryForkUnavailable: 'Fork with summary requires paid admission; no fork was opened.',
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
  approvalLedgerFaultUpdate:
    'Muse Code applied your approval but could not save its approval record. Update Muse Code to 1.4.3 or later with {command}, then restart Muse Code. Each card follows what Muse Code does next; a new conversation also avoids the fault.',
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
  // A restarted backend whose replacement lost the sign-in (F94): the
  // first turn that fails for it names the restart and the way back,
  // instead of failing as just another turn. {exit} is the previous
  // run's end in the log's words; {detail} the turn's reason.
  museSignInLostOnRestart:
    '{exit}, and it is no longer signed in, so this turn could not run ({detail}). Sign in again with “muse login” in a terminal, or set META_API_KEY for the CLI, then send again.',
  // The vault scrubber is locked (or its build refused): the turn reason and
  // the export notice name the outage instead of failing silently (RVM109T 7).
  vaultScrubUnavailable: 'Vault scrub service is unavailable',
  vaultSessionLogUnavailable: 'Vault-safe session log export is unavailable',
  turnUnqueued: 'Not sent: the queued message was withdrawn',
  turnRetracted:
    'Another Muse Code client withdrew a message from this conversation; reopen it from History to see it as stored.',
  turnRetractDeclined:
    'Withdrawing the message was declined, so the turn continues with it still in place.',
  approvalReviewing: 'The Safety Check is reviewing this approval.',
  sessionBranchChanged: "The session's version-control branch changed.",
  sessionViewHealthChanged: 'The session view health changed.',
  turnForegroundCompleted:
    'The turn finished its visible work; background checks are still running.',
  sessionClosed: 'The session was unloaded from this host.',
  sessionLeaveCompleted: 'The session handoff finished.',
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
  contributorTitle: 'Contributor-Tier Model',
  contributorDetail:
    'Meta may use prompts and completions sent to a contributor-tier model to train its models, in exchange for the lower price. Use it for this conversation?',
  contributorConfirm: 'Use Contributor Model',
  contributorBlocked:
    'Contributor-tier models are blocked in this workspace (museSpark.confidentialWorkspace).',
  // A BYO model whose provider or route may train on the content, refused
  // where the workspace forbids it (M95, PLAN.md D74).
  trainingBlocked:
    'Models that may train on workspace content are blocked in this workspace (museSpark.confidentialWorkspace).',
  backendItem: 'Backend',
  backendDetail: 'Which engine runs this conversation: automatic, Muse Code, or the Model API.',
  backendMuseCode: 'Muse Code (Your Muse Subscription)',
  backendModelApi: 'Meta Model API (Your Key, Pay as You Go)',
  modelApiBackendNotice:
    'This conversation runs on the Meta Model API with the extension’s own tools (read, edit, write, search, list, shell). Its sessions are kept in this workspace’s extension storage.',
  installOrKeyDetail:
    'The Muse Code CLI hosts conversations for this extension; without it you can still use a Meta Model API key.',
  compactionDone: 'Context compacted',
  compactionDoneDetail: forms({
    one: 'Compacted {count} turn into a summary ({before} entries before, {after} after).',
    other: 'Compacted {count} turns into a summary ({before} entries before, {after} after).',
  }),
  referenceManualCompaction:
    'Summarize the conversation with /compact and keep recent turns verbatim.',
  autoCompactionName: 'Automatic compaction',
  paidConfirmAutoCompaction:
    'Automatic compaction uses the selected model at {price}. The subscription does not pay for it.',
  autoCompactionAwaitingEvaluation: 'Automatic compaction is awaiting evaluation and is inactive.',
  autoCompactionFailed: 'Automatic compaction failed; continuing with the original context.',
  autoCompactionBudgetRefused:
    'Automatic compaction did not run: the daily paid budget refused it. Raise the budget or try again tomorrow; continuing with the original context.',
  contextWindowFull: 'Context window full: /compact or /handoff',
  contextWindowFullAcp:
    'Context window full: automatic compaction needs your one-time approval in the editor; approve its paid-use request, or run /compact. A client that cannot show the approval leaves it off.',
  contextWindowFullExec:
    'Context window full: rerun with --auto-compaction --max-budget-usd <amount> so the run can compact itself, or shorten the task.',
  // TOOLCAP: the person's preview of a cut tool result says the same as the
  // model's one-line notice, in plain words, with the spill file to open.
  toolResultCutPreview:
    'Tool result cut: {total} characters, kept the start and end ({head} whole lines at the start, {tail} at the end; {omitted} left out). The full result is in {spill}. It is removed with the session.',
  // TOOLCAP: the turn's last word when trimming and compaction could not fit
  // the conversation into the model's window. True by construction: the
  // numbers come from the provider's own refusal, and nothing was deleted.
  contextWindowTooLong:
    'The conversation ({tokens} tokens) is larger than this model’s window ({maximum} tokens) by {over} tokens. /compact the conversation, switch to a model with a larger window, or start a new conversation; nothing was deleted.',
  // TOOLCAP: a configured tool-output cap that cannot be honoured is refused
  // here, with the reason, and the default is used instead.
  toolResultCapRefused:
    'The {source} tool-output cap of {value} is refused ({reason}); the result enters whole unless the model’s window share cuts it.',
  // TOOLCAP: the two reasons a configured tool-output cap is refused, each
  // its own translated sentence for the person reading the refusal above.
  toolResultCapBelowFloor: 'below the readable floor of {floor} bytes',
  toolResultCapAboveWindow: 'larger than the model’s window of about {window} tokens',
  // TOOLCAP: the spill file for a cut tool result could not be written (for
  // example a read-only workspace); the cut text still went to the model.
  toolResultSpillFailed:
    'The full tool result could not be kept in {spill}; only the cut text remains.',
  toolResultCutPreviewUnkept:
    'Tool result cut: {total} characters, kept the start and end ({omitted} left out). The full result could not be kept.',
  // The Model API session budget (M82, D208): a limit the person set. A
  // request whose estimate would pass it is not sent, and the turn's cost is
  // shown against it afterwards.
  sessionBudgetStopped:
    'Stopped: the next request (about {estimate}) would pass the session budget of {cap} ({spent} used). It was not sent.',
  // D208: said once when what is left no longer fits a request like the last one.
  sessionBudgetNearLimit:
    'Session budget: {spent} of {cap} used. What is left may not fit the next request.',
  // D208: a response that ended without its usage adds nothing; {spent} is what the conversation counts.
  sessionBudgetCostUnknown:
    'A response ended without reporting its usage, so its cost is unknown. It was not added to what this conversation spent ({spent} so far).',
  spendLedgerDamaged:
    'The {scope} spend ledger is damaged ({file}). No new request can be sent; restore or repair this ledger.',
  spendLedgerUnreadable:
    'The {scope} spend ledger cannot be read or saved ({file}: {errno}). No new request can be sent; correct the file access or storage problem.',
  spendLedgerIntegrity:
    'The {scope} spend ledger has conflicting ownership or amounts ({file}). No new request can be sent; repair this ledger.',
  spendLedgerMidnight:
    'Local midnight passed. Nothing was sent; restart with today’s daily budget.',
  execContextLimit:
    'The request exceeds this model’s context limit. Nothing was sent; reduce the input or output allowance.',
  execBudgetImpossible:
    'This request is too large for any spend cap this run accepts. Reduce its input or output allowance.',
  execEstimateBound:
    'Input reservation: provider estimate + {margin}, capped by the upper bound from size.',
  sessionBudgetStoreUnavailable:
    'The session spend ledger could not be read or saved. No new request can be sent until it is available.',
  sessionBudgetSearchUnavailable:
    'Web search is unavailable under a finite spend cap: its billed query count has no verified limit. Ordinary chat and free web fetch remain available.',
  sessionBudgetRetryUnavailable:
    'The previous request may have been billed, so it is not sent again. Send a new prompt to retry.',
  sessionBudgetUnknownCharge:
    'Usage was not verified. {amount} remains reserved as a possible charge; this is not a confirmed bill.',
  sessionBudgetVoiceUnavailable:
    'Muse Voice file transcription is unavailable under a finite spend cap: its billed audio duration has no verified bound. Use free system dictation.',
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
  sideChatWriteRefused: 'Side chats are read-only, so this request was refused.',
  sideChatResolver: 'Side Chat',
  // M79 (PLAN.md D49): plans as files. {path} is the plan's workspace path.
  planActionsLabel: 'Plan Actions',
  savePlan: 'Save Plan',
  implementPlan: 'Implement in a Fresh Conversation',
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
  handoffDialogTitle: 'Hand Off to a New Conversation',
  handoffDialogBody:
    'Review the brief, edit it if you need to, then start the new conversation. Nothing starts until you confirm.',
  handoffConfirm: 'Start New Conversation',
  handoffUnavailable: 'Handoff runs on the Model API backend only.',
  handoffEmpty: 'There is nothing to hand off yet.',
  handoffBusy: 'A handoff is already running.',
  handoffWaitTurn: 'Wait for the reply to finish, or stop it, first.',
  handoffSideChat: 'Start a handoff from the main conversation.',
  handoffInterrupted: 'The handoff request did not finish; nothing was started.',
  handoffFailed: 'Could not prepare the handoff',
  // After handoffFailed: the distillation turn ended with no reply text.
  handoffNoBrief: 'The model returned no brief.',
  handoffChangedNotStarted:
    'The handoff was not started: the conversation changed in the meantime.',
  // {mode}: the permission mode's name. The model wrote the brief, so it
  // starts in the starting mode only when the dialog showed all of it.
  handoffUnshownMode:
    'The new conversation starts in {mode}: the brief holds a control or format character (such as a direction override or a zero-width character) that the dialog does not show, so you did not see all of it.',
  planOpenFailed: 'Could not open the plan',
  sideChatSessionOnly: 'This side chat can open only side-chat conversations.',
  renameFailed: 'Could not rename the conversation',
  sandboxOffProfileWarning:
    "Muse Code's Windows sandbox cannot reliably run commands in a workspace under your user profile, so this window runs Muse Code without its OS sandbox. Its file tools can then write anywhere your account can, outside this workspace too, without asking in any mode, Plan included, and its commands run directly as you, with your network. Approval still covers its commands and writes to .git, .muse and .agents. A workspace outside your user profile keeps the sandbox. Setting: museSpark.shellSandbox.",
  sandboxOffSettingWarning:
    'museSpark.shellSandbox is off, so Muse Code runs without its OS sandbox in this window. Its file tools can then write anywhere your account can, outside this workspace too, without asking in any mode, Plan included, and its commands run directly as you, with your network. Approval still covers its commands and writes to .git, .muse and .agents.',
  sandboxPreparingNotice:
    "Muse Code's Windows sandbox is still being prepared, so this command did not run. After its setup, Muse Code gives the sandbox read access to your files once, in the background, and that can take a while on a large user profile. Try again in a few minutes. Setting: museSpark.shellSandbox.",
  // F91: at host start on Linux, while sandboxed, the bwrap probe measured
  // that Muse Code's sandbox cannot start here. Said once on every surface;
  // the sandbox stays on until the person turns it off.
  sandboxCannotStartNotice:
    "Muse Code's shell sandbox cannot start on this machine: its bubblewrap sandbox cannot create a user namespace here, so commands it runs without asking (such as git status) will fail. Set museSpark.shellSandbox to off, or allow unprivileged user namespaces on this machine (sysctl kernel.unprivileged_userns_clone=1; where AppArmor restricts them, kernel.apparmor_restrict_unprivileged_userns=0). The sandbox stays on until you choose.",
  rulesFileNoWorkspace: 'Open a folder first; AGENTS.md lives in the workspace root.',
  rulesFileExists: 'AGENTS.md already exists in this workspace; opening it.',
  rulesFileCreated: 'AGENTS.md created. Muse reads it as project rules from the next conversation.',
  terminalCliMissing: 'The Muse Code CLI is not installed, so there is no terminal to open.',
  signedOutNotice: 'Signed out of Muse Spark.',
  // The Agent map, the usage modal, the banner and the compact button (M14).
  agentsPillTitle: 'Show the agent map',
  agentsCount: forms({ one: '{count} Agent', other: '{count} Agents' }),
  // M46: the header pill while background work runs and no agent is shown.
  backgroundTasksPillTitle: 'Show the background tasks',
  agentMapTitle: 'Agent Map',
  agentActivities: { active: 'Active', waiting: 'Waiting', inactive: 'Inactive' },
  agentOutcomes: {
    complete: 'Complete',
    incomplete: 'Incomplete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    unverified: 'Ended, Unverified',
  },
  agentWaitingReasons: {
    approval: 'approval',
    input: 'input',
    queued: 'queued',
    interrupted: 'interrupted',
    idle: 'no recent activity',
  },
  agentStopReasons: {
    normal: 'Normal End',
    budget: 'Budget Exhausted',
    limit: 'Call Limit Reached',
    error: 'Error',
    cancelled: 'Stopped by User',
    unknown: 'Unavailable',
  },
  agentContinue: 'Continue',
  agentRetry: 'Retry',
  agentReceipt: 'Agent Receipt',
  agentReceiptFiles: 'Changed Files',
  agentReceiptChecks: 'Commands and Checks',
  agentReceiptStop: 'Stop Reason',
  agentReceiptUnfinished: 'Unfinished Items',
  agentReceiptHistory: 'Attempt History',
  agentReceiptUnavailable: 'This backend did not provide this evidence.',
  agentReceiptTruncated: 'The receipt reached its size limit; some evidence is omitted.',
  agentRecoveryConfirm: '{action}: {objective}? The current permissions and budgets apply.',
  agentRetryUnavailable:
    'Retry is unavailable: this backend provides no isolated worktree checkpoint. Shared workspace changes are kept.',
  agentRetryNoSubagent: 'Retry is unavailable for this agent: it has no subagent to retry.',
  agentRetryNoCheckpoint:
    'Retry is unavailable for this agent: it has no isolated checkpoint. Shared workspace changes are kept.',
  agentContinueUnavailable: 'Continue is unavailable for this agent or its current state.',
  playbookResumePaused:
    'The machine has paused new work, so this agent cannot be resumed now. Try again when the machine is idle.',
  agentGone: 'That agent is no longer in this conversation.',
  referenceAgentOutcomes:
    'Agents show activity and evidence-backed outcomes. Select an ended agent for its bounded receipt and attempt history. Continue keeps its session and changes after confirmation; Retry requires an isolated checkpoint. Missing evidence is shown as unverified. ACP: /agents, /agents receipt ID, /agents continue ID, /agents retry ID.',
  agentMapHint: 'click an agent for details',
  agentMapEmpty: 'No subagents in this conversation.',
  // M96c (D75): scheduler, Traffic, recovery and user-level runners.
  teamTraffic: {
    title: 'Traffic',
    score: 'Priority {priority} × critical path {criticalPath} × fit {fit}',
    afterTask: 'After task {task}: {path}',
    size: 'Size',
    waitingApproval: 'Waiting for Approval',
    attemptRunning: 'Attempt Running',
    attemptRetiring: 'Attempt Retiring',
    attemptRetired: 'Attempt Retired',
    attemptUncertain: 'Attempt Uncertain',
    attemptInterrupted: 'Attempt Interrupted',
    diverging: 'Diverging',
    flaky: 'Flaky Check',
    notReviewed: 'Not Reviewed',
    sameModelReview: 'Same-Model Review',
    priority: 'Priority',
    writeSet: 'Write-Set',
    resources: 'Resources',
    diskUse: 'Disk Use',
    queuePosition: 'Queue position {position}: {reason}',
    workerCount: forms({ one: '{count} worker', other: '{count} workers' }),
    machineLoad: forms({
      one: '{count} window runs {workers} on this machine.',
      other: '{count} windows run {workers} on this machine.',
    }),
    board: 'Task Board',
    lanes: 'Lanes',
    leases: 'Leases',
    otherWindows: 'Other Windows',
    recovery: 'Recovery',
    conflicts: 'Predicted Conflicts',
    mergeQueue: 'Merge Queue',
    metrics: 'Metrics',
    noTasks: 'No tasks on the board',
    pauseQueue: 'Pause Queue',
    resumeQueue: 'Resume Queue',
    runNext: 'Run Next',
    hold: 'Hold',
    release: 'Release',
    reassign: 'Reassign…',
    handOffAnyway: 'Hand Off Anyway',
    continueAnyway: 'Continue Anyway',
    restartTeamHost: 'Restart the Team Host',
    cancel: 'Cancel Task',
    serialize: 'Serialize',
    letBothRun: 'Let Both Run',
    openWindow: 'Open That Window',
    takeBack: 'Take Back',
    pause: 'Pause',
    retry: 'Retry',
    remove: 'Remove',
    landNow: 'Land Now',
    landWithoutChecks: 'Land Without Checks',
    undoBatch: 'Undo Batch',
    cleanup: 'Clean Up',
    apply: 'Apply',
    openTerminal: 'Open a Terminal Here',
    recover: 'Recover',
    stop: 'Stop Process',
    keep: 'Keep',
    showTerminal: 'Show in a Terminal',
    takeOver: 'Take Over',
    newTask: 'Continue Here as a New Task',
    includeEdits: 'Include Its Uncommitted Edits',
    hostBusy: 'Host Busy',
    exclusiveWriter: 'Exclusive Writer',
  },
  teamTrafficDetails: {
    changedSinceOpened:
      'This work changed since you opened it. Review the current state and try again.',
    freeSlots: 'Free Slots',
    processWorkers: 'Process Workers',
    heavyCommands: 'Heavy Commands',
    raiseLimit: 'Raise a Limit…',
    resume: 'Resume Task',
    discard: 'Discard Task',
    restartServer: 'Restart Server',
    releaseAnyway: 'Release Anyway',
    waiting: 'Waiting',
    checking: 'Checking Batch',
    serial: 'Serial Admission',
    returned: 'Candidate Sent Back',
    admitted: 'Admitted',
    matched: 'Matched',
    uncertain: 'Uncertain',
    staleHint: 'Stale hint',
    advisoryExceeded: 'The advisory total exceeds this window’s worker cap.',
    ownerMayBeLive: 'Another window may still own this work. Taking over can break its task.',
    predictedRate: 'Predicted Conflicts per Writing Task',
    mergeRate: 'Merge Conflicts per Landing',
    reviewRounds: 'Review Rounds After the First',
    reassignments: 'Reassignments',
    candidatesReturned: 'Candidates Sent Back',
    runnerInvalid: 'Check the runner fields. Credentials and SSH options are not allowed.',
    runnerId: 'Runner ID',
  },
  teamStallReasons: {
    noProgress: 'No Progress',
    outOfSteps: 'Request Limit Reached',
    rateLimited: 'Rate Limited',
    usageLimited: 'Usage Limit Reached',
    providerDown: 'Provider Unavailable',
    crashed: 'Worker Crashed',
  },
  teamSharedFileKinds: { text: 'Plain Text', 'json-table': 'JSON Table', changelog: 'Changelog' },
  teamTaskSizes: { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra Large' },
  teamTaskStates: {
    queued: 'Queued',
    ready: 'Ready',
    running: 'Running',
    blocked: 'Blocked',
    review: 'In Review',
    merge: 'Awaiting Merge',
    merged: 'Merged',
    done: 'Done',
    discarded: 'Discarded',
    failed: 'Failed',
    cancelled: 'Cancelled',
    redesign: 'Needs Redesign',
    waitingApproval: 'Waiting for Approval',
    waitingForYou: 'Waiting for You',
    capped: 'Capped',
    interrupted: 'Interrupted',
    notStaffed: 'Not Staffed',
  },
  teamPriorities: {
    urgent: 'Urgent',
    high: 'High',
    normal: 'Normal',
    low: 'Low',
  },
  teamSchedulerSettings: {
    integrationFlow: 'Integration Flow',
    full: 'Full',
    reviewAutomatically: 'Review Automatically',
    manual: 'Manual',
    onStall: 'When a Task Stalls',
    reassign: 'Reassign',
    ask: 'Ask',
    stop: 'Stop',
    sharedFiles: 'Shared Files',
    dependencyInstallation: 'Dependency Installation',
    checkSlots: 'Check Slots',
    perCopy: 'Each Working Copy',
  },
  // M96d machine coordinator: every refusal says why the window keeps its own scheduler.
  coordinatorStoreTooLarge:
    'The machine coordinator’s record is too large to read safely, so this window keeps its own scheduler.',
  coordinatorStoreAmbiguous:
    'The machine coordinator’s record is damaged or unclear, so this window keeps its own scheduler. Nothing was deleted.',
  coordinatorStoreIdentity:
    'The machine coordinator’s record belongs to another store, so this window keeps its own scheduler.',
  coordinatorEpochReused:
    'The machine coordinator refused a reused session, so this window keeps its own scheduler.',
  coordinatorLedgerOwned:
    'Another process already coordinates this machine, so this window keeps its own scheduler.',
  coordinatorLedgerOwnerUncertain:
    'The machine coordinator cannot tell whether another process still coordinates this machine, so this window keeps its own scheduler.',
  coordinatorSyncFailed:
    'The machine coordinator could not save its record, so this window keeps its own scheduler.',
  coordinatorModeWindowStorage:
    'Machine-wide coordination is off: this store cannot hold it. This window keeps its own scheduler.',
  coordinatorModeWindowNative:
    'Machine-wide coordination is off: this machine’s process control is not qualified yet. This window keeps its own scheduler.',
  coordinatorModeWindowScope:
    'Machine-wide coordination is off: complete process containment is not proved here. This window keeps its own scheduler.',
  coordinatorModeBlockedGrants:
    'Machine-wide coordination is blocked: earlier grants are still open. This window keeps its own scheduler until they settle.',
  coordinatorEndpointPathTooLong:
    'The machine coordinator cannot listen here: the address is too long. This window keeps its own scheduler.',
  teamTrafficMetrics: {
    utilisation: 'Lane Utilisation',
    queueDepth: 'Queue Depth',
    waitMedian: 'Median Wait',
    waitP90: '90th Percentile Wait',
    conflictRate: 'Conflict Rate',
    reworkRate: 'Rework Rate',
    costPerMerge: 'Cost per Merged Change',
    timeToMerge: 'Time to Merge',
    estimated: 'Estimated',
    reported: 'Reported',
    today: 'Today',
    week: 'This Week',
    allTime: 'All Time',
  },
  teamRunners: {
    title: 'Runners',
    add: 'Add Runner…',
    testAll: 'Test Runners',
    test: 'Test Runner',
    destination: 'SSH Destination',
    port: 'SSH Port',
    os: 'Operating System',
    workFolder: 'Work Folder',
    maxJobs: 'Maximum Jobs',
    labels: 'Labels',
    commandClasses: 'Command Classes',
    tests: 'Tests',
    builds: 'Builds',
    typeChecks: 'Type Checks',
    declared: 'Declared Commands',
    setupCommand: 'Setup Command',
    cacheKey: 'Cache Key',
    environmentNames: 'Environment Names',
    online: 'Online',
    offline: 'Offline',
    busy: 'All slots busy',
    testFailed: 'Runner self-test failed',
    commandTooLong:
      'The Windows runner command exceeds the process command-line limit. Shorten the setup command or check.',
    executionPolicy: "This machine's policy does not allow scripts to run; nothing was started.",
    hostKeyNotice:
      'Connect once from your own terminal to verify and trust this host key: {fingerprint}.',
    inputHangNotice:
      'The remote shell waited for input. Use the scheduled-task wrapper and test again.',
    environmentNotice: 'Only these environment names are passed. Credentials are always excluded.',
    trustNotice: 'Runners execute project code and receive snapshots only in a trusted workspace.',
  },
  teamTrafficNotices: {
    queuePaused:
      'The queue is paused after a reload. Resume queue to start queued tasks; paid work checks consent again.',
    windowCaps: 'Caps apply to this window. Other windows’ counts are advisory.',
    uncertainAttempt:
      'The earlier attempt has not stopped. Its slots remain counted and its working copy cannot be reused.',
    userDecision:
      'Continuing is your decision, not proof that every descendant stopped. An earlier process may still act on its resources.',
    handoffUnavailable:
      'A replacement cannot start: {reason}. Raise a limit or restart the team host.',
    snapshotChanged:
      'The working snapshot or check identity changed. The queue will merge and test again.',
    lockHeld:
      'Git’s lock is held: {path}. Apply later or open a terminal; the extension never removes another process’s lock.',
    changedDuringLanding:
      'Changed during landing: {path}. Undo merge is available only while the landed bytes still match.',
    unverifiedCheck: 'Unverified check: {command}. No matching command was run by this attempt.',
    journalBroken:
      'The team journal could not be read: {path}. The broken file was kept; review recovery before resuming.',
    dependencyBlocked:
      'Dependency {task} did not finish successfully. This task is blocked; re-delegate or cancel it.',
    paidNotice:
      'Paid extras are enabled for your chosen setup. Before the first charge, accept the price: {price}. Shared daily budget: {budget}, set by museSpark.paidDailyBudgetUsd. Your subscription does not pay for these calls.',
  },
  teamSchedulerCommands: {
    showTeamTraffic: 'Show Team Traffic',
    pauseTeamQueue: 'Pause Team Queue',
    resumeTeamQueue: 'Resume Team Queue',
    addRunner: 'Add Runner…',
    testRunners: 'Test Runners',
    cleanUpAgentBranches: 'Clean Up Agent Branches',
    showAllWorkspacesAgents: 'Show All Workspaces’ Agents',
  },
  // A subagent's or background task's status as Muse Code reports it; one
  // not listed here is shown as it came.
  agentStatuses: {
    inProgress: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
    interrupted: 'Interrupted',
    resultReady: 'Result Ready',
    queued: 'Queued',
    closed: 'Closed',
  },
  agentTokens: '{tokens} tokens',
  agentContextTokens: '{tokens} tokens in context',
  agentUntitled: 'Agent',
  agentRole: 'Role:',
  agentBack: 'Back to the Map',
  agentTranscriptLoading: 'Reading the agent’s transcript…',
  agentTranscriptFailed: 'Could not read the agent’s transcript',
  /** The Agent map's owner controls (M18). */
  agentInterrupt: 'Interrupt',
  agentStop: 'Stop',
  agentResume: 'Resume',
  agentClose: 'Close Agent',
  agentReopen: 'Reopen Agent',
  agentReadResult: 'Mark Result Read',
  agentSendMessage: 'Send Message',
  agentFollowup: 'Follow-Up Task',
  agentMessagePlaceholder: 'A note for this agent, or its next task…',
  agentControlsLabel: 'Agent Controls',
  agentControlFailed: 'The agent command was refused',
  agentResultText: 'Result',
  agentNoTranscript: 'No transcript for this agent.',
  agentTranscriptLabel: 'Agent Transcript',
  agentDelegationOff:
    'Muse Code’s subagent delegation is off (its default), so the model has no agent tools in this conversation. Set run.subagent_delegation_mode to "auto" in the Muse Code settings file to enable it; the extension never edits that file.',
  agentOpenMuseSettings: 'Open the Muse Code Settings File',
  museSettingsMissing: 'Muse Code has not written a settings file yet. It would be at {path}',
  // Workflows (M47, PLAN.md D40): a run's card, its agents and controls, the
  // Workflow tool's row, and Muse Code's trigger setting in the Agent map.
  workflowRowLabel: 'Workflow',
  // A run the model wrote for this task, not a saved one.
  workflowGenerated: 'Written for This Task',
  // What started a run (Muse Code's `triggerSource`); one not listed shows as it came.
  workflowTriggerSources: {
    guidanceAuto: 'started by the model',
  },
  workflowAgentsLabel: 'Workflow Agents',
  // A workflow agent's status before it ends; one not listed shows as it came.
  // An agent the workflow gave no label; {number} counts from 1.
  workflowChildUntitled: 'Agent {number}',
  workflowAttempt: 'Attempt {attempt}',
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
  // The run card's owner controls (RLF-M47): Cancel, Pause and Resume on a
  // live run, Skip on a running agent. Retry reuses agentRetry.
  workflowCancel: 'Cancel',
  workflowPause: 'Pause',
  workflowSkip: 'Skip',
  // The card's own mark while the run stays paused through this panel.
  workflowPaused: 'Paused',
  workflowControlFailed: 'The workflow command was refused',
  // The run is gone (missing_run) or already settled (already_terminal).
  workflowRunEnded: 'That workflow run is not running any more',
  // A child control needs the in-flight attempt (invalid_target otherwise).
  workflowChildNotRunning: 'That workflow agent is not running right now',
  // The attempt moved between the panel's read and the command (stale_attempt).
  workflowChildMovedOn: 'That agent moved on; try again',
  // The session's backend offers no workflow controls (the Model API runs none).
  workflowUnsupported: 'This backend runs no workflows',
  backgroundTasksCount: forms({
    one: '{count} Background Task',
    other: '{count} Background Tasks',
  }),
  backgroundTasksLabel: 'Background Tasks',
  backgroundBadge: 'Background',
  subagentRowLabel: 'Agent',
  // The node's team and nodes pages (M110c lane U3): the worker liveness
  // words, the capabilities label and the empty-nodes sentence.
  nodeTeam: {
    live: 'Live',
    quiet: 'Quiet',
    gone: 'Gone',
    capabilities: 'Capabilities',
    noNodes: 'No nodes have joined',
  },
  // The team tree and cards (M96 lane U2): the Agent map's team tree, the
  // delegation, switch, waiting-for-you and merge cards, the worker label's
  // group excluded (it splices technical names), and the Usage Team section.
  teamTreeLabel: 'Team',
  teamWorkerMerged: 'Merged',
  teamWorkerDiscarded: 'Discarded',
  teamRunningOf: '{used} of {amount} running',
  teamWorkerFinished: 'Team task {task}: {status}.',
  teamTreeKeyboardHint:
    'Use arrow keys to move. F2 focuses actions; Left and Right choose an action; Escape returns to the item.',
  teamMergeAffectedFiles: 'Affected Files',
  teamMergeProtectedPaths: 'Protected Paths',
  teamMergeConflictPaths: 'Conflict Paths',
  teamMergeDetailsMissing:
    'File details are unavailable. Review the diff before requesting a new merge card.',
  teamMergeReviewVerdict: 'Review Verdict',
  teamMergeNoPaths: 'None',
  teamRunningCount: forms({ one: '{count} running', other: '{count} running' }),
  teamMergeMorePaths: forms({ one: 'and {count} more', other: 'and {count} more' }),
  teamOrchestrator: 'Orchestrator',
  teamOrchestratorDefault: 'Default',
  teamOrchestratorOverride: 'Override',
  // An entry the host gave no model name; {number} counts from 1.
  teamEntryUntitled: 'Entry {number}',
  // A pool entry's state; one not listed here is shown as it came.
  teamEntryStates: {
    ready: 'Ready',
    capped: 'Capped',
    rateLimited: 'Rate Limited',
    usageLimited: 'At Usage Limit',
    unavailable: 'Unavailable',
  },
  teamCapUsed: '{used} of {amount}',
  teamEstimated: 'Estimated',
  teamOpenTranscript: 'Open Transcript',
  teamReviewDiff: 'Review Diff',
  teamMergeAction: 'Merge',
  teamDiscardAction: 'Discard',
  teamResetEntry: 'Reset',
  teamEditRole: 'Edit in Roles Section',
  teamStopAll: 'Stop All Team Tasks',
  teamQueuedGroup: 'Queued',
  teamUnmergedGroup: 'Unmerged',
  teamInterruptedGroup: 'Interrupted',
  teamTasksCount: forms({ one: '{count} Team Task', other: '{count} Team Tasks' }),
  teamPlanTitle: 'Delegation Plan',
  teamPlanDelegated: 'Delegated',
  teamPlanKept: 'Kept by the Main Agent',
  teamPlanDryRun: 'Plan only: nothing started or spent.',
  // Why a task moved entries; one not listed here is shown as it came.
  teamSwitchReasons: {
    cap: 'cap reached',
    concurrency: 'no free slot',
    rateLimited: 'rate limited',
    usageLimit: 'usage limit',
    unavailable: 'unavailable',
    reset: 'reset',
    usageLimited: 'usage limit',
    notStaffed: 'not staffed',
  },
  teamWaitingTitle: 'Waiting for You',
  teamWaitingQueue: 'Queue It',
  teamWaitingSelf: 'Main Agent Does It',
  teamWaitingRaise: 'Raise a Limit…',
  teamWaitingCancel: 'Cancel',
  teamMergeTitle: 'Merge',
  teamMergeNotReviewed: 'Not Reviewed',
  teamMergeSameModel: 'Reviewed by the Same Model',
  teamMergeBranchMoved: 'The branch moved during the task.',
  teamMergeConflict: 'Conflicts need resolving before merge.',
  teamReportTitle: 'Report',
  teamUsageTitle: 'Team',
  teamUsageToday: 'Today',
  teamUsageWindow: 'This Window',
  teamUsageTasks: 'Tasks',
  teamUsageTokens: 'Tokens',
  teamUsageCost: 'Cost',
  usageAccount: 'Account',
  usageAddModelApiKey: 'Add Model API Key',
  usageReplaceModelApiKey: 'Replace Model API Key',
  usageAuthMethod: 'Auth Method',
  usageAuthCli: 'Meta Account (Muse Code CLI)',
  usageAuthKey: 'Model API Key',
  usageAuthNone: 'Not Signed In',
  usagePlanPayAsYouGo: 'Pay as You Go',
  usagePlanUnknown: 'Not reported yet',
  usageCliVersion: 'Muse Code',
  usageModel: 'Model',
  usageHeading: 'Usage',
  usageCost: 'Estimated Cost',
  usageCacheHits: 'Cache Hits',
  // What the prompt cache saved, in dollars (M82, Model API only).
  usageCacheSavings: 'Cache Savings',
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
  modelAttemptsCount: forms({
    one: '{count} model attempt',
    other: '{count} model attempts',
  }),
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
  sandboxProfileNotice:
    "This workspace is under your user profile, where Muse Code's Windows sandbox may not run commands: they can start in the PowerShell folder instead of the project, or never finish. File reads and edits are unaffected. A workspace outside %USERPROFILE% runs commands in place.",
  // Label groups keyed by id (they were records in constants.ts before M40).
  permissionModes: {
    manual: 'Manual',
    acceptEdits: 'Edit Automatically',
    plan: 'Plan',
    auto: 'Auto',
    bypassPermissions: 'Bypass Permissions',
  },
  // One line under each mode in the Modes menu (the Claude Code wording, with
  // Muse in place of Claude and the MSP behaviour behind each mode, PLAN.md
  // D7, D69), per backend where they differ (D24). On Muse Code (the default
  // lines): in Manual it applies edits inside the workspace without an
  // approval (verified live in M4), so Edit automatically is Manual there,
  // and under `muse serve` Auto skips only the commands Muse Code judges
  // simple, with no safety-check judge (D69); the panel's reviewer checks the
  // rest while its setting is on (museCodeReviewedAutoDetail). The Model API
  // backend has no safety-check judge behind Auto either; its paid Auto
  // reviewer (M78) checks commands no rule settles while it is on
  // (modelApiReviewedAutoDetail).
  permissionModeDetails: {
    manual:
      'Muse asks before running each command, unless a permission rule allows it; Muse Code edits workspace files without asking',
    acceptEdits:
      'On Muse Code, the same as Manual: Muse Code edits workspace files without asking, and asks before running each command, unless a permission rule allows it',
    plan: 'Muse plans first; Muse Code refuses commands, but its file tools can still edit files without asking',
    auto: 'Muse Code runs the commands it judges simple without asking and asks before the rest',
    bypassPermissions: 'Muse will edit files and run commands without asking',
  },
  museCodeReviewedAutoDetail:
    'Muse Code runs the commands it judges simple without asking; a reviewer may allow some others once, and you are asked about the rest',
  modelApiPermissionModeDetails: {
    manual: 'Muse will ask for approval before each edit and each command',
    acceptEdits: 'Muse will edit files without asking and ask before running commands',
    plan: 'Muse will explore the code and present a plan before editing',
    auto: 'Muse will edit files without asking, except protected files, and ask before commands',
  },
  modelApiReviewedAutoDetail:
    'Muse will edit files without asking, except protected files; a paid reviewer may allow some commands once, and you are asked about the rest',
  effortLevels: {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
    max: 'Max',
    ultra: 'Ultra',
  },
  // Tool names seen on the wire (Muse Code 1.3.0, live captures 2026-09-21/22)
  // and the label the row shows; unknown tools show their raw name. The IDE
  // tool is named by the CLI's MCP catalog: `mcp__<server>__<tool>`.
  toolLabels: {
    judge: 'Judge',
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
    subagent_spawn: 'Spawn Agent',
    subagent_wait: 'Wait for Agents',
    subagent_status: 'Agent Status',
    subagent_send_message: 'Message Agent',
    subagent_read_result: 'Agent Result',
    subagent_cancel: 'Cancel Agent',
    // Meta's hosted search on the Model API backend (M33).
    web_search: 'Web Search',
    // Paid image generation on the Model API backend (M34) and image edits (M44).
    generate_image: 'Image',
    edit_image: 'Edit Image',
    // The same, made by the extension's ide server for Muse Code (M44).
    mcp__ide__generateImage: 'Image',
    mcp__ide__editImage: 'Edit Image',
    // The extension's web fetch for Muse Code, through the ide server (M69).
    mcp__ide__webFetch: 'Fetch Page',
    // The browser check on the Model API backend and for Muse Code (M81).
    browser_check: 'Browser Check',
    mcp__ide__browserCheck: 'Browser Check',
    // Muse Code's own tools (M43): captured live 2026-09-25, the rest named
    // from the CLI's tool list (PLAN.md D36).
    read_memory: 'Read Memory',
    add_memory: 'Save Memory',
    edit_memory: 'Edit Memory',
    create_goal: 'Set Goal',
    get_goal: 'Check Goal',
    update_goal: 'Update Goal',
    report_progress: 'Goal Progress',
    cron_create: 'Schedule Prompt',
    cron_list: 'Scheduled Prompts',
    cron_delete: 'Cancel Scheduled Prompt',
    scheduled_prompt: 'Run Scheduled Prompt',
    web_fetch: 'Fetch Page',
    work_stop: 'Stop Work',
    work_status: 'Work Status',
    powershell_input: 'PowerShell Input',
    bash_input: 'Bash Input',
    shell: 'Shell',
    apply_patch: 'Patch',
    monitor: 'Monitor',
    artifact: 'Artifact',
    image_generation: 'Image',
    workflow: 'Workflow',
    code_exec: 'Run Code',
    code_wait: 'Wait for Code',
    tool_search: 'Find Tools',
    read_skill: 'Skill',
    send_session_message: 'Message Session',
    list_peer_sessions: 'Other Sessions',
    write_todos: 'Tasks',
    update_plan: 'Tasks',
    TodoWrite: 'Tasks',
    snooze_reminder: 'Snooze Reminder',
    submit_reminder_decision: 'Reminder',
    submit_result: 'Result',
    // The Auto reviewer's own row (M78): one review, marked paid.
    auto_review: 'Auto Review',
    // M68 (PLAN.md D49): the verify loop on the Model API backend: the
    // model's own call, and the automatic check after a round of edits.
    run_checks: 'Run Checks',
    verify_edits: 'Check Edits',
    // M67: code intelligence, native on the Model API and on the ide server.
    find_definition: 'Definition',
    find_references: 'References',
    workspace_symbols: 'Symbols',
    document_symbols: 'Outline',
    hover: 'Hover',
    call_hierarchy: 'Calls',
    repo_map: 'Repo Map',
    rename_symbol: 'Rename',
    mcp__ide__findDefinition: 'Definition',
    mcp__ide__findReferences: 'References',
    mcp__ide__workspaceSymbols: 'Symbols',
    mcp__ide__documentSymbols: 'Outline',
    mcp__ide__hover: 'Hover',
    mcp__ide__callHierarchy: 'Calls',
    mcp__ide__repoMap: 'Repo Map',
    mcp__ide__renameSymbol: 'Rename',
  },
  // A tool from an MCP server the table does not name (`mcp__<server>__<tool>`).
  mcpToolLabel: '{tool} ({server})',
  // Where a memory note lives: Muse Code's `scope` (M43).
  memoryScopes: {
    personal_project: 'Your Memory for This Project',
    project: 'Project Memory, Shared With the Repository',
    personal: 'Your Memory for Every Project',
  },
  // A session goal's status (M43); one Muse Code adds later shows as it comes.
  goalStatuses: {
    active: 'Active',
    paused: 'Paused',
    complete: 'Complete',
    blocked: 'Blocked',
    // M45: the rest of Muse Code 1.3.0's list; a goal stopped by a limit.
    usage_limited: 'Usage Limit Reached',
    budget_limited: 'Token Budget Spent',
  },
  // {percent} is already formatted ("50%").
  goalPercent: '{percent} done',
  goalProgress: 'Goal Progress',
  goalNow: 'Now',
  goalNext: 'Next',
  goalTokens: 'Tokens',
  goalTokensOfBudget: '{used} of {budget}',
  // The session goal (M45, PLAN.md D38): the strip above the composer, its
  // controls, `/goal` in the prompt and what the conversation says of them.
  goalItem: '/goal',
  goalItemDetail: 'Set a goal Muse keeps working toward: /goal <objective>',
  goalStripLabel: 'Session Goal',
  goalTitle: 'Goal',
  goalPause: 'Pause',
  goalResume: 'Resume',
  goalEdit: 'Edit',
  goalClear: 'Clear',
  goalPauseTitle: 'Pause the goal: Muse stops working toward it until you resume it',
  goalResumeTitle: 'Resume the goal: Muse starts working toward it again',
  goalEditTitle: 'Change the goal’s objective',
  goalClearTitle: 'Remove the goal',
  goalEditLabel: 'Goal Objective',
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
  goalObjectiveTooLarge:
    'That objective is too long for the selected model’s context window. Shorten it or pick a model with a larger window.',
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
  // A schedule consent file that cannot be read (CATCHMONEY R3, P3-4): the
  // errno reaches the person through a closed kind word, never raw. `{reason}`
  // is one of the scheduleStoreReason* words below.
  scheduleConsentUnreadable:
    'Scheduled prompts are off: their saved consent {reason}. Fix its permissions or delete it, then set up schedules again.',
  scheduleStoreReasonDenied: 'could not be read; permission was refused',
  scheduleStoreReasonDiskFull: 'could not be read; the disk is full or read-only',
  scheduleStoreReasonUnknown: 'could not be read',
  // M52: extension-owned schedules on the Model API backend. Muse Code's cron
  // jobs stay model-mediated until its MSP exposes scheduler verbs.
  loopItem: '/loop',
  loopItemDetail: 'Schedule a prompt in this Model API conversation',
  loopSyntax:
    'Use /loop 10m <prompt>, /loop "0 9 * * 1-5" <prompt>, /loop list, or /loop cancel <id>.',
  schedulePanelLabel: 'Scheduled Prompts for This Conversation',
  schedulePanelTitle: 'Scheduled Prompts',
  schedulePanelScope: 'Model API · this workspace, conversation and key',
  scheduleEvery: 'Every {duration}',
  schedulePending: 'Due · waiting for you to run it',
  scheduleRun: 'Run Now (Paid)',
  scheduleCancel: 'Cancel Schedule',
  scheduleEnablePaid: 'Enable Paid Runs',
  scheduleRunJob: 'Run Scheduled Prompt {id}',
  scheduleEnableJob: 'Enable Paid Runs for Scheduled Prompt {id}',
  scheduleCancelJob: 'Cancel Scheduled Prompt {id}',
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
    'Turn on Scheduled Prompts (Paid) and accept its price before running a due prompt.',
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
  // P3-2: a rotated key is not a changed mind: the refusal says the key moved.
  execKeyRotated: 'The key was rotated during the run; the request was not sent.',
  requestStaleTurn: 'The model or conversation changed while sending. Send your message again.',
  requestStaleCompaction: 'The model or conversation changed while compacting. Compact again.',
  requestStaleRetry: 'The model or conversation changed before the request was sent. Try again.',
  requestStaleHookModel:
    'The model changed while the hook was asking the model. Try the action again.',
  requestStaleRun: 'The model changed during the run. Run the command again.',
  webNoResults: 'No results',
  backgroundRunning: 'Running in the background',
  // M46 (PLAN.md D39): moving a running command to the background, stopping
  // background work, and the user's own `!` shell commands.
  moveToBackground: 'Move to Background',
  moveToBackgroundTitle: 'Keep this command running in the background and let Muse carry on',
  moveToBackgroundFailed: 'The command could not be moved to the background',
  nothingToMoveToBackground: 'No command is running that could move to the background',
  stopTask: 'Stop',
  stopTaskTitle: 'Stop this background task',
  stopUserShellTitle: 'Stop this command',
  stopAllTasks: 'Stop All',
  stopAllTasksTitle: 'Stop every background task of this conversation',
  stopTaskFailed: 'The background task could not be stopped',
  taskNotRunning: 'That task is not running any more',
  stillWaitingNotice: 'Still waiting: {what} ({duration}). Stop ends it.',
  // The subjects the still-waiting notices name (PR #214 review): each one
  // is translated, so a notice never interpolates English prose. The
  // request and command names ({name}, {method}) stay as the other side
  // spelled them.
  stillWaitingSubject: {
    imageRequest: 'the image request',
    providerAnswer: 'the provider answer',
    modelReply: 'the model reply',
    mcpServerStartup: 'MCP server "{name}" startup',
    mcpServerRequest: 'MCP server "{name}" {method}',
    museCodeCommand: 'Muse Code {method}',
    sessionDeletion: 'session deletion',
    shellCommand: 'the shell command',
    museServeStarting: 'muse serve starting',
    webFetch: 'the web page',
    pluginHook: 'the plugin hook',
  },
  userShellLabel: 'You Ran',
  userShellExitCode: 'Exit code {code}',
  userShellExitSignal: 'Ended by signal {signal}',
  userShellRestricted:
    'Shell commands do not run while the workspace is in Restricted Mode. Trust the workspace to run them.',
  userShellNotGranted: 'This Muse Code did not allow shell commands from the panel',
  userShellFailed: 'The command did not run',
  composerShellMode: 'Shell',
  composerShellModeTitle:
    'Runs this command in the workspace, as you. Muse sees the command and what it printed.',
  runCommandTitle: 'Run Command',
  toolImageAlt: 'The image {path}',
  toolImageFailed: 'The image could not be shown',
  // A CLI run that failed without saying why; {code} is the process's own number.
  processExitCode: 'exit code {code}',
  // Where a skill in the Manage Skills pick comes from, keyed by the CLI's scope.
  skillScopes: {
    bundled: 'Built-In',
    user: 'Yours',
    project: 'This Project',
    plugin: 'Plugin',
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
  bundledSkillsNotNow: 'Not Now',
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
  bundledSkillsOfferFailed: 'The bundled skills could not be offered: {reason}',
  // The reason when the folder is there but holds no mark of the extension's install.
  bundledSkillsNotOurs:
    'a folder of that name exists that Muse Spark did not install, so it was left alone',
  bundledSkillsUnavailable:
    'The bundled skills installer could not be loaded; reinstall the extension and reload the window. The log has the details.',
  // What's New after an update (M99, PLAN.md D79): the page's own words (the
  // release notes stay English), the notice after a fixes-only patch, and its
  // buttons. {version}, {from}, {to}: versions such as 0.13.0; {date}: a
  // release's date in the display language.
  whatsNewTitle: 'What’s New in Muse Spark Code',
  whatsNewVersion: 'You’re on version {version}.',
  whatsNewUpdatedFrom: 'Updated from {from} to {to}.',
  whatsNewReleased: 'Released {date}',
  whatsNewHighlights: 'Highlights',
  whatsNewTryIt: 'Try It',
  whatsNewOpenSetting: 'Open the Setting',
  whatsNewNotesInEnglish: 'The release notes are in English.',
  whatsNewNoNotes: 'No release notes ship with version {version}.',
  whatsNewEarlierNotes: 'Earlier notes: see the full changelog',
  whatsNewFullChangelog: 'Full Changelog on GitHub',
  whatsNewReadme: 'README on GitHub',
  whatsNewStarGithub: 'Enjoying Muse Spark Code? A star on GitHub helps other people find it.',
  whatsNewHideOnUpdate: 'Don’t Show on Updates',
  whatsNewUpdatedNotice: 'Muse Spark Code updated to {version}.',
  whatsNewOpen: 'What’s New',
  whatsNewDontShowAgain: 'Don’t Show Again',
  whatsNewUnavailable:
    'What’s New could not be loaded; reinstall the extension and reload the window. The log has the details.',
  whatsNewAttachmentsRefused: '/whatsnew takes no attachments: send it alone.',
  // The conversation's notices (they were English literals in the controller).
  notSignedInReason: 'Sign in before sending a message.',
  noWorkspaceReason: 'Open a folder first; Muse works inside a workspace.',
  nothingToSendReason: 'Type a message or attach an image first.',
  // M92e (PLAN.md D71): a prompt holding a detected secret, held before
  // sending. The transcript card shows the redacted text either way.
  secretPromptTitle: 'This Prompt Contains a Secret',
  secretPromptDetail:
    'A secret was detected. The transcript shows it redacted. Send it anyway, or go back and edit the prompt.',
  secretPromptSendAnyway: 'Send Anyway',
  secretPromptEdit: 'Edit Prompt',
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
  // {reason}: the reviewer's own refusal, such as a managed exclusion.
  permissionReviewerNotInstalled:
    'The permission mode was applied, but its reviewer could not be installed ({reason}). New turns are refused until the mode is set again.',
  // The tear that kept a forward mode change's reviewer from being confirmed,
  // as {reason} for the sentence above: the acknowledgement named the mode,
  // so the mode is known and only the reviewer is missing.
  permissionReviewerTornReason: 'the mode change tore while applying',
  permissionReviewerMissing:
    'New turns are refused: the permission reviewer could not be installed. Set the permission mode again to recover.',
  // {mode}: the wire mode a later mode notice named while turns were
  // refused. The notice installs and removes no reviewer (Plan and Bypass
  // install none), so the sentence names that mode and says turns stay
  // refused until the mode is set again, with no reviewer or tear words.
  permissionModeChangedWhileQuarantined:
    'The permission mode changed to {mode} while new turns were refused. New turns stay refused until the mode is set again.',
  // {mode}: the previous wire mode the torn rollback restored. The profile
  // never changed, so that mode's reviewer is still installed; the adoption
  // itself could not be confirmed, so turns stay refused until a reset.
  permissionReviewerRollbackTorn:
    'The permission mode change tore while applying; the previous mode ({mode}) is restored and its reviewer is still installed, but the adoption could not be confirmed. New turns are refused until the mode is set again.',
  // {mode}: the wire mode the host runs after a torn change (the
  // acknowledged mode on a forward tear, the restored previous mode on a
  // rollback's). The mode installs no reviewer (Plan, Bypass), so the tear
  // must not claim one failed: the mode is in effect, only the adoption is
  // unconfirmed, and turns stay refused until a reset.
  permissionModeTornUnconfirmed:
    'The permission mode change tore while applying; the host runs {mode} but the adoption could not be confirmed. New turns are refused until the mode is set again.',
  permissionReviewerUnknown:
    'The permission mode could not be changed and the mode the host runs is unknown. New turns are refused until the mode is set again.',
  // {reason}: the refusal that stopped the change, in its own words.
  permissionModeKept:
    'The permission mode change did not take ({reason}); the host keeps running its mode.',
  // {reason}: the refusal that stopped the restore, in its own words;
  // {mode}: the wire mode the host still runs (the admission's, with its
  // reviewer), because the conversation's mode never came back.
  permissionRestoreRefused:
    "The conversation's permission mode could not be put back ({reason}); the host still runs {mode}. New turns are refused until the mode is set again.",
  // {action}: the panel's id for a host command, such as `openSettings`.
  hostActionFailed: '{action} failed',
  backendListenerFailed:
    'A backend event listener failed. The operation continued; see the log for details.',
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
  // The Muse Code backend's own bundle (PR206, PLAN.md D6), loaded when that
  // backend first starts.
  museCodeBundleUnavailable:
    'The Muse Code backend could not be loaded; reinstall the extension and reload the window. The log has the details.',
  // Why the Muse Code CLI was not found, on the sign-in page and in warnings.
  cliNotFound: 'Muse Code is not installed in any known location.',
  cliPathNotAbsolute: 'museSpark.museBinaryPath must be an absolute path.',
  cliSearched: 'Searched: {paths}',
  // The ACP agent in other editors (M63, PLAN.md D61, D62): its sign-ins,
  // the key's commands, its errors and its help.
  acpAuthMuseCodeName: 'Sign In to Muse Code',
  acpAuthMuseCodeDetail:
    'Runs Muse Code’s own sign-in in a terminal. Your Muse subscription pays for the conversations.',
  acpAuthKeyName: 'Store a Meta Model API Key',
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
  // An unavailable store cannot prove whether it contains a key (F43/F47).
  acpStoreDown:
    'This computer’s credential store is unavailable, so stored keys cannot be checked.',
  acpKeyCleared: 'The Meta Model API key was removed from this computer’s credential store.',
  // {reason}: the operating system's own error.
  acpOutsideWorkspaceRefused:
    'Outside the workspace; nothing was read or written. Approval cannot widen workspace access.',
  // {path}: the refused path or search pattern, as the user wrote it.
  acpRefusalOutsideWorkspace: 'Path {path} is outside the workspace; nothing was read or written.',
  acpRefusalLinkEscape:
    'Path {path} leads outside the workspace through a link; nothing was read or written.',
  acpCredentialStoreNoAnswer:
    'The credential store did not answer. This request was not sent; try again.',
  acpStoreUnavailable:
    'This computer’s credential store cannot be used ({reason}). On Linux the agent needs a running, unlocked Secret Service, such as GNOME Keyring or KWallet.',
  acpStoreNames: {
    windows: 'Windows Credential Manager',
    macos: 'the macOS Keychain',
    linux: 'the Secret Service keyring',
  },
  acpNoModels: 'The backend offers no model this agent may use.',
  acpPromptBusy: 'A prompt is already running in this session.',
  // {detail}: the failure's fixed-vocabulary cause (an error name, code or kind).
  acpSessionStartFailed:
    'The session could not be started ({detail}). The Muse Spark log has the details.',
  // {detail}: the failure's fixed-vocabulary cause (an error name, code or kind).
  acpTurnStartFailed:
    'The turn could not be started ({detail}). The Muse Spark log has the details.',
  createdRegistrySave: {
    // {reason}: why the save failed, one of the clauses below.
    failed:
      'The created-resources registry could not be saved ({reason}). The Muse Spark log has the details.',
    refused: 'the system helper refused the save',
    unsafe: 'a safety check on the saved registry failed',
    invalid: 'the saved registry was invalid',
    io: 'the save could not be written',
  },
  acpQuestionFormMessage: 'Muse has a question for you.',
  acpQuestionAsked:
    'Muse has a question; this editor cannot show it as a form, so answer in your next message:',
  acpUnknownArgument: 'Unknown argument: {argument}',
  // {command}: the slash command as typed. {commands}: the nearest known
  // commands. A message starting with \/ sends a literal leading slash.
  acpUnknownCommand: String.raw`Unknown command {command}. Nearest commands: {commands}. Send /help for the full list. To send a message starting with a slash, start it with \/.`,
  // {topic}: the /help topic as typed.
  acpHelpUnknownTopic: 'No help for {topic}. Send /help for the command list.',
  // The /help footer for slash handling: unknown commands stay local, and
  // \/ sends a literal leading slash.
  acpCommandHelpNote: String.raw`A slash message the agent does not know is answered here, never sent to the model. /help <command> explains one command. To send a literal leading slash, start the message with \/.`,
  // {argument}: the paid feature's flag as typed.
  acpPaidNeedsModelApi: '{argument} needs --backend modelApi: paid features bill a Model API key.',
  // {argument}: the subscription flag as typed.
  acpSubscriptionNeedsModelApi:
    '{argument} needs --backend modelApi: the Muse Code subscription pays for Model API calls.',
  execSubscriptionStdin:
    '--subscription and --key-stdin cannot be combined: one credential per run.',
  // {command}: the executable's name. The options and values stay as typed.
  acpFontUi: 'UI Font',
  acpFontCode: 'Code Font',
  acpFontLigatures: 'Code Ligatures',
  acpFontSystem: 'System Font',
  acpFontInstalled: 'Font pack installed: {directory}',
  acpFontIntegrity: 'Font asset failed verification: {file}',
  acpFontInstallFailed: 'The font pack could not be installed.',
  acpFontsUsage: 'Usage: {command} fonts install [--from <directory>]',
  acpUsage: [
    'Usage:',
    '  {command} [options]              Serve the Agent Client Protocol on stdin and stdout',
    '  {command} [options] login        Sign in to Muse Code in this terminal',
    '  {command} auth set|status|clear  Store, check or remove the Meta Model API key',
    '  {command} auth set|status|clear --provider <id>  Store, check or remove a provider key (read from stdin)',
    '  {command} providers list|add|test|remove|connect|usage <id>  Manage model providers',
    '  {command} exec [options] <prompt>  Run one headless turn',
    '  {command} scan-secrets <file> [--key-stdin]  Count likely secrets in one file (prints only the number; exits 0 when clean, 10 when a secret is found, 2 for misuse)',
    '  {command} report [options]  Print a scrubbed problem report (starts no backend, opens no browser)',
    '  {command} legal [options]  Run the read-only legal scan (no backend, no sign-in)',
    '  {command} fonts install [--from <directory>]  Install the optional fonts for standalone surfaces',
    '  {command} playbook <status|record|settings ...>  Show or change the orchestrator playbook (starts no backend)',
    'Options:',
    '  --backend museCode|modelApi      Who pays: Muse Code (the default) or the Model API key',
    '  --trust-workspace                Load the folder’s rules, skills and memory',
    '  --muse-binary <path>             The Muse Code CLI to run',
    '  --shell-sandbox auto|muse|off    Muse Code’s shell sandbox',
    '  --questions-defer-after <seconds>  Defer questions after this many seconds; no limit unless you set one (0, the default, never defers)',
    '  --allow-dangerously-skip-permissions  Offer the Bypass permissions mode',
    '  --allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    '  --web-search                     Offer paid web search (Model API backend; its price is asked first)',
    '  --image-generation               Offer paid image generation (Model API backend; its price is asked first)',
    '  --muse-voice                     Offer paid Muse Voice transcription of attached sound (Model API backend; its price is asked first)',
    '  --subscription                   Drive the Model API backend with the Muse Code subscription instead of a key',
    '  --no-auto-compaction             Disable automatic compaction',
    '  --verbose                        Log every detail on stderr',
    '  --help, --version',
    '  {command} --trust-workspace setup [--maintenance]  Run the Setup hooks and exit',
  ].join('\n'),
  // Report a problem headless (M93 lane A, PLAN.md D72): `report --help`
  // and bad report arguments print this on stderr, never the report itself.
  // {command}: the executable's name. <file> and <text> stay as typed.
  reportUsage: [
    'Usage:',
    '  {command} report [--out <file>] [--description <text>] [--no-facts] [--no-events]',
    '  Prints the scrubbed problem report to stdout, or writes it to <file> with --out.',
    '  Starts no backend, signs in nowhere, and opens no browser.',
    'Options:',
    '  --out <file>         Write the report to a file instead of stdout',
    '  --description <text>  What was happening, in your own words',
    '  --no-facts           Leave the support facts out',
    '  --no-events          Leave the recent events out',
  ].join('\n'),
  // The terminal agent's own help (PLAN.md D120): one topic per command,
  // generated from the parser's option table, so help cannot drift from
  // what the parser accepts. {command}: the executable's name; {cmd} and
  // {topic}: the command as typed. Option names and values stay as typed.
  cliHelp: {
    usage: 'Usage:',
    options: 'Options:',
    examples: 'Examples:',
    exits: 'Exits:',
    commands: 'Commands:',
    // {command}: the executable's name.
    topHint: "Run '{command} help <command>' for one command's own options and examples.",
    // {command}: the executable's name.
    allHint: "'{command} help --all' prints the full Help & Reference.",
    // {value}: the default, as typed.
    defaultIs: 'default {value}',
    // {value}: the bound with its unit, as typed.
    atMost: 'at most {value}',
    // {values}: the accepted values, as typed.
    accepts: 'accepts {values}',
    repeatable: 'repeatable',
    // {option}: the option as typed; {cmd}: the command; {accepted}: its options.
    unknownOption: "Unknown option {option} for '{cmd}': {cmd} accepts {accepted}.",
    // {cmd}: the command; {accepted}: its options. A secret-looking name is
    // never repeated: the refusal says only what the command accepts.
    unknownOptionHidden: "Unknown option for '{cmd}': {cmd} accepts {accepted}.",
    // {nearest}: the closest valid option, as typed.
    suggestOption: "Did you mean '{nearest}'?",
    // {command}: the executable's name; {topic}: the command.
    seeHelp: "See '{command} {topic} --help'.",
    // {topic}: the unknown command; {command}: the executable's name.
    unknownTopic: "Unknown command '{topic}': run '{command} help' for the command list.",
    purposeServe: 'Serve the Agent Client Protocol on stdin and stdout.',
    purposeLogin: 'Sign in to Muse Code in this terminal.',
    purposeAuth: 'Store, check or remove keys in this computer’s credential store.',
    authSetNote:
      'auth set reads the key from standard input (your terminal, or a pipe); auth status prints whether a key is stored, never the key itself.',
    purposeProviders: 'Manage model providers and their model lists.',
    purposeExec: 'Run one headless turn.',
    purposeScanSecrets: 'Count likely secrets in one file (prints only the number).',
    purposeReport: 'Print a scrubbed problem report.',
    purposeLegal: 'Run the read-only legal scan.',
    purposeFonts: 'Install the optional fonts for standalone surfaces.',
    purposePlaybook: 'Show or change the orchestrator playbook, or run one of its check commands.',
    purposeLsp:
      'Serve Tab completions to an editor over the Language Server Protocol on stdin and stdout.',
    noteLsp:
      'Without --tab nothing is billed and the credential store is never read. With it, each new price asks in the editor first; Allow Always is offered only with --trust-workspace.',
    purposeSupervise:
      'Run another command of this agent so that stop can end it, with every process it started.',
    purposeStop: 'Stop every supervised run started in this folder, with every process it started.',
    purposePanel:
      'Serve an editor’s Muse panel host over MHP: this agent’s settings and storage, for the folder it starts in.',
    notePanel:
      'A setting written here is the one this agent itself reads: user settings stay in the data folder’s settings.json and resources.json. Settings that choose what runs or what is billed are yours alone and refuse the workspace scope. No key or token is ever stored.',
    purposeSetup: 'Run the Setup hooks and exit.',
    purposeUsage: 'Show usage and cost across models.',
    purposeResources: 'Show machine pressure and recent history.',
    purposeShare: 'Share a conversation: copy it, save it to a file, or open it in a browser.',
    purposePrompts: 'Save, list, use and share reusable prompt templates.',
    purposeJudge: 'Ask Muse Judge for verdicts on standard input.',
    judgeServeLintNote:
      'serve and lint take their own flags; the options below belong to ask, calibrate, report and mcp.',
    // {entry}: the provider entry id.
    modelsList: 'Models for {entry}:',
    // {reason}: the user's one-line reason for forcing the model.
    modelsForced: 'forced: {reason}',
    modelsExtra: 'On the provider but not in the entry:',
    modelsUnreadable: 'The provider list could not be read; showing the entry only.',
    // {models}: the model ids; {entry}: the provider entry id.
    modelsAdded: 'Added {models} to {entry}.',
    // {models}: the model ids; {entry}: the provider entry id.
    modelsRemoved: 'Removed {models} from {entry}.',
    // {model}: the unknown id; {entry}: the entry; {closest}: the closest ids.
    modelsUnknown: "Unknown model '{model}' for {entry}; the closest matches are: {closest}.",
    // {entry}: the unknown id; {closest}: the configured entry ids.
    modelsUnknownEntry: "Unknown provider entry '{entry}'; configured entries are: {closest}.",
    modelsNeedsForce: "Use --force '<reason>' to add a model the provider does not list.",
    modelsForceNeedsAdd: '--force needs --add: only added models can carry a reason.',
    modelsCustomReadOnly:
      'Custom provider model lists are read-only here; use the Models panel to set each model’s context window and output cap.',
    // {command}: the executable's name.
    modelsUsage:
      'Usage: {command} providers models <entry> [--add <model>] [--remove <model>] [--force <reason>]',
  },
  // M80 (PLAN.md D65): the headless exec and scan-secrets commands.
  execProgressStarted: 'Request {request} started; {reserved} reserved.',
  execProgressSettled:
    'Request {request} ended; run input {input}, output {output}; {settled} spent, {uncertain} uncertain.',
  execProgressTokens: forms({ one: '{count} token in total', other: '{count} tokens in total' }),
  execTokenCount: forms({ one: 'at most {count} token', other: 'at most {count} tokens' }),
  execBudgetQuote:
    'Input {inputTokens} ({inputCost}) + output cap {outputTokens} ({outputCost}) = {estimate}; run cap {cap}, {spent} used. Request not sent.',
  execBudgetMinimum: 'This run requires at least {minimum}.',
  execBudgetRequired: 'Model API requires --max-budget-usd.',
  execNumberInvalid: 'Invalid number or limit; the USD budget accepts at most six decimal places.',
  // {option}: the option as typed; {help}: the help that lists its accepted
  // values, as typed (`serve --help`).
  cliValueInvalid: 'Invalid value for {option}; run {help} for the accepted values and bounds.',
  execLimitInvalid: 'Invalid number or limit for {flag}.',
  execTrustRefused: 'Headless runs refuse workspace trust and bypass permissions.',
  execModeRefused: 'Headless runs permit only plan or acceptEdits.',
  execWebSearchUnbounded: 'Hosted web search has no bounded allowance and is refused.',
  execPaidNeedsEdits: 'Image generation requires acceptEdits.',
  // {options}: the refused command-line options as typed, joined by commas.
  execModelApiOnly: 'These options require the Model API backend (--backend modelApi): {options}.',
  execTeamNeedsEdits: '--team needs --permission-mode acceptEdits.',
  execTeamWorkerUnsupported: 'Headless teams run only engine workers; {kind} cannot run in CI.',
  execTeamConfigInvalid: 'Headless team configuration is invalid: {reason}.',
  execTeamConfigNotJson: 'team.json is not JSON.',
  execTeamConfigNotObject: 'team.json must hold a single object.',
  execTeamConfigLowersOnly:
    'team.json entry {entry} is not allowed: the workspace file can only lower existing limits.',
  execTeamConfigBadEntry: 'team.json entry {entry} is not valid.',
  execTeamStateUnreadable:
    'The stored headless team cannot be read; check the workspace team file.',
  execTeamReviewerUnsupported:
    'team.json requires reviewer {entry}; this runner offers only code review.',
  execTeamMergeMarkers:
    'The branch still shows conflict markers at {detail}; resolve them and merge again.',
  execTeamMergeHeldProtected:
    'Protected paths need approval, so the branch is held at {ref}. Approve them and merge again, or remove {ref} to discard the work.',
  execTeamMergeHeldReview:
    'The required review is not complete, so the branch is held at {ref}. Collect the review and merge again, or remove {ref} to discard the work.',
  execTeamMergeBlocked: 'The merge cannot proceed for task {entry}: {detail}.',
  // {options}: the refused command-line options as typed, joined by commas.
  execMuseCodeOnly:
    'These options require the Muse Code backend, the default without --backend modelApi: {options}.',
  execModelUnpriced: 'This model has no known tariff.',
  execPromptMissing: 'Provide one nonempty prompt.',
  execPromptTwice: 'Choose exactly one prompt source.',
  execStdinTwice: 'Prompt and key cannot both use stdin.',
  execKeyStdinTerminal: 'Read the key from a pipe, not a terminal.',
  execKeyMissing: 'No valid Model API key was provided.',
  execKeyTooLong: 'The key exceeds the byte limit.',
  execFileUnreadable: 'The input file cannot be read.',
  execFileTooLarge: 'The input exceeds the byte limit.',
  execFileEmpty: 'The input file is empty.',
  execTooManyChunks: 'The input exceeds the chunk limit.',
  execUnknownModel: 'This model is not available for this run.',
  execEffortUnavailable: 'This effort is not available for this model.',
  execFastUnavailable: 'Fast is not available for this model.',
  // {tier}: a served effort tier outside the extension's vocabulary, by its catalogue name or description.
  effortTierUnsupported:
    '{tier} cannot be selected: the extension does not support this effort tier.',
  modelNotOnProvider: 'Model "{model}" is not offered by provider "{provider}". {remedy}',
  modelNotInSession:
    'Model "{model}" is not offered in this session. Choose one of the models offered instead.',
  unknownModelListModels: 'Run "{command}" to see the models it offers.',
  unknownModelPickOffered: 'Choose one of the models offered instead.',
  chatPartNotSupported: 'The "{kind}" part cannot be sent to this model.',
  effortNotForModel:
    'Effort "{effort}" is not available for model "{model}". Use one of: {levels}.',
  effortNoneForModel:
    'Effort "{effort}" is not available for model "{model}": it offers no effort levels.',
  execTimedOut: 'The run reached its deadline.',
  execBudgetRefused: 'The next request exceeds the remaining budget.',
  // EXECPROV round 5: a budget refusal names both remedies with numbers. The
  // cap remedy is a complete clause on its own, so ACP and the editor show
  // the same reason through the shared scope without the terminal-only flag
  // half. {admitCap} is the cap that admits the request, rounded up to the
  // cent; {maxTokens} is the largest --max-output-tokens value that fits the
  // remaining cap; {inputCost} and {remaining} feed the input-alone note.
  execBudgetRemedyCap: 'Raise --max-budget-usd to at least {admitCap} to admit it.',
  execBudgetRemedyOutput: 'Or retry with --max-output-tokens {maxTokens}.',
  execBudgetRemedyInput: 'The input alone costs {inputCost}, above the {remaining} left.',
  // EXECPROV round 6: the provider variant states the rule, since its
  // first body is not built yet ({output} is the output cap every request
  // reserves).
  execBudgetStartRule:
    'Capped run: cap {cap}, {remaining} left. Each request reserves its counted input plus up to {output} output tokens.',
  // EXECPROV round 7 (R2): a wire with no counter reserves the byte
  // bound, and the start line says so — never "counted input".
  execBudgetStartBytes:
    'Capped run: cap {cap}, {remaining} left. Each request reserves its byte-bound input plus up to {output} output tokens.',
  // A budget stop with nothing produced yet: the run was still reading, so
  // no answer exists. The remedies follow as their own sentences.
  execBudgetStillReading:
    'The budget stopped the run while it was still reading, so no answer exists yet.',
  // An exact provider count was tried and failed: the fixed reason the byte
  // bound is used instead. The provider's own error never reaches this line.
  execCountBytesFallback:
    'The provider input count failed, so the byte bound reserves this request instead.',
  // The same fallback with the redacted HTTP failure named: {status} is the
  // count answer's status, {type} its error type. Never content.
  execCountBytesFailed:
    'The provider input count failed (HTTP {status}, {type}), so the byte bound reserves this request instead.',
  // An exact provider count larger than the request itself was rejected:
  // its own reason the byte bound is used instead.
  execCountBytesOverLength:
    'The provider input count exceeded the request size, so the byte bound reserves this request instead.',
  // A --max-output-tokens value above the policy cap is refused at parsing.
  // {cap} is the absolute ceiling every policy cap sits at or below.
  execOutputCapExceeded: '--max-output-tokens exceeds the output cap of {cap} tokens.',
  // EXECPROV round 5 (5a): a missing price is not a budget stop. {model} is
  // the requested ref; {file} is the runner's own providers file, where a
  // price for the model is added. The second sentence is the backend without
  // a providers file.
  execUnpricedProvider:
    'This model has no known tariff, so a capped run cannot reserve for {model}. Add a price for this model in {file}, or choose a priced model.',
  execUnpricedModel:
    'This model has no known tariff, so a capped run cannot reserve for it. Choose a priced model.',
  // D1, D208: a daily stop names its numbers: the request's estimate, the
  // limit the person set, what is spent today, when the day resets, and the
  // setting that raises it. Nothing is held, so nothing else is counted.
  execPaidDailyStopped:
    'Stopped: the next request (about {estimate}) would pass the daily budget of {cap} ({spent} used today). It was not sent. The budget resets {reset}; raise {setting} to continue.',
  // D3: a budget-stopped turn keeps its work; the final message says what was
  // reached ({count} is the completed request count).
  execBudgetProgress: forms({
    one: 'The budget stopped the run after {count} request; work so far is kept.',
    other: 'The budget stopped the run after {count} requests; work so far is kept.',
  }),
  // D4: three causes, three sentences. {available} names what can run.
  execModelNeedsProvider:
    'Model {model} belongs to provider {provider}; run again with --provider {provider}. Available models: {available}.',
  execModelNotOnProvider:
    'Model {model} is not on provider {provider}. Available models: {available}.',
  execModelAvailable:
    'Model {model} is not available on this backend. Available models: {available}.',
  execBudgetOverage:
    'The last request exceeded its reservation by {overage} ({cost} charged, {reserved} reserved). The run stopped before another request.',
  execBudgetBreach: 'Observed accounting exceeded its reservation.',
  execIncomplete: 'The response did not complete.',
  execIncompleteTransport:
    'The connection to the model was lost. The session is kept and can be resumed.',
  turnPausedNetwork:
    'Paused: the model connection was lost at {time}; attempt {attempt}, retrying.',
  turnPausedNetworkCapped:
    'Paused: the model connection was lost at {time}; attempt {attempt} of {cap}, retrying.',
  nodeLivenessOnline: 'Online',
  nodeLivenessOffline: 'Offline',
  nodeLivenessUnreachable: 'Unreachable since {time}, retrying',
  nodeWaitingRow:
    'Waiting: {node} unreachable since {time}, retrying, attempt {attempt}, next in {delay}',
  packsVerifyUnavailable: 'Pack verification is unavailable in this build.',
  peekSlashDescription: "Peek at an agent's event stream (read-only).",
  peekUsage: '/peek [agent-id]',
  peekNoAgents: 'No agents are running in this session.',
  peekUnknownAgent: 'Unknown agent: {id}',
  peekAttachmentsRefused: '/peek takes no attachments: send it alone.',
  toolchainsFeatureName: 'Toolchains',
  referenceToolchains: 'The toolchains installed on this machine, with their versions.',
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
    timeout: 'Timed Out',
    budget_exceeded: 'Budget Exceeded',
    unpriced: 'Unpriced',
    request_cap: 'Request Cap Reached',
    denied: 'Denied',
    auth_required: 'Authentication Required',
    backend_unavailable: 'Backend Unavailable',
    internal: 'Internal Error',
    accounting_unverified: 'Accounting Unverified',
  },
  execTooManyFiles: forms({
    one: 'At most {count} input file is allowed.',
    other: 'At most {count} input files are allowed.',
  }),
  referenceTurnLimit:
    'No round count of ours ends a Model API turn: it runs until the model answers without a tool call, you press Stop, a hook stops it, the provider refuses it, or a limit you set is spent. A caller allowance still bounds its run: exec --max-requests, or a best-of-N attempt ceiling. The first call always runs with tools: an answer completes the turn, a tool request ends it at the request cap. The last call of a capped turn that ran tools answers without tools and completes with max_turn_requests (headless exec reports request_cap, exit 5); send a message to continue.',
  modelApiWrapUpReserved:
    'The remaining request is reserved for the final answer. The image was not generated.',
  modelApiTurnLimit: forms({
    one: 'The turn stopped after {count} model call. Send a message to continue.',
    other: 'The turn stopped after {count} model calls. Send a message to continue.',
  }),
  modelApiWrapUpTruncated: forms({
    one: 'The turn stopped after {count} model call with the final answer cut short by the output limit. The partial answer is kept. Send a message to continue.',
    other:
      'The turn stopped after {count} model calls with the final answer cut short by the output limit. The partial answer is kept. Send a message to continue.',
  }),
  modelApiWrapUpHookBlocked:
    'A stop hook asked for more work, but the turn reached its model-call limit, so the final answer stands.',
  modelApiWrapUpFailed: forms({
    one: 'The turn stopped after {count} model call, but the final summary could not be produced ({reason}).',
    other:
      'The turn stopped after {count} model calls, but the final summary could not be produced ({reason}).',
  }),
  modelApiWrapUpFailedReason: {
    rateLimited: 'rate limited',
    modelError: 'model error',
    budget: 'budget stop',
    stopped: 'stopped',
  },
  execRequestCapReached: forms({
    one: 'The request cap of {count} attempt was reached.',
    other: 'The request cap of {count} attempts was reached.',
  }),
  // M95 lane X (PLAN.md D74): the ACP agent's provider commands. Every key
  // below also lives in all 14 `l10n/ui.*.json` tables.
  // {provider}: the provider id; {store}: where the key lives; {origin}: the bound origin.
  providerKeyStored: 'The {provider} key is stored in {store}.',
  providerKeyNotStored: 'No key was entered, so nothing was stored.',
  providerKeyNotText: 'That input is not text (it is not valid UTF-8), so it was not used.',
  providerKeyPresent: 'The {provider} key is stored in {store}, bound to {origin}.',
  providerKeyAbsent: 'No {provider} key is stored.',
  providerKeyCleared: 'The {provider} key was removed from this computer’s credential store.',
  // {provider}: the id as typed.
  providerUnknown: 'Unknown provider: {provider}.',
  // A pasted provider key is never refused for its looks; each notice is
  // a question the person answers ("use it anyway?"), never a dead end.
  providerKeyNoticeWhitespace: 'This key contains a space or line break. Use it anyway?',
  providerKeyNoticeUrl: 'This looks like a web address, not a key. Use it anyway?',
  providerKeyNoticePath: 'This looks like a file path, not a key. Use it anyway?',
  providerKeyNoticePlaceholder: 'This looks like placeholder text, not a key. Use it anyway?',
  providerKeyNeeded: '{provider} needs its key from stdin (--key-stdin).',
  providerNotConfigured: '{provider} is not configured; add it with providers add first.',
  providerSecretUnreadable: 'The stored {provider} credential cannot be read; enter the key again.',
  // M95c part 6: a provider’s custom request headers (editor pickers and `providers headers`).
  providerHeaders: {
    button: 'Request Headers',
    pick: 'Request headers for {provider}',
    add: 'Add a header…',
    name: 'Header name, for example OpenAI-Project',
    value:
      'Value for {name}, sent only to {origin}. It is kept in your credential store and never shown again.',
    nameInvalid:
      'A header name uses letters, digits and the symbols ! # $ % & * + - . ^ _ | ~ only.',
    nameReserved: '{name} is sent by Muse Spark Code itself and cannot be set here.',
    valueInvalid: 'A header value is one line of printable characters.',
    unreadable: 'The stored request headers for {provider} cannot be read; set them again.',
    none: 'No request headers are set for {provider}.',
    list: '{provider} sends these request headers: {names}.',
    usage:
      'Usage: {command} providers headers <id> [set|unset <name>]; a value is read from standard input.',
  },
  // {reason}: the technical detail (a file error or a refused write).
  providerSaveFailed: 'Could not save the providers file ({reason}).',
  // {stored}: the origin the credential was stored for; {current}: where the provider points now.
  providerOriginMismatch:
    'The {provider} credential was stored for {stored} but the provider now points at {current}; enter the key again.',
  providersNoneFound: 'No providers are configured.',
  // {origin}: the exact origin the code goes to.
  providerAdded: 'Added {provider}; code goes to {origin}.',
  providerAlreadyConfigured: '{provider} is already configured; remove it first to add it again.',
  // {count}: the models the free check listed.
  providerTestOk: forms({
    one: 'Key works · {count} model.',
    other: 'Key works · {count} models.',
  }),
  // `providers refresh`: {provider}: the entry id; {models}: the added ids.
  providerRefreshAdded: forms({
    one: 'Stored 1 new model on {provider}: {models}.',
    other: 'Stored {count} new models on {provider}: {models}.',
  }),
  // {provider}: the entry id; {models}: filed ids the live list lacks.
  providerRefreshMissing: 'Still configured on {provider} but no longer listed: {models}.',
  // {provider}: the entry id.
  providerRefreshCurrent: forms({
    one: '{provider} is already current: 1 model.',
    other: '{provider} is already current: {count} models.',
  }),
  // Refresh on use: {model}: the native model id; {provider}: the entry id.
  providerModelStoredOnUse: 'Stored {model} on {provider} from the provider’s live list.',
  providerModelStoreFailed:
    'Could not store {model} on {provider}; this run proceeds without updating the file.',
  // {model}: the `<provider>/<model>` ref whose tool calling is unconfirmed.
  providerModelNoToolCalling:
    '{model} cannot run the coding agent because tool calling is not confirmed for it.',
  providerAddPickModel: 'Add one or more of these models with --model <id> (repeatable):',
  providerAddNeedsModel: 'Pass at least one model with --model <id> (repeatable).',
  providerProbeUnreachable: 'The provider could not be reached.',
  providerProbeUnparseable: 'The model list could not be read.',
  providerProbeNoKey: 'No key was supplied.',
  providerProbeRebinding: 'The address changed networks; the request was refused.',
  // Lane PROVERR: what a person reads when a configured provider answers a
  // request with a refusal. {provider}: the provider's display name;
  // {detail}: the provider's own words, quoted as theirs; {wait}: '' or the
  // localized wait the provider named; {status}: the HTTP status.
  providerRefusalCredit:
    '{provider} refused the request: its account is out of credit. Add credit at {provider}; nothing reached a model and nothing was charged for this request. {provider} said: {detail}',
  providerRefusalAuthentication:
    '{provider} refused the request: the stored key was rejected. Store a new {provider} key from Models & Agents; nothing reached a model and nothing was charged. {provider} said: {detail}',
  providerRefusalPermission:
    '{provider} refused the request: the key has no permission for this. Check the key’s permissions at {provider}; nothing reached a model and nothing was charged. {provider} said: {detail}',
  providerRefusalNotFound:
    '{provider} refused the request: it has no such model. Pick a model {provider} lists; nothing reached a model and nothing was charged. {provider} said: {detail}',
  providerRefusalContentFilter:
    '{provider} refused the request: its content filter blocked it. Rephrase without the flagged content and try again; nothing reached a model and nothing was charged for this request. {provider} said: {detail}',
  providerRefusalRateLimited:
    '{provider} refused the request for now: too many requests{wait}. Try again shortly; nothing was charged for this refusal. {provider} said: {detail}',
  // Lane PROVERRORS: a usage window, fair-use limit or expired plan (Z.ai's
  // 1308-1321). The provider's own words carry the reset time it names.
  providerRefusalUsageLimit:
    '{provider} refused the request: the account’s plan or usage limit does not allow it now, so it was not retried. Nothing was charged for this refusal. {provider} said: {detail}',
  providerRefusalOverloaded:
    '{provider} refused the request: it is overloaded{wait}. Try again shortly; nothing was charged for this refusal. {provider} said: {detail}',
  providerRefusalInvalidRequest:
    '{provider} refused the request: the request was invalid; nothing was charged. {provider} said: {detail}',
  providerRefusalTooLarge:
    '{provider} refused the request: it was too large. Shorten the conversation or attachments and try again; nothing was charged. {provider} said: {detail}',
  providerRefusalServerError:
    '{provider} failed to answer: a server error on its side. Try again shortly. {provider} said: {detail}',
  providerRefusalStreamError:
    '{provider} stopped answering with an error. Try again; the request may have been charged — check usage at {provider}. {provider} said: {detail}',
  providerRefusalUnrecognised:
    '{provider} answered with an error this build does not recognise (HTTP {status}). Try again; the request may have been charged — check usage at {provider}. The answer began: {detail}',
  // {seconds}: the wait the provider named, in seconds.
  providerRefusalWait: ' (retry after {seconds})',
  // {id}: the provider's request id, for its support (lane PROVERRORS).
  providerRefusalRequestId: ' (request id {id})',
  // {provider}: the provider's display name; {detail}: Node's own failure
  // codes (ECONNRESET, ENOTFOUND, …), never what a server wrote.
  // Round 2, finding 7: the connection failed, and whether the request
  // arrived is unknown — never "nothing was sent".
  providerUnreachable:
    'Could not reach {provider}: the connection failed ({detail}), so whether the request arrived is unknown; check the network and the provider address.',
  // Lane PROVERRORS: {provider} answered 200 and the connection was lost
  // while its reply came; {detail}: Node's own failure codes.
  providerConnectionLost:
    'The connection to {provider} was lost after it accepted the request ({detail}). The reply is incomplete, and the request may have been charged — check usage at {provider}.',
  // Round 2, finding 6: each cause a person can meet has its own sentence;
  // slots carry technical values only (ids, origins, paths), never prose.
  // {entry}: the provider entry id; {preset}: the preset id as typed.
  configuredProviderUnknownPreset:
    'The {entry} provider entry names the preset {preset}, which does not exist. Pick a preset in Models & Agents.',
  // {entry}: the provider entry id; {auth}: the auth kind as stored.
  configuredProviderUnsupportedAuth:
    'The {entry} provider entry uses {auth}, which this build does not support. Set an API key in Models & Agents.',
  // {entry}: the provider entry id.
  configuredProviderMissingAddress:
    'The {entry} provider entry has no address. Enter the provider address in Models & Agents.',
  // {entry}: the provider entry id.
  configuredProviderStoredKeyMissing:
    'The {entry} provider entry has no stored key. Store the key in Models & Agents.',
  // {entry}: the provider entry id; {model}: the model id as listed.
  configuredProviderUnusableModelsEntry:
    'The {entry} provider entry lists the model {model} with no usable data. Scan again in Models & Agents.',
  // {model}: the model id as entered.
  configuredProviderContextWindowUnset:
    'The {model} model needs its context window set. Set it in Models & Agents.',
  // {entry}: the provider entry id; {address}: the offending origin or path.
  configuredProviderAddress:
    'The {entry} provider entry points at {address}, which cannot be used here. Check the address in Models & Agents.',
  // {entry}: the provider entry id.
  configuredProviderChangedDuringRequest:
    'The {entry} provider entry changed while the request was prepared. Try again in Models & Agents.',
  // {entry}: the provider entry id; {detail}: the technical invariant.
  configuredProviderDefect:
    'The {entry} provider entry cannot be used because of a product defect ({detail}). Report it with Models & Agents.',
  mainServiceUnavailable:
    'The main Muse Spark service is not set up in this run, so that model cannot be answered here.',
  // {provider}: the provider's display name.
  providerStreamTooLarge:
    'The {provider} answer was larger than this build reads, so the request was stopped.',
  modelApiProvidersMissing: 'Models & Agents providers were not included in this build.',
  modelsPanelPartMissing:
    'That Models & Agents action is not wired into this panel; use the full panel.',
  providerSaveSecretFailed: 'The credential store operation failed.',
  providerSaveWriteConflict: 'The file could not be written or changed during saving; retry.',
  providerEditConflict: 'A field you edited changed elsewhere. Reload the form before saving.',
  providerSaved: 'Provider saved.',
  providerKeySaved: 'Key saved.',
  providerDefaultSaved: 'Default model saved.',
  providerBudgetSaved: 'Spending limit saved.',
  providerKeySaveFailed: 'The key was not saved: {detail}. Enter it again.',
  providerDefaultSaveFailed: 'The default model was not changed: {detail}.',
  providerComposerSaveFailed: 'The current conversation’s model was not changed: {detail}.',
  providerDefaultSkipped: 'The default model was not changed.',
  providerBudgetSkipped: 'The spending limit was not changed.',
  providerComposerSkipped: 'The current conversation’s model was not changed.',
  providerRefreshFailed: 'The panel could not refresh — reopen it.',
  providerSavedRefreshFailed: 'Provider saved; the panel could not refresh — reopen it',
  providerSaveBusy: 'Another provider update is running or its lock could not be acquired; retry.',
  providerSaveRecoveryFailed:
    'Saving failed and the {provider} credential could not be restored. Check auth status and re-enter or clear its key before retrying.',
  providerTestOkKey: 'Key works.',
  // {reason}: why the test failed, in plain words.
  providerPaidTest:
    '{provider} has no free check; add it from the Models & Agents panel, where the test cost is asked first.',
  // {origin}: the private-network address, asked once before it is saved.
  providerPrivateNeedsConfirm:
    '{origin} is on a private network; re-run with --private-ok to confirm.',
  // {reason}: the endpoint policy's refusal.
  providerEndpointRefused: 'That address cannot be used ({reason}).',
  providerNoRequestPath: '{provider} cannot run here yet; its wire capture is still pending.',
  // D4: a listed model without a price card cannot run; add/test/list say why.
  providerModelNoPrice: '{ref} cannot run: it has no price card, so no run can reserve for it.',
  execProviderNeedsModelApi: '--provider needs --backend modelApi.',
  execProviderModelRequired: 'This provider run needs --model provider/model.',
  // {provider}: the provider id the run asked for.
  execProviderNotReady:
    'Provider runs need the provider transport lane; request validation passed for {provider}.',
  execUsage: 'exec [options] <prompt> | exec [options] --prompt-file <path> | exec [options] -',
  execScanUsage: 'scan-secrets <file> [--key-stdin] [--timeout <seconds>]',
  scanSecretsExits: 'Exits 0 when clean, 10 when a secret is found, 2 for misuse.',
  execExits:
    'Exits 0 completed, 1 internal, 2 usage, 3 sign-in or backend unavailable, 4 failed, 5 budget or request limit, 6 timeout, 7 denied, 8 incomplete, 9 accounting unverified, 10 output schema mismatch, 130 on SIGINT, 143 on SIGTERM.',
  reportExits: 'Exits 0 when the report is written, 1 on failure, 2 for misuse.',
  // From LEGAL_EXIT (D76): 0 a complete scan with no blockers, 1 a complete
  // scan with blockers, 2 incomplete coverage, bad input or failure.
  legalExits:
    'Exits 0 when the scan completes with no blockers, 1 when blockers are found, 2 for incomplete coverage or misuse.',
  // The CLI-wide convention (CLI_EXIT) for commands with no exit table.
  genericExits: 'Exits 0 on success, 1 on failure, 2 for misuse.',
  // share/prompts: a cancelled or refused share is EXEC_EXIT.denied (7).
  sharingExits: 'Exits 0 on success, 7 when cancelled or refused, 2 for misuse, 1 on failure.',
  // The playbook's own exits (CLI_EXIT): `run` passes the check's exit code through.
  playbookExits:
    'Exits 0 on success, 1 on failure, 2 for misuse; run exits with the check’s own exit code.',
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
  exportShellHeading: 'Shell Command',
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
  // A failed turn the CLI judged resubmittable (TurnError.retryable): the
  // service faltered mid-turn, the turn kept its work, and sending the
  // message again continues it. The CLI's own detail follows in parentheses
  // where the turn carried one (RLWINFIX2 item 3).
  turnTransientFailed:
    'MuseΓÇÖs service could not finish the turn. The turn kept its work; send the message again to continue.',
  // Retry on a failed turn the backend judged retryable (RLF-ACPTURNS):
  // the error row's button resends the turn's own message.
  turnRetryAction: 'Retry',
  // The retry was refused: the turn's message is gone, it failed beyond
  // retrying, or the conversation moved on. Sending again still works.
  turnRetryUnavailable: 'That turn can no longer be retried. Send your message again.',
  // A retry pressed while a turn runs: the row's button is disabled
  // then, so this answers only the race.
  turnRetryBusy: 'Wait for the reply to finish, or stop it, before retrying.',
  turnRetrying: 'Attempt {attempt}/{maxAttempts} failed ({reason}); retrying in {seconds} s.',
  // A retry notice with no retry limit (lane RETRYLIMITS): neither the
  // provider nor the person sets one, so the provider governs.
  turnRetryingUncapped:
    'Attempt {attempt} failed ({reason}); retrying in {seconds} s (no retry limit set).',
  // A 429 retry names the provider's own wait and when it ends, so a long
  // provider wait never reads as a silent stall; Stop ends it at any time.
  modelApiProviderRetryWait:
    '{reason}; the provider asked to wait until {time}. You can stop the turn at any time.',
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
  // The getting-started tips (M8): the default keybindings, named for each
  // platform since the webview does not know which one it runs on (M26,
  // D29), and what each does.
  onboardingShortcuts: {
    focus: 'Ctrl+Esc (Cmd+Esc on macOS, Ctrl+Alt+Esc on Windows)',
    palette: '/',
    cycleMode: 'Shift+Tab',
    mentionSelection: 'Alt+K',
    mentionFile: '@',
    newTab: 'Ctrl+Shift+Esc (Cmd+Shift+Esc on macOS, Ctrl+Shift+Alt+Esc on Windows)',
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
  museLoginTerminalName: 'Muse Code Sign-In',
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
  paidWebSearchName: 'Web Search',
  paidImageGenerationName: 'Images',
  paidVoiceName: 'Muse Voice',
  paidScheduledName: 'Scheduled Prompts',
  paidSubagentsName: 'Subagents',
  paidSubagentRates:
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; billed per request until the task ends or is stopped.',
  paidSubagentTaskTitle: 'Approve paid task for {role}?',
  paidSubagentTaskDetail:
    '{objective}\n\n{price}\n\nBilled to your Model API key. Actual cost depends on tokens used. Other enabled paid tools are charged separately. Allow once covers this task only.',
  // The popup before each paid use (M58): its buttons, and the two uses that
  // have no popup of their own. "Allow once" is `allowOnce`.
  paidAllowAlways: 'Allow Always in This Workspace',
  paidDeny: 'Deny',
  paidUseWebSearchTitle: 'Let Muse search the web for this prompt?',
  paidSearchQuote: 'Provider: {provider} · Model: {model}.',
  paidQuoteChoicesUnreadable:
    'Saved "always" choices could not be read ({kind}), so this use asks again.',
  paidAlwaysNotKept:
    '"Always" for {feature} applied this time, but it could not be saved ({kind}): you will be asked again.',
  // `{kind}` above and in `paidQuoteChoicesUnreadable` is one of these
  // closed words, never an errno or an error name.
  paidStoreReasonDenied: 'permission was refused',
  paidStoreReasonDiskFull: 'the disk is full or read-only',
  paidStoreReasonUnknown: 'the cause is unknown',
  paidUseWebSearchDetail:
    'Muse may search the web while it answers. Each search is billed to your Model API key at {price}, on top of the tokens its results add. Deny sends the prompt without web search.',
  paidUseVoiceTitle: 'Record with Muse Voice?',
  paidUseVoiceDetail:
    'Muse Voice is a Meta service and bills your Meta Model API key at {price}, regardless of the conversation model. Recordings stop at three minutes. Allow once covers one recording; Always covers this workspace until revoked. Duration and estimated cost are shown; the provider’s bill cannot be read back. Deny leaves the microphone off.',
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
    'Muse Voice sends recordings to Meta, billed to your Model API key at {price}, on either backend. Recordings stop at three minutes and reserve the daily budget before connecting. A set conversation cap refuses microphone recordings; attached audio is transcribed only when its bounded cost still fits the cap. Allow once covers one recording; Always covers this workspace until revoked. The provider’s bill cannot be read back.',
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
  // Team workers billed to a key (M96 lane A, PLAN.md D75): the paid feature,
  // its per-task popup lines and its confirmation. {budget} is the shared
  // daily team budget in the display language's money format.
  paidTeamWorkersName: 'Team Workers',
  paidTeamWorkerRates:
    '{model}: {input} input, {cached} cached input, {output} output per million tokens; up to {tokens} tokens per task.',
  paidTeamWorkerUnpriced:
    'The price is unknown; up to {tokens} tokens per task. Daily token limits apply.',
  paidTeamWorkerTokenBudget: 'Shared daily team token ceiling: {tokens} tokens.',
  paidTeamWorkerLine: '{role} on {model}: {rates}',
  paidTeamWorkerBudget: 'Shared daily team budget: {budget}.',
  paidTeamWorkersTitle: 'Approve paid team tasks?',
  paidTeamWorkersDetail:
    '{tasks}\n\nBilled to your API key for each task’s provider. Actual cost depends on tokens used. Allow once covers these tasks only.',
  paidConfirmTeamWorkers:
    'Team workers are unavailable: no team runtime is bound, so no team task can start and nothing is billed.',
  usagePaidTeamTasks: forms({ one: '{count} team task', other: '{count} team tasks' }),
  // Team pool selection (M96 lane A, PLAN.md D75): the switch row and its
  // reasons, and the two refusals callers surface. {measure} and {window}
  // are D75's code words (tokens/day); {used} and {amount} are formatted
  // counts in the display language.
  teamSwitchReasonCap: '{measure}/{window} cap met, {used} of {amount} used',
  teamSwitchReasonConcurrency: 'no free running slot',
  teamSwitchReasonRateLimited: 'rate-limited by the provider',
  teamSwitchReasonUsageLimit: 'subscription usage limit reached',
  teamSwitchReasonUnavailable: 'agent unavailable',
  teamSwitchReasonReset: 'headroom back after reset',
  teamPoolNotStaffed: 'Role {role} has no entries in its pool: it is not staffed.',
  teamCapExceeded: '{entry} has no {measure}/{window} headroom left ({used} of {amount} used).',
  teamRouteReason: 'Task matches the {role} area ({areas}).',
  teamRouteNoMatch: 'Task matches no role area; it stays with engineering.',
  teamRouteSplit: 'Split across {roles}.',
  teamRouteCrossReview: '{author} work, cross-reviewed by {reviewer}.',
  teamResumeBriefEmpty: 'Task {task} is new to {candidate}: no earlier work to resume.',
  teamResumeBriefBorrow:
    'Task {task} continues with {candidate}: borrowed from {lender} for {role}.',
  teamResumeBriefRecall:
    'Task {task} returns to {candidate}: the recall ended {ending}. Resume from {diff}: {commits}; new files: {files}.',
  teamResumeBriefMove:
    'Task {task} moves from {from} to {candidate}: {trigger}. Resume from {diff}: {commits}; new files: {files}.',
  teamResumeBriefNoDiff: 'no diff',
  teamResumeBriefNoCommits: 'no commits',
  teamResumeBriefNoFiles: 'none',
  teamCodingRoleFrontend: 'Build what the person sees: panels, pages, styles and interactions.',
  teamCodingRoleBackend: 'Build what serves it: APIs, storage, workers and their contracts.',
  teamCodingRoleEngineering: 'Build the shared core both sides run on: logic, tools and wiring.',
  // Inline completions (M94, PLAN.md D73): the paid feature, the
  // once-per-window popup (Q-M94a), the status bar with its menu, the snooze
  // and the Account & usage row. {price} is a dollar amount in the display
  // language's money format.
  paidTabName: 'Tab Completions',
  paidConfirmTab:
    'Tab completions send the code around your cursor to Meta as you type, billed to your Model API key. {price} At typical typing that is about $0.80 an hour on Standard and about $0.05 on the contributor model. You can set a daily budget in settings; with none set, Tab spending is uncapped. The contributor model is cheaper, and Meta trains on the code it is sent. Copilot, if on, is yielded to: automatic Tab suggestions pause for its languages unless you run both. Tab asks once per window before its first suggestion.',
  paidUseTabTitle: 'Let Tab suggest in this window?',
  paidUseTabDetail:
    'Tab sends the code around your cursor to Meta’s {model} model, billed to your Model API key at {price}. Today’s budget is {budget}; Tab stops for the day if it is reached. {training} Allow once covers this window until it closes; Allow always in this workspace never asks again here; Deny snoozes Tab in this window.',
  paidUseTabDetailNoBudget:
    'Tab sends the code around your cursor to Meta’s {model} model, billed to your Model API key at {price}. No daily budget is set, so Tab keeps suggesting until you turn it off or snooze it. {training} Allow once covers this window until it closes; Allow always in this workspace never asks again here; Deny snoozes Tab in this window.',
  // M95c part 7: Tab on a bring-your-own model quotes its provider’s card ({billed} names who bills and at which rates).
  tabByo: {
    detail:
      'Tab sends the code around your cursor to {model}, {billed}. Today’s budget is {budget}; Tab stops for the day if it is reached. Allow once covers this window until it closes; Allow always in this workspace never asks again here; Deny snoozes Tab in this window.',
    detailNoBudget:
      'Tab sends the code around your cursor to {model}, {billed}. No daily budget is set, so Tab keeps suggesting until you turn it off or snooze it. Allow once covers this window until it closes; Allow always in this workspace never asks again here; Deny snoozes Tab in this window.',
    billedKey: 'billed to your {provider} key at {price}',
    billedPlan: 'covered by your {provider} plan',
    billedLocal: 'which runs on your own server at no charge per token',
    rates:
      '{input} input, {cached} cached input and {output} output per million tokens, plus {request} per request',
  },
  tabTrainingContributor:
    'The contributor model is cheaper, and Meta trains on the code it is sent.',
  // The status bar item while the feature is on; {spend} is today's spend.
  tabStatusSpend: 'Tab {spend}',
  tabStatusTooltip:
    'Tab completions ({model}). {requests} today, {spend} of the {budget} daily budget.',
  tabStatusTooltipNoBudget:
    'Tab completions ({model}). {requests} today, {spend} spent, with no daily budget set.',
  // Each state D73 names; {left} is the snooze's remaining time.
  tabStatusSnoozed: 'Tab snoozed ({left} left)',
  tabStatusBudget: 'Tab daily budget reached',
  // Hitting the Tab daily budget is never silent: the notice names both the
  // spend and the budget and how to raise it.
  tabBudgetReachedDetail:
    'Today’s Tab spend of {spent} has reached the daily budget of {budget}, so completions pause until tomorrow. To continue today, raise museSpark.tabDailyBudgetUsd in Settings.',
  tabStatusNoKey: 'Tab: no key',
  tabStatusUntrusted: 'Tab off in an untrusted workspace',
  tabStatusLanguageOff: 'Tab off for {language}',
  tabStatusCopilot: 'Tab: on Invoke while Copilot is on',
  // {kind} is the last failure's class, never code or a path.
  tabStatusError: 'Tab failed ({kind})',
  // A spark-hooks.json file is present but could not be loaded in full, so
  // Tab reads no file until it is fixed (M94 lane K).
  tabStatusHooksInvalid: 'Tab paused: hook file has errors',
  tabStatusHooksInvalidDetail:
    'A spark-hooks.json file could not be loaded in full, so Tab reads no file until it is fixed. The Muse Spark log names the problem.',
  // The status bar menu: turn off, the snoozes, languages, the multi-line
  // mode, Copilot's row and Account & usage.
  tabMenuTurnOff: 'Turn Tab Off',
  tabMenuSnoozeShort: 'Snooze for 15 Minutes',
  tabMenuSnoozeLong: 'Snooze for an Hour',
  tabMenuSnoozeRestart: 'Snooze Until Restart',
  tabMenuLanguages: 'Tab Languages…',
  tabMenuMultiline: 'Multi-Line Mode…',
  tabMultilineAuto: 'Automatic',
  tabMultilineOnInvoke: 'Only When Invoked',
  tabMultilineNever: 'Single-Line Context Only',
  tabMenuUsage: 'Account & Usage',
  tabMenuCopilotOff: 'Turn Off Copilot’s Suggestions for {language}',
  tabMenuRunBoth: 'Run Both',
  tabCopilotConfirmTitle: 'Turn off Copilot’s suggestions for {language}?',
  tabCopilotConfirmDetail:
    'Tab stops waiting for Invoke in {language} and sends its own automatic suggestions, billed to your Model API key. You can turn Copilot’s suggestions back on in settings any time.',
  // The Account & usage row: requests, tokens, cached tokens, cost today and
  // in this window, and the budget.
  usagePaidTabRequests: forms({ one: '{count} Tab request', other: '{count} Tab requests' }),
  usagePaidTabTokens: '{tokens} tokens ({cached} cached)',
  usagePaidTabReported: 'Reported token estimate: {cost}',
  usagePaidTabCostToday: 'Today: {cost}',
  usagePaidTabCostWindow: 'This window: {cost}',
  usagePaidTabBudget: 'Daily budget: {budget}',
  usagePaidTabBudgetNone: 'No daily budget',
  usagePaidTabBudgetUnknown: 'Daily budget: not known yet',
  // The prompt and agent hook handlers on the Model API (M91, PLAN.md D70):
  // a paid use under D30 and D48, tallied on their own line.
  paidHookModelName: 'Model Hooks',
  // {event}: the hook event's name.
  paidHookModelTitle: 'Let this {event} hook ask the model?',
  // {kind}: prompt or agent, as written in the file; {model}: the model id.
  paidHookModelDetail:
    'A {kind} hook asks {model} before it answers.\n\n{price}\n\nBilled to your Model API key. Actual cost depends on tokens used. Allow once covers this hook run only.',
  paidConfirmHookModel:
    'Prompt and agent hooks ask the model before they answer, each run billed to your Model API key. {price} Each run asks for approval in every permission mode, including Bypass, unless you allow model hooks always in this workspace. Actual cost depends on tokens used. They can only refuse, narrow or add context. Model API backend only; on Muse Code they use a turn of your subscription instead.',
  usagePaidHookModelRuns: forms({ one: '{count} hook run', other: '{count} hook runs' }),
  // A prompt or agent hook refused while museSpark.modelApiHookModels is off.
  hookModelPaidOff:
    'Model hooks are off. Turn on museSpark.modelApiHookModels to let prompt and agent hooks ask the model.',
  paidHookModelDailyBudget: 'Shared daily paid budget: {budget}.',
  // The session board (M77, PLAN.md D49).
  boardTitle: 'Session Board',
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
  bestOfNCeilingLabel: 'Requests per Attempt',
  bestOfNStart: 'Start',
  bestOfNCancelRun: 'Cancel Run',
  bestOfNTake: 'Apply and Stage',
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
  bestOfNAttemptCost: 'reported spend {cost}',
  bestOfNAttemptCostPartial: '{cost} reported, more pending',
  bestOfNAttemptFailed: 'Failed: {reason}',
  bestOfNTakenMark: 'Took {branch}',
  bestOfNDiffClipped: 'Diff clipped.',
  bestOfNInvalidPrompt: 'Describe what the attempts should do.',
  bestOfNInvalidRequest: 'That best-of-N run needs at least 1 attempt and 1 request per attempt.',
  bestOfNInvalidAttempts: 'Attempts must be 1 or more.',
  bestOfNInvalidCeiling: 'Requests per attempt must be 1 or more.',
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
  bestOfNTakenSpend: 'Applied and staged the preview from {branch}. Reported use: {tokens}.',
  bestOfNTakenSpendCost:
    'Applied and staged the preview from {branch}. Reported use: {tokens}, reported spend {cost}.',
  bestOfNTakeFailed:
    'Could not apply and stage {branch}. Check the checkout before retrying: {reason}',
  paidConfirmAccept: 'Turn On',
  // The composer's badge while a paid feature is on; {features} lists their names.
  paidBadge: 'Paid: {features}',
  paidBadgeTitle:
    'Billed to your Model API key: {prices}. Click for this window’s tally in Account & usage.',
  // A paid call's row in the transcript.
  paidRowBadge: 'Paid',
  paidRowTitle: 'Billed to your Model API key: {price}',
  // The palette's toggles (Model API backend only); {feature} is the name.
  paidToggleLabel: '{feature} (Paid)',
  // The usage dialog's tally.
  usagePaidHeading: 'Paid Features in This Window',
  usagePaidOn: 'on',
  usagePaidOff: 'off',
  // M58: a feature that no longer asks in this workspace; {features} lists names.
  usagePaidOnAlways: 'on, allowed always in this workspace',
  usagePaidAlwaysNote: 'Allowed always in this workspace, without asking: {features}.',
  usagePaidAskAgain: 'Ask Again Every Time',
  // A separate judge route's window grant (its own popup's Allow in this window).
  usagePaidRouteNote: 'Allowed in this window: the separate judge {model}.',
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
  usagePaidExtraTotal: 'Estimated Extra-Feature Total',
  usagePaidSubagentReported: 'Reported token estimate: {cost}',
  usagePaidTotal: 'Estimated Paid Total',
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
  subagentResultClipped:
    'This result was clipped to the first {kept} of {total} characters; the full result is kept in the child transcript.',
  subagentContributorBlocked:
    'The custom agent names a contributor-tier model, which cannot run while this workspace is confidential (museSpark.confidentialWorkspace).',
  subagentKeyChanged:
    'The Model API key changed after approval. Approve a new child task to continue.',
  subagentModelChanged: 'The model changed after approval. Approve a new child task to continue.',
  subagentGoalEnded:
    'The originating goal is no longer active. The child task cannot make another request.',
  subagentTariffUnknown:
    'No verified price is available for this model. The child task cannot start.',
  subagentPlanMode: 'Plan mode refuses paid child tasks; switch mode and approve a new task.',
  subagentWebSearchOff: 'Web search was turned off before this child request; no request was sent.',
  // M96 (PLAN.md D75): the orchestrator's writing tools wait while an
  // in-place worker task runs, in every mode.
  teamInPlaceOrchestratorRefused:
    'A team worker is writing in this workspace: edits, the shell and merges wait until its task ends.',
  // M96 (PLAN.md D75): a team conversation whose last ready entry went away
  // keeps its tools; from the next turn `delegate` is refused.
  teamSingleModelAgain: 'Only one model is ready: the team applies from a new conversation.',
  teamRunnerUnavailable: '{tool} is unavailable: the team runner has not loaded in this window.',
  // The team host service (M96 lane X): its tool answers and refused actions.
  teamPlanShown: 'Team plan shown; nothing started.',
  teamTasksStarted: 'Team tasks started: {count}',
  teamMergeRework: 'The merge met conflicts: the task went back for rework.',
  teamTaskUnknown: 'That team task is not open in this window.',
  teamWaitingUnknown: 'Nothing is waiting for this answer any more.',
  teamBudgetUnavailable:
    "A team task cannot start under a session budget until it can share this conversation's budget.",
  teamTaskNoDiff: 'That team task has no branch to compare.',
  teamTranscriptNotKept:
    "A team worker's conversation closes with its task; its report and its diff stay.",
  teamTaskBusy: 'That team task is already being merged or discarded.',
  teamMergeUntrusted: 'Trust this workspace to merge a team task.',
  teamMergeNeedsConversation:
    'Open the conversation that started this team task to merge it there.',
  teamMergePlanMode: 'Merging a team task is refused in Plan mode.',
  teamReviewStarted: 'A reviewer started checking this branch; merge it once the review is in.',
  webSearchFailed: 'The search failed',
  // Under a reply that cites web pages (M33).
  citationsHeading: 'Sources',
  // The microphone while Muse Voice is its engine (M35); {price} per hour of audio.
  dictationPaidLabel: 'Record Voice With Muse Voice (Paid)',
  dictationPaidTitle:
    'Muse Voice, paid: {price}, billed to your Model API key. Tap or hold to record (Ctrl+D)',
  // Why Muse Voice cannot record or transcribe.
  museVoiceNoKey:
    'Muse Voice needs a Meta Model API key; add one even when your conversation uses another provider or a local model.',
  museVoiceNoAnswer: 'Muse Voice did not answer; check the connection and try again.',
  museVoiceIdle:
    'Muse Voice closed the recording because audio stopped arriving at real-time pace.',
  museVoiceTransportFailed: 'The Muse Voice connection failed; the recording stopped.',
  museVoiceInvalidDuration: 'Muse Voice reported an invalid audio duration; the recording stopped.',
  museVoiceUsageReported:
    'Muse Voice: {duration}, estimated {cost} from the reported duration. The provider’s bill cannot be read back.',
  museVoiceUsageEstimated:
    'Muse Voice: {duration}, estimated {cost} from audio sent. No final duration arrived; the full reservation remains uncertain. The provider’s bill cannot be read back.',
  museVoiceUsageEmpty:
    'Muse Voice: {duration}, estimated {cost}. No audio was sent; no audio charge is expected. The provider’s bill cannot be read back.',
  museVoiceNoFinal: 'Muse Voice did not send the transcript in time; try again.',
  museVoiceMalformed: 'Muse Voice sent something that is not JSON, so the recording was dropped.',
  museVoiceRefused: 'Muse Voice refused the recording',
  museVoiceRateLimited: 'Muse Voice is rate-limited for this key; wait a moment and try again.',
  // {code}: the WebSocket close code Meta sent.
  museVoiceClosed: 'Muse Voice closed the connection (code {code})',
  museVoiceNoWebSocket:
    'Muse Voice needs WebSocket support in VS Code’s extension host, which this version does not have.',
  // M56 (PLAN.md D43): a proxy is set, but this editor's version does
  // not route the voice connection through it (before VS Code 1.112).
  // On 1.112 and later the refusal names the setting left off instead
  // (the two keys below).
  museVoiceNoProxy:
    'Muse Voice cannot use the configured proxy on this version of VS Code; behind a proxy it needs VS Code 1.112 or later.',
  // A proxy is set and the editor could route the voice connection, but
  // the person's http.proxySupport setting is "off".
  museVoiceProxySupportOff:
    'Muse Voice cannot use the configured proxy while the http.proxySupport setting is "off". Set http.proxySupport to "on" so the voice connection goes through the proxy.',
  // A proxy is set and http.proxySupport allows it, but the person's
  // http.webSocketAdditionalSupport setting is off.
  museVoiceProxyWebSocketOff:
    'Muse Voice cannot use the configured proxy while the http.webSocketAdditionalSupport setting is off. Turn http.webSocketAdditionalSupport on so the voice connection goes through the proxy.',
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
  reviewUncommittedItem: 'Review Uncommitted Changes',
  reviewUncommittedDetail: 'Staged and unstaged changes, against the last commit',
  reviewBranchItem: 'Review This Branch…',
  reviewBranchDetail: 'Every change since it left the base branch you pick',
  reviewCommitItem: 'Review a Commit…',
  reviewCommitDetail: 'One of the latest commits, which you pick',
  reviewSecurityItem: 'Security Review',
  reviewSecurityDetail:
    'The uncommitted changes, for injection, secrets, authentication and unsafe APIs',
  reviewChangesItem: 'Review This Conversation’s Changes',
  reviewChangesDetail: 'Accept or revert each change, and comment on a line',
  // The base-branch and commit pickers.
  reviewPickBase: 'The branch to compare this one with',
  reviewPickCommit: 'The commit to review',
  reviewDefaultBase: 'Default Base',
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
  reviewPaneTitle: 'Changes in This Conversation',
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
  reviewNotReverted: 'Not Reverted',
  reviewComment: 'Comment on a Line…',
  reviewCommentLine: 'Line',
  reviewCommentLabel: 'Comment',
  reviewCommentPlaceholder: 'What should the agent know or change here?',
  reviewSendSteer: 'Send to the Running Turn',
  reviewSendNext: 'Send as the Next Message',
  reviewCommentCancel: 'Cancel',
  // {line}: a line number; {text}: that line's code.
  reviewLineOption: 'Line {line}: {text}',
  reviewRemovedLineOption: 'Removed line {line}: {text}',
  reviewOpenFile: 'Open File',
  reviewCommentSent: 'Comment sent to the agent',
  // What the live region says when a change's Revert settles; {name} is reviewHunkName.
  reviewAnnounceReverted: '{name} reverted',
  reviewAnnounceNotReverted: '{name} not reverted: {reason}',
  // The findings list under a review's reply.
  reviewFindingsLabel: 'Review Findings',
  reviewFindingsHeading: forms({ one: '{count} Finding', other: '{count} Findings' }),
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
  // D203: /playback. The agent states its own understanding of the goal and
  // instructions from its working memory, with no tools for the turn.
  playbackItem: '/playback',
  playbackDetail: 'Muse states its own understanding of the goal, from memory only, with no tools',
  playbackUsage: '/playback takes no arguments: send it bare.',
  // Why a playback did not start, on its card.
  playbackBusy: 'A playback starts once the current turn has ended.',
  playbackOutputSchemaRefused:
    'A playback cannot use structured output: its reply must open with the marker line, which a JSON schema cannot hold.',
  // No backend no-tools turn (Muse Code): refused instead of sent as an
  // ordinary turn a reactive stop might reach too late.
  playbackNeedsModelApi:
    'A playback needs the Model API backend: Muse Code offers no turn without tools, so no playback can start there.',
  // The playback's turn text loads with the review's module (dist/review.js), which could not be loaded.
  playbackUnavailable:
    'The playback could not be loaded, so no playback can start; reinstall the extension and reload the window. The log has the details.',
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
  // M92e (PLAN.md D71): a shell command holding a detected secret. The card
  // shows the value redacted, and no allow rule approves it on its own.
  approvalSecretNote:
    'This command contains a detected secret, shown redacted. It always asks: no allow rule approves it on its own.',
  // Who answered a call no card was shown for (the row's "Decided" line).
  autoReviewerResolver: 'Auto Reviewer',
  // The CLI's own reviewer deciding for one child (M116, PLAN.md D96.17):
  // the row's "Decided" line names it and the child, never a waiting card.
  cliReviewerDecision: 'Muse Code reviewer for {child}',
  commandRuleResolver: 'Command Rule',
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
  paidAutoReviewerName: 'Auto Reviewer',
  paidConfirmAutoReviewer:
    'In Auto mode on the Model API backend, a separate model call judges each plain shell command or MCP tool call that would ask and that no rule or permission profile settles, and runs it without asking when it looks safe. It never allows a forbidden command, a command your rules ask about, a protected write or a paid call, and when it declines or fails, you decide. Each review is billed to your Model API key at the conversation model’s token rates:\n{price}\nEvery review asks first, unless you allow reviews always in this workspace.',
  // {tool}: the tool the reviewed call is for; {action}: its command line or arguments.
  paidUseAutoReviewerTitle: 'Let the Auto reviewer judge this {tool} call?',
  paidUseAutoReviewerDetail:
    '{action}\n\nA separate call to {model} judges whether it may run without asking you. Billed to your Model API key: {price}. Total varies with tokens used. Deny shows you the approval card instead.',
  usagePaidAutoReviews: forms({ one: '{count} review', other: '{count} reviews' }),
  // The Muse Judge (M98, PLAN.md D77): its name, confirmation and tally.
  paidJudgeName: 'Judge',
  paidConfirmJudge:
    'Your own chat model judges each risky Auto action that no rule settles, and can only add caution: a ready caution turns an allow into a question, or into a note on the approval card. Each judgment is billed to your Model API key at the conversation model’s token rates:\n{price}\nThe judge asks once before the first charge, with these prices and the shared daily budget: {budget}. Switching from a free source to a paid one asks again. On Muse Code the same calls run on your subscription instead.',
  usagePaidJudgeCalls: forms({ one: '{count} judgment', other: '{count} judgments' }),
  // Phase-2 source/status labels; runtime availability is supplied by the source lanes.
  paidConfirmJudgeEmbedding:
    'An embedding request to {model} costs at most {price}, billed to your provider key. The shared daily budget is {budget}. Your subscription does not pay for this request. Allow once covers this window; switching from a free source or changing the price asks again.',
  paidConfirmJudgeSystemOne:
    'Experimental and untested: a SystemOne judge request to {model} at {recipient} costs at most {price}, billed to your own provider key. The judged action is sent there; the result only adds caution to your own model’s judgment and never answers you or decides alone. The shared daily budget is {budget}. Your subscription does not pay for this request. Allow in this window covers every request on this route until this window closes; Ask again every time in Account & usage, or a changed price, asks again.',
  judgeSeparateNeedsKey: 'Separate judge needs its provider key in Models & Providers',
  judgeSeparateNeedsCapture:
    'Separate judge: this provider model needs a captured structured or logprob judge request first',
  judgeSeparateNeedsInstall:
    'Separate judge: the local judge needs a vetted install on a certified platform',
  judgeSeparateUnknown: 'Separate judge: the configured id names no known source',
  judgeSeparateUserSettingsOnly:
    'Separate judge is set in workspace settings; paid settings are read from user settings only',
  judgeSourceSame: 'Own chat model',
  judgeSourceSeparate: 'Separate judge',
  judgeSourceBoth: 'Own model and separate judge',
  judgeLocalUnverified: 'Unverified local endpoint',
  judgeSourceUntested: 'Experimental, untested; explicit opt-in required',
  judgeNoAnswer: 'No judge answer ({reason}). Existing checks and approvals still apply.',
  judgeCaution: 'Muse Judge suggests caution. You decide; it cannot approve this action.',
  judgeCliDescription: 'Muse Judge: verdicts, calibration, reports, serving and lint.',
  judgeAdvisoryMissing:
    'The background safety check did not finish, so no advisory is attached to this approval.',
  judgeSubscriptionNotice:
    'Muse Judge uses your chat model on your Muse subscription and counts against its limits. Each batch uses a fresh isolated Plan session. A tool-item guard cancels the session, but cannot prove that no tool ran. It can only add caution.',
  judgeStatusSame: 'Same Model',
  judgeStatusSeparate: 'Separate model',
  judgeStatusBoth: 'Both models',
  judgeStatusUntested: 'Off: separate source has not been verified',
  judgeStatusProfiles: 'Off: fitted profiles are missing',
  judgeAutoNoSource: 'Same model: no separate source is available',
  judgeAutoUntested: 'Same model: separate source has not been verified',
  judgeAutoNoProfiles: 'Same model: fitted profiles are missing',
  judgeAutoNoEvidence: 'Same model: held-out paired evaluation evidence is missing',
  judgeEmbedNoLabels:
    'The embedding shortcut needs hundreds of independent labels for this family; none recorded yet, so the full judge runs instead',
  judgeStatusOff: 'Off',
  judgeStatusUnavailable: 'Off: source unavailable or standing allow rules',
  judgeStatusConsent: 'Waiting for first-charge consent',
  judgeStatusDeclined: 'Off: paid use declined',
  judgeStatusSlow: 'Off by default: too few results ready at the reviewer fence',
  judgeStatusSubscription: 'Subscription',
  judgeStatusPaid: 'Paid',
  // M125 lane 0 (D107): the fast judge's status line and setup command.
  judgeFastOff: 'Fast path off',
  // M125 lane C (D107): the stuck chip's text; Stop and Steer reuse their own labels.
  judgeLooksStuck: 'Looks stuck — the last tool calls are not making progress.',
  judgeSteerTurn: 'Steer',
  judgeNotSetUp: 'Judge: Not Set Up — Set Up',
  judgeInstalling: 'Judge: Installing ({percent})',
  referenceJudgeSetup: 'Scan this machine and install a local judge model.',
  // M125 lane H (D107): the setup recommender's plain-words reasons. Sizes
  // and latencies arrive formatted; families stay codes (technical detail).
  judgeRecommend: {
    pick: 'Recommended: {model} ({size}).',
    fitGpu: "It fits in your GPU's memory.",
    fitCpu: 'It fits in memory with room to spare.',
    latency: 'Should answer in about {latency} at worst.',
    classesOn: 'Fast enough for: {classes}.',
    classesOff: 'Not fast enough for: {classes}.',
    classInline: 'decisions before each request',
    classSlack: 'decisions while you type',
    classBoundary: 'decisions while the model works',
    classPost: 'checks on each reply',
    uncalibrated: 'Checks on replies stay off until it is calibrated for them.',
    calibrated: 'Calibrated for: {families}.',
    lowerQuality:
      'A smaller model, lower quality: speed decisions only, never destructive-command review or vetoes.',
    noneUnmeasured: 'Nothing to recommend yet: no model has verified timings on this computer.',
    noneUnfit: 'No local judge fits this computer: nothing fast enough fits in memory and on disk.',
    noneUncalibrated: 'No local judge is ready yet: the fitting models still need calibration.',
    cpuOnly: 'No usable GPU was found; judging CPU-only options.',
  },
  // M125 lane W (D107 §8.1): the `judge scan|setup|remove` text
  // steps. Codes (backends, classes, phases, reasons) stay codes;
  // counts use forms; bytes and lists arrive formatted.
  judgeSetupCli: {
    scanOs: 'OS: {os} {arch} ({version})',
    scanRam: 'RAM: {total} ({free} free)',
    scanCpu: 'CPU: {model} ({cores}, {features})',
    scanCores: forms({ one: '{count} core', other: '{count} cores' }),
    scanGpu: 'GPU: {vendor} ({backend}): {reason}',
    scanDiskFree: 'Disk: {free} free at {path}',
    scanDiskUnknown: 'Disk: unreadable at {path}',
    scanOllamaAbsent: 'Ollama: not installed',
    scanOllama: 'Ollama: {version} at {path}, {state}',
    ollamaRunning: 'running',
    ollamaStopped: 'stopped',
    unknownValue: 'unknown',
    scanPick: 'Recommendation: {model} ({digest}, {backend}, p95 {p95})',
    scanClasses: 'Classes: {classes}',
    scanFitting: 'Also fits: {models}',
    scanFitsNothing: 'Recommendation: fits nothing on this machine.',
    planModel: 'Model: {model} ({digest})',
    planSize: 'Download: about {bytes} plus the runtime archive',
    planLicence: 'Licence: {name} ({url})',
    planLicenceNoUrl: 'Licence: {name}',
    planRuntime: 'Runtime: {version} ({url})',
    planNoRuntime: 'Runtime: no pinned archive for {platform} ({backend})',
    planPath: 'Installs to: {path}',
    needsYes: 'Re-run with --yes to download and install.',
    setupDone: 'Installed {model}: smoke {correct}/{total} correct.',
    cannotSetup: 'Cannot set up ({reason}).',
    setupFailed: 'Setup failed ({phase}/{reason}).',
    setupProgress: '{phase} {done}/{total}',
    removeNone: 'No local judge installed.',
    removePlan: 'Installed: {model} at {path}. Re-run with --yes to remove.',
    removeDone: 'Removed: {paths}.',
    setupUsage:
      'Usage: judge scan [--cpu-only] | judge setup [--model MODEL] [--cpu-only] --yes | judge remove --yes',
  },
  // M125 lane W (D107 §8.1): the wizard Done step's per-class and
  // per-check rows, formatted by the host. {class} is the timing
  // class's name; {p95} arrives formatted with its unit.
  judgeSetup: {
    doneClassOn: '{class} answers within its deadline (p95 {p95}).',
    doneClassOver: '{class} misses its deadline (p95 {p95}); those decisions run as today.',
    doneCheckOn: 'Calibrated.',
    doneCheckOff: 'Not calibrated yet.',
  },
  // M125 lane W (D107 §8.1): the Set Up Local Judge panel, its steps,
  // the Settings › Judge management buttons, the remove confirm and
  // the status item. Wizard labels read in Title Case. {error} is a
  // technical phase/reason code; {backend} is cuda, rocm, metal or cpu;
  // {bytes} and {p95} arrive formatted with their units.
  judgeSetupWizard: {
    title: 'Set Up Local Judge',
    unavailable: 'Set Up Local Judge is not available in this window.',
    scanTitle: 'Scan This Machine',
    scanBody:
      'The scan reads this machine’s hardware and any existing Ollama. It writes nothing and makes no network call.',
    scanStart: 'Scan',
    scanAgain: 'Scan Again',
    scanning: 'Scanning…',
    scanFailed: 'The scan failed ({error}).',
    recommendTitle: 'Recommended Model',
    fitsNothing: 'Nothing fits this machine.',
    downloadSize: 'Download: {bytes}',
    backendName: 'Backend: {backend}',
    p95: 'Verified-path p95: {p95}',
    classes: 'Classes: {classes}',
    reasonsTitle: 'Why this model',
    advanced: 'Advanced',
    advancedModel: 'Model',
    cpuOnly: 'CPU only',
    hosted: 'Use hosted instead',
    skip: 'Skip setup',
    install: 'Install',
    licenceTitle: 'Licence',
    licenceBody: '{model} is published under {name}.',
    licenceLink: 'Read the licence',
    acceptLicence: 'Accept and Install',
    installTitle: 'Installing {model}',
    phaseFetch: 'Fetching',
    phaseVerify: 'Verifying',
    phaseInstall: 'Installing',
    phaseRegister: 'Registering',
    phasePreload: 'Loading',
    phaseHealth: 'Checking health',
    phaseSmoke: 'Smoke checks',
    progressBytes: '{done} of {total}',
    installFailed: 'Setup failed ({error}).',
    tryAgain: 'Try Again',
    doneTitle: 'Local Judge Ready',
    classesTitle: 'Timing classes',
    checksTitle: 'Accuracy checks',
    smoke: 'Smoke: {correct} of {total} correct',
    close: 'Close',
    setUpLater: 'Set Up Later',
    sectionSetup: 'Set Up Local Judge',
    sectionRescan: 'Re-scan',
    sectionChange: 'Change Model',
    sectionRemove: 'Remove',
    sectionNotInstalled: 'No local judge installed.',
    removeConfirmTitle: 'Remove Local Judge',
    removeConfirm: 'Remove {model} and its runtime at {path}? Only what setup added is deleted.',
    removeYes: 'Remove',
    removeDone: 'Removed {model}.',
    removeNone: 'No local judge installed.',
    statusText: 'Set Up Local Judge',
    statusTooltip: 'Scan this machine and install a local judge model',
  },
  // M125 lane F1b (D107 §9.4, §9.6): the B1 skip's transcript row. The
  // allow line is the design's exact words; the count fills {count}.
  judgeB1: {
    allowRow: 'Allowed without review: inspect command',
    excluded: forms({ one: '{count} entry not read', other: '{count} entries not read' }),
    resolver: 'B1 fast path',
  },
  // The Models panel's Judge section (M98 phase 2, lane FP). Amounts are filled
  // with the display language's money format; an unknown amount is not shown as zero.
  judgePanel: {
    source: 'Source',
    model: 'Model',
    technique: 'Technique',
    calibration: 'Calibration',
    partial: 'Distribution',
    partialYes: 'Partial',
    price: 'Price',
    priceInput: '{input} per million input tokens',
    priceCached: '{cached} per million cached input tokens',
    priceOutput: '{output} per million output tokens',
    reserved: 'Reserved',
    settled: 'Settled',
    uncertain: 'Uncertain, still a possible charge',
    dailyBudget: 'Shared daily budget',
    spentToday: 'Spent today',
    notKnown: 'Not known',
    unpriced: 'No price is known, so a paid call is not sent.',
    askOnce: 'Review the price',
    freeLocal: 'Free on this computer',
    fast: {
      method: 'Fast method',
      turns: 'Fast turns',
      applied: 'Fast turns applied',
      judgeCalls: 'Judge calls',
      judgeTokens: 'Judge tokens',
      saved: 'Fast time saved',
      stateActed: 'Acted',
      stateRaised: 'Raised, not applied',
      stateIdle: 'Not raised',
      noWindow: '{count} without a window',
    },
    techniques: {
      logprob: 'Log probabilities',
      top1: 'Approximate, from the top token',
      stated: 'Stated confidence',
      systemone: 'System One answer',
      sampling: 'Several samples',
      contrastive: 'Question and its opposite',
      cascade: 'Own model, then the separate judge',
      embedding: 'Embedding shortcut',
    },
    labels: {
      logprob: 'Calibrated from log probabilities',
      stated: 'Calibrated from stated confidence',
      uncalibrated: 'Uncalibrated',
      top1: 'Approximate, from the top token',
    },
  },
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
  verifyUnchecked: forms({
    one: '{count} file not checked',
    other: '{count} files not checked',
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
    refused: 'the permission mode refuses shell commands',
    restricted: 'shell commands are off in Restricted Mode',
    unsafePath: 'a file name cannot be passed to it safely',
    changed: 'the file changed after the edit',
    stopped: 'the checks stopped after failing round after round',
  },
  // An edit's then_run: the command it ran right after the edit.
  thenRunLabel: 'Then Ran',
  // {reason}: one of checkSkips, with the user's or the hook's words after it.
  thenRunNotRun: 'Not run: {reason}',
  // A then_run value that is present but not a command line.
  thenRunNotString: 'then_run must be one command line as a string',
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
  // M95 (PLAN.md D74): bring-your-own model providers. The first-run
  // screen's third choice, beside the Muse sign-in and the Meta key.
  startWithOwnModel: 'Start With Your Own Model',
  startWithOwnModelDetail: 'Add a model provider with an API key and pick a model.',
  // {provider}: the preset's name; {model}: the qualified model reference.
  setupComplete: 'You’re set up with {provider} · {model}',
  manageProviders: 'Manage Providers',
  // The Models & Agents panel's framework: its sections, filters and wizard.
  outputCapBelowMinimum: forms({
    one: 'Output cap must be at least {count} token.',
    other: 'Output cap must be at least {count} tokens.',
  }),
  referenceOutputCapMinimum:
    'Output caps below the provider’s known minimum are refused when saved and before sending. Meta requires at least 16 tokens.',
  modelsPanelTitle: 'Models & Agents',
  // Shown when the panel's bundle cannot load: an explicit error, never an
  // empty panel.
  modelsPanelUnavailable: 'Models & Agents is not available in this build.',
  providersSectionTitle: 'Providers',
  modelsSectionTitle: 'Models',
  // The Models & Agents section nav paints before the vault surface loads,
  // so its title is startup English like the other section titles; the
  // vault group's own title stays with the deferred surface.
  vaultSectionTitle: 'Vault',
  providerSearchPlaceholder: 'Search providers…',
  modelsSearchPlaceholder: 'Search models…',
  // The provider dropdown's filter chips.
  providerFilters: {
    cloud: 'Cloud',
    local: 'On This Computer',
    subscription: 'Subscription Sign-In',
    aggregator: 'Aggregator',
  },
  scanComputer: 'Scan This Computer',
  // {label}: the local app's name from its preset; {port}: the port that answered.
  localScanChoice: '{label} on Port {port}',
  // Shown when no local server answered, above each app with its usual port.
  localScanEmpty: 'Nothing is running on this computer yet.',
  providersScanning: 'Scanning…',
  providerUntested: 'Not Tested',
  // A stored credential names only the origin it was entered for, never the key.
  keyBoundState: 'stored, bound to {origin}',
  // {count}: the models the free check listed.
  providerKeyWorks: forms({
    one: 'Key works · {count} model',
    other: 'Key works · {count} models',
  }),
  // Before a check that bills a token: its cost is stated and asked first.
  providerTestPaid: 'This check sends one token and costs about {cost}.',
  // {detail}: what the provider answered, in its words.
  providerTestFailed: 'Test failed: {detail}',
  scanFailed: 'Scan failed: {detail}',
  localContextWindow: 'Context window (tokens)',
  localContextWindowHint:
    'Enter the context window loaded on the local server. Manual values override scanned limits.',
  localContextWindowInvalid: 'Enter a positive whole number of tokens.',
  // {build}: the server build the llama.cpp quirks were captured against.
  llamacppScanMissingWindow:
    'The llama.cpp model list reports no live context window (captured build {build}).',
  // {model}: a local model saved without its server's reported window.
  localModelWindowUnknown:
    'Model {model} has no known context window. Enter its loaded window in the provider wizard, Models panel or providers add --context-window.',
  // {id}: the provider saved without its key.
  providerNeedsKey: 'Provider {id} needs a key.',
  // The wizard's first step; the quick pick runs the same flow.
  wizardPickProvider: 'Pick a Provider',
  providerFields: {
    provider: 'Provider',
    address: 'Address',
    models: 'Models',
    privacy: 'Privacy',
  },
  // The wire format a custom server speaks.
  wireFormats: {
    responses: 'OpenAI Responses',
    chat: 'Chat Completions',
    anthropic: 'Anthropic Messages',
  },
  // A custom server's per-model limits, asked on the wizard's models step.
  customLimitsContext: 'Context Window (Tokens)',
  customLimitsOutput: 'Longest Reply (Tokens)',
  // Shown while a chosen custom model still misses a valid limit.
  customLimitsMissing:
    'Each chosen model needs its context window and longest reply before saving.',
  // The quick pick's token-count prompt.
  customLimitsTokensPlaceholder: 'Tokens, for example 128000',
  customLimitsInvalid: 'Enter a positive whole number of tokens.',
  customLimitsOutputCap: 'The longest reply cannot pass the context window.',
  // {provider}: the saved provider's label; {preset}: its preset id (technical).
  providerPresetUnsupported:
    '{provider} is unavailable: this version does not support its preset ({preset}).',
  // A sign-in the picker shows disabled: no connector in this editor.
  signInNotOffered: 'Not offered here.',
  // A sign-in the picker shows disabled: ChatGPT sign-in needs a local window.
  signInRemoteWindow: 'Unavailable in a remote window. Sign in from a local window.',
  // A sign-in the picker shows disabled: Grok sign-in needs the terminal's device flow there.
  signInRemoteWindowGrok:
    'Unavailable in a remote window. Sign in from the terminal on that host: muse-spark-code-acp providers add grok --device.',
  getKey: 'Get a Key',
  enterKey: 'Enter Key…',
  // {provider}: the preset's name.
  providerConnect: 'Connect {provider} Account',
  providerConnectWaiting: 'Waiting for {provider} in the browser…',
  // The OAuth loopback's callback page, shown in the browser.
  oauthCallbackDone: 'You can close this window and return to VS Code.',
  providerKeyPrompt: '{provider} API Key',
  // {origin}: the address the credential is sent to, and no other.
  keyStoredNote: 'Stored in your system keychain; sent only to {origin}.',
  changeKey: 'Change Key',
  reconnectAccount: 'Reconnect',
  providerEdit: 'Edit',
  providerRemove: 'Remove',
  testConnection: 'Test',
  saveProvider: 'Save',
  saveAndUseNow: 'Save and Use Now',
  wizardBack: 'Back',
  wizardCancel: 'Cancel',
  wizardContinue: 'Continue',
  suggestionAccept: 'Accept',
  suggestionChange: 'Change',
  // {id}: the provider id, as written.
  providerRemoved: 'Removed provider {id}.',
  undoAction: 'Undo',
  providerExport: 'Export',
  providerImport: 'Import',
  providerImportPreviewTitle: 'Import Preview',
  importNeedsKey: 'needs a key',
  importNeedsKeyLabel: 'Needs a Key',
  providerConnectReplaceKey:
    'An OpenRouter key is already stored. Replace it? Type yes to continue.',
  providerCreatedKeyDiscarded:
    'OpenRouter created a key labelled {label}. It was not kept here. Remove it at {url}.',
  providerConnectFailed: 'OpenRouter connection failed. Try connecting again.',
  huggingfaceOAuthNotRegistered:
    'Hugging Face sign-in is not open yet: its OAuth app must be registered on huggingface.co first (a publisher step).',
  huggingfaceConnectFailed: 'Hugging Face connection failed. Try connecting again.',
  huggingfaceRemoteWindow: 'Hugging Face sign-in needs a local window.',
  providerConnectBusy: 'Another provider change is in progress. Try again when it finishes.',
  providerConnectRecoveredStored:
    'A previous OpenRouter connection already stored its key. It is kept.',
  providerConnectStoredNewKey:
    'The new OpenRouter key is stored. The previous key could not be restored.',
  providerUsageFailed: 'OpenRouter key usage could not be read. Try again.',
  providerUsageNeedsId: 'A provider id is needed: {command} providers usage <id>.',
  providerPasteCode: 'Paste the authorization code shown by OpenRouter.',
  usageKeyTotal: 'Total Usage',
  usageUnlimited: 'No Limit',
  providerOpenRouterServices:
    'Connect your OpenRouter account and view the key’s usage, limit and remaining balance.',
  refreshModels: 'Refresh Models',
  scanNewModels: forms({
    one: '{count} new model since the last scan',
    other: '{count} new models since the last scan',
  }),
  scanRemovedModels: forms({
    one: '{count} model removed since the last scan',
    other: '{count} models removed since the last scan',
  }),
  scanRepricedModels: forms({
    one: '{count} model with a new price since the last scan',
    other: '{count} models with a new price since the last scan',
  }),
  // The Models table's badges, each shown by its rule (M95 acceptance 17).
  modelBadges: {
    recommended: 'Recommended',
    cheapestCapable: 'Cheapest Capable',
    largestContext: 'Largest Context',
    newBadge: 'New',
  },
  // How a model without a dollar price is marked.
  modelToolCallingUnavailable: 'Tool calling has not been verified for this model.',
  paidProviderPrice:
    'Per million tokens: input {input}, cache read {cached}, cache write {write}, one-hour write {write1h}, twelve-hour write {write12h}, output {output}. Per request {request}; per image {image}.',
  paidProviderPriceTier:
    'From {threshold} input tokens: input {input}, output {output} per million.',
  modelUnpriced: 'Unpriced',
  modelLocal: 'Local',
  modelPlan: 'Plan',
  // A contributor-tier model's mark in the picker (F62): Meta may train on
  // what it is sent, for the lower price.
  pickerContributorTier: 'Contributor',
  modelFree: 'Free',
  modelColumns: {
    name: 'Model',
    context: 'Context',
    inputPrice: 'Input',
    outputPrice: 'Output',
    price: 'Price',
  },
  // OpenRouter's privacy routing, private by default; each in one sentence.
  privacyNoRetention: 'No Data Retention',
  privacyNoRetentionDetail: 'Only providers that retain no data are used.',
  privacyNoTraining: 'No Training',
  privacyNoTrainingDetail: 'Providers may retain data, but must not train on it.',
  privacyAnyProvider: 'Any Provider',
  privacyAnyDetail: 'Any provider may be used, including ones that train on data.',
  spendLimitLink: 'Set This Key’s Own Spend Limit',
  // The suggestion engine's values (M95) and why each is proposed.
  suggestDefaultModel: 'Default Model',
  suggestSessionBudget: 'Session Budget',
  suggestReasonCheapest:
    'The cheapest model that calls tools and fits the context the harness needs.',
  suggestReasonRecommended: 'The provider’s recommended model.',
  // {cost}: the median of the user's own recent sessions.
  suggestReasonBudgetMedian: 'From your recent sessions (median {cost}).',
  // The wizard's spending limit IS the conversation spending limit
  // setting: 0 means no limit, anything else caps every conversation.
  wizardSessionBudget: 'Spending Limit per Conversation (USD, 0 = No Limit)',
  // {amount}: the effective limit now; {scope}: where it is set.
  wizardSessionBudgetNow:
    'This is your setting for every conversation; it is {amount} now ({scope}).',
  // Where the spending limit is effective from, as the wizard names it.
  sessionBudgetScopeWorkspace: 'workspace',
  sessionBudgetScopeGlobal: 'this computer',
  wizardSessionBudgetInvalid:
    'Enter a non-negative amount in dollars, for example 2 (0 means no limit).',
  // {detail}: why the limit could not change after provider persistence succeeded.
  sessionBudgetPartialSave: 'Provider saved; the spending limit was not changed: {detail}',
  // {amount}: the concurrent current limit; {requested}: the user's retained edit.
  sessionBudgetConflict:
    'The spending limit changed to {amount}. Save again to confirm your limit of {requested}.',
  // {amount}: what the setting still reads after the write resolved.
  sessionBudgetStillEffective: 'the setting still reads {amount}',
  // {detail}: why the address is refused, in technical words.
  providerAddressInvalid: 'This address cannot be used: {detail}',
  // {address}: a private-network address, saved only after confirmation.
  providerPrivateNetwork: '{address} is on a private network. Use it only if you trust it.',
  providerPrivateConfirm: 'Use it anyway',
  providerPrivateConfirmLabel: 'Use It Anyway',
  // {expected}: the origin the credential was entered for; {actual}: where
  // the file points now. The request is refused until it is entered again.
  originBindingMismatch:
    'This provider now points at {actual}, but the stored credential was entered for {expected}. Enter it again.',
  providerRedirectRefused: 'The provider redirected the request, so it was not sent.',
  // The composer's model picker (groups, pinned favourites first).
  addModelProviderRow: 'Add a Model Provider…',
  manageModelsRow: 'Manage Models…',
  // {window}: the model's context window; {price}: its price, `unpriced`,
  // `local` or `plan`.
  pickerModelDetail: '{window} context · {price}',
  // The models view's first group, when any model is pinned (M95).
  pickerPinnedGroup: 'Pinned Favourites',
  // The models view's group for Meta's own models, which carry no provider.
  pickerMetaGroup: 'Muse Spark',
  // {input}, {output}: a priced model's per-M-token prices as dollars.
  pickerPricePair: '{input} in · {output} out (per M tokens)',
  // Account & usage's rows per provider.
  usageKeyUsage: 'API Key Usage',
  usageLimit: 'Limit',
  usageRemaining: 'Remaining',
  usageToday: 'Today',
  usageThisMonth: 'This Month',
  usageUnpricedDetail: 'This model has no price card, so only its tokens are counted.',
  // Sign-out keeps provider keys unless this is ticked (M95 acceptance 15).
  signOutRemoveProviders: 'Also Remove Model Providers and Subscriptions',
  // The ACP agent's provider commands print through these.
  acpProvidersNone: 'No providers are configured.',
  // {id}: the provider id, as written.
  acpProviderAdded: 'Added provider {id}.',
  acpProviderRemoved: 'Removed provider {id}.',
  acpChatGpt: {
    usage: 'Usage: muse-spark-code-acp providers add|remove|status chatgpt [--new-account]',
    actions: {
      add: 'Continue With ChatGPT',
      // A new registration for another ChatGPT account (`providers add chatgpt --new-account`).
      'add-new-account': 'Use a Different ChatGPT Account',
      remove: 'Remove ChatGPT Sign-In',
      status: 'Check ChatGPT Sign-In',
    },
    notice:
      'ChatGPT Plus or Pro is required. Requests use your plan allowance; OpenAI may spend additional credits if you enabled them in ChatGPT. Continue in your browser to sign in.',
    alreadyAdded: 'ChatGPT is already added. Remove it before signing in again.',
    // The browser signed in to another account than the saved registration's.
    accountMismatch:
      'This is not the ChatGPT account this app registered here. Sign in with that account, or choose “Use a Different ChatGPT Account”.',
    // OpenAI answered invalid_client for the saved registration.
    clientRefused:
      'OpenAI no longer accepts this app’s saved ChatGPT registration. Remove ChatGPT if it is added, then choose “Use a Different ChatGPT Account”.',
    states: {
      'signed-in': 'ChatGPT is signed in.',
      expired:
        'ChatGPT sign-in has expired; it will refresh on use, or remove it and sign in again.',
      'signed-out': 'ChatGPT is not signed in.',
    },
    callback: 'ChatGPT sign-in is complete. Return to your editor or terminal.',
    failure: 'ChatGPT sign-in could not be completed. Try again or remove it and sign in again.',
    // Each sign-in, refresh or catalogue failure says its own cause; none is general.
    discoveryInvalid:
      'OpenAI’s sign-in configuration at auth.openai.com was not in the documented form. Try again later.',
    callbackInvalid: 'The browser’s answer did not match this ChatGPT sign-in. Try again.',
    callbackTimeout:
      'No answer from the browser reached this app in time, so the ChatGPT sign-in stopped. Try again.',
    stateMismatch:
      'The browser’s answer belonged to a different ChatGPT sign-in attempt. Try again.',
    tokenAnswerInvalid:
      'OpenAI’s token answer for this ChatGPT sign-in was not in the documented form. Try again.',
    idTokenInvalid:
      'OpenAI’s identity token for this ChatGPT sign-in could not be verified. Try again.',
    missingPlanScope:
      'This ChatGPT sign-in does not allow plan use: OpenAI did not grant chatgpt.tokens.use.direct. Remove ChatGPT, sign in again and allow plan use.',
    originMismatch:
      'This app refused to send the ChatGPT sign-in anywhere but https://api.openai.com.',
    // {reason}: OpenAI's own refresh error code, such as invalid_grant.
    signInRefused:
      'OpenAI no longer accepts this ChatGPT sign-in ({reason}). Remove ChatGPT and sign in again.',
    grantUnreadable:
      'The ChatGPT sign-in stored on this computer could not be read. Remove ChatGPT and sign in again.',
    registrationUnreadable:
      'This app’s saved ChatGPT registration could not be read. Choose “Use a Different ChatGPT Account” to register again.',
    // {reason}: where the host identifier is kept (a credential-store entry or a file name).
    hostIdUnreadable:
      'The ChatGPT host identifier stored on this computer ({reason}) could not be read, so no ChatGPT sign-in can start. Delete it to start over.',
    // {reason}: the HTTP status and OpenAI's own error code.
    catalogueRefused: 'OpenAI refused the ChatGPT plan’s model list ({reason}).',
    catalogueUnreadable:
      'OpenAI’s model list for this ChatGPT plan was not in the documented form.',
    catalogueEmpty: 'OpenAI lists no model this ChatGPT plan can use in this app.',
    addedModelsUnlisted:
      'None of the ChatGPT models added here is in the plan’s current model list. Remove ChatGPT and add it again to choose from the current list.',
    // {model}: the model reference asked for, as written.
    modelNotAdded:
      '{model} is not among the plan models added here. Choose one from the plan’s list.',
    // {reason}: the HTTP status, or Node's own network codes.
    requestFailed: 'A request to OpenAI failed ({reason}). Try again.',
    storeUnavailable:
      'This computer’s credential store is unavailable. Sign in from an interactive desktop session with an unlocked credential store; on Linux, start Secret Service first.',
    // {reason}: the operating system's own code for the failure.
    lockUnavailable: 'The local sign-in lock could not be opened ({reason}). Try again.',
    // {reason}: OpenAI's own error code for refusing the authorize request.
    authorizeRefused:
      'OpenAI refused the ChatGPT sign-in request ({reason}). Try again or remove it and sign in again.',
    // Another window or process kept the sign-in lock past the wait.
    lockBusy:
      'Another window or process is signing in to ChatGPT or refreshing the sign-in. Wait for it to finish and try again.',
    // The person or the editor ended the wait.
    cancelled: 'The ChatGPT sign-in was cancelled before it finished.',
    // Said when the editor or terminal could not show the sign-in address.
    browserUnavailable:
      'The sign-in address could not be opened in a browser. Open it yourself, or try again from a desktop session.',
    // {reason}: the operating system's code, or this app's own word, for the local failure.
    localFailed: 'A local step of the ChatGPT sign-in failed ({reason}). Try again.',
    // {reason}: why the providers file could not be read: unparseable or invalid.
    providersFileUnreadable:
      'The providers file could not be read ({reason}). Fix or remove it, then try again.',
    // {reason}: why the providers file could not be saved: invalid or io-error.
    providersFileUnwritable:
      'The providers file could not be saved ({reason}). Check that its folder is writable, then try again.',
  },
  acpGrok: {
    usage:
      'Usage: muse-spark-code-acp providers add|remove|status grok [--device] [--client-id <id>] [--scopes <scopes>]',
    actions: {
      add: 'Continue With Grok',
      // The device-code flow for SSH and remote hosts (`providers add grok --device`).
      'add-device': 'Continue With Grok (Device Code)',
      remove: 'Remove Grok Sign-In',
      status: 'Check Grok Sign-In',
    },
    notice:
      'A SuperGrok or X Premium subscription is required. Requests use your subscription allowance. Continue in your browser to sign in.',
    // The device flow's description: the code and address are shown by the terminal.
    deviceNotice:
      'A SuperGrok or X Premium subscription is required. Requests use your subscription allowance. Open the shown address and enter the code to sign in.',
    alreadyAdded: 'Grok is already added. Remove it before signing in again.',
    states: {
      'signed-in': 'Grok is signed in.',
      expired: 'Grok sign-in has expired; it will refresh on use, or remove it and sign in again.',
      'signed-out': 'Grok is not signed in.',
    },
    callback: 'Grok sign-in is complete. Return to your editor or terminal.',
    failure: 'Grok sign-in could not be completed. Try again or remove it and sign in again.',
    // {url}: xAI's verification address; {code}: the user code.
    code: 'To sign in with Grok, open {url} and enter the code {code}. Waiting for xAI; press Ctrl+C to cancel.',
    // Said when this app's own xAI client id is not configured: no request goes out.
    clientIdUnset:
      "Muse Spark Code's xAI sign-in awaits xAI's registration: xAI has not issued this app a client id. Once it has, set it in the Muse Spark: Grok Client Id setting, or pass --client-id to providers add grok.",
    // Each sign-in, refresh or catalogue failure says its own cause; none is general.
    discoveryInvalid:
      "xAI's sign-in configuration at auth.x.ai was not in the documented form. Try again later.",
    callbackInvalid: "The browser's answer did not match this Grok sign-in. Try again.",
    callbackTimeout:
      'No answer from the browser reached this app in time, so the Grok sign-in stopped. Try again.',
    stateMismatch: "The browser's answer belonged to a different Grok sign-in attempt. Try again.",
    tokenAnswerInvalid:
      "xAI's token answer for this Grok sign-in was not in the documented form. Try again.",
    idTokenInvalid: "xAI's identity token for this Grok sign-in could not be verified. Try again.",
    scopeRefused:
      'xAI granted this Grok sign-in less access than requested. Remove Grok, sign in again and allow the requested access.',
    originMismatch: 'This app refused to send the Grok sign-in anywhere but https://api.x.ai.',
    deviceExpired: 'The device code expired before it was approved. Sign in again.',
    deviceDenied: 'The Grok sign-in was denied at xAI.',
    // {reason}: xAI's own error code for refusing the device flow.
    deviceRefused: 'xAI refused the Grok device sign-in ({reason}). Try again.',
    verificationRefused:
      "xAI's reply named a sign-in address that cannot be opened safely, so it was refused.",
    // {reason}: xAI's own refresh error code, such as invalid_grant.
    signInRefused:
      'xAI no longer accepts this Grok sign-in ({reason}). Remove Grok and sign in again.',
    expired: 'xAI granted too little time to finish this request. Sign in again.',
    grantUnreadable:
      'The Grok sign-in stored on this computer could not be read. Remove Grok and sign in again.',
    // {reason}: the HTTP status, or Node's own network codes.
    requestFailed: 'A request to xAI failed ({reason}). Try again.',
    storeUnavailable:
      'This computer’s credential store is unavailable. Sign in from an interactive desktop session with an unlocked credential store; on Linux, start Secret Service first.',
    // {reason}: the operating system's own code for the failure.
    lockUnavailable: 'The local sign-in lock could not be opened ({reason}). Try again.',
    // {reason}: xAI's own error code for refusing the authorize request.
    authorizeRefused:
      'xAI refused the Grok sign-in request ({reason}). Try again or remove it and sign in again.',
    // Another window or process kept the sign-in lock past the wait.
    lockBusy:
      'Another window or process is signing in to Grok or refreshing the sign-in. Wait for it to finish and try again.',
    // The person or the editor ended the wait.
    cancelled: 'The Grok sign-in was cancelled before it finished.',
    // Said when the editor or terminal could not show the sign-in address.
    browserUnavailable:
      'The sign-in address could not be opened in a browser. Open it yourself, or try again from a desktop session.',
    // {reason}: the operating system's code, or this app's own word, for the local failure.
    localFailed: 'A local step of the Grok sign-in failed ({reason}). Try again.',
    // {reason}: why the providers file could not be read: unparseable or invalid.
    providersFileUnreadable:
      'The providers file could not be read ({reason}). Fix or remove it, then try again.',
    // {reason}: why the providers file could not be saved: invalid or io-error.
    providersFileUnwritable:
      'The providers file could not be saved ({reason}). Check that its folder is writable, then try again.',
    // {reason}: the HTTP status and xAI's own error code.
    catalogueRefused: "xAI refused the Grok subscription's model list ({reason}).",
    catalogueUnreadable:
      "xAI's model list for this Grok subscription was not in the documented form.",
    catalogueEmpty: 'xAI lists no model this Grok subscription can use in this app.',
    addedModelsUnlisted:
      "None of the Grok models added here is in the subscription's current model list. Remove Grok and add it again to choose from the current list.",
    // {model}: the model reference asked for, as written.
    modelNotAdded:
      "{model} is not among the Grok models added here. Choose one from the subscription's list.",
  },
  // D207: each sign-in failure below says its own cause; the general line
  // stays for the callers the merges kept.
  // GitHub sign-in outside VS Code (M123 lane A, PLAN.md D104): the device
  // flow's code, shown by the CLI, the ACP notice and the panel alike.
  githubSignIn: {
    usage: 'Usage: muse-spark-code-acp auth github login|logout|status',
    // {url}: GitHub's https://github.com/login/device; {code}: the user code.
    code: 'To sign in to GitHub, open {url} and enter the code {code}. Waiting for GitHub; press Ctrl+C to cancel.',
    // {store}: where the token is kept (the credential store's name).
    signedIn: 'Signed in to GitHub. The token is kept in {store}.',
    notSignedIn:
      'Not signed in to GitHub. Run muse-spark-code-acp auth github login to sign in with GitHub’s device flow.',
    // {url}: the app's page on github.com, where the grant is revoked.
    signedOut:
      'Signed out of GitHub: the token was deleted from this computer. To revoke the app’s access as well, open {url} and choose Revoke.',
    cancelled: 'GitHub sign-in was cancelled.',
    failures: {
      clientIdUnset: 'This build has no GitHub app client id, so GitHub sign-in is unavailable.',
      verificationAddress:
        'GitHub’s reply named a sign-in address other than github.com/login/device, so it was refused.',
      userCode: 'GitHub’s reply held a code that cannot be shown safely, so it was refused.',
      expired: 'The code expired before it was entered. Sign in again.',
      denied: 'The sign-in was denied on GitHub.',
      disabled: 'GitHub has the device flow turned off for this app.',
      incorrectClient: 'GitHub did not recognize this app’s client id.',
      incorrectDeviceCode: 'GitHub did not recognize the sign-in code. Sign in again.',
      unsupportedGrant: 'GitHub refused the sign-in request.',
      refreshRefused: 'GitHub refused to renew the sign-in. Sign in again.',
      network: 'GitHub could not be reached. Check the connection and try again.',
      reply: 'GitHub’s reply could not be read.',
    },
  },
  execProviderNotCatalogue: 'This model is not in this build’s catalogue: {model}.',
  providerCliModelsRequired: 'Use --model <id> (repeat for more models). Available: {models}.',
  providerCliConfigure:
    'Check these flags: --preset {preset}, --model <id>, --key-stdin, --address <url>, --private-ok.',
  execProviderNotConfigured: 'Provider {id} is not configured.',
  // M95 providers: evaluated through UI_TEXT at use time.
  providerText: {
    wizard: {
      cancelled: 'The wizard was cancelled.',
      pick: 'Pick a provider first.',
      address: 'Enter the server address.',
      credential: 'Enter the key or connect the account first.',
      test: 'Test the connection first.',
      models: 'Tick at least one model.',
      validate: 'Validate the server address first.',
      refused: 'The server address was refused: {reason}',
      private: 'Confirm access to this private network first.',
      pickStep: 'Pick a provider from its own step.',
      keyStep: 'Enter the key at its own step.',
      oauthStep: 'Connect the account at its own step.',
      costStep: 'Accept the test cost at its own step.',
      testStep: 'Run the test at its own step.',
      costConsent: 'Say the test’s cost and ask first: it was not accepted.',
      modelsStep: 'Tick models at their own step.',
      privacyStep: 'Choose privacy at its own step.',
      passedTest: 'A passed test comes before the models.',
      finish: 'Confirm to finish.',
      confirmStep: 'Confirm from the summary step.',
    },
    summary: {
      provider: 'Provider: {value}',
      destination: 'Code goes to: {value}',
      models: 'Models: {value}',
      defaultSuggested: 'Default model: suggested',
      defaultModel: 'Default model: {value}',
    },
    schema: {
      id: 'A provider id, never "meta"',
      modelRef: 'A model reference',
      outputCap: 'Output cap exceeds context window',
      customLimits: 'Custom models require context windows and output caps',
      compat: 'Compatibility overrides apply only to a custom server',
      upstream: 'Upstream routing applies only to a Hugging Face entry',
    },
    descriptions: {
      openai: 'OpenAI Responses API with GPT models',
      azure: 'Azure OpenAI v1 API on your own resource and deployment',
      xai: 'Grok models on the xAI Responses API',
      anthropic: 'Claude models on the Anthropic Messages API',
      gemini: 'Gemini models on the generateContent API',
      openrouter: 'Hundreds of models through one key, with privacy routing',
      groq: 'Fast inference on Groq hardware, OpenAI-compatible',
      deepseek: 'DeepSeek chat models with thinking on by default',
      mistral: 'Mistral chat models with prompt caching',
      mistralPlan: 'Uses your Mistral subscription’s credits, not pay-as-you-go billing.',
      together: 'Open models on Together, priced per model',
      fireworks: 'Fast open-model inference on Fireworks',
      huggingface: 'The Hugging Face router across many providers',
      zai: 'GLM models on Z.ai pay-as-you-go',
      moonshot: 'Kimi models on the Moonshot API',
      ollamaCloud: 'Ollama Cloud models through an API key',
      minimaxPlan: 'MiniMax models on an M Plan key',
      alibabaPlan: 'Alibaba models on a Coding Plan key',
      ollama: 'Models on this computer through Ollama',
      lmstudio: 'Models on this computer through LM Studio',
      vllm: 'A vLLM server, here or on your network over HTTPS',
      llamacpp: 'A llama.cpp server, here or on your network over HTTPS',
      custom: 'Any Chat Completions, Responses or Messages server',
    },
    hints: {
      site: 'The key from {site}',
      azure: 'The resource key from the Azure portal',
      router: 'The key from {site} or Connect OpenRouter account',
      custom: 'The key the server expects',
    },
    privacy: {
      zdr: 'No data retention: only endpoints that store no data at all may answer.',
      'no-training': 'No training: only providers that do not train on your data may answer.',
      any: 'Any provider: the cheapest or fastest answer wins, including providers that may keep data.',
    },
    suggest: {
      recommended:
        'Recommended, and the cheapest tool-calling model with room for the harness ({ref}).',
      cheapest: 'The cheapest tool-calling model with room for the harness ({ref}).',
      last: '{reason} It is also your last default.',
      history: 'Your recent sessions’ median: {amount} a session.',
      reference: 'No history yet: a reference session at the default model’s prices ({amount}).',
    },
    scan: {
      empty: 'First scan: no models listed.',
      first: forms({
        one: 'First scan: {count} model.',
        other: 'First scan: {count} models.',
      }),
      new: forms({
        one: '{count} new model',
        other: '{count} new models',
      }),
      removed: forms({
        one: '{count} removed model',
        other: '{count} removed models',
      }),
      repriced: forms({
        one: '{count} repriced model',
        other: '{count} repriced models',
      }),
      unchanged: 'No changes since the last scan.',
      since: '{changes} since the last scan.',
    },
    labels: {
      custom: 'Custom Server',
      mistralPlan: 'Mistral Plan',
    },
  },
  // M95: locally authored Anthropic errors; protocol identifiers remain technical.
  anthropicCodecError: 'Anthropic could not process this request.',
  anthropicCodecPdfUnsupported: 'PDF input is not supported for Anthropic models.',
  anthropicCodecImageInvalid:
    'Anthropic images must use a base64 data URL with a supported image type.',
  anthropicCodecToolArgumentsInvalid: 'Anthropic tool arguments must be a JSON object.',
  anthropicCodecEffortUnsupported: 'This reasoning effort is not supported by Anthropic.',
  // Lane DSTHINK: the Chat codec's typed refusal for an unlisted effort.
  chatCodecEffortUnsupported: 'This reasoning effort is not supported by the selected model.',
  // Lane DSTHINK3: the same typed refusal for Thinking off on a model that
  // cannot disable thinking.
  chatCodecThinkingOffUnsupported: 'Thinking cannot be turned off for the selected model.',
  anthropicCodecEmptyTurn: 'Anthropic requires at least one message.',
  anthropicCodecLimitExceeded: 'The Anthropic response exceeded a decoding limit.',
  anthropicCodecManyImagesDimensions:
    'Anthropic allows at most {maxPixels} px per image side in requests with more than {maxImages} images ({count} images, largest side {pixels} px).',
  anthropicCodecRequestTooLarge:
    'Anthropic allows requests up to {maxSize} (this request is {size}).',
  // M95-M (the Models panel's framework, PLAN.md D74): the table, filter
  // and form labels the panel's shared components read. Lane 0 tabled the
  // M95 flows above; these rows are the panel's own.
  modelsEmpty: 'No model providers yet. Add one to use your own models.',
  panelNoMatches: 'No matches.',
  modelFilterLabels: {
    toolCalling: 'Tool Calling',
    vision: 'Vision',
    reasoning: 'Reasoning',
    contextMin: 'Min Context',
    contextMax: 'Max Context',
    maxInput: 'Max Input Price',
    maxOutput: 'Max Output Price',
    maxCached: 'Max Cached Price',
    freeOrLocal: 'Free or Local',
    provider: 'Provider',
    family: 'Family',
    clear: 'Clear Filters',
    any: 'Any',
  },
  // {model}: the qualified model reference.
  tickModel: 'Offer {model} in the Model Picker',
  // {model}: the qualified model reference.
  pinModel: 'Pin {model} as a Favourite',
  modelsColumnOffered: 'Offered',
  modelsColumnPinned: 'Pinned',
  providerDetailFields: {
    azureResource: 'Azure Resource',
    deployment: 'Deployment',
    loopbackPort: 'Local Port',
    customFormat: 'Wire Format',
    safetyIdentifier: 'End-user ID (xAI safety)',
  },
  providerDocs: 'Documentation',
  providerDataUse: 'How Your Data Is Used',
  numCtxLabel: 'Context Size',
  suggestUnavailable: 'No suggestion: no model here qualifies.',
  // {model}: the last default's qualified reference.
  lastDefaultHint: 'Last default: {model}',
  importUntrusted: 'This file is untrusted: check every address before importing.',
  openRouterOrder: 'Preferred Provider Order',
  openRouterFallback: 'Fall Back to Other Providers',
  keyMissing: 'No Key Stored in the Editor',
  // Provider keys live in two separate stores (RLTESTDRIVE item 6): the
  // editor's secret storage for keys entered here, the agent's own OS
  // credential store entries for keys entered in the terminal.
  providerKeysSplitStores:
    'Keys entered here stay in the editor’s secret storage; the terminal agent keeps its own keys in the OS credential store.',
  testRunning: 'Testing…',
  // {shown}: the filtered rows; {count}: every row.
  modelsShownCount: forms({
    one: '{shown} of {count} model',
    other: '{shown} of {count} models',
  }),
  pricePerMillion: 'Prices per million tokens.',
  modelsNotScanned: 'Refresh to list this provider’s models.',
  teamFileHelperMissing: 'The verified native worker file helper is unavailable.',
  teamFileNativeFailed: 'The native worker file proof failed; no file contents were written.',
  // {kind}: the helper exception's type name, fixed vocabulary, never a path.
  teamFileHelperFailed:
    'The worker file helper itself failed ({kind}); no file contents were written.',
  teamFileLinked: 'The file path contains a link or a reinterpreted component.',
  teamFileOutside: 'The file is outside the admitted working copy.',
  teamFileRoleDenied: 'The role does not allow writing this path.',
  teamFileExists: 'The new file path is already occupied.',
  teamFileChanged: 'The reserved file or its parent changed.',
  // {path}: the working-copy-relative path that cannot be created.
  teamFileCannotCreate: 'The file {path} cannot be created inside the working copy.',
  referenceTeamFiles:
    'Teams remain unavailable pending integration and certification. Engine and ACP workers can create files through the verified native helper, within their working copy and role write paths.',
  // Native Ollama codec failures (M95).
  ollamaModelRequired: 'Ollama needs a model id.',
  ollamaContextRequired: 'Ollama needs a positive integer num_ctx.',
  ollamaPdfUnsupported: 'Ollama does not accept PDF input.',
  ollamaToolImageUnsupported: 'Ollama does not accept images in tool results.',
  ollamaDuplicateCall: 'Ollama history contains a duplicate tool call id.',
  ollamaResponseIdRequired: 'Ollama needs a unique response id for this request.',
  ollamaMissingFinal: 'Ollama closed the stream without a final answer.',
  // Azure OpenAI (M95): a 404 on the resource names a deployment that is not there.
  azureDeploymentInvalid:
    'Azure OpenAI has no such deployment on this resource. Check the deployment name.',
  ollamaMalformedFrame: 'Malformed Ollama stream frame.',
  ollamaStreamLimit: 'Ollama exceeded the stream size or item limit.',
  ollamaFinishReason: 'Ollama finished with reason "{reason}".',
  // M96 lane R (PLAN.md D75): agent roles. {role}: the role id.
  teamCapabilityNoTools: 'This model cannot call tools, so it cannot run the {role} role.',
  // {tokens}: the model's window; {minimum}: what every role needs.
  teamCapabilitySmallWindow:
    'This model’s context window ({tokens} tokens) is below the {minimum} tokens every role needs.',
  // {tokens}: the model's window; {recommended}: the role's recommendation; {role}: the role id.
  teamCapabilityWarnWindow:
    'This model’s context window ({tokens} tokens) is below the {recommended} tokens recommended for the {role} role.',
  // {role}: the role id.
  teamCapabilityWarnImages:
    'This model takes no image input, which the {role} role works better with.',
  teamCapabilityWarnReasoning:
    'This model has no reasoning tier, which the {role} role works better with.',
  // {model}: the model id; {role}: the role id.
  teamCapabilityUnknown:
    'The capabilities of {model} are unknown; it was not checked for the {role} role.',
  // A saved team setting the selected model does not take. {setting} and
  // {value} are the saved technical key and value; {model}: the model id.
  teamSettingUnsupported: 'The saved team setting {setting} ({value}) is not supported by {model}.',
  // A role or team.json file refused whole. {file}: the file; {detail}: the technical reason.
  teamRoleFileRefused: '{file}: {detail}',
  teamRoleResolutionUnknown:
    'Role resolution refused because an input is missing, unreadable, malformed or ambiguous.',
  teamRoleGlobUnproven: 'Write-path inclusion cannot be proved.',
  teamRoleNotFound: 'Role {role} is not in the complete catalogue.',
  teamJsonRefused: '{file}: {detail}',
  // {id}: the project role; {detail}: the wider asks.
  teamRoleNeedsAllowance:
    'The project role {id} asks for {detail}; it runs read-only until allowed for this workspace.',
  // M96 (PLAN.md D75): the team. Every role, pool, task, ledger and hint
  // string the Roles section, the Agent map and the cards show. Text the
  // model reads is TEAM_MODEL_TEXT in constants.ts and stays English.
  teamEditor: {
    transcript: 'Open Transcript',
    diff: 'Review Diff',
    editRole: 'Edit in Roles Section',
    stopAll: 'Stop All Team Tasks',
    toolSearch: 'Search Tools',
    workspace: 'Workspace',
    poolKeys: 'Alt+Up / Alt+Down move this entry in its pool.',
    purpose: 'Purpose',
    done: 'Done Criteria',
    guidance: 'Guidance',
    roleId: 'Role ID',
    pools: 'Pools',
    concurrent: 'Running Limit',
    caps: 'Caps',
    task: 'Task',
    day: 'Day',
    lifetime: 'Lifetime',
    addCap: 'Add Cap',
    reapply: 'Re-apply Level',
    empty: 'No Team Is Running',
    save: 'Save Team',
    saved: 'Team saved.',
    invalid: 'Review the team’s invalid or missing values before saving.',
    moveLabel: 'Moved {entry} to position {position}.',
    noCalls: 'This preview makes no model call and costs nothing.',
    settings: 'Model Settings',
    agents: 'Agents',
  },
  teamEditorRoles: {
    research: 'Research',
    design: 'Design',
    marketing: 'Marketing',
    engineering: 'Engineering',
    qa: 'QA',
    'code-review': 'Code Review',
    docs: 'Docs',
  },
  referenceTeamPoolKeys: 'Alt+Up / Alt+Down move this entry in its pool.',
  referenceTeamConfiguration:
    'Roles and Agents stay hidden until the team worker and configuration bindings are installed.',
  teamRolesTitle: 'Roles',
  teamAgentsTitle: 'Agent Map',
  teamHistoryTitle: 'Team History',
  teamOrchestratorSlot: 'Orchestrator',
  teamResetToDefault: 'Reset to Default',
  teamAddCustomRole: 'Add Custom Role',
  teamCharterEnforced: 'The harness enforces this',
  teamAccessModes: {
    readOnly: 'Read-Only',
    ownBranch: 'Own Branch',
    inPlace: 'In Place',
  },
  teamInPlaceConfirm:
    'A worker in this role writes in your own tree, beside your own edits. Only writers you allow here run this way: never a repository, a project role or a template.',
  teamToolChecklist: 'Tool Set',
  teamToolGroups: {
    read: 'Read',
    codeIntel: 'Code Intel',
    rename: 'Rename',
    write: 'Write',
    shell: 'Shell',
    readOnlyShell: 'Read-Only Shell',
    testShell: 'Test Shell',
    checks: 'Checks',
    diagnostics: 'Diagnostics',
    webFetch: 'Web Fetch',
    webSearch: 'Web Search',
    images: 'Images',
    memoryRead: 'Memory Read',
    skills: 'Skills',
    report: 'Report',
  },
  teamReportShapes: {
    summary: 'Summary',
    review: 'Review',
    qa: 'Q&A',
  },
  teamPoolFree: 'Free',
  teamAddEntry: 'Add Entry',
  teamDefaultEntry: 'Default',
  // {model}: what Default resolves to now, for example a model and backend.
  teamDefaultResolves: 'Default ({model})',
  // {model}: the entry's model; {reason} or {warning}: what the check found.
  teamCapabilityRefused: '{model} cannot take this role: {reason}.',
  teamCapabilityWarning: '{model}: {warning}.',
  teamIntensityTitle: 'Intensity',
  // M96 lane F (PLAN.md D75): team templates, autofill, intensity, model
  // settings, cap validation, preview and transfer.
  teamTemplateSolo: 'Solo',
  teamTemplatePair: 'Pair (Code + Review)',
  teamTemplateFull: 'Full Team',
  teamTemplateCustom: 'Custom',
  // {step}: the guided first run's step number.
  teamSetupStep: 'Set-up step {step}',
  teamIntensityLevels: {
    minimal: 'Minimal',
    light: 'Light',
    balanced: 'Balanced',
    heavy: 'Heavy',
    max: 'Max',
  },
  // {cost}: the level's dollars per hour; {tokens}: its tokens per hour.
  teamIntensityCost: '{cost} per hour, about {tokens} tokens',
  teamTemplates: {
    solo: 'Solo',
    pair: 'Pair (Code + Review)',
    full: 'Full Team',
    custom: 'Custom',
  },
  teamTemplateDetails: {
    solo: 'No delegation: exactly today’s chat.',
    pair: 'Engineering and code review on different vendors.',
    full: 'Research, design, engineering, QA, code review and docs, with marketing offered.',
    custom: 'Start empty and add what you need.',
  },
  teamSetupSteps: {
    template: 'Template',
    agents: 'Agents Found',
    pools: 'Pools',
    limits: 'Limits',
    preview: 'Preview',
  },
  // Cap prefills, each with its reason (D75). {amount}: the suggested cap;
  // {window}: its window; {role}: the role; {count}: the learned tasks.
  teamCapPrefillDefault: '{amount} per {window}: the default for {role}.',
  teamCapPrefillLearned: '{amount}: the median of your last {count} {role} tasks.',
  // Inline cap validation (D75). {label}: the cap; {minimum}: one request's
  // minimum in tokens.
  teamCapBelowMinimum: '{label} is below one request’s minimum ({minimum}).',
  teamCapTaskAboveDay: 'A task cap above the same measure’s day cap never fills.',
  teamCapDollarsUnpriced: 'A dollar cap needs a priced model: use a token cap.',
  teamCapUnpricedNeedsCaps:
    'A model without a price joins a pool only with token caps in both the task and the day window.',
  teamCapConcurrentAboveGlobal: 'Above the global caps: it runs at the ceiling.',
  teamCapDayAboveBudget: 'Above the team’s daily budget: it stops at the budget.',
  teamSuggestionAccept: 'Accept',
  teamSuggestionChange: 'Change',
  teamSuggestionDismiss: 'Dismiss',
  // Autofill suggestions, each with its reason (D75).
  teamSuggestReviewVendor: 'Review on {model}: another vendor than {other}.',
  teamSuggestCheapest: '{model} passes the capability check and costs least here.',
  teamSuggestFallback: 'One entry only: add a fallback ({model}).',
  teamSuggestBudgetCaps: 'Day caps that fit the daily budget left: {amount}.',
  teamSuggestLearned: '{median} from your last {count} {role} tasks.',
  // Reorder suggestion from recorded outcomes (D103, M120 lane 5). {better}
  // moves above {worse}: each named with its first-review acceptances and
  // tasks; {role} is the role id the panel already shows.
  teamOutcomeReorderReason:
    '{better}: {betterAccepted} of {betterTasks} {role} tasks accepted on first review; {worse}: {worseAccepted} of {worseTasks}.',
  teamPreviewTitle: 'Preview',
  teamPreviewSample: 'Sample Task',
  // {cost}: the labelled cost of one orchestrator turn.
  teamTryTally: 'Paid preview: {attempts}; charged {charged}; retained liability {retained}.',
  teamTryDenied: 'Paid planning preview denied. No charge was made.',
  teamNotReleased: 'Agent teams are not available in this build.',
  teamTryWithOrchestrator: 'Try With the Orchestrator ({cost})',
  teamImportDraft: 'Opened as a draft: entries you lack show as missing.',
  teamEntryMissing: 'Missing: map it to one of your agents or remove it.',
  teamIncludeTranscripts: 'Include Transcripts',
  // The tree's states (D75). Entry states with a time or reason ride in the
  // templates below.
  // {time}: when the mark lifts; {reason}: why the entry cannot run.
  teamEntryRateLimited: 'Rate-limited until {time}.',
  teamEntryUsageLimited: 'At its usage limit until {time}.',
  teamEntryUnavailable: 'Unavailable: {reason}.',
  teamEntryCapped: 'Capped: {reason}.',
  teamResumeAction: 'Resume',
  teamTakeBack: 'Take Back',
  teamMoveToBridge: 'Move to the Shared Bridge',
  teamResetRecord: 'Reset Record',
  // One transcript row per switch (D75). {role}: the role; {from} and {to}:
  // the entries; {reason}: one of teamSwitchReasons with its figures.
  teamSwitchRow: '{role}: {from} → {to}, {reason}',
  teamWaitingForYou: 'Waiting for You',
  teamChoiceQueue: 'Queue It',
  teamChoiceSelf: 'Main Agent Does It',
  teamChoiceRaise: 'Raise a Limit…',
  teamChoiceCancel: 'Cancel',
  teamNotStaffed: 'Not staffed: the pool is empty.',
  teamOnlyOneModel: 'Only one model is ready: the team applies from a new conversation.',
  teamUndoMerge: 'Undo Merge',
  teamBranchMoved: 'The branch moved during the task.',
  // {file}: the file whose merge conflicts.
  teamMergeConflicted: '{file} has conflicts.',
  teamNoSecondModel:
    'The team is on, but only one model is ready, so this conversation works as today. Add a second model to a role to start the team.',
  // The paid feature `teamWorkers` (D48, rule 12): asked once before the
  // first charge, with the price and the shared daily budget. {price}: each
  // model's prices; {ceiling}: each task's ceiling; {budget}: the shared
  // daily budget.
  teamWorkersName: 'Team Workers',
  teamPaidTitle: 'Let team workers use your key?',
  teamPaidDetail: '{price}\nEach task is capped at {ceiling}. Shared daily budget: {budget}.',
  // {task} and {day}: the token ceilings of an unpriced key model.
  teamPaidUnknownPrice:
    'The price is unknown: this entry runs under token ceilings of {task} per task and {day} per day.',
  // {command}: the external agent's command line.
  teamPaidExternalOnce:
    '{command} runs under its own rules, billed however it is paid. The first task in each workspace asks once.',
  // Lane K's hints, orphans, probes and refusals (M96, D75). {file}: the
  // file or journal; {server}: the exclusive server; {unread}: the tasks
  // that could not be read.
  teamHintContinue: 'Continue',
  teamHintWait: 'Wait',
  teamHintOpenWindow: 'Open That Window',
  teamHintStartAnyway: 'Start Here Anyway',
  teamHintsOff: 'Team hints are off: the hints folder cannot be used. Nothing else changes.',
  teamHintFileClash: '{file} is open in another window.',
  teamHintServerRunning: '{server} runs in another window.',
  teamRetry: 'Retry',
  teamOpenTerminalHere: 'Open a Terminal Here',
  teamRestartServer: 'Restart Server',
  teamTestAgain: 'Test Again',
  teamOpenProviderSettings: 'Open Provider Settings',
  teamOrphanKeep: 'Keep',
  teamOrphanShowTerminal: 'Show in a Terminal',
  teamJournalBroken: '{file} did not parse and was moved aside. {unread} tasks could not be read.',
  teamNoSubtaskSlot: 'No free slot for a sub-task: the orchestrator does it itself.',
  teamHostBusy: 'Host Busy',
  // Lane M96-0b: recovery and landing actions (round-4 plan). Button labels
  // use the plan's exact words; each explanation names what the action ends
  // or risks. {sessions}: the team worker sessions to end; {server}: the
  // exclusive server; {files}: the files that changed; {task}: the old task.
  teamRestartTeamHost: 'Restart the Team Host',
  teamRestartTeamHostDetail:
    'Ends only this window’s team worker sessions ({sessions}). The conversation’s own sessions are untouched.',
  teamContinueAnyway: 'Continue Anyway',
  teamContinueAnywayWarning:
    'Retirement cannot be proved here (macOS, and Linux without a user scope). Continuing records your decision that the earlier attempt has stopped, not proof.',
  teamReleaseAnyway: 'Release Anyway',
  teamReleaseAnywayWarning:
    'Releases {server} as your decision, not as proof: the earlier call may still be acting on the resource.',
  teamTakeOver: 'Take Over',
  teamTakeOverWarning:
    'Take over marks the old task interrupted in this window’s records and offers to discard its copy and branch. If the other window is still open, its task breaks.',
  teamContinueHereAsNewTask: 'Continue Here as a New Task',
  teamContinueHereAsNewTaskDetail:
    'Starts a new task in a fresh working copy from the old task’s last commit. The old task keeps its id, its copy, its branch and its journal row, untouched.',
  teamIncludeUncommittedEdits: 'Include Its Uncommitted Edits',
  teamIncludeUncommittedEditsDetail:
    'Reads a snapshot of the old copy through a temporary index: a read, never a write.',
  teamLandingApply: 'Apply',
  teamChangedDuringLanding: forms({
    one: '{count} file changed during landing: {files}.',
    other: '{count} files changed during landing: {files}.',
  }),
  // A Roles-section setting: probing is setup traffic, authorized by
  // configuring a second model.
  teamCheckModelsOnOpen: 'Check the Team’s Models When This Window Opens',
  teamCheckModelsOnOpenDetail:
    'When on, and a role has a distinct custom model, the panel probes the team’s models once when the window opens. Configuring a second model is what authorizes this traffic.',
  teamDuplicateJournal:
    'Another window’s journal ({task}) may belong to a window that is still open. Nothing here writes its copy, branch or journal row.',
  teamThrottledByProvider: 'throttled by provider',
  // {low}, {high}: dollars per hour; {tokens}: tokens per hour.
  teamLevelCost: '{low}–{high} per hour, {tokens} tokens',
  teamLevelCostTokens: '{tokens} tokens per hour',
  teamControlLabels: {
    thinkingBudget: 'Thinking budget',
    outputCap: 'Output cap',
    parallelToolCalls: 'Parallel tool calls',
    temperature: 'Temperature',
    topP: 'Top-p',
  },
  teamSettingCostEffort: 'Higher effort is slower, about twice the tokens per step up',
  teamSettingCostThinking: 'Thinking adds reasoning tokens to every task',
  teamSettingCostServiceTier: 'Priority tiers cost more per token',
  teamSettingCostMaxOutput: 'A higher cap lets long answers finish, at their token cost',
  teamSettingCostSampling: 'Sampling changes style, not cost',
  teamSettingCostVerbosity: 'Higher verbosity uses more output tokens',
  teamSettingCostParallel: 'Parallel tool calls finish faster at the same token cost',
  teamSettingCostContextCap: 'A lower cap compacts earlier and bounds each reservation',
  // {minimum}: the token floor below which a cap cannot serve one request.
  teamCapTokenTooSmall: 'Below one request’s minimum of {minimum} tokens',
  teamCapInvalidAmount: 'Use a finite positive cap; token and task counts must be whole numbers',
  teamCapInvalidConcurrent: 'Running concurrency must be a whole number of at least one',
  teamCapDollarUnpriced: 'A dollar cap needs a priced model; use a token cap',
  // {budget}: the team's daily budget.
  teamCapDayAboveBudgetDetail: 'Above the team’s daily budget of {budget}',
  // {maximum}: the global running limit.
  teamCapConcurrentAboveGlobalDetail: 'Above the global limit of {maximum} running',
  teamCapUnpricedKeyNeedsCaps: 'An unpriced key model needs both a task and a day token cap',
  // {model}: the suggested model; {vendor}: its vendor.
  teamSuggestReviewVendorDetail:
    'Review on {model} ({vendor}), a different vendor from engineering',
  // {model}: the suggested model; {role}: the role it would serve.
  teamSuggestCheapestDetail: '{model} is the cheapest model that can do {role} work',
  teamSuggestFreeLocal: '{model} is free and local, and can do {role} work',
  // {role}: the single-entry pool; {model}: the suggested second entry.
  teamSuggestFallbackDetail: '{role} has one entry; add {model} as its fallback',
  // {role}: the role; {amount}: the suggested day cap.
  teamSuggestBudget: '{role} day cap of {amount}, from the remaining daily budget',
  // M96d Traffic suggestions: {count} below is the measured count.
  trafficSuggestAddReviewer: forms({
    one: '{count} change waits for review with no free reviewer lane; adding {model} to {role} unblocks it',
    other:
      '{count} changes wait for review with no free reviewer lane; adding {model} to {role} unblocks them',
  }),
  trafficSuggestRaiseIntensity: forms({
    one: '{count} task is ready but the running caps are full; raising intensity from {from} to {to} starts it',
    other:
      '{count} tasks are ready but the running caps are full; raising intensity from {from} to {to} starts more',
  }),
  trafficSuggestAddProviderEntry: forms({
    one: '{entry} was throttled {count} time; adding {model} on {provider} spreads the load',
    other: '{entry} was throttled {count} times; adding {model} on {provider} spreads the load',
  }),
  trafficSuggestDeclareSharedFile: forms({
    one: '{path} caused {count} conflict out of {total}; declaring it a shared file with regions lets the next change land cleanly',
    other:
      '{path} caused {count} conflicts out of {total}; declaring it a shared file with regions lets the next changes land cleanly',
  }),
  trafficSuggestAddRunner: forms({
    one: 'The load guard tripped {count} time; adding a runner (now {runners}) absorbs the load',
    other: 'The load guard tripped {count} times; adding a runner (now {runners}) absorbs the load',
  }),
  trafficSuggestLowerIntensity: forms({
    one: 'The load guard tripped {count} time; lowering intensity from {from} to {to} eases the machine',
    other:
      'The load guard tripped {count} times; lowering intensity from {from} to {to} eases the machine',
  }),
  trafficSuggestUserWaiters: forms({
    one: '{count} task waits for you; answering unblocks it',
    other: '{count} tasks wait for you; answering unblocks them',
  }),
  teamPreviewFeatureTests: 'A feature with tests',
  teamPreviewResearchLibrary: 'Research a library',
  teamPreviewReviewBranch: 'Review my branch',
  // {low}, {high}: the estimated cost range; {tokens}: the token figure.
  teamPreviewCost: '{low}–{high} for about {tokens} tokens',
  teamPreviewCostTokens: 'About {tokens} tokens; no priced entry takes part',
  teamPreviewCostUnknown: 'About {tokens} tokens; price unknown',
  teamLevelCostUnknown: '{tokens} tokens per hour; price unknown',
  // {count}: the steps the caps moved off the first entry.
  teamPreviewSwitches: forms({
    one: '{count} switch forced by caps',
    other: '{count} switches forced by caps',
  }),
  // {cost}: the one orchestrator turn's estimated cost.
  teamPreviewDryRunCost: 'Try with the orchestrator first: one turn, about {cost}',
  // {key}: the unknown setting; the whole file is refused.
  teamImportUnknownKey: 'Unknown setting {key}: the file was refused whole',
  // {model}: the entry's model reference.
  teamImportMissingEntry:
    '{model} is not installed here; map it to one of your models or remove it',
  legalRegistryNotice:
    'Before the first lookup: {hosts}. Only package names and versions are sent over HTTPS; no source, paths or lockfile contents are uploaded. Turn off Legal Registry Lookups for offline scans.',
  legalRegistryOfflineUnknown:
    'Offline: missing dependency license findings remain unknown because registry lookups are disabled or declined.',
  legalRegistryFact: '{name}@{version}: the registry declares {license}.',
  legalRegistryRecommendation:
    'Verify the original terms and distribution obligations; registry metadata does not prove rights.',
  legalRegistryMetadataOnly:
    'Registry metadata is supplemental; original license terms and local incomplete findings still require review.',
  legalScanTitle: 'Legal Scan',
  legalScanDisclaimer: 'Not legal advice; for distribution decisions consult a lawyer.',
  legalScanEmpty: 'The scan completed with no findings.',
  legalFindingsCount: forms({
    one: '{count} finding',
    other: '{count} findings',
  }),
  legalFilesScanned: 'Files scanned: {count}',
  legalScanIncomplete: 'Incomplete: {checks}',
  legalScanFailed: 'The legal scan failed: {reason}',
  legalScanUnavailable:
    'The legal scanner could not be loaded; reinstall the extension and reload the window. The log has the details.',
  legalSeverities: {
    blocker: 'Blocker',
    'should-fix': 'Should Fix',
    advice: 'Advice',
  },
  legalCategories: {
    license: 'License',
    copyrightHeader: 'Copyright Header',
    spdxIdentifier: 'SPDX Identifier',
    noticeFile: 'Notice File',
    dependencyLicense: 'Dependency License',
    distribution: 'Distribution',
    codeQualityHeader: 'Code Quality Header',
  },
  legalHeaderPolicies: {
    required: 'Required',
    optional: 'Optional',
    off: 'Off',
  },
  legalFixable: 'Fixable',
  legalNotFixable: 'Recommendation Only',
  legalEvidenceLabel: 'Evidence: {evidence}',
  legalConfidenceLabel: 'Confidence: {confidence}',
  legalScanItem: '/legal',
  legalCommandUsage: 'Usage: /legal [workspace-relative path …]. Options are not supported.',
  legalScanReceiptHelp:
    'Local licence scan; optional licence-review.json receipts bind a reviewed SPDX licence to its package, exact version and SHA-256, with a reason. Changed bytes or versions require review again.',
  legalScanItemDetail: 'Scan the workspace for licensing, attribution and header findings',
  legalScanBusy: 'A legal scan starts once the current turn has ended.',
  legalScanUntrusted:
    'The legal scan reads the workspace, which Restricted Mode does not allow. Trust this workspace to use it.',
  legalScanPlanModeNotice:
    'This legal scan holds the conversation in Plan mode while it reads the workspace, and the permission mode you had comes back when it ends.',
  legalDistributionLine: 'Distribution: {distribution}',
  legalRegistryLine:
    'Registry ({hosts}): {queried} queried, {found} found, {skipped} skipped, {bytes} received.',
  legalRegistryOff: 'Registry enrichment off. Rerun with --registry to enrich missing licenses.',
  legalWroteFile: 'Legal scan report written to {path}.',
  legalFormatInvalid: 'The format must be text or json.',
  legalExclusionsLine: 'Excluded: {exclusions}',
  legalScanNoDistribution: 'The scan did not complete, so no distribution was assumed.',
  legalUsage: 'legal [--format text|json] [--out <file>] [--registry]',
  legalReportFindings: 'Legal Findings',
  legalFixSelect: 'Fix {id}',
  legalSelectedCount: forms({ one: '{count} selected', other: '{count} selected' }),
  legalFixAllSafe: 'Fix All Safe Ones',
  legalPreviewFixes: 'Preview Fixes',
  legalFixPreviewTitle: 'Fix Preview',
  legalFixApply: 'Apply Fixes',
  legalFixOwnership:
    'Confirm that these files are project-owned and that the license and copyright in the preview apply to them: {paths}',
  legalFixDenied: 'The edits were not approved.',
  legalExportMarkdown: 'Export Markdown…',
  legalFixFiles: 'Files to Change',
  legalFixExcluded: 'Not Included',
  legalFixReasonNotFixable: 'No safe fix; recommendation only.',
  legalFixReasonProjectLicense: 'Project license changes need separate confirmation.',
  legalFixReasonUnknown: 'Not part of this scan.',
  legalFixReasonTooLarge: 'Too large to guard; fix it by hand.',
  legalFixNothingSelected:
    'Select at least one finding to fix, even in Bypass mode. Nothing is pre-authorized by the scan.',
  legalFixSeparateConfirm: 'I separately confirm the project license change.',
  legalFixRefusedPlan: 'Fixes are refused in Plan mode, which never writes.',
  legalFixRefusedTrust: 'Fixes are refused while the workspace is untrusted.',
  legalFixRefusedWorkspace: 'The workspace changed since the preview. Ask for a fresh preview.',
  legalFixRefusedStale: 'The evidence changed since the preview. Run a fresh scan.',
  legalFixRefusedExpired: 'The preview expired. Ask for a fresh preview.',
  legalFixRefusedUnavailable: 'Applying fixes is unavailable in this build.',
  legalFixRescanHint: 'Run a fresh scan to confirm what remains.',
  legalExplainPaid: 'Explain Findings (Paid)',
  paidLegalExplanationName: 'Explain Findings',
  legalExplainConsent:
    'Explain these findings on {model}, billed to your Model API key at {price}. The subscription pays none. Only finding IDs, categories, severity and recognized license IDs are sent; no source, paths or excerpts.',
  legalExplainConfirm:
    'Optional Model API explanation: {price}. Each use asks for consent and shares the daily paid budget.',
  legalExplainUnavailable:
    'Enable paid legal explanations in Account & usage and store a Model API key first.',
  legalScanner: {
    m001: 'compatibility reader over {v0}',
    m002: '{v0} is dual-licensed; {v1} is a clean choice beside {v2}. Confirm the chosen terms before shipping.',
    m003: 'Record which license branch the distribution complies with.',
    m004: '{v0} declares {v1} as alternative copyleft terms; distribution requires choosing and satisfying the applicable source and linking obligations.',
    m005: 'Confirm the chosen license branch and its obligations with a lawyer.',
    m006: '{v0} ships under {v1} while the project declares {v2}: distributing the combination may oblige source disclosure of the combined work. This is a question, not a verdict.',
    m007: 'Confirm with a lawyer whether this distribution triggers the copyleft obligations, and on which code.',
    m008: '{v0} declares {v1} in development scope only.',
    m009: 'Confirm it never ships; a shipped strong-copyleft dependency may oblige source disclosure.',
    m010: '{v0} declares {v1} with distribution unknown: if this combination ships, source disclosure may be obliged.',
    m011: 'Establish whether the dependency ships, then confirm the obligations with a lawyer.',
    m012: '{v0} declares {v1}{v2}: file-level copyleft stays with its covered files, and LGPL linking needs its source and relinking terms.',
    m013: 'Keep covered files under their terms, preserve their notices, and confirm LGPL linkage evidence.',
    m014: '{v0} declares {v1}{v2}: source-available or restricted terms, not an open-source grant. Recognition is not approval.',
    m015: 'Review the terms against this exact distribution with a lawyer; confirm a BUSL change date or Commons Clause scope where one applies.',
    m016: '{v0} declares {v1}, which this reader does not classify: confirm the terms by hand.',
    m017: 'Review the license text against this distribution.',
    m018: '{v0} ships under {v1} terms: no license grant travels with it.',
    m019: 'Confirm private ownership of this exact version, or remove it from the shipment.',
    m020: '{v0} declares {v1} terms outside the shipped set.',
    m021: 'Confirm it never ships; a shipped proprietary dependency needs ownership proof.',
    m022: 'not checked: {v0} package {v1}@{v2} has no license evidence',
    m023: '{v0} declares the license {v1}, which is not a well-formed SPDX expression: {v2}.',
    m024: 'Correct the declaration from the package metadata, or confirm the terms by hand.',
    m025: '{v0} declares the custom reference {v1}: its terms need a human read.',
    m026: 'Confirm the referenced license text and its compatibility with the distribution.',
    m027: '{v0} declares {v1}, a deprecated SPDX identifier form; a trailing + no longer names which later versions apply.',
    m028: 'Use the current -only or -or-later identifier the package intends.',
    m029: '{v0} declares the exception {v1}, which is not on the SPDX exception list.',
    m030: 'Confirm the exception text; an exception changes the analysis.',
    m031: 'License evidence conflict for {v0}: {v1}. No source silently settles the conflict.',
    m032: 'Review the original license and declarations together before deciding which terms apply.',
    m033: 'not checked: conflicting license evidence for {v0} needs human review',
    m034: '{v0} reader at {v1}',
    m035: 'not checked: artifact freshness is not established by file-name evidence alone',
    m036: 'not checked: bundle inputs are absent or stale against the workspace inventory',
    m037: forms({
      one: 'distribution read from {count} known bundle inputs',
      other: 'distribution read from {count} known bundle inputs',
    }),
    m038: 'source checkout, distribution unknown: no bundle inputs or package inventory evidence',
    m039: 'not checked: distribution set unknown (no bundle metafile or package files evidence); shipped obligations assume nothing ships',
    m040: 'not checked: package pattern count exceeds the bounded inventory',
    m041: 'not checked: package files contains unsupported patterns; distribution is approximate',
    m042: 'not checked: .vscodeignore pattern {v0} uses unsupported syntax, so the shipped set is approximate',
    m043: 'not checked: package inventories do not establish embedded bundle inputs or artifact freshness',
    m044: 'distribution approximated from package files and .vscodeignore; unbuilt artifacts may differ',
    m045: 'distribution reader',
    m046: forms({
      one: '{count} dependency may ship with no notice file present to attribute them.',
      other: '{count} dependencies may ship with no notice file present to attribute them.',
    }),
    m047: 'Add THIRD_PARTY_NOTICES or the equivalent notice file covering the shipped set.',
    m048: '{v0} may ship but no present notice file names it.',
    m049: 'Attribute the package in THIRD_PARTY_NOTICES or the equivalent notice file.',
    m050: 'not checked: {v0} has no readable NOTICE attribution',
    m051: 'distribution reader at {v0}',
    m052: '{v0} carries an upstream NOTICE file with no attribution in the present notices.',
    m053: 'Preserve the applicable NOTICE attribution in THIRD_PARTY_NOTICES or the equivalent notice file.',
    m054: 'Refused path outside the workspace or beyond its bounds',
    m055: 'not checked: complex REUSE patterns, precedence and ownership relationships; only complete exact-path annotations are honored',
    m056: 'asset inventory at {v0}',
    m057: '{v0} has no observed per-file provenance declaration; its filename alone cannot establish ownership or distribution rights.',
    m058: 'Record the asset source, author and applicable terms from verified ownership in a sidecar or REUSE declaration.',
    m059: 'source reference at {v0}',
    m060: '{v0} contains a source reference whose provenance and applicable terms need review; a reference alone does not prove copying or infringement.',
    m061: 'Verify the original source, author, date, license and attribution for any copied material; keep legitimate upstream headers.',
    m062: 'not checked: copyright header checks are off by policy',
    m063: 'not checked: {v0} is unreadable or binary header material',
    m064: 'header reader at {v0}',
    m065: '{v0} has no copyright line in its first lines, but the header policy requires one.',
    m066: 'Add the project copyright line from verified ownership; never replace a third-party header.',
    m067: '{v0} has no SPDX-License-Identifier line, but the header policy requires one.',
    m068: 'Add the SPDX identifier matching the applicable license.',
    m069: '{v0} has no {v1} in its first lines.',
    m070: 'Add the project copyright header for hygiene; the policy leaves it optional.',
    m071: '{v0} has a copyright line, but {v1}.',
    m072: 'Correct the date with the holder; an earlier year alone is never stale.',
    m073: '{v0} declares SPDX-License-Identifier {v1}, which does not parse: {v2}.',
    m074: 'Write the identifier as an SPDX expression (AND, OR and WITH in uppercase).',
    m075: 'Confirm the referenced text exists beside the file or in REUSE.toml.',
    m076: '{v0} declares {v1}, a deprecated SPDX identifier form.',
    m077: 'Use the current identifier from the SPDX License List.',
    m078: '{v0} carries distinct SPDX declarations {v1} and {v2}.',
    m079: 'Confirm the applicable terms for each declaration; preserve legitimate upstream licenses.',
    m080: '{v0} declares {v1}, outside the project licenses {v2}.',
    m081: 'Confirm the file carries third-party terms (keep its header) or correct the identifier.',
    m082: 'project license reader at {v0}',
    m083: 'Write the license as an SPDX expression (AND, OR and WITH in uppercase, parentheses where needed).',
    m084: 'not checked: full SPDX text matching and modified terms; title and clause matching is heuristic',
    m085: '{v0} reads as no recognized license text; its terms need a human read.',
    m086: 'Confirm what license the file grants and declare it in the manifest.',
    m087: '{v0} points at {v1}, which is absent from the workspace.',
    m088: 'Add the referenced license file or correct the manifest field.',
    m089: '{v0} marks the project UNLICENSED: proprietary, all rights reserved by default.',
    m090: 'Ship it only to its intended recipients; a public distribution needs a license grant.',
    m091: 'project license reader at {v0} and {v1}',
    m092: '{v0} declares {v1} but the license file reads as {v2}.',
    m093: 'Reconcile the two before shipping: fix the metadata or replace the license file, with explicit confirmation for a license change.',
    m094: 'project license reader',
    m095: 'The manifests disagree with no license file to settle it: {v0}.',
    m096: 'Reconcile the manifests before shipping, with explicit confirmation for a license change.',
    m097: 'The manifest declares terms but no root license file was found.',
    m098: 'Add the applicable license text from verified ownership before distribution.',
    m099: 'The README declares {v0} but the project declares {v1}.',
    m100: 'Reconcile the README with the license file and manifest before shipping.',
    m101: 'The license {v0} is declared only in the README; there is no license file or manifest field.',
    m102: 'Add a LICENSE file and a manifest license field from verified ownership.',
    m103: 'No LICENSE file, manifest license field or README declaration found: undistributed code is all rights reserved by default.',
    m104: 'Choose a license with explicit confirmation and declare it in a LICENSE file and the manifest.',
    m105: '{v0} carries license-like text the reader does not recognize: vendored code needs attribution in the notices.',
    m106: '{v0} carries {v1} terms inside the workspace: vendored code needs attribution in the notices.',
    m107: 'Confirm the vendored code is attributed in THIRD_PARTY_NOTICES or the equivalent notice file.',
    m108: 'Unknown header policy',
    m109: 'Too many selected paths',
    m110: 'not checked: assets, copied code provenance, proprietary terms and complete license-text matching require human review',
    m111: 'Legal scan cancelled',
    m112: 'scan stopped at limit: elapsed time',
    m113: 'not checked: {v0} cannot be read as text',
    m114: 'scan stopped at limit: {v0} exceeds the bounded text read budget',
    m116: forms({
      one: 'not checked: dependency evidence bound reached; {count} entry omitted',
      other: 'not checked: dependency evidence bound reached; {count} entries omitted',
    }),
    m117: 'not checked: license text for {v0} at {v1} is unrecognized',
    m118: 'license text reader at {v0}',
    m119: forms({
      one: 'The distribution set is unknown and {count} production dependency exist: obligations are read against an undistributed source checkout.',
      other:
        'The distribution set is unknown and {count} production dependencies exist: obligations are read against an undistributed source checkout.',
    }),
    m120: 'Supply bundle inputs or package inventory evidence so shipped obligations are exact.',
    m121: 'scan stopped at limit: report truncated for {v0}',

    m123: forms({
      one: 'report truncated: {count} generated exclusions omitted past the bound',
      other: 'report truncated: {count} generated exclusions omitted past the bound',
    }),
    m124: 'The scan built an invalid result: {v0}',
    m125: 'not checked: an evidence field exceeds the report bound and was truncated',
    m126: 'Unexpected character {v0}',
    m127: 'WITH must name a license exception',
    m128: 'Unexpected end of the expression',
    m129: 'Missing closing parenthesis',
    m130: 'Unexpected operator without a license beside it',
    m131: 'Empty license expression',
    m132: 'Unexpected text after the expression',
    m133: 'License expression exceeds the text bound',
    m134: 'License expression nesting exceeds the bound',
    m135: 'Malformed license identifier',
    m136: 'License expression alternatives exceed the bound',
    m137: 'Legal scan root is not a directory',
    m138: 'not checked: {v0} is a link or escaped directory',
    m139: 'scan stopped at limit: directory-entry budget reached; remaining tree not enumerated',
    m140: 'not checked: {v0} changed during enumeration',
    m142: 'not checked: {v0} is a link',
    m143: 'not checked: {v0} is a special file',
    m144: 'not checked: {v0} could not be admitted',
    m145: 'not checked: {v0} contains path crates whose ownership and resolved metadata are unknown',
    m146: 'not checked: {v0} contains inherited or nested Cargo declarations not resolved statically',
    m147: forms({
      one: 'not checked: {count} Cargo lock entry carry no license metadata in the lock and no vendored crate manifest covers them',
      other:
        'not checked: {count} Cargo lock entries carry no license metadata in the lock and no vendored crate manifest covers them',
    }),
    m148: forms({
      one: 'not checked: {count} Cargo requirements have no resolved version in any Cargo.lock',
      other: 'not checked: {count} Cargo requirements have no resolved version in any Cargo.lock',
    }),
    m149: 'not checked: no Cargo manifests or locks found',
    m150: 'not checked: {v0} is not valid JSON, so its requirements and license are unknown',
    m151: 'not checked: {v0} is not valid JSON, so its locked versions are unknown',
    m152: 'not checked: license evidence conflict for {v0} between {v1} and {v2}',
    m153: forms({
      one: 'not checked: {count} Composer requirements have no locked version in any composer.lock',
      other:
        'not checked: {count} Composer requirements have no locked version in any composer.lock',
    }),
    m154: forms({
      one: 'not checked: {count} Composer packages carry no license metadata in the lock or installed data',
      other:
        'not checked: {count} Composer packages carry no license metadata in the lock or installed data',
    }),
    m155: 'not checked: no composer.json, composer.lock or installed.json found',
    m156: 'not checked: {v0} uses executable code, which never runs; only its static assignments are read',
    m157: 'not checked: {v0} is read statically; computed Ruby metadata and conditional assignments are not evaluated',
    m158: forms({
      one: 'not checked: {count} gem requirements have no locked version in any Gemfile.lock',
      other: 'not checked: {count} gem requirements have no locked version in any Gemfile.lock',
    }),
    m159: forms({
      one: 'not checked: {count} gems carry no license metadata; present gem specifications would close the gap',
      other:
        'not checked: {count} gems carry no license metadata; present gem specifications would close the gap',
    }),
    m160: 'not checked: no Gemfile, Gemfile.lock or gemspec files found',
    m161: 'not checked: Go replacement targets, tool-package module mapping and non-vendored transitive selection require review; checksums can include unused versions',
    m162: forms({
      one: 'not checked: {count} Go modules carry no license metadata; checksums and module path alone are not licenses, so vendored license text would close the gap',
      other:
        'not checked: {count} Go modules carry no license metadata; checksums and module paths alone are not licenses, so vendored license text would close the gap',
    }),
    m163: forms({
      one: 'not checked: {count} Go tool requirements have no resolved version; their licenses are unknown',
      other:
        'not checked: {count} Go tool requirements have no resolved version; their licenses are unknown',
    }),
    m164: 'not checked: no go.mod, go.sum or vendor/modules.txt found',
    m165: 'not checked: license metadata conflict for {v0} between {v1} and {v2}: {v3} versus {v4}',
    m166: 'not checked: {v0} is read statically; executable logic, catalogs and computed declarations are not evaluated',
    m167: 'not checked: Maven transitive graph, parent properties and profiles are not resolved by static POM declarations',
    m168: forms({
      one: 'not checked: {count} Maven/Gradle requirements have no resolved version in any lockfile or catalog',
      other:
        'not checked: {count} Maven/Gradle requirements have no resolved version in any lockfile or catalog',
    }),
    m169: forms({
      one: 'not checked: {count} Maven/Gradle packages carry no license metadata; present artifact POMs would close the gap',
      other:
        'not checked: {count} Maven/Gradle packages carry no license metadata; present artifact POMs would close the gap',
    }),
    m170: 'not checked: no POMs, Gradle declarations, locks or catalogs found',
    m171: 'not checked: {v0} has unreadable npm lock metadata',
    m172: 'not checked: {v0} uses an unsupported npm lock version',
    m173: 'not checked: {v0} exceeds the npm nested lock depth bound',
    m175: 'not checked: {v0} has no readable Yarn package entries',
    m176: forms({
      one: 'not checked: {v0} records versions but no license metadata for {count} packages; installed package data would close the gap',
      other:
        'not checked: {v0} records versions but no license metadata for {count} packages; installed package data would close the gap',
    }),
    m177: 'not checked: {v0} uses an unsupported pnpm lock version or has no readable packages section',
    m178: 'not checked: license evidence conflict for {v0}@{v1} between {v2} and {v3}',
    m179: forms({
      one: 'not checked: {count} npm requirements have no resolved version in any lockfile; their transitive licenses are unknown',
      other:
        'not checked: {count} npm requirements have no resolved version in any lockfile; their transitive licenses are unknown',
    }),
    m180: 'not checked: no npm manifests, locks or installed metadata found',
    m181: 'not checked: NuGet conditional or dynamic project declarations, version ranges and multi-framework conflicts require review',
    m182: forms({
      one: 'not checked: {count} NuGet requirements have no resolved version in any lock, asset or central version file',
      other:
        'not checked: {count} NuGet requirements have no resolved version in any lock, asset or central version file',
    }),
    m183: forms({
      one: 'not checked: {count} NuGet packages carry no license metadata; present .nuspec file would close the gap',
      other:
        'not checked: {count} NuGet packages carry no license metadata; present .nuspec files would close the gap',
    }),
    m184: 'not checked: no NuGet declarations, locks or asset files found',
    m185: 'not checked: {v0} includes {v1}; arbitrary include names are not recursively resolved',
    m186: 'not checked: {v0} includes {v1}, which is absent from the workspace',
    m187: 'not checked: {v0} contains a requirements option or editable source not resolved statically',
    m188: forms({
      one: 'not checked: {count} requirement line in {v1} use a form the reader does not parse',
      other: 'not checked: {count} requirement lines in {v1} use a form the reader does not parse',
    }),
    m189: 'not checked: {v0} names no project, so its requirements are unattributed',
    m190: 'not checked: {v0} has no readable package stanzas',
    m191: forms({
      one: 'not checked: {v0} records versions but no license metadata for {count} packages; present distribution metadata would close the gap',
      other:
        'not checked: {v0} records versions but no license metadata for {count} packages; present distribution metadata would close the gap',
    }),
    m192: 'not checked: installed metadata version differs for {v0}; locked license unknown',
    m193: 'not checked: Python static declarations do not establish complete transitive coverage without lock and installed metadata; dynamic build metadata is never evaluated',
    m194: forms({
      one: 'not checked: {count} Python packages have no matching license metadata',
      other: 'not checked: {count} Python packages have no matching license metadata',
    }),
    m195: forms({
      one: 'not checked: {count} Python requirements have no resolved version; their transitive licenses are unknown',
      other:
        'not checked: {count} Python requirements have no resolved version; their transitive licenses are unknown',
    }),
    m196: 'not checked: no Python manifests, locks or distribution metadata found',
    m198: 'not checked: {v0} declares a malformed license expression ({v1}); its terms need human review',
    m199: 'not checked: license text for {v0} at {v1} differs from its canonical wording',
    m200: '{v0} differs from the SPDX {v1} template at “{v2}”, where the template continues “{v3}”; its modified terms need human review',
    m201: '{v0} differs from the SPDX {v1} template: “{v2}” is not part of it; its modified terms need human review',
    m202: 'not checked: bundle {v0} lists {v1}, which lies outside the workspace and cannot be verified',
    m203: 'not checked: build records disagree about the content of {v0}',
    m204: 'not checked: bundle {v0} output {v1} is missing or differs from its build record',
    m205: 'not checked: pinned SPDX template data failed verification ({v0}); exact license-text matching is off for it',
    m206: 'not checked: bundle {v0} input {v1} has no build-captured hash or no longer matches it',
    m207: forms({
      one: '{count} dependency that does not ship has a licence text that differs from its SPDX template or is unrecognized ({v0}); it is not distributed, so it does not limit this scan',
      other:
        '{count} dependencies that do not ship have licence texts that differ from their SPDX templates or are unrecognized ({v0}); they are not distributed, so they do not limit this scan',
    }),
    m208: 'If one of these dependencies starts to ship, review its licence text.',
    m209: forms({
      one: '{count} more advice finding for {v0} is not listed; nothing else was left out',
      other: '{count} more advice findings for {v0} are not listed; nothing else was left out',
    }),
    m210: 'Scan a smaller set of paths to list them.',
    reviewedReceipt: 'Reviewed by receipt: {reason}',
    receiptRenew: 'A new version or changed licence bytes need a new review and receipt.',
    invalidReceipt: 'not checked: {file} is not a valid licence-review receipt file',
    unknown: 'unknown',
    unresolved: 'unresolved',
    noLicense: 'no license',
    shipment: ' in the shipment',
    copyrightSpdxLines: 'copyright or SPDX-License-Identifier lines',
    spdxLine: 'an SPDX-License-Identifier line',
    copyrightLine: 'a copyright line',
    invalidYear: 'the year {value} is not a four-digit year',
    impossibleYear: 'the year {value} is impossible',
    reversedYears: 'the range {value} ends before it starts',
    selectedPaths: forms({ one: '{count} selected path', other: '{count} selected paths' }),
    moreUnchecked: forms({
      one: 'and {count} more unchecked item omitted past the bound',
      other: 'and {count} more unchecked items omitted past the bound',
    }),
    declaration: '{file} declares {license}',
    licenseFile: 'a license file',
    bundleLoad: '{file} could not be loaded',
    bundleShape: '{file} has an unexpected shape',
    invalidResult: 'the scanner returned an invalid result',
  },
  legalScanAgain: 'Scan Again',
  // M108: shared by the Models panel, usage page, ACP and runtime.
  accounts: {
    certificationPending: 'Account switching and pooling await certification.',
    none: 'No Account Selected',
    id: 'Account ID',
    use: 'Use Account',
    useScope:
      "The chosen account serves this chat's own requests; background work spreads by headroom.",
    earlier: 'Move Earlier',
    later: 'Move Later',
    keyPrompt: '{provider} · {account} API key (not shown as you type): ',
    execHelp:
      'Headless accounts: {command} exec --account <id> [--account-pool]. CI with --key-stdin uses only the default account and never swaps.',
    unavailable:
      'Accounts are unavailable until this runtime is connected to the shared account service.',
    unavailableReason: 'Accounts are unavailable ({reason}).',
    noAccountsEntry: '{provider} has no accounts entry in this runtime.',
    changed: 'Accounts changed while updating. Try again.',
    notReady: 'Accounts are not ready yet. Try again.',
    invalidReply: 'The account service answered with an unexpected reply.',
    noticeFailed: 'The account notice could not be shown ({reason}).',
    revokeUnsupported: 'Removing this sign-in is not supported in this runtime.',
    providersInvalid:
      'The providers file is invalid, so its entries were refused and the file was left unchanged.',
    poolUnavailable:
      'Account pooling is unavailable in this runtime: it needs a bound resource owner. Run again without --account-pool.',
    cliUsage:
      'Accounts: {command} providers accounts list|add|remove|order|thresholds --provider <id> [--account <id>] [--label <label>] [--limit-group <id>] [--thresholds <JSON>] [ordered ids]. Credentials: {command} auth set --provider <id> --account <id> (standard input only).',
    slashDescription: 'List accounts, view thresholds, or choose an account.',
    title: 'Accounts',
    defaultLabel: 'Default Account',
    add: 'Add Account',
    remove: 'Remove Account',
    label: 'Label',
    order: 'Pool Order',
    limitGroup: 'Shares Limits With',
    thresholds: 'Thresholds',
    spend: 'Spend in USD',
    inputTokens: 'Input Tokens',
    outputTokens: 'Output Tokens',
    requests: 'Requests',
    month: 'Month',
    planWindow: 'Plan-Window Usage',
    rateHeadroom: 'Rate-Limit Headroom',
    swap: 'Swap Accounts',
    parallel: 'Use Accounts in Parallel',
    swapDescription:
      'Swap at the next request boundary when a threshold is reached. Each account keeps its own limits.',
    parallelDescription:
      'Spread background work by headroom and keep each worker on its assigned account.',
    current: 'Current Account',
    switchUnavailable:
      'This session stays on {provider} · {account}. Account switching is unavailable in this runtime.',
    swapNotice: 'Now on {provider} · {account}: {previous} reached {threshold}.',
    coldCache: 'Estimated context re-read cost: {cost}.',
    stopped: '{provider} · {account} has no room. Resets {reset}.',
    resetUnknown: '{provider} · {account} has no room. Reset time is unknown.',
    sharedGroup: '{account} shares the same vendor limit group; another key adds no capacity.',
    policy: 'Vendor Account Policy',
    policyOn: 'Pooling Available',
    policyConfirm: 'Confirmation Required',
    notOffered: 'This product cannot be added.',
    checked: 'Checked {date}',
    stale: 'This policy was checked more than {duration} ago. Re-check it before release.',
    confirmWarning:
      '{provider}’s terms restrict or prohibit using several accounts to get past vendor limits. The vendor may act against your accounts.',
    legitimate: 'I confirm that these accounts are legitimately mine to use this way.',
    confirm: 'Confirm',
    ownCapsOnly: 'Only at My Own Caps',
    cancel: 'Cancel',
    revoke: 'Revoke Confirmation',
    localConfirmation: 'Confirmations stay on this machine.',
    museCodeUnavailable:
      'Muse Code accounts are unavailable until sign-in and serving from a separate config home have been captured.',
    chatgptRecovery:
      'Pause ChatGPT plan requests, open Usage, and choose credits or your own API key.',
    museCodeRecovery:
      'Upgrade your Muse Code plan, wait for its reset, or use your own pay-as-you-go key. Paid use asks for consent.',
    paidConsent:
      '{provider} · {account}\n{price}\nShared daily budget: {budget}. Charges go to this account; its first paid use needs your consent.',
    credentialHelp:
      'Use the password box or standard input. Keys never belong in `providers.json`.',
    summary: '{provider} · {account}: {requests}; {cost} spent.',
    headroomAmple: 'Ample Headroom',
    headroomSome: 'Some Headroom',
    headroomNone: 'No Headroom',
    placementConflict:
      '{provider} already has an account on {device}. Choose another device or turn off onePerDevicePerProvider.',
    sendToDevice: 'Send to {device}',
    routeUnavailable: 'The selected device has no available account or routing permission.',
    missingDevice: 'The selected device is unavailable.',
    ownerBusy: 'A prompt is already running for this conversation.',
    multipleAllowed: 'Several Accounts Allowed',
    multipleConditions: 'Several Accounts With Conditions',
    multipleOnePerson: 'One Account per Person',
    multipleUnclear: 'Several Accounts Unclear',
    sourceDate: 'Source date: {date}',
    userCap: 'User Cap',
    vendorLimit: 'Vendor Limit',
    swapEvent: 'Account Swap',
    spreadEvent: 'Work Spread',
    stopEvent: 'Work Stopped',
    sourceUndated: 'No source date shown',
    selectedRemoved:
      'The chosen account no longer exists. This chat will use the default account on its next request.',
    invalidAccount: 'Check the account id, label, order, limit group and thresholds.',
    removeConfirm:
      'Remove {account}? Its stored credential will be deleted and its sign-in revoked.',
    requestCount: forms({
      one: '{count} request',
      other: '{count} requests',
    }),
    usageLiability: 'Reserved {reserved}; uncertain {uncertain}.',
    usageReached: 'Threshold Reached',
    usageReset: 'Resets {reset}.',
    usageResetUnknown: 'Reset time is unknown.',
    usageSpread: '{provider} · {account}: worker {worker} assigned.',
    usageStop: '{provider} · {account}: stopped at {threshold}.',
    usageThreshold: '{metric} limit for {period}: {threshold}',
    usageEvents: 'Account Events',
    usageRateTokens: 'Tokens',
    usageUnavailable: 'No current usage snapshot.',
    spendReported: 'Reported by {provider}, as of {date}.',
    spendTokensByModel: '{model}: {input} input, {output} output.',
    spendDollarsByDay: '{day}: {cost} spent.',
    spendBalance: 'Balance: {balance}.',
    spendKeyUsage: 'Spent {today} today, {week} this week, {month} this month.',
    spendKeyLimit: 'Limit {limit}; {remaining} left.',
    spendEstimate: 'Our estimate for the same period: {cost}.',
    spendEstimateTokens: 'Estimated tokens: {input} input, {output} output.',
    spendMatches: 'The provider figure matches our estimate within rounding.',
    spendDiffers:
      'The provider reports {reported} and we estimate {estimated} for the same period, a difference of {difference}. {reasons}',
    spendReasonShared: 'The same key may also be used by other tools.',
    spendReasonCatalogue: 'Our prices come from a catalogue dated {date}.',
    spendReasonPriority: 'Priority Tier use is not in the provider cost figure.',
    spendRefused: 'The provider refused the spend report request.',
    spendPlanUnavailable: 'This account’s plan does not offer the report API.',
    spendUnreadable: 'The provider’s report could not be read ({kind}).',
    spendUnsupported: 'This provider offers no spend report.',
    spendAdminMissing: 'No admin report key is stored for {provider}.',
    spendAdminExplains:
      'This key can read the whole organisation’s usage and members. It is stored separately and used only for read-only spend reports, never for model requests.',
    spendAdminPrompt: 'Admin report key for {provider}: ',
    spendAdminStored: 'Admin report key stored for {provider} in {store}.',
    spendAdminCleared: 'Admin report key cleared for {provider}.',
    spendRefreshWait: 'Spend reports refresh at most once a minute; showing the cached report.',
  },
  // M108 X: machine-local testing options; read after table installation.
  developer: {
    title: 'Developer Options',
    badge: 'Developer Mode',
    allowMultiple: 'Allow Several Accounts of One Provider on This PC',
    unlockWarning:
      'Local testing options, off by default. Account limits, vendor terms and paid confirmations still apply.',
    multipleWarning:
      'Allow isolated local profiles for testing several accounts of one provider on this PC? This choice stays on this machine.',
    resetWarning:
      'Reset Developer options? Local profiles will stop and their credential slots and state folders will be deleted.',
    foreignResetWarning:
      'Reset Developer options on this machine? This clears this machine’s developer state. It stops nothing: profile folders and credentials stay as they are.',
    locked: 'Developer options are locked.',
    unavailable: 'Developer options are unavailable.',
    differentMachine:
      'Developer options were set up under a different machine identity. Reset them to start over on this machine.',
    invalidRequest: 'Check the Developer options request.',
    expires: 'Developer mode expires {time}.',
    reset: 'Reset Developer Options',
    profiles: 'Local Profiles',
    profileInfo:
      'Each profile has its own credential slot, state folder and runtime process. Expiry stops profiles; Reset deletes them.',
    provider: 'Provider ID',
    account: 'Account ID',
    addProfile: 'Add Local Profile',
    helpUnlock: 'Click the version seven times or use the Developer options command to unlock.',
    helpTerminal: 'Run `developer` to unlock; `developer status` shows this machine’s options.',
    commandUsage:
      'Usage: developer [status|enable|disable|reset|add <provider> <account>|remove <profile>]',
  },
  // M124 (D106): the connector's Help & Reference rows.
  mcpConnectorTitle: 'MCP connector for other agents',
  referenceMcpCommand:
    'Serve Muse Spark Code’s tools to other agents (Codex, Claude Code, Gemini CLI) over MCP; every write waits for your approval.',
  // M124 (D106): the MCP connector’s approval page and its `mcp` terminal commands
  // (the runtime region, dist/uiTextRuntime.js: activation never reads them).
  // M104 lane H: the language server (`lsp`). Not named after a command: the
  // reference's route names would carry the group into the panel's English.
  languageServer: {
    // {command}: the executable's name. Shown by the muse.help command.
    help: 'Muse Spark Code (Unofficial) Tab, served by {command} lsp. Inline completions ask for a suggestion; run muse.tabInvoke to insert one where your editor shows none; muse.usage shows today’s Tab spend; muse.stop stops every supervised run in this folder.',
    // {spent}, {budget}: amounts of US dollars.
    budgetReached:
      'Today’s Tab spend of {spent} has reached the daily budget of {budget}, so completions pause until tomorrow. To continue today, start the language server with a higher --tab-daily-budget-usd.',
    unavailable: 'The language server is not available in this installation.',
  },
  // M104 lane H: `supervise` and `stop`.
  supervision: {
    stopNone: 'No supervised run was started in this folder.',
    stopped: forms({
      one: 'Stopped {count} supervised run.',
      other: 'Stopped {count} supervised runs.',
    }),
    stopFailed: forms({
      one: '{count} supervised run could not be stopped whole.',
      other: '{count} supervised runs could not be stopped whole.',
    }),
    unavailable: 'Supervision is not available in this installation.',
  },
  // M104 lane B: the runtime panel (`panel`). Not named after the command:
  // the reference's route names would carry the group into the panel's English.
  hostService: {
    unavailable: 'The runtime panel is not available in this installation.',
    needsStdio: 'panel needs --stdio: the editor’s host speaks to it on standard input and output.',
    notAvailable: 'This is not available through this editor yet.',
  },
  acpConnector: {
    title: 'Approve connector requests',
    intro:
      'Another agent asked Muse Spark Code to do the following. Nothing happens until you approve it here; that agent’s own Allow, Auto or Bypass settings cannot approve it.',
    loading: 'Loading requests…',
    empty: 'No requests are waiting.',
    failed: 'The request list could not be loaded.',
    retry: 'Retry',
    approve: 'Approve once',
    deny: 'Deny',
    approved: 'Approved.',
    denied: 'Denied.',
    decisionFailed: 'That request changed or expired. Nothing was done.',
    client: 'Client (as it names itself)',
    connection: 'Connection',
    workspace: 'Workspace',
    operation: 'Operation',
    generation: 'Target generation',
    price: 'Price',
    free: 'Free',
    expires: 'Expires',
    fieldTitle: 'Title',
    fieldScope: 'Scope',
    fieldTags: 'Tags',
    fieldBody: 'Text',
    grantConfirm: 'Grant connection {connection}: {summary}? (y/N)',
    grantSaved: 'Connection {connection} is granted. Its workspaces: {workspaces}',
    grantNeedsTerminal:
      'Run this in your own terminal: a grant needs you to type the confirmation.',
    grantInvalid: 'The grant could not be made: {reason}',
    notConfirmed: 'Nothing was changed.',
    revoked: 'Connection {connection} is revoked.',
    killOn: 'The connector is switched off. New effects are refused; Stop still works.',
    killOff: 'The connector is switched on again.',
    statusOn: 'Connector: on',
    statusOff: 'Connector: switched off',
    statusGrant: 'Connection {connection}{revoked}: {scopes}',
    statusRevoked: ' (revoked)',
    statusWorkspace: '  {id}: {root}{content}',
    statusContent: ' (content)',
    noGrants: 'No connection grants yet.',
    storageRefused:
      'The connector folder is not private to your account ({folder}), so nothing was done. Make it private to your account (or delete it and grant again) and try again.',
    unavailable: 'The connector could not start.',
    usage:
      'muse-spark-code-acp mcp [--connection ID]\nmuse-spark-code-acp mcp grant [--connection ID] --workspace FOLDER… [--scope SCOPE…] [--content] [--user-library]\nmuse-spark-code-acp mcp revoke [--connection ID]\nmuse-spark-code-acp mcp kill | resume | status',
  },
  // M109: read each key through UI_TEXT.vault at use time.
  vault: {
    title: 'Vault',
    locked: 'Locked',
    unlocked: 'Unlocked',
    // RVCM1091D P2: every vault state has its own true heading, so no state
    // falls through to 'Locked'.
    stateUncreated: 'Not set up',
    stateSetupPending: 'Setup pending',
    stateUnavailable: 'Unavailable',
    empty: 'No vault items yet.',
    add: 'Add to Vault',
    edit: 'Edit Item',
    remove: 'Remove Item',
    grant: 'Create Grant',
    revoke: 'Revoke Grant',
    audit: 'Audit',
    lock: 'Lock Vault Now',
    unlock: 'Unlock Vault',
    allowSession: 'Allow for This Session',
    manage: 'Manage in Vault',
    requirePresence: 'Require Presence for Each Use',
    unattended: 'Unattended Allowed',
    silentUnlock: 'Silent Unlock',
    hidden: 'Hidden From Agents',
    firstParty: 'First-Party Only',
    askEveryTime: 'Ask Every Time',
    askOncePerSession: 'Ask Once per Session',
    alwaysAllow: 'Always Allow',
    never: 'Never',
    name: 'Name',
    label: 'Label',
    kind: 'Kind',
    value: 'Value',
    username: 'Username',
    password: 'Password',
    seed: 'One-Time Code Seed',
    roles: 'Roles',
    // RVCM1091D P3: grant-form hints are code vocabularies (field names and
    // keywords the form parses back), so they stay English in every table via
    // l10n/untranslated.json; the label words beside them stay translated.
    rolesHint: 'any / orchestrator / subagent / headless / role:name / hook:name / mcp:name',
    workspaces: 'Workspaces',
    workspacesHint: 'any',
    target: 'Target',
    // The Add/Edit flow asks where a secret may be used through a picker
    // first; the JSON box stays for the uses the picker cannot express.
    // Retry reasons name the field in fixed words and never repeat an answer.
    targetNone: 'Nowhere yet — the vault holds it and nothing may use it',
    targetSsh: 'One SSH computer — its name, user and host key',
    targetSshAny: 'Any SSH computer — the user name',
    targetSshSign: 'Git commit signing — the key fingerprint',
    targetGit: 'Git over HTTPS — the host and repository path',
    targetOrigin: 'A website — its address',
    targetCustom: 'Something else — type it as JSON',
    targetKeep: 'Keep the current targets',
    targetAddAnother: 'Add another use',
    targetDone: 'Done',
    targetHostName: 'Host name',
    targetPath: 'Repository path',
    targetKeyFingerprint: 'Key fingerprint, starting with SHA256:',
    targetHelp:
      'Where this secret may be used. Empty, as [ ], means nowhere yet: the vault holds it and nothing may use it. Type a JSON list with one entry per use. One SSH computer: {"kind":"ssh","host":"ssh.example.com","remoteUser":"deploy","hostKeyFingerprint":"SHA256:Ex4mpleHostKeyFingerprintOnlyNotARealKey012","forwarding":false}. Any SSH computer: {"kind":"sshAnyHost","remoteUser":"deploy","forwarding":false}. Git commit signing: {"kind":"sshSign","keyFingerprint":"SHA256:Ex4mpleHostKeyFingerprintOnlyNotARealKey012","namespace":"git"}. Git over HTTPS: {"kind":"git","protocol":"https","host":"git.example.com","path":"team/repo"}. A website: {"kind":"origin","origin":"https://app.example.com"}. An app login: {"kind":"oauth","origin":"https://app.example.com","issuer":"https://login.example.com","resource":"https://app.example.com/api"}. Show it to yourself: {"kind":"disclosure","recipient":"person"}.',
    targetNotJson: 'That did not parse as JSON. Type a JSON list.',
    targetFieldIssue: 'The {field} entry is missing or not valid.',
    targetListInvalid: 'That is not a list of uses. Type a JSON list.',
    fieldMissing: 'That answer is empty. Try again.',
    fieldInvalid: 'That answer is not valid. Try again.',
    // An expiry takes two shapes only (src/shared/vaultExpiry.ts): a day, the
    // start of that day in the person's time, or a day and a time. The shapes
    // are formats, not words: every table keeps YYYY-MM-DD and
    // YYYY-MM-DDTHH:MM as they are.
    expiresPrompt:
      'Expires: a date as YYYY-MM-DD (the start of that day, your time), or a date and time as YYYY-MM-DDTHH:MM.',
    expiresNone: 'Leave it empty for no expiry.',
    expiresInvalid: 'That date is not valid. Type it as YYYY-MM-DD or YYYY-MM-DDTHH:MM.',
    expiresPassed: 'That date has already passed.',
    nameInvalid:
      'Names start with a lowercase letter and use only lowercase letters, numbers and dashes.',
    labelInvalid: 'Type a label using its own words on one line.',
    originInvalid:
      'That address is not valid. Type the full address starting with http:// or https://.',
    originHttpsInvalid:
      'That address is not valid. Type the full website address starting with https://.',
    originsInvalid:
      'One address is not valid. Type website addresses separated by commas, each starting with https://.',
    issuerInvalid:
      'That issuer is not valid. Type the https:// address of the service that issued this login.',
    resourceInvalid: 'That resource is not valid. Type the https:// address this login is for.',
    command: 'Command',
    cwd: 'Working Folder',
    environmentNames: 'Environment Variable Names',
    useCount: 'Use Count',
    expires: 'Expires',
    timeWindow: 'Time Window',
    days: 'Days',
    daysHint: '0–6',
    hours: 'Hours',
    startHourHint: 'startHour',
    endHourHint: 'endHour',
    remoteUser: 'Remote User',
    hostKey: 'Host Key',
    origin: 'Origin',
    resource: 'Resource',
    requester: 'Requester',
    outcome: 'Outcome',
    tier: 'Protection Tier',
    provider: 'Provider',
    publicKey: 'Public Key',
    fingerprint: 'Fingerprint',
    signInYourself: 'Sign In Yourself',
    moveToVault: 'Move to Vault',
    undoMigration: 'Undo Migration',
    importFile: 'Import File',
    keepFile: 'Keep File',
    deleteFile: 'Delete the File',
    rotate: 'Rotate Credential',
    recoveryCode: 'Recovery Code',
    apiKey: 'API Key',
    oauth: 'OAuth Tokens',
    sshKey: 'SSH Key',
    generateSshKey: 'Generate New Key',
    importSshKeyFile: 'Import Key File',
    sshKeyPassphrase: 'Key file passphrase (empty for none)',
    webLogin: 'Web Login',
    totp: 'One-Time Code',
    session: 'Session Cookies',
    secret: 'Named Secret',
    devicePair: 'Device Pairing',
    internal: 'Internal Record',
    labelWarning: 'Agents see names and labels. Keep secrets out of them.',
    processWarning:
      'This program and its children will see the credential and can send it elsewhere.',
    disclosureWarning:
      'Only you will see this value, after confirming your presence. A released value cannot be recalled; rotate it afterwards.',
    taintWarning:
      'This request follows untrusted content: {content}. Approval is required despite existing grants.',
    presenceWarning: 'Your operating system will ask you to confirm this exact use.',
    noDestination: 'Destination not proven. An any-host grant is required.',
    rollback: 'This vault is older than its recorded generation. Restore a current backup.',
    basicText:
      'The basic_text backend provides no secure encryption and cannot protect a vault slot.',
    brokerDisabled:
      'The credential vault is switched off in this build pending integration checks. First-party keys still work; agent uses are refused.',
    brokerBlocked:
      'The broker cannot start. First-party keys still work; agent uses are refused. Repair the broker installation.',
    // The person switched the vault off in settings (museSpark.vault.enabled,
    // or the legacy museSpark.vault boolean): commands refuse with this.
    switchedOff:
      'The credential vault is switched off in settings. Turn museSpark.vault.enabled on to use it.',
    noUnattended:
      '{item} needs an unattended grant for {use}. Add one in the vault or run interactively.',
    nopasswd:
      'NOPASSWD sudo is available. Any approved command may become root; the vault adds no protection here.',
    fenceOff:
      'Turning off the fence exposes your environment and credential routes to the main conversation. Workers stay fenced.',
    ambientWarning:
      'An approved command can read files you can read. Importing credentials does not hide other files.',
    deleteWarning:
      'Deleting this file may stop other programs from authenticating. Review their vault route first.',
    passkeys:
      'Passkeys stay with your authenticator. Sign in yourself; the vault stores session cookies only.',
    recoveryWarning:
      'Keep the recovery code somewhere safe. It is shown only once and unlocks the vault.',
    // C-M109-1: the setup flow and the CLI (lead decision 8).
    setUp: 'Set Up Vault',
    savedIt: 'I Saved It',
    copyCode: 'Copy',
    cancelSetup: 'Cancel Setup',
    setupNeeded: 'Set up the vault before you store a secret in it.',
    setupExists: 'A vault already exists for this user.',
    // RVCM1091D P2: an item or path collision is not a setup failure.
    itemConflict:
      'An item with the same name is already in the vault, or the source changed during the import. Nothing was added.',
    // RVCM1091E P2: a Delete refused because the source changed after a
    // successful import is not told that nothing was added.
    deleteConflict:
      'The original file changed after its credentials were imported. Nothing was deleted; the imported items stay in the vault.',
    setupPending: 'Save the recovery code, then confirm to finish setting up the vault.',
    setupCancelled: 'Vault setup was cancelled. Nothing was saved.',
    setupHeadless:
      'Vault setup and recovery need an interactive terminal; headless runs cannot do them.',
    recoveryShownOnce: 'Recovery code (shown only now): {code}',
    savedItPrompt: 'Have you saved the recovery code somewhere safe?',
    writerRecoveryWarning:
      '{holder} If another program is still writing this vault, resetting or restoring it will lose that program’s changes. Continue only with explicit confirmation.',
    busy: 'The vault is busy in another window. Try again.',
    busyHolder:
      'The vault is held by process {pid} since {since}. Try again after that process exits.',
    busyOtherMachine:
      'The vault is held on another machine by process {pid} since {since}. Its death cannot be established here.',
    ownerUnknown:
      'The vault cannot acquire a writer because this process’s exact operating-system birth could not be established. Try again.',
    unreadable: 'The writer lock is unreadable and will not clear. Reset the vault to start again.',
    filesystemUnsupported:
      'This folder’s filesystem cannot publish vault updates: hard links are not supported here. Move the vault to a filesystem that supports them and try again.',
    // C-M109-1: import and Reset Vault (lead decisions, 2026-10-10).
    importedLabel: 'Imported {source} credential {number}',
    importedSummary: 'Imported into the vault: {names}',
    importKeepOrDelete:
      'Keep the original file, or delete it now that its credentials are in the vault?',
    resetVault: 'Reset Vault',
    resetHeadless:
      'Resetting the vault needs an interactive terminal; headless runs cannot reset it.',
    resetContinue: 'Continue',
    resetWarning:
      'Resetting erases this vault for good: every stored secret is gone, and rollback protection restarts with a new anchor when you set the vault up again.',
    resetTypeWord: 'Type {word} to reset the vault.',
    resetDone: 'The vault was reset. Set it up again to store secrets.',
    vaultLost:
      'The vault cannot be opened because files are missing or damaged, or writer ownership cannot be established. Review Reset to start again.',
    // RVCM1091B 4: the OS store's fixed repair, never native text.
    storeUnavailable:
      'The operating system’s credential store is not available. On macOS, unlock the login Keychain; on Windows, sign in interactively; for the terminal agent on Linux, sign in to a desktop session with an unlocked keyring (the Secret Service). In VS Code on Linux, this build has no Secret Service component, so the vault there can use only a TPM your account can reach (usually by joining the tss group). Then try again.',
    remoteWarning:
      'Only a signature or a one-time code may be requested from another device. Its user must approve each use there.',
    approvalExpired: 'This approval expired. Request the use again.',
    useChanged: 'The use changed after approval. Request approval for the new use.',
    editConflict: 'The vault changed while the editor was open. Review the latest and try again.',
    osStoreWarning:
      'Protected by your operating system’s credential store. Programs running as you may unlock it too.',
    unknownTierWarning:
      'The protection tier is unknown because the vault is locked. Unlock to see how it is protected.',
    // RVCM1091D P2: an open vault with no observed slot names no protection
    // and never asks for an unlock.
    tierUnknown: 'The protection tier is unknown.',
    hardwareWarning:
      'Protected by this device’s hardware. It unlocks silently, so programs running as you can unlock it too.',
    presenceTierWarning:
      'Every use needs your touch, PIN or passphrase. Unattended use is refused.',
    sshUse: 'SSH Authentication',
    sshSignUse: 'Sign With an SSH Key',
    sudoUse: 'Run Sudo',
    askpassUse: 'Script Askpass',
    gitUse: 'HTTPS for Git',
    environmentUse: 'Inject Environment Variables',
    stdinUse: 'Write to Standard Input',
    mcpUse: 'Start an MCP Server',
    headerUse: 'Send an HTTP Header',
    fillUse: 'Fill a Login Field',
    disclosureUse: 'Show to You',
    forwarding: 'Allow Forwarding',
    anyHost: 'Any Host',
    noAccess: 'No access',
    ask: 'Ask for Access',
    status: 'Vault Status',
    watch: 'Watch Pending Requests',
    grantCeiling: 'Worker Access Ceiling',
    hardware: 'Hardware Protection',
    presence: 'User Presence',
    osStore: 'OS Credential Store',
    secretStorage: 'Editor Secret Storage',
    windowsTpm: 'Windows TPM',
    secureEnclave: 'Secure Enclave',
    linuxTpm2: 'Linux TPM',
    windowsDpapi: 'Windows DPAPI',
    loginKeychain: 'Login Keychain',
    secretService: 'Secret Service',
    passphrase: 'Passphrase Protection',
    recovery: 'Recovery Protection',
    autoProtection: 'Automatic Protection',
    approval: '{requester} requests {use} with {item} for {target}.',
    paidWarning: 'Vault grants do not approve paid requests.',
    windowsElevation: 'Windows elevation uses UAC and cannot be brokered.',
    seUnavailable: 'Secure Enclave protection is unavailable. Use a passphrase for presence.',
    passphraseWarning:
      'A passphrase is required to unlock. It protects a copied disk and prevents silent unlock by programs running as you.',
    // RVCM1091E P3: never names an unlock; the section showing Unlocked
    // after a failed operation would otherwise be told to unlock it.
    operationFailed: 'The vault operation failed. Try again.',
    // RVCM1091F REDESIGN: the person's own Retry after a transient failure
    // spent the bounded auto-retries.
    retry: 'Retry',
    // RVCM1091G P3: true whether the leftover record was cleared or is
    // still stuck — the file is gone either way, there is nothing to retry,
    // and the imported credentials stay in the vault.
    sourceGone:
      'The original file is already gone; there is nothing to retry. The imported credentials stay in the vault.',
    // RVCM1091G P2: a Delete whose source cannot be read (permissions). The
    // import record is kept and nothing is deleted.
    sourceUnreadable:
      'The original file could not be read. Check its permissions and try again; the import record was kept and nothing was deleted.',
    // RVAPP-CM1091D5 P3-1: the source's location is not available (a drive
    // down or away). Never "gone": the import record is kept and nothing
    // is deleted.
    sourceUnavailable:
      'The original file’s location is not available. Try again later; the import record was kept and nothing was deleted.',
    // RVAPP-CM1091D5 P2-2: imports whose receipt was kept or orphaned,
    // finishable here with Keep or Delete.
    pendingImports: 'Unfinished imports',
    // RVAPP-CM1091D5 P2-2: the terminal lists the same finishable receipts.
    noPendingImports: 'No unfinished imports.',
    // RVCM1091G P3: the kept view shown while a bounded auto-retry is
    // scheduled or in flight.
    retrying: 'Retrying the last request. The view shown may be stale.',
    invalidFields: 'Check the grant fields and its target.',
    grantHelp:
      'Every scope below limits this grant. Empty count, expiry or time window means no limit.',
    metadataOnly: 'Edit Settings Only',
    replaceValue: 'Replace Credential',
    presenceAdvice: 'Presence is recommended for sudo, SSH keys and web logins.',
    passwordEntry:
      'Enter credentials in the editor’s password box. Existing values are never shown.',
    auditInvalid: 'The audit could not be verified. Restore a current backup.',
    slotUnavailable: 'No usable protection slot is available.',
    any: 'Any',
    unlimited: 'Unlimited',
    localTime: 'Local Time',
    created: 'Created',
    lastUsed: 'Last Used',
    policy: 'Agent Policy',
    item: 'Item',
    sessionScope: 'Session',
    taskScope: 'Task',
    ceiling: 'Access Ceiling',
    ceilingHint: 'none / ask / secret://',
    enabledDescription: 'Enable the per-user credential vault shared by editors.',
    protectionDescription:
      'Choose vault key protection. Automatic uses available hardware plus the operating system store.',
    fenceDescription:
      'Fence agent processes from ambient credential routes. Workers remain fenced when this is off.',
    idleDescription: 'Lock the vault after this many idle minutes.',
    screenDescription: 'Lock the vault when the operating system reports a screen lock.',
    legacyNotice: forms({
      one: 'Old entries remain mirrored for {count} minor release. Undo migration is available until removal.',
      other:
        'Old entries remain mirrored for {count} minor releases. Undo migration is available until removal.',
    }),
    itemsCount: forms({ one: '{count} item', other: '{count} items' }),
    grantsCount: forms({ one: '{count} Grant', other: '{count} Grants' }),
  },
  // M110os (OS3, OS4, OS5, OS7): the first-boot setup over the LAN, served
  // by the node until the setup code is accepted. TPM/PIN/SSH/Tang names stay
  // English in every table: they are product and protocol names.
  nodeOs: {
    setupTitle: 'Set up your Muse Node',
    setupCodeLabel: 'Setup code',
    setupCodeHint: 'Type the code shown on the machine’s screen. It works once.',
    setupCodeWrong: 'That code did not match. Check the machine’s screen and try again.',
    setupCodeUsed: 'That code was already used. Restart the machine to show a new one.',
    consoleAddress: 'Address',
    consoleName: 'Name',
    consoleFingerprint: 'Certificate fingerprint',
    consoleCode: 'Setup code',
    netTitle: 'Network',
    netDhcp: 'Ethernet (automatic)',
    netWifi: 'Wi-Fi',
    netSsid: 'Network name',
    netPassword: 'Wi-Fi password',
    netSeedNote: 'Network settings from the card were applied, then removed.',
    netConsoleNote:
      'A Wi-Fi-only machine shows no setup page until its network is typed at the console.',
    diskTitle: 'Disk',
    diskTarget: 'Install disk',
    diskEncryptTpm: 'Unlock automatically (TPM)',
    diskEncryptPassphrase: 'Ask for a passphrase at every boot',
    diskEncryptNone: 'No disk encryption',
    diskNoEncryptWarning: 'Workspaces are not encrypted at rest. Secrets stay in the sealed store.',
    diskTpmPin: 'TPM PIN (optional)',
    recoveryKeyTitle: 'Recovery key',
    recoveryKeyWarning: 'Write this key down. It is shown once and never again.',
    diskTangNote:
      'Without a TPM, a headless machine unlocks from your Tang server or waits for a passphrase.',
    sshTitle: 'Remote shell (SSH)',
    sshKeyLabel: 'Public key (optional)',
    sshKeyInvalid: 'That is not a valid SSH public key.',
    sshOffNote: 'SSH stays off until a public key is added. Passwords are never allowed.',
    signinTitle: 'Sign-in and pairing',
    signinPasskeyNote:
      'The first passkey and browser pairing are set up here once the sign-in update lands.',
    orchestratorTitle: 'Orchestrator (optional)',
    orchestratorWaiting:
      'Pairing with an orchestrator arrives with a later update. This node works alone until then.',
    chromeTitle: 'Google Chrome (optional)',
    chromeTerms: 'Google Chrome installs from Google’s packages under Google’s terms.',
    chromeAccept: 'Install Google Chrome',
    chromeFallback: 'Without Chrome, the node uses Chromium.',
    nvidiaTitle: 'NVIDIA graphics (optional)',
    nvidiaTerms: 'The NVIDIA driver installs from NVIDIA’s packages under NVIDIA’s terms.',
    nvidiaAccept: 'Install the NVIDIA driver',
    nvidiaDatacenter: 'GeForce cards are not licensed for datacenter use.',
    skipStep: 'Skip',
    summaryTitle: 'Review',
    setupDone: 'Setup is complete. The machine is starting your node.',
    setupFailed: 'Setup could not finish: {reason}',
    seedRefused: 'The card’s setup files were not used: {reason}',
    continueButton: 'Continue',
  },
  desktop: {
    greeterTitle: 'Muse Desktop',
    password: 'Password',
    pin: 'PIN',
    securityKey: 'Security key',
    fingerprint: 'Fingerprint',
    orSignInWith: 'Or sign in with',
    capsLockOn: 'Caps Lock is on',
    session: 'Session',
    sessionDesktop: 'Desktop',
    sessionTerminal: 'Terminal',
    accessibility: 'Accessibility',
    recovery: 'Recovery',
    recoveryHint: "Needs an administrator's password or the recovery key",
    secureAttentionGreeter: 'Press Ctrl+Alt+Del at any time to reach the real sign-in screen.',
    secureAttentionLock: 'Press Ctrl+Alt+Del at any time to check this is the real lock screen.',
    secureAttentionPrompt: 'Not sure this is real? Press Ctrl+Alt+Del.',
    notificationsCount: forms({
      one: '{count} notification',
      other: '{count} notifications',
    }),
    agentsRunning: forms({ one: '{count} agent running', other: '{count} agents running' }),
    worksWithoutSignIn: 'Works without signing in',
    stopEverything: 'Stop everything',
    stopEverythingDetail: 'Agents, admin actions and dev servers',
    lockAdmin: 'Lock admin',
    lockAdminDetail: 'Agents lose admin access until you unlock it',
    stopMachine: 'Stop machine',
    administratorPassword: 'Administrator password',
    authenticate: 'Authenticate',
    cancel: 'Cancel',
    agentAdminRequest: 'Agent admin request',
    taintAskNote:
      'This asks even under Always allow: {agent} read a web page before making the request.',
    writtenToAdminAudit: 'Written to the admin audit',
    touchKeyToAllow: 'Touch your security key to allow',
    deny: 'Deny',
    allowOnce: 'Allow once',
    wifiPassword: 'Wi-Fi password',
    connectAutomatically: 'Connect automatically',
    connect: 'Connect',
    bluetoothPairing: 'Bluetooth pairing',
    launcherCalculateLocal: 'Worked out on this machine. Nothing is sent anywhere.',
    launcherSymbolSearch: 'Find emoji or a symbol',
    onboardingTitle: 'Set up Muse Desktop',
    onboardingStep: 'Step {step} of {total}',
    packsForYourWork: 'Packs for your work',
    recommendedPacks: forms({ one: 'Recommended · {count}', other: 'Recommended · {count}' }),
    allPacks: 'All packs · {count}',
    fromSignedIndex: 'From the Muse pack index, signed',
    downloadSize: 'Download',
    onDiskSize: 'On disk',
    details: 'Details',
    setUpLater: 'Set up later',
    back: 'Back',
    install: 'Install',
    installingPacks: forms({ one: 'Installing {count} pack', other: 'Installing {count} packs' }),
  },
}

/** The shape every table has: English's keys, with any language's plural forms. */
export type UiText = typeof EN

/** Browser lazy-region installer; Node consumers already have the canonical vault group. */
export function setVaultEnglish(english: UiText['vault']): void {
  EN.vault = english
}
