# MSM97 — finish milestone M97: Legal and licence scan (macmini, 2026-10-17)

Lane branch `ms/msm97`, worktree `/Users/randy/lanes/MSM97`.
No model call, no paid call, no push, no rebase. Hooks on for every commit.
F27–F31 (wrong licence readings measured on 0.18.2) are owned by the
concurrent LEGALTRUE lane; this lane changes none of that code and records
only what it measured on its own tree (section 6).

## 1. Candidate review

All four named candidates resolve into the lane base; nothing was cherry-picked:

| Candidate                                | SHA         | Date       | Verdict                                                                                                                     |
| ---------------------------------------- | ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| rigs/macmini/c/m97-1-r3 (`cand/MSM97/1`) | `cc01bc594` | 2026-10-11 | Lane base: newest and most complete (CM971-R3/R4/R5, scan-scope ruling, receipts, provenance, post-commit CLI verification) |
| rigs/macmini/c/m97-1 (`cand/MSM97/2`)    | `8e74f2d23` | 2026-10-10 | Ancestor of the base; absorbed                                                                                              |
| rigs/win11/m97/sr (`cand/MSM97/3`)       | `24c211b2c` | 2026-10-05 | Ancestor of the base and already in main; absorbed                                                                          |
| rigs/win11/m97/win (`cand/MSM97/4`)      | `f170022e6` | 2026-10-05 | Ancestor of the base and already in main; absorbed                                                                          |

`git merge-base HEAD main-now` before the merge was `82d50d5e4`
(release 0.17.0). The branch adds no new D-numbers to PLAN.md, so no
renumbering from D140 was needed. Main's test-overhaul deletions stay deleted:
`test/unit/legalRun.test.ts` and `test/unit/legalScanBundle.test.ts` were
present on the branch, modified on main's side only by the overhaul's removal
(`f2b00c09` `test-overhaul PASS 2a: delete 786 GO unit test files`), and are
resolved deleted. Both used fake scanners/transports, which the owner's
2026-10-12 testing rules delete anyway.

## 2. Main merge (`8338f86ef`)

`git merge --no-edit main-now` (`821566c0f`), committed as `8338f86ef`
with hooks on (gitleaks: no leaks found). Eight conflicts, each resolved by
meaning:

- `CHANGELOG.md`: main's file plus the branch's five M97 bullets only (two
  under `### Changed`, three under `### Fixed` — the same sections they came
  from; everything else on the branch's Unreleased list had shipped on main).
- `package.json`: one hunk, the `build` script — main's
  `gen-lazy-registry.mjs --check` kept, the branch's trailing
  `check-legal-build-records.mjs` kept.
- `scripts/build.mjs`: one hunk — main's three new bundle entries
  (`modelApiTools`, `rulesFile`, `modelsSubscriptions`) built through the
  branch's `shippedBuild` production-recording wrapper (M97 build records).
- `src/runtime/reference.node.generated.ts`,
  `src/shared/reference/reference.generated.ts`,
  `src/shared/reference/referenceSchema.generated.ts`: regenerated with
  `node scripts/gen-reference.mjs` (73 features, 65 commands, 89 settings,
  29 slash, 244 CLI), never hand-merged.
- `PLAN.md`: two hunks, both sides' append-only records kept (§3 resolved
  questions, §7 gate receipts).
- `ROADMAP.md`: regenerated with `node scripts/gen-roadmap.mjs`
  (218 entries).

Exit-code semantics kept the branch's PLAN-blessed side: advice and
should-fix exit 0, only blockers exit 1 (`src/runtime/legal/runLegal.ts`,
which auto-merged without conflict).

## 3. Connections — every surface a person can reach (file:line)

- Panel `/legal` slash and palette: `src/extension.ts:4732` routes
  `requestLegalScan`; `src/host/conversation/conversationController.ts:10184`
  handles it; the scan runs lazily through `dist/legalScan.js` at
  `src/extension.ts:2168` (`legalScanLoader`, `runLegalScan` at :2172,
  enrichment at :2180). Workspace trust is enforced at :2173.
- Terminal: `exec legal-scan` / `legal` in `src/runtime/cliArgs.ts:270,315`,
  executed without backend, auth or model at `src/runtime/main.ts:1043`
  (`runLegalCommand`), stdout carries only the report, exit 0/1/2.
- Editor protocol, both backends: Muse Code `mcp__ide__legalScan` in
  `src/host/ide/legalScanTool.ts:35` (`isIdeLegalScanOffered`), Model API
  `legal_scan` in `src/core/backends/modelapi/legalScanTool.ts:1`; the
  runtime backend forwards at `src/runtime/backends.ts:351`, the ACP agent
  at `src/runtime/main.ts:763`.
