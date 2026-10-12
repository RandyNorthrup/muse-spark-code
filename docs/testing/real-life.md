# The real-life run

The real-life run is the product's test. It takes the packed product,
installs it the way a person installs it, and uses it the way a person and
an editor use it, against real providers on their cheapest models. What it
observes is what a person would observe: an answer, a file on disk, an exit
code, a sentence on the screen, a cost above zero, a conversation that
loads again.

It is the gate for a release and the proof behind every claim the product
makes (`docs/testing/claims-*.json`, read by `scripts/check-claims.mjs`).
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
`--model openai=<model>` runs a route on another model. `--keep` leaves the
install, the home and the workspaces in place to look at.

The run exits 0 when every scenario it ran passed, 1 when one failed or a
key of the run is still in the credential store, and 2 for a wrong command
line.

### Routes

| Route                 | Wire format                       | Model                        | Key name            |
| --------------------- | --------------------------------- | ---------------------------- | ------------------- |
| `anthropic`           | Anthropic Messages                | `claude-haiku-4-5`           | `anthropic-fleet-1` |
| `openai`              | OpenAI Responses                  | `gpt-5-nano`                 | `openai`            |
| `xai`                 | OpenAI Responses, xAI             | `grok-build-0.1`             | `xai`               |
| `gemini`              | Gemini                            | `gemini-3.8-flash`           | `gemini`            |
| `zai`                 | chat completions, Z.ai            | `glm-5.3-flash`              | `zai`               |
| `anthropic-no-credit` | Anthropic Messages, no credit     | `claude-haiku-4-5`           | `anthropic-fleet-2` |
| `meta`                | Meta Model API                    | `muse-spark-1.3-contributor` | `modelapi-key`      |
| `musecode`            | Muse Code (the machine's sign-in) | `muse-spark-1.3-contributor` | none                |

Each model is the cheapest the route offers that the product's own
catalogue knows. The product hides a model its catalogue does not know, so a
route cannot run on one; and a key may list fewer models than its provider
has (`--model` picks one it does list).

On the Meta routes the model is always the contributor model, named. A
prompt is sent only while the session sits on the route's model: a session
on any other model is not used, and the scenario fails with nothing sent.

The Muse Code route needs the Muse Code CLI signed in on the machine. It
does not run on Windows.

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
name of its own (`rl-<route>`): its key sits beside your own entries and
never replaces one. Meta's key goes to each terminal command on standard
input and stores nothing; an editor session reads it from the store only,
so the run stores it with `auth set` only when no Meta key is stored, and
removes it afterwards. While another key is there, the Meta editor
scenarios are not run.

## What it costs

Before the first request the run prints the most requests it may make and
its dollar cap. It starts a scenario only while the scenario's own most
still fits under `--max-requests`, and starts nothing more once
`--max-usd` is reached. Afterwards it prints the requests made and the
dollars, and beside them what the product's own `usage` holds for that
home.

Requests and dollars are the product's own count: a terminal run by its
result, an editor session by the usage the product recorded for it. A
scenario that makes more requests than it said it may fails for that alone.

A full matrix on one route is at most 32 requests. Measured on 2026-10-12
on the published 0.18.1, both surfaces: 24 requests on Anthropic
`claude-haiku-4-5` cost $0.064, 23 on OpenAI `gpt-5.6-luna` $0.005, 23 on
Z.ai `glm-5.3-flash` $0.003 and 23 on Meta's contributor model $0.005.

Two things make the product's count larger than what a provider charges,
and both are the product's own behaviour, recorded as such:

- `exec` holds a request's worst case against its hard cap before it sends
  (a full context window at the model's price), so every `exec` is given a
  cap of $3.00. What it spends is what the result says.
- The product books a request the provider refused at the whole remaining
  reservation ($0.03 to $0.52 a request on 0.18.1). The scenarios that
  expect a refusal therefore run last, and a route whose plain turn fails
  is not asked for anything else that costs a request.

Keep a whole run under 150 requests and $1.00; say so first when a run
needs more.

## The record

`--record <file>` writes `<file>.json` and `<file>.txt`. The JSON is what
the claims gate reads; the text is the same for a person.

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
`musecode`); the vendor is in `model` and in `vendor`. Beside the gate's
fields each result keeps its observations one by one (`seen`), what the
product itself recorded for it (`recordedByProduct`) and, when it failed,
the last lines of the product's own log. `notRun` lists what was not
started and why. `keysLeftInTheCredentialStore` is empty unless the
clean-up failed.

A release's records live under `docs/testing/real-life/<version>/`.

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
