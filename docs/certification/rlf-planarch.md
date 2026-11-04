# RLF-PLANARCH: PLAN.md back under its budget (2026-11-04)

Worktree `mx-cc-planarch`, branch `cc/planarch`, base `3d7811fc93`, under
CONTRIBUTING.md, "Archiving closed history from PLAN.md". `PLAN.md` stood 20
bytes over `check:plan`'s line, so the gate failed. The line did not change.

## Result

| Measure                                | Before     | After     |
| -------------------------------------- | ---------- | --------- |
| `PLAN.md` bytes                        | 3,565,178  | 3,432,359 |
| Share of the reader's bound            | 85.0%      | 81.8%     |
| Room under the gate's line (3,565,158) | OVER by 20 | 132,799   |
| Hashed blocks in `decisions.md`        | 142        | 149       |
| `decisions.md` bytes                   | 1,140,777  | 1,285,876 |
| Moved (7 blocks)                       |            | 143,142   |
| Left in the moved text's place         |            | 10,323    |

**The brief's aim of 300 KB of room is not reached: 132,799 bytes is what the
rules allow today.** Why, and what would release the rest, is below.

Bytes moved per section: §2 143,142; §6 0; §7 0. `gates.md` and
`milestones.md` are unchanged. No `--allow-fact-change`.

## What moved

All to `docs/plan-archive/decisions.md`, in one `npm run plan:archive -- move
--batch` at `3d7811fc9` (dry run first, the same report). Line numbers are
those of `PLAN.md` at that commit.

| Decision | Block id                   | Lines     |  Bytes | SHA-256     | What stays in `PLAN.md`                                     |
| -------- | -------------------------- | --------- | -----: | ----------- | ----------------------------------------------------------- |
| D49      | `decisions-3d7811fc9-2871` | 2871–2894 |  1,235 | `1234db5f…` | nothing: D49's paragraph already links its record           |
| D49      | `decisions-3d7811fc9-2991` | 2991–3019 |  6,406 | `7e258f93…` | nothing: the wave table, all shipped; "Rules carried" stays |
| D90      | `decisions-3d7811fc9-4179` | 4179–4208 |  1,980 | `7e414e45…` | a pointer; "What it is", "Builds on" and the list stay      |
| D90      | `decisions-3d7811fc9-5907` | 5907–6022 |  7,464 | `a0ff6c43…` | a pointer, under the "Suggested additions" line             |
| D91      | `decisions-3d7811fc9-6026` | 6026–7105 | 81,515 | `160b9799…` | a paragraph with the rule in force and its amendments       |
| D93      | `decisions-3d7811fc9-7513` | 7513–7853 | 36,490 | `6fdd0a2b…` | a paragraph; the opening and "What exists" stay             |
| D94      | `decisions-3d7811fc9-7859` | 7859–7993 |  8,052 | `b738bb84…` | a paragraph with the rule in force and its rulings          |

D91's and D93's whole numbered lists are one top-level block each, so they
moved whole. Each paragraph cites the numbered items (D91.13, D93.5), which
keep their numbers in the archive. M111, M113 and M114 are still building;
their milestone sections, status rows and lane tables did not move. As with
D75, D87 to D89 and D107, a design record moves while its milestone builds,
and the paragraph carries the rule.

D49's section in the archive stands as `## ### D49 …`, from an earlier move;
its two blocks were filed there, so D49 keeps one section.

Each summary was written from the whole decision after reading it, amendments
applied: D91's shell is Qt 6 Quick (not the GTK first written in its decisions
4 and 6) and its status bar is the shell's surface (D91.30); D93's source reads
have no timeout of ours (D121, D208). D94's paragraph says its pixel-comparison
gate gave way to AGENTS rule 5's local look, the standing rule that outranks it.
A check confirms that all 126 code spans, decision references, milestone ids and
bold names in the three summaries occur in the text they summarise, and every
numbered reference is an item of its own list. That check is names only, and one
reader wrote and checked these paragraphs; lanes should read the record before
building on a detail.

## Open branches

Taken from this repository, as the brief lists: `refs/heads/cc/*`, `rec/*`,
`fix/*`, `ms/*`, `rv/*`, `realuse-win/*`, `refs/rigs/*` and `origin/*`.

| Measure                                     | Count |
| ------------------------------------------- | ----: |
| Refs in those namespaces                    | 3,233 |
| Not merged into `3d7811fc93` (first scan)   | 1,202 |
| Distinct head commits                       | 1,104 |
| Heads whose own `PLAN.md` diff is not empty |   609 |
| Refs at those heads                         |   697 |
| Distinct base/head file pairs merged        |   330 |
| Heads with no merge base                    |     0 |

Unmerged by namespace at the first scan: `heads/rv` 13, `heads/fix` 7,
`heads/ms` 4, `heads/rec` 2, `heads/cc` 0, `heads/realuse-win` 0, `origin` 7;
`rigs/kubuntu` 537, `win11` 234, `macmini` 203, `linuxlt` 92, `macbook` 48,
`wslpc` 39, `lxair` 8, `flex` 7, `host` 1.

