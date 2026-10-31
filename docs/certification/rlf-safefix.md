# RLF-SAFEFIX — three small safety fixes (2026-10-30)

Recovery lane on the `macmini` rig, worktree `/Users/randy/lanes/RLF-SAFEFIX`
(branch `rec/rlf-safefix`). Base is `int/recovery` at `b781451b94`. No paid
call and no Muse model turn anywhere in this lane: every live check below is
a zero-call step (list models, open a session, refuse before the prompt).

Commits:

- `3115599b1` — item 3, the watchdog's acknowledgement.
- `5a9fc25bf` — item 2, the bounded deferred-event retry (plus the close
  ordering it exposed and the paid-consent key narrowing the new plural
  entry required).
- `7fe5ca140` — item 1, the contributor guard in live helpers.
- (this record, the PLAN.md status line and the lint/deadcode follow-ups
  land in the closing commit below.)

## Item 1 — nested sessions never select a non-contributor model

RLF-MACLIVE's live Neovim test sent one request on Muse's default
`muse-wonder-1.0` because its tap omitted `--allow-contributor-models`, so
the contributor model was not listed and the client fell back (record:
`rlf-maclive.md` on `rec/rlf-maclive`, "Wrong-tier run"). The lane tripwire
only watches a lane's own session, not sessions a test starts.

`test/e2e/liveCli.ts` now resolves the run's model and refuses before any
prompt: `liveContributorModelId()` reads `MUSE_LIVE_MODEL` (defaulting to
the `muse-spark-1.3-contributor` constant) and refuses anything not ending
in `-contributor`, in words; `assertLiveContributorModel(modelId, offered)`
refuses a non-contributor id and refuses when the offered list does not
include it, naming `--allow-contributor-models`; `liveGuardedModelId(host)`
does both against `host.listModels()` in one await the drills share. The
default stays so existing `MUSE_LIVE_E2E=1` runs keep working; the default
is itself contributor-tier and suffix-checked, so it cannot fall back.

Wired into every live helper that opens a Muse session with model turns:

- `test/e2e/live.e2e.test.ts` (both drills) and
  `test/e2e/reviewer.live.e2e.test.ts`: `liveGuardedModelId(host)` after
  `ensureHost`, before `startSession`. The reviewer hold reuses the
  guarded id.
- `test/e2e/team.live.e2e.test.ts`: the worker agent takes
  `liveContributorModelId()`, and `sendPrompt` asserts the spawn model
  against `muse model-profile show` (the CLI's free local resolution, no
  model call) before spawning; the existing probe delegates to the same
  check.
- `test/e2e/vim.live.e2e.test.ts` + `test/hosts/vim-live-driver.vim`: the
  run resolves the expected model before Vim spawns, passes it as
  `VIMLIVE_MODEL`, and the driver switches to it (refused unless listed),
  checks the contributor header, and quits before any prompt otherwise;
  the transcript assertions compare against the run's model.

Already compliant, verified by reading, no change:

- `scripts/real-life/lib/person.mjs` + `routes.mjs`: the `meta` route pins
  `muse-spark-1.3-contributor`, the read-back refuses any other named
  model, and session start/set-model refuse anything but the route model;
  the `museCode` route is refused entirely.
- The Vim driver's pre-prompt refusal above predates this lane except for
  the parameterization.
- `sessionModes.live` runs on the echo provider (no model turn, no tier);
  `tab`/`eval`/`judgeLocal` drills bill the Model API key or local models,
  not Muse sessions; `nodeSandbox`/`nodeWorkspace` open no sessions.
- Neovim/Emacs/Zed taps live only in the RLF-MACLIVE lane; nothing for
  them is committed in this tree, so there is nothing to guard here.

Real-code test `test/e2e/contributorGuard.e2e.test.ts` (runs in CI, opens
no session, sends no prompt): the contributor id passes when listed;
refuses with the flag named when the RLF-MACLIVE wrong-tier list
(`muse-wonder-1.0`, recorded, plus the base constant) omits it, and when
nothing is offered; refuses non-contributor ids even when listed; the
resolver defaults, overrides, and refuses a bad `MUSE_LIVE_MODEL`.

