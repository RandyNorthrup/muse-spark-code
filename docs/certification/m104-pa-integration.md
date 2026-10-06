# M104PA continuation 3 — B/C central integration

Rig: macmini, `/Users/randy/lanes/M104PA`, 2026-10-06. Base `74b99c4a0`.
Authorized merges: B `737196296` in `39205d54`; C `739cf1771` in `97d15be1`.
No B/C implementation or reserved UI tests were edited. No live/paid calls,
credential reads, downloads, dependency installations, support promotions or
full quality/full-suite runs occurred. The brief requires scoped sequential
verification, at most three test files/workers and repository default deadlines.
Hooks remain enabled; commits use explicit paths and the required coauthor.

## Result and limits

All 28 B request sections and 17 numbered C requests have central dispositions
in their request records. Integrated factories, transport and discovery are
actual implementations. Optional native dependencies remain unavailable until
an owning adapter supplies the typed contracts. Internal editor-service schemas
are authored MHP services, not inferred provider wire shapes. B's captured
provider parsers and events remain unchanged.

- Lazy `runtimeEngines.js` installs the caller's language and owns auth, Git,
  review/edit review, transfer, worktrees, usage insights, voice and Judge
  contributions as soon as each is acquired. Shared backend/checkpoint stores
  retain backend lifetime. Missing native Best-of-N Git admission explicitly
  rejects instead of selecting the controller's ordinary Git fallback.
- Lazy `runtimeBackendServices.js` supplies actual checkpoint recording,
  dirty-path aliases, exact version-attested diagnostics, selected-model-gated
  code intelligence, pinned web fetch and durable schedules. Exact optional
  hooks/MCP/browser/Auto-reviewer contracts and paid policy/ledger/immutable
  tariff admission share backend teardown; the ledger closes after clients.
- Lazy `runtimeContext.js` reuses the confined saved-plan store, lazy Markdown
  reader and checkpoint-protected edits. Implement uses the real controller's
  trust, confirmation and fresh-session path. Transfer uses native indexed
  picker/confirmation operations.
- Lazy `runtimePresentation.js` composes C's Tasks, What's New and reports.
  What's New uses shipped content, fresh nonces, authenticated same-build
  assets, awaited HTML publication and allowlisted native commands/settings.
  Reports use a facts-only journal, existing scrub/export logic and real native
  save; recovery is queued until the actual chat-ready message.
- Auxiliary plans, managers, roles/traffic, diff and walkthrough have bounded
  validated state and correlated action results. Actions resolve current IDs
  and recheck fresh authoritative records; session/surface retirement suppresses
  results. Traffic summaries are scrubbed; unknown statuses/peers survive.
  Plans and actual advertised-model walkthrough steps have default providers.
  Other pages require real native engine records/actions, never fake lists.
- Companion sessions accept only their assigned immutable binding. Native
  same-batch open-result/lifecycle delivery waits for view adoption. Native
  fragmented input now grows geometrically within the original byte caps;
  retained snapshots pass the five-second deadline without quadratic copying.

## Explicit contract adoption

MHP 1.3 replaces 1.2: versions, negotiated range, wire envelope, both legacy-named
snapshot/lock pairs and owned fixtures move together. Adoption was generated
from the committed 1.2 locks with `node scripts/mhp-schema.mjs
--adopt-version=mhp/1.3.0`. The uncommitted proposal was finalized before commit;
no committed 1.3 lock was readopted. Current-version readoption and old-version
refusal remain tested. `npm run check:mhp` passes against the frozen final bytes.

New service acknowledgements include fresh diagnostics, picker metadata,
file-open/save, HTML publication, command/settings and diff decisions. Native
GitHub uses protected owner-bound UUID leases and the existing captured REST
parsers; no OAuth token is bridged. Key entry requests carry workspace/owner IDs
and completion only: the native terminal must execute trusted installed ACP
`auth set` with private stdin, final owner/signal checks and awaited process exit.

