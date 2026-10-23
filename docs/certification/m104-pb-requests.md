# M104PB — integration requests to A/C

These requests preserve exclusive ownership. No shared schema, translation,
composition, build or central test config is edited by B.

## A — test discovery

Add `test/m104/engines/**/*.test.{ts,tsx,mjs}` to the repository Vitest include
and knip test entries. Keep the existing setup, coverage gates and default
five-second test timeout. B's owned `test/m104/engines/tsconfig.json` extends
the unit project and is used by ESLint's project service. Add its compiler
invocation to the aggregate typecheck. Until integrated, B runs a scratch
Vitest config extending the repository config with only test discovery added.
Validation: a deliberately broken engine guard must fail its owned test;
restored tests must pass through both the scratch and final central configs.

## A/C — checkpoint 1 seams (implementation follows)

The frozen `RuntimeEnginePorts` includes checkpoints but not editor context;
`RuntimePresentationPorts` owns edit review. B will export a guarded portable
edit-review factory for C, with original text passed directly to C's shared
diff presentation rather than requiring a VS Code virtual-document provider.
A must supply the backend's real checkpoint port/recorder to both the engine
factory and the Model API manager. Controller port availability alone cannot
record the tools' actual writes. Detailed signatures and validation are added
with the tested implementation.

### C — F8 edit-review export

Import `createRuntimeEditReview` from `src/runtime/features/editReview.ts`.
Its `RuntimeEditReviewDeps` requires the confined workspace/platform, bounded
read and canonical-path functions, real guarded tool I/O and trash service,
checkpoint port, logger and live `assertCurrent`. It accepts optional
`beginEdit` for verification invalidation. `openDiff(before, target, title)`
receives original text, the confined file path and localized title; route it
to the shared diff surface. Register the returned awaited `dispose` with
`context.own`, and publish `review` as `features.editReview`.
All strings use existing translated keys; no schema/model-wire/l10n addition
is required. Validate hunk/full-file revert, dirty refusal, trust revocation
during read, path escape and suspended presentation/release on both backends.

### A — F15 selected editor text

Import `runtimeEditorContext` from `src/runtime/features/editorContext.ts`.
Replace the current header-only conversion with
`runtimeEditorContext(ports.selection(), workspaceRoot, platform, canShare)`.
The synchronous `canShare(relative)` reads live trust and the workspace index's
admitted/canonical file set. Excluded or noncanonical files keep only their
path. Add `editorContext` to the engine contribution if B is to own that
binding; alternatively call the function in A's existing conversion.
MHP's frozen selection schema already carries `excerpt`/`truncated`; no wire
or translation change is needed. Validate actual excerpt, path-only context,
Windows separators and outside/non-file/reversed-range refusal.

### A — F10/F11 actual recording and frozen engine factory

`RuntimeBackendDeps` in the B-owned `src/runtime/backends.ts` now accepts
`checkpoints(root): Promise<RuntimeCheckpoints>` and
`unsavedPaths(root): readonly string[]`. In the interactive panel's runtime
construction only, supply `createRuntimeCheckpoints(deps, table, locale)` from
`src/runtime/features/checkpoints.ts`. `RuntimeCheckpointDeps` requires the
actual data root/dist directory, workspace root/platform, scrubbed environment,
logger and live trust/turnCheckpoints/cleanupPeriodDays callbacks. Set
`onAvailabilityChanged` to notify every owning controller. Each callback must
refer to that workspace's settings/trust; resolve aliases to the same owning
profile policy. ACP/headless defaults stay unchanged and exec rejects this
injection by ignoring it. Do not install a recorder only on the controller:
the runtime now uses it in the backend's real before/after-turn hooks.

Bind `factories.engines` to the exported `createRuntimeEngines` from
`src/runtime/features/engines.ts`; its signature matches A's frozen factory.
It publishes `features.checkpoints` from `runtime.checkpointsFor(root)`.
Backend lifetime owns the shared workspace store; a conversation must not
close it while a sibling still uses it. Await `runtime.close()` during profile
replacement/shutdown. C's edit-review adapter must consume this same port.

Lazy build integration: declare an engines entry reading the caller's language
table/locale and call `createRuntimeEngines`; include it in the exact ACP/panel
package inventory and notices. Keep the existing checkpointStore lazy chunk,
all current caps and startup budgets unchanged. Add the engines entry and owned
tests to knip. Validation: real fake-API tool write/restore/Redo, current dirty
paths and native-startup denial, concurrent acquisition/close and journal
cleanup, all at the default test timeout. No new UI strings or service/model
wire fields are needed for this checkpoint.

### F — documentation/reference synchronization

Add an Unreleased note for portable guarded edit review, selected-text admission
and runtime checkpoint recording/rewind adapters. Describe the A/C binding and
native qualification prerequisites explicitly. No command/setting is added.
The help catalog/reference source named by common.md is absent at this base;
regenerate it when its owning integration supplies it. Component receipts do
not support W or a newly supported editor claim.

### A/D/E/F — F9 fresh editor verification

Import `createRuntimeVerify` from `src/runtime/features/verify.ts` and supply
`RuntimeBackendDeps.verify(root)` in interactive composition. The backend owns
one returned service per workspace, feeds its VerifyHooks into the actual
Model API manager, aborts it before stopping managers and awaits its drain.
The injected `RuntimeVerifyDeps` requires live settings/generation/trust,
realPath, HostServices and `settledDiagnostics(uri, version, signal)`.
That last callback returns the authored internal shape
`{ uri, version, diagnostics }`, or undefined when no fresh report exists.
The native owner must attest the exact document version after diagnostics
settle and obey cancellation. Existing `diagnostics/get` supplies an array
without freshness/version: it cannot justify returning this attestation.
If A chooses a wire addition, specify version and freshness from the native
editor's own document protocol, validate both ends and regenerate the lock;
this is an editor service, not a guessed provider response.

