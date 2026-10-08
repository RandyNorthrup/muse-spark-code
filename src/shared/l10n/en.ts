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
  resourceResumeNow: 'Resume now',
  resourceRunNow: 'Run now',
  resourceShow: 'Show resources',
  resourceMoveTo: 'Move to {device}',
  resourceKeepHere: 'Keep here',
  resourcePauseNotice:
    'Machine busy: {metric} is {reading} (limit {threshold}). New background work is paused.',
  resourceOverrideNotice: 'Work resumed until {time}.',
  resourceRelocatedNotice: 'Queued work moved to {device} because this machine is busy.',
  resourceRelocationNoRoute:
    'Relocation is not available yet: it needs a paired device or runner route. Work stays on this machine.',
  resourceUnavailable: 'This reading is unavailable on this machine.',
  resourceTransport: 'Transport failures',
  resourceOsService: 'OS service pressure',
  resourceCpu: 'CPU use',
  resourceMemory: 'Memory in use',
  resourceAvailableMemory: 'Available memory',
  resourceGpu: 'GPU use',
  resourceDisk: 'Disk busy',
  resourceDiskFree: 'Free disk space',
  resourceDiskWriteRefused: 'Cannot write to {volume}: critically low free disk space.',
  resourceDiskMinFreeGiBDescription:
    'Free disk space floor in GiB. The default is 10 GiB or 10% of the volume, whichever is smaller, with a minimum of 2 GiB.',
  resourceHistory: 'Resource history',
  resourceHarness: 'Harness work',
  resourceCpuTime: 'CPU time',
  resourcePeakMemory: 'Peak memory',
  resourceHistoryEmpty: 'No resource history recorded yet.',
  resourceHistoryInvalid: 'Resource history could not be read.',
  resourceHistoryObserved:
    'Minute averages and observed harness work. Missing readings stay unknown; unobserved work is not estimated.',
  resourceHistoryThreshold: 'Limit',
  resourceHistoryLevel: 'Level',
  resourceHistoryEvents: 'Resource events',
  resourceHistoryTime: 'Time',
  resourceHistoryKind: 'Work kind',
  resourceHistoryCount: 'Event totals',
  resourceHistoryLevelChanged: 'Level changed',
  resourceHistoryDeferred: 'Deferred',
  resourceHistoryRelocated: 'Relocated',
  resourceHistoryPaused: 'Paused work',
  resourceHistoryOverrides: 'Resume override',
  resourceHistoryOlder: 'Older',
  resourceHistoryNewer: 'Newer',
  resourceHistoryPage: 'Page {page} of {pages}',
  resourceHistoryDetailNotice:
    'Detail is limited to recent history. Totals include all retained journal records.',
  resourceMemoryBelowFloor: 'Below the memory floor',
  resourceMemoryLow: 'Low headroom',
  resourceMemoryAmple: 'Ample headroom',
  referenceResources:
    'Resource, service and transport pressure reduce admission. Each job has observed process and birth limits; cleanup removes only recorded temp roots.',
  resourceGovernorDescription:
    'Keep this machine responsive by slowing or deferring work started by the harness. On by default.',
  resourceCpuMaxPercentDescription:
    'Throttle when machine CPU use stays above this percentage for 30 seconds.',
  resourceMemoryMaxPercentDescription:
    'Throttle when memory in use stays above this percentage for two samples.',
  resourceMemoryMinFreeGiBDescription:
    'Minimum available memory in GiB, capped at 15% of this machine’s RAM.',
  resourceGpuMaxPercentDescription: 'Optional GPU use limit in percent. Unset means no GPU probe.',
  resourceDiskBusyMaxPercentDescription:
    'Optional disk busy limit in percent. Unset means no disk probe.',
  resourceRelocateDescription:
    'Where queued team tasks and checks may move when this machine is busy. Relocation needs a paired device or runner route and is not available yet, so work stays on this machine.',
  resourceRelocatePairedDescription:
    'Use an approved paired device with normal resource load once relocation is available.',
  resourceRelocateAskDescription: 'Ask before moving queued work.',
  resourceRelocateOffDescription: 'Keep work on this machine.',
  // M106: loop previews, structured answers, health and explicit feedback.
  toolArgumentPreviewLabel: 'Argument preview',
  toolArgumentPreviewTruncated: 'Preview truncated.',
  toolArgumentPreviewPending: 'Waiting for complete arguments…',
  toolArgumentPreviewPreparing: 'Preparing arguments…',
  modelApiContinuing: 'The output limit was reached. Continuing once…',
  modelApiContinuationLimit: 'The output limit was reached again. Send a message to continue.',
  modelApiToolStuck:
    'The turn stopped because the same tool call kept returning an unchanged result. Send a message to try another approach.',
  structuredOutputRepair: 'The structured answer was invalid. Retrying once…',
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
  modelApiPacingTokenLimit:
    'Fan-out request exceeds the token budget reserved for background work.',
  modelApiPacingWaiting: 'Waiting for rate limit headroom…',
  modelApiPacingExpired:
    'The wait for rate limit headroom expired. Send the message again to retry.',
  modelApiStatusLabel: 'Meta API status',
  modelApiStatusUnavailable: 'Status unavailable',
  modelApiStatusOpen: 'Open service status',
  modelApiServiceFailure: 'The service returned an error. Check its status or try again.',
  feedbackFailed: 'Could not submit feedback.',
  // M102: the shared usage page; its full table is a separate lazy family.
  usagePageTitle: 'Usage & cost',
  paletteUsagePage: 'Track cost, tokens and limits across editors.',
  openUsagePage: 'Open usage page',
  acpUsageDescription: 'Show usage and cost across models, or open the usage page.',
  companionLaunchFailed:
    'Could not open the panel. Return to your editor and open Muse Spark Code again to get a fresh launch link.',
  // M118: prompt library and local sharing; read UI_TEXT at use time.
  promptLimits: 'The prompt exceeds the size limit, or this scope has too many prompts.',
  promptWorkspaceRequired: 'Open a workspace to save workspace prompts.',
  promptScopeDamaged:
    '{scope}: The prompt store is unreadable or damaged. Its files were kept unchanged.',
  promptImportConfirmScope: 'Save imported prompt in {scope}',
  promptStoreDamaged: 'The prompt store is unreadable or damaged. Its files were kept unchanged.',
  promptStoreBusy: 'The prompt store is busy or changed. Try again.',
  promptSecretsNote: 'Prompts are stored as plain text. Do not save passwords or keys.',
  promptSearch: 'Search prompts and tags',
  promptEmpty: 'No saved prompts match.',
  promptDuplicate: 'Duplicate',
  promptRun: 'Review variables and insert',
  promptEdit: 'Edit prompt',
  promptDelete: 'Delete prompt',
  promptDeleteConfirm: 'Delete this prompt?',
  promptLink: 'Import from link or raw gist URL',
  promptFromFile: 'Import from file',
  promptImportConfirm: 'Save imported prompt',
  promptSave: 'Save prompt',
  promptUseSaved: 'Use saved prompt…',
  promptLibrary: 'Prompt library',
  referencePromptMenu:
    'Composer toolbar or right-click: Save, Share, Use saved. Outside VS Code, Shift-right-click keeps native clipboard actions. Prompts are plain text; save no secrets.',
  promptCopyToUser: 'Copy to my prompts',
  promptTitle: 'Title',
  promptBody: 'Prompt text',
  promptTags: 'Tags',
  promptVariables: 'Variables',
  promptScopeUser: 'All workspaces',
  promptScopeWorkspace: 'This workspace',
  promptImport: 'Import prompt…',
  promptUntrusted:
    'Imported prompt: untrusted text. Review the text and variables before inserting.',
  promptInsert: 'Insert into chat',
  promptFileInvalid: 'The prompt file is invalid or unsupported.',
  shareChat: 'Share chat…',
  sharePrompt: 'Share prompt…',
  shareFull: 'Full transcript',
  shareConversation: 'Conversation only',
  shareCodeBlocks: 'Include code blocks',
  shareAttachmentNames: 'Include attachment names',
  shareDiffs: 'Include diffs',
  sharePreview: 'Preview',
  shareConfirm: 'Confirm sharing',
  shareCopy: 'Copy',
  shareFile: 'Save file…',
  shareBrowser: 'Open in browser',
  shareConfidential: 'Sharing is blocked while this workspace is confidential.',
  shareReviewPrivacy:
    'Review the exact preview for private text before confirming. Known and registered secrets are removed; other private text may remain.',
  shareCancelled: 'Sharing cancelled',
  shareMode: 'Sharing mode',
  shareDecision: 'Decision',
  shareFormat: 'File format',
  shareRangeFrom: 'From message',
  shareRangeTo: 'Through message',
  shareAllMessages: 'All messages',
  shareAttachmentContents: 'Include selected attachment contents',
  shareRangeInvalid: 'Choose an ordered range of messages from this conversation.',
  shareTooLarge: 'This share exceeds the file size or transcript limit.',
  shareAttachmentUnavailable: 'Selected attachment content is unavailable in this range.',
  sharePreviewExpired: 'The preview changed or expired. Preview again before sharing.',
  // M117 / D97: portable estimator surfaces, help and future manifest copy.
  estimateTitle: 'Estimator',
  estimateGoal: 'Goal',
  estimateDeadline: 'Deadline',
  estimateCurrent: 'Current fleet',
  estimateMinimum: 'Minimum setup',
  estimateOptimum: 'Optimum setup',
  estimateCost: 'Lowest cost',
  estimateSpeed: 'Fastest finish',
  estimateRun: 'Estimate',
  estimateRefresh: 'Re-estimate',
  estimateSpinUp: 'Spin it up',
  estimateP50: 'P50 finish date',
  estimateP90: 'P90 finish date',
  estimateCriticalPath: 'Critical path',
  estimateCriticalBound: 'More agents would not finish sooner.',
  estimateBottleneck: 'Limiting resource',
  estimateMachines: 'Machines',
  estimateSlots: 'Agent slots',
  estimateAccounts: 'Accounts',
  estimateCi: 'CI jobs',
  estimateInputs: 'Inputs',
  estimateCalibration: 'Calibration',
  estimateSampleSize: 'Calibration sample size',
  estimatePrior: 'Uncalibrated prior',
  estimateFitted: 'Calibrated from history',
  estimateHistory: 'Lane history',
  estimateHistoryPrivacy: 'History keeps lane IDs, hours and counts, never conversation content.',
  estimateSeed: 'Simulation seed',
  estimateAsOf: 'Snapshot time',
  estimateMarginal: 'Time saved by this added machine',
  estimateHourly: 'Hourly price',
  estimateCatalog: 'A catalog price on {date}, not a quote.',
  estimateNoPrice: 'No public catalog price available.',
  estimateAdvice: 'Rented-server advice only; installation and pairing are unavailable.',
  estimateBudget: 'Provisioning budget (USD)',
  estimateBudgetRequired:
    'Set a hard budget for this run before provisioning; there is no default.',
  estimateConfirmServer: 'Create {server} for {price}? Total: {total}; run budget: {budget}.',
  estimateSpendRule:
    'Confirm each server separately. The estimator never pays or creates provider accounts.',
  estimateIdleNotice: '{server} has been idle for {duration}. Keep it or tear it down and wipe it.',
  estimateKeep: 'Keep',
  estimateTeardown: 'Tear down and wipe',
  estimateProvider: 'Connected provider',
  estimateStartExisting: 'Start lanes on the existing fleet',
  estimatePrerequisites:
    'Contracts must be reviewed and prerequisites merged before the first wave starts.',
  estimateDrift: 'Drift since the previous estimate',
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
  estimateFailed: 'Estimate failed: {detail}',
  estimateSchedule: 'Lane schedule',
  estimateGantt: 'Schedule for {goal}, with the critical path and P50 and P90 finish marks.',
  estimateOptimizeDescription:
    'Choose the cheapest setup meeting the deadline at P90, or the fastest setup with worthwhile marginal savings.',
  estimatePriceLookupDescription:
    'Look up public catalog prices when the Reports network policy permits; each price shows its date.',
  estimateCostDescription: 'Cheapest setup meeting the deadline at P90.',
  estimateSpeedDescription: 'Fastest setup while another machine still saves enough time.',
  estimateCommandTitle: 'Open Estimator',
  estimateUsage: 'Usage: /estimate <goal> [--by <date>] [--fleet current|minimum|optimum]',
  estimateCliHelp:
    'Estimate a goal using linked machines, agent slots, accounts and CI; no model call.',
  estimateCiUnavailable: 'CI minutes unavailable',
  estimateInstalling: 'Installing node',
  estimatePairing: 'Pairing node',
  estimateReady: 'Server ready',
  estimateDeleting: 'Tearing down server',
  estimateKept: 'Server kept',
  estimateLocalBudget: 'The estimate exceeded its local time budget.',
  estimateFormat: 'Output format',
  estimatePriceLookup: 'Public price lookup',
  estimateOptimization: 'Optimization',
  estimateTotal: 'Total price',
  estimateWindowRolling: 'Rolling window',
  estimateWindowCalendar: 'Calendar window',
  estimateWindowPeriod: 'Window period',
  estimateWindowRenewal: 'Quota renewal',
  estimateWindowTimeZone: 'Time zone',
  estimateAllowance: 'Full allowance',
  estimateDisk: 'Disk space',
  estimateDiskPeak: 'Peak disk demand',
  estimateDiskSteady: 'Retained disk demand',
  estimateDiskHeadroom: 'Usable disk headroom',
  estimateDiskFloor: 'Disk free-space floor',
  estimateBasis: 'Measurement basis',
  estimateBasisHistory: 'Historical measurement',
  estimateBasisCalibration: 'Calibration',
  estimateBasisAssumption: 'Assumption',
  estimateUnknown: 'Unknown',
  estimateUncertainty: 'Uncertainty',
  estimateReviewRounds: 'Lane review rounds',
  estimateModuleStrikes: 'Module-family strikes',
  estimateClassStrikes: 'Finding-class strikes',
  estimateRedesigns: 'Redesign events',
  estimateDisclosureMissing: 'Numeric calibration disclosures are incomplete.',
  // The estimator's own module (dist/estimator.js) could not be loaded.
  estimateUnavailable:
    'The estimator could not be loaded, so no estimate can run; reinstall the extension and reload the window. The log has the details.',
  // M117 W (PLAN.md D100, gotcha G4): {lanes} is the stale-base lane list.
  estimateStaleBase: 'Stale base ({lanes}): rebase before starting.',
  // M117 W: {lanes} is the submitted first wave.
  estimateWaveStarted: 'Started {lanes}.',
  referenceAgentControls:
    'Agent controls; Interrupt; Stop; Resume; Close agent; Reopen agent; Mark result read; Send message; Follow-up task',

  referenceBestOfNRequirements:
    'Candidates require Model API, the paid feature enabled, a trusted Git workspace, Git 2.36 or newer, and no configured Git filter or hook programs. A finite session budget requires an owned parent budget scope shared by candidates. Set attempt and request limits, compare results or cancel, then take selected changes by applying and staging without a commit.',
  referenceWindowsSessions:
    'Muse Code cannot rename or fork sessions on Windows (meta-models/muse-code-sdk#30, #31).',
  referencePaletteKeys:
    'Navigate items, choose or complete a selection, or close the list. Choose how much effort Muse puts into each reply.',
  referenceServe:
    '{command} [options]              Serve the Agent Client Protocol on stdin and stdout',
  referenceTabSnooze: 'Snooze for 15 minutes; Snooze for an hour; Snooze until restart.',
  referenceElicitationKeys: 'Cancel',
  referenceGoalKeys: 'Cancel',
  referenceMicKeys: 'records your voice into the composer (tap to toggle, hold to talk)',
  referenceOutputKeys: 'Open output',
  referenceAgentKeys: 'Send message',
  referenceDialogKeys: 'Browse matches, activate the selected conversation or close the dialog.',
  referencePopoverKeys: 'Navigate options, adjust a value, choose an option or close the popover.',
  referenceExecImages:
    'Headless images require --image-generation, acceptEdits and an affordable hard budget. No price question is shown; requests requiring permission are refused.',
  referenceProviders:
    'List, add, test or remove model providers. Keys use the credential store. Paid token probes require the editor; the CLI refuses them.',
  referenceCliOptions: {
    'resource-governor':
      '--resource-governor on|off: Keep this machine responsive by throttling or deferring harness work. On by default.',
    'cpu-max': '--cpu-max <percent>: Throttle when CPU stays above this percentage for 30 seconds.',
    'memory-max':
      '--memory-max <percent>: Throttle when used memory stays above this percentage for two samples.',
    'usage-history': '--usage-history: Track cost, tokens and limits across editors.',
    preset: '--preset: Provider',
    as: '--as: Provider',
    address: '--address: Address',
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
    'shell-sandbox': '--shell-sandbox auto|muse|off    Muse Code’s shell sandbox',
    'allow-dangerously-skip-permissions':
      '--allow-dangerously-skip-permissions  Offer the Bypass permissions mode',
    'allow-contributor-models':
      '--allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    'web-search':
      '--web-search                     Offer paid web search (Model API backend; its price is asked first)',
    'image-generation':
      '--image-generation               Offer paid image generation (Model API backend; its price is asked first)',
    'scheduled-prompts':
      '--scheduled-prompts              Offer paid scheduled prompts (Model API backend; its price is asked first)',
    verbose: '--verbose                        Log every detail on stderr',
    'questions-defer-after':
      '--questions-defer-after <seconds>  Defer questions after 60 seconds by default; 0 never, 1–9 read as 10, maximum 3600',
    help: 'help / --help / -h: ACP / CLI. help --all: Commands, settings and features, with descriptions and documentation.',
    version: 'Print the installed agent version.',
    cwd: 'Use this directory as the workspace.',
    'prompt-file': 'Read the prompt from this file.',
    'untrusted-file': 'Attach this file as untrusted data; repeat the option for more files.',
    attach: 'Attach this media file; repeat the option for more files.',
    record: 'Refused for headless runs: nobody is there to preview a recording.',
    'permission-mode': 'Choose how Muse asks before it acts.',
    model: 'Choose the model for this run.',
    provider:
      '--provider <id>                   The provider the account belongs to (auth set/status/clear).',
    account: '--account <id>                    The account to use (auth set, exec).',
    'account-pool':
      '--account-pool                  Request account pooling. Requires a bound resource owner; excludes key-stdin in CI.',
    effort: 'Choose how much effort Muse puts into each reply.',
    output: 'Choose the result format: text, json or jsonl.',
    'max-budget-usd': 'Set the hard spending limit in USD for this run.',
    'max-requests': 'Set the maximum number of model requests.',
    timeout: 'Set the run deadline in seconds.',
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
    'no-auto-compaction': 'Disable automatic compaction',
    'output-schema':
      'Validate the final answer against a bounded JSON schema file (Model API only).',
    'output-schema-outside': 'Allow the output schema file to resolve outside the workspace.',
    'estimate-by': '--by <date>: Deadline',
    fleet: '--fleet current|minimum|optimum: Current / Minimum / Optimum',
    'estimate-format': '--format md|html|json|text: Output format',
    seed: '--seed <seed>: Simulation seed',
  },
  referenceScanSecrets:
    'Scan a UTF-8 patch file for secrets and fail on detection. --key-stdin also checks for the exact in-memory Model API key; no key is stored.',
  referenceVault:
    'Work with the per-user credential vault from a terminal: status, unlock, lock, list, add, grants, audit, import and watch. Values never print; the broker holds them.',
  referenceVaultHelp: 'Show the per-user credential vault command usage.',
  referenceVaultPanel:
    'Open the per-user credential vault. Values never print; the broker holds them.',
  referenceVaultLock: 'Lock the per-user credential vault now, ending every use in every window.',
  referenceAuthClear: 'Remove the stored Model API key.',
  referenceAuthStatus: 'Check whether a Model API key is stored.',
  referenceAccountsTitle: 'Several accounts per provider',
  referenceAccounts:
    'Manage the accounts of one provider: list, add, remove, order and thresholds. Credentials come only from standard input. Paid consent stays per workspace for now.',
  referenceDeveloper:
    'Show or unlock machine-local developer options. Profile operations require a connected resource owner.',
  referenceTabLanguages: 'Choose a language to switch Tab suggestions on or off for it.',
  referenceTabMenu:
    'Turn Tab off; Snooze for 15 minutes; Snooze for an hour; Snooze until restart; Tab languages…; Multi-line mode…; Account & usage. When Copilot causes Tab to yield, the menu also offers disabling Copilot for the current language or running both.',
  referenceTabOff: 'Turn Tab off: museSpark.modelApiTab=false.',
  referenceTabOn:
    'museSpark.modelApiTab=true. Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic.',
  referenceBrowserDownload:
    'Chrome for Testing: Download (Settings: museSpark.browserCheckRuntime).',
  referenceRemoveSkills:
    'Remove only the extension-managed Muse Code skill copy and its links; leave other skills untouched.',
  referenceInstallSkills:
    "Copy project_setup, feature_delivery and quality_retrofit into Muse Code's configuration and link them as skills.",
  referenceExecContract:
    'Headless runs refuse workspace trust and bypass permissions. Headless runs permit only plan or acceptEdits. Hosted web search has no bounded allowance and is refused. Image generation requires acceptEdits. Choose exactly one prompt source. Prompt and key cannot both use stdin. Model API requires --max-budget-usd. modelApi: --max-budget-usd / --max-requests / --ephemeral / --key-stdin / --image-generation; museCode: --muse-binary / --shell-sandbox; --untrusted-file: data; --fail-on-denial; --ephemeral: memory-only; --output: text/json/jsonl; --cwd: workspace.',
  referenceBriefHelp:
    'help / --help / -h: ACP / CLI. help --all: Commands, settings and features, with descriptions and documentation.',
  referenceKeyStdin:
    'auth set: Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations. exec / scan-secrets --key-stdin: Read the key from a pipe, not a terminal. stdin → memory; prompt stdin + key stdin = Prompt and key cannot both use stdin.',
  referenceModalKeys: 'Close the dialog or move focus within it.',
  referenceRenameKeys: 'Confirm or cancel renaming this conversation.',
  referenceRadialKeys:
    'Navigate actions, jump to the first or last, activate an action, or close or return to the parent menu.',
  referenceRowKeys: 'ContextMenu / Shift+F10: More actions',
  referenceEffortKeys: 'Choose how much effort Muse puts into each reply.',
  referenceMenuKeys: 'Navigate items, choose or complete a selection, or close the list.',
  referenceArchiveKeys: 'Archive / Unarchive',
  referenceModeKeys: 'cycles the permission mode while the composer has focus',
  referenceDictationKeys: 'records your voice into the composer (tap to toggle, hold to talk)',
  referenceNewlineKeys: 'Insert a new line in the draft.',
  referenceSendKeys: 'Send the draft using the gesture selected by useCtrlEnterToSend.',
  referenceThinking:
    'Choose how much effort Muse puts into each reply. Thinking: On = effort; Off = museCode:none / modelApi:minimal.',
  referenceSandbox:
    'On Windows, when this window uses the Muse Code shell sandbox, set it up with one administrator approval, then start a new conversation. shellSandbox="off" does not require setup.',
  referenceSetup: 'Run Setup hooks for init from spark-hooks.json in a trusted workspace.',
  referenceSkills: "SKILL.md. museCode: Turn Muse Code's skills on or off. modelApi: SKILL.md.",
  referenceDictation:
    'Voice dictation is not available on Linux: no distribution ships a speech recogniser, and this extension adds no third-party engine. Voice dictation is not available in a remote window (SSH, WSL, a container, a tunnel or a codespace): the extension runs on the remote machine, which cannot hear this computer’s microphone. Open the folder in a local window to dictate.',
  referenceVoice:
    'Paid voice is unavailable on Model API in this version. Muse Code needs a local window, a stored Model API key and explicit opt-in. Linux also needs arecord or parec.',
  referenceBestOfN:
    'Best of N Apply and stage exactly the selected preview. No commit is created; ignored files are excluded.',
  referenceNativeAgentsConditions:
    'When run.subagent_delegation_mode="auto", Muse Code can delegate to agents. When it is "off", delegation tools are unavailable. run.workflow_trigger_mode: auto / explicit / off.',
  referenceNativeAgents:
    'run.workflow_trigger_mode: auto / explicit / off. Muse Code agent delegation controls.',
  referenceAttachments:
    'Attach files by selecting or dropping them, and paste images into the composer. PNG, JPEG, GIF and WebP images require a selected model with vision. PDF attachments require Model API. Trusted indexed workspace text files can be attached; protected or confidential files are refused. The limits below apply before sending.',
  referenceScreenRecording:
    'Record the screen, preview the clip, then attach or discard it. Needs a local window; remote windows refuse. The clip attaches as video and follows the media limits. Requires native recorder support and verified video upload support.',
  referenceLatestRecording:
    'Attach the most recent screen recording again without recording a new one. Requires a readable recording and verified video upload support.',
  referenceUploadedFiles:
    'List the files uploaded for this conversation and delete them before they expire. Deleting a file another app also uses asks first. Requires provider/account upload storage integration.',
  referenceConversationActions:
    'Rename, fork or rewind a conversation. Rewind can restore recorded edits as well as history; changed files are left alone, and shell changes are not covered. While a turn runs, new messages steer it. Model API messages can be withdrawn before the next request; Muse Code permits withdrawal only while queued, because steering is delivered immediately. Side chat copies completed turns, clears the goal and stays in Plan; Muse Code file tools may still edit in Plan. Select transcript text to reply, ask, comment or copy.',
  referenceQuestions:
    'Choose and Submit an answer, explain in your own words, or Cancel. Muse receives submitted answers and explanations in the conversation.',
  referenceQuestionsDeferral:
    'In the panel, each question has one interactive card pinned above the composer. The transcript keeps a compact Open question marker; Answer opens or expands the docked card and focuses its first control, including after deferral. MCP forms follow the same rule. Muse receives submitted answers and explanations in the conversation. After museSpark.questions.deferAfterSeconds (60 seconds by default; 0 waits indefinitely), Muse continues work that does not depend on the answer; the card becomes an open question that you can answer later or dismiss. A late answer is your own message and approves nothing. Next open question and Previous open question move between open cards. Scheduled prompts defer at once, and headless exec declines questions. In ACP, --questions-defer-after sets the form deadline, /questions lists open questions and /answer <n> <text> answers one.',
  referencePermissionLimits:
    'museCode:manual: Muse will ask before running commands; Muse Code edits workspace files without asking\nmuseCode:acceptEdits: On Muse Code, the same as Manual: Muse Code edits workspace files without asking and asks before running commands\nmuseCode:plan: Muse plans first; Muse Code refuses commands, but its file tools can still edit files without asking\nmuseCode:bypassPermissions: Muse will edit files and run commands without asking\nmodelApi:manual: Muse will ask for approval before each edit and each command\nmodelApi:acceptEdits: Muse will edit files without asking and ask before running commands\nmodelApi:plan: Muse will explore the code and present a plan before editing\nmuseCode (museSpark.museCodeAutoReviewer=false): Muse Code runs the commands it judges simple without asking and asks before the rest\nmuseCode (museSpark.museCodeAutoReviewer=true): Muse Code runs the commands it judges simple without asking; a reviewer may allow some others once, and you are asked about the rest\nmodelApi (museSpark.modelApiAutoReviewer=false): Muse will edit files without asking, except protected files, and ask before commands\nmodelApi (museSpark.modelApiAutoReviewer=true): Muse will edit files without asking, except protected files; a paid reviewer may allow some commands once, and you are asked about the rest\nThese Auto descriptions concern requests not settled by rules. The Model API reviewer additionally requires paid consent and budget admission. A declined or failed review leaves the decision to you. Ordinary ACP has neither reviewer.',
  referenceElicitationTitle: 'MCP elicitation',
  referenceElicitation:
    'MCP forms ask for information for the requesting MCP server. Submitted form values go to that server, outside the model conversation and transcript. A server can include them in later tool output. Never enter a password or key.',
  referenceSecretPrompt:
    'When a prompt contains a detected secret, the transcript redacts it and asks whether to send it anyway or return to editing.',
  referenceCodeIntelExtra:
    'Use editor language services for definitions, references, symbols, calls and safe renames. Hover Repo map (mcp__ide__repoMap / repo_map).',
  referenceContext:
    'Click to compact now Summarise older context to free the window Cannot rewind before the latest compaction.',
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
    'Shared daily budget for interactive paid extras: museSpark.paidDailyBudgetUsd. Tab has its own separate budget.',
  referenceCache: 'Settings (modelApiPromptCacheRetention).',
  referenceMcp:
    'MCP servers: Muse Code runs its own servers; on Model API this window runs configured servers. ACP Model API has no editor MCP servers.',
  referenceTab:
    'Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic.',
  referenceNativeSearch:
    'Muse Code web search and native cron use the subscription. Native cron has no MSP schedule controls; extension search and schedules are separate paid Model API features.',
  referenceCustomAgents:
    'Define custom agents in project or personal AGENT.md files. Select an agent or ask for explore or second-opinion; tool allowlists narrow its abilities. Model API child tasks require paid subagent consent.',
  referenceCodeOutput:
    'Copy copies code; Insert writes at the editor cursor; Apply replaces the editor selection. Open tool output to read the full result; clipped output can be paged. Select transcript text to quote it in the composer, ask about it, add a comment or copy it.',
  referencePaidContexts:
    'Interactive Model API extras ask before spending and share the daily budget. Muse Code images and voice need a stored Model API key and explicit opt-in; their spending is outside that daily ledger. ACP paid features default off and require Model API flags and editor permission. ACP and headless Model API requests reserve against the runtime daily budget; headless also requires a hard run budget. Headless images require acceptEdits and the image flag. Account & usage can forget workspace paid-use grants.',
  referenceAcp:
    'Installed skills add dynamic slash commands. This static reference does not list them. ACP handles local /help, /report, /playbook, /compact, /legal, /usage, /resources, /resources resume, /usage resources, /questions, /answer, /prompt, /share and /agents plus installed skills; panel slash commands, settings and editor dialogs in the linked reference are extension workflows.',
  referenceWebFetchTitle: 'Web fetch',
  referenceWebFetchDetail:
    'Fetch public web pages as readable text, with permission and network checks.',
  referenceCodeIntelTitle: 'Code intelligence',
  referenceCodeIntelDetail:
    'Use editor language services for definitions, references, symbols, calls and safe renames.',
  referenceShellDetail:
    'Run your own !commands, or let the agent run commands under your permission mode.',
  referenceBoardDetail:
    'Filter conversations by title or branch, inspect their state, changes and approvals, and activate a conversation.',
  helpReferenceTitle: 'Help & Reference',
  referenceIntro: 'Commands, settings and features, with descriptions and documentation.',
  referenceSearch: 'Search the reference',
  referenceFeatures: 'Features',
  referenceCommands: 'Commands',
  referenceSettings: 'Settings',
  referenceShortcuts: 'Keyboard shortcuts',
  referenceCurrent: 'Current value',
  referenceDefault: 'Default',
  referenceOpenSetting: 'Open setting',
  referenceRun: 'Run',
  referenceDocs: 'Documentation',
  referenceNoMatches: 'No matching entries.',
  referenceUnavailable: 'Current values are unavailable in this host.',
  referenceHidden: 'Hidden to protect sensitive values',
  referenceApplies: 'Editors: {editors}. Backends: {backends}.',
  referencePaid:
    'Meta Model API (your key, pay as you go): Allow once / Allow always in this workspace',
  referenceVersion: 'Print the installed agent version.',
  referenceSidebar: 'Open the Muse Spark chat in the sidebar.',
  referenceNewTab: 'Open a new Muse Spark conversation in an editor tab.',
  referenceFocus: 'Move keyboard focus between the chat input and editor.',
  referenceTasks: 'Open this conversation’s task list in a separate editor tab.',
  referenceDiagnostics: 'Show local backend and extension diagnostics.',
  referenceReport: 'Preview a scrubbed problem report before saving or sending it.',
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
  sessionDeleteTimedOut: 'Deletion confirmation timed out. The session remains in History.',
  // M116 / D96: shared panel, Agent map, ACP, CLI and report wording.
  playbookTitle: 'Orchestrator playbook',
  playbookStatus: 'Status',
  playbookRecord: 'Record',
  playbookSettings: 'Playbook settings',
  playbookEmpty: 'No playbook decisions recorded yet.',
  playbookEnabled: 'On',
  playbookDisabled: 'Off',
  playbookReasonLabel: 'Reason for turning this rule off',
  playbookReasonRequired: 'Give a reason before turning a rule off.',
  playbookDisabledDetail: 'Turned off by {actor} on {date}: {reason}',
  playbookSafetyAlwaysOn: 'Safety checks always apply. This rule cannot be turned off.',
  playbookPatchRoundsLabel: 'Fix rounds before redesign',
  playbookPatchRoundsHelp:
    'The limit can be lowered. After it is reached, write a design decision and dispatch a redesign lane.',
  playbookPatchRoundsInvalid: 'Choose one or two fix rounds; the ceiling cannot be raised.',
  playbookFallbackReviewer: 'Fallback reviewer for classifier-blocked reviews: {reviewer}',
  playbookFallbackNone: 'No fallback reviewer named',
  playbookResidualAccepted: 'Residual accepted',
  playbookRecordHelp:
    'Show review strikes, design decisions, safety refusals, settings and unbound acceptance reasons.',
  playbookResidualUnbound: 'Unbound residual acceptance',
  playbookResidualUnboundReason:
    'No earlier residual matches this acceptance’s time and evidence. It covers no residual.',
  playbookLeaseRecord: 'Patch lease {status}: {module} ({lane})',
  playbookWorkRecord: 'Work {id} on {module}: {commits} baseline commits',
  playbookVerificationRecord: 'Hook verification {result} for {commit} ({scope})',
  playbookPlanRedesign: 'Plan a redesign',
  playbookDesignDecision: 'Design decision',
  playbookDesignPending: 'Awaiting redesign review',
  playbookCoverageLabel: 'Review coverage',
  playbookModuleLabel: 'Module',
  playbookClassLabel: 'Finding class',
  playbookOutcomeLabel: 'Redesign outcome',
  playbookUnavailable: 'The playbook is unavailable in this session.',
  playbookHelpDescription:
    'Show review strikes, design decisions, safety refusals and rule settings.',
  playbookCommandUsage: 'Use `playbook status|record|settings`.',
  playbookSave: 'Save settings',
  playbookSaved: 'Playbook settings saved.',
  playbookStrikeBadge: forms({ one: '{count} review round', other: '{count} review rounds' }),
  playbookRules: {
    threeStrikes: 'Redesign after three strikes',
    onePassReview: 'Review every class in one pass',
    contractsFirst: 'Contracts and prerequisites first',
    smallFirst: 'Small work first, after dependencies',
    offload: 'Offload heavy checks to workers',
    continuousIntegration: 'Integrate on one rolling trunk',
    breakOnPurpose: 'Prove tests and gates fail',
    loudFailures: 'User items and failures first',
    neverAround: 'Never route around a safety check',
  },
  playbookClasses: {
    validation: 'Validation',
    security: 'Security',
    failure: 'Failure paths',
    honesty: 'Honesty',
    concurrency: 'Concurrency',
    lifecycle: 'Lifecycle',
    tests: 'Tests and gates',
    docs: 'Documentation',
  },
  playbookResolutions: {
    impossible: 'Structurally impossible',
    caught: 'Caught by a check',
    remains: 'Still present',
  },
  playbookDispositions: {
    fixed: 'Fixed',
    disputed: 'Disputed',
    residual: 'Named residual',
    override: 'Lead or owner override',
  },
  playbookDesignFields: {
    failureClass: 'Class of failure',
    whyPatchesFailed: 'Why the patches did not end it',
    structuralChange: 'Structural change that removes the failure',
    planLocation: 'Decision in the plan',
    redesignLane: 'Redesign lane',
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
      liability: 'Retained liability',
      certainty: { exact: 'Exact', estimated: 'Estimated', unknown: 'Unknown' },
      edit: 'Edit schedule',
      audit: 'Grant audit',
      invalid: 'Check the schedule fields, target availability and standing grant before saving.',
      loadFailed: 'Schedules could not be loaded. Try again.',
      empty: 'No schedules in this workspace.',
      defaultName: 'Scheduled prompt',
      defaultPrompt: 'Describe what the schedule should do.',
      stateUnknown: 'State unknown — Retry',
      retry: 'Retry',
      dateTimeUtc: 'Date and time (UTC)',
      anchorDate: 'Anchor date (in the schedule’s time zone)',
      minutes: 'Interval in minutes',
      everyDays: 'Every N days',
      times: 'Times (HH:MM, comma separated)',
      cronExpression: 'Five-field cron expression',
      source: 'Event source',
      conditions: 'Conditions (field=value, one per line)',
      endDate: 'End date and time (UTC)',
      afterRuns: 'End after N runs',
      sent: 'Sent on schedule',
      cost: 'Cost',
      grantHelp:
        'One entry per line. Paths stay inside this workspace; protected paths and tools that require a person are always refused.',
      auditKinds: {
        created: 'Created',
        changed: 'Changed',
        revoked: 'Revoked',
        used: 'Used',
      },
    },
    reportAction: {
      formats: {
        markdown: 'Markdown document',
        html: 'HTML document',
        json: 'JSON document',
        text: 'Plain text',
      },
      unavailable:
        'Report delivery is unavailable in this host. The deterministic report runner is required.',
      grantRequired: 'This report destination is outside the schedule’s current grant.',
      failed: 'Report delivery failed or its outcome is uncertain.',
      invalidResult: 'The report runner returned an invalid destination receipt.',
      kind: 'Report kind',
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
      timeZone: 'Time zone',
      preview: 'Next five fires',
      end: 'End condition',
      target: 'Target',
      delivery: 'Delivery',
      mode: 'Permission mode',
      grant: 'Standing grant',
      paidCap: 'Daily schedule cap',
      parallel: 'Run in parallel',
      paused: 'Paused',
      pause: 'Pause schedule',
      resume: 'Resume schedule',
      remove: 'Remove schedule',
      revoke: 'Revoke grant',
      pin: 'Pin schedule',
      timeline: 'Schedule timeline',
      schedulePrompt: 'Schedule this prompt…',
      runNow: 'Run now',
      save: 'Save schedule',
      tools: 'Allowed tools',
      commands: 'Command prefixes',
      paths: 'Workspace paths',
      creator: 'Creator',
      depth: 'Scheduling depth',
      background: 'Background entry',
      whenClosed: 'Closed target',
      catchUp: 'Missed fires',
      unavailable: 'Unavailable',
    },
    delivery: {
      steer: 'Steer the running turn',
      interrupt: 'Interrupt and run',
      queue: 'Queue after this turn',
      whenIdle: 'New turn when idle',
      newConversation: 'New conversation',
    },
    triggers: {
      once: 'Once at a date and time',
      interval: 'Every N minutes or hours',
      daily: 'Every N days',
      weekdays: 'On weekdays',
      weekly: 'Weekly days and times',
      cron: 'Custom cron',
      event: 'On an event',
      afterEvent: 'After an event, at a time',
    },
    targets: {
      conversation: 'This conversation',
      namedConversation: 'Named conversation',
      newConversation: 'New conversation each fire',
      worker: 'Worker',
      role: 'Team role',
      team: 'Team',
      node: 'Muse Node',
    },
    destinations: {
      save: 'Save to a folder',
      browser: 'Open in browser',
      email: 'Email to the user',
      post: 'Post to a repository',
      cloud: 'Cloud save (planned)',
      sms: 'Text message (planned)',
    },
    policies: {
      open: 'Open in the background',
      skip: 'Skip the fire',
      runOnce: 'Run once to catch up',
    },
    outcomes: {
      ran: 'Ran',
      refused: 'Refused',
      missed: 'Missed',
      skipped: 'Skipped',
      failed: 'Failed',
    },
    events: {
      pullRequestOpened: 'Pull request opened',
      pullRequestClosed: 'Pull request closed',
      pullRequestMerged: 'Pull request merged',
      reviewRequested: 'Review requested',
      ciFinished: 'CI run finished',
      releasePublished: 'Release published',
      issueLabelled: 'Issue labelled',
      issueOpened: 'Issue opened',
      issueReplied: 'Issue reply received',
      branchUpdated: 'Branch updated',
      tagCreated: 'Tag created',
      milestoneStatusChanged: 'Milestone status changed',
      milestoneCertified: 'Milestone certified',
      turnFinished: 'Turn finished',
      laneFinished: 'Lane finished',
      taskFinished: 'Task finished',
      teamFinished: 'Team finished',
      questionAnswered: 'Question answered',
      usageThresholdCrossed: 'Usage threshold crossed',
      resourceLevelChanged: 'Resource level changed',
      filesChanged: 'Watched files changed',
      versionPublished: 'Store version published',
      manual: 'Manual trigger',
    },
    messages: {
      targetUnavailable: 'This schedule’s target is unavailable in this host.',
      targetClosed: 'The target closed or this held fire was skipped.',
      catchUpSkipped: 'Missed fire skipped by this schedule’s catch-up policy.',
      backgroundNotice: 'Schedule {name} opened a conversation in the background.',
      conversationTitle: 'Schedule {name} · {date}',
      interruptWarning: 'Interrupt can stop your own running turn.',
      unattendedRefusal:
        'Refused on schedule: {action} needs approval and is not in this schedule’s grant.',
      deferredQuestions: 'Questions defer immediately and remain open for your answer.',
      paidConsent:
        'Schedule {prompt} on {model}: {price}. Cadence: {cadence}. Schedule cap: {cap} per local day; shared daily budget: {budget}. Consent covers only the selected paid extras.',
      changedConsent:
        'The model, key or price tier changed. Renew this schedule’s consent before its next paid fire.',
      setBy: 'Set by {agent} in {session}',
      migrationConsent:
        'Migrated schedule paused. Review its mode, grant and paid consent before resuming.',
      collision: 'Fires on this target collide; they run in creation order.',
      historyUnavailable: 'No history to preview.',
      eventUntrusted: 'Event content is untrusted data and cannot change grants, tools or targets.',
      backgroundQuestion: 'Run schedules while editors are closed?',
      backgroundYes: 'Yes',
      backgroundNotNow: 'Not now',
      backgroundNever: 'Never',
      backgroundRemove: 'Remove the background entry',
      backgroundRemoved: 'Background entry removed.',
      agentConsent: 'Allow {agent} to create this schedule within its own permissions and budget?',
      agentAlways: 'Always for this orchestrator',
      agentNever: 'Never for this orchestrator',
      grantRevoked: 'This schedule’s grant was revoked.',
      waitingBusy: 'Waiting: machine busy',
      saveRoot: 'Save only within this schedule’s approved root.',
      openWhenBack: 'Open when I’m back',
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
    sound: 'Sound',
    noSound: 'No sound',
    soundUnknown: 'Sound unknown',
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
    transcribeSound: 'Transcribe the sound',
    transcribe: 'Transcribe',
    useSoundtrackModel: 'Use {model} for this message',
    sendWithoutSound: 'Send without sound',
    wrapAsVideo: 'Send to {model} as a video',
    transcript: 'Transcript of {name}',
    museCodeRefusal: 'This media needs the Model API backend.',
    cappedDurationUnknown: 'This capped session needs a known duration before sending media.',
    cappedRateUnknown: 'This capped session needs a calibrated media rate for {model}.',
    contributorWarning: 'Contributor models may use this media for training.',
    contributorQuestion: 'Send {name} to a Contributor model? It may be used for training.',
    recordingWarning: 'This recording includes whatever was on your screen.',
    send: 'Send',
    useStandard: 'Use the Standard model',
    uploadPending: 'Waiting to upload',
    uploadProgress: 'Uploaded {uploaded} of {total}',
    uploadStop: 'Stop upload',
    uploadFailed: 'Upload failed: {reason}',
    uploadExpired: 'The upload expired. Attach {name} again.',
    sourceChanged: '{name} changed since upload. Attach it again.',
    uploadedFiles: 'Uploaded files',
    filesOurs: 'Uploaded by this app',
    filesOtherApp: 'From another app',
    filesEmpty: 'No uploaded files.',
    fileNoExpiry: 'No expiry set',
    fileSessions: 'Sessions: {sessions}',
    filesInUse: 'Remove this file from its sessions before deleting it.',
    deleteUploadedFiles: 'Delete uploaded files…',
    deleteAllOurs: 'Delete all ours',
    otherAppFileConfirmation: 'Another app may still use {name}. Delete it anyway?',
    filesReadOnly: 'The key was removed. Uploaded files are read-only until their expiry.',
    fileExpiry: 'Expires {expiry}',
    poolUsage: '{used} of {pool} stored',
    replayOmitted: '{name} ({duration}) was left out: {model} does not take {kind}.',
    attachRecording: 'Attach screen recording…',
    attachLatestRecording: 'Attach latest screen recording',
    recordingCountdown: 'Recording: {remaining} remaining',
    recordingMicrophone: 'Microphone',
    recordingSystemAudio: 'System audio',
    recordingPreview: 'Preview screen recording',
    recordingAttach: 'Attach',
    recordingDiscard: 'Discard',
    recordingPermissionDenied:
      'Screen recording permission was denied. Allow it in system settings and try again.',
    recordingAccessDenied:
      'Access to the screen recording was denied. Check permissions and try again.',
    recordingFailed:
      'Screen recording failed. Check available storage and recording support, then try again.',
    recordingOpenPermissions: 'Open Screen Recording settings',
    recordingUnavailable: 'Screen recording is unavailable: {reason}',
    recordingRemote:
      'This window runs on a remote host with no local screen. Use the companion page or choose a recording file.',
    recordingBrowserUnsupported: '{browser} cannot record mp4. Choose an mp4 recording file.',
    recordingUserOnly: 'Only an interactive user can start a screen recording.',
    recordingNoRecent: 'No recent screen recording was found.',
    recorderUnavailable: 'No screen recorder is available on this host.',
    attachHeadless: 'Refused for headless runs: pass the file with --attach instead.',
    uploadStorageUnknown:
      'Storage billing has not been verified. Uploads are unavailable until it is recorded.',
    attachmentUnknownType: 'Unsupported attachment type: {type}',
    recordingStart: 'Start recording',
    recordingStop: 'Stop recording',
    uploadDeleteFailed: 'Could not delete {name}: {reason}',
    conversionFailed: 'Conversion failed: {reason}',
    replayMetadata: 'Media: {name} ({duration}, {size})',
    replayMetadataNoDuration: 'Media: {name} ({size})',
  },
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
  planUi: {
    copilotConnect: 'Use my Copilot models',
    copilotUnavailable: 'Copilot models are unavailable. Enable Copilot and try again.',
    copilotQuota: 'Your Copilot quota is exhausted. Manage usage or choose another model.',
    copilotRateLimit: 'Copilot is rate limited. Try again later.',
    copilotConsent: 'Allow access to Copilot in its consent dialog to continue.',
    expired: 'ChatGPT granted too little time to finish this request. Sign in again.',
    retry: 'ChatGPT is temporarily unavailable. Try again.',
    // M95b: plan billing, allowance recovery and Copilot's required content note.
    chatGptMark: 'Using ChatGPT plan',
    providerMark: 'Using {provider} plan',
    manage: 'Manage usage',
    noticeTitle: 'You’re using your ChatGPT plan',
    noticeDetail: 'ChatGPT Plus/Pro requests share your allowance; they add none.',
    credits:
      'Apps may spend credits after plan limits if enabled. Check ChatGPT’s Manage usage settings.',
    understood: 'Got it',
    limitTitle: 'ChatGPT plan usage limit reached',
    limitDetail:
      'Wait for a reset or choose an API-key model. Reset time is unknown. You choose billing changes.',
    chooseModel: 'Choose another model',
    usageHeading: 'Plan usage',
    usageDetail:
      'Plan allowance or credits pay, outside this app’s dollar cap. Quota and reset time are unknown.',
    requests: 'Requests',
    reportedTokens: 'Reported tokens',
    estimatedTokens: 'Estimated tokens',
    unknownTokens: 'Unknown tokens (requests)',
    // {input}, {output}, {requests}: localized counts, including the sampled requests.
    tokenCounts: '{input} input · {output} output · requests: {requests}',
    reduced: 'Reduced',
    aiContent:
      'AI content can be inaccurate. Copilot adds rules and uses AI credits. Unreported token usage is estimated.',
    reportContent: 'Report harmful content',
  },
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
  // macOS binds Cmd+Esc; Windows binds Ctrl+Alt+Esc (Ctrl+Esc opens Start
  // there; M26, D29).
  composerPlaceholder:
    'ctrl esc (cmd esc on macOS, ctrl alt esc on Windows) to focus or unfocus Muse',
  // Shown while a turn runs: Enter then steers the running turn.
  composerQueuePlaceholder: 'Queue another message…',
  queuedLabel: 'Queued',
  queuedMenuLabel: 'Queued message actions',
  queuedEdit: 'Edit',
  queuedEditTitle: 'Take the message out of the queue and back into the prompt box',
  queuedDelivered: 'Already delivered to the running turn',
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
  messageSentAt: 'Sent {time}',
  messageReceivedAt: 'Received {time}',
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
    importSession: 'Resume an exported session file on the Model API backend.',
    review: 'Ask Muse to review your changes, or what you describe.',
    reviewUncommitted: 'Muse reviews your staged and unstaged changes.',
    reviewBranch: 'Muse reviews this branch against a base branch you pick.',
    reviewCommit: 'Muse reviews one recent commit you pick.',
    reviewSecurity: 'Muse checks your uncommitted changes for security problems.',
    reviewChanges: 'Accept or revert each edit this conversation made.',
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
  agentImportSourceTitle: 'Import from',
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
  // Hooks from every popular agent (M91, PLAN.md D70): the new sources.
  agentImportSourceGemini: 'Gemini CLI',
  agentImportSourceCopilot: 'Copilot and VS Code',
  agentImportSourceWindsurf: 'Windsurf',
  agentImportSourceKiro: 'Kiro',
  agentImportSourceCline: 'Cline',
  agentImportSourceAmp: 'Amp',
  agentImportSourceOpenCode: 'OpenCode',
  agentImportSourceEvery: 'All of them',
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
  hooksItemDetail:
    'Inspect project, user, managed and spark-hooks.json hook sources for the selected backend.',
  mcpTitle: 'Muse Code MCP servers',
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
  // Shared resources (M96 lane B, D75): the registry, the leases and the bridge.
  teamResourcesTitle: 'Tools and devices',
  teamResourcesDetail: 'Which MCP servers and devices the team shares, and who may use them',
  teamResourcesKindLabel: 'Kind',
  teamResourcesKindExclusive: 'Exclusive',
  teamResourcesKindExclusiveDetail:
    'One at a time: a browser, a device or a fixed port. Calls wait for the lease.',
  teamResourcesKindShared: 'Shared',
  teamResourcesKindSharedDetail: 'Up to its limit at once. Further calls wait in its queue.',
  teamResourcesKindFree: 'Free',
  teamResourcesKindFreeDetail: 'No lease. Any worker calls it any time.',
  teamResourcesRolesLabel: 'Roles that may use it',
  // {count}: the shared resource's concurrency limit, a number.
  teamResourcesLimitLabel: 'At most {count} at once',
  // {role}: the holding role's name; {taskId}: the holding task's id.
  teamResourceBusy: 'resource busy, held by {role} task {taskId}',
  teamToolBindingChanged:
    'The tool or its permissions changed while waiting, or its lease is no longer held. The call was refused; list the tools again before retrying.',
  teamLeaseTakeBack: 'Take back',
  teamLeaseTakeBackDetail:
    'The lease moves to the orchestrator; the holder’s next call is told the resource is busy.',
  teamLeaseRestartServer: 'Restart server',
  teamLeaseRestartServerDetail:
    'Ends the server the window started; the lease is released once its process has exited.',
  teamLeaseReleaseAnyway: 'Release anyway',
  teamLeaseReleaseAnywayDetail:
    'Releases the lease as your decision. The earlier call may still be acting on the resource.',
  // {server}: the exclusive server's name.
  teamLeaseElsewhereTitle: 'Another window runs {server}',
  // {window}: the other window's name; {server}: the exclusive server's name.
  teamLeaseElsewhereDetail:
    '{window} is using {server}. Starting it here too can take it from that window.',
  teamLeaseStartAnyway: 'Start here anyway',
  teamLeaseWait: 'Wait',
  teamLeaseOpenWindow: 'Open that window',
  // {server}: the exclusive server's name.
  teamMoveToBridgeDetail:
    'Remove {server} from Muse Code’s settings file (the extension never writes it), and add it to the extension’s own MCP configuration, where the bridge serves it to every worker.',
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
  // Hooks from every popular agent (M91, PLAN.md D70). The Hooks picker's
  // rows for spark-hooks.json, the extension's own hook file, which Muse Code
  // never reads.
  hooksSparkProject: 'Extension hooks for this project',
  hooksSparkProjectFile: '.muse/spark-hooks.json',
  hooksSparkProjectNone: 'This workspace has no .muse/spark-hooks.json.',
  hooksSparkUser: 'Your extension hooks',
  hooksSparkUserNone: 'You have no spark-hooks.json.',
  // {file}: the file's name or path.
  hooksSparkCount: forms({
    one: '{count} hook in {file}',
    other: '{count} hooks in {file}',
  }),
  hooksSparkAbout:
    'Muse Code never reads this file. It holds the events only this extension runs, and hooks imported from other agents.',
  // Which backend runs a file's hooks, under its row.
  hooksBackendMuseCode: 'Run by Muse Code',
  hooksBackendBoth: 'Run by Muse Code, and by this window on the Model API backend',
  hooksBackendSpark:
    'Run by this window: on the Model API backend, and on both backends for the events the extension itself handles',
  hooksFormatModelApiOnly: 'Hooks in another agent’s format run only on the Model API backend.',
  // {format}: the source agent's name, such as Cursor.
  hooksFormatTag: '{format} format',
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
  hookMessageEdited: 'Edited by a hook',
  hookMessageShowOriginal: 'Show the original',
  hookMessageShowEdited: 'Show the hook’s version',
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
  // M71 (PLAN.md D49): git and pull requests, conversations in a worktree.
  groupGit: 'Git and pull requests',
  gitCommitItem: 'Commit…',
  gitCommitItemDetail:
    'Commit the changes in this workspace; a message is written only when you ask',
  gitPushItem: 'Push…',
  gitPushItemDetail: 'Push this branch; always asks, never forces',
  gitPullRequestItem: 'Open a pull request…',
  gitPullRequestItemDetail: 'On GitHub, as a draft or ready, linked to this conversation',
  gitCheckoutItem: 'Open a pull request in a conversation…',
  gitCheckoutItemDetail: 'Check a pull request out in its own worktree and window',
  gitRestricted:
    'Git and pull requests are unavailable in Restricted Mode: git can run programs a repository’s configuration names. Trust the workspace to use them.',
  gitHeld: 'Git and pull requests wait until you trust this worktree in the card above.',
  gitUnavailable: 'VS Code’s Git is not available here',
  gitExtensionMissing: 'VS Code’s built-in Git extension is not available in this window.',
  gitExtensionDisabled: 'VS Code’s Git is turned off (git.enabled).',
  gitNoRepository: 'This workspace is not in a git repository that VS Code’s Git has open.',
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
  gitFileStaged: 'staged',
  gitFileUnstaged: 'not staged',
  gitMoreFiles: forms({ one: 'and {count} more file', other: 'and {count} more files' }),
  gitMessageLabel: 'Commit message',
  gitIncludeUnstaged: 'Include unstaged changes and new files',
  gitGenerate: 'Write with Muse',
  gitGenerateTitle: 'Asks the model in this conversation, as your own message',
  gitGenerating: 'Writing…',
  gitCommitAction: 'Commit',
  gitCommitConfirm: 'Commit these changes?',
  gitOperationChanged: 'Repository, conversation or trust changed. Open the form again.',
  gitCommandConsequences:
    'Git may run repository hooks, signing programs or credential helpers. Cancellation stops later steps; a Git or GitHub call already started may finish.',
  gitCommitting: 'Committing…',
  gitCancel: 'Cancel',
  gitPullRequestFormLabel: 'Pull request',
  gitPrTitle: 'Pull request on {repository}',
  gitPrRemote: 'Remote',
  gitPrHead: 'Branch',
  gitPrBase: 'Into',
  gitPrTitleLabel: 'Title',
  gitPrBodyLabel: 'Description',
  gitPrDraft: 'Open as a draft',
  gitPrMasked: 'Credential-shaped text is masked before anything is sent.',
  gitPrCreate: 'Create pull request',
  gitPrCreateDraft: 'Create draft pull request',
  gitPrPushFirst: 'The branch goes to {remote} first, a first push; you will be asked.',
  gitPrPushCommits: forms({
    one: '{count} commit goes to {remote} first; you will be asked.',
    other: '{count} commits go to {remote} first; you will be asked.',
  }),
  gitPrBehind: 'The branch is behind its upstream: the pull request shows what is already pushed.',
  gitPullRequestLabel: 'This conversation’s pull request',
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
  gitChecksNotRead: forms({ one: '{count} more not read', other: '{count} more not read' }),
  gitStatusNeedsSignIn: 'Sign in to GitHub to see its status.',
  gitCheckedAt: 'as of {time}',
  gitSignInGitHub: 'Sign in to GitHub',
  gitRefresh: 'Refresh',
  gitOpenOnGitHub: 'Open on GitHub',
  gitWorktreeBranch: 'Worktree on {branch}, of {repository}',
  gitWorktreePullRequest: 'Worktree of pull request #{number}, of {repository}',
  worktreeHoldLabel: 'Held pull request worktree',
  worktreeHoldTitle: 'Someone else’s code: held until you trust it',
  worktreeHoldPullRequest: 'Pull request #{number} by {author}: held until you trust it',
  worktreeHoldDetail:
    'This conversation stays in Plan mode, and this worktree’s project rules, skills, hooks and MCP servers stay off, until you trust the worktree here. VS Code’s own trust does not change that.',
  worktreeHoldRestricted:
    'VS Code also opened this folder in Restricted Mode, which applies as well.',
  worktreeHoldOtherExtensions:
    'Other extensions follow VS Code’s own workspace trust, which Muse Spark cannot lower.',
  worktreeTrustButton: 'Trust this worktree…',
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
  openPullRequestTitle: 'Open a pull request in a conversation',
  openPullRequestPlaceholder: 'A number, like 51, or the pull request’s GitHub address',
  openPullRequestInvalid: 'Type a pull request number, or its github.com address.',
  openPullRequestNoRemote:
    'There is no GitHub remote to read the pull request from (upstream, the tracked one, origin, or the only one).',
  openPullRequestOtherRepository: 'No remote of this repository points at {repository}.',
  openPullRequestConfirm: 'Open pull request #{number} in a new window?',
  openPullRequestBy: 'By {author}',
  openPullRequestBranches: 'From {head} into {base}',
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
  openPullRequestTooLarge:
    'The pull request is larger than a held checkout writes (at most {files} files and folders, {size} in all). Nothing was checked out.',
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
  compactDetail: 'Summarise older context to free the window',
  clearItem: '/clear',
  logoutItem: '/logout',
  openLog: 'Open output log',
  // M113 / D93: regional report table until M102 supplies separate families.
  reportShowCommand: 'Show report…',
  reportShowItem: 'Show report…',
  reportSlashDescription:
    'Generate a deterministic report from named sources, without a model call.',
  reportUsageAction: 'Usage report',
  reportLabels: {
    needsYou: 'Needs you',
    releases: 'Releases',
    milestones: 'Milestones',
    lanes: 'Lanes',
    pullRequests: 'Pull requests',
    ci: 'Continuous integration',
    usage: 'Usage',
    risks: 'Risks',
    nextSteps: 'Next steps',
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
    releaseRecord: 'Release record',
    totals: 'Totals',
    breakdown: 'Breakdown',
    limits: 'Limits',
    model: 'Model',
    backend: 'Backend',
    turns: 'Turns',
    tokens: 'Tokens',
    inputTokens: 'Input tokens',
    outputTokens: 'Output tokens',
    cachedTokens: 'Cached tokens',
    cost: 'Cost',
    tools: 'Tools',
    files: 'Files',
    approvals: 'Approvals',
    checks: 'Checks',
    paidUses: 'Paid uses',
    commits: 'Commits',
    agents: 'Agents',
    workers: 'Workers',
    devices: 'Devices',
    nodes: 'Nodes',
    vault: 'Vault',
    grants: 'Grants',
    denials: 'Denials',
    locks: 'Locks',
    developerAudit: 'Developer audit',
    accounts: 'Accounts',
    swaps: 'Swaps',
    confirmations: 'Confirmations',
    criticalPath: 'Critical path',
    limitingResource: 'Limiting resource',
    setups: 'Setups',
    inputs: 'Inputs',
    calibration: 'Calibration',
    decisions: 'Decisions',
    drills: 'Drills',
    disabledRules: 'Disabled rules',
    refusals: 'Refusals',
    issues: 'Issues',
    timeline: 'Timeline',
    schedules: 'Schedules',
    fires: 'Fires',
    keybindings: 'Key bindings',
    conflicts: 'Conflicts',
    diff: 'Difference',
    sources: 'Sources',
    planFormat: 'Plan format',
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
    observedAt: 'Observed at',
    reason: 'Reason',
    ok: 'Available',
    partial: 'Partial',
    unavailable: 'Unavailable',
    notApplicable: 'Not applicable',
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
    superseded: 'Superseded',
    waiting: 'Waiting',
    blocked: 'Blocked',
    inReview: 'In review',
    inProgress: 'In progress',
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
    playbook: 'Engineering playbook',
    issues: 'Issues',
    schedules: 'Schedules',
    keybindings: 'Key bindings',
  },
  reportUi: {
    invalidArguments: 'Invalid report arguments. Choose a report kind and its scope.',
    problem: 'Report a problem…',
    scope: 'Enter the milestone id or release version.',
    historyRequired: 'Save this report in history before comparing it.',
    format: 'Format',
    show: 'Show report…',
    description: 'Generate a deterministic report from named sources, without a model call.',
    usageAction: 'Usage report',
    title: 'Reports',
    saveAs: 'Save as…',
    copyMarkdown: 'Copy as Markdown',
    attach: 'Attach to message',
    history: 'History',
    diffPrevious: 'Diff with previous',
    refresh: 'Refresh',
    noChange: 'No change since {asOf}',
    unavailableReason: 'Unavailable: {reason}',
    rateLimitedUntil: 'Rate-limited until {time}',
    sourceFile: 'Source: {file}',
    lastReport: 'Last report: {age}',
    footer: 'Renderer {version}; ICU {icu}; locale {locale}',
    notFound: 'Not found: {id}. Nearest matches: {nearest}',
    generationFailed: 'The report could not be generated.',
    noHistory: 'No report history yet.',
    networkOff: 'Report network sources are off.',
    signInRequired: 'Sign in to GitHub to read this source.',
    noPlan: 'This project has no structured plan.',
    planDrift: 'Plan format at line {line}: {detail}',
    automatedNote: 'This report was generated automatically.',
    post: 'Post',
    previewPost: 'Preview the full report before posting.',
    reportAction: 'Action: Report',
    verificationMessage: 'Your report email verification code is {code}.',
    nameTemplate: 'File name template',
    retention: 'Reports to keep',
    verifyRecipient: 'Verify recipient',
    saveDestination: 'Save to folder',
    browserDestination: 'Open in browser',
    emailDestination: 'Email to you',
    openWhenBack: 'Open when I’m back',
    recipientUnverified: 'Verify this recipient before sending.',
    tlsRequired: 'Email requires TLS with a valid certificate.',
    deliveryLimit: 'The delivery limit has been reached.',
    saved: 'Report saved to {path}',
    copied: 'Report copied.',
    attached: 'Report attached to the message.',
    saveFailed: 'The report could not be saved.',
    copyFailed: 'The report could not be copied.',
    unsupportedKind: 'Report kind {kind} is not available yet.',
    localBudgetExceeded: 'The local report exceeded {duration}.',
    confirmFirstSend: 'Confirm the first email to this recipient.',
    destinations: 'Destinations',
    recipient: 'Recipient',
    verifyCode: 'Verification code',
    allowList: 'Recipient allow-list',
    schedule: 'Schedule report…',
    cloud: 'Save to cloud',
    sms: 'Text message',
    privateLink: 'Private link',
    paidSms: 'Text messages cost {price} each. Shared daily budget: {budget}.',
    generatedAsOf: 'Generated as of {asOf}',
  },
  reportSourceReasons: {
    missing: 'The source file or repository is missing.',
    invalid: 'The source has an unsupported format or invalid data.',
    limit: 'The source exceeds the report read limit.',
    cancelled: 'The source read was cancelled or timed out.',
    failed: 'The source could not be read completely.',
    refused: 'The source path is private or outside its allowed folder.',
    disabled: 'This agent usage source is not enabled.',
    unbound: 'This source integration is not available yet.',
    history: 'History for the selected session is unavailable.',
  },
  reportRowsMore: forms({ one: '{count} more', other: '{count} more' }),
  reportCliUsage:
    'Generate a deterministic report from named sources, without a model call.\n  {command} report <kind> [args] [--format md|html|json|text] [--out <file>]\n  [--as-of <ISO>] [--lang <locale>] [--network] [--from <file.json>]\n  [--diff previous|<file.json>] [--full] [--strict] [--fail-on <conditions>]\n  {command} report history\n  {command} report problem\n',
  reportIssue: 'Report an issue…',
  // Report a problem (M93, PLAN.md D72): the crash offer, the report
  // dialog's labels and actions, and the export outcomes. The preview shows
  // exactly what Copy, Save and the issue page carry.
  reportCrashOffer: 'Muse Spark Code stopped unexpectedly last time — report it?',
  reportCrashAction: 'Report a problem',
  reportCrashDismiss: 'Not now',
  reportThisAction: 'Report this',
  reportTitle: 'Report a problem',
  reportDescriptionLabel: 'What were you doing when it happened?',
  reportIncludeFacts: 'Include support facts',
  reportIncludeEvents: 'Include recent events',
  reportPreviewLabel: 'Preview',
  reportCopyAction: 'Copy report',
  reportOpenIssueAction: 'Open issue page',
  reportSaveAction: 'Save to a file',
  reportVscodeReporterAction: 'Use the VS Code issue reporter',
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
  reportItemsLabel: 'What this report contains',
  reportRemoveItem: 'Remove {item}',
  reportFactsItem: 'Support facts',
  reportEventItem: '{kind} · {age}',
  reportUpdating: 'Updating the preview…',
  reportStaleDraft:
    'The report changed while exporting. The preview below is current — export again.',
  reportIssueOpened: 'The issue page was opened in the browser.',
  reportIssueOpenFailed: 'The issue page could not be opened. Copy the report instead.',
  reportVscodeReporterOpened: 'The VS Code issue reporter was opened.',
  reportVscodeReporterFailed: 'The VS Code issue reporter could not be opened.',
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
  modelAttachmentUnsupported: 'This model does not support this attachment.',
  providerCapabilityUnsupported: 'Selected model does not support these request settings.',
  modelAttachmentOverLimit: "This attachment exceeds the model's limits.",
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
  browserRuntimeNotNow: 'Not now',
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
    'The browser check is not available on this computer. It supports Windows x64, Linux x64 and macOS.',
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
  showMore: 'Show more',
  showLess: 'Show less',
  loadingOutput: 'Loading…',
  surfaceLoadFailed: 'This panel could not load.',
  surfaceLoadRetry: 'Try again',
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
  /**
   * A browser check on the Model API backend (M81): {action} is the URL. The
   * second when its host is beyond loopback and the setting: allowing it
   * widens the check to that host.
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
  // M112: the attention dock, durable open questions and late answers.
  questionOpen: 'Open question',
  questionNoLongerOpen: 'No longer open',
  questionDeferred: 'Deferred',
  questionAnsweredLater: 'Answered later',
  questionAnsweredOnReask: 'Answered when asked again',
  questionDeclined: 'Declined',
  questionDismissed: 'Dismissed',
  questionExpired: 'Expired',
  questionAnswer: 'Answer',
  questionDismiss: 'Dismiss',
  questionExpand: 'Expand question',
  questionCollapse: 'Collapse question',
  questionNextOpen: 'Next open question',
  questionPreviousOpen: 'Previous open question',
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
  openQuestionsTabCount: forms({ one: '{count} open', other: '{count} open' }),
  clarifyNotAccepted: 'The explanation was not accepted',
  /** Replying to an output and quoting a highlighted passage (M17). */
  messageActions: 'Message actions',
  rowMoreActions: 'More actions',
  rowRewindGroup: 'Rewind',
  rowOpenOutput: 'Open output',
  // An edit row's Revert (M87, D66 item 17): its label, and the confirmation before it writes.
  rowRevertEdit: 'Revert',
  revertEditConfirmTitle: 'Revert this edit?',
  revertEditConfirmDetail:
    'The lines this edit changed are put back as they were. A file where those lines changed since is left as it is and named. Later edits, and what commands changed, are not undone.',
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
  todoProgress: '{done} of {total} done',
  todoOpenInTab: 'Open in a tab',
  todoOpenInTabTitle: 'Open the task list in an editor tab, which you can move into its own window',
  tasksTabTitle: 'Tasks: {conversation}',
  tasksTabMoveToWindow: 'Move into new window',
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
  diffTallyFiles: forms({
    one: '{count} file changed',
    other: '{count} files changed',
  }),
  diffTallyLines: '+{added} −{removed}',
  diffTallyLabel: 'Changes in this conversation',
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
  // Tokens hooks added, never netted against the savings (M91, SoL-Pi rule 6).
  usageAddedByHooks: 'Added by hooks (estimate)',
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
  // {wait}: the Retry-After the provider asked for, in seconds; {cap}: the
  // wait past which a request fails at once instead of waiting it out.
  modelApiRetryAfterTooLong:
    'The provider asked to wait {wait} s before retrying, past the {cap} s limit, so the request was not retried.',
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
  // The vault scrubber is locked (or its build refused): the turn reason and
  // the export notice name the outage instead of failing silently (RVM109T 7).
  vaultScrubUnavailable: 'Vault scrub service is unavailable',
  vaultSessionLogUnavailable: 'Vault-safe session log export is unavailable',
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
  // A BYO model whose provider or route may train on the content, refused
  // where the workspace forbids it (M95, PLAN.md D74).
  trainingBlocked:
    'Models that may train on workspace content are blocked in this workspace (museSpark.confidentialWorkspace).',
  backendItem: 'Backend',
  backendDetail: 'museSpark.backend: auto / museCode / modelApi',
  backendMuseCode: 'Muse Code (your Muse subscription)',
  backendModelApi: 'Meta Model API (your key, pay as you go)',
  modelApiBackendNotice:
    'This conversation runs on the Meta Model API with the extension’s own tools (read, edit, write, search, list, shell). Its sessions are kept in this workspace’s extension storage.',
  installOrKeyDetail:
    'The Muse Code CLI hosts conversations for this extension; without it you can still use a Meta Model API key.',
  compactionDone: 'Context compacted',
  autoCompactionAwaitingEvaluation: 'Automatic compaction is awaiting evaluation and is inactive.',
  autoCompactionFailed: 'Automatic compaction failed; continuing with the original context.',
  contextWindowFull: 'Context window full: /compact or /handoff',
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
  sandboxOffProfileWarning:
    "Muse Code's Windows sandbox cannot reliably run commands in a workspace under your user profile, so this window runs Muse Code without its OS sandbox. Its file tools can then write anywhere your account can, outside this workspace too, without asking in any mode, Plan included, and its commands run directly as you, with your network. Approval still covers its commands and writes to .git, .muse and .agents. A workspace outside your user profile keeps the sandbox. Setting: museSpark.shellSandbox.",
  sandboxOffSettingWarning:
    'museSpark.shellSandbox is off, so Muse Code runs without its OS sandbox in this window. Its file tools can then write anywhere your account can, outside this workspace too, without asking in any mode, Plan included, and its commands run directly as you, with your network. Approval still covers its commands and writes to .git, .muse and .agents.',
  sandboxPreparingNotice:
    "Muse Code's Windows sandbox is still being prepared, so this command did not run. After its setup, Muse Code gives the sandbox read access to your files once, in the background, and that can take a while on a large user profile. Try again in a few minutes. Setting: museSpark.shellSandbox.",
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
  agentActivities: { active: 'Active', waiting: 'Waiting', inactive: 'Inactive' },
  agentOutcomes: {
    complete: 'Complete',
    incomplete: 'Incomplete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    unverified: 'Ended, unverified',
  },
  agentWaitingReasons: {
    approval: 'approval',
    input: 'input',
    queued: 'queued',
    interrupted: 'interrupted',
    idle: 'no recent activity',
  },
  agentStopReasons: {
    normal: 'Normal end',
    budget: 'Budget exhausted',
    error: 'Error',
    cancelled: 'Stopped by user',
    unknown: 'Unavailable',
  },
  agentContinue: 'Continue',
  agentRetry: 'Retry',
  agentReceipt: 'Agent receipt',
  agentReceiptFiles: 'Changed files',
  agentReceiptChecks: 'Commands and checks',
  agentReceiptStop: 'Stop reason',
  agentReceiptUnfinished: 'Unfinished items',
  agentReceiptHistory: 'Attempt history',
  agentReceiptUnavailable: 'This backend did not provide this evidence.',
  agentReceiptTruncated: 'The receipt reached its size limit; some evidence is omitted.',
  agentRecoveryConfirm: '{action}: {objective}? The current permissions and budgets apply.',
  agentRetryUnavailable:
    'Retry is unavailable: this backend provides no isolated worktree checkpoint. Shared workspace changes are kept.',
  agentContinueUnavailable: 'Continue is unavailable for this agent or its current state.',
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
    waitingApproval: 'Waiting for approval',
    attemptRunning: 'Attempt running',
    attemptRetiring: 'Attempt retiring',
    attemptRetired: 'Attempt retired',
    attemptUncertain: 'Attempt uncertain',
    attemptInterrupted: 'Attempt interrupted',
    diverging: 'Diverging',
    flaky: 'Flaky check',
    notReviewed: 'Not reviewed',
    sameModelReview: 'Same-model review',
    priority: 'Priority',
    writeSet: 'Write-set',
    resources: 'Resources',
    diskUse: 'Disk use',
    queuePosition: 'Queue position {position}: {reason}',
    workerCount: forms({ one: '{count} worker', other: '{count} workers' }),
    machineLoad: forms({
      one: '{count} window runs {workers} on this machine.',
      other: '{count} windows run {workers} on this machine.',
    }),
    board: 'Task board',
    lanes: 'Lanes',
    leases: 'Leases',
    otherWindows: 'Other windows',
    recovery: 'Recovery',
    conflicts: 'Predicted conflicts',
    mergeQueue: 'Merge queue',
    metrics: 'Metrics',
    noTasks: 'No tasks on the board',
    pauseQueue: 'Pause queue',
    resumeQueue: 'Resume queue',
    runNext: 'Run next',
    hold: 'Hold',
    release: 'Release',
    reassign: 'Reassign…',
    handOffAnyway: 'Hand off anyway',
    continueAnyway: 'Continue anyway',
    restartTeamHost: 'Restart the team host',
    cancel: 'Cancel task',
    serialize: 'Serialize',
    letBothRun: 'Let both run',
    openWindow: 'Open that window',
    takeBack: 'Take back',
    pause: 'Pause',
    retry: 'Retry',
    remove: 'Remove',
    landNow: 'Land now',
    landWithoutChecks: 'Land without checks',
    undoBatch: 'Undo batch',
    cleanup: 'Clean up',
    apply: 'Apply',
    openTerminal: 'Open a terminal here',
    recover: 'Recover',
    stop: 'Stop process',
    keep: 'Keep',
    showTerminal: 'Show in a terminal',
    takeOver: 'Take over',
    newTask: 'Continue here as a new task',
    includeEdits: 'Include its uncommitted edits',
    hostBusy: 'Host busy',
    exclusiveWriter: 'Exclusive writer',
  },
  teamTrafficDetails: {
    changedSinceOpened:
      'This work changed since you opened it. Review the current state and try again.',
    freeSlots: 'Free slots',
    processWorkers: 'Process workers',
    heavyCommands: 'Heavy commands',
    raiseLimit: 'Raise a limit…',
    resume: 'Resume task',
    discard: 'Discard task',
    restartServer: 'Restart server',
    releaseAnyway: 'Release anyway',
    waiting: 'Waiting',
    checking: 'Checking batch',
    serial: 'Serial admission',
    returned: 'Candidate sent back',
    admitted: 'Admitted',
    matched: 'Matched',
    uncertain: 'Uncertain',
    staleHint: 'Stale hint',
    advisoryExceeded: 'The advisory total exceeds this window’s worker cap.',
    ownerMayBeLive: 'Another window may still own this work. Taking over can break its task.',
    predictedRate: 'Predicted conflicts per writing task',
    mergeRate: 'Merge conflicts per landing',
    reviewRounds: 'Review rounds after the first',
    reassignments: 'Reassignments',
    candidatesReturned: 'Candidates sent back',
    runnerInvalid: 'Check the runner fields. Credentials and SSH options are not allowed.',
    runnerId: 'Runner ID',
  },
  teamStallReasons: {
    noProgress: 'No progress',
    outOfSteps: 'Request limit reached',
    rateLimited: 'Rate limited',
    usageLimited: 'Usage limit reached',
    providerDown: 'Provider unavailable',
    crashed: 'Worker crashed',
  },
  teamSharedFileKinds: { text: 'Plain text', 'json-table': 'JSON table', changelog: 'Changelog' },
  teamTaskSizes: { S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra large' },
  teamTaskStates: {
    queued: 'Queued',
    ready: 'Ready',
    running: 'Running',
    blocked: 'Blocked',
    review: 'In review',
    merge: 'Awaiting merge',
    merged: 'Merged',
    done: 'Done',
    discarded: 'Discarded',
    failed: 'Failed',
    cancelled: 'Cancelled',
    redesign: 'Needs redesign',
    waitingApproval: 'Waiting for approval',
    waitingForYou: 'Waiting for you',
    capped: 'Capped',
    interrupted: 'Interrupted',
    notStaffed: 'Not staffed',
  },
  teamPriorities: {
    urgent: 'Urgent',
    high: 'High',
    normal: 'Normal',
    low: 'Low',
  },
  teamSchedulerSettings: {
    integrationFlow: 'Integration flow',
    full: 'Full',
    reviewAutomatically: 'Review automatically',
    manual: 'Manual',
    onStall: 'When a task stalls',
    reassign: 'Reassign',
    ask: 'Ask',
    stop: 'Stop',
    sharedFiles: 'Shared files',
    dependencyInstallation: 'Dependency installation',
    checkSlots: 'Check slots',
    perCopy: 'Each working copy',
  },
  teamTrafficMetrics: {
    utilisation: 'Lane utilisation',
    queueDepth: 'Queue depth',
    waitMedian: 'Median wait',
    waitP90: '90th percentile wait',
    conflictRate: 'Conflict rate',
    reworkRate: 'Rework rate',
    costPerMerge: 'Cost per merged change',
    timeToMerge: 'Time to merge',
    estimated: 'Estimated',
    reported: 'Reported',
    today: 'Today',
    week: 'This week',
    allTime: 'All time',
  },
  teamRunners: {
    title: 'Runners',
    add: 'Add runner…',
    testAll: 'Test runners',
    test: 'Test runner',
    destination: 'SSH destination',
    port: 'SSH port',
    os: 'Operating system',
    workFolder: 'Work folder',
    maxJobs: 'Maximum jobs',
    labels: 'Labels',
    commandClasses: 'Command classes',
    tests: 'Tests',
    builds: 'Builds',
    typeChecks: 'Type checks',
    declared: 'Declared commands',
    setupCommand: 'Setup command',
    cacheKey: 'Cache key',
    environmentNames: 'Environment names',
    online: 'Online',
    offline: 'Offline',
    busy: 'All slots busy',
    testFailed: 'Runner self-test failed',
    commandTooLong:
      'The Windows runner command exceeds the process command-line limit. Shorten the setup command or check.',
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
  // The team tree and cards (M96 lane U2): the Agent map's team tree, the
  // delegation, switch, waiting-for-you and merge cards, the worker label's
  // group excluded (it splices technical names), and the Usage Team section.
  teamTreeLabel: 'Team',
  teamWorkerMerged: 'merged',
  teamWorkerDiscarded: 'discarded',
  teamRunningOf: '{used} of {amount} running',
  teamWorkerFinished: 'Team task {task}: {status}.',
  teamTreeKeyboardHint:
    'Use arrow keys to move. F2 focuses actions; Left and Right choose an action; Escape returns to the item.',
  teamMergeAffectedFiles: 'Affected files',
  teamMergeProtectedPaths: 'Protected paths',
  teamMergeConflictPaths: 'Conflict paths',
  teamMergeDetailsMissing:
    'File details are unavailable. Review the diff before requesting a new merge card.',
  teamMergeReviewVerdict: 'Review verdict',
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
    ready: 'ready',
    capped: 'capped',
    rateLimited: 'rate limited',
    usageLimited: 'at usage limit',
    unavailable: 'unavailable',
  },
  teamCapUsed: '{used} of {amount}',
  teamEstimated: 'estimated',
  teamOpenTranscript: 'Open transcript',
  teamReviewDiff: 'Review diff',
  teamMergeAction: 'Merge',
  teamDiscardAction: 'Discard',
  teamResetEntry: 'Reset',
  teamEditRole: 'Edit in Roles section',
  teamStopAll: 'Stop all team tasks',
  teamQueuedGroup: 'Queued',
  teamUnmergedGroup: 'Unmerged',
  teamInterruptedGroup: 'Interrupted',
  teamTasksCount: forms({ one: '{count} team task', other: '{count} team tasks' }),
  teamPlanTitle: 'Delegation plan',
  teamPlanDelegated: 'Delegated',
  teamPlanKept: 'Kept by the main agent',
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
  teamWaitingTitle: 'Waiting for you',
  teamWaitingQueue: 'Queue it',
  teamWaitingSelf: 'Main agent does it',
  teamWaitingRaise: 'Raise a limit…',
  teamWaitingCancel: 'Cancel',
  teamMergeTitle: 'Merge',
  teamMergeNotReviewed: 'Not reviewed',
  teamMergeSameModel: 'Reviewed by the same model',
  teamMergeBranchMoved: 'The branch moved during the task.',
  teamMergeConflict: 'Conflicts need resolving before merge.',
  teamReportTitle: 'Report',
  teamUsageTitle: 'Team',
  teamUsageToday: 'Today',
  teamUsageWindow: 'This window',
  teamUsageTasks: 'Tasks',
  teamUsageTokens: 'Tokens',
  teamUsageCost: 'Cost',
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
  sandboxProfileNotice: String.raw`This workspace is under your user profile, where Muse Code's Windows sandbox may not run commands: they can start in the PowerShell folder instead of the project, or never finish. File reads and edits are unaffected. A workspace outside C:\Users runs commands in place.`,
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
  // backend has no safety-check judge behind Auto either; its paid Auto
  // reviewer (M78) checks commands no rule settles while it is on
  // (modelApiReviewedAutoDetail).
  permissionModeDetails: {
    manual: 'Muse will ask before running commands; Muse Code edits workspace files without asking',
    acceptEdits:
      'On Muse Code, the same as Manual: Muse Code edits workspace files without asking and asks before running commands',
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
    xhigh: 'Extra high',
    max: 'Max',
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
    // The browser check on the Model API backend and for Muse Code (M81).
    browser_check: 'Browser check',
    mcp__ide__browserCheck: 'Browser check',
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
  whatsNewTryIt: 'Try it',
  whatsNewOpenSetting: 'Open the setting',
  whatsNewNotesInEnglish: 'The release notes are in English.',
  whatsNewNoNotes: 'No release notes ship with version {version}.',
  whatsNewFullChangelog: 'Full changelog on GitHub',
  whatsNewReadme: 'README on GitHub',
  whatsNewStarGithub: 'Enjoying Muse Spark Code? A star on GitHub helps other people find it.',
  whatsNewHideOnUpdate: 'Don’t show on updates',
  whatsNewUpdatedNotice: 'Muse Spark Code updated to {version}.',
  whatsNewOpen: 'What’s New',
  whatsNewDontShowAgain: 'Don’t show again',
  whatsNewUnavailable:
    'What’s New could not be loaded; reinstall the extension and reload the window. The log has the details.',
  // The conversation's notices (they were English literals in the controller).
  notSignedInReason: 'Sign in before sending a message.',
  noWorkspaceReason: 'Open a folder first; Muse works inside a workspace.',
  nothingToSendReason: 'Type a message or attach an image first.',
  // M92e (PLAN.md D71): a prompt holding a detected secret, held before
  // sending. The transcript card shows the redacted text either way.
  secretPromptTitle: 'This prompt contains a secret',
  secretPromptDetail:
    'A secret was detected. The transcript shows it redacted. Send it anyway, or go back and edit the prompt.',
  secretPromptSendAnyway: 'Send anyway',
  secretPromptEdit: 'Edit prompt',
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
  acpFontUi: 'UI font',
  acpFontCode: 'Code font',
  acpFontLigatures: 'Code ligatures',
  acpFontSystem: 'System font',
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
    '  {command} providers list|add|test|remove  Manage model providers',
    '  {command} exec [options] <prompt>  Run one headless turn',
    '  {command} scan-secrets <file> [--key-stdin]  Count likely secrets in one file (prints only the number)',
    '  {command} report [options]  Print a scrubbed problem report (starts no backend, opens no browser)',
    '  {command} legal [options]  Run the read-only legal scan (no backend, no sign-in)',
    '  {command} fonts install [--from <directory>]  Install the optional fonts for standalone surfaces',
    '  {command} playbook <status|record|settings ...>  Show or change the orchestrator playbook (starts no backend)',
    'Options:',
    '  --backend museCode|modelApi      Who pays: Muse Code (the default) or the Model API key',
    '  --trust-workspace                Load the folder’s rules, skills and memory',
    '  --muse-binary <path>             The Muse Code CLI to run',
    '  --shell-sandbox auto|muse|off    Muse Code’s shell sandbox',
    '  --questions-defer-after <seconds>  Defer questions after 60 seconds by default; 0 never, 1–9 read as 10, maximum 3600',
    '  --allow-dangerously-skip-permissions  Offer the Bypass permissions mode',
    '  --allow-contributor-models       List contributor-tier models (Meta may train on their content)',
    '  --web-search                     Offer paid web search (Model API backend; its price is asked first)',
    '  --image-generation               Offer paid image generation (Model API backend; its price is asked first)',
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
  execFileEmpty: 'The input file is empty.',
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
  // M95 lane X (PLAN.md D74): the ACP agent's provider commands. Every key
  // below also lives in all 14 `l10n/ui.*.json` tables.
  // {provider}: the provider id; {store}: where the key lives; {origin}: the bound origin.
  providerKeyStored: 'The {provider} key is stored in {store}.',
  providerKeyNotStored: 'No key was entered, so nothing was stored.',
  providerKeyPresent: 'A {provider} key is stored in {store}, bound to {origin}.',
  providerKeyAbsent: 'No {provider} key is stored.',
  providerKeyCleared: 'The {provider} key was removed from this computer’s credential store.',
  // {provider}: the id as typed; {hint}: the key's shape as a hint.
  providerUnknown: 'Unknown provider: {provider}.',
  providerKeyShape: 'That key is not shaped like {provider} keys ({hint}).',
  providerKeyNeeded: '{provider} needs its key from stdin (--key-stdin).',
  providerNotConfigured: '{provider} is not configured; add it with providers add first.',
  providerSecretUnreadable: 'The stored {provider} credential cannot be read; enter the key again.',
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
  providerProbeUnreachable: 'The provider could not be reached.',
  providerProbeUnparseable: 'The model list could not be read.',
  providerProbeNoKey: 'No key was supplied.',
  providerProbeRebinding: 'The address changed networks; the request was refused.',
  providerSaveSecretFailed: 'The credential store operation failed.',
  providerSaveWriteConflict: 'The file could not be written or changed during saving; retry.',
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
  execProviderNeedsModelApi: '--provider needs --backend modelApi.',
  execProviderModelRequired: 'This provider run needs --model provider/model.',
  // {provider}: the provider id the run asked for.
  execProviderNotReady:
    'Provider runs need the provider transport lane; request validation passed for {provider}.',
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
  paidSearchQuote: 'Provider: {provider} · Model: {model}.',
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
  // Team workers billed to a key (M96 lane A, PLAN.md D75): the paid feature,
  // its per-task popup lines and its confirmation. {budget} is the shared
  // daily team budget in the display language's money format.
  paidTeamWorkersName: 'Team workers',
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
    'Team tasks run on models billed to your Model API key. {price} The first delegate call that starts key tasks asks for approval in every permission mode, including Bypass, unless you allow team workers always in this workspace. Subscription and local tasks are not paid uses. Actual cost depends on tokens used; other paid tools cost extra.',
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
  // Inline completions (M94, PLAN.md D73): the paid feature, the
  // once-per-window popup (Q-M94a), the status bar with its menu, the snooze
  // and the Account & usage row. {price} is a dollar amount in the display
  // language's money format.
  paidTabName: 'Tab completions',
  paidConfirmTab:
    'Tab completions send the code around your cursor to Meta as you type, billed to your Model API key. {price} At typical typing that is about $0.80 an hour on Standard and about $0.05 on the contributor model, capped by a daily budget you can change in settings. The contributor model is cheaper, and Meta trains on the code it is sent. Copilot, if on, is yielded to: automatic Tab suggestions pause for its languages unless you run both. Tab asks once per window before its first suggestion.',
  paidUseTabTitle: 'Let Tab suggest in this window?',
  paidUseTabDetail:
    'Tab sends the code around your cursor to Meta’s {model} model, billed to your Model API key at {price}. Today’s budget is {budget}; Tab stops for the day if it is reached. {training} Allow once covers this window until it closes; Allow always in this workspace never asks again here; Deny snoozes Tab in this window.',
  tabTrainingContributor:
    'The contributor model is cheaper, and Meta trains on the code it is sent.',
  // The status bar item while the feature is on; {spend} is today's spend.
  tabStatusSpend: 'Tab {spend}',
  tabStatusTooltip:
    'Tab completions ({model}). {requests} today, {spend} of the {budget} daily budget.',
  // Each state D73 names; {left} is the snooze's remaining time.
  tabStatusSnoozed: 'Tab snoozed ({left} left)',
  tabStatusBudget: 'Tab daily budget reached',
  tabStatusNoKey: 'Tab: no key',
  tabStatusUntrusted: 'Tab off in an untrusted workspace',
  tabStatusLanguageOff: 'Tab off for {language}',
  tabStatusCopilot: 'Tab: on Invoke while Copilot is on',
  // {kind} is the last failure's class, never code or a path.
  tabStatusError: 'Tab failed ({kind})',
  // The status bar menu: turn off, the snoozes, languages, the multi-line
  // mode, Copilot's row and Account & usage.
  tabMenuTurnOff: 'Turn Tab off',
  tabMenuSnoozeShort: 'Snooze for 15 minutes',
  tabMenuSnoozeLong: 'Snooze for an hour',
  tabMenuSnoozeRestart: 'Snooze until restart',
  tabMenuLanguages: 'Tab languages…',
  tabMenuMultiline: 'Multi-line mode…',
  tabMultilineAuto: 'Automatic',
  tabMultilineOnInvoke: 'Only when invoked',
  tabMultilineNever: 'Single-line context only',
  tabMenuUsage: 'Account & usage',
  tabMenuCopilotOff: 'Turn off Copilot’s suggestions for {language}',
  tabMenuRunBoth: 'Run both',
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
  // The prompt and agent hook handlers on the Model API (M91, PLAN.md D70):
  // a paid use under D30 and D48, tallied on their own line.
  paidHookModelName: 'Model hooks',
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
  // M96 (PLAN.md D75): the orchestrator's writing tools wait while an
  // in-place worker task runs, in every mode.
  teamInPlaceOrchestratorRefused:
    'A team worker is writing in this workspace: edits, the shell and merges wait until its task ends.',
  // M96 (PLAN.md D75): a team conversation whose last ready entry went away
  // keeps its tools; from the next turn `delegate` is refused.
  teamSingleModelAgain: 'Only one model is ready: the team applies from a new conversation.',
  teamRunnerUnavailable: '{tool} is unavailable: the team runner has not loaded in this window.',
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
  // M92e (PLAN.md D71): a shell command holding a detected secret. The card
  // shows the value redacted, and no allow rule approves it on its own.
  approvalSecretNote:
    'This command contains a detected secret, shown redacted. It always asks: no allow rule approves it on its own.',
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
  judgeCaution: 'Muse Judge suggests caution. You decide; it cannot approve this action.',
  judgeSubscriptionNotice:
    'Muse Judge uses your chat model on your Muse subscription and counts against its limits. Each batch uses a fresh isolated Plan session. A tool-item guard cancels the session, but cannot prove that no tool ran. It can only add caution.',
  judgeStatusSame: 'Same model',
  judgeStatusOff: 'Off',
  judgeStatusUnavailable: 'Off: source unavailable or standing allow rules',
  judgeStatusConsent: 'Waiting for first-charge consent',
  judgeStatusDeclined: 'Off: paid use declined',
  judgeStatusSlow: 'Off by default: too few results ready at the reviewer fence',
  judgeStatusSubscription: 'Subscription',
  judgeStatusPaid: 'Paid',
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
  thenRunLabel: 'Then ran',
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
  startWithOwnModel: 'Start with your own model',
  startWithOwnModelDetail: 'Add a model provider with an API key and pick a model.',
  // {provider}: the preset's name; {model}: the qualified model reference.
  setupComplete: 'You’re set up with {provider} · {model}',
  manageProviders: 'Manage providers',
  // The Models & Agents panel's framework: its sections, filters and wizard.
  modelsPanelTitle: 'Models & Agents',
  // Shown when the panel's bundle cannot load: an explicit error, never an
  // empty panel.
  modelsPanelUnavailable: 'Models & Agents is not available in this build.',
  providersSectionTitle: 'Providers',
  modelsSectionTitle: 'Models',
  providerSearchPlaceholder: 'Search providers…',
  modelsSearchPlaceholder: 'Search models…',
  // The provider dropdown's filter chips.
  providerFilters: {
    cloud: 'Cloud',
    local: 'On this computer',
    subscription: 'Subscription sign-in',
    aggregator: 'Aggregator',
  },
  scanComputer: 'Scan this computer',
  providersScanning: 'Scanning…',
  providerUntested: 'Not tested',
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
  // The wizard's first step; the quick pick runs the same flow.
  wizardPickProvider: 'Pick a provider',
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
  getKey: 'Get a key',
  enterKey: 'Enter key…',
  // {provider}: the preset's name.
  providerConnect: 'Connect {provider} account',
  providerConnectWaiting: 'Waiting for {provider} in the browser…',
  // The OAuth loopback's callback page, shown in the browser.
  oauthCallbackDone: 'You can close this window and return to VS Code.',
  providerKeyPrompt: '{provider} API key',
  // {provider}: the preset's name. Said under the password box while typing.
  providerKeyInvalid: 'This does not look like a {provider} key.',
  // {origin}: the address the credential is sent to, and no other.
  keyStoredNote: 'Stored in your system keychain; sent only to {origin}.',
  changeKey: 'Change key',
  reconnectAccount: 'Reconnect',
  providerEdit: 'Edit',
  providerRemove: 'Remove',
  testConnection: 'Test',
  saveProvider: 'Save',
  saveAndUseNow: 'Save and use now',
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
  providerImportPreviewTitle: 'Import preview',
  importNeedsKey: 'needs a key',
  providerOpenRouterServices:
    'OpenRouter account connection and key usage are not available yet. Paste a key to use models.',
  refreshModels: 'Refresh models',
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
    cheapestCapable: 'Cheapest capable',
    largestContext: 'Largest context',
    newBadge: 'New',
  },
  // How a model without a dollar price is marked.
  modelToolCallingUnavailable: 'Tool calling has not been verified for this model.',
  paidProviderPrice:
    'Per million tokens: input {input}, cache read {cached}, cache write {write}, one-hour write {write1h}, output {output}. Per request {request}; per image {image}.',
  paidProviderPriceTier:
    'From {threshold} input tokens: input {input}, output {output} per million.',
  modelUnpriced: 'unpriced',
  modelLocal: 'local',
  modelPlan: 'plan',
  modelFree: 'free',
  modelColumns: {
    name: 'Model',
    context: 'Context',
    inputPrice: 'Input',
    outputPrice: 'Output',
    price: 'Price',
  },
  // OpenRouter's privacy routing, private by default; each in one sentence.
  privacyNoRetention: 'No data retention',
  privacyNoRetentionDetail: 'Only providers that retain no data are used.',
  privacyNoTraining: 'No training',
  privacyNoTrainingDetail: 'Providers may retain data, but must not train on it.',
  privacyAnyProvider: 'Any provider',
  privacyAnyDetail: 'Any provider may be used, including ones that train on data.',
  spendLimitLink: 'Set this key’s own spend limit',
  // The suggestion engine's values (M95) and why each is proposed.
  suggestDefaultModel: 'Default model',
  suggestSessionBudget: 'Session budget',
  suggestReasonCheapest:
    'The cheapest model that calls tools and fits the context the harness needs.',
  suggestReasonRecommended: 'The provider’s recommended model.',
  // {cost}: the median of the user's own recent sessions.
  suggestReasonBudgetMedian: 'From your recent sessions (median {cost}).',
  // {detail}: why the address is refused, in technical words.
  providerAddressInvalid: 'This address cannot be used: {detail}',
  // {address}: a private-network address, saved only after confirmation.
  providerPrivateNetwork: '{address} is on a private network. Use it only if you trust it.',
  providerPrivateConfirm: 'Use it anyway',
  // {expected}: the origin the credential was entered for; {actual}: where
  // the file points now. The request is refused until it is entered again.
  originBindingMismatch:
    'This provider now points at {actual}, but the stored credential was entered for {expected}. Enter it again.',
  providerRedirectRefused: 'The provider redirected the request, so it was not sent.',
  // The composer's model picker (groups, pinned favourites first).
  addModelProviderRow: 'Add a model provider…',
  manageModelsRow: 'Manage models…',
  // {window}: the model's context window; {price}: its price, `unpriced`,
  // `local` or `plan`.
  pickerModelDetail: '{window} context · {price}',
  // The models view's first group, when any model is pinned (M95).
  pickerPinnedGroup: 'Pinned favourites',
  // The models view's group for Meta's own models, which carry no provider.
  pickerMetaGroup: 'Muse Spark',
  // {input}, {output}: a priced model's per-M-token prices as dollars.
  pickerPricePair: '{input} in · {output} out (per M tokens)',
  // Account & usage's rows per provider.
  usageKeyUsage: 'API key usage',
  usageLimit: 'Limit',
  usageRemaining: 'Remaining',
  usageToday: 'Today',
  usageThisMonth: 'This month',
  usageUnpricedDetail: 'This model has no price card, so only its tokens are counted.',
  // Sign-out keeps provider keys unless this is ticked (M95 acceptance 15).
  signOutRemoveProviders: 'Also remove model providers and subscriptions',
  // The ACP agent's provider commands print through these.
  acpProvidersNone: 'No providers are configured.',
  // {id}: the provider id, as written.
  acpProviderAdded: 'Added provider {id}.',
  acpProviderRemoved: 'Removed provider {id}.',
  acpChatGpt: {
    usage: 'Usage: muse-spark-code-acp providers add|remove|status chatgpt',
    actions: {
      add: 'Continue with ChatGPT',
      remove: 'Remove ChatGPT sign-in',
      status: 'Check ChatGPT sign-in',
    },
    notice:
      'ChatGPT Plus or Pro is required. Requests use your plan allowance; OpenAI may spend additional credits if you enabled them in ChatGPT. Continue in your browser to sign in.',
    alreadyAdded: 'ChatGPT is already added. Remove it before signing in again.',
    states: {
      'signed-in': 'ChatGPT is signed in.',
      expired:
        'ChatGPT sign-in has expired; it will refresh on use, or remove it and sign in again.',
      'signed-out': 'ChatGPT is not signed in.',
    },
    callback: 'ChatGPT sign-in is complete. Return to your editor or terminal.',
    failure: 'ChatGPT sign-in could not be completed. Try again or remove it and sign in again.',
    storeUnavailable:
      'This computer’s credential store is unavailable. Sign in from an interactive desktop session with an unlocked credential store; on Linux, start Secret Service first.',
  },
  execProviderNotConfigured: 'Provider {id} is not configured.',
  // M95 providers: evaluated through UI_TEXT at use time.
  providerText: {
    wizard: {
      cancelled: 'The wizard was cancelled.',
      pick: 'Pick a provider first.',
      address: 'Enter the server address.',
      credential: 'Enter the key or connect the account first.',
      keyShape: 'The key is not shaped like this provider’s keys.',
      test: 'Test the connection first.',
      models: 'Tick at least one model.',
      validate: 'Validate the server address first.',
      refused: 'The server address was refused: {reason}',
      private: 'Confirm access to this private network first.',
      pickStep: 'Pick a provider from its own step.',
      keyStep: 'Enter the key at its own step.',
      badKey: 'That key is not shaped like this provider’s keys.',
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
      together: 'Open models on Together, priced per model',
      fireworks: 'Fast open-model inference on Fireworks',
      huggingface: 'The Hugging Face router across many providers',
      zai: 'GLM models on Z.ai pay-as-you-go',
      ollama: 'Models on this computer through Ollama',
      lmstudio: 'Models on this computer through LM Studio',
      vllm: 'A vLLM server, here or on your network over HTTPS',
      llamacpp: 'A llama.cpp server, here or on your network over HTTPS',
      custom: 'Any Chat Completions, Responses or Messages server',
    },
    hints: {
      prefix: 'Key beginning with {prefix}… ({site})',
      site: 'The key from {site}',
      azure: 'The resource key from the Azure portal',
      router: 'Key beginning with {prefix}… ({site}) or Connect OpenRouter account',
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
      custom: 'Custom server',
    },
  },
  // M95: locally authored Anthropic errors; protocol identifiers remain technical.
  anthropicCodecError: 'Anthropic could not process this request.',
  anthropicCodecPdfUnsupported: 'PDF input is not supported for Anthropic models.',
  anthropicCodecImageInvalid:
    'Anthropic images must use a base64 data URL with a supported image type.',
  anthropicCodecToolArgumentsInvalid: 'Anthropic tool arguments must be a JSON object.',
  anthropicCodecEffortUnsupported: 'This reasoning effort is not supported by Anthropic.',
  anthropicCodecEmptyTurn: 'Anthropic requires at least one message.',
  anthropicCodecLimitExceeded: 'The Anthropic response exceeded a decoding limit.',
  // M95-M (the Models panel's framework, PLAN.md D74): the table, filter
  // and form labels the panel's shared components read. Lane 0 tabled the
  // M95 flows above; these rows are the panel's own.
  modelsEmpty: 'No model providers yet. Add one to use your own models.',
  panelNoMatches: 'No matches.',
  modelFilterLabels: {
    toolCalling: 'Tool calling',
    vision: 'Vision',
    reasoning: 'Reasoning',
    contextMin: 'Min context',
    contextMax: 'Max context',
    maxInput: 'Max input price',
    maxOutput: 'Max output price',
    maxCached: 'Max cached price',
    freeOrLocal: 'Free or local',
    provider: 'Provider',
    family: 'Family',
    clear: 'Clear filters',
    any: 'Any',
  },
  // {model}: the qualified model reference.
  tickModel: 'Offer {model} in the model picker',
  // {model}: the qualified model reference.
  pinModel: 'Pin {model} as a favourite',
  modelsColumnOffered: 'Offered',
  modelsColumnPinned: 'Pinned',
  providerDetailFields: {
    azureResource: 'Azure resource',
    deployment: 'Deployment',
    loopbackPort: 'Local port',
    customFormat: 'Wire format',
  },
  providerDocs: 'Documentation',
  providerDataUse: 'How your data is used',
  numCtxLabel: 'Context size',
  suggestUnavailable: 'No suggestion: no model here qualifies.',
  // {model}: the last default's qualified reference.
  lastDefaultHint: 'Last default: {model}',
  importUntrusted: 'This file is untrusted: check every address before importing.',
  openRouterOrder: 'Preferred provider order',
  openRouterFallback: 'Fall back to other providers',
  keyMissing: 'No key stored',
  testRunning: 'Testing…',
  // {shown}: the filtered rows; {count}: every row.
  modelsShownCount: forms({
    one: '{shown} of {count} model',
    other: '{shown} of {count} models',
  }),
  pricePerMillion: 'Prices per million tokens.',
  modelsNotScanned: 'Refresh to list this provider’s models.',
  // Native Ollama codec failures (M95).
  ollamaModelRequired: 'Ollama needs a model id.',
  ollamaContextRequired: 'Ollama needs a positive integer num_ctx.',
  ollamaPdfUnsupported: 'Ollama does not accept PDF input.',
  ollamaToolImageUnsupported: 'Ollama does not accept images in tool results.',
  ollamaDuplicateCall: 'Ollama history contains a duplicate tool call id.',
  ollamaResponseIdRequired: 'Ollama needs a unique response id for this request.',
  ollamaMissingFinal: 'Ollama closed the stream without a final answer.',
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
  teamRolesTitle: 'Roles',
  teamAgentsTitle: 'Agent map',
  teamHistoryTitle: 'Team history',
  teamOrchestratorSlot: 'Orchestrator',
  teamResetToDefault: 'Reset to Default',
  teamAddCustomRole: 'Add custom role',
  teamCharterEnforced: 'The harness enforces this',
  teamAccessModes: {
    readOnly: 'Read-only',
    ownBranch: 'Own branch',
    inPlace: 'In place',
  },
  teamInPlaceConfirm:
    'A worker in this role writes in your own tree, beside your own edits. Only writers you allow here run this way: never a repository, a project role or a template.',
  teamToolChecklist: 'Tool set',
  teamAddEntry: 'Add entry',
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
  teamTemplatePair: 'Pair (code + review)',
  teamTemplateFull: 'Full team',
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
    pair: 'Pair (code + review)',
    full: 'Full team',
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
    agents: 'Agents found',
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
  teamPreviewTitle: 'Preview',
  teamPreviewSample: 'Sample task',
  // {cost}: the labelled cost of one orchestrator turn.
  teamTryWithOrchestrator: 'Try with the orchestrator ({cost})',
  teamImportDraft: 'Opened as a draft: entries you lack show as missing.',
  teamEntryMissing: 'Missing: map it to one of your agents or remove it.',
  teamIncludeTranscripts: 'Include transcripts',
  // The tree's states (D75). Entry states with a time or reason ride in the
  // templates below.
  // {time}: when the mark lifts; {reason}: why the entry cannot run.
  teamEntryRateLimited: 'Rate-limited until {time}.',
  teamEntryUsageLimited: 'At its usage limit until {time}.',
  teamEntryUnavailable: 'Unavailable: {reason}.',
  teamEntryCapped: 'Capped: {reason}.',
  teamResumeAction: 'Resume',
  teamTakeBack: 'Take back',
  teamMoveToBridge: 'Move to the shared bridge',
  teamResetRecord: 'Reset record',
  // One transcript row per switch (D75). {role}: the role; {from} and {to}:
  // the entries; {reason}: one of teamSwitchReasons with its figures.
  teamSwitchRow: '{role}: {from} → {to}, {reason}',
  teamWaitingForYou: 'Waiting for you',
  teamChoiceQueue: 'Queue it',
  teamChoiceSelf: 'Main agent does it',
  teamChoiceRaise: 'Raise a limit…',
  teamChoiceCancel: 'Cancel',
  teamNotStaffed: 'Not staffed: the pool is empty.',
  teamOnlyOneModel: 'Only one model is ready: the team applies from a new conversation.',
  teamUndoMerge: 'Undo merge',
  teamBranchMoved: 'The branch moved during the task.',
  // {file}: the file whose merge conflicts.
  teamMergeConflicted: '{file} has conflicts.',
  teamNoSecondModel:
    'The team is on, but only one model is ready, so this conversation works as today. Add a second model to a role to start the team.',
  // The paid feature `teamWorkers` (D48, rule 12): asked once before the
  // first charge, with the price and the shared daily budget. {price}: each
  // model's prices; {ceiling}: each task's ceiling; {budget}: the shared
  // daily budget.
  teamWorkersName: 'Team workers',
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
  teamHintOpenWindow: 'Open that window',
  teamHintStartAnyway: 'Start here anyway',
  teamHintsOff: 'Team hints are off: the hints folder cannot be used. Nothing else changes.',
  teamHintFileClash: '{file} is open in another window.',
  teamHintServerRunning: '{server} runs in another window.',
  teamRetry: 'Retry',
  teamOpenTerminalHere: 'Open a terminal here',
  teamRestartServer: 'Restart server',
  teamTestAgain: 'Test again',
  teamOpenProviderSettings: 'Open provider settings',
  teamOrphanKeep: 'Keep',
  teamOrphanShowTerminal: 'Show in a terminal',
  teamJournalBroken: '{file} did not parse and was moved aside. {unread} tasks could not be read.',
  teamNoSubtaskSlot: 'No free slot for a sub-task: the orchestrator does it itself.',
  teamHostBusy: 'Host busy',
  // Lane M96-0b: recovery and landing actions (round-4 plan). Button labels
  // use the plan's exact words; each explanation names what the action ends
  // or risks. {sessions}: the team worker sessions to end; {server}: the
  // exclusive server; {files}: the files that changed; {task}: the old task.
  teamRestartTeamHost: 'Restart the team host',
  teamRestartTeamHostDetail:
    'Ends only this window’s team worker sessions ({sessions}). The conversation’s own sessions are untouched.',
  teamContinueAnyway: 'Continue anyway',
  teamContinueAnywayWarning:
    'Retirement cannot be proved here (macOS, and Linux without a user scope). Continuing records your decision that the earlier attempt has stopped, not proof.',
  teamReleaseAnyway: 'Release anyway',
  teamReleaseAnywayWarning:
    'Releases {server} as your decision, not as proof: the earlier call may still be acting on the resource.',
  teamTakeOver: 'Take over',
  teamTakeOverWarning:
    'Take over marks the old task interrupted in this window’s records and offers to discard its copy and branch. If the other window is still open, its task breaks.',
  teamContinueHereAsNewTask: 'Continue here as a new task',
  teamContinueHereAsNewTaskDetail:
    'Starts a new task in a fresh working copy from the old task’s last commit. The old task keeps its id, its copy, its branch and its journal row, untouched.',
  teamIncludeUncommittedEdits: 'Include its uncommitted edits',
  teamIncludeUncommittedEditsDetail:
    'Reads a snapshot of the old copy through a temporary index: a read, never a write.',
  teamLandingApply: 'Apply',
  teamChangedDuringLanding: forms({
    one: '{count} file changed during landing: {files}.',
    other: '{count} files changed during landing: {files}.',
  }),
  // A Roles-section setting: probing is setup traffic, authorized by
  // configuring a second model.
  teamCheckModelsOnOpen: 'Check the team’s models when this window opens',
  teamCheckModelsOnOpenDetail:
    'When on, and a role has a distinct custom model, the panel probes the team’s models once when the window opens. Configuring a second model is what authorizes this traffic.',
  teamDuplicateJournal:
    'Another window’s journal ({task}) may belong to a window that is still open. Nothing here writes its copy, branch or journal row.',
  teamThrottledByProvider: 'throttled by provider',
  // {low}, {high}: dollars per hour; {tokens}: tokens per hour.
  teamLevelCost: '{low}–{high} per hour, {tokens} tokens',
  teamLevelCostTokens: '{tokens} tokens per hour',
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
  legalScanTitle: 'Legal scan',
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
  legalScanItem: '/legal',
  legalCommandUsage: 'Usage: /legal [workspace-relative path …]. Options are not supported.',
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
  legalReportFindings: 'Legal findings',
  legalFixSelect: 'Fix {id}',
  legalSelectedCount: forms({ one: '{count} selected', other: '{count} selected' }),
  legalFixAllSafe: 'Fix all safe ones',
  legalPreviewFixes: 'Preview fixes',
  legalFixPreviewTitle: 'Fix preview',
  legalFixApply: 'Apply fixes',
  legalFixOwnership:
    'Confirm that these files are project-owned and that the license and copyright in the preview apply to them: {paths}',
  legalFixDenied: 'The edits were not approved.',
  legalExportMarkdown: 'Export Markdown…',
  legalFixFiles: 'Files to change',
  legalFixExcluded: 'Not included',
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
  legalExplainPaid: 'Explain findings (paid)',
  paidLegalExplanationName: 'Explain findings',
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
    m115: forms({
      one: 'not checked: the scan stopped after reading {count} file; {v1} more not read',
      other: 'not checked: the scan stopped after reading {count} files; {v1} more not read',
    }),
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
    m122: forms({
      one: 'report truncated: {count} finding omitted past the {v1}-finding bound; blockers and should-fix findings kept first',
      other:
        'report truncated: {count} findings omitted past the {v1}-finding bound; blockers and should-fix findings kept first',
    }),
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
    m141: 'not checked: {v0} is repository internals',
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
    m174: forms({
      one: 'not checked: {count} npm lock entry in {v1} carry no license metadata and no installed package data covers them',
      other:
        'not checked: {count} npm lock entries in {v1} carry no license metadata and no installed package data covers them',
    }),
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
  legalScanAgain: 'Scan again',
  // M108: shared by the Models panel, usage page, ACP and runtime.
  accounts: {
    none: 'No account selected',
    id: 'Account id',
    use: 'Use account',
    earlier: 'Move earlier',
    later: 'Move later',
    keyPrompt: '{provider} · {account} API key (not shown as you type): ',
    execHelp:
      'Headless accounts: {command} exec --account <id> [--account-pool]. CI with --key-stdin uses only the default account and never swaps.',
    unavailable:
      'Accounts are unavailable until this runtime is connected to the shared account service.',
    cliUsage:
      'Accounts: {command} providers accounts list|add|remove|order|thresholds --provider <id> [--account <id>] [--label <label>] [--limit-group <id>] [--thresholds <JSON>] [ordered ids]. Credentials: {command} auth set --provider <id> --account <id> (standard input only).',
    slashDescription: 'List accounts, view thresholds, or choose an account.',
    title: 'Accounts',
    defaultLabel: 'Default account',
    add: 'Add account',
    remove: 'Remove account',
    label: 'Label',
    order: 'Pool order',
    limitGroup: 'Shares limits with',
    thresholds: 'Thresholds',
    spend: 'Spend in USD',
    inputTokens: 'Input tokens',
    outputTokens: 'Output tokens',
    requests: 'Requests',
    month: 'Month',
    planWindow: 'Plan-window usage',
    rateHeadroom: 'Rate-limit headroom',
    swap: 'Swap accounts',
    parallel: 'Use accounts in parallel',
    swapDescription:
      'Swap at the next request boundary when a threshold is reached. Each account keeps its own limits.',
    parallelDescription:
      'Spread background work by headroom and keep each worker on its assigned account.',
    current: 'Current account',
    swapNotice: 'Now on {provider} · {account}: {previous} reached {threshold}.',
    coldCache: 'Estimated context re-read cost: {cost}.',
    stopped: '{provider} has no account with room. Resets {reset}.',
    resetUnknown: '{provider} has no account with room. Reset time is unknown.',
    sharedGroup: '{account} shares the same vendor limit group; another key adds no capacity.',
    policy: 'Vendor account policy',
    policyOn: 'Pooling available',
    policyConfirm: 'Confirmation required',
    notOffered: 'This product cannot be added.',
    checked: 'Checked {date}',
    stale: 'This policy was checked more than {duration} ago. Re-check it before release.',
    confirmWarning:
      '{provider}’s terms restrict or prohibit using several accounts to get past vendor limits. The vendor may act against your accounts.',
    legitimate: 'I confirm that these accounts are legitimately mine to use this way.',
    confirm: 'Confirm',
    ownCapsOnly: 'Only at my own caps',
    cancel: 'Cancel',
    revoke: 'Revoke confirmation',
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
    headroomAmple: 'Ample headroom',
    headroomSome: 'Some headroom',
    headroomNone: 'No headroom',
    placementConflict:
      '{provider} already has an account on {device}. Choose another device or turn off onePerDevicePerProvider.',
    sendToDevice: 'Send to {device}',
    routeUnavailable: 'The selected device has no available account or routing permission.',
    missingDevice: 'The selected device is unavailable.',
    ownerBusy: 'A prompt is already running for this conversation.',
    multipleAllowed: 'Several accounts allowed',
    multipleConditions: 'Several accounts with conditions',
    multipleOnePerson: 'One account per person',
    multipleUnclear: 'Several accounts unclear',
    sourceDate: 'Source date: {date}',
    userCap: 'User cap',
    vendorLimit: 'Vendor limit',
    swapEvent: 'Account swap',
    spreadEvent: 'Work spread',
    stopEvent: 'Work stopped',
    sourceUndated: 'No source date shown',
    invalidAccount: 'Check the account id, label, order, limit group and thresholds.',
    removeConfirm:
      'Remove {account}? Its stored credential will be deleted and its sign-in revoked.',
    requestCount: forms({
      one: '{count} request',
      other: '{count} requests',
    }),
    usageLiability: 'Reserved {reserved}; uncertain {uncertain}.',
    usageReached: 'Threshold reached',
    usageReset: 'Resets {reset}.',
    usageResetUnknown: 'Reset time is unknown.',
    usageSpread: '{provider} · {account}: worker {worker} assigned.',
    usageStop: '{provider} · {account}: stopped at {threshold}.',
    usageThreshold: '{metric} limit for {period}: {threshold}',
    usageEvents: 'Account events',
    usageRateTokens: 'Tokens',
    usageUnavailable: 'No current usage snapshot.',
  },
  // M108 X: machine-local testing options; read after table installation.
  developer: {
    title: 'Developer options',
    badge: 'Developer mode',
    allowMultiple: 'Allow several accounts of one provider on this PC',
    unlockWarning:
      'Local testing options, off by default. Account limits, vendor terms and paid confirmations still apply.',
    multipleWarning:
      'Allow isolated local profiles for testing several accounts of one provider on this PC? This choice stays on this machine.',
    resetWarning:
      'Reset Developer options? Local profiles will stop and their credential slots and state folders will be deleted.',
    locked: 'Developer options are locked.',
    unavailable: 'Developer options are unavailable.',
    invalidRequest: 'Check the Developer options request.',
    expires: 'Developer mode expires {time}.',
    reset: 'Reset Developer options',
    profiles: 'Local profiles',
    profileInfo:
      'Each profile has its own credential slot, state folder and runtime process. Expiry stops profiles; Reset deletes them.',
    provider: 'Provider id',
    account: 'Account id',
    addProfile: 'Add local profile',
    helpUnlock: 'Click the version seven times or use the Developer options command to unlock.',
    helpTerminal: 'Run `developer` to unlock; `developer status` shows this machine’s options.',
    commandUsage:
      'Usage: developer [status|enable|disable|reset|add <provider> <account>|remove <profile>]',
  },
  // M109: read each key through UI_TEXT.vault at use time.
  vault: {
    title: 'Vault',
    locked: 'Locked',
    unlocked: 'Unlocked',
    empty: 'No vault items yet.',
    add: 'Add to vault',
    edit: 'Edit item',
    remove: 'Remove item',
    grant: 'Create grant',
    revoke: 'Revoke grant',
    audit: 'Audit',
    lock: 'Lock vault now',
    unlock: 'Unlock vault',
    allowSession: 'Allow for this session',
    manage: 'Manage in vault',
    requirePresence: 'Require presence for each use',
    unattended: 'Unattended allowed',
    hidden: 'Hidden from agents',
    firstParty: 'First-party only',
    askEveryTime: 'Ask every time',
    askOncePerSession: 'Ask once per session',
    alwaysAllow: 'Always allow',
    never: 'Never',
    name: 'Name',
    label: 'Label',
    kind: 'Kind',
    value: 'Value',
    username: 'Username',
    password: 'Password',
    seed: 'One-time code seed',
    roles: 'Roles',
    workspaces: 'Workspaces',
    target: 'Target',
    command: 'Command',
    cwd: 'Working folder',
    environmentNames: 'Environment variable names',
    useCount: 'Use count',
    expires: 'Expires',
    timeWindow: 'Time window',
    days: 'Days',
    hours: 'Hours',
    remoteUser: 'Remote user',
    hostKey: 'Host key',
    origin: 'Origin',
    resource: 'Resource',
    requester: 'Requester',
    outcome: 'Outcome',
    tier: 'Protection tier',
    publicKey: 'Public key',
    fingerprint: 'Fingerprint',
    signInYourself: 'Sign in yourself',
    moveToVault: 'Move to vault',
    undoMigration: 'Undo migration',
    importFile: 'Import file',
    keepFile: 'Keep file',
    deleteFile: 'Delete the file',
    rotate: 'Rotate credential',
    recoveryCode: 'Recovery code',
    apiKey: 'API key',
    oauth: 'OAuth tokens',
    sshKey: 'SSH key',
    webLogin: 'Web login',
    totp: 'One-time code',
    session: 'Session cookies',
    secret: 'Named secret',
    devicePair: 'Device pairing',
    internal: 'Internal record',
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
    brokerBlocked:
      'The broker cannot start. First-party keys still work; agent uses are refused. Repair the broker installation.',
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
    remoteWarning:
      'Only a signature or a one-time code may be requested from another device. Its user must approve each use there.',
    approvalExpired: 'This approval expired. Request the use again.',
    useChanged: 'The use changed after approval. Request approval for the new use.',
    osStoreWarning:
      'Protected by your operating system’s credential store. Programs running as you may unlock it too.',
    unknownTierWarning:
      'The protection tier is unknown because the vault is locked. Unlock to see how it is protected.',
    hardwareWarning:
      'Protected by this device’s hardware. It unlocks silently, so programs running as you can unlock it too.',
    presenceTierWarning:
      'Every use needs your touch, PIN or passphrase. Unattended use is refused.',
    sshUse: 'SSH authentication',
    sshSignUse: 'Sign with an SSH key',
    sudoUse: 'Run sudo',
    askpassUse: 'Script askpass',
    gitUse: 'HTTPS for Git',
    environmentUse: 'Inject environment variables',
    stdinUse: 'Write to standard input',
    mcpUse: 'Start an MCP server',
    headerUse: 'Send an HTTP header',
    fillUse: 'Fill a login field',
    disclosureUse: 'Show to you',
    forwarding: 'Allow forwarding',
    anyHost: 'Any host',
    noAccess: 'No access',
    ask: 'Ask for access',
    status: 'Vault status',
    watch: 'Watch pending requests',
    grantCeiling: 'Worker access ceiling',
    hardware: 'Hardware protection',
    presence: 'User presence',
    osStore: 'OS credential store',
    secretStorage: 'Editor secret storage',
    passphrase: 'Passphrase protection',
    recovery: 'Recovery protection',
    autoProtection: 'Automatic protection',
    approval: '{requester} requests {use} with {item} for {target}.',
    paidWarning: 'Vault grants do not approve paid requests.',
    windowsElevation: 'Windows elevation uses UAC and cannot be brokered.',
    seUnavailable: 'Secure Enclave protection is unavailable. Use a passphrase for presence.',
    passphraseWarning:
      'A passphrase is required to unlock. It protects a copied disk and prevents silent unlock by programs running as you.',
    operationFailed: 'The vault operation failed. Unlock the vault and try again.',
    invalidFields: 'Check the grant fields and its target.',
    grantHelp:
      'Every scope below limits this grant. Empty count, expiry or time window means no limit.',
    metadataOnly: 'Edit settings only',
    replaceValue: 'Replace credential',
    presenceAdvice: 'Presence is recommended for sudo, SSH keys and web logins.',
    passwordEntry:
      'Enter credentials in the editor’s password box. Existing values are never shown.',
    auditInvalid: 'The audit could not be verified. Restore a current backup.',
    slotUnavailable: 'No usable protection slot is available.',
    any: 'Any',
    unlimited: 'Unlimited',
    localTime: 'Local time',
    created: 'Created',
    lastUsed: 'Last used',
    policy: 'Agent policy',
    item: 'Item',
    sessionScope: 'Session',
    taskScope: 'Task',
    ceiling: 'Access ceiling',
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
    grantsCount: forms({ one: '{count} grant', other: '{count} grants' }),
  },
}

/** The shape every table has: English's keys, with any language's plural forms. */
export type UiText = typeof EN

/** Browser lazy-region installer; Node consumers already have the canonical vault group. */
export function setVaultEnglish(english: UiText['vault']): void {
  EN.vault = english
}
