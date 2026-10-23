# RLF-ACPTURNS certification — honest notices, quiet accounting, a Retry action

Lane RLF-ACPTURNS, recovery release. Worktree
`/Users/randy/lanes/RLF-ACPTURNS`, branch `rec/rlf-acpturns`, from
int/recovery at `397aca3dd` (main 0.19.0 plus 15 lanes). Rig `macmini`.
Built 2026-10-22.

Expected call count, stated first: at most 4 model requests per editor,
all on `muse-spark-1.3-contributor` by its explicit name. Spent: 1 in
Neovim, 2 in Emacs, 1 direct-ACP capture turn, 0 in the smoke and the two
SIGKILL captures — 4 model calls total, every one counted below. No other
paid or live call anywhere in this lane.

## What landed

| Fix                                                                | Commit      | Shape                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1: one-shot notices go out as their own message                   | `5d2fed48b` | The notice fallback `agent_message_chunk` carries a fresh `messageId` (`noticeMessageId()`, `src/acp/translate.ts`); the same id rides `accountNoticeUpdate`, `sandboxCannotStartUpdate` (`src/acp/agent.ts`) and `acpResourceUpdates` (`src/acp/resources.ts`).                                                                   |
| Retry: a Retry action for retryable failed turns                   | `8dd92e44f` | `retryable` on `turnCompleted` (`src/shared/agentEvents.ts`); CLI mapping (`mapNotification.ts`, auth counts as not retryable); Model API predicate (`modelApiFailureRetryable`); panel remembers plain sends, arms on failed+retryable, resubmits as a new turn; ACP prompt errors carry `data.retryable`. No automatic resubmit. |
| Retry: a dead host's turn offers Retry where resubmission can work | `fed23ec3f` | The panel keeps remembered turns across a non-persistent host exit, arms the dead turn, and the resubmit re-establishes the dropped session; a persistent exit offers no Retry. ACP host death says `retryable: false` (the session is released with its host). Found by the live SIGKILL capture below.                           |
| F2: quiet accounting on the Muse Code backend                      | no change   | Verified, not built: this base has no usage-accounting warning to remove (below).                                                                                                                                                                                                                                                  |

`docs/acp.md` documents the two protocol facts for client authors
(`data.retryable`, notice message ids); CHANGELOG carries the Retry
addition and the notice fix.

## Retry semantics, as shipped

- The producer judges. The CLI backend reads the turn error's own
  `retryable`, defaulting `authRequired` to false; the Model API backend
  judges durable state (overflow, plan limit, ledger, session budget,
  auth) not retryable and per-attempt failures retryable.
- The panel remembers only plain composer sends (bound 8, steers and
  briefs excluded), arms only failed+retryable turns, and resubmits the
  remembered parts as a new turn, keeping all the failed turn's work.
  The composer draft is untouched; the button disables while a turn runs.
- A host death is judged by exit kind. Non-persistent (restarts on
  send, same conversation resumes): the dead turn arms Retry and the
  resubmit re-establishes the session. Persistent (refuses to run):
  no Retry; the sign-in gate speaks.
- Through ACP the judgment rides the prompt error's `data.retryable`.
  A dead backend says false: its session is released with it, so
  resubmission into that session cannot work.
- Absent judgment never reads as retryable (`=== true` everywhere).
- No automatic resubmit anywhere (owner decision B3 stays open).

## Proof: real conversations in installed editors

The packed agent is
`dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz` built from this tree
(the second packaging, after `fed23ec3f`, for the SIGKILL re-run) and
installed into a sandbox prefix. The rig's real Muse Code sign-in is
read by the product itself (`XDG_CONFIG_HOME` pointed at the real
config home; sessions, journals and logs stay in the sandbox); no
credential value was read, printed or stored by this lane.

### Neovim 0.12.5 with CodeCompanion (commit 8611841)

Headless driver: `muse_spark` ACP adapter (wrapper command,
`auth_method = "muse-code-login"`,
`session_config_options.model = "muse-spark-1.3-contributor"`), one
auto-submitted chat. Transcript (`$TMPDIR/rlf-nvim-transcript.json`):

- user: "What is the capital of Australia? Reply in one short sentence,
  no tools needed."
- llm: "The capital of Australia is Canberra." then, after a blank
  line, "The turn finished its visible work; background checks are
  still running."

