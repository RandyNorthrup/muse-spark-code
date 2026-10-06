# M104PC requests to lane A and native owners

These are concrete integration requests, not edits to another lane's files.
Existing caps, wire version negotiation and ACP/headless restrictions stay.
No additional localization key is needed for the first Tasks checkpoint.

1. **Test discovery:** include `test/m104/ui/**/*.test.{ts,tsx,mjs}` in the
   central Vitest and test TypeScript projects. The lane config keeps the
   repository's default timeout. Validate with the lane test commands below
   and the full required gates on the assembled tree.
2. **Tasks composition:** lazy-load `createRuntimePresentation` from the
   forthcoming `src/host/views/runtimePresentationEntry.ts`, install the caller
   table/locale, and assign it to `RuntimeFeatureFactories.presentation`.
   `PortableTasks` uses the existing `tasksState`/Tasks messages and
   `surfaces/open`, `surfaces/focus`, `surfaces/close`. Native/companion carriers
   must return an opened surface ID before sending its `opened` lifecycle
   notification, route its immutable session binding to the contribution view,
   and report user-closed surfaces to the owning presentation factory. A closed
   surface must be recreated on the next Open action. Validate reload/latest
   state, ended state, window move, open/close failure and release during open.
3. **Session identity:** expose a current session-ID callback in
   `RuntimeFeatureContext` for auxiliary creation after new/fork/switch. Until
   then the runtime presentation uses the runtime surface's existing
   `takeRestoredSessionId()` callback (A's implementation returns the current
   session ID). Validate no stale auxiliary binding survives session retirement.
4. **Build ownership:** new presentation code must load in a checked lazy
   Node bundle, with its caller language table installed and declared readers.
   Add its budget/split/package inventory in A's files; do not increase the
   existing 900 KiB startup or 50 KiB deferred browser budgets. The lane will
   provide measured browser chunks and concrete export names per checkpoint.

F owns CHANGELOG/README/PLAN updates and aggregate status. The help-reference
catalog and generator named by common.md are absent at this base; A/F must
include accurate references when their owning files land. No new command or
setting has been introduced by the first checkpoint.
