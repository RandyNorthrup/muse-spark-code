# Headless runs and GitHub CI (Unofficial)

M80 integration guide, 2026-10-02. All four implementation lanes (A contracts,
B engine and CLI, C Action, D packaging and docs) are integrated, and their
fake-only tests pass on Linux, macOS and Windows. The hosted `action-check.yml`
matrix (W, fake-only) runs and passes on same-repository pull requests. The live
receipt LA passed on 2026-10-05 for main at `30de7c89`, using the unsigned
candidate package. The live receipt L, and LR now that 0.12.0 is released, are
still open, so this page does not claim certified headless or Action support,
nor npm-registry Action support. Command receipts and precise claim limits live in
[m80.md](certification/m80.md).

ACP and headless Model API/BYO requests share a hard local-day budget in the agent data folder. Its `settings.json` accepts `{"paidDailyBudgetUsd":5}` (USD; default $5, range $0.50–$500), corresponding to the extension’s `museSpark.paidDailyBudgetUsd`. Reservations use an exclusive cross-process lock before dispatch and settle from verified usage; an interrupted or unpriced request retains its liability. Headless also requires `--max-budget-usd`, and BYO attempts use the same usage journal as interactive turns. Image generation still requires its flag and consent (or the headless flag plus hard run budget). Hosted search is unavailable in this runtime while the hard daily budget is active because its returned fees have no dispatch bound.

## One prompt, one workspace, one turn

```text
muse-spark-code-acp exec [options] <prompt>
muse-spark-code-acp exec [options] --prompt-file <path>
muse-spark-code-acp exec [options] -
muse-spark-code-acp scan-secrets <file> [--key-stdin]
```

Muse Code must already be signed in; exec never initiates login. Model API uses
your existing OS credential entry, set through `auth set`'s stdin. In CI only
`--key-stdin` is used: a single bounded non-TTY line, at most 4096 bytes, ending
at LF without waiting for EOF. One CRLF ending is accepted; any other white space
is part of the value and refused, as the Action's own intake refuses it.
The agent has no environment-key fallback and does not open the native keyring
on this path. Do not place a key in an argument, file or editor setting.

```sh
muse-spark-code-acp exec 'Review this workspace.'
muse-spark-code-acp exec --backend modelApi --max-budget-usd 2.00 --ephemeral --output json 'Review this workspace.'
muse-spark-code-acp exec --backend modelApi --allow-contributor-models --model muse-spark-1.3-contributor --max-budget-usd 1.00 --output jsonl --prompt-file prompt.txt
muse-spark-code-acp scan-secrets fix.patch
```

| Exec option                         | Default                | Validation                                                                                                                  |
| ----------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| --backend museCode\|modelApi        | museCode               | Must be an ACP backend.                                                                                                     |
| --cwd <dir>                         | process.cwd()          | Resolve absolute; existing directory.                                                                                       |
| <prompt>, --prompt-file, -          | required               | Exactly one; nonempty UTF-8; at most 262,144 bytes. Stdin prompt conflicts with --key-stdin.                                |
| --untrusted-file <path>, repeatable | none                   | At most 8 files, 1 MiB each, 2 MiB total, 48 chunks total; readable regular files.                                          |
| --permission-mode plan\|acceptEdits | plan                   | Refuse auto, manual, bypassPermissions and all other modes.                                                                 |
| --model, --effort                   | backend default        | Listed for this run; supported effort. Model API model must also have a known tariff.                                       |
| --allow-contributor-models          | off                    | Explicit permission to select a contributor model; docs name training eligibility (`apidocs/pricing-rate-limits.md:21–29`). |
| --output text\|json\|jsonl          | text                   | Exact enum.                                                                                                                 |
| --max-budget-usd <usd>              | required for Model API | Finite, 0 < value ≤ 20; must cover the model minimum below before billable dispatch. Refuse on Muse Code.                   |
| --max-requests <n>                  | 30 for Model API       | Integer 1–500; all admitted billable HTTP attempts, including retries, compaction and images. Refuse on Muse Code.          |
| --timeout <seconds>                 | 1800                   | Integer 10–21,600; deadline counts from process start.                                                                      |
| --image-generation                  | off                    | Model API plus acceptEdits plus budget.                                                                                     |
| --web-search                        | refused                | Exit 2; no hosted-tool allowance.                                                                                           |
| --fail-on-denial                    | off                    | First ordinary approval denial stops if enabled.                                                                            |
| --ephemeral                         | off                    | Model API only; suppress the session store.                                                                                 |
| --key-stdin                         | off                    | Model API only; non-TTY stdin.                                                                                              |
| --muse-binary, --shell-sandbox      | serve defaults         | Muse Code only.                                                                                                             |
| --verbose                           | off                    | Trace on redacted stderr.                                                                                                   |

Budget grammar is unsigned ASCII decimal `[0-9]+(?:\.[0-9]{1,6})?`,
range 1–20,000,000 micro-USD. Signs, exponents, whitespace, non-ASCII digits
and more than six fractional digits are usage errors. The raw string is parsed
directly into integer micro-USD; `Number` never parses that budget string.
Exactly one nonempty UTF-8 prompt is required (262,144-byte maximum).
Stdin prompt conflicts with stdin key. Files must be readable regular files.
Untrusted resources: at most 8 files, 1 MiB each, 2 MiB total and 48 chunks.
Every resource, including random markers and the model's untrusted-data lead,
fits 65,536 characters, split at code-point boundaries. CLI rejects oversize
input rather than truncating; Action diff/metadata truncation is disclosed.

