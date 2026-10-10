# M106 production capability binding — C-M106-2 (kubuntu, 2026-10-10)

Lane branch `c/m106-2` from `358bee7aa`; R2 repairs the RVCM1062 findings
(P1/P2/P3, all four). No paid or live model call, no
credential read, no network call beyond `npm` tooling. No cap, gate level,
ignore or timeout was weakened; all tests ran at the repository timeout
(no `--testTimeout`).

## Scope

`argumentPreviewCapabilities` was forwarded by
`modelApiBackendManager.ts` but supplied by no caller, and the selected
`output.maxTokens` fell back to the legacy 32,768-token request cap. This
lane binds both from the SELECTED model record in the Model API bundle
entry (`src/host/backend/modelApiEntry.ts`), which every host loads:

- Cap: the entry stashes each resolved selected-record policy in its
  `models.resolve` wrapper (the host resolves the selected model at session
  start and on every switch) and the default `modelOutputMaxTokens`
  supplier reads the stash first. Bare Meta models never reach the
  resolver, so they fall through to `metaOutputMaxTokens`, which now
  delegates to M95's own `modelPolicyFor` (the documented 131,072-token
  maximum, the same record the host's clamp reads). No lane code names a
  model id; an unresolved model fails closed to the legacy cap.
- Preview: `metaArgumentPreviewCapabilities` stays gated on the U9-captured
  `muse-spark-1.3-contributor` model. Evidence is the counted 2026-10-05
  capture (`test/fixtures/m106/u9-strict-stream.json`): two
  `response.function_call_arguments.delta` frames then `.done`. A grep over
  `src/` proves no other streaming-argument record exists in-tree for any
  model (bare or qualified), so every other model stays preview-free with
  reason "no capture" rather than guessing from M95's preset. Rendering
  undeclared model bytes stays denied by the preview grammar (declared
  fields only), pinned on the captured wire.
- Both production manager callers now supply the M95 registry resolver:
  `src/extension.ts` builds it from the configured provider services over
  the existing `dist/configuredProviders.js` split chunk (lazy import, no
  new block, presence-only key check through the secret store), and
  `src/runtime/backends.ts` reuses the provider run's registry where a
  provider run exists (unchanged errors elsewhere). A caller-supplied
  preview/cap dep still takes precedence (`??` in the entry).

No edit was needed in `src/acp/translate.ts`: the ACP translator already
renders record-emitted previews, covered by the existing
`UpdateTranslator` cases in the preview suite.

## Acceptance (PLAN 31780-31826: items 1, 6, 8)

| Item                       | Verdict                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Off means today's bytes | Unchanged: golden requests with the feature off are byte-identical (existing M91 fixtures green, untouched); the new off/on golden run proves the default-on byte diff is exactly `max_output_tokens` 32768 → 131072, nothing else.                                                                                                                                                                              |
| 6. Previews                | Captured U9 argument bytes drive previews through the unmanaged production path (manager → entry → host → real SSE/transport/parser): snapshots accumulate to the captured length; nothing runs, asks or calls a hook before `.done`; no preview bytes reach replay or requests. Declared-tool text rendering from captured bytes awaits raw per-delta payloads (lead-held; only the split point is the test's). |
| 8. Output                  | Meta turns request 131,072, clamped by the budget; a qualified selected record with `output.maxTokens = 65536` requests 65536 through the production path; one continuation follows `max_output_tokens`, then a notice (existing L2 mechanics, unchanged). Calls in a cut-short reply are answered with an error, never run (existing).                                                                          |

Provider × item rows: `muse-spark-1.3-contributor` on/on; other bare
`muse-spark-*` off-preview/on-cap (cap is documented for every Muse Spark
model; streaming deltas were captured only on the contributor model);
qualified models on-cap/off-preview (cap binds from the resolved record;
no in-tree streaming-argument record exists for any qualified model);
all other providers off/off with reason "no capture" (C-M106-1 manifest:
every row waits for its key or local runtime).

## Tests

- `test/unit/modelCapabilitiesBinding.test.ts`: selector values unchanged
  (`metaOutputMaxTokens` now delegates to `modelPolicyFor` with identical
  observable values on captured, bare, qualified and unknown ids).
- `test/unit/modelApiArgumentPreview.test.ts` (`productionRig` with the
  shared production selectors): captured model streams a preview and
  requests 131072; `muse-spark-1.2` withholds previews at 131072;
  `future-model` stays at 32768 with no previews; no `argumentPreview`
  bytes in any request.
- `test/unit/modelApiBackendManager.test.ts` (+2 R2): "binds a qualified
  selected record through the unmanaged production path" (registry
  `team/small` with `output.maxTokens = 65536` requests 65536, preview-free
  for want of a streaming record); "replays the captured U9 argument wire
  through the production path" (fixture byte-exact done arguments as two
  deltas through real SSE/transport/parser/host; snapshots reach the
  captured length with no rendered text per the undeclared-tool rule; cap
  131072; no preview bytes in requests). Caller-supplied precedence by
  reference still holds.
