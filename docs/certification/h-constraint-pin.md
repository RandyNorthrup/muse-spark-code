# H-CONSTRAINT-PIN — verbatim constraint pinning across compaction (RLF-PINNED)

Date: 2026-11-02. Machine: linuxlt. Base: `72d8d5003` (rv/int9), branch
`rec/rlf-pinned`. H-EVAL-TASKS had not merged, so the four side-constraint
tasks were authored here, as the brief's fallback directs.

## What landed

- **Host-owned constraint block.** `src/core/backends/modelapi/constraintPins.ts`
  captures side constraints deterministically from user turns (queued and
  steered): an explicit `Constraints:` section and imperative
  must/never/always lines, outside fenced code, questions excluded; when
  in doubt it captures, and the person can unpin. Pins are session state
  beside `packedCallIds` (`pinnedConstraints` in
  `src/core/backends/modelapi/sessionStore.ts`), so resume, fork and
  rewind (which forks) keep them; a fork keeps only the pins its kept
  turns stated. Open todos keep riding the compaction snapshot as today.
- **Never summarised, re-sent verbatim.** The summariser's request input
  is built with the pinned item removed (`withoutPinnedConstraints` in
  `runCompaction.makeBody`), and at acceptance the block is rebuilt from
  session state as its own replay entry (turn id `pinned`) directly
  after the summary entry, so every post-compaction request re-sends it
  word for word. This is the faithful-compaction rule the brief points
  at (carry verbatim or drop, never a summary of a summary): the pin is
  never an input to a summary. The research file itself
  (`lanes/rsch-cc:docs/research/claude-code-2026-11-02.md`, R2) is not
  present on this rig; the rule as quoted in the brief is what was taken.
- **Budget accounting.** The pinned entry is ordinary replay: its bytes
  are in every post-compaction request body, so the session budget's
  request estimates and the provider's reported usage count them. In the
  auto-compaction economics its tokens are _retained_ context (the kept
  set in `maybeAutoCompact`), never part of what a compaction is
  credited with removing.
- **Visibility and Unpin.** The compaction item carries
  `pinnedConstraints` verbatim; its fallback text lists them under
  "Pinned across compaction:" for every surface, and the panel renders
  each pin with an Unpin button (`unpinConstraint` protocol message →
  `ConversationController.unpinConstraint` → `ModelApiSession.unpinConstraint`),
  which rebuilds the re-sent block and re-shows the card together. A
  backend without pins (Muse Code compacts in the CLI) says so instead
  of agreeing. All strings are in `src/shared/l10n/en.ts` plus the 14
  tables; `node scripts/check-l10n.mjs` reports 0 problems.
- **Dormant until evaluated.** Capture and re-send run only while
  `deps.constraintPinning` (tests, the eval arm) or
  `IS_CONSTRAINT_PINNING_EVALUATED` says so. The latch is **false**:
  like automatic compaction before its receipt, pinning ships built and
  tested, and turns on only with the live pair's passing receipt. No new
  cap of ours was added (D121); compaction spend stays under the
  existing D78 admission.

## Offline proof (real code only)

`test/unit/constraintPins.test.ts` (10 tests) over the real capture, the
real `ModelApiHost` and the real file session store:

- capture: section (bullet/numbered/inline), imperative lines, fenced
  code and questions excluded, a pin's inner spacing byte-for-byte;
- merge folds duplicates in stated order;
- the summariser-input filter removes exactly the pinned item and
  nothing else (a user message merely mentioning a pin stays);
- a real session: capture → snapshot → the host's own persist through
  the file store round-trips pins byte-for-byte;