Formatting uses frozen `codeIntel/format`, expectedVersion and bounded
cancellation, then rechecks URI/version/text/dirty state before returning text
for the tool's guarded writer. Diagnostics check the recorded fingerprint,
recheck the document after settling and keep absent/stale reports unchecked.
A changed executable configuration skips editor services for the entire
batch. Supply `unsavedPaths(root)` with all canonical/display aliases from the
live dirty-buffer service. Validate CRLF, Windows URI/separators, stale report
and formatter races, code-loading exclusion, trust revocation and shutdown.
No l10n changes are needed. All native editors need these version/freshness
and cancellation guarantees; absent services remain explicit unchecked data.

### A/C/D/E/F — F25/F28/F29 portable services

Interactive RuntimeBackendDeps now has `hooks(root)`, `hookSettings` with
`path(root)`/`isEnabled(root)`, `mcp(root, newPool)` and `schedules(root)`.
`hooksFor(root)` is backend-owned and the engines factory publishes its manual
and message-rewrite ports. Bind `createRuntimeHooks(deps, table, locale)` from
`src/runtime/features/hooks.ts`; its deps extend ExtensionHookRunnerDeps with
live `assertCurrent`. The process callback must be the existing real tool
I/O's runHook wrapped by the shared checkpoint guard, with a scrubbed env;
never a terminal command that loses its cancellation/credential fence. Wire
native file/config/settings/folder events to the named note methods only after
the existing shared/native schemas validate them. Bind C's hooks manager to
listManual/runSetup/output and the current settings snapshot; cancel watchers
before backend.close. No new hook wire is guessed and no new text is needed.

For MCP, `mcp(root, newPool)` should return
`createRuntimeMcp(deps, newPool)` from `src/runtime/features/mcp.ts`.
The actual bundle passes its own existing pool factory. RuntimeMcpDeps requires
readSettings, env, fetch, log, workspace/platform/version, live trust/current
owner and `canUseTools()` from the selected model's catalog capability record.
Supply the real Windows job executable on Windows. Before local startup await
that workspace's shared checkpoint `markNativeBackend` as the existing VS Code
adapter does; admission failure must start nothing. Env lookup is scrubbed;
no stored key reaches a server. `mcpSnapshotFor(root)` projects the manager's
actual pool state without starting a host. C/D/E/F must bind server views,
forms, cancel/teardown and negotiated services; Muse Code's own server manager
is retained and still needs its native/provider scenarios. Test a selected
model losing/gaining tool support, trust loss during admission, late process
acquisition/release and refusal in exec. Canonical tool capability names must
come from A's catalog contract, not a provider-name inference.

`schedules(root)` returns the existing `createFileScheduleStore` (B-owned
`src/host/backend/fileScheduleStore.ts`) in the owning canonical profile's
MODEL_API_SCHEDULES_DIR. Keep immutable account/session/workspace ownership
and atomic occurrence claims. Bind paid dispatch only with the real priced
consent and shared ledger; ACP/headless get no new schedule injection. The
paid-off test creates/lists/cancels durably and dispatches no request.

Supply `RuntimeBackendDeps.isWorkspaceTrusted(root)` from live native trust
for both backends, plus the same reader to checkpoints, verifier, hooks and
MCP. The launch flag remains the upper bound; this callback can only revoke.
The actual writer checks it just before publication, including Bypass.

Lazy integration: build the portable feature adapters in a named deferred
engine entry, keep MCP protocol/model text in modelApi.js via its pool factory,
and preserve all caps and exact notices/inventory. New standalone exports
require knip entry integration. Provider catalog/transports are absent from
this base; deliver typed selected records, verified tariffs and provider
factories before any model-dependent row is qualified.

### A/C/D/E/F — F32/F39/F40 interactive paid policy and daily accounting

Bind `RuntimePaidUse` from `src/runtime/features/paidUse.ts` to a real
PaidFeatureGate, PaidUsage, paidGrantFile, live settings/defaults, stored-key and
selected-model availability, immutable current profile and trusted workspace.
Supply it as `RuntimeBackendDeps.interactivePaid`; root shutdown aborts/drains
its unresolved decisions and gate/grant mutations. Await that release before
rebinding its stores, and route gate/grant writes through the contributed owner.
For Tab, supply the declared window's stable surface ID on ordinary admissions
and dispose the policy when that window closes; its once grant is memory only.
ACP/exec ignore this injection. Contract v2 now binds ordinary controller calls through B's contributed
policy with `requiresAsking: false`; the old composition-port request is
resolved. Keep true for actual hook or protected/requiresAsking backend uses. The underlying native confirm request must also
be cancelled by A's request owner on profile/panel release.

Attach the real D48 asker once. Generalize the owned shared paid-use price
contract/question to the selected model's verified catalog tariff and required
capabilities; an unknown price/capability refuses before consent or dispatch.
Preserve current Muse prices. Append the existing localized daily-budget line
with today's hard limit and billed key/provider. Reuse existing rate/Intl keys;
if a new key is needed, A owns all fourteen translations. C must render paid
rows, composer badges, usage and workspace-grant revocation from real state.
No ordinary approval card or Bypass mode grants paid consent.

