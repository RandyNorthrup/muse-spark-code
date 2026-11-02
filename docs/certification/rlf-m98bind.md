# RLF-M98BIND — M98 phase-2 production binding, offline half (2026-11-02)

Recovery lane assembling M98 phase 2's production binding with no live,
paid or local-model call. Base `rv/int9` per brief; worktree
`/Users/user/lanes/RLF-M98BIND`, branch `rec/rlf-m98bind` at
`72d8d5003dddee5adc6113671b5dfeeb385a2ddb`. Rig `macbook`. The
2026-11-02 run assembled and inspected (every shell call denied); the
resume run on published 0.19.0 executed every suite, gate and drill
below and committed.

## Sources

No `src/RLF-M98BIND/*` branch exists in this machine's bare repo
(`packed-refs` and `info/refs` searched 2026-11-02: only RLF-M108,
RLF-REFRESHLOCK and RLF-TEAMWIRE carry `src/` branches; no loose-ref
directory `refs/heads/src/RLF-M98BIND` either), and the brief
names no other lane to merge. The offline half below is the tree's own
assembled state, verified file by file in this run; the lane adds this
record and the PLAN M98 status line, and no source change. No stub,
TODO, placeholder or fake was found on the binding path.

## What the offline half is (verified by inspection)

One binding seam serves every surface. `createPhase2Binding`
(`src/core/judge/binding.ts:212`) builds the `JudgeRuntimeBinding` or
returns `undefined` for a true single-model setup (`off`, `same`, or no
separate id — `binding.ts:216-219`), which keeps byte-exact phase-1
behaviour. `cascadeSideFromRuntime` (`binding.ts:137`) adapts a
merged-lane `JudgeRuntime` into a cascade side with the surface's
ledger-backed costs; refusals pass through as the failed side.
`createClientlessBinding` (`src/core/judge/evidencePaths.ts:315`) is the
shared configured-but-sideless constructor, so a configured id reports
its gap instead of silently staying phase-1.

One production side-factory port builds the separate source
(`buildSeparateSource`, `src/core/judge/sides.ts:174`), with one
technique selector (`judgeSideTechnique`, `sides.ts:36`) and the gap
codes `key`, `capture` (E), `install` (J), `unknown`
(`src/shared/constants.ts:2275`, plus window-only `scope`):

- **C, SystemOne (built).** `openrouter-jev:typesafe/jev-1.13` (or any
  captured preset/model pair) becomes lane C's runtime over M95's
  origin-bound stored record, a pinned-origin `fetch` POST with
  `redirect: 'error'`, and the D78 ledger (window) or the run cap (CLI).
  Route, tariff and consent identity come from the captured rows
  (`src/core/providers/presets.ts:1644`,
  `src/core/providers/capabilities.ts:156`; terms at
  `capabilities.ts:131`: $0.042 per million input tokens, output free,
  64,000-token request bound). One request's ceiling is therefore exactly
  $0.002688 (`systemOneUsd(64000, 0, …)`,
  `src/core/judge/systemone/policy.ts:54`). Every row is `tested:
false`, `optIn: true`, `autoSelectable: false`: explicit-only, never
  auto-selected, D48 consent first with its own ceiling and recipient.
- **E, bring-your-own (gap `capture`).** Lane E's dispatch code is real
  (`src/core/judge/providers/run.ts:1`, decided by
  `chooseByoTechnique`), but side construction reports `capture`
  (`sides.ts:290`) until L98P2-CAPABILITY's bounded captures exist (see
  below). Nothing dispatches without a capture.
- **J, local (gap `install`).** The 2j runtime is real
  (`createLocalJudgeSource`, `src/core/judge/local/source.ts:115`; the
  host adapter `src/host/judge/local.ts:40`; the per-platform peer
  proofs), but side construction reports `install` (`sides.ts:273`)
  because no surface passes a verified `ports.local`: install records
  and the certified platform are lead-vetted (L98P2-LOCAL), and M125
  lane E closes the gap. Unverified-local and unknown locality refuse
  confidential use.