Trust and dangerous skip flags are refused. Plan refuses edits, commands and
paid calls by policy, without an approval request, so those refusals are not
listed in denials and do not trip --fail-on-denial. On the Model API,
acceptEdits allows ordinary confined writes, denies protected writes, and
records each approval it denies (on Muse Code, acceptEdits is Manual and Muse
Code writes workspace files without an approval request).
Questions are declined, tool errors alone do not stop a run, and ordinary
approval requests select reject_once (or cancel if unavailable). Model/effort
validation closes a newly created session before usage/2. Too-small valid budget
is refusal/5 before any billable request, naming the model's minimum.

M112 does not start question timers in `exec`: `question_declined` remains
its tally, with no late-answer queue or remembered answer. The interactive
ACP option `--questions-defer-after` is refused by `exec`. Best-of-N, worktree
conversations and the evaluation retain their immediate cancellation or
clarification. Scheduled/unattended prompts instead defer at once and retain
an open question, including with interactive deferral set to 0 (D92.8 as
amended by D95); they never wait for a form. The schedule and registry
bindings are certified by M112's integration, not by a headless run.

## Exits, authoritative completion and output

| Code | Status                              | Meaning                                                                                                                                                |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | completed                           | ACP end_turn AND latest Model API response completed at clean EOF with valid usage and priced settlement; or Muse Code tap terminal exactly completed. |
| 1    | internal                            | Crash, output closed/stalled, duplicate settlement or wrapper failure when exec itself succeeded. Result is best effort.                               |
| 2    | no result                           | CLI/input usage error; redacted stderr only.                                                                                                           |
| 3    | auth_required / backend_unavailable | Missing/invalid key, HTTP 401/403, CLI signed out, missing CLI/bundle or unavailable store.                                                            |
| 4    | failed                              | Ordinary backend/transport/HTTP failure after retry policy; explicit response.failed.                                                                  |
| 5    | budget_exceeded / request_cap       | Pre-dispatch budget/shape/unpriced refusal, request count limit or observed accounting bound breach.                                                   |
| 6    | timeout                             | Process deadline.                                                                                                                                      |
| 7    | denied                              | --fail-on-denial latched.                                                                                                                              |
| 8    | incomplete                          | response.incomplete, clean EOF without terminal (no_completion), or Muse Code terminal other than completed; preserve its word/reason.                 |
| 9    | accounting_unverified               | Latest response.completed has missing or invalid usage, or accounting validation explicitly stops the run. Never authorizes comment/patch/apply.       |
| 130  | cancelled                           | SIGINT.                                                                                                                                                |
| 143  | cancelled                           | SIGTERM.                                                                                                                                               |

First latched stop wins. Otherwise auth failure precedes backend/HTTP/transport
failure, then incomplete response/EOF, then completed-with-unverified-accounting.
Only the latest clean completed response with valid priced settlement plus ACP
end_turn authorizes Model API success. An observed terminal followed by transport
loss remains cut short. Muse Code requires its tap terminal exactly completed.
Exit 2 has no result; forced exit/SIGKILL can leave no result.

