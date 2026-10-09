# M104PA continuation 3 — B/C central integration

Rig: macmini, `/Users/randy/lanes/M104PA`, 2026-10-06. Base `74b99c4a0`.
Implementation: `3cf813d0aca90f7e2c7727ff4148e3d354271790`.
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

F updates the legacy-named native guide `docs/ide-compatibility/host-api-panel-1.1.md` for 1.3 adoption and prepares Playwright 1.63.0 WebKit build 2359 and installed Chrome on browser
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

## FIXM104PA3 — RVM104PA3 repairs (2026-10-06)

Base: `fa60c3763`, macmini, this same worktree. All six review findings are
fixed in lane A's files. No review finding is deferred. No merge, dependency,
credential read, live/paid call, guard weakening or support promotion is part
of this repair. The lane brief reserves aggregate quality/full-suite checks
for the lead; final checks run sequentially and use repository deadlines.

| Finding                             | Repair and regression                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-1 P1, missing VSIX protocol      | `.vscodeignore` includes `dist/hostProtocol.js`; `vsixPackaging.test.mjs` checks actual VSCE collection/staging. `deferredBundles.test.ts` now builds all production runtime entries with the actual shared-protocol plugin and adjacent protocol bundle, and loads extension exports through it. The declaration file exposes the existing plugin without a cast.                 |
| R3-2 P2, cancelled disposal         | `runPanel.ts` binds `surfaces/close` to carrier lifetime while ordinary requests retain conversation lifetime and explicit caller cancellation. `runtimePanelState.test.ts` uses real `PortableTasks` on both backends: profile replacement cancels ordinary calls, sends native auxiliary close and creates the replacement profile without waiting for a lifecycle notification. |
| R3-3 P2, retained request IDs       | `presentationViews.ts` removes each settled ID in `finally`. Separate reload and 129-sequential-action tests pass in `test/m104/runtime/presentation.test.ts`; concurrent duplicate admission remains refused.                                                                                                                                                                     |
| R3-4 P2, whole-page stale check     | Actions compare their indexed plan/manager entry or action/role/diff hunk/walkthrough step, including manager identity and hunk version/text. Accepted actions read, validate and publish replacement state before their result. Tests cover two manager mutations, an unrelated added plan, new role traffic and changed diff heading, while refusing changed target records.     |
| R3-5 P2, startup-only selected text | `runtimeFeatures.ts` refreshes admission whenever the actual mention index rebuilds. Selection stays confined to the original canonical workspace root and rechecks the live physical target synchronously. `runtimePanelPorts.test.ts` proves a newly indexed file shares its excerpt and an outside link, excluded file or untrusted workspace does not.                         |
| R3-6 P2, obsolete README marker     | `mhpPanelContract.test.ts` uses the README's current section marker and requires the statement that 1.3 replaces both 1.1 and 1.2; schema and version-lock assertions remain.                                                                                                                                                                                                      |

The existing staged badge-contract test exceeded five seconds when its three
independent child-process scenarios shared one test. They now run as three
separate cases with every assertion and the unchanged default deadline.

### Required package and inventory handoff

The shared protocol is also an **existing VS Code dependency**, required at
module load by `dist/extension.js`. It now ships in the built VSIX and its
actual package-member regression is owned by A. F's exact distribution
inventory must retain this dependency as well as the ACP/native dependencies
listed above. Add `extension/dist/hostProtocol.js` to the required VSIX members
in `.github/workflows/build.yml`, and `package/dist/hostProtocol.js` to its
ACP members, alongside the new runtime artifacts and complete portable graph.
This CI inventory handoff does not defer the repaired VSIX allowlist or its
owning test. A does not edit the F-owned packaging scripts or workflow.

Initial end-to-end `npm run build` and package pass. Packaging uses
`BADGE_CHECK_SKIP_NETWORK='FIXM104PA3 offline rig brief' npm run package`,
the existing named local option required by this lane's no-network rule.
No hook or CI setting is changed. The actual VSIX lists
`extension/dist/hostProtocol.js` (24,770 bytes). Final restored receipts follow
after the scoped checks.

### Deliberate red controls

Every row ran its complete owning test file with `--maxWorkers=3`, no name
filter, skip or `--testTimeout`. Each mutation produced exit 1 in the named
regression and was restored byte-exact in `finally`, verified with SHA-256.
Local logs and structured receipts live under ignored `temp/fix-m104-pa3/`.

