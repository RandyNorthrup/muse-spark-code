# M103INT — integration, interfaces and strings

Kubuntu, 2026-10-05. Base `6fb6f0f924`, branch `m103/int`. The requested
`plan/m103-m104` ref is absent on this rig; `m103/sfix:PLAN.md` contains the
complete D83/M103 decisions and lane table used here. No guard branch,
main/release merge, push, rebase, physical hardware, credential read or model
call. Model attempts and paid calls: **0**. No dependencies installed so far.

## Merge receipts

Each merge used `git merge --no-ff`, with hooks enabled and the Codex trailer.

| Lane | Merge commit | Conflicts and resolution                                                                                                                                                                                                                                                                                           | Owning suites                                                                                                         |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| S    | f4d2949f7    | PLAN and CHANGELOG: preserve both decisions and release history                                                                                                                                                                                                                                                    | installer/skills: 59 pass                                                                                             |
| D    | 8e1b1ad6f    | PLAN and CHANGELOG: keep both correction/qualification records                                                                                                                                                                                                                                                     | detector/presets/Pi: 75; catalogue/I/O/skills: 36 pass                                                                |
| P    | 556c46ff8    | PLAN and CHANGELOG: keep lease corrections and safety records                                                                                                                                                                                                                                                      | lease/ports/session: 50; serial/adapters: 17 pass                                                                     |
| M    | 56caebdaf    | PLAN: preserve both audit/arc safety corrections and residuals                                                                                                                                                                                                                                                     | G-code/machines/registry: 228; CAD: 21 pass                                                                           |
| X    | 9138de1cd    | PLAN, CHANGELOG, README: preserve release badge guidance and add rig instructions                                                                                                                                                                                                                                  | lifecycle: 5 pass; opted-in board matrix: 17 fail because this worktree has no tools/images cache                     |
| A    | 337aee9f7    | PLAN, CHANGELOG, manifest, packaging allowlist, Knip, build/split/size/global scripts, en and all 14 translations, host inventory, integration imports, bundle-size tests: preserve both features; add verifyEditor to the current shared split list; retain hashed browser chunks and use Arduino profile targets | board/build/host: 30; editor/JSON/lazy-loader: 70; settings/language/walkthrough: 30; budgets/package/splits: 57 pass |
| T    | 99585cfe2    | PLAN and CHANGELOG: retain context-only Thonny hand-over design and prior records                                                                                                                                                                                                                                  | existing Python 3.14/pytest 9 environment: 190 pass                                                                   |

The first A host fixture run lacked `dist/test/integration`; building with
`--production --integration-tests` makes all 30 cases pass. The first split
run exposed a missing verifyEditor build fixture; adding the real entry
restores the gate. A packaging run overlapped the T documentation merge and
read conflict markers; after files settled its entire suite passes. No test
filter, timeout increase, skip or gate relaxation was added.

Every vitest run uses at most three files, `--maxWorkers=3` and
`--testTimeout=120000`; logs are in this worktree's ignored `temp/`.

## Build receipts after each merge

Every `npm run build` exited zero, including caps, split, globals and notices.
Sizes are KiB; unchanged caps: activation 600, Model API 475, checkpoint 225,
webview startup 900, ACP 850, verification 25.

| Merge | Activation | Model API | Checkpoint | Webview startup |   ACP | Verification |
| ----- | ---------: | --------: | ---------: | --------------: | ----: | -----------: |
| S     |      438.4 |     446.9 |       76.9 |           792.2 | 818.2 |            — |
| D     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| P     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| M     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| X     |      438.4 |     447.0 |       76.9 |           792.7 | 818.2 |            — |
| A     |      434.0 |     447.0 |       76.9 |           792.9 | 818.2 |         22.2 |
| T     |      434.0 |     447.0 |       76.9 |           792.9 | 818.2 |         22.2 |

## Integration split drill

Remove the verification files from the shared deferred manifest, run the
complete `deferredBundles.test.ts`, observe both verification regression
assertions fail (2 failed / 26 passed), then restore byte-exact. SHA-256:
`cfa75e01bbe5d18f2343e7de775f5652d7a33ac4e813ed7eeba6516cee6f4c64`.
This proves the new split-fixture cases exercise the production rule.
The normal build passes with verification 22.2/25 KiB and activation shrinks.

## Pending qualification

The X opt-in run was attempted with all tests enabled: 17 failures name
missing worktree-local emulator tools, ELF/UF2/images and the IDF app. Its
previous lane receipts remain historical; this trunk has no fresh board
qualification. No other lane's private cache was read. G joins later;
U/V/R, W packaging/wiring and E's editor/physical/live evidence remain open.
Full `npm run quality` is explicitly prohibited by this brief and remains
with the lead. The host API inventory was regenerated and reviewed after A:
342 APIs, 33 VS Code importers, 26 Node built-ins, 61 theme variables, zero
problems. Native Arduino installation/qualification and cross-OS receipts
remain the inherited lane A/E obligations.