On Windows a forced stop (the shared 5-second grace runs out, or a distinct
second signal's 300 ms grace ends) ends the process with self-SIGKILL: the
process exit is 1 and buffered stdout/stderr may be lost. A result that was
delivered keeps its first-stop status, signal and logical exit code (130/143
for a signal). Drained Windows exits and POSIX keep the table above. The Action
requires the result's exit code to equal the process's, so a forced Windows
result is not published: the run step reports status unknown, as for a missing
result, and publishes nothing.

Stdout contains only the chosen format: text finalMessage, one JSON result, or
JSONL envelopes `{v:1,seq,time,type,...payload}` (seq starts at 1; time is ISO).
Stderr holds redacted diagnostics and status/requests/settled/uncertain/image
summary. No cwd or raw tool text appears in the result. Changed/denied paths are
relative with forward slashes; input names are basenames.

The complete machine contracts are [result v1](schemas/exec-result-v1.schema.json)
and [event v1](schemas/exec-event-v1.schema.json), shipped in npm `schemas/`.
Required fields and numeric/status invariants are validated by the runtime;
`x-runtime-invariants` records arithmetic/sequencing that JSON Schema alone
cannot express. `npm run schema:exec -- --check` checks deterministic bytes.
The runtime zod schemas (`src/runtime/exec/execProtocol.ts`) are normative.
The shipped event schema also enforces the update egress rule itself:
`$defs.execSafeUpdateValue` refuses chunk/tool `sessionUpdate` values and
`rawInput`/`rawOutput`/`toolCallId` at any depth, so a consumer validating
only the file cannot accept tool text. The Action's extractor checks every
event variant against a structural mirror of the event schema, parity-tested.

| Field                                                       | Type / meaning                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v                                                           | Literal 1.                                                                                                                                                                                                                                |
| status, exitCode, signal                                    | Exit table above; signal is SIGINT, SIGTERM or null.                                                                                                                                                                                      |
| stopReason                                                  | ACP reason string or null.                                                                                                                                                                                                                |
| terminal, incompleteReason                                  | Latest response/tap terminal and reason, or null.                                                                                                                                                                                         |
| backend, mode, model                                        | museCode/modelApi; plan/acceptEdits; selected id or null before selection.                                                                                                                                                                |
| sessionId, ephemeral                                        | string or null; boolean.                                                                                                                                                                                                                  |
| finalMessage                                                | Whole redacted released final message or fixed withholding line.                                                                                                                                                                          |
| filesChanged                                                | Deduplicated relative paths from edit locations/tap; not a secret-scan claim.                                                                                                                                                             |
| denials                                                     | {toolCallId,title,kind,paths:string[]} rows; paths relative.                                                                                                                                                                              |
| questionsDeclined                                           | Nonnegative integer.                                                                                                                                                                                                                      |
| inputs                                                      | {name,bytes,chunks,complete} rows. CLI inputs are complete; Action truncation is separately disclosed.                                                                                                                                    |
| usage.requests                                              | Admitted billable attempts; null on Muse Code.                                                                                                                                                                                            |
| usage.inputTokens/outputTokens/cachedTokens/reasoningTokens | Sum valid per-response usage only; 0 on Model API when no response had valid usage, null on Muse Code without a snapshot. Muse Code uses the latest cumulative snapshot, never a sum.                                                     |
| usage.costUsd                                               | {settled,uncertain,reserved,total,isUpperBound}, or null on Muse Code. total includes retained full reservations. isUpperBound iff uncertainty, a pending reservation or any latched stop.                                                |
| usage.paid                                                  | {imageAttempts,imagesReturned,imagesRefunded,imagesUncertain,settledUsd,uncertainUsd}. Zero on Muse Code.                                                                                                                                 |
| ledger                                                      | {capUsd,breach,refusal,lastResponse}, or null on Muse Code. lastResponse carries n, terminal, incompleteReason, endedWithoutTerminal, httpStatus, transportError, usage (valid/missing/invalid) and settlement (priced/full-reservation). |
| limits                                                      | {budgetUsd:number\|null,maxRequests:number\|null,timeoutSeconds:number}.                                                                                                                                                                  |
| durationMs                                                  | Nonnegative finite elapsed time from process start.                                                                                                                                                                                       |
| error                                                       | null for completed; otherwise {kind,message}, whole-redacted.                                                                                                                                                                             |

| Event type        | Payload                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| start             | agent {name,version}, backend, mode, model, effort, sessionId, ephemeral, paidFeatures, limits; no cwd            |
| update            | unknown non-tool ACP update fields retained and string leaves redacted                                            |
| tool              | name, status, durationMs only                                                                                     |
| message           | itemId, kind (agentMessage/reasoning), whole text, complete                                                       |
| permission_denied | toolCallId, title, kind, paths                                                                                    |
| question_declined | count                                                                                                             |
| attempt           | n, endpoint, phase admitted/settled, reservedUsd, totals; optional maxOutputTokens, outcome, chargedUsd, terminal |
| paid_use          | feature=imageGeneration, n, phase admitted/returned/refunded/uncertain/refused, units, usd; optional reason       |
| limit             | budget/requests/timeout/breach/request_shape/unpriced/accounting                                                  |
| signal            | SIGINT/SIGTERM                                                                                                    |
| result            | one ExecResult                                                                                                    |

Agent message/thought chunks and all ACP tool text/content/rawInput/rawOutput/
diffs/resources are suppressed. Tool events carry metadata only. Complete prose
is released only against its own response's completed terminal and clean EOF.
Every incomplete/failed/cut-short item is withheld whole as
“message withheld: the response did not complete”; a final withheld item cannot
be replaced with an earlier successful message. Completed prose with missing
usage may be redacted and shown, but exit 9 never authorizes Action publication.
Every egress sink replaces longest exact literals first, then known Meta/auth/
JWT/field/URL/GitHub/AWS/Slack patterns. Each exact literal is also matched in
its percent-encoded form, and in the form an earlier pattern-only pass left of
it (a legacy key's tail after the `%` its pattern stops at, as a network error's
description carries it). The code's pattern minimums are looser than the
spec's and so over-redact: `gh[pousr]_` and `github_pat_` tokens from 20
characters, `AKIA`/`ASIA` ids with exactly 16 more, Slack `xox?-` from 10.
Unknown secrets remain outside coverage.
Comments defuse @ mentions and cap text only after whole-text redaction.

## Conditional budget guarantee

Provider facts below are the supplied 2026-10-02 `SP/apidocs/` snapshots named
by the M80 v4 spec. They are not current online verification. “SP” denotes the
lead's supplied scratchpad; the precise source baseline/capture binding is in
[m80.md](certification/m80.md). The following theorem is conditional, never a
claim about other processes, future prices or contrary provider behavior.

Total provider billing attributable to this run is at most its USD budget, provided Meta applies facts 1–6 below to every dispatched request. This is conditional on those documented provider semantics and the listed tariffs. It does not bound another process using the same key, a later tariff change, or provider behavior contrary to those facts. Missing receipts do not release liability.

1. input_tokens + max_output_tokens must fit the model context window; over-window input is refused with HTTP 400 and is not silently truncated (`apidocs/error-handling.md:46,569–571`; `apidocs/protocols_responses.md:605`; `apidocs/cookbook_long-context.md:155`).
2. W=1,048,576 for every supported Muse Spark model (`apidocs/models.md:21–25`).
3. max_output_tokens bounds reasoning plus visible output; reasoning has the output tariff (`apidocs/protocols_responses.md:605`; `apidocs/reasoning.md:294–297`).
4. Standard rates per million are input $1.25, cached input $0.15, output $4.25; contributor rates are $0.10, $0.002, $0.20. Cached input is never priced above input. There is no long-context premium (`apidocs/pricing-rate-limits.md:13–29,43,51`).
5. Injected scaffolding is not billed and is excluded from usage; billed input is usage.input_tokens constrained by fact 1 (`apidocs/pricing-rate-limits.md:83`). The theorem uses no relation between a counting endpoint and billing.
6. Images cost $0.01 per successfully generated and returned image, with built-in image/search tooling included and no separate image-token charge (`apidocs/pricing-rate-limits.md:55`).

Only supported priced models, client-side function tools and fixed n=1 image
requests are admitted. Hosted response tools, background/previous_response_id,
arbitrary hosts, uploads, polling and hosted search are refused before forwarding.
Exact Meta HTTPS origin, empty user-info/fragment/unexpected query, string POST
body and `redirect:error` are required. Only GET /v1/models and POST
/v1/responses, /v1/images/generations, /v1/images/edits may pass.

With W=1,048,576 and M=max_output_tokens, context liability is
`R=((W-M)*p_in + M*p_out)/1,000,000`. Admission uses exact tariff arithmetic,
then rounds each reservation and priced liability **up** to integer micro-USD
(EXEC_USD_UNITS=1,000,000; F1 supersedes v4's earlier nanodollar text).

| Tier, M=32,768 | Exact context liability | Admitted reservation/minimum | Minimum with images |
| -------------- | ----------------------: | ---------------------------: | ------------------: |
| Contributor    |              $0.1081344 |                    $0.108135 |           $0.118135 |
| Standard       |               $1.409024 |                    $1.409024 |           $1.419024 |

Standard recipes use $2.00; contributor recipes explicitly opt in and use $1.00.
Cached input is priced at its lower tariff, reasoning is already part of output.
Counter values must be nonnegative safe integers; cached ≤ input, reasoning ≤
output, optional total=input+output, input ≤ W−M and output ≤ M. Unknown pricing,
nonrepresentable/unsafe arithmetic and invalid request bodies fail closed.

One shared billable slot atomically reserves before fetch and increments the
request count; retries and compaction consume fresh attempts. The immutable body
is sent unchanged. Valid clean-EOF usage replaces R with its upward-rounded
priced liability. Missing/invalid usage, HTTP errors, ambiguous sends, cancellation,
malformed/oversize frames, response.failed/incomplete and lost transport retain
full R permanently. **No HTTP-status refund is assumed**, even for 401/429/500.
Missing intermediate usage can continue only within remaining liability; latest
unverified usage exits 9. Bound violations mark breach, close admission and exit 5;
this reports contradiction of provider assumptions, not a bound outside them.

For finished request i use validated liability q_i, otherwise full R_i; active
requests contribute R_i. Atomic admission requires sum(q_i)+sum(active R_i)+
R_next ≤ cap. Valid settlement cannot increase a reservation, uncertain settlement
never releases it. Induction preserves cap, under the six provider facts above.
An unknown earlier request plus retry keeps both liabilities. Upward micro-USD
rounding may refuse an otherwise sub-micro fit; it never enlarges supplied cap.
Cost output converts these integers, and total=settled+uncertain+reserved.

For /v1/responses the fetch adapter returns headers promptly and passes bytes
unchanged through a bounded streaming observer with backpressure, never
buffering a whole response before returning; an image response is read whole
(at most 32 MiB) and checked before it is returned. Response total cap is
32 MiB; frame/feed caps 16 MiB.
The real client's **five-minute idle interval** tracks progress, not total run
length. Clean EOF drains observer settlement before final classification;
downstream cancel/upstream error settles full liability exactly once. There is
no counting endpoint, byte/token estimate or separate settlement race.

## Paid images

Off by default. Only Model API + explicit image flag + acceptEdits + hard USD
budget permits ordinary, non-asking image uses. Every n=1 image reserves $0.01
before dispatch. Protected destinations and requiresAsking are denied; no
remembered grants or ordinary approval grants apply. Hosted search, voice,
subagents and schedules are unavailable. Subscription pays none of these calls.

Per-use events distinguish admission and returned/refunded/uncertain settlement.
A parsed successful empty image result proves a zero-image refund; one usable
returned PNG costs $0.01. Missing/malformed data, errors or cancellation retain
full $0.01 as uncertain. Count above 1 is breach/5. Tally shows attempts, returned,
refunded and uncertain images plus settled/uncertain USD. Image settlement never
replaces the latest response completion/accounting record.

## Scanner and keys

Scanner reads exact bounded staged bytes locally, valid UTF-8, at most 16 MiB.
It prints only a localized count, never matches, excerpts or a path. Exits:
0 clean, 10 secrets found, 2 unreadable/oversize/invalid-key/cancelled/error;
On POSIX, a repeated signal forces the earliest latched stop code: 130/143
if a signal came first, or 6 if the deadline had already latched timeout.
An earlier non-signal stop keeps its own code. Windows forced process exit
is 1; a delivered result retains its logical first-stop code.
Its 30-second deadline includes key reading and output flush. Private key stdin
stops at LF, clears references in finally and never touches an OS keyring.
The scanner's protection covers known patterns/exact literal only.

GitHub puts `MUSE_SPARK_MODEL_API_KEY` into only the run-step process. That step
**directly execs** the trusted absolute Node launcher. Launcher deletes variable
before starting any child and holds key only in memory until finally cleanup.
Only two trusted installed agent children receive private stdin: exec, then
scan-secrets for the exact private staged patch. Git/install/check/hook/tool/
apply/publish children receive no key in env/argv/file. Both agent commands clear
references in finally. Local auth remains OS-store based; CI never calls auth set.

Initial OS environment can remain inspectable by same user; deleting variable
cannot erase that record or guarantee memory zeroization. Private self-hosted
runners warn about this; public self-hosted is refused. Collaborators can change
workflows under GitHub trust. Use a **secret-free checkout**: readable workspace
contents can reach Meta, even when shell/hook/Git execution is denied. These
boundaries do not claim prompt-injection immunity or M78 deny-read profiles.

## Action inputs, outputs and isolation

Main Action is `action/`; apply sub-action is `action/apply/`. Frozen contract:

| Input                                   | Default             | Rule                                                                                                               |
| --------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| model-api-key                           | required            | secrets.MUSE_MODEL_API_KEY; only run step gets MUSE_SPARK_MODEL_API_KEY.                                           |
| max-budget-usd                          | required            | Same CLI budget grammar/range above; includes text and images.                                                     |
| mode                                    | review              | review→plan, fix→acceptEdits.                                                                                      |
| image-generation                        | false               | Exact boolean; true only in fix.                                                                                   |
| max-requests                            | 30                  | Same CLI request-count bounds above.                                                                               |
| timeout-minutes                         | 20                  | Integer; converted into allowed exec seconds.                                                                      |
| model, effort, allow-contributor-models | empty, empty, false | Selected model validation; contributor explicitly opted in.                                                        |
| max-diff-bytes                          | 262144              | Integer 1–1,048,576; truncation reported.                                                                          |
| trigger-phrase                          | @muse-spark         | Comment must start with it.                                                                                        |
| pr-number                               | empty               | Positive integer required for workflow_dispatch.                                                                   |
| extra-instructions                      | empty               | Trusted workflow author instruction.                                                                               |
| path                                    | .                   | Relative inside workspace, no .. or symlink escape.                                                                |
| post-comment, upload-artifacts          | true, true          | Exact booleans.                                                                                                    |
| github-token                            | github.token        | Gate, private checkout, post; no exec/scan/Git-input/patch child inherits it.                                      |
| https-proxy, no-proxy, extra-ca-certs   | empty               | Only caller-specified network settings; canonical CA outside workspace; proxy enables NODE_USE_ENV_PROXY=1.        |
| agent-package, agent-package-sha256     | empty               | Both or neither; canonical regular tarball outside real workspace; digest verified; candidate is visibly unsigned. |

Outputs: status, exit-code, out-dir, result-path, events-path, patch-path,
patch-withheld, artifact-name, requests, cost-usd, cost-is-upper-bound, images,
image-attempts, images-uncertain, paid-uncertain-usd, diff-truncated.
Unavailable paths are empty. patch-withheld is empty or binary/secret/scan_failed/
no_result/cancelled/limit/not_completed. Nonzero exec exit is preserved separately
from wrapper error; completed exec plus failed extraction/publication exits 1.
No missing result invents successful exit. Apply requires mode=prepare|push and
artifact-name, defaults github-token to github.token and path to '.', outputs
ready=true only after verified apply, commit-sha only after successful push.

Same-repo only; a pull request author or commenter must be
OWNER/MEMBER/COLLABORATOR (workflow_dispatch, which needs write access, is not
association-checked); agreeing API head/open state required.
Reject fork, bot, pull_request_target, other events, unsupported PR actions,
non-created or unprefixed comments, issues without PR, over-4000-character tasks,
invalid dispatch PR, changed head and public self-hosted. Review cannot enable
images. Install/gate precede checkout/run; refused gate starts none of them.

Every step clears BASH_ENV, ENV, SHELLOPTS, BASHOPTS, PS4, NODE_OPTIONS and
NODE_PATH. Trusted absolute Node/Git and package/CA realpaths live outside
workspace, including symlink/.. checks. Per-invocation work/out/artifact identities
include run/attempt/job/random; private staging stays outside checkout.
Child environments use explicit system/locale/private-home/proxy allow-lists,
without inherited GIT__, GITHUB__, ACTIONS_*, tokens, DBUS or SSH routes.
Windows argv/injected-env hashes are not full environment-block proof; macOS
owned-pid ps evidence is limited. Linux owned-pid /proc can inspect those children.

Every Git phase uses one sanitized runner (`safeGit`): no replace objects,
fsmonitor, maintenance/gc, external diff/textconv, signer, hook or credential
helper; an actual empty hooks folder and global config; no system config; no
inherited `GIT_*` (`GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT` included).
Configuration is closed by its shape: before every Git child, every effective
configuration name outside the command's own overrides (the repository's file
and anything it includes) must be one a fresh `git init` writes, or the command
is refused before it starts. URL rewrites, include/includeIf, `core.sshCommand`,
remote upload/receive-pack, credential, filter, diff, protocol and http keys are
refused this way, not suppressed one by one. Network commands may use only the
validated remote's own transport (`GIT_ALLOW_PROTOCOL`, https in production),
and `GIT_CEILING_DIRECTORIES` stops discovery of a parent repository. HTTPS
API-validated remotes and bounded argument arrays apply to checkout/diff/
prepare/commit/push alike. Checkout/push tokens are one-command headers, never
persisted or handed to exec.

## Installer identity, not a package self-claim

Unsigned candidate requires both absolute regular tarball outside real workspace
and matching SHA-256; emitted label is **unsigned agent package**. This is
caller-trusted digest pinning, not npm registry provenance. Test tarball is
private/fake-only, separate from production and never a release product.

Registry path installs exact package version from trusted Action-root manifest
with ignore-scripts/private empty npm config. Installed lock version/resolved/
sha512 integrity must match exact registry dist.integrity; npm verifies download.
Package manifest names a bin, never proves its own integrity. Verifier pinned:

```text
npx --yes npm@11.19.0 audit signatures --json --include-attestations --prefix <absolute work/agent>
```

Require successful same invocation, no invalid/missing records, expected package
in verified, and that record's authenticated SLSA attestationBundles. Decode DSSE
and bind subject `pkg:npm/muse-spark-code-acp@version`, SHA-512 digest to both lock
and registry, workflow.repository to https://github.com/RandyNorthrup/muse-spark-code,
workflow.path to .github/workflows/release.yml, ref to refs/tags/v<version>.
From the **same verified bundle**, parse authenticated signing certificate and
require its sole unambiguous URI SAN to equal
`https://github.com/RandyNorthrup/muse-spark-code/.github/workflows/release.yml@refs/tags/v<version>`.
Signature-only, absent provenance, wrong predicate/digest/SAN or substituting a
separately fetched bundle fails closed. Canonical bin must stay within package.
The GitHub Release job (asset attestations) and the npm job get id-token:write;
only the npm job publishes, with --provenance.
LR remains required before registry installation is called supported.

## Launcher bounds, cancellation and publication

One owner covers input diff, exec, extraction, patch Git, scanner and publication.
Apply owns its isolated artifact-validation/checkout/apply/commit/push
lifecycle; the download step runs before it. The gate, install and checkout
steps have bounded owners of their own; the tools and input-staging steps have
no owner or bound; no process spans composite steps.

| Constant                      |      Value | Bound                                                                     |
| ----------------------------- | ---------: | ------------------------------------------------------------------------- |
| ACTION_GATE_MS                |  30,000 ms | API gate phase.                                                           |
| ACTION_INSTALL_MS             | 300,000 ms | Install plus verifier.                                                    |
| ACTION_CHECKOUT_MS            | 120,000 ms | Entire initial checkout phase.                                            |
| ACTION_INPUT_MS               |  30,000 ms | Run step input read, then diff plus prompt rendering.                     |
| ACTION_EXEC_OVERHEAD_MS       |  10,000 ms | Exec phase wall limit = exec timeout + this.                              |
| ACTION_GIT_MS                 |  30,000 ms | One local Git child; total patch generation also 30 s.                    |
| ACTION_SCAN_MS                |  30,000 ms | Scanner including key stdin/body/output.                                  |
| ACTION_EXTRACT_MS             |  10,000 ms | Event/result extraction.                                                  |
| ACTION_PUBLISH_MS             |  10,000 ms | Atomic patch/manifest publication and outputs/summary.                    |
| ACTION_DOWNLOAD_MS            |  60,000 ms | Apply artifact validation after download.                                 |
| ACTION_APPLY_MS               | 180,000 ms | Apply owner total, excluding caller's tests.                              |
| ACTION_PUSH_MS                |  60,000 ms | Push network child within apply total.                                    |
| ACTION_STOP_GRACE_MS          |   5,000 ms | Exact signal forwarding, waiting.                                         |
| ACTION_KILL_AFTER_MS          |   7,000 ms | Grace + 2 s; force-kill current child.                                    |
| ACTION_REAP_MS                |   2,000 ms | Bounded wait after force-kill before wrapper error exit.                  |
| ACTION_CLEANUP_MS             |   5,000 ms | Bounded staging/key-reference final cleanup.                              |
| ACTION_STDERR_MAX_BYTES       |  1,048,576 | Per child, buffered (exec redacted after exit); overflow stops the owner. |
| ACTION_CHILD_STDOUT_MAX_BYTES | 16,777,216 | Git/install/verifier/download; overflow stops the owner.                  |
| ACTION_EVENTS_MAX_BYTES       | 67,108,864 | Exec JSONL; capped while streaming to events file.                        |
| ACTION_RESULT_MAX_BYTES       | 16,777,216 | One parsed result/final publication.                                      |
| ACTION_PATCH_MAX_BYTES        | 16,777,216 | Exact Git patch and scanner file.                                         |
| ACTION_SCAN_STDOUT_MAX_BYTES  |     65,536 | Scanner's counts-only output.                                             |
| ACTION_COMMENT_MAX_CHARS      |     60,000 | Redacted comment.                                                         |
| ACTION_META_MAX_BYTES         |     65,536 | PR metadata.                                                              |
| ACTION_TASK_MAX_CHARS         |      4,000 | Collaborator task.                                                        |
| ACTION_DEFAULT_MAX_DIFF_BYTES |    262,144 | Input default; maximum 1,048,576.                                         |
| ACTION_W_BUDGET_USD           |       1.00 | W test fixture cap.                                                       |

The pinned download-artifact step runs before the apply owner exists, so its
transfer is bounded only by the caller job's `timeout-minutes` (the recipes set
20 and 10). The apply owner then refuses any artifact entry other than out/'s
four regular files, or a file past its bound, before reading it. The run step's
input read before its owner exists, and its outputs and summary after cleanup,
keep their own bounds (ACTION_INPUT_MS, ACTION_PUBLISH_MS); a stuck final write
ends the step by self-SIGKILL, because process.exit would wait for the blocked
file worker.

