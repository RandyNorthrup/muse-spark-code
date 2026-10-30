# CC-WINRUNS: the suites and looks the sandboxed rigs could not run, run on Windows 11

Lane CC-WINRUNS (Claude Code), branch `cc/winruns` on int/recovery
`9b090e87c7`, 2026-10-30, the owner's Windows PC (Windows 11 Pro 10.0.26200,
node v24.20.0, npm 11.19.0). Four items earlier lanes wrote and could not
run (no GUI session, no Chrome, no Windows in their sandboxes): RLF-TAB's
integration suite, RLF-M95B2's integration suite, RLPROVSYNC's UI look and
RLF-M107's Windows job CPU-rate row. All four are on int (checked first:
`test/integration/tab.test.ts` and `test/integration/editorChat.test.ts` by
`git ls-files`, the `models` and `usage-page-*` scenes in
`scripts/lib/harnessServer.mjs`, the production Windows actuator in
`src/core/resources/actuators/windows.ts`).

No paid or Muse model call, no provider call, no credential read. The vault
suites and the real operating-system credential-store suites were not run
(they write the owner's Credential Manager). `npm ci` ran without the three
install scripts npm 11 now withholds (`@vscode/vsce-sign`, `esbuild`,
`keytar`); esbuild's binary came from its platform package and nothing here
needs keytar. Every run below used `TMP` and `TEMP` under this worktree's
`temp/tmp` and `GIT_CEILING_DIRECTORIES` at its `temp/`. One VS Code test
instance ran at a time; the only processes stopped were this lane's own
(vscode-test closed its instance itself; the owner's VS Code and Chrome were
never touched).

## 1. RLF-TAB: `test/integration/tab.test.ts` (18 cases)

Command, once per label, after `npm run build:dev`:
`npx vscode-test --label <stable|minimum> --run dist/test/integration/tab.test.js`.
vscode-test downloaded VS Code 1.144.0 (stable) and 1.99.0 (minimum, from
`engines.vscode`) into the gitignored `.vscode-test/`. The repository's own
Mocha timeout (20 s) applied; the whole suite takes about two seconds.

| Run                    | VS Code | Result                | Exit |
| ---------------------- | ------- | --------------------- | ---- |
| First run, int's bytes | stable  | 17 passing, 1 failing | 1    |
| After the fix below    | stable  | 18 passing            | 0    |
| After the fix below    | minimum | 18 passing            | 0    |

The failing case, `a secret at the cursor stays quiet, unasked`, found a
product defect, not a test error. `createTabProvider` decided
`secret-at-cursor` (a secret spanning the cursor, from the document alone)
after the D48 paid-use question, so a person editing a file with a secret
under the cursor was asked to approve a spend for a request that could never
be sent, and Deny snoozed Tab for the window. D73 says the question comes with
the first request and that nothing is sent before an allowing answer; a
request that is stopped from the document alone is not a paid request. The
test (written by RLF-TAB, which could not run it) states exactly that:
quiet, nothing asked.

**The fix** (`src/host/vscode/tab/tabProvider.ts`): the line, the mode and
the redacted halves are read before the question, and `secret-at-cursor`
quiets the request first. Nothing else moved: every other quiet path, the
question, the reservation and the send keep their order. The same read also
now comes from the same synchronous snapshot as the text it is cut from
(before, the line was read from the live document after the question's
wait). The sibling in `src/runtime/lsp/lspTab.ts` (Tab over LSP for other
editors) has the same order; it has no suite, so it is left as it is and
named in the report.

**Drill:** the red run is int's own bytes (17 passing, 1 failing, exit 1,
`Error: no queued answer` from the question's queued-answer fixture, which
the unasked case leaves empty on purpose); the fixed bytes give 18 passing,
exit 0 on both labels. The logs are in this lane's `temp/logs/` (ignored).

## 2. RLF-M95B2: `test/integration/editorChat.test.ts` (10 cases)

Same command with `editorChat.test.js`.

| VS Code | Result     | Exit |
| ------- | ---------- | ---- |
| stable  | 10 passing | 0    |
| minimum | 10 passing | 0    |

No fix was needed. The unproven items RLF-M95B2 named stay unproven: the
consent dialog's grant click (a modal no harness answers), the dispatched
reply (needs a live model) and the Meta thinking-off wire value (needs the
Meta backend).
