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

(Commits land here as they go.)

## Red/green drills

(Each: break on purpose, non-zero exit, restore, green.)

## Gates

(Exit codes on the final tree.)
