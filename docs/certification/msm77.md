# MSM77 — finish M77: Session board and best-of-N (D49)

Lane branch `ms/msm77`, worktree `/home/randy/lanes/MSM77`. This record
covers the finish lane; the C-M77-1 VS Code proof stays in
[docs/certification/m77.md](m77.md) and is not repeated here.

## 1. Base: most complete earlier work + current main

- Earlier work: `rigs/win11/c/m77-1` (tip `5b0f766ca`, 2026-10-10) is the
  lane's starting point; it is the only `cand/MSM77/*` branch, so nothing
  else had to be merged.
- Merged `main-now` (`3d30a7321`) as `5157409f7` with hooks on (gitleaks:
  no leaks found). Conflict resolution, by meaning:
  - `test/unit/bestOfNManager.test.ts`,
    `test/unit/bestOfNSnapshot.test.ts`,
    `test/unit/modelApiAttemptBudget.test.ts`: deleted on main by the
    test-overhaul lane, modified here. Main's deletions stay deleted
    (removed via `git rm`); the other M77 fake-suite deletions
    (`bestOfNAttempts`, `bestOfNRunner`, `sessionBoardHost`,
    `worktreeConversationHost`, `helpers/bestOfN`) merged cleanly.
  - `CHANGELOG.md`: kept this lane's `[Unreleased]` Added/Changed blocks;
    main's side was empty.
  - `ROADMAP.md`: generated file; took main's copy, regenerated at lane
    end (`npm run roadmap:generate`).
  - `PLAN.md`: auto-merged. No D-number added by this branch collides
    with main's, so no D140+ renumbering was needed.
- No `@unwired M77` tag exists on the merged tree: nothing was left
  built-but-unconnected for M77.

## 2. What was already connected (verified on the merged tree)

- Board: header board button → `SessionBoardDialog` (lazy, `App.tsx:264`),
  both backends, keyboard/focus behaviour; 13 M77 tests pass
  (`bestOfN`, `sessionBoard`, dialogs, `worktreeConversations`).
- Best-of-N: `Best of N…` action → `BestOfNDialog` (lazy, `App.tsx:224`),
  Model API only, one D48 popup, ceiling admission, immutable
  `add`/`write-tree` capture, ordinary `git apply --index` take, no
  commit. Setting `museSpark.modelApiBestOfN`, Help reference
  (`session-board`, `best-of-n` in `featureCatalog.ts`), README
  §"Session board and best-of-N".

## 3. C-M77-2: taken-attempt spend folded into the parent's view

PLAN's hold: "Attempt costs remain their own reported row until actually
folded into a parent." The fold, as built: every attempt keeps its own
reported spend on the run; the side-by-side comparison shows it; the
take notice in the originating conversation names it. The window tally's
aggregate best-of-N row is unchanged, so nothing is counted twice.

- `src/shared/bestOfN.ts`: `bestOfNAttemptSchema` gains optional
  `reportedInputTokens`, `reportedOutputTokens`, `reportedCostUsd`
  (exact-decimal, provider-reported only) and `hasUnreportedCost`. They
  ride the existing `bestOfNUpdate` message (`protocol.ts:1042`)
  unchanged; absent until the first delta, never an invented zero.
- `src/core/bestOfN/attemptUsage.ts` (new, pure):
  `accumulateAttemptUsage(previous, modelId, usage)` sums validated
  per-response deltas with the tally's refusal contract (unpriced model
  without a reported cost; non-integer/negative/cached-greater-than-input
  counts). Cost sums reported receipts only; a delta without one marks
  the total partial.
- `src/core/bestOfN/bestOfNRunner.ts:467`: the run's `noteUsage` folds
  each delta into `entry.attempt` and publishes, then forwards to the
  window tally as before.
- `src/webview/components/BestOfNDialog.tsx:106` (`attemptMeta`): each
  attempt line shows reported tokens (`agentTokens`) and, when the
  provider reported one, the reported cost — `bestOfNAttemptCost`, or
  `bestOfNAttemptCostPartial` (`{cost} reported, more pending`) when
  some responses are still missing a receipt.
