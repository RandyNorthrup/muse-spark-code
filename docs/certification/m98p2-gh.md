# FIXM98GH — RVM98GH repairs (2026-10-05, Kubuntu)

Brief: `/home/randy/lanes/_ctx/FIXM98GH.rig.md`; shared rules:
`/home/randy/lanes/_ctx/codex/common.md`; review:
`/home/randy/lanes/_ctx/codex/RVM98GH.report.md`. Base `919b316c` on
`m98/ghfix`. The rig override forbids merges, rebases and pushes. Scope is
the GH adapter, `judgeHookCli*` tests, this certification and PLAN's repair
policy/residual records. G/Z still own dispatcher registration, installed
commands, README/CHANGELOG, strings, shared gates and product certification.

This receipt supersedes the safe-result, no-answer and Claude-table policies
in the historical [GH receipt](m98-gh.md). Its 46 controls and source hash
certify the earlier delivery; the controls here certify the repair bytes.

## Findings and delivered behavior

| Finding                                                        | Disposition                                                                                                                                                                                                                                                                     | Regression                                                                                                                                            | Drill         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| P1: safe Cursor permission output blocks                       | Fixed by excluding all three permission rows before inference: their host requires a decision, so no safe judge result reaches an invalid empty exit-0 response. No grant is fabricated. Native delivery remains limited as the named P2 residual below.                        | `keeps Cursor %s unavailable before inference because abstention needs a grant` (three events, safe/risky/no-answer sources)                          | D01           |
| P2: no answer vetoes Gemini/Copilot/native worktree operations | Fixed for supported rows: the hook exits 0 with its preflighted neutral output; the actual generic `judge ask` retains exit 4. Budget, unavailable, failed and partial sources are exercised against the real host consumers, including native `WorktreeCreate`.                | `no answer from budget, unavailable, failed or partial sources never vetoes a supported host`; built-pipe Gemini/Copilot test; generic-ask regression | D03, D04, D05 |
| P2: Claude inherits VS Code's smaller event set                | Fixed: Claude has its own six captured event names and native answer shape. Captured `SessionEnd` is recognized and abstains before inference because the host discards its JSON output; captured object-valued `PostToolUse` also works. VS Code keeps its own flavor/table.   | `uses Claude own captured %s event instead of the VS Code Local table`; unrecorded-event refusal                                                      | D06, D07, D11 |
| P2: malformed foreign tool inputs reach paid admission         | Fixed: zod strictly validates the known tool-field slice before initialization/resolution/admission. Object inputs remain objects. Intentional Cursor MCP and Copilot JSON strings must decode to argument objects. Unknown envelope additions remain complete, redacted state. | `strictly rejects malformed %s/%s %s before paid admission`; explicit paid Copilot positive case                                                      | D08, D09, D10 |

Safe and absent supported verdicts preserve the host's ordinary checks and
approvals. Cursor observation hooks receive exactly one empty JSON object
on abstention, validated against their own output schema; risky observations emit
exactly one validated caution instead. Input/configuration errors retain
exit 2 and fixed localized error text. Inherited deadlines, cancellation,
closed/stalled pipes and invalid engine outcomes produce no caution; hook
abstention is a host completion, never a claim of a model answer.

No paid guard is widened. The adapter still borrows G's real ask runner,
source/model selection, explicit USD cap and injected durable daily-ledger/
first-charge-consent admission. No initialization or paid admission occurs
for unsupported rows or malformed inputs. Generic CLI/MCP exit policies,
foreign parsers, host contracts, dependencies and size caps are unchanged.

## Named residual and registration fence

**GH-Cursor-permission-abstention (RVM98GH P2; PLAN §9).** The pinned Cursor
contract requires `permission` on `preToolUse`, `beforeShellExecution` and
`beforeMCPExecution` (also `beforeReadFile`; `beforeSubmitPrompt` requires
`continue`). An empty exit-0 result is
invalid; with `failClosed`, any nonzero exit or absent output also blocks.
There is no advisory-only neutral decision in this contract. The adapter
therefore refuses these events **before source initialization/resolution or
paid admission**, with exit 4 and no output. It never evaluates a safe action
and then accidentally vetoes it, and never invents ALLOW for an absent answer.
A direct invocation of an unavailable row can still veto under native
`failClosed`; interruption before Cursor stdin/preflight can do so too.

