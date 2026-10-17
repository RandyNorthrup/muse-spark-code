# C-M106-1 capture receipt (macmini, 2026-10-10)

Base: `82d50d5e4`, branch `c/m106-1`. This lane supplies capture evidence
and the lead's Meta collector. It does not certify M106's production bindings
or release. The rig brief overrides common.md's old merge/aggregate-quality
instructions: no branch integration, push, full-suite run or aggregate quality.
No dependency, hook, gate, timeout or bundle cap is changed.

## Counted Muse Code 1.4.4 evidence

The installed CLI reports `Muse Code 1.4.4 (1.4.4-R5419.1)`. Four foreground
`muse serve` processes run against empty directories created under the rig's
private `$TMPDIR`, with `--provider meta --model muse-spark-1.3-contributor
--no-session-log --disable-shell --disable-write`. The child receives only
OS/profile, PATH, temporary-directory and locale variables, never credential
variables. It uses its own sign-in; this agent reads no credential file or
keychain and supplies no Model API key. No rules are trusted or tools run.

The [completion manifest](../../test/fixtures/m106/completion-manifest.json)
records timestamps, exact workspace locations, raw in-memory source hashes,
scrubbed fixture hashes, command counts and limitations. The CLI source hash
covers recorded outgoing request serializations and raw incoming JSON lines,
joined by LF without a terminal LF; the client `initialized` notification
and stderr are excluded. These counts are
separate from the historical Meta run in [m106-captures.md](m106-captures.md).
There are **18 MSP requests, zero `turn/start` requests and zero model
attempts**. The two created sessions' own bootstrap traces each contain zero
model admission events; the rejected-start probes cannot launch a model turn.
The CLI's model catalogue is protocol evidence, not a counted inference.

| Fixture                             | Requests | Observed evidence                                                                                                                                                                                                           |
| ----------------------------------- | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `msp-1.4.4-invalid-initialize.json` |        3 | A hyphenated client machine name gets `invalidParams`; subsequent list/start requests get `notInitialized`.                                                                                                                 |
| `msp-1.4.4-invalid-approval.json`   |        3 | Successful handshake/catalogue; approval mode `default` gets `invalidParams`, naming the four accepted modes.                                                                                                               |
| `msp-1.4.4-session-lifecycle.json`  |        6 | Handshake/catalogue, ephemeral session start, `session/reasoningEffortChanged`, feedback with that session gets `sessionNotFound`, delete gets `methodNotFound`, EOF produces `session/closed` and `session/statusChanged`. |
| `msp-1.4.4-host-feedback.json`      |        6 | Same session/effort lifecycle; host-level feedback returns `outcome: uploaded`, an upload ID, bundle path and both session-record booleans false. Delete is refused.                                                        |

Feedback has **two attempts and one upload**. The uploaded content is the
literal public synthetic note in the fixture, with `withFiles: false`,
`attachSessionRecord: false`, no `sessionId` and no client artifact path.
No attachment-enabled outcome is claimed. The failed named-session attempt
is retained separately; it is not recast as an upload or successful deletion.

Only scrubbed projections are written. `museHome`, profile IDs, avatars,
e-mail fields and opaque encrypted reasoning are omitted; strings replace
profile/workspace paths and e-mail addresses. The selected raw source stays in memory
and contributes only its SHA-256. JSON-RPC IDs, session/command IDs, cursors,
source ranges, notifications' timestamps and upload-receipt IDs preserve the
observed correlations. No account label, key, raw stderr or private trace
content is copied into the certificate.

The model catalogue contains `variants`, `reasoningEffortVariants` and
`defaultReasoningEffort`. The contributor model's default is `max`, its
variants are minimal through max, and its one described tier is `xhigh`.
These differ from the non-contributor row's default. Every captured model
reports **`outputLimit: 128000`**. That is a Muse Code catalogue fact; it is
not proof of Meta HTTPS accepting the recommended **131072** cap.

## Uncaptured or refused native contracts

PLAN D26's 1.4.4 amendment wins over D86.7/acceptance 13's historical SDK
1.4.2 wording: `session/delete` was removed. Both valid-session probes return
`-32601`, `data.kind: methodNotFound`. No `session/deleteCompleted` exists in
this evidence, and C-M106-3 must preserve refusal on 1.4.4 rather than wire
that dormant delete port. An upstream replacement needs its own capture.

`session/started` and `session/closed` are now captured. These ephemeral
sessions produce no `session/listChanged`; durable-history notifications
still need a lead-authorized durable or isolated signed-in-profile capture.
The agent did not create retained sessions in the owner's history or copy
credentials to a new profile. The successful feedback receipt has no session
record; session-scoped and attachment-enabled outcomes remain uncaptured.

## Meta collector and remaining provider rows

[scripts/capture-m106-meta.mjs](../../scripts/capture-m106-meta.mjs) is a
standalone developer tool with offline `--help` and `--plan`. Live mode
requires `--allow-paid-captures`, a new output directory and a key on standard
input. It makes, at most, two `/v1/status` GETs and four contributor-model
`/v1/responses` POST attempts in sequence, without retries:

1. Public and authenticated status, preserving unknown model-status entries.
2. Strict weather-tool streaming, retaining complete raw SSE delta/done
   objects, item identity and exact split points rather than reconstructing
   them from the earlier truncated U9 summary.
3. The captured strict-schema refusal (`additionalProperties: true`).
4. Strict structured output alongside the tool with the recommended 131072
   output cap; a refusal remains a failed receipt, not capability evidence.
5. A one-token output limit to observe `incomplete/max_output_tokens`.