Red/green drill: with `test/e2e/liveCli.ts` restored to `HEAD` (no
guard), the new test fails 4/4 (`assertLiveContributorModel is not a
function` — the old helper cannot refuse, so the drill would proceed to
send, as RLF-MACLIVE proved live). With the guard, 4/4 pass in ~10 ms.

Zero-call evidence (no prompt anywhere): a temporary in-process probe
through the real backend and the real CLI listed 8 models including all
four `-contributor` ids (`muse-spark-1.3-contributor` among them) and
opened a session on it (id issued, no turn sent). The packed agent
(`dist/muse-spark-code-acp-0.19.0-darwin-arm64.tgz`, built per-target
after building the two sanctioned darwin helpers) installs and serves,
but its ACP `session/new` fails with the redacted internal error in
untouched adoption code — no client request is involved (logged), it
fails identically outside the worktree, and this lane's diff touches no
ACP/session code, so it was left for its owning lane; the without-flag
half stays proved by the recorded RLF-MACLIVE run plus the three-line
`allowsContributorModels` filter in `openHost`. The Vim driver
expressions (`execute` with the env model, the escaped wait pattern, the
header prefix check) were verified headless in real Vim against stubs:
contributor accepted, `muse-wonder-1.0` refused both ways.

## Item 2 — a bounded retry for failed deferred schedule events

