# Historical 0.15.0 integration notes

These are the accumulated train notes before release consolidation. Later entries
can supersede earlier integration limits; the release changelog and current
certification record describe the final candidate. This history is not shipped
in the extension.

## [0.15.0] - 2026-10-06

### Highlights

- **Bring your own models.** Add OpenAI, Anthropic or Gemini keys, connect local models, or try ChatGPT and Copilot sign-in in Models & Agents; features follow the selected model's capabilities. <!-- try: command museSpark.modelsAndAgents -->
- **Agent roles and teams.** Configure role pools, task limits and worker review, with explicit paid-worker consent and the shared daily budget. <!-- try: command museSpark.modelsAndAgents -->
- **Scan with /legal.** Review licensing, copyright and source evidence without a model call, then export the report or confirm supported header fixes. <!-- try: command museSpark.legalScan -->
- **Long-task context and upstream sync.** Pi and SoL-Pi ports preserve packed output, literal recall and cache-stable prompts; automatic compaction is implemented but remains inactive pending its paired evaluation. <!-- try: setting museSpark.modelApiAutoCompaction -->
- **Usage and cost.** Open the local Usage & Cost page for provider and team totals, reported or estimated tokens, budgets and exports. <!-- try: command museSpark.openUsagePage -->

### Changed

- Restore the inherited startup size ratchet by loading the legal report,
  review comment form, optional English text and optional keyboard contexts
  on demand. Keep complete translation validation, first-paint controls,
  accessible loading and retry, and existing bundle caps.
  Wait for workflow-map controls and its loaded tree in the accessibility
  harness instead of timing the clicks.

- Share chat, Models and Usage browser dependencies in one emitted graph;
  load the optional panel bodies on demand with separate measured budgets.
  Preserve the pages' specific failures and Models' host error reports.
  The authenticated ACP companion resolves their dynamic shared chunks under
  its existing nonce policy.
  Set this train's universal VSIX cap to 2775 KiB from the measured package
  plus 5%, rounded up to 25 KiB; existing individual bundle caps stay fixed.

### Added

- Generate Help & Reference for the train's providers, usage, legal scan,
  teams and compaction, including their current CLI routes and paid-budget
  conditions. Keep the reference lazy and losslessly encoded within its
  existing bundle cap.

- Keep release package fixtures current with the canonical CLI help source
  and required Help bundle. Run package rejection cases independently under
  the default test deadline, and check installed ACP help in all archived
  languages without changing request goldens.

- Record production headless BYO usage at the shared transport boundary, enforce a shared ACP/headless daily budget before dispatch, and defer optional hooks and MCP connections to preserve Model API headroom. New train bundles have measured budgets; existing startup and universal package caps stay fixed.

- **Bring-your-own-model keys and panel host (M95 lane K).** The `Start
with Your Own Model` wizard (in-memory draft; Save writes
  `providers.json` and the secret together, Cancel discards), the
  `Models & Agents` panel host with its validated bridge, and the
  `Add Model Provider…` quick-pick fast path: SecretStorage records
  bound to their origin, the password box with the preset's live shape
  check, the one-shot `127.0.0.1` OAuth callback, the local-server
  probe, OpenRouter connect and key usage, cached model scans with
  diffs, removal with Undo, import/export without secrets, and the
  workspace preset suggestion.

- **First-run and usage UI for bring-your-own providers (M95 lane U).**
  The sign-in gate offers Start with your own model beside the other two
  (ranked equally with no backend set up); a finished setup confirms once
  with Manage providers. The model picker groups by provider with pinned
  favourites first, priced/unpriced/local/plan details and provider rows;
  the composer pill names the provider; Account & usage lists per-provider
  tallies with OpenRouter key usage and unpriced/local costs. A confidential
  workspace hides training models from the list and refuses them on switch.

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

- **M96 integration round 3c (unreleased internals).** Reconcile W's final
  worker fixes with the shared Git classifier and retain the D78 conditional
  recall request contract. Tree, cards, worker labels and team usage share a
  separately budgeted lazy browser chunk. The package diet archives exact lazy
  bundle bytes and translation values. The release integration uses maximum
  Brotli quality under the existing staging deadline and unchanged bundle caps.
  The report frame allowlist includes the shipped team bundles, and the paid
  worker row explains its price in the existing localized consent text.
  Package fixtures follow the final split inventory; the native retirement
  regression advances its test clock while retaining real process ownership.

- **Traffic browser harness integration.** Load one ESM surface per scenario
  and wait for the Traffic readiness marker before accessibility scanning.
  Browser regressions cover all five Traffic and runner scenarios.

- **Team settlement integration (unreleased internals).** A and K share
  one durable settlement algorithm while keeping their own error messages.
  End-write recovery tests arm their injected failure before a child can exit.

- **M96c X2 package adapters (unreleased internals).** The team factory loads
  board/scheduler tools and runner/Traffic host capabilities on demand; VSIX
  and ACP packages include their bundles and runner helpers. Tool schemas
  are generated from the production validators. The missing Models & Agents
  panel and team runtime bindings remain an integration prerequisite.
  The English fallback uses a lossless build-time encoding; strings and
  installed-language behavior are unchanged.

- **Team strings, constants and schemas (M96 lane 0, unreleased
  internals).** Shared pool, task, usage, ledger and Agent map contracts,
  charter templates and recovery/landing text with all 14 translations.
  Pool entries retain model settings, and ledger task rows retain their
  required task identity. Team validators install when the team activates,
  keeping single-model activation, Model API and ACP bundles free of them.

- **Agent roles, charters and tool sets (M96 lane R, unreleased
  internals).** The new `src/core/team/` holds the seven built-in roles
  and their generated `AGENT.md` files, the role keys on M76's parser with
  shadow-only narrowing and the new-id ceiling, the seven-part charter
  generator, the one tool-set definition behind allowlists, the charter's
  "You may" line and the panel checklist, the model-into-role capability
  check, same-model identity, and the workspace team with the
  `.muse/team.json` lowering merge — with tests, translations and the red
  drills in `docs/certification/m96-r.md`. Nothing team-related loads or
  changes requests for a single model.

- **M96 agent roles, lane A (pools, accounting and the ledger)**: pool selection takes the first entry with headroom and moves down the line at a cap, a rate limit or a usage limit, with one switch row and one `TeamAgentSwitch` per move; `continue on next` hands the task off with a brief on the same branch; the exhausted policy answers `ask` (Queue it, Main agent does it, Raise a limit…, Cancel), `queue` (recoverable reasons only, then it asks) or `self`; meters sum ledger rows plus open reservations per measure and window, reported or estimated, charged to the sending entry; the ledger keeps one redacted row per delegation in a daily append-only file, with interrupted rows and retention rollups. New paid feature `teamWorkers` (`museSpark.modelApiTeamWorkers`, on with one price question before the first charge): each delegate call that starts key tasks asks once with each model's prices, each task's ceiling and the shared daily budget.

- **Team templates, autofill, intensity, validation, preview and transfer
  (M96 lane F).** Pure core: the four team templates with suggested pools,
  the four suggestion kinds with reasons, dismissals and learning from the
  local record, the five intensity levels with custom-role keeping and the
  throttle backoff, per-model settings with cost notes, inline cap
  validation, the no-model-call preview with cost ranges, and credential-
  free export with strict import. Strings in all 14 tables.

