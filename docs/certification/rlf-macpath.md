# RLF-MACPATH — the spaces app-data path stays whole (2026-10-22, macmini)

Recovery lane. Base: int/recovery at 3198954c91 (main 0.19.0). Branch
`rec/rlf-macpath`. Rig `macmini`.

## Finding

The fleet's strays are an unquoted shell expansion of the spaces
app-data path, not a product split. Surveyed on this rig:

- `RLM95/`: `Support/Muse`, `Spark`, `Code/resource-created/trees/muse-tree-0c7d29c4-…/m03`
  (dirs, 700, 2026-10-22 02:25:53, no marker file in the tree).
- `RLF-NOLIMITS/`: empty FILE `Spark` (600, 18:08:39) plus
  `RLF-NOLIMITS.app/home/Library/Application` (empty file, 600, same second).
- Six more lane homes (`AUDITTESTS`, `MSM105`, `PR206FIX`, `REALUSE190`,
  `RLVAULTCI`, `VAULTOPEN`) hold an `Application` dir from Oct 17/18/21;
  `RLACP`'s holds a fetched HTML page (46,323 bytes, word 1 only) and
  `RLM95`'s a repo file listing (5,543 bytes, word 1 only).
- The tails (`m03`, `short-tmp`) and the file contents exist nowhere in
  the repository: they are operator artifacts.

Every product path that could split was audited and splits nothing: the
registry uses only Node fs APIs; the native helper
(`native/darwin/MuseSparkCreated.c`, incl. `MuseSparkWorkerFile.c`) takes
argv and works fd-relative; every spawn goes through `execFile`/`spawn`
with argument arrays (`guardedChildProcess.ts`, `trees/run.ts`); every
shell string interpolates through `posixQuoted`/`powerShellQuoted`
(`museResourceLaunch.ts`, `createdPathCommands`' Windows branch,
`checkCommands.ts`, the M91 shell trailer, device workers, schedule and
launchd plists, git runners); all `.sh` file operations quote their
variables; no `shell: true` and no `exec(` exist in `src/`, `scripts/`
or the test helpers. The registry already refuses a relative file or
tree base before writing anything (`createdRegistry.ts`, thrown since
33c58f64e); this lane pins that refusal and the spaces lifecycle with
real-code tests.

## Drill 1 — mechanism red, dirs (the RLM95 shape)

A fresh tree through the REAL product (`CreatedRegistry` bundled with
esbuild + `MuseSparkCreated.c` compiled with `cc`, opened on the lane's
real `~/Library/Application Support/Muse Spark Code`, run from an empty
working folder) left the folder empty. Then, from that folder:

```
ROOT="<home>/Library/Application Support/Muse Spark Code/resource-created/trees/muse-tree-97097a5e-…"
mkdir -p $ROOT/m03        # unquoted, as an operator expansion
```

Result, exactly the field evidence: `Support/Muse`, `Spark`,
`Code/resource-created/trees/muse-tree-97097a5e-…/m03` (all 700, stray
tree holding only `m03`, no `.muse-owner.json`) plus
`<lanehome>/Library/Application` (700 dir). Real tree untouched.

## Drill 2 — mechanism red, files (the RLF-NOLIMITS shape)

After removing drill 1's strays, from the same folder:

```
touch $ROOT/short-tmp     # unquoted; exit 1
# touch: Support/Muse: No such file or directory
# touch: Code/resource-created/trees/muse-tree-97097a5e-…/short-tmp: No such file or directory
```

Result: only words 1 and 3 exist as empty 600 files
(`<lanehome>/Library/Application`, `Spark`); words 2 and 4 fail on
their missing parents — exactly the NOLIMITS evidence. (A `curl -o` or
`node … argv` shape explains the word-1-only content files: the flag
takes the first word and the rest fail as inputs.)

## Drill 3 — product green

The real lifecycle from the working folder — create, save/publish,
finish, native remove — through the same real registry and helper:

```
node ../drill.cjs cycle
# released=true root=…/trees/muse-tree-35b5ccb3-…
```

Working folder still empty; lane-home `Library/` holds only
`Application Support`. Drill trees released afterwards; only the
session's own live tree remains in the manifest.

## Drill 4 — the guard test fires red, then green

`test/unit/createdRegistrySpaces.test.ts` pins the refusal. Breaking it
on purpose (`if (false)` over the `path.isAbsolute` check):

