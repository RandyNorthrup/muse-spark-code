# Provider truth (F82, F83, F85) — lane PROVIDERTRUTH

Base `06847350f` (PR 172 head), branch `fix/provider-truth`. All runs
directly in this worktree on `wslpc`, repo default timeouts (no
`--testTimeout`), vitest `--maxWorkers=3`.

## F82: an internal status shown as the model's own words

Before: every Model API turn through the editor protocol prefixed the
model's reply with "Automatic compaction is awaiting evaluation and is
inactive." Root cause: `UpdateTranslator.updates()` mapped every
`backendNotice` to `agent_message_chunk`
(`src/acp/translate.ts:474` before the fix).

After:

- `src/acp/translate.ts` — `backendNotice` becomes
  `{ sessionUpdate: 'notice', severity, title }` when the client
  advertised `session.notices` (ACP SDK 1.7.0 schema `Notice`; the
  spec's sanctioned fallback stays an agent message otherwise).
- `src/acp/agent.ts` — the session's translator is told whether the
  client advertised `session.notices`
  (`clientCapabilities.session?.notices != null`).
- `src/runtime/exec/runExec.ts` — headless runs print the notice on
  stderr (`log.warn`) beside the run instead of dropping it.
- Panel: already a separate notice
  (`conversationController.ts:2414` → `this.notice(...)`); unchanged.

The notice still fires once per session (`didReportCompactionEvaluation`,
`ModelApiHost.ts:2603,14164-14166`); the wording is unchanged, so no
locale churn.

Tests: `test/unit/acpTranslate.test.ts` (real module, data in) — the
old expectation (notice → agent chunk) is kept for clients without
notices support; a notices-capable translator now asserts the `notice`
update. Red drill: old `translate.ts` (from HEAD) → 1 failed / 43
passed; restored byte-exact (SHA-256 `a2c2615e…`, verified equal after
restore); final run 44 passed.

Real-life run for the lead: configure a capable provider, open an ACP
session from an editor that advertises `session.notices`, run a first
Model API turn. Observe: the turn carries no compaction sentence in the
model's text; the client receives one
`session/update` with `sessionUpdate: 'notice'`,
`severity: 'info'` and the awaiting-evaluation title. In a terminal,
`exec --backend modelApi --provider <id> --model <ref> --max-budget-usd
<X> <prompt>` prints the same line on stderr beside the run.

## F83: a model without confirmed tool calling disappears with no reason

Before: `createProviderRegistry().list()` returned `[]` for any model
whose `policy.tools.calling.state !== 'yes'`
(`src/core/providers/providerRegistry.ts:45` before the fix), so e.g.
Together `openai/gpt-oss-20b` vanished from every model list silently.

After (one sentence everywhere —
`providerModelNoToolCalling` in `src/shared/l10n/en.ts` + all 14
`l10n/ui.*.json`, in English order):

- Registry `list()` keeps the model and sets `agentLimit` (new optional
  `ModelSummary` field, `src/core/agent/agentBackend.ts`).
- Panel picker shows the sentence as the row detail
  (`protocol.ts` `modelOptionSchema.agentLimit`,
  `conversationController.ts` pass-through, `Palette.tsx`).
- Editor protocol model option carries it as `description`
  (`src/acp/agent.ts` `configOptions()`).
- Panel add wizard tick step shows it beside the row
  (`src/webview/models/Wizard.tsx`; rows already carried
  `toolCalling` from `scanRows`).
- Terminal `providers add` prints it per added model whose catalogue
  evidence does not confirm tool calling
  (`unconfirmedToolModels` in `src/runtime/providersCommands.ts` —
  the same catalogue evidence the registry resolves; a missing
  catalogue stays silent).
- `resolve()` refuses an agent turn on such a model with the same
  sentence — the one choke point for panel `setModel`, ACP
  `set_config_option` + turn start, and headless exec
  (`ModelApiHost.setModel` → `resolveModel`, `ModelApiHost.ts:15985`).

Tests: new `test/unit/providerRegistry.test.ts` (real module, injected
data rows): unconfirmed + unknown-capability models stay listed with
the sentence, a confirmed model has no `agentLimit`, and `resolve()`
rejects with the sentence (unknown refs still get `execUnknownModel`).
Red drill: old `providerRegistry.ts` → 2 failed; restored byte-exact
(SHA-256 `3d2b50e0…`, verified equal after restore); final run
2 passed.

Real-life run for the lead: `providers add --preset together --as
matrix-together --key-stdin --model openai/gpt-oss-20b` prints the
sentence after the wizard summary and before the `Added …` line
(corrected in review; it does not follow `Added …`); the model appears
in the panel picker and the session model list with the sentence;
starting an agent turn on it fails with the sentence and sends no
request.

## F85: the terminal speaks panel words and cannot discover models

Before: `providers add --preset openai … --key-stdin` without `--model`
fell through to the wizard's `Tick at least one model.` blocker, and
the ids the key test had just read were discarded (`modelCount` only).

After: the key test's listed ids ride the probe outcome
(`KeyProbeOutcome.modelIds`, `src/core/providers/presets.ts`,
`probeProvider` in `src/runtime/providersCommands.ts`), and
`providersAdd` without `--model` prints
`providerAddPickModel` plus one id per line on stderr and exits 1 —
before reaching the wizard. `--model` is repeatable (array flag,
`src/runtime/cliArgs.ts:521`). The panel keeps `Tick at least one
model.` unchanged.

Proof (packed `dist/acp.js`, real `providersAdd` + real loopback
models list — see "Packed drills" below): [drill outputs].

Real-life run for the lead: `providers add --preset openai --as …
--key-stdin` (no `--model`) lists the key's models and names
`--model <id>`; re-run with `--model <one id>` adds it.

## Packed drills

Method: `npm run build` (exit 0, all caps/split checks pass), then
`node dist/acp.js …` against a static local Ollama-shaped `/api/tags`
(`{"models": [{"name": "drill-model-a"}, {"name": "drill-model-b"}]}`;
a diagnostic stand-in for the provider list; no model call is made in
any drill; isolated `XDG_CONFIG_HOME=temp/drill/cfg`).

BLOCKED by this session's sandbox (measured 2026-10-15 ~22:00 UTC):
cross-process loopback does not work here. Same-process
`fetch('http://127.0.0.1:<port>/')` returns 200 (`temp/drill/ping.mjs`
drill), but a plain child `node -e "fetch(...)"` fails
(`temp/drill/child.mjs` drill: `child failed: fetch failed`, no server
HIT), so the packed `dist/acp.js` child never reaches the drill
server: `providers add` answers `Test failed: The provider could not
be reached.` (exit 1, no server HIT) for both the no-`--model` and the
`--model` invocations. This is environmental, not a product defect:
the identical `providersAdd` through real source code in-process DOES
reach the server (scratch vitest, since removed).

What ran instead (same code the bundle ships — `providerAddPickModel`
is present in the built `dist/acp.js`): real `providersAdd` from
source against the real drill server, no `--model`:

- server HIT `GET /api/tags`, exit 1,
- stderr: `Add one or more of these models with --model <id>
(repeatable):` then `drill-model-a`.

That is F85's new behavior end to end through the real command, short
of the bundle boundary.

Lead rerun (outside the sandbox), from the worktree root:

Run `node temp/drill/packed.mjs` from the worktree root (all four
packed runs with HIT logging),

or by hand: serve `{"models": [{"name": "drill-model-a"},
{"name": "drill-model-b"}]}` at `GET /api/tags` on
`http://127.0.0.1:48733`, then with an isolated config dir:

```sh
export XDG_CONFIG_HOME=<empty dir>
node dist/acp.js providers add --preset ollama --as f85drill \
  --address http://127.0.0.1:48733
# exit 1, stderr names --model <id> and lists drill-model-a,
# drill-model-b (F85)

node dist/acp.js providers add --preset ollama --as f85drill \
  --address http://127.0.0.1:48733 --model drill-model-a
# exit 0; prints the tool-calling sentence for
# f85drill/drill-model-a (catalogue has no Ollama tool evidence),
# then `Added f85drill; …` (F83 add-time)

node dist/acp.js providers list
# shows the f85drill row with drill-model-a (F83 listed, not hidden)

node dist/acp.js exec --backend modelApi --provider f85drill \
  --model f85drill/drill-model-a --max-budget-usd 0.05 "say hi"
# refused with the F83 sentence, no request sent (F83 refusal)
```

The drill scripts live in `temp/drill/` (gitignored scratch, not on
the branch): `packed.mjs` (all four packed runs with HIT logging),
`run.mjs`, `hit.mjs`, `ping.mjs`, `child.mjs`, `curl.mjs`,
`probe.test.ts`.

## Gates (final tree)

| Gate                                                                        | Result                                                                                                                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc -p tsconfig.json --noEmit` (host)                                  | exit 0                                                                                                                                                                          |
| `npx tsc -p src/webview/tsconfig.json --noEmit`                             | exit 0                                                                                                                                                                          |
| `node …/tsc -p test/unit/tsconfig.json --noEmit`                            | exit 0                                                                                                                                                                          |
| `npx tsc -p test/e2e/tsconfig.json --noEmit`                                | exit 0                                                                                                                                                                          |
| `npx tsc -p test/integration/tsconfig.json --noEmit`                        | exit 0                                                                                                                                                                          |
| `npx eslint --max-warnings=0` on all changed TS files                       | 0 problems                                                                                                                                                                      |
| `npx prettier --check` on all changed files                                 | pass                                                                                                                                                                            |
| `npm run check:l10n`                                                        | 14 UI + 14 usage tables, 0 problems                                                                                                                                             |
| locale key order (`providerTestOk` < new keys < `providerProbeUnreachable`) | ok in all 14                                                                                                                                                                    |
| `npm run check:reference`                                                   | 73 features, current                                                                                                                                                            |
| `npm run check:host-api`                                                    | 0 problems                                                                                                                                                                      |
| `npm run deadcode` (plain knip)                                             | exit 0                                                                                                                                                                          |
| `npm run cycles`                                                            | no circular dependency                                                                                                                                                          |
| `npm run duplication` (jscpd)                                               | 0 clones                                                                                                                                                                        |
| `npm run security:audit`                                                    | exit 0 (2 advisories, 1 exception)                                                                                                                                              |
| `npm run security:sast`                                                     | NOT RUN: semgrep not installed on this rig (`which semgrep` empty)                                                                                                              |
| `npm run build`                                                             | exit 0, all caps/split checks pass (extension 550.8/600 KiB, modelApi 507.2/525 KiB)                                                                                            |
| `test/unit/acpTranslate.test.ts`                                            | 44 passed                                                                                                                                                                       |
| `test/unit/providerRegistry.test.ts` (new)                                  | 2 passed                                                                                                                                                                        |
| `vitest related` over 9 changed src files                                   | 26 files, 496 passed / 24 skipped                                                                                                                                               |
| modelsPanelSections + Palette + providersL10n                               | 72 passed                                                                                                                                                                       |
| providersFlow + providersModel + byoProtocol                                | 57 passed                                                                                                                                                                       |
| modelsPanelSchemas + modelsPanelReducer                                     | 21 passed                                                                                                                                                                       |
| acpPackageFixtures                                                          | 3 passed                                                                                                                                                                        |
| packed `execStdio` e2e                                                      | NOT RUN HERE: needs loopback to the packed child (sandbox-blocked, see above); lead runs `NPM_CONFIG_CACHE=… npx vitest run test/e2e/execStdio.e2e.test.ts` outside the sandbox |

## The compaction report for the lead (F82 context, no code change)

What automatic compaction waits on: the evaluated latch
`IS_AUTO_COMPACTION_EVALUATED` (`src/shared/constants.ts:2226`,
currently `false`), AND the `museSpark.modelApiAutoCompaction`
setting (machine-scoped, default on), AND per-turn admission
`admitAutoCompaction` returning the shared paid (D78) actual-send
guard with per-attempt settlement
(`ModelApiHost.maybeAutoCompact`, `src/core/backends/modelapi/ModelApiHost.ts:14757`;
`admitAutoCompaction` is the fail-closed port,
`docs/certification/m101-c2.md:92-98`). Corrected in review: the
constant is not read through a single reader — `ModelApiHost`,
`src/host/backend/modelApiEntry.ts`, `src/host/paid/paidHost.ts`,
`src/acp/paid.ts`, `src/extension.ts` (twice) and
`src/runtime/backends.ts` (twice) read it directly, while
`isAutoCompactionEvaluated()` (`constants.ts:2228`) serves
`src/shared/paid.ts`, `src/shared/paidBoundary.ts`,
`src/shared/reference/referenceEntry.ts` and
`src/runtime/cliOptions.ts`. Flipping the one constant reaches all of
them; there is no second latch.

What exactly must run to activate it (lane E,
`docs/certification/m101-c2.md:100-119`), corrected in review for what
this tree already has: the D78 admission binding m101-c2 lists as
future work is already bound — the panel passes
`reserveAutoCompaction` (`src/extension.ts:2739`), the runtime passes
transport accounting (`src/runtime/backends.ts:522`), and
`src/host/backend/modelApiEntry.ts:116-158,212` builds
`admitAutoCompaction` from them for every Model API host. What remains
is the evaluation itself: freeze the long-context accept and held-out
tasks on the current M75 harness; in that bounded harness only, inject
`autoCompaction: () => true`, `autoCompactionEvaluated: () => true`
plus the real shared D78 guard/ledger adapter; run the paired
baseline/mechanism evaluation and require both 0.75 capability floors
with actual compaction evidence; only then flip the constant to
`true`.

Real model calls and which models: zero for compaction to date
(`docs/certification/m101-c2.md:5-7`: "zero live or paid model
attempts" in that lane, and no later record runs the pair). The M75
task set is twelve tasks, seven accept and five held-out (PLAN.md,
the M75 packing record); the only completed pair on it, for
observation packing, made 111 model calls on
`muse-spark-1.3-contributor` for $0.0156
(`docs/certification/m73-run.md:3`). A compaction pair's call count is
not predetermined — it is whatever the frozen twelve tasks take on
both arms, on the same contributor model unless the freeze names
another — and no honest total can be quoted before that run. After
activation each auto-compaction costs the host's conservative
estimate of two summary requests on the session's own selected model
(`docs/certification/m101-c2.md:29-35`: cached-prefix response +
possible tool-less fallback, zero assumed cache hits), each actual
attempt settled through the D78 guard.

Overflow while inactive: nothing automatic stops it. `maybeAutoCompact`
returns `false` when the latch is false — including the overflow path
(`ModelApiHost.ts:14760-14764`, `isOverflow` included). A classified
overflow fails the turn with `contextWindowFull`
(`ModelApiHost.ts:14199-14200`, text `Context window full: /compact or
/handoff`); the person compacts by hand. The 99/100 fraction
(`MODEL_API_SILENT_OVERFLOW_FRACTION`, `src/shared/constants.ts`)
only classifies a provider reply as `empty-near-window`
(`src/core/context/overflow.ts:99-103`); it compacts nothing.

## APP PROBLEMS

1. Cross-process loopback from this lane's session is blocked (measured:
   same-process fetch 200, child `node -e fetch()` fails with no server
   HIT). Per the 2026-10-08 sandbox rule this stops the packed-drill
   part here; the lead reruns `temp/drill/packed.mjs` outside the
   sandbox. Not a product defect.
2. `~/lanes/_ctx/codex/l10n-pack-diag.mjs` (named by the rig note) does
   not exist in this lane's shared context; verified key order with an
   inline key-position check instead (ok in all 14), plus
   `check:l10n` exit 0.
3. Adjacent, not changed: `src/acp/agent.ts:391` rewrites a resource
   governor pause into an `agent_message_chunk` (same "internal status
   as the model's words" class as F82, but a status rewrite of the
   governor's own chunk rather than a prefix to the model's reply).
   Left alone as out of scope; flagging for the lead. **Fixed in
   review** (see the review addendum below).

## Review addendum (RVPROVIDERTRUTH, 2026-10-14)

The ACP fallback is the specification's own: SDK 1.7.0's `Notice`
schema says agents MUST only send notices when the client advertised
`ClientSessionCapabilities::notices`, and "Otherwise, Agents may use
an agent message when the information should still be surfaced"
(RFD: Session Notices). The lane's translator change follows it
exactly. The review found and fixed the rest of the class:

- Resource-governor statuses (`src/acp/resources.ts`) and account
  swap/stop notices (`src/acp/agent.ts`, `AcpAccounts.onNotice`) still
  went out as `agent_message_chunk` for every client. Both now use
  the `notice` update where advertised (pause and account stop as
  `warning`, the rest `info`), with the agent-message fallback and
  the structured `_meta` unchanged otherwise. New
  `test/unit/acpResources.test.ts` (real module, data in) proves it;
  red before the fix (1 failed / 2 passed), 3 passed after.
- Every other `agent_message_chunk` path is an answer the person
  asked for, not an unsolicited status: slash-command and `/agents`,
  `/questions`, `/resources` answers, question-deferral instructions
  (durable by design — a notice is fire-and-forget and the person
  needs the question id), the elicitation fallback text, and the
  `/attach` and `/record` answers. The two internal ACP clients (headless exec,
  `clientCapabilities: {}`; the team process) advertise no notices,
  so their account-event parsing of agent chunks is unchanged.
- Headless `backendNotice` lines now carry the notice's own level
  instead of always `[warn]`.
- F83: `ModelApiHost.setModel` committed the new model before
  resolving it, so the F83 refusal left the backend session on the
  refused model while the panel and the ACP session kept the old one.
  The switch now restores the old model when resolution refuses. On
  ACP the refusal itself arrived as a bare "Internal error" (the
  SDK puts a plain error's message in the error data, not its
  message); `set_config_option` now refuses a limited model with
  `invalidParams` carrying the sentence. A new ACP session also no
  longer starts on a limited model while a usable one is listed, and
  terminal `providers list` states the limit, reading the person's
  capability overrides as the registry does.
- F85: a key test that read no model list (Hugging Face's identity
  check on its own origin; an empty list) still fell through to the
  wizard's "Tick at least one model." in the terminal. It now exits 1
  with the terminal's own `providerAddNeedsModel` sentence (English
  table plus all 14 locale tables, in English order).
- Not fixed, recorded for the lead: the panel wizard's tick row reads
  scan evidence (catalogue plus the provider's own models-list row),
  while the registry resolves catalogue plus the person's overrides
  only. A model the list row confirms but the catalogue does not
  would show no wizard sentence yet still be listed with the limit
  and refused at turn start. Unifying the evidence is a capability
  change beyond this lane.
