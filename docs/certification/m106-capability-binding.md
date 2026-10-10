# M106 production capability binding — C-M106-2 (kubuntu, 2026-10-10)

Lane branch `c/m106-2` from `358bee7aa`. No paid or live model call, no
credential read, no network call beyond `npm` tooling. No cap, gate level,
ignore or timeout was weakened; all tests ran at the repository timeout
(no `--testTimeout`).

## Scope

`argumentPreviewCapabilities` was forwarded by
`modelApiBackendManager.ts` but supplied by no caller, and the selected
`output.maxTokens` fell back to the legacy 32,768-token request cap. This
lane supplies both from the captured Meta record in the Model API bundle
entry (`src/host/backend/modelApiEntry.ts`), which every host loads:

- `metaArgumentPreviewCapabilities` (`src/core/backends/modelapi/modelCapabilities.ts`):
  streaming-argument support on the U9-captured `muse-spark-1.3-contributor`
  model only. Evidence is the counted 2026-10-05 capture
  (`test/fixtures/m106/u9-strict-stream.json`): two
  `response.function_call_arguments.delta` frames then `.done`. The selector
  asserts only that streaming sequence, never payload shapes.
- `metaOutputMaxTokens`: the documented 131,072-token maximum for bare
  `muse-spark-*` models, matching `modelPolicyFor`'s Meta ceiling so the
  request and the clamp agree. Qualified (`provider/model`) and non-Meta ids
  keep the legacy request cap until their own capture.

A caller-supplied resolver still takes precedence (`??` in the entry), for
the C-M95-8 registry follow-up. No caller passes these deps today: the only
two `ModelApiBackendManager` construction sites (`src/extension.ts:2526`,
`src/runtime/backends.ts:337`) were read and pass neither, so no edit was
needed in `extension.ts`, `runtime/backends.ts` or `src/acp/translate.ts`
(the ACP translator already renders record-emitted previews, covered by the
existing `UpdateTranslator` cases in the preview suite).

## Acceptance (PLAN 31780-31826: items 1, 6, 8)

| Item                       | Verdict                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Off means today's bytes | Unchanged: golden requests with the feature off are byte-identical (`modelApiGoldenRequests.test.ts` green, unmodified); unobserved models keep the legacy stream and 32,768-token cap through the production path.             |
| 6. Previews                | Deltas render in the tool row, bounded; nothing runs, asks or calls a hook before `.done`; no preview bytes reach replay or requests. Proven through the unmanaged production path (manager → entry → host → fake SSE deltas).  |
| 8. Output                  | Meta turns request 131,072, clamped by the budget; one continuation follows `max_output_tokens`, then a notice (existing L2 mechanics, unchanged). Calls in a cut-short reply are answered with an error, never run (existing). |

Provider × item rows: `muse-spark-1.3-contributor` on/on; other bare
`muse-spark-*` off-preview/on-cap (cap is documented for every Muse Spark
model; streaming deltas were captured only on the contributor model);
all other providers off/off with reason "no capture" (C-M106-1 manifest:
every row waits for its key or local runtime).

## Tests

- `test/unit/modelCapabilitiesBinding.test.ts` (+2): selector values on the
  captured/contributor models, `undefined` for uncaptured, qualified and
  unknown ids. 14 passed.
- `test/unit/modelApiArgumentPreview.test.ts` (+3, `productionRig` with the
  exact entry suppliers): captured model streams a preview and requests
  131072; `muse-spark-1.2` withholds previews at 131072; `future-model`
  stays at 32768 with no previews; no `argumentPreview` bytes in any
  request. 47 passed.
- `test/unit/modelApiBackendManager.test.ts` (+2): a turn through the real
  entry with no caller suppliers previews on the captured model (131072),
  stays silent on 1.2 (131072) and on an unobserved model (32768) with no
  preview bytes in requests; a caller-supplied resolver keeps precedence by
  reference. 25 passed.

## Red drills

1. Execute on a delta (existing L1 guard, re-fired by this lane's wiring):
   `modelApiArgumentPreview.test.ts` →
   "never executes, asks or calls a tool hook on a delta, then reuses the
   row after done". Passed with the binding in place.
2. Guard removal: the entry's two `?? meta…` defaults were replaced with
   plain pass-through; "binds the selected record through the unmanaged
   production path" failed as named (`expected false to be true` — no
   preview on the captured model). The entry was restored byte-exact
   (`sha256sum -c` OK against the pre-drill hash). `modelCapabilities.ts`
   was untouched by the drill; its hash below is the committed lint-clean
   content, re-verified by the green suites in Gates.

| File                                              | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `src/host/backend/modelApiEntry.ts`               | `6297ecd90a094e41818a3d3d2e3ce6f0936614f1ce20e63e1a4a77a0daaa770f` |
| `src/core/backends/modelapi/modelCapabilities.ts` | `edc4135a1b14a030b7a57c317f140f3cd8b510fdd20cda70f168c938595cdbd1` |

## Gates (kubuntu rig)

- `npx vitest run` (repository timeouts): the three files above green.
- `modelApiGoldenRequests.test.ts`: proves feature-off bytes unchanged
  (run in the final gate pass).
- `npm run typecheck`, `eslint --max-warnings=0` + `prettier --check` on
  changed files, `node scripts/check-l10n.mjs` (no new strings), `npm run
build` with bundle-size/split gates: run in the final gate pass.
- `npm run check:reference`: no new command, setting or feature surface, so
  no catalog row; the check must stay green.

## Editor and OS scope

One binding in the shared bundle entry serves VS Code, ACP and headless
`exec` by construction (all three load `dist/modelApi.js` through the same
manager). The suites above run on kubuntu; Windows/macOS receipts, the
`~4-turn` live check, Codex + Grok review and the M106 release checklist
stay with the lead. The entry and selectors use no path, shell or
platform-dependent code (model-id string comparison only).

## Open (lead decisions)

1. Run the Meta collector with the key and install raw U9 delta/done,
   status and output-cap receipts (`m106-completion-captures.md` gate).
2. Capture U9 streaming rows for other Meta models to widen previews beyond
   the contributor model.
3. C-M95-8 follow-up: pass registry BYO records through the manager deps
   (the `??` precedence hook is ready).
4. The lead's full gate matrix, hosted CI on three OSes, and Codex/Grok review.