- **Team workspaces and integration (M96 lane I).** `src/core/team/` holds the
  `agents/<role>/<task-id>` workspaces on the Best-of-N infrastructure
  (shared clones with no remote, scratch copies for read-only workers, the
  end-of-task commit and fetch), the ref fence (the worker git guard, the
  read-only shell list, the credential-free environment, the `agents/` ref
  check), the per-file three-way merge with `git merge-file` (conflicts with
  markers, protected paths, `write-paths`, Undo merge), and review-before-merge
  with the reviewer pick that differs from every author.

- **The Agent map's team tree and transcript cards (M96 lane U2).** Once
  the team runs, the Agent map grows a team tree — the orchestrator at the
  root, roles with mode and tools, pool entries with caps and headroom, and
  each entry's workers with Open transcript, Stop, Review diff, Merge and
  Discard — with WAI-ARIA tree keyboard support and the same items at
  320 px. The orchestrator's transcript shows the delegation plan, one row
  per switch, the four-choice "waiting for you" card, the merge card and
  each task's report row; a worker's own approval or question card carries
  the panel-drawn role, agent and task label. Account & usage gains a Team
  section, and the header pill counts team tasks. With one model the panel
  is exactly today's: no team UI loads or changes requests.

- **Integrated the M97 legal-scan candidate.** `/legal`, its slash-palette
  action, the native Model API tool, Muse Code's read-only `ide` tool and the
  ACP package's top-level `legal` command now load the real scanner from
  `dist/legalScan.js`. Manifests/locks, local license evidence, distribution
  notices, SPDX expressions, headers and asset/source provenance are examined
  without a model, network, writes, builds or installs. The report shows
  distribution assumptions and exclusions, with localized percentage formatting.
  The Model API manager forwards the scanner only to its workspace host.

- Packaged the pinned SPDX identifier data, provenance and attribution in the
  VSIX and ACP package, and added a 150 KiB lazy-scanner cap from the lane-S
  measurement plus D6's margin. Existing caps are unchanged. Regenerated
  third-party notices and the host API record from the integrated build.

- Added the translated command-palette contribution and real-scanner adapter
  regressions. Fixed merged duplicate constants, an optional-options test type
  and incomplete logger doubles without weakening gates.

- Integrated the B/R review fixes: one shared scanner entry, host-owned Plan
  hold, signed-out routing, strict reserved-command usage, turn/Stop admission,
  trust rechecks, registry redirect refusal, error redaction, JSON disclaimer
  and version-aware bundled-skill links.

- Kept queued cancellation in the canonical scanner entry using the existing
  Node global scheduler, without adding a scanner import exception.

- Reused the legal scan's bounded schema fields and factored repeated legal
  test fixtures after the unchanged zero-duplication gate rejected the merge.

- Documented the candidate's limits. The selected-fix applier, requested
  Markdown export, scanner-prose translations, enrichment consent/network
  review, optional explanations and installed/Windows certification remain
  open. Headless uses top-level `legal` and treats `should-fix` as exit 1;
  real scans always report incomplete coverage. The scan is not a legal certificate.

### Changed

- Legal validators and paid accounting share the existing Node boundaries; maximum Brotli quality preserves every runtime archive value without raising individual bundle caps. Legal explanations follow the interactive Model API paid defaults and shared ledger on both backends.

- The lead sets the universal 0.15.0 VSIX cap to 2475 KiB from the measured
  package plus 5%, rounded up to 25 KiB, for providers, teams, compaction and
  usage. Every individual bundle cap remains unchanged.

- M96's structured state/edit tail now loads from the existing team runtime
  after a team tool answers, preserving the first-request path and every
  individual bundle cap.

- Share captured Model API validators and pure team admission in an independently budgeted Node bundle; load paid usage rows only when the report includes paid features. Existing size caps and usage behavior stay fixed.

- Account & usage loads provider tallies in their own chunk when a nonempty
  provider report is shown, keeping the original deferred bundle allowance.

- Chat, Models and What's New share one browser splitting build; common React,
  validation, bridge and localization code ship once. The exact provider
  catalogue uses the verified lazy runtime archive, reducing the VSIX while
  retaining every existing startup and package cap.

- Smaller universal VSIX and ACP packages: runtime translations, lazy English
  regions share a bounded Brotli archive; exact lazy Node sources use a separate
  solid archive so translation damage preserves backend availability.
  Bundle checksums preserve the compiled bytes and filename; damaged tables
  retain the existing English fallback. Lossless walkthrough image compression
  preserves every pixel. Activation code and all package caps stay unchanged.

- M101 integration: combine release 0.14.0 and reviewed cache, compaction,
  overflow, tools and provider lanes. Bind strict schemas to selected model
  capabilities (including owner-confirmed Meta support), restore optional
  null tool arguments, and resize real PNG/JPEG images in a bounded portable
  worker before replay when documented model limits are supplied. Keep
  automatic compaction inactive pending lane E. Align transient goal progress
  with automatic-compaction snapshots, preserving goal-budget/Stop guards. Compress the complete browser
  English fallback and immutable Model API instructions losslessly and share repeated usage markup to retain every
  existing startup/deferred cap. Lane E's launcher supplies fake checks,
  live M75 opt-in and counted capture estimates. Restore merged contributor
  privacy checks and picker host actions, retain browser array bounds in strict
  schemas, and align shipped browser/worker package records.

- Smaller universal VSIX and ACP packages: runtime translations, lazy English
  regions share a bounded Brotli archive; exact lazy Node sources use a separate
  solid archive so translation damage preserves backend availability.
  Bundle checksums preserve the compiled bytes and filename; damaged tables
  retain the existing English fallback. Lossless walkthrough image compression
  preserves every pixel. Activation code and all package caps stay unchanged.

- Record installed Windows VSIX/NVDA receipts for legal-report controls,
  dialogs, export, notices and license text, including actual VS Code zoom.

- Restore the legal report's Export button after returning from its native
  save dialog, so cancellation preserves keyboard and screen-reader focus.

- Keep signed-out `/legal` keyboard navigation free of spurious sign-in
  warnings by requesting authenticated skills only after sign-in.

- Skip unavailable Python launchers when compressing the VSIX on Windows,
  so a Microsoft Store alias cannot hide an installed interpreter. Preserve
  real compression failures and the existing archive-content checks.

- Record the complete M97 quality pass on `c8c3cfd8` on macmini, closing the
  local aggregate receipt with every gate unchanged.

- Fix the duplicate paid marker on legal-explanation toggles; align quality
  fixtures with window-scoped registry settings, signal readiness, controlled
  deadline boundaries and lossless VSIX localization packaging.

- Await settled reviewer turns directly and construct full-depth parser trees
  in linear time for traversal tests, preserving every assertion and deadline.

- Keep ACP package guard fixtures aligned with lossless localization packaging and assert plural values in the emitted tarball.

- Add opt-in, priced legal explanations through the shared D78 daily reservation/settlement ledger, with bounded technical input, no tools/retries and retained unknown liability.

- Route ACP `/legal` and `/legal --offline` to the shared scanner on both backends without a model turn; disclose default registry queries through editor permission prompts.