Fallback UI adds clipboard and external-open through existing schemas. Four
presentation headings and complete provider-price/budget consent text are in
English and all fourteen translated tables. Spanish uses “Roles de agentes”
so the unchanged untranslated-text gate remains meaningful. Node language
factories install the caller's table; browser tables are installed before mount.

Standalone paid requests refuse before a popup without native configured hard
ledger and verified catalog quotes. Exact selected-model/provider price,
complete maximum dispatch cost and shared daily budget are named in consent.
Unknown, invalid, mismatched or replaced quotes refuse. Every answer rechecks
owner/profile/quote. ACP/headless defaults remain as before.

## Verification

All commands ran directly here, one heavy command at a time. No Vitest command
used `--testTimeout`, test-name filters, skips or environment gate overrides.
Every invocation used at most three files and `--maxWorkers=3`.

| Check                                       | Result                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                         | All host/browser/unit/e2e/integration and four M104 compiler projects pass; runtime namespace is also in unit discovery |
| Changed-file ESLint, zero warnings          | Pass                                                                                                                    |
| Changed-file Prettier                       | Pass                                                                                                                    |
| `npm run deadcode` (plain knip)             | Pass, no new ignores                                                                                                    |
| `npm run duplication`                       | Pass, zero clones                                                                                                       |
| `npm run cycles`                            | Pass                                                                                                                    |
| `npm run check:l10n`                        | Pass, fourteen tables, zero problems                                                                                    |
| `npm run check:mhp`                         | Pass                                                                                                                    |
| `npm run build`                             | Pass including size, split, localization and host-global checks                                                         |
| `npm run check:host-api`                    | Expected F-owned generated inventory delta only; see handoff                                                            |
| A runtime namespace, four files             | All pass: real auxiliary admission, paid/native auth services browser acknowledgements and corrupt-bundle refusal       |
| A existing runtime/ACP/MHP/companion suites | Pass after owned fixtures adopt actual bindings, trust and final lock bytes                                             |
| Native/companion/ACP stdio E2E              | 29 tests pass at default deadlines                                                                                      |
| B engine namespace, 25 files / 225 tests    | 224 pass; one paid-image fixture wait remains, below                                                                    |
| C UI namespace                              | 55 non-browser tests pass; browser beforeAll cannot start missing WebKit, leaving 962 cases unexecuted                  |

B's checkpoint suite was rerun alone: write/restore/Redo passes at the default
five-second deadline; the paid-image test still expires at its one-second
`vi.waitFor` before the asker fires. A temporary owned fake-only probe of the
same flow waiting for the actual question passes, including the two adjacent
paid cases (3/3). The probe was removed. B owns the fixture correction; this
namespace is not claimed green. Two prior failures were diagnosed, and no
continued rewrites of B's implementation or longer test deadline were attempted.

The stock native paid E2E now verifies refusal before any popup or hosted-search offer when no native catalog/ledger is configured; a normal fake chat still completes. The ACP write fixture now explicitly grants workspace trust as well as approval;
B's guarded writer correctly refuses its old untrusted setup. Companion E2E
reads the actual HTML-assigned binding instead of inventing a surface UUID.
Both corrected owned suites pass.

C's fixes retain generation-tagged latest-session Tasks/What's New acquisition,
late acquisition drain, authoritative Tasks-close retirement and clipboard
abort/disposal result refusal. The passing tasks/whatsNew/factory suites cover
the Node ownership behavior. Browser installed-host receipts remain open; an
already started clipboard write cannot be undone.

Compiler separation is structural: Node integration
excludes the DOM-only shared browser entry, which is independently fully typed
in `src/shared/browser/tsconfig.json`; the browser project includes its real
CSS declarations. No existing rule, threshold or budget is weakened.

## Final measured bundle sizes

