# PLAN.md archive move (2026-10-11)

`PLAN.md` is read whole by `npm run check:plan`, `npm run check:roadmap` and
`/report`. Their reader refuses a plan over `REPORT_PLAN_MAX_BYTES`
(4,194,304 bytes). On the release train of 2026-10-11 the file stood at
4,157,477 bytes, 36,827 short of the bound, and the next branch to merge added
71,640: both checks failed in the middle of that merge
(`Plan format at line 1: input-size: maxUtf8Bytes=4194304`). The lead's
ruling: the bound is a sound product limit and stays; closed history moves to
`docs/plan-archive/`, and a gate keeps the file from getting that close again.

An earlier move (2026-10-08, `docs/certification/int0170-combined.md`) had put
147 closed milestone sections in `docs/plan-archive/milestones.md`. This one
follows its convention for milestones and adds two files.

## Result

|                                   |     Bytes |  Lines | Share of the bound |
| --------------------------------- | --------: | -----: | -----------------: |
| `PLAN.md` before (`5161b6476`)    | 4,157,477 | 48,966 |              99.1% |
| `PLAN.md` after                   | 3,472,457 | 40,836 |              82.8% |
| Moved out (net of what was added) |   685,020 |  8,130 |                    |
| The gate's line (85%)             | 3,565,158 |        |                    |

| Pool                                        | Sections | Blocks | Moved bytes | Added to PLAN.md |
| ------------------------------------------- | -------: | -----: | ----------: | ---------------: |
| §2 decisions, design record                 |       50 |     51 |     534,696 |           42,653 |
| §7 gate records dated 2026-10-08 or earlier |        1 |    140 |     164,850 |              432 |
| §6 closed 0.17.0 sections                   |        7 |      7 |      35,071 |            6,243 |

"Added to PLAN.md" is what stands in the moved text's place: a decision's
paragraph, the one pointer paragraph in §7, a closed section's kept rows and
pointer line. A note under the §2 heading says how to read the section. The
blank lines between moved passages are not counted in either column; the
first table's figures are the files' sizes.

SHA-256 of the files at this commit:

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `PLAN.md` before                  | `17b1c71ea09e709edf94cec3a1ac73f8cae68fbd821f87720ae527998cafe71f` |
| `PLAN.md` after                   | `340236ae80ab2cbb9339b76e4f9a184383b24e5c5535386803e665955ac5c8b3` |
| `docs/plan-archive/decisions.md`  | `76b6aafabe77646a08006605d96d9c770e22da3cd186249ff369dabdd8dc2128` |
| `docs/plan-archive/gates.md`      | `141e241a52cf694b3fc737b1747c604924695756d4baa112fa3ec8cfdfce903d` |
| `docs/plan-archive/milestones.md` | `39cf6d360d030fbf3c336d154ce2cbd46001ba2c52e576aeeca40483c52b2c49` |

## What moved

**§2 decisions (50).** Top-level blocks of a decision that no open branch
touches, that stand next to no touched block, that no test cites and that are
not live tables. `PLAN.md` keeps the heading, one paragraph that states the
rule in force and ends with `Full record: …`, and the kept blocks in place.
Each paragraph was written from the whole decision by a reader that had to
copy three to eight exact quotes with line numbers supporting it; every quote
was checked mechanically against the frozen file (432 quotes over 55 drafts,
0 mismatches), and where a decision amends itself the paragraph states the
amended rule. Five drafts were not used: the decisions they describe stayed.
Audit findings tables (D14, D16 to D29) count as record and moved; every
other table stayed.

| Decision | Moved bytes | Decision | Moved bytes | Decision | Moved bytes |
| -------- | ----------: | -------- | ----------: | -------- | ----------: |
| D11      |       3,932 | D32      |       4,947 | D61      |       3,567 |
| D12      |       9,016 | D33      |       4,287 | D62      |       9,910 |
| D13      |       8,268 | D37      |       2,040 | D66      |      30,493 |
| D14      |       5,963 | D38      |      11,158 | D67      |      17,261 |
| D18      |       6,950 | D39      |       4,390 | D68      |       3,345 |
| D19      |       8,738 | D40      |       4,902 | D69      |       4,352 |
| D20      |       3,839 | D41      |       6,947 | D70      |      14,143 |
| D21      |       8,377 | D42      |       7,256 | D72      |       7,224 |
| D22      |       3,440 | D43      |       8,525 | D73      |       5,898 |
| D23      |       4,135 | D45      |       3,818 | D74      |      39,185 |
| D24      |      18,282 | D46      |       2,771 | D76      |       7,900 |
| D25      |      10,003 | D47      |       9,642 | D77      |      35,296 |
| D26      |      41,468 | D48      |       3,116 | D78      |       4,182 |
| D27      |      19,817 | D50      |       6,251 | D79      |      11,990 |
| D28      |      21,213 | D51      |       3,294 | D82      |      21,037 |
| D29      |       5,414 | D60      |       3,753 | D85      |      17,799 |
|          |             |          |             | D95      |      27,660 |
|          |             |          |             | D98      |       7,502 |