- Add a platform-gated headless legal accessibility check to local quality and hosted checks, covering keyboard, accessibility tree, four themes, narrow layouts and browser-metric zoom.

- Correct lossless English phrase expansion and singular/few scanner count forms; preserve all pre-existing English messages byte for byte.

- Translate deterministic legal findings, evidence labels, reader failures and limits in every supported language; preserve stable finding ids. Package translations losslessly within the existing size caps.

- Editor legal scans offer disclosed public npm/PyPI metadata lookups, with an offline setting, HTTPS redirect refusal and supplemental licence evidence.

- Legal scanning now bounds UTF-8 bytes, total reads, each rule’s findings and elapsed time independently, and reports incomplete work at every limit.

- Integrated all 20 M97 scanner/report review repairs and removed dynamic
  regex construction from the static ecosystem readers. Historical synthetic
  auth fixtures and an ordinary-prose secret-scan false positive are recorded
  by exact fingerprint only; no secret-scan path or rule is suppressed.

- **M97 selected header repairs and report export.** Exact patches are prepared
  from existing project evidence, require ownership confirmation, and use the
  existing guarded edit path with live admission and evidence rechecks. Partial
  failures remain visible after an automatic rescan. Markdown export preserves
  the disclaimer and scrubbed facts, and both tool reports include it. The ACP
  agent reserves `exec legal-scan --json` before model/prompt parsing; complete
  should-fix findings no longer produce blocker exit 1. All new controls are
  translated in the 14 tables; scanner prose remains a named release blocker.

- Package UI JSON is compacted without changing any translated value; every
  other asset stays byte-exact and malformed JSON refuses publication. SAST
  bounds worker contention at two while keeping every rule and deadline.

- The accessibility gate reuses real Chrome workers and checks narrow scenarios
  at 320px, retaining every scenario, theme, axe rule and failure condition.

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

- Documented the `/legal` design (PLAN.md D76/M97): an offline, read-only
  licensing and copyright/header scan, an evidence-based report, and optional
  selected fixes through existing approvals. Recorded ecosystem coverage,
  research, cost/privacy boundaries, implementation lanes and certification
  requirements. The command is planned; this change adds no product code.

### Fixed

- Preserve the macOS helper's executable ZIP mode when packaging on Windows.
  Exclude optional fonts, source maps and unused model-catalog build provenance.

- Archived Node bundles retain their named exports under native `import()` and
  `require()`, restoring lazy hooks, MCP forms, Auto review and deferred panels.
  Both package jobs now compare every Node module's exports and selected
  function calls with the unpacked build.

- The VSIX packaging unit suite now builds its own English fixtures from source,
  so a fresh checkout can run it before a production build.

- M101 lane P2 (Pi/SoL-Pi upstream sync): long-context tiers reprice cached
  reads and writes, and 1-hour cache writes settle at their own price.
  The shared retry classifier refuses known quota codes and excessive
  `Retry-After` waits; provider transport binding remains pending.
  One-shot OAuth callbacks retain every parameter and destroy keep-alive
  connections on settlement. Custom servers accept validated compatibility
  overrides. Session saves coalesce into one in-flight write plus the latest;
  parallel save failures are observed immediately while other sessions drain.
  History listing validates headers without replay/transcript validation.

- M101 lane P1 (BYO codecs): one bad history item no longer breaks later
  requests. Blank text is dropped, empty tool results ride as
  `(no tool output)`, non-JSON tool arguments ride as `{}` (Ollama keeps its
  documented raw-text fallback), PDFs ride as Anthropic `document` blocks,
  and images for a model without image input ride as an
  image-omitted placeholder. Tool-call ids are mapped per target format
  (Anthropic charset, chat length, Mistral preset 9-alphanumeric even under
  provider aliases) with unique
  per-response Gemini fallback ids. Responses replays send the call `id`
  only for the same model with an `fc_` prefix. Gemini replays thought
  signatures on text parts (empty ones included), counts omitted usage as
  zero, sends vision-gated tool-result images inside `functionResponse.parts`
  and full tool schemas through `parametersJsonSchema` on Gemini 3.
  Gemini rejects proxy-null usage and explicitly rejects negative usage
  counters instead of retaining an earlier tally. Signed blank parts replay;
  late response ids salt fallback call ids; `$ref` siblings stay constrained
  through `allOf`. The Anthropic decoder tolerates
  proxy-null usage and tool payloads cut off at `max_tokens`, and thinking
  requests `display: summarized` so newer models stream thinking text.
  Lone surrogates are removed from every BYO encoder; parsed JSON retains
  own `__proto__` keys as data, including Anthropic tool arguments.
  Fakes only; no live
  or paid model call.

- M101 tool correctness: atomic multi-edit calls are schema-valid, fuzzy
  matching preserves newlines and yields to Stop, read paging keeps its
  next offset, file URLs decode before confinement, and ACP previews name
  the same targets. Shell originals remain recallable above the first-send
  budget, background completions pack, and new failures are translated.

- M101 tool safety: cut-short replies refuse every tool call, including
  completed items, show failed tool rows and explain why the turn failed
  across all five provider codecs.

- M101 review repairs keep Gemini goal progress as trailing user context and
  Chat/OpenRouter rolling cache markers on historical messages. Pending
  Manual approvals preserve sticky packed ids for safe crash recovery, even
  without a token/spend change. ACP and headless Model API conversations now
  share observation packing and exact literal `recall_output` with the panel.

- M101 adds case-sensitive literal search to `recall_output`, keeps its
  declaration stable for a tool-capable packing session, and restores sticky
  packing ids across resume, fork and rewind. Cache misses are logged only
  where the selected format reports cached usage; all new text is translated
  into the 14 display languages.

- M101 keeps goal progress outside the cached instruction prefix, places
  Anthropic’s rolling breakpoint before the transient progress message, and
  fixes the local prompt date once per session across resume and fork.

- Automatic compaction stops during pending dependencies, honours a memory
  hook's request to stop, and ends goal work when a summary spends its token
  budget while preserving separate user input. Stopped unsent reservations are
  refunded when they arrive; late failures are observed and summary streams close.
  A committed manual summary remains accepted when Stop cancels its recount.
  Retained context and summaries use the pricing tier selected by their
  respective input sizes. The plan
  distinguishes this candidate's packing default from released main's default.

- Carry the existing release repairs into the candidate's five test fixtures:
  include the required validation bundle, check module script tags, and await
  the deferred Account & usage dialog.

- The Model API engine now has automatic compaction economics, settled-tool
  boundary decisions, and one classified overflow recovery attempt per turn.
  Memory snapshots use existing permission checks and retain untrusted labels;
  the hidden continuation restores exact host todos and the goal. The machine
  setting defaults on, with an ACP/headless opt-out, but production reports
  awaiting evaluation and stays inactive until its M75 pair passes and shared
  D78 paid admission/ledger wiring is available. Missing admission fails closed.
  If accounting fails during an HTTP retry notice, that dispatched attempt
  is settled once and the turn stops; cleanup cannot tally it a second time.

- Compaction keeps media removed by Stop out of its request and resolves the
  selected model's capabilities after hooks. File snapshots report successful
  effective tool results. Final-admission refusal rolls back unsent summary
  forks; already compacted sources can be summary-forked. ACP editors and
  headless prompts route `/compact` to the same backend compaction core.