Bind `createRuntimePaidBudget` from `paidBudget.ts` with one canonical
machine-wide LOCAL directory shared by standalone editors and VS Code,
`PAID_DAILY_BUDGET.accountId`, the same unpadded local-day key as the existing
D78 adapter, live cap, now/sleep/current-owner and native `isLocalStorage()`
attestation. D's current VS Code profile directory must adopt this namespace
too; do not certify sharing while paths differ. Refuse network/synced storage.
Keep Stop's monotonic marker, explicit raise controls and liabilities visible.
Dispose this shared ledger only AFTER every backend/paid client has stopped and
settled; late shutdown settlement must not be lost by early ledger release.

Supply `RuntimeBackendDeps.reservePaidRequest` from
`runtimePaidRequestAdmission` (`paidRequest.ts`). Its `price(...args)` returns
undefined for unsupported/unpriced/replaced dispatch, otherwise a verified
worst-case `costUsd` and `isCurrent()` bound to the actual request's provider,
model, capability and settings. It reserves before dispatch and rechecks after
key retrieval at the actual transport guard. Keep uncertain attempt liability.
Supply `paidUsage: new PaidUsage(log, costOf)` with a verified live catalog reader
returning undefined for unpriced model IDs. The core reader validates units and
nonnegative finite cost; no non-Meta model falls back to a Meta tier. Account
views must use this exact tally. Subscription and stored-key boundaries remain.

The fixture exercises an actual Model API image tool in Bypass after priced
consent, guarded PNG publication, paid event and settlement, plus final model
replacement before dispatch. Synthetic verified tariff tests for OpenAI,
Anthropic, Gemini, xAI, OpenRouter, Ollama and custom are INTERNAL catalog tests;
they do not supply provider wire captures or installed-provider qualification.
Add these adapters to A's own named lazy entry/knip discovery without increasing
startup/deferred caps or broadening MODEL_TEXT readers. No build/config or
shared-schema file was changed by B.

### A/C/D/E/F — portable review support and F30 native language services

Bind `RuntimeBackendDeps.codeIntel(root)` to `createRuntimeCodeIntel` from
`src/runtime/features/codeIntel.ts`. Supply the validated HostServices pipe,
canonical workspace/platform, realPath, immutable current owner, negotiated
native language capability, selected-model tool capability and native editor/
SDK library roots. The backend shares the owner per workspace, exposes
`codeIntelFor(root)`, injects its real service into the Model API engine and
aborts/drains it at shutdown. Exec ignores it. Muse Code's ide endpoint must
reuse `service` with the existing `ideCodeIntelTools`/codeIntel.js bundle and
checkpoint/process admission. No editor-only side path replaces the tool.

All frozen definition/reference/hover/symbol/hierarchy/rename/read methods are
validated and consumed. The symbol schema is flat and omits detail/children:
capture the actual native nested data before A expands it; never invent a
provider shape. Rename replies require correct expectedVersion for EVERY file,
fileOperations (none/present/unknown) and current saved-buffer data; core rename
still checks confinement, ranges, text and dirty aliases before guarded writes.
Publish the live dirty buffer paths via the existing unsavedPaths binding.
Exercise Windows separators/URI casing, symlink retarget, version/dirty races,
virtual/outside results, null hierarchy, missing service and release cancellation.

Bind `createRuntimeReview(deps, table, locale)` from
`src/runtime/features/review.ts` as the existing conversation `review` port;
register its awaited dispose immediately with the owning conversation/profile.
It reuses real shared Git collection and Plan-mode hold, not UI events alone.
Its runGit accepts args/cwd/timeout plus AbortSignal: use the trusted sanitized
Git process, exact before-launch owner fence and native cancellation. Supply the
real single-picker, live trust/current owner and selected catalog support for
the backend's review path. Captured support is not a provider-name inference.
Keep REVIEW_MODEL_TEXT in its existing declared review.js reader: A should ship
the factory in that lazy entry or explicitly guard a new named reader without
raising any cap. C renders the resulting material/findings using shared views.
The optional PlanModeHoldDeps.isCurrent is now checked before each mode change;
the controller's original callback still protects turn admission and user mode
choices. Dispose before a replaced conversation can send/restore any old hold.

### A/C/D/E/F — F34 transfer and F35 worktrees

Bind `createRuntimeTransferFiles(deps, table, locale)` from
`src/runtime/features/transfer.ts` to the conversation's existing
`SessionTransferFiles`. Its native `pickFile(title, signal)` returns a validated
local file URI or undefined; `confirm(title, detail, signal)` preserves Deny.
Supply immutable profile ownership and native prompt cancellation. Register its
awaited dispose with that conversation. It reads the actual selected file
through the existing bounded, canonical, single-handle reader and fatal UTF-8
before the controller's strict import parser. Export/share still use the real
existing controller serializers with live handles removed; bind their native
save/clipboard services separately. The frozen MHP file-dialog service is
absent: A must specify a native chooser/save contract, validate both ends and
regenerate the lock before connecting D/E/F. No guessed provider wire is needed.

Bind `createRuntimeWorktrees(deps, table, locale)` from
`src/runtime/features/worktrees.ts` to the existing `newWorktree` and
`removeWorktree` host actions. It reuses actual Git/worktree commands with a
captured physical workspace and live trust/current owner. Its required runGit
accepts args/cwd/timeout/**beforeRun**/AbortSignal; the sanitized process must
invoke beforeRun immediately before spawning. Supply native input/picker/
confirmation/open-folder ports, real recordWorktree persistence and cancellation,
and shared checkpoint process admission. Await dispose before rebinding the
profile. Test alias retarget, Deny removal, admission failure/no process,
revoked trust and release during input/Git. Native dialog services and same-root
ownership must be delivered by A/D/E/F. F36 Git/push/PR remains separate work.