| Mutation                                         | Named failing regression                                                                                                                 | Restored source SHA-256                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Remove VSIX `hostProtocol.js` allowlist          | ships the helper, shared runtime and deferred chunks                                                                                     | `c67caccb6f1310bcc94c5f20466e7ce8f58dd80c820818664f57c656b3385bbc` |
| Bind cleanup back to conversation cancellation   | profile replacement closes acquired Tasks after ordinary requests are cancelled (both backends)                                          | `5ca6cb43a46f654916caef6daddc13d90335f92cae28fd3ebcc904af9a2a6754` |
| Stop retiring request IDs                        | retires completed IDs for reload actions; retires completed IDs for sequential actions                                                   | `8348c891a7c795100def9aac06fc2a9893945b2d5eac3d86c071d371dde1b182` |
| Restore whole-page equality                      | allows unrelated plan additions but refuses a changed target record; roles/diff actions ignore unrelated changes and reject target drift | `8348c891a7c795100def9aac06fc2a9893945b2d5eac3d86c071d371dde1b182` |
| Omit post-action state publication               | publishes accepted manager mutations and admits another unchanged entry                                                                  | `8348c891a7c795100def9aac06fc2a9893945b2d5eac3d86c071d371dde1b182` |
| Keep only initial mention admission              | admits newly indexed selected text live and refuses a replaced link or excluded path                                                     | `6e5d49e62c121b2b0c0a06ea80bf7a2e620a3fd33945933811d3a9b03ea9be2a` |
| Change README marker back to the obsolete phrase | documents replacement of 1.1 and current 1.3 schemas behind legacy filenames                                                             | `ae154bf7b87bbbf0d799f9b918c0f716b57c4149f8e47b60b9f4b5d687809d8b` |

Eight controls fired. Original failure receipts also reproduce the missing
package member, both lifecycle failures, exhausted/reused action IDs, stale
manager state and the obsolete README contract test before their repairs.

The eighth control binds **ordinary requests** to carrier lifetime instead of
conversation lifetime. Both profile-replacement tests fail because their
cleanup explicitly requires an `AbortError` for the ordinary call. Restoring
the separate signals restores source SHA-256
`5ca6cb43a46f654916caef6daddc13d90335f92cae28fd3ebcc904af9a2a6754`.

### Final scoped gate receipts

| Check                                         | Result                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restored Vitest, six owning files             | 101 unique tests pass: 72 in packaging/deferred/MHP; 29 in lifecycle/presentation/ports. After final fixture consolidation and confinement simplification, presentation and ports pass again individually; lifecycle is verified again with the stronger `AbortError` assertion. Every run uses at most three files/workers and repository deadlines. |
| `npm run typecheck`                           | All configured projects pass; final host and unit source checks also pass.                                                                                                                                                                                                                                                                            |
| Changed-file ESLint, zero warnings / Prettier | Pass. The two test-setup clones found by jscpd were removed through the existing fixture; final `npx jscpd` reports zero clones.                                                                                                                                                                                                                      |
| `npm run deadcode` / `npm run cycles`         | Pass; plain knip and dpdm, no new ignores.                                                                                                                                                                                                                                                                                                            |
| `npm run check:l10n` / `npm run check:mhp`    | Pass; fourteen tables, zero localization problems; frozen MHP schemas and locks unchanged.                                                                                                                                                                                                                                                            |
| `npm run check:host-api`                      | Same inherited F-owned inventory drift: crypto 53→55, fs 36→38, fs/promises 52→54, os 9→10, path 90→95, url 7→13. No additional API or theme-variable change; generated inventory remains with F.                                                                                                                                                     |
| `npm run build`                               | Pass: sizes, splits, readers, host globals and third-party notices.                                                                                                                                                                                                                                                                                   |
| Named-offline `npm run package`               | Pass end to end; VSIX 2,197,008 / 2,252,800 bytes. The local named badge option avoids network only; packaging validation and all caps stay intact.                                                                                                                                                                                                   |

Final Node measurements (KiB / unchanged cap): extension **450.4 / 600**,
Model API **447.5 / 475**, ACP **830.1 / 850**, runtimePanel **96.2 / 100**,
runtimePanelPorts **57.0 / 75**, runtimeContext **22.1 / 50**, runtimeEngines
**133.4 / 150**, runtimeBackendServices **138.3 / 200**, runtimePresentation
**44.6 / 50**, hostProtocol **24.2 / 50**, checkpointStore **77.3 / 225**.
The existing deferred browser group remains **49.7 / 50**; all five portable
page closures remain below their independent **5 KiB** caps.

No RVM104PA3 P1/P2/P3 residual remains. The inherited F inventory, exact ACP
package closure, aggregate quality and installed-editor/provider qualifications
remain the explicit handoffs above. No support claim changes.

