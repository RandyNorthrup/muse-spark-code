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
