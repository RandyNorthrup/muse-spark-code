# CLI help (lane CLIHELP, D108) — certification

The terminal agent's help now tells a person what each command takes, from the
same table the parser reads. No model call is involved in any drill below.

Review note (RVCLIHELP, 2026-10-14): the accepted-today list in §1 covers the
registry routes and playbook only. The grammars that parse outside the
registry (`schedule`, `vault`, `providers accounts`, `developer`,
`share`/`prompts`, `providers … chatgpt`) also existed on the base; they keep
their own usage text, are not `help <command>` topics, and are outside the
guard. Four review fixes landed on this branch after the lane: the serve
grammar no longer echoes a secret-looking option name through the raw parser
message (key spellings included), `playbook --help` prints its topic,
a repeated `providers models --add` writes the model once, and `auth --help`
states that `auth set` reads the key from standard input.

## 1. Accepted today (from the code, release 0.18.1 base)

Parser routes (`CLI_OPTION_REGISTRY` in `src/runtime/cliOptions.ts`, plus the
grammars named): serve (28 options), login (26), auth set/status/clear (26
each), providers add (8), providers models (4: add, remove, force, help),
exec (35, incl. resource-governor/cpu-max/memory-max and attach), scan-secrets
(key-stdin, help), report (out, description, no-facts, no-events, help), legal
(json, format, out, registry, help), fonts install (from, help), setup
(COMMON), usage (range, by, from, to, json, csv, out, stdio, help), resources
(json, help), estimate (by, fleet, format, seed, help). Playbook parses its own
`status|record|settings` verbs. Serve additionally accepts `--max-budget-usd`
(hard USD cap, at most 20) and `--trust-workspace`; exec additionally requires
`--max-budget-usd` on the Model API backend and refuses `--trust-workspace`,
`--allow-dangerously-skip-permissions`, `--web-search` and `--record`.

## 2. Before (0.18.1, verified against HEAD `src/runtime/cliArgs.ts`)

- `exec --help` → `{ command: 'help', all: true }` (parseHeadless): the whole
  "Help & Reference", hundreds of lines; exec's own options never listed.
- `auth --help`, `providers --help`, `login --help` → `{ command: 'help' }`
  (strict path): the top-level compact usage again; `auth set` reading the key
  from stdin, `--provider` ids and `status` output undocumented.
- `providers --help` showed only the shared usage; `list|add|test|remove`
  flags (`--preset`, `--as`, `--model`, `--key-stdin`) undiscoverable.
- Wrong options exited 1 on most routes, with the raw parser message.

## 3. After (this lane, live `dist/acp.js` output)

`exec --help` (exit 0) prints its own usage, options with defaults and bounds,
and two real examples — nothing else:

```text
Usage:
  muse-spark-code-acp exec [options] <prompt>
  muse-spark-code-acp exec [options] --prompt-file <path>
  muse-spark-code-acp exec [options] -
  Run one headless turn.
Options:
  --backend museCode|modelApi      Who pays: Muse Code (the default) or the Model API key (accepts museCode|modelApi; default museCode)
  --provider <id>                   The provider the account belongs to (auth set/status/clear).
  --model <model>  Choose the model for this run.
  --effort minimal|low|medium|high|xhigh|max  Choose how much effort Muse puts into each reply. (accepts minimal|low|medium|high|xhigh|max)
  --permission-mode plan|acceptEdits  Choose how Muse asks before it acts. (accepts plan|acceptEdits; default plan)
  --output text|json|jsonl  Choose the result format: text, json or jsonl. (accepts text|json|jsonl; default text)
  --max-budget-usd <amount>  Set the hard spending limit in USD for this run. (at most 20 USD)
  --max-requests <count>  Set the maximum number of model requests. (default 30; accepts 1–500)
  --timeout <seconds>  Set the run deadline in seconds. (default 1800; accepts 10–21600 seconds)
  ...
Examples:
  muse-spark-code-acp exec --backend modelApi --max-budget-usd 1 'Summarise this repo'
  muse-spark-code-acp exec --permission-mode plan --output json 'List the risks'
```

`auth --help` (exit 0) prints the auth usage, `--provider`/`--account` and two
examples (`auth status`, `auth status --provider openrouter`); `providers
--help` (exit 0) prints the list/add/test/remove/models usage with all twelve
flags and two examples. The top-level `--help` (exit 0) lists all thirteen
topics with one-line purposes, the serve-only `--max-budget-usd` /
`--scheduled-prompts` rows, and the `help <command>` / `help --all` routes.
The full reference stays behind `help --all` / `help reference` only.

A wrong option exits 2 with one sentence plus the command's help (exit 2,
nothing run):

```text
$ muse-spark-code-acp exec --max-budgut 1 hi
Unknown option --max-budgut for 'exec': exec accepts --backend, --provider, --model, --effort, --permission-mode, --output, --max-budget-usd, --max-requests, --timeout, --cwd, --prompt-file, --output-schema, --output-schema-outside, --untrusted-file, --attach, --account, --account-pool, --allow-contributor-models, --muse-binary, --shell-sandbox, --image-generation, --fail-on-denial, --ephemeral, --key-stdin, --vault, --verbose, --no-auto-compaction, --resource-governor, --cpu-max, --memory-max, --help. See 'muse-spark-code-acp exec --help'.
```

A secret-looking name is refused without repeating it (live `dist/acp.js`
output, exit 2, nothing run), so a mistyped credential flag cannot reach
terminal output, logs or reports:

```text
$ muse-spark-code-acp auth set --account-secret-canary
Unknown option for 'auth': auth accepts --provider, --account, --help, --version. See 'muse-spark-code-acp auth --help'.
```

