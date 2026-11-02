# The unproven-backlog scenario index

`unproven.md` (this folder) lists every behaviour whose tests were deleted
under the no-fakes rule: each waits for proof by real use of the packed
product. This index maps every backlog section to how it is proven. A
behaviour leaves `unproven.md` only when the lead's run proves it; this
lane adds the scenarios and the index, and marks nothing proven.

Dispositions:

- `RUN <file>` — a new scenario under `scripts/real-life/scenarios/`,
  with its declared requests and dollar cap. The lead runs it.
- `OLD <file>` — one of the twelve older scenarios already covers it.
- `MANUAL` — the lead proves it by hand through the packed product; the
  steps follow. Nothing here is clickable by the runner (a VS Code panel,
  a browser, an OAuth dance, fault injection, another locale).
- `HOSTED` — only hosted CI or a vendor receipt can prove it.
- `GATE` — a repository gate already proves it on every run.
- `READ` — the lead reads the shipped words against the packed product.
- `GONE` — the code it tested was deleted too; there is nothing to prove.
- `INFRA` — unit math behind a behaviour a run proves in composition; the
  adversarial halves (races, corrupt stores, hostile files) stay `MANUAL`.

Shared setups, named so the steps stay short:

- `SETUP-VSCODE` — install the packed `.vsix` in VS Code with a fresh
  user-data folder, open a new empty workspace, sign in on the Model API
  backend, cheapest contributor model.
- `SETUP-ACP` — install the packed agent tarball, open it from an editor
  over ACP in a new empty workspace, same backend and model.
- `SETUP-TEAM` — `SETUP-ACP`, then tick a second runnable model, so a
  headless team passes the two-model rule.
- `SETUP-ADMIN` — provider keys with admin scopes for spend reads
  (OpenAI admin key; the owner holds them).

Model costs below are estimates on the cheapest models (about $0.003 a
request); caps are bounds, and every `RUN` file declares its own.

## Deleted test files

### test/e2e/acpStdio.e2e.test.ts

- `prints its version and help, and refuses an argument it does not know`
  → `RUN m63-agent-identity` (0 req, $0.00).
- `binds saved prompts and sharing help over real ACP stdio without a model
send (M118)` → `RUN m118-prompts-share` (0 req, $0.00).
- `streams a reply, runs an allowed tool call and skips a denied one` →
  `OLD plain-turn`, `OLD tool-write`, `OLD refused-approval`.
- `cancels a running turn and lists the session afterwards` → `OLD cancel`,
  `OLD session-continues`.
- `mcpServersFrom (M57)` → `MANUAL`: `SETUP-ACP` with an MCP server in the
  person's own Muse Code settings and one forbidden id; start a session,
  confirm the allowed server's tools are offered and the forbidden id is
  refused with its sentence (1 turn, ~$0.01).
- `FIXM95X` (environment credentials are not a sign-in) → `MANUAL`: with
  `META_API_KEY` set in the shell, start the agent; confirm the agent does
  not treat it as a sign-in and `auth status` still asks for sign-in ($0).