Both factories share the tested `runtimeFeatureLifetime`: cancellation starts
immediately, late results refuse, native cancel errors still drain accepted
work, and one release promise owns cleanup. Ship them only in A's own named
lazy entry with unchanged caps/discovery and caller language installation.

### A/C/D/E/F — F31 fetch and F33 browser

Interactive `RuntimeBackendDeps.webFetch(root, fetchPage)` must return
`createRuntimeWebFetch` from `src/runtime/features/webFetch.ts`, using the supplied
existing pinned public-address transport and isolated page converter. Inject
live trust/network/catalog tool support and immutable owner; redirects consume
the same live predicate. `webFetchFor(root)` exposes this exact backend-owned
service. No replacement HTTP stack or system proxy/browser is introduced.

Bind `RuntimeBackendDeps.browser(root)` to `createRuntimeBrowser` from
`src/runtime/features/browser.ts`. Supply existing verified browserCheck.js and
browserRuntime.js paths, canonical local storage, logger, runtimeMode,
askConsent/onAdmissionChange native services, live trust/network/held-worktree
ceiling/tool capability, vision capability, extra hosts and checkpoint process
admission. `browserFor(root).host` is the actual injected Model API tool service.
Muse Code's ide tools must consume those same hosts. Text checks remain offered
without vision; screenshots are neither requested nor returned after vision
withdraws. The same pinned consented runtime remains mandatory. Binding the
standalone Download command (`BrowserChecks.prepareOnly`) is still open; do not
claim that this adapter implements its native menu/installer UI. Root release
aborts and drains both services; ACP/exec ignore both interactive injections.

Validate native consent cancellation, download/install integrity, network/scope
changes during checks, selected capability withdrawal, no-process admission,
Windows path handling and profile release. Fake bundle/port scenarios and a
real runtime tool turn are component evidence, not installed browser/editor or
non-Meta transport qualification. Add only a named lazy reader/inventory; do
not enlarge startup or deferred budgets.

### A/D/F — original dispatch tariff for response settlement

The priced admission function now also exports `admission.responseCost`.
Supply **both** `reservePaidRequest: admission` and
`paidResponseCost: admission.responseCost` to interactive RuntimeBackendDeps.
`price(...args)` may return `receiptCost(usage)` bound to that dispatch's
verified immutable tariff, including all metered fees. It is never recomputed
from the newly selected model/profile. A missing/invalid receipt cost retains
the reserved claim as uncertain; the portable path never substitutes Meta
rates. A verifiable worst-case bound must include hosted tool fees; refuse
unbounded/unknown tariffs before dispatch. The root supplies an unpriced reader
when admission exists without settlement pricing. D's adapter must adopt the
same reader when supporting non-Meta providers; its legacy Meta-only caller is
unchanged. PaidUsage's repeated token validation was removed only after its
shared usageCost/reviewerCost validation already checks the same units.

Deliver captured provider responses/transports and catalog tariffs first.
These changes use the existing captured Meta stream fixture and internal cost
ports; they add no provider parser or guessed response shape. Validate the
original tariff after selection replacement and retained liability when a
receipt is unknown, plus all actual provider/backends before qualifying rows.

### F — checkpoint 5/6 documentation and remaining scope

Add an Unreleased note for bounded portable session transfer, guarded physical
worktrees, fetch/browser tool owners and historical paid response pricing.
Keep all native/composition/provider qualification prerequisites visible in
PLAN §3/§7, help/catalog and the support matrix. No new command/setting or UI
translation key was added by B. At that checkpoint the original XL lane still needed the remaining groups.
Continuation checkpoints 8–14 below supersede that implementation list: all
exposed rows still require their native/composition/provider qualification;
F53/F55/F56 lack engine/contract prerequisites and remain missing.
No registry status is changed by B.

### A/F — checkpoint 6 gate blockers (2026-10-06, Kubuntu)

`npm run deadcode` currently exits 1: A's unchanged central test discovery
reports 19 new engine test/helper files, eleven portable feature implementation
files and createRuntimeCheckpoints as unused. Add the requested engine test
entry and actual named lazy factory entry; do not add ignores or remove exports
that the frozen factory/native bindings require. B keeps plain knip and its
rule levels unchanged. The exact raw receipt is in the lane's final gate record.

`npm run check:host-api` currently exits 1 solely because F-owned
`docs/ide-compatibility/host-api.md` needs regeneration. Run the existing
`npm run check:host-api -- --write`, review the generated diff and rerun the
gate. Expected Node built-in import counts: node:crypto 53 → 54, node:fs
36 → 37, node:path 90 → 92, node:url 7 → 11. VS Code API count stays 349,
files importing vscode 32 and theme variables 61. B changed no native VS Code
adapter or central gate. F must record the justified integration deferrals in
PLAN §7; neither failing aggregate gate is claimed green. The lead runs full
quality after assembling A/C/D/E/F; this rig brief forbids B's aggregate run.

A's Knip discovery request was checked with a scratch copy of the exact central
config, adding only `test/m104/engines/**/*.test.{ts,tsx,mjs}` to entry. Plain
Knip with that config exits 0 (no rule/exclude/ignore changes). This proves the
discovery fix; it does not make the unchanged aggregate deadcode command green
or prove the portable factories are shipped. Actual lazy composition/inventory
still needs A's integration and native qualification.

### A/C/F — F38 portable trace insight data