CodeCompanion groups chunks into one chat message regardless of id, so
the notice stands as its own paragraph there (the designed shape for
that client); clients that group by message id start a new message
(see the Emacs wire tap). The product's own usage journal
(`usage/v1/days/2026-10-22`, client `CodeCompanion.nvim`): exactly 1
turn on `muse-spark-1.3-contributor`, session
`01a16656-d540-73b3-9531-696a8ba1c63e`, input 25528 / output 72
tokens. 1 request, within the allowance of 4.

### Emacs 31.1 with agent-shell 0.88.3 (acp.el 0.18.2, shell-maker 0.98.2)

Emacs is not installed on the rig, so the universal
`Emacs-31.1-universal.dmg` from emacsformacosx.com was installed into
the sandbox (as RLACP did). Batch driver: agent-shell config per
`docs/acp.md` plus `:needs-authentication`,
`:authenticate-request-maker` with method `muse-code-login`, and
`:default-model-id` returning `muse-spark-1.3-contributor`. The first
run's tap wrapper closed the client's stderr pipe (a spurious "stderr
finished" notice); the second run's tap keeps the pipe flowing and the
artifact is gone. Transcript (`$TMPDIR/rlf-emacs-transcript.txt`, the
wire tap beside it in `$TMPDIR/emacs-tap/`):

- sign-in confirmed by the CLI: "Muse Code sign-in confirmed by
  account/read: accountLogin (signedIn)"; `muse serve` spawned with
  `--contributor-mode on`.
- model set to `muse-spark-1.3-contributor` (confirmed on the wire).
- user: the same one-sentence capital prompt as Neovim.
- answer: "The capital of Australia is Canberra." then, after a blank
  line, the turn-finished notice — rendered apart from the answer.
- wire: the answer chunks carry no message id; the notice chunk
  carries its own (`"messageId":"50bea15a-…"`), then `stopReason:
end_turn`. This is F1 on the wire.

Journal (client `agent-shell`): exactly 2 turns, both on
`muse-spark-1.3-contributor` (sessions `01a16669-…` and `01a16670-…`).
2 requests, within the allowance of 4. The agent's stderr holds 13
lines, 4 routine warns (account-host stderr, redacted `muse serve`
stderr, sandbox unavailable, approval mode), zero usage or accounting
warns (F2).

## Proof: the retryable data on the wire

A direct-ACP script (no editor): initialize, authenticate with
`muse-code-login`, `session/new`, set the contributor model, send one
prompt, SIGKILL the `muse serve` backend mid-turn (found by
parentage — `muse` is a script that execs its binary, so command-text
matching finds nothing).

- Against the first packaging (`8dd92e44f`): the prompt error was
  `Internal error: Muse Code was stopped by SIGKILL` with no `data`
  at all — the hole: host death carried no judgment anywhere. 0 model
  calls (the backend died before any usage row).
- Against the second packaging (`fed23ec3f`): the same kill yields
  the same message with `"data": {"retryable": false}`. 0 model
  calls. Live red-to-green for the ACP half of the Retry fix.

A first capture attempt killed nothing (the `pgrep -f` lesson above)
and the haiku it sent answered normally: 1 call on the contributor
model, journal row `rlf-acpturns-capture`, session `01a16676-…`. The
zero-call smoke (initialize, authenticate, `session/new`) passed the
same way. `session/delete` on the Muse Code backend answers
honestly that Muse Code 1.4.11 cannot delete conversations (finding,
not this lane).

## F2: quiet accounting, verified

- The string "ACP usage accounting is unavailable" (and every
  `usage accounting|accounting.*unavailable` match) is absent from
  this base: RLACP's warning lived in code (`hasLoggedUsageFailure`,
  `createAcpAccounting`) that is not an ancestor of this tree.
  Staying silent needed no change.
- RLUSAGE's branch, which the brief names, does not exist in this
  clone (no `RLUSAGE` branch, lane dir, or usage/exec lane branch
  besides finished provider-usage work): nothing to reconcile.
- Every live agent stderr on the Muse Code backend (smoke, Neovim,
  Emacs ×2, captures ×3) scans silent for usage/accounting warns,
  while the journal records every turn (4 turn rows above).
- The F2 drill below proves the scan itself fires.

## Red/green drills