| Artifact                                              |                  KiB / unchanged or own cap |
| ----------------------------------------------------- | ------------------------------------------: |
| extension                                             |                                 450.4 / 600 |
| Model API                                             |                                 447.5 / 475 |
| ACP                                                   |                                 830.1 / 850 |
| runtimePanel / runtimePanelPorts                      |                       96.2 / 100; 57.0 / 75 |
| runtimeContext / runtimeEngines                       |                      22.1 / 50; 133.2 / 150 |
| runtimeBackendServices / runtimePresentation          |                      138.3 / 200; 44.6 / 50 |
| hostProtocol                                          |                                   24.2 / 50 |
| checkpointStore                                       |                                  77.3 / 225 |
| VS Code startup / portable complete                   |                794.0 / 900; 1,025.5 / 1,100 |
| Existing legacy deferred                              |                                   49.7 / 50 |
| Portable Walkthrough / Diff / Manager / Plans / Roles | 0.6 / 5; 1.8 / 5; 1.5 / 5; 2.1 / 5; 1.6 / 5 |

## Native and F handoffs

F must regenerate/review `docs/ide-compatibility/host-api.md` with
`npm run check:host-api -- --write`. Observed Node counts: crypto 53→55,
fs 36→38, fs/promises 52→54, os 9→10, path 90→95, url 7→13.
349 VS Code APIs, 32 importing files and 61 theme variables remain unchanged.
A does not edit the reserved generated inventory.

Exact ACP/test/distribution inventories must include the new Node artifacts
`dist/{runtimeContext,runtimeEngines,runtimeBackendServices,runtimePresentation,
hostProtocol}.js`, the fifth portable root `presentation.js` and its CSS,
complete static/dynamic outputs and verified `modules.json` hashes. Existing
dependencies `sessionBoard.js`, `checkpointStore.js` and `planMarkdown.js`
must also be included: the current ACP Node list omits them. Optional Judge and
browser runtime entries must remain in their applicable exact closures. Production build
already emits/checks these graphs; reserved packaging scripts still need F's
adoption before shipment. C's portableBundle test helper also needs the fifth
root, and its reserved panelBridges fixture still advertises 1.2; C must adopt
1.3 there without changing A's refusal of legacy versions.

New Node caps are 50/150/200/50/50 KiB respectively. The five C portable page
closures each have an independent 5 KiB cap, counting non-eager static imports.
The 1,100 KiB complete portable graph, 900 KiB startup and existing 50 KiB
legacy deferred cap remain unchanged. No existing cap is raised.

D/E/F must adopt 1.3 services and qualify native auxiliary open/reload/move/close,
ready ordering, immutable binding, dialog focus/inertness, clipboard/external
open/save failures, all language bootstraps and four themes. Fresh diagnostics
must attest the exact document version. Protected Git/GitHub/auth must retain
native credentials, physical owner, sanitized environment, final process
admission, cancellation and actual process-tree drain. Configured hooks require
real file/config/folder watcher and SDK-root callbacks; no guessed file-event
wire was added. Voice needs captured PCM/socket and native drain; Tab/Judge
need eligible context, verified captured capability/price records, shared hard
ledger and exact original settlement. Optional absence never implies support.

F prepares Playwright 1.63.0 WebKit build 2359 and installed Chrome on browser
qualification rigs. Missing executable was
`~/Library/Caches/ms-playwright/webkit-2359/pw_run.sh`; no download was attempted
under this lane's no-network rule. The help catalog/generator named by shared
rules is absent at this base; F supplies its owning source before regenerating
accurate reference and aggregate docs. README/CHANGELOG/PLAN received only the
necessary integration facts, historical 1.3 override and gate deferrals here.

## B's bounded prerequisite stops

- F18: preserve captured Muse workflow events; Model API workflow orchestration
  needs an internal tool/schema/model-text contract and captured selected-model
  tool capabilities, plus a separately sized implementation checkpoint.
- F53: legal-scan needs actual rules, normalization/results, trusted CLI contract
  and captured internal/provider material. There is no engine to adapt.
- F55: device work needs M95 provider-local auth/prices, M96 role/worker/attempt
  journal, accepted security review, manual public invitations, pinned mutual
  TLS, revocation, bounded remote attempt/Git-return contracts and durable
  ownership/accounting. Devices/mDNS remain off; no listener was created.