Standalone exec timeout counts from process start, before async localization.
Grace totals 5000 ms, forced output at most 300 ms; duplicate same signal within
500 ms is deduplicated, distinct/repeated later signal forces bounded exit.
Async fd writers avoid blocking event-loop timers. EPIPE/EBADF or >16 MiB queue
stops run. A full non-blocking pipe (EAGAIN) is retried every 10 ms within those
bounds: a slow reader is not a closed one. Forced result may be absent; SIGKILL has no graceful guarantee.
POSIX INT/TERM e2e is explicitly skipped on Windows: process.kill terminates there;
Action cancellation is best effort, not guaranteed graceful result.

Launcher latches stop once, starts no later phase, forwards exact signal,
escalates at 7 s, reaps under bound and clears references/staging in finally.
All phase I/O races cancellation/deadlines/output caps; cleanup failure leaves
only private invocation work for tidy. No stopped invocation regains eligibility.

Extract exactly one validated result before patch; seq/time/schema/execCode agree.
Missing/duplicate/truncated/invalid JSONL gives no result path and no patch.
Completed/0 fix uses sanitized intent-to-add + binary diff against exact head.
Any binary patch (including an unignored generated image) withholds the **entire**
patch. Scan exact staged text, including removed/context/deleted lines; do not
redact a patch. Found secrets withhold whole patch; timeout/bad count/error
withholds as scan_failed/cancelled/limit. Publish clean bytes unchanged only
under active owner; atomic result/patch/manifest moves are revoked on failure.
Manifest binds headSha/baseSha/prNumber/patchSha256/runId/attempt/invocation.
A stopped or failed wrapper revokes everything it moved into out/, result and
events included; each move is synchronous right after an eligibility check, so
none finishes after cleanup. Upload runs only when the run step reported an
exec status (not unknown or cancelled, and not killed). Private work/staging is
removed by tidy.