- Model API compaction reuses the sent cached prefix where supported,
  snapshots exact open tasks and replay-derived file paths, and keeps recent
  whole turns and supported reasoning verbatim. Structured summaries update
  earlier summaries; output and tail budgets scale with the model window.
  Blank summaries are refused, repeated compaction is a no-op, and transient
  stream failures share the turn retry limit. Returned tools never run.
  The summary-fork engine action is opt-in and requires injected paid
  admission; it remains unavailable in the UI until D78 is wired.

- Model API turns recognize context overflow and show “Context window full:
  /compact or /handoff”. Context pressure, request admission and text-file
  read budgets follow the selected model's supplied window. Admission checks
  the lower input estimate against the full window, so an 8k Ollama session
  can start with the real prompt and tools. Each attempt keeps its admitted
  window and format through completion and failure. Quota and billing failures
  keep their actual errors; only verified legacy Muse ids inherit the Muse
  window when no registry resolver is installed. Manual compaction remains
  available and rate limits keep their existing retry path. BYO registry wiring and certified production activation of automatic
  recovery remain integration work.

### Added

- Integrated Usage & cost across the VS Code command, status bar, panel menu,
  ACP summary, companion browser page and CLI JSON/CSV exports. All surfaces
  use the same local journal, aggregates, formatter and translated page.
- Usage companion authentication uses the shared M104 loopback server: one-use
  launch codes, per-window in-memory bearer headers and fetch-streamed replies,
  with no cookies. The separate usage listener is retired.
- Machine-scoped usage history and retention settings, standalone ACP
  `--usage-history=off`, and headless `--usage` JSON. Daily budget usage reads
  preserve unopened ledgers and outstanding reservations.

### Fixed

- Usage request observations run at the shared transport boundary for Meta and
  configured providers. ACP loads `/usage` rendering and headless execution
  on first use, preserving the existing startup cap. Production headless BYO
  accounting remains explicitly unavailable before dispatch.

- Contributor models show the confidentiality warning even after contributor
  confirmation. Package frame validation includes the Models and Usage bundles.
- Usage and Models pages share React and browser common code with chat. The
  usage companion loads those modules under its existing authenticated CSP;
  packaged ACP installs retain every usage translation alongside the archived
  UI family. All existing bundle and package caps remain unchanged.
- Usage tables use explicit solid theme backgrounds so axe can decide their
  contrast. Pages disclose unavailable native editor actions, and browser
  exports enforce a visible encoded bound before dispatching a download.
- Usage reads include existing Tab reservations and active parent conversation
  budgets. Validated OpenRouter account observations remain visible with history
  off. Terminal daily, model and limit commands render their selected section.
- The Linux foreground-opener test simulates the actual imported platform
  binding on Windows, while retaining the native Windows opener coverage.
- Usage history switches now update the shared preference across native and
  browser pages, and native reads respect a companion's disabled preference.
- Integration retains every merged milestone in the plan's proper section and
  registers standalone usage browser checks in the dead-code graph.
- Usage history keeps known prices for incomplete calls and records the cost of
  their known token portion as uncertain, without filling unknown counters.
- Usage history reads stay consistent across retention, read atomically replaced
  rollups through one handle, and fsync rollups before publication. Generation
  locks prevent a paused former owner from releasing its successor's lock.
- ACP `/usage` cancellation abandons a pending URL elicitation immediately,
  returns a cancelled response, and lets the next prompt run before the client
  answers the old request. Late answers cannot send a stale reply.
- Linux `usage open` acknowledges and detaches the browser handler on spawn,
  allowing foreground handlers to keep running. The usage companion retains
  its own idle timeout or explicit-stop lifetime, independent of handler exit.
- M102 usage sums settle in integer micro-dollars before formatting, keeping
  buckets, breakdowns and exported totals consistent at cent boundaries.
  ACP/CLI summaries show the latest provider/source/window limit with its
  stale or awaiting status, while charts retain the observation history.
  A held-operation regression now proves usage actions run in order and
  return the history state from their own completed action. Cache and speed
  rates use paired observations and retain those sums/counts in the shared
  aggregation read interface; visible coverage awaits the contract owner.
- Usage recording retains earlier uncertain billing after HTTP retries and
  journals Muse Code's reported tokens before a turn completes, preserving
  those counts if its process exits early. Sent image calls with lost responses
  retain uncertain reserved costs, ACP records paid tools through the shared
  producer, and deactivation awaits a bounded final journal flush.
- Usage & cost preserves keyboard focus through custom-date edits and
  recovers from native host send failures with localized feedback and retry.
  Charts use contrasting theme-token boundaries and non-color series cues;
  provider-limit observations and keyboard selection follow elapsed time.
- Join general provider management and origin-bound credentials to the ACP
  runtime. Free terminal probes use the shared transport. Headless provider
  arguments validate their inputs and explicitly refuse without an accounting
  runner; they do not dispatch an unbudgeted request.
  Serialize terminal configuration commits, detect stale snapshots and
  compensate secret changes on write failure. Retain private-network consent,
  custom formats/base paths and captured free-probe headers and model lists.
  Keep translated terminal help complete and show the same help after invalid
  arguments, including the existing ChatGPT commands.

- Join the configured providers to the shared request transport: origin-bound
  credentials, redirect refusal, bounded framing, parser redaction and event
  progress deadlines. Meta's request bytes remain unchanged.
  Redact stream failure diagnostics while preserving executable arguments
  and model content. Bind legacy review consent to the client's actual origin
  and recognize errors structurally across lazy bundles.

- Include the lazy subscription and configured-provider bundles in the VSIX
  allowlist and keep crash-report frames aligned with the packaged files.
- Preserve normalized Gemini model IDs when joining free model scans to
  catalogue capabilities, so captured tool-capable models remain selectable.
- Pin the patched development source-map parser, `source-map-js` 1.2.2,
  after the dependency audit reports GHSA-68fv-2mgg-jv7q.
- Record the plugin runtime launcher's deliberate, bounded subprocess
  boundary for static analysis, retaining its runtime and credential checks.
- Restore Copilot's production tool loop by binding admission to the same
  host grant identity used when the request was confirmed.
- Connect the captured Mistral plan-key preset and configured providers to
  a shared, pinned transport in VS Code and ACP. Resolve capabilities and
  pricing from the selected model, reread origin-bound credentials at each
  send, and count plan requests separately from dollar budgets.
- Load subscription authentication and account details lazily so the joined
  release passes the existing provider and deferred browser size caps.
- Integrate the M95 capability, host, deflake and subscription lanes onto
  release 0.14.0, retaining lazy bundle boundaries and translated strings.
  Keep bundle drills in memory and include the release build inputs and
  provider bundle in private ACP packaging fixtures.
- Drive harness scenarios after the real webview ready message, wait for
  Models data, and acknowledge the plan disclosure before opening usage.
- Restore model-text split checks over every browser chunk and its own
  declared readers, retaining all size caps and guard failures.
- Keep Account & usage open for unpriced models whose usage includes cached
  tokens; show dollar estimates only with a verified Model API tariff.
- Restore the confidential contributor-model warning before remembered
  consent can return, retaining the fresh configured-provider privacy check.
