# RLF-M88: M88 lane C — timed sends and resume after a limit (D67 items 15–16)

Lane RLF-M88, recovery release. Worktree `/Users/user/lanes/RLF-M88`,
branch `rec/rlf-m88`, rig `macbook`. Base: cc/int9 `5ec754534`.
No live model calls, no paid calls: the lane's only Muse requests are
its own session's.

## Scope verdict (2026-11-02, inventory)

M88 lanes 0, P, A, B and W for sequences and bookmarks are IN this
base, via `c7903a525` (merge of RLM88, `rec/rlm88`, into
int/recovery). Saved prompts are M118's (built). What was never
started is lane C: timed sends and resume after a limit. This lane
builds lane C only, on M115's store and delivery path (D95.12 absorbs
lane C: its one-shot cadence, Muse Code timed sends and Resume later
"become M115's, unattended"). Nothing here forks M115's store,
claim/journal or delivery binding.

## Delivery path per backend (no fork)

- Model API timed send: v2 `once` schedule (`scheduleTimeTriggerSchema`)
  in the v2 journal store → engine admission (`admitTiming`) →
  `createScheduleDeliveryBinding` → live Model API conversation
  (`findLive`) or background target → unattended run under the
  schedule's grant and paid consent. M115 owns every step; lane C adds
  only the timed-send entry rules (once lead, local-time whole-minute
  picker) and the Resume-later seed.
- Muse Code timed send: the same v2 path with
  `target.backend: 'museCode'`. D67's `storageUri/musecode-timed-sends`
  extension store is NOT built: it would fork the v2 store, which
  already holds museCode-targeted schedules and delivers them through
  the same binding. Lane C adds the D67 binding on this path (below)
  and the Resume-later seed.
- Consent: M115's per-schedule paid consent (asked once at creation,
  re-checked at every dispatch: changed model/key/cap/grant/consent/
  mode/revision refuses until renewed through a schedule edit)
  supersedes D67's one-shot D48 confirmation and M52's Run modal
  (D95.12 replaces both). A send is never a new way to spend money
  unseen: every Model API fire carries its schedule's consent, and a
  mismatch refuses before any request.
- Busy session: the person's delivery choice (`whenIdle` default) and
  the exactly-once claim/journal supersede D67's deferredSend-for-
  schedules and grace mechanics. Lane C builds no second deferral.
- Late sends: the person's `catchUp` choice (`runOnce` default)
  governs missed occurrences. D67's "nothing is ever sent late on its
  own" and `TIMED_SEND_GRACE_MS` are superseded: a late fire is the
  person's own catchUp choice under their schedule's consent.
  `TIMED_SEND_MAX_LEAD_MS` is not built either: its rationale (the v1
  seven-day job lifetime) is gone under v2's person-chosen end, and
  D121/D208 forbid it as an arbitrary cap of ours. The picker keeps
  D67's one-minute lead (`TIMED_SEND_MIN_LEAD_MS`) and whole minutes.

## D67 rules lane C builds

- Once entry: whole minutes, at the earliest a minute ahead, in local
  time; "Schedule This Prompt…" seeds the editor with the composer's
  text; `/schedule add` keeps its grammar.
- Muse Code binding WITHOUT the unproven signature: the credential
  file's structure (`credentialFileVerdict`) instead. A token refresh
  rewrites the file without changing the account, so relying on
  size/mtime (D67's primary) risks deleting the person's sends for no
  reason; the day-of-ordinary-use capture that would settle it is
  still open (unproven.md). Per D67's own fallback, only the
  sign-outs and sign-ins the host sees clear the workspace's Muse Code
  once-schedules, checked at start, at every museCode admission, and
  before the schedule surface lists; the transcript says why. While
  `META_API_KEY` is present in the window's environment (presence
  only, never the value), Muse Code offers no timed send: creation
  and admission refuse in words. No per-job account field is stored:
  with the structure binding there is no baseline to keep, so the v2
  schema is unchanged.
