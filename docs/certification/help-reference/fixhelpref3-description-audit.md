# FIXHELPREF3 whole-catalogue prose audit

Kubuntu, 2026-10-06. Reviewed the catalogue's human-written text against the
owning handlers and admission paths. This receipt inventories every description
reference reached by all 53 features, 44 commands, 58 settings (including
enum meanings and nested descriptions), 26 slash rows, 116 CLI command/option
rows and 29 keyboard rows. Shared text appears once with all its owners.
Code-derived facts and contracts retain the existing runtime truth tests.

Corrected prose: Auto reviewers and admission (C01); ordinary model answers
and separate MCP server replies (C02); native delegation statements moved into
a typed condition while retaining all information (C06); Hooks includes both
backends and all supported sources (C07); scan-secrets explains UTF-8 scanning,
failure, exact in-memory key matching and no storage (C07). No additional false
description found in the remaining inventory; no finding deferred. This is a
source audit, not a claim of new live-wire or native-host certification.

The technical selector on a conditional owner records its state domain; it
does not claim that state currently holds. The plain-description lint rejects
generic conditional wording, including new sentences and quoted state words.

- **ui:bestOfNTitle**: Best of N

  Owners: feature:best-of-n/name.

  Sources: [src/core/bestOfN/bestOfN.ts](../../../src/core/bestOfN/bestOfN.ts), [src/core/bestOfN/bestOfNCoordinator.ts](../../../src/core/bestOfN/bestOfNCoordinator.ts), [src/host/bestOfN/bestOfNManager.ts](../../../src/host/bestOfN/bestOfNManager.ts).

- **ui:referenceBestOfN**: Best of N Apply and stage exactly the selected preview. No commit is created; ignored files are excluded.

  Owners: feature:best-of-n/summary; feature:best-of-n/description.

  Sources: [src/core/bestOfN/bestOfN.ts](../../../src/core/bestOfN/bestOfN.ts), [src/core/bestOfN/bestOfNCoordinator.ts](../../../src/core/bestOfN/bestOfNCoordinator.ts), [src/host/bestOfN/bestOfNManager.ts](../../../src/host/bestOfN/bestOfNManager.ts).

- **ui:referenceBestOfNRequirements**: Candidates require Model API, the paid feature enabled, a trusted Git workspace, Git 2.36 or newer, and no configured Git filter or hook programs. A finite session budget prevents this workflow until candidate budgets can be shared. Set attempt and request limits, compare results or cancel, then take selected changes by applying and staging without a commit.

  Owners: feature:best-of-n/detail 1 [bestOfNAdmission].

  Sources: [src/core/bestOfN/bestOfN.ts](../../../src/core/bestOfN/bestOfN.ts), [src/core/bestOfN/bestOfNCoordinator.ts](../../../src/core/bestOfN/bestOfNCoordinator.ts), [src/host/bestOfN/bestOfNManager.ts](../../../src/host/bestOfN/bestOfNManager.ts).

- **ui:referencePaidContexts**: Interactive Model API extras ask before spending and use the shared daily budget. Muse Code images and voice need a stored Model API key and explicit opt-in; that daily ledger does not cover them. ACP paid features default off, require Model API flags and editor permission; ordinary ACP has no mandatory hard budget. Headless images require acceptEdits, the flag and a hard budget. Account & usage can forget workspace paid-use grants.

  Owners: feature:best-of-n/detail 2; feature:custom-agents/detail 1; feature:voice/detail 1; feature:search/detail 1; feature:images/detail 1; feature:subagents/detail 1; feature:auto/detail 1.

  Sources: [src/core/bestOfN/bestOfN.ts](../../../src/core/bestOfN/bestOfN.ts), [src/core/bestOfN/bestOfNCoordinator.ts](../../../src/core/bestOfN/bestOfNCoordinator.ts), [src/host/bestOfN/bestOfNManager.ts](../../../src/host/bestOfN/bestOfNManager.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/shared/palette.ts](../../../src/shared/palette.ts), [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/core/voice/museVoice.ts](../../../src/core/voice/museVoice.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts).

- **ui:permissionModeItem**: Permission mode

  Owners: feature:auto-subscription/name; feature:permissions/name; feature:rules/name; feature:auto/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/backends/modelapi/permissions.ts](../../../src/core/backends/modelapi/permissions.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **ui:museCodeReviewerNotice**: On by default. In Auto on Muse Code, only approvals for the running turn that no rule settles are eligible: one short Muse Code turn on your subscription in a hidden Plan session. Protected writes, paid calls, child tasks, questions, replayed or escalated requests, unknown subjects, requests without allow-once and sessions shared by panels are never reviewed. A successful review may allow once; declines, failures, busy sessions, timeouts or a tripped breaker show the approval card. Host exit recreates the side session. Turn it off with museSpark.museCodeAutoReviewer.

  Owners: feature:auto-subscription/summary [permissionMode=auto&museCodeAutoReviewer=true]; feature:auto-subscription/description [permissionMode=auto&museCodeAutoReviewer=true].

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **ui:agentsCommand**: /agents

  Owners: feature:native-agents/name; feature:custom-agents/name; feature:subagents/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/musecode/MuseCodeHost.ts](../../../src/core/backends/musecode/MuseCodeHost.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/shared/palette.ts](../../../src/shared/palette.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **ui:referenceNativeAgents**: run.workflow_trigger_mode: auto / explicit / off. Muse Code agent delegation controls.

  Owners: feature:native-agents/summary; feature:native-agents/description.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/musecode/MuseCodeHost.ts](../../../src/core/backends/musecode/MuseCodeHost.ts).

- **ui:referenceAgentControls**: Agent controls; Interrupt; Stop; Resume; Close agent; Reopen agent; Mark result read; Send message; Follow-up task

  Owners: feature:native-agents/detail 1.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/musecode/MuseCodeHost.ts](../../../src/core/backends/musecode/MuseCodeHost.ts).

- **ui:referenceNativeAgentsConditions**: When run.subagent_delegation_mode="auto", Muse Code can delegate to agents. When it is "off", delegation tools are unavailable. run.workflow_trigger_mode: auto / explicit / off.

  Owners: feature:native-agents/detail 2 [run.subagent_delegation_mode].

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/musecode/MuseCodeHost.ts](../../../src/core/backends/musecode/MuseCodeHost.ts).

- **ui:paidWebSearchName**: Web search

  Owners: feature:native-search-cron/name; feature:search/name.

  Sources: [src/core/backends/musecode/MuseCodeHost.ts](../../../src/core/backends/musecode/MuseCodeHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **ui:referenceNativeSearch**: Muse Code web search and native cron use the subscription. Native cron has no MSP schedule controls; extension search and schedules are separate paid Model API features.

  Owners: feature:native-search-cron/summary; feature:native-search-cron/description.

  Sources: [src/core/backends/musecode/MuseCodeHost.ts](../../../src/core/backends/musecode/MuseCodeHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:attachmentsLabel**: Attachments

  Owners: feature:attachments/name.

  Sources: [src/core/attachments.ts](../../../src/core/attachments.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:referenceAttachments**: Attach files by selecting or dropping them, and paste images into the composer. PNG, JPEG, GIF and WebP images require a selected model with vision. PDF attachments require Model API. Trusted indexed workspace text files can be attached; protected or confidential files are refused. The limits below apply before sending.

  Owners: feature:attachments/summary; feature:attachments/description.

  Sources: [src/core/attachments.ts](../../../src/core/attachments.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:effortItem**: Effort

  Owners: feature:effort/name.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **tip:effort**: Choose how much effort Muse puts into each reply.

  Owners: feature:effort/summary; feature:effort/description.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:referenceCustomAgents**: Define custom agents in project or personal AGENT.md files. Select an agent or ask for explore or second-opinion; tool allowlists narrow its abilities. Model API child tasks require paid subagent consent.

  Owners: feature:custom-agents/summary; feature:custom-agents/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:transcriptLabel**: Conversation

  Owners: feature:conversation-actions/name; feature:chat/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/extension.ts](../../../src/extension.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceConversationActions**: Rename, fork or rewind a conversation. Rewind can restore recorded edits as well as history; changed files are left alone, and shell changes are not covered. While a turn runs, new messages steer it. Model API messages can be withdrawn before the next request; Muse Code permits withdrawal only while queued, because steering is delivered immediately. Side chat copies completed turns, clears the goal and stays in Plan; Muse Code file tools may still edit in Plan. Select transcript text to reply, ask, comment or copy.

  Owners: feature:conversation-actions/summary [turnState]; feature:conversation-actions/description [turnState]; feature:chat/detail 2 [turnState].

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/extension.ts](../../../src/extension.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceWindowsSessions**: Muse Code cannot rename or fork sessions on Windows (meta-models/muse-code-sdk#30, #31).

  Owners: feature:conversation-actions/detail 1.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx).

- **ui:copyCode**: Copy

  Owners: feature:code-output/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/components/MarkdownView.tsx](../../../src/webview/components/MarkdownView.tsx).

- **ui:referenceCodeOutput**: Copy copies code; Insert writes at the editor cursor; Apply replaces the editor selection. Open tool output to read the full result; clipped output can be paged. Select transcript text to quote it in the composer, ask about it, add a comment or copy it.

  Owners: feature:code-output/summary; feature:code-output/description.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/components/MarkdownView.tsx](../../../src/webview/components/MarkdownView.tsx).

- **ui:questionSubmit**: Submit

  Owners: feature:questions/name.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/webview/components/QuestionCard.tsx](../../../src/webview/components/QuestionCard.tsx).

- **ui:referenceQuestions**: Choose and Submit an answer, explain in your own words, or Cancel. Muse receives submitted answers and explanations in the conversation.

  Owners: feature:questions/summary; feature:questions/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/webview/components/QuestionCard.tsx](../../../src/webview/components/QuestionCard.tsx).

- **ui:referenceElicitationTitle**: MCP elicitation

  Owners: feature:mcp-elicitation/name.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/webview/components/ElicitationCard.tsx](../../../src/webview/components/ElicitationCard.tsx).

- **ui:referenceElicitation**: MCP forms ask for information for the requesting MCP server. Submitted form values go to that server, outside the model conversation and transcript. A server can include them in later tool output. Never enter a password or key.

  Owners: feature:mcp-elicitation/summary; feature:mcp-elicitation/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/webview/components/ElicitationCard.tsx](../../../src/webview/components/ElicitationCard.tsx).

