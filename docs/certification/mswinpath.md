# MSWINPATH — Safer Windows paths follow-ups (2026-10-17, macmini)

Lane: `ms/mswinpath`. Milestone: the shipped SECWINPATH / SECWINPATH2 /
TRUSTROOT (D105) "Safer Windows paths" line; there is no `### WINPATH`
heading on main, no `cand/MSWINPATH/*` branch, and no `@unwired WINPATH`
code, so there was nothing to merge and nothing unwired to connect. The
SECWINPATH identity commits (`7cec0c47c`, `203660e7d`) are ancestors of main,
and every trusted-path caller (`nodeBackgroundIo`, `nativeBackground`,
`effectiveDefinition`, `convert`, vault store) is wired.

## What was finished

One genuine follow-up bug plus the regression cover the D108 test overhaul
deleted (`test/unit/windowsTrustedPath.test.ts` went out in `f2b00c094` as
GO):

- `src/runtime/windowsTrustedPath.ts` (`stepsBelow`, now exported): the
  escape check was `relative.startsWith('..')`, so a folder literally named
  `..foo` (or `...`) directly under the trusted root was refused as
  "outside its trusted root". Only `..` itself or a leading `..\` leaves
  the root now; genuine escapes (`..\other`, siblings, other drives) still
  fail closed. Commit `24cbe24b6`.
- `test/unit/windowsPathSpelling.test.ts` (13 tests): the shared Win32
  spelling refusal through the real module with an explicit win32 platform —
  devices incl. superscript spellings, ordinary dotted names (`con.d`),
  trailing dots/spaces, streams, drive-relative spellings, verbatim-prefix
  handling, device namespaces, UNC inside/outside a UNC workspace. Runs on
  every OS, no stand-ins.
- `test/unit/windowsTrustedPathSteps.test.ts` (5 tests): `stepsBelow`
  accept/refuse cases plus verifier pre-query refusals (escape fails
  closed, absolute path/root required) with a `run` that throws, proving
  no subprocess is needed for these paths.

No README / Help / catalogue entry: the fix changes no user-visible wording
or surface, only which ordinary names verify. The public line stays the
ROADMAP "Safer Windows paths" entry.

## Red drill

`test/unit/windowsTrustedPathSteps.test.ts` against the pre-fix line fails
`accepts ordinary names that start with two dots` with
`expected undefined to deeply equal [ '..foo' ]` while the genuine-escape
cases still pass; the fix restores green. No source bytes beyond the fix.

## Gates (final tree; macmini, repo defaults, no timeout overrides)

| Gate                                                                                                                | Result                         |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| New + related suites (`windowsPathSpelling`, `windowsTrustedPathSteps`, `museCodeProtectedWrites`, `canonicalPath`) | 4 files, 54 tests pass, exit 0 |
| `npm run typecheck` (all 5 projects)                                                                                | exit 0                         |
| prettier `--check` on touched files                                                                                 | pass                           |
| eslint on touched files, zero warnings                                                                              | exit 0                         |
| `npm run deadcode` (knip)                                                                                           | exit 0                         |
| `npm run cycles`                                                                                                    | no cycles, exit 0              |
| `npm run duplication`                                                                                               | 0 clones, exit 0               |
| `npm run check:l10n`                                                                                                | 0 problems, exit 0             |
| `npm run check:reference`                                                                                           | matches, exit 0                |
| `npm run check:host-api`                                                                                            | 0 problems, exit 0             |
| `npm run check:plan`                                                                                                | 0 drift, exit 0                |
| `npm run check:roadmap`                                                                                             | current, exit 0                |
| `npm run build`                                                                                                     | exit 0                         |
| `security:sast` (`SEMGREP_ENABLE_VERSION_CHECK=0`)                                                                  | exit 0                         |
| Full `npm run test:unit`                                                                                            | result below                   |

## Real-life steps for the lead (Windows 11 host)

1. `npx vitest run test/unit/windowsPathSpelling.test.ts test/unit/windowsTrustedPathSteps.test.ts --maxWorkers=3` — passes on Windows unchanged.
2. Create `C:\tmp\trustroot\..foo` as a real folder and verify a native
   schedule registration rooted at `C:\tmp\trustroot` accepts it (pre-fix
   it was refused as outside its trusted root); verify `C:\tmp\other`
   against the same root is still refused.
3. The verifier itself is reachable only through native schedule
   wake/registration and helper launches on Windows — there is no direct
   user command; the spelling refusal surfaces in workspace/checkpoint
   admission messages.