- Document Copilot's VS Code Language Model API boundary and the ChatGPT/API
  routes available to other editors; record remaining integration failures.

### Added

- M95b connects ChatGPT and Copilot subscription actions to the Models panel,
  command palette and shared harness. ChatGPT uses the account catalogue and
  parses headerless SSE, including usage limits inside HTTP 200; ACP editors
  use the same dispatch. Plan attempts have separate token/request tallies
  and bypass USD reservations. Copilot uses host consent and remains reduced
  and unavailable in confidential workspaces. Live success certification
  remains pending; Mistral plan-key transport is wired in both hosts.

### Fixed

- Chat startup now loads syntax highlighting only for a closed supported code
  fence, leaving code text and Copy, Insert and Apply immediately available
  while its engine loads. Action-only dialogs and the separate Tasks surface
  also load on demand; the command palette reuses its shared list shell. The
  900 KiB startup budget and existing deferred budget stay unchanged.

- Isolate M95's built exec package and bundle-split drills so parallel unit
  suites cannot delete each other's browser chunks or read partially written
  metafiles. Share the verified restored-fixture check across cases, cutting
  repeated source parsing under CPU load. Keep real production builds, exact
  guard failures, coverage thresholds and default deadlines unchanged.

- Package only allowlisted build artifacts with a short landing guide and recent
  release notes. Compact staged translation and manifest JSON preserves every
  value, and the strict localization gate validates the exact packaged data.
  Source docs and tables remain complete; the VSIX size cap stays unchanged.
- M95 capability review repairs keep enabled thinking above zero, omit
  unsupported effort without disabling supported thinking, and derive the
  reasoning mode from native/catalogue effort evidence. Sparse Anthropic and
  Gemini list rows retain native metadata; Anthropic image admission enforces
  its documented 10 MB bound. Gemini 2.5 fallback mode cites research rather
  than an uncaptured wire claim. Media refusals explain capability, MIME and
  individual limits separately from exhausted replay budgets.

- M95 model capabilities now retain evidence sources and distinguish unknown
  from unsupported. Native model lists retain reasoning, limits, modalities,
  structured-output and sampling metadata; custom model overrides are validated
  and stored as user evidence. Haiku 4.5 uses manual budgeted thinking, while
  captured Sonnet/Opus and Gemini models use their supported reasoning mode.
  Composer effort tiers and image/PDF admission accept the resolved model
  policy. Meta request bytes and existing media limits remain unchanged.
  Final host dispatch and pricing composition remain assigned to lane I.
- Bind replayed reasoning and Model API hook identity to the producing
  provider and model; name BYO models in the system prompt.

- Resolve host turns and Auto review through a lazy provider registry seam;
  honor verified tool support, output limits, effort tiers and price cards.
  Bind retries and held confirmations to the provider/model/credential,
  retain unknown costs and separate Meta image credentials from BYO profiles.
  Production transport composition remains pending M95 lane T/W integration.
- Windows concurrent ChatGPT refresh recovery retries transient sharing
  refusals without deleting a live owner or replacing a legacy ownerless lock.

- Plan notices now use a verified account hash, and dismissed usage limits
  stay dismissed through model switches and saved conversation restoration.
  Plan billing disclosures survive a temporarily empty model catalogue.
  Subscription commands install the language in both deferred bundles.
  Corrupted subscription records return a fixed error without exposing their
  stored text through JSON parsing failures.

- ChatGPT provider add, remove and status commands now reach the ACP executable
  and appear as terminal or manual actions in every ACP editor. Sign-in saves
  the account's eligible catalogue models atomically; translated notices and
  callback text ship in all fourteen languages. Native credential-store failures
  retain a sanitized recovery category and direct users to an interactive
  desktop session, without exposing the store's error text.

- M95 integration shares the Node validation runtime and the provider-setup
  schema, so Models host stays within its existing size budget. Account & usage
  loads on demand with a dismissible loading modal. Chat's unchanged startup
  budget counts every static JavaScript chunk; the package ships all chunks.
  Package and panel regression fixtures exercise the shared parser, module
  scripts and asynchronous dialog loading.

- M95 integration uses one strict Models panel bridge and includes the captured
  Chat and Ollama codecs in the lazy provider bundle. Z.ai key checks use a
  fixed pattern, and OAuth callbacks serve localized plain text. Models
  harness readiness and selected-description contrast survive combined builds.
  Native Chat reasoning fragments copy future fields without setter mutation;
  serial SAST scans complete at unchanged rule deadlines without timeout warnings.

- The M95 Chat codec keeps impossible cache accounting unknown, fails
  corrupt response chunks, and preserves tool-call identity across fragments
  and responses, including Fireworks' captured nullable continuation IDs.
  Vision-capable models accept image input and image tool results; retained
  completed hosted search survives a provider switch as plain text. Packed
  output and compaction requests now have checked-in byte goldens.

- M95 integration keeps all captured provider codecs and provider core in
  `dist/providers.js`, with required membership and exclusion checks and a
  measured bundle budget. The Models panel emits the script and stylesheet
  paths its host and harness load; its new bundles have measured budgets.
  Shared scan/context constants and loopback rejection assertions now work
  across the merged lanes. The host settings reader validates and preserves
  the workspace's provider suggestion alongside its documented default.
  Accessibility captures use the existing Playwright Chrome driver with the
  same viewports and deadlines, avoiding the rig's stalled CLI captures.
  The Models panel has its own themed page background, readable control
  and error colors, valid usage markup and accessible checkbox targets.
  The harness routes the BYO chat palette to the chat bundle.

- Provider endpoint checks classify equivalent IPv6 spellings consistently and
  restrict plain HTTP to literal loopback or localhost. Budget admission reserves
  full input cost; settlement counts fresh, cached and cache-written input once.
  Concurrent provider saves use unique temporary files beside the destination
  and clean up failed writes. OpenRouter routing keeps order and fallback
  restrictions together, Fireworks keys use the correct prefix, custom model
  limits survive reload, scan summaries track price availability accurately,
  and recommendations exclude non-callable models. The provider wizard requires
  endpoint validation and private-network consent before saving, and connection
  edits clear dependent credentials, tests and consent.

- Provider descriptions, key hints, privacy explanations, wizard and validation
  messages, suggestions and scan summaries follow the installed display language
  in all fourteen translations, including localized counts and currency.

- Gemini codec: count billed thinking in output usage, require a successful
  terminal reason, and retain live item identities. Regression checks include
  the unit TypeScript project and the real host's live message/thinking rows.

- Gemini tool-result images now fail with an explicit named error pending a
  supported captured replay shape. Checked-in exact request bytes cover first
  turns, signed tool loops, user images, packed output and compaction; session
  growth preserves every earlier content entry and stable request field.

- Harden the pending Anthropic provider codec: bound stream accumulation,
  reject malformed deltas, preserve cache-write usage and TTL counts, apply
  rolling cache breakpoints, and translate local errors. Native request
  goldens and the codec bundle exclusion guard cover the review regressions.