The produced `muse-spark-code-0.14.1.vsix` has SHA-256
`fc8b43359b7873a593d2e33a1d5379478c7c46c12006204b5aff1c1e7e19189a`.
Inspection of the ZIP verifies that protocol, validation, wire and English
fallback members exactly match the final emitted bundles. Its extracted
extension entry loads successfully with only VS Code's supplied module stubbed,
exports `activate`/`deactivate`, requires the adjacent `hostProtocol.js` and
retains deferred conversation loading. This is a real package module-load
receipt; installed-editor qualification remains with F.

## FIXM104PA4 — RVM104PA4 repairs (2026-10-07)

Base: `554de87b6`, macmini, this same worktree (branch `m104/pa`). Both
review findings are P2; no P1 or P3 was reported. Both are fixed in lane
A's files. No merge, dependency, guard widening, support promotion,
credential read or live/paid call is part of this repair. Residual R3-2
is closed by the P2-2 repair below. Scoped checks run directly here with
repository deadlines (`--maxWorkers=3`, never `--testTimeout`).

| Finding                                                                                         | Repair and regression                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R4-1 P2, state publication remounts the pending action's page                                   | `presentationUi.tsx` no longer takes a fresh `PresentationBoundary` key on every `show`: a published state reconciles into the mounted page, and only a crashed boundary takes a fresh key (crash fallback and reload behaviour unchanged). `planDiff.test.tsx` keeps a pending plan read mounted across a republication (preview text plus Open/Implement controls survive) and retains an accepted diff decision across a same-version republication.                                                                                                                                                                     |
| R4-2 P2, close requests past conversation cancellation have no serialized owner (residual R3-2) | `runPanel.ts` retires replaced companion pages through one exported `retireCompanionPages` step while the session is still held: each page's server context is retired and its surface is handed to the feature owners (`surfaceClosed`, e.g. `PortableTasks.closed`), so release-time cleanup finds nothing orphaned to close and `replaceProfile` proceeds to the replacement instead of stalling on `MHP_TASKS_CLOSE_FAILED` / `MHP_COMPOSITION_RELEASE_FAILED`. No guard is widened. `runtimePanelState.test.ts` covers the handoff (contexts retired, unrelated session kept, owner released) and the ownerless prune. |

### Deliberate red controls

Each mutation broke only the named guard, failed the named regression, and
was restored (P2-1 byte-exact at drill time; a lint-driven boolean rename
followed under the same green tests. P2-2 byte-exact at drill time; a
type-narrowing-only call-site edit followed under the same green tests).
Final source SHA-256: `presentationUi.tsx`
`9737e434aa6d796e900114e159e1c5a64a16621e96b86dd8f17cfd4a59001c51`,
`runPanel.ts`
`b97ab8300f5a61583b5226556e8fd2b5ab22b7b7530c81befaae6a408bdf1ad4`.

| Mutation                                        | Named failing regression                                                                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remount the boundary on every publication again | `keeps a pending plan read mounted across a state publication`; `retains an accepted decision across a same-version state publication` (2 failed, 7 passed) |
| Omit the retire owner handoff                   | `retires replaced pages and hands each surface to its feature owner` (1 failed, 12 passed)                                                                  |

### Scoped gate receipts

- Restored Vitest: `planDiff.test.tsx` 9 pass; `runtimePanelState.test.ts`
  13 pass; `presentation.test.ts` + `browserBridge.test.ts` with planDiff 21
  pass across 3 files. Every run uses `--maxWorkers=3` and repository
  deadlines; no name filter, skip or `--testTimeout`.
- `npm run typecheck`: all configured projects pass.
- Changed-file ESLint zero warnings, Prettier check, `node
scripts/check-l10n.mjs`: fourteen tables, zero problems.
- No build, packaging, or aggregate quality run in this lane; those stay
  with the lead's four-machine gate.

### Named follow-up (not a residual finding)

Full companion-transport end-to-end for R4-2 (runPanel on companion with an
acquired Tasks view, profile switch, replacement configured) was drafted
(browser-wire plan verified step by step against the server and controller
sources) but cannot execute on this rig: its sandbox
denies loopback binds (`listen EPERM 127.0.0.1`), so `startCompanionServer`
fails here — the existing `companionMhp.test.ts` socket tests fail on this
rig for the same pre-existing environmental reason. The committed
link-level regression above runs here and fails without the guard. The E2E
remains a follow-up for a socket-capable rig; it needs the real bundle
factory stack (engines/context/presentation/checkpointStore bundles),
a checkpoint namespace for the fake backend, and the drafted HTTP
browser emulation. No RVM104PA4 P1/P2/P3 residual remains.