- `asks for sign-in when Muse Code is signed out, and for the key on the
Model API backend` → `RUN m95-accounts-auth` (0 req, $0.00) for the read
  side; `MANUAL` for the interactive ask: sign out of Muse Code on a rig
  (never the owner's machine), start the agent, confirm it asks for
  sign-in instead of failing silently ($0).
- `asks for sign-in after muse logout` → `MANUAL`: same rig, `muse logout`,
  confirm the next turn asks for sign-in ($0).
- `reads readiness from the credential file, asks the CLI where only it can
say, sign-in state transitions (PR #49)` → `RUN m95-accounts-auth`
  (0 req, $0.00) for status/list; `MANUAL`: corrupt nothing, but read
  `auth status` against a credential file with `meta` in each lane
  (api_key, access_token, none) and confirm the readiness follows the file
  ($0).
- `ships the Model API backend beside the agent` → proven by the install
  itself: every provider-route cell turns on it. No separate run.
- `Q66 says at start that a proxy will not be used under a proxy-bearing
environment` → `MANUAL`: start the agent with `HTTPS_PROXY` set;
  confirm the start-up notice names the proxy as unused ($0).
- `offers terminal sign-in for auth.terminal and for the older _meta flag,
and to no one else` → `MANUAL`: drive the ACP sign-in registry flow for
  an `auth.terminal` account and confirm the terminal sign-in is offered;
  repeat for a non-terminal account and confirm it is not ($0).

### test/e2e/execStdio.e2e.test.ts

- `M80 package guards` (built `exec --help`, arg values, paths, JSONL
  plumbing) → proven by the packed install plus `OLD exec-help` and
  `RUN m80-exec-egress`; the guard inventory itself is `GONE` with the
  fake-only package.
- `E1/H4` (help topics) → `OLD exec-help`.
- `E2/H1 refuses %s with usage/2` → `RUN m80-exec-args` (0 req, $0.00).
- `E3/E4/H2 completes using test-owned auth` → `OLD plain-turn`,
  `OLD tool-write` (the same turns on run-owned keys).
- `E5 %s while streaming is bounded` → `RUN m80-exec-egress` (4 req,
  $0.10) for the bounded stream; `MANUAL` for the kill half: start a long
  `exec`, kill it mid-stream, confirm it exits within its grace with no
  half envelope on stdout (~$0.01).
- `E6 redacts exact percent-legacy key from startup failure stderr` →
  `MANUAL`: `exec --key-stdin` with a bogus key on the Meta route;
  confirm the failure names the cause and never the key ($0).
- `E7 scan-secrets packaged` → `RUN m80-scanner` (3 req, $0.05).
- `E8 runs a plan-mode turn` → `OLD plain-turn`.
- `E9 refuses the turn when the packed helpers bundle is gone` →
  `MANUAL` (lead only, on a copy of the install): remove the packed
  helpers bundle, confirm the turn is refused with its reason, restore
  ($0).

### test/e2e/execTestLauncher.e2e.test.ts

- The whole file → `GONE`: the fake-only test package
  (`scripts/package-acp-test.mjs`, `package:test-bed`) was deleted with
  it. The real `exec` the guards shadowed is proven by `OLD plain-turn`,
  `OLD tool-write` and `RUN m80-exec-egress`.

### test/e2e/modelApi.live.e2e.test.ts

- `case01 plain turn` → `OLD plain-turn`.
- `case02 tool definitions for every surface` → `OLD tool-write`.
- `case03 replay` → `OLD session-continues`.
- `case04/05 images, PDFs attached and read (M54)` → `RUN m54-media-attach`
  (4 req, $0.10) for the attach path; `MANUAL`: attach a real PNG and a
  real PDF in `SETUP-ACP`, have the model read each back, confirm the
  words (~$0.03).
- `case06 goals` → `MANUAL` in `SETUP-VSCODE`: set a goal, confirm a turn
  wakes and closes it, and the panel shows the state (~$0.03).
- `case07 memory (M49)` → `RUN m49-memory` (4 req, $0.10).
- `case08 MCP stdio server from Muse Code settings (M50)` → `MANUAL`:
  `SETUP-ACP` with a real MCP server (e.g. the time server over `npx`),
  confirm its tools list and one tool answers (~$0.03).
- `case09 hooks trusted and untrusted (M51)` → `MANUAL`: `SETUP-ACP`
  twice, once with `--trust-workspace` and once without, with a hook that
  writes a marker file; confirm the trusted run writes it and the
  untrusted run never loads the hook (~$0.03).
- `case10 subagents (M48)` → `RUN m48-subagents` (6 req, $0.15).
- `case11 web search (M33)` → `RUN m33-web-search` (0 + 4 req, $0.15).
- `case12 images generated and edited (M34, M44)` →
  `RUN m34-images` (8 req, $0.30).
- `case13 schedules incl. cancelled/failed/denied (M52)` → `MANUAL` once
  schedule delivery is certified: create each schedule kind, confirm Run
  now, cancel, failure and deny paths (cost per the schedule's own cap).
- `case14 Muse Voice (M35)` → `MANUAL`: dictate one sentence through the
  packed product with a microphone, confirm the transcription and its
  charge (~$0.02).
- `case15 auto-compaction (D41, M45)` → `OLD compact`.
- `case16 resume and rewind (M53)` → `OLD session-continues` for resume;
  `MANUAL`: fork a stored session and rewind one turn in `SETUP-VSCODE`,
  confirm both land where they should (~$0.02).
- `case17 workspace context (D13, M10)` → `RUN m10-workspace-context`
  (4 req, $0.10).
- `case18 a question, and Stop while a card is open (M16, D26)` →
  `MANUAL`: in `SETUP-VSCODE`, have the model ask a question, answer it,
  then press Stop with a card open; confirm the late answer lands exactly
  once and nothing duplicates (~$0.02). `OLD cancel` covers headless stop.
- `case19 code intelligence (M67, D49)` → `RUN m67-code-intel` (8 req,
  $0.15).
- `case20 Plan-mode reply saved byte for byte, then implemented with the
steps as the todo list (M79)` → `MANUAL` in `SETUP-VSCODE`: take a
  Plan-mode turn, confirm the plan file matches the reply byte for byte,
  implement it, confirm the steps become the todo list (~$0.05).
- `case21 verify loop (M68)` → `MANUAL` in `SETUP-VSCODE` on a project
  with a check command: edit in a diagnostic, confirm the loop runs the
  check, shows the diagnostics, and `then_run` output lands in the turn
  (~$0.05).
- `case22 session budget (M82)` → `RUN m82-budget-refusal` (0 req, $0.00)
  for the never-sent half; `MANUAL`: compare one request's estimate
  against Meta's own counted cost and confirm the estimate is at or above
  (~$0.01).
- `case23 /review as the Reviewer (M70)` → `RUN m70-review` (8 req, $0.15).
- `case24 git commit message and PR as the user's own turn (M71)` →
  `MANUAL` in `SETUP-VSCODE` on a scratch repo: draft a commit message and
  a PR body, confirm both read as the user's own turn and nothing is
  pushed (~$0.03).

### test/integration/tab.test.ts

- The whole file → `MANUAL`: `SETUP-VSCODE` with Tab on, type in a file,
  accept one completion, confirm the charge and the ledger row (~$0.02).

### test/unit/a11yScheduling.test.mjs

- The whole file → `GATE` in part (`npm run test:a11y` walks the harnessed
  page); `MANUAL` for the rest: keyboard through the panel (every control
  reachable, focus visible, live regions announced) in `SETUP-VSCODE`.

### test/unit/accountUsage.test.ts

- The aggregation and projection rows → `INFRA`: proven in composition by
  `OLD usage` and `RUN m102-usage-views`. The workbook-label and
  unknown-model rows → `MANUAL`: run usage against a workbook entry and an
  unknown model id, confirm the labels and the unknown-model sentence ($0).

### test/unit/acpMedia.test.ts

- Sniffing, admission and the store-port rows → `RUN m54-media-attach`
  (4 req, $0.10) for the attach path; the media-suffix/no-suffix and
  copy-outcome halves → `MANUAL`: attach each kind in `SETUP-ACP` and
  confirm delivery or the refusal sentence (~$0.03).

### test/unit/acpNpmReadme.test.ts, test/unit/acpPackageFixtures.test.ts

- The whole files → `GATE`: `npm run package:acp` plus the packaging
  checks prove the bundle identity, entry points and shipped README on
  every build.

### test/unit/acpPlaybook.test.ts

- The whole file → `RUN m116-playbook` (0 req, $0.00).

### test/unit/acpTranslate.test.ts

- The whole file → `INFRA`: every `OLD` and `RUN` ACP cell speaks through
  this translation, so green cells prove it in composition. The
  permission-shape rows ride `OLD tool-write` and `OLD refused-approval`
  explicitly.

### test/unit/actionApply.test.ts, actionGate.test.ts, actionGit.test.ts, actionInputs.test.ts, actionManifest.test.ts

- Every row → `HOSTED`: the composite proposal Action is proven only by
  live receipts (`action-live.yml`, the LA/LR runs). Nothing local can
  stand in for a vendor run.

### test/unit/activityIcon.test.mjs

- The whole file → `MANUAL`: one small local look at the activity icon in
  a light and a dark theme (`npm run ui:look`), confirming the mark and
  the badge.

### test/unit/agentImport.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: import hooks from another
  agent (Gemini, Cline), confirm each converts or is refused with its own
  sentence, and nothing foreign runs unreviewed ($0).

### test/unit/AgentMap.test.tsx, test/unit/agentOutcome.test.ts

- The map rows (delegation notices, outcome rows) → `MANUAL` in
  `SETUP-VSCODE`: run a subagent, confirm the map shows it live and its
  outcome row afterwards (~$0.03).
- The outcome-receipt rows (D101) → `MANUAL` in `SETUP-ACP`: after any
  child run, `/agents receipt` shows the structured outcome, and
  continue/retry behave (~$0.02).

### test/unit/ApprovalDock.test.tsx, test/unit/attentionDock.test.tsx, test/unit/cards.test.tsx, test/unit/backgroundRows.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: raise an approval, confirm
  the dock, the card and the attention row agree (title, reason, diff),
  allow once, deny once, confirm each lands exactly once (~$0.03).
- `ApprovalCard > names the page a web fetch will read (M69)` rides
  `RUN m69-web-fetch` too: its asked title is in that record.

### test/unit/AttachmentMediaCost.test.tsx, test/unit/AudioAttachmentActions.test.tsx, test/unit/toolVideo.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: attach an image, an audio
  file and a video; confirm each cost row, each action and each refusal
  sentence; transcribe nothing by hand (~$0.05).

### test/unit/autoCompactionBundle.test.mjs

- The whole file → `GATE`: the bundle-split checks prove the lazy
  compaction bundle on every build; `OLD compact` proves the behaviour.

### test/unit/backendSelection.test.ts

- The whole file → `MANUAL` on a rig: sign Muse Code out and in again
  with the key stored and removed (four combinations); confirm auto picks
  CLI, then key, then the sign-in gate, and says which ($0). Never on the
  owner's machine.

### test/unit/BestOfNDialog.test.tsx, test/unit/HistoryDialog.test.tsx, test/unit/SessionBoardDialog.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: open each dialog, confirm
  its rows, pick one, cancel one, confirm each lands once ($0).

### test/unit/bridgeChecks.test.ts, test/unit/checkSlots.test.ts, test/unit/runnerRouting.test.ts

- The whole files → `INFRA` behind the M68 verify loop; `MANUAL` in
  `SETUP-VSCODE` on a project with several check commands: confirm each
  check runs once in its slot, routes to the right runner, and a second
  edit reuses the slot (~$0.05).

### test/unit/browserRestartReadiness.test.mjs, test/unit/canaries.test.ts

- The whole files → `MANUAL` in `SETUP-VSCODE`: run a browser check on a
  plain page with consent given once; confirm the runtime downloads once,
  the canaries vet it, and the check reads the page (~$0.03).

### test/unit/chatColumn.test.mjs, test/unit/ChatShareDialog.test.tsx, test/unit/sharingBridge.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: share a chat to a file,
  confirm the preview, the scrub and the Markdown; cancel one share and
  confirm nothing is released (~$0.02). The CLI/ACP halves ride
  `RUN m84-share-redaction` and `RUN m118-prompts-share`.

### test/unit/checkPlan.test.ts, test/unit/planCitation.test.ts, test/unit/planArchive.test.ts

- The whole files → `GATE`: `npm run check:plan` proves the reader, the
  citations and the archive markers on every run.

### test/unit/companionCertification.test.ts, test/unit/companionMediaTransport.test.ts

- The whole files → `MANUAL` through the companion client: upload a file
  from the companion browser, confirm the transport guards (size, type,
  no content in metadata) and the certified server digest ($0).

### test/unit/confirmedDispatchInventory.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: answer an old approval
  after a newer one landed; confirm the helper's stale-dispatch refusal
  sentence, and that no other site refuses ($0).

### test/unit/ContextMeter.test.tsx, test/unit/DiffTallyRow.test.tsx, test/unit/EffortSlider.test.tsx, test/unit/QuoteMenu.test.tsx, test/unit/toolRows.test.tsx, test/unit/verifyRows.test.tsx, test/unit/trafficView.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: run one turn with tools,
  confirm the context meter, the diff tally, the effort slider, the quote
  menu, the tool rows and the verify rows all agree with the turn
  (~$0.03).

### test/unit/cx1r6HostCommands.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: invoke the estimate,
  schedule and prompt-launch shims from the palette; confirm each refuses
  with its own sentence outside its host ($0).

### test/unit/cyclesRoots.test.ts

- The whole file → `GATE` in part (`npm run cycles` runs the detection);
  the root-coverage half it asserted is `MANUAL`: the lead re-verifies
  the dpdm roots cover every entry before the release.

### test/unit/developerOptions.test.ts, test/unit/developerOptionsPage.test.tsx, test/unit/localDeveloperProfiles.test.ts, test/unit/developerSurfaces.test.ts

- The whole files → `MANUAL` in `SETUP-VSCODE`: unlock developer mode,
  confirm the options, the page, the profiles and the per-surface gates
  behave, then lock again ($0).

### test/unit/elicitationCard.test.tsx

- The whole file → `MANUAL` in `SETUP-VSCODE` with an MCP server that
  elicits input: confirm the card, answer it, deny it, confirm each lands
  once (~$0.02).

### test/unit/ErrorBoundary.test.tsx, test/unit/Modal.test.tsx, test/unit/Palette.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: break a panel (offline
  backend), confirm the boundary's sentence and retry; open the palette
  and one modal, confirm focus, escape and announced rows ($0).

### test/unit/execOutput.test.ts

- The A12/A14/A17/A19/A20 egress rows → `RUN m80-exec-egress` (4 req,
  $0.10).
- The M106 structured-egress rows → `RUN m106-structured-output` (6 req,
  $0.10).
- The remaining redaction-in-egress rows → `INFRA`: proven in composition
  by `RUN m84-share-redaction` and `RUN m80-scanner`.

### test/unit/execSchema.test.ts

- The A15/A16/F1 rows → `RUN m80-exec-egress` (4 req, $0.10): the result
  envelope it asserts is the committed shape. The committed schemas stay
  the authority; a drift fails that scenario.

### test/unit/feedback.test.ts

- The whole file → `MANUAL` on the Muse Code backend: walk the
  report/feedback flow with consent given and refused; confirm the
  dispatch guards and that nothing leaves without consent ($0).

### test/unit/fileSessionStore.test.ts

- Round-trip rows → `OLD session-continues`.
- Retention, corrupt-file, traversal and lock rows → `MANUAL`: craft a
  session directory with an old session, a corrupt file and a traversal
  name; confirm retention, the corrupt-file sentence and the traversal
  refusal ($0).

### test/unit/fontPreferences.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: set each font preference,
  confirm the UI and code fonts follow and ligatures toggle ($0).

### test/unit/fsAtomic.test.ts, test/unit/git.test.ts, test/unit/workLifetime.test.ts

- The whole files → `INFRA`: proven in composition by every run (sessions
  save, git review stages, browser prep). The adversarial rows (busy
  renames, junction swaps, lock races) → `MANUAL` fault-injection runs on
  a rig, Windows included ($0).

### test/unit/gitActivationWiring.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE` without `vscode.git` (a
  host without the Git extension): confirm the native route activates and
  the panel's Git half works ($0).

