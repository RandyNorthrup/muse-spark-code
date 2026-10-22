# Editor commands answer (lane ACPSAY, 2026-10-12, macmini)

Three defects the lead's real-life run showed on the published 0.18.1 and
the 0.18.2 candidate, fixed as classes on branch
`fix/editor-commands-answer` (from main `898a26c5e3` = release 0.18.2).

Worktree `/Users/randy/lanes/ACPSAY`. No model call and no request to
any model provider anywhere in this lane (one accidental live attempt is
recorded under proof). Every sentence below that a person reads comes
from the English table with translations in all 14 locale files in the
same commit (`npm run check:l10n`: 0 problems; pack-order diagnostic:
`equal=true` for all 14).

## 1. Every command a person can send in an editor session ends with something the person can read

Command dispatch audited in `src/acp/agent.ts` (`prompt()`, vault block,
`mediaCommand()`, `usageReply()`, `setConfigOption()`), with the result
contracts of `src/acp/accounts.ts`, `src/acp/questionDeferral.ts`
(`command(): Promise<string>`), `src/acp/resources.ts`, `src/acp/reports.ts`
(`runAcpReport(): Promise<string>`), `src/runtime/usage/usageAcp.ts` and
the playbook/sharing/schedule/estimate/legal ports.

| Command                                    | Success: the person reads                                                     | Nothing to do: the person reads                           | Failure: the person reads                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `/help`                                    | The command reference (`compactReference`)                                    | Always lists                                              | Protocol error speaks                                                 |
| `/compact`                                 | `Compacted N turns into a summary (B before, A after)` / `Context compressed` | `Nothing to compact (reason)` / `Compaction stopped`      | Protocol error speaks                                                 |
| `/usage`, `/usage page`, `/usage open`     | Usage text, then the page link                                                | A turn stopped first ends `cancelled`, not silent (fixed) | Protocol error speaks                                                 |
| `/accounts …`                              | JSON list / current / thresholds text                                         | n/a                                                       | Errors speak; no sentence is now a refusal instead of silence (fixed) |
| `/vault status\|list\|lock\|audit`         | Vault text                                                                    | n/a                                                       | `brokerBlocked` / `noAccess` speak                                    |
| `/report <kind> [args]`, `/report history` | Report text, or `generationFailed` with no port                               | `No report history yet.`                                  | Protocol error speaks                                                 |
| `/agents [receipt\|continue\|retry] [ID]`  | Agent text (always a string)                                                  | Same path                                                 | Busy/error speaks; stopped ends `cancelled`                           |
| `/questions`, `/answer …`                  | Question text (always a string)                                               | `No open questions.` etc.                                 | Protocol error speaks                                                 |
| `/playbook …`                              | Playbook text when bound                                                      | Falls through to skill/model turn when unbound            | Protocol error speaks                                                 |
| `/schedule …`                              | Result text, or the unavailable sentence                                      | Same path                                                 | Protocol error speaks                                                 |
| `/estimate …`                              | Estimate text, or the runtime-unavailable sentence                            | Usage sentence for bad args                               | `estimateFailed` sentence speaks                                      |
| `/legal [--offline]`                       | Scan text                                                                     | n/a                                                       | `legalScanUnavailable` speaks                                         |
| `/share …`, `/prompt …`                    | Sharing text                                                                  | Stopped ends `cancelled`                                  | Errors speak                                                          |
| `/attach <path>`                           | Attachment metadata text                                                      | Missing arg is a refusal                                  | Errors speak                                                          |
| `/record`                                  | Attachment metadata, or `recordingDiscarded` when dismissed                   | Dismissed still answers                                   | Headless/user-only refusals speak                                     |
| `/resources …`, `/usage resources`         | Resource text (always speaks when it claims the command)                      | Same path                                                 | Errors speak                                                          |
| `session/set_config_option` model/effort   | Silent config update (not a command turn)                                     | n/a                                                       | Refusal sentences (defect 3)                                          |
| Unknown `/word`                            | Skill or model turn (the model speaks)                                        | n/a                                                       | Model/backend errors speak                                            |

Silent before, silent after: the audit found two reachable silent turns
(`/accounts` returning no sentence; `/usage` stopped before its first
sentence) plus the reported `/compact` silence (fixed in the lane's
earlier commit `ec178177b`, same branch). Silent after: 0 reachable
command turns end `end_turn` with nothing to read. `cancelled` stop
reasons carry no text by protocol design; a stopped usage now reports
`cancelled` instead of `end_turn`.