The rig refs are present, not missing. The newest stands at 2026-11-03; the
newest unmerged one that changes the plan at 2026-10-30, and most are from
October's first three weeks. They are this hub's copies from the last sync, so
a commit still only on a rig is not seen.

A re-scan before the commit found `cc/int12` and `cc/winland` newly past the
base; neither changes `PLAN.md`, and no other head appeared.

Each head's diff (`git diff --histogram -U0`, base to head) was carried onto the
frozen file through the base's own alignment with it. 3,060 top-level blocks
came out of the repository's `topLevelBlocks`. A passage a head changes or
anchors an insertion on, and each block next to it, stayed. A base line the
frozen file no longer has counts for the two sides of its place, for whatever
still resembles it, and for any exact copy elsewhere. Thirteen pairs of
2026-10-11 to 2026-10-17 each remove some 9,000 lines; they carry the first
archive move on an old base, and those lines are mostly gone from the frozen
file too.

## Why not 300 KB

- **§6 holds 2,012,237 bytes, and 44 sections still building, planned or waiting
  hold 1,816,388 of them.** They never move, nor do the 19 built with no release
  yet. No closed, released section holds 300 bytes of blocks that are free of open
  branches and carry no status row, field, lane table or checklist item: earlier
  moves took them.
- **§3, §8, §9 and §10** (742,524 bytes) never move, nor D3 and D6 (155,796).
- **§7** is 37,498 bytes, nearly all open M95-K residuals that branches touch.
- That leaves §2's design records, and open heads touch or carry most of them.

What would release more, each the lead's call:

| Passage                 |   Bytes | Held by                                                                              |
| ----------------------- | ------: | ------------------------------------------------------------------------------------ |
| D90's numbered list     | 117,991 | 37 refs dated 2026-10-06 to 10-17 change it (`plan/d108-link`, `review/*`, `snap/*`) |
| D92, both copies        |  20,922 | `refs/heads/rec/rlplan` alone (2026-10-21)                                           |
| D86's numbered list     |   9,788 | 17 refs dated 2026-10-09 to 10-17                                                    |
| D103's preference block |   5,854 | 27 refs dated 2026-10-11 to 10-17 insert beside it                                   |

Retiring those refs would free about 150 KB more, an estimate before their
summaries; with D97, D209 and D212 below, that comes close to the 300 KB asked for.
Separately, the ruling PLANFIX2 had (history inside an open record moves with a
summary that keeps its open items) would reach §6's open sections, where 789,941
bytes are free of open branches. Neither was done: neither is in the rules today.

## What stayed that looked movable

| Passage                       |  Bytes | Why it stayed                                                                                                                       |
| ----------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------- |
| D97, whole record             |  8,051 | Merge trial: 7 heads got new or larger conflicts (`plan/d108-link`, `rv/d108`, `rt-actflake` …): they add the same text themselves  |
| D212's list                   |  4,398 | Merge trial: 24 heads (`m126/*`, `rec/rlm96c`, `rv/cm96c1*` …) carry their own copy                                                 |
| D209's record                 |  3,961 | Merge trial: `move-snap/REVPAIR` carries it as D123                                                                                 |
| D36's capability table        | 10,188 | Doubtful: a recent lane edited a row (RLF-M47) and the 2026-10-11 record calls it live                                              |
| D30's table and rules         | 10,556 | Same record: a paragraph true to its text would mislead                                                                             |
| D1                            |  3,105 | Same reason                                                                                                                         |
| D121's list                   |  9,436 | Live limits list                                                                                                                    |
| D49's "Rules carried"         |  4,350 | Rules in force, one amended on 2026-10-31                                                                                           |
| D74's "Words", D106's list    | 12,137 | The first kept by the 2026-10-24 record, the second listed live by PLANFIX0190. Only an edge-flagged heading holds them in this map |
| D65, D102, D208, D228 to D263 |   ~36K | Short rule text, not a record, most of it landed after 0.19.0; a paragraph would save little                                        |

## Proofs

**Byte for byte** (`temp/planarch/08-prove.mjs`, separate from the command and
its library, on raw bytes from git and disk): exit 0, 0 failures.

- Each of the 7 passages stands once in `decisions.md`, between markers carrying
  its own size and SHA-256, its stored bytes equal to the frozen file's.
- Each stands 0 times in the new `PLAN.md`, and no line of it remains beyond the
  copies the old file held outside the moved ranges.
- Outside the ranges `PLAN.md` is unchanged, and what stands in each range's
  place is exactly the summary, the pointer or nothing.
- The new `PLAN.md` with each stub replaced by the block read back from the
  archive has SHA-256 `15434b76…c209c`, the old file's.
- In `decisions.md` all 142 older blocks are unchanged and its old lines survive
  in order (`git diff --numstat`: 1,798 added, 0 deleted).

