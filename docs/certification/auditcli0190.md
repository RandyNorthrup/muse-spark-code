# AUDITCLI 0.19.0 — every terminal command says what it takes (lane record)

Sweep: `node dist/acp.js` (the brief's `dist/runtime.js` path is stale; the
terminal command builds from `src/runtime/main.ts` to `dist/acp.js`) plus
each command's `--help`, recursively, against `src/runtime`'s command table
and each parser. Live probes ran against a `build:dev` binary; the
production `npm run build` stops at the What's New bound on this branch
(0.19.0 notes decode to 147798 bytes over the 76800 bound), so the binary
was built with a local-only CHANGELOG trim that was restored afterwards
and never committed.

## Result

Every misuse below now exits 2 with words that name the flag or argument.
Real failures keep their documented codes (exit 1 wiring/refusal, the
headless `EXEC_EXIT`/`LEGAL_EXIT` codes). `--help` exits 0 everywhere.

## Commands checked

| Command                                                 | Help screen (exit 0)                                                                   | Misuse before → after                                                            | Naming                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bare / `serve` flags                                    | compact `--help`                                                                       | unknown flag, `frobnicate`, `help foo`: 1 → 2                                    | parser's own words name the flag                                                                                                                                                                         |
| `login`                                                 | compact `--help`                                                                       | `--provider` etc: 1 → 2, said `login`                                            | now names the refused `--flag`                                                                                                                                                                           |
| `setup`                                                 | compact `--help`                                                                       | `--provider`: 1 → 2, said `setup`                                                | now names `--provider`; untrusted setup stays a real refusal (exit 1, hooks text)                                                                                                                        |
| `auth set/status/clear`                                 | compact `--help`                                                                       | 1 → 2                                                                            | credential guidance kept, argv never echoed (a token may be the key); refused `--preset`-style flags name the flag only                                                                                  |
| `providers list/test/remove`                            | compact `--help`                                                                       | 1 → 2                                                                            | missing arg names `providers <verb>`; malformed id keeps `Unknown provider: <id>`                                                                                                                        |
| `providers add`                                         | compact `--help`                                                                       | missing `--preset`, bad values: 1 → 2                                            | missing names `--preset`; syntactically valid but unconfigured preset stays a real failure (exit 1, `Unknown provider`)                                                                                  |
| `providers connect openrouter`, `providers usage <id>`  | compact `--help`                                                                       | 1 → 2                                                                            | usage line names the command                                                                                                                                                                             |
| `providers add/remove/status chatgpt\|copilot`          | chatgpt usage + compact (exit 2)                                                       | 1 → 2                                                                            | usage line                                                                                                                                                                                               |
| `providers accounts …`                                  | accounts usage (exit 2)                                                                | 1 → 2 (the brief's third example)                                                | usage line                                                                                                                                                                                               |
| `exec`                                                  | full reference via `exec --help`                                                       | already 2                                                                        | bad `--effort/--backend/--output/--shell-sandbox/--permission-mode/--timeout/--max-requests/--output-schema*` named the bare usage line; now each names its `--flag` (budget keeps its decimal guidance) |
| `scan-secrets`                                          | full reference via `--help`                                                            | already 2                                                                        | usage line                                                                                                                                                                                               |
| `report [options]` (M93)                                | reference rows; `report --help` prints the named-reports help by design (F34)          | already 2 (reports engine)                                                       | reports usage                                                                                                                                                                                            |
| `report problem`, `report <kind>`, `report history`     | reports usage (exit 2 / 0)                                                             | already 2                                                                        | reports usage                                                                                                                                                                                            |
| `legal`, `exec legal-scan`                              | compact `--help`                                                                       | already 2                                                                        | parser names unknown flags; bad `--format` keeps `text or json`                                                                                                                                          |
| `fonts install`                                         | fonts usage                                                                            | 1 → 2                                                                            | usage line                                                                                                                                                                                               |
| `playbook`                                              | `Use playbook status\|record\|settings` (exit 2)                                       | already 2                                                                        | usage line                                                                                                                                                                                               |
| `estimate`                                              | estimate usage incl. `--check-plan` (exit 2)                                           | already 2                                                                        | own parser                                                                                                                                                                                               |
| `usage …`, `--usage`                                    | compact `--help`                                                                       | already 2                                                                        | bad `--range/--by/--from/--to/--stdio/--out/--json --csv`/action/extra now named (was `Unknown argument: usage`)                                                                                         |
| `resources …`, `usage resources`                        | compact `--help`                                                                       | already 2                                                                        | names `resources <args>`                                                                                                                                                                                 |
| `dictate`                                               | n/a (companion voice not ready in this build; unknown flags fall to the strict parser) | 1 → 2                                                                            | parser names the flag                                                                                                                                                                                    |
| `share`, `prompts`                                      | reserved; refused without the bound owner                                              | 1 (`invalid`) unchanged                                                          | names the command                                                                                                                                                                                        |
| `vault`, `vault --help`                                 | vault usage (exit 0 both; bare `vault` reads as help)                                  | already 2                                                                        | vault usage                                                                                                                                                                                              |
| `schedule`                                              | schedule usage                                                                         | already 2                                                                        | schedule usage                                                                                                                                                                                           |
| `developer`                                             | developer usage, exit 2 (was `SyntaxError` + stack, exit 1)                            | stack → usage, 1 → 2                                                             | usage line; parsed before any store is touched                                                                                                                                                           |
| `help`, `--help`, `-h`, `help --all`, `--version`, `-v` | compact / full reference / version                                                     | 0 unchanged                                                                      | —                                                                                                                                                                                                        |
| `auth status` (real failure, no store on this rig)      | —                                                                                      | silent exit 1 → store-unavailable notice naming the recovery cause, still exit 1 | journal recovery now composes the notice instead of swallowing the error                                                                                                                                 |

## The brief's three examples

1. `exec --effort none`: parser and reference contract agree (`EFFORT_LEVELS`
   has no `none`; `none` is the Thinking-toggle wire value, not a CLI tier),
   so the refusal stands and now names the flag (`Unknown argument:
--effort none`, exit 2).
2. `--max-tool-output-bytes`: no such flag in any parser, registry, or help
   text on this branch — parser and help agree (unknown-flag exit 2).
   Nothing to fix.
3. `providers accounts` misuse exiting 1: fixed at the cause (below).

## Fixes (at the cause)

- `src/runtime/cliArgs.ts`: the shared `invalid()` owns exit 2; every
  literal misuse without a code got one; refused serve/login/auth flags are
  named (`--flag`) instead of folded into positionals; `parseUsage`
  failures name their flag. Auth argv is deliberately never echoed.
- `src/runtime/exec/execArgs.ts`: per-flag refusals via `flagArgument` /
  `invalidFlagValue` (existing UI strings only); pinned reasons
  (`execModelApiOnly`, `execBudgetRequired`, reused `execModeRefused`) kept.
- `scripts/lib/reference.mjs` + `npm run reference:generate`: the published
  reference no longer drops parser-accepted flags (`exec --vault`,
  `--account-pool`, `--no-auto-compaction`; `serve --scheduled-prompts`,
  plus the serve-family `--no-auto-compaction` rows). 259 → 269 CLI rows.
  Compact `--help` is unchanged (still offers no pooling, per CM108ACC/CX1R4).
- `src/runtime/providerAuth.ts`: journal-recovery failure composes its
  notice instead of failing silently.
- `src/runtime/providers/accountsEntry.ts`: `developer` misuse exits 2
  with the usage before any store is touched.
- `test/unit/cliHelpConsistency.test.ts`: 37 checks with no stand-ins —
  the real parser and renderer in-process. The built `dist/acp.js` itself
  is proven in `test/hosts/exec.sh` (10 misuse/help checks, then 5
  no-bounds checks below, including `--timeout 9` past the removed floor):
  the unit shards run `vitest` without `dist/`,
  and that script runs in CI only after the production package is built
  and installed (hosts.yml `agent` job). The built-binary sweep above is
  the recorded real-use drill.
- No bound of ours on `exec` (owner's Limits rule, 2026-10-16): without
  `--max-requests` a run has no request limit (the ledger cap is optional
  end to end, and the Action forwards the flag only when set); without
  `--timeout` a run has no deadline of ours (no timer armed, null
  `timeoutSeconds` in the result/event limits); a set
  `--timeout`/`--max-requests` is any positive safe integer;
  `--max-budget-usd` is positive-only. The 21,600-second, 500-request and
  20 USD maxima, the 30-request default, the 1800-second default, the
  10-second floor and the Action's 20-minute default are gone from the
  parser, the lifecycle, the protocol schemas, the generated reference,
  the v2 exec schemas, the Action (which forwards `--timeout` and arms
  its wrapper timers only when `timeout-minutes` is set) and the docs.
  The deadline timer re-arms at Node's setTimeout ceiling instead of
  overflowing on a large value. Proven through the real binary: large
  values fall through to the missing-prompt check instead of being
  refused as bounds (red on the stale binary, green on the rebuild),
  and a default run reports null `timeoutSeconds`. Frozen v1 wire
  snapshots untouched.

## Open (not fixed here)

- `report --help` shows the named-reports help, never the M93
  `--out/--description/--no-facts/--no-events` flags (only in the reference).
- `exec --record` / `--trust-workspace` / `--web-search` refusals name the
  concept, not the literal flag; changing those words needs new UI strings.
- Silent-`auth status` verified fixed only on a storeless rig; a desktop
  run with a real store still needs the lead's confirmation.

## REVCLI review fixes (revcatch/revcli)

- `src/runtime/cliArgs.ts`: the "every literal misuse without a code got
  one" line above was wrong for two sites — `auth` with a refused
  `--backend` / `--shell-sandbox` value returned the credential guidance
  with no exit code, so `main` fell back to exit 1 while every sibling
  misuse exits 2 (proven: real parser returned no `exitCode`; sibling
  `login --provider foo` returned 2). Both sites own exit 2 now; the argv
  is still never echoed. Covered in `test/unit/cliHelpConsistency.test.ts`
  (now 39 checks: 36 misuse rows plus the developer and two reference
  tests) and in `test/hosts/exec.sh` (`auth --backend bogus set`, exit 2
  naming the guidance, proven through a local dev build; the production
  build still stops at the pre-existing What's New bound, as recorded
  above).
- `docs/schemas/exec-event-output-schema-v1.schema.json` (two limits
  blocks) and `docs/schemas/exec-result-output-schema-v1.schema.json`:
  `timeoutSeconds` accepts null and a set deadline from 1 second, matching
  the parser, the v2 schemas and the Action validator. The bounds removal
  updated every other bound in these files but left `timeoutSeconds`
  non-null with its 10-second floor, so a no-deadline result or a
  `--timeout 9` result failed the published files (proven red against the
  unedited files with ajv, green after).
- `docs/ci.md`: the budget paragraph still stated the removed ceiling
  ("range 1–20,000,000 micro-USD") and the v2 paragraph still spoke of
  "the same hard bounds"; both now say positive, at most six decimals, no
  upper bound.
- Checked and left alone: the narrowed `SyntaxError` catch in
  `runTerminalDeveloperCommand` (a zod `ZodError` from `developer add`
  with a bad value rethrows exactly as before the sweep — same crash text,
  same exit 1, pre-existing); `--timeout` past `MAX_SAFE_INTEGER`/1000
  seconds loses millisecond exactness in `timeoutMs` (representation, no
  person passes a 285-million-year deadline; refusing it would invent a
  limit of ours); "Unknown argument" reused for known-flag bad values
  (the flag and value are named and the usage follows — truer than the
  bare usage line it replaced).

## JOIN0190 merge of cand 137 (REVCLI b1649b7c5e)

Union decisions where the joined tree was newer than the candidate base:

- Auth unknown-option refusal carries both wordings: the docself
  self-doc (accepted flags, secret-looking names still suppressed) plus
  the REVCLI credential guidance, exit 2
  (`src/runtime/cliArgs.ts` strict catch). Pinned both ways:
  `test/unit/cliHelp.test.ts` "secret-looking option" and
  `test/unit/cliHelpConsistency.test.ts` auth rows.
- An `auth` global enum refusal yields the guidance, never the enum
  self-doc (`enumRefusal` skipped for `auth`; the `--backend` /
  `--shell-sandbox` checks below already answer guidance, exit 2).
- The published reference model carries every flag the parser takes
  (the dormant-hiding filter is gone, as the CLI chain decided):
  `serve: --scheduled-prompts`, `exec: --vault`, `exec: --account-pool`,
  `--no-auto-compaction`. Pinned by the two reference tests.
- `--effort none` stays accepted (Thinking-off, lane REASONSHAPESR2,
  pinned in `cliHelp.test.ts` and `execArgs.test.ts`); the stale
  refusal row left the consistency table.
- Numeric-limit refusals keep `Invalid number or limit for --timeout` /
  `--max-requests` (kept `cliHelp.test.ts` rows); "Unknown argument"
  stays for genuinely unknown flags and values.
- The real-use harness owns its step time box
  (`REAL_USE_STEP_TIMEOUT_SECONDS = 600`, the live recipe timeout)
  now the product ceiling is gone; `EXEC_TIMEOUT_MAX_SECONDS` is
  deleted from `action/lib/result.mjs` with its declaration and test.

Proof on the joined tree (rig macmini): `cliHelpConsistency` 38/38,
`cliArgs` + `cliHelp` + `execLimits` + `execArgs` 112/112,
`actionExecBounds` + `ciRun` with consistency 58/58,
`real-use` 33/33, `runLedger` with the no-cap test intact;
`typecheck:host` clean, `check:l10n` 0 problems, `check:reference`
current, `check:catches` green on the regenerated baseline.