1. F1 translator: dropped `messageId` from the notice fallback,
   `acpTranslate.test.ts` fails 1; restored, 44 pass.
2. F2 scan: planted `[warn] ACP usage accounting is unavailable` in
   the Emacs agent stderr, the scan trips; removed, silent, SHA-256
   byte-identical before and after.
3. Retry memory: `rememberRetryableTurn` made to remember nothing,
   `turnRetryResubmit.test.ts` fails the resubmit case; restored, all
   pass.
4. Retry host-death restore: the `hostExited` restore loop made to
   restore nothing, both host-death resubmit cases fail; restored,
   all pass.
5. Live ACP data: the SIGKILL capture above — dataless error before
   `fed23ec3f`, `data.retryable: false` after, same kill, 0 calls
   each way.

## Gates (final tree, exit codes)

| Gate                                              | Exit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc` main + webview                              | 0, 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `eslint --max-warnings 0` all 29 lane files       | 0 (one targeted `no-unnecessary-condition` disable in `retryTurn`, PLAN.md §8 row: the live turn check crosses the session-establishment await)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `prettier --check` lane files                     | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/check-l10n.mjs`                     | 0 (0 problems)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:reference`                         | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run check:catches`                           | 0 (baseline already regenerated in `8dd92e44f`; this lane adds no catch)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run check:host-api`                          | 0 after `--write` (one count: `node:crypto` 224 → 225, this lane's `randomUUID` for notice ids; diff reviewed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check:roadmap`                           | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run duplication`                             | 0 (0 clones)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run cycles`                                  | 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npx knip`                                        | 0 (hints only, pre-existing)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run security:audit`                          | 0 (4 advisories, 2 exceptions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run build`                                   | red, pre-existing: the same 3 bundles over budget on the base (`modelApi.js` 527.7 KiB vs 525; `resourceAdmission.js` and `vaultActions.js` exactly at 25.0). This lane adds 0.2 KiB to `modelApi.js`. Measured in a paired base worktree.                                                                                                                                                                                                                                                                                                                                                            |
| `npm run check:plan`                              | red, pre-existing: PLAN.md 3,668,951 bytes on the base vs the 3,565,158 budget (85%). This lane adds one §8 row (~500 bytes, required by rule 4). Archiving is the lead's integration work.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run package:acp -- --target darwin-x64`      | 0 twice (packager self-test green both times)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run security:sast`                           | blocked: semgrep crashes on `ca-certs: empty trust anchors` in this sandbox, exactly as in RLACP; the lead runs it outside                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `vitest related` (17 changed sources → 830 files) | triaged: 0 lane failures. 18 files red in the big run (47 tests); every one re-run alone and, where still red, against the untouched base in a paired worktree (identical failures: vault POSIX/keychain/socket/scope/build/compression (20 in batch 6 alone), `ps` live-reading races, schedule timing, exec-team sweep, connector guard, crash-marker pid reuse, tree sync/lifecycle, playbook contention). Green alone on this tree: `estimatorSnapshotStrict`, `teamModelsFirstPaint`, `schedulePauseAfterFailures` (timing-flaky both sides). No file this lane changed or added fails anywhere. |

## Findings for the lead (follow-ups, not this lane)

- `session/delete` on Muse Code answers that the CLI cannot delete
  conversations; the agent reports it honestly. Deletion support (or
  its documented absence) belongs to whoever owns the ACP/CLI seam.
- Journal turn rows read `outcome: incomplete` even for turns that
  ended `end_turn` (all 4 proof rows): the visible turn finished while
  background checks still ran. Settling those rows is accounting's
  work (RLUSAGE's area).
- The panel arms no Retry when the host closes the session idle
  (`sessionClosedByHost`): same transient shape as host death, but no
  recorded `closed` exchange exists on this backend to prove it with.
  One line when such a capture exists.
- The Emacs batch driver's `on-finished` never fires in `--batch`
  (both runs rendered the full answer and a fresh prompt anyway);
  the `<shell-maker-failed-command>` marker at the buffer top is
  shell-maker's own invisible marker, not a failure. Driver-side
  only; the product behaved correctly in both runs.
- CodeCompanion renders the notice as its own paragraph inside the
  model's chat block (it groups by turn, not by message id). Only an
  upstream change there could split it into its own block.
