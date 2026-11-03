# RLF-FIRSTRUN — first-run dead-ends leave evidence (RSCH-MUSE-G, #157)

Lane: RLF-FIRSTRUN (rig `linuxlt`, worktree `/home/randy/lanes/RLF-FIRSTRUN`,
branch `rec/rlf-firstrun`). Base `72d8d5003` (rv/int9). Date 2026-11-02.

## The gap

[muse-spark-code#157](https://github.com/RandyNorthrup/muse-spark-code/issues/157)
(0.18.2 on win32, filed 2026-10-14, still open): a person whose laptop had
shut down reached the not-installed screen ("i dont know what happened my
laptop got shutdown now i cannot add muse spark") and filed a report with
`cli: not found; signed in: no`, no key anywhere — and `Recent events (0):
none`. Nothing in the report said whether they ever pressed Install, whether
an install ran, or whether a sign-in was offered and abandoned.

#157 predates REPORTFLOW (landed 2026-10-24), which records the CLI probe,
the backend resolution and sign-in starts/ends. This lane verified what
current main records on that journey and closed what it does not.

## What each dead-end writes (all existing vocabulary, no new kinds/codes)

| Dead-end                                         | Fact                                                                                 | State before                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------- |
| CLI-not-found screen shown                       | `cliProbe`/`cliMissing` + `backendResolved`/`noneCliMissing` (via `choose()`)        | already recorded — verified |
| Sign-in offered (gate with methods)              | `backendResolved` (`noneCliMissing` → key offered; `noneCliSignedOut` → browser+key) | already recorded — verified |
| Install pressed                                  | forced `cliProbe`/`cliMissing` start row                                             | **added**                   |
| Install re-check timed out                       | forced `cliProbe`/`cliMissing` outcome row                                           | **added**                   |
| Install re-check never started (terminal failed) | forced `cliProbe`/`unknown` outcome row                                              | **added**                   |
| Key prompt dismissed                             | `signInFailed`/`cancelled` (browser-cancel precedent)                                | **added**                   |

How to read the next report: one start row plus one outcome row per install
attempt (user actions, not a loop, so the journal cannot crowd out). Shown
pair alone means never pressed Install; a start/outcome pair means tried.
An outcome row landing seconds after its start row means the installer
never started; one landing ~5 minutes after (the install timeout) still
missing means the re-check ran out. `cliProbe` rows feed no derivation
(`lastSignIn` reads only `signIn*`, `lastNotice` only `errorNotice`,
`backendResolution` only the static facts), so the forced rows cannot
corrupt the summary lines. D14/D72 unchanged: fixed codes only, no paths
(the CLI's reason text and the terminal failure never leave the host),
no free text. `problemReport.ts` needed no change: it already renders
`panel`, `backendResolution` and `lastSignIn` when facts exist.

The install-success path already leaves evidence through change: when the
CLI appears, `choose()` records the changed probe and resolution rows.

## Proof 1 — suites over the real recorder + builder (committed)

`test/unit/authFirstRunFacts.test.ts` (5 tests, real `AuthService` + real
`CliAccount` + real `CredentialStore` over temp files, real
`ReportRecorder` + real window journal on a temp dir, real
`enrichProblemReportFacts` + `buildProblemReportDraft`):

1. not-installed screen shows `noCli` with the `apiKey` offer and records
   the probe + resolution; the draft carries `panel: landingNoCli`,
   `backend resolution: noneCliMissing`, both event rows, and never the
   CLI's absence reason.
2. an install that times out leaves the start row and the timed-out
   re-check row: two `- 5m ago cliProbe cliMissing` rows (shown + start)
   plus the just-landed re-check row, `Recent events (4)`.
3. an installer that never starts records `cliProbe`/`unknown`, and the
   terminal failure text never reaches the draft.
4. a dismissed key prompt records `signInFailed`/`cancelled`; the draft
   reads `last sign-in: failed cancelled`.
5. a signed-out CLI resolves to the browser-and-key offer
   (`cliSignedOut` + `noneCliSignedOut`).

`test/unit/helpers/cliAccountBackendFacts.ts` holds the CliAccount wiring
both AuthService suites share (extracted to keep the 0-clone gate).

## Proof 2 — real extension host, CLI absent (throwaway, this rig)

Dev build, then stable VS Code under `xvfb-run` with a throwaway profile
(`temp/firstrun-profile`), `PATH` without `muse`, and `HOME`/`XDG_CONFIG_HOME`
in an empty throwaway dir (POSIX resolution also probes
`~/.local/bin/muse`). A throwaway integration test (deleted after the run):
activated the extension, focused the chat view (the install screen),
polled the profile's real journal, executed `museSpark.reportProblem`
(the command resolves once the draft posts; it never waits on the
person), and built the draft from the real journal entries with the real
builder. 3/3 passing, exit 0.

The journal held exactly (versions real: ext 0.19.0, host 1.144.1):

```json
[
  { "v": 1, "kind": "cliProbe", "code": "cliMissing", "frames": [] },
  { "v": 1, "kind": "backendResolved", "code": "noneCliMissing", "frames": [] }
]
```

and the draft carried the new facts:

```text
Problem report: Muse Spark 0.19.0 on linux
...
cli: not found; signed in: no
...
panel: landingNoCli
last notice: none
last sign-in: none
backend resolution: noneCliMissing

Recent events (2):
- 2s ago cliProbe cliMissing
- 1s ago backendResolved noneCliMissing
```

Not driven in the host (by judgment, documented): pressing Install would
run the real installer and mutate the shared rig; the key prompt needs a
person. Those paths are proved by the committed suite over the same real
`AuthService` code the host runs.

## Red/green drills (each restored byte-exact, `git diff` empty after)

1. Install-start record removed: suite exit 1, the 2 install tests fail,
   3 pass. Restored: green.
2. Re-check record removed from `installFailed`: suite exit 1, the same
   2 tests fail. Restored: green.
3. Dismiss record removed from the `apiKey` path: suite exit 1, exactly
   the dismiss test fails. Restored: green.

## Gates (final tree, exit codes)

| Gate                                                          | Exit                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier --check (touched files)                              | 0                                                                                                                                                    |
| eslint --max-warnings 0 (touched files)                       | 0                                                                                                                                                    |
| npm run typecheck (all projects)                              | 0                                                                                                                                                    |
| node scripts/check-l10n.mjs                                   | 0 (0 problems)                                                                                                                                       |
| npm run check:reference                                       | 0                                                                                                                                                    |
| npm run check:host-api                                        | 0 (0 problems)                                                                                                                                       |
| npm run check:plan                                            | 0 (251 milestones, 0 drift)                                                                                                                          |
| npm run check:roadmap                                         | 0 (251 entries, current)                                                                                                                             |
| npm run check:catches                                         | 0 (matches baseline)                                                                                                                                 |
| npm run duplication                                           | 0 (0 clones; one clone found and extracted mid-lane)                                                                                                 |
| npm run cycles                                                | 0                                                                                                                                                    |
| npm run deadcode                                              | 0                                                                                                                                                    |
| npm run build                                                 | 0 (budgets hold)                                                                                                                                     |
| authFirstRunFacts + authFastSignIn suites                     | 0 (9 passed)                                                                                                                                         |
| vitest related src/host/auth/authService.ts (128 files)       | 2 load-caused failures, measured unrelated (below); a prior run showed 1 failure under heavier load whose identity scrolled out of the captured tail |
| SAST (`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`) | 0                                                                                                                                                    |
| npm run security:audit                                        | 0                                                                                                                                                    |

Related-run failures (both files import nothing of AuthService at
runtime; the `related` link is type-only): `acpUpdateNotSent` (a
200-poll loop starved under 128-file load; passes alone) and
`noLimitsInput` "admits an image" (12 MiB PNG fixture vs the 5 s repo
timeout: 10.2 s in the parallel run, 6.1 s in a 2-file run, 5.03 s
single-file on this tree, then 3.5 s pass on the untouched base
worktree at HEAD and 4.0 s pass on re-run here — same code, load
variance only). Left to hosted CI; neither covers this change.

## Reply text for #157 (drafted for the owner, NOT posted)

> Thanks for the report — it showed us a real gap: when the CLI goes
> missing, the report carried no history at all, so we couldn't tell
> whether the install screen ever offered anything or an install had
> failed. That changes in the next release: the report now records the
> not-installed screen, pressing Install, the install's re-check
> running out or never starting, and dismissing the key prompt, each as
> one line in recent events.
>
> For your machine: since the shutdown removed the CLI, open the Muse
> Spark panel and press **Install** (it runs Meta's installer in the
> terminal), then **Check again**; or paste a Model API key if you have
> one. If Install fails, file the report again from the panel — this
> time it will say exactly where it stopped, and we'll take it from
> there.

## Open items

None for the lane. Posting the reply is the owner's.