**§7 gate records (140 of 260).** A record is a `###` heading or a paragraph
whose bold title carries a date; undated paragraphs belong to the record above
them. A record moved when its date is 2026-10-08 or earlier, no open branch
touches it or a record next to it, and its title names no milestone that has
nothing in a release yet. Kept: 44 a branch touches, 30 of unreleased
milestones, 16 dated later, and the rest for standing next to a touched record
or first or last in the section. One paragraph in §7 says where the others
went.

**§6 closed sections (7).** INT0170, INT0170B, INT0180, FIXCYCLES, FIXCYCLES2,
MONEY017 and VIS017: built or merged by 2026-10-08, shipped in 0.17.0, touched
by no open branch. As in the first move, `PLAN.md` keeps the heading, every
status row, the Goal / Depends on / Gates fields, the checklist, the lane
tables and the pointer line; the whole section is copied to `milestones.md`.

## What stayed, and why

- **§3, §8, §9, §10** and every milestone that is not fully released: the
  reader parses them, `/report` diffs §8 and §9 against the last tag, and
  lanes work in them.
- **D3 and D6** (version pins and bundle budgets) by the lead's ruling, and
  D36 and D49, whose bodies are mostly live tables.
- **The agent roles and team design (D75, M96).** Its heading at old line
  6120 has no body. Its text stands under D74's first heading (old lines 6124
  to 6256) and under D82's from old line 6502 to 9743, without a heading of
  its own. Lanes are working in it; it stays whole, and D82's paragraph says
  so. Only D82's own text (to the rule at old line 6500) moved. Filing that
  text under its own heading is left to the M96 lanes.
- **D1, D7 and D30.** Each states something a later decision or the code has
  since changed (the backend interface's names, the pre-M4 approval collapse,
  "off by default" before D78), so a paragraph true to its text would mislead.
  They stay in full.
- **D89, D90, D91, D92 and D93**, and most of D73 and D82's team text: open
  branches touch nearly all of their blocks.
- **Passages tests cite**: D81's and M73's `Candidate packing default`, M101's
  lane P1 record, M113's closure lines, the five team phrases of
  `teamPlanRecord`, M121's sanctioned-money clauses; and the lane tables of
  M91, M93 and M100.

## Proof that nothing was lost

Every moved passage stands in its archive file between
`<!-- plan-archive:begin id lines bytes sha256 -->` and
`<!-- plan-archive:end id -->`. `lines` are its line numbers in `PLAN.md` at
`5161b6476`.

1. **Per block.** `test/unit/planArchive.test.ts` hashes the bytes of every
   block against its marker: 198 blocks (51 + 140 + 7), 0 mismatches. It also
   fails on a marker that no longer parses, a duplicate id and an archive link
   in `PLAN.md` that leads nowhere.
2. **Reassembly.** Starting from the new `PLAN.md`, each of the 77 places the
   move changed was restored from the archive files (the added lines removed,
   the blocks and the blank lines between them put back; 74 places held
   blocks, 3 only gained a paragraph). The result is 4,157,477 bytes with
   SHA-256 `17b1c71e…cafe71f`: the old file, byte for byte.
3. **Parsed facts.** The product's reader (`src/core/reporting/plan/reader.ts`)
   gives the same facts for the old and the new file, positions aside: 217
   milestones (status, date, goal, dependencies, gates, lanes, checklist), 34
   questions, 139 risks, 276 residuals, 30 release records and 20 delivery
   entries; 0 drift in both.
4. **ROADMAP.md** regenerates with no change (`npm run roadmap:generate`).

## Proof that no open branch merges worse