Only completed results post one bot-owned sticky comment with redacted prose,
model/requests/settled+uncertain cost/returned+uncertain images/run link and
fix artifact/withholding notice. The notice lists changed files up to 4,000
characters, then counts the rest, so the 60,000-character cap holds. Failures
remain in summary. Apply prepare
validates exact digest/current-run/artifact name, checks out the manifest's
head (only push re-reads the PR), applies
--index, then permits caller's secret-free tests. Push rechecks current open PR
same repo/exact head, applies/commits with hooks/signers disabled and pushes
with exact force-with-lease. No repository script runs in privileged push.
Tests inform approval; maintainer must **read proposal** before approving.
An unprotected script changed by a patch can execute later.

## Three complete workflow templates

Save each as its own workflow. Before use, lead must replace every `<commit-sha>`
with the same **reviewed immutable integrated Action SHA**, configure repository
secret `MUSE_MODEL_API_KEY` through a hidden secure UI/prompt, and create
`muse-apply` environment with maintainer reviewers. The Action is integrated,
but no reviewed immutable Action SHA is named for these templates yet. LA's
operational receipt covers main at `30de7c89` with the candidate package only.
These complete templates are not supported-run claims. Do not use moving tags,
pull_request_target, fork secrets, or put model key in test/push jobs.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
permissions: { contents: read, pull-requests: write }
concurrency:
  group: muse-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: RandyNorthrup/muse-spark-code/action@<commit-sha>
        with:
          model-api-key: ${{ secrets.MUSE_MODEL_API_KEY }}
          max-budget-usd: '2.00'
