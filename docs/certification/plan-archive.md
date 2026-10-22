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

## D108 panel-focus design record (2026-10-14, lane PRFIX160)

Renumbered D116 on 2026-10-15: D108 was also the test overhaul's decision, and both merged with pull request 172. The archived body below the hashed markers keeps its original text.

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

## D122 design record (2026-10-17, branch ci/org-capacity)

The branch had added D122 after D116, inside §3, where `Q-M94d`'s entry
swallowed it (the reason D116's move needed `--allow-fact-change`). Commit
`a9720961e` moved the D122 block unchanged to the end of §2; then
`npm run plan:archive -- move decisions --heading "D122 — CI capacity from a
second account; the project stays here (owner, 2026-10-16; redesigned
2026-10-17)" --lines 14396-14449 --summary <private summary file>` ran at
`a9720961e` without `--allow-fact-change`:

| Measure                                | Before    | After     |
| -------------------------------------- | --------- | --------- |
| `PLAN.md` bytes                        | 3,446,809 | 3,444,329 |
| Share of the reader's bound            | 82.2%     | 82.1%     |
| Room under the gate's line (3,565,158) | 118,349   | 120,829   |
| Hashed blocks in `decisions.md`        | 52        | 53        |
| Bytes moved (1 block: the D122 record) |           | 3,534     |

`PLAN.md` keeps the `### D122` heading and the rule in force, ending with the
archive link; the record (why, the replaced first design, the design in
force, what was weighed) stands in `decisions.md` between hashed markers
(`decisions-a9720961e-14396`, SHA-256 `86987020…503f`). D122 exists only on
this branch, so no other branch's `PLAN.md` touches it.

Proofs: reassembly identical to the old `PLAN.md` (SHA-256
`de9325f3…bbef`) before writing; parsed facts identical, format drift 0;
`prettier --check` on both files, `check:plan` (218 milestones, 0 drift),
`roadmap:generate` (`ROADMAP.md` unchanged), `check:reference` (current),
`status` (53 + 168 + 87 blocks, all intact), and the plan suites that remain
after PR #183 (`planReader`, `planCitation`, `autoCompact`,
`paidMoneyStructure`: 129 passed).

## D123 design record archived (2026-10-14, lane PRFIX159; renumbered from D108 on the 2026-10-17 merge with main)

Review finding 4273569038: the branch added its decision straight to
`PLAN.md` §2 with its full record inline, but new design records belong
in `docs/plan-archive/decisions.md` in the same change. The move keeps
the heading and the rule-in-force paragraph in `PLAN.md`. The record
was numbered D108 on the branch; main's D108 is the test overhaul, so
the merge renumbered this decision D123 in `PLAN.md`, the archive
heading and the code citations. The hashed archive body is unchanged.

`npm run plan:archive -- move decisions --heading "D108 — The provider
judges a key; no key is refused for its shape (lane PROVKEYS,
2026-10-12)" --lines 14315-14336 --summary temp/d108-summary.txt`
at `a64aebd4a`:

| Measure                                | Before    | After     |
| -------------------------------------- | --------- | --------- |
| `PLAN.md` bytes                        | 3,565,134 | 3,564,632 |
| Share of the reader's bound            | 85.0%     | 85.0%     |
| Room under the gate's line (3,565,158) | 24        | 526       |
| Hashed blocks in `decisions.md`        | 51        | 52        |
| Bytes moved (1 block)                  |           | 1,420     |

The block stands under `## D123` there as
`decisions-a64aebd4a-14315` (`lines="14315-14336"`,
`sha256="04385ca919235e6aea41a6ba2fb179aa3a925a792ef99a07cfd37c0741652958"`).

Proofs:

- Reassembly: the command rebuilt the old `PLAN.md` from the result,
  SHA-256 `97943e29d03e87261052a963a949d1671b868f2da2ced31af1d92b489b0c93d4`,
  before writing.
