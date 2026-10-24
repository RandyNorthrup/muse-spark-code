# Certification: merge 04 — the report flow lands (lane REPORTFLOW R1+R2)

Merge of `src/RLUSAGE/04-feat-report-flow` (from main `f8435aaacb`) onto
the recovery branch, resolved for current main. Motivating case: GitHub
issue 146 (0.16.0, Windows) — no description, `Recent events (0): none`,
facts only saying the CLI was found, not signed in, no key stored.

## What the report now carries and why (PLAN.md M93, D72 intact)

Fixed words only: no service prose, no free text, no path, no prompt, no
session id. Every new fact goes through the same zod schema, the same second
scrub and the same preview as the existing ones, and is switched off with
the facts (`includeFacts: false`).

### New facts (`ProblemReportFacts`, all optional)

| Fact                | Vocabulary                                                                                                                                                                              | Source                                                                                                                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `panelState`        | `REPORT_PANEL_STATES`: `starting`, `landingNoCli`, `landingInstalling`, `landingSignedOut`, `landingSigningIn`, `landingError`, `ready`, `turnRunning`, `turnFailed`, `questionWaiting` | Webview names it on `openReport` (`reportPanelStateOf` in `src/core/support/reportContext.ts`, derived from the auth snapshot, the active turn, the open questions and the last row); absent outside a panel renders `panel: not recorded` |
| `lastNotice`        | `{ code, ageMs }`, code in `REPORT_ERROR_CODES` (off-list refused)                                                                                                                      | Last `errorNotice` journal event (`lastNoticeOf`); absent renders `last notice: none`                                                                                                                                                      |
| `lastSignIn`        | `{ outcome: none\|started\|succeeded\|failed, code?, ageMs? }`; `failed` requires its reason code, any non-`none` requires its age                                                      | Last `signInStarted`/`signInSucceeded`/`signInFailed` journal event (`lastSignInOf`); absent renders `last sign-in: none`                                                                                                                  |
| `backendResolution` | `REPORT_BACKEND_RESOLUTIONS`: `museCodeSetting`, `museCodeAuto`, `modelApiSetting`, `modelApiAuto`, `noneCliMissing`, `noneCliSignedOut`, `noneNoKey`                                   | `describeBackendResolution` (`src/core/backendSelection.ts`), the same facts `selectBackend` reads; absent renders `backend resolution: not recorded`                                                                                      |

Every host builds the same facts for the same state through
`enrichProblemReportFacts` (`src/core/support/problemReport.ts`).

### New journal events (same event schema, no new free text)

`signInStarted` / `signInSucceeded` (code: the `browser` or `apiKey` path),
`signInFailed` (codes `expired`, `denied`, `saveFailed`, `cancelled`,
`timedOut`, `unsupportedFile`, `cliMissing`, `keyInvalid`, `keyRefused`,
`unknown`), `cliProbe` (`cliSignedIn`, `cliSignedOut`, `cliMissing`),
`backendResolved` (the resolution word). The sign-in, probe and resolution
code words join `REPORT_ERROR_CODES`. `AuthService` takes an optional
facts-only `report` (wired to the flight recorder in `src/extension.ts`, so
recording runs from activation, before any conversation exists); probe and
resolution record once per change so a refresh loop cannot crowd the journal
out. Codes are catalogue words only — a key, a user code, a path or a detail
never reaches a record.

### No filing rule (D121/D208)