- **M95 provider host review repairs.** Stored-key tests and scans refuse an
  edited origin; panel failures use fixed text, and password-box/OAuth keys
  remain in host-owned drafts. The panel uses the Models bridge and stylesheet.
  Save compensates persistence and composer failures, native private-network
  consent is required, draft scans use the entered key, and concurrent cache
  writes/removal recovery preserve provider state. Auth recognizes configured
  local models. Canonical exports retain model options and the default model.
  Final integration certification and the activation-growth residual remain open.

- Confidential workspaces resolve current bring-your-own model privacy
  before selection, including first setup; unknown models and failed
  resolution are refused. Bare Muse-only pickers retain their existing
  rows and keyboard wrapping.

- The Models panel requests provider edit drafts explicitly, keeps grid
  shortcuts within the grid, and clears inaccessible active references.
  Its JavaScript and CSS now build at the host's expected paths. Theme
  colors, usage-list markup and checkbox targets pass the four-theme
  accessibility checks; five German, French and Italian labels are
  translated without localization exceptions.

- **M95 Ollama codec review repairs.** Native tool identities preserve
  growing-session history, reasoning replays only to its producing model,
  stream buffers and output retention are bounded, and the native terminal
  line closes the source. Nine local Ollama 0.35.1 receipts replace invented
  decode fixtures; five byte goldens and translated codec errors cover the
  repaired seam. Provider integration and full milestone certification remain
  separate gates.

- **Provider account IDs stay redacted across session export boundaries.**
  Whole-string redaction validates slice cuts, including `team id` followed
  by a newline and UUID; serialized OpenAI and Anthropic account headers
  are redacted in logs and exports while retaining JSON names and quotes.

- **Offline provider catalogue replay avoids deep Buffer assertion cost.**
  Tests compare byte length and SHA-256 without changing the default timeout
  or the sealed snapshot integrity checks.