The window builds inside `dist/judge.js` from three plain activation
values (`separateId`, `evidenceRoot`, `judgeP2BundlePath`, plus
`readStoredCredential` from SecretStorage,
`src/extension.ts:1707-1717`) through `createHostPhase2`
(`src/host/judge/judgeBinding.ts:90`): the side-factory port
(`judgeBinding.ts:134-146`), key presence read ahead and refreshed per
action, the D78 ledger reserve/settle/refund and D48 route consent
(`src/host/judge/judgeEntry.ts:238-351`), the gap on the status line
(`judgeEntry.ts:194-205`), and the phase-1 fallback: a plan with no
request-level side runs the working phase-1 same-model judge
(`judgeEntry.ts:750-754`), never a side-less runtime. The CLI/ACP/MCP
path builds the same binding from the same factory and the same port
(`cliJudgeBinding`, `src/runtime/judge/cliBinding.ts:38`): the OS
store's M95 record checked before anything resolves, the D78 daily
journal every paid headless use settles into, and the run cap on the
planned ceiling (`src/runtime/main.ts:2129-2156`).

Adoption receipts and fitted profiles load from owner storage, never the
VSIX: `<globalStorage>/judge` in the host, `<config>/muse/judge` for
CLI/MCP (`cliEvidenceRoot`, `evidencePaths.ts:252`), at
`<root>/<kind>/<slug>.json` with `/` separators on every platform and a
bounded hash-suffixed slug (`evidencePaths.ts:133-164`). Profiles load
under the technique the side's own selector chose
(`binding.ts:232-256`); the measurement fit version is `1`
(`JUDGE_FIT_VERSION`, `constants.ts:2267`) over family
`risk.destructive`, prompt `1`, criteria `1` (`constants.ts:2260-2262`),
with the isotonic floor of 200 independent labels
(`JUDGE_ISOTONIC_MIN_LABELS`, `constants.ts:2239`). The receipt is read
beside the sides (`binding.ts:280`) and checked by
`hasJudgeAdoptionEvidence` (`src/core/judge/adoption.ts:51`) — lazy
through `dist/judgeP2.js` in the host (`judgeBinding.ts:103-104`),
direct in the runtime (`src/runtime/judge/judgeEntry.ts:82-83`).

A surface without a fitted profile keeps phase-1 behaviour and says so:
`auto` stays same-model with `judgeAutoNoSource`, `judgeAutoUntested`,
`judgeAutoNoProfiles` or `judgeAutoNoEvidence`
(`src/shared/l10n/en.ts:6927-6930`); explicit `separate`/`both` refuse
with the matching `Off:` sentence; the CLI/MCP refusal stays
`source-unavailable` under G's dispatcher contract. The `separateGap`
code travels binding → plan (`src/core/judge/plan.ts:250`) → window
status (`src/host/judge/judgeEntry.ts:195`) and CLI/MCP refusal
(`src/runtime/judge/assembly.ts:32`); the status line renders each code
in words (`src/webview/components/JudgeStatusLine.tsx:29-35`,
`src/shared/l10n/en.ts:6902-6909`), with the embedding `labels-missing`
note beside it (`JudgeStatusLine.tsx:54-60`). Out of the box the
engine is `auto` with no separate id (`package.json:1353-1359`), so the
factory returns `undefined` and phase 1 is the judge. One immutable plan
per run (`planJudgeRun`, `src/core/judge/plan.ts:198`) reads the binding
once; a
receipt landing mid-run or a tariff refresh cannot dispatch past the
admitted cap.

## What stays out, with counts and ceilings (lead/owner)

| Item                                      | Owner                  | Count / ceiling                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C live capture (L98P2-SYSTEMONE)          | lead                   | At most 3 attempts, at most $0.009, on the lead's own OpenRouter key. Per-request ceiling $0.002688 at the captured tariff ($0.042/M input, output free, 64,000-token request bound). Direct TypeSafe stays untested (documented wire, not captured).                                                                                                                                                |
| E captures (L98P2-CAPABILITY)             | lead                   | At most 2 attempts per named M95 model variant, recording a structured or logprob judge request. No new credential.                                                                                                                                                                                                                                                                                  |
| J vetting (L98P2-LOCAL) + `install` close | lead, then M125 lane E | One exact per-OS manifest: install record (executable, owner, SHA-256), model directory and manifest digest, certification id and native-host proof, built peer helper, full-request token measurement. $0: local inference is free (`worstCaseUsd` 0).                                                                                                                                              |
| EMBED live labels (L98P2-EMBED)           | lead                   | Hundreds of independent labels per family with B's disjoint groups plus a paired held-out report before any family's head enables. Floors: 2 fitted profiles x 200 labels, 1 receipt with grouped lineage, 1 head + manifest x 200 labels. Fitting itself runs offline and free; paid same-provider vs free opted-in verified-local routes; the plan copies the tariff and a claim above it refuses. |
| Any paid dispatch                         | user opt-in            | Explicit engine + stored key + D48 consent + ledger/run-cap admission. None run in this lane.                                                                                                                                                                                                                                                                                                        |