277 unmerged heads committed since 2026-10-06 change `PLAN.md` (the queued
train branches, `m104/*`, `m126/*`, the M100, M103 and M105 branches and their
port lanes, M98, M110, M111 and every in-flight `c/*` head). Their own diffs
touch 2,199 lines of the train's file; each touched block and the blocks next
to it stayed in place.

Each head's `PLAN.md` was then merged onto the old file and onto the new one
with `git merge-file --diff-algorithm=histogram` (the diff `git merge` uses
for file content) and the two results compared:

|                                                    | Old file | New file |
| -------------------------------------------------- | -------: | -------: |
| Heads that merge with no conflict                  |       43 |       43 |
| Conflict regions, all heads                        |    1,003 |    1,003 |
| Branch-changed lines inside conflict regions       |  113,747 |  113,747 |
| Heads with a line newly in conflict, or more of it |          |        0 |

A first run with the Myers diff reported 67 old-base heads as worse. All were
alignment artefacts of that algorithm on bases older than the 2026-10-08 plan
restructuring (a branch's untouched list item in §3 matched against a
different paragraph); the histogram diff, the one a merge really uses, shows
none.

## The gate

`scripts/check-plan.mjs` fails when the plan it checks is larger than 85% of
`REPORT_PLAN_MAX_BYTES` (3,565,158 bytes), after format drift and before
anything else, with the size, the line it crossed and where the procedure is:

```
PLAN.md is 3565159 bytes, over 85% (3565158) of the plan reader's 4194304-byte bound. Move closed history to docs/plan-archive/ before adding more: CONTRIBUTING.md, "Archiving closed history from PLAN.md".
```

`test/unit/checkPlan.test.ts` (`archive guard`, 4 cases): a plan at exactly
85% passes; one byte more fails with that message and no other output; format
drift is still reported first; CONTRIBUTING.md has the section the message
names and the repository's own plan is under the line.

Room after this move: 92,701 bytes to the gate's line. The branches queued
for this train add about 244,000 bytes to `PLAN.md` between them, so the gate
will ask for the next move before they are all in. What becomes archivable
then: the sections and gate records of 0.17.1 once it is released, and the
train's own once it ships.

## Runs

Linux laptop rig (Ubuntu 25.10, 8 threads), Node v24.21.0, Vitest 5.0.3,
repository timeouts, on a snapshot of the finished tree; host: Prettier and
ESLint (`--max-warnings=0`) on the changed files.

| Run                                                                                                                                                              | Result                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `planReader`, `checkPlan`, `planArchive`, `planCitation`, `autoCompact`, `geminiCodec`, `m113cLaneClosure`, `teamPlanRecord`, `paidMoneyStructure`, `genRoadmap` | 10 files, 271 passed                                                 |
| `npm run check:plan`                                                                                                                                             | `plan-format-v1; 217 milestones; 0 drift`                            |
| `npm run check:roadmap`                                                                                                                                          | `217 entries; ROADMAP.md is current`                                 |
| `npm run check:reference`                                                                                                                                        | `77 features, 71 commands, 100 settings, 29 slash, 257 CLI; current` |
| `npm run typecheck:unit`                                                                                                                                         | exit 0                                                               |
| `prettier --check` on `PLAN.md`, the three archive files and the changed documents                                                                               | clean                                                                |
| `gitleaks dir docs/plan-archive`                                                                                                                                 | no leaks                                                             |

### Drills

Both at once, on the same rig, then restored and compared by SHA-256
(`scripts/check-plan.mjs` `e5d10247…190dabcb`, `gates.md` `141e241a…fce903d`):