The fonts refusal formats in the display language main installs after
parsing (the `reason` getter reads the live table, as the fonts usage
always did): `test/unit/fontCli.test.ts` parses `fonts install --bad`
in English, installs French, and reads the French refusal naming `--bad`.

## 4. Guard and red drills

- `test/unit/cliHelp.test.ts` ("one table drives parsing and help") asserts
  every registry route but `estimate` is covered by a help topic, every parsed
  option is shown or mapped in `CLI_NON_TOPIC_OPTIONS`, and every shown option
  parses without an unknown-option refusal.
- Red drill 1: deleting `--timeout` from the exec topic fails the guard with
  `exec --timeout: expected false to be true` (plus the bounds test);
  restored byte-exact (SHA-256 `16f92da9…` before and after).
- Red drill 2: adding `bogus: { type: 'boolean' }` to the exec registry fails
  the guard with `exec --bogus: expected false to be true` and throws from
  `npm run check:reference`; restored byte-exact (`a2ab3d8c…`).
- Red drill 3: `npm run check:reference` with the README route phrase removed
  fails with `README terminal section lacks help <command>`; green again after
  documenting the route. `docs/reference.md` is regenerated from the same
  `cliCommands()` table (65 commands, 250 CLI rows).
- Secret drill: `test/unit/accountsCommand.test.ts` pins that no parsed
  `auth set` secret route repeats its canary. The lane's first refusal text
  echoed a secret-looking flag name and failed it; the fix
  (`isSecretLookingOption` in `src/runtime/cliHelp.ts`, the
  `unknownOptionHidden` sentence in all 15 tables) refuses without the name,
  and `test/unit/cliHelp.test.ts` pins the hidden refusal. Both suites green.
- L10n drill: the first `unknownOptionHidden` insert doubled a comma in all
  14 locale files (`npm run check:l10n`: 14 problems); fixed, `0 problems`,
  and `l10n-pack-diag.mjs` prints `equal=true` for all 14 again.
- B12 drill (`test/unit/referenceGenerator.test.mjs`): the new
  `providersModels` registry route failed the probe with `providersModels:
--add` (`--add` reached the parser with no sample value), and every
  route's `--help` probe still expected the old uniform `help` although the
  lane answers each command's own topic. The probe now drives
  `providers models <entry>` with model samples (`--force` travels with an
  `--add`, as the parser requires) and expects `helpTopic` for every route
  but serve, whose bare flags keep the top-level `help`. Full file green
  (117 tests).

## 5. Provider models (Part 2)

`providers models <entry>` lists the entry's models and, where the provider's
own list reads with the stored key, the listed models the entry does not
offer; `--add`/`--remove` change the list through the same validated atomic
commit the panel writes (`commitProviderChange` → `writeProvidersFileAtomic`
with `providersFileSchema`). An unlisted add is refused with the closest ids
unless `--force '<reason>'` is given; the reason is stored in the entry's
`forcedModels` map and shown by later lists. The stored key is read only to
consult the provider's list — a forced add never touches secrets.

Only real modules run in `test/unit/providersModels.test.ts` (9 tests, no
stand-in for our code, no faked provider, no mock of any kind): the argument
parser, the command, the real file IO over a real providers file in a temp
folder, and the product's own memory secret store (empty: "no key stored").
Seams the path must not touch are tripwires that fail the test when called
(`fetch`, `readSecret`; DNS answers nothing, so an entry that needs the
network resolves to the honest unreadable-list fallback). Covered: list with
the entry's models plus the unreadable note (openrouter with no key; a
retired-preset entry proving the same fallback with zero secret reads),
unknown entry with the closest configured ids, forced add storing the reason
with zero secret reads, blank-model refusal writing nothing, remove dropping
the forced reason and clearing a `defaultModel` naming the removed model,
refused removal with the closest ids leaving the file unchanged. The
list-consulting path (provider's own list with a stored key) has no automated
case: no recorded provider answer exists and live provider calls are out of
scope, so the lead's real-life run with a real key covers it (steps in §6).

## 6. Gates run on this lane, and the real-life scenarios for the lead

Static gates on the final tree: `npm run typecheck`, ESLint + Prettier on
changed files, `npm run check:l10n` (0 problems), `node
~/lanes/_ctx/codex/l10n-pack-diag.mjs` (all 14 `equal=true`),
`npm run check:reference`, `npm run deadcode`, `npm run security:sast`,
`npm run security:audit`, `npm run check:cycles`, the duplication check,
`npm run build` (headless 98.4 KiB under its 100 KiB cap after moving the
distance helper to a leaf module and the models command to its own lazy
module). Focused vitest suites at repository timeouts: cliHelp,
providersModels, acpRuntime, legalArgs, referenceEntry, reportCommand, plus
`npx vitest related --run` over the changed sources. No new end-to-end test
(owner's 2026-10-12 rules); the packed product is run directly instead:

- `exec --help` / `auth --help` / `providers --help` / `help exec` through
  the packed agent: exit 0, the command's own usage/options/examples, and no
  "Help & Reference" text.
- `exec --max-budgut 1 hi` through the packed agent: exit 2 naming
  `--max-budgut`, the accepted options and `exec --help`.
- `providers models <entry>` against a providers file whose entry points at
  a closed port: exit 0, the entry's models, then the unreadable-list note
  (a real connection refusal, nothing answered as a provider).
- With a real stored key: `providers models <entry>` additionally names the
  provider's models the entry does not offer; `--add` of one of them writes
  it; `--add` of an unlisted id is refused with the closest ids; the same add
  with `--force '<reason>'` writes it and later lists show the reason.