The branch gated filing exports on a 20-character description
(`REPORT_DESCRIPTION_MIN_CHARS`, `hasReportDescription`,
`assertFilingDescription`, the `needsDescription` export reason, the
terminal's exit-2 stdout refusal). A minimum of ours on the person's
description is a threshold of ours, so the merge removes it everywhere:
the dialog's hint list guides instead, the host and the terminal never
refuse an empty description, and the protocol's export reasons carry no
`needsDescription`. `REPORT_DROP_COUNT_CAP` went the same way: drop counts
render as counted, floored at none. The 2,000-character textarea bound
(`REPORT_DESCRIPTION_MAX_CHARS`) predates this merge on main and stays.

### The vault scrub stays wired (unlike the branch's P2-4)

The branch removed the `vaultScrub` parameter everywhere; current main
keeps the vault path for the pending vault lane, so the merge keeps it in
all three hosts: `buildVaultProblemReportDraft` with the optional scrub
port in the dialog's handler (and its re-scrub on export), and in
`runReportCommand` (the terminal and `/report problem`). Production wires
no scrub today (the extension and the agent pass none), so the pattern
scrub is the only scrub in real use; the port's contract is pinned by the
handler and rebuild suites with a counting scrub, and by `reportCommand`'s
scrub case for the terminal.

## What each host shows

- **VS Code family (dialog):** the three prompts under the field; the
  connect hint (sentence plus **Sign in to Muse Code** and **Add a Model
  API key**, posting the landing screen's own `signIn` messages) when the
  CLI is not signed in and no key is anywhere; the working state while the
  draft gathers; every export available with any description; rebuild
  failures in the dialog's own status line with the last draft kept. The
  draft carries all four new facts.
- **Terminal / ACP (`muse-spark-code-acp report`):** `--description` is
  optional and never refused; `--out` writes the file. A build or write
  failure names its field and fixed reason on stderr and in the log. The
  draft carries `lastNotice`, `lastSignIn` and `backendResolution` from
  the same journal and facts; `panel` reads `not recorded`. Reports build
  on `android`.
- **Other editors:** `/report problem <what happened>` answers the same
  scrubbed draft in the reply with the issue link; an empty description
  still answers its draft. Nothing leaves the editor: no browser, no model
  or vendor call.

## The report always builds (round 2)

Every fact behind its own bounded read (`withReportTimeout`, always
cleared); the dialog snapshot bounds the facts read, the journal read and
the reporter check at `REPORT_SNAPSHOT_TIMEOUT_MS`, and a source that
throws or hangs becomes `unknown` with a fixed reason code for that fact
while the report still opens. The whole snapshot shares one deadline; the
dialog shows `reportOpening` → `reportLoading` while it waits. When the
report bundle cannot load, or the panel never becomes ready within
`REPORT_SURFACE_READY_TIMEOUT_MS`, the editor itself offers Copy Report,
Save to a File and Open Issue Page (`dist/reportFallback.js`, its own
50 KiB budget, no `vscode` of its own); `Report This` uses the same way
out when the dialog cannot open. `Report This` waits for its event's
write first, bounded by `REPORT_JOURNAL_FLUSH_TIMEOUT_MS`. The draft
carries its build time (`Built:`, the ages' anchor), the backend actually
running conversations, the Model API sign-in state, the reported event's
mark, and the records it left out (`Dropped events:`, silence when none).

### The four bounds are error-survival waits (D121 and D208, owner 2026-10-23)

`REPORT_FACT_TIMEOUT_MS` (2 s), `REPORT_SNAPSHOT_TIMEOUT_MS` (10 s),
`REPORT_JOURNAL_FLUSH_TIMEOUT_MS` (2 s) and `REPORT_SURFACE_READY_TIMEOUT_MS`
(30 s) cap no work of the person's: each is a wait that exists to survive a
hung read or a surface that never loads, and each ends by saying why (the
fact reads `unknown` with the fixed reason `TimeoutError`, the log keeps the
same code, and the fallback's pick is titled "The report window could not
open. Choose another way to report."). The branch had no wording for this;
the merge adds the cited values in `src/shared/constants.ts`: 2 s is twice
the 1 s default `timeoutSeconds` of a Kubernetes probe (checked 2026-10-24,
kubernetes.io), 10 s is Nielsen's limit for keeping a person's attention on
the dialogue (nngroup.com, "Response Times: The 3 Important Limits", checked
2026-10-24), 30 s is Docker's default `HEALTHCHECK --timeout` (docs.docker.com,
checked 2026-10-24). None is person-settable: they bound a diagnostic read,
not work, and the dialog stays closable at any moment. Main's own D93 rule
that no timeout of ours ends a report source read (the `/report` engine,
42aec1b0b) is untouched: these are the problem report's, a separate path.

### Gate rework in this merge

- `check:catches`: the branch added nineteen catch sites the gate could not
  classify as handled or reported. Each now records its failure under a fixed
  reason code (`reportError`, `recordError`, `readBounded` in
  `reportTimeout.ts`; `reportError` in `reportCommand.ts`), narrows to a named
  condition (`isMissingPath`, `ReportBuildError`) or was removed as
  redundant (`canUseVscodeReporter`'s inner catch, the recorder's swallowing
  `forget`, `existsSync`'s try). No class count rose; eight fell (root CLEANUP
  2 to 1, runtime SWALLOW 34 to 32, runtime GENERIC 188 to 183; baseline
  regenerated on falls only, no new identity).
- `cycles`: `authService` took `isValidModelApiKey` from `credentialStore`,
  closing `credentialStore -> authEntry -> authService`; it now tests the
  same shared `MODEL_API_KEY_PATTERN` directly.
- `duplication`: the three suites share one fixture module
  (`test/unit/helpers/reportFixtures.ts`).
- Test-only seams in `ConversationReports` (`loadReport`, `runReportFallback`)
  had no remaining test and are removed.

## Tests (this tree, repo default timeout)

Owning suites, all real code, no stand-ins:

- `reportProblemHandler.test.ts` (28) — open with exactly the carried
  records; session numbering; panel state and connect hint; builder
  refusal posts `reportFailed` and clears the wait; unknown facts, mark
  unknown journal and hidden reporter on a thrown read (class-only log);
  item bounds within the transport cap; localized ages with an English
  draft; the bounded flush wait; rebuild echo and unmarked success;
  reporter refusal and export-scrub failure in fixed words; copy exactness
  and seal naming; stale-seal refusal with re-preview; refused clipboard
  and cancelled save; the prefilled issue page and its over-long fallback;
  issue and reporter filed with an empty description; refused/throwing
  browser; throwing save path; reporter prefill fields; missing-command
  reporter failure; scrubbed webview-failure forwarding; the transport
  strictness pair (forged fields rejected, bounds accepted).
- `reportCommand.test.ts` (24) — argument parsing (bare, options, exit-2
  refusals, `--help` to the reports usage); the sealed stdout draft equal
  to the builder's; `--out` without a description; no VS Code version
  outside VS Code; section switches; exact `--out` bytes; unreadable
  journal failing closed; CLI presence and sign-in from local files only
  (never values); absent CLI; refused build, locked store and failed write
  answering internal with nothing on stdout; the terminal-and-log reason;
  `android` accepted; `onSealedDraft`; stdout with an empty description;
  the vault scrub over the sealed draft; platform refusal; the agent-journal regressions (cross-process read,
  tampered-record rejection, prune on read and on append, never through a
  link — the link test needs a symlink privilege this account lacks; see
  below).
- `reportFallback.test.ts` (7) — picks, copy/save/issue, copy-failure
  words, the blank issue page, never failing for lack of a fact.
- `acpProblemReport.test.ts` (5) — the `/report problem` description, no
  port left to the engine, the draft text, a failed build naming its
  reason (a real ENOENT), a cancelled turn keeping the fixed sentence.
- `reportTimeout.test.ts` (3) — the race won, the `TimeoutError` word,
  throw passthrough and the reason mapping.
- `reportProblemRebuild.test.ts` (1) — a refused rebuild settles on the
  previous draft, marked, and the next edit retries unmarked (the refusal
  is a failing vault-scrub call through the real builder).
- `reportContext.test.ts` (4) — all ten panel states, the hint predicate
  (never guesses).
- `problemReportDetails.test.ts` (5) — contributor mode unknown; the cap
  never called skipped; caller-counted drops; uncarried records said aloud.
- `reportProblem.test.ts` (55) — the export paths and the event-kind pin
  with the five new kinds.

Result on this rig (MacBook, repo default timeouts, 2026-10-24): the
report suites above pass, 134 tests in 10 files (handler 28, command 24,
fallback 7, ACP problem report 5, timeout 3, rebuild 1, context 4, details
5, reportProblem 55, failure reasons 2 kept from source 03). The link-refusal
case, which needs a symlink privilege the Windows account lacked, runs and
passes here.

### Red drills (this tree; each restored byte-exact, hash before = after)

Drill script: break the named line, run the named command, restore from a
copy, rerun. Every red exits 1, every green exits 0, and the file's
sha256 prefix before and after matches.

| File (sha256 prefix)                 | Break                                                | Red (exit 1)                                                            | Green |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- | ----- |
| `reportFallback.ts` (`33657d081a76`) | the pick's title back to the dialog's title          | `offers copy, save and the issue page…` fails (1 of 7)                  | 0     |
| `reportTimeout.ts` (`d3c42a829a2e`)  | `readBounded` rethrows instead of falling back       | the three unknown-facts, journal and reporter cases fail (3)            | 0     |
| `acp/reports.ts` (`2d0ee19e94b8`)    | a failed problem report answers the fixed sentence   | `names the reason a failed build gives` fails (1 of 5)                  | 0     |
| `reportCommand.ts` (`85762bb00190`)  | the vault scrub not passed to the builder            | `runs the vault scrub over the sealed draft…` fails (1 of 24)           | 0     |
| `reportFallback.ts` (`33657d081a76`) | a bare `catch {}` in the blank-issue path            | `check:catches` exit 1 (a new SWALLOW site)                             | 0     |
| `authService.ts` (`fdf279ef1d5d`)    | `isValidModelApiKey` imported from `credentialStore` | `npm run cycles` exit 1 (`credentialStore -> authEntry -> authService`) | 0     |

The branch's own drills (`reportTimeout`, handler facts fallback,
`reportFailed` post, issue-link fallback) were not rerun on this rig; the
suites they pinned pass.

## Scenes for the reviewer (not run here — no browser on this rig)

- `test/harness/index.html`: `report` scene carries the four new fact
  lines, and a new `report-connect` scene (the hint, its two actions,
  every export available on the empty description).
- `scripts/lib/harnessServer.mjs`: `report-connect` added to `SCENARIOS`
  (axe runs it; no visual baseline touched).
- The lead's `npm run test:a11y` run covers `report`, `report-narrow` and
  `report-connect` in all four themes; the `report*` visual baselines need
  a reviewed update (the dialog now renders the prompt list and the hint)
  — manifest and PNGs untouched here.

## Not run here

Browser suites (`test:a11y`, harness shots/screenshots),
`test:integration`, the production visual baseline review, and installed
editor/remote/ACP-host runs. The vault suites stay off this machine until
RLVAULTANCHOR lands. No live or paid model call was made.
