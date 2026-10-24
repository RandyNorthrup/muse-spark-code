# RVINT4 — independent review of the fourth integration round (2026-10-23)

Review lane with fix rights, on Grok, worktree `rec/rvint4`. Base is
`int/recovery` at `d81327d360` (the lead's dependency pin after
`2640d6daea`). Reviewed range: `8ae18f2266..2640d6daea`, the 22 lane
merges onto `8ae18f2266` (RLINTFIX, RLF-BUDGETS, RLF-JUDGEFIX, RVINT2,
RLF-HYGIENE, RLF-SECSCAN, RVSEC, RLF-REFRESHLOCK, RLF-ACPTURNS,
RLF-MACPATH, RLF-M95B2, RLF-PROVLIMITS, RLF-HOSTS2, RLM125, RLF-DEVICES,
RLF-M100K, RLM110A0, RLM110B, RLF-M110OS, RLF-M107, RLF-M47, RLF-M111L0)
and every `fix(int):` commit in that range. No work was merged by this
lane. The dependency pin `d81327d360` is `fix(deps):`, outside the
`fix(int):` list, and was not re-reviewed.

## Method

For each merge, `git show --remerge-diff`. A survival pass compared
changelog bullets, flattened l10n keys, and added source lines across
the 37 merges in the range (the 22 integrator merges and the nested
source-branch merges). A title pass compared `it`/`test` titles. The
scripts and their reports stayed in gitignored `temp/` and are not part
of the tree. Generated files were judged by the integrator's regenerate
notes and by the gates on this tree, not by hand-merging. Every
`fix(int):` diff was read for a looser test, a removed guard, or a
raised budget or bound.

## Finding fixed

### A signaled program's stderr was no longer proven (merge `47562e98c7`)

`47562e98c7` (Merge `src/RLM125/01-fix-judge-stat-uutils` into RLM125)
dropped the only test of the signal-death rule. The lane parent
`96f2c90f` added `test/unit/inspectExec.test.ts` (`never reads a killed
program's stderr as the helper's verdict`) and a `killedAfterJson` mode
in `test/fixtures/inspect-helper.mjs`. Neither file exists at the merge
result or at HEAD. The fixture was a stand-in and was not restored.

The production branch survived. After a child error has already been
returned, a null exit is a signal death, and stderr is not a verdict
(`src/core/judge/fast/inspectExec.ts:263`):

```typescript
if (result.exitCode === null) {
  return refused(parsed.program === 'du' ? 'processCreation' : 'confinement')
}
```

`du` stays `processCreation` because that program dies asking for a
thread the boundary denies. Anything else stays `confinement`. The
native helper itself does not take this path: a denied thread is a JSON
refusal and exit 125 (`native/confine/MuseSparkConfine.c`), so the
null-exit branch is the runner's own reading.

The proof is `test/unit/inspectNative.test.ts` (`a signaled program is
not its own verdict`), inside the Linux case and beside the kernel
suite so it does not compile the confine helper. `InspectRunner` is the
real runner. The session self-test's probe, `cat` and `grep` replay the
file's recorded helper bytes. The command under test is a real Node
child, started through `inspectStart` (the same pipe and stop contract
as the governed launcher): it writes a confined line and
`{"refused":"network"}`, then SIGKILL. `wc -l allowed.txt` must come
back `confinement`. `du -s .` must come back `processCreation`.

## Red/green drill

Break, on purpose: the null-exit branch parsed the killed program's
last stderr line with `nativeRefusalSchema` and returned that `refused`
word. Same command both times, from WSL2 (Linux, Node, this worktree),
`node node_modules/vitest/vitest.mjs run test/unit/inspectNative.test.ts -t "forged refusal" --maxWorkers=1`.
Vitest 5.0.3. The Linux case does not run on Windows.

- Red. Vitest exit 1. Duration 450.07s, started 18:06:35. One failed,
  33 skipped. The runner returned `{ kind: 'refused', reason: 'network' }`
  where `wc -l allowed.txt` must be `confinement`. The drill log named
  `test/unit/inspectNative.test.ts:849`. The helper then moved to module
  scope for lint; that assertion is line 851.
- Restore. `src/core/judge/fast/inspectExec.ts` matches HEAD again
  (blob `916201c35edfa973b48aef21d06a8f4440ccd851`).
- Green, on that restored blob, before the red re-run. Vitest exit 0.
  Duration 345.30s, started 18:00:03. One passed, 33 skipped.

## Named checks that hold