- Parsed facts: identical; format drift after: 0.
- `npm run check:plan`: `plan-format-v1; 218 milestones; 0 drift`, exit 0.
- `npm run roadmap:generate`: 218 entries, `ROADMAP.md` byte-identical.
- `npm run check:reference`: current, exit 0.
- `npx prettier --check PLAN.md docs/plan-archive/decisions.md`: clean.
- Suites that read the plan, all green at the repo default timeout on
  the branch: `planArchive` (7), `planReader` (49), `checkPlan` (28),
  `planCitation` (19), `m113cLaneClosure` (2), `teamPlanRecord` (2),
  `autoCompact` (26), `geminiCodec` (67), `paidMoneyStructure` (46).

## PLANFIX0190: d13baec65 reverted, 46 M95-K records re-verdict, closed-history batch (2026-10-20)

`d13baec65` moved 46 records from the M95-K residuals (§7/§9) to
`milestones.md` with `--allow-fact-change` while M95 still builds; the
records name open follow-ups, handoffs and residuals in their own words.
Step 1 reverted that commit (`406932fef0`): `PLAN.md` and
`docs/plan-archive/milestones.md` are byte-identical to `d13baec65^`
(`git diff e4d3bd922d HEAD` empty for both files); the reverted
certification note's claims are superseded by the verdicts below.
`PLAN.md` back to 3,580,933 bytes (85.4%, 15,775 over the gate); all
hashed blocks intact (`status`: 118 + 241 + 182, the reverted 46 gone).

### The 46 verdicts (closed only when the record's own words say the work is done and name no follow-up, handoff, pending item, residual or "remains"; in doubt, open)

Open (38, stay in PLAN.md):

- K22 resolved: OPEN — "Full composed certification still belongs to the lead".
- K-recovery: OPEN — "Shared-store crash atomicity remains follow-up"; serialization "awaits PROVSTORE-LOCKLIB after M123".
- FIXM118INT: OPEN — "existing M118 editor/CI dependencies below remain unclaimed".
- FIXM118C: OPEN — "Existing C/W/X wiring and editor certification handoffs remain as named".
- FIXM118P: OPEN — "installed native-editor parity still waits on M104".
- M107-W-DK4-review-block: OPEN — receipts "remain named qualifications, not clearance of production disk cleanup".
- M116-U RVM116U2: OPEN — "Existing P/I/W integration handoffs below remain open".
- M116-U RVM116U: OPEN — P/I bindings and W registration "remain the previously named integration handoffs".
- M116-L0: OPEN — "Follow-up: P/I prove these invariants with real policy tests and restart tests before W certifies".
- FIXM115S: OPEN — tests "do not certify U/D's durable target ledger or W's shipping editor bindings and full platform quality matrix"; "U/D/W bind the status to existing surfaces".
- FIXM115U6: OPEN — "Follow-up is a dependency-complete guarded editor port"; "W/lead owns aggregate quality and unrun integrations".
- FIXM115U5: OPEN — ports "retain all editor/runtime handoffs"; "W/lead owns aggregate quality".
- FIXM115E-SharedStoreBinding: OPEN — "Follow-up: real multi-process and crash/reopen receipts before shipping".
- FIXM115V: OPEN — "Follow-up: W merges HELPREF and registers the page"; "Aggregate quality/platform/live proof stays with W/lead".
- ENVFENCE-HELPREF (inherited): OPEN — "Follow-up: add the setting to HELPREF's catalogue".
- FIXM102J: OPEN — "combined editor wiring and full quality remain lead/W work".
- M96 U2: OPEN — "Lanes T/A/W must fill the new internal UI fields and send clearTeamTree".
- FIXVSIX2: OPEN — "The existing integrated-release quality/platform checks remain with the lead".
- FIXM117C: OPEN — "W must expose the journal's skippedRecords diagnostics"; "remain lead-owned handoffs".
- FIXM117S: OPEN — "M117-S-cross-rig-and-W-bindings remains an integration handoff".
- FIXM117R: OPEN — existing S/C, fleet/catalog, U disclosure and W shipping/product-doc bindings "remain explicit".
- FIXM117L0: OPEN — missing estimates and existing bindings "remain the named integration handoffs"; "lead owns aggregate quality and cross-rig certification".
- FIXM117U: OPEN — "the known W-owned host-API record gap is unchanged".
- M113-P: OPEN — quality, wiring and manifest keys "remain the lead/W handoff".
- M113-K: OPEN — manifest and host-api-record "remain W's gate handoffs; W wires the manifest and regenerates the inventory before full quality".
- M113-R: OPEN — scrub limit and W's shipping/product-doc/integration-gate handoffs "remain".
- M113-V: OPEN — "W must bind that slot"; W/X handoffs "stay open".
- M113-X: OPEN — S/K/H bindings, native/companion/TUI/desktop receipts and W integration "remain named handoffs".
- M113-H: OPEN — W-owned bindings and fleet gates "remain integration handoffs".
- M113-N4: OPEN — captures/wiring/lazy-bundle and W's public handoffs "remain".
- M113-N2: OPEN — N-captures/storage/wiring/lazy-bundle and W documentation/quality handoffs "remain".
- M113-N: OPEN — handoffs "remain with their named owners"; "W retains unused manifest-key wiring and host API regeneration, public documentation and the lead's full integrated quality run".
- M113-L0: OPEN — "Existing implementation handoffs remain with P/S/K/R/N/H/X/W".
- FIXHELPREF4: OPEN — "Arbitrary prose truth still needs an owning source audit".
- FIXHELPREF3: OPEN — boundary and "the lead's integrated quality gate remain outside this scoped rig certification".
- FIXM109B2: OPEN — "B's existing unbound C/P/T/route, Windows, all-editor and W/full-quality handoffs remain open".
- FIXM109B: OPEN — "B's existing C/P/T/route, Windows, all-editor, audit-contract and W/full-gate handoffs remain open".
- FIXM106O22: OPEN — ownership handoffs "remain in force"; "Follow-up: W adopts the same record preflight".