Bind `createRuntimeUsageInsights(deps)` from
`src/runtime/features/usageInsights.ts` as C's `usageInsights` data port. Pass
the actual CLI home directory, now(), immutable current profile owner and live
`canReadTraceLogs()` for that CLI source. Register awaited dispose immediately.
It reuses the existing bounded/cached captured CLI parser and actual day/week
summaries, checks before/after reads and drains pending work on release.
Model API/other-provider spending must come from actual backend observations
and the already verified PaidUsage tariff reader, not these CLI trace lines.
Account facts, credential/provider status, native presentation and full F38
qualification are still open. No new wire field, UI string, key read or price
fallback is introduced. Add this factory to the appropriate named lazy reader
and exact inventory while preserving all caps; F owns PLAN/Unreleased/help.

The final actual runtime subagent scenario verifies that both root and packaged
ModelApiBackendManager must carry admission.responseCost. Allow once settles the
original tariff and Deny dispatches no child/no paid claim. F17 has component
receipts now, while its map/control presentation and editor/provider captures
remain open. No team delegation or real paid/model call occurs in the fixture.

Historical Account & usage pricing must bind the owning provider/profile's
immutable verified tariffs too, using provider-qualified model identity where
IDs collide. The PaidUsage costOf reader must never read a new selection's
rates for an older response. The actual runtime subagent fixture injects the
same verified $0.25 cost into its ledger receipt and PaidUsage tally and asserts
both. Native/account/provider qualification still remains open.

### A/C/D/E/F — continuation 2 contract v2 and F6

The contract-v2 paid/manager port request is resolved. `createRuntimeEngines`
publishes `paid` from backend `paidFor(root, surfaceId)` and `modelApi` from
`modelApiFor(root)` when the interactive RuntimePaidUse is injected. The latter
constructs the actual manager without starting a host; its ordinary and
Best-of-N clients retain original admission/settlement callbacks. ACP/exec
receive neither port. Controller Always consent uses false for ordinary use.
`RuntimePaidUse.composition` binds actual gate changes, workspace revocation
and all usage tallies. Its grants now require `RuntimePaidGrantStore`, whose
`paidGrantFile.forgetWorkspace(root)` uses an independent revocation generation
to prevent stale writes restoring a grant and preserve other workspaces.
Machine setting OFF still revokes that feature globally. Native setting price
questions must be owner-cancellable and settings/profile events must remain
coherent. Availability requires the real stored-key fact and captured catalog.

Bind `createRuntimeAutoReviewer` from `src/runtime/features/autoReviewer.ts`
as `features.museCodeReviewer`. It takes the existing checked reviewer bundle
path and empty physical profile folder, live setting/trust/captured catalog
`canReview(modelId?)`, immutable `assertCurrent`, and logger. Register its
awaited dispose immediately; it cancels and drains reviews and side-session
cleanup. Capability support must include the existing no-thinking setting;
unknown support refuses before loading/dispatch. The captured reviewer parser,
first-line ALLOW/ASK and exact allow-once approval logic are unchanged. Model
API uses its existing paid reviewer through RuntimePaidUse, tariff admission
and settlement, never the Muse subscription. Add only an owned lazy factory
reader/knip discovery, with existing caps. No shared wire or translation key
was added. Installed native/backend/provider qualification remains open.

For F6, supply `RuntimeBackendDeps.autoReviewer(root)` in interactive panel
construction. The backend shares the owner, the actual engines contribution
publishes `features.museCodeReviewer`, and backend close drains it. Do not
construct it for ACP/exec. F owns the matching PLAN/Unreleased/help update.

### A/C/D/E/F — F18 captured workflow path and missing orchestration

The actual runtime→MuseCodeHost→shared-event workflow path now has owned
captured seven-revision tests, malformed-row refusal and open status evidence.
C should consume existing ItemSnapshot/workflowDetails/WorkflowRun, preserving
IDs, child usage/result refs and reconciled output. No new event shape is
needed for this read-only path. Native/editor qualification remains open.
The Model API backend has no workflow orchestration/tool contract in this base.
A must deliver its internal tool/schema/model-text contract and captured
selected-model tool capabilities; C supplies grouped run presentation. A
new orchestration implementation needs a separately sized checkpoint under
the shared 300-line rule. No provider wire is invented, and the native Muse
workflow setting still belongs to Muse Code; the extension never edits it.

### A/C/D/E/F — F20 retained session goal refusal

The actual packaged Model API runtime accepts, wakes, pauses, reads, resumes
and forks existing captured goals. A retained session now refuses controlGoal
after runtime release before changing its goal or dispatching work. Bind
existing controller goal actions; no extra wire/port is needed. C/native owners
retain unknown captured goal statuses and show the existing goal data. Selected
model support still needs a captured catalog entry. Muse Code owns its own goal
engine; its native/controller scenarios and all provider scenarios remain open.
F owns the PLAN/Unreleased/help record for the refusal and component receipts.

### A/C/D/E/F — F23/F24 existing engines and v2 attempt hosts

User shell now rejects retained session commands after owner release before
creating a task. Native owners must keep the existing final subprocess
admission/cancellation and sanitized environment. Captured userShell/background
rows continue through existing events, without any new schema.

V2 modelApi.buildAttemptHost now has an actual packaged-runtime shared-ledger
receipt: enabled requests settle their immutable verified $0.25 tariff; OFF
admission sends no request and spends zero. The new engine suite uses only
synthetic transport/key. Existing BestOfNManager/Runner 48 tests pass. A should
provide features.runBestOfNGit from its real native process admission (trust,
immutable repository owner, markNativeBackend checkpoint gate, final entry
guard, signal and awaited process-tree drain), rather than a raw Git callback.
The v2 manager/paid ports resolve their previous missing-port request; fan-out
and take UI/native flows remain to qualify. The runner's current Meta-specific
tariff lookup needs verified catalog injection before M95 providers are on.
Unknown tariffs/tool support refuse; do not substitute Meta rates. F owns
PLAN/Unreleased/help for these component receipts and remaining requirements.

