# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Entries record what actually
happened, not what was planned; superseded entries are kept.

## [Unreleased]

### Changed

- Runner-route resource relocation joins the lazy check router to the
  existing governor, SSH admission and resource journal. Complete
  scheduler bindings supply approved routes, exclusive attempt ownership,
  Ask, Keep here and task/Traffic rows. Queued heavy checks can move at
  relocate/pause; ambiguous remote admission never retries locally. No
  runner route is active in an installed editor yet; paired-device
  relocation stays refused.

- The ACP agent's resource history now includes its own work. Each
  `muse-spark-code-acp` process runs one resource governor, shared by the
  agent, a headless `exec` run and terminal commands instead of each
  starting another. The tools, checks and other processes the agent starts
  are that governor's work: at throttle one background item per kind runs
  and the next starts when it finishes, where before none started until the
  level dropped. Their CPU time and peak memory appear as harness work in
  `resources history`, `usage resources`, ACP `/usage resources` and every
  editor's usage page, as the VS Code window's already did (not yet on
  macOS). An ACP conversation now gets the resource notice when its own
  turn's work waits, and a headless run's own deferred or refused work is a
  v2 `resource` event in its output.

### Fixed

- **Runtime resource cleanup on older macOS.** CLI, ACP and headless
  shutdown now forward disposal to the sampler's memory helper, so a
  resource status command exits normally and no helper keeps the runtime
  alive after shutdown.

- On macOS, memory headroom includes free, inactive and purgeable pages on
  runtimes with libuv older than 1.52, including Node 22 and older
  extension hosts. The packaged signed helper handles one request per
  sample in one child per governor; a failed reading stays unknown, and
  newer runtimes keep Node's API.

- Cancelling a runtime launch or reaching its deadline now ends the wait
  even while the resource governor's first settings read is still pending;
  other callers keep the same initialization.

- Attested job accounting in resource history now requires both the host's
  recording flag and the shared history choice at settlement; turning
  history off discards buffered rows and their overflow tally, so enabling
  it later cannot publish work collected while history was off.
- Runner receivers now publish a run's exit record only after the run is
  settled (CM1073 round 7): the job supervisor first drains the run's
  processes to zero (the Windows job object; the POSIX process group)
  and then closes its own redirected output handle before writing the
  record, so the record is never observable while a dying process still
  holds the output file. On Windows this removes the 1-in-5 `EBUSY`
  deleting `runs\<id>\output` after settlement. A settled run whose
  output file is still held reports the typed `uncertain` dispatch and
  stays retryable under the same run id, never Offline, with no leaked
  slot.

- Windows runner receivers left at Windows' default execution policy
  (CM1073 round 5): the SSH remote command now starts Windows PowerShell
  with the shared `-ExecutionPolicy Bypass` flag (process scope: it changes
  nothing on the machine), built from the same argument list as every other
  script-file launch, so the helper runs instead of being refused before
  its first line. Where Group Policy overrides the flag and still forbids
  scripts, the run reports its own sentence — “This machine's policy does
  not allow scripts to run; nothing was started.” — in every language, at
  the test button and through the run's refusal reason, instead of reading
  Offline. No machine setting is changed by the product or by a test, ever.

- Runner-route relocation repairs (reviews RVCM1073B, RVAPP-CM1073R3):
  registering or unregistering a route rebinds the relocation target on the
  loaded host instead of disposing it, so unrelated active work is never
  stopped; a pressure or setting change after the route decision runs the
  ordinary runner route instead of failing a labelled check Offline, and
  Offline is produced only when the runner is genuinely unreachable; a
  target that became busy keeps the check on the source with its reason
  reported, and the ordinary route keeps a proved receiver refusal reason
  when every runner is exhausted; losing the last route steps the governor
  down from relocate to pause at once; an explicitly null relocation target
  reports no route while no runner is bound. The two PowerShell refusal
  cases skip with "PowerShell unavailable" where the parser is missing, and
  the admitted-run case requires Windows PowerShell itself; all three run
  on Windows.

### Release infrastructure

- The release's Open VSX check reads the universal package at its own
  address. Once a version has packages for each platform, Open VSX's
  plain version address can name any one of them, and 0.19.0's check
  compared the universal package with another platform's (every package
  was published and matched when checked by its own address).

## [0.19.0] - 2026-10-21

### Highlights

- **Provider refusals read as the provider's refusal.** A wrong key reads as
  a rejected key and an unknown model as no such model at every recorded
  provider; a quota or spend-cap refusal is never retried while a bare rate
  limit still is; a session-budget stop ends the turn with its own sentence
  instead of "Models & Agents is not available in this build"; and
  `providers add` and `providers test` name a failed connection's network
  codes and say whether the request arrived is unknown.
- **The conversation keeps the model you chose.** After a restart the next
  message goes out on the model shown, the panel shows the model each
  request really used, and a message that would run on another model is not
  sent.
- **The chat no longer takes the keyboard from a file you just opened.**
  A panel that finishes loading never pulls the focus in, and a question
  that arrives while you are elsewhere waits with its badge.
- **Muse Voice stays silent with its reason past an unrouted proxy.** On
  VS Code 1.101 to 1.111 with `http.proxy` set, the microphone stays
  unavailable with the reason instead of recording audio that cannot be
  sent.
- **The Linux sandbox says why it cannot start.** While sandboxed on Linux,
  each host start probes whether the bubblewrap sandbox can create a user
  namespace here and says so once on every surface, naming the two ways
  out, without ever switching the sandbox off on its own.

### Added

- **GitHub sign-in from three sources, and the GitHub card in the panel.**
  Every GitHub call takes its sign-in from, in order: your editor's own
  GitHub sign-in; Muse Spark's own sign-in with GitHub's device flow; and
  your `gh` login, only after you turn on the new machine-scoped
  `museSpark.github.useGhLogin` setting (off by default). Where the editor
  has no GitHub sign-in of its own, **Sign In to GitHub** starts the device
  flow. A card above the composer shows the code with copy, open and cancel
  actions, then names the account and the sign-in in use, with sign-out for
  Muse Spark's own. A token GitHub refuses is dropped, and you sign in
  again.
- **In a terminal: `muse-spark-code-acp auth github login | logout |
status`.** `login` prints the code and GitHub's address and keeps the
  token in this computer's credential store, renewing it before it expires;
  `status` says whether one is stored, never the token; `logout` deletes it
  and prints the app's page on GitHub. Signing out in one window also ends
  sign-ins still running in others.
- **Git and pull requests without VS Code's Git extension.** An editor built
  on VS Code that does not ship it now gets commit, push, pull requests and
  Write with Muse through your own `git`: the same forms and confirmations,
  the same refusals (never a force-push), the push confirmation naming every
  URL Git will push to. Creating a pull request signs in first, pushes the
  branch after its confirmation, then asks once more with what goes out
  before opening it.
- In an ACP editor, `/whatsnew` reads this version's release highlights and
  full notes as text, answered locally with no model turn.
- **MCP connector for other agents, local phase (in progress).**
  `muse-spark-code-acp mcp` serves Muse Spark Code's tools over MCP on
  stdio to other coding agents on the same machine. Built so far: saved
  prompt list, read, fill and share preview; schedule list and pause;
  deterministic reports; operation status and Stop; and saving a new prompt,
  which waits for your approval on Muse Spark Code's own approval page and
  cannot be approved by the other agent. Fleet status, agent outcomes,
  estimates, new or edited schedules and share publishing answer
  `unavailable`, with their reason. No client has been qualified yet.
- **Evaluated automatic compaction.** Automatic compaction is on by default
  on the Model API backend after two passing counted evaluation runs (one
  setting turns it off), and it is published in Help, the ACP/CLI usage and
  the generated reference; its first charge still asks once in the paid-use
  popup naming the price and daily budget. Every automatic attempt reserves
  its projected cost from the daily ledger before dispatch, rechecks the
  claim at send, and settles once per attempt at its exact cost; a refused
  or missing ledger sends nothing. <!-- try: setting museSpark.modelApiAutoCompaction -->
- Each provider's own retry limit, nothing global. The single default is
  replaced by the documented values (Anthropic 2, OpenAI 2, Gemini 4, Azure
  10, xAI 4, Meta 4), and a provider that documents no maximum retries until
  its own wait or stop answer ends the exchange. The new machine-scoped
  `museSpark.modelApiMaxRetries` setting caps every provider's retries when
  set (`0` never retries); unset, the providers' documented maxima govern.
- JSON headless runs report request starts, token totals and cost on stderr
  while stdout remains one JSON result.
- Headless Model API runs accept `--max-output-tokens <n>` as an optional
  lowering limit: absent is the model's policy cap, present never exceeds it.
  The limit is carried into the request and its reservation, so a small
  budget can size a run down.
- Claude Haiku 5.5 is listed with an unknown price pending a documented
  receipt.
- The Muse Code backend tracks the latest CLI and SDK (1.4.10): new
  session-protocol notifications (model retries, Auto-review holds, plugin
  changes, declined retracts, branch and view-health moves, foreground
  completions) now reach the conversation. Three machine settings carry no
  limit of ours: `museSpark.hooksMaxStopContinuations`,
  `museSpark.hooksMaxRunningCommands` and `museSpark.subagentMaxConcurrent`
  are each `0` (unlimited) unless you set one, and a set value stays within
  Muse Code's own ranges.
- In Manual (and Edit automatically) on the Muse Code backend, Muse now asks
  before running each command, as the Modes menu promises, instead of letting
  an automatic judge allow commands with no approval reaching you. Requires
  Muse Code 1.4.7 or later; older hosts keep their previous behaviour. A
  refused mode change keeps the running mode and names it, and a torn change
  refuses new turns until the mode is set again. The translated settings
  tables say the same in every language.
- The Muse Code backend honours your contributor mode: while your own Muse
  Code settings enable it, `serve` starts with `--contributor-mode` on, and
  the model picker, `exec --model`, ACP and the panel offer each served
  model's `-contributor` counterpart by name. Nothing turns it on by
  default, and someone not entitled hears the provider's own refusal.
- Local models accept a validated manual context window in the provider
  wizard, quick pick, Models table, ACP configuration and `providers add
--context-window`. Manual limits survive rescans and edits, and size both
  manual and automatic compaction. Custom servers accept validated
  compatibility overrides.
- **llama.cpp server and LM Studio presets in the Models panel.** Both are
  listed once their own live wire captures landed: reply, one and parallel
  tool calls, streamed reasoning, usage placement, context-overflow and error
  frames, and which tool-choice and output-cap forms each takes. Errors from
  both still read as the server's words. The Custom server is listed again
  alongside them; presets without a capture (vLLM, Ollama) stay out until
  theirs land, and a saved model with no known window refuses before anything
  is sent — enter one by hand. Loopback scans no longer go through your
  proxy.
- OpenRouter account connection now completes browser authorization without
  copying a key in local editor windows. Remote windows and ACP terminal
  authentication accept the single-use code; the returned key stays in the
  system credential store. New setups retain no-data-retention routing.
- Models & Agents and Account & usage show OpenRouter's key usage, limit and
  remaining balance. Terminal connection and usage share those paths, with no
  credentials in UI state or output.
- `/playback`: ask the agent to state its own understanding of the goal and
  instructions, from its working memory only, with no tools for the turn, so
  you can compare it with what you asked and correct it in the next message.
  On the Model API backend it runs on the panel, the terminal and ACP
  editors, in all fourteen languages; on the Muse Code backend it is
  refused, since Muse Code offers no turn without tools.
- Linux free dictation recognizes English offline with a prebuilt CPU-only
  helper. First use asks once before the helper and model downloads; every
  helper file is verified before it ever runs, refuses loudly on mismatch,
  and is removed with the model when the setting is off. The helper ships as
  same-tag release assets instead of inside the package. The feature stays
  off until review passes and hosted receipts land.
- History can delete a conversation for good on the Model API backend: a
  Delete action on each row asks for confirmation naming the conversation,
  then removes it from the session store and the list. The same deletion is
  offered to editors through ACP `session/delete`. On the Muse Code backend
  no Delete is offered: its CLI serves no session delete, so there is nothing
  that could remove the session.
- **Reports cover more ground without a model call.** `/report accounts`
  and `/report security` read the provider registry, thresholds, developer
  audit and vault aggregates (never a value); `/report estimate` runs the
  estimator for a goal with deadline and fleet and reports P50 and P90, the
  critical path and the limiting resource; `/report playbook` and `/report
schedules` read the orchestrator journal, upcoming and recent fires,
  outcomes and cost; `/report session` and `/report usage` read the current
  or a stored conversation with matching Account & usage totals;
  `/report keybindings` lists every installed editor binding; and the store,
  workflow, release and npm channels report from captured registry shapes. In
  VS Code, ACP and the terminal alike.
- `/estimate` goals now resolve from your workspace plan with its git
  evidence — lane hours, dependencies, rigs, file affinities, the delivery
  order and releases — instead of refusing. `estimate --check-plan` lists
  every plan problem, one per line, printing nothing when the plan is clean.
  Dependency cells keep a strict grammar and anything else refuses instead of
  inventing or dropping dependencies; estimates refuse loudly naming the
  problem instead of accepting or inventing data.
- **Headless runs on GitLab CI, Azure Pipelines, Jenkins and Bitbucket
  Pipelines.** One thin template per system runs the GitHub Action's own
  launcher, which the agent package now carries. Each template checks the
  pinned tarball before anything of it runs; the key comes from the system's
  secret store and reaches the agent over standard input only. Nothing
  comments or pushes. No vendor run has been simulated and no live run has
  certified them yet.
- Tool results are bounded before they reach the model: one choke point cuts
  an oversized result, a cut keeps the full text in spill files for paging
  and tells the model and you what was cut and how to read more, and a
  provider "prompt is too long" refusal trims the largest results, compacts
  once when available, then ends the turn with what to do next. No byte
  guard of ours applies unless you set one:
  `museSpark.modelApiMaxToolOutputBytes` is `0` (results stay whole within
  the model's window) by default; `exec --max-tool-output-bytes` sets it for
  one headless run. One
  oversized result can no longer fill the model's window and end the
  conversation.
- The terminal agent documents itself per command: `<command> --help`
  prints that command's own usage, its options with defaults and bounds, and
  examples that run. A wrong option or value exits 2, names the option and
  the accepted values, and suggests the nearest valid option when the name is
  close. All of this reads in the installed language.

### Changed

- **The browser check runs on Chrome for Testing 156.0.8078.47** (r1706539,
  published 2026-10-20), pinned in place of 154.0.8037.92, which the
  release's pin check refused as more than 14 days behind the newest Stable.
  After the update the check downloads the new version once, as it did the
  last one, checked against its pinned length and SHA-256. The pin now comes
  from `scripts/pin-browser-runtime.mjs`, which reads the Chrome for Testing
  and ChromiumDash records the pin check reads and measures each archive
  with the runtime's own ZIP reader (docs/RELEASING.md).
- Legal scans read shipped vendor licences as written (affiliate and `et
al.` notice suffixes, terminal periods, paired email/URL contacts) while
  restrictive holder text still needs human review. A workspace-root
  `licence-review.json` receipt binds a reviewed text to its package,
  version, SHA-256 and SPDX id and shows as **Reviewed by receipt**; changed
  bytes or versions need review again.
- Tab has no daily budget unless you set one:
  `museSpark.tabDailyBudgetUsd` is now `0` (no budget, nothing reserved or
  locked) instead of `$1.00`, and a set budget starts at `$0.05` with no
  ceiling of ours. Spend is reported without a cap when none is set.
- Headless `exec` has no default request limit: without `--max-requests` a
  Model API run is not stopped after 30 requests. A set value is any
  positive safe integer — no provider publishes a request-count maximum, so
  the product sets none.
- A Model API turn no longer stops itself after 50 tool rounds. No provider
  publishes a round count, so the product sets none: a turn runs until the
  model answers without a tool call, you press Stop, a hook stops it, or a
  budget you set is spent. A turn never stops for repeating the same tool
  call: it says the model is repeating the call and keeps going until
  stopped. A structured answer repairs until it validates instead of
  stopping after one repair, saying which repair round it is on.
- The credential vault's foundation landed underneath: broker protocol v2
  with management requests and pushed lock, revoke, approval and change
  events; setup with a one-time recovery code; import of discovered
  credential files in one encrypted commit (imports stay hidden from agents
  until you review them); and Reset for a vault that can no longer be opened.
  The panel section, the Windows channel (pipe, storage and presence check)
  and the per-OS storage slots sit behind the broker gate, and a stored
  opt-out keeps working, and an approval waits two minutes for your allow
  or deny before it ends as expired. The integration has landed on Linux
  and macOS: the Models & Agents panel mounts its vault section, the Vault
  command opens it, Lock ends every use, and SSH keys can be generated or
  imported when adding an item. On Windows the pipe and slot helpers build at first use.
- Schedules settle durably: the candidate scheduler writes a dispatch fence
  and owns every terminal record across VS Code, ACP and the terminal;
  ambiguous dispatch becomes uncertain without replay; failed cost reads
  preserve delivered output and spend; schedule consent joins both daily
  caps. Fence and lease ownership settle cleanly on cancel and timeout, and
  a dispatch lost to another live owner records nothing. Automatic delivery
  stays disabled until cross-platform qualification.
- Schedule drafts start with no spending cap and never spend until you set a
  cap and complete paid consent for it. The shared store has one versioned
  root that carries older entries across once; closing one panel cannot stop
  another panel's scheduler; closing the runtime touches only its own
  delivered fires; and manual runs refuse with their true reason.
- Attached video and audio work in production on every surface: on the
  contributor models an mp4 or mov can be attached in the panel, through ACP
  and with `exec --attach`, uploading once and priced on the one admission
  path, while other models refuse with the reason. On the model that cannot
  hear a video's sound the soundtrack is transcribed and the transcript goes
  beside the video; each transcription asks first with the price and the
  shared daily budget. The converter runs only from a configured or
  documented install, never from PATH. An attached file belongs to the turn
  that sends it and is let go when that turn ends. Where the production
  media service is not bound, uploads stay unavailable and scheduled reads
  say so.
- More loads on first use instead of at activation: the Muse Code backend,
  dictation setups, Linux voice, the sign-in and paid gates, the credential
  lease, the first-use command flows (MCP servers and hooks pickers, skills,
  worktree and memory flows, Plans picker, Diagnostics report text) and the
  AGENTS.md and bundle commands each load with their first use. Opening the
  panel for the first time starts Muse Code at once: a sign-in warms every
  cold panel, and the start never queues behind paused work.
- The panel uses plainer words: the Getting Started rows can never overlap,
  the empty composer invites a message and names only this machine's focus
  key, the Backend row says which engine runs the conversation, and the model
  picker marks contributor-suffixed models.
- Web fetch reads a page whole however slow it answers, with no deadline of
  ours: the wait says how long it has waited, until the page answers or you
  press Stop.
- Hook model calls send no output cap of ours: the capability record's
  published maximum rides along, or nothing is sent when the record names
  none — your budget fit still caps, and the daily tally settles the true
  cost after.
- Plugin children run with no bound of ours: no per-call deadline, heap
  flag, memory bound, answer-size bound or failure latch — a call waits for
  the child's answer, an explicit per-hook timeout (which names the bound it
  waited) or Stop, and every wait says how long it has waited while it
  waits. You can set your own bounds, each `0` (the default) for none:
  `museSpark.pluginHookTimeoutSeconds` (how long a call waits),
  `museSpark.pluginChildMaxMemoryMiB` (how much memory a child may use),
  `museSpark.pluginAnswerMaxBytes` (how large an answer may be) and, on
  Windows, `museSpark.pluginMaxFailures` (how many job-launcher failures
  set plugin hooks aside until **Retry Plugin Hooks**).
- Schedules never pause themselves on failures:
  `museSpark.schedulePauseAfterFailures` (`0`, the default) keeps firing
  with every failure in the run history, and a set count pauses the
  schedule after that many consecutive failures.
- `scan-secrets` runs with no deadline of ours: the scan continues until it
  finishes or a signal stops it, and a caller that wants a deadline (such
  as CI) sets one per run with `--timeout <seconds>`.

### Fixed

- In VS Code on macOS and Linux, started from the Dock, Finder or a desktop
  launcher, the editor's working folder (`/` or the home folder) no longer
  reads as a workspace a program could be planted in, so the vault's
  identity check and other helpers run instead of being refused.
- A crashed-connect journal recovery that cannot read this computer's
  credential store says so with exit 1 (`auth status` and its siblings)
  instead of an internal error.
- When a window or terminal command crashes while saving or removing a
  provider key, the windows that recover its lock at the same time can no
  longer both write the credential store: exactly one takes the crashed
  lock over, every other is told the lock is busy, and none disturbs a
  lock another window already holds. The crashed lock stays next to your
  user-level `providers.json` as a small `providers.json.lock.retired-…`
  folder, on purpose: it holds only the crashed process's id, start time
  and a random tag, never a key.
- A screen recording length you set is used as set, any whole number of
  seconds: 5 or 3600 now records for 5 or 3600 seconds, with no floor of 10
  and no ceiling of 600. 0 (the default) still records until you stop.
- **Attach Latest Screen Recording** takes your newest recording however
  long ago you made it, instead of only one from the last ten minutes. On
  Windows it also finds Xbox Game Bar's recordings (Win+Alt+R, saved in
  `Videos\Captures`) beside Snipping Tool's (`Videos\Screen Recordings`),
  and the newer one wins. When there is none it says where it looked, for
  example "No screen recording was found in Videos\Screen Recordings or
  Videos\Captures.", instead of "No recent screen recording was found."
- Usage history keeps recording after a write was cut off mid-way (a power
  loss or a killed process): a usage lock file left holding only empty
  bytes is taken over once it is stale, instead of stopping every later
  record for good.
- After Restart Muse Code, a conversation opened from History keeps going.
  Continuing it used to fail with "session MCP configuration conflicts with
  the loaded session runtime" and the message was never sent; the
  conversation now resumes with the tools it was started with, so the next
  message gets an answer.
- A conversation that cannot be opened from History, or brought back after
  a window reload, says so straight away with the reason ("Could not resume
  the conversation: …") and offers a new conversation. It used to fail
  without a word, and a message typed afterwards went nowhere you could
  see; now that message is refused at once with the same reason, and what
  you typed stays on its card. A conversation still open in the panel is
  not affected. A message you send while a conversation is still opening
  waits for it and then goes into that conversation, or is refused with
  the reason it could not open; it no longer disappears when the
  conversation's history appears.
- "Muse Spark Code stopped unexpectedly last time — report it?" no longer
  appears after an ordinary close. The window's crash marker is cleared as
  soon as VS Code asks the extension to stop, instead of after a shutdown
  VS Code cuts short; and on Windows and macOS a marker whose process id now
  belongs to a newer process is recognised as left over instead of being
  kept forever.
- On Windows the vault starts inside VS Code. VS Code runs extensions from
  its own install folder, so the editor's own runtime read as a program
  planted in a workspace and the vault's broker was never launched: the
  panel only said "The vault operation failed".
- On Windows a vault you just set up now unlocks. After "I Saved It" the
  vault read "Locked" and every Unlock Vault said "The vault operation
  failed. Try again.": the vault's activity log was written the macOS and
  Linux way, which Windows refuses, could not be created on first use,
  could not be read while it was open for writing, and needed the system
  keyring the extension does not ship (it now keeps its checkpoint in a
  private file beside the vault, as the vault's rollback record already
  did). The vault's Windows connection also no
  longer drops a request it receives before the caller is verified, no
  longer briefly disappears between callers, no longer fails on a request
  larger than 4 KB (a key bundle, a certificate), and no longer stops
  serving every window when one window closes while it answers.
- The Models panel and `auth status` tell apart two providers made from
  one preset (two Anthropic keys): each adds the provider's id instead of
  showing the same name twice.
- `exec` names the options it refuses for the chosen backend (for example
  "--max-budget-usd, --max-requests" on Muse Code) and how to choose the
  other backend, instead of a bare "These options require…".
- In an editor connected over ACP that cannot show notices, a Muse Code
  notice after the answer (such as "The turn finished its visible work")
  now starts its own paragraph instead of running on from the answer's
  last word.
- Question deferral uses the seconds you set, any whole number, with no
  floor of 10 and no ceiling of an hour: 0 (the default) never defers, and
  a wait past one timer's reach still holds until its deadline.
- On Windows, steps that run in Windows PowerShell work when VS Code, or the
  terminal agent, was opened from a PowerShell 7 terminal: the
  screen-recording preview's private folder, the agent's owner-only folders
  and every other Windows PowerShell step load Windows PowerShell's own
  modules instead of PowerShell 7's, which it cannot use ("Unprotected
  preview directory").
- On Windows, `ssh` runs where the product starts it with a narrow
  environment: an MCP server started through `ssh`, `ssh` or git over ssh in
  a hook, and Muse Code under the terminal agent now keep `ProgramData`,
  without which Windows' own OpenSSH quit without a word.
- On Windows the vault no longer refuses to write on a machine whose
  Windows PowerShell starts slowly (a fresh machine, heavy antivirus): the
  process identity a vault writer records is read by a small native reader
  instead, and nothing gives up after 10 seconds.
- On Windows, steps that read or end processes through Windows PowerShell,
  `taskkill` or the process table are no longer killed after 20 seconds. On
  a slow machine Windows PowerShell's first start can take longer, and the
  step it served (building a Windows helper, reading a process tree, ending
  one) then failed. These steps, and their macOS and Linux counterparts, now
  run until they end; Stop, or a deadline the caller sets, still ends them.
- Reports no longer give up on a source after 5 seconds. A slow answer from
  GitHub, the Marketplace, Open VSX, npm or a large repository's git history
  used to make that part of the report read "unavailable"; each source now
  waits for its answer, and Stop still ends the report. A source rate-limited
  without saying until when is asked again on the next report instead of
  being held back for 5 seconds.
- On Windows as an elevated administrator (Windows Server's defaults), work
  the resource governor starts is no longer refused, and the private folder
  for a screen-recording preview is locked to its owner alone.
- On Windows the credential vault now starts. Its helpers build in the
  vault's own folder, the broker launches and serves its private pipe, and
  the editor's requests reach it. Before, faults in the Windows helper and
  its relay stopped it at each step: the pipe never served, missing files
  read as refused, and every vault write was refused while the file was
  being written.
- On Windows, a process that stops a child it started through the resource
  governor now exits as soon as the child has ended, instead of up to
  10 seconds later.
- On Windows, a paid-use grants folder replaced by a file is now logged as
  damage instead of reading as no saved choice, as it already was elsewhere.
- Web fetch dropped a dead second converter no code called. No behaviour
  change.
- The unused paid-consent helpers for scheduled runs and per-account consent
  stay unwired until their owning milestones land. Meanwhile a paid schedule
  draft from the panel is refused and every reachable paid use still asks the
  popup. No behaviour change.
- On VS Code 1.101 to 1.111 with `http.proxy` set, the microphone now stays
  unavailable with the reason while a proxy is set there, instead of
  recording audio that cannot be sent.
- Behind a proxy on VS Code 1.112 or later, a Muse Voice refusal caused by
  your own settings now names the setting that is off and what to change;
  the version text stays only for VS Code before 1.112.
- The production build no longer starts every bundle at once through one
  service, which could fail under machine load with an error that named no
  bundle and then hang. Bundles now run through a bounded pool of 8; a
  failure names its bundle, in-flight bundles settle, and the process exits
  with the true error.
- On Windows, two requests that reserve session spend at the same moment no
  longer end one of them with a ledger failure when nothing is wrong with
  the ledger. Both lock answers are now waited on the same way, within the
  same one-second bound.
- On macOS the credential vault starts and stops faster. Shutting the broker
  down advanced its lock generation twice, paying the slow native helper
  each time, and a client waiting for the broker to listen re-proved the
  broker's identity after every refused connection instead of only when the
  broker might be gone. The generation now advances once, and the extra
  proof runs only when the broker may be gone.
- Limits of ours are gone from runs and budgets: best-of-N attempts and
  requests per attempt are your own per-run choice; headless `exec` sets no
  `--max-requests` or `--max-budget-usd` ceiling of its own; the GitHub
  Action sets no request limit unless you ask (a set value allows any
  positive number of billable attempts); and the published headless
  event/result schemas state no request-count maximum. Your flags and inputs
  stay with no ceiling of ours.
- Limits of ours are gone from content and teams: a rename may touch any
  number of files; a hook agent handler loops over its read-only tools until
  the model stops; objectives, plans, handoff briefs, saved prompts and
  titles stand at any size; image generation takes a prompt of any length
  and any number of edit sources; a provider holds any number of accounts;
  checks name any positive timeout; conversations spawn subagents and teams
  delegate without our ceilings, and team review, pipeline, reassignment and
  playbook patch rounds run until the work converges (paid consent still asks
  per spawn, pricing each request as it goes); exports,
  shares and report sources read and write at any size and item count; the plan
  reader parses the whole plan however large unless you set your own byte bound
  (`museSpark.reports.planMaxBytes`, `reportsPlanMaxBytes` in the agent's
  `settings.json`); and a
  held pull request checks out without our entry and byte ceilings. A saved
  prompt file reads, imports and shares at any size (only a blank title
  still refuses); a link import reads under web fetch's own body bound; an
  import is refused only past the provider's own documented context window;
  a long check timeout waits its whole length (timers re-arm in slices); and
  the invented output clipping, dropping and queue limits are gone.
- Questions, searches, uploads, recordings and background work carry no
  limit of ours: unanswered questions never defer on their own, hosted
  searches run with no bound of ours, attachments open at any size, screen
  recordings run until stopped, and the resource governor measures and shows
  but holds nothing back. Each has a setting when you want your own bound.
- Model API requests are no longer ended by the product's own clocks: no
  30-second request timeout and no 300-second stream idle limit. A request
  names how long it has been waiting and keeps waiting until Stop or a
  caller-named deadline. Retries are not counted out at four and a
  Retry-After is honoured at any length; only a call that names its own
  ceiling stops early, and quota never retries.
- Model API pacing follows the provider instead of invented numbers: no
  starting request shape, no reserved foreground fraction and no long
  admission wait. A queued request names what it is waiting for and keeps
  waiting until Stop; only the provider's observed rate-limit headers, 429
  answers and Retry-After shape the wait.
- Waits replace timeouts across the product: Git readers name no deadline of
  their own; `muse serve` starts until the server answers, saying so each
  minute; the browser check runs until it finishes or is stopped, with any
  number of click or type steps; MCP servers honour their entry's own startup
  and tool timeouts, however long, with a still-waiting notice each minute;
  Muse Code commands are waited on until Muse Code answers; shell commands
  honour the model's own timeout, unnamed commands run until they end or are
  stopped; billed image requests wait until Meta answers; and the legal scan
  and its walk run until done or stopped. A caller-named deadline still
  applies wherever one exists.
- Web fetch no longer stops same-host redirects after 5 or refuses pages
  past 5 MiB; a redirect loop ends at Stop and cross-host redirects are
  still handed back. The https-only, no-credentials and public-hosts
  refusals stay, and a caller-set text limit still applies.
- A spending limit exists only when you set one. The editor and agent daily
  budgets are none by default, so the ACP agent no longer stops a job on a
  daily budget it was never given. With no limit there is no spending check
  on the request path: nothing is reserved, locked or written before a send.
- Under a limit you set, the session and daily budgets keep running totals
  from the usage each call reported, saved after the call, so a resume
  continues from them. A request whose estimate would pass the limit is not
  sent and the reason says so; one warning comes when what is left no longer
  fits a request like the last one. A response that ended without its usage
  counts as cost unknown instead of its whole reservation.
- Spend admission uses one atomic versioned ledger, and the old journal,
  lock and admission bound are gone. Refused requests publish no hold; dead
  locks recover by process identity; concurrent checks inside one process
  queue instead of refusing each other as busy; and requests the provider
  refused before answering, unsent requests, dead runs' holds and holds left
  by older builds all release or age out instead of leaking into the day's
  ledger. Unresolved liability is shown separately from spend.
- Headless runs count exact input tokens where the provider documents a
  same-body count call (OpenAI, Anthropic Messages and Google Gemini join
  it), instead of reserving every body byte as a token; any failed count
  falls back to the byte bound with an info line, and wires with no counter
  keep the byte bound and say so. Token estimates reserve a margin where the
  shape is unverified, and provider and Meta requests reserve their actual
  conservative caps instead of a full context window. Budget refusals show
  the arithmetic.
- A headless budget refusal names both remedies with numbers: the run cap
  that admits the request and the largest output-token value that fits what
  is left. A run refused for a model with no known tariff returns its own
  `unpriced` status naming the model and where a price is added, instead of
  a budget stop. A turn stopped by its budget keeps the work produced so far,
  and a stopped headless run retains its partial answer and cost with an
  explicit incomplete marker. A paid limit refusal names the limit with its
  numbers.
- Help stays in its own command: deep help, per-command help, estimate help
  and bare help each show their own usage and options, and the report usage
  lists every working kind with its required argument. `exec --effort none`
  parses so Thinking off reaches the model's record; `exec
--max-tool-output-bytes` is listed with its per-run byte-guard
  description; a `providers accounts` misuse exits 2 with the accounts
  usage; enum refusals list the accepted values; exit-2 refusals read in the
  display language; and custom provider model lists are read-only in the
  terminal — edits take the Models panel.
- Exec and ACP honour the configured provider default and refuse a missing
  default instead of silently choosing another model. Provider setup errors
  name terminal flags and available model IDs; native model IDs containing
  slashes and repeated `--model` flags are accepted; every model offers its
  recorded effort levels and lists allowed values when a choice is refused;
  and ChatGPT sign-in stays a terminal command from ACP. An invalid
  output-tokens, timeout or request-count value names that flag, and
  ephemeral runs say they omit durable usage history. Imported provider
  files reject blank force reasons and control characters, and terminal
  `providers add` without `--model` lists the key's models and says to pass
  `--model` instead of the panel's tick wording.
- Every ChatGPT plan-route failure now names its cause instead of
  "temporarily unavailable" or "that did not work", and a crashed account
  check no longer crashes the packed agent. Account errors now say their real
  cause instead of the generic unavailable sentence while the runtime is
  connected. Configured providers keep budget, consent, model, codec and
  stale-confirmation refusals visible, and price cards retain cache-write
  premiums and long-context rates.
- In the ACP agent, only a legal scanner that fails to load blames the
  installation: a failed scan or a lost update carries its own cause.
  `/agents retry` no longer blames the backend's missing checkpoint for
  everything; `/playbook` no longer calls the playbook unavailable when a
  loaded playbook's command fails; and retrying an agent whose row left the
  conversation says the agent is no longer in the conversation.
- Terminal sharing answers accept `y`/`yes` in any case; `share` and
  `prompts` print result JSON only with `--json`, stay readable without it,
  and explain a cancellation on stderr; `prompts use` asks once, takes
  scripted variables and confirmation, and only imported prompts run
  untrusted; `scan-secrets` prints only the count and names its exits; each
  slash command is announced once; and a dead credential store, a missing
  pre-session item and an unavailable store all say so in one sentence each.
- An `exec` with a ChatGPT plan model runs on the shared subscription path
  with no Meta key needed; a missing grant names the ChatGPT or Copilot
  sign-in, never a Meta key. With no unlocked credential store the agent
  still starts and steps that need a stored key refuse in the one store
  sentence, with nothing written in plain text. Provider account advice
  follows the runner's providers file, and a keyless session resolves
  identity and spend at the first step that needs a provider.
- No provider key is refused for its looks any more, on any surface: any
  non-blank key is sent to the provider's own free key test, and a refusal
  shows the provider's reason. Values that look like the wrong thing ask a
  "use it anyway?" question instead of dead-ending; a piped key that is not
  text is told so; and the wrong-key questions read in the installed
  language.
- Provider refusals carry their detail: an Anthropic reply cut at its output
  limit continues instead of ending the turn; an Azure content-filter block
  has its own sentence; a refusal shows the provider's request id; a
  rejected key, missing permission or unknown model says nothing reached a
  model; and masked-key remnants and account ids never reach the log file or
  report bundles.
- In ACP, closing a session no longer discards its selected permission mode;
  `session/set_mode` is acknowledged in order; a permission answer is
  remembered before dispatch so a stage update cannot re-open the same
  prompt; and consent for one command prefix cannot silently install another
  stage's rule.
- Governor and account statuses share the session notice on the editor
  protocol; a refused model switch keeps the session on its model and
  carries the refusal sentence; `providers list` states the tool-calling
  limit; and a key test that read no model list still gets the terminal's own
  wording. Forced-model annotations and imported-provider reasons read in the
  installed language.
- A Muse Code side chat is read-only at the panel: every approval its branch
  raises is refused with the card's own rejection, labelled Side Chat, so
  the branch cannot approve a write.
- A failure is never turned into a different fact. Unreadable credentials,
  damaged history, quote, consent or upload state, a stopped OAuth flow, a
  corrupt history choice, an unreadable schedule consent file and a broken
  account host each say what happened, once, where you see it, with what the
  product does and the next step. One unreadable provider entry no longer
  hides a working provider later in the list; a failed panel message still
  reaches its draft; and a usage bridge that fails settles it so later
  refreshes and exports are not blocked.
- Usage and cost say what really happened: cached input, reasoning tokens
  and cache hit rate come from each request's own reported counters; plan
  spend carries the equivalent API price at the used tier under the
  subscription meter's own plan name; the models breakdown shows the model
  and tier each request was really sent as; and hourly rows keep the timezone
  they were recorded in. The journal format is version 3 and still reads
  versions 1 and 2; a completion report delivered twice is journaled once;
  and usage budgets follow the stored credential, disappearing with a rotated
  or removed key.
- A folder whose name only starts with two dots is an ordinary folder now:
  on Windows a folder literally named `..foo` under a trusted root, and the
  same mistake in the import preview, file identities, Tab context, ZIP
  extraction, problem-report paths and the schedule store, no longer refuse
  as outside the root. A genuine `..` segment still fails closed.

- On macOS, the resource panel no longer reports GPU use, disk busyness and
  memory headroom as unknown: each comes from its published counters and
  readings on new enough runtimes.
- On macOS, OpenCode plugins now run instead of being refused: bun runs
  directly, as OpenCode itself runs it, under the same per-call
  timeout, answer-size and process-tree bounds.
- On Windows, a browser check that ended at once with "unrecognized" now
  waits for the browser's network service, within the check's own time and
  Stop, before reading its process list.
- OpenRouter cancelling now interrupts token exchanges and usage reads,
  releases the queue and discards late credentials. All six usage amounts
  retain exact wire decimals, and panel actions read the network only on
  open, Save and Refresh.
- Terminal Connect asks before replacing a key and preserves it across every
  interrupted write. Connection, recovery and rollback run inside one shared
  lock with a staged journal; a crashed Connect is reported and cleaned on
  the next start, and a refused rollback says the new key is stored.
- Local scans settle every probe answer exactly once, and a scanned model
  carries its server's reported window into the saved limits, so the
  composer's context limit is set from the save instead of staying empty. A
  model with no known window refuses with a plain reason before anything is
  sent.
- Provider records follow the live catalogue, not a snapshot, and
  rate-limit headers are read with their real meaning per provider. Fresh
  attachments on a listed provider model no longer meet the wrong budget
  before send, and Azure entries persist the deployment while dispatch still
  refuses until Azure's own capture lands.
- Muse Voice gives each recording one owner from Start until its end: a
  queued Start keeps the budget scope, consent and context fence it was
  pressed under, every end awaits the recorder process exit before
  reporting, and helper events and the hard cap stay isolated across rapid
  Stop/Start. Refused budget admission never starts the microphone.
- Muse Voice now works on Model API with a finite budget, through the
  existing microphone adapters. Recordings reserve the shared daily budget
  and any conversation cap before connecting, then settle from the final
  reported audio duration; the tally shows estimated cost, interrupted audio
  keeps its reserved liability, and idle streams with no audio settle zero.
  Allow once covers one recording.
- Video reaching any request the model cannot take now refuses with the
  model's own reason before anything is sent, on every route, instead of a
  generic failure or a silently dropped part.
- Transcription keeps honest books: the last paid check runs immediately
  before the request goes out; a request that never left the machine refunds
  its reservation and adds nothing to the tally; a replaced file refuses
  before anything is sent; and a re-attached file uploads from the new copy,
  not the deleted one. A converter that stalls after a clean exit now ends
  with Stop or its deadline; a cancelled provider cleanup still runs bounded
  with retry intent; and an attached file is released with its turn instead
  of staying in memory. The privacy notice says what a contributor-model
  read of a video does: the bytes go to the Files API, the upload expires
  after seven days, and session deletion or the retention purge deletes it.
  "Storage billing has not been verified" is gone from every refusal. A
  provider delete refusal is recorded with backoff and retried by a later
  sweep instead of blocking saving.
- On Windows, a stdio MCP server, a plugin hook's runtime or a team run is
  now created inside its kill-on-close job, so a launcher ended in between
  can no longer leave the new process suspended outside the job.
- An image an MCP tool returns is priced at the calibrated image bound on
  the contributor models, like every other image, so a capped turn no longer
  under-reserves it.
- Hook processes and plugin hooks run with no limit of ours: with nothing
  set, every matching handler starts at once and a Stop hook keeps a
  finished turn going until it ends on its own. A set
  `museSpark.hooksMaxRunningCommands` or
  `museSpark.hooksMaxStopContinuations` stays within Muse Code's own bounds,
  and an aborted capped waiter wakes the waiters queued behind it instead
  of stalling them.
- A configured `ToolUseStart` hook warns that it is not wired on the Model
  API backend instead of being silently ignored: no tool-start firing point
  exists yet.
- `skill/import` quarantine entries keep their `reasons` and failure entries
  their required `reason`: a real quarantine's reasons were silently dropped.
- A session view that reports `unavailable` keeps the host's reason in its
  notice, and a host that reports its sandbox `unavailable` while the shell
  sandbox is on now warns with the host's reason.
- Reports stay useful when individual sources fail: one bad record is a named
  problem beside the good rows, never a lost source; cancelled reads stop
  cleanly; duplicated row ids never fail a report; a report keeps its
  requested language; and estimator, schedule and account sources name their
  own refusals instead of inventing rows.
- Closing the schedules runtime no longer touches the native background entry
  when no background consent was ever recorded, so terminal schedule
  management exits on its merits even on a machine with no background runner.
- Native IDE calls can carry a session-bound identity: unattended callers use
  their own grants, retired callers lose access, colliding request ids cannot
  cancel another caller's tool, and interactive-only tools refuse unattended
  calls before showing a popup or making a purchase.
- A team task waiting on a busy exclusive resource is answered at its
  deadline instead of waiting forever; concurrent spend checks inside one
  process queue instead of refusing each other as busy; and an invalid
  output-tokens, timeout or request-count value names that flag.
- Ephemeral runs omit durable usage history and say so in their JSON record,
  and an invalid usage-history settings file pauses recording with a
  specific repair warning instead of the generic write warning on every run.
- A window reports recurring file damage again after another window has
  observed a repair, instead of a stale cache hiding the warning; and a
  revoked paid-search request no longer claims an unsaved Always choice
  applied this time.
- The app's own statuses no longer speak as the model's reply: automatic
  compaction awaiting evaluation and its kin arrive as their own session
  notice, panel notice or terminal line. A configured model without
  confirmed tool calling is listed with its limit stated instead of
  vanishing silently, and refused for agent turns with the same sentence.
  Panel notices wrap long unbroken text now.
- MCP elicitation hooks now run instead of being accepted but never firing:
  with hooks on, a project hook can decline the request and a user hook can
  answer it, checked against the server's schema.
- A fully evidenced legal scan exits 0 (or 1 with a blocker) instead of
  always exiting 2, and judges what the workspace distributes:
  development-only dependencies are information, not gaps.
- Headless run sentences now read in the run language instead of always
  English: the language reaches the request-cap, budget and error sentences.
- After Muse Code is restarted, the first turn refused for the lost sign-in
  names the restart and the way back instead of a bare credential failure.
- The vault's key migration never loses or reverts a key: a save during
  unlock or after sign-out, a changed provider key and an interrupted
  sign-out each keep the newest key in both copies; only apiKey records
  ever reach the vault (oauth, subscription and account records stay in
  SecretStorage); and orphaned copies are removed instead of kept hidden.
- Windows gets a working vault client and broker: pipe and slot helpers
  built at first use, DPAPI/CNG storage and Windows Hello presence
  answering where present, and a capability-probed hardware slot beside
  the OS-store one. Where the OS keyring binding is not installed the
  vault keeps working from its owner-only file record, sealing a hardware
  slot where the machine can.
- The ACP estimate read no longer crashes when an estimate call fails: the
  shared schema chunk carries the schema error class beside the conversion,
  so the failure is rethrown as the estimate's own diagnostic. The guarded
  probe environment the vault transports build moved beside the executable
  resolver, so the vault chunks no longer carry the resource tree reader.
- The playbook and schedules report inputs are back within their 59 KiB
  budget: the git rename evidence the orchestrator reads now lives in its own
  module beside the playbook registry, so the report chunk no longer carries
  the git-spawning machinery the report read never calls. No behaviour
  changed on either side.
- The panel's deferred English is back within its unchanged 25 KiB budget:
  the ChatGPT sign-in's English and the team runners' English load in their
  own lazily fetched chunks beside their deferred surfaces instead of riding
  the shared surface-English closure. No sentence changed in any language.

- Bundled skills load when the extensions or storage folder is reached
  through a symlink or a short Windows name. A symlinked or short-named
  ancestor of the installed package itself is no longer mistaken for a link
  inside the skill tree, while a link inside the tree that leads outside it
  is still refused with its warning.
- The governor's bookkeeping folder no longer grows with every command: each
  save retires its staged manifest and the displaced copy once the live
  manifest is proven, and a load sweeps the names earlier runs left behind.
  A name is removed only once it proves to be this registry's own retained
  file, by content and identity and never by age; a name exchanged for
  anything else is left alone and reported.
- Your values are honoured as set, with no floor, ceiling or default of
  ours on them. Stop-hook continuations, subagent concurrency, command
  rules, browser-check hosts, CPU and memory thresholds, disk and memory
  floors, web searches per response and upload expiry days no longer stop
  at 8, 64, 500, 32, 30%, 40–98%, 0.5–64 GiB, 2 GiB, 20 or 1–30 days: a
  number you set governs as set, and only what the quantity itself cannot
  be (a negative count, a percentage past 100) is refused with its setting
  named. Usage history no longer trims to a year by default: with nothing
  set it is kept until you set a number of days or clear it, and a set
  number of days of 1 or more trims as set.
- The agent's command line now names the real cause of a bad option value:
  a known option with a value it cannot take (such as
  `--questions-defer-after abc` or `--backend foo`) says the value is
  invalid, names the option and points at the help that lists what it
  takes, instead of calling the argument unknown. A value that starts with
  a dash or is missing answers in the same words instead of the parser's
  English, on every command, and a truly unknown argument keeps its
  unknown-argument answer.
- Adding a secret to the vault no longer ends with "The vault operation
  failed. Try again." when the Target answer is not a JSON list of uses.
  The flow now asks where the secret may be used — one SSH computer, any
  SSH computer, Git commit signing, Git over HTTPS, a website, showing it
  to yourself, or nowhere yet — and everything already typed stays while a
  mistyped answer (Target, expiry date, name, label or address) asks again
  with the reason.
- Opening the vault no longer writes "Vault operation failed" to the
  extension log when nothing failed: a load overtaken by a newer one (as
  the first open is, by the vault's own events) is not a failure.
- The vault's Expires box says what it takes: a date as YYYY-MM-DD (the
  start of that day, your time) or a date and time as YYYY-MM-DDTHH:MM.
  Anything else asks again naming both shapes, where it used to be guessed
  ("1" was stored as 1 January 2001, "12/1" as 1 December 2001, a date alone
  as midnight UTC instead of your own midnight), and a date that has already
  passed asks again with its own sentence. An OAuth or session login's
  expiry reads the same way and cannot be left empty; editing another
  setting of an already expired item still keeps its date; and a grant
  whose expiry has already passed is refused with the same sentence
  instead of being saved.

### Security

- A Muse Code conversation is listed under what you typed. Session History,
  the session board, the restore pickers and the session list another
  editor reads over ACP showed everything sent with the first message: the
  notes Muse Spark Code adds for the model, and also a quoted chat passage,
  a Git draft prompt with its diff, the code you had selected or the
  contents of an attached file, which any editor connected over ACP could
  read in that list. Conversations saved before this release are listed
  under your words too, and one whose first message was only an attachment
  is listed as "Untitled".
- Starting Muse Code no longer lets a program planted in the workspace run
  from PATH. Every child environment built for `muse serve` drops PATH
  entries that are relative, empty or inside the workspace, on Windows,
  macOS and Linux alike; nothing else in PATH changes. Drive-relative,
  UNC, verbatim and admin-share spellings of the workspace compare as the
  workspace itself, and guarded Windows children also ignore the working
  directory when resolving programs. The same exclusion covers `muse login`,
  the account host, the sandbox check, and every other product lookup
  (`git`, plugin runtimes, MCP server commands, shells, hooks, openers,
  voice recorders and team workers). A planted helper never runs either:
  real use caught a planted `bwrap` running twice at serve start, before any
  prompt or approval.

### Known issues

- In VS Code on Linux the vault can be set up only when your account can
  reach the machine's TPM (usually by joining the `tss` group): this build
  of the extension carries no Secret Service component. The terminal agent
  (`muse-spark-code-acp`) includes it and uses your desktop keyring. The
  vault's message now says exactly this instead of sending you to unlock a
  keyring the extension cannot use.

### Packaging

- The Get Started walkthrough ships smaller, pixel-identical screenshots,
  and the packaged extension no longer carries the privacy file, which no
  code read; the file stays in the repository and the packaged readme still
  links the privacy policy by its URL.
- One package per platform, plus a fallback: the release ships six platform
  packages instead of one universal package. Each carries only its own
  platform's native pieces and is checked against the same unchanged size
  budget, and the untargeted fallback carries the Linux helpers for servers
  without their own package (Alpine, 32-bit ARM Linux), so they keep
  installing the way they always have.

### Release infrastructure

- Two earlier release tags for this version stopped at the release's own
  checks, before anything was built or published: first because the browser
  check's pinned Chrome for Testing runtime had fallen more than 14 days
  behind Chrome's Stable channel, then because the pin check, which had just
  begun reading Google's version lists through a schema, could not load that
  schema's library in a job that installed nothing. Both are fixed; the
  unpublished tags were deleted and 0.19.0 was tagged again.
- A new gate, `npm run check:workflow-scripts`, fails any workflow step
  that runs one of the repository's scripts before its job installs the
  dependencies that script imports.
- The release checks every package's Linux helper pins (each VSIX's voice
  bundle read from its runtime archive), and a release that reused its CI
  packages can be recovered from like one that built them.
- Every fake test is gone. Deleted: the tests that used stand-ins or
  invented data, the tests that only checked that some text, key or file
  exists, the editor host checks that drove the fake CLI, the fake-only
  Action check and its test package, and the Model API live sweep built on
  fakes. No product code was deleted.
- The unit suite now runs real code only: the fake-driven suites are deleted,
  the screenshot comparison system is removed (a UI change gets one small
  local look), and the coverage gate is dropped. The packed product's
  real-life run is the product's test.
- Pull requests can borrow the organization's CI runners. Once the owner has
  installed the organization's GitHub App and switched the capacity flag on,
  a pull request runs its Windows and macOS unit shards there while every
  other job runs here. The capacity wait survives the documented queue, and
  a weekly seed keeps the capacity cache warm. The Hosts, Forks and
  browser-check capacity runs follow the pull request's cumulative paths, so
  a follow-up push touching only an unrelated file no longer passes with no
  Windows or macOS run anywhere.
- The real-life run drives the packed product for real: installed into a new
  empty folder and used against real providers on their cheapest models,
  spending real money up to a stated request and dollar cap, with its record
  kept beside the release.
- The release door reads hosted evidence, not replays: skipped or neutral
  workflows no longer count as green, a second run ID for the same workflow
  and unchanged head is refused, hosted evidence is re-read immediately
  before passing, and publication recovery uses a fresh artifact-only run.

## [0.18.2] - 2026-10-12

### Highlights

- **The landing screen shows the extension's own mark.** The empty chat
  panel showed the Meta logo beside the product name. It now shows the
  product's own squiggled "m", the mark of the Marketplace and activity-bar
  icons: blue in dark and light themes, and in the theme's text colour in
  high-contrast themes and under forced colours.

### Changed

- The chat panel's empty screen shows the extension's own mark instead of
  Meta's logo, in the same place and at the same size. The mark is blue in
  ordinary themes and takes the text colour in high-contrast themes.
- The Get Started walkthrough's four pictures were taken again. Two still
  showed Meta's logo (the empty panel and the actions palette); the other
  two were from an older panel, and the sign-in picture did not show the
  third choice, Start with your own model, that the last page describes.

### Documentation

- The README's four screenshots that showed Meta's logo (modes, palette,
  slash commands, voice) were taken again and show the extension's own mark.

### Release infrastructure

- Screenshot comparison no longer runs in CI or in the local gate (the
  owner's decision, 2026-10-12). A change to the interface is looked at by a
  person, locally, in one light and one dark theme. The comparison could
  only say that a frame had changed against the frame accepted before it,
  never that what a frame showed was wrong: Meta's logo was in the accepted
  frames.

## [0.18.1] - 2026-10-12

### Fixed

- In 0.18.0 a turn on a model provider you added yourself, on a ChatGPT
  plan or through Copilot stopped before anything was sent, with an internal
  error ("… is not a function"). Those turns work again, and we are sorry
  for the broken release. Meta's own models were not affected.
- Usage recorded by earlier versions is counted again. 0.18.0 left those
  records out as not exact; nothing was deleted.
- Report a Problem did nothing if you had changed certain settings (those
  with a second dot in their name, such as `museSpark.vault.enabled`): it
  said "That did not work" and never opened. It opens again.

### Changed

- A damaged install now says so before anything is sent. Part of the Model
  API backend loads from a file of its own (`dist/modelApiTools.js`) the
  first time a turn needs it. If that file is missing or cannot be read, the
  turn is refused, nothing goes to the model, and you are told what to
  reinstall: the extension in VS Code, `muse-spark-code-acp` in a terminal
  or an ACP editor. The log names the file. Nothing else about a turn
  changes: what is sent to the model, what your hooks receive and the
  argument previews are the same bytes as before.

## [0.18.0] - 2026-10-11

### Highlights

- **Several accounts per provider, in the terminal and in ACP editors.**
  Keep more than one account with a provider:
  `muse-spark-code-acp providers accounts` lists, adds, orders and removes
  them and sets each one's thresholds,
  `auth set --provider <id> --account <id>` stores a key for one account, and
  `exec --account <id>` runs on the account you name. In an ACP editor on a
  Model API key, `/accounts` shows the list, the current account and its
  thresholds. A vendor limit stops only the account that hit it. Changing
  account inside a session, pooled runs and an Accounts page in the editor
  are not available yet.
- **See a tool call's arguments while the model writes them.** On a Model API
  key with `muse-spark-1.3-contributor`, a tool row in the panel and in ACP
  editors shows the file path, command, search pattern or URL as soon as it
  is complete. File content and edits stay hidden, and nothing runs, asks or
  calls a hook until the call itself is complete. Other models keep the
  finished-call row until their own stream is captured; headless `exec`
  shows finished tools only.
- **Reviewing Git changes works without a Git filter.** On a machine or
  repository with no Git filter configured (for example without Git LFS),
  every native review was refused with "Git could not read the changes to
  review" since 0.15.0. It works now.
- **The activity-bar icon is the extension's own mark.** The squiggled "m"
  of the Marketplace icon replaces the Meta logo silhouette.

### Added

- **Catch inventory and ratchet (tooling).** `scripts/catch-inventory.mjs`
  walks every `try/catch` and promise `.catch(` under `src` and classifies
  each as NARROW, REPORTED, SWALLOW, GENERIC or CLEANUP; `npm run
  check:catches` (wired into `npm run quality`) fails when any SWALLOW or
  GENERIC count rises against `scripts/catch-baseline.json`. Every
  SWALLOW and GENERIC in `src/acp` and `src/webview` is now NARROW or
  REPORTED with per-handler tests, and `docs/certification/
  catch-inventory.md` ranks the 40 worst remaining handlers in core, host
  and runtime for the per-area fix lanes.

- **Several accounts per provider, in the terminal and in ACP** (M108,
  CM108ACC). `providers accounts` lists, adds, removes and orders a
  provider's accounts and sets their thresholds;
  `auth set --provider <id> --account <id>` stores one key per account, read
  from standard input only;
  `exec --account <id>` pins a headless run to one account. In an ACP session
  on the Model API backend `/accounts` shows the list, the current account
  and its thresholds, and the `account` picker shows the same. Meta's Model
  API entry is built in, so nothing has to exist first; a vendor limit stops
  only its own account and the stop names it. Still refused, and saying so:
  changing account inside a session and pooled runs. The three account
  settings keep no effect, and the editor has no Accounts page yet.

- **Live tool-argument previews, in the panel and in ACP** (M106, C-M106-2).
  On the Model API backend a tool row shows an **Argument preview** while
  the model is still writing the call: declared top-level string fields
  (file paths, shell commands, search patterns, fetch URLs) appear once
  their closing quote validates, scrubbed like every other display. File
  content, edits and nested values stay hidden, and a tool the request never
  offered shows a byte count only. A preview never runs a tool, asks for
  approval or calls a hook. One model's record verifies streamed arguments
  today, `muse-spark-1.3-contributor`; every other model keeps the
  completed-call row until its own stream is captured, and headless `exec`
  records completed tools only.

- **Judge benchmark tooling (repository only, lane JEVBENCH, D107/M125).**
  `scripts/judge-bench.mjs` judges a labelled decision set through one
  engine interface (local Ollama SystemOne, local llama-server chat with
  logprobs, remote Jev wire or remote chat from environment variables) and
  reports accuracy, per-label precision/recall, per-domain accuracy,
  unsafe-approve count, Brier, latency p50/p95/max with cold vs warm, tokens
  and the 5 s veto-window fit. `scripts/judge-bench-decisions.json` holds
  170 hand-labelled decisions (50 allow / 50 deny / 50 ask plus 20 hard
  cases, all secrets synthetic). Results and the recommendation live in
  `docs/certification/judge-bench.md`. Nothing here runs in CI or ships in
  the extension.

- **Judge engine decision (lead, 2026-10-10; lane JEVBENCH2, D107/M125).**
  Jev online stays the Judge engine: on the Win11 GPU both local sizes
  fit the 5 s veto window but score far below Jev on the full 170 cases
  (0.376/0.375 vs 0.794), with 9 must-refuse cases approved by 4b.
  Local veto engines wait for ~0 unsafe-approves and accuracy within 2
  points of Jev; M125 lanes L/V retune the deny question first. The
  lead's rows in `docs/certification/judge-bench.md` (§§3/8) were
  verified cell-by-cell against the committed raw result files in
  lane JEVBENCH2 round 2 (all matched; gaps filled), and a new unit
  test fails if a committed result file contains anything key-like.

- Internal B1 inspect confinement tooling (M125 F1a): Linux per-file Landlock
  grants, verified system executables, a fixed environment, syscall guards,
  session self-tests and a portable runner. `npm run build:confine` builds
  its offline certification artifacts under `temp/`; no editor approval
  uses this path. macOS stays off pending its captured Seatbelt policy and
  platform receipt; Windows is excluded by D107. Fresh reviews and F1b's
  approval integration are required before exposure.

- Cursor's Tab hooks now run at Tab's two points (M94 lane K, revived as
  M94KR on the 0.17.0 base). `beforeTabFileRead` guards fail closed before
  completion dispatch, with verdicts cached per path and content digest and
  invalidated on configuration changes; `afterTabFileEdit` observes accepts
  with actual line text and never blocks. The guard and dispatch bridge stay
  in the lazy Tab bundle, all hook callers share the production runner's
  process cap, and a bundle-load failure logs fixed words only. The final
  live check remains open; see `docs/certification/m94-k.md`.
  - **What these hooks receive.** They are local processes you configure.
    `beforeTabFileRead` gets the absolute path and the **full, unredacted
    text** of the current file and of each context file, with the workspace
    folders, the Tab model and the request id. `afterTabFileEdit` gets the
    accepted text and the surrounding line text (512 characters each at
    most) with a 1-based range. Neither payload is sent anywhere by the
    extension; hook processes never get the Model API key.

- **Production admission for automatic compaction** (M101 C-M101-1, dormant).
  The panel backend manager and the runtime backend manager (ACP, exec) now
  bind the one shared D78 gate and ledger for automatic compaction
  (`admitAutoCompaction`) and the Meta catalogue model reader
  (`autoCompactModel`), so every host that offers automatic compaction
  admits the same way. Every automatic attempt reserves its projected cost
  from the daily ledger before dispatch, rechecks the claim synchronously
  at send, and settles once per attempt at its exact cost (known nonsends
  refunded, uncertain attempts retain their liability); a refused or
  missing ledger sends nothing. Near-window and overflow protection are
  never blocked by economics. Nothing changes for users yet: the feature
  stays off behind the unevaluated latch (`IS_AUTO_COMPACTION_EVALUATED`)
  and reports "awaiting evaluation", and requests sent while it is off are
  byte-identical.

### Changed

- What's New fits its content budget by itself: the newest release always
  ships in full. The writer checks every complete plan against both decoded
  and encoded bounds, preferring older full notes, then Highlights with a
  full-notes link, then omission, newest first. Keeping earlier Highlights
  never reserves bytes for a shortening flag the final plan does not need.
  A shortened page says "Earlier notes: see the full changelog",
  and the packaged changelog shows the same releases. A newest release that
  alone exceeds the budget still fails the build naming the release, so its
  notes are trimmed instead. Packaging uses the parser's heading and body
  spans; release headings require ATX `## [version] - YYYY-MM-DD` with LF or
  CRLF endings. CR-only files and Setext release headings fail by name.
  Only size overflow permits reducing notes: other encoding or schema
  failures stop the build with the releases and cause. HTTP/HTTPS schemes
  are normalized to lowercase, including repository-derived full-notes links
  in the page and packaged notes, so uppercase links cannot drop fitting
  notes. An unsupported repository URL fails by name before plan selection.

- Internal B1 inspect checks protected/private paths after canonicalizing
  their spelling, sends the same operands to the grant walk and program,
  and refuses noncanonical native input. A cancelled caller detaches from
  the shared self-test promptly; session disposal still awaits its cleanup.
  Regression properties and native canaries cover both review findings
  (M125 F1a); the component remains unavailable to editor approvals.

- Usage, team and schedule money is exact too (M121): journal and usage
  page totals, provider rows, key usage, team costs, budgets and preview
  totals, and schedule caps and liabilities are kept as exact decimal
  dollars and shown through the exact formatters. The usage journal moves
  to version 2; version 1 records with numeric dollars still read and
  convert exactly, and a record that cannot convert is refused with an
  explanation instead of being rounded or zeroed.

- Keep automatic-compaction admission in the lazy Model API backend and its
  price-card calculations in the existing providers bundle. Format paid-use
  questions on first use through the existing imported-hook runtime. Activation
  behavior, paid admission, displayed text and all bundle limits stay unchanged.
  Remove the unused internal GitHub lease-result type found by the train gate.

- M106's wire certification adds counted, scrubbed Muse Code 1.4.4 effort,
  feedback and session-lifecycle captures, plus an opt-in developer collector
  for Meta's missing raw argument stream, status and output-cap receipts.
  Every provider's remaining credential or local-runtime requirement is
  recorded. Muse Code 1.4.4's removed delete method is captured as a refusal.

- The Model API backend now binds the selected model's capability record in
  production: streamed tool-argument previews render on the U9-captured
  `muse-spark-1.3-contributor` model in VS Code and ACP, and Meta turns in
  VS Code and interactive ACP request the documented 131,072-token output
  cap. Headless `exec` requests at most 32,768 output tokens (or the record’s
  smaller maximum), because its run ledger reserves each request’s worst
  case before dispatch. Its body, schema, ledger and start reservation
  share one resolved cap. Headless `exec` drops every `tool_call`/`tool_call_update`
  before its sink, so it records completed tools only and never shows live
  argument previews. Unobserved models keep today's stream and the legacy
  32,768-token request cap. No setting changes; feature-off request bytes
  are unchanged (`docs/certification/m106-capability-binding.md`).

- Fixed headless edit reporting after argument previews: complete-argument
  promotion carries file locations through ACP, so successful edits appear in
  `filesChanged` even when their previews began without a path. ACP regression
  coverage now checks workspace-relative locations on any Windows drive and
  excludes pathless tools and paths outside the session workspace.

- Fixed the Model API selected-record binding review findings: the
  production entry resolves qualified models through the session client's
  own resolver instead of a standalone registry, so headless `exec` keeps
  its daily budget admission and run-ledger accounting, ChatGPT and Copilot
  subscription models stay selectable, plan-key usage stays with the owning
  service, and interactive ACP binds a qualified record's larger output
  cap. Declared IDE and MCP tools render preview text from their own
  string fields, as host tools do; unoffered tools still show a byte count
  only. The reference lists argument previews on the VS Code and ACP
  surfaces. Raw Meta capture receipts: the 16-frame U9 strict stream
  proves declared-tool preview text from captured bytes, and the refused
  1-token probe documents Meta's 16-token output minimum (the collector
  probes it next run).

- Fixed two follow-up selected-record binding findings (RVCM1062C). A
  compaction, Git draft or summary fork sent before any prompt on a resumed
  qualified model now builds its request after the selected record
  resolves, so it carries the record's output maximum and reasoning effort
  instead of the legacy 32,768-token cap and the unresolved fallback; the
  cached maximum is dropped whenever the record or the selection changes.
  Streamed argument-preview text now comes only from the tools the request
  itself offered: a tool the request never offered (allowlisted out,
  untrusted away, or never declared) renders a byte count only, never its
  fields (`docs/certification/m106-capability-binding.md`).

- Fixed both RVCM1062D binding findings. Strict tools preserve each host
  tool's curated preview fields, so file content, edits and tools without
  preview declarations remain hidden. Responses and token counts build
  from one resolved model record and use it for output caps, reasoning,
  offered tools, admission and accounting; configuration changes cannot
  replace the client underneath an already-built body. A stale record
  refuses before dispatch, and a switched selection rebuilds the request.

- Fixed the RVCM1062E finding: every stale-record refusal now names the
  operation the user actually ran. A lapsed record during manual
  compaction says to compact again, during a turn to send the message
  again, and during a model-hook call to try the action again; headless
  runs name the run, and resolution-time refusals that know no operation
  retry neutrally. Scheduled prompts keep their schedule guidance. The
  new guidance is translated in all fourteen UI tables
  (`docs/certification/m106-capability-binding.md`).

- The activity-bar icon is now the extension's own mark: the squiggled "m"
  from the Marketplace icon as a single-colour mask, replacing the Meta logo
  silhouette. The Marketplace icon, banner and social preview already used
  the "m"; the activity-bar icon was missed.

- The visual check's What's New footer screenshots apply hover, focus and
  pressed to the footer's own links, whatever the notes above them end with
  (VISFOOT).

- The Cost Over Time chart now scales its bars to the largest period, like
  the token and time charts; before, a period under $1 drew a short bar
  whatever the others were.

### Fixed

- Local report sources sort every tied list to a total order, so the same
  inputs produce byte-identical source facts whatever order records arrive
  in: Git commits, tags, branches and worktrees break key ties on their
  full serialized bytes, session check runs break remaining ties on
  serialized bytes after the existing timestamp/check/outcome/commit/
  duration fields, usage breakdown and limit keys do the same, scrubbed
  question ids do the same, and agent file order normalizes Windows
  separators before comparing. Permuted valid inputs additionally render
  byte-identical changes, project, session and usage reports in Markdown,
  HTML, JSON and text. Distinct records that scrub to the same key still
  collide at the collector's unique row keys; that pre-existing collector
  limitation is recorded, not changed, by this repair. Runtime discovery
  also refuses directory entries shaped like session files, so a folder
  named `*.jsonl` can no longer mark a usage read partial (C-M113-1,
  RVM113S tie-breaks, RVCM1131 findings 1–3).

- Tab's Help description and all 14 translations now explain that only
  **Allow always in this workspace** saves the model and price; **Allow once**
  saves nothing, covers this window, and each new window asks again. The
  generated reference no longer promises one extra question for legacy consent
  (RVM94KR4G).

- Tab consent review RVM94KR3G: accepting image generation's price or turning
  voice off preserves Tab's **Allow once**, including requests waiting to
  send. Revocation is per feature; **Ask again** and Tab's own price acceptance
  changes end its consent, and a changed model or price asks for its own key.
  The legacy **Allow always** migration saves the model and price only when answered
  **Allow always in this workspace**; **Allow once** saves nothing and the
  next window asks again.

- Tab consent and hook-policy review RVM94KR2 (M94 lane K, redesign). Each
  point fails closed.
  - Tab's consent is keyed by model and price. A question open for one model
    no longer answers a request for another; **Allow once** stays in its
    window and is never written down; **Allow always** is kept with the model
    and price it named. An **Allow always** kept by an earlier version asks
    a migration question: only **Allow always in this workspace** saves the
    model and price; **Allow once** saves nothing and the next window asks
    again. An answer given after **Ask again** sends nothing.
  - A hook file or setting change stops Tab reading from the moment it is
    noticed, before the `ConfigChange` hook runs, until it has reloaded.
  - A request's last check now runs immediately before it is sent, after the
    key read and rate pacing: a changed model, consent or hook configuration
    sends nothing, and the request costs nothing.
  - A hook's cached read verdict counts only for the model it was asked about
    and the configuration it ran under.

- Tab hook review RVM94KR (M94 lane K). Each point fails closed.
  - A `spark-hooks.json` that is present but does not load in full no longer
    reads as "no hooks": invalid JSON, an unreadable or oversized file, an
    unknown event name, an invalid Tab group or a guard whose matcher never
    names `TabRead`. Tab then reads no file, and the status bar says **Tab
    paused: hook file has errors** in all 14 languages until it is fixed.
  - A Tab request is bound to the trust, Tab settings, `files.exclude`,
    ignore files and hook configuration in force when it starts. It is
    checked again after the paid question, at dispatch (after the debounce or
    a wait for a free slot) and before its answer shows, and dropped if
    anything moved.
  - The paid question names the request's own model, the request sends only
    that model, and a request for another model than the one last allowed
    asks again, **Allow always** included.
  - A hook whose wait for a process slot was cancelled now gives its
    admitted resource lease back.
  - The privacy guide said configured Cursor Tab hooks did not run; they do,
    and the guide, README and this entry now say what they receive.

- Unproved version 1 monthly rollup dollars are refused before money validation,
  preserving the other usage days and the translated precision notice even for
  overflow or negative literals (M121A round 4). Changes that round to zero show
  `0%`; the money guard also checks nested and generic mapped keys, including
  remapped (`as`) names and lib-declared records beneath ordinary wrappers.

- Legacy money reads fail closed on overflow, underflow, negative zero and
  unconvertible exponents (M121A round 3), preserving the precision-refusal
  notice instead of accepting a rounded zero.

- Usage period-change percentages and cost sorting use exact dollars,
  including charges smaller than a nano-dollar. Portable usage summaries
  share the same exact percentage calculation; very small monetary labels
  keep their digits beyond Intl's precision limit. The money guard resolves
  union/intersection members, apparent types and inherited interfaces.

- Exact money keeps every promise on every Node version (M121A fix round).
  Version 1 journals and schedules read dollars through a small JSON parse
  that keeps each number's written digits, so a literal a double cannot
  carry is refused on Node 20 exactly as on newer runtimes instead of being
  rounded into the record. Usage charts label the original amount in every
  status line, data table and previous-period figure; only the plotted
  geometry stays approximate, so a single xAI tick no longer reads as ten
  times its charge. The exact-money type guard now also sees through
  finite-key records and mapped types.

- Tests only: the exact-money guard cites PLAN.md by heading and quoted
  phrase instead of by line number. A line number named a different sentence
  after every edit above it, and the old check only asked that the numbered
  line was not blank; each sanctioned entry's clause must now be in PLAN.md
  exactly once, under M121's heading, so PLAN edits elsewhere no longer turn
  the suite red and a deleted, reworded, duplicated or moved clause does.

- **Automatic compaction review repairs** (M101, RVCM1011C): hidden options
  preserve the complete ACP and CLI manuals, including invalid-argument help.
  Help filters structured option identities rather than flag substrings.
  Revoked consent, paid switch, trust or evaluation refuses only that
  compaction and lets the ordinary turn continue; actual ledger failures
  still fail closed. The native setting keeps 0.17.1's description (it shows
  or hides the first-turn notice while automatic compaction is inactive), and
  the README and ACP page do not describe the inactive feature.

- **Automatic compaction admission, third review** (M101, RVCM1011B): one
  authority reserves each actual request's input estimate and full output
  allowance, settles reported usage and refunds the difference. Consent,
  paid switch, trust and evaluation are checked at preparation and final
  dispatch, including retries; revocation stops the send. Unevaluated
  automatic compaction is absent from paid surfaces and help; the native
  setting only shows or hides the first-turn notice.
  Turn-on confirms its rates, manual summary forks keep their own identity,
  and ACP Once covers one workspace within the agent process.

- **Automatic compaction admission** (M101, RVCM1011): shared first-charge
  consent precedes spending; daily Stop and unreadable storage refuse even
  near-window protection. Each HTTP attempt gets a fresh claim, known
  nonsends refund, and settlement failure ends the owning turn before any
  continuation. ACP/exec use their transport's sole daily debit. ACP adds
  `--auto-compaction` as an explicit paid opt-in; exec paid defaults remain
  off. The evaluated latch remains false.

- The installed CLI, ACP agent and headless runs share the account service
  instead of answering "Accounts are unavailable": Meta's Model API entry is
  built in, so `providers accounts` (list, add, remove, order, thresholds),
  `auth set --provider meta --account <id>`, `exec --account <id>` and
  ACP's `/accounts` (list, current, thresholds) work with no pre-existing
  file. The `account` picker serves the Model API backend only; the Muse
  Code backend runs on its subscription, and an accounts failure leaves the
  session working without accounts. Choosing another account in a session
  stays refused until the pooled owner lands, and says which account the
  session keeps instead of reporting unavailable — including across the
  runtime/ACP bundle boundary. A malformed user row refuses and is left
  untouched (the built-in entry applies only with no file); a vendor-limit
  stop names the blocked account and its reset even with no usage page
  bundled; a pooled `exec` run names the missing pool owner instead of
  the connection text. The Models panel stop notice names the blocked
  account too, and a refused providers file (a malformed row, unparsable
  JSON, duplicate account ids, or a provider id that does not match its
  key) says the file was refused and left unchanged instead of the
  connection sentence — on the terminal, through ACP list/current/thresholds
  and picker selection, as the Models panel's own error, from `exec
  --account` readiness instead of a keyring-outage message, from developer
  multiple-accounts open instead of a raw stack, and on the terminal crash
  line as the sentence itself.

- Models & Agents keeps the visible section during lazy navigation and reserves
  its remembered height on reload. The first visit estimates its host rows.
  Visual captures wait for money amounts, and filtered model tables now have
  reviewed coverage across every theme, width and interaction state.

- Release-train bundle diet (repository only, no user-visible change):
  shared top-level initialisers the bundler cannot drop (computed
  `Math.ceil`, `String.raw`, `String.fromCodePoint`, `'0'.repeat`,
  templates over constants, call-argument `new Set`) are literals or pure
  factories now, and single-surface schemas live behind pure builders, so
  small bundles stop carrying them: usagePanel.js back under its cap with
  room to spare. Recorded in `docs/certification/train-bundle-diet.md`.

- A confirmed run on a ChatGPT or Copilot plan model (hook model, review,
  scheduled prompt) no longer fails with "the model changed" before it is
  sent. The subscription client proceeds while the confirmation is still
  allowed and refuses with the run's own guidance only once it has lapsed,
  like the other clients (M106, RVCM1062F).

- Fixed the RVCM1062G findings on that plan-model success path. A confirmed
  scheduled run now records its start receipt and scheduled-prompt tally,
  and a paid-gate lapse during ChatGPT sign-in or Copilot token counting
  still refuses before anything is sent — through the same
  confirmed-dispatch helper the other branches use. A lapsed confirmation
  names the hook, schedule or review instead of the generic plan retry
  sentence, and a catalogue request id is accepted against a session
  confirmation id (M106, RVCM1062G;
  `docs/certification/m106-capability-binding.md`).

- Fixed the RVCM1062H findings: the last two confirmed-dispatch paths that
  decided by themselves now route through the shared helper. A still-allowed
  scheduled or hook confirmation on a configured provider (which carries no
  origin) dispatches instead of refusing with "Models & Agents is not
  available in this build", and a lapsed confirmation there keeps the run's
  own guidance instead of that sentence. An inventory test fails if any site
  but the helper ever refuses a confirmed dispatch again (M106, RVCM1062H;
  `docs/certification/m106-capability-binding.md`).

- Reviewing Git changes now works on machines and repositories with no Git
  filters configured (for example without Git LFS installed). Broken since
  0.15.0, it refused every native review there with "Git could not read the
  changes to review" (lane REVIEWEXIT).

### Documentation

- The README's Resources screenshot shows the relocation sentence users
  see ("Relocation requires a paired device or runner route."); it still
  showed the wording 0.17.1 replaced.

- PLAN.md had grown to 4,157,477 bytes, 36,827 short of the 4 MiB bound at
  which `check:plan`, `check:roadmap` and `/report` refuse it. Closed history
  moved to `docs/plan-archive/`, byte for byte: the design record of 50
  decisions (`decisions.md`; PLAN.md §2 keeps each heading, a paragraph that
  states the rule in force and a link), 140 gate records dated 2026-10-08 or
  earlier (`gates.md`) and 7 closed 0.17.0 sections (`milestones.md`).
  PLAN.md is 3,472,457 bytes. Passages that open branches touch, passages
  tests cite and live tables stayed in place; every parsed fact is unchanged
  and ROADMAP.md regenerates identical. `check:plan` now fails when PLAN.md
  passes 85% of the bound and names the archive procedure in CONTRIBUTING.md,
  and `test/unit/planArchive.test.ts` hashes every archived passage.

- `npm run plan:archive` (repository only) moves passages of PLAN.md into
  `docs/plan-archive/` and proves each move before writing: the old file is
  rebuilt byte for byte from the result, and the plan reader must parse the
  same facts. `status` shows the plan's size against the bound and the gate
  and checks every archived block's hash. A design record now goes to the
  archive in the change that adds it; PLAN.md keeps the rule in force and
  the link (AGENTS.md, CONTRIBUTING.md).

## [0.17.2] - 2026-10-11

### Fixed

- A reply from a provider you added yourself (an Anthropic, OpenAI or
  Mistral key, a local server and the others) or from a ChatGPT plan is no
  longer cut off 30 seconds after the request starts. Since 0.15.0 any answer
  that took longer, such as a long written answer or one the model thinks
  about first, was lost, and for a provider you added the error read
  "Models & Agents is not available in this build." A reply now has no limit
  on its total time; one that goes silent ends after 5 minutes with nothing
  received, and the message says so.

### Changed

- The visual check renders the What's New screenshots from a fixed sample
  of release notes (`test/harness/whats-new/CHANGELOG.fixture.md`) instead
  of this file, so a release's notes and its version no longer need new
  reviewed screenshots. A test names any kind of Markdown the real notes
  use and the sample lacks. The capture inputs gain the build helpers and
  the dependency versions, and no longer include this file (VISFIX).

## [0.17.1] - 2026-10-10

### Highlights

- **The provider picker works again.** Models & Agents lists every provider
  again, Anthropic and custom servers included; 0.16.0 and 0.17.0 showed only
  "That did not work" and an empty list.
  <!-- try: command museSpark.modelsAndAgents -->
- **Saving a provider keeps what worked.** Save checks everything first, then
  saves in order; if a later step fails, the saved parts stay saved and the
  panel says what was not. Edit and Change Key keep the saved connection.
- **The wizard's spending limit is your real conversation limit.** It shows
  the current limit, writes only when you change it, and asks before
  replacing a limit someone changed meanwhile.
- **Title Case labels.** English buttons, menus, tabs and titles capitalize
  every major word; sentences and messages keep sentence case.
- **Smaller fixes.** Chat action menus fan close around the row's **…**
  button, highlighted-text actions included; a question's own-answer field no
  longer overlaps the options and buttons around it, sharing a chat from an
  ACP editor or the terminal shows its preview, an ACP session on a Model API
  key starts without account details, DeepSeek's Thinking off sends
  DeepSeek's own switch, a nearly spent budget stops with the budget message
  instead of a Meta error, a Muse Code older than 1.4.3 that hits its
  approval-record fault now gets the update command, and Help and these notes
  describe only what works today and name the features still being built.

### Changed

- **Help, settings and release notes describe only what works.** Several
  accounts per provider, the credential vault, scheduled prompts v2, capacity
  estimates, teams of workers, automatic compaction, live argument previews,
  moving work to another device and ten of the fifteen report kinds are still
  being built. The README, the Marketplace page, Help & Reference, What's
  New, the roadmap, the terminal's and ACP's help and the settings
  descriptions (in all 15 languages) no longer present them as usable. The
  notes of 0.15.0, 0.16.0 and 0.17.0 keep their text, each with a dated
  correction, and What's New leaves their corrected items out. `/loop`,
  manual compaction, the project, quality, milestone, release and change
  reports and the terminal and ACP playbook commands are documented as
  before (CX1).

- Commands of features that are still being built say so. `/schedule` and
  `/estimate` answer that they are unavailable, in chat and in ACP editors,
  and are left out of the `/` menu, completions, ACP command lists and Help;
  a workspace skill cannot take over their names. The schedule, vault and
  estimator commands are hidden from the Command Palette and refuse when run,
  and `/vault` refuses in ACP. Settings with no effect yet keep their stored
  values and say "Stored for compatibility; no runtime effect."; the
  schedule, relocation, automatic-compaction and credential-fence settings
  describe what they still control. Switching team workers on or off records
  no price acceptance (CX1).

- **English titles and labels use Title Case.** Buttons, menu items, tabs,
  headings, dialog and section titles, chips, badges, column headers, field
  labels and command titles now capitalize every major word ("Rewind
  Conversation to Here", "Open in Browser", "Account & Usage"). Sentences,
  notices, tooltips that are sentences, placeholders and error messages keep
  sentence case. Other languages keep their own convention; their labels and
  badges that began in lower case ("aktuell", "payant") now start with a
  capital. A follow-up pass cases sixty labels the first pass missed (count
  and state labels such as **1 Background Task** and **Running**) and keeps
  error text that shares a key with a label in sentence case (`Duration
  unknown`, `Stop upload`, `All slots busy`), with separate label keys for
  the chips and buttons that show those words. A later pass splits two more
  shared keys the same way: the missing-key failure stays `needs a key`
  while its labels read **Needs a Key**, and the unconfirmed private-network
  failure stays `Use it anyway` while its dialog button reads **Use It
  Anyway**.

### Fixed

- A question's "Type your own answer…" field no longer touches the Other
  option above it or the Submit and Explain instead buttons below it; its
  focus ring now has room on both sides.

- Chat action menus fan close around the row's **…** button, with 6 px gaps
  and a shallower arc. Highlighted-text actions open at the selected row's
  **…** button (the pointer only when the row has none) and follow it through
  scrolling, content reflow and panel resizing; a menu closes when its opener
  disappears or scrolls out of view. Narrow menus, the checkpoint **Rewind**
  submenu at 320 px included, keep their equal-width pills clear of the
  opener and cut long labels short with the whole label in a tooltip. Hover
  and pressed borders stay inside each pill, and keyboard focus rings keep
  2 px clear of the pills beside them.

- A nearly spent session budget now stops the turn with the budget message
  instead of a Meta error: the output cap is recomputed for each request and
  never sent below the provider's minimum (16 tokens for Meta), which Meta
  rejected with HTTP 400.

- Static output caps below the selected provider's known minimum are refused
  when saved and before sending, with the same translated message naming the
  minimum (16 tokens for Meta). Older stored caps are refused without a request
  or a silent increase.

- The companion page server no longer misses a stop request, a transport
  error or an early transport close that arrives while it is still starting:
  it handles them instead of hanging or failing with an error nothing catches,
  and cancelling during startup stops it at once with the cancel's reason
  instead of waiting for the server to finish binding.

- Sharing a chat now shows its preview in ACP editors (`/share chat`) and in
  the terminal (`muse-spark-code-acp share chat`). In 0.17.0 both always
  ended with an error saying the conversation's history was not returned,
  because the conversation was never read.

- ACP editors on a Model API key can start a session when no provider
  account details are stored. In 0.17.0 every new session then failed with
  an internal error, because the optional accounts service was started with
  the session and its failure stopped it. A session now also opens when that
  service fails to start, without account controls (CX1).

- ACP editors refuse `/schedule`, `/estimate` and `/accounts` the same way
  when they are typed after spaces, tabs or blank lines. Such a prompt used
  to skip the refusal and run a workspace skill of that name, or go to the
  model as an ordinary message (RVCX1F).

- The panel's deferred English is back within its 25 KiB budget: the
  output-minimum message no longer brings the provider file's own text into
  the browser. Chat startup no longer loads the schedule surfaces' English
  to refuse `/schedule`, and stays within its first-paint baseline.

- Muse Code approval-ledger fault notices now give the update command on
  versions older than 1.4.3. A live Windows 1.4.3 check accepted the approval
  without that fault; detection remains active on every version. Rename and
  fork still fail on 1.4.3, so their Windows limits remain. The sandbox cwd
  was correct on the prepared host, but a shell write was denied; the
  profile-workspace workaround remains until fresh-setup reliability is proven.

- Shorten the existing question-deferral Help summary and its 14 translations,
  restoring the surface-English bundle to its unchanged 25 KiB budget without
  adding strings or dropping the question, permission or ACP instructions.

- Reopening provider Edit after an address change whose key write failed can
  save a newly tested replacement key. Concurrent credential changes still
  conflict, and the old key remains unusable at the new origin.

- Confirmed quick-pick spending-limit retries preserve receipts for the
  provider, key and default already saved when a later write fails, in all
  14 translated languages.

- Provider Save validates before writing, then saves changed provider fields,
  an entered origin-bound key, an explicitly chosen default, an edited spending
  limit and the requested conversation model in order. Later failures keep
  completed writes and name saved, failed and skipped steps in all 14 languages.
  Rollback and its inverse machinery are removed. A key-write failure after an
  address change shows the key as missing; the old key cannot serve the new origin.

- Every provider Save outcome attempts panel refresh. A refresh failure appends
  its warning without hiding entry/key/default/limit errors or saved information.
  Budget-only partial drafts can retry with a fresh baseline; other partial or
  stale drafts reopen from the completed writes.

- Provider Save compares edited fields with the opening snapshot inside the
  stored update. Untouched keys retain later rotations or removals, and untouched
  provider fields retain changes made during private-network confirmation.
  Competing edits to the same field stop Save and offer Reload with no overwrite.

- Provider Edit and Change key share a full copy of the saved connection.
  Unchanged routing, format, model limits, favourites, compatibility, private
  access and default model stay intact; only an explicit default choice
  retargets it. Save preserves untouched concurrent fields, ignores duplicate
  submissions and disables its buttons while working. Declining private-network
  access asks for confirmation instead of calling the saved address invalid.

- Saved custom-provider limits persist directly from Edit without another
  connection test when the address, format and key are unchanged.
  Save reports success or its specific failure; failed saves keep the form and
  typed limits open for retry, and the next Edit shows the saved values.

- The provider wizard leaves an untouched spending limit alone and compares
  an edited limit with its prefill at write time. Concurrent changes are shown
  with a confirmation request. Provider save finishes before the limit write;
  a later limit failure says the provider was saved and gives the reason,
  without claiming full success. The panel retains the edit for a safe retry.

- Editing or changing the key of a saved custom provider keeps its model
  limits, exposes them for editing, and saves them back. Back from incomplete
  custom limits keeps the typed values and allows returning to Models;
  final Save still validates every limit.

- The provider wizard stores the conversation spending limit as the number
  its native setting requires, refusing amounts that would lose decimal
  precision or overflow at that boundary.

- Models & Agents: **Scan This Computer** offers every local server that answers
  ("Ollama on Port 11434"); choosing one opens its wizard with the local port
  filled, and an empty scan says nothing is running yet and names each local app
  with its usual port. Previously it kept only the first answer, asked for a
  local port it never used, and said nothing when nothing answered. Mistral's
  plan key now has its own "Mistral Plan" label and a sentence saying it uses
  the subscription's credits, not pay-as-you-go billing. The Copilot sign-in
  has its own sentence (VS Code's granted models, billed to the Copilot plan
  or AI credits) instead of repeating ChatGPT's notice.

- Editing an OpenRouter provider or changing its key preserves its saved
  privacy, provider order and fallback choice through Test and Save, including
  Change key followed by Edit. New providers still default to no data retention.

- A failed model scan stops showing Scanning and offers Refresh with a clear
  reason. Previous model rows remain available; cancelled scans keep their
  existing behavior.

- Change key in Models & Agents keeps the replacement when Edit opens.
  Test uses that draft key; Save keeps it, and Cancel leaves the stored key.

- OpenRouter's key test checks its key endpoint before saying the key works.
  The panel and CLI share the same free-check contract, so a successful public
  model list cannot stand in for a credential check.

- New OpenRouter setups in Models & Agents default to no data retention,
  matching the shared setup flow and saved privacy routing.

- Models & Agents shows captured provider prices and recognizes free cloud
  models. Free and price filters include the right rows, and a refreshed
  cache price counts as a price change. Routing metadata updates do not count
  as price changes.

- Models & Agents can scan Gemini and Ollama after ordinary setup, and
  Anthropic's scans and key tests send its required version header. Presets
  supply the wire format when it is absent from saved configuration.

- Models & Agents: the provider picker works again. In 0.16.0 and 0.17.0 it showed only
  "That did not work" and listed no provider, Anthropic included, because
  Mistral's plan key carried the Subscription sign-in category the panel's
  card contract did not accept, and one refused card emptied the list. The
  contract now has that category, and the host's chip type is derived from
  it, so the two cannot drift again. ChatGPT and Copilot sign-ins move under
  the Subscription sign-in chip, where the plan put them, and Custom server
  (Chat Completions, Responses or Anthropic Messages) is in the picker again.
  A preset the contract still refuses is left out on its own, with a log line
  that names the preset and the field but no value. A test opens every
  shipped preset and adds Anthropic end to end. (The custom-server save in
  that test used the memory store, so it missed that a custom entry needs
  per-model limits to save through the production file; corrected below.)

- Models & Agents: four review findings closed. A custom server now asks, per
  ticked model, for its context window and longest reply (prefilled from the
  server's model list where reported); Save stays disabled with the reason
  until each ticked model has valid limits, and the entry saves through the
  production file, which a new test proves against a real providers file. The
  first Test of a private endpoint now carries the consent just granted, so it
  sends once and shows its result; declining still sends nothing. A saved
  provider whose preset card is refused stays listed as unavailable with its
  reason instead of hiding every valid provider. Subscription sign-ins follow
  availability: an unavailable sign-in shows disabled with its reason in the
  picker (Copilot stays hidden in confidential workspaces, per the README),
  and choosing one is refused with that reason before any connector runs.

- Models & Agents: the provider wizard's spending limit is now the real
  conversation spending limit (`museSpark.modelApiSessionBudgetUsd`).
  Previously the wizard accepted a "Session budget" and reported setup
  success while the enforced cap stayed unchanged, so a typed USD 2 left the
  conversation unlimited. The suggestions step now labels the field
  "Spending Limit per Conversation (USD, 0 = No Limit)", shows "This is your
  setting for every conversation; it is $X now", prefills the current
  effective value, and the typed number counts on Continue and on Save. An
  unchanged value writes nothing; a changed one is written at the scope it
  is effective from (an existing workspace value stays a workspace value).
  A failed write keeps the typed value, shows its specific error, and
  reports no setup success. The quick pick does the same through the same
  shared function instead of dropping the value.

- DeepSeek Thinking off now sends the documented `thinking: {type:
  "disabled"}` switch and omits `reasoning_effort` instead of sending the
  unlisted value `"none"`. Any other effort a model's declared list cannot
  express is refused with a typed codec error rather than reaching the wire;
  every other preset's request bytes are unchanged.

- DeepSeek review fixes: an unlisted Thinking-on effort (e.g. `medium`) is
  refused with the typed `unsupported_reasoning_effort` error instead of
  silently disabling thinking; the off switch also sends for toggle-only
  models with no effort list; and the typed refusal now reaches the caller
  instead of the generic unavailable error.

- Reasoning effort and Thinking off now go through one resolver per
  selected model and its capability record. DeepSeek: an unlisted
  Thinking-on level moves to the nearest level the model lists (for
  example `medium` sends `high`), never to Thinking off; Thinking off is
  sent only where the model can disable thinking, otherwise it is refused
  with a translated "Thinking cannot be turned off for the selected
  model."; a model without effort levels gets no effort field. Every
  other provider's requests are back to byte-identical with 0.17.0,
  which also restores short Claude Haiku replies at the default effort.

- Visual review covers 0.17.1's Title Case labels, provider-picker repair,
  chat menus and current What's New notes across all six themes at 320 and
  690 px.

- Visual baseline reconstruction accepts the recorded sentence-case account
  and vault labels alongside 0.17.1's Title Case labels. Pixel, coverage and
  readiness checks retain their existing limits.

- The visual harness supplies the canonical conversation budget required by
  the provider panel, so wizard scenes render through its strict message schema.

- Visual capture lets lazy chunk requests settle between its frozen-clock
  paint steps, so a scene whose chunk arrives late (agent details) is
  captured after it rendered. Scenario timing and failure bounds are
  unchanged (CX1).

### Documentation

- README screenshots show 0.17.1's current labels, question-field spacing and
  chat menus, regenerated through the repository's screenshot script.

- Correct the provider-wizard round-3 certification text to the round-4
  contract: provider persistence precedes the spending-limit write, and a
  later limit failure reports partial success with the provider saved.

## [0.17.0] - 2026-10-08

Correction (2026-10-10): Several accounts per provider, credential vault, scheduled prompts v2, capacity estimator forecasts, ten report kinds and VS Code panel playbook access did not work for users in this release; it is being completed.

### Highlights

- **Deterministic reports.** `/report` builds project, quality, milestone,
  release and change reports from local facts, in Markdown, HTML, JSON or text,
  with saved history and comparisons; nothing is sent to a model.
  <!-- try: command museSpark.showReport -->

- **Capacity estimates (preview).** `/estimate <goal>` and the Estimator are in
  place and verified with test data. Real forecasts need the plan reader
  bound into the estimator; the reader is on main but still unbound, so until
  then they say so instead of guessing.
  <!-- whats-new: historical -->

- **Several accounts per provider.** List provider accounts, see the current
  one and its thresholds; a vendor limit blocks only the affected account.
  <!-- whats-new: historical -->

- **Orchestrator playbook.** The nine orchestration rules ship as a first-party
  skill. In the ACP agent and the CLI, `/playbook status`, `record` and
  `settings` answer locally. Today: the VS Code panel does not enforce them yet.
  <!-- whats-new: historical -->

- **Refreshed design.** Shared design tokens and generated palettes style every
  panel surface; an optional pinned OFL font pack serves standalone installs.

### Changed

- Update the ACP SDK to 1.5.1, Vitest and V8 coverage to 5.0.3, jscpd to
  5.4.0 and knip to 6.39.0. Keep typescript-eslint 8.70.1 because 8.71.0
  regresses lint memory use. Rules, deadlines and bundle budgets stay intact.
  ACP and team-child streams use the media budget plus 16 MiB instead of
  the SDK's 32 MiB default, allowing valid multi-image prompts to reach
  individual image and media checks.

- Restore bundle budgets through shared wire schemas and report redaction,
  a backend port for accounts, fewer ACP locales, and deferred vault English,
  Help facts, estimate schemas and exact dollar formatting. Accounts shrink
  from 348 to 48 KB; the ACP engine from 915 to 639 KB. The provisional
  universal VSIX cap is 3700 KiB pending hosted measurement.
  <!-- whats-new: historical -->


### Fixed

- Action apply fixtures disable Git auto-gc and maintenance, preventing
  detached repacks from racing the tests; a guard verifies this.

- `/estimate` recognizes Windows instead of rejecting Node's `win32` name.
  <!-- whats-new: historical -->
- Developer storage works below linked ancestors, including macOS `/var`,
  redirected profiles and Windows short names. Links at or below its root
  are still refused.

- Translated tables ship in English key order; packaged ACP tables match
  their sources byte for byte.

### Documentation

- [Contributor vetting](docs/contributor-vetting.md) requires person and
  change review, Codex and Grok reviews, a certification record and the
  owner's approval before outside code runs, lands or is copied. Hosted PR
  CI may run after person and change review. All external fork contributors
  require workflow approval. The earlier contribution has a retrospective
  record evaluating its tests; CONTRIBUTING documents the policy.

### Fixed

- Compress README captures while preserving every pixel and PNG metadata;
  unchanged images remain exact.

- Avoid redundant plan-string writes while retaining privacy scrubbing;
  prepare usage fixtures within their existing deadlines.

- Centre chat in its container, await schedule mounts before accessibility
  scans, and supply the real report panel input in CI.
  <!-- whats-new: historical -->

- Register both schedule defaults as flat machine-scoped settings beside
  the schedule switch; keep validated legacy reads.
  <!-- whats-new: historical -->

- Await the named screenshot scenario after the webview handshake so empty
  welcome screens cannot pass capture or accessibility checks.

- Traverse reader-owned arrays without scrubbing generated indices as text;
  retain recursive secret scrubbing and the plan performance budget.

- Cache validated journal deltas only while reread bytes match, clone before
  replay, await workflow controls, and measure heavy engine/browser fixtures.

- Keep recording-reader fixtures within ordinary deadlines; name only the
  measured TypeScript compiler setup timeout.

- Reuse schedule-journal validation only while serialized bytes match;
  reread storage and validate every change and lease.
  <!-- whats-new: historical -->

- Include schedule usage in shared CLI help; keep the native theme bridge
  within budget and validate original role keys.
  <!-- whats-new: historical -->

- Share schedule XML encoding, use maintained report task-glob matching,
  and verify literal private paths before redaction.
  <!-- whats-new: historical -->

- Use generated tokens for report borders and usage-chart fallbacks; retain
  native theme overrides and the 4 KiB core token budget.

- Restrict context recording to fixed reader-only builders. Reject unbranded
  or copied content and filesystem, Git or skill-store imports, including
  dynamic imports. Sealed scopes cannot create content or rerun adapters.

- Discard late acknowledgements for idle turns; refuse automatic verification
  as soon as scheduled steering claims the session, before adopting input.
  <!-- whats-new: historical -->

- Record cached scheduled inputs, Git facts and directory indexes in closed
  reader scopes. Refuse replay of undelivered Git subjects and verification
  that would read unconfined editor dependencies. Defer schedule authorization
  and context builders, freeing over 10 KiB in the Model API bundle.
  <!-- whats-new: historical -->

- Retain pending native starts across idle snapshots so schedules cannot
  claim an ordinary turn acknowledged afterward.

- Require complete cached-context source inventories and derivations, with
  one canonical workspace boundary for cached and live reads. Omitted or
  truncated evidence cannot authorize delivery.

- Release stale schedule mode effects and stopped or withdrawn admissions,
  settle refused queued fires, and validate steer media before claiming a
  session, allowing later work to proceed.
  <!-- whats-new: historical -->

- Load tool rows and schedule channels on first use with accessible loading,
  explicit failure and retry; preserve provider, usage, report and schedule
  behavior alongside playbook fixes.
  <!-- whats-new: historical -->


### Fixed

- Preserve reports, provider/team workflows and playbook during integration;
  remove duplicate Help, retain prompt scope for a local user named `user`,
  and generate report palettes from shared tokens.
  <!-- whats-new: historical -->

- Keep universal packaging within budget through lossless localization leaf
  archives, full English fallback and legacy decoding. Key ordering changes
  no translated values.

- Fit the planning document within its parser bound without losing decisions,
  rationale, milestone status or delivery order.

### Fixed

- Preserve provider, team, legal, sharing and local usage workflows alongside
  reports, design and playbook, within existing bundle caps.
  <!-- whats-new: historical -->

- Load optional English before the first slash registry resolves; Help-only
  fallback stays in lazy Help.

- Await sandboxed report content and fonts before screenshots; retain main
  chat readiness checks.

### Added

- Ship the orchestrator-playbook skill with nine rules, a third-strike
  redesign template and two repository examples. Project or personal skills
  take precedence on Model API; Install Bundled Skills copies it byte-exact
  for Muse Code and offers Update when its digest changes. Missing sources,
  invalid ids, non-file skills and linked roots refuse installation. Its
  reviewer charter covers eight classes, coverage, dispositions and exact
  prior-finding resolutions, loading only through the skills bundle.
  Orchestrated reviewer bindings remain pending.
  <!-- whats-new: historical -->

- ACP `/playbook <status|record|settings ...>` and terminal `playbook` answer
  locally from a journal without a backend or model turn. Settings record
  owner and reason; rule opt-outs and fallback reviewers require a user
  decision. Residuals stay open until lead or owner acceptance and block
  release while open. Dispatch briefs record hashes before rendering. Help
  and capability inventories cover all four editor/backend surfaces; full
  panel enforcement still awaits the planner.
  <!-- whats-new: historical -->


### Fixed

- CLI, ACP and React playbook records show unmatched legacy acceptance reasons
  and original decisions, distinguish identical entries by journal position,
  and use browser-safe contracts. All fourteen languages include the labels;
  queued-answer write failures warn that retained answers may repeat.
  <!-- whats-new: historical -->

- Commit ACP queued-answer leases only when their carrying model turn starts,
  after hooks and admission. Withdrawal, unqueue, Stop, release, exit and
  refused or failed submissions retain answers without claiming delivery.
  Local commands never lease. Failed writes retain answers, warn of repeats,
  and leave active turns busy and stoppable.

- Panel subagent, delegate, best-of-N and `/review` dispatches use shared
  playbook policy and offer a Plan redesign at round three. Planner, fleet,
  schedule and review integrations remain named handoffs.
  <!-- whats-new: historical -->

- Verify native Git hook exit verdicts instead of emulating Husky; invalidate
  older receipts and discover worktree private refs. Timeout cleanup follows
  detached descendants by parent and start identity; prepared cgroup/scope
  runners take precedence, with resource-governor binding pending.

- Detect skipped Husky bodies, new refs and detached worktree commits. Run
  source hooks by absolute path, clean partial registrations, scrub failures,
  and handle annotated tags and ref deletions. Reject legacy or invalidated
  receipts, require renewal/cancellation tokens, enforce hook strikes even
  without findings, and contain processes in POSIX groups or Windows jobs.

- Persist playbook safety refusals across tools, agents and restart to block
  same-effect retries. Journal fixtures own and clean their temporary folders.
  <!-- whats-new: historical -->

- Verify shell outcomes: new commits require durable hook receipts before
  managed push or completion; failures add strikes. Early command checks
  remain advisory. Bind reviews to lane and lease generation, follow edits
  through content and Git history, record lineage before admission, and
  reconcile merged strikes and lifetime counts. Editor/planner bindings
  remain pending.

- Fence playbook replies by bridge lifetime, request and workspace so disposed
  surfaces cannot populate another workspace.
  <!-- whats-new: historical -->

- Prioritize owner failures and unresolved redesigns in badges and agent
  details. Settings preserve other drafts, restore focus and announce saves.

- Refresh saved playbook fields, including another window's lowered round
  limit, so stale controls cannot overwrite them.
  <!-- whats-new: historical -->

- Local ACP playbook commands settle unused answer leases. Residual acceptance
  binds to its instance, rationale, follow-up and module. Submodules and
  separate Git directories without `commondir` work. All deferred playbook
  wrappers offer accessible loading, failure and retry. Slash/mention menus,
  edit tally, task panel and effort controls defer startup work; playbook
  loads separately to restore the ACP 850 KiB budget.
  <!-- whats-new: historical -->

- Legacy name-only acceptance covers only earlier residuals, never a reused
  name; unmatched records remain visible. Failed wrapper loads stay local
  with retry. Edit totals and task lists load only when needed.

### Added

- Add shared design tokens, generated editor/Muse palettes, contrast and
  staleness checks, and raw-colour guards. Accessibility overrides cover
  html, body and nested scopes; guards catch escaped paint and closing-brace
  hex values.

- Add an optional pinned OFL font pack, verified `fonts install`, offline
  seeds, portable UI/code fonts and ligatures, and notice/package guards.
  Hosts retain control of editor fonts.

- Add pixelmatch regression for all audited panel, Tasks and What's New
  surfaces across six themes, six states and 320/690 px widths. Hashes and
  dimensions identify bounded external PNG archives; CI reconstructs the
  reviewed source in its own rendering environment.

- Load exact money arithmetic, paid tariffs and estimates after first paint.
  Names, badges and tooltips paint immediately; prices never use guesses.
  Failed loading offers "Prices could not load." and Try again, rebuilding
  the panel. Paid and session-budget acceptance waits for the price; cancelled
  or replaced wizard drafts drop pending budget changes. Schedule prompt
  mapping loads on submit; failure restores the command in an empty composer
  with a warning, and closed surfaces or sessions stash nothing. Restored
  schedule rows use a small English group; other schedule text loads with
  its surfaces. Exact cap checks avoid startup arithmetic. The first-paint
  baseline is 760,059 B plus the prior 1.4 KB margin.
  <!-- whats-new: historical -->


### Changed

- Visual checks use antialiasing detection, colour threshold 0.1 and at most
  0.01% or 12 changed pixels per image. Both CI tiers reconstruct source
  comparisons; static gates check tokens.

- Polish conversation cards, tools, composer, chips, dock, menus, pickers,
  dialogs, usage, History, Tasks and What's New with shared tokens and states.
  Approval choices remain equal on one row at 320 px; gooey pills stay crisp.
  Header targets stay 24 × 24 px; History retains Arrow/Delete archiving.
  Reduced motion stops animation; forced colours distinguish hover, focus
  and pressed states.

- `@muse-code/sdk` moves from 1.4.2 to 1.4.4 (SDK144). Muse Code 1.4.4
  (1.4.4-R5419.1) serves the new pin's schema fingerprint, so it connects
  without a mismatch warning; a 1.4.2 host now logs one, as older hosts did
  after earlier bumps. The SDK now hides the `muse serve` window on Windows
  itself (meta-models/muse-code-sdk#34). The extension's other Muse Code
  workarounds were re-checked against 1.4.4 and are still needed
  (`docs/certification/sdk144.md`).

- `@agentclientprotocol/sdk` moves from 1.5.1 to 1.7.0 (SDK144). The ACP
  agent, headless `exec` and team workers speak the same ACP v1; the SDK's
  transport is unchanged, so the agent's 32 MiB line override and the
  session-router seam carry over as they were.

- **A sent message's menu is shorter and its pills fit their labels.**
  **Fork conversation from here** is now **Fork Conversation**, and **Fork
  conversation and rewind code** is now **Fork and Rewind**, in every
  language. Every radial menu's pills stay one size, but that size is now
  the longest label's own width instead of a fixed 272 px, so short menus
  no longer carry empty blue space; only a label wider than the panel ends
  in an ellipsis with the whole label in its tooltip.

- The README's Resources screenshot is retaken with the rest of the set (the
  same Linux Chrome build and fonts); the other 18 screenshots still match the
  current UI and are unchanged.

- README and `docs/acp.md` name all four places the project ships from (VS Code Marketplace, Open VSX, npm, GitHub Releases), add an npm version badge, and install the ACP agent with `npm install -g muse-spark-code-acp` first, the release `.tgz` second.
- The npm package's README and the Marketplace/Open VSX page list the same four channels as the README (VS Code Marketplace, Open VSX, npm, GitHub Releases); the npm page adds the release `.tgz` install.
- README adds a total downloads badge (all channels) and a GitHub app installs badge, both served by the project's Cloudflare Worker, now kept in `infra/marketplace-hook` (counters only; not part of any package).
- README notes the project's unofficial GitHub OAuth app for M123 sign-in and that its GitHub Marketplace listing awaits GitHub's review; the privacy notice adds the app's device flow, `repo` scope, keychain or vault storage and revocation.
- The working line is calmer: the heartbeat trace sweeps in about 1.4 s instead of
  1.2 s, and the circle mark before the status text keeps its 0.16.0 loop at 75 % size
  (12 px instead of 16 px).

- Preserve exact decimal USD across schedule authorization, consent and agent caps,
  rental cost estimates, reporting facts, account totals and voice consent. Read
  historical numeric records at validated boundaries; saved reports verify their
  original hashes before migration to exact money version 2.
  <!-- whats-new: historical -->

- Saved reports verify their original hashes before migration to exact money
  version 2; historical numeric records are read at validated boundaries.

- The resource history journal is one shared bundle that the window's
  governor and the usage page both load, instead of a copy in each; both stay
  inside their size budgets. Usage records read the account id from a small
  leaf instead of every account schema.

- The Model API backend's session store loads with that backend instead of
  at activation (its own `dist/modelApiSessions.js`), taking 24.5 KB off the
  activation bundle; sessions are kept and read as before (ACTBUD017).

### Fixed

- Keep visual CI shards, integrated question/lazy coverage and revision-bound
  receipts. Open Questions uses the shared keyboard ring; modal and menu
  focus stay independent. Theme bundles fit their budget and font errors
  use the installed language.

- Use six deterministic visual shards, requiring every receipt, matching
  coverage/environment and combined 512 MiB archive budgets.

- Follow imported generated stylesheets for the complete host theme inventory.
- Add local `/report` and a report tab with Markdown, HTML, JSON and text,
  saved history and comparisons. Composer, palette and usage share the lazy
  engine without model turns; unavailable evidence retains reasons/freshness.

- Add checked plan grammar, report-v1 schema, pure collectors, bounded local
  readers, canonical redaction and CLI/ACP/native shared contracts.

### Fixed

- `museSpark.reports.network` promises only wired GitHub reads; store, workflow
  and release adapters remain unavailable pending approved captures.

- Reject reporting bundles that include the paid gate.
- Render report comparison diffs in every format. Validate decoded redaction,
  order equal history stamps by save sequence and tied checks consistently,
  discover Claude subagents, match quality globs like the runner, and resolve
  workspace aliases through Git. Fixtures use canonical roots and ordinary
  deadlines; long picker identities wrap at 320 px.

- Cold filtered slash commands await English with accessible loading/failure/
  retry; browser checks await scenario start before measuring or sending keys.

- Sequence long-reply accessibility after competing axe pages without dropping
  deltas, themes, scans or readiness deadlines.

- Reuse validated estimator scheduling without report-only timelines or unused
  reservation sorting; keep all 2,000 draws and the selected P50 schedule.
  <!-- whats-new: historical -->

- Account projections load without unrelated Models, vault, team or keybinding
  schemas.
  <!-- whats-new: historical -->

- Honor approved audio models for ordinary requests, retaining model, key and
  consent fences. Include vault/estimator bundles in problem-recorder frames.
  <!-- whats-new: historical -->

- Speed vault scanning without changing redaction or stream boundaries; retain
  Unicode SSH wildcard matching without regex construction; share HTML encoding
  for estimator exports.
  <!-- whats-new: historical -->

- Register `museSpark.vault.enabled` and nested defaults in VS Code while
  preserving opt-outs; use accepted release captures for request baselines.
  <!-- whats-new: historical -->

- Capture diagnostics before team-test timeouts. Retain early ready messages
  until their scenario handler exists.

### Fixed

- Preserve provider, media and account contracts; defer credential-bearing
  account commands. Files requests retain endpoint checks and scrubbed errors;
  upload cleanup requires its ownership ledger. Both packages include vault
  and estimator assets, with the native macOS helper from CI. Fresh clones
  retain browser English readers under temporary parents. Unbound vault shell
  descriptors preserve strict-tool requests; account help shares usage text,
  GCM decryption pins tag length, and legacy credentials reuse shared validators.
  Harnesses supply the estimator setting. Budgets remain unchanged.
  <!-- whats-new: historical -->

- Record window/ACP minute resource readings, levels, overrides, deferrals and
  harness CPU in one flushed local machine journal when usage history is on.
  Usage **Resources**, `resources history`, `usage resources` and ACP
  `/usage resources` read it. Keep seven recorded days with bounded files and
  reads; ignore only a torn final line, report other unreadable data as
  unavailable, and clear it with **Delete history**.

- Show **This minute so far** across windows/agents and one **Earlier days**
  row per recorded day. **Delete history** includes the resource-entry count.

- Add [the public roadmap](ROADMAP.md), generated from milestone statuses,
  release headings and curated entries. Its quality/CI gate rejects stale
  fingerprints, missing or extra milestones and internal working ids in
  public text. Prepared releases appear under _In the next release_ until
  a release record confirms shipment.

### Added

- Add several-account storage, thresholds, confirmations and shared account/
  usage/developer UI, certified with fake editor ports. Installed mounts,
  pooling, credential-changing selection and profile/device owners remain
  pending; extra Muse Code accounts await captures. Account changes never
  reset paid gates or shared budgets. See
  [policy](docs/certification/m108-policy.md) and
  [integration evidence](docs/certification/m108.md).
  <!-- whats-new: historical -->

- Terminal `auth set` reads credentials only from standard input, never an
  argument or file.

- Resource-history deletion refuses swapped links outside the usage folder
  on Linux/Windows; macOS retains the same-user race documented in SECURITY.
  Failed removal reports and retries, leftovers are cleaned, and retention
  failure logs. Recording, daily upkeep and deletion share a lock; writes
  recheck ownership and delete order. Readings while history is off or before
  deletion cannot land later; old daily rows stay hidden. Refused-removal
  restoration preserves replacements except SECURITY's stated cases. Retried
  uncertain writes count once; window close flushes its minute. The 32 MiB
  read bound counts actual bytes.

- Resource-history cards use one column at 320 px and two at 690 px; legends
  and trailing chart values stay visible.

- Governed launches declare contained work, read-only probes, OS handoffs
  (including `share` and `prompts share`), terminal `login` or helper builds.
  CLI shutdown stops owned work; handoffs wait at most ten seconds for the
  adapter and leave opened browsers running; terminal Ctrl+C reaches login.
  Pause immediately refuses helper/background launches with `Resources: Paused`,
  without first-command Windows fallback. Deadlines include sampling; a
  source guard checks every process against its inventory.

- Windows commands avoid per-launch PowerShell. Jobs enforce process caps and
  report whole-tree retirement, CPU and memory; real-Git schedules on four
  CPUs improve from about 12.4 to 8.3 s. Shutdown awaits exit before temporary
  cleanup; non-exiting trees are retained and reported.

- Windows completion requires a helper report proving the job empty. Killed
  or undrained helpers retain temporary folders for recovery. Process/memory
  cap refusals fail commands even after exit 0. Every launch checks helper
  bytes, refuses changes and rebuilds; shutdown awaits the final report.

- Read-only Git, gh, birth and media-version probes keep admission/containment
  without temporary folders. This avoids missing-helper refusals in Linux/
  macOS source checkouts and repeated Windows PowerShell starts. Writers,
  including converters and schedule OS commands, retain temporary folders;
  runtime Windows helpers prepare once.
  <!-- whats-new: historical -->

- Helper compilation uses heavy bootstrap admission, bounded output and
  whole-tree deadlines/cancellation. Runtime admission covers login/browser
  launches. Windows report leases close before restoration, preserving
  concurrent journal entries; birth probes avoid module discovery. Help
  names unavailable recording and vault-broker services.
  <!-- whats-new: historical -->

- Account-scoped Muse Code hosts share governed native jobs and retirement.
  Vault MCP stdio uses a guarded governed builder. Media, vault helpers,
  reporting and schedule readers use admission/containment; missing native
  launch services refuse before spawning.
  <!-- whats-new: historical -->


- **Resource chip in the VS Code chat** (M107 U–C1/W). After the window's
  first governed launch, a **Resources** chip sits beside the heartbeat, or
  above the composer between turns. Its popover shows CPU, memory in use and
  available memory against your limits, what is waiting, any override, and
  that relocation is not available on this build. Its buttons are **Resume
  now**, **Open settings** and **Show resources** (the Usage & cost page). A
  status bar item shows while the governor throttles or pauses. At pause, one
  notice per conversation names the reading and its limit, with the same
  actions. New commands: **Muse Spark: Show Resources** opens the popover in
  the chat in view, and **Muse Spark: Resume Work Now** holds this window's
  governor at normal for fifteen minutes. A governor you switched off stays
  off. The governor, its status item and the chip still load on first use,
  never at activation, and chat's first paint stays within its budget.
  A status the chip cannot trust (unreadable, with unknown fields, or too
  large) shows as **Resources: Unknown** with a short explanation, never as
  an older reading. While the chip loads it says so in place, and if it
  cannot load it offers **Try again** without disturbing the conversation.
  JetBrains, Visual Studio, Eclipse and the companion page can reuse the same
  chip and status adapter once their M104 bridges bind them; none does yet.
  ACP and terminals keep `/resources` and `resources status|resume`.

### Fixed

- Remote vendor limits persist per sender, owner and provider across sticky
  moves, named sends, account removal and restart. Group/global exclusions
  share local eligibility; reset or bounded expiry clears blocks, with
  overlapping limits using the later reset. Frames carry no account/group data.

- Profile create/remove and Reset audit the real calling surface, including
  terminal commands. Sticky/retry/busy certification follows its regressions.

- Device admission shares local queues, full limit groups and advertised
  capacity. Threshold changes move sticky routes; deleted accounts cannot
  wedge them. Refusals distinguish recovery, cancellation, caps, busy owners
  and missing devices.

- Remote routing skips blocked accounts' full limit group using sender-side
  pool rows, without frame metadata. Busy conversations report "A prompt is
  already running for this conversation." in all fourteen languages.

- Unknown profile removal cannot change authority. Revocation stops profiles
  before saving; failed publication cannot restore revoked grants. Enable/
  disable audit actual surfaces; stale launches fail and release credentials.

- Account/developer/Help English loads with optional surfaces within startup
  and deferred budgets. Every translated key, plural and template slot still
  validates. Help data packs losslessly within budget.

- Unbound runtime profile cleanup reports unavailable and retains its ledger
  after failed launches.

- Fixed-account surfaces retain backend identity after reordering/removal.
  Headless ports bind requested credentials; missing accounts or malformed
  metadata cannot fall back to the legacy Meta key.

- ACP package guards include the lazy account-runtime bundle.
- Companion uploads support Unicode filenames and omit unrelated loopback
  cookies: only header metadata is encoded; streamed intake stays guarded.
  Progress reports start/completion. Closed panels settle recorder startup
  and dispose late previews; browser tests use OS temporary storage.

- Media keeps exact currency, ceiling display and tariff text outside startup;
  tool rows offer lazy accessible loading/failure/retry. Patch projections
  share schemas within existing caps. Headless `--record` help is corrected;
  pending capture, provider, accounting, recorder and companion bindings are
  explicit. Packages preserve signed recorder resources and media bundles;
  macOS CI needs no permission. Estimates round upward and refused fills
  close reserved descriptors. ACP/VS Code inspect media on first use; shared
  reference values restore ACP/reference budgets to 850/100 KiB. Attachment
  and inspection factories install the caller's language before refusals.
  <!-- whats-new: historical -->

- ACP supports between-turn `/attach <path>` and `/record`, capability-gated
  audio, confined resource links and PDF/video/audio/image/unknown blobs.
  Headless `exec --attach <path>` repeats, `--record` refuses, and `read_file`
  reads mp4/mp3/wav within the media budget.

- Files API uploads stream approved media with progress, Stop, SHA-256 and
  expiry; validate receipts and reject redirects or ambiguous retries.
  Storage admission and lazy media bindings remain integration work.

- Upload metadata/reference counts persist across sessions. Deletion/purge
  cleans uploads; missing-file replacement verifies its source. Usage lists
  files and cleanup with expiry/read-only metadata; editor ports await binding.

- Media and screen recording load on first use with separate budgets/guards;
  startup stays near 733 KiB. Add Attach screen recording, Attach latest
  screen recording and Delete uploaded files, plus `mediaMaxUploadMiB`,
  `mediaUploadExpiryDays`, `screenRecordingMaxSeconds` and `mediaAudioAction`.
  Recordings return to their starting conversation; picked media uses drop
  confinement and reasoned refusals. Audio pastes transcribe by default;
  Gemini/OpenAI-compatible video remains unsupported.
- On macOS 26, a process that `ps` lists with an unknown state (`?`) while
  it changes no longer voids every resource tree's membership read, which
  could refuse Stop/kill for a tree while any process on the Mac was mid-transition.

- The two-account Muse Code backend test waits for the usage event that
  follows a turn instead of assuming both arrive together, and the estimator
  browser harness pays the browser's first-navigation work once before its
  matrix, keeping every case's two-second bound.
  <!-- whats-new: historical -->

- The estimator browser harness uses the same packed English fallback as
  independent production pages, avoiding cold Windows navigation timeouts
  while keeping its two-second bound and complete accessibility/keyboard matrix.
  <!-- whats-new: historical -->

- macOS UI regressions give each target-size scene its own test and await
  the palette view's actual lazy-import rejection before checking its failure
  row, retaining every assertion at the existing deadlines (CIR4MAC).

- macOS runtimes with libuv older than 1.52 report unknown memory headroom
  instead of counting only free pages, preventing false resource pauses and
  ACP multi-workspace session timeouts on Node 22 (ACPM118).

- Windows recorder destinations accept native 8.3 temporary-folder spelling
  while still refusing traversal and existing destinations (CIFIX017W).

- Companion uploads close their inspection handle and remove private bytes
  before acknowledging the request, avoiding Windows cleanup races.
  A failed inspection close returns a refusal with private diagnostics withheld.

- Windows resource-history tests wait for durable disposal output before
  checking or corrupting journal files.

- Windows native probes avoid unnecessary PowerShell module startup;
  packaging tests share one production build while retaining private outputs.

- Visual capture waits for restored question rows to finish loading before
  measuring the context-menu passage, preventing a timing-dependent 14 px
  menu displacement in narrow captures. Pixel allowances are unchanged.

- Schedule runtime tests cover Linux, Windows and macOS rearm ownership
  explicitly; macOS wake shutdown retains its independent after-exit helper.
  <!-- whats-new: historical -->

- Reporting journal, history-engine and response-cache tests retain real OS
  process-birth probes on macOS and Windows without requiring unrelated
  resource-governor installation in their storage fixtures.

- Windows: the ACP agent (`muse-spark-code-acp`) could not start a Muse
  Code session. Its governed `muse serve` launch was missing the Windows job
  helper the extension's launch already had, so every new session failed
  with an internal error.

- Windows: the npm package of the ACP agent now ships the C# of that job
  helper's launcher (`MuseSparkMcpLauncher.cs`). An agent installed with
  `npm install -g` still failed every new session with an internal error
  without it (CIFIX017W2).

- Windows: the trusted-path check behind background schedules reads each
  folder's attributes and ACL through .NET alone. Its PowerShell no longer
  loads the modules behind `Get-Item`, `Get-Acl` and `ConvertTo-Json`, which
  took over 15 s per folder on machines with many PowerShell modules
  installed, such as hosted CI runners (CIFIX017W2).
  <!-- whats-new: historical -->

- macOS with Node 22 (or an editor on its libuv): the resource governor read
  free memory pages as headroom, judged an ordinary Mac critically short of
  memory and held every later process start for 20 seconds, so a second ACP
  session took over 20 s to open. That reading is now treated as unknown
  (CIFIX017R3).

- A report save could fail after two seconds when another save released
  its lock while a third retired one: a lock file being deleted was taken
  for an unsafe file, and the releasing save kept its lock (CIFIX017R3).

- The report's plan reader no longer parses each plan line three times;
  this repository's plan reads about 15% faster (CIFIX017R3).

- Windows: `muse-spark-code-acp usage open` and sharing to the clipboard or
  browser failed with "That did not work". The program lookup added `.exe`
  to names that already had it (`rundll32.exe.exe`) and found nothing.

- Linux: `muse-spark-code-acp usage open` waited 10 s and then reported
  failure when `xdg-open` stayed open with the browser, as many handlers do.
  The opener now counts as launched once it starts, in its own session, and
  is never stopped. Any OS opener still running at the hand-off limit is
  detached and counted as launched, not killed; one that exits with an
  error still fails.

- When a Windows job helper fails to compile, the log names the compiler's
  errors and exit code again, not only "Bootstrap command failed".

- Visual regression reconstructs the recorded schedule surface inside the
  served historical revision, so clean CI can load its lazy schedule entry.
  The current-source audit also records the accounts accessibility stylesheet.
  <!-- whats-new: historical -->

- Native schedules and helpers no longer refuse a Windows profile folder
  that is a junction or redirected to another drive. Paths are now checked
  from the folder the extension owns: links above it are accepted by their
  resolved identity, and a link below it is still refused.
  <!-- whats-new: historical -->

- Windows helpers no longer refuse a profile folder that is a junction or
  redirected to another drive. Paths are now checked from the folder the
  extension owns: links above it are accepted by their resolved identity,
  and a link below it is still refused.

- Scheduled prompts spend about half the time on their store per fire: the
  store keeps one journal per workspace, so its validated snapshot and deltas
  are reused between calls, and a read copies the folded state once instead
  of every journal entry. Every read still rereads and checks the bytes.
  <!-- whats-new: historical -->

- Model API turns no longer reinstall the whole display-language table for
  every recorded context read (about 4 ms each); the schedules bundle
  installs it once per language.

- ACP: an answer queued with `/answer` is sent with the next prompt once,
  even when the backend finishes that turn before it confirms the start.
  Before, such a turn released the answer instead of marking it sent, so the
  following prompt carried it again.

- Model API replies stream with less work per event: the stream's key
  redaction builds its matcher once per reply (and again only when a stored
  secret changes) instead of for every string in every event. A long reply
  had spent most of its time there.

- Contributors: a pre-commit hook that fails now stops the commit on Windows
  even when nothing is reading Git's output any more (for example
  `git commit … | Select-Object -First 5`). Before, husky's runtime was
  killed by a broken pipe while reporting the failure, and Git for Windows
  counted that as a pass. `npm run prepare` installs stubs that rule this
  out on every OS, and the hook asks for `npm run prepare` in a worktree
  that still has husky's own stubs.

- Packaged translation tables round-trip byte-exact again: every language
  table lists its keys in English's order, including the resource history
  and Windows path strings merged for 0.17.0.

- The dependency-cycle gate now covers every build entry, lazy import target,
  entry-named module and knip entry, with a guard against root-list drift.
  Remove the worker admission/environment/ref-fence cycle by sharing the
  unchanged credential-free environment policy from the worker environment
  module. The guard now shares integration-test discovery with the build,
  so changes to its directory or filter also change the required cycle roots.

- Start the team browser tests' card and tree deadline once the harness reports
  the scene played, keeping bundle start-up, the ready handshake and the
  steps' settle time outside that wait, and list still-open requests when a
  team test's wait fails.
  <!-- whats-new: historical -->

- Settle quote-menu capture origins after final layout and isolate source-reconstruction fixtures from temporary-directory placement.
- Capture settled share-view highlighting, usage-dialog account facts and status rows, and the palette's focus scroll so visual replays no longer race lazy renderers.
- Complete integrated visual coverage through real optional UI scenes, decode packed update notes in replay, wrap narrow Models actions and use token focus rings.
- Guard the lazy slash-command registration as a deferred chat entry without adding activation bytes.
- Restore the Schedule Prompt, Schedules and Schedule Timeline editor commands, including panels opened on demand.
  <!-- whats-new: historical -->
- Reuse successful time-zone validation during repeated schedule journal reads, preserving storage checks and workload deadlines.
  <!-- whats-new: historical -->
- Resolve visual replay fixtures from the running gate when historical render sources predate them, and guard Help document IDs against duplication.
- Prepare browser-English probe scratch space in fresh clones and include the merged Linux helper job in the visual CI test fixture.
- Give plan-usage request counts localized singular/plural text so contrast checks can measure their visible content.
- Refresh reviewed README captures from the combined UI and its real ready handshake, retaining the curated media budget.
- Name and exercise report-root literal regex escaping across all operators and Windows separators.
- Share ACP preparation cancellation and exact USD display helpers; align merged paid-ledger tests with the exact decimal contract.
- Batch staged-file tool arguments below the Windows command-shim limit while retaining every hook check.
- Include lazy account and developer surfaces in the browser English regression probe while preserving deferred fallback checks.
  <!-- whats-new: historical -->
- Remove the obsolete compact Node reference build plugin and its stale test; the production reference uses the current generated data loader.
- Draw the independent reporting focus ring and the Models/account boundaries from the M114 token contract instead of direct host colours, so keyboard focus stays visible on low-contrast themes.
- Give team traffic and Runners buttons the secondary-button token role instead of input-field colours, and draw their keyboard focus ring from the M114 token contract.
  <!-- whats-new: historical -->
- Draw Models buttons, the accounts picker and traffic buttons from a new assured boundary role that mixes the theme foreground into its background, keeping control boundaries at 3:1 or more in every captured theme.
  <!-- whats-new: historical -->
- Draw Models buttons from a new assured boundary role that mixes the theme foreground into its background, keeping control boundaries at 3:1 or more in every captured theme.
- Give the team merge card's path lists their own full-width row so long paths wrap instead of one character per line at narrow widths.
  <!-- whats-new: historical -->
- Media request tariffs accept exact USD amounts only and reject numeric
  JavaScript callers before admission. Ordinary session reservations share the
  atomic-admission lock, preventing competing owners from publishing during an
  unfinished claim and preserving cap checks at the remaining headroom.

- The Account & usage spend meter sums exact decimal amounts instead of
  rounding through nano-USD, so sub-nano spend below a nearby cap reports
  unreached exactly as admission evaluates it.

- The media accounting core claims its calibrated upper bound
  against both schedule and shared daily caps, including replayed file IDs,
  settles the admitted media tariff once, and retains uncertain liabilities.
  Above-reserve bills refuse settlement; daily claim transfers secure their
  replacement before releasing held budget.
  Production video/audio uploads remain unavailable in this version pending
  the production upload and transcription bindings (PLAN D85.6, M105).
  Scheduled reads now explain that limitation explicitly in every editor.
  Media read-file references through a bound adapter carry their checked source
  into the run ledger;
  stopped reads cannot publish a new proof.

- The 0.17.0 integration's daily-budget and durable schedule tests now assert
  exact decimal money, including entered limits below nano precision, while
  account consent fixtures persist quote ceilings and retain account refusal.
  Account-bound paid consent carries exact decimal budgets through its popup.
  <!-- whats-new: historical -->

- Account-bound paid consent holds "Always" across instances and restarts for
  the same workspace, provider, account and price through the binding-kept
  grant when no host quote store is configured; it still asks again when any
  of them changes, when the quote generation changes, or when only a
  differently-keyed legacy grant exists.
  <!-- whats-new: historical -->

- Account-bound paid consent no longer fabricates quote approval from the
  binding's feature grant: it requires an account-scoped quote store and
  generation, persists the approved quote and generation per account, asks
  again for a higher tariff or a different model on the same or a new
  instance, and revoke() clears that account's quote grants too. No
  production host constructs account-bound consent yet — paid approval stays
  per workspace until M108 lane P wires it — and Help now says so.
  <!-- whats-new: historical -->

- Account-bound paid consent binds grant authority to a durable revocation
  epoch persisted per account binding: revoke() advances the epoch before
  clearing, so leftover grants from a failed clear stay stale on every
  instance after a restart, and a failed advance rejects with the grants
  still working. Every grant records its approval epoch; concurrent asks on
  another instance cannot resurrect a revoked grant. Help says paid consent
  stays per workspace in all fourteen translated tables.
  <!-- whats-new: historical -->

- Resource history now includes Windows contained and probe commands: the
  helper's final CPU and memory use is recorded once in this window's
  history (at most 512 waiting results between reads). The governed process
  launcher and the start of vault-backed MCP servers now load on first use
  in bundles of their own (`dist/resourceProcess.js`, new 50 KiB budget;
  `dist/mcpVault.js`, new 25 KiB budget), so the resource governor is back
  within its unchanged 125 KiB budget and activation no longer carries the
  vault MCP start.
  <!-- whats-new: historical -->

- Resource history now includes Windows contained and probe commands: the
  helper's final CPU and memory use is recorded once in this window's
  history (at most 512 waiting results between reads). The governed process
  launcher now loads on first use in a bundle of its own
  (`dist/resourceProcess.js`, new 50 KiB budget), so the resource governor is
  back within its unchanged 125 KiB budget.

### Security

- Refuse ambiguous Windows file names: device namespaces, drive-relative
  paths, alternate streams, trailing dots/spaces and reserved names (including
  superscript digits), on every drive. Muse Code approvals for these or
  protected resolved paths (8.3, junctions, `subst`) require manual once-only
  consent. Ordinary Muse Code `\\?\X:\` paths retain automatic editing,
  Auto review and Always allow. Checkpoints/held PRs compare native identities:
  other volumes, WSL and loopback shares stay outside; linked/relocated profiles
  work; unprovable identity refuses writes explicitly. `con.d` and `aux.js`
  remain ordinary Windows 11 names. Browser and token ACL helpers locate
  Windows through `SystemRoot`, then `windir`, on any drive.

- Document process-tree cleanup after timeouts, explicit background-job
  handoffs, blind readings for protected processes and no tight security-status
  polling. Shared orchestration, resource, vault and support policy and the
  placement playbook adopt these rules across models.
  <!-- whats-new: historical -->


## [0.16.0] - 2026-10-07

Correction (2026-10-10): Live argument previews did not work for users in this release; it is being completed.

### Highlights

- **Loop guarantees.** Strict tool contracts, bounded hosted search and streamed
  tool rows make Model API work easier to follow; read-only calls can
  run concurrently while results retain their original order. Today: rows stream
  while arguments arrive, but the argument text is not shown yet (no production
  tool declares preview fields).
  <!-- whats-new: historical -->

- **Keep your machine responsive.** Machine-scoped CPU and memory thresholds
  throttle, then pause, new background work. Relocation needs a paired device
  or runner route and is in progress, so work stays on this machine.
  <!-- try: setting museSpark.resourceCpuMaxPercent -->
- **Protect free disk space.** Disk floors hold back disk-heavy launches and
  refuse critical-volume writes; cleanup requires recorded ownership and proved
  process-tree exit.
  <!-- try: setting museSpark.resourceDiskMinFreeGiB -->
- **Pinned questions.** One interactive question or MCP form stays above the
  composer; transcript markers open and focus it.
- **Agent outcomes.** Activity, evidence-backed outcomes and redacted receipts
  show attempts and unfinished work, with confirmed Continue and guarded Retry.

### Added

- M106 strict tool contracts and parallel reads have machine-scoped switches;
  completed calls remain the execution boundary, cut-short tool replies fail
  without running tools, and repeat/continuation guards bound the loop.
- Tool argument previews load on first use.
  <!-- whats-new: historical -->
- Hosted search has a per-request bound, immutable consent quotes and exact
  decimal USD accounting. Captured rate-limit headers pace background fan-out;
  transport idle/retry waits remain bounded and cancellable.
- Structured side calls validate their answers, permit one repair and retain
  the text fallback. Headless `--output-schema` validates a bounded schema
  through a held file handle and withholds an invalid final answer.
- The headless v2 result/event contract carries canonical decimal USD and
  structured output alongside resource events; frozen v1 schemas stay shipped.
- Optional Meta status and the Models & Agents panel have independent lazy
  bundles. SDK 1.4.2 is pinned; native effort, feedback and deletion remain
  unavailable until their captured feature readers are bound.
- M107's portable resource governor, machine-scoped settings, process-tree
  admission and independent lazy control/history artifacts. Active editor,
  journal, paired-device and native-platform qualifications remain explicit in
  [the M107 record](docs/certification/m107.md).

- Agent activity and structured outcomes, with bounded redacted receipts and
  retained Model API attempt history. Continue asks before resuming the same
  child and keeps its edits. Retry explains when an isolated checkpoint is
  unavailable. Native ends without completion evidence remain unverified.
  ACP editors get local `/agents` listing, receipts and confirmed recovery.
  Model API children can keep their own task list without replacing the parent's.

### Changed

- Deliver Linux resource cleanup helpers in VSIX and ACP packages, including
  architecture-specific CI builds and missing-helper package refusal.
- Resource admission now responds to transport failures and OS service pressure;
  per-job process and observed spawn-rate caps stop only the offending tree.
- Correct the security guide to reflect the joined disk-registry race repairs.

- M107 delivery candidate: eight machine-scoped resource settings and generated
  Help coverage; independent governor/admission/control/history artifacts with
  measured budgets, split/package guards and exec-event-v2 schema packaging.
  Editor/runtime/actuator, native delivery/storage and M96/M96c/M100/M102 bindings remain
  explicitly pending in the integration certification.

- Native PID-reuse verification bounds discovery to its real fixture processes,
  retaining all 32 births and native identity, membership and signal checks at
  the default test deadline.

- Complete M107 verification restores session-board change counts when Git has
  no filters, keeps resource bundle frames in scrubbed reports, and validates
  exec v2 resource events in the Action while preserving v1 results. Production
  and fake-only package checks cover the resource artifacts and all three schemas.

- M107's deferred resource parser preserves the startup size regression;
  lossless English-key and Node reference packing retain complete content
  under existing caps. Notices resolve deferred parser package paths on
  Windows and POSIX without omitting their licences.

- Linux resource Stop retains cgroup and parent descriptors until direct
  registry kills settle, removes empty scopes through a pinned parent and
  reports late harness insertion explicitly while thawing safely.

- Resource history keeps known minute readings and merges final tree accounting
  idempotently after a read-time flush, including the same cached sample timestamp.
- Resource history rejects dates outside the supported formatter range, including
  override deadlines. Its shared page and text summary use one date formatter.
- Resource-history detail retains at most seven recorded days/10,080 minute
  segments and 1,000 events, with charts and tables paged in groups of 60.
  Work and event totals still include every retained journal record.

- The staged team/check slot adapter rechecks live governor capacity after
  local slot waiting. Work remains queued at pause or when throttle is full,
  releasing unstarted reservations before waiting again.
- The staged resource relocator rechecks policy and cancellation after the
  final offer callback, preventing dispatch after synchronous revocation.
- Its headroom probes run concurrently with a five-second bound, and Keep
  here cancels discovery without waiting for an unresponsive peer.
- Automatic relocation rotates among equal-headroom peers across attempts,
  preserving ample-before-some priority and explicit Move to choices.

- Governed shell, MCP, browser, Git, voice and plugin cleanup uses registered
  member stops, including descendants after root exit. Refused stops retain
  unknown occupancy and never fall back to a bare process or job kill.
- The lazy governor artifact exports both the window and runtime factories
  and ships with the admission shim in the ACP package.

- Runtime resource settings preserve injected class stores' methods. ACP
  shows one full pause warning per conversation while continuing level updates.
- Temp quarantine and restore use native no-replace renames. Manifest
  publication links without replacement and verifies/rolls back POSIX exchanges;
  stages and displaced manifests are retained to protect exchanged names.
  Cleanup rechecks each directory name against its held identity immediately
  before empty-only removal. Creation rejects an older directory swapped into
  mkdir/open and binds the marker writer to the native creation identity.
  The final same-user empty-trash-name window and native delivery/artifact
  qualifications are recorded in PLAN §9 and the M107 DK certification.

- Temp cleanup now walks identity-checked directory handles on Linux and in
  the native macOS/Windows helpers, refuses filesystem and Linux mount boundaries
  (including same-device bind mounts), and removes
  trash entries empty-only. Interrupted or legacy records without stored
  identity/marker hash are report-only. Creation requires an empty owned handle;
  registration cannot adopt existing folders. Manifest stage replacements are
  retained instead of being unlinked by name.

- Disk cleanup rejects forged or public manifests, requires private-base
  confinement and an ownership marker, and quarantines roots before removal.
  Linux pins the base directory during cleanup. Creation intent is saved before
  mkdir, and a refused root no longer blocks cleanup of other eligible roots.
  Initial OS temp ancestor aliases resolve to the verified canonical base,
  supporting macOS temp paths without following those aliases during cleanup.
- Checkpoint Git checks its storage volume and stays available at critical temp
  pressure without allocating a temp root. Admission abort/disposal no longer
  waits for sampling; stalled statfs publishes unknown readings within a bound.
- Account/sign-in Muse children receive the same owned temp environment as chat
  children. Nonzero/signal exits and SDK initialization/spawn failures retain
  their temp roots for 24 hours after proved tree exit.

- Staged disk-space protection samples harness write volumes with `fs.statfs`,
  uses the existing governor's levels and recovery, and blocks disk-heavy
  admission before the foreground deadline can bypass it. Owned-tree temp
  environments and a persisted creation registry provide guarded cleanup
  after proved exit, with 24-hour retention for failed runs and idempotent
  cleanup when tree exit and disk pressure coincide. Remaining host/device/platform bindings are
  tracked in the M107 DK certification.

- Windows Muse Code shutdown stops the verified registered job, bounds all
  SDK close surfaces, reports forced or unproved shutdown honestly, and
  disposes session handles even when close reports a failure. The CLI inherits
  the SDK's stdio handles directly instead of PowerShell's native pipeline.
- User turns queued behind scheduled work keep foreground admission and its
  20-second wait bound. Rejected concurrent schedules release only their own
  lease; completion is matched to the running schedule's generation and turn.
- Short window CLI commands, including rules initialization and diagnostics,
  and plugin runtime version probes enter resource admission and register
  native process trees. CLI commands recheck their owner after admission,
  preserve argument boundaries and stop their tree on cancellation.
- Resource-governor recovery uses margins scaled to the configured limit
  and machine memory, so low GPU/disk limits and small containers can recover.
  Resume override expiry drains older pending reads and waits for a fresh
  sample before deciding the level.
- Windows actuator integration verifies the real job's below-normal/idle
  priority, 50% CPU cap, birth-identity refusal and exact priority/rate
  restoration alongside the merged governor and actuator review repairs.
- Staged resource-governor integration admits the window's tool shells,
  checks, MCP servers, hooks, browser checks, Git, voice/recording and Muse Code hosts, and the
  Model API's background attempts, children and scheduled runs. Windows
  launches register named jobs, including the browser's binary CDP pipes;
  orphan children retain a queryable job until empty, and failed holders or
  unproved tree readings retain their reservations. The governor loads in
  its own bundle on the first governed launch.
- Resource sampler probes prevent libuv from filling missing Windows
  environment variables from the parent; Linux resource-tree paths retain
  POSIX semantics when their complete fixtures run on Windows.

- Resource actuators release controls for members explicitly proved exited,
  including zombies, so the living tree can recover and retire. Unavailable
  Linux cgroup controls retry opening on later scans with bounded backoff,
  preserving usable handles and their original policy snapshots.
- Resource actuators keep unconfirmed irreversible writes unknown during
  recovery and retirement, verify confirmed policy again, and require a fresh
  prior-state reading before attempting another irreversible change.

- Linux resource trees pin their cgroup directory before the workload runs.
  Stop and accounting refuse a removed or replaced directory, and an empty
  tree retires automatically after its root exits. Stop also reasserts the
  harness's pinned home placement before kill or freeze; bounded retry failure
  keeps ownership with an explicit localized status for a later Stop retry.

- Linux resource trees launch behind a gate in their own delegated cgroup.
  Stop waits for the kernel's empty-cgroup receipt before cleanup, preventing
  an outside same-tick PID replacement from inheriting tree authority.
  Undelegated groups refuse small PID namespaces and recheck identity bounds.
- Registered resource trees expose verified signal and tree-kill actions, with
  exact birth checks and honest outcomes. Observed descendants retain authority
  after reparenting or starting another session; recycled PIDs need new proof.
- Resource trees use the shipped macOS helper's kernel microsecond identities
  and classify zombie processes as exited instead of live members.
- Resource-tree readers revalidate an existing POSIX authority anchor before
  retaining new witnesses, preventing a mixed-time scan from admitting a
  process in a reused group. Ticket retirement also invalidates pending reads
  so they cannot restore accounting or overwrite a newer registration. Linux
  cgroup scans omit vanished rows while keeping genuine read failures unknown.
- The staged resource-governor sampler honours cgroup v1 memory capacity
  and enforced ancestor limits, and rejects noncanonical cgroup paths
  before walking the mount hierarchy.
- Its optional probes preserve missing/null Windows counters as unknown
  and combine Linux DRM and Nvidia readings so the busiest GPU is counted.
- ACP help and argument errors now use one complete localized usage table,
  including the Setup hooks command, so the installed package passes the
  release job's strict English fallback check.
- Windows shell directory tracking now uses the native long workspace path
  when starting or resetting a command, so 8.3 aliases keep the correct cwd
  and workspace-relative directory tail.
- Production bundle regression tests now build their own compressed English and
  shared wire fixtures, so macOS CI's test job works without a prior build.
- Windows CI hook fixtures now use the platform their captured paths describe;
  Cline discovery exercises both POSIX and Windows path handling on every OS.
  Deferred-bundle checks load their in-memory builds without requiring stale
  or pre-existing files in `dist`.
- Cline hook quoting is checked through native PowerShell on Windows and the
  POSIX shell on Unix, without requiring a Windows Bash installation.
- Fake-only headless tests recognize MinGit's verified GNU Bash `sh.exe`, and
  missing-browser-chunk checks accept Windows filesystem error paths.
- Fake-child plugin dispatch fixtures use drive-qualified plugin paths on
  Windows while retaining native-platform parsing and containment checks.
- Retry after a failed optional panel reloads its complete module graph with
  the conversation and draft saved. Cold menus respect outside dismissal and
  late imports cannot take focus; failed menus accept Escape and return focus
  to their trigger.

- Rebuild 0.16.0 on the complete 0.15.0 candidate, preserving loop guarantees,
  machine resource controls, provider/team/usage/legal features and prompt sharing.
  Regenerate the combined reference and localization tables. Remove duplicated
  headless engine loading and measure the combined deferred bundles with D6's
  authorized 5% margin rounded to 25 KiB.
  <!-- whats-new: historical -->

- Avoid retaining unused exact-money schemas in unrelated lazy bundles while
  preserving runtime validation of every used price and schema.

### Fixed

- Windows resource stops avoid cold PowerShell module discovery. Native job
  helpers use verified long paths even when TEMP has an 8.3 spelling; Windows
  launch qualification reuses its compiled helper and loads JSON support explicitly.
- The Muse Code feedback dialog is removed until it can work. Nothing opened it,
  and Muse Code feedback still refuses before dispatch without a captured receipt
  reader. Help no longer lists **Send feedback to Muse Code**, and its ten
  dialog-only strings are gone from every language table.
- A paid search answered **Always** goes ahead once when the profile store
  cannot hand out an approval order (read-only or corrupt), instead of being
  denied; the grant is not kept, the next search asks again, and the same
  "could not be kept" warning is logged as for a failed save.
- The Model API service-status body is read under the provider body cap, so
  an oversized status page is cancelled at the cap instead of buffered whole.
- `npm run quality` runs the legal accessibility suite again, and the
  dependency-cycle check covers the 22 entry points a merge had dropped
  (57 roots, no cycles); a manifest test pins both accessibility suites.
- The `museSpark.resourceRelocate` setting no longer implies relocation works.
  No paired-device or runner route is bound in this release, so resource status,
  the pause notice and `resources status` say relocation is in progress,
  and the setting's description says so too.
  <!-- whats-new: historical -->
- Release CI fixtures retain both resource commands and agent outcomes, staged
  multilingual Help checks, and the harness's signed-in readiness handshake.
  Cold bundle tests own a complete build, and exec package fixtures supply
  the required native helpers without relaxing production packaging guards.
- Action-check builds the real Darwin and both Linux native helpers before
  producing its fake-only ACP candidate.
- Restore the merged Windows job helper's compilation for shell commands,
  resource controls and team process containment. Resource job holders load
  the same assembly directly without PowerShell module discovery.
- Keep Windows resource creation, manifest rotation and cleanup bound to
  verified native handles, including current-user ownership, missing-root
  completion and preservation of raced directory replacements.
- Load packed runtime and English regions through explicit CommonJS requires
  under Node 22 loader hooks, preserving archive digest checks and fallback.

- Keep the GitHub-only badge authorization spread compliant with the existing
  lint gate, retaining unauthenticated requests when no job token is supplied.

- Deliver every long-reply harness frame before advancing the stream, keeping
  readiness pending through completion within its existing deadline. Batch
  validated deltas between paints and wait for the actual composer before
  scene actions, preventing startup sign-in races in questions and reports.

- Parse the full changelog in release and artifact test setup so version,
  Highlights and lossless packing assertions keep their existing deadlines
  under load.

- Screenshot helpers use the harness's bounded scene readiness instead of a
  removed idle-delay constant, preserving theme, font, paint and error checks.

- ACP cancellation stops the running model turn while local agent inspection
  waits, and a late cancelled read preserves newer command preparation.
- Agent receipts read patch references through the child that owns them and
  preserve earlier native attempt receipts while a new attempt is running.
- Child completion evidence belongs to the current turn. Parent Model API
  request bytes and cache prefixes keep their original tool order.
- Windows shell credential regressions await the matching background completion
  before cleanup and probe raw environment values within the default test deadline.
- Prompt host shutdown awaits mirror merges and other admitted operations
  before releasing storage, preventing Windows cleanup from racing a sync write.
- Browser package tests build the chat, Help and What's New pages themselves,
  so a clean CI shard needs no artifacts from an earlier production build.
- The installed ACP help check validates its complete localization table,
  retaining prompt and sharing labels in its exact output comparison.
- Chat-share HTML encodes markup delimiters in one pass. Privacy regexes have
  literal-metacharacter controls and documented, specific audit exceptions
  for their escaped workspace, home and username fragments.
- Keep every long-reply accessibility delta while yielding through a task port,
  avoiding nested timer throttling within the existing readiness deadline.

- Check every staged ACP help language in bounded parallel batches, keeping
  cold package certification within its existing deadline.

- Start browser harness scenarios after the webview's ready handshake, keeping
  cold bundle loading outside their DOM deadline and exposing bounded browser
  diagnostics before a team test times out.

- Accept Windows short temp-path spellings for team hints while refusing linked
  folders; avoid broad PowerShell module discovery in team native helpers and
  await unconfirmed helper closure before cleaning up its files.
- Check unit types in sequential projects to reduce hosted macOS memory, warm
  the shared companion browser before security cases, and observe launch readiness
  and network events directly. Reuse localization setup and separate the exec
  suite's one production build from its cold package deadline.

- Pass one serial worker limit to the local Semgrep launcher so aggregate
  quality runs reach the scan with the pinned CLI.

- Wait for actual scheduled harness events before accessibility scans instead
  of sleeping five seconds on every page, keeping timed scenes and all checks.

- Resolve installed browser paths before legal accessibility checks launch
  Playwright, including PATH-only Linux installs and explicit overrides.

- Prepare the large usage-journal benchmark before timing its warm read,
  retaining its 300 ms and no-reread checks with the normal test deadline.

- Compress the independent package archives concurrently at the same production
  quality and with identical bytes, keeping cold CI setup within its deadline.

- Exercise headless unread-output shutdown with the same large write in one
  synthetic text delta, avoiding more than 100,000 unnecessary fake frames.

- Keep cold package certification within its existing setup deadline by
  observing the source and packaged native exports in isolated workers together.

- Make clean CI shards own their ACP build and README image inputs, retain the
  historical activation baseline in the checkout, and verify installed help
  against its shipped translation archive.
- Encode companion recovery text with the shared HTML text encoder.
- Keep Action reviews and low-budget refusals working for large release diffs
  by retaining only the bounded review prefix before exec.

- Keep each waiting or deferred question's interactive card pinned above the
  composer. Its transcript marker's Answer button reopens and focuses that
  card, including after deferral; MCP forms use the same compact marker.
  Refresh Help & Reference and the README question screenshots.

- Search usage-journal newlines in native byte arrays so cold scans retain their
  validation and finish within CI's existing deadline under coverage. Companion
  browser security fixtures advance credential time explicitly, keeping session
  expiry independent of runner load.
- Share immutable Git setup for persistent-slot tests and run every uncertain
  descendant or transport-failure scenario at its own unchanged test deadline.
- Start the browser restart capture's discovery window after its verified
  runtime is ready, so a cold download cannot consume the discovery budget.
- Reuse Windows held-launch cancellation during retirement so a second STOP
  write cannot hide the disposal refusal with a closed-pipe error. Prepare
  immutable check-slot Git seeds once and verify each native failure scenario
  at the unchanged repository deadline.
- Prepare native Windows ACL, worker-handle and reviewer-journal fixtures before
  their assertions, and reserve background process priority for its dedicated
  lifetime test. Build the packaged team's invariant fixtures in suite setup.
  Native security checks and repository deadlines stay unchanged.
- Make provider, headless, deferred-bundle and VSIX tests independent of stale
  build outputs in clean CI shards. Reuse VSCE collection and reject oversized
  runtime members before parsing; existing budgets and test deadlines stay fixed.
- Bind historical worker certification to checked-in, byte-exact source fixtures
  so fresh clones need no rig-only Git objects.
- Canonicalize trusted usage-journal roots on macOS while retaining linked-store
  refusals. Team processes set below-normal priority before their command runs.
- CI fixtures share the ACP budget's home, wait for legal-dialog focus and
  prompt-menu controls, and use Playwright's installed browser when available.
  Windows worker checks retain alias refusals on volumes without 8.3 names.
- Validate newly added README screenshots from the checkout while continuing
  public image checks for files already on main; missing local images fail.
- Make usage, reference, provider and companion tests independent of stale build
  output and repeated cold setup on hosted runners, preserving default deadlines,
  all randomized cases, offline replays and native Windows security checks.

- Keep resource-only English in its independent fallback, removing duplicate
  deferred-surface bytes while preserving the installed language and size caps.
- Include all 35 bundled ACP runtime dependencies in its third-party notices,
  selecting the actual staged shared/lazy bundles and usage browser chunks.

- Include esbuild's namespaced resource-validation dependencies in release
  CycloneDX inventories using normalized POSIX and Windows package paths.

- Inventory ACP's actual staged shared/lazy bundles and usage browser assets,
  retaining their runtime dependencies and excluding extension-only outputs.

- Separate check-slot uncertainty cases and journal benchmark preparation,
  retaining default test deadlines and the 300-ms warm-read requirement.

- Run the actual badge/image gate in the ChatGPT package fixture under CI,
  preserving the prohibition on offline badge overrides.

- Reuse the headless tests' existing fake image transport for every package
  guard, retaining CI and the real badge validator without an offline override.

- Inspect the Team harness's real package inventory in an owned publication
  tree, avoiding other test workers' temporary files within the same setup limit.

- Compose exact money ports across the provider, team, usage and headless train;
  keep subscription Plan turns independent of API budget journals and validate
  output caps before clamping.

- Ship and require the Darwin helper in ACP archives, retain native cleanup
  refusals, and load each resource surface's own English fallback within its cap.

- Pass Semgrep's worker option once, preserving the serial scan and every rule
  and deadline after the release merge.

- Install companion launch recovery labels through DOM text content, keeping
  translated markup inert before the authenticated app starts.

- Keep paid/reply browser fixtures on canonical decimal USD and wait for the
  real settled harness when capturing README scenes with lazy imports.

- Remove the obsolete source-map-js audit exception once the locked tree no
  longer reports its advisory; retain the existing audit policy.

- Restore queued late-question answers before ACP manual compaction, so the
  next ordinary prompt delivers each answer once.

- Count the shared chat/resource browser graph once in the split guard while
  preserving independent-graph and model-text leak checks.

- Forward the resource-wrapped headless result exit code after structured-output
  validation, retaining schema mismatch code 10 and its accounted spend.

### Documentation

- New orchestration docs: `docs/orchestration/ssh-limits.md` (SSH connection
  limits, how they apply, per-platform handling) backing gotchas G50–G52, and
  `docs/orchestration/playbook-placement.md` (placement, load balancing and
  moving work, model-agnostic) for the M116 playbook skill to adopt.
- Orchestration gotcha rows numbered after the rows 0.15.0 shipped: key
  installs G49, handshake throttling G50, the Windows desktop heap G51,
  password and probe penalties G52. New rows G34 (smoke call per engine per
  machine), G35 (launch liveness probe), G36 (done means a clean tree, listed
  steps and a moved head) and G37 (fail-closed safety checks, per-run caches
  in the run's workspace).
- Eleven orchestration gotcha rows G38–G48 (orphan process trees, the
  completion ledger with a 15-minute alarm, cadence pulls of critical-path
  heads, one owning lane per file, pipelined releases, clean-tree
  certification, early draft PRs, hotfixes running full prep checks,
  reviewer inputs inside the workspace, one repair per failure class,
  sweep hits checked before a bulk edit), with D100 amendments for M96c,
  M107, M116 and M117. The playbook placement chapter gains lessons 11–20
  covering the same failures, still model-agnostic.
- Seven orchestration gotcha rows G53–G59 (completion only from the
  runner's observed process exit, review reports attached to the lane
  ledger, temp cleanup under one harness-owned root that deletes outside it
  only recorded identities and never changes permissions, deletion chosen by
  a clone-aware estimate and validated with `df`, heavy gates in reentrant
  per-machine slots owned by the run's process tree, a staged and committed
  diff re-read after hooks, no `git stash` in lanes), with D100 amendments
  for M96c, M107 and M116. D87.14's outside-root leftovers rule is narrowed
  to match G55. AGENTS.md gains rule 15 (re-read the staged and committed
  diff after every commit, since the pre-commit hook's `eslint --fix` can
  rewrite logic); changing the hook itself is left to the owner. The
  playbook placement chapter gains lessons 21–27 covering the same failures,
  still model-agnostic.

- A register of orchestration gotchas (`docs/orchestration-gotchas.md`) lists
  what went wrong while a fleet of agents built this project. For each one it
  gives the rule that prevents it and the milestone that will enforce that
  rule in the app's own orchestrator (D100).

- Keep paid-usage formatting and agent presentation labels out of chat startup, preserving the existing startup review baseline; pack their complete English fallback losslessly within its existing budget.

## [0.15.0] - 2026-10-06

Correction (2026-10-10): Teams and automatic compaction did not work for users in this release; it is being completed.

### Highlights

- **Bring your own models.** Add OpenAI, Anthropic or Gemini keys, connect local models, or try ChatGPT and Copilot sign-in in Models & Agents; features follow the selected model's capabilities. <!-- try: command museSpark.modelsAndAgents -->
- **Agent roles and teams.** Configure role pools, task limits and worker review, with explicit paid-worker consent and the shared daily budget. Today: teams of workers in isolated workspaces cannot be created yet. <!-- try: command museSpark.modelsAndAgents -->
  <!-- whats-new: historical -->

- **Scan with /legal.** Review licensing, copyright and source evidence without a model call, then export the report or confirm supported header fixes. <!-- try: command museSpark.legalScan -->
- **Long-task context and upstream sync.** Pi and SoL-Pi ports preserve packed output, literal recall and cache-stable prompts; automatic compaction is implemented but remains inactive pending its paired evaluation. <!-- try: setting museSpark.modelApiAutoCompaction -->
  <!-- whats-new: historical -->

- **Usage and cost.** Open the local Usage & Cost page for provider and team totals, reported or estimated tokens, budgets and exports. <!-- try: command museSpark.openUsagePage -->

### Added

- **Models & Agents.** Add origin-bound provider keys, discover and select
  models, pin favourites, test local endpoints, and import or export configuration
  without secrets. OpenAI, Anthropic, Gemini, OpenRouter and other captured
  provider formats share the in-process harness; features are enabled according
  to each model's capability record. A confidential workspace hides and refuses
  models that train on its content.
- **Subscription sign-in previews.** Eligible ChatGPT Plus/Pro accounts can use
  Subscription Sharing through the system browser. Compatible VS Code hosts can
  expose Copilot models through their Language Model API. Plan requests retain
  their provider's limits and do not consume the harness's USD cap. Installed
  editor and live success certification retains the limits in M95b's record.
- **Roles and teams.** Configure role charters, tools, model pools, task limits,
  templates and intensity. Workers use isolated workspaces, show their role and
  task in the transcript and Agent map, and support review before merging.
  Paid workers ask for consent naming model prices, task ceilings and the shared
  daily budget; subscriptions do not pay for these extras.
  <!-- whats-new: historical -->

- **/legal.** Scan manifests, locks, local license evidence, SPDX expressions,
  headers and source/asset provenance without a model call. Public npm/PyPI
  metadata lookups disclose the registries and package identifiers first;
  offline scans remain available. Bounds and incomplete coverage stay visible.
- Export legal reports as Markdown and confirm supported evidence-based header
  repairs through the guarded edit path. Optional Model API explanations ask
  for paid-use consent and share the daily reservation/settlement ledger.
- **Usage & Cost.** A local page groups usage by provider, model, request kind
  and client, with charts, budgets, limits and exports. Reported and estimated
  tokens, unpriced/local requests and uncertain costs remain distinct. Shared
  ACP/headless accounting reserves its daily budget before dispatch.
- Record the orchestration gotchas and the product rules they motivate in
  docs/orchestration-gotchas.md (D100).

### Changed

- Port Pi and SoL-Pi context improvements: sticky packed output, literal recall,
  cache-stable prompts, selected-model strict tool schemas and bounded replay
  image resizing. Manual compaction is available in ACP. Automatic compaction
  remains inactive until its paired evaluation passes, even with its setting on.
  <!-- whats-new: historical -->

- Generate Help & Reference for providers, teams, legal scan, compaction, usage
  and the merged question workflows, including current CLI routes and paid limits.
- Apply selected-model cache pricing, bounded one-shot sign-in callbacks,
  validated custom compatibility overrides and coalesced session saves.
- Chat, Models and Usage share browser dependencies once. Legal reports,
  review comments, optional English, keyboard contexts and panel bodies load on
  first use with accessible loading, failure and retry. Complete translations
  and the inherited startup/deferred ratchets are preserved.
- Package runtime translations and exact lazy Node sources losslessly. The
  approved universal 0.15.0 VSIX budget is 2775 KiB; individual bundle caps stay
  unchanged. ACP help includes every merged local command in all 14 languages.

### Fixed

- Strip credential-shaped environment variables from runner setup, checks, Git
  and SSH children, and refuse credential names in remote forwarding configuration.
- Preserve measured cache-hit percentages and token speeds after usage retention;
  roll up costs with the same micro-dollar rounding as detailed usage totals.
- Resolve provider addresses before adding, editing or importing configuration;
  keep private-network confirmation and metadata refusals. Local scans contact
  preset model-list endpoints. Hide unavailable OpenRouter account connection
  and key-usage services with an explicit status; pasted keys remain supported.
- Export subscription provider configuration without secrets. Confirmed imports
  clear credentials for imported and removed providers, validate default model
  references before confirmation, and publish providers/default atomically.
- Keep deferred question controls and team-worker attention labels together
  after the release merge. Local ACP compaction preserves queued late answers.
- Preserve safe Windows team storage aliases, publish private
  hints with the current user's verified ownership, and admit bounded native
  process confirmations containing long executable paths.
- Keep team settlement durable, retain worker labels in the combined attention
  dock, and preserve queued late answers alongside local ACP commands.
- Restore legal-export focus after a cancelled native save dialog and keep
  signed-out /legal navigation free of unnecessary sign-in warnings.
- Gemini rejects proxy-null usage and negative counters rather than reporting
  stale token totals.
- Keep Windows shell directory tracking on the native long workspace path and
  normalize Windows paths in bundle and package checks.
- Make package, browser and process fixtures deterministic at the repository's
  default test deadline. Accessibility scenarios wait for their actual lazy
  controls and loaded content before scanning.
- Legal keyboard and zoom checks wait for scripted scenario actions before
  native input, preserving focus assertions without racing preview setup.
- History rows load correctly in production builds and keep their Archive
  shortcut when optional keyboard contexts are deferred.
- ACP Registry and stdio release tests share their real-agent fixture build
  and cleanup, preserving installed-package coverage without copied setup.
- Translated ACP help retains provider and legal commands alongside sharing,
  and names the automatic compaction opt-out in every installed language.
  <!-- whats-new: historical -->

- Agent map harness scenes select their titled pill when Side chat is also
  available. Package and localization fixtures include the merged sharing graph;
  shutdown coverage waits for prompt storage before backend and usage cleanup.
- Checkpoint disposal tests retire the captured owner after filter-free Git
  discovery exits 1, so the cancellation assertion exercises disposal reliably.
- Built-exec tests isolate package image requests with local screenshots and
  test-owned badge responses, so unpublished PR assets cannot block the engine
  tests. The real package badge validation and independent public-image gate
  still run.
- Test infrastructure warms deferred panel and row modules before behavior
  suites, keeping cold transforms outside the default UI query deadlines.
  A source check catches new deferred imports missing from warm-up.
- Test infrastructure: harness scenes wait for the controls they touch,
  including lazy panels, and finish startup and control waits before
  accessibility scans. The scrolling scene waits for its rendered reply and
  New messages control. A source guard catches unexplained fixed-delay
  interactions; screenshots use the same readiness checks.
- Shared-panel hosts without VS Code's native context menu open the compact
  Prompt library menu at the pointer when right-clicking the composer input.
  Save, Share and Use saved keep the toolbar's conditions and exact draft;
  Escape returns focus. Shift-right-click preserves the host's clipboard menu.

### Documentation

- The npm landing page carries the same quiet GitHub star link as the other
  landing pages, with a regression check for its exact sentence and placement.
- README screenshots refreshed for the question dock, Git actions, slash
  commands and paid usage; added open-question and Help & Reference
  views, with matching captions on both landing pages.

## [0.14.5] - 2026-10-06

### Fixed

- Composer prompt actions sit in one compact Prompt library menu on the
  composer toolbar (Save prompt, Share prompt, Use saved prompt), also in the
  right-click menu, instead of three full-width buttons covering the chat box.
- The ACP agent offers terminal sign-in to clients that announce it with the
  older `_meta` terminal-auth capability (ACP Registry).

## [0.14.4] - 2026-10-06

### Added

- Save your own messages, composer text and editor selections into a personal
  prompt library usable across workspaces, or a project-local library. Search,
  tags, literal variable substitution and reviewed portable imports prepare
  text for insertion without submitting a model request.
- Share prompts and conversations as Markdown, HTML or versioned JSON with an
  exact preview and confirmation before copy, file or browser destinations.
  Conversation-only shares use an allow-list; confidential or unknown content
  is refused with an explanation, and secrets and private paths are scrubbed.
- Local ACP `/prompt` and `/share chat` commands and terminal `prompts` and
  `share chat` routes use the shared stores and renderer. Help & Reference
  includes all six editor commands, both features and the opt-in sync setting.
  ACP composer insertion and final-action UI still depend on M104/M110a0;
  installed-editor parity is not claimed.

### Fixed

- History Save menus stay keyboard reachable beside listbox options, and
  composer prompt actions and the input meet minimum target sizes.
- Cold prompt and chat dialogs retain modal loading, Escape dismissal and
  focus restoration; a late import cannot reopen a dismissed dialog.
- Exports from symlinked workspaces bind atomic writes to checked canonical
  targets. Cancellation covers a pending Save dialog; prompt sync changes
  activate the mirror before first use, and action failures appear as notices.
- Full shares retain displayed command outcomes, verification failures, status,
  exit codes and citations. Late confirmation cannot close another session's
  dialog; colon-prefixed absolute paths are scrubbed without damaging URLs,
  slash commands, division, HTML tags or regex literals.
- Standalone ACP full Help ships its manifest localization tables and is
  checked from the staged package in every shipped language before packing.
- Panel `/help` uses the complete Help & Reference catalog through one palette
  route while retaining all prompt and chat actions.
- Problem reports recognize the shipped prompt bundle alongside the question
  deferral bundle. Translated ACP compact help includes the sharing routes.
- Windows shell credential regressions await the matching background completion
  before cleanup and probe raw environment values within the default test deadline.
- Prompt host shutdown awaits mirror merges and other admitted operations
  before releasing storage, preventing Windows cleanup from racing a sync write.
- Browser package tests build the chat, Help and What's New pages themselves,
  so a clean CI shard needs no artifacts from an earlier production build.
- The installed ACP help check validates its complete localization table,
  retaining prompt and sharing labels in its exact output comparison.
- Chat-share HTML encodes markup delimiters in one pass. Privacy regexes have
  literal-metacharacter controls and documented, specific audit exceptions
  for their escaped workspace, home and username fragments.

### Performance

- Prompt library and chat preview load on first use with their own measured
  25 KiB budgets. Optional tool details, review findings, effort controls and
  History rows also load lazily, preserving the existing startup regression
  baseline, 900 KiB startup cap and 50 KiB original deferred cap.
- The Node Help bundle packs its complete reference with a native lossless
  codec while keeping the browser schema and every reference field intact.
  Its existing 100 KiB cap and the 2400 KiB VSIX cap are unchanged.
- Bundle tests build only the production browser fixture they inspect, keeping
  verification within the repository's default timeouts.

### Documentation

- A register of orchestration gotchas (`docs/orchestration-gotchas.md`) lists
  what went wrong while a fleet of agents built this project. For each one it
  gives the rule that prevents it and the milestone that will enforce that
  rule in the app's own orchestrator (D100).

## [0.14.3] - 2026-10-06

### Added

- Questions stay in the dock and transcript, defer after a machine-scoped
  deadline, and accept late answers exactly once. Open counts appear in
  History, the tab title and the composer; Next and Previous navigate them.
- ACP question handling: deadlines and cooperative form
  withdrawal, immediate deferral without forms, late form answers, and local
  `/questions` and `/answer` commands. The runtime parses
  `--questions-defer-after` and its help is translated in all 14 languages.
  The real registry and private durable idle-answer queue are connected to
  the launcher. Headless's explicit policy declines immediately with no clock.
- Help & Reference covers questions: the Next and Previous open question
  commands, `museSpark.questions.deferAfterSeconds`, `--questions-defer-after`
  and the ACP-local `/questions` and `/answer`, which ACP `/help` now lists.

### Changed

- Question choices, explanations, countdowns and dock controls now load in a
  separate lazy browser chunk on the first question. A minimal arrival card
  stays visible while loading, and the shared draft survives loading and
  remounting. The chunk has its own 25 KiB budget; existing caps are unchanged.

### Fixed

- Problem reports retain frames from the shipped question deferral bundle.
- Release checks cover crash recovery through the shared reload helper, await
  deferred question commands and menus, and verify Cline shell quoting on all
  platforms without a slow PowerShell startup.
- Two accessibility scenes for questions wait for the lazily loaded question
  controls instead of a fixed delay.
- Retry after a failed optional panel reloads its complete module graph with
  the conversation and draft saved. Cold menus respect outside dismissal and
  late imports cannot take focus; failed menus accept Escape and return focus
  to their trigger.

- Durable questions: late answers now use the ordinary send path's permission
  barriers and session recovery. Re-asks keep their own deferral deadline,
  publication saves once with durable rollback, coalesced replies finish
  independently before their shared card retires, and session deletion removes
  temporary question snapshots left by interrupted writes.
- ACP Stop cancels without waiting for question storage. Late form answers
  wait for registry opening, failed deferrals explicitly cancel the waiting
  tool, and released sessions cannot queue refused steers. Idle answers are
  announced as queued until the next prompt actually sends them.
- Question cards and settled outcomes load when first shown. ACP forms and
  elicitation parsing use `acpQuestions.js`; private registry and queue storage
  use `runtimeQuestions.js`. Both backends load the shared deferral note only
  when a question defers. Every existing hard cap remains unchanged; the lead
  accepted the webview startup growth in PLAN §9.
- Cancelling ACP preparation restores a leased answer queue before any turn
  starts; an uncertain submission retires its prefix so a restart cannot send
  it again. Failed grouped deferrals cancel each failed backend request.
- History shows the same open count as the chat badge and discards a private
  count read after its surface changes, including a failed read, so an old list
  cannot reappear on the new surface.
- Correct the frozen question contract: scheduled/unattended prompts defer
  immediately, including when interactive deferral is disabled.
- Question snapshots now retire stale open cards and their controls together;
  known terminal states survive same-session history refreshes. The attention
  dock prioritizes the newest waiting question over past reminders while
  preserving a focused question and retaining inactive drafts.
- MCP-form accessibility scenes wait for the lazy dock's input before filling
  it, so a slower first load is checked without a harness timing failure.

### Performance

- The Help reference packs each CLI route prefix losslessly, keeping the
  Node reference within its existing 100 KiB budget with the question entries.

- Optional menus, sign-in, goals, schedules, Account & usage and Agent map
  content load on first use with accessible loading and retry after a failed
  chunk request. A lossless native encoding keeps the complete English fallback
  inline while reducing webview startup from 794.1 to 733.8 KiB (60.3 KiB).
  The original deferred group drops from 50.0 to 32.1 KiB; existing size caps
  stay unchanged.

- MCP form controls and workflow details also load on first use, preserving
  the diet's startup and deferred regression limits with the question dock.
  Questions keep their visible arrival card and use the shared local retry
  after a failed load. Workflow details have their own 25 KiB closure budget;
  all existing caps remain unchanged.

- Reference tests share unchanged setup and keyboard analysis, keeping
  catalogue mutation checks within the normal test timeout.

- The VSIX omits the duplicate generated Markdown reference; Help continues
  to load its bundled reference and links to the complete online guide.
  Its compressed universal package budget is 2400 KiB, measured with Help
  and the macOS helper plus 5%, rounded up to 25 KiB.

## [0.14.2] - 2026-10-06

### Security

- Update the dev-only shell-quote lock entry to fix GHSA-pqg4-j6r4-53mv
  within npm-run-all2's existing dependency range.

### Fixed

- The release-artifact check validates complete ACP help, including its reference
  hint, in English and every installed language using the CLI's shared formatter.

- The report CLI help test follows the documented complete-reference contract
  for subcommand `--help` and `-h`.

- The Help reference gate accepts Windows file paths and continues checking
  keyboard dispatch against the runtime registry.

- Activation paid-setting checks are directly importable in tests, and ACP
  stdio checks include the localized Help reference hint.

- Hungarian Help translations now package correctly alongside the other languages.

- Help includes the shell credential pass-through setting and its restrictions
  on interactive Model API commands.

- Best-of-N help states the implemented shared parent-budget prerequisite in
  all fourteen languages. The reference guard rejects state predicates across
  every emitted description, including shortcuts, enum meanings and facts;
  conditional text retains typed selectors on every help surface.

- Help keeps conditional state in typed descriptions with a rejecting guard
  for new plain-text claims. Hooks describes both backends, and secret-scanner
  help explains scanning and in-memory key matching without storage.

- Auto help names both command reviewers, their rule precedence and paid
  admission, and separates ordinary model questions from private MCP form replies.

- Help search matches the JSON text displayed for schemas, facts and CLI
  contracts. Markdown preserves argument placeholders in every prose field,
  and the modal keyboard row includes both Tab and Shift+Tab from its handler table.

- Help derives keyboard actions, CLI options and paid identities from the tables
  used at runtime, preserves enum defaults and meanings, and describes conditional
  availability explicitly. All descriptions have catalogue translations. Search
  includes displayed shortcut text and keeps related command targets visible.
  Headless image help states its flag, mode and budget admission without promising
  an interactive price question. Deferred and headless package reference-bundle
  fixtures are complete.

- Help now distinguishes host/backend combinations, subscription and key billing,
  paid defaults and actual voice/Tab availability. It retains setting schemas,
  command prerequisites and CLI/slash syntax, refreshes skills on first ACP help,
  uses installed manifest translations in CLI help, and offers retry after a
  help-loading failure. The reference gate checks these source inventories.

### Added

- **Help & Reference.** `/help` and **Muse Spark: Open Help & Reference** open
  a lazy, searchable shared-webview page for features, commands, settings,
  slash syntax, CLI options and keyboard actions. Current/default values, direct setting links,
  safe command actions and documentation use all 14 translated tables. ACP
  `/help` answers locally; CLI `help --all` prints the generated reference.
  `check:reference` guards catalogue coverage and generated-file freshness.

### Performance

- Reference tests share unchanged setup and keyboard analysis, keeping
  catalogue mutation checks within the normal test timeout.

- The VSIX omits the duplicate generated Markdown reference; Help continues
  to load its bundled reference and links to the complete online guide.
  Its compressed universal package budget is 2400 KiB, measured with Help
  and the macOS helper plus 5%, rounded up to 25 KiB.

- Frequent Help reference values use shorter lossless dictionary tokens, keeping
  the complete reference within its existing bundle limit.

- Shorter tokens in the lossless inline English dictionary keep chat startup smaller than 0.14.0 while adding Help & Reference; the complete fallback and existing size limits remain.

## [0.14.1] - 2026-10-05

### Security

- Cover common credential suffix families, Azure DevOps PATs,
  `SYSTEM_ACCESSTOKEN` and Terraform's `TF_TOKEN_*` in the shared environment
  fence. A scheduled shell delayed in directory preparation now retains its
  original unattended admission after backgrounding and turn completion;
  a later interactive turn cannot grant it credential pass-through.
- Fence credential environment variables from VS Code Model API shell commands,
  verification/`then_run`, schedules, child workers, hooks/plugins, Git and native
  helpers, using the same matcher as ACP/headless. Terminal overrides are fenced
  too. The new machine-scoped `museSpark.shell.passEnvironmentVariables` array
  permits named variables only for interactive top-level shell commands; its
  description warns that output can expose them to the model provider. MCP's
  explicitly configured environment and Muse Code's own credentials are unchanged.

### Fixed

- Marketplace/Open VSX and ACP npm landing pages now show static version badges
  generated from the packaged version, avoiding stale badge-service caches.
  Release refresh discovers every GitHub README badge, including CI and
  Markdown images, before purging GitHub's image proxy. A packaging/quality
  check rejects broken images, dynamic store versions and version mismatches.

- Timed-out and stopped POSIX shell commands now wait for their process
  group to exit before returning. Cleanup is bounded and reports a group
  that remains; macOS monitor tests recognize exited zombies correctly.
- Chat startup now loads syntax highlighting only for a closed supported code
  fence, leaving code text and Copy, Insert and Apply immediately available
  while its engine loads. Action-only dialogs and the separate Tasks surface
  also load on demand; the command palette reuses its shared list shell. The
  900 KiB startup budget and existing deferred budget stay unchanged.

## [0.14.0] - 2026-10-05

### Highlights

- **Tab completions with a separate hard daily budget.** Invoke ghost text with Alt+\; first-use consent names the price and $1.00/day default. <!-- try: command museSpark.tabMenu -->
- **Git and pull requests from the panel.** Draft, commit and push with confirmation, then create or open a GitHub PR in a held conversation worktree. <!-- try: command museSpark.openPullRequestInConversation -->
- **Hooks and plugins from other agents.** Import popular hook formats, run Setup and Manual hooks, and use bounded Amp and OpenCode plugins on the Model API backend. <!-- try: command museSpark.runSetupHooks -->
- **Preview a scrubbed problem report.** Review, copy or save the exact local report before choosing to open an issue; the extension sends nothing. <!-- try: command museSpark.reportProblem -->
- **Muse Judge phase 1.** The conversation model can add uncalibrated caution to an approval without granting permission. Model API use asks first and shares the durable daily budget. <!-- try: setting museSpark.judge.engine -->

### Added

- A quiet GitHub star link in the GitHub and Marketplace/Open VSX READMEs,
  What's New footer and Getting Started welcome step, with the footer and
  step description translated in all 14 languages.

- **Tab completions (M94, PLAN.md D73).** On by default, with its status
  item visible at startup and its completion engine loaded on first use.
  Alt+\ invokes ghost text; the five Tab commands turn it on/off, snooze it,
  open its menu and choose languages. The default trigger is Invoke because
  the probe measured 3.8 s median to first text. The first charge asks once
  per window, names the model's rates and the $1.00/day default hard budget;
  the stored Model API key pays on either chat backend, never the subscription.
  - Fast and multi-line context, filtered completions, typing-through cache,
    bounded scheduling and per-window daily-ledger files shared across all
    windows. Reported usage settles reservations; missing usage retains them.
  - Related recent-edit and definition snippets now reach the engine in
    path order, within the context limit, through the same file privacy
    checks as the current file; secrets are redacted before cutting excerpts.
  - The status item shows spend, snooze, budget, no key, trust, language and
    Copilot states. Account & usage counts Tab requests, tokens, cached tokens,
    this window's reported cost and the cross-window day/budget.
  - Translated commands and multi-line picker labels in all 14 languages.
    `dist/tab.js` ships in the VSIX, with size, module-split, model-text and
    host-global checks; the host-API record is regenerated.
  - Cursor's Tab hook bridge is prepared; executing those hook configurations
    and the final live check wait for M91/lane K.

- Git and pull requests from the panel (M71): editable commit and PR drafts
  written by the user's Muse turn, explicit commit/push consent, GitHub PR
  creation and conversation-linked checks. Push never uses force. A commit's
  consent covers the bytes of new files too, in either of VS Code's views of
  them, so a commit whose new files changed after the consent is refused. A
  foreign PR opens in its own held worktree, with project configuration and shell
  access off until the extension's trust card is confirmed. Git never checks
  a foreign PR out: the worktree is added with `--no-checkout`, its index
  read from the commit, and its files written by the extension exactly as
  stored, so no filter, hook or conversion runs wherever Git's configuration
  defines one. Paths that would leave the worktree, name `.git`, use a name
  the platform cannot hold or collide where case does not count refuse the
  checkout whole, as do PRs over 20,000 entries or 250 MB. A trusted parent
  record never releases a held PR below it. Best-of-N, the session board's
  worktree reads and `/review` of Git's changes run no Git in a held PR
  window until its trust card is confirmed, whatever VS Code's trust says.
  Concurrent opens of the same
  held PR preserve the successful checkout's record when another open
  fails. The held checkout rejects non-commit SHA arguments before Git
  runs and reports an overflowing tree listing as the existing too-large
  refusal. Physical-owner and lifetime
  guards refuse stale operations. Commit, push, PR fetch and checkout use
  checkpoint process admission.

- **Hooks and plugins (M91/M91b, PLAN.md D70).** Trusted, opt-in
  `spark-hooks.json` dispatch reaches extension events on both backends,
  with Setup and Manual commands, `/hook run`, bounded file/settings
  notifications and MessageDisplay markers. Muse Code never reads that file.
  The standalone agent can run trusted Setup without a model call.
  - Importers cover Codex, Gemini, Cursor, Copilot and VS Code, Windsurf,
    Kiro and Cline. Codex native hooks run on both backends; foreign-format
    adapters and Amp/OpenCode plugins run on the Model API backend. Unsupported
    or weaker event mappings are refused visibly. No foreign answer grants.
  - Typed `http`, `mcp_tool`, `prompt` and `agent` handlers keep their trust,
    network, permission and paid-consent boundaries. Model hooks use the shared
    daily ledger; bounded hidden agents can only read, search and use read-only
    code intelligence. Their usage appears separately.
  - Model API shell calls keep a confined current directory; `then_run` and
    checks stay at the workspace root. `modelApiShellKeepsDirectory` can disable it.
  - MCP forms validate the supported flat schema subset, ask even in Bypass,
    and cancel on Stop, timeout or closing. Elicitation hooks run through the
    wired host seam; answers never enter logs or saved transcripts.
  - Plugin children have bounded lifetimes, memory and credential-free
    environments. OpenCode is refused on macOS and plugins are refused in ACP.
    Windows offers Retry Plugin Hooks after containment preparation failures.
  - Hook runtimes, imported adapters and plugins each load on first use.
    Hooks-off golden Model API bodies remain byte-identical. The certification
    records retain capture qualifications and unsupported events.

- **Report a problem (M93, PLAN.md D72).** `Muse Spark: Report a Problem`,
  the palette's Support item, "Report this" on recorded error rows and
  notices, and the crash screen open one dialog that builds a scrubbed report
  locally. No chat, sign-in, backend, model call or network request is needed,
  and nothing is sent by the extension.
  - **A flight recorder, not a log.** Each window keeps a bounded journal of
    facts under VS Code's global storage (7 days, 256 KiB a journal, pruned
    at start, append and read): a fixed event kind, a known error class or
    the word `unknown`, the versions, and stack frames inside the shipped
    bundles only. No prompt, code, file content, model output, tool text,
    message, path, id or credential is ever written. Links and unexpected
    files are refused.
  - **The exact draft first.** The dialog shows the final scrubbed text,
    lists every item in it (each removable), takes an optional description
    and warns that it can still disclose something. Copy, Save, the
    prefilled GitHub new-issue page (copy plus the empty form past 2,000
    encoded characters) and, where VS Code has it, its own issue reporter
    all export that same sealed text; a change after the preview re-previews
    instead.
  - **After a crash**, the next activation offers once: "Muse Spark Code
    stopped unexpectedly last time — report it?" A second live window is
    never taken for a crash.
  - **Headless.** `muse-spark-code-acp report` prints the same scrubbed
    report from the agent's own journal, starting nothing; in ACP mode the
    agent records its own failures there without touching ACP stdout.
  - **Windows reports.** UNC and extended Windows paths are scrubbed,
    including quoted paths with spaces. Workspace/home replacements accept
    equivalent Windows case and separators; extended paths retain verified
    package stack frames. Windows link, open-file pruning and CRLF export
    checks are recorded in `docs/certification/m93.md`. The dialog's section
    switches now have enough room for Windows native checkbox targets.

- **Muse Judge phase 1 integration (M98, PLAN.md D77).** Same-model,
  uncalibrated risk advice at existing reviewer and card fences, a fixed
  caution note, status and separate usage rows. Muse Code uses fresh hidden
  Plan sessions on the subscription, with standing-rule checks, redaction,
  cancellation and temporary-folder cleanup. `museSpark.judge.engine`
  selects `auto` (default), `same` or `off`; the Judge bundle loads only at
  an eligible approval. Model API main-body goldens and main-session MSP
  invariants remain unchanged. Paid transport admission, credential-wait
  rechecks and unknown-cost liability are integrated, but Model API Judge
  uses D78’s shared durable daily ledger, reserving once before dispatch and
  retaining uncertain liability. Subscription-only users see no Judge price popup.
  Local/separate Judge, CLI, live measurements and full certification remain
  planned.

### Changed

- After all four release channels publish successfully, a credential-free final
  job waits for public version propagation, refreshes README badge URLs and
  purges GitHub's camo image copies. Older version badges get a cache-busting
  retry and an original-URL recheck; stale caches and network failures warn
  without failing the release.

- Preserve both full What’s New releases in a bounded lossless artifact
  envelope, keeping its existing 40-KiB file cap and plain-file compatibility.

- Share existing Node boundary schemas in one validated runtime and losslessly
  encode the complete inline browser English fallback, retaining every key,
  value and plural form within the unchanged bundle and archive caps.

- Load Report only when opened, preserving loading cancellation and
  opener focus. Keep Share and Session Board eager within the unchanged combined browser caps. Keep the browser’s review-comment template separate from
  backend instructions and emit equivalent UTF-8 browser text.

- ACP loads the same recorder bundle before report reading or session startup,
  keeping the journal implementation out of its entry bundle.

- Keep English fallback regions lazy through descriptor-preserving locale
  state. Runtime, hooks and optional surfaces load their text on access;
  browser and integration builds retain their inline fallback.

- Load the conversation implementation on the first chat surface, install its
  caller's display language, and keep backend restart handling eager. Move
  conversation-only model prompts beside their lazy readers.

- Package translated UI values in one bounded lossless archive; installed
  values stay identical, while source and ACP tables keep their JSON format.

- **M100's paired-device plan now states connectivity prerequisites.** Manual
  address entry bypasses discovery only; routing and explicitly authorized
  inbound access are still required. D80, acceptance B/K and the research
  record specify blocked/unreachable setup recovery, standard-user/default-
  firewall and explicit-deny cases, and per-rig listener/permission evidence.
  Devices and mDNS stay off by default as an explicit security exception to
  enhancements-on. Documentation only; no pairing or remote execution ships.
- Keep paid HTTP clients in the existing Model API bundle until first use; compress production Node English text and packaged UI tables without changing their decoded values or size budgets.

- **Plugin limits (M91b).**
  - OpenCode plugins are refused on macOS, where `bun`'s memory cannot be
    bounded.
  - Plugin hooks are refused in the ACP agent.
  - An OpenCode `tool.execute.before` blocks the call when it throws,
    crashes or times out. Every other plugin hook fails open.
- **M50's Windows MCP job launcher** takes an optional job memory limit.
  MCP servers still start without one.

- **M98 integration repairs.** A ready Judge latch is invalidated when its
  live source becomes unavailable; the main Model API body is read from the
  actual sent request. Hidden-session rows stay out of History, and the
  PowerShell tool toggle fits within a 320 px panel. Invalid side-receipt
  counts fail before they reach usage rows. Hosted-tool prefixes use
  standalone Judge bodies, so token consent grants no hosted-search charge. Every existing
  bundle and VSIX cap is preserved; the new lazy Judge has a 100 KiB cap
  from its 77.7 KiB measurement plus the existing sizing rule.
- **Accessibility browser driver.** All scenarios use the existing
  Playwright page driver after Chrome's `--dump-dom` stalled on ordinary
  pages. The scenarios, themes, page timeout and axe finding rules stay
  unchanged.

- **Tiered CI, ready for a merge queue.** The full gate now runs as parallel
  jobs:
  - the static gates on all three platforms;
  - the unit/e2e tests in four coverage shards per platform, merged before
    the unchanged thresholds apply;
  - the accessibility harness once, on Ubuntu;
  - integration on Ubuntu and Windows;
  - the macOS helper and the universal packages.

  A `merge_group` run checks the commit that will land. Once the maintainer
  turns on the queue and sets `CI_MERGE_QUEUE=on`, pull requests run only a
  fast Ubuntu tier: the static gates, the build, every test, gitleaks and
  semgrep. Until then every pull request keeps the full tier. The seven
  required check names and the release artifacts are unchanged. In a merge
  group, gitleaks runs its pinned, checksum-checked CLI, because the gitleaks
  action refuses that event.
- **The extension loads less at startup**: `dist/extension.js` is
  436.7 KiB after the integrated startup repair, under its unchanged 600 KiB budget
  (PLAN.md D6, 2026-10-03 and 2026-10-04). Model text that only a lazily
  loaded bundle or the ACP agent reads is no longer carried at activation
  (same words, in blocks by reader), and the window's web fetch loads with
  its own bundle, `dist/webFetch.js` (budget 75 KiB), on the first fetch; if
  it cannot load, that fetch fails with the reason ("Web fetch could not be
  loaded", in all 14 languages) and the next one tries again. The lazily
  loaded bundles shrink too (the Model API backend, the checkpoint store,
  the import, code intelligence and both reviewers by 4 to 27 KiB each).
  `npm run build` now fails when a shipped bundle carries a model-text
  block it does not read, or when `MODEL_TEXT` holds a key no source file
  of `dist/extension.js` reads; the code intelligence and web fetch
  bundles' tests check that neither carries any key or value of `MODEL_TEXT`.
- Releases reuse verified universal CI packages when the successful own-repository
  PR, merge-queue or main CI build has exactly the tag's source tree, with recorded
  SHA-256/version checks and 30-day retention; tag-push misses run the full gates.
- Manual release recovery uses the same verified staging path while preserving
  the earlier run's original bytes; invalid recovery and cancelled runs cannot publish.

### Fixed

- ACP help and argument errors now use one complete localized usage table,
  including the Setup hooks command, so the installed package passes the
  release job's strict English fallback check.
- Windows shell directory tracking now uses the native long workspace path
  when starting or resetting a command, so 8.3 aliases keep the correct cwd
  and workspace-relative directory tail.
- Production bundle regression tests now build their own compressed English and
  shared wire fixtures, so macOS CI's test job works without a prior build.
- Windows CI hook fixtures now use the platform their captured paths describe;
  Cline discovery exercises both POSIX and Windows path handling on every OS.
  Deferred-bundle checks load their in-memory builds without requiring stale
  or pre-existing files in `dist`.
- Cline hook quoting is checked through native PowerShell on Windows and the
  POSIX shell on Unix, without requiring a Windows Bash installation.
- Fake-only headless tests recognize MinGit's verified GNU Bash `sh.exe`, and
  missing-browser-chunk checks accept Windows filesystem error paths.
- Fake-child plugin dispatch fixtures use drive-qualified plugin paths on
  Windows while retaining native-platform parsing and containment checks.
- Extension hooks use the held-project trust check before loading or running, including Setup and Manual hooks.

- Register every newly merged and split bundle in the report’s exact frame
  vocabulary so its package-only stack frames remain available after the diet.

- **Muse Judge (M98, RVM98J).** Boolean action arguments hash correctly;
  retried actions reject stale callbacks and fences; complete prompt batches
  fit the measured context; choice and score tokens must be one character.
  Explicit `same` honors the user's selection below the automatic readiness
  floor, logprob metadata matches the shared contract, and top-1 estimates
  correctly report partial evidence. Startup excludes the judge from legacy
  paid price review and loads no judge schema. The first-charge wording in
  every language says ask once and shows the shared daily budget. First-use consent and D78 accounting are wired through the window factory;
  remaining live and isolation qualifications stay explicit in its certification.

- **CI reliability:** the checkpoint-copy count test crosses a small test-only
  budget with six real copies, then checks the exact read bound and reuse of
  the same directory cursor. It avoids hundreds of unnecessary disk operations
  and no longer accepts repeated traversal restarts as eventual success.
- **The README's "What's new" section matches the release again.** 0.12.1 and
  0.13.0 shipped with the README still headed "What's new in 0.12.0". The train now
  describes 0.14.0, the Marketplace README carries the same section, and a
  test fails any release whose README section does not name its version.

- M91's Gemini hook adapters translate established native arguments
  and explicitly refuse unsupported blocking calls. Tool-selection whitelists
  survive `ANY` without forcing a call. Captured nested arguments and saved
  vendor scripts now have data-dependent checks; certification claims are
  limited to the evidence actually checked. Model packets validate their
  captured shapes, tool patches preserve full original arguments, ignored
  lifecycle controls retain observations, and Notification retains details.

- **M91 import review, round 3:** unreadable source switches refuse hooks;
  Copilot inline settings refuse siblings together; Cline script references
  are checked again after awaits and during planning, quoted as literal paths
  for Unix and PowerShell, and retain their 30-second bound. Nonexact tool
  matchers and Gemini lifecycle filters refuse visibly, Gemini sequential
  policy spans user and project settings, Cursor requires version 1 and
  uses the adapter's source-event contract, and universal Copilot regexes
  remain supported. Truncated or normalized MCP identities are refused.
  Kiro Manual is refused until its adapter has a row.

- Restore dead-export checks for shared constants: the exec schema tests use named imports instead of enumerating the whole module, and Knip also checks unused namespace values and types.

- Deferred-bundle split drills now build the checked Node entries once in
  memory and call the production guard directly. They retain rejection and
  byte-exact restoration checks without repeated full-repository scans,
  child processes, shared `dist/` mutations or longer timeouts.

- A blocked M80 `v0` tag update now reports that an administrator must move it,
  while preserving the four release channels' outcomes. Updates require a
  fast-forward; the release guide documents the administrator's recovery command.

### Security

- Tab uses held-project trust for completions and rechecks it at the native Git entry for ignore lookups, so a held pull-request worktree runs no automatic Tab Git command.

- **The plugin child** (RVM91X review, M91):
  - **Contained.** On Windows it runs in a kill-on-close job, so it cannot
    leave descendants behind. It sees only the allowlisted hook
    environment, as does the version probe.
  - **Memory-bounded.** The limit is 1 GiB: a Windows job limit, a `node`
    heap cap, or `prlimit` for `bun` on Linux.
  - **Validated.** Every answer it sends is parsed by a closed schema, and
    no plugin answer grants a permission.
  - **Ruled.** A failed answer follows the call's fail-closed rule, and an
    earlier refusal survives a later handler's failure.

## [0.13.0] - 2026-10-05

### Highlights

- **Browser checks on local web changes.** The model can open your dev server, click or type, and read console errors and failed requests through a verified, isolated headless browser. The Model API also receives its screenshot. <!-- try: command museSpark.downloadBrowserCheckRuntime -->
- **What's New after updates.** Release highlights and full notes open in an editor tab when you are idle; fixes-only patches show a quiet notification. <!-- try: setting museSpark.showWhatsNewOnUpdate -->
- **Enhancements available by default.** Model API extras are visible out of the box, with paid-use consent before spending and a shared daily budget. Explicit false settings stay off. <!-- try: setting museSpark.paidDailyBudgetUsd -->
- **Muse Gadgets guidance and secret checks.** The bundled SDK skill covers ESP32 build, flash and bounded monitoring. Detected tokens are redacted, secret-bearing prompts pause for your decision, and emitted shell approvals offer only one-time consent.
- **Safer diagnostics and steadier Windows helpers.** Diagnostic notices redact known secret shapes; confidential workspaces recheck contributor dispatch; protected file approvals stay protected; Windows job helpers compile directly with the .NET compiler.

### Added

- Bundled `muse_gadgets` skill (Model API backend, listed while `museSpark.bundledSkills` is on): ESP32 build, flash and monitor guidance with the bounded-monitor pattern, the SDK token rules, and the never-a-gadget warning. A timed-out shell command is proven to return its captured output with `isTimedOut` and leave no process behind on Windows, macOS and Linux. README gains a "Muse Gadgets" section.

- **A live receipt workflow for the GitHub Action (M80 LA).**
  `.github/workflows/action-live.yml` runs the real Action, on the agent
  package packed from the same commit, against one open same-repository pull
  request with the `MUSE_MODEL_API_KEY` secret: the contributor model, a hard
  $0.25 budget, read-only permissions and no comment. Only the repository
  owner can start it, by hand, on the default branch; it has no other
  trigger. `test/action/la-check.mjs` judges the run and the step summary
  records the receipt. It has not run yet.
- **The first live Action receipt (M80 LA) passed** on 2026-10-05, in
  [run 37249121568](https://github.com/RandyNorthrup/muse-spark-code/actions/runs/37249121568).
  The real Action, with the real key, reviewed pull request #114 on the
  contributor model. It completed in 5 requests for $0.001668, and neither key
  shape appeared in the log or the artifacts. The package was an unsigned
  candidate; registry-path support still waits on LR after a release.
- **Panel polish (M87).** The owner's panel requests of 2026-10-03 (PLAN.md
  D66).
  - **A context meter** replaces the composer's "12% context": a ring that
    fills with the share of the context window used, the whole percent
    (rounded down) inside it, the warning colour from 70 % and the error
    colour from 90 %. Its name and tooltip give the tokens, the window and
    the backend's pressure word; a click still compacts.
  - **Steps fold under one summary row.** In the default view a run of two
    or more finished steps reads, for example, "Edited 2 files, ran a
    command, and read 3 files" and opens in place. A failure is named with
    its dot, a step waiting on you never folds and a running one stays
    below. Focus view folds under the same summary.
  - **Message times** on hover and keyboard focus: the time alone for
    today, otherwise the date and time, the full date in the tooltip. Muse
    Code's come from its recorded times; the Model API now stores a time
    with each message and reply (older sessions show none).
  - **Edit a queued message** from its ⋯ menu: it leaves the queue (Muse
    Code's `turn/unqueue`; the Model API's queue, or a steer no request has
    read yet) and returns to the prompt box above any draft. One that
    already reached the model stays, with a notice; a Muse Code steer's menu
    says it was delivered.
  - **A diff tally** above the goal and task panes, such as "8 files
    changed +313 −96": the conversation's edits added up, each file once.
    It is not `git diff`, so shell commands' and your own changes are not
    counted. Its **Review** opens the review pane on the same edits.
  - **The tasks pane** collapses to two lines. **Open in a tab** (or **Open
    Tasks in a Tab**) mirrors the list in a read-only editor tab that
    rebuilds after its webview reloads and says when its conversation
    closes; where VS Code has the command (its built-in
    `workbench.action.moveEditorToNewWindow`), **Move into new window**
    moves it into a window of its own. Acceptance in native VS Code is
    still open.
  - **One radial menu for the chat.** Right-click a row, press Shift+F10 or
    the Menu key, or use its one ⋯: each action is one crisp blue pill, its
    icon then its name, every pill the same size (the owner's requests of
    2026-10-04), in a fan beside the pointer or ⋯ that stays whole inside
    panels as narrow as 320 px; the pills scale in one after another. A message
    has fork and the Rewind group's second burst, queued Edit; a reply Copy
    response and Reply to this output; a restore Redo; a tool Open output;
    a landed edit Review and **Revert** (Revert asks first and is not
    offered while a turn runs; it rechecks the session and turn through
    patch loading, file preparation and every write or delete, a turn
    started meanwhile refuses it, and no send overlaps its file I/O). A
    label longer than its pill ends in an ellipsis, with the whole label
    as its name and tooltip; an unavailable note is
    the same pill, opaque, with a dimmed icon. Selected text keeps its
    Copy, Ask about this and Comment on this menu, in the same pills. Arrow
    keys, Home/End, Enter/Space and Escape work as in any menu; reduced
    motion shows the pills in place, and forced colours draws bordered
    pills.
  - **Tips** on every row of the palette and the `/` list: a skill's own
    description, or "Run the _name_ skill." for one without.
  - **Rows and the status line.** A shell row's IN and OUT are one bordered
    block, five lines each with its own Show more (your `!` rows too). The
    working line leads with a small looping circle-pattern mark (after
    Inclushe's "circle pattern animation lighten", CodePen OPWreWR, MIT,
    written fresh with no pointer tracking), then the verb, in a box as wide as
    the longest verb so nothing moves when it changes, and a heartbeat
    trace whose beam draws the P/QRS/T shape itself and leaves only a fading
    trail; under reduced motion both stand still. Stop turns red on hover
    and focus.
  - **One centred chat column** (the owner's requests of 2026-10-04). The
    transcript (queued messages and the working line included), the diff
    tally, the goal, task and schedule panes, the approval dock and the
    composer share one column, at most 760 px wide with its side gutters,
    so their edges line up at every width; a wide panel centres it, the
    transcript's scrollbar no longer shifts it, and a narrow panel keeps
    the full width.
  - **Even approval buttons.** "Always allow …" and "Allow once" are the
    same height (28 px), one line each; the fill alone tells approving from
    rejecting. A label longer than the card ends in an ellipsis with the
    full text in its tooltip, and in a narrow card the choices stack, each
    as wide as the card.
  - **A shorter model pill.** Its fill is 20 px tall instead of 26 px, the
    open-file chip's height, inside the same 26 px click target.
  - **Narrow panels.** The composer's controls stay on one row at one
    height: square icon buttons, the mode button as its icon alone, and a
    model pill that shortens. An open-file chip that no longer fits moves
    to its own row below the controls.
  - **Plural counts.** The localization gate requires `{count}` in a
    language's `one` form when it also covers an integer other than 1 in
    0–200. Seven step-summary forms each in Russian, French and Brazilian
    Portuguese now show the actual count; German forms may still omit it
    when English does.
- `npm run readme:shots` refreshes the README's screenshots from the UI
  harness: `scripts/readme-shots.json` declares each image's scenario,
  theme, size and language (`languages.png` renders `usage` in German),
  with `--list` printing the mapping and its gaps, `--only <name,...>`
  retaking some images and `--out <dir>` previewing elsewhere. The banner
  stays rendered by `scripts/render-images.mjs`.
- **Browser check** (M81, PLAN.md D49). After a web change the model can
  open a page of your local dev server in a headless browser, optionally
  click and type through up to eight steps, and read back the console
  errors and the failed requests; on the Model API backend it also sees a
  screenshot (`browser_check`). Muse Code gets the same check as text
  through the extension's `ide` server (`mcp__ide__browserCheck`),
  confirmed in the extension's own dialog before every call.
  - **The browser** is Google's Chrome for Testing headless shell, one
    version pinned by each release (154.0.8037.92, r1689415), for Windows
    x64, Linux x64 and macOS (Intel and Apple silicon). The first check asks
    before downloading it (about 100 to 120 MB from
    `storage.googleapis.com`) into the extension's storage; the new
    machine-scoped `museSpark.browserCheckRuntime` (`ask`, `download`,
    `off`) can download it without asking or turn the check off. The
    archive and the browser are checked against the pin's lengths and
    SHA-256 by a bounded ZIP reader before anything runs, and the browser
    again before each check; getting it ready has its own 15 minutes, the
    check its 60 seconds after. A pin serves for 45 days after Google
    published it; then the check refuses until an update pins a newer one,
    and the release and a weekly job fail when the pin is past that, or
    more than 14 days behind the newest Stable. A **Download Browser Check
    Runtime** command is contributed for getting it ahead of a check.
  - **Where a page may go.** All its traffic goes to the check's own proxy
    on 127.0.0.1, Chrome's loopback exception removed, the same proxy on
    the page's private context: plain `http` to this computer and to the
    hosts you widened, with sign-in challenges and credentials taken out;
    `https` and WebSockets only to a widened host, passed encrypted and
    unread (a site there may sign in with this computer's account, which
    the card and the setting now say). The browser looks up no names
    itself. The check's own tests run before, between and after the page
    in the same browser (routing, sign-in stripping, WebRTC, WebTransport,
    and a network-service restart), and any that fails returns nothing from
    the page. Over the debugging pipe, never a network port, in a fresh
    private profile deleted afterwards. Only you widen it, in the
    machine-scoped `museSpark.browserCheckExtraHosts` or on a card or in the
    dialog for one check; never the model. Every failure is one of a fixed
    set of reasons, in your language.
- The browser check ships as two bundles of its own: `dist/browserCheck.js`
  (the pipe, the run, the proxy and its tests; 50.5 KiB, budget 75 KiB),
  loaded on the first check, and `dist/browserRuntime.js` (getting and
  verifying the browser; 37.2 KiB, budget 50 KiB), loaded only to prepare
  it. Each budget is the measured size plus 15%, rounded up to 25 KiB.
  - **Refusals and Stop:** a runtime the OS refuses to run reads as blocked whether the refusal is thrown or arrives after the spawn returned; a Stop or lost admission during teardown refuses the page instead of returning its report; and the release pin gate fails a pin dated in the future, as the check itself does.
  - **Restore notes it:** a turn that ran a browser check is marked as having run a process, so restoring it says that what the page made a local server change is not undone (M86).
  - **Main integration:** browser output obeys the live permission-policy fence; best-of-N attempts have no window browser check. Widening cards retain their session choice in Bypass, and visual reads use the relocated Model API text constants.

- **What's New** (M99, PLAN.md D79). After an update, the release notes of
  recent versions since the one you had open in an editor tab ("What's New in
  Muse Spark Code"): each release's Highlights (with a **Try it** button
  where a highlight has a command or setting to try) and then its notes.
  Full notes ship for the newest two releases, plus the newest earlier
  Highlights when those releases have none; the full-changelog link covers
  older details. The generated JSON has its own hard 40 KiB raw budget.
  - **When.** Once per update, in one window only, some seconds after the
    window starts and only while no turn runs and you are not typing; the
    tab opens in the background. A patch release with no Highlights (fixes
    only) shows a quiet notification ("Muse Spark Code updated to x.y.z")
    with **What's New** and **Don't show again** instead. A fresh install
    shows nothing (the walkthrough covers new users); a downgrade or the
    same version shows nothing.
  - **Turn it off** with `museSpark.showWhatsNewOnUpdate` (machine-scoped, on
    by default) or the page's **Don't show on updates** box. **Muse Spark:
    What's New** (Command Palette, or the panel's palette under Support)
    opens the page for the current version at any time. The version you have
    seen is synced by Settings Sync, so another machine does not show it
    again.
  - **Safe and light.** The page is a webview, which every VS Code fork has,
    with a strict content security policy: no raw HTML from the notes, links
    open in your browser through VS Code, and a Try it runs only a command or
    setting the extension contributes. Its content is built from this
    CHANGELOG at build time (`dist/whatsNew.json`) and its code loads only
    when it is shown (`dist/whatsNew.js`), so startup does not grow. The
    page's words are in all 14 languages; the release notes stay English.
  - **Releases.** A minor or major release's CHANGELOG section must carry a
    `### Highlights` list of 1 to 5 bullets, or the changelog test fails
    (docs/RELEASING.md).

### Changed

- Load Account & usage, Agent map, best-of-N, history, the session board and the review pane when opened, keeping the initial chat smaller and the same controls available.
- Package compact JSON and a concise marketplace guide; retain Unreleased and the newest two releases in the bundled changelog with links to the complete documentation and history. Source translations and release history stay unchanged.
- Share the Node bundles’ validation runtime to reduce installed size without changing boundary validation.

- **A smaller package, so the browser check fits the 2200 KiB VSIX budget
  (M81, PLAN.md D6).** The macOS dictation helper is now built for size
  (`-Osize`), dead-stripped at link time and stripped of local symbols
  before it is signed (109,034 to 80,798 bytes deflated on the Mac mini;
  its disclaim check passes), and the four walkthrough images are
  recompressed losslessly (identical pixels). The budget is unchanged.
- **Tiered CI, ready for a merge queue.** The full gate now runs as parallel
  jobs:
  - the static gates on all three platforms;
  - the unit/e2e tests in four coverage shards per platform, merged before
    the unchanged thresholds apply;
  - the accessibility harness once, on Ubuntu;
  - integration on Ubuntu and Windows;
  - the macOS helper and the universal packages.

  A `merge_group` run checks the commit that will land. Once the maintainer
  turns on the queue and sets `CI_MERGE_QUEUE=on`, pull requests run only a
  fast Ubuntu tier: the static gates, the build, every test, gitleaks and
  semgrep. Until then every pull request keeps the full tier. The seven
  required check names and the release artifacts are unchanged. In a merge
  group, gitleaks runs its pinned, checksum-checked CLI, because the gitleaks
  action refuses that event.
- **The extension loads less at startup**: `dist/extension.js` is
  552.6 KiB, down from 590.6 KiB, under its unchanged 600 KiB budget
  (PLAN.md D6, 2026-10-03 and 2026-10-04). Model text that only a lazily
  loaded bundle or the ACP agent reads is no longer carried at activation
  (same words, in blocks by reader), and the window's web fetch loads with
  its own bundle, `dist/webFetch.js` (budget 75 KiB), on the first fetch; if
  it cannot load, that fetch fails with the reason ("Web fetch could not be
  loaded", in all 14 languages) and the next one tries again. The lazily
  loaded bundles shrink too (the Model API backend, the checkpoint store,
  the import, code intelligence and both reviewers by 4 to 27 KiB each).
  `npm run build` now fails when a shipped bundle carries a model-text
  block it does not read, or when `MODEL_TEXT` holds a key no source file
  of `dist/extension.js` reads; the code intelligence and web fetch
  bundles' tests check that neither carries any key or value of `MODEL_TEXT`.
- Releases reuse verified universal CI packages when the successful own-repository
  PR, merge-queue or main CI build has exactly the tag's source tree, with recorded
  SHA-256/version checks and 30-day retention; tag-push misses run the full gates.
- Manual release recovery uses the same verified staging path while preserving
  the earlier run's original bytes; invalid recovery and cancelled runs cannot publish.
- **Enhancements available out of the box (D78).** Model API observation
  packing, trusted configured hooks and per-reply usage are on by default.
  Paid images, Auto review, child agents, schedules and explicit best-of-N
  are available by default; their first use still asks with the price and
  shared daily budget. Explicit false settings stay off. Interactive extras
  share a machine-scoped $5/day cap (`paidDailyBudgetUsd`, $0.50–$500), with
  durable cross-window reservations, fail-closed storage, and a shared
  raise-for-today or stop-until-tomorrow choice. Hosted search and Muse Voice
  remain refused under a finite cap until billing bounds are verified.
  Free OS dictation stays the default (`dictationEngine`); ordinary turns
  still use one model. Repo-map prompt injection remains off pending Q11's
  paired evaluation. Tab's separate budget, Muse Code, ACP and headless
  policies are unchanged.

### Fixed

- What’s New has a localized tip in the palette and slash-command list, alongside the panel’s other actions.

- Secret prompts are redacted on their first transcript card, history replay, saved draft recovery and Markdown export (including filenames). Delayed warnings survive a later send; Send anyway resends the held text, attachments and reference while preserving newer typing.

- **Diagnostic failures redact known key/token shapes before display.**
  A shared event redactor covers both backends' failed-turn/retry reasons;
  the panel boundary also covers raw diagnostic events and notices before
  webview snapshots. MCP picker failures and voice error/close notices are
  covered, including M87 queued-edit refusals and Tasks-tab failures at the
  panel boundary. Muse Code RPC/failure logs and skill activation stdout/stderr use
  fixed kind/code/length summaries, keeping account/profile text out of
  those failure logs. Ordinary conversation and tool content stays intact.
- **Confidential workspaces block contributor dispatch after an earlier yes.**
  Every send/steer, queued/timed preparation, review and resume checks the
  current setting; checks repeat after confirmations and setup awaits.
  Configuration changes cancel and retire existing contributor sessions.
  Turning the setting off retains the panel's earlier confirmation.
- **Scanner forced-signal docs preserve the first stop.** On POSIX an earlier
  latched timeout retains exit 6 when repeated signals force cleanup; only a
  signal that latched first selects 130/143. Windows forced process exit is 1.
- **Docs, setting descriptions and panel hints now match the code** (a
  truth audit of the 0.12.0 tree). The README, PRIVACY.md, SECURITY.md,
  acp.md, ci.md, RELEASING.md, CONTRIBUTING.md, the walkthrough and the
  manifest's setting and command text no longer overstate what asks: Plan
  refuses where they said "asks", allow rules, session allowances and hooks
  settle some asks in Manual, and "Allow always in this workspace" covers
  subagents, scheduled runs, best-of-N and reviews. They name all seven paid
  features (the Auto reviewer was missing), say the ACP agent is on npm
  since 0.11.0, and give the current bundle caps, exec and scanner rules,
  release recovery run and hosted Action check status. The Modes menu's Auto
  line on the Model API names the paid Auto reviewer while it is on, and the
  panel's focus shortcuts name Cmd+Esc on macOS.
- **The panel no longer says approvals still cover everything when Muse
  Code runs without its sandbox.** Without it, Muse Code's file tools can
  write anywhere your account can, without asking, in every mode, Plan
  included (Meta's permissions page; probed on 1.4.2). This is the posture
  `museSpark.shellSandbox` at `auto` picks for a Windows workspace under
  your user profile, where the sandbox does not reliably run commands
  ([#26](https://github.com/meta-models/muse-code-sdk/issues/26): 1.4.2 ran
  them there on one machine and hung on a freshly set-up one). The panel
  now warns once per window whenever the sandbox is off, whether `auto` or
  the `off` setting turned it off; the Diagnostics report gains a
  `muse code file writes` line; the setting's description says so too.
- **The Modes menu no longer promises that Plan on Muse Code plans before
  editing.** Plan is Muse Code's `denyUnmatched`, which refuses commands its
  own allow rules do not cover and writes to `.git`, `.muse` and `.agents` but lets its file tools edit
  other files, and the menu now says that.
- **A first command after the Windows sandbox setup that fails while Muse
  Code is still preparing the sandbox** (`ACL publication lock … timed
  out`) now says to wait and try again, instead of offering the setup that
  has already run.
- **The browser check's live suite on Windows CI (M81).** CI names the
  runtime's storage `D:\a\_temp/muse-browser-storage`, and the check's
  folder comes back joined with `\`, so the suite's string-prefix check
  failed though the folder was inside the storage. It now compares by path.
  Tests only; the product is unchanged.

- **CI reliability:** Windows MCP and shell job helpers compile directly with the .NET compiler, avoiding PowerShell startup and module discovery under load; failures retain compiler diagnostics and termination details.
- What's New keeps version claims across overlapping updates, preventing
  windows on different builds from deleting each other's claim and showing
  duplicate notices. A pending notice cannot reopen its page or change the
  update setting after the window is disposed.
- A blocked M80 `v0` tag update now reports that an administrator must move it,
  while preserving the four release channels' outcomes. Updates require a
  fast-forward; the release guide documents the administrator's recovery command.
- **CI reliability: flaky tests no longer race a deadline.**
  The Model API host's fork, Auto reviewer and two-host budget tests, the
  Action's signal tests (G18) and the headless deadline test (D9) failed now
  and then on slow runners. Each now waits for the event it tests: a settled
  parent turn, a held request, published claims, the fake agent's ready
  line, a held response. Tests only; the product is unchanged.
- **CI reliability: the accessibility gate keeps each page focused.**
  Headless Chrome did not keep a window's focus, so on a loaded machine the
  `slash-commands` page's `/` menu closed while axe scanned it and was
  reported as `scrollable-region-focusable` on `:root`. Each page now runs
  with Chrome's focus emulation and is scanned only once its scenario is
  ready (a page not ready in 10 s fails); no rule or exemption changed.
  Tooling only.
- **A cancelled browser check no longer leaves its folder behind (M81).** A Stop, lost admission or the deadline while the folder is still being created now removes the folder when it finishes arriving, and a folder whose creation fails part way is removed at once; the M81 bullet already promised the profile deleted afterwards. A normal run still removes it exactly once.

- **Interactive extras preserve consent and daily Stop (D78, FIXDEF).** A
  delayed raise cannot clear another window's Stop until tomorrow. Cancelling
  budget admission refunds unsent requests and rejects late dialog answers
  and limit publication. Backend switches preserve accepted prices and
  workspace Always grants. Unused observation packing keeps the original
  request tools and cache key; recall is offered with packed observations.
  The Best-of-N overview now agrees with its default availability.

### Security

- Secret approval cards now remove workspace standing grants, redact contextual credentials across shell stage arguments, scrub reviewer fallback updates, and show the secret note when an existing card changes.
- Muse Gadgets SDK tokens (`mgst_…`) are now redacted from logs and transcripts and counted by `scan-secrets`. A valid-length prefix glued to more token characters (a trailing `-` or `-extra`) is an overlength near-miss, not a token, and is left alone.
- A prompt holding a detected secret is held before sending: the panel warns (Send anyway / Edit) and the transcript shows the redacted text either way. On the Model API backend a shell command holding one asks even in Bypass. Every emitted Muse Code approval shows its card redacted with a secret note and no standing grant; Muse Code Bypass can execute without an approval event and cannot be intercepted here. Both read the one shared detection table; the extension writes no commits, so there is no commit guard to add.

- **Other coding agents' folders and files are protected writes.** On the
  Model API backend, a write into `.claude`, `.codex`, `.cursor`, `.gemini`,
  `.github/hooks`, `.github/copilot`, `.devin`, `.windsurf`, `.kiro`,
  `.clinerules`, `.amp`, `.opencode`, `.continue` or `.roo`, or to
  `.mcp.json`, `opencode.json`, `opencode.jsonc`, `GEMINI.md`,
  `.cursorrules`, `.windsurfrules`, `.roomodes` or
  `.github/copilot-instructions.md` (like `AGENTS.md` and `CLAUDE.md`
  already), now always shows an approval card, "Edit automatically" and
  Auto included; only Bypass writes it without asking. Those folders hold
  hooks, MCP servers, plugins and settings that the other agent runs on its
  own, and the instruction files steer the next agent that reads them, so
  before this a model could plant a hook or an instruction there without a
  card and have it act the next time you started that agent in the
  workspace.
- **Muse Code's file-write approvals follow the same list.** When Muse Code
  asks before writing a file the list protects, wherever it is (outside the
  workspace too, such as `~/.claude/settings.json`), the card now says
  "Protected write", "Edit automatically" and the Auto reviewer never
  answer it, and it offers no "Always allow" rule. Before this the
  extension went only by Muse Code's own flag, and Muse Code does not flag
  these folders. Muse Code still writes some of them without asking at all
  (it wrote `.claude/settings.json` that way in a live check with its
  sandbox off); the extension cannot stop a write it is never asked
  about.

## [0.12.1] - 2026-10-04

### Changed

- **The ACP agent's npm page has a proper README**: a banner, badges, a
  short pitch, install, a quick start for Zed, JetBrains, Neovim, Emacs and
  JupyterLab, headless `exec` and the GitHub Action, backends and cost,
  privacy, and links, all with absolute links. The detailed guide stays at
  `docs/acp.md`. The package also gets a clearer description, editor
  keywords, the repository homepage and the donate link.

### Fixed

- **A release can no longer lose its CHANGELOG section.** 0.12.0's first
  release run passed every check and then stopped, because the CHANGELOG at
  its tag had no `[0.12.0]` section (a merge dropped the heading). A test
  now fails any change whose `package.json` version has no
  `## [x.y.z]` section, so a release PR catches it in minutes; a release
  run can also publish an earlier run's tested packages without rebuilding.

## [0.12.0] - 2026-10-04

### Added

- **Auto rules, permission profiles and an optional paid reviewer (M78).**
  Standing command rules include executable examples; repository rules only
  tighten them. Complex commands ask, native language-service reads obey file
  denials, and malformed profiles deny access. Files a profile hides spend
  none of the repo map's 1,000-file cap: it reads on to readable files.
  Reviewer consent binds account,
  model, turn and policy, uses its own M82 claim, and falls back to asking on
  failure or its circuit breaker. It cannot allow a forbid, an ask rule,
  a protected write or another paid call. Attempt editors stay rooted in their
  worktree; applying a selected snapshot invalidates the original check ledger.
  - **A settings change reaches calls already in flight.** Whatever any tool
    brings back, an MCP or IDE tool's included, is judged again under the
    current rules, profile, mode and workspace trust just before it reaches
    the model. A call they no longer allow is refused with a reason in the
    user's language and nothing from it is sent; a change it had already
    written stays, and its row says so. Output that may quote files it
    cannot list (a shell command's, an MCP or IDE tool's, a check's, a
    subagent's) is refused if any file rule, the profile or the trust
    changed at all while the call ran, and a subagent's result is withheld
    if they changed since it started, after a restart too. A shell command
    is judged again at its process's entry, a memory note at its write, and
    an image edit's sources right before the request leaves the machine, so
    a source denied meanwhile is never sent and nothing is billed.
    `read_skill` refuses a project skill the file rules deny, and a Stop
    during a memory read or write, its index line included, ends the call
    as a stop, not a file error.
  - Approval cards retain the Auto reviewer's and command rule's explanation
    through webview delivery, later approval stages and saved-state restoration.
  - **Automatic checks respect revoked file access.** A verification round keeps
    the original edited-file policy fence even after denied files are filtered
    out of lookup. It withholds diagnostics and refuses checks after revocation.
- **Awareness and budgets** (M82, PLAN.md D49).
  - While the VS Code window is unfocused, a VS Code notification says when
    a turn of a minute or more ends, or a turn waits for your approval or
    answer, with **Show conversation**; nothing shows while the window is
    focused, and two panels on one conversation raise it once. Off with
    `museSpark.notifyOnBackgroundTurn`.
  - On the Model API, `museSpark.modelApiReplyUsage` (off by default) prints
    the tokens and dollar estimate under each reply, counting every request
    since the previous line in that turn. Muse Code reports no per-reply
    totals, so its replies carry none. The dollar amount is labeled
    estimated, including the unverified tier fallback for unfamiliar models.
  - The machine-scoped `museSpark.modelApiSessionBudgetUsd` caps what each
    Model API conversation may spend. Each request's input is estimated high
    (the last reported input plus what was added since, one token per byte)
    and `max_output_tokens` is lowered so it fits what is left; a request
    that cannot fit is not sent and the turn says why. Each request is
    priced at the model it was sent to, and the spend is saved as it is
    spent, even while a call waits for approval. Shared durable liabilities
    cover hosts reopening the same conversation, ordinary requests and known
    image fees. Unknown sent usage retains its whole reservation;
    ambiguous failures cannot retry under that same allowance while capped.
    Hosted search is unavailable with a cap until its billed query bound is
    verified; cap-off search keeps its paid consent. A model with no published price
    is refused while a cap is set. The transcript shows each turn's cost
    against the cap, and warns when a reply used all the output it was left.
  - Account & usage shows what the prompt cache saved in dollars. Its value
    (`usageCacheSavingsValue`) is a pre-formatted amount and percentage, so
    the localization gate lets it stay the same in every language.
  - **Voice Stop remains available after a cap or paid setting changes.** It
    reaches the recording's existing driver instead of applying new-recording
    availability. Child requests retain separate consent and ceilings; reported
    cost is counted without reserving against the parent's cap, as decided for
    M82. The setting and guide name that possible overrun in every language.
  - **Model API session budgets retain their open reservation before a
    response arrives.** Capped requests await a durable reservation write
    before fetch and recheck final admission afterward; failed writes or
    unavailable storage send no request. A stopped or superseded nonsent
    request releases its reservation. Switching a model away and back, or
    changing it during compacted-context counting, cannot restore a stale
    budget base. Stored usage and reply costs refuse negative values,
    overflowing usage reports are ignored, and token-count failures log a
    status and fixed words instead of network text.
    Stale session saves cannot lower the shared journal's spend, and crashes
    retain unsettled claims. Unverified historical spending refuses a cap
    rather than treating unknown amounts as zero. All new reasons and the
    revised setting description are localized.
    Shared uncapped requests publish pending uncertainty before HTTP, so a
    capped host cannot admit around an unresolved earlier request. Verified
    known usage clears that uncertainty; unknown tariffs or earlier ambiguous
    retry attempts remain unknown despite a successful final response.
    Fresh forks and side chats retain copied paid and closed-child history
    while starting their own spend at verified zero; their first own request
    is charged only to the new conversation.
    Attempt observers run only after final admission and request building,
    adjacent to fetch; Stop or confirmation refusal after preflight leaves
    the request uncounted and refunds its known nonsent reservation.
    Paid Muse Voice on the Model API backend is unavailable with a finite
    cap. Uncapped shared recordings publish uncertainty before authentication
    and fence the actual account and parent context before sends. Local audio
    duration remains an estimate without a server billing receipt; CLI voice
    and free system dictation retain their behavior.
    Cap-off Model API voice also remains available without a folder or
    journal, with its original consent account/context fenced before every
    send. A later finite cap stops authentication, audio and end sends;
    unshared window usage remains an estimate.
- **Session board and best-of-N** (M77, PLAN.md D49). The header's board
  button lists every conversation open in the window, on either backend, and
  the saved conversations of the backend the window runs on, with its
  state, branch, changed files and waiting approvals; typing filters and
  Enter resumes. The board queries the known worktree roots and includes the
  attempts of a running best-of-N. Its git reads run as the prompt's git
  facts do: opening it starts no fsmonitor, filter or other program a
  repository configures, in any mode, and takes no index lock.
  - Best-of-N runs the same prompt in 2 to 5 worktrees at once on the Model
    API backend, behind the new off-by-default, machine-scoped
    `museSpark.modelApiBestOfN` setting: one paid-use popup per run names the
    prompt, the published token rates, the attempt count and the per-attempt
    request ceiling, and the subscription never pays. Each attempt works on
    its own `best-of-n/<run>/<index>` branch; attempts that would ask are
    declined and counted. Attempts run no shell command and no configured
    check, in any mode, Bypass included: a working folder confines no
    process. **Open** appears only for an attempt whose worktree was made.
    Needs a trusted workspace with a folder open. The
    form stays open after **Start** until the run begins, so a start that is
    refused keeps its prompt and numbers beside the reason, ready to retry.
  - Successful attempts compare side by side, and **Apply and stage** takes
    only that attempt's immutable preview: its uncommitted tracked and
    unignored new files, binary changes included, applied and staged as exact
    bytes, with no project commit. A failed, cancelled or unreadable attempt
    cannot be selected; fresh checkout, editor, ownership and path checks
    refuse a changed or linked target.
  - The run reserves its window owner before the paid popup and rechecks
    context and account after it; actual HTTP tries and retries are counted at
    the final key-read boundary, and every attempt host binds the M82 parent
    journal, so a finite session budget refuses when that scope is
    unavailable. Account & usage shows reported attempt tokens and cost
    separately, with unreported requests marked unknown. Automatic Git
    operations run with no hooks, fsmonitor or maintenance and refuse a
    repository that configures filters or hook commands.
  - Strings ship in all 14 UI and manifest tables.
  - A missing or damaged board/best-of-N bundle gives a translated refusal
    with reinstall guidance; its cause goes to the log. Closing the panel
    during the first best-of-N load suppresses stale failure notices.
- Defer the session board and best-of-N execution to their first action, and
  Auto reviewer execution until paid consent. Each loads its own bundle with
  the installed language, retaining current policy and budget admission.
  Their new 75 KiB caps use measured size plus 15%, rounded up to 25 KiB.
  The activation cap stays 600 KiB. The Model API cap is revisited, as M57
  planned, to 475 KiB (402.8 KiB measured, by the same rule; PLAN.md Q-M78b).
- **Headless runs and a GitHub Action** (M80, PLAN.md D65):
  `muse-spark-code-acp exec` runs one turn on a workspace without an editor.
  The prompt comes as an argument, from `--prompt-file` or from stdin, with
  up to eight `--untrusted-file` inputs marked as untrusted data. Plan is the
  default and Accept edits the only other mode; workspace trust, bypass and
  hosted web search are refused, every approval request is denied and every
  question declined, and a Model API run starts no shell, check, hook, MCP,
  Git or web-fetch process. Output is plain text, one JSON result or JSONL
  events; the exit code names the outcome (0 completed, 2 usage, 3 sign-in,
  4 failed, 5 budget or request cap, 6 timeout, 7 denied, 8 incomplete,
  9 accounting unverified, 130/143 interrupted). Tool output text never
  leaves exec, and a reply cut short is withheld whole. On Windows a forced
  stop exits 1 and may lose buffered output.
  - **Budgets and refusals:** the Model API needs `--max-budget-usd` (up to
    $20, six decimals) and caps billable requests with `--max-requests`
    (every attempt, retries included). Each request reserves the most its
    context window could cost before it is sent: at least $0.108135 on the
    contributor model and $1.409024 on standard, one cent more with images.
    A request whose cost is lost or uncertain keeps its whole reservation,
    and a budget below the minimum is refused before any billable call.
    Images need `--image-generation` with Accept edits and are tallied per use.
  - **Keys:** a local run uses the key in your OS credential store;
    `--key-stdin` reads one line from a pipe and keeps it in memory only.
    No environment variable is read. Every output removes the run's exact key
    first, also in its percent-encoded form, then known token shapes.
  - **Results and schemas:** the result and events are versioned (v1) and
    validated, and their JSON Schemas ship in the package's `schemas/`;
    `npm run schema:exec` regenerates them. `muse-spark-code-acp
    scan-secrets <file>` counts likely secrets in one file and prints only
    the number.
  - **The Action:** `action/` reviews, or proposes a fix for, a
    same-repository pull request on GitHub-hosted runners (a private
    repository may also use a self-hosted one, with a warning) under the
    same hard budget. Forks, bots, `pull_request_target` and commenters
    outside the repository's members are refused before anything is
    installed; the agent
    is installed before checkout and verified against its npm provenance (a
    candidate tarball is pinned by digest and labelled unsigned); the key
    reaches only exec and the secret scanner, over stdin. It posts one sticky
    review comment within GitHub's size limit and uploads the validated
    result; a fix is published as a patch only after a clean secret scan of
    its exact bytes, and any binary change (a generated image included) or
    detected secret withholds the whole patch. A stopped or failed run
    publishes nothing. `action/apply` applies the patch for your own
    secret-free tests, then pushes it after maintainer approval with a lease
    on the exact reviewed head, refusing an unexpected or oversized artifact.
    Every Git step runs with no hooks, filters, fsmonitor, signer or
    credential helper, and refuses any repository configuration a fresh
    clone does not carry. It installs the agent from npm with its
    provenance checked, or a pinned candidate tarball.
  - Acceptance on hosted runners and with a real key is still pending.
- **Bundled workflow assets (M89 vendor lane).** Ship the byte-exact
  high-quality-projects-skill v0.7.0 workflows, shared helpers, templates and
  top-level documentation under their MIT licence. A checksum-verified sync
  script records the pinned archive and each file's SHA-256 (the tests check
  every vendored file against it), and refuses archives whose names collide
  by case or by trailing dots and spaces; packaging includes
  the assets and third-party notices. Formatting, linting and pre-commit
  checks preserve vendored bytes. Backend discovery and installation are
  covered by the other M89 lanes.
- **Bundled skills** (M89, PLAN.md D68): the high-quality-projects
  workflows `project_setup`, `feature_delivery` and `quality_retrofit` ship
  with the extension. On the Model API backend they are a third skill
  source after the project's and your own (a skill of yours with the same id
  wins), and the model reads each after one line naming its package root,
  the skill's `SKILL_ROOT`. For Muse Code, **Muse Spark: Install Bundled
  Skills for Muse Code** copies the package to
  `<config home>/muse/skill-sources/high-quality-projects-skill/`, marks the
  copy, and links each skill into `<config home>/muse/skills/` (junctions on
  Windows, directory symlinks elsewhere); a skill of yours with the same
  name is left alone and named. The first Muse Code conversation offers it
  once (Install / Not now, remembered), a newer vendored release offers
  Update once, and **Remove Bundled Skills from Muse Code** removes only the
  marked copy and the links into it. `museSpark.bundledSkills` (on by
  default, machine-scoped) turns off the Model API source and the offer; an
  installed Muse Code copy stays until Remove, and the Model API backend,
  which reads the same personal skills folder, lists it as your own skills
  meanwhile. The installer is its own lazily
  loaded bundle, `dist/bundledSkills.js` (22.6 KiB; budget 50 KiB in
  PLAN.md D6), so `dist/extension.js` grows by 4.8 KiB (576.8 to 581.6 KiB).
  Strings in all 14 languages.
- **A reviewer for Auto on Muse Code (M90, PLAN.md D69).** In Auto on the
  Muse Code backend, an eligible approval Muse Code raises for the running
  turn that no rule settles goes
  to a reviewer before it reaches you: the Model API backend's Auto
  reviewer (its instructions, its input marked as data, its strict
  ALLOW/ASK answer and its breaker), run as one short turn of a hidden side
  session in the same `muse serve`, on your Muse subscription. The side
  session runs in Plan mode with thinking off, on the conversation's model,
  in an empty folder under the extension's global storage, so it reads none
  of your workspace files, rules or skills in the captured setup (CLI-global
  context is not excluded) and History never lists it; it is started again
  after Muse Code exits, restarts or closes it, after a timeout, busy fallback
  or tool activity, for another model, and every ten reviews. Native tools
  cannot be disabled through the SDK: any item other than the prompt's echo,
  Muse Code's reminder agents, reasoning or the reply cancels the review and
  shows the generic failure card. A
  command covered by an always-allow rule could run in the empty folder
  before cancellation lands. On
  ALLOW the approval is answered *Allow once* (never an "always" choice) for
  each stage while subject and user request stay the same, and the tool row says "Decided: approved (Auto
  reviewer)" with its reason; on ASK, an unreadable answer, no answer
  within 45 seconds, an error, a busy side session or a tripped breaker,
  the card asks you as before, with the reason on it when there is one. It
  never answers a protected write, a paid call, a child task, a question,
  a replayed or escalated request, an unknown subject, a request without
  allow-once, a session shared by panels, or anything in another mode;
  one review runs at a time
  in a window. On by default with the machine-scoped
  `museSpark.museCodeAutoReviewer`; the window's first review says what it
  does and costs (one short Muse Code turn: four model attempts in the live
  check). Changed subjects, accepted messages and steering invalidate old
  verdicts; queued jobs recheck the breaker, setup shares the 45-second
  deadline and cancellation, and only a completed reply in a completed
  turn may allow. Attribution survives resolution before the tool row
  (the newest 50 unseen item ids). It loads on the first review from
  `dist/museCodeReviewer.js`, within its unchanged 75 KiB budget; activation
  remains within 600 KiB.
- **Review** (M70, PLAN.md D49), on both backends:
  - `/review` reviews the uncommitted changes; `/review branch [base]` the
    branch against its base, `/review commit [revision]` one commit (a
    picker asks when you leave either out), `/review <what to look at>`
    anything you describe, with no git. `security` first, or **Security
    review** (`/security-review`), looks for injection, secrets,
    authentication and unsafe APIs. The palette's new **Review** group has
    each preset.
  - Git's changes go with the review marked as untrusted data, files that
    may hold secrets left out and only named; in Restricted Mode the git
    presets say why they cannot run.
  - On the Model API the review runs as the built-in **Reviewer**: its own
    prompt and tools that only read, in every permission mode, and no
    extra charge (it is your own turn). The model can start it as a paid
    subagent with the role `reviewer` (a custom agent it names instead runs
    as that agent). On Muse Code the review turn runs in
    Plan mode and your permission mode comes back when it ends; Muse Code's
    own allow rules still apply in Plan mode, so that review is not claimed
    strictly read-only.
  - Findings end the reply as a list with severity, file and line; each
    location opens its file there.
  - **The review pane** (`/changes`): every change this conversation made,
    hunk by hunk, with **Accept**, **Revert** (that one hunk only, as the
    file is now) and **Comment on a line**, which sends your comment with
    the lines around it into the running turn or as your next message.
  - A review is a turn: it is marked running and takes its turn checkpoint
    like a message, and a message you send while a review is starting waits
    for it and then goes into the review turn. Clearing the conversation
    while a review is still starting lets the new conversation's review or
    message start at once.
  - 70 new strings in the 14 tables (the word for review in Simplified
    Chinese is the table's existing 审阅).
  - **It loads on first use** (M70, PLAN.md D6). Git's material, the
    review turn's text, the Plan-mode hold and edit review (Open diff and
    Revert) are the new `dist/review.js` (43.1 KiB, budget 50), required the
    first time one is used; a module that cannot be loaded refuses the review
    with `reviewUnavailable` and the log has the cause.

### Changed

- **The shared English text bundle's budget is 125 KiB** (PLAN.md D6), up
  from 100 KiB: new strings bring `dist/uiText.js` to 100.2 KiB; the new
  budget is that plus 15 %, rounded up to 25 KiB. It loads lazily, so
  activation is unchanged.
- **The release package's size budget is 2200 KiB** (PLAN.md D6), up from
  1850 KiB: the cohort's four lazily loaded bundles bring the universal VSIX
  to 1,938,910 bytes; the new budget is that plus 15 %, rounded up to 25 KiB.
- **Code intelligence and voice load on first use** (PLAN.md D6). Muse
  Code's `ide` code intelligence answers and both voice engines' drivers now
  ship as `dist/codeIntel.js` and `dist/voice.js`, required on the first
  call and the first recording, so `dist/extension.js` goes from 603.3 to
  568.7 KiB under its unchanged 600 KiB budget (new budgets 100 and 50 KiB).
  Nothing changes in use. With a damaged install a code intelligence call
  answers with an error result saying so, and a recording fails with
  "Voice dictation failed" and reinstall guidance in every UI language; the
  log has the cause, and the next call or press tries again.
- Regenerate the host API inventory and bundled-package notices from the
  combined import, session board, reviewer, budget and handoff source.
- The host API compatibility record is regenerated from the combined source.

### Fixed

- **The ACP agent is on npm.** `muse-spark-code-acp` 0.11.0 reached npm on
  2026-10-04, and releases from 0.12.0 publish there by npm trusted
  publishing (OIDC from `release.yml`), with no stored npm token. Before
  that every release's npm step failed: 0.10.0 on a path bug, 0.10.1 and
  0.11.0 because the token could not bypass the account's 2FA (`EOTP`).
- Edit rows no longer load their diffs while a turn runs on Muse Code (0.11.0): a long turn's reads queued past 60 s and held up approvals. A row loads when you open it or once the turn ends, which also retries a read that failed.
- Two windows starting turn checkpoints in one conversation at once no longer fail when one briefly holds the other's lock (0.11.0).
- Windows commands retry job helper preparation after a failed first build or self-test instead of keeping the fallback for the whole session (0.11.0).
- **The Modes menu no longer promises a safety check Muse Code does not run
  (0.11.0, PLAN.md D69).** Auto on Muse Code read "Muse will approve actions
  that pass a safety check and pause for anything risky", but `muse serve`
  has no approval judge: Auto skipped only the commands the CLI classifies
  as simple, and every script asked. Each mode now says what it does on
  each backend: on Muse Code, Edit automatically is Manual, and Auto is
  Muse Code's own skip of simple commands plus the new reviewer while it is
  on (README "Permission modes", PLAN.md D7's correction).
- **Revert on an edit no longer overwrites your saved or unsaved changes**.
  Edit review's Revert and the pane's hunk Revert are one step under the
  turn checkpoints' file-edit lease: they read the saved file, rebuild the
  pre-edit text from it, check that the path still leads to the same file
  inside the workspace and that no editor has unsaved changes for it (the
  file itself or a link to it), then write the file, or move a file Muse
  created to the trash, only while it still holds what was read, with no
  link or junction on the way. A save, an editor turning dirty or a folder
  swapped for a link meanwhile makes Revert refuse and say why instead of
  overwriting. Reverts of one file run in order and rebuild from each
  other's bytes; a failed write frees the next one, and a Revert that wrote
  stays done when releasing the lease fails afterwards (the log says so),
  so it is not offered again. They tell live verification about the write
  without creating an edit round of the agent's own.
- A handoff brief that arrives while the review pane is open waits until
  the pane closes, preserving one modal and one focus trap at a time.
- The Reviewer retains whole tool observations when observation packing is
  enabled, because its read-only tools cannot recall packed output. The
  next ordinary request still uses the same packed placeholder.
- **The `/` and `@` lists keep the highlighted row in view.** The arrow
  keys move through a list taller than its menu, and the list now scrolls
  to the row they reach instead of highlighting one out of sight.

## [0.11.0] - 2026-10-03

### Added

- **Turn checkpoints (M86).** On by default again, with restore rebuilt on
  the model's own file-tool writes while each file still holds exactly
  what the model left. Commands, hooks, MCP tools or background work active
  in those turns are noted; their file changes are never undone. Workspace
  captures and ignored-file scans are removed. Restore and Redo refuse
  replaced workspace roots, swapped junctions, dirty editor aliases and
  incomplete later transcripts. Durable recovery inputs survive unreadable
  records; applied batches keep their results and Redo after lost outcomes.
  Retention releases old units by sequence and sweeps every unreferenced
  content copy, including failed writes without an intent, after a one-hour
  grace period with no live writer. Bounded passes resume next time.
  One CAS lease manager recovers abandoned cleanup reservations before ordinary
  sends, trusted startup, cleanup and restore, preserving live and uncertain
  owners. One BigInt identity module protects copies, reservations, publication,
  cleanup and workspace fences; ESLint rejects identity reads elsewhere. Children keep
  their inherited recording decision across reloads, and folder cleanup
  uses actual creation ownership. Imports from other agents keep their edit
  and storage guards while remaining outside the model's recorder.
  Identity metadata without file contents may outlive retired copies until
  the window that wrote it retires; removing extension storage clears it.
- **Import from Claude Code, Codex and Cursor** (M83, PLAN.md D49, D64):
  commands become skills, compatible agents become M76 agent files, project
  rules append to `AGENTS.md`, and MCP servers/hooks open as unsaved target
  editor edits for review and save. Import preserves source exposure:
  personal stays personal and git-ignored files never enter tracked targets;
  target exposure and path guards are checked again at publication/edit.
  Values stay unchanged; no credential detector or clipboard operation.
  Preview/picker output shows names, scopes and targets only, logs counts
  and fixed reasons only. Only active MCP transport fields are copied;
  inactive/unknown fields are dropped by name. Existing files and running
  turn checkpoint ownership remain protected. Codex TOML uses `smol-toml`
  1.8.0 in the existing lazy importer bundle. Lead certification pending.
- **Session export, import and share** (M84, PLAN.md D49): **Export
  session as JSON…** writes a portable file on either backend. Credentials
  of a known shape and the key digest are always scrubbed, from every
  string including item ids and error labels (a secret in any other shape
  is not recognised); paths (your own folders included, spaces and all,
  and any other absolute path in any script) and account ids are redacted
  by default, and the redacted file opens read-only in the editor before
  anything is written. The scrub runs in slices of about 64 KiB, a long
  message cut only between lines no credential runs across, and the window
  keeps working between them; a single line longer than a slice is still
  scrubbed in one go (about half a second for 16 MiB). **Muse Spark: Import
  Session** resumes such a file as a new conversation on the Model API
  backend, on your own model, in Manual (or Plan when that is the initial
  mode) every time it is opened, forked or restored, with no session rules,
  goals, schedules, todos or patches; the model reads each imported turn as
  untrusted data, a plan written in such a conversation is implemented in
  Manual (or Plan) as a plan file is, and its code blocks offer Copy only
  (no Insert or Apply). A file whose turns are more text than a
  conversation can start with (786.4 kB, counted as one token a byte) is
  refused before the import is confirmed, naming both sizes. The ACP agent applies the same start to a stored session
  marked imported before it advertises a mode or replays history. **Muse
  Spark: Open Share File** reads such a file read-only in the panel (Copy
  and links only), 200 items at a time with Show more; an item that cannot
  be rendered says so in its place. At 320 px, its controls and scrollable
  code are reachable by keyboard with the VS Code focus border; Escape
  closes it and returns focus to the composer. Every imported byte is checked: at most 16 MiB, read
  through one bounded descriptor of a local file (other file providers are
  refused), the format and its version, and no unknown field; a refusal
  never quotes the file. Nothing is uploaded: sharing is a file on your
  disk.
- **Observation packing, off by default** (M73, PLAN.md D49;
  `museSpark.modelApiObservationPacking`, machine-scoped). On the Model
  API backend, a tool output over 8,000 characters rides whole for two
  requests, then as a short placeholder (its id, size, and first and last
  lines) that stays the same on every later request, so the prompt cache
  breaks once per output; `recall_output(id, offset)` pages the original
  back, and the conversation itself always keeps the whole output.
  Account & usage shows the estimated tokens saved. A conversation reads
  the setting when it starts or is reopened. The evaluation gains the
  `packing` arm and two long-output tasks (twelve tasks: seven accept,
  five held-out), and a packing run passes only if it packed on each
  long-output task. Its M75 run passed before the setting was added: both
  arms 7/7 accept and 5/5 held-out against the 0.75 floors, packing
  engaged on both long-output tasks (39% fewer input tokens there, about
  the same cost), 111 model calls for $0.0156 in all
  (`docs/certification/m73-run.md`). The Evidence-Preserving Reducer is
  not built (PLAN.md §3).
  - **A recalled page is untrusted tool data.** Each page names the tool
    that returned it and comes with the untrusted-data notice, between
    fresh random markers around the unchanged slice, so a page from the
    middle of a fetched web page keeps its boundary.
  - **The savings ledger survives a resume.** A saved conversation keeps
    its total; one saved before the total was kept resumes at zero. A
    corrupt stored total is ignored: the conversation still loads, and
    packing restarts its ledger at zero.
  - **The recall row speaks the display language.** Its heading and its
    refusals are in the installed language, with counts in its number
    format; the recalled text is shown as it was, and the model's text
    stays English.
    An unknown recall id names at most the last eight packed ids, plus
    the number omitted, keeping the model's error bounded in long sessions.
  - **The live report records the packing acceptance.** The report says
    whether packing engaged on each long-output task, and a run that holds
    the floors without packing is recorded as failed in both its JSON and
    its Markdown.
- **Handoff to a new conversation** (M74, PLAN.md D49). `/handoff`,
  optionally with a goal after it, asks the model — as your own turn in the
  current conversation — for a distilled brief: the goal, the decisions,
  the files touched, the open work and the todo list. Anything drawn from
  tool output, fetched pages or imported files is marked `[untrusted]` in
  the brief, and the new conversation is told what that means. The brief
  opens in a dialog before anything starts, with the open items the new
  todo list will hold: review it, edit it, then start the new
  conversation, or cancel and nothing starts; a reloaded panel shows it
  again, and a brief that is ready while Account & usage, the Agent map or a share file
  is open waits until you close it. Starting leaves the old conversation
  in History and seeds the new one through the plan brief path, with the
  open items (never completed or dropped ones) as its todo list before
  the first request. The model wrote the brief, so the new conversation
  starts in your starting mode only when the dialog showed all of it: a
  brief or an item holding a character the dialog does not show (a
  direction override, a zero-width character) starts in a mode that asks,
  and the panel says so. A handoff from Plan mode stays in Plan. Model API
  backend only (on Muse Code the command says it is unavailable there).
  Side chats are refused; one handoff runs at a time; a `/handoff` while a
  reply runs is refused ("Wait for the reply to finish, or stop it,
  first."), nothing queued; an oversized (over 256 KB) or empty brief is
  refused with the reason; a refused `/handoff` stays in the prompt with
  its goal. While a new API key is being activated, a Start is refused
  before anything is left and the brief stays to start again, Cancel
  still works, and a deferred brief read says why and retries when sign-in
  or key activation completes, including a read that failed while admission
  was held. Start shares the plan actions' operation lock: either refuses
  while the other runs. A composer send during distillation is refused,
  keeping its exact draft and images without replacing newer typing.
  No new setting: nothing automatic runs. Automatic
  compaction, the hidden follow-up and memory flush stay unbuilt and off.
- **Custom agents on the Model API backend** (M76, PLAN.md D49): specialised
  agents with their own prompt, tools, model or effort, and permissions. The
  model runs one through `subagent_spawn` with `agent` set to its id, and the
  run is a paid child task like any subagent (asks in the paid-use popup,
  off unless paid subagents are on, refused in Plan). The extension ships
  `explore` (read-only reconnaissance) and `second-opinion` (a high-effort
  consult); your own are `.agents/agents/<id>/AGENT.md` in the workspace or
  `~/.config/muse/agents/<id>/AGENT.md` (`$XDG_CONFIG_HOME/muse/agents` when
  set), with front matter (`name`, `description`; optional `tools` as a
  comma-separated allowlist, `model`, `effort`, `permission-mode`) above a
  Markdown prompt. The CLI names no agent folder, so the folder is this
  extension's own (PLAN.md D13). On the CLI backend Muse Code reads its own
  agents. The paired evaluator keeps its isolated defaults: no personal
  agents and no paid child tasks.
- **What a custom agent may do.** An agent can only narrow the session: its
  tool list binds every call (memory tools included), automatic check commands
  need `run_checks` or the shell in it and `then_run`, which runs any
  command line, needs the shell, and a mode switch keeps its ceiling. Its
  `permission-mode` applies as far as your mode allows: under Manual every
  child asks, a Manual agent always asks, and an Edit automatically agent
  writes without a card under Edit automatically, Auto and Bypass
  permissions (a protected write still asks). A model it names
  passes the checks of your own choice: contributor models are blocked in a
  confidential workspace and otherwise ask once for each spawn (and for a
  follow-up this session was never given the yes for), and a model other
  than the session's asks in the paid-use popup even when subagents are
  allowed always in the workspace. A spawn is checked again after each
  question it asks, so no popup follows one that can no longer run (trust
  withdrawn, the workspace turned confidential), and a retry under the same
  `command_id` answers with its child even if a new one could not start now.
- **Agent files are untrusted input.** A file is read only up to 64 KB and only
  when it is a regular file; a skill file gets the same cap. Front matter
  the reader cannot take whole (a YAML list, an indented value, a repeated
  key, a `tools` line that names no tool) skips the file with a log line
  instead of reading as "every tool"; names, descriptions and models are
  bounded and free of control and direction characters; at most 32 agent
  files load. A repository's files load only in a trusted workspace, no agent
  is offered once it stops being trusted, and a child's role is labelled with
  its source and sits below the workspace rules that outrank it. Each agent
  folder loads on its own: one that cannot be read is logged by name and
  the others still load, and an agent it, or a file in it that was skipped,
  might define is refused by name rather than replaced by a broader personal
  or built-in agent of the same id.

### Changed

- **Approval cards are docked above the message box** while they wait,
  as in Claude Code's panel, so scrolling never loses one.
  - The tool's row in the conversation keeps a short "Waiting for your
    approval" line, then shows the decision.
  - With several waiting, the oldest is docked (the order Muse asked) with
    "Approvals waiting: N"; each moves up as the one before is settled.
  - Focus moves to an arriving card itself, not onto a choice. A field you
    are typing in (one holding text, or a key in the last 1.5 s) keeps
    focus, and the panel's live region announces the card either way.
  - Behind a dialog the dock is inert. It scrolls on its own at 45% of the
    panel's height and wraps a long command at 320 px.
  - The accessibility gate checks it in the four themes in new scenarios:
    several cards, 320 px, and a step that moved on.
- README: an install guide for the most used editors (VS Code, Cursor,
  Windsurf/Devin Desktop, VSCodium, Kiro, Positron, JetBrains IDEs, Zed,
  Neovim, Emacs), with the ACP agent's install command and Zed and JetBrains
  settings; the README, banner and social preview now name no single editor
  ("a coding agent in your editor"), and the README links every channel:
  the VS Code Marketplace, Open VSX, npm and GitHub Releases.
- Upgrade `html-encoding-sniffer` to 7.0.0 while preserving HTML's byte-order-mark
  and HTTP-header priority. XML declarations and BOM-less UTF-16 signatures stay
  tentative; HTML meta declarations still win or trigger a later reparse. Valid
  transport encodings without a runtime decoder remain explicit errors. Version
  7 declares Node 22.13 or later, but the page worker bundles it: the shipped
  bundle loads and converts pages in VS Code 1.99.0 (Node 20.18.3, the
  extension's floor), now in the integration run's `minimum` label too
  (`docs/certification/pr60-sniffer7.md`).
- The dependency audit accepts GHSA-vfj7-8cjw-p6xm (`braces`, high) until
  2026-11-01. No fixed release exists, and `braces` reaches only development
  tools (stylelint, and secretlint under `vsce` and `ovsx`); nothing in the
  VSIX or the ACP package loads it. The exception is removed when a fix ships
  or npm stops reporting it (PLAN §7).
- Take the compatible development updates from the grouped Dependabot pull
  request: ACP SDK 1.5.0, jsdom 30.1.1 and Prettier 3.9.9. Its TypeScript
  7.0.2 is left out: typescript-eslint 8.70.1 accepts only `<6.1.0`, so
  TypeScript stays at 6.0.3 and Dependabot now ignores its major updates
  until typescript-eslint admits 7. The SDK is bundled into the ACP agent
  alone; no file of the extension changes.
- A skill file over its 64 KB cap is now refused before it is read whole, so
  its log line says "is over the 65536 byte limit" without the file's size.

### Fixed

- Staged file writes and plan-stage cleanup compare exact device/inode IDs,
  preventing rounded Windows file IDs from accepting or removing a replacement.
- **Approval decisions and recovery (PR #90, D26):** simultaneous panels
  share one decision's eventual result, so a confirmed refusal unlocks
  both. Stop waits for an in-flight decision and rejects the next waiting
  stage before cancelling. A fault's Restart now stops only Muse Code;
  Model API conversations continue. Recovery buttons retire on first use
  and remain retired in restored panels. The approval dock count uses
  localized plural forms in every display language.
- Muse Code 1.4.2 no longer logs a schema fingerprint mismatch at every start.
- Web fetch decodes a windows-1252 page by the Encoding standard's table on
  every Node. Node 20.18 (VS Code 1.99's) decodes windows-1252 as ISO-8859-1,
  so the euro sign, curly quotes and dashes of a page in that encoding (and of
  every `latin1`, `iso-8859-1` and `us-ascii` page, which the standard reads as
  windows-1252) came out as invisible control characters there.
- **The log redacts more credential shapes.** The output channel's
  redactor (`src/core/redact.ts`) also removes GitHub, GitLab, npm, Google
  API and Slack tokens, AWS access key ids and `~/.aws/credentials` lines
  (in any case), an Azure connection string's `AccountKey=`, `.npmrc`'s
  `_authToken=`, PEM private keys, `sk-` style keys and secrets named by an
  upper-case variable, a header, a JSON field or a URL parameter.
- **A long dotted line no longer stalls the log.** The redactor's URL
  credentials pattern took quadratic time on a long run such as `a.b.c.…`;
  its scheme is now bounded. Text with none of the credential literals
  (most log lines) now skips the patterns in one scan.
- **A conversation no longer opens while the Model API backend closes or
  after you sign out, and an overtaken side chat leaves no Plan mode.**
  Starting, resuming or forking a conversation loaded the hooks, then made
  the session and ran its SessionStart hook without checking again that
  the backend was not closing (or, when resuming, that you were still
  signed in). Both are checked now, before the session exists and again
  after its SessionStart hook. And a side chat whose opening another
  opening overtook (a second conversation opened before the first had
  loaded) still switched the panel to Plan; only the opening that lands
  sets the mode now.
- **A `/goal` refused while a Model API key is activated no longer
  sticks.** While a key was being activated, with the panel still reading
  signed in, a `/goal …` from the prompt or a goal edit was refused with
  only a notice and never answered, so the panel kept waiting for it:
  Enter on the same command sent nothing and the goal strip's Save stayed
  disabled, even once the key was active. The same happened when the
  activation or a backend restart came while the command was starting,
  before the backend had it. Every such refusal is now answered: the
  command stays in the prompt, and sending it again works. When the
  activation or the restart came after the backend had the command, the
  panel now says it may or may not have taken effect, keeps it in the
  prompt, and reads the goal back from the backend before the
  conversation's next action, so the session goal shows where it stands.
- **Implement in a fresh conversation no longer leaves the conversation
  for nothing.** When a new API key was being activated while a plan's
  Implement looked up the backend, the current conversation was left
  before the start was refused. The start is now refused first, with the
  reason, and the conversation stays.
- **One decision per approval step (0.10.0, 0.10.1).** The approval card
  sent a step's decision again, so one approval got two or three answers
  and Muse Code refused the extra ones ("That request moved on to its next
  step…"). Two things re-armed it:
  - The card reopened after every error for a decision. Muse Code 1.4.2
    reports its ledger fault for decisions it has applied
    ([#29](https://github.com/meta-models/muse-code-sdk/issues/29)).
  - The card also reopened after every 60-second deadline. On a busy
    machine Muse Code took one decision in three minutes after it was
    sent, after two more for the same step.

  Now:
  - The card locks at the first click and stays locked until Muse Code
    settles the decision, however fast the clicks come and whatever arrives
    in between.
  - The session sends one decision per step whatever the card asks.
  - A decision that got no answer, or that Muse Code applied while
    reporting an error, is never offered again. The card reopens only when
    Muse Code refused the decision and still waits on that very step.
  - The log names the step each answer was for: a multi-step command
    decided step by step had read as repeated answers.
- **A step Muse Code moved without saying so no longer strands its
  card.** After **Always allow in this workspace**, Muse Code 1.4.2 can
  show a step its new rule already allows, refuse the decision for it as
  stale, and never show the step it waits on. The card then waited for
  ever, and the only way out was Stop. Now the card moves to the step the
  refusal names, with that step's own "Always allow" label, and says on
  the card that the request moved on.
- **A Stop no longer wedges a conversation.** With Muse Code 1.4, stopping
  a turn while a multi-step command was partly approved left the
  conversation refusing every message ("approval replay failed: decision
  stage evidence contains an unrecorded human resolution") until Muse Code
  restarted. On Windows, every decision then reported the ledger fault.
  - A Stop now rejects the waiting step first, through Muse Code's own
    decision, which keeps the conversation usable. It waits 10 s at most,
    then stops anyway.
  - A conversation already in that state is named once, in plain words, as
    a fault in Muse Code. The notice offers **Restart now** (the next
    message starts Muse Code again and continues the conversation) and
    **New conversation**.
  - The ledger fault is named once per conversation the same way, with
    **New conversation**.
- **Tool outputs load quietly while Muse Code works (0.10.0, 0.10.1).**
  An edit row read its stored patch while the edit was still running, and
  Muse Code answered "item or attached output ref was not found". On a busy
  Muse Code, which answers reads one after another, each row's read waited
  60 s and failed, and each failure stacked its own error ("Could not load
  the output", five at once). Now:
  - A row reads its patch once the edit has finished.
  - A read already in flight is joined rather than sent again.
  - A failure is said once per conversation, as a warning saying how to
    retry; later ones go to the log until a read succeeds.
  - Collapsing and expanding the row asks again. The row keeps the diff it
    already shows, and the turn goes on meanwhile.
- **A spawn that starts no child asks nothing** (Model API backend). One past
  the 64 children of a conversation, one asking for worktree isolation, or
  one reusing an earlier spawn's command id for a different task is refused
  before the paid-use popup or the contributor question; a retry of the
  same spawn under its command id answers with that child without asking
  again. Each used to ask first.
- When your PreToolUse hook rewrites a `then_run` command into one that
  names no command, the line under the edit says so in your display
  language; it was English. The model is still told in English.
- A skill folder that cannot be read no longer hides the other folder's
  skills (Model API backend): each loads on its own, and the log names the
  one that failed.
- Project context files are read through the canonical path confinement.
  Replacing an agent/skill/rules alias with an outside link between check and
  read no longer redirects the read outside the workspace.
- **Implement in a fresh conversation** now waits while handoff Start is
  running, and Start waits for Implement, so they cannot both leave the
  conversation and steer one brief into the other.
- **A handoff brief no longer mixes in a later turn's tasks.** A message
  sent after the distillation turn ended but before its brief was read
  back could update the todo list the dialog and the new conversation
  take from it. Sends stay refused until the brief and its todos are
  captured. A brief deferred by key activation now also survives the
  activation's restart: it is read back once the key is active, instead
  of never returning. And a send refused while it waited is kept across
  a panel reload, so the exact draft is still restored.
- **A message sent while a turn runs is never sent twice (0.10.x).** When
  Muse Code did not answer the steer within 60 s, the panel sent the same
  message again as a new turn, and a slow Muse Code took both: the copy
  waited in its queue and ran (or failed) after the turn. Now only Muse
  Code saying no turn is there to take it sends the message as a new turn.
  A steer with no answer fails the message's card with "Muse Code did not
  confirm your message reached the running turn. It may still arrive; check
  before you send it again.", and the composer keeps the text; any other
  refusal is said in its own words.
- **A Muse Code that stops answering no longer leaves every action waiting
  60 s.** On 2026-10-03 `muse serve` stopped writing anything at all (one
  core busy), and every command (a message, a new chat, Stop) waited out
  its deadline, with no way out but reloading the window. Now, after three
  commands in a row missed their deadline with nothing at all from Muse
  Code for 90 s, it counts as not answering: new commands fail at once
  ("Muse Code is not answering. Restart it with "Muse Spark: Restart Muse
  Code"."), and anything Muse Code sends clears it. With no turn running in
  the window it is restarted at once and the panel says so; while a turn
  runs, that panel's notice offers **Restart now**, which stops the turn.
- **Muse Spark: Restart Muse Code** starts a fresh `muse serve` without
  reloading the window. A running turn is stopped, and each conversation
  continues with its next message. A fault notice's **Restart now** does
  the same.
- **A conversation whose Muse Code log is damaged says so.** Muse Code
  1.4.2 can fail a session's event log ("event log failed: …", a fault in
  Muse Code), after which it fails every message of that session. The
  panel now remembers such a session (the newest 50 in each workspace): it
  is never resumed by itself after a restart or a reload, and a message to
  it is refused before Muse Code hears of it, with a notice offering **New
  conversation**. The conversation stays in History.
- **Moving the effort slider no longer sends a change per step.** Eight
  quick steps sent eight `session/setReasoningEffort` at once, and a busy
  Muse Code failed each with its own warning. Now one change per
  conversation is in flight, the newest waits, and a failed burst is said
  once.
- **Edit rows no longer read all their diffs at once after a resume.**
  Every open edit row asked for its stored diff at the same instant (26 at
  once in the owner's session). At most four reads go to Muse Code at a
  time, in order, and one for a conversation no longer shown is never
  sent.
- **A notice said again is one row, not a stack (0.10.1 and earlier).**
  When Muse Code stopped answering, the conversation filled with copies of
  the same notice: "Could not load the output: … within 60 s" five times,
  "Reasoning effort could not be applied: …" seven times. That buried the
  chat. Now:
  - A notice with the same level and text as one in the run of notices
    that ends the conversation replaces it. The one row moves to the end,
    with a small count after its text ("7×", read out as "Shown 7 times").
    A notice said before the last message stays where it was said.
  - Notices with a different text or level stay apart.
  - Each file restore's notice keeps its own row and its Redo.
  - A Muse Code fault said again offers its buttons again.
  - The count is kept when the panel reloads.
- **Error notices in the conversation are readable in the Light and Dark
  themes.** Their red text on the red tint measured 2.6:1 and 3.8:1, and
  WCAG AA asks for 4.5:1. They now use the theme's text colour on the tint,
  with a red edge.

### Release infrastructure

- Release assets now include SHA-256 checksums, package provenance attestations
  and CycloneDX inventories limited to the actual bundled dependencies, plus
  the ACP package's native runtime dependencies. npm publication requests
  provenance and retains token authentication.
- Registry publishing retries only transient network failures with a bounded
  20/60-second backoff. Existing versions require matching VSIX SHA-256 or
  tarball SHA-512 integrity; GitHub reruns verify existing assets and add only
  missing files. A final summary reports all channel outcomes and fails any
  failed channel. The release guide documents partial publication and npm EOTP.
- Packaging checks every ACP locale and enforces a measured universal VSIX
  size budget. M80 schema-upload and fully-published `v0` tag hooks are prepared
  and remain inert until their source directories exist.

## [0.10.1] - 2026-10-02

### Added

- **Paired efficiency evaluation** (M75, PLAN.md D49): the harness a
  token-saving mechanism must pass before it ships (M73, M74). Ten small
  repository fixtures (six accept, four held-out), each judged by a
  verifier that runs the fixed code, so any correct fix passes however it
  is spelled. Each task runs on the extension's own Model API harness in
  an empty temporary workspace, on the contributor model only; attempts,
  tokens and cost are counted from the requests actually sent, and each
  arm is held against capability floors fixed in advance (0.75 per
  split). `npm run test:e2e:live:eval` runs it, opt-in and never in CI.
  The baseline passed all ten tasks in 39 model calls for $0.0041
  (`docs/certification/m75-baseline.md`).
  - **Its key stays out of every environment.** The live run reads the
    Model API key from the ACP agent's OS credential entry inside the
    enabled test, never from its own environment, an argument or a file,
    and the shell commands the model runs get an environment without any
    credential variable (`withoutCredentials`).
  - **It stops when a sent call cannot be priced.** Missing, invalid or
    unsafe usage counts, or an ambiguous request failure, close the run's
    shared budget for every later task and arm.
  - **Arms take turns going first.** Task by task the arm order rotates, so
    the prompt cache one arm warms cannot be counted as another arm's
    saving.
  - **Reports are version 2;** the version-1 baseline still reads, with
    the two counts it never recorded shown as not recorded. A workspace
    that cannot be created reports only an error code, never a path.

### Changed

- The Node bundles share their English fallback as `dist/uiText.js`, while
  installed-language state stays local to each bundle. The VSIX and ACP
  tarball include it, and CI checks both package member lists. Existing
  bundle caps remain unchanged; runtime smoke checks cover the extension,
  Model API bundle and the agent installed from its tarball.

### Fixed

- **Windows hooks no longer wait on PowerShell's module scan.** The
  PowerShell wrapper that puts each Windows command and hook in its job
  object (M27) loaded the job helper with `Add-Type` and switched output to
  UTF-8 with `New-Object`. PowerShell finds both cmdlets by module
  auto-loading, which, without its module analysis cache, first analyses
  every installed module. A hook's narrow environment does not carry
  `PSModuleAnalysisCachePath`, so on GitHub's Windows runner a hook waited
  roughly 18 to 30 s before it started, and past the hook test's 60 s on a
  fresh runner (the M51 hook test's intermittent timeout). The wrapper now
  makes .NET calls only, so a hook or command starts without any module
  discovery; the helper's self-test and a stopped command's job kill load
  it the same way.
- **The ACP agent reaches npm.** The release workflow passed its package as
  `release/muse-spark-code-acp-<version>.tgz`, which npm reads as a GitHub
  `owner/repo` and tried to fetch over SSH, so 0.10.0 was not published to
  npm. The path now starts with `./`.
- **A slow Muse Code start is waited for, and a failed one is shown once.**
  On a machine short of CPU, `muse serve` could miss its 30-second
  handshake and was ended, and every action waiting on that start showed
  its own "That did not work" card (six for one start). A start whose
  process still runs at 30 seconds now gets up to 120 seconds in all (the
  model pill keeps reading "Starting Muse Code…"); one whose process exits
  fails at once. A failed start is shown once in the panel, by the first
  action that needed it (a message on its own card); the panel's warm-up
  says it only when nothing else did, and the skill listings of the
  palette and the slash menu only log it. The next action starts Muse
  Code afresh.
- **A crafted long line no longer stalls the log.** Every line the
  extension logs passes through its secret redactor, whose JSON Web Token
  pattern read a long word again from every `eyJ` after a dash in it: a
  64,000-character line of `eyJa-eyJa-…` took seconds. It now reads each
  run of dotted words once. A token glued after `_` or a letter
  (`x_eyJ…`), which the old pattern missed, is redacted too, and nothing
  the old pattern redacted is left.
- Documentation: corrected the Bypass row of the permission-mode table (paid
  uses still ask), the remote-window Bypass description in the Restricted Mode
  text, and the Diagnostics, dictation and macOS helper claims in PRIVACY and
  SECURITY; cited Meta's source for the PDF page limits.

## [0.10.0] - 2026-10-01

### Highlights

- **Other editors.** The ACP agent (`muse-spark-code-acp`) brings Muse Spark to Zed, JetBrains IDEs, Neovim, Emacs and more (`docs/acp.md`).
- **Code intelligence and rename.** The agent finds definitions, references and symbols through VS Code's language services, and renames a symbol everywhere it is used.
- **The agent checks its own edits.** After edits, the language servers' errors and your check commands reach the next request (Model API backend).
- **Web fetch.** The model reads one public HTTPS page on either backend, fetched from your machine and free.
- **Plans as files.** Save a Plan-mode reply to `.agents/plans/` and implement it in a fresh conversation.
- **Turn checkpoints (Preview, off by default).** Restore files, the conversation or both, then redo; the copies never touch your `.git` (stored restore needs a Model API session). Turn them on with `museSpark.turnCheckpoints`; their restore is being rebuilt on the tools' own writes (PLAN.md D63).
- **Every paid use asks first.** A popup (Allow once, Allow always in this workspace, Deny) in every mode, Bypass included.
- **A lighter start.** The Model API backend is a bundle of its own, loaded only when a conversation uses it.
- **VS Code 1.99 or newer** (was 1.125), so editors built on VS Code 1.99 or later can install the extension.
- **Open VSX and npm publishing.** A release tag also publishes the VSIX to Open VSX and the ACP agent to npm (each when its token is set).

### Added

- **The agent checks its own edits** (M68, PLAN.md D49). On the Model API
  backend, after each round of tool calls that edited files, the next
  request carries the edited files' errors and warnings from VS Code's
  language servers, with what changed since each file's previous check
  (`museSpark.diagnosticsAfterEdits`, on by default), and the results of
  your **check commands** (`museSpark.checkCommands`: lint, test or
  type-check commands, none by default), within one 64,000-character
  budget. A **Check edits** row shows the files, their problems, how many
  were **not checked** (no report arrived, unsaved, or past the first 8;
  never reported clean) and how each check ended.
- **Check commands take the shell tool's hooks and permission path.** Your
  PreToolUse, PostToolUse and PostToolUseFailure hooks see each check and
  `then_run` command as a shell call (deny, rewrite, ask, add context, stop
  the turn), and a hook's denial is shown apart from your Reject. Each asks
  wherever a shell command would ask (every mode but Bypass permissions),
  "Always allow in this session" allows that check (never the agent's own
  shell call of the same command, nor the other way round) until the agent
  edits a
  file that decides what it runs (`package.json`, a `Makefile`, a config
  the tools load, a file it names; any file, for a command with quotes,
  variables or other shell syntax), and none runs in Plan mode or Restricted
  Mode. `changedFiles` passes the edited files that still exist after `--`,
  each quoted as one argument, and refuses a file name that starts with `-`
  or `@`, or on Windows holds `"`, `&`, `|`, `<`, `>`, `^`, `%` or `!`;
  `timeoutSeconds` caps each run. A rejected check is not asked again, and
  after three failing rounds in a row the checks stop, until your next
  message (a message you add while the agent works starts them again too);
  the model and the panel say so. A round counts as failing only by checks
  run on the files as they now are, and passes only when none of those
  fails; an edit's `then_run` of the own command of a check that does not
  take the changed files counts as that check (a pass only when the check's
  time limit is no shorter than the shell's). No such check runs twice for
  the same state of the files, and nothing runs after the turn's last
  round.
- **`run_checks`**, the model's own call of the checks (on files that exist
  in the workspace, or those edited since your message), and **`then_run`**
  on `write_file` and `edit_file`: one command run right after the edit,
  asked for like any shell command, run only if the file still holds what
  the edit wrote, and shown under the diff as the call's second result
  (SoL-Pi's Action Fusion, reimplemented from its description).
- **Format on edit** (`museSpark.formatOnEdit`, off by default): the file's
  formatter runs on each file the Model API backend's edit tools write,
  before anything checks it. The formatted text is written only while the
  file still holds what the edit wrote and has no unsaved changes in an
  editor; otherwise, or when it cannot be written, the edit stays as
  written and the log says why.
- **Code the editor runs is never opened or formatted by the loop**
  (`eslint.config.js`, `.prettierrc.cjs`, `package.json`, `node_modules`),
  and once the agent writes such a file nothing more is opened or formatted
  until your next message.
- **Muse Code** is told with each message to check the files it edits with
  `mcp__ide__getDiagnostics` (when the session has the IDE tool server) and
  to run your check commands.

- **Plans as files** (M79, PLAN.md D49). In Plan mode the latest reply gets
  two buttons, **Save plan** and **Implement in a fresh conversation**.
  Pressing one is the approval: neither backend marks a plan or its approval
  on the wire (Muse Code 1.4.0 was captured live).
  - **Save plan** writes the plan byte for byte to
    `.agents/plans/YYYY-MM-DD-<slug>.md`, Muse Code's own convention, with a
    numeric suffix when the name is taken; an existing file is never
    replaced. A Muse Code plan reply's two handoff lines ("Reply `go` to
    execute this plan…") are left out. `.agents` is protected, so the save
    asks first; Restricted Mode refuses it.
  - **Implement in a fresh conversation** starts a new conversation on the
    same backend. Its first message is the plan file, attached as named
    text, and nothing else from the planning conversation, which stays in
    History. Plan mode gives way to the starting mode.
  - On the Model API backend, the plan's steps become the todo list before
    the first request, and the brief names them. On Muse Code, which keeps
    its todo list to the model, the brief asks Muse to list the steps.
  - **Plans…** in the palette lists the saved plans, newest date first, to
    open or implement. A plan file is untrusted content (PLAN.md D49): one
    implemented from Plans… starts in Manual (Plan when that is the
    starting mode) and is never presented to the model as approved.
  - Only a reply to a message sent in Plan mode, in a turn that stayed in
    it, counts as a plan. Save and Implement resume the conversation after
    a restart, find a plan already saved instead of writing it twice, and
    say why when they do nothing. What the model gets is what the user
    saw: the reply is shown, and the brief written, from one rewritten
    Markdown tree (a link's destination beside its text, a picture's
    source, titles, definitions, footnotes and code-fence info as text), so
    nothing in the brief is hidden in the panel. A plan with raw HTML is
    saved with a warning and not started; one with a control or format
    character (a direction override, a zero-width character) is neither
    saved nor started. The log names a plan by a
    verified date and a hash, or by the hash alone, never by its name.
  - The plan reader (the panel's Markdown parser) is a bundle of its own,
    `dist/planMarkdown.js` (budget 150 KiB), loaded on the first Save plan,
    Implement or Plans…, so the activation bundle does not carry it. If it
    cannot load, those actions are refused with the reason.
  - A reload of the conversation (a delivery gap) keeps Save plan and
    Implement under a plan reply. A plan that cannot open from Plans… says
    why in the panel and logs only the kind of failure.
  - Leaving Plan mode when the backend refuses the change keeps a running
    Plan-mode turn a plan turn. A reasoning effort the session refuses is
    no longer shown as applied.
- **Memory and plans: folder re-check.** A new memory note or plan is
  refused when its folder was swapped for a link or junction after it was
  checked (`createFileExclusively` checks again after making the folder and
  before publishing).
- **Web fetch on both backends** (M69, PLAN.md D49; folds in M44b). The
  model can read one public web page it found or you named: `web_fetch` on
  the Model API backend, and `mcp__ide__webFetch` on Muse Code, whose own
  `web_fetch` is switched off. The extension fetches the page from your
  machine; it is free, not Meta's paid search.
  - `https://` only, public internet addresses only: the name is resolved
    here and refused when any answer is loopback, private, link-local,
    carrier-grade NAT, cloud metadata or reserved (IPv4-mapped, NAT64 and
    6to4 forms judged by the IPv4 inside), and local or reserved names are
    refused before any lookup. The connection goes to the address that was
    checked, never to a second lookup; TLS still verifies the name.
  - Same-host redirects are checked and pinned again, at most five; a
    redirect to another host is handed back to the model. 5 MiB after
    decompression, 30 seconds, an allow-list of text types; HTML becomes
    Markdown, text stays as it is, anything else is refused with the reason.
  - Through VS Code's proxy and certificates: the proxy is asked to tunnel
    to the checked address, and a proxy's own answer is refused as such,
    never read as the page.
  - On the Model API backend it asks per host in Manual, Edit automatically
    and Auto ("Always allow in this session" covers that host), runs in
    Bypass, and is refused in Plan and in Restricted Mode. On Muse Code the
    tool is listed only in a trusted workspace whose
    `museSpark.sandboxNetwork` is not `restricted`, declares itself
    open-world and not read-only, and the extension asks in its own dialog
    before every fetch.
  - The model receives the page between random markers, with a note that it
    is untrusted content; the row shows the URL, the size and type, and what
    the model read. 23 new strings in fifteen languages.
  - After review: Muse Code's Stop (a closed request, or
    `notifications/cancelled`) stops the fetch and voids a later answer in
    the dialog, which is also asked only once per URL at a time and checks
    the workspace again after it; the checked addresses are raced as RFC 8305
    says; failures name the page's host and the addresses tried instead of
    M56's advice about Meta, and a network failure's detail only by its
    error codes (never a certificate's names); a server's text reaches the
    model outside the markers only as short tokens; the HTML converter is bounded; names with
    trailing dots or empty labels are refused; a network's own NAT64 prefix
    is discovered (RFC 7050), and while it cannot be learned no IPv6 answer
    is used (only a DNS answer proves there is none); pages are parsed by
    HTML's own rules (implied ends, misnested and self-closed tags, SVG and
    MathML, comments and scripts), and the Markdown is the page's text as
    served, which can include text a browser would not show (no stylesheet
    or hiding attribute is read, since hiding cannot be worked out
    completely and visible small print hides nothing), all of it between
    the untrusted markers, as the tool's description and the note now say;
    a hook's "allow" no longer replaces
    the per-host card; trust
    and the mode are asked again after the card, before each request and
    before the page reaches the model; damaged compression and unknown charsets are
    handled as a browser would; `museSpark.sandboxNetwork`'s description now
    says it also hides web fetch from Muse Code. Fifteen more strings, one
    changed and one dropped, and two changed setting descriptions, in
    fifteen languages.
- **Dependencies.** Web fetch parses HTML with `parse5` 8.0.1 (MIT)
  and sniffs its encoding with `html-encoding-sniffer` 6.0.0 (MIT), both
  already in the tree through the test tools. They load only in
  `dist/pageWorker.js` (201 KiB, budget 300 KiB), on a worker thread started for each page (at
  most two at once) and stopped at 10 seconds or 512 MiB; `dist/extension.js` does not carry
  them. `entities` is no longer a direct dependency.
- **Code intelligence** (M67, PLAN.md D49): the agent finds definitions,
  references and symbols the way the editor does, from VS Code's own
  language services, instead of searching text. `find_definition`,
  `find_references`, `workspace_symbols`, `document_symbols`, `hover`,
  `call_hierarchy` and `repo_map` are reads in every mode on the Model API
  backend, Plan and Restricted Mode included; a symbol is named by path,
  line and column, by its name on a line or in a file, or by name alone.
  Answers are workspace-relative, sorted and capped, and say how many
  results outside the workspace (a library's declarations, another folder)
  they left out; a hover for a symbol defined only outside the workspace
  (and outside the languages' own libraries) is held back. A file whose
  language has no service, or that declares nothing, says so instead of
  answering nothing, and an empty answer says that not every language
  provides every kind. In a file with unsaved changes a line number is
  refused and a name is found in the editor's text, said so, the editor
  matched by the file's real path (a workspace opened through a link). A
  call hierarchy names the file of each outgoing call site, and counts the
  other functions a position names (overloads) that it did not ask. On the Muse
  Code backend the same tools are served to Muse Code as
  `mcp__ide__findDefinition` and the rest, each marked read-only; Muse Code
  1.4.0 still shows its own card for them in its on-request mode.
- **`rename_symbol`** renames a symbol everywhere it is used. On the Model
  API backend it is an edit: the card names its files, a protected one
  first (and is a protected write when one of them is); every file is
  checked again after the card and once more right before its own write,
  and Stop before the first write writes nothing; the row carries one
  patch, so Revert and rewind undo it, a rename stopped partway included.
  It refuses an edit that also creates, moves or deletes files, and one
  whose ranges no longer cover the old name (made from an older version of
  a file). A hook matching `Edit` runs for it, with the files it would
  write, and the rename writes the plan the hook was shown. On Muse Code it changes nothing and hands Muse Code the diff to
  apply with its own edit tool.
- **A repo map in the Model API's prompt** (`museSpark.modelApiRepoMap`,
  off by default, machine-scoped, trusted workspaces only): the files other
  files use most, with their most used definitions, within about 1,000
  tokens. It is kept once made, tried again on a later turn when a try finds
  nothing (three tries at most), and shared with child tasks and forks. It
  adds those tokens to every request, its heading and notes counted in
  the budget. `repo_map` gives the same map on request either way, all of
  its text within `max_tokens`; a budget too small for its own lead and
  notes is refused with the size that would do.
- **Groundwork for editors other than VS Code** (M60, M61, PLAN.md D60).
  The owner's IDE compatibility plan is filed in `docs/ide-compatibility.md`.
  A new gate, `npm run check:host-api`, keeps a record of what the
  extension asks of its host (`docs/ide-compatibility/host-api.md`): the
  initial 201 VS Code APIs and where, the 13 files that imported `vscode`,
  the Node built-ins, and what the webview needs (`acquireVsCodeApi` and 57
  theme variables); it fails when the record goes stale, and when the
  engine, the protocol, the webview, the conversation controller, either
  backend or the credential store reaches `vscode`. The webview now talks
  to VS Code through one host bridge, and the chat surface, the log and the
  dictation setup carry no VS Code types. Nothing changes in VS Code.
- **Muse Spark for editors that speak ACP** (M63, PLAN.md D61, D62).
  `muse-spark-code-acp`, an npm package attached to each GitHub Release,
  runs Muse Code or the Model API as an Agent Client Protocol agent for
  Zed, JetBrains IDEs, Neovim, Emacs and the other ACP editors: the chat,
  tool calls with diffs, the plan, permission prompts (a cancelled or
  unknown answer rejects), questions as forms, the modes, the model and
  effort, skills as commands, and sessions listed, loaded and resumed. The
  backend is chosen when the editor starts it and never switches.
  `muse-spark-code-acp auth set` keeps a Model API key in the operating
  system's credential store (Windows Credential Manager, the macOS
  Keychain, the Secret Service on Linux, with no plaintext fallback); the
  key is never read from the environment or passed to Muse Code. Paid
  features (web search, image generation) are off unless the editor
  starts the agent with `--web-search` or `--image-generation`, and then
  each use asks first in the editor's permission prompt, naming the price,
  as the panel's popup does (M58): Allow once, Allow always in this
  workspace (only with `--trust-workspace`, kept in the agent's data
  folder and forgotten when the agent starts without the flag) or Deny.
  Subagents stay off in the agent. The agent loads the Model API backend
  from the same `dist/modelApi.js` the extension ships (M57), which its
  package carries. The editor's MCP
  servers (stdio and HTTP) are passed to Muse Code, so Jupyter AI's
  notebook tools and Zed's context servers reach it. See `docs/acp.md`;
  which editors have been tried is tracked in
  `docs/ide-compatibility/hosts.md` (Zed, Emacs
  with agent-shell, Neovim with CodeCompanion and JupyterLab with Jupyter
  AI so far). On the Model API backend, a trusted folder gets Muse Code's
  memory tools as the panel does; subagents, which are paid, are not
  offered, and the package carries the C# of the shell tool's Windows job.
- **The ACP agent and proxies.** The agent runs outside VS Code, so VS
  Code's proxy and certificate settings do not reach it, and Node's own
  `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` (Node 22.21 or
  later, or 24). The agent does not re-route by itself: on the Model API
  backend it warns once in its log at start when a proxy variable is set
  and would not be used (or this Node cannot use one), and a request that
  never reaches Meta now names the variables to set in the agent's
  environment instead of VS Code's `http.*` settings, in all 15 languages.
  `docs/acp.md` has a new "Networks and proxies" section.
- **The ACP agent's Muse Code sign-in is read as the panel reads it**
  (PR #49): from the credential file's structure, and the CLI's
  `account/read` where only it can say, so an agent after `muse logout`
  asks for sign-in instead of failing its first turn. A Muse Code agent no
  longer clears the Model API agent's "Allow always" when it starts, and a
  Model API agent whose `dist/modelApi.js` is missing says to reinstall the
  agent, not the extension.
- **The ACP agent keeps credential variables to Muse Code.** A
  `META_API_KEY` in the agent's environment still reaches Muse Code and
  counts as its sign-in, as with the extension, but no shell command, hook
  or git the agent runs sees it or any other `*_API_KEY` variable. A
  loaded or resumed session now runs in the mode, model and effort the
  editor shows (or fails to load), the model as Muse Code reports it; a
  session the agent could not set up is let go rather than left running,
  and closing or reloading a session ends its running prompt as
  cancelled and stops that turn, with any answer still owed to it
  ignored;
  a question's form answer is used only
  when it is one of the form's own options, in the allowed number; and the
  agent's log names a backend failure by its kind, never its message.
- **The key outside VS Code, in the rules** (AGENTS.md rule 8, PLAN.md
  D61). Outside VS Code the operating system's credential store stands in
  for SecretStorage: the ACP agent's key goes in only through `auth set`'s
  standard input and never reaches a child process. The one named
  exception is the planned CI bootstrap (M80), whose step shell pipes the
  key to `auth set` and unsets it before the run.
- **Open VSX and npm publishing** in the release workflow. A tag also
  publishes the VSIX to Open VSX, for VS Code forks that install from
  there, and the agent to npm, each only when its token is set in the
  `marketplace` environment.
- **Host checks in CI** (the Hosts workflow, `test/hosts/`). Every pull
  request that touches the product runs development-extension integration
  in VSCodium and packaged browser checks in code-server (the 1.99 floor
  and the latest) and Eclipse Theia,
  and the packaged ACP agent on Linux, macOS and Windows (its key through
  each credential store) and in JupyterLab, Emacs and Neovim, all against
  a fake Muse Code CLI; the latest releases are tried again every Monday.
  A second workflow, Forks, installs the VSIX in the latest Linux builds
  of Cursor, Devin Desktop (formerly Windsurf), Kiro and Positron, then
  runs development-extension integration there, weekly and by hand.

### Changed

- **The diagnostics tool reads a file no editor shows.** VS Code's language
  servers report only on files an editor shows (TypeScript and JSON,
  measured in VS Code 1.139.1 and 1.125.0), so when the agent asks
  `getDiagnostics` about one such file, on either backend, the extension
  opens it in a tab beside your editor without taking focus, waits up to 10
  seconds for its report, and closes the tab again; a file outside the
  workspace by its real path, or code the editor runs, is not opened, and a
  file no report arrived for is "not checked", never clean.
- **VS Code 1.99 or newer** (was 1.125; M62, PLAN.md A8), so editors built
  on VS Code 1.99 or later can install the extension. The extension uses
  no VS Code API newer than 1.85, checked against every published
  `@types/vscode` from 1.85 on, and its host bundles now need nothing
  newer than Node 20.18, the Node of VS Code 1.99 and 1.100. Tested in
  VSCodium 1.99.3 and 1.135 (the integration tests, 9 passing in each) and
  in code-server 4.99.4 (VS Code 1.99.3: a conversation and an approval
  in the browser), where the 1.125 floor was refused; and in the latest
  Cursor, Devin Desktop (formerly Windsurf), Kiro and Positron, which
  install it and pass the integration tests. On 1.99 and 1.100 Muse Voice
  says it is unavailable, as their Node has no WebSocket. VS Code routes an
  extension's WebSocket through its proxy support only from 1.112, so on
  1.101 to 1.111 Muse Voice's socket goes to Meta without it; **Muse Spark:
  Diagnostics** now says whether this editor routes the extension's `fetch`
  and WebSocket at all, instead of reading only the settings, and the
  README's Proxies and certificates section says what to use. The Model
  API's requests are routed on every supported version.
- **README: How this extension is built** (Development): the owner, Claude
  Code as lead, up to four headless Muse Code builders on the contributor
  model, Grok Build and Codex as reviewers, and the gates on dedicated test
  machines and CI.

- **Turn checkpoints: restore files, the conversation, or both, then redo**
  (M72, PLAN.md D51). Each turn gets a checkpoint of the workspace's files at
  its start and end, on both backends, untracked files included and
  ignored files left out. A sent message's menu offers **Restore files to
  here** and **Rewind conversation and restore files**. A restore undoes
  what the conversation's turns changed from that message on, including
  what shell commands changed. It names every file it left as it is:
  changed since the turn (by you, a build, or another conversation's
  overlapping turn), unsaved in an editor or notebook, not in the
  checkpoint, or could not be changed. Each file is checked again just
  before it changes, deletions come before writes (a case-only rename or a
  file that became a folder comes back), and no file is written or deleted
  through a link or junction. Its notice has **Redo**, which puts back what
  the restore replaced; the redo record is saved before the first file
  changes, so a restore that stops part way still reports what it changed
  and keeps Redo, and a redo that could not do everything keeps its button.
  **Rewind conversation and restore files** checks the conversation first
  and rewinds it only when every file was restored. A folder that was there
  before the turn, even an empty one, is never removed.
- **Independent windows share checkpoint records without overwriting them.**
  Current-version windows use a shared canonical-root namespace under extension
  global storage, including different VS Code workspace identities/aliases.
  Old per-workspace captures remain preserved, readable and labelled read-only.

  Per-record Git compare-and-swap refs replace the shared lock and JSON file;
  each window owns its index, pending captures, staged copies and presence.
  A restore or Redo reserves one shared ref before file changes. Archives
  are durable before returning, including in Restricted Mode, and cleanup
  spares recent objects while another window creates its refs. Model API
  turns await their running mark before hooks, edits or model calls, queued
  and scheduled turns and children included; a failed mark prevents them
  from running. A child outliving its parent keeps restores blocked.
  Tool preimages remain until the end record persists; retry keeps the
  original boundary rather than recapturing later user changes. Cancellation
  stops before the next file and finalizes Redo for the files actually
  changed. Errors shown in the panel are localized and storage paths are
  excluded from failure logs. Stored destructive Restore/Redo is limited to
  the actual attached Model API session with confirmed process safety. Every
  extension-managed CLI skills/import/export or sandbox command, and
  interactive/auth/MCP/installer terminal, awaits durable native admission
  before process or terminal creation. Shutdown or backend disposal cancels
  a held start. Terminal callbacks are awaited through command and auth
  callers; terminal closure does not clear unproved descendant activity.
  A workspace Muse Code serve (account probes included) publishes the same
  unsafe marker before startup.
  **Create AGENTS.md** applies this admission to `muse init`; refused startup
  cannot choose the template fallback. The explicit pure template write holds
  a file-edit lease until actual I/O settles, including in Restricted Mode
  without Git, and checks shutdown/generation before writing.
  Extension-managed Git worktree add/remove publish the same native marker
  before normal repository hooks run, with fresh owned-cwd/lifetime checks.
  Pure plan publication/stage cleanup and file-review Revert hold an activity
  lease through actual I/O, preserving no-clobber and stage ownership checks.
  Automatic prompt Git status/log now suppress configured fsmonitor,
  signature and clean/process helpers through bounded names-only overrides,
  with live trust/owner/cwd checks before actual spawn. Plain metadata leaves
  file restore eligible; ordinary Git configuration remains unchanged.
  The independent ACP runtime explicitly records its no-VS-Code-checkpoint
  startup policy; it neither offers stored Restore nor claims the shared
  window fence. Its external-editor scope is documented in the ACP guide.
  After joined-main review, plans retain current trust/lifetime checks through
  native staging/publication and stale-stage removal. Restore/Redo use the
  existing conditional writer for final expected-file/dirty checks, including
  binary/absent expectations, and recheck unlinked deletion destinations.
  Executable modes and durable partial Redo are retained; the final
  comparison-to-syscall residual is documented.
  Shell/hook activity is tracked through its actual promise, including `!`,
  background and child work; unproved descendant shutdown leaves sticky unsafe
  presence rather than enabling restore. Native/old/unknown uncertainty
  survives window close, PID death and age. Explicit confirmed recovery removes
  only the exact stale presence marker, preserving checkpoints and history.
- **Checkpoints never touch the workspace's `.git`.** They live in a shadow
  repository under the extension profile's canonical-root global storage, run with hooks,
  fsmonitor, your git configuration and the workspace's filters all off,
  and copy bytes as they are. A folder that is not a repository, and a
  repository with no commits, get checkpoints too.
- **Ignored files the turn itself touched.** A file the Model API's edit
  and write tools (or the image tools) are about to change is copied first,
  so a restore brings it back. Ignored files a shell command created are
  found by a bounded scan and deleted by a restore. Ones a command changed
  are listed as not restorable; the restore never claims to have undone
  them.
- **Limits and cleanup.** A file over 16 MiB, a link, a folder link or
  junction and a nested repository are left out and named, and a workspace
  with more than 50,000 files outside its ignore rules gets no checkpoints;
  the panel says why. Archiving a conversation deletes its checkpoints (in
  Restricted Mode its records at once, its copies once the folder is
  trusted), and retention keeps the 100
  newest checkpoints and 20 redo records per conversation for 50
  conversations, within `museSpark.cleanupPeriodDays`, applied each time the
  window opens. The checkpoint folder is 0700 on macOS and Linux.
- **`museSpark.turnCheckpoints`** (machine-scoped, a Preview, off by
  default) turns them on. They are off in Restricted Mode, where the extension runs no git,
  and without git on `PATH`; the menu says which. With Muse Code on
  Windows, which cannot fork, the menu offers **Restore files to here** and
  says why the conversation rewind is missing.
- **A restore keeps more of what you did since** (the third Codex review of
  PR #55). A restore or Redo leaves a file whose execute bit you changed
  since the turn, even with the same bytes. A subagent's turn that outlives
  its parent's no longer makes the parent's own edits read as changed
  outside the turns. A conversation's turns are ordered by their own count,
  not the clock, so two turns in one millisecond or a clock set back never
  pull an earlier turn into a restore. A repository an ignore rule hides is
  left out whole like any nested repository, and no tool write inside a
  nested repository is restored. The repository's `info/exclude` and your
  global excludes file are read again before every capture. Switching
  `museSpark.turnCheckpoints` off during a turn still keeps the tools'
  copies for that turn. On a case-sensitive macOS volume, a link that
  differs from its target only in letter case is refused. A window's first
  message is no longer sometimes refused ("could not tell other windows …")
  when the checkpoint repository was still being set up. A file you save in
  the editor while a turn runs is yours: restoring that turn leaves it as
  you saved it. An ignored file a tool copied but never changed (its write
  was refused) is left alone, not rewritten. Unarchiving a conversation
  keeps its new checkpoints even if the clock was set back. Checkpoint
  storage that a link or junction puts inside the workspace is refused.
  What the extension writes for you while a turn runs (Create AGENTS.md, a
  Markdown export, a saved plan, a Revert, a note the Memory view creates or
  trashes) is yours too. A restore leaves alone what an earlier turn of the
  same conversation, still running in another window, changed, and what a
  turn of a window that closed mid-turn may have changed. A file you save in
  any window on the folder while a turn runs, even one with no turn of its
  own and even while the turn's first checkpoint is being taken, is yours
  too.

- **Rewind code to here asks first** (M72), in the same confirmation as a
  file restore. **Fork conversation and rewind code** is now one action:
  the confirmation, the reverts, then the fork; declining does neither.

- **Every paid use asks first, in a popup** (M58, PLAN.md D48): **Allow
  once**, **Allow always in this workspace**, or **Deny**, in every
  permission mode, Bypass included. It covers each image (on either
  backend), each subagent task, each scheduled run, each Muse Voice
  recording, and web search once per prompt (Deny sends the prompt without
  it). Web search and Muse Voice asked nothing per use before; images and
  child tasks asked on an in-chat card, which is gone.
- **Allow always in this workspace** is offered only in a trusted
  workspace with a folder open, lapses everywhere when the feature is turned
  off or a new price is accepted, and **Ask again every time** in Account &
  usage takes it back. A paid image aimed at a protected path, and a hook
  that demands a question, still ask. Account & usage and the paid badge's
  tooltip name what no longer asks; every use stays a paid row in the
  tally.
- **The extension starts lighter** (M57, PLAN.md D6). The Model API backend
  (its host, tools, hooks, goals, subagents and MCP client) is now a bundle
  of its own, `dist/modelApi.js`, loaded the first time a conversation uses
  that backend rather than whenever VS Code starts the extension:
  `dist/extension.js` goes from 596.8 KiB to 425.3 KiB, and a Muse Code user
  never loads the backend at all. Nothing it does changes. If the file is
  missing or damaged, the conversation says so in your language and the log
  names the file.
- **Build.** `dist/modelApi.js` has a size budget of 400 KiB (295.6 KiB
  today), and `npm run build` fails if the backend's files creep back into
  the activation bundle (`scripts/check-bundle-split.mjs`). The host-globals
  and third-party-notices checks cover the new bundle, `npm run cycles`
  follows it, and the `.vsix` ships it.
- **Build: the ACP agent's budget is 850 KiB** (PLAN.md D6). `dist/acp.js`
  is 713.2 KiB now that it loads the Model API backend from
  `dist/modelApi.js` (it was 874.1 KiB, over its 800 KiB budget, before
  M57 reached it); the budget is that plus about 15 %. The agent is
  installed once and never loaded by VS Code, so the size is a download,
  not a start-up cost. No other budget changed.
- **Development: test infrastructure.** On macOS and Linux the integration
  tests use a short user-data folder under the temporary folder only when the
  default would not fit a Unix socket path (macOS caps it at 104 bytes;
  `scripts/lib/vscodeTestProfile.mjs`), so a rig's long checkout path no longer
  stops VS Code with `listen EINVAL`; a path that fits, CI's included, and
  Windows are untouched. Vitest's macOS worker cap is typed so that
  `npm run typecheck:host` passes (it failed on TS2769).

### Fixed

- **A very long log line no longer stalls the extension.** Hiding
  credentials in a log line took time that grew with the square of a long
  run of dotted or dashed words with no URL in it (3.5 s for 40,000
  characters); it is now linear.
- **Memory notes keep restore copies, and the Memory view cannot overlap
  another window's restore** (M72). The Model API's memory tools and the
  Memory view now copy an ignored project note and its `MEMORY.md` before
  they change them, a new note's creation takes the same copy first, and a
  note is copied before the view moves it to the trash, so a checkpoint
  restore brings them back. The view's new note, delete and index line hold
  the restore lease until they finish (personal notes outside the workspace
  take none), and so does a conversation export you save inside the
  workspace, whichever way the folder is spelled (a link, a junction or a
  mapped drive included): another window's Restore or Redo is refused while
  one runs.

- **A workspace opened through a link, a junction or a mapped drive keeps its
  conversations** (M72). Sessions, the CLI’s working directory and memory are
  keyed by the folder as VS Code spells it, as before; only the checkpoint store
  uses the canonical path.

- **A restore no longer reverts another window’s edit made at the same
  instant** (M72). Turns in two windows that touch at one clock tick count as
  overlapping, so the other window’s edit is protected.

- **A file named `..something` is inside the workspace** (M72, and the ACP
  agent’s mention links). It was treated as outside because its name begins with
  two dots, so it got no restore copy.

- **A completed restore keeps its Redo when its lease cannot be released**
  (M72). The release is tried again and logged instead of replacing the result
  with a failure; the window’s next restore takes over a lease it still holds.

- **Restore and rewind stops when any file is left behind** (M72). A file with no
  earlier copy, one that was never in the checkpoint, or ignored files that
  could not all be put back now keep the conversation from being rewound, as the
  confirmation says.

- **The checkpoint storage is never the model’s to edit** (M72). Checkpoints
  refuse a workspace that holds their storage (a profile folder opened as a
  workspace), and the tools refuse every file inside the checkpoint storage, so
  no file the model writes can change the repository a turn’s end runs git on.

- **A checkpoint copy never takes a file from outside the workspace** (M72), even
  when a folder was replaced by a link after the tool’s check.

- **Fork conversation and rewind code stops when an edit cannot be reverted**
  (M72), instead of forking away from the history the code still matches.

- **A check that never started is reported as not run** (M68/M72), not as a
  failed command with hooks around it.

- **A native start that a restore refuses no longer blocks restores** (M72);
  nothing started, so the window is not marked unsafe.

- **A file a turn made visible to git is put back from the copy kept** (M72),
  when a `.gitignore` change made an ignored file show up as new.

- **The model picker lists the models again after a new, resumed or forked
  conversation** (0.9.1 regression). Every conversation change threw away the
  backend’s model list, so the picker showed nothing to choose (only the pill’s
  current model) until the next message, and the context meter lost the model’s
  window. The list now belongs to the backend: only a backend that stops or exits,
  or a sign-in change, clears it.

- **A `!` command is checked again at its real start** (M72). On the Model
  API backend, a `!` command you typed could still start after the workspace
  lost trust, after your Stop, or while the window was closing, when a
  checkpoint safety step was waiting in between. It now checks again just
  before it starts. A command refused there says "The command did not run",
  and the agent is told nothing about a command that never ran (one that did
  run is still told).

- **A shell that could not start no longer blocks Restore.** A missing
  PowerShell or bash, or a command the operating system refuses to start (a
  NUL byte in it, a command line past the system's length limit), no longer
  leaves checkpoint Restore and Redo closed as if a command had run: nothing
  launched, so nothing can still be running. A command that did launch keeps
  the existing safety rule.

- **Turn checkpoints work with long Windows paths.** Git refuses a
  repository path past its own limit however `core.longpaths` is set, so a
  long extension storage path could stop the first checkpoint. The
  repository is now made under a short name and moved into place in one
  step, and long paths are given to git in the spelling it accepts. A path
  git cannot use at all (the checkpoint folder over 240 characters, or a
  workspace over 258, on Windows) now says so ("the path of the workspace
  or of this extension's storage folder is too long for git", in all 14
  translated languages, machine-made) instead of "the checkpoint failed".
  A failed, cancelled or racing first start no longer leaves a half-made
  repository in the storage folder.

- **Checkpoint bundle budget** (M72). The checkpoint store and legacy reader
  ship as `dist/checkpointStore.js`, loaded synchronously at the existing
  activation construction point with the installed language. Startup safety,
  maintenance, activity marks and disposal remain unchanged. A missing or
  malformed store module refuses startup instead of offering unsafe work.

- **Stop across checkpoint waits** (M68/M72). Ordinary writes, first rename
  publication and late formatter writes retain captured owner admission
  through preimage and atomic waits. Refused late formatting preserves the
  completed edit and patch. Revoked diagnostic data is withheld, and check
  commands recheck admission after checkpoint marks and native preparation;
  a proven refusal starts no process and leaves no unknown activity mark.
  Sequential and explicit checks retain their original admission and refusal
  reasons; owned background commands preserve their separate Stop controls.
  Memory reads and note/index writes retain the same original Stop,
  permission-mode, trust and conversation lifetime through their waits.
  Already published notes remain when a later index update is refused,
  with the existing index warning.

- Plan actions recheck current workspace trust and disposal after lookup
  and confirmation; a plan may still be saved after a conversation change,
  while its stale implementation is refused. No-clobber writes check their
  canonical directory before mkdir and their owned stage before publishing
  or cleanup. Stale plan stages that were replaced, moved or refreshed are
  retained.

- **Android/Termux regression coverage** (PR #51). Tests preserve PATH and
  home-directory Muse launcher discovery, XDG credential paths, and explicit
  unavailability of bundled dictation/recording helpers on Android. This is
  simulated platform coverage; no Android device support claim is added.
- **Web fetch rechecks permission before every address attempt.** A permission
  withdrawal while the first connection waits or fails prevents fallback
  connections, stops outstanding attempts and closes late answers.
- **Standalone page-fetch proxy warnings distinguish Node transports.**
  Node 24.0–24.4 can proxy Meta's `fetch` requests while HTTPS page requests
  still go directly; startup now warns about that gap. The ACP package includes
  the page-converter worker and its notices, and documents pinned-IP `NO_PROXY`
  matching.
- **Stop still prevents a rename's first write during its final file check.**
  A cancellation after approval is checked again after the awaited recheck.
  Once a write starts, the remaining rename keeps its existing completion path.
- **ACP paid-grant race tests use canonical temporary paths.** Filesystem
  aliases on macOS and Windows no longer leave the test waiting for a rename
  under a different name. Native path resolution also expands Windows 8.3
  names. The production grant storage and timeout stay intact.
- **ACP sessions keep the newest owner while cancellation finishes.** A
  concurrent reload or close waits for the old turn to stop; an older delayed
  resume cannot replace the newest request. A backend exit while a turn starts
  fails its prompt without an unobserved rejection terminating the agent.
- **Late ACP answers affect only their owning prompt.** Cancelled or completed
  prompts reject late paid-use, approval and question answers; a stale paid
  answer cannot install an Allow always grant for a later prompt.
- **ACP paid grants survive independent process updates safely.** Per-feature
  revocation generations and generation-specific workspace records replace the
  shared JSON map. A stale writer cannot restore revoked permission or replace
  a newer explicit grant. Legacy grants ask again; storage that cannot publish
  safely remembers nothing and retains only the explicit Allow once use.
- **ACP packaging works from Windows paths containing spaces.** npm runs in
  the staging directory with fixed relative arguments. Host documentation now
  distinguishes development-extension integration tests from VSIX installation.
- **Web fetch preserves picture fallback images** (M69). HTML conversion
  now walks `<picture>` instead of discarding it, retaining the fallback
  `<img>` and its alt text under the existing safe-source rules. Source
  alternatives are not selected or fetched; images inside inert templates
  or embedded media remain excluded.
- The Model API verify loop hears about workspace writes before they write
  or format, in every live conversation and subagent. A parent's, child's
  or sibling's cached check grant cannot silently run a changed script
  while its writer waits for formatting. Pending writes survive a new user
  message, reach newly opened sessions, and release on failure; checks
  that start during a write cannot certify its completed state. Project
  memory notes and their index also invalidate checks that name them.
- Symbol renames notify the verify loop before their rechecks, release pending
  notices after Stop or failure, and check only the files actually written.
  ACP conversations opened through native aliases share workspace notices
  without changing their saved-session folder identity.

- **Windows plan-store test stability** (M79). The complete numeric suffix
  range is checked through the existing in-memory file port, with exact
  attempts, unchanged occupied files, the last free name and same-plan reuse
  at that boundary. This avoids 100 staged file flushes in one test on the
  hosted Windows runner; the 5-second timeout and real-file-system
  publication, collision, cleanup and confinement tests are retained.
- **Signing out of Muse Code finishes, and a signed-out CLI no longer reads
  as signed in** (PLAN.md D26).
  - **The cause.** `muse logout` rewrites the CLI's `auth.json` with no
    sign-in in it; it never deletes the file. Muse Code 1.3.0 and 1.4.0 do
    this on every OS.
  - **What went wrong.** The extension took the file being there for a
    sign-in. After any sign-out it went on choosing Muse Code, and the panel
    stayed on "Sign-out is in progress or credentials remain" until a new
    browser sign-in.
  - **Reading the file.** The extension now reads only its structure: the
    schema version, which providers it names, the storage lane of each, and
    whether Muse Code's own (`meta`) holds a key in a shape Muse Code was
    seen writing (`api_key`, `access_token`). Every value, the token
    included, is dropped as the file is parsed. Another entry alone, such
    as the one Muse Code's bundled Slack connector reads, or a `meta` entry
    in any other shape, is not taken for a Muse sign-in.
  - **Asking Muse Code.** When the structure cannot say, the extension asks
    Muse Code itself (`account/read` on a short-lived host). On macOS that
    covers every file but the empty one a sign-out leaves, since no one has
    seen what Muse Code 1.4.0 does there with a file holding the sign-in.
    The extension keeps the answer until the file changes, or until you
    sign in, sign out or choose **Check again**, which always asks afresh;
    pressing it twice asks once. On macOS it asks only when you act: a
    click in the panel, or the **Sign Out** or **Diagnostics** command.
  - **Switching backends.** Whenever the panel moves conversations to the
    other backend (Muse Code signed in after all, a pasted key while Muse
    Code is signed out, an install that found Muse Code signed in, a
    changed `museSpark.backend`), the
    conversation running on the old backend ends first, as a completed
    browser sign-in already did. Before, a Cancel pressed just after the
    browser approved could switch to Muse Code while a Model API
    conversation kept running. A restart that finishes late no longer
    forgets a backend signed in on meanwhile, and a save of the sign-out
    state that fails late no longer keeps conversations shut after a later
    save succeeded. A restart that fails late, or an install's error
    report, no longer replaces a newer state with its error.
  - **Old answers.** An answer Muse Code gives to a question the extension
    had already dropped (after Cancel, a sign-out or **Check again**)
    reaches no one, and a slower, older check never replaces what a newer
    one showed. While a browser sign-in shows its code, a check leaves the
    code where it is.
  - **Signing out.** Sign-out uses Muse Code's own `account/logout` and
    confirms it with `account/read`. Only when Muse Code still reads signed
    in afterwards does it open `muse logout` in a terminal. With
    `META_API_KEY` set, a sign-out no longer opens that terminal every
    time. A sign-out never decides on an earlier answer from Muse Code, so
    a Keychain sign-in made since is signed out too.
  - **Check again after a sign-out.** A sign-out that must wait for the
    terminal, or for `META_API_KEY` to go, now offers **Check again**,
    which its message asks for.
- **Browser sign-in waits as long as the code lives, and ends at once when
  Muse Code ends it.**
  - **The code's lifetime.** A code lasts ten minutes (captured on
    1.4.0-R4302.1). The panel now waits that long and says when the code
    expired. Before, it gave up after five minutes and cancelled a code
    that could still be approved.
  - **Other endings.** A denied code and a sign-in Muse Code could not save
    each have a message of their own. An ending Muse Code has not been
    seen to send is shown in its own word.
  - **Cancel.** It works at once, even when Muse Code stops answering, and
    the code leaves the panel at once. If the browser approved just
    before, the panel follows what Muse Code saved instead of saying the
    sign-in was cancelled. On macOS, where an approval may reach only the
    Keychain, a Cancel after the code was shown asks Muse Code afresh,
    and so does every click that asks it (Diagnostics included), unless
    it already asked during that same click.
  - **Success.** It is taken from Muse Code's `account/read` turning
    signed in, or from a new credential file it does not contradict. When
    Muse Code could not say who was signed in before the flow, its own
    `granted`, borne out by `account/read`, counts too, so a Keychain
    sign-in that leaves the file as it was is seen.
  - **A re-sign-in to the same account** after a sign-out Muse Code could
    not finish is recognized from Muse Code's own `granted`, even when
    only the macOS Keychain changed; before, it waited out the limit.
  - **With `museSpark.backend` set to the Model API,** the panel no longer
    asks Muse Code about its sign-in at all, so a slow answer cannot keep a
    stored key waiting.
  - **A host that exits.** The sign-in fails at once instead of waiting
    out the eleven-minute limit, unless the credential file changed first:
    then the sign-in went through. A change Muse Code already called
    signed out (another Muse process signing out) still counts as signed
    out.
  - **Sign-out and closing the window** no longer wait on Muse Code's
    answer to a sign-in that had just finished or failed. Closing the
    window cancels the sign-in and closes its host and every short-lived
    account host, and a sign-in click still checking the CLI then starts
    nothing. A check that answers after a sign-out no longer holds the
    sign-out gate again.
- **A macOS `auth.json` copied to Windows or Linux is named** as the reason
  Muse Code cannot start, instead of a host that exits at every message.
  That covers an empty version-2 file too: Muse Code 1.4.0 refuses it on
  Windows and on Linux, as it refuses a pointer and a Keychain entry in a
  version-1 file. With `META_API_KEY` set Muse Code starts with any of
  them. The log names that state without the file's path; the panel still
  shows it.
- **The CLI's terminals get `museSpark.environmentVariables`.** The
  terminals for `muse logout`, MCP sign-in and **Open in Terminal** now run
  with them, as `muse serve` does, so with `XDG_CONFIG_HOME` moved they use
  the same config home.
- **Muse Spark: Diagnostics** describes the CLI's credential file by its
  structure and gives the CLI's sign-in state. On macOS it also says whether
  the login Keychain holds Muse Code's item, looked up by attribute only,
  which reads no secret and shows no prompt. Its question to Muse Code
  about the sign-in may still show the Keychain's prompt, as Muse Code
  reads the Keychain to answer.
- **The log keeps no text Muse Code chose.** Its messages can name a folder
  in your profile or your e-mail address, and the log's redaction catches
  only keys. How a browser sign-in ended is logged in fixed words; an MSP
  error by its kind and code; a sign-in state or reason only when shaped
  like a protocol word; and what `muse serve` and `muse skills` write to
  stderr as fixed words for the lines Muse Code was seen writing (an
  unsupported credential file, an unreadable Keychain item, a failed
  model-catalog fetch), otherwise by its length alone.

## [0.9.1] - 2026-09-27

Works with Muse Code 1.4.0, now Meta's stable release, which its launcher
installs by itself.

### Fixed

- **Rename, conversation rewind and Side chat came back on Windows with
  Muse Code 1.4.0, and failed.** The panel hid them only up to Muse Code
  1.3.0, but 1.4.0 still refuses `session/rename` and `session/fork` on
  Windows (meta-models/muse-code-sdk#30, #31). They are now hidden on
  Windows for every Muse Code version until a release is verified to fix
  them, and the message no longer names a version.
- **The warning about a workspace under your Windows user profile was
  missing with Muse Code 1.4.0.** Its sandbox still starts shell commands in
  PowerShell's folder there (#26), so the warning is shown again for every
  version. It no longer says each command takes half a minute, which is no
  longer true on 1.4.0.
- **Every Muse Code 1.4.0 start logged "MSP schema fingerprint mismatch".**
  1.4.0's protocol only adds to 1.3.0's; its known fingerprints are now an
  info line naming the build, and an unknown one is still a warning.

## [0.9.0] - 2026-09-27

Muse Code installs and signs in from the panel, PDFs and text files become
input, and the Model API backend gains subagents, MCP servers, hooks,
memory, goals and scheduled prompts. Conversations can be rewound or
branched into a side chat. Five paid extras arrive, each off until you turn
it on. The extension also works behind corporate proxies and HTTPS
inspection.

### Added

- **Install and sign in from the panel** (M55). Without the Muse Code CLI,
  the sign-in screen offers **Install Muse Code**: it shows Meta's install
  command for your system, runs it in a terminal you can watch once you
  confirm, and offers sign-in when the CLI appears; a timed-out install can
  be retried. **Sign in with your Meta account** shows Muse Code's approval
  code and sign-in link in the panel, with Cancel and a timeout. Account &
  usage offers the same install while you use a Model API key, and lets a
  Muse Code user add or replace the key. After **Sign out**, a note in the
  extension's state (no credential) keeps an old CLI credential from
  signing the window back in until you sign in again; if the logout terminal
  cannot open, the extension still stops its host and says how to finish.
- **PDFs and text files as input** (M54, PLAN.md D47). On the Model API
  backend, pick, paste or drop a PDF of up to 32 MB (recognised by its
  content, whatever its name), and the agent can read workspace PDFs and
  images with `read_file`. A request stays within Meta's limit of 50 images
  and PDF pages together: an attachment that would pass it is refused with
  the reason, and older media left out of a replay is announced. A picked
  UTF-8 text file from the workspace becomes a named text attachment on both
  backends (up to 1 MiB each); private files are refused, and files outside
  the workspace stay mentions. Muse Code cannot take PDFs over MSP, so it
  says so. When the page count of a PDF cannot be read for certain, it
  counts as the full 50. Conversation rewind is not offered for a message
  with a PDF or a text file.
- **MCP servers on the Model API backend** (M50, PLAN.md D42). The window
  runs the MCP servers in Muse Code's settings file itself, local (stdio)
  and remote (streamable HTTP): their tools are offered as
  `mcp__<server>__<tool>`, with schemas fitted to Meta's limits, and their
  text and pictures reach the model. A call asks like a command in Manual
  and Auto (a tool its server marks read-only runs in Auto, as in Muse
  Code); Plan refuses all but read-only tools, which ask; "always allow in
  this session" works per tool. None runs in Restricted Mode. A local server
  sees only a short list of VS Code's environment variables plus its own
  `env`, never the Model API key; `${VAR}`, timeouts and tool filters from
  its entry are honoured. **MCP servers…** in the palette shows whether each
  server is connected and with how many tools, or why not; a failing server
  is a warning, and a required one stops the message with the fix. On
  Windows each local server runs in a job object, so stopping it ends
  everything it started. Remote error bodies and authentication challenges
  stay out of tool errors and logs. The extension's diagnostics tool
  (`getDiagnostics`) is offered on this backend too.
- **Memory, on both backends** (M49, PLAN.md D41). Muse Code keeps Markdown
  notes in three scopes: yours for this project (the default, outside the
  repository), the project's (`.agents/memory`, shared with the
  repository) and yours for every project. Both backends now read and write
  the same notes, found on disk and in a live capture of Muse Code 1.3.0.
  - **Memory…** in the palette (`/memory`, **Muse Spark: Memory**) lists
    up to 500 notes per scope with their scopes and summaries; open one to
    read or edit it, create one, or delete one to the trash after a
    confirmation. The scope's `MEMORY.md` index gains a created note's line
    and loses a deleted note's lines.
  - **The Model API backend** has Muse Code's `read_memory`, `add_memory`
    and `edit_memory`, with its arguments, refusals and JSON results, so
    their rows read the same on both backends; at the start of a
    conversation the model gets each scope's `MEMORY.md` and its notes'
    names, as Muse Code gives them. A new note gets its index line. Writes
    ask in Manual, run in Auto and Edit automatically, and are refused in
    Plan; a refused path asks nothing. Not offered in Restricted Mode.
    Linked scope folders below the workspace or data home are refused, so
    they cannot expose notes outside their intended roots.
  - A new note is created exclusively and published whole: a synced hidden
    copy is hard-linked into a free name, so it never replaces a racing
    writer's note or shows partial bytes, and a filesystem without hard
    links refuses the create. Names with spaces, brackets or percent signs
    are encoded in `MEMORY.md`, so a note keeps one index line.
  - Updates to an existing note replace it atomically but do not take Muse
    Code's native memory lock; simultaneous writers can still lose an update.
- **Session goals** (M45, PLAN.md D38). `/goal <objective>` sets a goal
  the agent keeps working toward; a strip above the task list shows its
  status, a progress bar and the work now and next, with Pause, Resume, Edit
  and Clear (also `/goal pause`, `resume`, `edit <objective>`, `clear`).
  On Muse Code these are its own goal commands, and a resumed conversation
  shows its goal and task list. On the Model API backend the agent gets Muse
  Code's four goal tools with the same results, the goal is saved with the
  conversation and kept in the instructions while active, Stop pauses it,
  and nothing starts a model call you did not ask for. A goal changed while
  a request runs does not take that request's tokens or tool calls, and a
  rejected `/goal` keeps its draft. Built from a live capture of Muse Code
  1.3.0.
- **Your own shell commands: `!`** (M46, PLAN.md D39). A message that
  starts with `!` runs as a shell command in the workspace, outside any
  turn, as Muse Code's `!` does, and gets its own row: **You ran**, the
  command, its exit code, run time and output. The agent sees it with your
  next message. On Muse Code it is the CLI's `session/userShell`; on the
  Model API backend it runs through the shell tool's own runner, with a
  **Stop**. Nothing runs in Restricted Mode, a command that could not run
  comes back to the prompt with the reason, and one Muse Code could not
  start without its Windows sandbox offers the setup, as the shell tool's
  failure does. A running Model API `!` command is saved at once, so
  another surface on the conversation shows its row and can stop it.
  Markdown export includes a command's termination signal when Muse Code
  reports no exit code.
- **Background work you control** (M46). **Move to background** on a
  running shell row, or `Ctrl+B` while the conversation in view runs one,
  lets the command go on while the agent carries on; a background task has
  **Stop** on its row and in the Agent map, which also has **Stop all**
  (and the new **Muse Spark: Stop Background Tasks** command). The header
  pill counts running background tasks. Muse Code's `task/background`,
  `task/stop` and `task/stopAll` on its backend; on the Model API backend a
  moved command runs without its time limit until it ends or is stopped,
  and what it printed reaches the agent with its next request. Releasing
  the last surface of a Muse Code session stops its background tasks;
  another surface holding it leaves them running. A resumed or second
  surface shows a running foreground shell and can move it with `Ctrl+B`;
  while that shell still awaits permission, it shows the same card and
  leaves `Ctrl+B` to VS Code. A fork carries the end or lost-output note
  for each inherited background shell.
- **Explain instead** on question cards (M46): an answer in your own words
  in place of the options (Muse Code's `userInput/clarify`, and the same on
  the Model API backend); the row then reads "Explained".
- **Approvals across panels** (M46). A panel joining a conversation shows
  its open approval cards on both backends, but never automatically
  answers a card that was already pending under another panel's mode. With
  several panels attached every approval needs an explicit choice; a sole
  Edit automatically panel keeps its automatic plain-edit approval.
- **Subagents on the Model API backend** (M48, PLAN.md D45). With the paid
  setting `museSpark.modelApiSubagents` on and its rates accepted, the agent
  can start child tasks. Each runs in parallel within fixed limits, with its
  own transcript, the same tool approvals and workspace rules, and its usage
  counted with the conversation. Every new child task asks first, in every
  mode, Bypass included (Plan refuses it), and one consent covers at most
  four requests, retries included. The Agent map can steer, stop, read and
  reopen children; the child's row and Account & usage show its paid
  attempts and tokens. On Muse Code, the map's Read result and Reopen wait
  for a capture of Muse Code's replies to them.
- **Model API hooks** (M51, PLAN.md D36). With the machine-scoped
  `museSpark.modelApiHooks` on (off by default), the Model API backend runs
  Muse Code's hook commands for all 17 documented events: your
  administrator's, yours and the project's `.muse/hooks.json`, in a trusted
  workspace only. A hook gets JSON on its standard input (your prompt and
  bounded previews of tool and model calls, without images, credential
  fields or the Model API key), runs with time and output limits, and is
  stopped with everything it started. A `PreToolUse` hook can deny a call or
  ask for approval, which a person then answers in every mode; a
  `PreLLMCall` hook can stop a request before it is sent. Unsupported events
  and handler types are reported and skipped; not all of Muse Code's
  event-specific hook output is supported yet. **Muse Spark: Hooks** shows
  whether the setting is on and opens it.
- **Scheduled prompts on the Model API backend** (M52). `/loop` saves a
  prompt with an interval or a five-field cron schedule in the conversation;
  the panel lists due prompts and cancels them. A due prompt never runs by
  itself: with the paid setting `museSpark.modelApiScheduledPrompts` on, you
  choose **Run now** and confirm that run's model and token rates. Prompts
  belong to their workspace, conversation and key, and each occurrence runs
  at most once, across windows and restarts. Anything that changes while the
  price dialog is open cancels that approval. A schedule that would not fire
  within its seven days is refused. On Muse Code, its own `/loop` remains
  available through the model.
- **Conversation rewind and side chats** (M53, PLAN.md D46). **Rewind
  conversation to here** on a sent message branches the conversation before
  it and puts its prompt back in the composer, with its Model API images
  while replay still holds them (otherwise the panel says so). **Side chat**
  opens a Plan-mode branch in its own panel without stopping the main one;
  it runs no hooks, refuses outside MCP tools and scheduled prompts, and
  closing it returns focus to the main panel. Muse Code 1.3.0 cannot fork
  on Windows, so both are hidden there.
- **A row for every tool Muse Code runs** (M43, PLAN.md D36). Memory rows
  show the note and where it lives, and an edit as the text replaced; goal
  rows show the objective, its status, a progress bar, what is being done
  now and next, and the tokens spent; scheduled prompts show their
  schedule, next run and how often they ran; web search shows its results
  as links with snippets, on both backends; a picture the agent read, or
  the Model API backend made, shows in its row. Every other tool in Muse
  Code's list has a name, an MCP tool reads "tool (server)", and any other
  result is indented JSON. All built from a live capture of Muse Code 1.3.0.
  Tool-row pictures now use the checked workspace target and a bounded,
  single-handle read, so a changing link or growing file cannot bypass the
  10 MiB preview limit.
- **Workflows** (M47, PLAN.md D40). A multi-agent workflow Muse Code runs
  is a read-only card that keeps updating after the reply: its label,
  status, what started it, each agent's state, attempt, time and tokens,
  and the result or failure it reported. The **N agents** pill counts
  workflow agents, the Agent map lists the runs and says how Muse Code is
  set to start workflows (`run.workflow_trigger_mode`, read from its
  settings file, never written), and Diagnostics reports that setting too.
  Built from a live capture of Muse Code 1.3.0. Cancel, Skip and Retry wait
  for a capture of Muse Code's replies to them.
- **Web search** (M33). With `museSpark.modelApiWebSearch` on, the model can
  search the web on the Model API backend ($2.50 per 1,000 searches). Each
  search is a row marked paid with its query and results, and a reply lists
  the pages it cites under it (also in `/export`).
- **Image generation** (M34). With `museSpark.modelApiImageGeneration` on,
  the model can create a PNG in the workspace with `muse-image-1.0` ($0.01
  per image). Every image asks first, in every permission mode, Bypass
  included, showing the prompt and the price, with no "always allow"; Plan
  refuses it. A path that is taken, outside the workspace or not a `.png`
  is refused before anything is billed, and a new image never overwrites a
  file.
- **Muse Voice** (M35). With `museSpark.modelApiVoice` on, the microphone
  records for Meta's Muse Voice Transcribe instead of your computer's own
  recogniser ($0.18 per hour of audio), streamed as you speak; the
  transcript lands at the caret. The recorder is `native/windows/capture.ps1`
  on Windows, the macOS helper's new `--capture` mode, and `arecord` or
  `parec` on Linux, which gets a microphone for the first time.
- **Opt in and loud** (M33–M35, PLAN.md D30, D34). Off by default and
  machine-scoped; a confirmation names the price when one is turned on, from
  the palette's new toggles or in settings, and declining it turns the
  setting back off. The composer's badge names what is on, the microphone
  says when it is paid, and Account & usage tallies this window's searches,
  images and seconds of audio with their estimated cost.
- **Image edits** (M44, PLAN.md D37). With image generation on, the model
  can also change one workspace image, or combine up to four, by a prompt,
  into a new PNG (`edit_image`, Meta's `/images/edits`, $0.01 per image).
  The card names the images it starts from; everything that could fail is
  checked before anything is asked or billed. Image-edit sources now read
  their checked canonical targets if a workspace link retargets. New image
  output is reserved at its checked target before any paid request.
- **Images and Muse Voice on the Muse Code backend** (M44). While a Model
  API key is stored, the extension's own `ide` tool server offers Muse Code
  an image and an image-edit tool, and the microphone can use Muse Voice:
  billed to the key, never to the subscription, each image confirmed with
  its price first, the rows marked paid, and the tally in Account & usage.
  The key never reaches the Muse Code CLI.
- **Enterprise networks** (M56, PLAN.md D43).
  - `museSpark.sandboxNetwork` (machine-scoped) passes Muse Code's
    `--sandbox-network`: `proxy-only` (each new destination asks),
    `restricted` (no network for commands) or `enabled`; `default` leaves
    Muse Code's own default or an administrator's managed configuration.
    It applies while the shell sandbox is on, and changing it restarts the
    host.
  - **Muse Spark: Diagnostics** states the network posture (whether a proxy
    is set, never its address; VS Code's proxy and certificate settings;
    where Muse Code's proxy comes from; `NODE_EXTRA_CA_CERTS`,
    `SSL_CERT_FILE`) and prints `muse config status`, Muse Code's managed
    configuration's recognized source and generation fields. Unrecognized
    lines and failed-command output are withheld.
  - A Model API request that never reached Meta says why and what to check:
    an untrusted certificate (a network that inspects HTTPS), a proxy that
    wants credentials or refused the tunnel, or no route, with Node's own
    detail beside it; it read "fetch failed". Quoted credential fields in
    that detail are redacted in full, including spaces.
  - A permission mode above Muse Code's ceiling (its default permission
    profile, or a managed policy) is refused with a sentence saying so and
    what to choose instead.
- **Prompt caching as Meta documents it** (M56). The Model API backend's
  `prompt_cache_key` names the prefix every request starts with (model,
  instructions, tools) instead of the session, so conversations in a
  workspace share their cached start, and `prompt_cache_retention` asks for
  Meta's shorter `in_memory` default. The machine-scoped
  `museSpark.modelApiPromptCacheRetention` setting lets the user choose 24
  hours at the same cached-input price; a repository cannot extend it.

### Changed

- **The Windows job helpers' C# ships beside the host bundle** (M55, M56;
  PLAN.md D6). The shell job type, the MCP launcher and the Win32 half they
  share are `.cs` files under `native/windows/`, read and compiled when a
  helper is first needed, instead of strings in `dist/extension.js`, which
  stays under its 600 KiB budget. A helper built from the earlier source is
  rebuilt once.
- **The Model API backend saves memory with the memory tools** (M49). It
  used to be told to write `.agents/memory` with the file tools, which as
  protected writes asked every time. The personal scopes, left out before
  (PLAN.md D13), are now read and written too, and a memory note must be
  UTF-8, as Muse Code requires.
- **CI** (contributors). Pull requests run the seven cross-platform jobs
  once per reviewed tree; merges to `main` do not repeat them, and a manual
  branch dispatch remains for diagnostics. On Windows, unit test files run
  one at a time and the accessibility gate opens at most two pages at once,
  so the hosted runner is not starved; the pre-commit hook runs its lint and
  format tasks serially. No check, threshold or deadline changed. An
  opt-in live sweep (`npm run test:e2e:live:modelapi`, never in CI) runs the
  Model API backend against Meta's real API, one case per feature, on the
  contributor tier.

### Security

- **A Model API conversation belongs to the key that made it** (M55). Each
  saved conversation and scheduled prompt records a one-way SHA-256 digest
  of its key, never the key. History, reads, resume and fork list and open
  only the stored key's sessions. Replacing the key stops the old host
  first and starts a fresh conversation; a paid image waiting for approval
  or retry is refused rather than billed to the new key. Conversations
  saved before 0.9.0 stay on disk but cannot be reopened.
- **Signing out or changing account clears the panel** (M55). The previous
  account's transcript, tool output, agent views, usage, model and skill
  lists and file chips are cleared; unsent draft text stays. A read, History
  event, rename or message still in flight cannot refill the panel or run
  under the next account. Overlapping sign-outs share one operation, and a
  key write or backend restart already under way finishes before the key is
  cleared.
- **Workspace file access re-checks its target at the moment of I/O**
  (M54). Picked files, `read_file`, `write_file`, `edit_file`, tool-row
  image previews and paid image output read or write the checked canonical
  file through one bounded handle. A link or junction swapped after the
  check, or a file that grows, cannot expose or overwrite anything outside
  the workspace or exceed its size cap.

### Fixed

- **Model API keys in Meta's current format are accepted.** A key that
  starts with `LLM_` (Meta's current keys have no `|`) was refused as
  malformed; both shapes are now accepted, and both are redacted from logs.
- **A question answered the moment it appears is taken** (Model API). The
  card was shown before the question was held as pending, so an answer in
  that instant was refused and the turn waited for ever. Found by the live
  sweep.
- **Account & usage reset timing (M53 follow-up).** The open modal updates its
  countdown each minute and stops treating an expired report as current. It
  uses Muse Code's reported account-level percentages and reset timestamps
  without guessing model or plan multipliers. Sign-out and authentication
  changes clear visible usage; the old global snapshot is no longer read and
  is removed during activation when storage permits. An empty CLI read also
  clears a same-host snapshot. A late read cannot replace a newer report or
  restore a stopped host's usage.
- **A resumed Muse Code conversation shows its task list** (M45). A resume
  asked for inline history, which carries no task list; it now asks for the
  folded snapshot, which carries the task list and the goal.
- **A stopped task read "Failed"** (M46): a row stopped by you or by Stop
  now reads "Stopped" with the reason, and is read out so.
- **The Agent map's note about Muse Code's delegation setting** showed only
  once Account & usage had been opened in that panel (M47). Opening the map
  now reads the setting itself. A map with background tasks also no longer
  says it is empty merely because it has no subagent row.
- **Muse Code behind a proxy lost the IDE tools** (M56). With `http.proxy`
  set and `http.noProxy` empty, Muse Code sent its requests to the
  extension's loopback `ide` server (diagnostics, images) to the proxy,
  which cannot reach them. Loopback is now always in Muse Code's `NO_PROXY`
  whenever it has a proxy, VS Code's or its own.
- **Malformed VS Code proxy settings** (M56). A wrong-typed `http.proxy` or
  `http.noProxy` value is ignored before Muse Code's child environment is
  built; Diagnostics reports the same validated setting state.
- **A command Muse Code moved to the background read "Interrupted"** when
  its turn ended (M43). It now shows what it printed, says it is still
  running, and is listed among the background tasks.
- **Model API conversations that narrate before a tool** (M42, PLAN.md D35).
  Text the model writes before a tool call is replayed as commentary, as
  Meta requires; replayed as an answer, it made the next request fail with
  a 400. A reasoning item is replayed with its summary (empty when there was
  none), and a reply that was reasoning alone is followed by the minimal
  message the docs ask for.
- **A server that stops mid-reply** (M42). A stream that ends because the
  instance shut down or was overloaded is sent again, with the retry notice
  in the transcript; a 502 is retried like the other server errors.

## [0.8.0] - 2026-09-25

The panel in VS Code's display languages: fourteen of them, machine-made
and checked by a gate of their own, with the model's side kept in English.

### Added

- **The panel in fourteen languages** (M40, PLAN.md D33). The panel, its
  notices, the Command Palette's commands and the settings follow VS Code's
  display language: Simplified and Traditional Chinese, Japanese, Korean,
  German, French, Spanish, Brazilian Portuguese, Russian, Italian, Turkish,
  Polish, Czech and Hungarian. Any other language gets English.
  - **Machine-made**, and checked by the localization gate rather than by
    native speakers; the README says how to report a wrong one.
  - **Still English:** text sent to the model, and what Muse and the tools
    write.

### Changed

- **The groundwork for the panel in VS Code's display languages** (M40,
  PLAN.md D33). The panel still reads in English until the translations
  land; what changed underneath:
  - **Whole sentences:** every text the user reads is in one table
    (`src/shared/l10n/en.ts`). A sentence built around a value is one
    template, so a language can put the value where its grammar needs it,
    and a count picks its form by the language's own plural rules.
  - **The manifest:** the Command Palette's commands, the settings and the
    walkthrough take their text from `package.nls.json`.
  - **Text for the model stays English:** what goes to the model is kept
    apart, so the model behaves the same in every display language.
  - **One file at a time:** the host loads the table for VS Code's display
    language and hands it to each panel. A missing or damaged table falls
    back to English, and the log says so.
  - **`<html lang>`:** the panel declares its language to screen readers.
- **Numbers, money and times follow the display language's conventions**
  (`Intl`). In English that changes a few:
  - History's times read "5 min. ago", "3 hr. ago", "yesterday".
  - The usage window's reset reads "2h 5m".
  - A failed Muse Code or sandbox run names its "exit code".

### Fixed

- The Modes menu's highlighted row showed its detail line below 4.5:1
  contrast in the Dark Modern theme (WCAG 1.4.3), as M37 had fixed for the
  palette; it takes the row's own text colour.
- A token count just under a million read "1000K"; it reads "1M".
- Accessibility, found by checking the panel in a pseudo-locale:
  - The palette's and History's search box kept pointing at a list that a
    search matching nothing had removed (`aria-controls`, WCAG 4.1.2). It
    now controls a list only while one is shown.
  - A code block's Copy, Insert and Apply buttons are 24 px targets; with
    longer labels, spacing alone no longer made up for their height (WCAG
    2.5.8).
- The Agent map showed a background task's raw status ("inProgress"); it
  reads "running", like the agents above it.
- The hooks view counted "3 in your settings"; it says "3 hooks in your
  settings".

## [0.7.1] - 2026-09-25

The new mark on the Marketplace listing, the README rewritten for 0.7.0,
and a false failure in the log fixed.

### Changed

- The Marketplace icon, the README banner and the social preview carry a
  squiggled, handwritten blue "m" in the manner of Muse's own mark, in place of
  the plain "M" (at the owner's direction). It is drawn from a curve, not
  traced from Meta's mark.
- The README is rewritten for 0.7.0: a contents list, what is new, the
  limits, accessibility, the protected writes, and the corrections below.
- A file the Model API tools refuse as too large now says to read part of it
  with a shell command; it no longer suggests the search tool, which skips
  files over 1 MiB.
- Setting descriptions: `attachOpenFile` says it also hides the open-file
  chip and sends neither the file nor the selection when off;
  `cleanupPeriodDays` deletes when a window lists the conversations, not
  when it opens them; `backend`'s `auto` falls back to Muse Code's sign-in
  when no key is stored.

### Fixed

- `npm run security:sast` finds a semgrep that pip installed into Python's
  user Scripts folder when that folder is not on the shell's PATH (an
  editor started before it was added), instead of failing with "semgrep is
  not recognized".
- Resizing the sidebar while the prompt held a draft of several lines could
  log a false panel failure ("ResizeObserver loop completed with undelivered
  notifications"): the prompt refitted its height inside the browser's own
  resize callback. It now refits on the next frame.
- The UI harness's `chips` scenario had clicked a button renamed before the
  first release, so it never picked a file; it now uses the Attach menu.
- Four scenarios of the UI harness (`filter`, `agents-off`, `usage-api`,
  `usage`) had failed since M38, when a typed `/` stopped showing the
  palette's filter box, and the accessibility gate checked whatever the
  broken step left on screen. They open the palette from its button again,
  and a scenario that throws now fails the gate.

## [0.7.0] - 2026-09-25

What can be built now without Meta: Muse Code's skills, MCP servers, hooks
and worktrees from the panel, conversations exported, a rewind that finds an
edit that moved, an accessibility gate on every screen, `/` as in Claude
Code, and a log that tells a session's story.

### Added

- **MCP servers…** and **Hooks…** (palette and Command Palette, CLI
  backend):
  - The MCP view lists what Muse Code will load from its settings: each
    server's transport, where it points, whether it is required, and the
    names (never the values) of its environment variables and headers.
  - A remote server can be signed in to or out of through `muse mcp login`
    or `logout` in a terminal.
  - It warns out loud about the two settings mistakes that make Muse Code
    load no server at all.
  - The hooks view shows the project's, your own and managed hooks and
    opens each file.
  - Both views are read-only; the extension never edits Muse Code's
    settings.
- **New worktree…** starts a branch in a folder beside the repository and
  opens it in a new window. **Remove a worktree…** deletes another
  worktree's folder (the branch stays), and asks a second time before
  discarding uncommitted changes.

- **Manage skills…** (palette and Command Palette, CLI backend): a
  checklist of every skill Muse Code knows, built-in, yours, the project's
  and plugins'; unchecking one turns it off through `muse skills disable`.
  Muse Code reads skill changes when it starts, so the change ends with an
  offer to restart it, and the conversation continues on the next message.
- **Import skills…**: shows what `muse skills import` would copy from
  Claude Code or Codex into your Muse skills folder, imports it once you
  confirm, and reports what was imported, skipped or failed.
- "Continue a Claude Code session" and "Continue a Codex session" in the
  palette's Context group, where the session offers Muse Code's
  `resume-claude` and `resume-codex` skills.
- `/export` and **Muse Spark: Export Conversation** save the conversation as
  Markdown (messages, thinking, tool calls with their arguments and visible
  output) where you choose, on both backends; on the CLI backend **Export
  session log…** saves Muse Code's own JSON record of the session through
  `muse export`. An export asked for while a reply runs is refused, with a
  note to export once it has finished (corrected after release: this entry
  said it waited), and a conversation too long for Muse Code to replay is
  pointed to the session log instead of being written as an empty file.

- **Delete** in the History dialog archives the highlighted conversation, or
  restores an archived one, while the search box is empty.
- An accessibility gate: every screen of the panel's test harness is checked
  with axe-core against WCAG 2.2 AA in VS Code's four default themes, with
  colours read from a real VS Code, and any violation fails the build.

### Security

- On the Model API backend a write under `.muse/` asks in every mode but
  Bypass, like `.git` and `.vscode`: `.muse/hooks.json` names commands Muse
  Code runs outside its sandbox and approvals, so an agent on the key could
  otherwise have planted one without asking. Muse Code itself already asks
  before writing it (checked live with 1.3.0).

### Fixed

- A Model API reply whose stream sends nothing for five minutes ends, saying
  so, instead of holding the turn until Stop.
- The file tools refuse a file over 10 MiB before loading it, rather than
  holding any file whole.
- Opened tool-output documents are limited to 32 million characters
  together, as well as 20.
- An image that cannot be read says so in the banner.
- A rewind whose file cannot be read (a permission problem) says why,
  instead of "no longer matches".
- A Muse Code install that cannot be read is named in the log, instead of
  looking like no install at all.
- Accessibility (WCAG 2.2 AA):
  - Diff line numbers, a failed tool's reason and the detail line of a
    selected menu row now meet 4.5:1 contrast in every default theme. A
    failure keeps its red as a bar beside the reason.
  - The palette's and History's lists can be scrolled from the keyboard:
    each is a Tab stop, the dialog stays open while the focus is in it,
    and Escape works from there.
  - Screen readers no longer meet buttons nested inside list rows. The
    effort row is set with Left and Right, and History rows archive with
    Delete; the dots and the × remain for the mouse.
  - Question answers have 24 px rows, so each radio or checkbox is easy to
    hit, and each effort dot in the Modes menu is a 24 px target.
- **Rewind code to here** no longer skips an edit just because you added or
  removed lines above it since. The edit's own lines, matched exactly, are
  found where they moved to when they appear in exactly one place. An edit
  whose lines you changed, or whose lines appear more than once, is still
  refused with the reason, never guessed at.
- A path with a typographic apostrophe, such as `C:\Users\O’Brien`, no
  longer breaks the Windows job helper's PowerShell scripts. PowerShell
  reads ‘ ’ ‚ ‛ as quote characters, and only the plain `'` was being
  escaped.
- The terminals the extension opens (sign-in, Open in Terminal, MCP
  sign-in) single-quote the CLI's path and every argument for the shell
  they run, so nothing in them is expanded.
- On macOS, dictation from the panel asks for speech recognition and the
  microphone as the helper itself (muse-dictate, with its own usage
  descriptions) instead of as Visual Studio Code, which declares no
  speech-recognition purpose and so was refused without being asked
  (microsoft/vscode#307364). The grants cover the helper alone; an update
  that changes the helper asks again.

### Changed

- **The log tells the whole story** (Muse Spark: Show Logs):
  - **Failures:** every failure the panel or a popup showed, and any that
    failed unseen, with a stack where there is one. That covers panel
    actions, commands, background restarts and errors inside the panel
    itself. The panel reports its errors at most ten a minute.
  - **Sessions and turns:** each session started, resumed or forked, with
    its id. Each turn with its result, duration and time to first output.
  - **Also:** approvals (the tool and the answer), sign-in changes, the
    backend in use, and why the backends restarted.
  - **At Trace level:** each Muse Code command's and Model API request's
    time.
  - **Never logged:** prompt text, file contents, dictated words and model
    output. An invalid setting now warns once, not on every read.
- **Faster when replies stream:** streamed text reaches the panel at most once
  a frame, and the panel stops saving its state every second while a reply
  streams (it saves when the turn ends).
- **Smaller:**
  - The Model API's git facts are gathered in parallel.
  - The editor selection is read once it settles, not on every arrow key.
  - Tool output previews are cut at 2,000 characters as well as 12 lines.
  - The diagnostics server starts when a session first needs it.
- **`/` in the prompt** works as in Claude Code. A `/` on an empty prompt
  stays in the box and shows the palette above it, and the box keeps the
  keyboard: Up and Down, `Enter` and `Esc` work the palette. Type a letter
  more and the palette gives way to a list of slash commands narrowed as you
  type, names that start with your letters first. `Enter` runs a command,
  or completes a skill so you can add its arguments; `Tab` completes the
  name. New names in that list: `/model`, `/resume`, `/permissions`,
  `/config`, and `/mcp` and `/hooks` on the CLI backend. The `/` button
  still opens the palette with its own filter box.
- The Agent map and the header's agents pill show running and finished
  agents in the panel's blue, as a running tool's dot is, instead of green.
- The Marketplace publish runs in a `marketplace` environment that only
  version tags can use, holding the publishing token; no other workflow
  run can read it.

## [0.6.0] - 2026-09-23

The hardening release: the findings of a full audit of the code against
other harnesses' bug trackers and the platform documentation, fixed.

### Security

- The Model API backend's file tools resolve every path through the file
  system before using it: a symbolic link or junction inside the workspace
  that leads outside it is refused, for reads as well as writes, and the
  search skips such files. Edit Review and the rewind check the same way
  before writing a file back. Windows alternate data streams (`a.txt:x`),
  device names (`NUL`, `COM1`) and names ending in a dot or a space are
  refused.
- On the Model API backend, a committed `AGENTS.md`, `CLAUDE.md`, memory
  index or project skill that is a link leading outside the workspace is
  skipped, with the reason in the log; its target used to reach the model.
- Protected writes: on the Model API backend, writing git's hooks and
  config, `.husky`, `.vscode`, `.idea`, `.devcontainer`, CI workflows,
  `.agents`, `AGENTS.md`, `CLAUDE.md`, `.envrc` or `.gitmodules` shows an
  approval card in every mode but Bypass, whatever the session's "always
  allow" rules say. Auto used to write them without asking.
- No `git` in Restricted Mode: a repository's own `.git/config` can name
  programs git runs, and the `@` mention index and the Model API prompt ran
  git status and log on the first message in an untrusted folder. git, bash
  and PowerShell are now started by absolute path from absolute `PATH`
  entries only (never a copy inside the workspace), and the Muse Code CLI
  search skips empty and relative `PATH` entries too; a relative
  `museBinaryPath` is refused. git runs with a 15-second timeout and without
  taking the index lock (`GIT_OPTIONAL_LOCKS=0`).
- "Always allow in this session" on a shell command now allows that exact
  command line, not every later command. An approval choice the card never
  offered is refused instead of counting as a yes.
- Bypass permissions ends in every open conversation as soon as
  `allowDangerouslySkipPermissions` is turned off. In a remote window (where
  a dev container definition can write machine settings) a conversation
  never starts in Bypass, and entering it asks once.
- Resuming a conversation that ran on a contributor-tier model asks as
  choosing one does, or, in a confidential workspace, moves it to a
  standard model.
- The shell tool's environment drops the editor's internal variables
  (`ELECTRON_RUN_AS_NODE`, `VSCODE_*` IPC handles) exactly as VS Code's own
  terminal does, and Windows PowerShell gets its own module path.
- The log redacts JWTs, basic credentials, token and password fields and
  credentials in URLs; a `muse serve` stderr chunk is capped in the log;
  the diagnostics report writes the home directory as `~`.
- The release workflow checks the tag (manifest version, on `main`) before
  building, hands the Marketplace token to one step after an install that
  runs no package scripts, and keeps no token in checkouts.
- `npm audit` still blocks releases, with a reviewed, expiring exception
  list for advisories that have no fix.

### Added

- `THIRD_PARTY_NOTICES.txt` ships in the package.
- `museSpark.cleanupPeriodDays` (default 30, as Claude Code's
  `cleanupPeriodDays`): Model API conversations idle longer are deleted
  when a window lists them; 0 keeps them.

### Fixed

- **Edit automatically** now does what it says: plain file-write approvals
  are answered for you (the row says "Edit automatically"); protected
  writes, escalations and commands still show the card. It behaved like
  Manual before.
- The `search` and `list_files` glob no longer builds a regular expression:
  a crafted 37-character pattern held the extension host for 25 seconds.
  Matching is linear, `[!x]` negates and braces nest.
- The Modes menu describes each mode truthfully per backend (Muse Code's
  Manual applies in-workspace edits without asking; the Model API's Auto
  has no safety-check model).
- On Windows the focus and new-tab shortcuts are `Ctrl+Alt+Esc` and
  `Ctrl+Shift+Alt+Esc`; Windows takes `Ctrl+Esc` and `Ctrl+Shift+Esc`
  itself. The walkthrough, the getting-started tips and the composer's
  placeholder name them.
- Dictation says why it is unavailable in a remote window; the Windows
  helper no longer inherits PowerShell 7's module path; a write to a dead
  helper no longer throws.
- On macOS, dictation names the app macOS asks, separates speech from
  microphone refusals, and explains an early exit.
- The crash screen's **Reload** brings the conversation back as it was: the
  transcript, a waiting approval or question and the running turn. A state
  that crashes the panel twice is dropped instead of looping.
- A stopped or failed turn no longer leaves the reply streaming, tools
  running or cards clickable; a tool it cut off reads "Interrupted".
- "Rewind code to here" no longer unwinds a subagent's earlier edits after
  the Agent map has read the agent's transcript.
- **New Conversation** from its keybinding clears the panel too, and acts on
  the panel you last used.
- With an input method (Chinese, Japanese, Korean), Enter commits the
  candidate instead of sending the message or picking a mention.
- Typing and streaming no longer re-render the whole transcript; a code
  block being written is highlighted once, when it is complete.
- A resumed conversation's thoughts read "Thought", not "Thinking…".
- The transcript stays at the end when its content grows without a new row.
- A tab restored after a window reload keeps its conversation until the
  resume succeeds.
- A refused message's images no longer linger unseen in the panel's host;
  they come back to the composer when the host still holds them.
- A question card posts one answer however often Submit is pressed, and
  opens again when the answer is refused.
- Screen readers get one announcement per event.
- Dialogs keep Tab inside and the chat behind them is inert; message menus
  close on a click outside; right-click on a selection offers **Copy**.
- The History dialog's keys keep working after **Show archived**.
- Images over 10 MB, or past 20, are refused before they are read, and the
  banner says why.
- Relative links in a reply open the workspace file at the lines they name.
- Right-to-left text reads right to left.
- Reduced motion stops every animation.
- Tasks with the same text no longer collide; approval feedback starts empty
  on each step; Windows line ends no longer show in diffs; diffs over 256 KB
  keep their line numbers.
- A shell command that times out or is stopped now ends with everything it
  started (a process group on macOS and Linux, `taskkill /T` on Windows),
  and a command that leaves a background process running (`server &`)
  returns when it exits instead of holding the turn open; Stop reaches a
  running command. A flood of output keeps its beginning and its end. On
  Windows each command runs in a job object of its own, so Stop and a
  timeout end everything it started at once, including a program it was
  starting at that moment and one a launcher left behind (`taskkill` missed
  those: they ran on, and one stayed suspended for good); a command that
  ends normally still leaves its background processes running. Where
  Windows policy forbids the job helper, the log says so and a sweep of the
  process table stands in.
- A restart the extension makes (trust granted, a setting changed, a
  sign-in) no longer looks like a crash that blocks every panel: the running
  turn is cancelled, and the next message continues the same conversation.
  After a real crash the turn ends with the reason and the next message
  restarts Muse Code and continues; only an exit that restarting cannot fix
  (a configuration Muse Code refuses, a build without the SDK surface) is
  shown as an error.
- Muse Code gets deadlines: 30 seconds to start, 60 per command (three
  minutes to load, copy or compact a session), so a wedged CLI no longer
  hangs sign-in, switching or sign-out.
- When Muse Code closes or evicts a session, the next message resumes it
  instead of failing; two quick messages start one session; two panels on
  the same session no longer silence (or, on the Model API backend, cancel)
  each other when one closes; a panel closed while its session starts keeps
  nothing running.
- Signing in with the browser waits for a new sign-in, not a stale
  credential file, and pressing the button twice opens one terminal; a
  broken OS keyring no longer blocks the Muse Code backend.
- Model API retries show in the transcript ("Attempt 2/5 failed …"), Stop
  cuts a retry wait short, and a `Retry-After` given as a date is honoured.
- The IDE tool server restarts if its first start failed, and the session
  that needed it waits for it; a failing request answers 500.
- **New Conversation** after a crash or a restart starts a new session
  instead of continuing the old one with its first message.
- Resuming a conversation that was waiting on an approval or a question
  shows its card again, and a turn that was running when you resumed can be
  stopped and steered. Each prompt shows one card, however often Muse Code
  announces it, and a second panel on the same conversation sees the cards
  still open.
- A decision or answer that arrives after the request moved on says so as
  information instead of an error; a refused decision opens the card again;
  a request Muse Code no longer holds loses its card. A step already closed
  by an "always" decision is no longer asked again.
- Updates Muse Code could not deliver are recovered by reloading the
  conversation; a queued message Muse Code withdrew reads "Not sent"; a
  model the account cannot serve, and a message another client withdrew,
  are notices. Unexpected notifications are logged once each.
- On the Model API backend, a tool that fails (a missing folder, a disk
  error) or a call Stop cuts off no longer breaks the rest of the
  conversation; `write_file` creates the folders it needs; a message typed
  while the final answer streams gets its own answer; a compaction runs as
  a turn, so messages sent meanwhile wait and Stop cancels it; Stop ends
  each queued message with a reason; a refusal shows its words.
- Account & usage shows the conversation's totals on both backends (Muse
  Code showed the last request only); the cached rows appear where they can
  be counted.
- A message too large for Muse Code (10 MiB, images included) is refused
  with the reason instead of hanging; its images stay in the composer.
- Output pages and Revert patches no longer break a character in two; a
  binary output says so instead of showing base64.
- The Model API stream tolerates `data: [DONE]`, empty keep-alives and a
  line break split across two reads.
- **Revert** and **Rewind code** no longer trash a file after an edit that
  only added lines to it (such as an import at the top); a created file you
  have added to since keeps your lines; lines an edit deleted are put back
  only where the file still matches, never at a line that moved; a file's
  BOM survives.
- On the Model API backend, edits keep a file's Windows line breaks, BOM and
  final line break, and a multi-line change matches a CRLF file; a file
  that is not UTF-8 text (binary, UTF-16, Latin-1) is refused instead of
  rewritten; a file with unsaved editor changes is left alone; `write_file`
  replaces an existing file only after reading it; writes are atomic, go
  through a symbolic link to the file it leads to, keep a script's
  permissions and refuse a read-only file.
- A shell command's flood of output keeps its end and its exit line; a
  search that runs out of time returns what it found; Windows PowerShell
  output is UTF-8, so accents and symbols no longer come back garbled.
- With autosave off, the panel names the files whose unsaved changes Muse
  will not see.
- Edit Review without an open folder says to open it, instead of resolving
  paths against the extension's own directory.
- On the Model API backend, rules files (`AGENTS.md`, `CLAUDE.md`), skill
  files and the memory index saved as UTF-16 (as Windows PowerShell's `>`
  writes them) load correctly; one that is not text is skipped with a line
  in the log, and no longer hides the other skills. Skill folders that are
  symbolic links or junctions load.
- The Problems-panel tool reports only the workspace's files, by relative
  path, shortens very long messages, and answers a malformed request with an
  error.
- `@` mentions of paths with spaces, `#` or quotes are written in quotes
  (`@"my notes/a b.md"#5-10`), and the mention menu searches names with
  spaces.
- Multi-root workspaces: the first folder is the root for the open-file
  chip, the mention list and search, drops, diagnostics and file links; a
  file in another folder is mentioned by its absolute path.
- Files dropped onto the panel in a remote window (SSH, WSL, containers)
  are mapped as VS Code's own URI transformer maps them, so they insert
  mentions; this is unit-tested, not yet tried in a real remote window.

### Changed

- Integration tests run on the latest VS Code and on the 1.125 floor;
  semgrep and PSScriptAnalyzer are pinned (its install from the PowerShell
  Gallery tried three times); every CI job has a timeout; four
  commands are hidden from the Command Palette where they cannot act; the
  categories are AI and Chat.
- `museSpark.museBinaryPath`, `museSpark.environmentVariables` and VS
  Code's `http.proxy` / `http.noProxy` restart Muse Code when changed; the
  proxy is handed to it when neither its environment nor
  `museSpark.environmentVariables` sets one, in any case.
- On Windows with Muse Code 1.3.0, which refuses both, the panel no longer
  offers Rename and Fork (meta-models/muse-code-sdk#30, #31); "Rewind code
  to here" stays.
- The Model API backend keeps only its conversations' list in memory and
  reads a conversation when it is opened; a file a crash left half-written
  is removed, and a save Windows briefly refuses is tried again.
- Muse Code commands no longer stay in memory after they are answered (the
  SDK kept every one, images included, for the life of the process).
- The Model API shell tool applies `terminal.integrated.env.*` as VS Code's
  terminal does.
- On Windows the CLI always starts as `muse-bin-<version>.exe` (the newest
  one when `.muse-version` is missing), never through its PowerShell
  launcher, which left the CLI running when closed.
- The sign-in and TUI terminals use `/bin/sh` off Windows, whatever the
  default shell.
- The CLI's credential file, settings file and personal skills are looked
  up where the CLI itself looks, including an `XDG_CONFIG_HOME` set in
  `museSpark.environmentVariables`.
- The extension stops Muse Code in `deactivate`, awaited by VS Code.

## [0.5.5] - 2026-09-23

Rewind across subagents, and the repository protected.

### Fixed

- **Rewind code to here** reverts a subagent's edits too. Since 0.5.0 an
  agent's rows live in its own transcript in the Agent map, and the rewind
  only looked at the conversation, so a delegated run's edits stayed on
  disk. Every edit now takes an arrival number when it completes, across
  the conversation and its agents, and the rewind unwinds all of them in
  the reverse of that order, so edits that overlap unwind cleanly. Found
  through a reader's question about overlapping subagent edits.

### Changed

- The repository is protected by GitHub rulesets: `main` cannot be deleted
  or force-pushed and takes changes through pull requests with the CI
  checks green; `v*` tags cannot be deleted or moved; the admin bypasses
  both for direct pushes and releases, logged.
- Dependabot no longer proposes a new major of `@types/node`: the typings
  follow the Node major the workflows and the manifest's `engines` run on
  (22); the 26.x proposal broke the type-aware lint's module resolution.
  The pinned-SHA actions took their weekly bumps (checkout 7.0.1,
  setup-node 7.0.0, setup-python 7.0.0, upload-artifact 7.0.1,
  download-artifact 8.0.1, gitleaks-action 3.0.0).

## [0.5.4] - 2026-09-23

The documentation cleanup; released because the walkthrough, PRIVACY.md and
a setting's description ship inside the package.

### Changed

- A documentation cleanup against the code: the walkthrough says dictation
  is a Windows and macOS feature; PRIVACY.md says the panel lists models
  when it opens while signed in, that the extension only checks whether
  the CLI's credential file exists, and that Sign out and `/logout` are
  one action; SECURITY.md describes the machine-scoped settings and the
  two backends' shell commands as they are; AGENTS.md, CONTRIBUTING.md,
  CLAUDE.md, `.env.example`, the knip comment and two script headers no
  longer describe the key injection removed in 0.1.0, a CI matrix that
  never existed or an interface that does not; the `autosave` setting's
  description matches what it does; PLAN.md's architecture diagram, gates
  table, open questions, budgets and milestone notes are brought up to
  date, with a register row for the test-only `Selection` casts. The
  certification folder gains an index, the harness keeps its Chrome
  profile in a temporary directory, and the Claude Code reference
  screenshots left the repository.

## [0.5.3] - 2026-09-23

### Added

- A way to support the project: the manifest's `sponsor` link puts a
  Sponsor button on the Marketplace listing, `.github/FUNDING.yml` puts one
  on the repository, and the README ends with the same PayPal link the
  author's other projects use.

## [0.5.2] - 2026-09-23

The first community fix, and the README brought up to date with the panel.

### Fixed

- The prompt box grows with wrapped lines as well as newlines, up to ten
  rows, and scrolls inside past that; a long single line no longer hides
  behind a one-row box (#4, reported by dhaw97160).
- The e2e suite's teardown on Windows no longer fails when the fake CLI's
  executable is still held for a moment after its process has exited: the
  temporary folders are removed with retries, and one that still cannot go
  is reported and left to the OS rather than failing a green suite.

### Changed

- The README describes the panel as it is at 0.5.x: the Open diff and
  Revert buttons it still promised are gone since 0.4.2 (the diff editor is
  behind Click to expand, revert is the rewind menu), subagents and the
  Agent map, reply and quote with context, question cards, outputs opening
  in the editor and the usage insights are in the highlights, the release
  workflow's own Marketplace publish replaces the by-hand recipe, the live
  drill's budget and measurements are current, and the three upstream Muse
  Code issues are linked from Troubleshooting. Its eleven screenshots are
  rendered from the shipped panel by the UI harness (`npm run
  harness:shots`) and say so; the 0.1.1 captures are gone.

## [0.5.1] - 2026-09-23

A docs-only patch, and the first release the workflow published to the
Marketplace itself (the `VSCE_PAT` repository secret exists since
2026-09-23).

### Fixed

- The README badges for the Marketplace version and installs rendered as
  "retired badge" on the listing: shields.io retired its Visual Studio
  Marketplace endpoints, so badgen.net serves both badges now.

## [0.5.0] - 2026-09-23

The verification round and the subagent orchestration it called for
(PLAN.md D21): every screen rendered and viewed, the live drills run.
Published to the Marketplace on 2026-09-23 from the release vsix, the first
Marketplace release since 0.1.1.

### Added

- Subagent tool rows are labelled (Spawn agent, Wait for agents, Agent
  status, Message agent, Agent result, Cancel agent), and an approval for a
  tool such as `subagent_spawn` reads "Muse wants to use …". Muse Code gates
  `subagent_spawn` behind an approval: in Manual mode the card appears and
  Allow once lets the agent spawn; Plan mode refuses it by policy.
- **Agent orchestration.** An agent's own replies and tool calls stay in
  its transcript in the Agent map instead of the conversation (they arrive
  with the child session's turn id, seen live). The map's details offer
  Muse Code's owner controls: Interrupt and Stop while an agent runs, a
  note to it, Resume, Close, and a follow-up task once its result is
  ready; its full result text is shown. Usage insights count a subagent's
  run by the CLI's own child marker, not by its tool count.
- 16 harness scenarios for the screens of 0.3.1–0.5.0.

### Fixed

- The usage modal's "what's contributing" section said the Model API has
  no trace logs even on the Muse Code backend; it now says no Muse Code
  trace logs were found on this machine.
- The live reply-only drill's attempt budget is 60 (three measurements:
  31, 45, 25); the CLI's reminder agents loop a varying number of times.

## [0.4.3] - 2026-09-22

Replying to an output and quoting the chat (PLAN.md D20).

### Added

- **Reply to this output**: a hover actions menu (⋯) on every finished
  reply, beside Copy. It puts a "Replying to: …" chip on the composer; the
  message then carries the whole output to the agent as a
  `<chat_reference intent="reply">` context part that says the user is
  replying to it.
- **Ask about this / Comment on this**: highlight any text in the chat (a
  reply, your own message or a tool output) and right-click it. The chip
  reads "Asking about: …" or "Commenting on: …"; the message carries the
  highlighted passage, who wrote it and the intent. Without a selection the
  browser's own menu is untouched.
- The sent message keeps the chip, and the chip's × drops the reference
  before sending.

## [0.4.2] - 2026-09-22

The owner's second F5 round, on 0.4.1 (PLAN.md D19).

### Added

- The path of an edit or read row is a link: it opens the file with the
  changed lines selected and revealed.
- **Click to expand** on every edit diff with a stored patch, opening the
  diff editor (the file side is editable). Shell and edit rows show their
  body from the start; read and generic rows open on click.
- Account & Usage shows the last window Muse Code reported, dated "as of",
  until the CLI reports a fresh one (it only does so after a reply).
- The question card is structured like Claude Code's: radio buttons or
  checkboxes stacked, an **Other** row with a text box, one tab per question,
  **Submit** disabled until every question is answered, and **Cancel**, which
  declines the prompt (Muse Code's `userInput/cancel`).

### Changed

- Thinking rows stream their summary while the model thinks and end as a
  plain "Thought for Ns" line, as in Claude Code; nothing to expand after.
- The **Open diff** and **Revert** buttons under edit rows are gone: the
  diff editor is behind Click to expand, revert is in the message's rewind
  menu.
- No outline on hover over a clickable output block.

### Fixed

- The model pill still read "Starting Muse Code…" until clicked: the pill
  reads the session's model, so the warm-up now posts the model the first
  send will use.

## [0.4.1] - 2026-09-22

The owner's first F5 round on 0.4.0 (PLAN.md D18).

### Added

- The transcript follows new entries while you are at the end (and after
  your own send); scrolled up, it holds still and a **New messages** button
  jumps to the newest.
- A chevron on every tool and reasoning row that opens; it turns when the
  row is open. Rows with nothing to show are disabled.
- **Copy** on each finished reply, shown on hover, copies the reply's
  markdown.
- A tool's output (a shell OUT, a read, a generic output) opens in a
  read-only editor tab on click or Enter, named like Claude Code's
  ("PowerShell tool output (a1b2c3)"); a stored output is paged in full.
- Long inline diffs are clipped behind **Click to expand**: with a stored
  patch it opens the diff editor (the file side is editable), otherwise the
  rows unfold inline.

### Fixed

- The model pill read "Starting Muse Code…" until the pill was clicked: the
  host now starts and lists its models as soon as the panel is open, and
  after a sign-in.
- An approval decision Muse Code failed to record (its "approval ledger
  durability fence" error on Windows) was reported as refused although the
  tool ran; it is now a warning that says the tool may have run anyway.

## [0.4.0] - 2026-09-22

Subagents, the Agent map, the Account & Usage modal, and the smaller
parity gaps the owner spotted (PLAN.md D17).

### Added

- **Subagents.** Muse Code's native subagents appear as rows (role,
  objective, status, duration), an "N agents" pill in the header opens the
  **Agent map**: this conversation, its agents with their tokens, the
  background tasks, and an agent's own transcript read from its child
  session. `/agents` opens it too. When Muse Code's delegation is off (its
  default, `run.subagent_delegation_mode`), the map says so and opens the
  CLI's settings file; the extension never edits it.
- **Background tasks.** A tool call the CLI put in the background carries a
  badge on its row and a line in the Agent map.
- **Account & Usage** is a centred modal with the chat dimmed behind it:
  auth method, plan, backend, Muse Code version and model; the
  subscription bars; this conversation's tokens with the cache-hit rate and,
  on the Model API, a dollar estimate from Meta's published prices; and
  "what's contributing to your usage" for the day or the week, read from
  the CLI's trace logs on this machine (reminder agents, subagents, long
  sessions).
- **Choices as pickers.** Every CLI turn carries a hidden note asking Muse
  to offer choices through `request_user_input` so the panel can show a
  picker; the Model API prompt says the same about `ask_user`.
- **Unsupported uploads** show a dismissible banner above the composer with
  the supported types and the @-mention / absolute-path hint, instead of a
  transcript notice.
- **Compact now**: the context indicator is a button; its tooltip carries
  the pressure level Muse reports.
- Diagnostics reports the CLI's subagent delegation mode.

### Changed

- The fake CLI of the e2e suite scripts subagents and backgrounded calls.

## [0.3.1] - 2026-09-22

The production-readiness verification (PLAN.md D16) and its fixes.

### Added

- A process-level end-to-end suite: a fake Muse Code CLI (an MSP host over
  stdio, a real executable on Windows) spawned by the real backend manager,
  covering a full turn, approvals allowed and rejected, refusal by mode,
  bypass, cancel, history, usage, and the drills (host death mid-turn, a
  malformed frame, a binary that will not start, no binary). Runs in the
  unit gate on every platform, no account needed.
- An opt-in live drill (`MUSE_LIVE_E2E=1 npm run test:e2e:live`): one
  reply-only turn on the real CLI in an empty workspace, with the model
  attempt count read from the CLI's trace log for the session and a
  budget of 40 (measured: 31, one for the answer and thirty for the CLI's
  bundled reminder agents).
- The user message's fork/rewind menu, as in Claude Code: one button
  opening **Fork conversation from here**, **Rewind code to here** (reverts
  every completed edit after that message, newest first, and reports the
  count) and **Fork conversation and rewind code**. Replaces the inline
  "Fork from here" button.
- Tests for the shell tool's error and stderr paths, the mention menu's
  mouse handling, the status line's timer and the effort dots.

### Changed

- The backend manager that spawns `muse serve` is covered by the e2e
  suite and no longer excluded from the coverage gate.
- The conversation controller depends on `AuthPort` and `DictationHandle`
  (the members it uses) instead of the classes; the two test casts are gone.
- `nextPermissionMode` wraps through a non-empty mode list; the type-only
  unreachable branch is gone.

### Removed

- `scripts/measure-markdown.mjs`, an M4 measurement wired to nothing (its
  numbers stay in `docs/certification/m4.md`).

## [0.3.0] - 2026-09-22

Harness parity with the Claude Code extension's preconfigured files
(PLAN.md D15).

### Added

- A four-step **Get started** walkthrough (what the agent is, open the
  panel, sign in, chat and sessions) that VS Code opens on install, and
  **Muse Spark: Open Walkthrough**.
- Commands: **New Conversation** (with an opt-in `Ctrl+N` / `Cmd+N`
  behind `museSpark.enableNewConversationShortcut`), **Sign Out**, **Open
  in Terminal** (the Muse Code CLI's own interface at the workspace root),
  **Create AGENTS.md** (`muse init` when the CLI is present and the
  workspace trusted, else the same template; an existing file is opened).
- Editor-tab conversations come back on their session after a window
  reload: the webview keeps its session id in VS Code's webview state and
  a panel serializer resumes it once signed in.
- Model API backend: the system prompt carries an environment section
  (today's date; git branch, changed-file count and latest commit subjects
  at session start) and working rules (read before editing, edits over
  rewrites, no commits or pushes unless asked, `path:line` references,
  short answers).

### Changed

- The settings that choose what runs and what is billed
  (`initialPermissionMode`, `backend`, `shellSandbox`,
  `allowDangerouslySkipPermissions`, `museBinaryPath`,
  `environmentVariables`) are machine-scoped: a repository's
  `.vscode/settings.json` can no longer set them. The Restricted Mode
  `restrictedConfigurations` list is gone with it (nothing left to
  restrict).
- Keybindings: `Alt+K` fires only with an editor focused, `Ctrl+Alt+F` only
  while a Muse panel or the chat view is focused.
- Starting a new conversation from the panel now tells the webview the
  session is gone (the model pill was already reset).

## [0.2.0] - 2026-09-22

### Fixed

- The Muse Code CLI is started with `--trust-workspace` when VS Code trusts
  the workspace, so the workspace's `AGENTS.md` rules and its
  `.agents/skills` project skills are loaded. They never were: `muse serve`
  skips both without the flag, and every session the extension had started
  since M1 ran without them (PLAN.md D13). Verified live on 2026-09-22 with
  an `AGENTS.md` rule and a project skill in a scratch workspace: before the
  fix the rule was ignored and the skill was `skillNotFound`; after it the
  reply ended with the rule's word and the skill ran.

### Added

- Model API backend: the workspace rules (`AGENTS.md`, `CLAUDE.md` where
  there is none, subdirectory files loaded when a tool first touches a path
  beneath them), the skills (project `.agents/skills` and the personal Muse
  root, a `read_skill` tool, `/id arguments` expanded with the skill's body,
  palette rows that follow the files) and the project memory index
  (`.agents/memory/MEMORY.md`) in the model's instructions, by Muse Code's
  conventions and size limits (`src/core/context/`).
- Workspace trust. The manifest declares `untrustedWorkspaces: limited`
  (in Restricted Mode no rules, skills or memory are loaded and no shell
  command runs on either backend; `museSpark.museBinaryPath` and
  `museSpark.environmentVariables` are not read from workspace settings
  there), `virtualWorkspaces: false` and `extensionKind: ["workspace"]`.
  Granting trust restarts the hosts, with a notice.
- Harness scenarios and screenshots for the sign-in gate (signed out, no
  CLI, waiting, error), recorded in `docs/certification/m7.md`.
- Model API conversations survive the window: each session is saved as a
  JSON file under VS Code's workspace storage for the extension after
  every change (turn, rename, model, effort, mode, fork), the History
  dialog lists stored sessions, and resume and fork bring them back with
  their transcript, replay and edit patches. A corrupt file is skipped
  with a log line; a failed save is logged and never fails a turn.
- The panel has an error boundary: a render error shows the message and a
  **Reload** button that rebuilds the webview document instead of a blank
  panel.
- `Muse Spark: Show Logs` opens the log channel; `Muse Spark: Diagnostics`
  writes a support report (versions, platform, remote, workspace trust,
  backend and sandbox settings, CLI location and version, credential
  presence as yes/no, dictation state) to the log and opens it.
- Repository governance: `SECURITY.md` (private vulnerability reporting
  is enabled on GitHub), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue
  and pull request templates, Dependabot (npm and Actions, weekly,
  grouped) and `CODEOWNERS`.
- `release.yml`: a `vX.Y.Z` tag runs the shared build, checks the tag
  against the manifest version, creates the GitHub Release with the
  `.vsix` and the CHANGELOG section as notes (`scripts/changelog-notes.mjs`),
  and publishes to the Marketplace when the `VSCE_PAT` repository secret
  is set (skipped and reported otherwise).

### Changed

- CI is the reusable `build.yml` (quality matrix, integration tests, the
  macOS helper, the `.vsix`, gitleaks, semgrep), called by `ci.yml` on
  pushes and pull requests and by `release.yml` on tags.

## [0.1.1] - 2026-09-22

### Changed

- The VS Code floor is `^1.125.0` (was `^1.134.0`, with `@types/vscode`
  pinned to match). A clean VS Code 1.130.0 (the owner's Windows 11 VM)
  refused to install 0.1.0 from the Marketplace as "not compatible"; the
  extension uses no API newer than 1.125, which the whole tree typechecks
  against, and the 1.134 floor had only come from the oldest typings on the
  registry at the time.
- README rewritten around the panel: banner, screenshots, highlights,
  quick start, then the reference sections; `media/readme/` holds the
  screenshots, `media/banner.svg` and `media/social-preview.svg` the brand
  art. `npm run images` (formerly `npm run icon`,
  `scripts/render-images.mjs`) renders the Marketplace icon, the banner and
  the GitHub social preview. Marketplace description, keywords and a dark
  gallery banner colour refreshed.
- No logo. The four-point sparkle of 0.1.0 is gone (it is Google's mark);
  the banner and the social image are typography only, and the Marketplace
  icon the listing requires is a plain "M" on the dark tile.

## [0.1.0] - 2026-09-22

The first release: milestones M0 to M9 of `PLAN.md`, both backends,
certified per milestone under `docs/certification/`.

### Added

- Milestone M9, voice dictation: a microphone in the composer ("Tap or
  hold to record (Ctrl+D)", the Claude Code gesture: tap toggles, hold
  records while held; `Ctrl+D` / `Cmd+D` in the composer and Space/Enter on
  the button do the same) that types recognised phrases at the caret, with
  "Starting the microphone…" / "Listening…" placeholders, a pulsing red
  mic, live-region announcements and a Getting-started tip. Recognition
  runs on the operating system's own engine in a helper process the
  extension keeps warm for five minutes: `native/windows/dictate.ps1`
  under Windows PowerShell 5.1 on `System.Speech` (verified 2026-09-22
  against a synthesised recording through the real Windows recogniser), and
  `native/darwin/muse-dictate`, a Swift helper on Apple's Speech framework
  compiled by CI's new `native-darwin` job and shipped by the new `package`
  job's `.vsix` artifact (run on the owner's Mac mini: a Mac without an
  input device gets an error line instead of an AVFAudio crash, the tap
  follows the hardware input format, start steps, levels and results are
  traced on stderr, `--input-device <UID>` pins the capture device, Apple
  chooses on-device or server recognition unless `--on-device` is given;
  Dictation or Siri must be on in System Settings). On Linux, and in a `.vsix` built without the
  macOS helper, the button is dimmed with the reason as its tooltip. No API
  cost, no third-party code, nothing sent to Meta. Gates: `lint:ps`
  (PSScriptAnalyzer over the helper script, real on Windows).
- Milestone M8, account & usage and packaging: an **Account & usage**
  dialog (palette row, `/usage`, `/cost`) showing the backend, the Muse Code
  subscription's current block and weekly window as bars with reset times
  and the observation age (MSP `usage/read`, live through `usage/changed`;
  verified live 2026-09-22 with the CLI on the owner's subscription), this
  conversation's input / output / cached tokens and context, and a link to
  the dev.meta.ai dashboard; a key-billed window says so instead of showing
  bars. Getting-started tips on the empty state with **Hide these tips**
  writing `museSpark.hideOnboarding`. A polite screen-reader live region
  announcing finished, failed and stopped turns, approval cards (with the
  tool), questions, resumes, warnings and errors. Packaging: a Marketplace
  icon (`media/icon.png`, rendered from `media/marketplace-icon.svg` by
  `npm run icon`; deliberately not Meta's logo), `vscode:prepublish`,
  `.vscodeignore` trimmed to the shipped files, `docs/PRIVACY.md`, and the
  Marketplace README. `npm run package` produces the `.vsix`; publishing
  (`vsce publish` with the owner's PAT) is a manual step.
- Milestone M7, the Meta Model API backend: with a pasted key the panel
  talks to `api.meta.ai/v1` itself (streamed `POST /responses`, stateless
  reasoning replay with `store: false`, the documented 429 / 500 / 503
  backoff with `Retry-After`) and runs its own tools (Read, Edit, Write,
  Search, List, PowerShell / bash, questions, task list) confined to the
  workspace, behind the same permission modes and approval cards; `/compact`
  summarises in one call; sessions, resume and fork for the window; the
  `museSpark.backend` setting (`auto` / `museCode` / `modelApi`), a Backend
  row in the palette, the sign-in gate offering the paths the selection
  allows (the key path works without the CLI), and a contributor-tier guard
  (one modal yes per conversation; hidden and refused in a confidential
  workspace) on both backends. The internal `AgentHost` / `AgentSession`
  protocol now sits between the controller and either backend.

- Milestone M6, sessions and history: a **History** dialog (header clock or
  `/` → Resume) over the workspace's stored Muse Code sessions
  (`session/list`, paged), grouped Today / Yesterday / Previous 7 days /
  Older with search on names and branches, relative times, turn counts and
  fork marks, live through `session/listChanged` / `session/closed`
  (`sessionListStream` capability); **Resume** rebuilds the transcript from
  the stored history (`session/resume` with `history: inline`, snapshot
  state when the host serves that; your messages as cards from their
  `displayText`, image chips from the attachment metadata) and continues the
  session live, seeding the model from the catalogue's active row and
  applying the surface's effort and permission mode; **Archive** /
  **Unarchive** per row and `museSpark.archiveInactiveSessions` (1 / 2 / 7 /
  14 days or never, default 14) kept in workspace state — hidden, never
  deleted; the sidebar resumes its last session when reopened within ten
  minutes of its last activity (Claude Code's rule), tabs always start
  fresh; **Rename** by clicking the header title (`session/rename`, the
  canonical name shown) and **Fork from here** on your messages
  (`session/fork` with the previous turn as the cut point; a fork before the
  first message is a new conversation) — both offered everywhere and
  refused by Muse Code 1.3.0 on Windows, which the panel reports as a
  notice; an unread badge on the hidden sidebar view and a `●` on a
  background tab when a turn completes or the agent waits for an approval
  or an answer; the tab and the view description follow the session name.

- `museSpark.shellSandbox` (`auto` / `muse` / `off`, default `auto`): how
  shell commands run. `auto` keeps Muse Code's OS sandbox except for a
  Windows workspace under the user profile, where the 1.3.0 sandbox cannot
  run commands in the project (meta-models/muse-code-sdk#26); there the host
  is started with `--disable-sandbox` and commands run directly as the user,
  in the project, still gated by the approval cards, as in Claude Code. The
  transcript explains the switch once per session; changing the setting
  restarts the host on the next message. Verified on the same workspace:
  `--disable-sandbox` runs `Get-Location` in the workspace in 14 s, the
  legacy shell tool does not help.

- Milestone M5, editor integration: the open-file chip beside the model pill
  (`App.tsx L5-10`, `×` to leave it out) sends the active file or selection
  with the message in Claude Code's own wording (`<ide_selection>` with the
  selected text, `<ide_opened_file>` for a bare file; excluded files share
  their path only) while `turn/start.displayText` keeps the transcript to
  what was typed; autosave of every dirty editor before a turn; **Open
  diff** and **Revert** on finished Edit / Write rows, rebuilt from the
  stored patch document through a `muse-edit:` content provider and
  `vscode.diff`, refusing when the file changed since; **Apply** on code
  blocks (replace the selection); a per-window IDE tool server (MCP over
  loopback HTTP with a bearer token, requested through the `sessionMcp`
  capability and registered with `session/start`) exposing `getDiagnostics`,
  the errors and warnings of the Problems panel. Harness scenario `editor`.
  Tool rows now label the CLI's `search` tool (`Search`, with its pattern)
  and the IDE tool (`Diagnostics`), both seen on the live M5 turns.

- Windows shell-sandbox setup from inside the extension (`PLAN.md` D12): when
  a chat opens, `muse sandbox windows check` runs once per extension host and
  a `setup_required` result raises a notification with _Set up now_ / _Not
  now_ / _Don't ask again_; _Set up now_ relaunches `muse sandbox windows
  setup` through the UAC prompt, re-checks, and reports. The new command
  **Muse Spark: Set Up Shell Sandbox** runs the same flow on demand, and a
  shell tool failing with `sandbox enforcement unavailable` re-offers it. The
  transcript notice now names that command instead of a terminal recipe.
- Approval cards lock the decided stage until the host moves to the next
  stage or resolves the approval; the host was seen repeating
  `approval/updated` for an already-decided stage, and a second decision on
  it is rejected as `already resolved`.
- A one-time notice on Windows when the workspace is under the user profile
  and the CLI is 1.3.0 or older: that CLI's sandbox cannot enter
  `C:\Users\<you>`, so shell commands start in PowerShell's own folder (about
  34 s each) instead of the project; file tools are unaffected. Verified
  through the panel's controller and through `muse exec` alike.

### Verified

- Live shell approvals through the panel after the owner's sandbox setup:
  a two-stage `allow_once` line ran inside the sandbox and an `abort` with
  feedback was honoured (`docs/certification/m4.md`). `reasoning` items with
  `summary.N` deltas appeared on those turns, so the reasoning row is
  live-exercised.

- Milestone M4, transcript rendering: assistant replies as GitHub-flavoured
  markdown (react-markdown 10.1.0 + remark-gfm 4.0.1; raw HTML never
  rendered, images as alt text, links through the host with an
  http/https/mailto allow list) with highlighted fenced code (highlight.js
  11.12.0 core, 18 grammars, Copy and Insert at cursor); tool rows for every
  `toolCall` item (`Read` / `Edit` / `Write` / `PowerShell` / `Bash` /
  `Question`, status dot, `Added N lines` / `Removed N lines` / `Modified`
  from `patchSummary`, line-numbered diffs from the stored `tool_patch`
  document via `item/readOutput` with the edit tool's unified `visibleOutput`
  as the interim view, `IN` / `OUT` boxes for shell tools, clipped outputs
  with Show more, generic rows for unknown tools and item kinds); reasoning
  rows ("Thought for Ns", summary parts); approval cards from
  `approval/requested` → `approval/decide`, following multi-stage
  `approval/updated` (step n of N) with the CLI's own choices and optional
  feedback; question cards for `request_user_input` → `userInput/answer`
  (single, multiple, free text); the pinned task list
  (`session/todoListChanged`); retry notices (`turn/retryScheduled`); the
  session name in the header (`session/nameChanged`); the context-window
  indicator in the composer; a status line with a rotating verb while a turn
  runs; image chips inside user cards; Focus view folding steps behind one
  expandable row (a card waiting on the user is never hidden). The `initialize`
  handshake now declares `userInputDialogs`, `HAS_APPROVAL_UI` is on so
  Manual / Edit automatically / Auto run as their real MSP modes, and the
  `approval/request` / `userInput/request` server requests are declined
  quietly because the commands settle them. A one-time notice explains
  `muse sandbox windows setup` when the shell tool reports the sandbox is not
  set up. Harness scenarios `markdown`, `tools`, `approval`, `question`,
  `todo`, `focus`, `long`; `scripts/measure-markdown.mjs` for render cost.

- The permission-mode button opens a **Modes** menu (Manual / Edit
  automatically / Plan / Auto with one-line descriptions, `⇧ + tab to switch`,
  a tick on the current mode, and an `Effort (level)` row with the dots in
  the footer), matching the Claude Code popout; the palette's "Permission
  mode" row opens the same menu. Shift+Tab still cycles.
- `museSpark.allowDangerouslySkipPermissions` (default off): lists Bypass
  permissions in the Modes menu and the cycle, as the Claude Code setting of
  the same name does. While off, the host refuses `bypassPermissions` with a
  notice, and `initialPermissionMode: bypassPermissions` starts in Manual with
  a logged warning. Replaces the modal confirmation.
- The `+` button opens an attach menu: _Upload from computer_ (the native
  dialog) and _Add context_ (starts an `@` mention at the caret).
- Effort tiers verified live per model (one turn per tier through Muse Code
  1.3.0; `PLAN.md` D10): the slider offers Minimal / Low / Medium / High /
  Extra high / Max on `muse-spark-1.3` and stops at Extra high on
  `muse-spark-1.2`, which rejects `max` with a 400; every dot names its tier
  in a tooltip and to assistive technology, and switching to a model that
  does not serve the current tier drops to the highest tier it does.
- The composer placeholder reads "Queue another message…" while a turn runs.
- The Meta logo the owner supplied is the brand mark in the panel's empty
  state and the activity-bar icon (`media/icon.svg`, single-colour mask).
- Harness scenarios `modes`, `modes-bypass`, `attach`, `add-context`; the
  owner's Claude Code reference screenshots under `docs/reference/`.

- Milestone M3, composer and command palette parity: the "/" palette
  ("Filter actions…"; Context / Model / Customize / Account & usage / Skills /
  Slash commands / Support; keyboard-only operation; opens from the "/" key
  on an empty draft or the slash button), "+" attach (native file dialog;
  PNG/JPEG/GIF/WebP become `name W×H` chips sent as MSP image parts, other
  files become `@path` mentions), paste and drop of images, drop of editor
  resources as mentions, `@` mention autocomplete over a `git ls-files`
  index (`.gitignore` respected, VS Code file search as the fallback), the
  model pill + picker (`model/list`, `session/setModel`, context window shown
  as "1M"), the effort slider (Low … Max → `session/setReasoningEffort`,
  default High like the CLI) and Thinking toggle (Ctrl+O; off sends `none`),
  the permission-mode button and Shift+Tab cycle (Manual / Edit automatically
  / Plan / Auto / Bypass permissions; Bypass asks for confirmation), skills
  from `skill/list` typed as `/selector args` and sent as skill parts, Enter
  while a turn runs steering that turn (`turn/steer`) with a fresh-turn
  fallback, `/clear`, `/compact`, sign-out and host notices in the transcript.
  Until the approval cards land (M4) every permission mode except Bypass
  still runs as `denyUnmatched`; the mapping is recorded in PLAN.md D7.
- `npm run harness:shots` (`scripts/harness-shots.mjs` + `test/harness/`):
  renders the built webview in headless Chrome behind a scripted fake host and
  writes one screenshot per scenario (palette, model list, pill toggle,
  mentions, chips, transcript, Shift+Tab, effort filter). The visual check
  behind the certification records.
- The header's new-conversation button now starts a new conversation in the
  same panel (Claude Code behaviour); a new editor tab remains available via
  `Ctrl+Shift+Esc` and the view-title `+`. The `openNewTab` webview message
  was removed.
- Milestone M2, sign-in and the Muse Code backend: locating the CLI per
  platform (Windows `muse-bin-<version>.exe` from `.muse-version`, PowerShell
  launcher fallback, POSIX `~/.local/bin/muse`), a sanitised child environment
  (Windows `PSModulePath`, optional `META_API_KEY`), `muse serve` spawned
  through `@muse-code/sdk` with a host wrapper that multiplexes one MSP
  session per panel; sign-in gate with browser (`muse login` in a terminal +
  credential-file watch) and API-key (secret storage) paths, sign-out, and the
  host's `authRequired` verdict overriding the presence check; optimistic
  message echo with `turnAccepted` / `sendFailed`, streamed replies, Stop,
  session model in the pill, token and context usage tracking. Unmatched
  approvals are denied until the approval cards ship (M4).
- Milestone M1, panel shell: header with Focus-view badge, history (disabled
  until M6) and new-conversation buttons; empty state with the
  "Type /model…" hint; composer with Enter / Shift+Enter / optional
  Ctrl+Enter semantics, auto-growing textarea, attach and slash buttons
  (disabled until M3), model pill, permission-mode label and Send (disabled
  until M2).
- Keybindings mirroring Claude Code: `Ctrl+Esc` toggle focus, `Ctrl+Shift+Esc`
  new tab, `Alt+K` insert `@path#lines` for the selection, `Ctrl+Alt+F` toggle
  Focus view; `+` in the sidebar view title opens a new tab.
- `museSpark.*` settings (`preferredLocation`, `initialPermissionMode`,
  `autosave`, `attachOpenFile`, `useCtrlEnterToSend`, `hideOnboarding`,
  `focusView`, `respectGitIgnore`, `confidentialWorkspace`, `museBinaryPath`,
  `environmentVariables`) validated at read time and pushed live to open
  panels.
- Redacting logger (Meta API keys, bearer tokens, `META_API_KEY=` /
  `MODEL_API_KEY=` assignments) in front of the output channel; typed
  host ⇄ webview messages (`init`, `settingsChanged`, `focusInput`,
  `insertText`, `ready`, `inputFocusChanged`, `openNewTab`).

### Fixed

- **Billing**: the Model API key pasted into the panel is no longer handed
  to the Muse Code CLI. The CLI prefers `META_API_KEY` over its own sign-in,
  so subscription work was billed to the key whenever one was stored. The
  CLI now runs on its own credential only; the pasted key drives only the
  Model API backend. Verified live with no key anywhere
  (`docs/certification/m7.md`).
- The History button toggles the dialog closed as well as open (its click
  used to blur the search box shut and reopen it), and the dialog hangs
  from the header rather than rising from the composer.
- The composer toolbar fits a narrow sidebar: the model pill ellipsizes
  instead of clipping both ends (it was a centred flex row), the open-file
  chip shrinks, the right-hand group keeps the mode button and Send whole,
  and under 340 px the context percentage and the mode label give way to
  their icons.

### Changed

- The model pill reads `model effort` (the context window moved to the model
  list rows), and it hugs its text instead of the 26 px control height.
- Toggle Thinking is `Ctrl+Alt+T` on Windows, `Option+T` on macOS (the Claude
  Code binding) and `Ctrl+Alt+O` on Linux instead of `Ctrl+O`; the owner found
  `Alt+T` opens the Windows Terminal menu before the composer sees it.

### Fixed

- The model pill and the slash button now toggle: a second click closes the
  list or palette (a mousedown on either no longer blurs the palette shut).
- The extension version label in the panel's corner overlapped the Send
  button and carried no information the Extensions view does not; removed,
  along with the `extensionVersion` field of the `init` message.
- The "/" palette and the model list were positioned against the whole panel
  and rendered above the viewport, so `/`, the slash button and the model
  pill appeared to do nothing in the first M3 F5 check; both now anchor to a
  wrapper around the composer.

### Security

- GitHub Actions pinned to full commit SHAs and npm given a minimum release
  age of 7 days, both raised as blocking findings by the semgrep CI job.

### Added

- Project scaffold (milestone M0): TypeScript 6.0.3 extension host + React 19
  webview bundled with esbuild; strict type-checked ESLint 10 (typescript-eslint
  `strictTypeChecked`, unicorn, react-hooks), Prettier, stylelint, knip, dpdm,
  jscpd, vitest with coverage thresholds, `@vscode/test-cli` integration tests,
  gitleaks, npm audit, husky + lint-staged pre-commit, GitHub Actions CI
  (ubuntu + windows quality matrix, gitleaks, semgrep).
- Minimal extension: `Muse Spark` activity-bar container with a `Chat` webview
  view, `Muse Spark: Open in New Tab` and `Muse Spark: Open in Sidebar`
  commands, nonce-based CSP, zod-validated host/webview message contract, and
  an empty-state shell ("Type /model to pick the right tool for the job.").
- `docs/certification/m0.md`: every gate run on the scaffold and proven to fail
  on a deliberate break. Findings: `knip --strict` analysed nothing (strict
  implies production mode, which needs `!` entries) so the gate is plain `knip`;
  the integration tab test polls `tabGroups` instead of reading it synchronously;
  `npm audit` high in the dev-only mocha chain resolved with `overrides`.
- `PLAN.md` with research notes (Meta Model API, Muse Code SDK / MSP, Claude
  Code extension parity inventory), architecture, decisions, and milestones
  M0–M8.
