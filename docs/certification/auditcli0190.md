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
- `test/unit/cliHelpConsistency.test.ts`: 37 checks on the real parser and
  the real help renderer (no stand-ins). CI unit shards run without `dist/`,
  so the committed test drives the same functions `dist/acp.js` bundles;
  the built-binary sweep above is the recorded real-use drill.

## Open (not fixed here)

- Outcome 3 vs the standing Limits rule: the parser enforces our own bounds
  (`EXEC_MAX_REQUESTS` 500, `EXEC_MAX_TIMEOUT_SECONDS` 21600,
  `EXEC_MAX_BUDGET_USD` 20, file count/byte caps) and defaults (30 requests,
  1800 s), all published in the reference contracts. Hiding them would make
  help lie (outcome 1); removing them changes spend safety and needs a
  PLAN.md decision. Left for the lead (§3 question).
- `report --help` shows the named-reports help, never the M93
  `--out/--description/--no-facts/--no-events` flags (only in the reference).
- `exec --record` / `--trust-workspace` / `--web-search` refusals name the
  concept, not the literal flag; changing those words needs new UI strings.
- Silent-`auth status` verified fixed only on a storeless rig; a desktop
  run with a real store still needs the lead's confirmation.