### A/D/E/F — F36 pure Git engine and native repository services

`createRuntimeGit(deps, surface, table, locale)` in features/git.ts returns
`git: ConversationGitPort` and an awaited idempotent dispose. Publish its port
as features.createGit(surface); register the owner immediately. It reuses
ConversationGit and its existing commit/push/PR forms and consent/fingerprint
checks. The pure conversation path now bundles without a VS Code value import;
`ownedRepository.ts` performs injected physical-owner checks. The installed
VS Code bundle entry explicitly preserves its native error identities. D may
reuse the new helper with its native error constructor to remove its older
duplicate implementation; B did not edit D's adapter.

Native service requirements are the existing GitWindow repository contract
(status, diff, commit, non-force push, fetch, log, diffBetween), immutable
physical captureGitOwner (reuse captureWorkspaceIdentity), cancellable exact
commit/push confirmations, untracked fingerprint/read, held-worktree trust,
links and secure GitHub REST transport. Runtime deps.beforeWorkspaceProcessStart
must use the real checkpoint/process gate; deps.admit must check the same
immutable owner at final native entry, with sanitized environment. cancelPrompts
and drain must cancel/drain that owner's requests/process tree. MHP auth/github
currently returns only a boolean and cannot supply a usable REST transport.
Keep GitHub credentials in the native auth service; add a concrete protected
transport contract rather than send a token through ordinary panel messages.
No provider wire/parser was changed. Add the pure factory's owned lazy reader
and hard size/inventory check; GIT_MODEL_TEXT must stay in its declared reader.
Native credentials/Git/GitHub installed qualification remains open.

### A/D/E/F — F37 v2 auth contributions and trusted key-entry terminal

`createRuntimeAuth(deps, table, locale)` in features/auth.ts returns features
(auth, ensureHost, accountFacts), isKeyStored (boolean) and awaited dispose.
Use these v2 contribution fields, replacing A's temporary unsupported auth
actions. It reuses AuthService's captured CLI/browser/installer/sign-out state
machine. Native callbacks are injected, guarded and drained. The key path
retires old hosts before replacement, gates ensureHost/engine admission while
entry runs, and waits for a cancelled entry process before sign-out clears the
OS store. The helper never receives/returns a key to the panel: runKeySignIn
launches the trusted existing ACP `auth set` in the user's terminal and returns
only its completion boolean. Input stays private stdin, never a file, argument
or environment variable. It must check beforeRun at final launch and honour
the signal/cancelNative, with drainNative awaiting exit. Owner identity here
is the profile/auth service lifetime, so its own backend restart can complete.

Native wrappers must deliver AuthBackendFacts, device sign-in, installer
terminal, OS-store CredentialStore, durable logout hold, accountFacts and
boolean stored-key facts. No raw account label/avatar/key is logged or bridged.
An existing failed-sign-out hold remains held; terminal key entry cannot fake
its release. Other M95 provider credentials need their captured/validated
provider-specific OS-store/key command contract first: this Meta credential
service is not generic provider qualification. Bind an owned lazy factory
reader with existing budgets. F owns PLAN/Unreleased/help and native receipts.

### A/C/D/E/F — F41 voice driver ownership and F42 priced Tab

`createRuntimeVoice` wraps the existing native/paid DictationSetup with live
selected capability/admission and immutable owner checks, suppresses retired
listeners, and awaits the actual Muse Voice key preparation/claim settlement
plus native drain. Supply cancelNative/drainNative, verified canStart and the
existing captured PCM capture/socket adapter. MHP's buffered recording format
is not a captured PCM streaming converter. Paid voice still needs hard shared
daily admission with captured price, D48 consent and usage before enabling it;
this wrapper does not manufacture that missing service or qualify any editor.

`createRuntimeTab` reuses the pure Tab engine with parsed provider stream,
verified price snapshot, D48 allows callback, shared RuntimePaidBudget,
capability/owner checks and original receipt-cost tally. OFF, unknown support,
unpriced and Deny refuse before a popup/dispatch where applicable. The real
client's final guard checks after key awaits; only onRequestStarted counts a
paid request. Missing keys refund unsent claims; sent unknown receipts retain
liability. Disposal drains the early suggestion's accepted stream/settlement
before the shared journal may close. Pass the verified cost to
PaidUsage.addTabUsage; a replacement catalog reader must not price an old call.
Native owners supply eligible-document context, version/cursor validation,
change/accept events, cancellation and trigger hooks. Bind owned lazy readers
with split/size guards; Tab and voice MODEL_TEXT stay in declared bundles.
No editor/provider qualification, flag defaults or headless paid availability
is changed. F owns PLAN/Unreleased/help for these component receipts.

### A/C/D/E/F — F54 owned lazy same-model advisory

`createRuntimeJudge` returns `judge` and awaited idempotent `dispose`; publish
as the controller's Judge contribution and register its owner immediately.
Reuse the real dist/judge.js checked lazy factory. The installed Judge remains
advisory, with captured M98 stated-confidence parsing, isolation, redaction,
standing-allow refusal and exact-action latches. The new settled seam drains
both consent preparation and actual background batches, including late known
paid settlement, before native sources or the shared journal may close.
Its contribution's synchronous dispose initiates that same owner release.