- **ui:helpReferenceTitle**: Help & Reference

  Owners: feature:acp/name.

  Sources: [src/acp/agent.ts](../../../src/acp/agent.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **ui:referenceAcp**: Installed skills add dynamic slash commands. This static reference does not list them. ACP handles only local /help and installed skills; panel slash commands, settings and editor dialogs in the linked reference are extension workflows.

  Owners: feature:acp/summary; feature:acp/description; feature:support/detail 1.

  Sources: [src/acp/agent.ts](../../../src/acp/agent.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts), [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts).

- **ui:referenceWebFetchTitle**: Web fetch

  Owners: feature:web-fetch/name.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/web/webFetchEntry.ts](../../../src/host/web/webFetchEntry.ts).

- **ui:referenceWebFetchDetail**: Fetch public web pages as readable text, with permission and network checks.

  Owners: feature:web-fetch/summary; feature:web-fetch/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/web/webFetchEntry.ts](../../../src/host/web/webFetchEntry.ts).

- **ui:referenceCodeIntelTitle**: Code intelligence

  Owners: feature:code-intelligence/name.

  Sources: [src/host/ide/codeIntelEntry.ts](../../../src/host/ide/codeIntelEntry.ts), [src/core/codeIntel/codeIntelTools.ts](../../../src/core/codeIntel/codeIntelTools.ts), [src/core/codeIntel/rename.ts](../../../src/core/codeIntel/rename.ts).

- **ui:referenceCodeIntelDetail**: Use editor language services for definitions, references, symbols, calls and safe renames.

  Owners: feature:code-intelligence/summary; feature:code-intelligence/description.

  Sources: [src/host/ide/codeIntelEntry.ts](../../../src/host/ide/codeIntelEntry.ts), [src/core/codeIntel/codeIntelTools.ts](../../../src/core/codeIntel/codeIntelTools.ts), [src/core/codeIntel/rename.ts](../../../src/core/codeIntel/rename.ts).

- **ui:referenceCodeIntelExtra**: Use editor language services for definitions, references, symbols, calls and safe renames. Hover Repo map (mcp__ide__repoMap / repo_map).

  Owners: feature:code-intelligence/detail 1.

  Sources: [src/host/ide/codeIntelEntry.ts](../../../src/host/ide/codeIntelEntry.ts), [src/core/codeIntel/codeIntelTools.ts](../../../src/core/codeIntel/codeIntelTools.ts), [src/core/codeIntel/rename.ts](../../../src/core/codeIntel/rename.ts).