New `PLAN.md` `69e4bd35…5439`; new `decisions.md` `ffdad1c4…c0ad`.

**The command's own proofs:** reassembly identical (`15434b76…c209c`), parsed
facts identical, format drift 0.

**Merge proof** (`git merge-file --diff-algorithm=histogram`; each pair's
`PLAN.md` onto the old file and onto the new, its merge base as base; a region
counts new when no old region's branch side holds its branch lines):

|                                | Old file | New file |
| ------------------------------ | -------: | -------: |
| Pairs merged (697 refs)        |      330 |      330 |
| Pairs with no conflict         |       38 |       38 |
| Conflict regions               |    1,748 |    1,748 |
| Branch lines in conflict       |  196,986 |  196,986 |
| New regions / pairs made worse |          |    0 / 0 |

The same for `decisions.md`: 3 pairs change it; 2 regions and 130 branch lines
before and after, 0 worse.

The first batch also held D97, D209 and D212, and this proof refused it: 32
pairs worse, 32 new regions (D212 24, D97 7, D209 1). The write was undone with
`git restore`, each candidate was tried alone, and those three stayed.

**Citations:** 31,190 string literals of 20 or more characters in `test/` and
`scripts/`, compared with the moved ranges: only bare identifiers match (paths
such as `src/webview/tokens.css`, flags such as `--enable-wayland-ime`). The
tests that open `PLAN.md` are `planReader`, `paidMoneyStructure`, `devices`,
`estimatorPlanSnapshotRealPlan`, `reportInputBoundaries` and
`reportPlaybookSchedules`; what they read is parsed facts, §8, §9, M113 and M121.

### Drills

| Break                                            | Red result                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| One byte inside block `…-7859` in `decisions.md` | `08-prove` exit 1: stored bytes differ, 0 copies, reassembly differs          |
| A line of §3 reworded in `PLAN.md`               | `08-prove` exit 1: reassembly differs                                         |
| The D94 passage left in `PLAN.md` as well        | `08-prove` exit 1: it still stands once, 124 lines remain, reassembly differs |
| D90's list moved (a block open heads edit)       | merge proof: 18 pairs worse, 18 new regions, branch lines 196,986 to 226,876  |

Files restored and compared by SHA-256; `08-prove` exit 0 afterwards.

## Gates

On the final tree, Windows host, repository timeouts.

| Run                                                                                                                                                                                                                                                                                                  | Exit | Result                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | -------------------------------------------------------------------- |
| `npm run check:plan`                                                                                                                                                                                                                                                                                 |    0 | `plan-format-v1; 265 milestones; 0 drift`                            |
| `npm run check:roadmap`                                                                                                                                                                                                                                                                              |    0 | 265 entries, `ROADMAP.md` current, so not regenerated                |
| `npm run check:reference`                                                                                                                                                                                                                                                                            |    0 | current                                                              |
| `npm run plan:archive -- status`                                                                                                                                                                                                                                                                     |    0 | decisions 149, gates 332, milestones 186 blocks, all intact          |
| `prettier --check PLAN.md docs/plan-archive/decisions.md`                                                                                                                                                                                                                                            |    0 | clean                                                                |
| `npm run format:check`                                                                                                                                                                                                                                                                               |    0 | clean, the two certification files included                          |
| `vitest run --maxWorkers=2` on `planReader`, `planCitation`, `autoCompact`, `paidMoneyStructure`, `devices`, `estimatorPlanSnapshotRealPlan`, `estimatorPlanSnapshotSource`, `estimatorSnapshotStrict`, `estimatorPlanHelp`, `reportInputBoundaries`, `reportPlaybookSchedules`, `qualityLedgerPlan` |    0 | 12 files, 415 passed; the same on the untouched file before the move |

## Not proven

- Refs outside the brief's list: 181 other unmerged refs exist (`refs/archive/*`,
  `refs/heads/move-snap/*`, `src/*`, `prep/*` and others) and were not considered.
- A commit only on a rig, or an edit uncommitted in another lane's worktree.
- `git merge-file` with the first merge base is not a whole `git merge`: a head
  with several merge bases could differ slightly.
- The paragraphs are one reader's, with names checked mechanically, not a
  second reader's review.
- Hosted CI, and the whole unit suite, were not run; the commit is not pushed.
  Only Markdown changed, so lint, typecheck and the packed product were not run
  beyond the commit hook.

## Noted, not changed

- Nothing in `test/` or `quality:gates` checks the archive's hashes any more:
  `test/unit/planArchive.test.ts`, which `decisions.md`'s introduction still
  names, is gone. `plan:archive status` is the only check, and it is run by hand.
- D93's opening (`PLAN.md` old lines 7488–7511) holds a merge scar: its last
  "What exists" bullet is split around two unrelated paragraphs. `rec/rlplan`
  edits next to it, so it stays.
- `### D92` stands twice in §2, and D49's paragraph says the M67–M85 batch has
  "all shipped" while M71, M77 and M80 still read `building`. Neither is this
  lane's text.