| Break                                                                               | Red result                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The gate's line lowered to 80% (the plan is at 82.8%)                               | `node scripts/check-plan.mjs` exits 1: `PLAN.md is 3472457 bytes, over 80% (3355443) of the plan reader's 4194304-byte bound. Move closed history to docs/plan-archive/ …`. `checkPlan`: 3 failed (the repository gate case, `passes a plan at exactly 85%`, `fails one byte over`) / 25 passed |
| One character changed inside archived block `7-0001` (`21 numeric` to `22 numeric`) | `planArchive`: 1 failed / 6 passed, `keeps every marked passage of gates.md byte for byte`: `expected [ '7-0001: sha256' ] to deeply equal []`                                                                                                                                                  |

Together: 2 files failed, 4 tests failed, 31 passed, exit 1.

## Tooling

The move was made with scripts kept outside the repository (the integrator's
scratchpad): a protection map from every open head's diff, a block mover that
writes the stubs and the archive files, the reassembly check, the reader
comparison and the merge simulation. CONTRIBUTING.md, "Archiving closed
history from PLAN.md", states the procedure they implement.

## The command (2026-10-11, same day)

The block mover, the reassembly check and the reader comparison are in the
repository now, so a lane can archive the passages of its own branch:
`npm run plan:archive` (`scripts/plan-archive.mjs`, text rules in
`scripts/lib/planArchive.mjs`; CONTRIBUTING.md, "The command"). The
protection map and the merge simulation stay with whoever moves text that
open work may touch; the command does not look at other branches.

What it adds to the first move's convention:

- A block's marker may carry `at="<commit>"`, the commit its `lines` refer
  to. The 198 blocks of the first move carry none (their file's introduction
  names `5161b6476`); `test/unit/planArchive.test.ts` reads both forms.
- A passage moved from a `PLAN.md` that differs from that commit's (a second
  move before a commit, or text a merge brought in, with `--at`) is looked up
  in the commit's file and must stand there exactly once, so `lines` is
  always true of `at`.
- A move that would change what the plan reader parses stops unless
  `--allow-fact-change` is given, and one that leaves format drift stops
  always.

`npm run plan:archive -- status` on the train at `f7b13f45e`: `PLAN.md`
3,558,627 bytes, 84.8% of the bound, 6,531 bytes under the gate's line;
`decisions.md` 51 blocks, `gates.md` 140, `milestones.md` 7, all intact.

Tests: `test/unit/planArchiveTool.test.mjs`, 28 cases: the text rules in
memory, and the command against a small plan committed in a throwaway
repository through the real plan reader (status, dry run, a decision with a
summary, a pointer at the end of the file, `--linked`, `--batch`, `--at`, the
fact and drift stops, the refusals). With `planArchive` and `checkPlan`: 3
files, 63 passed on win11; the 28 tool cases also passed on linuxlt in the
train's suite run before the command's last lint pass.

Drill (win11, both breaks at once, restored and compared by SHA-256:
`scripts/lib/planArchive.mjs` `2160a3b2…2d04508`, `scripts/plan-archive.mjs`
`e620546f…dbfda1`):

| Break                                                         | Red result                                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `putBack` no longer restores the blank line a last block took | `takes whole blocks out and puts them back, byte for byte` fails                                                                                                 |
| The fact comparison compares the old plan with itself         | `stops when the plan reader would parse something else, unless told the milestone is closed` and `takes a list of moves in the line numbers of one PLAN.md` fail |

Together: 3 failed, 25 passed, exit 1.

## Closed stubs trimmed (2026-10-11, with the command)

The plan stood 6,531 bytes under the gate's line with merges of 6.8 KB and
14.2 KB of plan text queued for the same day. The lead had approved trimming
the milestones archived on 2026-10-08 to heading, status rows and pointer;
this does it for the part no open work touches, and no further.

`npm run plan:archive -- move --batch <34 moves> --allow-fact-change` at
`bb25544b7`:

| Measure                                  | Before    | After     |
| ---------------------------------------- | --------- | --------- |
| `PLAN.md` bytes                          | 3,558,627 | 3,525,290 |
| Share of the reader's bound              | 84.8%     | 84.0%     |
| Room under the gate's line (3,565,158)   | 6,531     | 39,868    |
| Hashed blocks in `milestones.md`         | 7         | 41        |
| Bytes moved (34 blocks, 34 closed lanes) |           | 33,303    |

What moved is the leftover lane text of 34 closed sections whose full text
was already in `milestones.md`: checklists and closing notes of release,
CI-repair and review-fix lanes (INT0180, INT0160UX, QPIN, FLAKETH20, INT0170,
CI0150M/W/C/B, REL0150M, VSIXDIET2, TRAIN15A, PR132M, PROMPTMENU2, REL0142,
BADGEFIX, CIFIX14T/C/W2/M, TRAIN14B, TRAIN14A, KNIPC, DEFLAKE4, SDK142,
MACSLOW, FIXM116P4, FIXM112U, DIET1, FIXHELPREF4/3, REDHELPREF, FIXHELPREF,
HELPREF). Each block stands under its section's own heading there, with
`at="bb25544b7"`; the pointer line each section already had stays.

What stayed in those and the other archived sections: every `Goal`,
`Depends on` and `Gates` field (23 sections keep one or more), every lane
table, and every block that one of the 280 open heads touches or stands next
to (M87, ENVFENCE, TRAIN15H, CI0150L, CI0150A, FIXAGENTOUT, one block of
FIXM116P4), plus the sections tests cite (M73, M91, M93, M100, M101, M113,
M121), which were not candidates. About 40 KB stays in those fields and
protected blocks.

Proofs:

- Reassembly: the command rebuilt the old `PLAN.md` from the result,
  SHA-256 `9f833e55…7abc81`, before writing.
- Parsed facts: 33 of the 34 milestones lose checklist items (accepted for
  closed milestones); nothing else differs, drift 0, 218 milestones.
- `ROADMAP.md` regenerates byte-identical (`git status` clean for it).
- `status`: 51 + 140 + 41 blocks, all intact.
- Merge simulation, 280 open heads: conflict regions 1,010 before and after,
  branch-changed lines in conflict 107,426 before and after, clean merges 35
  before and after, heads made worse 0.

## Archive move (2026-10-14, lane TURNLIMIT)

`npm run check:plan` refused the lane's decision entry: `PLAN.md` stood at
3,565,781 bytes, 623 over the gate's 85% line (3,565,158). The move carries
two closed gate records from §7 to `docs/plan-archive/gates.md`, whose closed
sections the move leaves in place:

| Measure                                | Before    | After     |
| -------------------------------------- | --------- | --------- |
| `PLAN.md` bytes                        | 3,565,781 | 3,563,376 |
| Room under the gate's line (3,565,158) | -623      | 1,782     |
| Blocks in `gates.md`                   | 2         | 4         |
| Bytes moved (2 closed records)         |           | 2,619     |

What moved: the `REL0171B final 0.17.1 branch` paragraph (672 B) under its
own `##` heading, and the `VIS0171 0.17.1 visual refresh` paragraph
(1,947 B) under its own `##` heading, each replaced by a one-line pointer to
`docs/plan-archive/gates.md`. No test file cites either heading. No branch edits or deletes any of the
36 moved lines; two heads of one lane insert a paragraph directly before the
REL0171B record (merge-simulated below). What stayed: both closed sections, every
`Goal`, `Depends on` and `Gates` field, and every lane table.