Construction note (honest deviation): the brief asked that a command
returning no sentence not compile. That refactor — one result type for
every command port — was judged too big for this box next to the
behavioural fix and its proof. What holds by construction today: the new
sentence paths return text-or-throw (`accounts`, `usageReply` via the
reply gate, `compactResultText`, the refusal builder), and the table
above is the audit record. A follow-up may brand the sentence type.

## 2. A status of the product is never delivered as model text

Entry point on the editor protocol: `UpdateTranslator.updates()`
(`src/acp/translate.ts`), `backendNotice` case — the single choke point
for both backends (the Model API host emits `backendNotice` events; the
Muse Code backend maps its notifications to them in
`src/core/backends/musecode/mapNotification.ts`). Before: every notice
was sent as `agent_message_chunk` text, so the first model reply opened
with product status as if the model had said it.

After: every notice goes through the protocol's own channel,
`{ sessionUpdate: 'notice', severity, title }`. Pinned SDK 1.7.0,
`node_modules/@agentclientprotocol/sdk/dist/v2/schema/types.gen.d.ts:4441-4481`
(`Notice`, `NoticeSeverity`): "No Client capability is required, and
unsupported Clients may ignore notices." An earlier draft of this fix
gated on a client `notices` capability; the SDK says there is none, so
the gate was removed. An empty notice has no title and is dropped, never
sent as blank model text. Notices carry no part separator: they are live
events, never session history.

Every notice that took this path (Model API host unless noted):

- Turn-start budget/admission: `childCheckpointFailed`, `sendMarkFailed`
- Media omitted/replaced: `olderMediaOmitted`, hook output replaced
- Search/budget: `sessionBudgetSearchUnavailable`,
  `sessionBudgetUnknownCharge`, `sessionBudgetOutputLimited`, `budgetTurnCost`
- Hooks/elicitation: `elicitationDeclinedByHook`,
  `elicitationAnsweredByHook`, `hookTeammateKept`,
  `hookRefusedModelSwitch`, hook-model entry warning, reviewer entry
  (`autoReviewerTripped`, `autoReviewerFailed`, reason text)
- Schedules entry: `checksStoppedNotice`
- Continuation/limits: `modelApiContinuing`, `modelApiContinuationLimit`,
  `modelApiToolStuck`
- Soundtrack model: `media.useSoundtrackModel`
- Compaction: `autoCompactionAwaitingEvaluation` (once per session),
  `autoCompactionFailed`
- Dynamic `message`/`reason`/`notice.text`/`notice.reason`/`detail`
  notices (policy problems, schedule runs, subagent/hook reasons)
- Muse Code backend: `turnRetracted` and mapped notification text

Decision on the awaiting-evaluation notice: it stays, once per session,
now as a notice. It tells the person that Automatic compaction is on but
does nothing until the evaluation finishes; what they can do is turn the
setting off. The setting's own description
(`config.modelApiAutoCompaction.description`) promises exactly that —
"turning this off hides the notice" — so removing the emission would
break the documented contract. After the fix it no longer opens the
answer; it arrives beside it, after the person's own turn has started
(the emission sits inside the turn run, after admission).

Ordering note: no notice is emitted at session creation or before the
first prompt; all sites above fire inside a turn.

## 3. A refusal names what was refused and why

One sentence source: `src/core/unknownModel.ts`
(`unknownProviderModelText`, `listModelsRemedy`, `refEntryName`,
`unknownModelRefText`, `effortNotForModelText`), shared-only so every
bundle can carry it (the first version imported the provider parser and
broke `npm run build`'s bundle-split gate in 8 places; the parser went
back to the call sites that already load it).

Every use of the old shared sentence
(`This model is not available for this run.`) and its true cause:

| Site                                                          | True cause                                                                                 | Sentence now                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `execArgs` `--model` vs `--provider`                          | Value unparsable, or naming another provider                                               | Model + provider + `providers list`                                       |
| `providerExec` `--model` vs entry                             | Value names another entry, or nothing parsable                                             | Model as typed + this entry + `providers list`                            |
| `providerExec` no model, file default names another entry     | The file's default belongs elsewhere; the run has no model                                 | Default + this entry + `--model provider/model`                           |
| `providerExec` id not in the entry's own `models` (new check) | The entry does not offer this id                                                           | Model as typed + this entry + `providers list`; empty list judges nothing |
| `providerRegistry.resolve`                                    | No configured provider offers this id (bare Meta ids never resolve here)                   | Typed id + asked entry (`meta` lane gets the pick-offered remedy)         |
| `ModelApiHost.resolveModel` / `selectedModel`                 | Unknown or stale reference                                                                 | Typed id + asked entry + matching remedy; no request sent                 |
| `runExec` `--model` vs the child session's options            | The session does not offer this id                                                         | Typed id + this session + pick-offered                                    |
| ACP `session/set_config_option` model                         | The session does not offer this id                                                         | Typed id + this session + pick-offered                                    |
| Chat codec, 3 sites (text/image paths)                        | A part the chat route cannot carry (incl. images with no vision answer) — never a model id | The part kind                                                             |
| `acp/media` model change mid-attach                           | Stale, not unknown                                                                         | Existing stale-request sentence + retry                                   |
| `runExec` `--effort`, ACP effort option                       | Effort not on this model                                                                   | Effort + model + the valid levels                                         |

Adjacent fix on the way: the providers-file read error filled the wrong
slot (`{ reason: … }` for a `{detail}` template) and always rendered
`Test failed: {detail}`; it now renders the detail.

Not duplicated: a provider's own wire refusal (HTTP 4xx/5xx, unknown id
at request time) stays the provider-refusals lane's; ours all fire
before any request is sent.

Removed keys: `execUnknownModel`, `execEffortUnavailable` (English table
plus all 14 locales, same positions). Added: `modelNotOnProvider`,
`modelNotInSession`, `unknownModelListModels`,
`unknownModelPickOffered`, `chatPartNotSupported`, `effortNotForModel`.

## Proof

Built product: `npm run build` green (all size budgets and the split
gate; no cap raised, no pin moved). The packed agent is `dist/acp.js`,
driven over stdio with the SDK's own client from a scratch driver (kept
outside the repo; `temp/` is gitignored). Editor sessions run on the
Muse Code backend behind the repo's existing fake CLI (its credential
file holds placeholders only); local commands never reach the CLI. The
OS credential store is unreachable in this sandbox, so the run uses an
empty in-memory keyring stand-in plus a fake key that is never sent —
no real credential, no model call. One accidental live attempt happened
during setup (a fake Model API key was validated against the network and
refused); nothing was sent afterwards.

Terminal form, packed (`node dist/acp.js exec --backend modelApi
--max-budget-usd 0.01 …`):

- `--provider openai --model anthropic/nope-9`: before (0.18.2 bytes):
  `This model is not available for this run.` After:
  `Model "anthropic/nope-9" is not offered by provider "openai". Run
"providers list" to see the models it offers.`
- Providers file with entry `acme` (preset `openai`,
  `http://127.0.0.1:9/`, models `[m1]`), `--provider acme --model
acme/nope-9`: after:
  `Model "acme/nope-9" is not offered by provider "acme". Run
"providers list" to see the models it offers.` (0 requests; the port
  is closed. Before this lane the same run died later with
  `Backend Unavailable` and no refusal.)
- Same entry, `--model acme/m1`: proceeds past the refusal into the run
  (then fails at the closed port as it should).

Editor protocol, packed, what the person reads:

- `/help` → `end_turn` with the command reference text.
- `/compact` (empty session) → `end_turn` with
  `Nothing to compact (no_compactable_history).`
- `/usage` → usage text (`# Usage & Cost…`).
- `/accounts` (no account service in this runtime) → protocol error
  naming the cause, never silence.
- `/questions` → `end_turn` with `No open questions.`
- `/report history` → `end_turn` with `No report history yet.`
- `/attach` (no path) → `Invalid params: The file could not be read.`
- `/record` (no upload bindings here) → `Invalid params` naming the
  missing bindings.
- `session/set_config_option` model `nope-9` → `Invalid params: Model
"nope-9" is not offered in this session. Choose one of the models
offered instead.`
- `session/set_config_option` effort `ultra` → `Invalid params: Effort
"ultra" is not available for model "muse-spark-1.3". Use one of:
minimal, low, medium, high, xhigh, max.`