- **RVINT2's fixes were not lost when RLF-JUDGEFIX's form was kept.**
  Merge `cb48529bce` says so: the ten conflicted judge sources keep
  RLF-JUDGEFIX's `SyntaxError` narrowing and `failureForLog` (stronger
  than RVINT2's fixed-word logs); `scripts/catch-baseline.json` stays
  int's, so RVINT2's 53-site rise is not accepted; the duplicate
  `shippedJudgeFeatures` loader is left out and
  `test/unit/helpers/judgeP2Features.ts` is the shared copy. The
  narrowing is present, including `src/core/judge/providers/decode.ts:135`.
- **RLM110B's node pairing landed beside M100 pairing.** Merge
  `a13f6326c9`. `src/core/devices/pairing.ts` is M100's certificate
  pairing. `src/core/devices/nodePairing.ts` is the node's invitation
  text (M110). The suite imports it from there.
- **RLM110A0's budget raises were reverted.** Merge `e5dcb67a23`.
  Current caps: `reportInputs` 116, `reportingPanel` 50, `vaultActions`
  25, `estimateContracts` 25. The lane's 101/51/26/26 are absent. No
  existing budget in `scripts/check-bundle-size.mjs` is higher than it
  was at `8ae18f2266`. New bundles keep their own caps (`maker` 50,
  `resourceGovernorWindows` 13, `webview/judgeSetup.js` 400,
  `judgeSetup.css` 25, `estimateActions` 52, `judgeSetup.js` 50,
  `judgeSetupDriver.js` 50, `node.js` 75, `packsVerify.js` 1675).
  `teamRunners` is 75, `estimator` is 75, `judgeServe` is 25.
- **RLM125's D212 is D217.** `PLAN.md` D212 is M120 secondary roles.
  D217 is the judge fast-path `stat` decision, with the renumber note
  in its heading. `dist/modelApi.js` stays 525 and `dist/wire.js` stays
  75 (the lane's 575 and 80 were not kept). `src/core/judge/cascade.ts`
  keeps int's narrowed form and the lane's `side.technique` selector.

## `fix(int):` commits

Each is a compile, lint, or exactness fix. None loosens a test, removes
a guard, or raises a budget or bound.

- `2640d6daea` lint after the RLM125 and RLM110A0 merges.
- `1a658f0a41` the node-service split allow-list admits only the pack
  verifier chunk.
- `7de460ef3f` the node's paid-run budget and the TUI's paid ask carry
  exact money.
- `d013e0d283` pin zod 4.6.7 for the advisory.
- `c67d3501dd` the bare providers usage row walks as `providers usage`
  (round 3's RLTESTDRIVE2 merge; inside the range).
- `88c7e33f8c` the local-judge steps answer a lone `--help`.
- `1ac251ef7e` the per-owner ledger keeps spend exact.
- `2471059745` two fast-judge catches name `SyntaxError` / `RangeError`.
- `05badbf29c` the fast judge compiles against int's money, fence and
  event types (`Usd.from(0)`, platform literals).
- `c4237cad16` the resubmit suite narrows the turns it waits for; a
  missing turn throws.
- `1e618c319f` the catalog-row comparator carries only its order keys.
- `211cbabb86` is also a merge. Its remerge-diff is `ROADMAP.md` only,
  regenerated with the host receipts.

## Stands, not changed

- `docs/certification/plan-archive.md` records the duplicated C-M106-2
  R5 archive. RLINTFIX had already archived it; RLM110B's block landed
  with the hash note. Not a silent drop.
- RLF-ACPTURNS' title `falls back to the kind, then the terminal, for
the message` is gone because the resolved message is `reason` or the
  action-failed sentence, and absent judgment is not retryable
  (`src/acp/agent.ts` `turnFailureError`). The current suite covers
  that. A raw kind or terminal word is not the message.
- Nested source merges deleted stand-in and text-existence tests
  (`9171c97690` and the uutils title list: node image workflow, TUI
  socket, runtime store, and the bundle suites whose only delta from
  0.18.1 was a fixture timeout). Those titles were not restored.
- `src/core/judge/evidencePaths.ts:230` catches a malformed phase-2
  record, warns, and returns undefined. Left as it stands. Narrowing
  that catch was not required to keep either side.
- Known open failures other lanes own were not touched: `check:plan`
  size, RLM108's 24 catch sites, RLM125's 41 clones and two unguarded
  spawns, the lazy registry, 12 bundles over budget, and the 159 unit
  failures listed for RLF-INTFIX2-TESTS.

No changelog entry. A person does not see this test, and the refusal
behavior was already in the tree.