Closed by their own words (8), all in §9, none archived: §9 never moves
(reader parses it as residuals facts, `/report` diffs it, lanes work in
it; the script refuses without `--allow-fact-change`, which is for closed
milestones only, and M95 is open):

- FIXM115E-LegacyIdentityAmbiguity: CLOSED — repair complete ("Migration conservatively rejects both candidates, as its regression proves"); the S/W sentence is a conditional guard, no remaining work named.
- FIXM102E: CLOSED — "both assigned P2 findings are repaired ... no assigned review finding is deferred".
- FIXM117I: CLOSED — "Nothing deferred".
- M113-R2: CLOSED — "The single P2 is fixed; no review finding is deferred".
- M113-H2: CLOSED — "no review finding is deferred".
- M113-L02: CLOSED — "fixed with no review residuals".
- ENVFENCE-HELPREF (REL0142): CLOSED — findings "remain fixed"; no follow-up named in the record.
- M91-W-knip-constants: CLOSED — "Resolved by fix/knip-constants ... drills exit 1"; no remaining-work language.

Archived from the 46: none. Every archived pointer `d13baec65` added is
gone with the revert.

### Step-3 batch: 7 closed §2 design records to decisions.md (no --allow-fact-change; facts identical)

`node scripts/plan-archive.mjs move --batch temp/planfix0190/moves-step3.json`
at `406932fef`: 7 blocks, 6,974 bytes gross.

- D63 (3479-3503, summary): M86 restore design; branches merged, m86.md certifies; no open branch touches it (full-history `-G` hits are merged history plus byte-identical `move-snap/*` restores); no test cites the body.
- D5 bullets (936-960, pointer): 2026-09-21 pattern superseded by D108; rule paragraph ("Superseded ... What stays") and heading stay.
- D2 (684-693, summary): Model API client; implemented; untouched since 2026-09-21; code cites the decision heading, which stays.
- D8 (2444-2449, summary): attachments/host/header parsing; implemented.
- D9 (2453-2460, summary): mention index; implemented.
- D71 SDK list (7161-7176, pointer): ESP32/Linux SDK context for shipped M92; Decisions list (rules in force) stays.
- D117 Cause (14803-14813, pointer): 2026-10-12 incident record; Rule in force and 2026-10-17 amendments stay.

