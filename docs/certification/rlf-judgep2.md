# RLF-JUDGEP2 — `judgeP2Delivery`: from 90 minutes and hanging to green in ~10 (2026-11-02)

Lane `RLF-JUDGEP2`, worktree `/Users/randy/lanes/RLF-JUDGEP2`, branch
`rec/rlf-judgep2`, on the test rig `macmini` (macOS, Node 24.21.0).
Base: `cc/int9` `5ec754534`. Model attempts: **0**. Provider calls: **0**.
Muse requests: **0** beyond the lane's own session (the brief names no real
use). Nothing pushed, rebased, stashed or tagged. No sub-agents, no
background tasks; every run in the foreground.

## 1. Where the time went (measured on this rig)

The suite does all of its real work while the file is collected (Vitest
collection has no deadline), then asserts. One gate at a time, on the
untouched base with a fresh `node scripts/build.mjs --production`:

| Gate                                                                       | Time/run here | Runs before | Cost before |
| -------------------------------------------------------------------------- | ------------- | ----------- | ----------- |
| `check-bundle-split` (rereads ~6 MB of metafiles, scans ~14 MB of bundles) | 15 s          | 282         | ~70 min     |
| `vsce ls --no-dependencies` (walks the package tree)                       | 67 s          | 9           | ~10 min     |
| `check-bundle-size`                                                        | 0.3 s         | 11          | seconds     |
| `check-host-globals`                                                       | 0.2 s         | 9           | seconds     |
| `package-acp` (fails fast at `requireBundles`)                             | 2.4 s         | 1           | seconds     |

282 split runs = 1 green + 27 leak + 9 missing + 184 child-leak +
46 child-missing + 14 English + 1 final. Each control mutated one file and
ran the whole gate; the gate answers every violation per run, so that was
282 answers to what 18 runs could say. Together with the 9 VSIX listings
this is the 5,340 s `docs/certification/cc-int6.md` §4 measured (101 of 103
passed there; the extra minutes there are that rig's slower gates and its
59,000 scratch files under `vsce ls`).