RVINT5 P3: `scanDeferred` requeued a failed event forever with no
sentence. Under D121 as the owner clarified it on 2026-10-23, a retry
after failure keeps an industry-standard limit: capped exponential
backoff, wait = min(cap, base · 2^failures) (AWS Architecture Blog,
"Exponential Backoff And Jitter"), at most 5 fire attempts including the
first (gRPC's MaxRetryAttempts default), then it stops and reports the
give-up sentence. The base is one poll interval
(`SCHEDULE_POLL_INTERVAL_MS`: a shorter wait could never fire sooner);
the cap is eight intervals. The schedules settings carry no retry knobs
(only `schedules`, `defaultDelivery`, `agentCreation`,
`pauseAfterFailures`), so no setting tunes this. Rows written before the
bound carry no count and read as a first attempt. The sentence is
`scheduleV2.messages.deferredEventGaveUp` (`forms` one/other, read with
`plural`) in English plus all 14 tables; the host record gets every
failure and the sentence. A settled failure (delivery returned, no
throw) is consumed, not retried — only a throw retries.

Real-code test `test/unit/scheduleDeferredRetry.test.ts`: the real
engine over the real store on a real filesystem with a controlled clock.
The failure is a corrupted workspace index snapshot (the journal's own
`scheduleStoredJsonInvalid`) written through the real fs port, so every
fire throws while loading, before any hold or dispatch. One engine
serves both cases from two workspaces: five attempts with the exact
60/120/240/480 s waits then the drop and the sentence naming the
schedule and "failed 5 times" (6 reports), and a persisted `failures: 4`
row resuming to the drop with the same sentence (2 reports).

Red/green drill: with `src/runtime/schedules/engine.ts` restored to
`HEAD`, the new test fails 2/2 (`expected 2 to be 3` — the old code
never counts, so it never stops). With the bound, 2/2 pass.

Found proving it: `ScheduleRuntime.close()` reconciled the background
entry after the engine close had aborted its signal, so the consent
store (bound to that signal) threw `AbortError` on every close — shown
by a minimal create/hold/close repro, fixed by reconciling before the
engine close (the close still runs when the re-arm fails), and covered
going forward by every retry run's `afterAll` close. Also required: the
new plural entry widened `UI_TEXT.scheduleV2.messages[key]` to
`string | PluralForms`, breaking three `new Error(messages[failure])`
sites; `scheduleConsentFailure` and `refusal` now return the literal key
unions they actually return (types only, no behaviour change).

## Item 3 — the watchdog's acknowledgement

A reporter quoting the ack marker was not counted as answering:
`isWatchdogPost` matched the marker anywhere, so a quote counted as the
bot's own post (and was even adopted as the ack). The matcher now reads
only unquoted lines (GitHub's quote-reply prefixes each with `>`); the
bot's own unquoted marker still never counts as a reply.

Real-code test `test/unit/watchdogQuotedAck.test.ts`: recorded bodies
(`test/fixtures/m115w/github-issues`, issue 3 and its comment, captured
2026-10-24) with the watchdog's own real composer output quoted
GitHub-style; no GitHub stand-in. Quoted marker → answer; the bot's own
post under the same login → never an answer; quoted marker → ack still
owed (`post`), unquoted → adopted.

Red/green drill: before the fix, 2/3 fail (the quoted reply is not an
answer, the quote is adopted); after, 3/3 pass. The existing watchdog
suites still pass 28/28
(`watchdogCaptures`, `watchdogContracts`, `watchdogSurface`).

## Gates

(Exit codes from the closing pass on this rig; the two `*_TIMEOUT`
notes are rig load, measured below, not failures of the change.)

- prettier --check on touched files: 0.
- eslint --max-warnings 0 on touched files: 0.
- `npm run typecheck` (all six projects): 0.
- `node scripts/check-l10n.mjs`: 0 (14 UI + 14 usage, 0 problems).
- `npm run check:reference`: 0. `npm run check:host-api`: 0.
- `npm run check:plan`: 0. `npm run check:roadmap`: 0.
- `npm run check:catches`: 0 (runtime SWALLOW 30 → 29; baseline
  regenerated in the item-2 commit; no rise anywhere).
- `npm run duplication`: 0 (three clones of mine found and hoisted away
  during this lane).
- `npm run cycles`: 0. `npm run deadcode`: 0 (one knip duplicate-export
  of mine fixed by using the poll interval directly).
- `npm run build`: 0, every budget holds.
- `test/unit/watchdogQuotedAck.test.ts`: 3/3. `test/unit/watchdog*.test.ts`
  (captures, contracts, surface): 28/28.
- `test/unit/scheduleDeferredRetry.test.ts`: 2/2.
- `test/e2e/contributorGuard.e2e.test.ts`: 4/4. The five live Muse
  drills collect and skip without the opt-in (12 skipped, 0 errors).
- `npx vitest related` over `watchdog/ack.ts`, `schedules/engine.ts`,
  `schedules/runtime.ts`: the 4 related files green; the fifth,
  `test/unit/scheduleFireFailures.test.ts`, times out under this rig's
  load (see below) — it touches none of this lane's changed behaviour
  (only the untouched `scheduleFailedSettlement` export) and passes 8/8
  with time. `related` over `constants.ts`/`en.ts` is suite-scale (both
  are imported nearly everywhere) and did not finish in 20+ minutes on
  this loaded rig, so it was scoped to the direct consumers instead:
  `scheduleEventIntake`, `providerSpend` (the only direct
  `paidConsent` importer; that change is types-only) and `loadUiTable`
  pass 39/39. The `constants.ts` diff is purely additive (two new
  exports, verified by inspection of the diff) and `en.ts` adds one key
  covered by the l10n gate; hosted CI runs the full suite on merge.

Rig load during the closing pass: load averages 8–23 (other lanes'
batteries). Journal-heavy suites exceed the 5 s repo timeout here:
`scheduleFireFailures` (untouched by this lane) fails 4–6/8 at 5 s and
passes 8/8 at 60 s (3.7–8.8 s each); the neighbouring
`schedulePauseAfterFailures` (also untouched) likewise fails 3/5 at
5 s. This lane's own `scheduleDeferredRetry` was kept fast (shared
engine, minimal scans) and passes 2/2 at repo timeouts; its first case
takes ~1.1 s quiet, ~4.5 s at load 8.