### test/unit/hookFormatsGemini.test.ts, test/unit/hookHttpHandlers.test.ts, test/unit/hookHttpRequest.test.ts

- The whole files → `MANUAL`: import one Gemini hook file
  (`SETUP-VSCODE`, M91) and confirm its conversion; stage one HTTP hook
  against a local stub server and confirm the allowlist, redirect and
  typed-handler behaviour ($0).

### test/unit/integrationPackaging.test.mjs, test/unit/usagePackaging.test.mjs, test/unit/vsixPackaging.test.mjs

- The whole files → `GATE`: the build and packaging checks prove every
  shipped file on every build.

### test/unit/jobSource.test.ts

- The whole file → `GATE` in part (CI runs the job matrix); the
  per-source rows → `HOSTED`: each source's receipt proves its row.

### test/unit/judgeAdmission.test.ts, test/unit/judgeSameModelApi.test.ts, test/unit/judgeUi.test.tsx

- The whole files → `MANUAL`: the lead authors one judge run from the
  judge reference (`judge ask` with a scripted request, then the report);
  confirm admission, the separate-engine path, settlement and the review
  UI (cost per the run's own budget).

### test/unit/legalRegistry.test.ts, test/unit/legalScanTool.test.ts

- The whole files → `MANUAL`: run `legal` in a workspace with real
  dependencies, confirm the local scan, the exit code and the JSON; with
  network, confirm one registry read and its guard ($0).

### test/unit/m101P2Documentation.test.ts

- The whole file → `READ`: the lead reads the release notes against the
  packed product and confirms pending retry work is separate from what
  shipped.

### test/unit/m105CaptureScrub.test.ts

- The whole file → `MANUAL`: the lead greps the committed capture files
  for UUIDs, paths and secrets; any hit fails the release ($0, no product
  needed).

### test/unit/m106Build.test.mjs

- The whole file → `GATE`: `npm run build` plus `npm run check:reference`
  prove the generated reference round-trips in the real artifact.

### test/unit/m113cLaneClosure.test.ts

- The whole file → `READ`: the lead confirms the lane-closure record
  matches the branches and the release.

### test/unit/m94kTabHookDocs.test.ts

- The whole file → `READ`: the lead confirms the Tab hook docs against
  the packed hooks.

### test/unit/manifest.test.ts

- The CI/workflow/packaging rows → `HOSTED`: green first-run receipts
  prove each workflow it names.
- The manifest-text rows (commands, views, walkthrough, notices) →
  `READ`: the lead reads `package.json`, `package.nls.json` and the
  notices against the installed product.

### test/unit/mcp.test.ts

- The whole file → `MANUAL`: serve the `mcp` connector over stdio to a
  real MCP client; confirm initialize, the tool list and one tool call
  with its guards ($0).

### test/unit/mediaLimits.test.ts, test/unit/mediaProviders.test.ts, test/unit/mediaSniff.test.ts

- The attach/admission rows → `RUN m54-media-attach` (4 req, $0.10).
- Over-limit, converter-probe and provider-matrix rows → `MANUAL`: attach
  an over-limit file, an unknown suffix and a real video in `SETUP-ACP`
  on machines with and without a converter; confirm delivery or the
  refusal sentence each time (~$0.05).

### test/unit/MentionMenu.test.tsx, test/unit/rowMenus.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: open the mention menu and
  one row menu, confirm rows, active marks, keyboard and dismissal ($0).

### test/unit/modelApiEntryExports.test.ts

- The whole file → `GATE`: the bundle-split checks prove the entry's
  exports on every build.

### test/unit/modelsApp.test.tsx, test/unit/modelsComponents.test.tsx, test/unit/modelsPanelSections.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: open Models & Agents,
  confirm sections, scan one provider, tick and untick a model, confirm
  the spend reads with `SETUP-ADMIN` (~$0.01).

### test/unit/moneyDisplay.test.tsx, test/unit/paidMoneyPorts.test.ts

- The display rows → `MANUAL` in `SETUP-VSCODE`: confirm money renders
  exactly (cents, zero, unknown) in usage and consent ($0).
- The exact-money port guard → `GATE`: the guard itself runs on every
  build.

### test/unit/ndjson.test.ts

- The whole file → `INFRA`: `RUN m80-exec-egress` splits and parses real
  NDJSON in composition. The split-UTF8/close-source rows → `MANUAL`
  only if that scenario ever shows a partial envelope ($0).

### test/unit/playbookCommand.test.ts, test/unit/playbookStrings.test.ts

- The CLI view rows → `RUN m116-playbook` (0 req, $0.00).
- Rule mutations → `MANUAL`: `playbook settings <rule> off "reason"`,
  confirm the journal row; try the safety switch and confirm the refusal
  ($0).
- The strings rows → `GATE` (`node scripts/check-l10n.mjs` proves every
  key in all tables) plus `READ` for the wording.

### test/unit/promptBridge.test.ts, test/unit/promptImport.test.ts, test/unit/promptLibrary.test.tsx, test/unit/promptStore.test.ts

- Save/list/use and the share binding (empty-chat refusal) →
  `RUN m118-prompts-share` (0 req, $0.00); the preview with content rides
  `RUN m84-share-redaction` through the CLI.
- Imports, workspace scope, conflicts, variable review, sync → `MANUAL`
  in `SETUP-VSCODE`: import a prompt file, clash a title, review a
  variable, sync, confirm each sentence ($0).
- The bounds-withdrawal rows stay proven by `promptBoundsRemoved.test.ts`,
  which was kept.

### test/unit/promptWorkspaceIntegration.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: load a real user prompt
  into a new empty workspace composer, confirm it lands unsent ($0).

### test/unit/providerModelScans.test.ts, test/unit/providerOpenRouter.test.ts

- Model scans → `MANUAL` in `SETUP-VSCODE`: scan one provider, confirm
  the models, one failure and its sentence ($0).
- The OAuth loopback rows → `MANUAL` with a real account: run the
  provider sign-in, confirm the loopback callback lands and a denied
  callback is refused with its sentence ($0).

### test/unit/QuestionCard.test.tsx, test/unit/questionStrings.test.ts

- The card rows → `MANUAL` in `SETUP-VSCODE`: raise a model question,
  answer it, ask for an explanation instead, confirm each lands once
  (~$0.02).
- The strings rows → `GATE` (all tables) plus `READ` (wording).

### test/unit/readmeVersion.test.ts

- The whole file → `READ` at release time: the pictures and version the
  README names match the packed product.

### test/unit/redact.test.ts

- Token, assignment, URL, PEM and encoding rows → `RUN m80-scanner`
  (3 req, $0.05) and `RUN m84-share-redaction` (2 req, $0.05) prove the
  rules end to end; every Model API turn redacts in composition.
- Near-miss and performance rows → `INFRA`.

### test/unit/reducedMotion.test.ts

- The whole file → `MANUAL`: one small local look with reduced motion on,
  confirming stillness across the panel.

### test/unit/referenceEntry.test.ts, test/unit/referenceKeyboardTruth.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE`: open the reference and
  the keyboard help, confirm each entry against the product ($0); the
  generated-file freshness half → `GATE` (`npm run check:reference`).

### test/unit/releaseIntegrity.test.mjs, test/unit/releaseMajorTag.test.mjs, test/unit/releasePublish.test.mjs

- Every row → `HOSTED`: the release workflow's receipts prove the tag,
  the integrity checks and the publish.

### test/unit/reportProblemDialog.test.tsx, test/unit/reportProblemRows.test.tsx

- The dialog rows → `MANUAL` in `SETUP-VSCODE`: file a problem report,
  confirm the rows, the scrub and the export ($0).
- The handler through the packed bundles → `RUN m93-report` (0 req,
  $0.00).

### test/unit/review.test.ts, test/unit/reviewMaterial.test.ts

- The Reviewer turn on an uncommitted change → `RUN m70-review` (8 req,
  $0.15).
- Branch/commit pickers, secret-file exclusion, cut diffs, pursued
  threads → `MANUAL` in `SETUP-VSCODE` on a scratch repo with a big
  branch: confirm each (~$0.08).

### test/unit/runtimeAccountsService.test.ts, test/unit/runtimeAccountStore.test.ts, test/unit/runtimeServices.test.ts, test/unit/runtimeStore.test.ts, test/unit/selectedHost.test.ts

- Status/list/models rows → `RUN m95-accounts-auth` (0 req, $0.00).
- Multi-account file moves, binding waits, host switching →
  `MANUAL` on a rig: add a second account, move the file mid-read,
  switch hosts, confirm each sentence ($0).
- Store-race rows → `INFRA` plus `MANUAL` fault injection on a rig.

### test/unit/runtimeChatGptCallback.test.ts, test/unit/runtimeChatGptPackage.test.ts

- The whole files → `MANUAL` with a real ChatGPT plan: run the sign-in,
  confirm the callback lands, the package ships and a denied callback is
  refused ($0).

### test/unit/sampler.test.ts, test/unit/samplerProbes.test.ts

- The live-sampler rows → `RUN m102-usage-views` (1 req, $0.05), whose
  resources readout runs the real sampler in composition.
- Fault rows (dead probes, cgroup shapes, GPU absence) → `MANUAL` on the
  rigs (Linux cgroups, macOS, Windows), confirming degraded readings say
  so ($0).

### test/unit/scanSecrets.test.ts

- The whole file → `RUN m80-scanner` (3 req, $0.05).

### test/unit/scheduleBinding.test.ts, test/unit/scheduleEvents.signals.test.ts, test/unit/SchedulePanel.test.tsx

- The whole files → `MANUAL` once delivery is certified: bind a schedule,
  confirm its panel, its signals and its consent renewal (cost per the
  schedule's own cap).

### test/unit/searchWorker.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: model turns using search
  with deny globs, a minified file and Stop pressed mid-search; confirm
  each boundary and the stop (~$0.05).

### test/unit/sessionBudget.test.ts

- The refusal rows → `RUN m82-budget-refusal` (0 req, $0.00).
- Estimate-against-Meta, media-part and provider-minimum rows →
  `MANUAL`: meter one request against Meta's own count and confirm the
  estimate covers it (~$0.01).

### test/unit/SetupBanner.test.tsx, test/unit/SignIn.test.tsx

- The whole files → `MANUAL` in `SETUP-VSCODE` from signed out: confirm
  the banner, each sign-in path and each refusal sentence ($0).

### test/unit/spawnInventory.test.mjs

- The whole file → `MANUAL`: the lead re-verifies the production process
  inventory against the sources before the release (the inventory guard
  went out with the fakes; this is a known gap to re-guard).

### test/unit/structuredOutput.test.ts

- The whole file → `RUN m106-structured-output` (6 req, $0.10) for the
  validated-answer path; the repair-until-valid rows ride its maxRequests
  headroom in composition.

### test/unit/surfaceRetry.test.ts, test/unit/toggleFocusView.test.ts, test/unit/warmDeferredSurfaces.test.ts

- The whole files → `MANUAL` in `SETUP-VSCODE`: fail a surface and retry
  it, toggle the focus view, and walk every deferred surface once ($0).

### test/unit/TasksApp.test.tsx, test/unit/TeamCards.test.tsx, test/unit/TeamTree.test.tsx, test/unit/WorkflowRun.test.tsx

- The whole files → `MANUAL`: `SETUP-TEAM`, run one headless team to
  completion, confirm the tasks document, the team cards, the tree and
  the workflow run agree with the engine (cost per the run's budget).

### test/unit/teamCleanup.test.ts, test/unit/teamGitIndexLock.test.ts, test/unit/teamLanding.test.ts, test/unit/teamMergeBatchRepository.test.ts, test/unit/teamMergeQueue.test.ts, test/unit/teamPlanRecord.test.ts, test/unit/teamRoster.test.ts, test/unit/teamRuntimePackage.test.mjs, test/unit/teamSchedulerPick.test.ts, test/unit/teamSchedulerReview.test.ts, test/unit/teamSchedulerRoster.test.ts, test/unit/teamSchedulerStalls.test.ts, test/unit/teamSchedulerText.test.ts, test/unit/teamSchedulerTools.test.ts, test/unit/teamServerToolList.test.ts, test/unit/teamStagingCopy.test.ts

- Admission → `RUN m96-team-admission` (0 req, $0.00).
- Everything a running team does (delegate, schedule, stall, merge,
  land, clean up) → `MANUAL`: `SETUP-TEAM`, run one team with a hard
  budget to completion with a clash and a stall in it; confirm the board,
  the merges, the landing and the cleanup (cost per the run's budget).
- `teamPlanRecord` → `READ`: the plan record matches the run.

### test/unit/teamWorkerCertification.test.ts

- The whole file → `MANUAL`: the lead re-pins the worker source hashes
  before the release (the pin test went out with the fakes; this is a
  known gap to re-guard).

### test/unit/tokens.test.mjs

- The whole file → `GATE`: `npm run check:tokens` proves the token build
  on every run; any visual change still gets its small local look.

### test/unit/treesLifecycle.test.ts, test/unit/treesLinuxLaunchNative.test.ts, test/unit/treesMacNative.test.ts

- The whole files → `INFRA` behind worktrees plus `MANUAL`: open and
  close a worktree on each native launcher (macOS, Linux, Windows),
  confirm the lifecycle and the launch sentences ($0).

### test/unit/uiTextRegions.test.mjs

- The whole file → `GATE`: the region checks prove the split on every
  build.

### test/unit/untrustedInput.test.ts

- The whole file → `MANUAL`: `exec --untrusted-file` with a small file,
  an empty file and a 200KB file (lead stages with the shell), plus too
  many at once; confirm delivery, the sentinels and each refusal sentence
  (~$0.02).

### test/unit/usagePerformance.test.ts

- The whole file → `MANUAL`: seed the journal to M102 scale (thirty days
  times two thousand calls) on a rig and time the usage service; confirm
  it answers in its budget ($0).

### test/unit/usageTable.test.ts, test/unit/usageText.test.ts

- The view rows → `RUN m102-usage-views` (1 req, $0.05).
- Non-English rendering → `MANUAL`: rerun one view under another
  installed locale and confirm the rendering ($0).

### test/unit/vault/credentialAdapter.test.ts, test/unit/vault/mcpSecrets.test.ts, test/unit/vault/mcpVaultPool.test.ts, test/unit/vault/sshAgent.test.ts, test/unit/vault/sshKeys.test.ts

- The whole files → `MANUAL`: the RLF-M109 record's §7 runs (fresh HOME,
  broker up, feeder through, SSH agent and keys, MCP secrets) on a Mac
  and on Linux ($0).

### test/unit/verifyLedger.test.ts

- The whole file → `INFRA` behind the M68 verify loop; its rows ride the
  `case21` manual run above.

### test/unit/walkthrough.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: click the Get Started
  walkthrough end to end ($0); the resource rows → `READ` against the
  shipped files.

### test/unit/webFetch.test.ts

- The fetched-page rows → `RUN m69-web-fetch` (4 req, $0.10).
- Private addresses, rebinding, redirects, encodings, deadlines →
  `MANUAL` in `SETUP-ACP`: fetch a private address (refused before any
  lookup), a redirect chain and an unusual encoding; confirm each refusal
  or rendering (~$0.03).

### test/unit/windowsScreenRecorderBuild.test.ts

- The whole file → `HOSTED`: the Windows build proves the recorder
  compiles and its smoke runs.

## Tests removed from files that stay

### test/integration/extension.test.ts

- `exposes every setting with its documented default` → `MANUAL` in
  `SETUP-VSCODE`: open Settings, confirm each `museSpark.*` setting shows
  its documented default ($0).
- `the Model API bundle loads from the installed extension and runs a
turn` → `MANUAL` in `SETUP-VSCODE`: run one Model API turn after a cold
  start, confirm the lazy bundle loads and the turn completes (~$0.01).

### test/unit/acpSdkTransport.test.mjs

- The bound row → `GONE`: it tested the suite's own shape, not a
  behaviour.

### test/unit/anthropicCodec.test.ts, test/unit/modelapiChatCodec.test.ts, test/unit/ollamaCodec.test.ts

- The golden/pin rows → `INFRA`: proven in composition by every
  `OLD`/`RUN` cell on those backends; a wire drift fails the turns.

### test/unit/autoCompact.test.ts

- The D81 row → `READ`: the compaction doc matches the packed behaviour
  (`OLD compact` proves the behaviour).

### test/unit/borderContrast.test.mjs

- The whole file → `MANUAL`: one small local look at the focused border
  in a light and a dark theme.

### test/unit/bundleDiet.test.ts

- The whole file → `GATE`: `npm run build` enforces every budget on each
  build.

### test/unit/bundledSkillsVendor.test.ts

- The whole file → `GATE`: the build proves the vendored skills ship.

### test/unit/changelogVersion.test.ts

- The whole file → `READ` at release time: the changelog's dated
  sections match what shipped.

### test/unit/cx1r2Truth.test.ts, test/unit/cx1r4Truth.test.ts

- The whole files → `READ`: the estimates, schedules and launch claims
  match the packed product (schedules once certified).

### test/unit/estimatorLocalization.test.ts

- The whole file → `GATE` (every key in all tables) plus `READ` (the
  estimate handoff words).

### test/unit/eval/evalTasks.test.ts

- The whole file → `GONE`: it tested the suite's own counts. The M73/M75
  evaluations run as documented in `docs/testing/real-life.md`.

### test/unit/hookFormatsContracts.test.ts, test/unit/hookFormatsFixtures.test.ts

- The row-cited contract rows → `MANUAL` with the M91 import run above:
  import one file per foreign format, confirm each row converts or is
  refused ($0).

### test/unit/judgeBench.test.ts

- The no-keys-in-bench row → `MANUAL`: the lead greps the committed bench
  for keys before the release ($0, no product needed).

### test/unit/legalGuards.test.ts, test/unit/legalSpdx.test.ts

- The whole files → `MANUAL` with the `legal` run above: confirm the
  guard refusal and the SPDX output on a real workspace ($0).

### test/unit/m106CaptureFixtures.test.ts

- The whole file → `GONE`: it tested the suite's own counts.

### test/unit/m95Strings.test.ts, test/unit/providersL10n.test.ts, test/unit/usageL10nTables.test.mjs, test/unit/mediaLocalization.test.ts, test/unit/team/teamTables.test.ts

- Key presence → `GATE` (`node scripts/check-l10n.mjs`); wording →
  `READ`.

### test/unit/modelApiLoopContracts.test.ts

- The bound rows → `INFRA`: proven in composition by every Model API
  turn; a loop that escapes its bound fails the turns.

### test/unit/outputSchema.test.ts

- The snapshot row → `RUN m106-structured-output` (6 req, $0.10): the
  live schema the model wrote to is the snapshot's subject.

### test/unit/resourceDelivery.test.mjs

- The whole file → `READ`: the security guide's delivery prose matches
  the packed governors.

### test/unit/sharingArtifacts.test.ts

- The command-registration row → `GATE` in part (the reference gate
  proves registration); the behaviour rides `RUN m118-prompts-share` and
  `RUN m84-share-redaction`.

### test/unit/teamConstants.test.ts

- The cap/role/tool-set rows → `RUN m96-team-admission` (0 req, $0.00)
  for admission; the running rows ride the `SETUP-TEAM` manual run above.

## Checks removed from scripts and workflows

### test/hosts/exec.sh

- The `--backend modelApi` run against a fake API → `OLD plain-turn` on
  a provider route: the same run against the real API. The fake-API route
  is `GONE`.

### .github/workflows/hosts.yml, forks.yml

- The fake-CLI/editor jobs → `GONE`.
- The remaining checks (installed agent help, trust refusal, key round
  trip; VSCodium and fork installs) → `HOSTED`: the workflows' receipts
  prove them. The agent halves also ride `RUN m63-agent-identity` and
  `RUN m95-accounts-auth` in composition.

### package.json `test:e2e:live` (the sweep)

- The whole script → `RUN`: the `m*` set above replaces the fake-surface
  sweep turn for turn (see the `modelApi.live` rows).

## Deleted helpers

The seven deleted doubles have no titles of their own. Their behaviours
are proven by the runs that replaced them: ACP stdio by `OLD`/`RUN` ACP
cells, exec egress by `RUN m80-exec-egress`, the Model API wire by every
Model API cell, sessions by `OLD session-continues`, the CLI by
`RUN m95-accounts-auth`, and attachments by `RUN m54-media-attach`.

## No-standins lint-gate leftovers

### test/unit/GoalPanel.test.tsx, test/unit/hostL10n.test.ts, test/unit/openInTerminal.test.ts, test/unit/planCommands.test.ts, test/unit/whatsNewPage.test.ts, test/unit/legalFixProduction.test.ts

- Each → `MANUAL` in `SETUP-VSCODE`: drive the panel once for real
  (goals, What's New, a non-English locale, Open in Terminal, plan
  commands, the legal fix), confirm each behaves (~$0.02 total).

## Lane STANDINS leftovers

### test/e2e/schedulesStdio.e2e.test.ts

- The whole file → `MANUAL` once delivery is certified: drive the
  schedule stdio surface for real (cost per the schedule's own cap).

### test/packaging/moduleExports.test.mjs

- The reviewer's paid-call path → `MANUAL`: run `/review` on a paid
  model in `SETUP-VSCODE`, confirm the consent names its price (~$0.05).
- The report-problem handler → `RUN m93-report` (0 req, $0.00).
- Session-board read, foreign-hook adapter → `MANUAL` in `SETUP-VSCODE`:
  open the board, import one foreign hook, confirm each ($0).
- The remaining resolution rows → `GATE`: the bundle-split checks prove
  the resolutions on every build.

### test/unit/pluginDispatch.test.ts, test/unit/marketplaceHook.test.mjs, test/unit/teamResources.test.ts, test/unit/modelApiLegalScan.test.ts

- Foreign-hook containment → `MANUAL`: run one imported hook in
  `SETUP-VSCODE`, confirm the sandbox, timeout and refusal sentences
  ($0).
- Idle-release timing → `MANUAL`: timed runs on a rig, confirming
  release and reaping at the documented bounds ($0).
- Legal-scan failure paths → `MANUAL` with the `legal` run above:
  confirm the invalid-result and failure sentences ($0).

### Composition note (team preview with lane A)

- → `MANUAL` in the `SETUP-TEAM` run above: confirm the preview agrees
  with the engine before the team starts.

## Lane no-standins-2 leftovers

### test/unit/windowsScreenRecorderNative.test.ts

- The whole files → `HOSTED`: the Windows host proves the native
  recorder.

### test/unit/pluginDispatch.test.ts (the 1 containment title)

- → `MANUAL` with the containment run above ($0).

## PR161FIX, PR161FIX3 and PR161W1 leftovers

### Failure-sentence suites (accountReadFailures, subscriptionStreamFailures, mcpOAuthDenied, credentialReadFailures)

- Every row → `MANUAL`: the lead's catch-money scenario from
  `unproven.md` — break each read once (revoked key, dead stream, denied
  OAuth, locked store), confirm each failure is said in its own sentence
  and nothing is silent ($0). The spend halves need `SETUP-ADMIN`.

## RVMSM105 leftovers

### test/unit/mediaProductionService.test.ts, test/unit/mediaAttachmentComposition.test.ts

- The capped/uncapped attach/send matrix → `MANUAL` in `SETUP-ACP` with
  real image, audio, video and PDF files: attach and send each, capped
  and uncapped, confirm delivery or the refusal sentence (~$0.10).
- The attach path itself → `RUN m54-media-attach` (4 req, $0.10).

### test/unit/uploadedFilesComposition.test.ts, test/unit/acpUploads.test.ts, test/unit/uploadedFilesBinding.test.ts, test/unit/mediaUploadStores.test.ts

- List/delete/usage → `RUN m105-uploads` (0 req, $0.00).
- Provider ledger operations, purge, lock races, cleanup intents, key
  removal → `MANUAL` with real provider files: upload, delete, purge,
  remove the key mid-lease, confirm each sentence (~$0.05).

### test/unit/productionAudio.test.ts, test/unit/transcriptionTransport.test.ts, test/unit/audioMessagePreparation.test.ts, test/unit/converterTrust.test.ts, test/unit/mediaVerifiedCopy.test.ts

- The whole files → `MANUAL`: attach a real audio file, confirm the
  converter runs (or its install sentence), the transcription is billed
  and shown, and the verified copy lands (~$0.05). Converter-permission
  and junction rows are fault injection on a rig ($0).

## RVMSM80 leftovers

### test/unit/ciTemplatesRun.test.ts, test/unit/ciRun.test.ts, test/unit/ciTemplates.test.ts

- Every row → `HOSTED`: only a hosted vendor run of each CI template
  proves these; no local run can.

## PR207 follow-up

### test/unit/scheduleLegacyDailyBudget.test.ts

- The whole file → `MANUAL` in `SETUP-VSCODE`: set the host daily
  budget, confirm the legacy mapping and each refusal sentence ($0).

## RLF-PLAYBOOK, RLF-RECORDING, RLF-NOSTUBS, RLF-M109, RLF-ORCHEXT, RLF-HOSTSLAND

- Every entry in these sections already names its exact real-life steps
  in `unproven.md`: each is `MANUAL` as written there. That includes the
  named files `test/unit/subscriptionCredential.test.ts`,
  `test/unit/mediaJobRun.test.ts` and
  `test/unit/providerSpendTerminal.test.ts` (each a partial withdrawal;
  the rest of each file stays on real runs), and the RVHOSTS
  still-unproven list. Two notes:
- The playbook view rows among them also ride `RUN m116-playbook`
  (0 req, $0.00) in composition.
- The `exec --backend modelApi` host checks ride `OLD plain-turn` on a
  provider route.