Proofs:

- Reassembly: the command rebuilt the old `PLAN.md` from the result,
  SHA-256 `9b7bd797…7f6de1`, before writing.
- Parsed facts: byte-identical old text, drift 0, 218 milestones.
- `check:plan`: `plan-format-v1; 218 milestones; 0 drift`, 1,782 bytes of
  room.
- `ROADMAP.md` regenerates byte-identical (`git status` clean for it).
- `status`: 51 + 140 + 41 blocks, all intact.
- Merge simulation, 35 local heads (`git merge-tree` of each head onto
  synthetic pre- and post-move commits holding the lane's decision entry
  constant): 33 heads have no hunk within 3 lines of either moved block, so
  their merge outcome is unchanged by construction. The remaining 2 (one lane
  under two names, inserting a paragraph directly before the REL0171B
  record): 95 hunks and 2 conflict markers (a pre-existing, unrelated §2
  conflict) before and after; the region diff is the archive alone plus
  hunk-offset shifts, and the branch's insertion stands in the post-move
  merge. Heads made worse: 0. No head adds a `D112` heading, so the lane's
  decision number is unique.

## D108 panel-focus design record (2026-10-14, lane PRFIX160)

`npm run plan:archive -- move decisions --heading "D108 — A chat surface takes
the keyboard only while it holds it (panel-focus, 2026-10-12)" --lines
14637-14673 --summary <lane-private summary file> --allow-fact-change`
at `6409d5aad`:

| Measure                                | Before      | After     |
| -------------------------------------- | ----------- | --------- |
| `PLAN.md` bytes                        | 3,566,098   | 3,564,514 |
| Share of the reader's bound            | 85.0%       | 85.0%     |
| Room under the gate's line (3,565,158) | OVER by 940 | 644       |
| Hashed blocks in `decisions.md`        | 51          | 52        |
| Bytes moved (1 block: the D108 body)   |             | 2,388     |

`PLAN.md` keeps the `### D108` heading and one rule-in-force paragraph ending
with the archive link; the full record (the Decision paragraph and the
2026-10-14 F3 follow-up) stands under its heading in `decisions.md` between
hashed markers (`decisions-6409d5aad-14637`, SHA-256
`5e93bad2…7568`). Not renumbered: pull request 159 cites this D108, and other
unmerged lanes hold separate same-numbered additions elsewhere (provider
watch, claimsgate, ui-text, testcut, the orchestrator link) for the
integrator's renumbering.