- a rejected compaction (the host's NOOP with nothing to compact)
  leaves replay and pins untouched;
- unpin removes exactly one pin, reports false for a missing one;
- nothing captures while pinning is not armed;
- a stored accepted-compaction layout (summary entry, pinned entry,
  tail) parses and resumes byte-for-byte, and unpinning rebuilds — then
  removes — the very replay entry the next request re-sends.
- a fork through the real host's `forkSession`: a rewind to an earlier
  turn drops the pin only a later turn stated, a whole fork keeps every
  pin, and a fork of a compacted session keeps the pins the copied
  pinned block carries — including a section-only pin (no
  must/never/always) whose stating turn the summary replaced — with the
  block byte-for-byte and the fork's compaction card showing them.

An accepted live compaction cannot be driven offline without inventing
a provider answer, which this repository forbids; the acceptance splice
itself is the same `pinnedConstraintsItem` builder these tests cover,
and the live pair below is its end-to-end proof.

## Red/green drill

Break: `withoutPinnedConstraints` made a no-op, so the pinned block
rides into the summariser's input.

```
npx vitest run test/unit/constraintPins.test.ts --maxWorkers=3 -t "takes the pinned block out"
→ 1 failed (8 skipped) — the filter test fails as designed.
```

Restore: `git checkout HEAD -- src/core/backends/modelapi/constraintPins.ts`
(byte-exact, no diff), same command → 1 passed.

Second drill (Claude Code resume, 2026-11-02): the fork path first
re-read pins out of the copied pinned block's text, which dropped a pin
only a `Constraints:` section made one (its turn was summarised away).
The fork test above was written against that code and failed
(`expected [ 'Never use var anywhere' ] to deeply equal [ 'Use tabs for
indentation', …(1) ]`); the fix keeps every pin the copied block
carries. Break: the line `if (entry.turnId === PINNED_TURN_ID) return
this.pinnedConstraints` deleted from `copyInto` →
`npx vitest run test/unit/constraintPins.test.ts --maxWorkers=3 -t "a fork keeps"`
exit 1 (1 failed, the same assertion). Restore: the saved copy put back
(`cmp` byte-exact) → same command exit 0 (1 passed).

## Live evaluation — not run on this rig (outside item)

The frozen pair is built: `auto-compaction` vs `auto-compaction-pinned`
(`PINNED_EVAL_ARMS`, differing by pinning alone, same harness window) on
the four side-constraint tasks plus `accept-long-compaction` and
`heldout-long-compaction`, with the constraint-kept rate in every split
summary. Offline, `test/unit/eval/evalPinnedArms.test.ts` proves the
pair's frozen options differ by pinning alone and that capture reads
exactly one pin out of each side-constraint prompt; the task verifiers
fail their planted defects and pass two spellings of each fix
(`test/unit/eval/evalTasks.test.ts`).

The counted live run did **not** run here: this rig's operating-system
credential store holds no Model API key (presence probed through the
product's own `CredentialStore`, value never read: `present=false`,
also with the user D-Bus address set). The key is the owner's to store
(`muse-spark-code-acp auth set`); no request of unknown tier was sent.

Run, when a key is stored (stated first, per the brief): 6 tasks × 2
arms, worst case 168 attempts + ≤12 summary attempts = **180**,
expected ~90 (~$0.03 at the frozen plan's measured average), model
`muse-spark-1.3-contributor` only:

```
node scripts/m101-e.mjs --plan
TMPDIR=$PWD/temp MUSE_LIVE_PINNED_EVAL=1 MUSE_EVAL_MAX_ATTEMPTS=180 \
  MUSE_EVAL_REPORT=$PWD/temp/h-constraint-pin-report \
  npx vitest run test/e2e/pinnedEval.live.e2e.test.ts --maxWorkers=3
```

**Verdict rule, fixed in advance.** Pinning ships default-on (flip
`IS_CONSTRAINT_PINNING_EVALUATED`) only if the pinned arm's
constraint-kept rate is at least the baseline arm's task pass rate on
heldout **and** both 0.75 floors hold. If today's arm already keeps the
constraints, ship only the UI visibility and say so. Either way the
receipt (report `.json`/`.md` beside this file) is the record; until
then the latch stays off and no win is claimed.

## Gates

Recorded at the end of the lane run; see the lane's final message for
each exit code. One pre-existing busy-rig failure is recorded there:
`test/unit/eval/evalJudgeArms.test.ts`' first test times out at the
repository's 5 s on this rig, identically on untouched base code
(verified in a clean worktree of the base commit).
