# RLF-UNPROVEN — certification record

Lane: RLF-UNPROVEN. Machine: macmini. Date: 2026-11-02. Base: rv/int9.
No live calls were made by this lane: the first pass ran with the shell
denied (see §6), and the resume run made none either — a real cell needs
a route key, which this lane never holds, so the keyed runs stay with
the lead.

## 1. What this lane did

`docs/real-life/unproven.md` (the backlog of behaviours whose tests were
deleted under the no-fakes rule) is converted into 23 run-ready real-life
scenarios under `scripts/real-life/scenarios/`, named `m<milestone>-<what>.mjs`,
one small file per scenario. Each file names its deleted titles, its
packed-product steps, its expected model attempts (`requests`) and its
dollar cap (`maxUsd`). `docs/real-life/scenario-index.md` maps every
backlog section to its scenario, an older scenario, lead-only manual
steps, or hosted receipts. Nothing is marked proven: a behaviour leaves
`unproven.md` only when the lead's run proves it.

The runner (`scripts/real-life/run.mjs`) enforces an optional per-surface
`maxUsd` exactly as it enforces `requests` (fail the cell, admit nothing
more), prints each surface's allowance in `--list`, and keeps declared
caps in the record (results and skipped alike). `docs/testing/real-life.md`
documents `maxUsd` and the backlog set (selection patterns, the
allowance/cap table, route restrictions).

## 2. The scenarios

- `m10-workspace-context` (acp, 4 req, $0.10): sweep case17 (rules).
- `m33-web-search` (exec 0 req, acp 4 req, $0.15): sweep case11;
  `execWebSearchUnbounded`.
- `m34-images` (exec, 8 req, $0.30): sweep case12.
- `m48-subagents` (acp, 6 req, $0.15): sweep case10.
- `m49-memory` (acp, 4 req, $0.10): sweep case07.
- `m54-media-attach` (exec, 4 req, $0.10): sweep case04/05 (attach path);
  mediaLimits; acpMedia.
- `m63-agent-identity` (exec, 0 req, $0.00): acpStdio
  version/help/unknown-arg.
- `m67-code-intel` (acp, 8 req, $0.15): sweep case19.
- `m69-web-fetch` (acp, 4 req, $0.10): webFetch end-to-end rows;
  ApprovalCard page row.
- `m70-review` (acp, 8 req, $0.15): sweep case23; review; reviewMaterial.
- `m80-exec-args` (exec, 0 req, $0.00): execStdio E2/H1; trust/search
  refusals.
- `m80-exec-egress` (exec, 4 req, $0.10): execOutput A12; execSchema
  A15/A16; execStdio E5.
- `m80-scanner` (exec, 3 req, $0.05): scanSecrets; redact (GitHub token,
  counts).
- `m82-budget-refusal` (exec, 0 req, $0.00): sessionBudget reserve rows;
  sweep case22 (never-sent).
- `m84-share-redaction` (exec, 2 req, $0.05): redact; promptImport;
  promptBridge.
- `m93-report` (exec, 0 req, $0.00): moduleExports report handler.
- `m95-accounts-auth` (exec, 0 req, $0.00): acpStdio sign-in/readiness;
  runtimeAccountsService.
- `m96-team-admission` (exec, 0 req, $0.00): teamConstants;
  teamSchedulerPick (reserved slot).
- `m102-usage-views` (exec, 1 req, $0.05): usageText; usageTable;
  sampler; samplerProbes.
- `m105-uploads` (acp, 0 req, $0.00): acpUploads.
- `m106-structured-output` (exec, 6 req, $0.10): execOutput M106;
  structuredOutput; outputSchema.
- `m116-playbook` (exec, acp, 0 req, $0.00): playbookCommand; acpPlaybook.
- `m118-prompts-share` (exec, acp, 0 req, $0.00): acpStdio M118;
  promptLibrary/Store/Import/Bridge.

