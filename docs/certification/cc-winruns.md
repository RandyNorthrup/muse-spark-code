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

## 3. RLPROVSYNC: the local looks (`npm run ui:look`)

Headless Chrome from `C:\Program Files\Google\Chrome` in its own throwaway
profile under `temp/tmp` (the owner's Chrome was not touched), after the dev
bundle above. One small look each, light and dark, two pictures per scene;
no baseline and no comparison:

- `npm run ui:look -- models`, exit 0: the chat view with its model picker
  open, both themes render and read cleanly
  ([light](cc-winruns-models-light.png), [dark](cc-winruns-models-dark.png)).
- `npm run ui:look -- usage-page-one-provider`, exit 0: Account & usage's
  totals now carry the `1h Cache Writes` and `12h Cache Writes` tiles
  between `Cache Writes` and `Reasoning Tokens`
  ([light](cc-winruns-usage-light.png), [dark](cc-winruns-usage-dark.png)).
  The fixture holds no cache-write counts, so both tiles read `Unknown`,
  which is what the page says for an absent count.
- Also looked at, not recorded as pictures: `usage-page-narrow` (320 px,
  exit 0; the viewport shows only the first tiles) and the same scene with
  `--lang=de` (exit 0): `12h Cache-Schreibvorgänge` fits its tile with no
  overflow.

What the look cannot show, said plainly: RLPROVSYNC's new setting row
`museSpark.modelApiPromptCacheTtl` is a row VS Code draws itself from
`package.json` in its Settings editor, so no harness scene renders it, and
the webview has no wizard field for the cache lifetime on int (no webview
source names the setting; the 12-hour surfaces are the usage page's tiles
and the model detail's price row). Those two stay unlooked-at here, not
claimed.

## 4. RLF-M107: the Windows job CPU-rate and priority row

The pending row is the Win11 one of `m107-platform.md` and `rlf-m107.md`: an
owned finite child in an owned job, the CPU rate control set to a 50% hard
cap (5000 in Windows' hundredths of a percent), read back, restored and read
back, with the job's below-normal and idle priority classes and their
recovery, without elevation. The row's old proof, `actuatorsWindows.test.ts`,
was deleted with the fake-driven unit suites (`f2b00c0947`), so nothing on int
proved it. The full-scale owner case was **not** run (it saturates this PC,
by the owner's rule); `scripts/m107-owner-case.mjs` is a governor measurement
for acceptance 15 and has no Windows job mode, so the smallest scale that
proves this row is the job itself.

**New suite:** `test/unit/actuatorsWindowsNative.test.ts` (two cases, Windows
only, modelled on `windowsTreeReader.test.ts`). It builds the real shell-job
assembly through the product's builder, starts one owned child (Windows
PowerShell that joins a fresh named job through `joinStatement` and sleeps),
and drives the production `WindowsResourceActuator` behind
`ResourceActuators` with the production `WindowsResourceTreeReader`. Nothing
is stood in. Every state is read back from the operating system by a path the
actuator does not use for its own answer: the job's CPU rate control and
priority class from `QueryInformationJobObject` (the helper's Read calls) and
the child's priority class from .NET's `Process.PriorityClass`.

- Case 1, throttle, pause, retire: before, the fresh job reads flags 0, rate 0. Throttle answers `jobPriority applied, jobCpuRate applied`; the job then
  reads flags 5 and rate 5000 (`RESOURCE_JOB_CPU_RATE_PERCENT` 50% times 100),
  priority `belowNormal` for the job and the child, and .NET reads
  `BelowNormal`. Pause reads job and child `idle` (`Idle`) with the rate still 5000. Retirement answers `retired: true` and the job reads flags 0, rate 0,
  its original priority record and the original .NET class again, exactly.
- Case 2, reused birth: a ticket whose root has the right pid and a wrong
  start time answers `[{ control: null, status: 'unknown' }]` and the job's
  rate, priority record and the child's class are unchanged.

The session was not elevated: `IsInRole(Administrator)` False, mandatory
level Medium (S-1-16-8192). Result: 2 passed, exit 0 (first run 77 s with the
helper compile; later runs 23 to 47 s for the file, 9 s and 1.4 s for the two
cases when warm). The repository's
`--maxWorkers` was 1 and no other suite ran beside it. The case deadline is a
named constant, `REAL_WINDOWS_JOB_TIMEOUT_MS` (120 s), with a PLAN.md §8 row.

**Drills** (each breaks production code, runs the whole file, restores the
file from a byte copy; `git diff` of the three files is empty afterwards):

| Drill | Break                                                                              | Result                                                                                                              | Exit |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---- |
| D1    | `windows.ts`: the cap computed as `* 10` instead of `* 100`                        | case 1 fails: the job reads `{ flags: 5, rate: 500 }`, not rate 5000                                                | 1    |
| D2    | `actuators/index.ts`: recovery writes the lowered value, not the original          | case 1 fails at retirement: the job still reads the capped values, not the original `{ flags: 0, rate: 0 }`         | 1    |
| D3    | `trees/windows.ts`: the tree reader accepts a root whose birth is not the member's | case 2 fails: the wrong-birth ticket is acted on (`jobPriority applied`, `jobCpuRate applied`, not the one refusal) | 1    |
| -     | all three restored                                                                 | 2 passed                                                                                                            | 0    |

**Still pending for M107, and why:** the full all-cores owner case at CPU
threshold 60 (not run: it saturates this PC, by the owner's rule; one command
on a bare rig, `node scripts/m107-owner-case.mjs`), the GUI second-window
activation row (part of that case) and the Kubuntu cgroup row (this is a
Windows machine).

## Gates

All on the final tree, exit codes as the shell returned them:

| Gate                                                                                            | Exit |
| ----------------------------------------------------------------------------------------------- | ---- |
| `prettier --check` on the touched source, test, CHANGELOG, PLAN and records                     | 0    |
| `eslint --max-warnings 0` on `tabProvider.ts` and `actuatorsWindowsNative.test.ts`              | 0    |
| `npm run typecheck` (all five projects)                                                         | 0    |
| `node scripts/check-l10n.mjs` (14 UI tables, 14 usage tables, 283 manifest strings; 0 problems) | 0    |
| `npm run check:host-api` (392 VS Code APIs, 0 problems; no record change)                       | 0    |
| `npm run check:plan` (240 milestones, 0 drift)                                                  | 0    |
| `npm run check:roadmap` (240 entries; ROADMAP.md current, no regeneration needed)               | 0    |
| `npm run check:catches` (counts match the baseline; the new test adds none)                     | 0    |
| `npm run duplication` (0 clones)                                                                | 0    |
| `npm run deadcode`                                                                              | 0    |
| `npm run build` (production build, bundle size and split gates, legal build records 0 problems) | 0    |
| `test/unit/actuatorsWindowsNative.test.ts`, repository timeouts, `--maxWorkers` 1 (2 passed)    | 0    |
| `npx vscode-test` Tab and editor chat, stable and minimum (section 1 and 2)                     | 0    |

Two gates were red once on the way and fixed at the cause: `check:plan` read
the first M94 status line as malformed (the bold ran over a line break; now
one line), and `duplication` found two clones inside the new test (the
repeated readbacks became one `snapshot` helper). The test was edited after
its first green run, so the drills above ran against its final text.

## Not run, and why

- The full all-cores M107 owner case, its GUI second-window row and the
  Kubuntu cgroup row: see section 4.
- The vault suites and the real credential-store suites (`keyringParts`,
  `keystoreOwner`, `credentialLease`, `providerHeadersStore`): they write the
  owner's Credential Manager.
- The whole unit suite: hosted CI owns it; only the suite this lane added and
  the unit files that import `tabProvider.ts` (none) ran.
- `security:sast`, `security:secrets`, `test:a11y` and the real-life run:
  outside this lane's list. The commit hook's gitleaks scan ran clean on each
  commit.
- `.vscode-test/` (1.5 GB: VS Code 1.144.0 and 1.99.0) is still in this
  worktree, gitignored; delete it with the worktree. The production build ran
  with it present and the legal repository scan reported 0 blockers.