The collector validates JSON boundaries, caps stdin at 8192 bytes and bodies
at 2 MiB, uses a 60-second request deadline and refuses redirects. It retains
only allowlisted response headers, scrubs literal key echoes recursively
(including property names), drops encrypted reasoning, uses private directory
and file modes, and clears its passed key reference in finally. It refuses
an existing output directory before dispatch. Each attempt is counted before
fetch; each parsed receipt is written and hashed before contract checking.
Any refusal, missing expected frame, malformed/oversized body or transport
failure leaves `state: failed`, never a completed capability claim. Malformed
bodies are not persisted as raw text. No child process receives the key.
Header values are evidence as reported; this script does not interpret quotas.

**The collector made zero live Meta Model API requests.** The fake test data is
confined to `test/unit/m106CaptureCollector.test.ts`; it is not installed as
live fixtures. The old `status.json` and its explicit unknown provenance are
retained. The lead must run the collector with the Meta key, review the scrubbed
receipts and install them before C-M106-2 enables selected-model previews or
output-cap evidence. The large advertised cap bills the Model API key; the
collector's help explicitly names that cap and the required paid opt-in.

The completion manifest names all 18 provider presets plus Meta. Every row
is waiting for its named credential or local server/model/version. OpenAI,
Azure, Anthropic, Gemini, xAI, OpenRouter, Groq, DeepSeek, Mistral, Together,
Fireworks, Hugging Face, Z.ai and custom have no supplied keys. No Ollama,
LM Studio, vLLM or llama.cpp executable is found on PATH, and no running
endpoint/model was supplied. Four additional unauthenticated models-list
GETs at the preset default loopback ports (11434, 1234, 8000 and 8080) all
fail with connection refused. The manifest counts and hashes this discovery
separately: zero inference attempts and no HTTP response or vendor frame.
Prior M95 captures are retained as historical
evidence; no provider inherits Meta's headers or capabilities. No local server
or parser is invented to manufacture a successful receipt.

## Editor and operating-system scope

No editor UI, runtime command, setting or production capability is added.
The collector uses portable Node paths and stdin on Windows, macOS and Linux;
this lane executes it with fake services on macOS only. Windows/Linux receipts
remain with the lead. C-M106-2 owns Model API selected-record bindings in
VS Code, ACP and exec; C-M106-3 owns native effort/feedback/delete readers;
C-M106-4 owns health/team surfaces, with M104 carrying equivalent bindings
into the supported embedded and companion editors. Those editor rows remain
open in their owning lanes. No partially implemented feature is surfaced.

## Verification and guard-fire receipts

The owning capture/collector tests, scoped gates and byte-exact drill receipts
are recorded with their final results below. Integrated quality, coverage,
accessibility, live Meta/provider receipts and lead review remain external
qualification steps under this rig brief.

All results below are direct runs in this macmini worktree:

| Check                                                                                                                                           | Result                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                             | All five projects pass.                                                                                           |
| `npx vitest run test/unit/m106CaptureCollector.test.ts test/unit/m106CaptureFixtures.test.ts test/unit/modelApiCaptures.test.ts --maxWorkers=3` | 3 files, 35 tests pass after every mutation is restored, with repository timeouts; no filter or timeout override. |
| ESLint with `--max-warnings=0`, changed script/declaration/tests                                                                                | Pass.                                                                                                             |
| Prettier check on all 17 changed files                                                                                                          | Pass.                                                                                                             |
| `npm run deadcode`, `npx jscpd`, `npm run cycles`                                                                                               | Pass; zero clones and zero dependency cycles.                                                                     |
| `node scripts/check-l10n.mjs`                                                                                                                   | 14 UI tables, 14 usage tables, 0 problems. No product strings added.                                              |
| `npm run check:reference`, `npm run check:host-api`                                                                                             | Pass. No production command/setting/feature added.                                                                |
| `npm run check:plan`, `npm run check:roadmap`                                                                                                   | Pass; roadmap regenerated.                                                                                        |
| `npm run build`                                                                                                                                 | Pass, including token, size, split, host-global and notice checks.                                                |
| Collector `--help`, `--plan`                                                                                                                    | Pass offline; no credential or live request.                                                                      |

Measured production bundles: extension **563348 B (550.1 KiB)**,
Model API **528186 B (515.8 KiB)**, checkpoint store **89366 B (87.3 KiB)**.
Their unchanged source-gate caps are 600, 525 and 225 KiB respectively. The
shared common.md's old Model API 475 KiB note is stale: this base's PLAN §7
and `scripts/check-bundle-size.mjs` already specify 525 KiB. This lane changes
no size gate. No new collector, fixture or test is a shipped bundle entry.

[The 26 drill receipts](m106-completion-drills.json) name mutations, exact
failing tests, nonzero exits and matching before/restored SHA-256. They cover
literal-key scrubbing, encrypted-reasoning omission, key preflight, complete
SSE framing, status validation, strict-refusal status, stream completion,
item identity, exact delta/done bytes, output cap, incomplete status, body
bounds, redirects, header allowlisting, pre-dispatch counts, key cleanup,
existing-directory refusal, feedback disclosure and provider coverage. The
final seven also prove offline help/plan output, unsuccessful CLI exit, the
complete stream validator, catalogue defaults, lifecycle reasons and rejected
probe kinds. All 26 new test cases have been observed failing; the receipts
list their full names under `observedFailingTests`.

One exploratory delta/done mutation initially stayed green: the test's
`{}` done argument also failed the later answer schema. It is not counted.
The test now uses valid arguments with different whitespace, so removing
byte correlation returns a valid answer and fails that named test. The
repeated drill fires and restores exactly; the final whole-file run passes.

Hook-on commit output is retained in ignored `temp/cm1061/commit.log` and
`temp/cm1061/commit-certification.log`.
The reviewed index and committed patch are re-read after the hook, including
any rewrite, as AGENTS rule 15 requires. Lead review remains outstanding.