```

```yaml
on:
  workflow_dispatch:
    inputs:
      pr-number: { required: true, type: number }
permissions: { contents: read, pull-requests: write }
jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: RandyNorthrup/muse-spark-code/action@<commit-sha>
        with:
          pr-number: ${{ inputs.pr-number }}
          model-api-key: ${{ secrets.MUSE_MODEL_API_KEY }}
          max-budget-usd: '2.00'
```

```yaml
on: { issue_comment: { types: [created] } }
permissions: { contents: read }
jobs:
  propose:
    if: github.event.issue.pull_request && startsWith(github.event.comment.body, '@muse-spark')
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions: { contents: read, pull-requests: write }
    outputs:
      status: ${{ steps.m.outputs.status }}
      artifact: ${{ steps.m.outputs.artifact-name }}
      patch: ${{ steps.m.outputs.patch-path }}
    steps:
      - id: m
        uses: RandyNorthrup/muse-spark-code/action@<commit-sha>
        with:
          mode: fix
          model-api-key: ${{ secrets.MUSE_MODEL_API_KEY }}
          model: muse-spark-1.3-contributor
          allow-contributor-models: 'true'
          max-budget-usd: '1.00'
  test:
    needs: propose
    if: needs.propose.outputs.status == 'completed' && needs.propose.outputs.patch != ''
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      - id: p
        uses: RandyNorthrup/muse-spark-code/action/apply@<commit-sha>
        with:
          mode: prepare
          artifact-name: ${{ needs.propose.outputs.artifact }}
      - if: steps.p.outputs.ready == 'true'
        run: npm ci && npm test
  push:
    needs: [propose, test]
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment: muse-apply
    permissions: { contents: write, pull-requests: read }
    steps:
      - uses: RandyNorthrup/muse-spark-code/action/apply@<commit-sha>
        with:
          mode: push
          artifact-name: ${{ needs.propose.outputs.artifact }}