Safe for this lane only because G has not registered this surface and the
unsupported rows cannot dispatch inference. **G/Z must not register these
Cursor rows.** The follow-up is an owner-approved host-specific policy and
captured native abstention proof before enabling them. This is a protocol
redesign, not a relaxed M91 parser or a claimed supported no-op. Other
recognized events without advisory delivery abstain before inference using
their neutral host contract. Claude events beyond the six captured here
remain unaccepted until their own source/capture is certified.

## Source evidence and attempt ledger

- Claude: `test/fixtures/hookFormats/captured/manifest.json`, Claude Code
  2.1.288, Windows throwaway workspace `C:\workspace`, **3 historical model
  turns**; eight scrubbed stdin files across six events. This repair reads
  all six event captures. Saved `raw-claude.md` in the shared hook research
  supplies the exit-code and universal-output rules, specifically the
  `SessionEnd` output-discard exception. It does not borrow VS Code's
  event availability or PostToolUse response type.
- Gemini: the same manifest, CLI 0.62.0, Kubuntu `/workspace`, **37 historical
  requests / 16 successful**, captured exit-2/exit-3 blocking behavior;
  `GEMINI_CONTRACT` remains the interpreter's source of truth.
- Cursor, Copilot CLI and VS Code Local: each existing M91 contract retains
  its separate saved-source citation and **doc-derived, not captured**
  qualification. Cursor's permission schema/`failClosed`, Copilot's CLI
  failure policy and VS Code's Local table are read independently. Synthetic
  unit payloads come only from those real table builders in `test/**`.
  Fake parser/stdio checks do not certify installed foreign-host delivery.

This repair makes **0 live, 0 paid and 0 local model attempts**, 0 new
captures, 0 network calls, 0 credential reads and 0 dependency installs.
No secret, escape hatch, user/model string or tunable is added. Production
fake providers and second credential/ledger stores are not introduced.

## Gates and deliberate controls

All runs are direct on Kubuntu. Whole owning files only, at most three per
run, `--maxWorkers=3 --testTimeout=120000`; no assertion filters or skips.
The initial new contract suite failed on the unmodified adapter:
**15 failed / 4 passed, exit 1**, reproducing every finding. An initial
SessionEnd test expectation was corrected against the saved host contract:
the event discards output, so successful recognition must not charge for an
undeliverable caution. No parser or gate was changed to make it green.

The four whole owning files pass **86/86 tests**. Aggregate quality/coverage
and installed/live receipts remain Z/lead work under the explicit bounded-lane
rules. Each source mutation below failed a named assertion at exit 1, restored
byte-exact in `finally`, and reran its entire owning file at exit 0. Full
mutations, named failures, counts and hashes are in
[m98p2-gh-drills.json](m98p2-gh-drills.json).

