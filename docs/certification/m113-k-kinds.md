# M113 K — report kinds

Authority: M113K.rig.md, codex/common.md, AGENTS.md, PLAN D93 and M113,
and lane 0's frozen contracts and certification. Worktree: M113K;
branch: m113/k. Implementation and verification run directly on Kubuntu.
No delegation, network, credential reads or model calls are required.

## Planned implementation within K's ownership

Pure collectors under `src/core/reporting/collect/` implement all frozen
kind contracts. They retain source records, require explicit unavailable
facts, sort keys by code unit, cap rows, and put Needs you first. Shared
edit counting moves to `src/shared/diffTally.ts` so portable session facts
and the webview use the same edit classification and path normalization.

The collector factory returns lane 0's `(snapshot, options) => ReportDocument`
signature. Its injected finalizer owns output scrubbing and content hashing
(R); K never manufactures a content hash. Its next-step limit is supplied
by W from constants.ts (D93's three). Pure selection ports carry ancestry
filtered commits (S) and risks/residuals added since the last release (P/S).
The frozen GitFacts has no ancestry graph, and PlanFacts has no revision
dates for risks; absent selectors produce explicit unavailable records.
Existing source ports carry M102/M112 and later milestone facts. No
production fallback invents those facts.

README, CHANGELOG, featureCatalogue, command dispatch, build entries and
purity lint configuration remain with W/X/V/R. Their named integration
handoffs and final test/drill receipts will be recorded below.

## Shared edit tally — first piece

The panel's existing edit classifier now lives in shared code and accepts
the portable `toolCall` fields as well as the panel's `tool` fields. It
retains pathless patch counts and normalizes Windows separators before
deduplicating paths. No user-facing command or setting is registered.

Two whole-file red drills (default timeout, Kubuntu) each exited 1 at
`diffTally > shares portable history counts and normalizes Windows separators`:
remove path normalization; reject portable tool kinds. Each restored the
exact original bytes and compared SHA-256:
`e6fcea3cfcc915dad357aa67bc54cdef4cf3d6cac14c47ca2b73016c26bc5b05`.
Receipts and failed-run logs are in ignored `temp/m113-k-drills/`.
The baseline and restored final whole file each passed all 17 tests with
the default timeout. Webview typecheck and changed-file ESLint passed.
Hooks exist at `.husky/_/pre-commit`; commits use the normal hooks.
