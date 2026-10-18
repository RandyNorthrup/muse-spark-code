# Agent instructions — Muse Spark Code (Unofficial)

These rules apply to every AI coding agent and every human working in this
repository. They are project-local; do not copy them into global settings.

## What this project is

One coding agent for many editors: a VS Code extension, an editor-protocol
(ACP) agent for Zed, JetBrains IDEs, Neovim, Emacs and other editors, and a
terminal command (`muse-spark-code-acp`). Its backends sit behind the
`AgentHost` and `AgentSession` interfaces (`src/core/agent/agentBackend.ts`):
the Muse Code CLI over the Muse Session Protocol (`@muse-code/sdk`) and the
Model API route, which serves Meta's models and other providers (your own
keys, a ChatGPT plan sign-in, Copilot). Read `PLAN.md`
before changing anything: it holds the decisions, the research that justifies
them, the milestone plan, and the certification checklist. Closed history
lives in `docs/plan-archive/`, byte for byte: §2 keeps each decision's rule in
force and links its full design record (`decisions.md`); closed milestone
sections are in `milestones.md` and older gate records in `gates.md`. Read the
archive when a summary is not enough, and never edit inside its blocks.
`PLAN.md` carries the rule in force; the record lives in the archive from the
day it lands: a change that adds a design record moves it there in the same
change, with `npm run plan:archive` (CONTRIBUTING.md, "Archiving closed
history from PLAN.md").

## The owner's standing rules

Two kinds, kept apart on purpose. A line elsewhere in this file or in PLAN.md
that disagrees with either loses.

### How we work on this repository (never build these into the product)

These bind every agent working here. They describe how we build, test, merge
and run our own jobs. They are not features of Muse Spark Code: never turn
them into app behaviour, settings, skills, prompts or limits. (2026-10-17: the
orchestrator "playbook" baked this project's own method into the app, and it
had to come out.)

- **Only real, finished work.** No stubs, fakes, TODO or FIXME, temporary
  code, fallbacks to legacy code, workarounds or dead code, in the product, the
  tests or the tooling. Everything works as designed and is fully implemented.
- **Nothing is claimed until it works in real use.** A feature goes into the
  README, CHANGELOG, Help or release notes only after it was used for real
  through the packed product. A claim that turns out false is fixed in the
  code first, never by rewording the claim.
- **Nothing merges unproven.** Before a pull request merges, what it changes
  has been used for real through the packed product, and the record is on the
  pull request; hosted CI green on its first run and every review thread
  answered are also required.
- **No fakes in tests (2026-10-12, 2026-10-17: "there can be no more fakes at
  all everything needs to be tested meaningfully or in actual use cases").**
  Never invent data a test feeds the code: outside-world input is only a
  recorded real exchange, kept with its capture date and the command that
  captured it. A test that only checks that some text, key or file exists is
  not a test. When only a real run proves something (hosted CI, the packed
  product, a real provider call at release), the real run is the proof.
- **Our own job caps stay ours.** Caps used to run this project's own work
  never go into the repository, and no time box, turn cap or tool cap of ours
  stops a job mid-run.
- **Every job through our own app.** Coding and review jobs run through Muse
  Spark Code itself, so its gaps show; a gap found that way is fixed in the
  product.
- **Muse requests go out only on a known contributor tier.** A request whose
  billed tier is not known to be contributor is never sent.
- **Credentials are never seen.** A key or token is stored without anyone
  reading its value (the operating system's store, or an encrypted file), and
  never printed, logged or put on a command line.
- **Never `--no-verify`**, never weaken a gate to get green, never re-run a red
  check into green: read it and fix the cause.
- **Research first, choose the most robust (2026-10-17).** Before suggesting,
  keeping or building anything, research it and verify that it is the most
  robust, feature-rich and reliable way to do it, "not some broken or half
  cocked hairbrained plan". This covers everything in the project, what exists
  as much as what is new: "this includes **ALL** of the current code, plans,
  milestones, etc."
- **Bleeding edge, always (2026-10-17).** The owner: "we need to be on the
  bleeding edge for each of these models, providers, and cli … as soon as an
  sdk drops or there has been a bugfix or a feature update etc we need that
  immidietly accounted for and incorporated into our app and tested
  accuratly". Every model, provider, SDK, CLI, protocol and editor the product
  uses is followed at its latest release. A new release, fix or feature is
  incorporated at once and tested accurately, never left as a gap.
- **"etc" means everything else (2026-10-17).** The owner: "etc means
  everything else i have not mentioned or thought of". It covers every case
  the owner did not name and every case nobody has thought of yet. Never read
  it as a short list.

### What the app must do (product rules; their decisions are in PLAN.md)

These are the owner's decisions about how Muse Spark Code behaves. Build them
into the product as code, exactly as stated, and nothing from the section
above.

- **Limits (2026-10-16, 2026-10-17).** The only hard-coded limits are each
  provider's own, per provider and per model, from the model's capability
  record ("the limits we set on our agents hardcoded are **ONLY** the limit
  set from the providers"). Every other limit or threshold is one the person
  sets in the app, none by default: per agent or role (the model role
  settings), per team, and for their machine's resources ("the limits are
  supposed to be setable in the app to prevent overconsumption or use").
- **Every cap the person sets is static or dynamic, and a cap that fires
  notifies the orchestrator (2026-10-17).** The owner: "the caps should be
  dynamic and static ie if we set a dynamic cap lets say 80 perct cpu cap that
  should allow as many agents as the role limits allow up until it hits the
  cpu cap when this cap is triggered the orchistrator should get a
  notification so it can assess what needs to be done if jobs should be paused
  or moved etc, and this should be true for all of the different caps and
  restrictions that can be set by the user". A static cap is a fixed ceiling
  ("dont use more than this many agents"). A dynamic cap on a live reading
  fires only when the reading stays over its threshold for the duration the
  person set with it ("you dont want to trigger a stop for like breif
  spikes"), and clears only when it stays back under.
- **A role gets everything its model's platform provides (2026-10-17).** When
  a model is selected for a role, the role offers every feature that model's
  platform provides, and the person can set custom limits per agent and per
  team. Each role has meaningful instructions, and is applied and enforced in
  code.
- **Orchestration rules are code on the orchestrator role (2026-10-17, D200).**
  The rules that prevent failures and duplicates, and that make the
  orchestrator watch every agent, are enforced by the harness in code on the
  orchestrator role only. They are never a playbook, a skill, a suggestion or
  a document.

## Working rules

1. **Plan first.** Work milestone by milestone as laid out in `PLAN.md` §6.
   New scope goes into `PLAN.md` before code. Open questions go in §3, not in
   code comments.
2. **Gates are not optional.** Hosted CI is the gate for a release: every job
   green on the commit that merges, and a red job is read and its cause
   measured, never rerun into green. Local runs are for fast feedback: format,
   lint, typecheck, the suites you touched and the packed product itself
   (its commands, its help, its errors, its files on disk). Before a release,
   real conversations go through the packed product in the real-life run
   (CONTRIBUTING.md, "Before you open a pull request"). Never weaken a gate
   (rule levels, ignores) to get green; fix the code or record a justified
   deferral in `PLAN.md` §7. An exact-size assertion may move with the
   measured number and a one-line reason in the same change. A limit on what
   the product does follows the standing rule above (models only).
3. **Prove new gates and tests fire.** A test or lint rule that has never been
   seen to fail is a decoration. Break the thing on purpose, watch it fail,
   revert, and note it in the milestone's certification record under
   `docs/certification/`. Tests run real code only, no exceptions: no
   `vi.mock`, fake timers, stand-in for our modules, a provider, the CLI,
   GitHub, an MCP server, the editor API or a store, no hand-answering local
   server, no invented data, no test that only checks text exists, no
   screenshot or frame comparison. A UI change gets one small
   local look (`npm run ui:look -- <scene>`).
4. **Escape hatches are logged.** Any `eslint-disable`, `@ts-expect-error`,
   `as` cast that is not a narrowing the compiler can verify, or `any` needs an
   inline reason **and** a row in `PLAN.md` §8.
5. **Constants, not literals.** Tunables live in `src/shared/constants.ts`.
   `0`, `1`, `-1`, `2`, `100`, empty collections and array index 0 are fine
   inline.
   - **Text the user reads** lives in the English table
     `src/shared/l10n/en.ts` and is read as `UI_TEXT.key` when the code runs,
     never at module load (the gate fails it), so the installed language is
     the one shown (PLAN.md D33).
   - **A sentence around a value** is one template, `{duration}` in `Thought for {duration}`, filled with `fill`. **A count** is `forms({ one, other })`
     read with `plural`. Numbers, percentages, units and dates go through the
     `Intl` helpers in `src/shared/l10n/text.ts`.
   - **"Label: detail" and "Label (id)"** may stay spliced when the detail is
     technical.
   - **Text the model or Meta reads** is `MODEL_TEXT` in constants.ts and
     stays English. A feature that only a lazily loaded bundle reads has a
     block of its own beside it (`REVIEW_MODEL_TEXT`, `MODEL_API_MODEL_TEXT`,
     `CODE_INTEL_MODEL_TEXT`, `WEB_FETCH_MODEL_TEXT`…), so the activation
     bundle does not carry it: one object is carried whole, and
     `npm run build` fails a `MODEL_TEXT` key that no file of
     `dist/extension.js` reads, a block in any shipped bundle but its
     declared readers, and a new block the split check does not guard
     (PLAN.md D6, 2026-10-03 and 2026-10-04).
   - **Node bundles share English fallback** (`dist/uiText.js` and its generated
     runtime/hooks/surfaces/media regions, PLAN.md D6).
     Each bundle keeps its own installed-language state; lazy factories install
     the caller's table before use. Production chat splits optional account/developer/help/runtime English
     behind `loadDeferredEnglish`; its generated validation templates preserve
     the complete shape and slots. Independent browser pages and integration
     bundles keep their inline fallback.
   - **Adding or changing a key** means every table in `l10n/` gets it too,
     or `npm run check:l10n` fails.
   - **New UI surfaces ship lazily**, on first use, with accessible loading,
     an honest chunk-load failure and retry, and a measured budget of their own.
     Startup and the original deferred aggregate retain their existing caps;
     reserve first-paint bytes for chat and its first turn.
   - **Design tokens (M114, D94).** Colours, radius, elevation, alpha,
     spacing, typography and motion come from `design/tokens/muse.tokens.json`.
     Read `design/tokens/README.md`; regenerate with `npm run build:tokens`
     and pass `npm run check:tokens`. Raw CSS/TypeScript paint is guarded;
     generated token files alone contain it. Meaningful motion uses the
     120/180/240 ms scale under the no-preference reduced-motion guard.
     Every visual change gets one small local look (`npm run ui:look --
<scene>`, pictures to `temp/ui-look/`, no baseline, no comparison, no
     CI), in one light and one dark theme, and the two pictures go into
     the change's certification record. README screenshots use `scripts/readme-shots.mjs` (2 MiB curated set).
6. **No dead code, no placeholders.** No commented-out code, unused exports,
   unused dependencies, TODO or FIXME, stubs, temporary code, fallbacks to
   legacy code, workarounds, fake implementations or mock data, anywhere. A function that cannot do its job throws or returns an explicit
   error; it never returns an empty success.
7. **Boundaries are validated.** Every message across postMessage, every MSP
   frame, every HTTP response is parsed with a zod schema before use.
8. **Secrets never leave SecretStorage.** No API keys in settings, logs,
   telemetry, tests, or fixtures. The pasted Model API key is never passed to
   any child process: the Muse Code CLI signs in on its own.
   - **Outside VS Code (the ACP agent, PLAN.md D61).** The operating
     system's credential store stands in for SecretStorage: it is the store
     VS Code's SecretStorage itself rests on. The key goes in only through
     `muse-spark-code-acp auth set`, from its standard input (the user's
     terminal, or a pipe into it); never from an environment variable, an
     argument or a file; and it is never passed to a child process
     (`muse serve`, a tool, a check). A `META_API_KEY` the user sets in the
     agent's own environment is theirs for Muse Code, not the stored key:
     as the extension's `muse serve` inherits it (PLAN.md D1), it reaches
     Muse Code's processes only, where it counts as Muse Code's credential.
     The agent takes every credential variable (`*_API_KEY` and the named
     ones hooks never get) out of its own environment at start, so no
     shell command, hook, git or helper it starts sees one.
   - **The exception: headless runs in CI (M80, PLAN D65).** GitHub supplies the Model API key to the Action's own run-step process through its environment. The step directly execs the trusted launcher, which deletes that variable before it starts any child and holds the key only in memory until final cleanup. It sends the key only over private standard input to two trusted installed agent commands: `muse-spark-code-acp exec --key-stdin` for the run, and `muse-spark-code-acp scan-secrets --key-stdin` for the exact private staged patch. Both hold it in memory only, clear their references in finally, and never store it. No Git, tool, hook, check, install, apply or other child receives it in an environment, argument or file. The launcher's initial OS environment can remain inspectable by the same user; deleting the variable does not erase that record or guarantee memory zeroization. Nothing else is excepted.
   - **The CLI's credential file.** The extension reads only its structure
     (`src/core/backends/musecode/credentialFile.ts`): the schema version,
     which providers are named (only `meta` speaks for the sign-in), each
     one's `storage` lane, and whether `meta` has an `api_key` or
     `access_token` entry (the parse replaces the value with `true`). It
     also reads the file's size and modification time. Never a token
     value.
   - **When the structure cannot say**, the CLI answers `account/read`
     (PLAN.md D26). Its `label` (an e-mail address) and `avatarUrl` are
     never kept, logged or shown.
   - **Text the CLI chose.** A `loginCompleted` message, `muse serve` or
     `muse skills` stderr and an MSP error message never reach the log as
     sent: they can name a path under the user's profile or an account,
     and the redactor catches only keys. Log a protocol word through
     `wireWordForLog`, an MSP failure through `failureForLog`, stderr
     through `stderrForLog`, or fixed words.
   - **Logging.** Log through the `LogOutputChannel`; never `console.log`
     in the host.
9. **Dependencies are deliberate.** Before adding one: check peer ranges
   against the pins in `PLAN.md` §2 D3 (`npm info <pkg> peerDependencies`),
   check `npm audit`, pin the exact version (`.npmrc` enforces `save-exact`),
   and record the reason in `PLAN.md`. No global installs.
10. **Docs move with code.** New command, setting, or script → `README.md`.
    Every meaningful change → `CHANGELOG.md` under `[Unreleased]`. Every
    command documented in the README must have been run successfully.
11. **Do not imply Meta endorsement.** The product is unofficial; keep the
    "(Unofficial)" suffix and never embed or ship a Meta API key.
12. **Anything that costs money is opt in and loud** (the owner's rule,
    PLAN.md D30, D34). A paid call runs only while `PaidFeatureGate.isOn`
    (`src/core/paid/paidFeatures.ts`) says so: its setting on, machine-scoped
    and available by default on interactive Model API (D78), with consent
    naming its price before spending. A spending limit applies only when the
    model's platform sets one or the person sets one in the model role
    settings (the standing rule on limits). Existing
    explicit false settings remain off; explicit OFF-to-ON changes still
    confirm the price. ACP/headless defaults and Muse Code opt-ins are unchanged. It is
    named in the composer's badge, shown as its own row marked paid
    (`paid` on the item), counted in `PaidUsage` for Account & usage, and
    billed to the Model API key: offered on the Model API backend, and on
    the Muse Code backend only while a key is stored and only through the
    extension itself (the `ide` server, M44; the key never reaches
    `muse serve`). Every use asks first in the paid-use popup (M58, D48:
    `PaidUseConsent` in `src/core/paid/paidConsent.ts`, Allow once / Allow
    always in this workspace / Deny), in every mode, Bypass included; a
    paid call never gets an approval card or a session rule. In the ACP
    agent (D62) a feature is on only with its flag, and the same question
    is the editor's permission prompt (`src/acp/paid.ts`). The
    subscription never pays for one. One exception to the key is planned
    (PLAN.md D50, M85, experimental): the TypeSafe assist is billed to the
    user's own TypeSafe key instead of the Model API key; every other part
    of this rule applies to it unchanged.

- **Tab (M94, D73):** `museSpark.modelApiTab` is machine-scoped and on by
  default. The first paid request asks D48's question with the model's rates
  (and the person's own budget, when they set one). Allow once covers this window until
  it closes; Always is workspace-scoped and revocable; Deny snoozes this
  window. No charge precedes consent. Consent is keyed by (`tab`, model,
  price): the question names the request's own model, which is the model
  sent; a grant for one key never answers another, Allow always is recorded
  with its key, and a legacy grant without one asks once (RVM94KR2). A
  request re-checks its key, hook policy epoch and cancellation after every
  wait and last at the HTTP send. Configured Cursor Tab hooks receive the
  full, unredacted file text (`beforeTabFileRead`) and the accepted text
  (`afterTabFileEdit`, 512 characters a field). Tab uses only the stored
  Model API key on either backend, with a hard cross-window local-day
  ledger. Its small status item shows at activation; `dist/tab.js` loads the
  provider, completion engine, ledger and menu on first use.

- **Headless exception (M80, D65):** interactive popup policy above stays.
  Headless images require the explicit `--image-generation` flag,
  `acceptEdits`, and a per-use admission/settlement tally (a USD budget only
  when the person passes one);
  refuse before unaffordable dispatch. Protected paths and
  `requiresAsking` are denied. No remembered grants, ordinary approval
  grants or translated-title decisions. CI paid defaults off; hosted search,
  voice, subagents and schedules stay unavailable. The conditional budget
  theorem, price, returned/uncertain tally and retained liability are visible;
  the subscription pays none of it.

13. **Keep the reference current.** Every new command, setting or feature
    updates `src/shared/featureCatalog.ts` in the same PR. Update the CLI table
    for a new runtime command; regenerate with `npm run reference:generate`.
    `npm run check:reference` validates coverage, descriptions, relationships
    and generated-file freshness. Keep help's data and UI lazy.

14. **Wire shapes come from a live capture.** A row, parser or schema for
    something Muse Code or the Model API sends is written from a captured
    frame (the certification record names the capture, its workspace and its
    counted model attempts), never from a guess; the tests use that shape.
    Anything the wire may add later (a goal status, an MSP field) is shown
    as it came rather than dropped (PLAN.md D36, M43).

15. **Re-read what the hook committed.** After every commit, re-read your
    staged diff and the committed diff: the pre-commit hook runs
    `eslint --fix` and can rewrite logic, not only formatting (G58 in
    `docs/orchestration-gotchas.md`).

16. **Outside code is vetted first.** A pull request, branch, fork or patch
    not authored by the owner or this project's agents follows
    `docs/contributor-vetting.md`: no workflow approval before the change
    review, no checkout where credentials live, and no merge, cherry-pick,
    copy or reproduction without the owner's explicit go for that pull
    request (PLAN.md D102).

17. **Keep the roadmap current.** Every milestone change (a new milestone, a
    status line, a release, a changed user-facing limit or label) updates its
    entry in `docs/roadmap/entries.json` and regenerates `ROADMAP.md` with
    `npm run roadmap:generate` in the same change. Release preparation adds
    PLAN.md §10's `X.Y.Z preparation (…)` record; publication adds
    `X.Y.Z released (…)`; regenerate after each. `npm run check:roadmap`
    fails on a stale file (any change to the milestone headings, statuses,
    §10 records, changelog headings or entries it is built from changes its
    source fingerprint), a milestone without an entry or an entry for a
    milestone PLAN.md does not have (PLAN.md M122; CONTRIBUTING.md has the
    entry format).

## Layout

```
src/extension.ts      activation: the view, the panel, the commands, the openers
src/host/**           VS Code adapters (views, conversation, backend managers,
                      the Model API bundle's entry (dist/modelApi.js, loaded
                      when that backend first starts), its schedule entry
                      (dist/schedules.js, loaded on the first schedule use),
                      the plan reader's
                      (dist/planMarkdown.js, loaded on the first plan action),
                      the review's (dist/review.js: git's material, the turn
                      text, the Plan-mode hold and edit review, loaded the
                      first time one is used),
                      code intelligence's `ide` answers (dist/codeIntel.js,
                      loaded on the first call) and voice's drivers
                      (dist/voice.js, loaded on the first recording),
                      the window's web fetch (dist/webFetch.js, loaded on
                      the first fetch),
                      the Auto reviewer on Muse Code (dist/museCodeReviewer.js,
                      loaded on the first review),
                      the report dialog's handler and export paths
                      (dist/report.js, loaded on the first report; M93) beside
                      the window's flight recorder (support/: its journal and
                      markers and the dialog's facts, loaded at activation),
                      What's New after an update (whatsNew/: the check and
                      claim at activation; the page in dist/whatsNew.js,
                      loaded on the first page or notice, its content
                      dist/whatsNew.json made from CHANGELOG.md by the build),
                      the search worker and web fetch's page converter worker
                      (dist/pageWorker.js, started for each page), the
                      browser check's processes (the verified pinned runtime
                      only, behind its own proxy; no system browser, no
                      policy reads) and bundle entry (dist/browserCheck.js,
                      loaded on the first check), its runtime's acquisition
                      and verification (dist/browserRuntime.js: the pin,
                      download, bounded ZIP reader, store; loaded only to
                      prepare a runtime) and the runtime's consent and command,
                      bundled skills' Muse Code installer (skills/,
                      dist/bundledSkills.js, loaded on first use),
                      first-party skills (first-party-skills/, installed beside
                      the vendored workflows, including the M116
                      orchestrator-playbook reviewer charter),
                      Tab's lazy provider, ledger and menu (dist/tab.js),
                      shared schema conversion (dist/structuredSchema.js),
                      Model API code intelligence and MCP pools
                      (dist/modelApiCodeIntel.js and dist/mcpPool.js),
                      with its status item in the activation shim,
                      media attachments (dist/media.js: the attach port, the
                      recording picker and the uploaded-files list, loaded on
                      the first attach or recording action; M105) and screen
                      recording (dist/screenRecord.js: the recorder command,
                      loaded on the first recording; M105),
                      the vault's window (vault/: the panel host and the
                      native editor in dist/vault.js, loaded on the first
                      vault command; only the command shim stays at
                      activation, and both commands refuse closed until the
                      broker-backed service lands),
                      the estimator's engine and history honesty
                      (dist/estimator.js, loaded on the first estimate; M117),
                      commands, auth, settings, mentions,
                      editor tracking, usage trace logs, voice, the IDE tool
                      MCP server (diagnostics, code intelligence, images, web
                      fetch, browser check), VS Code's language services, the MCP servers'
                      spawner, the network posture, web fetch's pinned
                      transport, git and pull requests through VS Code's Git
                      extension and GitHub sign-in, and the verify loop's editor
                      side: settled diagnostics, format on edit and turn
                      checkpoints' shadow repository)
src/core/**           backend-agnostic logic; must not import `vscode`
                      (media/inspectEntry.ts, the portable first-use inspector
                      shared by VS Code and ACP through dist/media.js;
                      MSP host, Model API client and tools, the MCP client,
                      the hook dispatcher and, in dist/foreignHooks.js loaded
                      on first use, the adapters for hooks imported from
                      other agents (M91),
                      context (rules, skills, custom agents), Muse Code's
                      questions' portable registry (questions/: states, clock,
                      owner-only store port and exactly-once late delivery; M112),
                      the orchestrator playbook (orchestration/playbook/: policy,
                      journal, outcomes, brief, reports and integration; D96/M116),
                      provider accounts and thresholds, backend pools, developer profile
                      ownership and account usage projections (M108; installed bindings
                      wait for M95/M102/M104/M109),
                      memory, export, worktrees, git and GitHub (push plans,
                      REST client, draft prompts), usage,
                      dictation, Muse Voice, the paid gate, network failures,
                      code intelligence and the repo map, web fetch's
                      public-address checks and HTML converter, the browser
                      check's address rule, managed-policy check, CDP pipe
                      and run, review (its git material, prompt and Plan-mode hold), the verify
                      loop's check commands, diagnostics report and the files
                      it never opens because tools run them, the checkpoint
                      restore plan, the paired efficiency evaluation,
                      observation packing, Tab's context windows, requests,
                      filters, typing-through cache, scheduler and spend, the flight recorder policy
                      and problem report builder and second scrub)
src/core/resources/** portable machine sampler, governor, queue, registered-tree
                      accounting/actions, disk and created-root policy;
                      dist/resourceGovernor.js loads on first governed use,
                      dist/resourceProcess.js is the governed launcher,
                      dist/resourceAdmission.js is the shared process shim
src/webview/resources/** shared chip/popover via injected source and lazy loader;
                      dist/webview/resourceSurface.js shares React/text chunks
src/webview/usage/**  ResourcesSection and lazy history boundary;
                      dist/webview/resourceHistory.js plus its CSS; M102 mount
src/runtime/resources/** machine settings/status/resume, session port and exec-v2
                      adapter; active spawn/history bindings remain named
src/acp/**            the ACP agent (D62): the ACP side of a session and the
                      translation of the engine's events, questionDeferral.ts
                      (dist/acpQuestions.js, loaded on the first question,
                      elicitation or question command; M112: cooperative form withdrawal,
                      local answer/list commands and the registry binding);
                      must not import
                      `vscode`
src/runtime/reporting/** deterministic report engine and portable facade
                      (dist/reporting.js), shared by editor, CLI and ACP;
                      permitted network reads (dist/reportingNetwork.js),
                      destination contracts (dist/reportingDestinations.js),
                      editor adapter (dist/reportingPanel.js) and shared page
                      (dist/webview/reportingPage.js), loaded on first use
src/runtime/exec/**   headless arguments/protocol/egress (dist/exec.js, loaded
                      only by the exec command), stdin key/scanner,
                      bounded lifecycle, ACP client/tap and per-attempt ledger
src/runtime/**        the agent's process: arguments, backends outside VS Code,
                      the OS credential store (D61), `auth`, `login`,
                      `report` (M93), `providers accounts` and the runtime
                      account services (dist/runtimeAccounts.js, loaded on the
                      first accounts, developer or keyed headless command; M108),
                      the journal-backed `playbook` command
                      with its ACP `/playbook` surface (M116); the schedule command and settle path
                      (schedules/), and the native background scheduler entry
                      (dist/scheduleBackground.js, run by the OS launcher)
src/shared/**         constants + zod protocol shared by host and webview
src/shared/l10n/**    the English table (en.ts), fill/plural/Intl helpers, the
                      table checks and the list of translated languages
l10n/                 translated tables (ui.<language>.json) and the names the
                      localization gate lets stay English
package.nls.json      the manifest's text (commands, settings, walkthrough)
src/webview/**        React 19 app (browser project, own tsconfig);
                      TasksApp is the tasks tab's read-only document (M87),
                      mounted by main.tsx for `data-surface="tasks"` and
                      speaking only shared/tasksProtocol; the tab itself is
                      host/views/tasksPanel (a WebviewPanel behind the
                      controller's TasksTabPort, no serializer, no composer);
                      stepSummary.ts names a folded run of steps;
                      components/GooeyMenu.tsx is the one radial menu (and
                      useRowMenu, each row's ⋯ opener) over gooeyLayout.ts's
                      pure geometry for its fanned column of labelled
                      pills; diffTally.ts and
                      components/DiffTally.tsx add up the conversation's edits;
                      models/sections/accounts, usage/AccountsSection and developer/
                      are optional M108 surfaces, mounted only through their lazy owners
src/webview/bridges/theme/**
                      the native hosts' theme colours onto the token roles
                      through MHP's theme message (M114 lane C, with M104)
design/tokens/**      the W3C design-token source (muse.tokens.json, M114
                      D94) and its generated CSS/JSON consumers
                      (scripts/build-tokens.mjs); design/fonts/ holds the
                      pinned OFL pack's manifest, subsets and licences
                      (never in the VSIX)
src/runtime/fonts/**  the pinned font pack's verified installer
                      (`fonts install`) and the portable UI/code font and
                      ligature preferences (M114 lane F)
native/windows/**     dictate.ps1, the Windows dictation helper; capture.ps1,
                      Muse Voice's recorder; the job helpers' C#
                      (MuseSparkJob.cs, MuseSparkMcpLauncher.cs and the
                      shared MuseSparkMcpJob.cs), compiled on first use
native/darwin/**      Dictation.swift, Info.plist, build.sh, check-disclaim.sh:
                      the macOS helper (built and checked in CI), with
                      Muse Voice's `--capture` mode
resources/            the walkthrough
test/unit/**          vitest (node + jsdom via docblock) over real code only:
                      no mocks, fakes, stand-ins, invented data, screenshot
                      comparisons or tests that only check that text, a key
                      or a file exists; no `vscode` module (the editor API is
                      tested inside VS Code, test/integration). What the
                      deleted fake tests covered: docs/real-life/unproven.md
test/e2e/**           the live drills, kept listed for the real-life run
                      (the Muse Code CLI; the Model API sweep and the M75
                      evaluation, which bill the owner's key)
test/integration/**   @vscode/test-cli, runs inside VS Code, over the workspace
                      test/fixtures/workspace (code-intel/ is a TypeScript
                      project its language service reads)
test/harness/         the webview behind a scripted host, for the local look
                      (`npm run ui:look -- <scene>`), the README pictures and
                      the accessibility gate; themes/ holds VS Code's four
                      captured themes
                      playbook.mjs scenes run standalone as
                      `npm run harness:playbook` until the panel port is bound
test/hosts/           the integration tests in VSCodium and the forks, and the
                      installed ACP agent's help, trust refusal and key round
                      trip, one script per check (hosts.yml, forks.yml)
scripts/**            esbuild build; bundle-size, bundle-split, host-globals,
                      notices, audit, PSScriptAnalyzer, semgrep, accessibility,
                      localization, tokens, reference
                      and host API gates; theme capture, the
                      pseudo-locale, the local UI look, image rendering,
                      changelog notes, What's New's content (lib/), VS Code
                      versions for CI, the ACP
                      agent's package
docs/certification/   per-milestone gate-fire records and screenshots
docs/plan-archive/    closed history moved out of PLAN.md, byte for byte
                      (decisions.md, milestones.md, gates.md); each passage
                      stands between hashed markers. `check:plan`
                      fails when PLAN.md passes 85% of the plan reader's
                      bound; CONTRIBUTING.md has the archive procedure and
                      `npm run plan:archive` (scripts/plan-archive.mjs)
                      moves a passage with its proofs
docs/ide-compatibility.md, docs/ide-compatibility/
                      the plan for editors beyond VS Code (D60), the
                      generated record of what the extension asks of its host,
                      and hosts.md, what each editor was tested at
action/**             composite proposal Action, bounded trusted launcher,
                      sanitized Git and exact verified package installation
                      action/apply/ holds prepare and reviewer-approved push
                      in separate jobs; test/action/la-check.mjs judges the
                      live receipt (action-live.yml)
docs/ci.md            headless/CI contract, security and accounting assumptions
docs/schemas/**       generated versioned event/result schemas, shipped in npm
docs/acp.md           the ACP agent's guide, shipped as its package's README
docs/orchestration-gotchas.md
                      what went wrong orchestrating the agent fleet, the rule
                      that prevents it, and the milestone that enforces it in
                      the app (D100); add a row when you find a new one
docs/orchestration/   SSH connection limits (ssh-limits.md) and the playbook
                      chapter on placement, load balancing and moving work
                      (playbook-placement.md, adopted by the M116 skill)
media/                icons, banner, social preview, README screenshots
```

## Commands

| Task                           | Command                                              |
| ------------------------------ | ---------------------------------------------------- |
| Every local gate in one run    | `npm run quality`                                    |
| The gates CI runs everywhere   | `npm run quality:gates`                              |
| Accessibility gate             | `npm run test:a11y` (merge and release, not PRs)     |
| Token generation / gate        | `npm run build:tokens` / `npm run check:tokens`      |
| Local UI look                  | `npm run ui:look -- <scene>`                         |
| Reference gate                 | `npm run check:reference`                            |
| Roadmap generation / gate      | `npm run roadmap:generate` / `npm run check:roadmap` |
| Localization gate              | `npm run check:l10n`                                 |
| Host API record (D60)          | `npm run check:host-api` (`-- --write`)              |
| Panel in the pseudo-locale     | `npm run ui:look -- <scene> --lang=pseudo`           |
| Unit tests (no coverage gate)  | `npm run test:unit`                                  |
| Integration tests              | `npm run test:integration`                           |
| Dev build / watch              | `npm run build:dev` / `npm run watch`                |
| Production build + size budget | `npm run build`                                      |
| Package `.vsix`                | `npm run package`                                    |
| Package the ACP agent (D62)    | `npm run package:acp`                                |
| Exec schemas (M80)             | `npm run schema:exec` (`-- --check`)                 |
| Scan staged text (M80)         | `muse-spark-code-acp scan-secrets <file>`            |
| Host checks (hosts.yml)        | `sh test/hosts/<script>.sh`                          |

M80's lanes are integrated; their fake-only suites were deleted on 2026-10-17
(no fakes). Do not call exec, the scanner or the Action supported until the
live receipts (L, LA; LR after release) pass.

## Toolchain pins that matter

- `typescript` stays on **6.0.x** until `typescript-eslint` declares support
  for 7 (`npm info typescript-eslint peerDependencies`). Upgrading early
  silently disables every type-aware lint rule.
- `knip.jsonc` must stay `.jsonc`; knip 6 rejects pseudo-comment keys.
- Cycle detection is `dpdm`, not an ESLint rule; `import-x/no-cycle` and knip's
  `cycles` are known to report nothing.
- Run knip as plain `knip`; `--strict` implies production mode and, without
  `!`-suffixed entries, analyses nothing while exiting 0 (verified M0).