Excluded with reasons: every other un-archived §2 decision is live
(D1/D3/D4/D6/D7/D30/D34/D44/D48/D60-D62/D65/D75/D77/D78/D100/D102/D104/
D106/D107/D119/D121/D207/D208), open-lane (D74/D80-D99/D103), test-cited
or keep-listed (D3/D6/D30/D1/D7/D73-pack-default/M101-P1/M113-closure/
team phrases/M121 clauses/M91-M93-M100 lane tables), fresh (D209-D211),
or names pending/open work itself (D10/D64/D118-amendments/D204).
§6: every remaining closed section is already a stub; all movable-looking
prose is glued to keep-listed status/Goal/table rows (M1-M6 Delivered
paras, M118 Scope/Settings/Lanes, M122 Sections/Gate, M44b folded para)
or names open items (M73 "Not built", M99 unchecked VSIX item, M92/M35
owed receipts, M90/M46/M83/M84 already archived). Lane tables stay (the
estimator fixture asserts every lane id). §7 holds only the QPIN stub and
the open M95-K residuals. Never §3/§8/§9/§10, D3, D6.

Proofs: reassembly identical (SHA-256 `15ab52a7…`), parsed facts
identical, format drift 0, `prettier --check` clean, `check:plan` runs,
`roadmap:generate` writes 222 entries with `check:roadmap` current and
`ROADMAP.md` byte-identical, `check:reference` current (83 features,
65 commands, 101 settings).
Suites at the repo default timeout, all green: `planReader` +
`planCitation` + `autoCompact` (89 passed), `paidMoneyStructure` +
`sharingArtifacts` + `estimatorPlanSnapshot` (79 passed),
`estimatorPlanSnapshotRealPlan` + `estimatorPlanSnapshotSource` +
`estimatorSnapshotStrict` (73 passed).
`status`: decisions 125 blocks, gates 241, milestones 182, all intact.

### Step 4: closed history cannot give the room

`PLAN.md` 3,580,933 → 3,574,749 bytes (85.2%; 6,184 saved). Still OVER
the 85% gate (3,565,158) by 9,591 bytes; 13,591 bytes short of 4,000
under it (≤ 3,561,158). Stopping here per the brief: the size sits in
open work — the §9 M95-K residuals list (~44 KiB, incl. the 38 open
records above), the open M95 (92 KiB), M96 (184 KiB), M96c (76 KiB) and
M100–M117 milestone sections, M73's 3.1 KiB Status block, M118
(7.1 KiB, open bindings), M122 (2.5 KiB). The lead decides.

## PLANFIX2: open-record history moves with summaries, plan under the gate (2026-10-20)