- **ui:composerShellMode**: Shell

  Owners: feature:shell/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceShellDetail**: Run your own !commands, or let the agent run commands under your permission mode.

  Owners: feature:shell/summary; feature:shell/description.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:boardTitle**: Session board

  Owners: feature:session-board/name.

  Sources: [src/webview/components/SessionBoardDialog.tsx](../../../src/webview/components/SessionBoardDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:referenceBoardDetail**: Filter conversations by title or branch, inspect their state, changes and approvals, and activate a conversation.

  Owners: feature:session-board/summary; feature:session-board/description.

  Sources: [src/webview/components/SessionBoardDialog.tsx](../../../src/webview/components/SessionBoardDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:reviewChangesItem**: Review this conversation’s changes

  Owners: feature:edit-review/name.

  Sources: [src/host/review/reviewEntry.ts](../../../src/host/review/reviewEntry.ts), [src/webview/components/ReviewPane.tsx](../../../src/webview/components/ReviewPane.tsx).

- **ui:reviewChangesDetail**: Accept or revert each change, and comment on a line

  Owners: feature:edit-review/summary; feature:edit-review/description; slash:/changes/museCode; slash:/changes/modelApi.

  Sources: [src/host/review/reviewEntry.ts](../../../src/host/review/reviewEntry.ts), [src/webview/components/ReviewPane.tsx](../../../src/webview/components/ReviewPane.tsx), [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:dictationLabel**: Record voice

  Owners: feature:free-dictation/name.

  Sources: [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts).

- **ui:referenceDictation**: Voice dictation is not available on Linux: no distribution ships a speech recogniser, and this extension adds no third-party engine. Voice dictation is not available in a remote window (SSH, WSL, a container, a tunnel or a codespace): the extension runs on the remote machine, which cannot hear this computer’s microphone. Open the folder in a local window to dictate.

  Owners: feature:free-dictation/summary; feature:free-dictation/description.

  Sources: [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts).

- **ui:referenceNewTab**: Open a new Muse Spark conversation in an editor tab.

  Owners: feature:chat/summary; feature:chat/description; command:museSpark.openInNewTab.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceThinking**: Choose how much effort Muse puts into each reply. Thinking: On = effort; Off = museCode:none / modelApi:minimal.

  Owners: feature:chat/detail 1; command:museSpark.toggleThinking.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:groupAccount**: Account & usage

  Owners: feature:account/name.

  Sources: [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **tip:accountUsage**: Subscription usage, this conversation's tokens, the backend.

  Owners: feature:account/summary; feature:account/description.

  Sources: [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:signInBrowserDetail**: Shows an approval code here; open the sign-in page to approve it.

  Owners: feature:account/detail 1.

  Sources: [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:signInApiKeyDetail**: Paste a key from dev.meta.ai; it is stored in VS Code secret storage.

  Owners: feature:account/detail 2.

  Sources: [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:installDetail**: The Muse Code CLI hosts conversations for this extension. Install it here, then sign in.

  Owners: feature:account/detail 3.

  Sources: [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:referenceSecretPrompt**: When a prompt contains a detected secret, the transcript redacts it and asks whether to send it anyway or return to editing.

  Owners: feature:account/detail 4 [secretDetected].

  Sources: [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **tip:permissionMode**: Choose how Muse asks before it acts.

  Owners: feature:permissions/summary; feature:permissions/description.

  Sources: [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **ui:referencePermissionLimits**: museCode:manual: Muse will ask before running commands; Muse Code edits workspace files without asking museCode:acceptEdits: On Muse Code, the same as Manual: Muse Code edits workspace files without asking and asks before running commands museCode:plan: Muse plans first; Muse Code refuses commands, but its file tools can still edit files without asking museCode:bypassPermissions: Muse will edit files and run commands without asking modelApi:manual: Muse will ask for approval before each edit and each command modelApi:acceptEdits: Muse will edit files without asking and ask before running commands modelApi:plan: Muse will explore the code and present a plan before editing museCode (museSpark.museCodeAutoReviewer=false): Muse Code runs the commands it judges simple without asking and asks before the rest museCode (museSpark.museCodeAutoReviewer=true): Muse Code runs the commands it judges simple without asking; a reviewer may allow some others once, and you are asked about the rest modelApi (museSpark.modelApiAutoReviewer=false): Muse will edit files without asking, except protected files, and ask before commands modelApi (museSpark.modelApiAutoReviewer=true): Muse will edit files without asking, except protected files; a paid reviewer may allow some commands once, and you are asked about the rest These Auto descriptions concern requests not settled by rules. The Model API reviewer additionally requires paid consent and budget admission. A declined or failed review leaves the decision to you. Ordinary ACP has neither reviewer.

  Owners: feature:permissions/detail 1 [backend&permissionMode&autoReviewer].

  Sources: [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **ui:resumeItem**: Resume

  Owners: feature:history/name.

  Sources: [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **tip:resume**: Pick a previous conversation in this workspace.

  Owners: feature:history/summary; feature:history/description.

  Sources: [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:mentionFile**: Mention file from this project…

  Owners: feature:context/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/commands/insertMention.ts](../../../src/host/commands/insertMention.ts).

- **tip:mentionFile**: Mention a file from this project in your message.

  Owners: feature:context/summary; feature:context/description; command:museSpark.insertMentionReference.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/commands/insertMention.ts](../../../src/host/commands/insertMention.ts), [src/extension.ts](../../../src/extension.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceContext**: Click to compact now Summarise older context to free the window Cannot rewind before the latest compaction.

  Owners: feature:context/detail 1.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/commands/insertMention.ts](../../../src/host/commands/insertMention.ts).

- **ui:groupSkills**: Skills

  Owners: feature:skills/name.

  Sources: [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceSkills**: SKILL.md. museCode: Turn Muse Code's skills on or off. modelApi: SKILL.md.

  Owners: feature:skills/summary; feature:skills/description.

  Sources: [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceBundled**: Bundled skills: project_setup, feature_delivery, quality_retrofit. muse_gadgets is available on Model API only.

  Owners: feature:skills/detail 1.

  Sources: [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **command:museSpark.importFromAgents**: Import from Other Agents

  Owners: feature:imports/name.

  Sources: [src/host/commands/agentImportCommands.ts](../../../src/host/commands/agentImportCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:agentImportDetailEvery**: Copy MCP servers, hooks, agents, commands and rules from Claude Code, Codex or Cursor, and hooks and plugins from Gemini CLI, Copilot, Windsurf, Kiro, Cline, Amp and OpenCode

  Owners: feature:imports/summary; feature:imports/description; feature:imports/detail 1; command:museSpark.importFromAgents.

  Sources: [src/host/commands/agentImportCommands.ts](../../../src/host/commands/agentImportCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/extension.ts](../../../src/extension.ts).

- **ui:referenceResumeAgents**: Pick up unfinished Claude Code work in this conversation. Pick up unfinished Codex work in this conversation.

  Owners: feature:imports/detail 2.

  Sources: [src/host/commands/agentImportCommands.ts](../../../src/host/commands/agentImportCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:memoryItem**: Memory…

  Owners: feature:memory/name.

  Sources: [src/host/commands/memoryCommands.ts](../../../src/host/commands/memoryCommands.ts), [src/host/memoryFeatures.ts](../../../src/host/memoryFeatures.ts).

- **tip:memory**: The notes Muse keeps for later sessions.

  Owners: feature:memory/summary; feature:memory/description; command:museSpark.memory.

  Sources: [src/host/commands/memoryCommands.ts](../../../src/host/commands/memoryCommands.ts), [src/host/memoryFeatures.ts](../../../src/host/memoryFeatures.ts), [src/extension.ts](../../../src/extension.ts).

- **ui:mcpItem**: MCP servers…

  Owners: feature:mcp/name.

  Sources: [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceMcp**: MCP servers: Muse Code runs its own servers; on Model API this window runs configured servers. ACP Model API has no editor MCP servers.

  Owners: feature:mcp/summary; feature:mcp/description; command:museSpark.mcpServers.

  Sources: [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/extension.ts](../../../src/extension.ts).

- **ui:hooksItem**: Hooks…

  Owners: feature:hooks/name; feature:hook-models/name.

  Sources: [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/extension.ts](../../../src/extension.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidFeatures.ts](../../../src/core/paid/paidFeatures.ts).

- **ui:hooksItemDetail**: Inspect project, user, managed and spark-hooks.json hook sources for the selected backend.

  Owners: feature:hooks/summary; feature:hooks/description; slash:/hooks/museCode; slash:/hooks/modelApi.

  Sources: [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/extension.ts](../../../src/extension.ts), [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:groupGit**: Git and pull requests

  Owners: feature:git/name.

  Sources: [src/host/commands/worktreeCommands.ts](../../../src/host/commands/worktreeCommands.ts), [src/host/git/conversationGit.ts](../../../src/host/git/conversationGit.ts).

- **tip:newWorktree**: A new branch in its own folder and window; this checkout is untouched.

  Owners: feature:git/summary; feature:git/description; command:museSpark.newWorktree.

  Sources: [src/host/commands/worktreeCommands.ts](../../../src/host/commands/worktreeCommands.ts), [src/host/git/conversationGit.ts](../../../src/host/git/conversationGit.ts), [src/extension.ts](../../../src/extension.ts).

- **ui:backgroundTasksLabel**: Background tasks

  Owners: feature:tasks/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/TasksApp.tsx](../../../src/webview/TasksApp.tsx).

- **ui:moveToBackgroundTitle**: Keep this command running in the background and let Muse carry on

  Owners: feature:tasks/summary; feature:tasks/description; command:museSpark.moveToBackground.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/TasksApp.tsx](../../../src/webview/TasksApp.tsx), [src/extension.ts](../../../src/extension.ts).

- **ui:exportJsonItem**: Export session as JSON…

  Owners: feature:exports/name.

  Sources: [src/host/conversation/exportConversation.ts](../../../src/host/conversation/exportConversation.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **tip:exportJson**: A portable file you can import or share.

  Owners: feature:exports/summary; feature:exports/description.

  Sources: [src/host/conversation/exportConversation.ts](../../../src/host/conversation/exportConversation.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceExports**: A portable file you can import or share Muse Code’s full JSON record of this conversation Resume an exported session file on the Model API backend

  Owners: feature:exports/detail 1.

  Sources: [src/host/conversation/exportConversation.ts](../../../src/host/conversation/exportConversation.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:groupReview**: Review

  Owners: feature:review/name.

  Sources: [src/core/review/planModeHold.ts](../../../src/core/review/planModeHold.ts), [src/host/review/reviewEntry.ts](../../../src/host/review/reviewEntry.ts).

- **tip:review**: Ask Muse to review your changes, or what you describe.

  Owners: feature:review/summary; feature:review/description.

  Sources: [src/core/review/planModeHold.ts](../../../src/core/review/planModeHold.ts), [src/host/review/reviewEntry.ts](../../../src/host/review/reviewEntry.ts).

- **ui:plansItem**: Plans…

  Owners: feature:plans/name.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/planFeatures.ts](../../../src/host/planFeatures.ts).

- **tip:plans**: Saved plans in .agents/plans: open one or implement it.

  Owners: feature:plans/summary; feature:plans/description.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/planFeatures.ts](../../../src/host/planFeatures.ts).

- **ui:referencePlanModes**: Only the latest reply in Plan mode can be saved as a plan. A new conversation with this plan as its brief, out of Plan mode Implement a plan from the main conversation; a side chat stays in Plan mode.

  Owners: feature:plans/detail 1.

  Sources: [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/planFeatures.ts](../../../src/host/planFeatures.ts).

- **ui:goalItem**: /goal

  Owners: feature:goals/name.

  Sources: [src/shared/goalCommand.ts](../../../src/shared/goalCommand.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **tip:goal**: Set a goal Muse keeps working toward: /goal &lt;objective&gt;.

  Owners: feature:goals/summary; feature:goals/description.

  Sources: [src/shared/goalCommand.ts](../../../src/shared/goalCommand.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:handoffItem**: /handoff

  Owners: feature:handoff/name.

  Sources: [src/shared/handoff.ts](../../../src/shared/handoff.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **tip:handoff**: Distil this conversation into a brief for a fresh one.

  Owners: feature:handoff/summary; feature:handoff/description.

  Sources: [src/shared/handoff.ts](../../../src/shared/handoff.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **command:museSpark.diagnostics**: Diagnostics

  Owners: feature:verify/name.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **setting:diagnosticsAfterEdits**: After each round of edits, give the model the errors and warnings of up to 8 edited files from VS Code's language servers, with what changed since their previous check (Model API backend; none once the model writes a file the editor runs as code, until your next message), or tell Muse Code to check them itself. On by default.

  Owners: feature:verify/summary; feature:verify/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **setting:modelApiRepoMap**: Add a repo map to the Model API backend's system prompt in a trusted workspace: the workspace's most used files and definitions, ranked with VS Code's language services, made once per conversation in about 1,000 tokens. Off by default: it adds those tokens to every request, billed to your Model API key. Either way, the repo_map tool makes a fresh map on request.

  Owners: feature:repo-map/name; feature:repo-map/summary; feature:repo-map/description.

  Sources: [src/core/codeIntel/repoMap.ts](../../../src/core/codeIntel/repoMap.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **setting:turnCheckpoints**: On by default: keeps the model’s own file, image, workspace memory and symbol-rename tool writes for Restore files and Redo in a connected Model API session, while files still hold exactly what the model left. Never undoes changes by commands, hooks, MCP tools, you or other windows; copies stay in extension storage, outside the workspace’s .git. Needs git on PATH and a trusted workspace.

  Owners: feature:checkpoints/name; feature:checkpoints/summary; feature:checkpoints/description.

  Sources: [src/core/checkpoints/toolWrites.ts](../../../src/core/checkpoints/toolWrites.ts), [src/host/checkpoints/checkpointHost.ts](../../../src/host/checkpoints/checkpointHost.ts).

- **setting:modelApiCommandRules**: Model API backend: your command rules for the shell tool. Each rule has the words a command starts with (`pattern`), a `decision` (`allow`, `ask` or `forbid`), optionally the `shell` it is for and a `justification`, and the command lines it must match (`match`) and must not match (`notMatch`), which are checked whenever the rules are read. A forbid or ask rule matches its words anywhere in a command line; an allow rule runs only one plain command that begins with its words, so a chain, a pipeline, an evaluator, or a line with a substitution, a redirection, a background `&` or a newline still asks. Forbid refuses in every mode, Bypass included. User and machine settings only. An allow rule permits only one plain command. Chains, pipelines and evaluators require a user decision.

  Owners: feature:rules/summary; feature:rules/description.

  Sources: [src/core/backends/modelapi/permissions.ts](../../../src/core/backends/modelapi/permissions.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **command:museSpark.downloadBrowserCheckRuntime**: Download Browser Check Runtime

  Owners: feature:browser/name.

  Sources: [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **setting:browserCheckRuntime**: How the browser check gets its browser: Google’s Chrome for Testing headless shell, pinned to this extension version and downloaded from storage.googleapis.com into the extension’s storage (about 100 to 120 MB for each pinned version). Only you can change this, never a repository’s settings.

  Owners: feature:browser/summary; feature:browser/description.

  Sources: [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceBrowser**: The page loads in a fresh private browser profile that is deleted afterwards. All its traffic goes through the extension’s own proxy, which lets through only plain http to this computer and the hosts in museSpark.browserCheckExtraHosts. The browser check is off in Restricted Mode. Trust the workspace to use it.

  Owners: feature:browser/detail 1 [workspaceTrust].

  Sources: [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:paidVoiceName**: Muse Voice

  Owners: feature:voice/name.

  Sources: [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/core/voice/museVoice.ts](../../../src/core/voice/museVoice.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts).

- **ui:referenceVoice**: Paid voice is unavailable on Model API in this version. Muse Code needs a local window, a stored Model API key and explicit opt-in. Linux also needs arecord or parec.

  Owners: feature:voice/summary; feature:voice/description.

  Sources: [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/core/voice/museVoice.ts](../../../src/core/voice/museVoice.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts).

- **tip:paid:webSearch**: Turn paid web search on or off.

  Owners: feature:search/summary; feature:search/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **ui:paidImageGenerationName**: Images

  Owners: feature:images/name.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts).

- **tip:paid:imageGeneration**: Turn paid image generation on or off.

  Owners: feature:images/summary; feature:images/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts).

- **ui:loopItem**: /loop

  Owners: feature:schedules/name.

  Sources: [src/core/backends/modelapi/schedules.ts](../../../src/core/backends/modelapi/schedules.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **tip:loop**: Schedule a prompt in this Model API conversation.

  Owners: feature:schedules/summary; feature:schedules/description.

  Sources: [src/core/backends/modelapi/schedules.ts](../../../src/core/backends/modelapi/schedules.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **tip:paid:subagents**: Turn paid subagents on or off.

  Owners: feature:subagents/summary; feature:subagents/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **tip:paid:autoReviewer**: Turn the paid Auto reviewer on or off.

  Owners: feature:auto/summary; feature:auto/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **tip:paid:hookModels**: Turn paid model hooks on or off.

  Owners: feature:hook-models/summary; feature:hook-models/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidFeatures.ts](../../../src/core/paid/paidFeatures.ts).

- **setting:modelApiPromptCacheRetention**: How long Meta is asked to keep the cached start of your Model API requests (the instructions, tools and conversation so far), which is billed at the lower cached-input rate. A hint: Meta may evict it sooner.

  Owners: feature:cache/name; feature:cache/summary; feature:cache/description.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/settings.ts](../../../src/host/settings.ts).

- **ui:referenceCache**: Settings (modelApiPromptCacheRetention).

  Owners: feature:cache/detail 1.

  Sources: [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/settings.ts](../../../src/host/settings.ts).

- **setting:paidDailyBudgetUsd**: Shared daily budget in USD for interactive paid Model API extras, across windows and keys. Default 5.00; range 0.50–500. Reserves before sending and refuses unreadable storage. Tab’s separate budget is not included. ACP and headless flags and budgets are unchanged.

  Owners: feature:budget/name; feature:budget/summary; feature:budget/description.

  Sources: [src/core/paid/paidFeatures.ts](../../../src/core/paid/paidFeatures.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **ui:referenceBudget**: Shared daily budget for interactive paid extras: museSpark.paidDailyBudgetUsd. Tab has its own separate budget.

  Owners: feature:budget/detail 1.

  Sources: [src/core/paid/paidFeatures.ts](../../../src/core/paid/paidFeatures.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **command:museSpark.tabMenu**: Tab Menu

  Owners: feature:tab/name.

  Sources: [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:referenceTab**: Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic.

  Owners: feature:tab/summary; feature:tab/description.

  Sources: [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:paidJudgeName**: Judge

  Owners: feature:judge/name; feature:judge-subscription/name.

  Sources: [src/host/judge/judgeEntry.ts](../../../src/host/judge/judgeEntry.ts), [src/core/judge/same/modelApiSource.ts](../../../src/core/judge/same/modelApiSource.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/host/judge/museCodeSameJudge.ts](../../../src/host/judge/museCodeSameJudge.ts), [src/core/judge/same/sessionSpec.ts](../../../src/core/judge/same/sessionSpec.ts), [src/core/judge/same/allowRules.ts](../../../src/core/judge/same/allowRules.ts).

- **tip:paid:judge**: Turn paid Judge advice on or off.

  Owners: feature:judge/summary; feature:judge/description.

  Sources: [src/host/judge/judgeEntry.ts](../../../src/host/judge/judgeEntry.ts), [src/core/judge/same/modelApiSource.ts](../../../src/core/judge/same/modelApiSource.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **ui:judgeSubscriptionNotice**: Muse Judge uses your chat model on your Muse subscription and counts against its limits. Each batch uses a fresh isolated Plan session. A tool-item guard cancels the session, but cannot prove that no tool ran. It can only add caution.

  Owners: feature:judge-subscription/summary; feature:judge-subscription/description.

  Sources: [src/host/judge/museCodeSameJudge.ts](../../../src/host/judge/museCodeSameJudge.ts), [src/core/judge/same/sessionSpec.ts](../../../src/core/judge/same/sessionSpec.ts), [src/core/judge/same/allowRules.ts](../../../src/core/judge/same/allowRules.ts).

- **ui:groupSupport**: Support

  Owners: feature:support/name.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **tip:issue**: Report an issue.

  Owners: feature:support/summary; feature:support/description.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **ui:referenceSidebar**: Open the Muse Spark chat in the sidebar.

  Owners: command:museSpark.openInSidebar.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceFocus**: Move keyboard focus between the chat input and editor.

  Owners: command:museSpark.focusInput.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceTasks**: Open this conversation’s task list in a separate editor tab.

  Owners: command:museSpark.openTasks.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/TasksApp.tsx](../../../src/webview/TasksApp.tsx).

- **tip:focusView**: Hide the steps outside your focus.

  Owners: command:museSpark.toggleFocusView.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **ui:referenceSandbox**: On Windows, when this window uses the Muse Code shell sandbox, set it up with one administrator approval, then start a new conversation. shellSandbox="off" does not require setup.

  Owners: command:museSpark.setUpSandbox [platform=win32&shellSandbox].

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **tip:log**: Open output log.

  Owners: command:museSpark.showLogs.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **ui:referenceDiagnostics**: Show local backend and extension diagnostics.

  Owners: command:museSpark.diagnostics.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **ui:referenceReport**: Preview a scrubbed problem report before saving or sending it.

  Owners: command:museSpark.reportProblem.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **tip:clear**: Clear this conversation and start a new one.

  Owners: command:museSpark.newConversation.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **tip:signOut**: Sign out of Muse Spark on this computer.

  Owners: command:museSpark.signOut.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:referenceTerminal**: Open the Muse Code CLI in the editor’s terminal.

  Owners: command:museSpark.openInTerminal.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:referenceRules**: Create or open AGENTS.md in the workspace root.

  Owners: command:museSpark.createRulesFile.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/commands/insertMention.ts](../../../src/host/commands/insertMention.ts).

- **ui:referenceWalkthrough**: Open the Getting Started walkthrough.

  Owners: command:museSpark.openWalkthrough.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **tip:manageSkills**: Turn Muse Code's skills on or off.

  Owners: command:museSpark.manageSkills.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **tip:importSkills**: Copy your Claude Code or Codex skills into Muse Code.

  Owners: command:museSpark.importSkills.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **tip:export**: Save this conversation as a Markdown file.

  Owners: command:museSpark.exportConversation.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/exportConversation.ts](../../../src/host/conversation/exportConversation.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **tip:importSession**: Resume an exported session file on the Model API backend.

  Owners: command:museSpark.importSession.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/exportConversation.ts](../../../src/host/conversation/exportConversation.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **tip:openShare**: Read a shared session file, read-only.

  Owners: command:museSpark.openShareFile.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/exportConversation.ts](../../../src/host/conversation/exportConversation.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **tip:hooks**: Inspect project, user, managed and spark-hooks.json hook sources for the selected backend.

  Owners: command:museSpark.hooks.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts).

- **ui:referenceSetup**: Run Setup hooks for init from spark-hooks.json in a trusted workspace.

  Owners: command:museSpark.runSetupHooks; cli:setup/setup.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **tip:hookRun**: Run one of your Manual hooks from spark-hooks.json now.

  Owners: command:museSpark.runHook.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts).

- **ui:referenceRetry**: Retry preparation of the Windows job for plugin hooks.

  Owners: command:museSpark.retryPluginHooks.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts).

- **tip:removeWorktree**: Delete a worktree folder; its branch stays.

  Owners: command:museSpark.removeWorktree.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/worktreeCommands.ts](../../../src/host/commands/worktreeCommands.ts), [src/host/git/conversationGit.ts](../../../src/host/git/conversationGit.ts).

- **ui:stopAllTasksTitle**: Stop every background task of this conversation

  Owners: command:museSpark.stopBackgroundTasks.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/TasksApp.tsx](../../../src/webview/TasksApp.tsx).

- **ui:mcpRestartDetail**: A reply that is running stops; the conversation continues on your next message

  Owners: command:museSpark.restartMuseCode.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **ui:referenceInstallSkills**: Copy project_setup, feature_delivery and quality_retrofit into Muse Code's configuration and link them as skills.

  Owners: command:museSpark.installBundledSkills.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceRemoveSkills**: Remove only the extension-managed Muse Code skill copy and its links; leave other skills untouched.

  Owners: command:museSpark.removeBundledSkills.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **ui:referenceBrowserDownload**: Chrome for Testing: Download (Settings: museSpark.browserCheckRuntime).

  Owners: command:museSpark.downloadBrowserCheckRuntime.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **tip:whatsNew**: Open this version’s release highlights and full notes.

  Owners: command:museSpark.showWhatsNew.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **ui:referenceTabOn**: museSpark.modelApiTab=true. Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic.

  Owners: command:museSpark.tabTurnOn.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:referenceTabOff**: Turn Tab off: museSpark.modelApiTab=false.

  Owners: command:museSpark.tabTurnOff.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:referenceTabSnooze**: Snooze for 15 minutes; Snooze for an hour; Snooze until restart.

  Owners: command:museSpark.tabSnooze.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:referenceTabMenu**: Turn Tab off; Snooze for 15 minutes; Snooze for an hour; Snooze until restart; Tab languages…; Multi-line mode…; Account & usage. When Copilot causes Tab to yield, the menu also offers disabling Copilot for the current language or running both.

  Owners: command:museSpark.tabMenu [copilotYield].

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:referenceTabLanguages**: Choose a language to switch Tab suggestions on or off for it.

  Owners: command:museSpark.tabLanguages.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **ui:gitCheckoutItemDetail**: Check a pull request out in its own worktree and window

  Owners: command:museSpark.openPullRequestInConversation; slash:/checkout-pr/museCode; slash:/checkout-pr/modelApi.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/host/commands/worktreeCommands.ts](../../../src/host/commands/worktreeCommands.ts), [src/host/git/conversationGit.ts](../../../src/host/git/conversationGit.ts), [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:referenceIntro**: Commands, settings and features, with descriptions and documentation.

  Owners: command:museSpark.openHelp; slash:/help/museCode; slash:/help/modelApi; cli:help/help --all.

  Sources: [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts), [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **nls:config.preferredLocation.description**: Where Muse Spark: New Conversation opens a conversation when none is active.

  Owners: setting:museSpark.preferredLocation.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.preferredLocation.enumDescriptions.sidebar**: Open new conversations in the Muse Spark sidebar view.

  Owners: setting:museSpark.preferredLocation/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.preferredLocation.enumDescriptions.panel**: Open new conversations as editor tabs.

  Owners: setting:museSpark.preferredLocation/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.initialPermissionMode.description**: Permission mode for new conversations.

  Owners: setting:museSpark.initialPermissionMode.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.initialPermissionMode.enumDescriptions.manual**: museCode: Muse will ask before running commands; Muse Code edits workspace files without asking modelApi: Muse will ask for approval before each edit and each command

  Owners: setting:museSpark.initialPermissionMode/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.initialPermissionMode.enumDescriptions.acceptEdits**: museCode: On Muse Code, the same as Manual: Muse Code edits workspace files without asking and asks before running commands modelApi: Muse will edit files without asking and ask before running commands

  Owners: setting:museSpark.initialPermissionMode/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.initialPermissionMode.enumDescriptions.plan**: museCode: Muse plans first; Muse Code refuses commands, but its file tools can still edit files without asking modelApi: Muse will explore the code and present a plan before editing

  Owners: setting:museSpark.initialPermissionMode/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.initialPermissionMode.enumDescriptions.auto**: museCode (museSpark.museCodeAutoReviewer=false): Muse Code runs the commands it judges simple without asking and asks before the rest museCode (museSpark.museCodeAutoReviewer=true): Muse Code runs the commands it judges simple without asking; a reviewer may allow some others once, and you are asked about the rest modelApi (museSpark.modelApiAutoReviewer=false): Muse will edit files without asking, except protected files, and ask before commands modelApi (museSpark.modelApiAutoReviewer=true): Muse will edit files without asking, except protected files; a paid reviewer may allow some commands once, and you are asked about the rest These Auto descriptions concern requests not settled by rules. The Model API reviewer additionally requires paid consent and budget admission. A declined or failed review leaves the decision to you. Ordinary ACP has neither reviewer.

  Owners: setting:museSpark.initialPermissionMode/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.initialPermissionMode.enumDescriptions.bypassPermissions**: Bypass permissions: edits and commands run without asking, but paid uses still ask and forbid rules still refuse (use only in sandboxes).

  Owners: setting:museSpark.initialPermissionMode/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.archiveInactiveSessions.description**: Hide sessions idle for this many days from the History dialog (they stay on disk; Show archived lists them).

  Owners: setting:museSpark.archiveInactiveSessions.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.archiveInactiveSessions.enumDescriptions.1**: Hide sessions idle for a day.

  Owners: setting:museSpark.archiveInactiveSessions/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.archiveInactiveSessions.enumDescriptions.2**: Hide sessions idle for two days.

  Owners: setting:museSpark.archiveInactiveSessions/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.archiveInactiveSessions.enumDescriptions.7**: Hide sessions idle for a week.

  Owners: setting:museSpark.archiveInactiveSessions/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.archiveInactiveSessions.enumDescriptions.14**: Hide sessions idle for two weeks.

  Owners: setting:museSpark.archiveInactiveSessions/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.archiveInactiveSessions.enumDescriptions.0**: Never hide sessions.

  Owners: setting:museSpark.archiveInactiveSessions/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.cleanupPeriodDays.description**: Delete Meta Model API conversations idle for more than this many days when a window lists them; 0 keeps them for ever. Muse Code CLI sessions are kept by the CLI.

  Owners: setting:museSpark.cleanupPeriodDays.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/HistoryDialog.tsx](../../../src/webview/components/HistoryDialog.tsx), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.backend.description**: Which backend hosts conversations. The pasted Model API key is never handed to the Muse Code CLI, so subscription work is never billed to the key.

  Owners: setting:museSpark.backend.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.backend.enumDescriptions.auto**: Muse Code when the CLI is installed and signed in (billed to your Muse subscription); otherwise the Meta Model API when a key is stored; otherwise Muse Code's sign-in.

  Owners: setting:museSpark.backend/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.backend.enumDescriptions.museCode**: Always the Muse Code CLI, with its own sign-in.

  Owners: setting:museSpark.backend/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.backend.enumDescriptions.modelApi**: Always the Meta Model API with the key you pasted (pay as you go), using the extension's own tools.

  Owners: setting:museSpark.backend/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.shellSandbox.description**: Whether shell commands run inside Muse Code's OS sandbox. Changing it restarts the Muse Code host.

  Owners: setting:museSpark.shellSandbox.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.shellSandbox.enumDescriptions.auto**: Use Muse Code's OS sandbox for shell commands, except on Windows for a workspace under your user profile, where the sandbox cannot reliably run commands. Without the sandbox, commands run directly as you, still gated by approvals, and Muse Code's file tools can write outside the workspace without asking.

  Owners: setting:museSpark.shellSandbox/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.shellSandbox.enumDescriptions.muse**: Always use Muse Code's OS sandbox for shell commands.

  Owners: setting:museSpark.shellSandbox/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.shellSandbox.enumDescriptions.off**: Never sandbox shell commands: they run directly as you, gated by the approval cards, as in Claude Code. Muse Code's file tools can then also write anywhere outside the workspace without asking, in every mode.

  Owners: setting:museSpark.shellSandbox/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.sandboxNetwork.description**: The network Muse Code's shell sandbox gives commands. For commands it applies only while the sandbox is on (museSpark.shellSandbox); without the sandbox, commands have your network. Changing it restarts the Muse Code host. At restricted, Muse Code is also not offered the extension's web fetch, sandbox or not; the Model API backend's web fetch follows its permission modes instead.

  Owners: setting:museSpark.sandboxNetwork.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.sandboxNetwork.enumDescriptions.default**: Pass nothing: Muse Code's own default (proxy-only), or what your administrator's managed configuration sets.

  Owners: setting:museSpark.sandboxNetwork/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.sandboxNetwork.enumDescriptions.proxyOnly**: Ask before each new destination (host, port or protocol) a command connects to.

  Owners: setting:museSpark.sandboxNetwork/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.sandboxNetwork.enumDescriptions.restricted**: No network access for commands, and no web fetch from the extension for Muse Code.

  Owners: setting:museSpark.sandboxNetwork/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.sandboxNetwork.enumDescriptions.enabled**: Full network access for commands.

  Owners: setting:museSpark.sandboxNetwork/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.autosave.description**: Save every dirty editor before each turn.

  Owners: setting:museSpark.autosave.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.attachOpenFile.description**: Show the open-file chip and attach the active file (or its selection) to each message. Turn off to attach neither.

  Owners: setting:museSpark.attachOpenFile.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.useCtrlEnterToSend.description**: Send with Ctrl+Enter (Cmd+Enter on macOS) instead of Enter.

  Owners: setting:museSpark.useCtrlEnterToSend.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.hideOnboarding.description**: Hide the onboarding checklist in new conversations.

  Owners: setting:museSpark.hideOnboarding.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.focusView.description**: Focus view: hide tool calls and reasoning, show only prompts and responses.

  Owners: setting:museSpark.focusView.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.respectGitIgnore.description**: Exclude .gitignore patterns from file searches and @-mentions.

  Owners: setting:museSpark.respectGitIgnore.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/commands/insertMention.ts](../../../src/host/commands/insertMention.ts).

- **nls:config.confidentialWorkspace.description**: Treat this workspace as confidential: contributor-tier models (whose traffic Meta may use for training) are blocked.

  Owners: setting:museSpark.confidentialWorkspace.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.allowDangerouslySkipPermissions.description**: Allow dangerously skip permissions: list Bypass permissions in the Modes menu. Muse then edits files and runs commands without asking; use only in a sandbox.

  Owners: setting:museSpark.allowDangerouslySkipPermissions.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/shared/permissionModes.ts](../../../src/shared/permissionModes.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.museBinaryPath.description**: Absolute path to the Muse Code executable. Leave empty to discover it on PATH or in the default install directory.

  Owners: setting:museSpark.museBinaryPath.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.environmentVariables.description**: Environment variables set for the Muse Code process and the terminals that run the Muse Code CLI. Do not put API keys here; use the Sign in flow, which stores them in secret storage.

  Owners: setting:museSpark.environmentVariables.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.environmentVariables.name.description**: Variable name.

  Owners: setting:museSpark.environmentVariables/schema/items.properties.name.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.environmentVariables.value.description**: Variable value.

  Owners: setting:museSpark.environmentVariables/schema/items.properties.value.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.enableNewConversationShortcut.description**: Use Ctrl+N (Cmd+N on macOS) to start a new conversation while a Muse Spark panel is focused.

  Owners: setting:museSpark.enableNewConversationShortcut.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/shared/palette.ts](../../../src/shared/palette.ts).

- **nls:config.modelApiWebSearch.description**: Hosted web search ($2.50 per 1,000 searches); unavailable under a finite budget because no hard query bound is verified. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiWebSearch.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **nls:config.modelApiImageGeneration.description**: Image generation and editing ($0.01 per image). Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiImageGeneration.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts).

- **nls:config.modelApiVoice.description**: Offers Muse Voice ($0.18 per audio hour); free OS dictation remains the default. Muse Voice is unavailable under a finite budget. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiVoice.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/core/voice/museVoice.ts](../../../src/core/voice/museVoice.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts).

- **nls:config.modelApiPromptCacheRetention.description**: How long Meta is asked to keep the cached start of your Model API requests (the instructions, tools and conversation so far), which is billed at the lower cached-input rate. A hint: Meta may evict it sooner.

  Owners: setting:museSpark.modelApiPromptCacheRetention.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiPromptCacheRetention.enumDescriptions.inMemory**: Meta's default: kept in memory and evicted sooner, under load or after inactivity.

  Owners: setting:museSpark.modelApiPromptCacheRetention/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiPromptCacheRetention.enumDescriptions.24h**: Up to 24 hours, so a conversation you come back to after a pause still reads from the cache. Priced the same as in memory.

  Owners: setting:museSpark.modelApiPromptCacheRetention/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiScheduledPrompts.description**: Explicit scheduled Model API runs at the selected model’s token prices. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiScheduledPrompts.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/schedules.ts](../../../src/core/backends/modelapi/schedules.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.modelApiSubagents.description**: Bounded paid child agents, with up to four requests per task including retries. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiSubagents.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **nls:config.modelApiBestOfN.description**: Offers best-of-N as a separate explicit action. Ordinary turns use one model unless you choose more attempts. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiBestOfN.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/bestOfN/bestOfN.ts](../../../src/core/bestOfN/bestOfN.ts), [src/core/bestOfN/bestOfNCoordinator.ts](../../../src/core/bestOfN/bestOfNCoordinator.ts), [src/host/bestOfN/bestOfNManager.ts](../../../src/host/bestOfN/bestOfNManager.ts).

- **nls:config.modelApiHooks.description**: On by default; inert without a hooks file. Runs your configured commands outside the agent sandbox, only in trusted workspaces. Review them in Muse Spark: Hooks. Provider credentials are withheld.

  Owners: setting:museSpark.modelApiHooks.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/extension.ts](../../../src/extension.ts).

- **nls:config.modelApiShellKeepsDirectory.description**: Keep the Model API backend shell's working directory between calls. On by default: a cd in one shell command carries into the next call of the same conversation, and a directory outside the workspace resets to the workspace root. Check commands and then_run still run at the workspace root.

  Owners: setting:museSpark.modelApiShellKeepsDirectory.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/extension.ts](../../../src/extension.ts).

- **nls:config.modelApiHookModels.description**: Paid, on by default. On the Model API backend, prompt and agent hooks each ask the model before they answer. Each run asks once with its price, in every permission mode including Bypass, unless you allow model hooks always in this workspace. A hook's answer can only refuse, narrow or add context. Never billed to the subscription.

  Owners: setting:museSpark.modelApiHookModels.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidFeatures.ts](../../../src/core/paid/paidFeatures.ts).

- **nls:config.hookHttpAllowedHosts.description**: Hosts an http hook may call: exact names, or *.example.com for subdomains only. Empty by default, so no http hook runs. HTTPS only, no redirects, and only while the window's network setting allows the network. A repository cannot set this.

  Owners: setting:museSpark.hookHttpAllowedHosts.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/commands/museConfigCommands.ts](../../../src/host/commands/museConfigCommands.ts), [src/extension.ts](../../../src/extension.ts).

- **nls:config.diagnosticsAfterEdits.description**: After each round of edits, give the model the errors and warnings of up to 8 edited files from VS Code's language servers, with what changed since their previous check (Model API backend; none once the model writes a file the editor runs as code, until your next message), or tell Muse Code to check them itself. On by default.

  Owners: setting:museSpark.diagnosticsAfterEdits.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.checkCommands.description**: Lint, test or type-check commands the Model API backend runs after each round of edits, before the model's next request; the model can also run them with run_checks, and Muse Code is told to run them itself. Each runs as the shell tool runs a command, your tool hooks included: it asks wherever a shell command would ask (Manual, Edit automatically and Auto, unless one of your command rules allows it), asks again after the agent edits a file that decides what it runs unless a command rule allows it, never runs in Plan mode or Restricted Mode, and stops at its time limit. After three failing rounds in a row they stop until your next message.

  Owners: setting:museSpark.checkCommands.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.checkCommands.name.description**: A short name for the check, such as lint or test.

  Owners: setting:museSpark.checkCommands/schema/items.properties.name.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.checkCommands.command.description**: The command line, run in the workspace root by the shell tool's shell (PowerShell on Windows, bash elsewhere).

  Owners: setting:museSpark.checkCommands/schema/items.properties.command.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.checkCommands.changedFiles.description**: Add the edited files that still exist after --, each as one quoted argument. A file name that starts with - or @, holds a control character, or on Windows holds " & | &lt; &gt; ^ % or !, keeps the check from running.

  Owners: setting:museSpark.checkCommands/schema/items.properties.changedFiles.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.checkCommands.timeoutSeconds.description**: Seconds before the command is stopped (300 unless set).

  Owners: setting:museSpark.checkCommands/schema/items.properties.timeoutSeconds.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.formatOnEdit.description**: Run the file's formatter on each file the Model API backend's write_file or edit_file writes, before the file is checked, in a trusted workspace; never on a file the editor runs as code, and not at all once the model writes one, until your next message. Off by default.

  Owners: setting:museSpark.formatOnEdit.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **nls:config.notifyOnBackgroundTurn.description**: Show a notification when a long turn ends, or a turn waits for your approval or answer, while the VS Code window is unfocused. Nothing is ever shown while the window is focused.

  Owners: setting:museSpark.notifyOnBackgroundTurn.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/webview/TasksApp.tsx](../../../src/webview/TasksApp.tsx).

- **nls:config.modelApiReplyUsage.description**: On by default. Shows tokens and estimated cost under each Model API reply; display only.

  Owners: setting:museSpark.modelApiReplyUsage.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.modelApiSessionBudgetUsd.description**: Spend cap in US dollars for each Model API conversation; 0 means no cap. Shared durable reservations cover ordinary token requests and image fees before sending; a request that cannot fit what is left is not sent, and input estimates may differ from billed usage. Web search is unavailable while capped because its billed query count has no verified limit. Unknown sent requests keep their reservation; automatic retries after ambiguous failures are refused. Requires working session storage. Separate paid consent still applies. Paid Muse Voice is also unavailable with a cap because no billed-duration bound is verified; use system dictation. Child requests are counted when usage is reported, without reserving against the parent cap, and can exceed it.

  Owners: setting:museSpark.modelApiSessionBudgetUsd.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/webview/components/UsageDialog.tsx](../../../src/webview/components/UsageDialog.tsx), [src/host/auth/accountHost.ts](../../../src/host/auth/accountHost.ts).

- **nls:config.modelApiRepoMap.description**: Add a repo map to the Model API backend's system prompt in a trusted workspace: the workspace's most used files and definitions, ranked with VS Code's language services, made once per conversation in about 1,000 tokens. Off by default: it adds those tokens to every request, billed to your Model API key. Either way, the repo_map tool makes a fresh map on request.

  Owners: setting:museSpark.modelApiRepoMap.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/codeIntel/repoMap.ts](../../../src/core/codeIntel/repoMap.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiObservationPacking.description**: On by default. Packs old long tool outputs after two requests; recall_output reads the originals. The M75 evaluation passed. Read when a conversation starts or resumes.

  Owners: setting:museSpark.modelApiObservationPacking.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/codeIntel/repoMap.ts](../../../src/core/codeIntel/repoMap.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.turnCheckpoints.description**: On by default: keeps the model’s own file, image, workspace memory and symbol-rename tool writes for Restore files and Redo in a connected Model API session, while files still hold exactly what the model left. Never undoes changes by commands, hooks, MCP tools, you or other windows; copies stay in extension storage, outside the workspace’s .git. Needs git on PATH and a trusted workspace.

  Owners: setting:museSpark.turnCheckpoints.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/checkpoints/toolWrites.ts](../../../src/core/checkpoints/toolWrites.ts), [src/host/checkpoints/checkpointHost.ts](../../../src/host/checkpoints/checkpointHost.ts).

- **nls:config.bundledSkills.description**: On by default: the skills that come with Muse Spark (project_setup, feature_delivery and quality_retrofit, from the high-quality-projects package) are available on the Model API backend, after any project or personal skill with the same name. Muse Code reads only its own folders, so for it they are installed with Muse Spark: Install Bundled Skills for Muse Code, which a Muse Code conversation offers once per window until you install them or choose Not now. Their delivery helpers need Python 3.12 or newer.

  Owners: setting:museSpark.bundledSkills.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/commands/skillsCommands.ts](../../../src/host/commands/skillsCommands.ts), [src/host/skills/bundledSkills.ts](../../../src/host/skills/bundledSkills.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.showWhatsNewOnUpdate.description**: On by default: after the extension updates, What's New opens in an editor tab when the release has highlights; after a fixes-only patch, a quiet notification offers it instead. Off shows nothing on updates; Muse Spark: What's New still opens it.

  Owners: setting:museSpark.showWhatsNewOnUpdate.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/extension.ts](../../../src/extension.ts), [src/shared/reference/referenceEntry.ts](../../../src/shared/reference/referenceEntry.ts), [src/shared/cliCommands.ts](../../../src/shared/cliCommands.ts).

- **nls:config.modelApiCommandRules.markdownDescription**: Model API backend: your command rules for the shell tool. Each rule has the words a command starts with (`pattern`), a `decision` (`allow`, `ask` or `forbid`), optionally the `shell` it is for and a `justification`, and the command lines it must match (`match`) and must not match (`notMatch`), which are checked whenever the rules are read. A forbid or ask rule matches its words anywhere in a command line; an allow rule runs only one plain command that begins with its words, so a chain, a pipeline, an evaluator, or a line with a substitution, a redirection, a background `&` or a newline still asks. Forbid refuses in every mode, Bypass included. User and machine settings only. An allow rule permits only one plain command. Chains, pipelines and evaluators require a user decision.

  Owners: setting:museSpark.modelApiCommandRules.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/permissions.ts](../../../src/core/backends/modelapi/permissions.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiPermissionProfiles.markdownDescription**: Model API backend: named permission profiles. Each can list `denyRead` globs (workspace-relative paths the file tools must neither read, list, search nor write) and `extraRoots` (absolute folders `read_file` may read outside the workspace). Choose one with `museSpark.modelApiPermissionProfile`. User and machine settings only.

  Owners: setting:museSpark.modelApiPermissionProfiles.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/permissions.ts](../../../src/core/backends/modelapi/permissions.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiPermissionProfile.markdownDescription**: Model API backend: the permission profile in force, by its name in `museSpark.modelApiPermissionProfiles`; empty for none. While a profile is on, every shell command and MCP tool call asks in Manual, Edit automatically and Auto (Plan refuses shell commands and all but read-only MCP tools; Bypass permissions runs them), since the shell and MCP servers run outside the profile's file rules. User and machine settings only.

  Owners: setting:museSpark.modelApiPermissionProfile.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/permissions.ts](../../../src/core/backends/modelapi/permissions.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiRepositoryRules.markdownDescription**: Model API backend: rules a repository can add in its `.vscode/settings.json`: `commandRules` that ask or forbid, and `denyRead` globs. They can only tighten your own rules, so an allow rule here is not applied.

  Owners: setting:museSpark.modelApiRepositoryRules.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/permissions.ts](../../../src/core/backends/modelapi/permissions.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.modelApiAutoReviewer.description**: In Auto, a paid review judges unresolved risky actions; it cannot override forbidden commands, protected writes or required questions. Available by default on Model API. Before spending, asks Allow once / Allow always in this workspace / Deny with the price and shared daily budget. Explicit false disables it.

  Owners: setting:museSpark.modelApiAutoReviewer.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **nls:config.museCodeAutoReviewer.description**: On by default. In Auto on Muse Code, only approvals for the running turn that no rule settles are eligible: one short Muse Code turn on your subscription in a hidden Plan session. Protected writes, paid calls, child tasks, questions, replayed or escalated requests, unknown subjects, requests without allow-once and sessions shared by panels are never reviewed. A successful review may allow once; declines, failures, busy sessions, timeouts or a tripped breaker show the approval card. Host exit recreates the side session.

  Owners: setting:museSpark.museCodeAutoReviewer.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts), [src/host/review/reviewedApprovals.ts](../../../src/host/review/reviewedApprovals.ts).

- **nls:config.browserCheckExtraHosts.description**: Hosts beyond this computer that the browser check may open and reach, as plain host names or IP addresses, with no port, path or wildcard; listing a loopback name also lets a local page use https and WebSockets. Empty means plain-http local pages only, unless you allow a host on a card or in the confirmation, for that one check. https and WebSocket traffic to a listed host is encrypted and not inspected, and a site there may sign in as you with this computer’s account (on Windows in particular). Only you can widen this, never the model, and a repository’s settings cannot.

  Owners: setting:museSpark.browserCheckExtraHosts.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.browserCheckRuntime.description**: How the browser check gets its browser: Google’s Chrome for Testing headless shell, pinned to this extension version and downloaded from storage.googleapis.com into the extension’s storage (about 100 to 120 MB for each pinned version). Only you can change this, never a repository’s settings.

  Owners: setting:museSpark.browserCheckRuntime.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.browserCheckRuntime.enumDescriptions.ask**: Ask before downloading it.

  Owners: setting:museSpark.browserCheckRuntime/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.browserCheckRuntime.enumDescriptions.download**: Download it when a check needs it, without asking, now and for every later pinned version.

  Owners: setting:museSpark.browserCheckRuntime/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.browserCheckRuntime.enumDescriptions.off**: No browser check: the tool is not offered and nothing is downloaded.

  Owners: setting:museSpark.browserCheckRuntime/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/browser/browserChecks.ts](../../../src/host/browser/browserChecks.ts), [src/core/backends/modelapi/ModelApiHost.ts](../../../src/core/backends/modelapi/ModelApiHost.ts).

- **nls:config.paidDailyBudgetUsd.description**: Shared daily budget in USD for interactive paid Model API extras, across windows and keys. Default 5.00; range 0.50–500. Reserves before sending and refuses unreadable storage. Tab’s separate budget is not included. ACP and headless flags and budgets are unchanged.

  Owners: setting:museSpark.paidDailyBudgetUsd.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/paid/paidFeatures.ts](../../../src/core/paid/paidFeatures.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts).

- **nls:config.dictationEngine.description**: Dictation engine on Model API. Free OS recognizer is the default; choosing Muse Voice requires paid-use consent and verified budget admission. Muse Code’s explicit voice opt-in is unchanged.

  Owners: setting:museSpark.dictationEngine.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/core/voice/helperLocation.ts](../../../src/core/voice/helperLocation.ts), [src/core/voice/museVoice.ts](../../../src/core/voice/museVoice.ts), [src/host/voice/dictationHost.ts](../../../src/host/voice/dictationHost.ts).

- **nls:config.modelApiTab.description**: Tab uses the stored Model API key on either chat backend. The default trigger is Invoke; automatic typing suggestions require Automatic. Hard daily budget in US dollars for Tab completion requests across every window on this machine; a request whose worst case would pass it is not sent. From $0.05 to $50. Allow once / Allow always in this workspace.

  Owners: setting:museSpark.modelApiTab.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabModel.description**: The model Tab completion requests use. Standard costs more per token; Meta does not train on what it is sent. The contributor model is cheaper per token, and Meta trains on the code it is sent.

  Owners: setting:museSpark.tabModel.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabModel.enumDescriptions.standard**: muse-spark-1.3: Standard rates, no training on your code.

  Owners: setting:museSpark.tabModel/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabModel.enumDescriptions.contributor**: muse-spark-1.3-contributor: contributor rates, Meta trains on the code it is sent.

  Owners: setting:museSpark.tabModel/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabDailyBudgetUsd.description**: Hard daily budget in US dollars for Tab completion requests across every window on this machine; a request whose worst case would pass it is not sent. From $0.05 to $50.

  Owners: setting:museSpark.tabDailyBudgetUsd.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabLanguages.description**: The languages Tab suggests in, shaped like GitHub Copilot's github.copilot.enable: every language is on except plaintext, markdown and scminput unless listed otherwise here.

  Owners: setting:museSpark.tabLanguages.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabMultiline.description**: When Tab adds surrounding context for multi-line completions.

  Owners: setting:museSpark.tabMultiline.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabMultiline.enumDescriptions.auto**: Multi-line when the cursor's line is blank or ends in a block opener, and on every explicit Invoke.

  Owners: setting:museSpark.tabMultiline/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabMultiline.enumDescriptions.onInvoke**: Multi-line context only on explicit Invoke.

  Owners: setting:museSpark.tabMultiline/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabMultiline.enumDescriptions.never**: Never add multi-line context; complete the rest of the line only.

  Owners: setting:museSpark.tabMultiline/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabTrigger.description**: Whether Tab suggests automatically while you type or only when you invoke it.

  Owners: setting:museSpark.tabTrigger.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabTrigger.enumDescriptions.automatic**: Suggest automatically after a short debounce.

  Owners: setting:museSpark.tabTrigger/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabTrigger.enumDescriptions.onInvoke**: Suggest only when you invoke suggestions by hand.

  Owners: setting:museSpark.tabTrigger/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabWithCopilot.description**: What Tab does where GitHub Copilot also suggests.

  Owners: setting:museSpark.tabWithCopilot.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabWithCopilot.enumDescriptions.yield**: Send no automatic Tab request for a language Copilot serves; explicit Invoke still works.

  Owners: setting:museSpark.tabWithCopilot/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.tabWithCopilot.enumDescriptions.both**: Send automatic Tab requests even where Copilot serves the language.

  Owners: setting:museSpark.tabWithCopilot/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/tab/tabStatus.ts](../../../src/host/tab/tabStatus.ts), [src/host/tab/tabEntry.ts](../../../src/host/tab/tabEntry.ts).

- **nls:config.judge.engine.description**: `auto` (your own chat model; `same` in phase 1) and `same` can only add caution to a risky Auto action no rule settles: a ready caution turns an allow into a question, or into a note on the approval card. `off` runs no judge. On the Model API backend each judgment bills your key and asks once first; on Muse Code it runs on your subscription.

  Owners: setting:museSpark.judge.engine.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/judge/judgeEntry.ts](../../../src/host/judge/judgeEntry.ts), [src/core/judge/same/modelApiSource.ts](../../../src/core/judge/same/modelApiSource.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/host/judge/museCodeSameJudge.ts](../../../src/host/judge/museCodeSameJudge.ts), [src/core/judge/same/sessionSpec.ts](../../../src/core/judge/same/sessionSpec.ts), [src/core/judge/same/allowRules.ts](../../../src/core/judge/same/allowRules.ts).

- **nls:config.judge.engine.enumDescriptions.auto**: Your own chat model judges (`same` in phase 1); a separate judge joins it once one is configured.

  Owners: setting:museSpark.judge.engine/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/judge/judgeEntry.ts](../../../src/host/judge/judgeEntry.ts), [src/core/judge/same/modelApiSource.ts](../../../src/core/judge/same/modelApiSource.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/host/judge/museCodeSameJudge.ts](../../../src/host/judge/museCodeSameJudge.ts), [src/core/judge/same/sessionSpec.ts](../../../src/core/judge/same/sessionSpec.ts), [src/core/judge/same/allowRules.ts](../../../src/core/judge/same/allowRules.ts).

- **nls:config.judge.engine.enumDescriptions.same**: Only your own chat model judges; it never switches models.

  Owners: setting:museSpark.judge.engine/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/judge/judgeEntry.ts](../../../src/host/judge/judgeEntry.ts), [src/core/judge/same/modelApiSource.ts](../../../src/core/judge/same/modelApiSource.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/host/judge/museCodeSameJudge.ts](../../../src/host/judge/museCodeSameJudge.ts), [src/core/judge/same/sessionSpec.ts](../../../src/core/judge/same/sessionSpec.ts), [src/core/judge/same/allowRules.ts](../../../src/core/judge/same/allowRules.ts).

- **nls:config.judge.engine.enumDescriptions.off**: No judge: approvals behave exactly as without one.

  Owners: setting:museSpark.judge.engine/enum.

  Sources: [src/host/settings.ts](../../../src/host/settings.ts), [src/host/judge/judgeEntry.ts](../../../src/host/judge/judgeEntry.ts), [src/core/judge/same/modelApiSource.ts](../../../src/core/judge/same/modelApiSource.ts), [src/core/paid/paidConsent.ts](../../../src/core/paid/paidConsent.ts), [src/host/judge/museCodeSameJudge.ts](../../../src/host/judge/museCodeSameJudge.ts), [src/core/judge/same/sessionSpec.ts](../../../src/core/judge/same/sessionSpec.ts), [src/core/judge/same/allowRules.ts](../../../src/core/judge/same/allowRules.ts).

- **ui:resumeDetail**: Pick a previous conversation in this workspace

  Owners: slash:/resume/museCode; slash:/resume/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:gitCommitItemDetail**: Commit the changes in this workspace; a message is written only when you ask

  Owners: slash:/commit/museCode [userRequestedMessage]; slash:/commit/modelApi [userRequestedMessage].

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:gitPushItemDetail**: Push this branch; always asks, never forces

  Owners: slash:/push/museCode; slash:/push/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:gitPullRequestItemDetail**: On GitHub, as a draft or ready, linked to this conversation

  Owners: slash:/pr/museCode; slash:/pr/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:switchModel**: Switch model…

  Owners: slash:/model/museCode; slash:/model/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:permissionModeTitle**: Permission mode

  Owners: slash:/permissions/museCode; slash:/permissions/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:mcpItemDetail**: What Muse Code connects to; sign in to a server

  Owners: slash:/mcp/museCode.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:mcpItemDetailModelApi**: The servers in Muse Code’s settings, run by this window

  Owners: slash:/mcp/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:memoryItemDetail**: The notes Muse keeps for later sessions

  Owners: slash:/memory/museCode; slash:/memory/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:openSettings**: Open settings…

  Owners: slash:/config/museCode; slash:/config/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:manualHookSlashDetail**: Run a Manual hook from spark-hooks.json

  Owners: slash:/hook run/museCode; slash:/hook run/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:agentsCommandDetail**: Show the agent map

  Owners: slash:/agents/museCode; slash:/agents/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:compactDetail**: Summarise older context to free the window

  Owners: slash:/compact/museCode; slash:/compact/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:handoffDetail**: Distil this conversation into a brief for a fresh one

  Owners: slash:/handoff/museCode; slash:/handoff/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:goalItemDetail**: Set a goal Muse keeps working toward: /goal &lt;objective&gt;

  Owners: slash:/goal/museCode; slash:/goal/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:exportDetail**: Save this conversation as a Markdown file

  Owners: slash:/export/museCode; slash:/export/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:clearConversation**: Clear conversation

  Owners: slash:/clear/museCode; slash:/clear/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:signOutItem**: Sign out

  Owners: slash:/logout/museCode; slash:/logout/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:usageCommandDetail**: Show account usage

  Owners: slash:/usage/museCode; slash:/usage/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:costCommandDetail**: Show this conversation’s token totals

  Owners: slash:/cost/museCode; slash:/cost/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:reviewItemDetail**: Review the uncommitted changes, a branch, a commit, or what you describe

  Owners: slash:/review/museCode; slash:/review/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:reviewSecurityDetail**: The uncommitted changes, for injection, secrets, authentication and unsafe APIs

  Owners: slash:/security-review/museCode; slash:/security-review/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:loopItemDetail**: Schedule a prompt in this Model API conversation

  Owners: slash:/loop/modelApi.

  Sources: [src/shared/palette.ts](../../../src/shared/palette.ts), [src/shared/slashCommands.ts](../../../src/shared/slashCommands.ts), [src/host/conversation/conversationController.ts](../../../src/host/conversation/conversationController.ts).

- **ui:referenceServe**: {command} [options] Serve the Agent Client Protocol on stdin and stdout

  Owners: cli:serve/[options].

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:acpAuthMuseCodeDetail**: Runs Muse Code’s own sign-in in a terminal. Your Muse subscription pays for the conversations.

  Owners: cli:login/login.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:acpAuthKeyDetail**: Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations.

  Owners: cli:authSet/auth set.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceAuthStatus**: Check whether a Model API key is stored.

  Owners: cli:authStatus/auth status.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceAuthClear**: Remove the stored Model API key.

  Owners: cli:authClear/auth clear.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceExecContract**: Headless runs refuse workspace trust and bypass permissions. Headless runs permit only plan or acceptEdits. Hosted web search has no bounded allowance and is refused. Image generation requires acceptEdits. Choose exactly one prompt source. Prompt and key cannot both use stdin. Model API requires --max-budget-usd. modelApi: --max-budget-usd / --max-requests / --ephemeral / --key-stdin / --image-generation; museCode: --muse-binary / --shell-sandbox; --untrusted-file: data; --fail-on-denial; --ephemeral: memory-only; --output: text/json/jsonl; --cwd: workspace.

  Owners: cli:exec/exec; cli:exec/exec: --trust-workspace; cli:exec/exec: --allow-dangerously-skip-permissions; cli:exec/exec: --web-search; cli:exec/exec <prompt> | exec - | exec --prompt-file <file>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceScanSecrets**: Scan a UTF-8 patch file for secrets and fail on detection. --key-stdin also checks for the exact in-memory Model API key; no key is stored.

  Owners: cli:scan-secrets/scan-secrets.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts), [src/runtime/exec/scanSecrets.ts](../../../src/runtime/exec/scanSecrets.ts).

