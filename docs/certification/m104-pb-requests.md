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
its unresolved decisions. ACP/exec ignore this injection. Ordinary paid calls
must pass `requiresAsking: false` to honour workspace Always: A's current
composition hardcodes true, which repeatedly asks. Keep true for actual hook or
protected/requiresAsking uses. The underlying native confirm request must also
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
translation key was added by B. The original XL lane still needs F6/F17/F18/
F20/F23/F24/F36/F37/F38/F41/F42/F53/F54/F55/F56 implementation/bindings and full
qualification; partially exposed rows also remain P until assembled receipts.
No registry status is changed by B.

### A/F — final gate blockers (2026-10-06, Kubuntu)

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
