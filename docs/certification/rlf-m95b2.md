# RLF-M95B2 — RLM95B's named test gaps: A4 foreign-path guard, editor-chat provider

Branch `rec/rlf-m95b2` on int/recovery at 0.19.0 (`d7be903c84`), rig macmini.
Merged `rec/rlm95b` (`e87e375b4`, not yet in int/recovery) first, then closed
the two gaps RLM95B named in its own work. No paid or live model calls.

## How this was verified

| Claim | Evidence |
|---|---|---|
| No product code names another app's storage | `test/unit/subscriptionForeignPaths.test.ts`, exit 0, 2 passed |
| The guard fires on a planted read | Drills D1–D2, exit 1 each, then green restored |
| Editor-chat conversion refuses and converts | `test/unit/editorChat.test.ts`, exit 0, 14 passed |
| The unit tests fire on broken logic | Drills E1–E2, exit 1 each, then green restored |
| The provider behaves over the real editor API | `test/integration/editorChat.test.ts`, 10 cases; NOT RUN on the rig (sandbox has no GUI session — see below) |
| Related suites still pass | `vitest related` on both changed sources, exit 0, 14 passed |
| Split exceptions are load-bearing | Without the deferredBundles exception the split gate fails naming `editorChat.ts` (exit 1); with both exceptions it passes (exit 0) |

## 1. A4's foreign-path guard test

PLAN M95b acceptance 4: Remove revokes and deletes, and nothing of Codex
CLI's, Claude Code's, Gemini CLI's or Copilot's own storage is ever read —
"a test that the code names none of their paths". The test scans every
`src/**/*.ts` file with the TypeScript API (string/template literals plus
identifiers, so comments and doc URLs never trip) for path-shaped markers:
the dotted home folders on a path boundary (bare, `/`- or `\`-joined, or
`.claude.json`), `github-copilot`, and the `CODEX_HOME` /
`CLAUDE_CONFIG_DIR` / `COPILOT_HOME` overrides. The boundary keeps
`platform.claude.com`, `github.copilot` settings keys and `copilot/` model
hints green. Exactly three files name foreign paths, each reviewed with its
mechanism anchors: `src/shared/constants.ts` (the documented import folders
and the no-write defense segments), `src/core/reporting/sources/agentUsage.ts`
and `src/runtime/reporting/sources.ts` (agent session roots). Anything else
that names one fails the suite; a listed mechanism that goes away fails the
anchor test until the record is updated.

- D1: `const drillForeignStore = '~/.codex/auth.json'` appended to
  `src/core/providers/subscriptions/chatgpt.ts` → 1 failed
  (`chatgpt.ts: .codex:793`); reverted → exit 0, 2 passed.
- D2: `process.env.CODEX_HOME` in the same file → exit 1
  (`chatgpt.ts: CODEX_HOME:793`); reverted → exit 0, 2 passed.

## 2. The editor-chat provider, tested for real

The provider (`createEditorChat`) imports `vscode`, so RLM95B left it
integration-only and untested. Both halves are now covered:

- Pure logic moved to `src/core/providers/editorChat.ts` (conversion,
  limits, rates, reasoning effort, grant evidence, the refusal class), with
  the editor's role and tool-mode values injected as an opaque numeric wire
  (verified numeric in the pinned `vscode.d.ts`: User 1, Assistant 2,
  Auto 1, Required 2). `lmProvider.ts` passes the real enums; the move is a
  mechanical extraction, behavior-preserving by construction (diff-reviewed).
- `test/unit/editorChat.test.ts` (14 tests) drives the real code: real
  resolved models (local, priced, unpriced, offable) from a providers file
  plus catalogue through the real registry, sentinel wire values, the
  recorded xAI tier capture for the long-context line. Refusals, conversion,
  effort selection, rate rendering and grant binding are all pinned.
- `test/integration/editorChat.test.ts` (10 tests) drives the production
  provider inside the Extension Development Host: opt-in gating and opt-out
  through the real setting, unpriced/unselected/cancelled refusals with the
  fixed sentence, and offline token counting (the reply path with no paid
  call; the injected socket fails the suite if a request is ever sent).

Drills on the unit tests (core logic broken on purpose, then restored):

- E1: `editorChatLimits` accepts a zero window → exit 1
  (`refuses an unknown window and a zero bound`); restored → exit 0.
- E2: `editorChatBody` accepts an assistant picture → exit 1
  (`refuses misrouted parts, oversized pictures and malformed turns`);
  restored → exit 0.

The integration suite could not run on this rig: the downloaded VS Code
test host never opens a window (process alive, user-data stuck at
`Local State`), because the agent sandbox has no GUI session
(`SECURITYSESSIONID` unset). Per the sandbox rule that part stops here:
the file is written to the repo's integration conventions, typechecks,
lints, and bundles under `build:dev`; the lead runs it outside the
sandbox and CI runs it headed. The `.vscode-test` download was removed
afterwards (it trips the legal repository scan).

Openly unproven: the consent dialog's grant click (a modal no harness can
answer) and the dispatched reply (needs a live model); the Meta
thinking-off wire value (needs the Meta backend). Everything up to and
around them is covered above.

## Gates

Green: unit runs above (repo's own timeout, no override), `typecheck`
(all five projects), eslint and prettier on every touched file,
`check:reference`, `check:roadmap`, `check:host-api`, `check:l10n`,
`check:catches` (counts match the merge baseline), `cycles`,
`check-bundle-split` (exit 0 with the two reasoned editorChat exceptions),
`gen-lazy-registry --check`, `check-host-globals`, `third-party-notices`,
`check-legal-build-records`, `security:audit`. `dist/editorChat.js` holds
its budget (19.2 of 30 KiB); the new core file rides only in that bundle.

Pre-existing failures, reported not fixed (other lanes' files, untouched
here): `check:plan` (PLAN.md over 85% of the archive budget at the merge
commit), `duplication` (one judge-tests clone), `deadcode` (judge/paid/
redact/resources/team findings), and seven `check-bundle-size` OVERs from
merge bloat — reportingPanel +0.2, resourceGovernor +1.8,
resourceAdmission +0.1, modelApi +7.4, vaultActions and estimateContracts
marginal, wire +1.0 KiB. No budget was raised. `security:sast` cannot run
in the sandbox (its semgrep binary aborts on an empty CA store).

## Commits

- `ca4a9327a` Merge rec/rlm95b (RLM95B) into RLF-M95B2
- `df27efb74` RLF-M95B2: M95b A4 foreign-path guard test
- `e22e54c6e` RLF-M95B2: editor-chat pure logic to core, unit-tested on real code
- records, the integration test and the shared rig helper (this commit)