- JSON envelope: `legalReportEnvelopeSchema` in
  `src/runtime/legal/runLegal.ts:84` validates every `--format json`
  emission before it leaves (`runLegal.ts:261`).
- Help reference: `legal` and `legal-explanation` features in
  `src/shared/featureCatalog.ts:403,414` (`legal-scan-m97` anchors);
  `npm run check:reference` passes (section 4). README `## Legal scan
(M97)` documents commands, header policy, registry consent, receipts and
  the not-legal-advice disclaimer; `docs/acp.md` documents the headless
  invocations with the exit-code table (0 complete, 1 blocker,
  2 incomplete/invalid/interrupted).
- Bundled skill: `skills/legal/SKILL.md` ships beside the scanner.
- The `@unwired M97 legal report envelope` tag on `LegalReportEnvelope`
  (`src/runtime/legal/runLegal.ts:89`) is kept on purpose: the JSON surface
  it describes is person-reachable (validated on every emission), but no
  product module imports the TS type yet — its importers will be the
  other-editor bindings (M104/M60–M66). Removing the tag makes
  `npm run deadcode` exit 1 (`LegalReportEnvelope` unused export, measured),
  so the tag stays until a consumer lands. The schema itself is wired.

## 4. Gates on the final tree (all run in this worktree, macmini)