- **M101 lane T: tool and packing correctness.** A packed placeholder trims
  the tail from its front so the final lines (a shell result's exit code)
  survive, a single long line packs to about a 1k excerpt, and packing that
  would save under half is skipped. A reply cut short by the output limit
  answers each uncompleted call with an error instead of running half-formed
  arguments, on every codec's stop mapping. Every model-given path resolves
  through one shared normalisation (Unicode spaces, a leading `@`, `file://`,
  Windows drive forms; `~` refused). `edit_file` falls back to a normalised
  unique match, refuses a no-op edit, and takes `edits[]` applied all or not
  at all with overlaps refused. A truncated `read_file` names the shown
  lines and the offset that reads on, and an offset past the end is an error.
  Search hits are cut to about 500 characters with a note. Shell and
  `then_run` output rides whole while the session packs observations, so it
  stays recoverable through `recall_output`; a non-string `then_run` is
  reported instead of silently dropped; output clips never split a character.

- Team staging reads independent Git mode metadata concurrently, keeping
  its raw-byte, executable-mode and final snapshot checks.

- POSIX runner jobs remove credential variables without starting a process
  for each environment name. Matching remains case-insensitive, and the
  helper restores its previous shell option afterward.

- Paid-consent regression tests share their exact pending-popup assertions,
  clearing the zero-duplication gate while preserving both Allow-once and
  Deny coverage.

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

- **Diff counter contrast checks.** The existing sign and count share one
  colored text span, preserving totals and translated order while allowing
  single-digit contrast measurement. The report browser fixture checks its
  controls after the lazy dialog renders.

- **Development dependency audit.** Pin `source-map-js` to 1.2.2 for the
  indexed-source-map denial-of-service advisory. The dependency is not shipped;
  the audit rule and existing exception list stay unchanged.

- Team workers and read-only Git calls share one classifier, including wrapper
  inspection, clustered short-option refusals, exact argv and safe listings.
  The workspace team reader preserves validated scheduler shared-file rules.

- Team checks validate and quote scoped files for the destination operating
  system and guard the final command before dispatch. Persistent check slots
  own their Git objects and release cancelled snapshots only when every
  launched child has proved retirement.

- Runner supervisors release their own setup-cache lease after timeout
  retirement. Output polling checks original bytes before streaming UTF-8,
  Windows launches refuse commands over the process limit with a translated
  reason, and the native Windows job separates initialization from argument
  assignment.

- M96 team launcher foundations now prove process ownership at each signal,
  use stable Linux pidfds, cancel held launches during disposal, retry failed
  retirement, and use monotonic deadlines. Advisory hints validate the opened
  inode; damaged recovery records warn without hiding valid launches. Product
  wiring and Windows runtime certification remain part of M96 integration.

- M96 team recovery now uses recorded process identity rather than marker text;
  macOS reads libproc and a separate environment projection. Retirement avoids
  waiting for unowned processes, Windows hints consume the ACL-verified handle,
  Windows END waits for helper closure without another STOP, and damaged foreign
  journal directories warn without hiding valid launches.

- M96's team view validators and paid-team pricing load from the existing
  team bundle on use. Ordinary startup discards unused role tables and shares
  identical scalar validators and paid-usage settlement code. Paid questions
  recheck cancellation and feature state after loading.

- **Final role ceilings (M96 lane R).** An empty final delegate intersection
  withdraws every delegation tool, so admission and the charter agree that
  the worker cannot delegate. Offered configured MCP tools survive personal
  allowlists and session inheritance, while runtime and project ceilings
  still narrow them. Charters consume the frozen final toolset and preserve
  built-in QA's test-only shell and research/review's read-only shell policy.

- **Role resolution redesigned (M96 lane R, round 3).** All role files,
  catalogues, permission modes and runtime ceilings are captured before
  resolution. Any missing, unreadable, malformed or ambiguous input refuses
  the whole catalogue with a translated reason. One pure permission meet
  narrows every applicable ceiling, conservatively proves write-glob
  inclusion, and supplies the exact tool set for charters. Orchestrator
  snapshots retain full agent identity and model settings, including Default
  entries; conflicting model identities refuse.

- **Project-role restrictions (M96 lane R).** Every project role, including
  a new id with a hash allowance, refuses in-place work, model selection
  and skills. Missing permission modes resolve to the strictest ceiling.
  Write-path narrowing accepts literal paths and confined subtrees; partial
  tool meets generate charters naming only the available capabilities.

- **The M96 round-4 plan remains the plan of record.** Lane 0 and R keep
  the approved descendant-retirement, recovery and separate team-host rules.

- **M96 second-review ledger repairs:** retention preserves concurrent and
  later usage settlements, takeover refuses a stale durable snapshot, and
  persistence strips unapproved fields, including nested private content.
  Team price questions identify provider/tariff, quote Meta rates only for
  verified Meta tariffs, and use unknown-price token ceilings otherwise;
  provider-key billing text has translations in all 14 languages. The
  integration adapter must refresh entry caps immediately before dispatch.

- **M96 review repairs:** computed worker ceilings preserve zero and partial
  provider limits; cooldowns only lengthen, and spend caps use the UI locale.
  Ledger publications and resets serialize with generation acknowledgements;
  timer failures log fixed words and retry with bounded backoff. Resets count
  later settlement deltas, and retention consults every day's task state.
  Paid team consent scopes Always to provider/model/tariff; unpriced popups
  show task/day token ceilings, with translations in all 14 languages. Key-billed
  team work is available in the Muse Code paid-feature list. The integration
  host must supply scoped grant persistence before offering team Always.

- **M96 lane A, round 4:** uncertain descendants retain worker and shell slots;
  replacement admission needs spare capacity. Pool budgets include the first
  request and throttle recovery respects lowered ceilings. Recovery requires
  an explicit takeover decision and writes only this window's ledger. Retention
  preserves cumulative usage and reset boundaries without touching other owners.

- **M96 claim accounting:** an injected D78 journal contract covers shared paid,
  team and workspace budgets, token measures, a durable latest day and restart
  lookup/settlement by claim id. Lost acknowledgements retry without another
  charge or refund; unknown usage retains the whole reservation. Integration
  must wire the durable adapter before dispatching team requests.

- **Single-model activation stays quiet:** the default-on team-worker
  setting no longer opens a price confirmation at activation. The host must
  declare a runnable team before workers are available; the first paid use
  keeps the three-choice popup.

- **Team MCP dispatch permissions.** Queued tool calls retain their admitted
  server, catalogue generation, tool and permission class. Registry dispatch
  rechecks that binding, current assignment and exact lease; changed tools are
  refused before transport dispatch with a translated error.

- **Team repository resource limits.** User and repository declarations now
  require positive safe integer limits; direct repository application refuses
  invalid limits without blocking an otherwise available shared server.

- **Team lease and call identities.** The shared-resource foundation now
  gives each lease a window/task/attempt/server-bound id and generation,
  and each call an independent state. Cancelled re-entry and old completions
  cannot release replacement ownership. Shared limits count concurrent calls;
  invalid local arguments create no call liability. Configured MCP clients
  have separate server endpoints and cancellation namespaces.

- **IDE MCP startup ordering.** Closing during startup closes the pending
  listener and leaves no endpoint; a later start still works.

- **Team resource ownership.** Take back and retirement retain exclusive
  resources until every earlier call is terminal, the server exits, or the
  user chooses Release anyway. Unassigned servers reach no worker role.

- **Team MCP bridge lifecycle.** Local timeouts retain ownership; worker
  server lists require user assignment. Caller removal and disposal cancel
  engine calls and queued admission, and a pending start cannot reopen a
  disposed bridge. Loopback auth-negative tests now send no credentials,
  and endpoint tests release their exclusive lease before switching holders.

- **Team configuration validation and transfer (M96 lane F).** Templates
  use D75's enforced tool groups, all planned cap measures are accepted,
  numeric limits and daily token budgets are validated, and exports keep
  role policies and entry concurrency while stripping extra nested fields.

- **Team intensity, suggestions and estimates (M96 lane F).** Re-apply
  uses the current level, zero ceilings keep workers stopped, budget
  suggestions learn from local records, and effort follows provider tier
  order. Unsupported settings stay hidden and thinking budgets are carried
  in task settings. Preview resolves live Default, unknown billed prices
  are shown as unknown, and subscription/local tokens incur no key-model
  estimate.

- **M96 integration:** ordinary activation, Model API and ACP bundles exclude
  the team runtime. Team conversations load tools and roster from their lazy
  bundle; shared constants and translated message contracts stay consistent.
  Single-model conversations retain the in-place refusal while another
  conversation has a worker writing in the workspace.

- Hardened team orchestration against MCP write bypasses and writes admitted
  before an in-place worker starts; team state changes remain structured tool
  data. Retry claims survive uncertain starts and conversation reopening,
  unavailable endpoints refuse, interrupted startup and metadata saves clean
  up, and team arguments have explicit size limits (M96 lane T, RVM96D).

- **Team worker race and lifecycle guards (M96, RVM96W3).** Admission keeps
  an opaque native root identity through startup and subsequent mediated
  operations. Prompt and ACP file operations check and use one open handle;
  write-path policy cannot authorize a different target. Bare parent arguments,
  directory-changing short options and Windows Git executable wrappers refuse
  before approval. Final non-text ACP messages discard earlier draft reports,
  model selection cannot reset the role mode, and cancellation has a deadline
  even when the agent stops draining its input. No live/vendor certification
  or OS sandbox claim is added.

- **Team worker fence redesign (M96, round 3).** Muse Code, ACP and engine
  workers share native filesystem identity admission, including Windows UNC,
  device, short-name, junction and subst aliases. Every mediated path and
  command rechecks its copy; unresolved targets refuse. Wrapped Git ref
  changes and unsafe command paths refuse before approval, and Git cannot
  use clone-config askpass or credential helpers. ACP keeps final messages
  separate, preserves non-success stop reasons, confirms legacy modes and
  protocol version, and flushes cancellation before process cleanup.
  Malformed engine reports retain the last message; bounded file excerpts
  are labelled and summaries clip complete Unicode characters. Windows
  regression evidence and remaining capture gates are recorded in
  `docs/certification/m96-w.md`.

- **Team worker confinement (M96, RVM96A).** Prompt assembly excludes
  private/protected file data, bounds UTF-8 bytes and preserves named paths.
  Child environments start empty with explicit runtime/profile allowlists
  and pinned Git credential isolation. Reports require a meaningful summary
  and blocked results require a question. Worker/ACP admission and lifecycle
  repairs are certified in `docs/certification/m96-w.md`. Worker roots are
  proven disjoint from the checkout before startup; unresolved/out-of-role
  requests and Git ref/worktree mutations are refused before approval.
  Uncaptured native-server exclusion now prevents worker startup.
  ACP accepts standard object text chunks and authentication errors,
  advertises only implemented capabilities, and requires selected-model
  readback before prompting. Abort signals interrupt startup and pending
  turns; failure and completion dispose sessions and owned ACP children.

- **Concurrent task publication on Windows (WINPUB).** Importing a worker's
  objects no longer starts automatic Git maintenance, writes a commit graph,
  or recurses into submodules. The destination still validates imported
  objects before atomic expected-old ref publication. The real two-writer
  regression checks both imported trees and the import command policy;
  loaded timings and deadline limits are recorded in lane I's certification.

- **Windows team Git operation cost (REDWINI96).** Merge reads exact blob
  IDs and modes from its raw diff, retrieves all required bytes through one
  binary-safe Git batch, and reuses them within that operation. Dirty base
  capture combines its metadata reads; isolated revision lookup avoids a
  driver scan. Mutable refs, configuration and paths retain their checks.
  Tests prepare and compact real repository/task fixtures once per file,
  then hard-link only immutable packed objects into independent copies,
  without a test-only blob cache. Measurements, restored drills and native
  repeats are recorded in M96 lane I's certification.

- **Windows overlap-refusal fixture cost (WINI96C).** The overlap regression
  imports its real task commit with Git fast-import, avoiding a separate
  task-tree copy and checkout that its parent-directory destination never
  uses. Overlap refusal, untouched user bytes and default deadlines remain
  checked; native timings and repeated runs are in lane I's certification.
  A subsequent junction-delete timeout receives the same unused-copy
  removal; shared docs-base setup uses fast-import and a real index reset,
  retaining junction, outside-content, sentinel and ref checks.
  The overlap assertion also requires the specific refusal message, so a
  generic Git failure cannot hide a missing overlap guard.

- **Remaining Windows team fixture cost (WINI96B).** The repository-program
  canary uses one owned Node program and a prepared repository, without a
  redundant task-tree copy. Two real writers commit concurrently behind an
  explicit staging barrier and publish their distinct refs in parallel.
  The publication-race fixture uses Git fast-import; its intervening write
  stays at the awaited object-import boundary. Original assertions and
  default deadlines remain, with additional checks of both published refs,
  both worker trees and the canary's merged content. Measurements and
  platform proof are in M96 lane I's certification record.

- **Lower Windows team fixture cost (WINI96).** Tests reuse prepared,
  independent repository and workspace copies, batch fixture commits with
  Git fast-import, and read immutable blobs through one Git batch per
  repository. Every original assertion and default deadline remains.
  Windows merge and workspace suite times fall roughly by half; at that
  checkpoint, three default-timeout cases still block complete native
  verification, recorded in M96 lane I's certification.

- **Team merge transactions (RVM96I2C lane I).** Landing compares each
  target's current bytes and permissions with its planned base, prepares
  replacement bytes before touching the target, and rolls back landed files
  on a later refusal. Errors carry the Undo record and rollback outcomes;
  Undo verifies its restored bytes. Worker bases honour local and global Git
  excludes, extension-owned worker-copy Git disables configured programs,
  clustered unsafe options and doubled `git` commands refuse, and read-only
  patch output remains available. Ref-lock failures retain their real error,
  symlink blobs refuse, executable flips preserve private permissions, binary
  rework keeps the worker's bytes, and 8.3 fixture listings stay bounded.
  That checkpoint left Windows default-timeout verification blocked; see
  M96 lane I's certification record and the WINI96B follow-up above.

- **Windows team paths (M96 lane I).** Canonical containment accepts drive
  letter and directory casing differences and extended namespace spellings.
  Junction ancestors remain refused for merge, deletion, cleanup and Undo;
  cleanup unlinks a replaced copy without following it. Ambiguous 8.3 aliases
  remain refused. Real-Git fixtures handle Windows path separators and quote
  inert arguments consistently across shells.

- **Team workspace security (RVM96B lane I).** Read-only commands require
  exact arguments and trusted Git execution; worker environments cannot
  restore Git helpers or SSH agents. Cleanup refuses linked storage parents,
  task publication uses atomic ref compare-and-swap, untracked source enters
  the worker base, and ignored scratch writes count as breaches. Merges
  re-read live task refs, validate every path ancestor, honour charter globs,
  handle multiple conflict hunks, and return conflicts to the task copy for
  rework. Executable modes survive merge/Undo, and completed review provenance
  enforces a different-model requirement.

- **Team UI review corrections (RVM96B, findings 13–23).** Completed and
  host-confirmed cards remain locked after replay; a refused request can
  be answered again. The tree has one Tab stop with keyboard-accessible
  actions and recovers from a removed focused task. Queued/interrupted
  work no longer looks running; completions produce a polite summary, and
  the host can explicitly remove the team view. Team buttons meet target
  sizes in all four themes, the narrow harness is truly 320 px, and known
  statuses and entry names are localized. Merge cards show bounded file,
  protected-path, conflict and review details. Tree/cards load through
  dynamic imports, with all shipped chunks inside the existing aggregate
  webview budget and the existing nonce policy.

- **Team pipelines and history hardenings (lane L, review RVM96A).** A
  step result whose kind does not belong to the step is refused, so a bare
  `work-done` can never stand in for the review's findings or the check's
  pass/fail. Round limits are positive integers in full definitions and
  project narrowings alike (fractional bounds no longer load). Token totals
  count input plus output only: cached input and reasoning output are
  subsets, never added again. `Today` totals use the caller's local calendar
  day in the injected time zone. Rows and filters carry per-agent identity
  with per-agent totals. `done` (a success needing no merge) is counted
  separately from `merged`. CSV export prefixes formula-opening cells
  (`= + - @`, tab, carriage return) with a single quote.

- **M96 integration on Windows:** ACP process fixtures use native file URLs and
  path rules; all workers share the mandatory environment fence. Cleanup tests
  prove junction and noncanonical case spelling refusals on Windows. Successful
  tasks without a merge retain `done` through both ledger schemas. Browser builds
  share the verified-identical JavaScript grammar inside TypeScript and emit
  UTF-8, preserving every language inside the unchanged aggregate cap. Missing,
  duplicate or changed vendor grammar declarations stop the build.

- **First-run and usage UI for bring-your-own providers (M95 lane U).**
  The sign-in gate offers Start with your own model beside the other two
  (ranked equally with no backend set up); a finished setup confirms once
  with Manage providers. The model picker groups by provider with pinned
  favourites first, priced/unpriced/local/plan details and provider rows;
  the composer pill names the provider; Account & usage lists per-provider
  tallies with OpenRouter key usage and unpriced/local costs. A confidential
  workspace hides training models from the list and refuses them on switch.
- **Companion transport authentication (M104 lane C, awaiting integration).**
  Per-window memory bearers replace host-wide cookies, preventing credential
  leakage across loopback ports and isolating tabs and concurrent runtimes.
  Rejected launches show localized, accessible instructions to reopen the
  panel from the editor.

- Archived Node bundles retain their named exports under native `import()` and
  `require()`, restoring lazy hooks, MCP forms, Auto review and deferred panels.
  Both package jobs now compare every Node module's exports and selected
  function calls with the unpacked build.
- The VSIX packaging unit suite now builds its own English fixtures from source,
  so a fresh checkout can run it before a production build.

### Security

- Pin the fixed development-only source-map-js 1.2.2 patch for
  GHSA-68fv-2mgg-jv7q; preserve the existing dependency audit policy.

### Security

- Update the dev-only shell-quote lock entry to fix GHSA-pqg4-j6r4-53mv
  within npm-run-all2's existing dependency range.

### Fixed

- Retry after a failed optional panel reloads its complete module graph with
  the conversation and draft saved. Cold menus respect outside dismissal and
  late imports cannot take focus; failed menus accept Escape and return focus
  to their trigger.

- The release-artifact check validates complete ACP help, including its reference
  hint, in English and every installed language using the CLI's shared formatter.

- The report CLI help test follows the documented complete-reference contract
  for subcommand `--help` and `-h`.

- The Help reference gate accepts Windows file paths and continues checking
  keyboard dispatch against the runtime registry.

- Activation paid-setting checks are directly importable in tests, and ACP
  stdio checks include the localized Help reference hint.

### Performance

- Optional menus, sign-in, goals, schedules, Account & usage and Agent map
  content load on first use with accessible loading and retry after a failed
  chunk request. A lossless native encoding keeps the complete English fallback
  inline while reducing webview startup from 794.1 to 733.8 KiB (60.3 KiB).
  The original deferred group drops from 50.0 to 32.1 KiB; existing size caps
  stay unchanged.

- Reference tests share unchanged setup and keyboard analysis, keeping
  catalogue mutation checks within the normal test timeout.

- The VSIX omits the duplicate generated Markdown reference; Help continues
  to load its bundled reference and links to the complete online guide.
  Its compressed universal package budget is 2400 KiB, measured with Help
  and the macOS helper plus 5%, rounded up to 25 KiB.

### Documentation

- A register of orchestration gotchas (`docs/orchestration-gotchas.md`) lists
  what went wrong while a fleet of agents built this project. For each one it
  gives the rule that prevents it and the milestone that will enforce that
  rule in the app's own orchestrator (D100).