Pure-logic tests through the real modules only (no mocks, no fakes):

- `test/unit/unknownModel.test.ts` (new, 8 tests): the builder names
  model/entry/remedy; `refEntryName` lanes bare/slashed ids;
  `providerRegistry.resolve` through the real registry with data-only
  deps refuses with the typed id and entry; effort names levels; the old
  sentence is gone.
- `test/unit/acpBackendNotice.test.ts` (new, 3 tests): a backend notice
  becomes `{ sessionUpdate: 'notice', … }`, never an agent message;
  severity survives; empty notices are dropped.
- Red drill: with the translator temporarily restored to agent text,
  2 of the 3 notice tests fail; restored byte-exact (SHA-256
  `c1026539…` before and after).
- Updated to the new contract (real tests, observation-only or no
  doubles): `test/unit/acpTranslate.test.ts` (1 assertion, 44 pass),
  `test/unit/modelapiChatCodec.test.ts` (2 assertions, 92 pass).
- Untouched suites re-run: `compactResult` (5), `acpAccounts` (36),
  `cx1r5Truth` (63) — all pass.

Real-life scenarios for the lead (real providers, packed agent):

1. Editor session on any backend, fresh conversation: send `/compact`.
   Before: `end_turn` with no text. After: one sentence naming the
   turns folded and sizes, or why nothing was done. On Anthropic
   `claude-haiku-4-5`, OpenAI `gpt-5.6-luna` and Meta
   `muse-spark-1.3-contributor` alike (the sentence is built before any
   provider is involved).
2. Turn Automatic compaction on, send one chat turn. Before: the reply
   opens with `Automatic compaction is awaiting evaluation and is
inactive.` as model text. After: the same words arrive as a notice
   beside the answer; turning the setting off hides them.
3. Terminal: `exec --provider <entry> --model <an id it does not have>`
   (or `--model` outside the session's list on the default backend).
   Before: `This model is not available for this run.` After: the typed
   id, the entry, and `providers list` (or the session remedy).

## Gates and suites

- `npm run build`: green (sizes + split; the first attempt failed the
  split gate 8× on the new module importing the provider parser —
  fixed by keeping the module shared-only).
- `check:l10n`: 0 problems; pack-order diagnostic `equal=true` all 14.
- `check:reference`: matches (73 features, 65 commands, 89 settings, 29
  slash, 244 CLI). No command/setting text changed, so no reference
  regeneration was needed.
- `deadcode` (knip): clean; `cycles`: none; `duplication`: 0 clones.
- `security:audit`: 2 advisories, 1 exception (unchanged).
- `security:sast`: NOT RUN — semgrep cannot start in this sandbox
  (`PermissionError … '/Users/randy/.semgrep/semgrep.log'`).
- Typecheck: host, webview, e2e, integration clean; unit has exactly one
  error, in the stand-in `test/unit/execProvider.test.ts:130` (references
  the removed key; TESTCUT owns the file).
- Loopback suites: not runnable here (this Mac sandbox cannot listen on
  loopback); no loopback proof was attempted.

Stand-in suites that fail because of this lane's intentional changes
(owner's rule: named and left for TESTCUT/the lead):

- `test/unit/execProvider.test.ts`: `falls back to the default model
only when it names the provider` expects the removed sentence (my
  468-sentence replaced it). Plus 1–2 timeouts in `probeProvider` /
  readiness rows (public-DNS path untouched by this lane; one passed on
  rerun — load-flaky, base UNMEASURED).
- `test/unit/acpModelApi.test.ts`: `writes a file the client allowed…`
  asserts the first reply is notice-text + model text (the exact defect
  2 behaviour). Plus the `Allow always` paid row times out at 5 s
  (stand-in; base UNMEASURED).
- `test/unit/modelApiAutoCompact.test.ts`: `keeps a committed manual
summary…` — measured: passes on base `898a26c5e3`, fails identically
  on the lane's earlier compact commit `ec178177b` and on this tree
  (the added outcome fields vs an exact-shape assertion). Predates my
  commit; named, not repaired (stand-in kind).
- `test/unit/acpAgent.test.ts`: `exposes all three ChatGPT actions…`
  measured failing on base too (not mine). The two paid-timing rows fail
  in full-file runs on this loaded rig but pass isolated on this tree
  (and split on base) — load/order-flaky, not attributed.