The lead's ruling for this lane: open work stays in `PLAN.md`, but the long
history inside an open record (earlier rounds, finished sub-steps, proofs,
commit lists) may move to the archive with `--summary`, leaving a short
paragraph that keeps every open item of that record (what is still open, who
owns it, the next step, in the record's own words where possible) plus
`Full record: <link>` — allowed only when the plan reader's parsed facts stay
identical (no `--allow-fact-change`; a refusal leaves the record whole).
§9 stays whole: the reader parses its bullets as residuals facts, so any
§9 move refuses without `--allow-fact-change`. §7 is parsed as no facts, so
its bullets move freely; §6 milestone prose that is not a status row, field,
lane table or checklist item moves freely too.

`node scripts/plan-archive.mjs move --batch temp/summaries/moves.json`
(dry-run first, identical report) at `5cf2e1004`: 14 blocks, 25,290 bytes
gross, 3 entries.

| Measure                                  | Before                | After               |
| ---------------------------------------- | --------------------- | ------------------- |
| `PLAN.md` bytes                          | 3,574,749             | 3,556,659           |
| Share of the reader's bound              | 85.2% (OVER by 9,591) | 84.8% (8,499 under) |
| Room to the brief's target (≤ 3,561,158) | 13,591 short          | 4,499 inside        |
| Hashed blocks in `gates.md`              | 241                   | 252 (+11)           |
| Hashed blocks in `milestones.md`         | 182                   | 185 (+3)            |

- Entry 1 (gates, `## M95 K repair residuals (2026-10-05)`, 11 blocks,
  5,910 bytes): the §7 K-bullet history (K22, K-contract, K-recovery,
  K-release-base merge, K-hook verification, K-final-runtime,
  M95MU-HOST-API-RECORD, M95-H, FIXM95O, RVM95SC-R-host-api-record,
  RVM95SC-R-shell-env; old lines 35371–35461). The stub is the summary at
  §7 lines 35203–35251, keeping every open item.
- Entry 2 (milestones, `## M123 — Git and pull requests in every editor
(D104)`, 2 blocks, 8,806 bytes): lane A landed plus reviews RVM123A and
  RVM123A2 (old lines 17323–17432, 17434–17458). The stub is the summary at
  M123 lines 17323–17348, keeping every open item.
- Entry 3 (milestones, same heading, 1 block, 10,574 bytes): reviews
  RVM123A3 and RVM123A4 with the logout-barrier state table (old lines
  17460–17537). The stub is the summary at M123 lines 17350–17366, keeping
  every open item.

Kept in place verbatim: the §9 M95-K list (66 bullets, still whole), the §7
generic gate bullets (M67…repository protection, 35255+), the §7 `Archived`
pointers, M123's status rows, Goal/Depends on/Order, lane tables, checklists,
Not-yet-shipped lists and acceptance rows.

### Every open item and where it now stands (quoted)

Entry 1's summary (§7, from line 35203):

- K22: "full composed certification still belongs to the lead" (35205).
- K-contract: "M must adopt strict `providers/edit` and scoped prefill
  variants, with the follow-up to certify the final composed protocol/editor
  flow" (35208–35209).
- K-recovery: "same-host snapshot comparisons remain, cross-window
  provider/key serialization awaits PROVSTORE-LOCKLIB after M123, and
  shared-store crash atomicity remains follow-up" (35211–35212).
- K-release-base merge: "the lead must reconcile the release base on
  integration ... and full certification stays open" (35215).
- K-hook verification: "it requires the closing commit's positive
  lint/Gitleaks receipt" (35219).
- K-final-runtime: "leaves live setup/OAuth/discovery, unsaved-draft scan
  cancellation, four themes, pseudo-locale and 320px as integration gates"
  (35220–35221).
- M95MU-HOST-API-RECORD: "lane W and the lead must regenerate and review it
  on the fully integrated tree where lane K also contributes APIs, and the
  full quality gate remains required before integration is proposed"
  (35226–35227).
- M95-H: "lane W registers Chat, lane I supplies its caller's vision
  capability and tools-retaining compaction body, then the lead runs full
  integrated quality and live acceptance" (35229–35230).
- FIXM95O O-INTEGRATION: "remains an integration acceptance limit since the
  codec is currently imported only by its owned test" (35234); "the follow-up
  that lane T/I inject a stable, session-unique response ID and wire the lazy
  codec bundle while the lead proves the complete provider turn/reload/resume
  flow and full quality" (35236–35237); O-SPLIT: "lane W enforcing the planned
  separate codec bundle without exemptions or weakened guards" (35239);
  O-HOST-API: "lane W regenerating and reviewing the record before milestone
  certification" (35241); "both are observed gate failures, not green gates"
  (35242).
- RVM95SC-R-host-api-record: "leaves the host API gate red"; "aggregate
  certification stays open"; "lane W with the lead must regenerate, inspect
  and recheck the record" (35243–35246).
- RVM95SC-R-shell-env: "an open gate, not newly accepted risk"; "lane I/X/W
  must decide intended inheritance versus stripping and test the shell
  boundary before broader provider security certification" (35247–35250).

Entries 2–3's summaries (M123, from line 17323):

- Lane A revocation docs: "the lead re-reads and dates it" (17337); "no live
  sign-in is allowed without the lead" (17339).
- Residual cross-process windows (A–A2): "closing the windows needs an atomic
  store or a cross-process lock, and neither the keychain binding nor the M109
  vault port offers one" (17346–17347).
- A4 overlap: "not closable over this store ... a store with no notification
  or lock cannot close it" (17359–17362); residual windows "each lose a pair
  while none serves a pair issued before a Sign out" (17364–17365).

### Proofs

- Reassembly: the command rebuilt the old `PLAN.md` from the result,
  SHA-256 `e4d15473…`, before writing.
- Parsed facts: identical (dry-run and write runs); format drift after: 0.
- `npx prettier --check PLAN.md docs/plan-archive/gates.md
docs/plan-archive/milestones.md`: clean.
- `npm run check:plan`: `plan-format-v1; 222 milestones; 0 drift`.
- `npm run check:roadmap`: 222 entries, `ROADMAP.md` current (no regenerate
  needed; no §10/heading/status change).
- `node scripts/plan-archive.mjs status`: decisions 125, gates 252,
  milestones 185 blocks, all intact.
- Suites at the repository's own timeout (no `--testTimeout`): `planReader` +
  `planCitation` + `autoCompact` (89 passed), `paidMoneyStructure` +
  `sharingArtifacts` + `estimatorPlanSnapshot` (79 passed),
  `estimatorPlanSnapshotRealPlan` + `estimatorPlanSnapshotSource` +
  `estimatorSnapshotStrict` (73 passed), `planDocument` (19 passed).

## 2026-10-21: room for the 0.19.0 release record

The 0.19.0 release record put `PLAN.md` at 3,566,310 bytes, 1,152 over the
`check:plan` gate (85% of the 4 MiB bound, 3,565,158). Two §7 gate records
of closed lanes moved to `docs/plan-archive/gates.md` with a pointer each;
no test, script or open branch cites or touches them (PR #252 changes §3 and
§6 only), and both milestones shipped:

| Block                                        | Lines (at `4e09cab6e`) | Bytes | SHA-256     |
| -------------------------------------------- | ---------------------- | ----- | ----------- |
| CIFIXV hosted visual repair (2026-10-09)     | 34544–34567            | 1,646 | `3b0e0461…` |
| M121A rounds 3–4 gate ownership (2026-10-09) | 34524–34540            | 1,287 | `66f4036a…` |

After: 3,563,591 bytes, 1,567 bytes under the gate.

### Proofs

- Reassembly: the command rebuilt the old `PLAN.md` before each write,
  SHA-256 `8bc0b6ef…` and `6719195b…`.
- Parsed facts: identical; format drift after: 0.
- `npx prettier --check PLAN.md docs/plan-archive/gates.md`: clean.
- `npm run check:plan`: `plan-format-v1; 222 milestones; 0 drift`.
- `npm run roadmap:generate`: `ROADMAP.md` unchanged.
- `npm run check:reference`: exit 0.
- `planReader` + `planCitation` + `autoCompact` + `paidMoneyStructure`: 135
  passed.

## 2026-10-22: room for the RLACP join (lane RLACP)

The RLACP join's D212 decision record put `PLAN.md` at 3,567,376 bytes,
2,218 over the `check:plan` gate (85% of the 4 MiB bound, 3,565,158). The
record moved to `docs/plan-archive/decisions.md` in the same change, as the
standing rule requires of a new design record; `PLAN.md` keeps the rule in
force with `Full record` pointing at it:

| Block                 | Lines (at `62a29535c`) | Bytes | SHA-256     |
| --------------------- | ---------------------- | ----- | ----------- |
| D212 ACPGAPS decision | 15270–15314            | 2,881 | `c78b2811…` |

After: 3,564,873 bytes, 285 bytes under the gate.

### Proofs

- Reassembly: the command rebuilt the old `PLAN.md` before the write,
  SHA-256 `31bca438…`.
- Parsed facts: identical; format drift after: 0.
- `npx prettier --check PLAN.md docs/plan-archive/decisions.md`: clean.
- `npm run check:plan`: `plan-format-v1; 223 milestones; 0 drift`.
- `npm run roadmap:generate`: `ROADMAP.md` rewritten for the lane's own
  `entries.json` change (ACPDOG entry added), not for the archive move.
- `npm run check:reference`: exit 0.
- `planReader` + `planCitation` + `autoCompact` + `paidMoneyStructure`: 135
  passed (after the numeric-cost rework below, which the joined branches
  forced: the money gate fired before this record was written).