Supply immutable profile/selected-context ownership, captured canJudge support
for the actual phase-1 request (stated confidence/cache/reasoning settings),
verified priceOf for the selected model, the existing shared judgeLedger,
cancellable native consent/source/session operations and awaited native drain.
Unknown capabilities or absent/unusable prices refuse before bundle load or a
popup. The Model API transport copies its admitted tariff, then passes the
settled verified cost to PaidUsage.addJudgeUsage. RuntimePaidUse.judge binds
the existing interactive D48 grants/gate/tally to this source; its workspace
and surface identity must match composition. M95's captured transport and
price-popup contract are still prerequisites for other providers; Meta
fallback is never used by this portable factory's tariff injection.

Muse Code startSession must itself guard final native/session entry after its
credential waits and honour cancellation; a session returned after retirement
is disposed without a turn. Model API transport must invoke the existing
ResponseAttemptGuard after key waits and onRequestStarted only at dispatch.
Native owners provide actual readMainBody/keyPrefix/prefixTokens from the
owned conversation, rather than reconstructing a prompt from panel content.
Add the owned engines lazy reader/discovery and unchanged size/split checks;
JUDGE_MODEL_TEXT stays in its declared reader. C keeps cautions advisory and
unknown/stale outcomes empty. No new provider wire, phase-2 logprobs/local
Judge, CLI, permission authority, editor qualification or W claim is added.
F owns PLAN/Unreleased/help and native qualification receipts.

### A/F — F53, F55 and F56 prerequisite stops

F53 legal-scan has no engine, runtime entry or captured result contract in
this base. PLAN D77's reference to planned M97 exec legal-scan is not its
implementation. Supply the actual scan rules/normalization/result and trusted
CLI contracts plus captured internal/provider material before an adapter can
reuse them. Building that engine here exceeds the shared ~300-line stop rule.

F55 remains M100/D80 documentation-only. Its recorded prerequisites are M95
provider-local auth/prices, M96 roles/board/worker and attempt journal, accepted
security review, manual public invitations, pinned mutual TLS, revocation,
bounded remote attempt/Git-return contracts and durable ownership/accounting.
No device protocol/service exists to bind here; implementation exceeds the
stop rule. Devices/mDNS remain explicitly off, without listeners/discovery.

F56 has no captured remote broker/control authorization contract or engine in
this base. A must supply the reviewed owned broker/session-grant interface and
captured validated protocol, with native cancellable approval, revocation and
process ownership; availability cannot be guessed without an authorized live
capture. Building a broker/control service exceeds the stop rule. No placeholder
factory, new listener or registry support promotion was made for these rows.

### A/F — final auth admission and Judge type compatibility

Terminal key sign-in now rejects while that same auth owner's sign-out is
still clearing credentials. Its existing key-entry/host gates and cancelled
entry drain remain in place; a new terminal cannot race the final store clear.
Native key launch must still honour its final beforeRun/signal contract.
JudgeWindowDeps keeps the actual PaidUsage public type, including current;
the new narrower policy fields do not hide the existing read-only tally.
F owns the PLAN/Unreleased note for this final refusal. Workflow notification
fixtures retain their captured methods, with a flat selection expression that
passes both format and lint gates. No command/setting/schema/key was added.

### D/F — portable Git types and static graph

B's `src/host/git/repositoryPort.ts` defines the existing immutable repository,
change and physical-owner callback shapes without a native module import.
ConversationGit and its pure ownership helper use it. D's existing Git API
is structurally compatible and was not edited; D may import/re-export these
shared shapes when consolidating its declarations. Push still has no force
argument. The host-API graph counts type edges too, so future portable services
must not import D's adapter even solely for types. The direct value-bundle and
Windows owner controls remain; restoring the native type edge fires the actual
static gate. F regenerates only the source-derived inventory after integration.

### A/F — continuation 2 final gate handoff

Fresh final results are persisted in m104-pb-continuation-gates.json: all five
repository typechecks, owned-engine TypeScript, changed lint/format, zero-clone
duplication, zero-problem localization, production build and 1,749 tests across
64 files pass. All 25 engine files (225 tests) pass under the repository setup/
deadlines with at most three files/workers and no skip/env override. There are
146 byte-exact mutation receipts, 51 new in this continuation.

Actual plain deadcode remains 1: 43 files plus createRuntimeCheckpoints, because
central A discovery/lazy wiring is absent. The exact central-config probe adds
only the owned engine test entry and exits 0; actual shipment needs the named
owned factories in guarded lazy readers/inventories with unchanged budgets.
Actual host-API remains 1 solely for F's generated Node import inventory:
crypto 53→54, fs 36→37, path 90→92, url 7→11. Portable type/value graph passes;
VS Code API 349 / importing files 32 / theme variables 61 are unchanged. F must
record these integration deferrals in PLAN §7 and regenerate/review its record.
Do not add ignores, weaken gates, raise caps or claim qualification from these
component tests. Full quality and assembled native/provider/live checks are
the lead's aggregate; F53/F55/F56 and the listed implementation prerequisites
remain open under the shared bounded-finding rule.

## A integration dispositions — continuation 3

Implementation commit: `3cf813d0aca90f7e2c7727ff4148e3d354271790`. DONE records completion of A’s central scope; listed native/package/reference qualification remains with its owner. **26 central dispositions completed; two bounded scope stops (18 and 25), including the partial captured workflow path.** Full evidence: [A integration record](m104-pa-integration.md).