`--allow-fact-change` was needed for two measured reasons, both unrelated to
lost information. First, `Q-M95INT2` names two different questions (lines
14476 and 14481, 361 vs 347 bytes); the script's duplicate-id comparison can
never match those, so that entry flags on every move of any line. Second,
`Q-M94d` (line 14599) greedily swallows every line to the next question item
(14711), including this D108 body, so archiving it shrinks that entry's text.
No question, status row, field, checklist or lane table was touched.

Proofs:

- Reassembly: the command rebuilt the old `PLAN.md` from the result,
  SHA-256 `791ddd05…81`, before writing.
- Parsed facts: only the two entries above differ; format drift 0,
  218 milestones.
- `npm run check:plan`: `plan-format-v1; 218 milestones; 0 drift`.
- `npm run roadmap:generate`: `ROADMAP.md` regenerates byte-identical
  (`git status` clean for it).
- `npm run check:reference`: current (73 features, 65 commands, 89 settings).
- Plan suites, repo default timeouts: `planArchive`, `planReader`,
  `checkPlan` (84), `planCitation`, `autoCompact`, `geminiCodec` (112),
  `m113cLaneClosure`, `teamPlanRecord`, `paidMoneyStructure` (50).
- Branch check: no local branch's `PLAN.md` diff touches the moved body
  lines (the panel-focus `landFocusRequest` / `FOCUS_REQUEST_WINDOW_MS` text
  appears in none); the same-numbered additions stand elsewhere.
- `status`: 52 + 140 + 41 blocks, all intact.

## Closed §6 sections and older §7 records (2026-10-14, with the command)

The plan stood 1,546 bytes under the gate's line. Two `move --batch` runs
(each `--dry-run` first, each proven byte for byte by the command before
writing) archive closed history, oldest first, staying at least 20 lines
from every range the lane brief lists as touched by open branches, and
leaving §2, §10, the test-cited sections (M73, M91, M93, M100, M101, M113,
M121) and every section with open checklist items or an active status
(M71, M77, M80, M87, M88, M94, M95, M96, M97, M102, M103, M104, M105, M106,
M107, M108, M109, M110, M111, M112, M114, M115, M116, M117, M118, M120,
M123, M125, M96b/c/d, M87–M88 and M60–M66 groups) in place.

| Measure                                | Before    | After     |
| -------------------------------------- | --------- | --------- |
| `PLAN.md` bytes                        | 3,563,612 | 3,502,761 |
| Share of the reader's bound            | 85.0%     | 83.5%     |
| Room under the gate's line (3,565,158) | 1,546     | 62,397    |
| Hashed blocks in `milestones.md`       | 41        | 80        |
| Hashed blocks in `gates.md`            | 140       | 157       |

Batch 1 (commit `c54550e6`, at `898a26c5e`): 39 blocks, 29,306 bytes, the
bodies of 17 closed §6 sections whose stubs keep the heading, status rows
and pointer — the eight provider-wizard lanes built for 0.17.1 (PROVWIZ10,
PROVWIZ9, PROVWIZ8, PROVWIZ7, PROVWIZ6, PROVWIZ2R5, PROVWIZ2R4, PROVWIRE),
the M53 and M26 follow-ups (merged/built), TRAIN13B (certified), M119
(released in 0.16.0), MUSE143, DEP138, FLAKEMERGE, SECWINPATH2, SECWINPATH.
Parsed facts change only in the seven closed checklists that moved with
their lanes (accepted for closed milestones); drift 0; reassembly
identical (SHA-256 `5bcf5572…bd63c2`).

Batch 2 (this commit): 17 blocks, 35,331 bytes, older §7 gate records of
verified lanes — FIX0160X, DEP138, MACSLOW, INT0170B, DIET1, FIXHELPREF4,
FIXHELPREF, HELPREF, CIFIX14C (both copies), CIFIX14W2, FIXVSIX2, TRAIN14B,
DEFLAKE2/3 (both copies), DEFLAKE5, the QPIN verification body, the 0.15.0
CI-repair and train records (CI0150M/W/L, FIX0150R/P, CI0150A, TRAIN15A/B),
CIFIX14T (both copies plus the delegation duplicate), TRAIN13B, TRAIN13,
MG87b/c, TRAIN15E (both, plus the SSH-race note), TESTWARM, PROMPTMENU2,
RELFAST3/2. Each leaves one pointer line; the §7 pointer paragraph stands.
Parsed facts identical; drift 0; reassembly identical
(SHA-256 `77c9bf94…0172d4d`).