The first D02 candidate (replace Cursor's neutral `{}` with empty output)
stayed green: M91's observation rows do not honor `failClosed`, and both
outputs are neutral there. This candidate is not counted. The regressions
now verify exact no-op bytes and actual source invocation; the counted D02
injects invalid JSON and proves the host preflight rejects it. Neither the
contract nor parser was changed.

**15/15 controls fired.** Delivered and restored source SHA-256:
`e499111abd9a1daefe89f081651c3f708a55dac98f6d3cf66715339d25d8d656`.

| ID  | Deliberate break                           | Named regression                                                                            | Whole-file restore      |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------- |
| D01 | host-neutral preflight                     | keeps Cursor preToolUse unavailable before inference because abstention needs a grant       | SHA equal; green exit 0 |
| D02 | valid Cursor neutral JSON                  | safe supported results preserve each host default checks and validated neutral output       | SHA equal; green exit 0 |
| D03 | hook-specific exit-4 abstention conversion | no answer from budget, unavailable, failed or partial sources never vetoes a supported host | SHA equal; green exit 0 |
| D04 | aborted/failed-delivery no-op exit         | honors parent cancellation before dispatch and during admission without leaking the reason  | SHA equal; green exit 0 |
| D05 | closed-pipe no-dispatch abstention         | abstains on closed pipes before dispatch and stalled delivery                               | SHA equal; green exit 0 |
| D06 | Claude own event coverage                  | uses Claude own captured SessionEnd event instead of the VS Code Local table                | SHA equal; green exit 0 |
| D07 | Claude SessionEnd output-discard preflight | uses Claude own captured SessionEnd event instead of the VS Code Local table                | SHA equal; green exit 0 |
| D08 | strict object-valued known tool fields     | strictly rejects malformed claude/PreToolUse tool_input before paid admission               | SHA equal; green exit 0 |
| D09 | JSON strings must contain argument objects | strictly rejects malformed copilot/preToolUse toolArgs before paid admission                | SHA equal; green exit 0 |
| D10 | foreign strict tool slice before admission | strictly rejects malformed gemini/BeforeTool tool_input before paid admission               | SHA equal; green exit 0 |
| D11 | Claude captured-event-only gate            | keeps unrecorded Claude events and VS Code unavailable events out of inference              | SHA equal; green exit 0 |
| D12 | no inference without a caution delivery    | uses Claude own captured SessionEnd event instead of the VS Code Local table                | SHA equal; green exit 0 |
| D13 | exactly one Cursor observation response    | emits exactly one caution for a risky Cursor observation                                    | SHA equal; green exit 0 |
| D14 | native strict tool slice retained          | validates malformed bytes, envelopes and required tool fields before inference              | SHA equal; green exit 0 |
| D15 | failed non-Cursor preflight abstains       | refuses a caution before inference when M91 rejects its native output                       | SHA equal; green exit 0 |

| Check                                         | Result                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                           | Exit 0, all five projects; final changed tests also checked with `npx tsc --noEmit -p test/unit/tsconfig.json`                                    |
| Whole owned Vitest files                      | 86/86 passed: format 46, budget/lifecycle 15, process 4, host-contract regression 21; each drilled owning file also reran green after restoration |
| Scoped ESLint / Prettier / `git diff --check` | Exit 0; no suppression                                                                                                                            |
| `node scripts/check-l10n.mjs`                 | Exit 0: 14 tables, 144 manifest strings, 517 source files, 0 problems                                                                             |
| `npm run deadcode`                            | Exit 0; only existing `vendor/**` and `axe-core` configuration hints                                                                              |
| `npx jscpd`                                   | Exit 0: 1,028 files, 0 clones                                                                                                                     |
| `npm run cycles`                              | Exit 0: 484 production-entry files, no cycles; owned hook graph also checked separately                                                           |
| `npm run check:host-api`                      | Exit 1: inherited generated-record mismatch, named `GH-host-api-baseline` in PLAN §§7/9                                                           |
| `npm run build`                               | All emitted sizes pass; exit 1 on inherited `toJSONSchema` shared-export/split error, named `GH-validation-export-baseline` in PLAN §§7/9         |
| `node scripts/check-host-globals.mjs`         | Exit 0 on emitted Node bundles                                                                                                                    |
| `node scripts/third-party-notices.mjs`        | Exit 0: 83 bundled packages                                                                                                                       |

Production sizes are unchanged: extension **597.7/600 KiB**, Model API
**468.1/475**, checkpoint **89.4/225**, webview startup **897.5/900**, ACP
**830.3/850**, English fallback **127.7/150**. GH remains outside the product
graph until G registers it, so these measurements do not certify future wiring.

The host-API differences are exactly those in the previous GH receipt:
paid-host 11→12, `WorkspaceConfiguration.get` gaining the paid-host reader,
`crypto` 37→38, `stream` 12→14 and `util` 5→6; current scan totals 300 VS Code
APIs, 24 VS Code importers, 25 Node built-ins and 61 theme variables. The split
failure is `src/runtime/judge/mcp.ts` reading `zod/mini.toJSONSchema` absent
from `dist/validation.js`. No repair-owned import or shared export changed.
G/Z own both fixes, their unchanged gate reruns, wiring, the inherited six
activation-fixture failures and complete installed/aggregate certification.
The rig brief forbids this lane from running `npm run quality` or changing
those shared files; no failing gate is reported as passed.

Commit hooks remain on: a temporary worktree-local `pre-commit` runs the
repository's `npx lint-staged --concurrent 1 --no-stash` and
`gitleaks git --pre-commit --staged --redact --no-banner`. The added
`--no-stash` follows the explicit never-stash rule while retaining both
checks; `git -c core.hooksPath=...` affects only this commit invocation.
No repository/user/machine setting or hook is modified. The delivered source
hash is compared after hooks with the drill receipt.