```

## Release publication and README badges

The release workflow reports GitHub Release, Marketplace, Open VSX and npm
outcomes before its final **refresh README badges** job. That job runs only
when the summary succeeds and every channel reports `published`; a registry
skipped for a missing secret does not start it. It needs no secret, no publishing
permission and no paid call.

`scripts/refresh-badges.mjs` polls the Marketplace extension query, Open VSX's
extension API, npm's `muse-spark-code-acp` latest tag and GitHub's latest release
for the manifest version. It polls unresolved channels every 30 seconds for at
most 15 minutes; each request has a 10-second deadline. It then requests every
badge image URL in README.md, including HTML, Markdown/reference images and
GitHub's workflow badge; PNG screenshots are excluded. Only an older version
badge gets a cache-busting retry; current, newer, static/count and unreadable
badges do not. It checks the original URL again because a fresh cache-busted
answer does not establish freshness of the URL used by the README.

Finally it fetches the public repository page, deduplicates its
`camo.githubusercontent.com` image URLs and sends HTTP PURGE to each, logging
status codes. Propagation timeouts, stale answers, unavailable pages and purge
failures produce warnings. Job-level `continue-on-error` also makes checkout,
Node setup and dependency-install failures nonblocking. Refreshing caches is
best effort: a successful run cannot guarantee immediate freshness for every
viewer. Fake-fetch and red-drill evidence lives in
[BADGES](certification/badges.md); the next hosted release must confirm actual
public-service responses and cache behavior.

Store landing pages use `{version}` in static Shields URLs; the VSIX and ACP
packagers fill it from `package.json` and check the exact staged README before
packing. Marketplace/Open VSX, npm and the npm page's GitHub release badge show
that package's version. Counts stay dynamic. The root GitHub README keeps its
latest-release badges and receives the release refresh above.

`npm run check:badges` runs in quality and the CI static job. It checks HTTPS
images, uses the pinned vsce processor to validate SVG service hosts (including
extensionless badge URLs), rejects dynamic store versions or mismatched static
versions, and fetches images with a 10-second deadline. Badge responses must be
well-formed SVG with the SVG namespace and cannot render an error; exact static
versions must render their expected label and version. PNG/content images must
return an image content type. Local offline runs may name a reason through
`BADGE_CHECK_SKIP_NETWORK`; CI rejects that override. Requests use no credentials.
Package checks use the same network policy. Focused proofs and archive inspection
are recorded in [BADGEFIX](certification/badgefix.md).

## Evidence and troubleshooting

M105 parses repeatable `exec --attach <path>` flags and confines each source
before credential handling. Production video/audio dispatch remains refused
until captured capabilities, Files storage/ownership and exact per-attempt
media liability are bound. Receipts carry name/size and completion metadata,
never file bytes. Headless `--record`, `/record` and `/attach` are usage errors
(exit 2); there is no unattended screen recorder or implicit paid transcription.
These flags do not change M80's pending live/hosted certification.

`.github/workflows/action-check.yml` runs W with the composite Action on the
three hosted runners against the fake-only test package, whose bin
(`test/action/exec-test-launcher.ts`) answers only Meta's origin with a scripted
fake and reports hashes and booleans only. W-review first reads
`test/action/w-fixture.txt`; W-text first writes the new
`test/action/w-text-fix.txt` (write_file replaces an existing file only as the
model last read it, D27); W-image first generates the unignored
generated/m80.png; each then returns its final reply. `test/action/w-check.mjs`
judges each invocation. `test/e2e/execTestLauncher.e2e.test.ts` packs the same
launcher and rehearses all four scenarios through the real run-exec entry on
each platform.
Two responses each report 10 input/5 output tokens. Upward micro-USD reservations
are $0.216270 for two replies, $0.226270 with image, within $1.00.
Simulated priced cost is $0.000004 text/review and $0.010004 with returned image,
about one cent; **actual fake W spend is $0**. Image case must publish no patch/
manifest and never invoke apply. Contributor $0.10 refuses below $0.108135
before any billable call. W also requires startup/env/argv traps, trusted gate
drills and exact digest/head/lease bare-repo apply tests on Linux/macOS/Windows.

`.github/workflows/action-live.yml` is LA's workflow. Only the repository
owner starts it, by hand (`workflow_dispatch`, on the default branch; no other
trigger). It packs the product package from the dispatched commit, checks its
digest, and runs `./action` on Ubuntu against one open same-repository pull
request in review or text (fix) mode. The run uses the real
`MUSE_MODEL_API_KEY`, `muse-spark-1.3-contributor`, a $0.25 cap, a 10-minute
deadline, `contents: read` and `pull-requests: read`, and posts no comment. W's
startup traps and token sentinel apply. `test/action/la-check.mjs` requires a
completed result within the cap and no fired trap, sentinel or key-shaped
string in the published outputs. The step summary records the commit, the
`action/` tree, the package SHA-256, the outputs and the ledger.

| Receipt                   | Needed before claim                                 | Scope / limitation                                                                                                                                |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| L, pending                | reviewed local text + PNG + one-page PDF            | actual runtime/auth/stream/media/replay/accounting and credential-free captures; not universal billing/Action isolation                           |
| LA, done 2026-10-05       | reviewed candidate Action + real MUSE_MODEL_API_KEY | exact same-repo PR/dispatch, immutable Action/package digests, run/jobs/comment/artifact/usage links and masking evidence; unsigned, not registry |
| LR, pending after release | exact published package + npm verified chain        | bundle/lock/registry/subject/certificate hashes, release/action/run/result links; no claim for other/future versions                              |

The LA receipt is
[run 37249121568](https://github.com/RandyNorthrup/muse-spark-code/actions/runs/37249121568).
It reviewed the same-repository draft pull request #114 at head `9efcdbce`,
using `muse-spark-code-acp-0.12.1.tgz` (SHA-256 `64bf51c7…63ee7d`) and the
`action/` tree `64e1a69f`. The run completed with exit 0, 5 requests and
$0.001668 settled. Neither key shape appears in the log or the artifacts, and
it posted no comment, because the workflow posts none. Every field is in
[m80.md](certification/m80.md).

Capture exact tree/package SHA-256, fixture hashes, workspace, sanitized wire,
M/reservations/settlement/usage and actual model-attempt counts. Small live text
may cost a few tenths of a cent; returned image adds one cent. The integration
ran none of L/LA/LR, read no real credential and called no model.

- Usage/2: check one prompt source, byte/file/chunk caps, exact budget grammar,
  supported model/effort and backend-only flags; trust/search/bypass are refused.
- Auth/3: local store absent/unavailable or signed-out Muse Code; CI non-TTY
  key line invalid/missing. Never solve by a production key environment variable.
- Limit/5: cover model minimum; uncertainty/retries consume retained headroom.
  Request limit counts HTTP attempts, not conversation turns.
- Incomplete/8 or accounting/9: inspect latest terminal and settlement; never
  authorize post/apply from ACP end_turn alone or an earlier successful response.
- Timeout/6 or internal/1: inspect phase/idle/output bounds; forced result can be
  absent. No later phase may publish after cancellation or overflow.
- Withheld binary: generated image is binary; entire fix is withheld. Retrieve
  eligible diagnostics, review separately; do not bypass scanner or apply guard.
- Registry refusal: require genuine release provenance and exact identity; a
  candidate digest or separately fetched attestation cannot satisfy LR.

### Reading local usage

`muse-spark-code-acp --usage` (or `usage --json`) reads the same versioned local
journal and checked page totals as the interactive page. It makes no model
request. Headless executions record settled calls through the shared writer;
usage files contain no prompts, paths, keys or key digests. This does not change
M80's pending hosted/live certification or paid admission policy.