- **ui:reportUsage**: Usage: {command} report [--out &lt;file&gt;] [--description &lt;text&gt;] [--no-facts] [--no-events] Prints the scrubbed problem report to stdout, or writes it to &lt;file&gt; with --out. Starts no backend, signs in nowhere, and opens no browser. Options: --out &lt;file&gt; Write the report to a file instead of stdout --description &lt;text&gt; What was happening, in your own words --no-facts Leave the support facts out --no-events Leave the recent events out

  Owners: cli:report/report.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceBriefHelp**: help / --help / -h: ACP / CLI. help --all: Commands, settings and features, with descriptions and documentation.

  Owners: cli:help/help / --help / -h.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceVersion**: Print the installed agent version.

  Owners: cli:version/--version / -v.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:backend**: --backend museCode|modelApi Who pays: Muse Code (the default) or the Model API key

  Owners: cli:serve/serve: --backend <value>; cli:login/login: --backend <value>; cli:setup/setup: --backend <value>; cli:authSet/authSet: --backend <value>; cli:authStatus/authStatus: --backend <value>; cli:authClear/authClear: --backend <value>; cli:exec/exec: --backend <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:trust-workspace**: --trust-workspace Load the folder’s rules, skills and memory

  Owners: cli:serve/serve: --trust-workspace; cli:login/login: --trust-workspace; cli:setup/setup: --trust-workspace; cli:authSet/authSet: --trust-workspace; cli:authStatus/authStatus: --trust-workspace; cli:authClear/authClear: --trust-workspace.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:maintenance**: Run the Setup maintenance event instead of init.

  Owners: cli:serve/serve: --maintenance; cli:login/login: --maintenance; cli:setup/setup: --maintenance; cli:authSet/authSet: --maintenance; cli:authStatus/authStatus: --maintenance; cli:authClear/authClear: --maintenance.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:muse-binary**: --muse-binary &lt;path&gt; The Muse Code CLI to run

  Owners: cli:serve/serve: --muse-binary <value>; cli:login/login: --muse-binary <value>; cli:setup/setup: --muse-binary <value>; cli:authSet/authSet: --muse-binary <value>; cli:authStatus/authStatus: --muse-binary <value>; cli:authClear/authClear: --muse-binary <value>; cli:exec/exec: --muse-binary <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:shell-sandbox**: --shell-sandbox auto|muse|off Muse Code’s shell sandbox

  Owners: cli:serve/serve: --shell-sandbox <value>; cli:login/login: --shell-sandbox <value>; cli:setup/setup: --shell-sandbox <value>; cli:authSet/authSet: --shell-sandbox <value>; cli:authStatus/authStatus: --shell-sandbox <value>; cli:authClear/authClear: --shell-sandbox <value>; cli:exec/exec: --shell-sandbox <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:allow-dangerously-skip-permissions**: --allow-dangerously-skip-permissions Offer the Bypass permissions mode

  Owners: cli:serve/serve: --allow-dangerously-skip-permissions; cli:login/login: --allow-dangerously-skip-permissions; cli:setup/setup: --allow-dangerously-skip-permissions; cli:authSet/authSet: --allow-dangerously-skip-permissions; cli:authStatus/authStatus: --allow-dangerously-skip-permissions; cli:authClear/authClear: --allow-dangerously-skip-permissions.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:allow-contributor-models**: --allow-contributor-models List contributor-tier models (Meta may train on their content)

  Owners: cli:serve/serve: --allow-contributor-models; cli:login/login: --allow-contributor-models; cli:setup/setup: --allow-contributor-models; cli:authSet/authSet: --allow-contributor-models; cli:authStatus/authStatus: --allow-contributor-models; cli:authClear/authClear: --allow-contributor-models; cli:exec/exec: --allow-contributor-models.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:web-search**: --web-search Offer paid web search (Model API backend; its price is asked first)

  Owners: cli:serve/serve: --web-search; cli:login/login: --web-search; cli:setup/setup: --web-search; cli:authSet/authSet: --web-search; cli:authStatus/authStatus: --web-search; cli:authClear/authClear: --web-search.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:image-generation**: --image-generation Offer paid image generation (Model API backend; its price is asked first)

  Owners: cli:serve/serve: --image-generation; cli:login/login: --image-generation; cli:setup/setup: --image-generation; cli:authSet/authSet: --image-generation; cli:authStatus/authStatus: --image-generation; cli:authClear/authClear: --image-generation.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:verbose**: --verbose Log every detail on stderr

  Owners: cli:serve/serve: --verbose; cli:login/login: --verbose; cli:setup/setup: --verbose; cli:authSet/authSet: --verbose; cli:authStatus/authStatus: --verbose; cli:authClear/authClear: --verbose; cli:exec/exec: --verbose.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:help**: help / --help / -h: ACP / CLI. help --all: Commands, settings and features, with descriptions and documentation.

  Owners: cli:serve/serve: --help / -h; cli:login/login: --help / -h; cli:setup/setup: --help / -h; cli:authSet/authSet: --help / -h; cli:authStatus/authStatus: --help / -h; cli:authClear/authClear: --help / -h; cli:exec/exec: --help / -h; cli:scan-secrets/scan-secrets: --help / -h; cli:report/report: --help / -h.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts), [src/runtime/exec/scanSecrets.ts](../../../src/runtime/exec/scanSecrets.ts).