The CLI still has no same-side contributor judge and no embedding model
capture (measurement prerequisites, `docs/certification/m98.md`
M98P2R); those belong to the measurement lanes, not this assembly.

## Proof status: RUN (resume run, 2026-11-02)

The first run's shell was denied throughout (90x `muse.bash`, 1x
`muse.monitor`, 1x escalated `muse.bash`: `tool denied: approval
aborted`); it assembled and inspected only. The resume run executed
everything below on the same tree. Two rig facts: `/usr/bin/git` is a
broken Xcode shim here (every git spawn fails), so all commands ran with
the Command Line Tools git first on `PATH`; `node_modules` was stale
(`qrcode-generator` missing), so the run started with `CI=true npm ci`
(exit 0). No `src/RLF-M98BIND/*` branch exists in `/Users/user/gates/muse.git`
(`git ls-remote`, empty), and the brief names no other lane to merge.

Suites (repository's own timeouts, `--maxWorkers=3`, at most 3 files per
run; no source file changed, so `vitest related` has no input):

| Batch | Files                                                                  | Result             |
| ----- | ---------------------------------------------------------------------- | ------------------ |
| 1     | judgeBinding (18), judgeP2Redesign (11), judgeP2RedesignSides (14)     | 43 passed, exit 0  |
| 2     | judgeP2ReviewFixes (7), judgeWiringAssembly (7), judgeWiringStatus (8) | 22 passed, exit 0  |
| 3     | judgeSystemOneWire (11)                                                | 11 passed, exit 0  |
| 3     | judgeP2Delivery (103)                                                  | 103 passed, exit 0 |

Red drills (the three M98P2R drills from `docs/certification/m98.md`,
adapted to this tree: `judgeP2RedesignWindow` no longer exists, and the
runtime assembly's phase-1 branch returns the same outcome object as a
side-less run, so drill 2 targets the factory's single-model gate, which
is the guard that keeps side-less runtimes from replacing phase 1):

| Drill                               | Mutation                                                                             | Red                                                                                                                                                              | Restored                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Second binding read before dispatch | `runtime.ts` `run` re-plans from a second `binding()` read                           | `judgeP2Redesign`: 5 failed / 6 passed (both receipt counterexamples on ask and MCP, both tariff counterexamples, the read-once test), exit 1                    | `42bb0cbc…`, 11/11 green |
| Side-less runtime replaces phase 1  | `binding.ts` single-model gates (`off`/`same`/unconfigured) weakened to `if (false)` | `judgeBinding`: 3 failed / 15 passed (exactly the three phase-1 preservation tests), exit 1                                                                      | `752c9b90…`, 18/18 green |
| Guessing technique helper           | `sides.ts` returns the capability-boolean guess (`systemone`/`structured`)           | `judgeP2Redesign` + `judgeBinding`: 4 failed / 25 passed (both technique counterexamples, the never-from-booleans test, the explicit-both dispatch test), exit 1 | `1b78eba6…`, 29/29 green |

Each drill restored its file byte-identical (SHA-256 matches the
pre-drill hash; `git diff` clean on all three) and re-ran green.

Gates (exit codes): prettier `--check` on both touched files exit 0
(after `--write` on this record); eslint `--max-warnings 0` not
applicable (both touched files are Markdown, ignored by config, 0
errors); `npm run typecheck` exit 0; `node scripts/check-l10n.mjs` exit 0
(0 problems); `npm run check:reference` exit 0; `npm run check:host-api`
exit 0 (0 problems); `npm run check:plan` exit 0 (0 drift); `npm run
check:roadmap` exit 0 (`ROADMAP.md` current; `npm run roadmap:generate`
rewrote it byte-identical); `npm run check:catches` exit 0 (baseline
match); `npm run duplication` exit 0 (0 clones); `npm run cycles` exit 0
(no circular dependency); `npm run deadcode` exit 0; `npm run build`
exit 0 (every budget holds). The build's first run in this worktree
reported `dist/judgeLocal.js no longer carries
src/core/judge/local/executable.ts`: a stale `dist/` artifact, not the
tree — the metafile already listed the file, and the immediate re-run
was fully green (298 ok lines, 0 problems).

## Files changed

- `docs/certification/rlf-m98bind.md` (this record)
- `PLAN.md` (M98 status line 2026-11-02)

No source, test, locale, settings or generated file changed, so no
CHANGELOG entry: no person-noticeable behaviour changed and no shipped
entry is repeated.

Cost of this lane: $0, 0 live/paid/local-model attempts.