- vitest exit 1: `refuses a relative registry file or tree base…` fails
  with `promise resolved "CreatedRegistry{ … }" instead of rejecting`,
  and the run leaves a real `relative/trees` stray in the working
  folder — the harm the guard prevents.
- Restored (working tree `src/` byte-identical, stray removed): 2 passed.

## Tests

New `test/unit/createdRegistrySpaces.test.ts` (real files, real native
protocol via `helpers/createdNative`, as the product wires it per OS):

- relative file or base is rejected before anything is written;
- a full create/finish/release lifecycle under an
  `Application Support/Muse Spark Code`-shaped data home keeps every
  tree (marker, `browser-profile`, `browser-cache`), stage and manifest
  inside it, ends with empty `trees/` and `[]`, and adds none of
  `Application`, `Support`, `Spark`, `Code` to the working folder.

Result on this rig at the repository's own timeout: 2 passed in
~0.9 s; no strays. Forensics runs (all at repo timeout, ≤3 files):
`resourceHandoffDeadline` green; `createdRegistrySaveErrors` green;
`worktreeCommands` + `nativeCheckout` + `sessionBoard` 29 passed;
`mcpJobRetire` + `scheduleRegistration` + `execHumanReason` 8 passed,
4 skipped; `resourceCreatedSweep` 4 failed on the unbuilt macOS helper
`native/darwin/muse-dictate-screen-x64.app` — identical at base
(RLF-NOLIMITS measured the same). `npx vitest related`: no `src/` file
changed, nothing to relate. No test was run with a raised timeout.

## Gates (final tree)

| gate                              | exit | note                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier (touched)                | 0    |                                                                                                                                                                                                                                                                                                                                        |
| eslint --max-warnings 0 (touched) | 0    |                                                                                                                                                                                                                                                                                                                                        |
| typecheck (all projects)          | 0    |                                                                                                                                                                                                                                                                                                                                        |
| check:l10n                        | 0    | 0 problems                                                                                                                                                                                                                                                                                                                             |
| check:reference                   | 0    |                                                                                                                                                                                                                                                                                                                                        |
| check:host-api                    | 0    | 0 problems                                                                                                                                                                                                                                                                                                                             |
| check:roadmap                     | 0    | 231 entries, current                                                                                                                                                                                                                                                                                                                   |
| cycles                            | 0    | no circular dependency                                                                                                                                                                                                                                                                                                                 |
| check:plan                        | 1    | pre-existing 85% overage: base PLAN.md 3,721,495 bytes vs 3,565,158 budget (over ~157 KB before this lane's ~1 KB); no drift. Archiving is the lead's procedure (RLF-NOLIMITS precedent).                                                                                                                                              |
| check:catches                     | 1    | pre-existing: 64 sites, all in judge/host/review files from other lanes' merges; this lane's files add none. Baseline left alone.                                                                                                                                                                                                      |
| duplication                       | 1    | pre-existing: 1 clone between `judgeP2RedesignSides.test.ts` and `judgeWiringAssembly.test.ts`; this lane's file not involved.                                                                                                                                                                                                         |
| deadcode                          | 1    | pre-existing: unused file/exports/type and hints, all in untouched files.                                                                                                                                                                                                                                                              |
| build                             | 1    | pre-existing: 227 budgets hold; 7 over — modelApi.js +7.3 KiB (532.3/525), resourceGovernor.js +1.9 KiB (126.9/125), wire.js +0.8 KiB (75.8/75), resourceAdmission.js +0.1 KiB, reportingPanel/vaultActions/estimateContracts marginal at 50.0/25.0/25.0 KiB. No shipped byte from this lane (test + docs only). Budgets never raised. |

No CHANGELOG entry: no product behaviour changed — there was no
splitting site to fix, and the refusal predates this lane. No l10n,
reference, host-api or catch-baseline impact.

## Open items

- Archiving PLAN.md past the 85% bound is the lead's procedure.
- The four pre-existing red gates (plan, catches, duplication,
  deadcode, build) belong to other lanes' merges.
- Observation, no action: on Windows `path.isAbsolute` also accepts a
  rooted but drive-relative spelling (`\x`). All callers pass
  fully-qualified paths (`agentDataFolder`, `tmpdir()`, fixtures), so
  the refusal is airtight in practice; tightening it further would be
  scope creep without an observed case.