- **cli:version**: Print the installed agent version.

  Owners: cli:serve/serve: --version / -v; cli:login/login: --version / -v; cli:setup/setup: --version / -v; cli:authSet/authSet: --version / -v; cli:authStatus/authStatus: --version / -v; cli:authClear/authClear: --version / -v.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:cwd**: Use this directory as the workspace.

  Owners: cli:exec/exec: --cwd <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:prompt-file**: Read the prompt from this file.

  Owners: cli:exec/exec: --prompt-file <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:untrusted-file**: Attach this file as untrusted data; repeat the option for more files.

  Owners: cli:exec/exec: --untrusted-file <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:permission-mode**: Choose how Muse asks before it acts.

  Owners: cli:exec/exec: --permission-mode <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:model**: Choose the model for this run.

  Owners: cli:exec/exec: --model <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:effort**: Choose how much effort Muse puts into each reply.

  Owners: cli:exec/exec: --effort <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:output**: Choose the result format: text, json or jsonl.

  Owners: cli:exec/exec: --output <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:max-budget-usd**: Set the hard spending limit in USD for this run.

  Owners: cli:exec/exec: --max-budget-usd <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:max-requests**: Set the maximum number of model requests.

  Owners: cli:exec/exec: --max-requests <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:timeout**: Set the run deadline in seconds.

  Owners: cli:exec/exec: --timeout <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceExecImages**: Headless images require --image-generation, acceptEdits and an affordable hard budget. No price question is shown; requests requiring permission are refused.

  Owners: cli:exec/exec: --image-generation.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:fail-on-denial**: Stop the run when a permission request is denied.

  Owners: cli:exec/exec: --fail-on-denial [permission=denied].

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:ephemeral**: Keep the session in memory without saving it.

  Owners: cli:exec/exec: --ephemeral.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:key-stdin**: auth set: Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations. exec / scan-secrets --key-stdin: Read the key from a pipe, not a terminal. stdin → memory; prompt stdin + key stdin = Prompt and key cannot both use stdin.

  Owners: cli:exec/exec: --key-stdin; cli:scan-secrets/scan-secrets: --key-stdin.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts), [src/runtime/exec/scanSecrets.ts](../../../src/runtime/exec/scanSecrets.ts).

