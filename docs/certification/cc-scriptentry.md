# CC-SCRIPTENTRY — no script ends silently when started through a symlink or junction (2026-10-30)

Claude Code lane `CC-SCRIPTENTRY`, worktree `C:/Users/Randy/Coding/mx-cc-scriptentry`,
branch `cc/scriptentry`, based on int/recovery `b781451b94`, on the owner's
Windows 11 PC (Node 24.20.0, npm 11.19.0, vitest 5.0.3). Model attempts: **0**.
Provider calls: **0**. Nothing was pushed, rebased, stashed or tagged. The vault
suites and the real credential-store suites (`keyringParts`, `keystoreOwner`,
`credentialLease`, `providerHeadersStore`, `test/unit/vault/**`) were never run
on this PC. `npm ci` exit **0**, `npm run prepare` exit **0**. `TMP` and `TEMP`
were `temp/tmp`, `GIT_CEILING_DIRECTORIES` was `temp`. Every junction and every
scratch folder lived under the worktree's ignored `temp/` and was removed by
the test itself or by hand afterwards (each link taken off with `unlink`, never
by deleting through it); `scripts/` still held its 108 entries and
`node_modules` its 665 afterwards.

## 1. The defect

Node names the module it starts by its real path (symlinks and junctions
resolved). `scripts/check-webview-archive.mjs` was found by CC-WINFAIL
(`4ca4f85ef0`, row 4b of `cc-winfail.md`) to compare that with `process.argv[1]`
as typed: started through a link the two differ, `main()` never runs, and the
script exits 0 without a word. A gate that exits 0 without checking anything is
a false green. The same comparison was copied across the tooling.

## 2. Every entry-point check found

Searched: every `argv[1]`, `argv.at(1)`, destructured `process.argv`,
`import.meta.url`/`import.meta.filename` comparison, `import.meta.main`,
`require.main` and `__filename` in every tracked `.mjs`, `.js`, `.cjs`, `.ts`,
`.sh` and `.yml` file outside `PLAN.md` and the archive. 28 files held a check
that fails through a link:

| Form                                                                         | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href` (22) | `a11y`, `build-blobhold`, `build-confine`, `build-linux-helper-pins`, `capture-m106-meta`, `check-badges`, `check-linux-helper-pins`, `check-node-image`, `check-vsix-size`, `check-webview-archive`, `github-release`, `package-node-image`, `package-vsix`, `publish-registry`, `readme-shots`, `refresh-badges`, `release-reuse`, `release-sbom`, `release-summary`, `retain-node-images`, `sync-bundled-skills`, `sync-provider-catalog` (all `scripts/*.mjs`) |
| `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)` (4)       | `scripts/build-tokens.mjs`, `check-tokens.mjs`, `gen-reference.mjs`, `tui-art.mjs`                                                                                                                                                                                                                                                                                                                                                                                 |
| `import.meta.url === pathToFileURL(process.argv[1]).href` (1)                | `scripts/mhp-errors.mjs` (also threw a `TypeError` when imported with no start argument, as under `node -e`)                                                                                                                                                                                                                                                                                                                                                       |
| the tail of the start path (1)                                               | `test/harness/build-node.mjs` (`argv[1]...endsWith('/test/harness/build-node.mjs')`: a junction to `test/harness/` never matched)                                                                                                                                                                                                                                                                                                                                  |

Looked at and left alone, with the reason:

- `action/lib/lifecycle.mjs` `isEntry` (used by `ci-run.mjs`, `tools.mjs`,
  `checkout.mjs`, `install.mjs` and the rest of `action/`) and
  `action/lib/ci-entry.mjs`: both already resolve links (`realpathSync`), and
  `isEntry` is also case-insensitive on Windows. The Action's scripts use Node
  built-ins only and ship apart from `scripts/`, so they cannot import
  `scripts/lib/`. Same contract as the new module.
- `require.main === module` in `src/runtime/vault/vaultBrokerEntry.ts` and
  `src/runtime/node/main.ts`: CommonJS bundles; Node compares the module object,
  not a path, so a link cannot break it.
- Scripts and test helpers that run unconditionally (every `test/hosts/*`
  worker, `scripts/judge-bench.mjs`, `scripts/m101-e.mjs`,
  `scripts/m107-owner-case.mjs`, `deploy/container/install-tools.mjs`, ...) have
  no entry check to fail. `m107-owner-case.mjs`'s `argv[1]` is a local array.

## 3. The shared check

`scripts/lib/entryPoint.mjs` exports `isEntryPoint(moduleUrl, script =
process.argv[1])`:

- `fs.realpathSync` on the start argument and on the module's own file, so a
  symlink, a junction or a chain of them on either side compares equal to the
  real file; compared without case on Windows only.
- A start argument that is missing or names nothing (`node -e ... word`,
  `ENOENT`, `ENOTDIR`) is not the entry: `false`. This is the only catch, and it
  is NARROW: every other failure (an invalid path, `EACCES`, a link loop) is
  thrown, so a script that cannot tell stops loudly instead of going quiet.
- The second parameter is the one the real call defaults; the tests pass real
  paths to it, so the function is called on real files without a stand-in.

All 27 `scripts/` files and `test/harness/build-node.mjs` now read
`if (isEntryPoint(import.meta.url))`, with the dead `pathToFileURL`,
`fileURLToPath` and `path` imports removed (`tui-art.mjs` keeps `fileURLToPath`
and `path` for other uses).

An ESLint block (`eslint.config.mjs`, files `scripts/**/*.mjs`, not
`scripts/lib/entryPoint.mjs`) refuses `process.argv[1]`, `process.argv.at(1)` and
`const [, x] = process.argv`, with the message to ask `isEntryPoint`, so the
twenty-eighth copy cannot be written. It does not reach `test/harness/` (the
`test/**` block owns that folder's `no-restricted-syntax`); the one file there
is converted by hand.

## 4. Files changed

Commit `0a41f4d2c9` (31 files, +344 -124); the hook rewrote nothing (the
committed tree equals lint-staged's pre-hook backup).

- new `scripts/lib/entryPoint.mjs`, new `test/unit/entryPoint.test.mjs`
- `eslint.config.mjs` (the one block above)
- the 27 scripts of section 2, form 1 to 3: each its entry condition and its
  imports
- `test/harness/build-node.mjs`

Not touched: `test/unit/webviewArchiveCheck.test.mjs` (CC-WINFAIL's, with its
added `every panel file present` assertion). No CHANGELOG line: tooling only,
nothing a person notices.

## 5. The test

`test/unit/entryPoint.test.mjs`, real files, real links, real processes, no
stand-in. The links sit in a `temp/entry-point-*` folder and are removed one by
one before the folder.

- `isEntryPoint on real files` (7 cases): the file's own path; a file it is not;
  a missing path; a path below a file (`ENOTDIR`); no argument; a junction to the
  folder by an absolute and a relative path; a junction made to another
  junction; a symlink to the file; a symlink to the folder; upper-case path
  (equal only on Windows); a path with a NUL byte throws.
- `a script started through <plain path | junction to scripts/ | symlink to the
file>`: 18 real scripts each, on input that makes each print or fail in its own
  words (rows: `check-webview-archive`, `check-vsix-size`, `github-release`,
  `publish-registry npm`, `sync-bundled-skills`, `sync-provider-catalog
--bogus`, `package-node-image`, `check-node-image`, `build-linux-helper-pins`,
  `check-linux-helper-pins --bundle x`, `capture-m106-meta --help`,
  `check-badges --bogus x`, `release-summary` without `RELEASE_NEEDS`,
  `release-reuse` and `release-sbom` in an empty folder, `refresh-badges` in an
  empty folder, `check-tokens`, `mhp-errors --check`). Every row names an exit
  status and a line of output, and a silent run never passes (`stdout + stderr`
  must not be empty). The plain-path rows are the baseline: the same rows hold
  for the plain path. `refresh-badges` imports `check-badges`, which must stay
  quiet as an imported module.
- `a script imported, not started`: `node --eval "await import(url)"` of a script
  reached through a junction runs nothing and exits 0.

Run here (junction, plain path): 42 passed, 20 skipped, 17.9 s; each script
0.06 to 1.0 s. **The 20 skipped are the symlink cases: this account cannot
create a file or directory symlink on this PC (`EPERM`, no Developer Mode, not
elevated).** Junctions (the Windows case) ran. The symlink cases run on Linux
and macOS in hosted CI, and on a Windows runner (elevated); they were not run
here. They are skipped by a probe at load, never by a platform name.

Not run by the test, with the reason: `a11y` (starts a browser),
`build-blobhold`, `build-confine` (compile native code), `build-tokens`,
`tui-art` (rewrite tracked generated files), `package-vsix`, `readme-shots`
(full builds), `retain-node-images` (calls `gh` and deletes registry versions),
`gen-reference` (2.3 s a start; `npm run check:reference` is its gate run, below),
and `test/harness/build-node.mjs` (esbuild into `dist/`). They share the helper
and the lint rule.

## 6. Red/green drills

Each break was made by an edit, the suite (or eslint) run, and the edit undone;
after each `git diff --quiet` exited 0.

| #   | Break                                                             | Result (non-zero)                                                                                                                                                                                                                             | Restored |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | the old comparison (form 1) back in `scripts/check-vsix-size.mjs` | vitest exit 1: `a script started through a junction to scripts/ > runs check-vsix-size.mjs`, `AssertionError: exit 0 : expected +0 to be 1` (the plain-path row passed). `eslint` exit 1: two `no-restricted-syntax` errors at 24:3 and 25:50 | green    |
| 2   | the old comparison (form 2) back in `scripts/check-tokens.mjs`    | vitest exit 1: junction row, `expected '' not to be ''` (exit 0 and not one line of output)                                                                                                                                                   | green    |
| 3   | `isEntryPoint` stops resolving the start path through its links   | vitest exit 1: 20 failed (the 2 junction function cases and all 18 junction script rows), 22 passed (plain rows)                                                                                                                              | green    |
| 4   | no case-insensitive compare on Windows                            | vitest exit 1: `compares without case on Windows only`, `expected false to be true`                                                                                                                                                           | green    |
| 5   | every error from the start path swallowed                         | vitest exit 1: `throws what is not a missing start argument`, `expected [Function] to throw an error`                                                                                                                                         | green    |
| 6   | a start argument that names nothing counts as the entry           | vitest exit 1: `knows its own start path ...`, `expected true to be false`; and `a script imported, not started`, `At least one VSIX path required : expected 1 to be +0` (the script ran on import)                                          | green    |

Final run after the last restore: `vitest run test/unit/entryPoint.test.mjs`
exit 0, 42 passed, 20 skipped.

## 7. The `npm run` gates start their scripts by the plain path and are unchanged

The gates were run in this tree and in an export of the base commit
(`git archive HEAD~1` into `temp/`, `node_modules` joined by a junction), exit
codes and output compared with each root's path blanked:

| Gate                          | Before | After | Output                                                                                                                 |
| ----------------------------- | ------ | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `npm run check:tokens`        | 0      | 0     | identical (`tokens: 0 problems`)                                                                                       |
| `npm run check:reference`     | 0      | 0     | identical (92 features, 68 commands, 110 settings, 33 slash, 359 CLI; current)                                         |
| `npm run check:host-api`      | 0      | 0     | identical (392 VS Code APIs, 57 files importing vscode; 0 problems)                                                    |
| `npm run check:plan`          | 0      | 0     | identical (241 milestones; 0 drift)                                                                                    |
| `npm run check:catches`       | 0      | 0     | identical                                                                                                              |
| `npm run check:roadmap`       | 0      | 0     | identical                                                                                                              |
| `npm run check:mhp`           | 1      | 1     | identical, see section 9                                                                                               |
| `npm run check:lazy-registry` | 1      | 0     | differs only because the export has no `dist/`: before, `dist/meta cannot be read`; this tree has the production build |

## 8. Gates (every exit code)

| Command                                                                                             | Exit | Result                                                     |
| --------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| `npm ci`; `npm run prepare`                                                                         | 0; 0 |                                                            |
| `prettier --check` on the 31 files of the commit                                                    | 0    |                                                            |
| `eslint --max-warnings 0` on the same 31 files                                                      | 0    |                                                            |
| `npm run typecheck`                                                                                 | 0    | host, webview, unit, e2e, integration, faults              |
| `npm run check:host-api`                                                                            | 0    |                                                            |
| `npm run check:plan`                                                                                | 0    |                                                            |
| `npm run check:catches`                                                                             | 0    |                                                            |
| `npm run duplication`                                                                               | 0    | 0 clones                                                   |
| `npm run deadcode`                                                                                  | 0    |                                                            |
| `npm run build`                                                                                     | 0    | includes `node scripts/check-tokens.mjs` by its plain path |
| `vitest run test/unit/entryPoint.test.mjs --maxWorkers=4`                                           | 0    | 42 passed, 20 skipped                                      |
| `vitest related <the 31 files> --run --maxWorkers=4` (vault and credential suites excluded by name) | 0    | 15 files, 264 passed, 20 skipped, 83 s                     |
| `vitest run test/unit/webviewArchiveCheck.test.mjs --maxWorkers=2`                                  | 0    | 4 passed                                                   |
| `npm run check:badges` with `BADGE_CHECK_SKIP_NETWORK` set (no public requests)                     | 0    | `network skipped`                                          |

## 9. Seen on the way, not changed

- **`npm run check:mhp` fails on the base itself**: `MHP_VERSION_LOCK: v1.1
frozen wire contract changed (expected 80d04e5d63...)` at
  `scripts/mhp-schema.mjs:219`. Measured on a clean export of `b781451b94`
  (exit 1, same line) and on this branch (exit 1). It compares the in-file v1.1
  contract with `src/shared/hostApi/mhp-v1.1.lock.json`; this lane touches
  neither. Earlier lanes recorded `check:mhp` 0 (`cc-rlm104.md`, `cc-m104h.md`), so
  a merge into int/recovery after them changed the frozen contract or the lock.
  Someone re-freezes it or reverts the contract; not decided here.
- The `check:mhp` failure comes at the lock check, before `generateMhpErrors`
  (imported from `scripts/mhp-errors.mjs`, which this lane edited) is called; the
  clean export of the base commit fails the same way.

## 10. Merging with `cc/winfail`

`cc/winfail` (`4ca4f85ef0`) fixed the same defect in
`scripts/check-webview-archive.mjs` alone, with `realpathSync(path.resolve(argv[1]))`
inline. Both branches change the import block and the entry condition of that
file, so merging the second one reports a conflict in
`scripts/check-webview-archive.mjs` only; the resolution is this branch's side
whole (`import { isEntryPoint } from './lib/entryPoint.mjs'` and
`if (isEntryPoint(import.meta.url)) {`, and neither `pathToFileURL` nor `path`
nor `realpathSync` imported). The same behaviour: one real path on each side;
here also case-insensitive on Windows and `false`, not a throw, for a start
argument that names nothing. CC-WINFAIL's added assertion in
`test/unit/webviewArchiveCheck.test.mjs` is a hunk this branch does not touch and
applies cleanly (and its junction case then also passes through the shared
check).

## 11. Open questions

1. Who re-freezes the MHP v1.1 lock (section 9)? Option A: the owner of the
   merge that changed the contract regenerates the lock with
   `node scripts/mhp-schema.mjs --adopt-version=...`. Option B: revert that
   contract change. Recommendation: A, by the lane that made the change, since
   `check:mhp` is a gate in `quality:gates`.
2. The ESLint rule covers `scripts/**`; `test/harness/` and `action/` are not
   under it. Recommendation: leave it; two files, both already converted or
   already correct.