- `test/unit/modelApiGoldenRequests.test.ts` (+1 R2): off/on golden run
  proves the default-on byte diff is exactly the cap, fixtures untouched.
- `test/unit/execClient.test.ts` (+1 R2): a preview-carrying
  `tool_call_update` never reaches the sink; only the completed edit's
  paths reach `onFilesChanged`.

## Red drills (R2; every guard broken on purpose, every file restored byte-exact)

1. Execute on a delta (existing L1 guard, re-fired by this lane's wiring):
   `modelApiArgumentPreview.test.ts` →
   "never executes, asks or calls a tool hook on a delta, then reuses the
   row after done". Passed with the binding in place.
2. Entry guard removal (covers F1, F2 and F3): the entry's default cap
   supplier and both `?? meta…` defaults were replaced with plain
   pass-through of caller deps. "binds a qualified selected record…"
   failed (`expected 32768 to be 65536`); "replays the captured U9
   argument wire…" failed (zero previews); "changes only
   max_output_tokens…" failed (the on arm carried no 131072 cap). The
   entry was restored byte-exact (`sha256sum -c` OK against the pre-drill
   hash recorded below).
3. Exec drop removal (covers F4): the `tool_call`/`tool_call_update` drop
   branch in `execClient.ts` was neutralised, so completed-edit paths were
   never reported. "drops preview-carrying tool updates…" failed on the
   `onFilesChanged` assertion (the sink still stayed marker-free behind the
   second tool-prefix filter). The file was restored byte-exact
   (`sha256sum -c` OK).

| File                                              | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `src/host/backend/modelApiEntry.ts`               | `9ab34634936eb1f7ae06a181fe5e017c0c78222d40c6bfccacf2d3a722cb8ff5` |
| `src/core/backends/modelapi/modelCapabilities.ts` | `a38746798e33c410027775bae82f67dd1f30a974f514c2808cd2049c1fd99657` |
| `src/runtime/exec/execClient.ts`                  | `abfda2b6f44aaeb899789e48ffb167baa393bc2fab7a1875b5d7a347dd7704fd` |

## Gates (kubuntu rig, R2 final pass)

- `npx vitest run` (repository timeouts, `--maxWorkers=3`): batch one
  (`modelApiBackendManager`, `modelCapabilitiesBinding`,
  `modelApiArgumentPreview`) 88 passed; batch two
  (`modelApiGoldenRequests` 141, `execClient` 11) 152 passed. Total 240.
- `npm run typecheck` (all five projects) clean; `eslint
--max-warnings=0` and `prettier --check` on every changed file clean;
  `node scripts/check-l10n.mjs` 0 problems (no new strings); `npx jscpd`
  0 clones; `npm run deadcode` clean (two pre-existing config hints);
  `npm run check:reference` current; `npm run check:host-api` 0 problems.
- `npm run build` (tokens, production esbuild, size, split, globals,
  notices) clean: `dist/extension.js` 550.5 KiB (cap 600),
  `dist/modelApi.js` 516.1 KiB (cap 525); `configuredProviders.js` stays
  its own chunk, so the new lazy import adds no block.

## Editor and OS scope

One binding in the shared bundle entry serves VS Code, ACP and headless
`exec` by construction (all three load `dist/modelApi.js` through the same
manager), but the hosts do NOT render alike: streamed argument previews
render in VS Code and ACP only. Headless `exec` drops every
`tool_call`/`tool_call_update` before its sink (`execClient.ts`) and its
engine observer emits completed-tool metadata only, so it records
completed tools and never shows live previews (pinned by the new exec
test). The output cap binds in all three hosts: it is a request path they
share. The suites above run on kubuntu; Windows/macOS receipts, the
`~4-turn` live check, Codex + Grok review and the M106 release checklist
stay with the lead. The entry and selectors use no path, shell or
platform-dependent code.

## Open (lead decisions)

1. Run the Meta collector with the key and install raw U9 delta/done,
   status and output-cap receipts (`m106-completion-captures.md` gate).
   Raw per-delta payloads are the one true external blocker left: only
   with them can declared-tool preview TEXT render from captured bytes
   (today only the byte-exact arguments, the counted sequence and the
   fail-closed rendering rule are proven).
2. Capture U9 streaming rows for other Meta models to widen previews beyond
   the contributor model; attest a qualified model's streaming arguments
   before any qualified preview turns on.
3. The lead's full gate matrix, hosted CI on three OSes, and Codex/Grok review.