- `src/host/conversation/conversationController.ts:4676`: the take
  notice names the taken attempt's reported use (`bestOfNTakenSpend`)
  and, only for a complete reported cost, its spend
  (`bestOfNTakenSpendCost`); otherwise the original `bestOfNTaken`.
- Text: 4 keys in `src/shared/l10n/en.ts:4623,4647`, translated in all
  14 `l10n/ui.*.json` at the identical index (verified: 2368, 2369,
  2390, 2391 in every table). `npm run check:l10n`: 0 problems.
- Test: `test/unit/bestOfNAttemptUsage.test.ts` — pure accumulation
  through the real module with values as data (sums, partial marking,
  unpriced-model refusal, invalid-count refusal). 4/4 pass, repo
  default timeout.
- Red drill: removed the unpriced-model throw from `attemptUsage.ts`;
  the named check `refuses an unpriced model without a reported cost`
  failed (1 failed, 3 passed); restored byte-exact (SHA-256
  `4efabcee921d9803fff35fb75889bdb92a9ad659be15a3d3ab4d976102883193`
  before and after).

## 4. C-M77-3: every editor (mapping + what runs where)

- VS Code and VS Code-compatible editors (VSCodium, code-server, Theia;
  `test/hosts/run-*.sh`): the same extension panel — header board
  button and Best of N… — no separate binding to build.
- ACP editors (Neovim, Emacs, Zed and other ACP clients): the board's
  binding is the protocol the agent already speaks —
  `session/list` (id, folder, title, last activity), `session/resume`,
  `session/close` (`src/acp/agent.ts:2700`). Verified against the
  packed product without a model (see §6). Best-of-N is not offered
  there: it needs the interactive D48 paid popup, a trusted workspace
  with git worktrees, and the window tally — the ACP paid-flag set
  (`ACP_PAID_FEATURES`: autoCompaction, webSearch, imageGeneration)
  has no best-of-N flag, and adding one means wiring the runner's host,
  consent and client notifications, which cannot be proven without a
  live model call. No stub was added; the seam is named here.
- Native plugins (JetBrains, Visual Studio, Eclipse, Xcode, Sublime):
  no host to bind to until M60–M66 lands; they get the shared webview
  panel through their bridges, recorded here and in PLAN §3.
- Headless/terminal (`exec`, one-turn): best-of-N does not fit a
  one-turn run; not offered, same reason as above.

## 5. C-M77-4: qualification

- Linux rig receipts are in §6. Windows/macOS hosted runs, the
  three-OS CI matrix and independent Grok review stay lead-run; this
  lane made no live or paid model call.
- Muse Code scope ruling (due here): best-of-N stays Model API-only
  (D49). Each attempt is billed per HTTP request to the key with a
  pre-admitted ceiling; no captured native HTTP-attempt admission
  contract exists, so no native equivalent is offered.

## 6. Gates and product proof (Linux rig `linuxlt`)

(TBD — final runs recorded here before the lane ends.)

## 7. Real-life steps for the lead

1. Open a trusted folder on the Model API backend with a stored key.
   Press the header board button: every open conversation lists state,
   branch, changed files and waiting approvals, running first; type to
   filter, Up/Down keeps focus in search, Enter resumes on its backend.
2. Run Best of N… on a prompt with 2 attempts: one paid popup names
   the prompt, published rates, attempt count and per-attempt ceiling.
   As attempts report, the comparison shows each side's requests,
   reported tokens and reported cost (`more pending` while receipts
   are missing). Take one: the checkout gains the exact selected
   snapshot staged, no commit; the conversation notice names the
   taken attempt's reported use and complete reported cost.
3. Account & usage still lists the aggregate best-of-N row with its
   estimated cost; unknown requests stay unknown, never zero.
4. In an ACP editor with the packed agent: `session/list` shows saved
   sessions with folder, title and last activity; resume/close work.
   No best-of-N command is offered.