- **cli:out**: --out &lt;file&gt; Write the report to a file instead of stdout

  Owners: cli:report/report: --out <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:description**: --description &lt;text&gt; What was happening, in your own words

  Owners: cli:report/report: --description <value>.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:no-facts**: --no-facts Leave the support facts out

  Owners: cli:report/report: --no-facts.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **cli:no-events**: --no-events Leave the recent events out

  Owners: cli:report/report: --no-events.

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts).

- **ui:referenceKeyStdin**: auth set: Reads your key in a terminal and keeps it in this computer’s credential store. The key is billed for the conversations. exec / scan-secrets --key-stdin: Read the key from a pipe, not a terminal. stdin → memory; prompt stdin + key stdin = Prompt and key cannot both use stdin.

  Owners: cli:scan-secrets/scan-secrets <file> [--key-stdin].

  Sources: [src/runtime/cliArgs.ts](../../../src/runtime/cliArgs.ts), [src/runtime/cliOptions.ts](../../../src/runtime/cliOptions.ts), [src/runtime/exec/scanSecrets.ts](../../../src/runtime/exec/scanSecrets.ts).

- **ui:referenceSendKeys**: Send the draft using the gesture selected by useCtrlEnterToSend.

  Owners: shortcut:composer.send.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceNewlineKeys**: Insert a new line in the draft.

  Owners: shortcut:composer.newline.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceDictationKeys**: records your voice into the composer (tap to toggle, hold to talk)

  Owners: shortcut:composer.dictation.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceModeKeys**: cycles the permission mode while the composer has focus

  Owners: shortcut:composer.permission.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceMenuKeys**: Navigate items, choose or complete a selection, or close the list.

  Owners: shortcut:composer.mention; shortcut:composer.slash.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceMicKeys**: records your voice into the composer (tap to toggle, hold to talk)

  Owners: shortcut:composer.mic.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceArchiveKeys**: Archive / Unarchive

  Owners: shortcut:history.archive.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referencePaletteKeys**: Navigate items, choose or complete a selection, or close the list. Choose how much effort Muse puts into each reply.

  Owners: shortcut:palette.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referencePopoverKeys**: Navigate options, adjust a value, choose an option or close the popover.

  Owners: shortcut:popover.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceDialogKeys**: Browse matches, activate the selected conversation or close the dialog.

  Owners: shortcut:dialog.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceRowKeys**: ContextMenu / Shift+F10: More actions

  Owners: shortcut:row.menu.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceRadialKeys**: Navigate actions, jump to the first or last, activate an action, or close or return to the parent menu.

  Owners: shortcut:radial.menu.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceRenameKeys**: Confirm or cancel renaming this conversation.

  Owners: shortcut:header.rename.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceModalKeys**: Close the dialog or move focus within it.

  Owners: shortcut:modal.focus; shortcut:deferred.close; shortcut:bestOfN.close.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceAgentKeys**: Send message

  Owners: shortcut:agent.message.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceOutputKeys**: Open output

  Owners: shortcut:output.open.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceGoalKeys**: Cancel

  Owners: shortcut:goal.edit.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).

- **ui:referenceElicitationKeys**: Cancel

  Owners: shortcut:elicitation.

  Sources: [src/shared/keybindings.ts](../../../src/shared/keybindings.ts), [src/webview/components/Modal.tsx](../../../src/webview/components/Modal.tsx).
