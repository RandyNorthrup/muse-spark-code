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