| Gate                    | Command                                                                                               | Result                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal suites            | `npx vitest run <39 files> --maxWorkers=3`, repo timeouts                                             | 11,108 passed, 0 failed (13 batches of ≤3 files; §5's three locale-reader files re-run after the key move: 3 files green)                                                                                                                                   |
| Typecheck, all projects | `npm run typecheck`                                                                                   | exit 0 (host, webview, unit, e2e, integration)                                                                                                                                                                                                              |
| ESLint, touched file    | `npx eslint --max-warnings=0 scripts/build.mjs`                                                       | exit 0                                                                                                                                                                                                                                                      |
| Format, touched files   | `npx prettier --check` on CHANGELOG/PLAN/ROADMAP/package.json/build.mjs/generated references/msm97.md | clean except this file before its final `--write` (fixed before commit)                                                                                                                                                                                     |
| Dead code               | `npx knip`                                                                                            | exit 0 (only the 3 pre-existing configuration hints)                                                                                                                                                                                                        |
| Cycles                  | `npm run cycles`                                                                                      | exit 0, no circular dependency in 2,319 modules                                                                                                                                                                                                             |
| Duplication             | `npx jscpd` (repo `duplication` script)                                                               | exit 0, 0 clones over src+test                                                                                                                                                                                                                              |
| Localization            | `npm run check:l10n`                                                                                  | exit 0 (14 UI + 14 usage tables, 252 manifest strings, 1,553 sources, 0 problems)                                                                                                                                                                           |
| Pack order              | `node /Users/randy/lanes/_ctx/codex/l10n-pack-diag.mjs`                                               | 14/14 `equal=true` after §5 (was 0/14)                                                                                                                                                                                                                      |
| Reference               | `npm run check:reference`                                                                             | exit 0, tables current                                                                                                                                                                                                                                      |
| Host API                | `npm run check:host-api`                                                                              | exit 0, 0 problems                                                                                                                                                                                                                                          |
| Plan / roadmap          | `npm run check:plan`, `npm run check:roadmap`                                                         | exit 0, 218 milestones, 0 drift, ROADMAP current                                                                                                                                                                                                            |
| Production build        | `npm run build`                                                                                       | exit 0 (see §4.1)                                                                                                                                                                                                                                           |
| SAST                    | `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                                                | NOT RUN HERE: the semgrep binary crashes on this rig before any rule loads — `Fatal error: exception Failure: ca-certs: empty trust anchors` with segfault-handler warnings, exit 2. Full log: `temp/msm97/sast.log`. The lead runs it outside the sandbox. |
| Audit                   | `npm run security:audit`                                                                              | exit 0 (2 advisories covered by the checked-in exceptions file; posture unchanged)                                                                                                                                                                          |

### 4.1 Production build receipt (`npm run build`, exit 0)

- `dist/extension.js` 550.8 KiB / 600, `dist/modelApi.js` 507.2 / 525,
  `dist/legalScan.js` 148.0 / 150 — every cap holds.
- `legal build records: 90 bundles, 1947 files, 0 problems`.
- `legal repository scan: 0 incomplete, 0 blockers, 0 should-fix, 149 findings`
  (all advice).

### 4.2 Packed-product proof (the built product, no model)

`node dist/acp.js exec legal-scan --json` on this worktree: exit 0, stdout
parses directly as JSON (`{disclaimer, result, registry}`), stderr carries
only the display-language notice. Counts: 0 incomplete checks, 0 blockers,
0 should-fix, 149 advice findings;
`dataVersion` is
`spdx-license-ids@3.0.24+spdx-exceptions@2.5.0+templates@3.28.0`.
`receipt/1/1` visibly names `lz-string@1.5.0`, MIT, its licence file,
`licence-review.json` and the renewal condition.

## 5. Lane fix: receipt strings in English key order (`45ce770dc`)

The four CM971R5 strings (`legalScanReceiptHelp`; `legalScanner`
`reviewedReceipt`, `receiptRenew`, `invalidReceipt`) sat after the last key
of their tables instead of in English position, so the packed archive
(English layout) differed from source and `npm pack` would fail with
`packaged l10n/ui.<locale>.json: differs from source`. Each moved to its
English neighbours in all 14 tables by exact line surgery
(`temp/msm97/reorder-l10n.mjs`, scratch, uncommitted): 14 files,
+84/−84, parsed values verified identical before write. `check:l10n` stays
0 problems; the pack diag went from 0/14 to 14/14 `equal=true`. No unit
test was added for this: per the owner's rules a key-existence/order test
is not a test — the pack comparison is the gate, and its output is the
proof recorded here. The three locale-reader suites re-ran green after the
move (JSON order cannot change parsed values).

## 6. F27–F31 spot measurements on this tree (no code touched)

Measured through the packed scan in §4.2 (149 advice findings on this
worktree). LEGALTRUE owns the fixes; these notes are evidence only:

- F29 (redaction): zero explanations read `[redacted] declares`, and
  `dataVersion` is the full version string, on this tree's
  `exec legal-scan --json` path. The 0.18.2 path the lead measured is
  unchanged by this lane.
- F28 (MPL wording): the compat `m012` template still pairs an MPL-2.0
  declaration with file-copyleft plus an LGPL-linking sentence (e.g. the
  eight `lightningcss*` findings). Whether that sentence belongs on a pure
  MPL finding is LEGALTRUE's ruling to make.
- F27/F30/F31: not reproducible from this tree without the lead's Python
  workspace (F27), and owned by LEGALTRUE (help exit codes F30, chat
  summary length F31). This tree's scan of itself completes with exit 0.

## 7. Incidents (UNMEASURED causes, stated as measured facts)

- At ~08:41–08:42, 170 test files (`test/unit` ×164, `test/e2e` ×6)
  disappeared from the worktree while legal suites and then the build ran.
  No command of this lane deletes test files (build and gate scripts were
  audited: their only `rmSync` targets are `dist/*` chunks/metafiles and
  mkdtemp workspaces). All 170 restored byte-identical with
  `git checkout HEAD -- test/`; the tree has been stable since (30+ min,
  `git status` clean apart from this file). Cause UNMEASURED: possibly an
  external actor on the shared rig. No work was lost (one merge commit
  existed before the event).
- The first `npm run build` invocation produced rebuilt `dist/` bundles and
  metafiles, then no observable output for 90+ minutes (output was piped
  through `tail`, hiding per-step progress). Its process state could not be
  inspected (`ps` is denied in this sandbox). Each build step re-run
  directly exits 0, and a second full `npm run build` with a log file
  completed exit 0 (§4.1). If the first invocation is still alive it is
  doing read-only check work; nothing of this lane depends on it.

## 8. Real-life steps for the lead

1. Panel: open an open trusted workspace, run `/legal` (or the Command
   Palette entry). A deterministic report appears with severity groups,
   evidence, exclusions and the disclaimer; no model turn runs.
2. Terminal: from the workspace root, run
   `node dist/acp.js exec legal-scan --json` (exit 0 when complete without
   blockers; 1 with a blocker; 2 when incomplete). Stdout is the
   `{disclaimer, result, registry}` envelope; `--out <file>` writes the
   report instead.
3. Receipts: add a root `licence-review.json` entry for a reviewed
   notice-only difference (package, exact version, licence-byte SHA-256,
   SPDX id, reason); rescan and see **Reviewed by receipt** in the report.
   Change one byte or the version and see review return.
4. ACP/headless: `muse-spark-code-acp exec legal-scan --json` from any ACP
   editor or shell — keyless, offline by default, `--registry` only with
   consent.
5. Still owed to hosted/Windows runs (lead): installed VSIX on both
   backends, Windows reparse/path receipts, browser/zoom/screen-reader
   receipts for the report (this sandbox cannot start a browser).

## 9. What is still not done and why

- LEGALTRUE's F27–F31 fixes land separately; this lane deliberately does
  not touch them.
- SAST could not run in this sandbox (tool crash, §4); installed-host,
  Windows and visual receipts stay with the lead (sandbox has no browser,
  and hosted CI is the lead's gate).
- `npm run quality` (aggregate) is the lead's gate per the shared lane
  rules and was not run here; every gate it contains that a lane may run
  is recorded in §4.
