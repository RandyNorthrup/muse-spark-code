# The real-life run

The real-life run is the product's test. It takes the packed product,
installs it the way a person installs it, and uses it the way a person and
an editor use it, against real providers on their cheapest models. What it
observes is what a person would observe: an answer, a file on disk, an exit
code, a sentence on the screen, a cost above zero, a conversation that
loads again.

It is the record behind a release: what the packed product did, read by a
person. No gate reads it yet (there is no `scripts/check-claims.mjs` and no
`docs/testing/claims-*.json`), so it proves no product claim by itself.
The owner's rule, 2026-10-12: the tests are the app used in real life;
nothing is tested against fake code.

Nothing of the product is imported, replaced or faked. The run starts the
installed command and reads what it prints, what it writes and how it ends.

## What it does

`scripts/real-life/run.mjs` is plain Node with no test framework.

1. It installs the artefact (`npm install <tarball>`) into a new, empty
   folder, and makes a new, empty home: the product reads and writes no
   profile, setting, session or usage history of yours.
2. For each route it sets the product up the way a person does, through the
   product's own commands: `providers add … --key-stdin`, then
   `providers test`. That is the first scenario of every route.
3. For each scenario it makes a new, empty workspace and drives the product
   by one surface:
   - **exec**: the terminal agent (`exec` with its flags, `usage`,
     `providers`, `auth`).
   - **acp**: the editor protocol over the agent's standard input and
     output, as an editor speaks it (a new session, a prompt, a permission
     answered, a model picked, a session listed and loaded, a cancel,
     `/usage`, `/compact`).
4. It removes what it added, through the product's own commands, checks
   that it is gone, and writes the record.

## Run it

```text
node scripts/real-life/run.mjs \
  --artefact dist/muse-spark-code-acp-<version>.tgz \
  --routes anthropic,openai,meta \
  --max-requests 100 --max-usd 1.00 \
  --keys env \
  --record docs/testing/real-life/<version>/<system>-<date>
```

`--list` prints the routes and the scenarios and makes no request.
`--scenarios 'plain-*,usage'` picks scenarios by file name, several
separated by commas. `--surfaces exec` runs the terminal agent only.
`--model openai=<model>` runs a provider's route on another model. `--keep` leaves the
install, the home and the workspaces in place to look at.

The run exits 0 when every scenario it ran passed, 1 when one failed or a
key of the run is still in the credential store, and 2 for a wrong command
line.

### A model matrix

```text
node scripts/real-life/run.mjs \
  --artefact dist/muse-spark-code-acp-<version>.tgz \
  --matrix models.json \
  --max-requests 240 --max-usd 1.00 \
  --keys env \
  --record docs/testing/real-life/<version>/<system>-<date>-matrix
```

`--matrix` takes the place of `--routes`: a JSON file of route to model ids,
as the provider lists them.

```json
{
  "anthropic": ["claude-haiku-4-5", "claude-sonnet-4-6"],
  "openrouter": [{ "id": "some/model:free", "free": true }]
}
```

Each provider is added once with all its models ticked. Every model then
gets one plain turn and one tool turn (a file written) by the terminal
agent, and one result each in the record, with the model in `model`.
`free` says the model's listed price is zero, so its turn is expected to
cost nothing.

Four brakes keep a matrix from spending on what cannot work: a model whose
plain turn fails gets no tool turn; a route whose first three models all
fail with no usage reported is stopped (an account or a key, not a model:
its other models are listed as never asked); three plain turns in a row
that send nothing stop the run (the product has stopped sending); and once
a scenario does not fit under `--max-requests`, nothing later is started.

A matrix sets one setting of the product, in its own new home and nowhere
else: `paidDailyBudgetUsd` to 500 in the data folder's `settings.json`, the
way the product's README says a person sets the daily budget of the
terminal agent. The product's daily ledger keeps the reservation of every
request that ends with no usage; at its default of $5 a day it stops a
matrix after a few of them, and a model whose single reservation is above
$5 could not be asked at all. The record's first lines name the setting.

The product has no command that prints the models a key lists (`providers
test` prints their number), so the list comes from the provider's own
listing, and from what a session then offers once they are ticked: the
product offers the models its catalogue prices and hides the rest.

### Routes