Per-case time was never the problem: even before, every case but the last
asserted precomputed controls in milliseconds; the last case runs three
gates in-test (~15–24 s, the file's one kept 60 s named timeout).

## 2. Why it hung

No gate hangs: split, size, globals and `package-acp` in the missing state
all fail fast (verified above), and `vsce ls` without `--follow-symlinks`
treats symlinked directories as files (vsce 4.0.0,
`node_modules/@vscode/vsce/out/package.js`), so no symlink cycle can wedge
it; this worktree has no symlinks outside `node_modules` either. The hang
shape is structural: `gate()` and `vsixListing()` used `spawnSync` /
`execFileSync` with **no timeout**, executed at collection where **no Vitest
deadline applies** — any stuck child hung the suite forever with zero
output, and the 90-minute silent collection alone outlasted every 10-minute
bound, which reads as a hang (the linuxlt report). The fix bounds every
child wait: `GATE_TIMEOUT_MS` 120 s (8× the slowest observed 15 s split
run), `VSCE_TIMEOUT_MS` 600 s (2.5× the 4-minute scratch-tree listing),
each with its reason in the file. A timed-out gate now reports its signal
in the control output (`… ETIMEDOUT: expected null to be 1`), and a timed-out
listing throws, instead of hanging silent.

## 3. The two failures, classified and fixed at cause

cc-int6 §4: `fires the new size and host-global guards without changing
caps` and `leaves every restored artifact green` fail asserting the size
gate exits 0 on restored artifacts. On that base the gate was red for three
over-budget team bundles; on this base it is red for four `MISS
dist/desktop/*` lines — the shared production build
(`test/unit/productionBuild.ts`) runs only `scripts/build.mjs
--production`, which never builds desktop (that is `build-desktop.mjs`,
a later step of `npm run build`). Class: **test scope** — the suite
asserted a global green exit for artifacts it does not own. The gates
themselves are untouched and still run in CI's build job. Fixed in
`test/unit/judgeP2Delivery.test.ts`:

- the green assertions scope to judge artifacts (`judgeProblems`: no
  problem line naming judge, plus a ran-check on the status);
- the last case proves **byte-identical** gate output before and after
  (all three gates are deterministic — verified by double runs and `cmp`),
  a stronger restoration proof than a green exit, and honest on a red base.
  It is renamed `leaves every restored artifact byte-identical`.

No product defect was found: the unbounded waits were in the test's own
spawn helpers, and no source file changed. One observation, not fixed (out
of scope): the split gate enforces two `judgeSources` members the suite's
own lists do not name (`src/core/judge/systemone/side.ts`,
`src/core/judge/sides.ts`); drill 2b below uses the first.

## 4. The fix (`fd36f144e`)

`test/unit/judgeP2Delivery.test.ts` only (180 insertions, 127 deletions).
No case deleted, none added: 103 before, 103 after, every assertion kept.

- Split controls batched per mutated file(s): 3 leak + 1 missing + 4
  child-leak + 6 child-missing + 2 English batches; 282 runs → 18.
- VSIX allowlist batched: one listing without all eight `!` entries (each
  bundle rides its own line; the file starts by excluding everything);
  9 runs → 2.
- Every child wait bounded (§2); `controlMany` restores N files with
  per-file digests; the size/globals red controls are unchanged (fast).
- Green assertions scoped and the final case made byte-identical (§3).

After: **103 passed, exit 0**, `npx vitest run
test/unit/judgeP2Delivery.test.ts --maxWorkers=3`, repository timeouts, no
`--testTimeout`: 8m06s wall the first green run, 11m23s the final
verification run (loaded rig; 681 s Vitest duration, 96% collection, 102
cases under 100 ms combined, the last case 19.7 s). A merge round can
afford it, and it fits CI's 20-minute unit-shard job, which the 90-minute
suite never could. No suite move: the repository marks no slow-suite place
by name, and none is needed at this cost.

## 5. Drills (break on purpose, non-zero exit, revert, green)

- **Drill 1, restoration proofs fire.** `controlMany` restored all but the
  first file: 99 of 103 failed (every `restored` check and the final
  byte-identical case). Reverted; `git diff` empty.
- **Drill 2, a real leak goes red.** Temporary `import { techniqueRefusal }
from './core/judge/sampling'` in `src/extension.ts`, built by the run's
  own shared setup: exit 1, exactly the ships-case failed
  (`expected [ 'src/core/judge/sampling.ts' ] to deeply equal []`).
  Reverted.
- **Drill 2b, `judgeProblems` fires where the suite's lists cannot.**
  Temporary import of `systemOneRoute` from `side.ts` (gate-enforced, not
  in the suite's lists): exit 1, exactly the ships-case failed on the new
  helper (`expected [ …(4) ] to deeply equal []`, e.g.
  `dist/extension.js carries src/core/judge/systemone/source.ts, which
belongs to dist/judgeSources.js`). Reverted; tree clean.
- **Drill 3, the bound fires loudly.** `GATE_TIMEOUT_MS = 1`: exit 1, 98
  failed, failures name the signal
  (`Error: spawnSync … ETIMEDOUT: expected null to be 1`). Reverted.
- **Green:** the final verification run (§4), 103 passed, exit 0, on the
  reverted tree.

## 6. Gates (final tree)

- `npx tsc -p test/unit/tsconfig.json --noEmit`: 0 (before commit)
- `npm run typecheck` (all 7 projects): 0
- `npx eslint test/unit/judgeP2Delivery.test.ts --max-warnings 0`: 0
- `npx prettier --check test/unit/judgeP2Delivery.test.ts`: 0
- `node scripts/check-l10n.mjs`: 0 (0 problems; no text touched)
- `npm run check:catches`: 0 (baseline unchanged; no catch added)
- `npm run duplication`: 0 (0 clones)
- Suite: exit 0, 103 passed (§4)

Not run: `npm run build` / packaging (no source, gate, or build input
changed); `npx vitest related` (no changed source file to relate).
No CHANGELOG entry (nothing a person notices changed) and no PLAN.md
change (no milestone scope).