- F56: remote control needs a reviewed owned broker/session-grant contract,
  captured validated protocol, native cancellable approval, revocation and
  process ownership. An authorized live capture is a prerequisite, not granted
  by this fake-only integration brief.

Each missing engine exceeds the shared ~300-line finding limit. These requests
are explicitly refused pending their contracts; no placeholder factory or W
promotion substitutes for implementation. The lead retains aggregate quality,
coverage, package checks and installed-editor/provider receipts.

## Gate-fire and restored verification receipts

The table below records deliberate mutations, named failure tests and SHA-256
restoration. Scratch logs/structured receipts are ignored under
`temp/m104-pa-integration/`; the checked-in record carries the evidence needed
without requiring those local logs. Final restored runs use the default deadline.

| Mutation                                                       | Observed failure                                                                                                | Restored source SHA-256                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| date-bound (`src/shared/presentationProtocol.ts`)              | exit 1: bounds authored role dates, IDs and collections while retaining unknown statuses                        | `b7c2589d78baacd04bffdf23c39f5fe53d36dcad94696b4a7c25d1da004ea25c` |
| indexed-actions (`src/runtime/panel/presentationViews.ts`)     | exit 1: acknowledges accepted exact reads and refuses removed or unindexed records                              | `3ec82e871478ae3b3243aff300784dcee8ca92e73c9ea87f648497bb5ba3e2c5` |
| duplicate-request (`src/runtime/panel/presentationViews.ts`)   | exit 1: waits for engine acceptance, suppresses retired results and rejects a duplicate request                 | `3ec82e871478ae3b3243aff300784dcee8ca92e73c9ea87f648497bb5ba3e2c5` |
| session-owner (`src/runtime/panel/presentationViews.ts`)       | exit 1: waits for engine acceptance, suppresses retired results and rejects a duplicate request                 | `3ec82e871478ae3b3243aff300784dcee8ca92e73c9ea87f648497bb5ba3e2c5` |
| traffic-scrub (`src/runtime/panel/presentationViews.ts`)       | exit 1: preserves unknown peers/status and scrubs traffic before both publication and index checks              | `3ec82e871478ae3b3243aff300784dcee8ca92e73c9ea87f648497bb5ba3e2c5` |
| quote-current (`src/shared/portablePaid.ts`)                   | exit 1: names the verified provider, complete price and shared budget, refusing unknown or replaced quotes      | `e85f36087c261310bc7d23f66534b118592d2804887d18dcf69443476571327e` |
| github-status (`src/shared/hostApi/methods.ts`)                | exit 1: rejects unprotected GitHub origins, malformed URLs and impossible response statuses                     | `9c5c9ba823b314c441b744a9e4a8a407d13584bc2026c63f6bfe8a1810b82c86` |
| key-entry-cancel (`src/runtime/panel/nativeGitHub.ts`)         | exit 1: asks the native trusted key terminal with owner IDs only and suppresses cancelled completion            | `4baa72ad17f5898a04d75c2987d4bc372c15ee13d01380365d2297b38b460349` |
| ack-correlation (`src/shared/browser/presentation.ts`)         | exit 1: waits for the matching validated acknowledgement and rejects retained handlers on disposal              | `d7637d1da5335592d1909a7bae8bbddeb0f56975c61a862a5ba5290ef40c524b` |
| surface-adoption (`src/runtime/panel/connection.ts`)           | exit 1: adopts the awaited open result before lifecycle and readiness from the same batch                       | `1f37f96cb0e51696fe2e4a78133d7e9a0724d928b60d4c71971844b55789b71e` |
| companion-binding (`src/runtime/companion/server.ts`)          | exit 1: refuses a valid frame assigned to a different authenticated context before any effect                   | `488ebc8a0ab68533e04faae94c0adcd58d70de516d09450a35bdaf6c856b243d` |
| paid-stock-refusal (`src/runtime/panel/runPanel.ts`)           | exit 1: refuses stock portable paid consent before a popup when catalog and hard-ledger configuration is absent | `aa1c1b787f3df2e67009b455c2caffab9ba97d0d5fad1f3ac397ed95456c37b7` |
| after-ready (`src/runtime/panel/runtimeController.ts`)         | exit 1: queues crash recovery until the actual chat ready message                                               | `f64f01d38bee77ec8e6e9a925418a160c6afc8a768e8d08c5d17df360e28b99e` |
| id-minimum (`src/shared/presentationProtocol.ts`)              | exit 1: bounds authored role dates, IDs and collections while retaining unknown statuses                        | `b7c2589d78baacd04bffdf23c39f5fe53d36dcad94696b4a7c25d1da004ea25c` |
| id-maximum (`src/shared/presentationProtocol.ts`)              | exit 1: bounds authored role dates, IDs and collections while retaining unknown statuses                        | `b7c2589d78baacd04bffdf23c39f5fe53d36dcad94696b4a7c25d1da004ea25c` |
| text-maximum (`src/shared/presentationProtocol.ts`)            | exit 1: bounds authored role dates, IDs and collections while retaining unknown statuses                        | `b7c2589d78baacd04bffdf23c39f5fe53d36dcad94696b4a7c25d1da004ea25c` |
| collection-maximum (`src/shared/presentationProtocol.ts`)      | exit 1: bounds authored role dates, IDs and collections while retaining unknown statuses                        | `b7c2589d78baacd04bffdf23c39f5fe53d36dcad94696b4a7c25d1da004ea25c` |
| loader-engineLoader (`src/runtime/panel/panelLoader.ts`)       | exit 1: engines: rejects a corrupt installed module and retries a rejected load                                 | `d3d0bde6702c0358e968d9c51fe7978876e525eafcb55951a4a2d8f93aa80fa0` |
| loader-backendLoader (`src/runtime/panel/panelLoader.ts`)      | exit 1: backend: rejects a corrupt installed module and retries a rejected load                                 | `d3d0bde6702c0358e968d9c51fe7978876e525eafcb55951a4a2d8f93aa80fa0` |
| loader-contextLoader (`src/runtime/panel/panelLoader.ts`)      | exit 1: context: rejects a corrupt installed module and retries a rejected load                                 | `d3d0bde6702c0358e968d9c51fe7978876e525eafcb55951a4a2d8f93aa80fa0` |
| loader-presentationLoader (`src/runtime/panel/panelLoader.ts`) | exit 1: presentation: rejects a corrupt installed module and retries a rejected load                            | `d3d0bde6702c0358e968d9c51fe7978876e525eafcb55951a4a2d8f93aa80fa0` |
| native-best-git (`src/runtime/panel/engineEntry.ts`)           | exit 1: requires a contributed native process guard for Best-of-N Git instead of the ordinary runner            | `c51fcd4df4e70bb999b758ffe6ccf5814c72b4611e4d5c6112cba9a4926af000` |
| node-caps (`scripts/check-bundle-size.mjs`)                    | exit 1: Five new Node caps each report OVER                                                                     | `6d86f99dca6e6fef727ff61bdb86a60558312a07625f32f773f2917e1cb0bdb4` |
| portable-caps (`scripts/lib/webviewBundles.mjs`)               | exit 1: Five portable page caps each report FAIL                                                                | `eb33a9ad6c0958fed3c82d06e77089eadc5b7123c2432a232b26fabee4a1f67b` |

**24 deliberate controls fired**, including ten independently named new
bundle caps. Every mutated source was restored byte-for-byte and its full
SHA-256 compared. The original snapshot deadline failed before geometric
framing and passes after it. A later quadratic-framing mutation passed on this
run; it is **inconclusive and not counted as a fired control**. This optimization
retains the original admission bounds; no deterministic deadline guarantee is
claimed. Restored verification follows in the final receipt paragraph.

Final restored receipt: 176 tests across 15 files pass in six sequential batches, including all four A runtime namespace files, every deliberately mutated regression and the 29 carrier E2E tests. No raised timeout or filtered test was used.