Declared totals: 62 requests on the Meta route at most, 58 on a provider
route. `m34-images` runs on Meta only (the run's Model API key pays);
`m80-exec-egress`, `m82-budget-refusal` and `m96-team-admission` run on
provider routes only (a raw command cannot carry Meta's key).

## 3. Why each scenario is believed run-ready

Every exact string, exit code and grammar in the set was read from the
sources it asserts against (no guesses):

- Exit codes: scan-secrets found 10 / usage 2 (`EXEC_SCAN_EXIT_FOUND`,
  `src/runtime/exec/scanSecrets.ts`, whose stdout is the bare count);
  unknown commands and bad flags 2 (`cliArgs.ts`, `main.ts`); team and
  budget run-start refusals nonzero; share preview-without-confirm 7
  (`EXEC_EXIT.denied`).
- Exact sentences: `execTrustRefused` and `execWebSearchUnbounded`
  (`src/shared/l10n/en.ts`); `/uploads` empty/usage/not-found
  (`src/acp/uploads.ts`); tool-call titles `Spawn Agent`, `Fetch Page`
  (`toolLabels` in `en.ts` via `src/acp/translate.ts`); share/prompt
  result texts (`src/runtime/sharing/commands.ts`, `src/acp/sharing.ts`);
  the `[redacted]` mark and the `ghp_` shape (`src/shared/redact.ts`).
- Grammars: `prompts save` reads stdin, `prompts use <id> --confirm`,
  the two-step scripted share (`--json` preview id, then `--confirm`);
  `exec --attach/--output-schema/--team/--image-generation`;
  trusted ACP sessions via `openEditor(['--trust-workspace'])`;
  `--web-search` on serve; `budget_exceeded` with 0 requests
  (`lib/admission.mjs`); the JSON Schema subset for `--output-schema`
  (`src/runtime/exec/outputSchema.ts`).
- Runner mechanics respected: parse-level refusals go through
  `person.command`, never `person.exec` (a missing result envelope would
  trip the runner's own missing-results check); `m82-budget-refusal`
  runs late (order 85) because a refused run keeps its reservation in
  the day's ledger; planted secrets are synthetic, hex-only (base64url
  would break the token shape), and never printed by any observation.

## 4. What the resume run proved, and what is not proven

- Every gate ran here and passed (§9): prettier, eslint (one
  `unicorn/prefer-early-return` in `m118-prompts-share.mjs` found and
  fixed), typecheck, l10n, reference, host-api, plan, roadmap (with
  `ROADMAP.md` regenerated), catches, duplication (0 clones), cycles,
  deadcode, and the production build with every budget holding.
- `--list` proves the 23 files load and print their allowances; the
  docs' glob selects exactly those 23 and none of the older scenarios.
  The declared totals were recomputed from the files: 62 requests on
  the Meta route, 58 on a provider route, as documented.
- Every `person.*` call, `session.*`/`editor.*` call, `routeArguments`,
  `EXEC_ADMIT_USD`, `only` and `order` used by the set was checked
  against `scripts/real-life/lib/` and the older scenarios: all exist.
  Claim ids are free-form (older scenarios invent theirs too; no gate
  checks them), so the new ones follow the convention.
- The `maxUsd` predicates were executed without a run:
  `microUsd('0.00')` is 0, `microUsd('0.05')` is 50000,
  `microUsd('bogus')` is NaN — so a malformed cap fails its cell and
  stops admission, and a surface without `maxUsd` skips the check
  unchanged.
- No keyed scenario ran here: a real cell needs a route key (the run
  refuses without one before installing anything), and the musecode
  route refuses on an unversioned CLI. The lead's runs are the proof
  the scenarios pass.
- The dollar caps are bounds from the 0.18.2 records (about $0.003 a
  cheapest-model request on Anthropic, less elsewhere), set an order of
  magnitude above expected spend so only a runaway fires one. If a cap
  fires on a healthy run, the cap — not the product — is the finding.
- Two behaviours the scenarios pin may legitimately differ per route and
  are recorded, not decided, here: whether image generation bills on the
  Meta route only, and whether hosted search answers from the provider
  or from memory (the lead reads the `m33` answer for it).

## 5. Findings for the lead (not this lane's to fix)

1. `exec` accepts `--web-search` and `--trust-workspace` (both refused
   with their own sentences) but the `exec` help topic lists neither.
   Help omits two words the parser knows.
2. The `spawnInventory` and `teamWorkerCertification` guards went out
   with the fakes; nothing re-guards the process inventory or the worker
   source hashes. The index marks both as known gaps to re-guard.
3. `m82-budget-refusal` and the Meta read-backs both reserve in the
   product's daily ledger; a full backlog run plus the older set should
   be watched against the day's budget on first execution.

## 6. The lane's condition

The first pass ran with the shell (`muse.bash`) denied throughout —
every command returned `tool denied: approval aborted` — so it ran
file-tools only: all reads, all writes, no execution, no commits. The
resume run (published 0.19.0, shell working) executed everything §4 and
§9 record and committed with hooks on.

## 7. Lead runbook

```text
# 1. The files load (no request, no spend).
node scripts/real-life/run.mjs --artefact <tgz> --routes meta --list
# 2. The backlog set on one provider route and the Meta route.
node scripts/real-life/run.mjs \
  --artefact dist/muse-spark-code-acp-<version>.tgz \
  --routes anthropic,meta \
  --scenarios 'm1*,m3*,m4*,m5*,m6*,m7*,m8*,m9*' \
  --max-requests 120 --max-usd 2.00 \
  --keys env \
  --record docs/testing/real-life/<version>/<system>-<date>-unproven
# 3. Only after green: move each proven behaviour out of unproven.md.
```

## 8. Open questions (none blocking)

None. The two route-dependent behaviours in §4 are recorded in their
scenarios for the lead's run to decide.

## 9. Red/green drills and gate exit codes (resume run, observed)

Drill A (the `--list` allowance printing): the budgets line in
`scripts/real-life/run.mjs` broken on purpose → `--list` prints
`(exec)` with no allowance, `grep 'cap \$0.00'` exits 1 (red);
restored → the allowance prints, grep exits 0 (green).

Drill B (scenario loading): `m63-agent-identity.mjs` broken on purpose
(trailing non-JavaScript) → `--list` exits 1 (red); restored → full
`--list` exits 0 (green).

A keyed cell run was attempted and honestly stopped: the musecode
route refuses on an unversioned CLI, and the meta route refuses
without `REAL_LIFE_KEY_MODELAPI_KEY` before installing anything. No
key exists in this lane, so no cell ran; the darwin-x64 tarball built
for the attempt (`npm run package:acp` needs the CI-built darwin
helpers, built here with `native/darwin/build-local-judge.sh` and
`native/darwin/build.sh`) is git-ignored and stays out of the commit.

| Gate                                                                   | Exit |
| ---------------------------------------------------------------------- | ---: |
| prettier --check (touched files; 13 fixed with --write)                |    0 |
| eslint --max-warnings 0 (touched files; 1 error fixed)                 |    0 |
| npm run typecheck                                                      |    0 |
| node scripts/check-l10n.mjs                                            |    0 |
| npm run check:reference                                                |    0 |
| npm run check:host-api                                                 |    0 |
| npm run check:plan                                                     |    0 |
| npm run roadmap:generate + npm run check:roadmap                       |    0 |
| npm run check:catches                                                  |    0 |
| npm run duplication (0 clones)                                         |    0 |
| npm run cycles                                                         |    0 |
| npm run deadcode                                                       |    0 |
| npm run build (every budget holds)                                     |    0 |
| npx vitest related scripts/real-life/run.mjs --run (no affected files) |    0 |
| node --check (run.mjs + 23 scenarios)                                  |    0 |
| --list (23 load; glob selects exactly them)                            |    0 |