Kept in place: every `Goal`, `Depends on` and `Gates` field, every lane
table (including the M91, M93 and M100 tables the tests read), the M121
sanctioned-money paragraph the money citations read, the M95/M96/M101
plan passages the codec, team-record and closure tests read, and every
record of an active or unreleased milestone thread (M95, M96, M97, M98,
M100, M101, M102, M105, M106, M108, M109, M112, M113, M114, M115, M116,
M123, PROVWIZ qualifications, CIFIX017, M123 and MENUFAN lanes).

Gates: `prettier --check` on `PLAN.md` and both archive files; `npm run
check:plan` (218 milestones, 0 drift); `npm run check:roadmap` (218
entries, current); `npm run check:reference` (current); the nine
plan-reading suites green at repository timeouts — planReader (49),
planArchive (7), planCitation (19), checkPlan, autoCompact, geminiCodec
(121 together), m113cLaneClosure, teamPlanRecord, paidMoneyStructure
(50 together): 246 passed.

The lane's 3,200,000-byte target is not reached, and cannot be reached
under the archive rules: the only other closed §6 bodies (PORTS017, M122,
INT0180B, M92) keep fields, status rows or open items in inseparable
blocks, and every §6 section over 15 KB is an
active milestone, a test-cited section, or the section M71 that stays as
the VS Code record. §10 cannot supply the rest: the roadmap gate hashes
its records, `planReader` requires the 0.11.0 release record, and
CONTRIBUTING bars §10 moves. About 300 KB more would need archiving
active sections, which is the lead's call.

## Cold-thread §7 lanes and M91 prose (2026-10-14, with the command)

A re-survey for the remaining 3,200,000-byte target moved one more
`--batch` run (`--dry-run` first, proven byte for byte): 16 blocks,
67,447 bytes, PLAN.md 3,502,761 → 3,436,064 bytes (83.5% → 81.9%;
129,094 bytes of room). Parsed facts change only in closed M91 (accepted);
drift 0; reassembly identical (SHA-256 `26615309…5a71`).

To `gates.md` (9 blocks): the M116 playbook lanes (REDM116P, M116-U),
the M105 multimodal lanes (FIXM105E3, W, M1 ×2, E1–E3, M2, F, FIXM105C,
FIXM105R1, R2, R3, R3B, R3-host-api), the M106 lanes (FIXM106S,
M106T-MODELAPI-BUDGET), the M108 account lanes (FIXM108U/H/P/P2/T/K,
M108-X), the M96 team lanes (FIXM96B, M96CINT, FIXM96CT2/CC/CO) and the
M101 lanes (M101INT, FIXM101C2/P1/P2) — all October 4–7 lanes of released
milestones, verified and with no follow-up thread. Each leaves one
pointer line.

To `milestones.md` (7 blocks, 42,410 bytes): the prose of closed M91
(captures, Lane P corrections, helper turns, event behaviour, Steps,
Acceptance). The stub keeps the heading, the status rows, the Goal block
and the lane tables the tests read (`planReader` still finds M91's lanes).

Still kept: the M95/M96 plan cluster in §7 (Goal, Lanes and lane tables
fused with hot-thread records), every record of an unreleased milestone
(M97, M98, M100, M102, M104, M109), the hot-thread lanes (M112, M113,
M114, PROVWIZ, CIFIX017, M123, MENUFAN), the October 8–11 records,
KNIPC/DEFLAKE4 (fused in one block with M96's record), STAR (unknown
milestone), all of §10 (the roadmap fingerprint covers every §10 record;
regenerating it would rewrite ROADMAP.md), and every §6 section with open
items or an active status.

Gates re-run green after this move: `prettier --check`, `check:plan`
(218 milestones, 0 drift), `check:roadmap` (218 entries, current),
`check:reference` (current), `status` (51 + 166 + 87 blocks, all intact),
and the nine plan suites (246 passed at repository timeouts).

Even moving every remaining §7 record (about 150 KB including current
and unreleased threads) would land near 3.29 MB; 3.20 MB needs active
§6 sections as well. The plan now has 129 KB of room instead of 1.5 KB.