- Resume after a limit, offered as "Resume later…" on the failed
  turn's row, creating a v2 once schedule of the fixed English
  resume prompt in the same session:
  - Model API rate limit: new `rateLimited` error kind on
    `turnCompleted`, carrying the last Retry-After; default time is
    when it ends, else five minutes after the failure. Provider
    quota/balance refusals (PROVERR `credit`/`usageLimit`) stay
    ordinary failures with their own sentences, per D67 and D252.
  - Model API session budget: no timer; the row offers the budget
    setting (deep-linked) and Continue.
  - Muse Code spent window: D252's typed quota detail is the captured
    signal; the opt-in (`museCodeQuotaContinue`) waits until the
    reset and resubmits once, never before it. With the opt-in off,
    the row offers Resume later at the reset. No early resend: the
    once schedule fires at the reset, never before it.
  - Muse Code `usage_limited` goal without typed detail: the host
    reads usage after the signal; a window at 100 % gives the time
    (the offer says it rests on the usage report); otherwise no
    offer. Any other failure stays ordinary, even at 100 %.
  - Every default time is rounded up to the whole minute and never
    less than a minute ahead; a limit lifting more than six days out
    gets no timer and the row says when it lifts.
- The live transcript marks a scheduled send's user card, and a
  refused/missed once-send is said in the conversation (refusals are
  never silent), with M82's background notice while unfocused.

## Build log

Base cc/int9 `5ec754534`, branch `rec/rlf-m88`, ten commits, each
green on its own suites before landing (real code only; no live or
paid model call anywhere in the lane):

- `84f4cea78` C1: constants (`TIMED_SEND_MIN_LEAD_MS`,
  `RESUME_LIMIT_DEFAULT_DELAY_MS`, `RESUME_OFFER_MAX_LIFT_MS`,
  `RATE_LIMITED_ERROR_KIND`, `MODEL_API_BUDGET_ERROR_KIND`) and the
  `resumeOfferFor` fitter (`test/unit/resumeOffer.test.ts`, 5).
- `b7a575719` C2: limit signals on `turnCompleted` — the
  `rateLimited` error kind carrying the last Retry-After, and the
  `budget` kind for a spent session budget
  (`test/unit/modelApiLimitFailure.test.ts`, 3).
- `cce8841b4` C3: resume offers on failed turns' error entries, with
  the row strings in English and all 14 tables
  (`test/unit/turnResumeOffer.test.ts`, 6).
- `f26700e05` C4: host `continueTurn` and `resumeLater`, the seeded
  schedule editor and the budget-setting deep link
  (`test/unit/turnResumeHost.test.ts`, 8).
- `0ed2d22a0` C5: error-row buttons and the composer seed
  (`test/unit/turnResumeButtons.test.tsx`, 5;
  `test/unit/seedScheduleDraft.test.ts`, 3).
- `091e0f6d1` C6: the once picker in local time, whole minutes, with
  the one-minute lead and the too-soon refusal
  (`test/unit/scheduleOnceLead.test.tsx`, 4).
- `5c4db336c` C7: the sent-on-schedule mark on scheduled user cards
  (`test/unit/scheduledMark.test.tsx`, 2).
- `f31d58b78` C8: the Muse Code timed-send account binding on the v2
  path — `META_API_KEY` refusal, the credential-structure verdict,
  the sweep at start/list/admission, the branded dispatch refusal
  (`test/unit/museCodeBinding.test.ts`, 24;
  `test/unit/museCodeDispatchRefusal.test.ts`, 5).
- `0de8d8354` C9: once outcome notices — a refused, skipped or missed
  send is said by name with its reason in every live conversation,
  with M82's background notice while unfocused
  (`test/unit/onceOutcome.test.ts`, 7).