| Route                 | Wire format                       | Model                        | Key name            |
| --------------------- | --------------------------------- | ---------------------------- | ------------------- |
| `anthropic`           | Anthropic Messages                | `claude-haiku-4-5-20251001`  | `anthropic-fleet-1` |
| `openai`              | OpenAI Responses                  | `gpt-5.6-luna`               | `openai`            |
| `xai`                 | OpenAI Responses, xAI             | `grok-build-0.1`             | `xai`               |
| `gemini`              | Gemini                            | `gemini-3.8-flash`           | `gemini`            |
| `zai`                 | chat completions, Z.ai            | `glm-5.3-flash`              | `zai`               |
| `deepseek`            | chat completions, DeepSeek        | `deepseek-flash`             | `deepseek`          |
| `mistral`             | chat completions, Mistral         | `ministral-3b-latest`        | `mistral`           |
| `groq`                | chat completions, Groq            | `openai/gpt-oss-20b`         | `groq`              |
| `together`            | chat completions, Together        | a DeepSeek V4 Flash          | `together`          |
| `fireworks`           | chat completions, Fireworks       | a Nemotron Lightning         | `fireworks`         |
| `huggingface`         | chat completions, Hugging Face    | `google/gemma-3-4b-it`       | `huggingface`       |
| `openrouter`          | chat completions, OpenRouter      | `mistralai/mistral-nemo`     | `openrouter`        |
| `anthropic-no-credit` | Anthropic Messages, no credit     | `claude-haiku-4-5-20251001`  | `anthropic-fleet-2` |
| `meta`                | Meta Model API                    | `muse-spark-1.3-contributor` | `modelapi-key`      |
| `musecode`            | Muse Code (the machine's sign-in) | `muse-spark-1.3-contributor` | none                |

Each model is the cheapest the route offers that the product's own
catalogue knows (`--list` prints the exact ids). The product hides a model
its catalogue does not know, so a route cannot run on one; and a key may
list fewer models than its provider has (`--model` picks one it does list).

A model of Meta's is asked on a Meta route, on the contributor model the
route names, and nowhere else. One rule in `lib/routes.mjs` decides it for
`--model` and for every model of a matrix: a Meta route takes no other
model (not another Muse model, not another contributor model), and a
provider's route takes no model of Meta's, whatever a reseller calls it.
In an editor session a prompt is sent only while the session sits on the
route's model, and a session of a Meta route is never set to any other
(the model-switch scenario leaves that step out there, and the record says
so). At the terminal every turn on a Meta route is first asked with a
budget of one millionth of a dollar, under which nothing is sent, and the
turn itself is sent only when the product names the route's model.

The Muse Code route is named and is not run, on any system. A request on
the Muse Code subscription is allowed only on a Muse Code CLI version known
to bill the contributor tier, and the product does not say which CLI
version it is about to start (its `report` prints "cli: found"), so the run
cannot check it. `--routes musecode` ends with that reason.

### Keys

A key is held in memory only. It reaches the product on the standard input
of the product's own command, and is never printed, written to a file or
put in a process argument. The record carries no key, no home folder, no
user name and no machine name: everything written passes through one
scrub.

- `--keys env` (any system): the variable `REAL_LIFE_KEY_<NAME>`, the key
  name in capitals with every other character as `_`
  (`REAL_LIFE_KEY_ANTHROPIC_FLEET_1`). Set it in the shell that starts the
  run and nowhere else. A variable that can hold a credential is never
  handed on to the product.
- `--keys dpapi:<folder>[;<folder>]` (Windows): `<folder>/<name>.dpapi`, a
  PowerShell secure string of the signed-in user, decrypted by PowerShell
  itself.

The operating system's credential store belongs to the signed-in user, so a
new home cannot replace it. The run therefore adds each provider under a
name of its own (`rl-<24 random hex digits>-<route ordinal>`, within the
product's 32-character limit): concurrent runs use different accounts. Its
key sits beside your own entries and
never replaces one. Meta's key goes to each terminal command on standard
input and stores nothing; an editor session reads it from the store only,
so the run stores it with `auth set` only when no Meta key is stored, and
removes it afterwards. While another key is there, the Meta editor
scenarios are not run.

What a route stored is removed when that route ends, when the run ends,
when it is interrupted (Ctrl+C, Ctrl+Break, a closing terminal, a
termination signal) and when it fails with an error nobody caught. A
process that is ended outright runs nothing. For that case the run writes a
note before it stores Meta's key (`real-life-run/meta-key-stored.json` in
the system's temporary folder: when, and by which run; never the key), and
clears it once the key is removed. The next run reads the note first of
all. It never removes a Meta key on the strength of the note, because you
may have stored your own since: it says, on its first line and in its
record, that a key is stored and that an earlier run left one, and how to
remove it (`auth clear`); when no key is stored any more, it clears the
note. A provider key left the same way has a recovery note (the provider name
only) under `real-life-run/providers/` in the system's temporary folder.
The note is written before storing and removed only after successful cleanup.
When it starts, a run checks those names plus the older static names
(`rl-<route>` and diagnostic `rlq-<route>`), reports present entries, and
names `auth clear --provider <name>`. It never removes an earlier entry;
its own per-run identity does not reuse those names.

## What it costs

Before the first request the run prints the plan's declared requests and
its admission stops. It starts a scenario only while its declared request
allowance fits under `--max-requests`, and starts nothing more once a stop
is reached or one scenario did not fit. **This is not a hard in-flight
request bound:** ACP has no per-request cap; extra model/tool/retry turns
can exceed the declaration during a running scenario. That cell fails and
nothing more is admitted once its usage reaches the stop. Dollar stops
also act between scenarios: a running scenario finishes, so it can take
the run above a stop by what it costs. Afterwards it prints the
requests made and the dollars, and beside them what the product's own
`usage` holds for that home.

Requests and dollars are the product's own count: terminal results are
reconciled with the journal after every cell, including matrix cells,
keeping the higher request and dollar counts rather than adding two views
of the same usage. Editor sessions use the journal. A missing or incomplete
terminal result fails the cell and stops further admission even if journal
usage was recovered: unjournaled spend may still be unknown. A scenario
that makes more requests than it said it may fails for that alone.

The product keeps kinds of dollars apart, and so does the run, in every
scenario's result, in the totals and in the first and last lines it prints:

- **settled** (`usd`): usage a provider reported, at the model's price.
  This is what `--max-usd` counts, because it is the money that was spent.
- **uncertain** (`uncertainUsd`): what the product booked for a request
  that was sent and came back with no usage report. It is the request's
  whole reservation, not a price; but the request reached the provider, so
  some of it may be real money (a provider that accepted the request and
  was cut off has charged for what it generated). It never counts as spend,
  and it has a stop of its own: `--max-uncertain-usd` (5 unless said).
- **held by the daily ledger** (`ledgerUnsettled`, in the totals): what
  the product's ledger of the local day holds with no settlement. It keeps
  a whole reservation for every request that came back with no usage (more
  than it books for a request an editor session stopped), and on a
  provider's route for a run it turned away for its budget before anything
  was sent. The run reads it once, at its end, from the ledger's files in
  its own home (`lib/ledger.mjs`). `turnedAwayUnsentRuns` counts the
  refusals the run itself asked for (a Meta turn's read-back).

An amount the product printed that the run cannot read is not zero: the
scenario fails with the text it could not read, and the run starts nothing
more.

A full matrix on one route is at most 32 requests. Measured on 2026-10-12
on the published 0.18.1, both surfaces: 24 requests on Anthropic
`claude-haiku-4-5` cost $0.064, 23 on OpenAI `gpt-5.6-luna` $0.005, 23 on
Z.ai `glm-5.3-flash` $0.003 and 23 on Meta's contributor model $0.005.

Two things make the product's count larger than what a provider charges,
and both are the product's own behaviour, recorded as such:

- `exec` holds a request's worst case against its hard cap before it sends
  (the model's whole output limit at the model's price), has no option
  that lowers it, and turns a smaller cap away with nothing sent and
  without saying how much it needs. Outside a matrix every `exec` is given
  a cap of $3.00. A matrix gives every turn $20, the most `exec` accepts
  (`lib/admission.mjs`), and does not feel for a model's cap with refusals:
  on 0.18.2 a run that is turned away for its cap leaves its reservation in
  the product's daily ledger for the rest of the day, and two refusals of a
  dear model stop every later run. What a run spends is what its result
  says.
- The product books a request that ended without a usage report at the
  whole remaining reservation: a request the provider refused ($0.03 to
  $0.52 a request on 0.18.1), and a request the person stopped in the
  middle of its answer ($0.33 on `claude-haiku-4-5` for 177 characters
  received, on the 0.18.2 candidate). The scenarios that expect a refusal
  therefore run last, in a pass of their own
  (`--scenarios unknown-model,no-credit`), and a route whose plain turn
  fails is not asked for anything else that costs a request.

Keep a whole run under 150 requests and $1.00; say so first when a run
needs more.

## The record

What the records of 0.18.2 say, in short (2026-10-12; the tarball that was
released). The twelve scenarios on four routes: 54 of 73 scenario runs
pass, and nothing that passed on 0.18.1 fails. The model matrix on the
direct keys: both turns pass on 38 of 47 models. Of the nine that fail,
three xAI models refuse the reasoning setting the product sends them, five
Mistral models answer and the product cannot read their thinking parts, and
one Mistral model answers in full and the run still ends as over budget.
Every such failure is shown as "the response did not complete" and booked
at the whole reservation, and a run turned away for its budget holds its
reservation against the day. The causes as they were read, with the
providers' own answers, the numbers and how to replay them, are in
`docs/testing/real-life/0.18.2/causes-2026-10-12.json`.

`--record <file>` writes `<file>.json` and `<file>.txt`. The JSON is the
release's record; the text is the same for a person.

```json
{
  "artefact": { "name": "muse-spark-code-acp-0.18.1.tgz", "sha256": "…" },
  "os": "Windows_NT 10.0.26200 x64",
  "startedAt": "2026-10-12T20:58:11.004Z",
  "endedAt": "2026-10-12T21:01:40.310Z",
  "results": [
    {
      "scenario": "plain-turn",
      "claims": ["ref/cli/exec/exec"],
      "route": "provider",
      "model": "claude-haiku-4-5 (Anthropic Messages)",
      "surface": "exec",
      "outcome": "pass",
      "observed": "saw the command ends with exit code 0: exit 0 | …",
      "requests": 1,
      "usd": "0.002661",
      "seconds": 2.4
    }
  ]
}
```

`route` is the claims table's name for it (`provider`, `modelapi`,
`musecode`); the vendor is in `model` and in `vendor`. `usd` is the settled
dollars. Beside the gate's fields each result keeps what the product booked
with no usage (`uncertainUsd`), its observations one by one (`seen`), what
the product's usage history recorded for it (`recordedByProduct`, outside a
matrix) and, when it failed, the last lines of the product's own log. `notRun` lists what was not
started and why. `keysLeftInTheCredentialStore` is empty unless the
clean-up failed.

A release's records live under `docs/testing/real-life/<version>/`. Beside
them a folder may keep what was read to explain a failure: the providers'
own answers (`provider-answers/`), the scripts that read them
(`diagnostics/`, which are not part of the run and which no scenario
loads), and the causes as data (`causes-<date>.json`).

## Add a scenario

A scenario is one small file in `scripts/real-life/scenarios/`: what the
person does, and what must be observed afterwards.

```js
// A person asks one thing and gets the answer.
export default {
  title: 'A plain turn completes',
  exec: {
    claims: ['ref/cli/exec/exec'],
    requests: 1,
    async run(person, see) {
      const marker = person.marker()
      const turn = await person.exec(`Reply with exactly this and nothing else: ${marker}`)
      see('the command ends with exit code 0', turn.code === 0, `exit ${String(turn.code)}`)
      see(
        'the answer carries the word',
        turn.result?.finalMessage?.includes(marker) === true,
        turn.result?.finalMessage,
      )
    },
  },
}
```

- `exec` and `acp` are the two surfaces; a scenario has one or both.
- `claims` are ids from the claims table, per surface.
- `requests` is the most model requests the surface may make.
- `see(what, ok, saw)` records one observation: what must be true, whether
  it was, and what was actually there. A scenario passes when every
  observation holds.
- `only: (route) => …` keeps a scenario to the routes it is for; `order`
  moves it earlier or later (50 when it says nothing).

Observe what a person can observe. Say nothing about a model's wording
beyond a marker the prompt asks for (`person.marker()`), and nothing about
the product's inner state.

What `person` can do: `exec(prompt, { mode, maxRequests, model, args })`,
`command(args)`, `openEditor()` (then `newSession()`, `listSessions()`,
`loadSession(id)`, `stop()`; a session has `prompt(text, { permissions })`,
`start(text)` with `cancel()`, `setModel(value)`, `setMode(id)`,
`models()`), `usage()`, `file(name)` and `marker()`.

The runner has no test suite of its own: it is proven by running it.

## Beside it

`test/e2e/eval.live.e2e.test.ts` and its harness (the M75 evaluation) also
make real calls on the contributor model. They stay as they are.