| Request section                                                          | A disposition                                                                                                                                                                     | Commit      |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1. A — test discovery                                                    | DONE — Central engine namespace, Vitest/knip and aggregate compiler discovery.                                                                                                    | `3cf813d0a` |
| 2. A/C — checkpoint 1 seams (implementation follows)                     | DONE — Real backend recorder and shared checkpoint/controller seams; detailed bindings below.                                                                                     | `3cf813d0a` |
| 3. C — F8 edit-review export                                             | DONE — Owned lazy edit-review factory accepts exact native guarded I/O and shared diff dependencies.                                                                              | `3cf813d0a` |
| 4. A — F15 selected editor text                                          | DONE — Confined live selected-editor text uses B’s conversion with canonical index/trust admission.                                                                               | `3cf813d0a` |
| 5. A — F10/F11 actual recording and frozen engine factory                | DONE — Same checkpoint store records backend writes; guarded lazy engines retain backend lifetime.                                                                                | `3cf813d0a` |
| 6. F — documentation/reference synchronization                           | DONE (F handoff) — Minimum integration docs and missing reference-source prerequisite recorded.                                                                                   | `3cf813d0a` |
| 7. A/D/E/F — F9 fresh editor verification                                | DONE — Version-attested diagnostics/settled and dirty aliases bind the actual verifier.                                                                                           | `3cf813d0a` |
| 8. A/C/D/E/F — F25/F28/F29 portable services                             | DONE — Exact configured hooks/MCP ports, backend lifetime and durable schedule namespace; native watchers remain prerequisites.                                                   | `3cf813d0a` |
| 9. A/C/D/E/F — F32/F39/F40 interactive paid policy and daily accounting  | DONE — Configured hard ledger/policy, verified quote consent, final-owner checks and stock refusal before a popup.                                                                | `3cf813d0a` |
| 10. A/C/D/E/F — portable review support and F30 native language services | DONE — Review/edit-review factories and selected-tool-gated code intelligence; native records remain required.                                                                    | `3cf813d0a` |
| 11. A/C/D/E/F — F34 transfer and F35 worktrees                           | DONE — Real plan/transfer chooser path and owned worktree factory; native process gates remain required.                                                                          | `3cf813d0a` |
| 12. A/C/D/E/F — F31 fetch and F33 browser                                | DONE — Pinned web-fetch binding and owned optional browser dependency contract.                                                                                                   | `3cf813d0a` |
| 13. A/D/F — original dispatch tariff for response settlement             | DONE — Original verified tariff admission and receipt-cost settlement are bound to configured backend teardown.                                                                   | `3cf813d0a` |
| 14. F — checkpoint 5/6 documentation and remaining scope                 | DONE (F handoff) — Checkpoint/feature receipt docs recorded without support promotion.                                                                                            | `3cf813d0a` |
| 15. A/F — checkpoint 6 gate blockers (2026-10-06, Kubuntu)               | DONE — Plain knip/discovery/build gates pass; source-derived host inventory regeneration is F’s handoff.                                                                          | `3cf813d0a` |
| 16. A/C/F — F38 portable trace insight data                              | DONE — Owned usage-insights contribution binds real trace data; no invented model usage fields.                                                                                   | `3cf813d0a` |
| 17. A/C/D/E/F — continuation 2 contract v2 and F6                        | DONE — Frozen v2 factories and configured Auto reviewer bind exact native dependencies; ACP/exec defaults retained.                                                               | `3cf813d0a` |
| 18. A/C/D/E/F — F18 captured workflow path and missing orchestration     | PARTIAL / BOUNDED STOP — Captured Muse workflow path retained. New Model API orchestration refused pending tool/model contract and captured capabilities; exceeds 300-line limit. | `3cf813d0a` |
| 19. A/C/D/E/F — F20 retained session goal refusal                        | DONE — Existing goal controller actions retained, including B’s owner-release refusal; no extra wire.                                                                             | `3cf813d0a` |
| 20. A/C/D/E/F — F23/F24 existing engines and v2 attempt hosts            | DONE — v2 attempt/paid ports retained; missing final native Best-of-N Git admission explicitly rejects.                                                                           | `3cf813d0a` |
| 21. A/D/E/F — F36 pure Git engine and native repository services         | DONE — Pure owned Git factory and protected native owner-bound GitHub lease/REST transport; native qualification open.                                                            | `3cf813d0a` |
| 22. A/D/E/F — F37 v2 auth contributions and trusted key-entry terminal   | DONE — v2 auth contribution, guarded trusted-terminal key-entry/completion service and boolean key presence; keys never bridged.                                                  | `3cf813d0a` |
| 23. A/C/D/E/F — F41 voice driver ownership and F42 priced Tab            | DONE — Owned voice factory and guarded Tab lazy export/caps; native PCM, eligible context and verified prices/ledger remain required.                                             | `3cf813d0a` |
| 24. A/C/D/E/F — F54 owned lazy same-model advisory                       | DONE — Owned same-model Judge contribution reuses checked existing lazy Judge and native ledger/capability/source contracts.                                                      | `3cf813d0a` |
| 25. A/F — F53, F55 and F56 prerequisite stops                            | BOUNDED STOP — F53/F55/F56 have no reusable engines/contracts; prerequisites and 300-line stops recorded, devices/listeners remain off.                                           | `3cf813d0a` |
| 26. A/F — final auth admission and Judge type compatibility              | DONE — B’s final sign-out/key-entry admission and Judge type fixes preserved; native final launch/drain remains required.                                                         | `3cf813d0a` |
| 27. D/F — portable Git types and static graph                            | DONE (D/F handoff) — Pure Git type graph retained; generated inventory delta recorded without editing native adapters.                                                            | `3cf813d0a` |
| 28. A/F — continuation 2 final gate handoff                              | DONE — Final scoped gate/test/cap receipts and exact package inventory handoffs recorded; one B fixture wait and C browser tooling remain open.                                   | `3cf813d0a` |