- `360f6b87b` C10: the `usage_limited` goal and the usage-read offer
  path — `usageForResume`/`resumeUsage`, a 100 % window fitting a
  report-based offer, anything else leaving the row ordinary
  (`test/unit/turnResumeUsage.test.ts`, 12;
  `test/unit/turnResumeUsageView.test.tsx`, 3).
- C11 (this change): the reference covers the three new host
  actions; PLAN.md §6 carries the lane's status;
  `docs/real-life/unproven.md` lists what the packed run still has
  to prove. No CHANGELOG or README line until that run. C11 also
  clears the two gates the lane tripped: the duplication gate (13
  clones: Retry/Continue share one host resubmit and one card
  resend; the suites share Transcript rows, turn ends, the schedule
  bridge and the engine teardown through `test/unit/helpers/`) and
  the wire budget (the lane's schemas put `dist/wire.js` 235 bytes
  over its 75 KiB cap: the rate-limit detail flattens to
  `retryAfterMs`, new ids stay plain strings, and wire shares
  scheduleProtocol, media and questions by name, dropping the four
  exports with no Node reader; `wireEntry.test.ts` pins the lists).
  The narrowing exposed one dead source type (`QuestionKey`, zero
  readers), deleted with its import. The real-engine binding suite
  carries the repo's named durable timeout, as its M115 siblings do.

87 lane tests in all, every one over real code. 16 new UI strings,
each in English and all 14 tables with the desktop tables
regenerated (`node scripts/check-l10n.mjs`: 0 problems). No new
command, setting or surface of the lane's own: the once editor is
M115's surface (lane C only seeds it), and
`museSpark.syncPromptsAndBookmarks` arrived on another lane.

## Red/green drills

- C7 (2026-11-02, on the C7 tree): broke the scheduled mark at its
  real `card.scheduled` read; `scheduledMark` red, exit 1;
  restored; green, exit 0. (A first attempt broke the wrong
  identifiers and stayed green, exit 0 — redone on the real line.)
- C10 (2026-11-02, on the final tree): raised the usage-offer bar in
  `applyHostMessage` from `usedPercent < 100` to `< 101`, so a full
  window fits no offer. `npx vitest run
test/unit/turnResumeUsage.test.ts --maxWorkers=3` red: exit 1, 2
  failed (`offers a full window at its reset minute`, and the flip
  case that answers at 100 %), 10 passed. Restored; the C10 pair
  green: exit 0, 15 passed.

## Gates

Exit codes on the final tree (2026-11-02, rig `macbook`):

- `prettier --check` (every touched file): 0.
- `eslint --max-warnings 0` (every touched file): 0.
- `npm run typecheck`: 0.
- `node scripts/check-l10n.mjs`: 0 problems.
- `npm run check:reference`: 0.
- `npm run check:host-api`: 0 problems.
- `npm run check:plan`: 0 drift.
- `npm run check:roadmap`: current.
- `npm run check:catches`: baseline matches.
- `npm run duplication`: 0 clones.
- `npm run cycles`: none found.
- `npm run deadcode`: 0.
- `npm run build`: 0; `dist/wire.js` 76,669 bytes against the
  76,800-byte cap.
- Touched suites, each green at the repo's own timeouts: the 87
  lane tests (13 files), `turnRetryButton`, `turnRetryResubmit`,
  `scheduleDeferredRetry`, `wireEntry` (+3 pin cases),
  `questionContracts`, `mediaContracts`, `acpUpdateNotSent`.
- `vitest related` over the 8 changed sources: 4,228 passed, 44
  failed, all 44 proven pre-existing or environmental: the same
  files fail identically on base `5ec754534` (team git/process
  suites under the rig's broken Xcode git, the keychain suite with
  no keychain, storage-guard trust, the documented schedule
  flakes, one timing case green alone on both trees), and every
  lane suite passed inside the run. No live or paid call anywhere:
  the agent-start cases failed at git before any agent launched.
