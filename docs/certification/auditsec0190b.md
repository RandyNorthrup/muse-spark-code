# Security audit, 0.19.0 JOINC features + dependency groups (lane B)

Scope: JOINC on `release/0.19.0` (`da685b3414`), i.e. the features group
(PR #219 #221 #224 #226 #206 #243 #231 #232) and the dependency group
(PR #215 #169 #194 #195 + unicorn 77). Method: read the added/changed
source folder by folder (`src/host`, `src/runtime`, `src/core`, `src/acp`,
`src/shared`, `scripts/`, `action/`, native helpers' callers), then drove
the real parsers and validators with hostile input through an esbuild
bundle of the actual modules (scratch probe, not committed). SAST:
`npm run security:sast` exit 0 (only rule timeouts on the 12k-line
`ModelApiHost.ts`, no findings).

## F1 (fixed): a hostile provider 429 wait stalls a turn unbounded

- `src/core/backends/modelapi/transport.ts:381` (`providerWaitMs`) and
  `:909` (`backoffMs`), `src/core/backends/modelapi/pacing.ts:357
(`observe`). The JOINC rate-limit/Azure work added the `retry-after-ms`millisecond header (read before`Retry-After`). The parsers return the
header whole and the consumers slept it whole: `backoffMs`returned`suggestedMs + jitter`with no ceiling, and`observe`set`pausedUntil = now + retryAfterMs` with no ceiling.
- Attacker: a compromised custom-provider endpoint (endpoints are
  user-configurable, Azure-compatible included) or a network MITM
  answering 429. What they get: driven values `retry-after-ms:
99999999999999` -> sleep 99999999999999 ms (~3170 years) per retry try
  (foreground turn never returns until the user Stops it), and a
  `Retry-After` HTTP date in 2040 -> 416620624811 ms. Background dispatch
  wedged the same way via `pausedUntil`.
- Fix at the cause: the provider's wait is honored whole up to the
  client's own retry ceiling; past it the ceiling applies per try
  (`Math.min(..., MODEL_API_RETRY_MAX_MS)` in both sinks). Still waited
  and still retried, never refused. Parse functions keep exact values
  (existing 1500 ms assertions untouched).
- Proof: `test/unit/providerPacing.test.ts` gains `hostile provider waits
stay bounded` (two tests driving `99_999_999_999_999` through the real
  `ModelApiPacing.observe`+`acquire` and the real `RequestTransport.
backoffMs`). Both fail with the caps reverted (2 failed, rest green)
  and pass with them (15/15).

## Reviewed clean (driven, no defect)

- `azureOrigin` (`src/core/providers/presets.ts:907`): resource pattern
  `^[a-z0-9-]{3,24}$` forbids dots, so hostile names
  (`evil.openai.azure.com.evil.com`, `../x`, `res%2eopenai`, 25 chars)
  all return undefined; `-abc` yields a contained single-label origin.
- `accountLedgerDirectory` (`src/core/media/uploadLedgerStorage.ts:51`):
  `..`, `../x` throw `Media path escapes its directory`; account ids at
  both callers are SHA-256 digests, never `.` (the one value that would
  collapse to the root, and it cannot occur). Last-account pointer
  re-validated as hex (`readLastAccountId`).
- `isNpmPackageName`/`encodeNpmPackageName`
  (`src/core/reporting/sources/npmStore.ts`): `../evil`,
  `@scope/../../x`, `@`, 300-char, uppercase all refused; encoding never
  emits a bare `/`.
- `uploadExpirySeconds` (`src/core/backends/modelapi/files.ts`): 0/-3
  clamp to the 1-day minimum, 31 to the 30-day maximum, non-integers to
  the default.
- `originOf`/`checkEndpointUrl`/`classifyAddress`
  (`src/core/providers/endpointPolicy.ts`): userinfo/query/fragment
  refused, `169.254.169.254` and `fd00:ec2::254` classified `metadata`
  and refused, `fe80::1%eth0` unusable.
- `parseCredentialJournal` (`src/core/credentialLease.ts:278`): strict
  zod; every non-journal staging value reads as undefined; recovery
  compares staged vs primary and never keeps a foreign key silently.
  Lock dirs derive from internal config paths, never attacker text.
- Foreign-hook command matcher
  (`src/core/backends/modelapi/foreignHooksEntry.ts:137`): clipped,
  unreadable, or unfinished patterns run the guard (fail closed).
- Playback (`playback.ts`, `ModelApiHost.ts:4567,12156,6579`): tools
  `[]`, every named call refused in code in every mode, no hook
  dispatch on playback turns.
- Dynamic regexps: escaped user text first (glob builder,
  path-redaction builder); `new RegExp(m)` only inside the bounded,
  fail-closed hook matcher.
- Child env: MCP allowlist (`mcpProcess.ts:94`), voice
  `withoutCredentials` (`voiceProcesses.ts`), converter trust via
  `%SystemRoot%` PowerShell + encoded commands (`converterTrust.ts`,
  `tokenFile.ts`), dictation helpers fixed commands + digest-verified
  Linux binary + audio-server env stripped (`helperLocation.ts`).
- Media converter: machine-scoped `mediaConverterPath` still passes
  trusted-path verification + version-banner check (`convert.ts:201`);
  private root/dir creation verified, TOCTOU-checked, errors scrubbed
  of paths (`privateDirectory.ts`, `privateRootLease.ts`).
- Report pipeline: save names refuse traversal and Windows device
  spellings (`destinations/save.ts`), POST goes through confirmed
  schema-parsed targets (`post.ts`), security collector emits
  counts/kinds only (`collect/security.ts`), store adapters use fixed
  hosts + strict name patterns (`sources/npmStore.ts`, …).
- Headless files egress allowlists methods/paths/body caps
  (`runtime/exec/filesTransport.ts`); ACP `/uploads delete` refuses
  `0`/`007`/computed indices (`acp/uploads.ts`).
- CI key intake (`action/lib/ci-key.mjs`): `O_NOFOLLOW`, size cap,
  alias allowlist, env scrub of value copies, single-source agreement.
- Linux dictation supply chain: source tarball sha256-pinned,
  helper pins digest-checked (`scripts/build-linux-dictation.mjs`,
  `scripts/check-linux-helper-pins.mjs`).
- Dependencies: only version bumps (ACP SDK 1.8.0, Muse SDK 1.4.10,
  keyring 2.1.1, types, axe, eslint); no new production packages.

## Incidental: unicorn 77's new asterisk rule is red tree-wide (pre-existing)

`eslint-plugin-unicorn` 76->77 (dependency group) added
`no-asterisk-prefix-in-documentation-comments` to the recommended set
(`eslint.config.mjs:97` spreads it wholesale). Untouched files fail it
too (e.g. `src/core/credentialLease.ts:65,125,172,245,319`), so
`lint:js:main` is red on the JOINC tree independent of this lane: the
dependency lane fixed only new comments. This lane's touched files are
clean (autofix + one early-return in `pacing.ts`, non-empty logger in
the test). Referred to the lead for a tree-wide pass.

## Noted, not fixed (pre-existing sinks outside JOINC, with why)

- `resetDurationMs('999999h')` -> 3.6e12 ms feeds derived pacing
  windows with no ceiling (`pacing.ts:104`). Only background classes
  wait on windows, every wait is Stop-abortable, and legitimate
  day-long windows (Groq) exist; capping would change real pacing
  math. Left as is.

## Follow-up (2026-10-18, lane AUDITSEC2FIX): the owner's way

### F1 replaced: the provider's wait is honoured whole, told, and stoppable

The `MODEL_API_RETRY_MAX_MS` cap above contradicts the owner's limits
rule (AGENTS.md: the only hard-coded limits are each provider's own),
so the silent cap is gone: `backoffMs` returns a named wait whole
(`src/core/backends/modelapi/transport.ts`), and `observe` pauses
background dispatch for the whole named wait
(`src/core/backends/modelapi/pacing.ts`). Only our own exponential
fallback (no provider value to honour) keeps a ceiling. In its place
the truth: the retry notice names the provider's wait and when it ends
in absolute time and plain words
(`UI_TEXT.modelApiProviderRetryWait`, filled with
`formatDateTime(now + delay)`, in all 14 tables), fired at once before
the pause, and the pause stays Stop-abortable (`pause` races the turn's
signal). The `HTTP 429:` reason prefix is unchanged, so the
rate-limited retry readers match as before.

Proof: `test/unit/providerPacing.test.ts` (`provider waits are
honoured whole`: the exact negation of the cap assertions, failing on
the capped code and passing on this tree, 15/15) and the new
`test/unit/providerRetryWait.test.ts`, which drives the real
`RequestTransport.request` with real timers and a real `AbortSignal`
and no socket and no server: the injected fetch answers each attempt
with a hand-built 429 `Response` whose header values are the hostile
input under test (a real `Headers` object is input data, not a
provider). A 250 ms `retry-after-ms` wait is really slept whole four
times (5 answers: 1 + 4 retries; the ~1 s elapsed floor proves the
sleeps happened), every notice carries the absolute-time sentence, a
`Retry-After: 120` wait ends at once on Stop (1 notice, 1 answer,
`cancelled` in milliseconds not minutes), and a trillions-scale
`retry-after-ms` wait is honoured whole in the computed delay. Drill
(2026-10-19, lane AUDITSEC2FIX2): with the capped pre-fix sources back
in place all three tests fail (`expected [ 60000, 60000, 60000, 60000
]` for the trillions wait; the plain `HTTP 429: slow down` reason
where the sentence belongs); with the fix restored all three pass.
No committed capture holds a real provider 429 with `Retry-After`
(`docs/certification/m95-captures` has no 429 frame and no
`retry-after` header), so the capture leg does not apply.

### DNS-rebinding TOCTOU in `pinProviderFetch`: pinned at the dial

`pinProviderFetch` (`src/runtime/exec/providerExec.ts`) no longer
hands the name to `fetch` after checking: it resolves once per request,
checks every answer against the saved network (`rebinding` before
anything is sent, as before), and dials the checked address through
Node's `lookup` answering that address only — the address checked is
the address dialled even when DNS changes in between. TLS still sends
and verifies the original name (`servername` defaults to it) and the
`Host` header carries it, as web fetch's pinned transport does
(`src/host/web/pinnedRequest.ts`); redirects stay refused
(`redirect: 'error'` parity via `HTTP_REDIRECT_STATUSES`). The unused
`fetch` parameter is gone from the pin, `probeProvider`,
`ProviderRunInput`, and `ProvidersDeps` (with its `main.ts` supplier).
`lookup` needs the address family beside it (measured on Node 24:
family in the callback alone fails with `Invalid IP address`).

Proof: `test/unit/providerPinDial.test.ts` with a real resolver
function returning a fixed address list and, where a real socket is
needed to prove the dial target, a bare TCP acceptor that records the
peer address and the raw request bytes then closes without writing a
byte — it answers nothing, so it is not a provider. Under the
unresolvable name `probe.invalid` (RFC 2606: no machine resolves it,
so arriving bytes prove the dial used the checked address): the
request reaches `127.0.0.1` with the `host: probe.invalid:<port>`
bytes and its body after exactly one resolution (the client's own
request fails, as it must with no answer); a wholly forbidden answer,
or one mixed with the loopback address, sends nothing (`rebinding`,
zero connections either time). A third test covers the redirect
refusal (`HTTP_REDIRECT_STATUSES` in `sendPinned`): the same bare
acceptor speaks framing only — a 302 with no body and no provider
content, which carries no answer by definition — and the pin refuses it
with the `redirect: 'error'` parity failure (`TypeError: fetch
failed`) after the one request, never following the Location answer.
Drill (2026-10-19, lane AUDITSEC2FIX2): with the pinned `lookup`
removed (hostname resolution at connect time, as before the fix) the
dial-target test fails with zero connections arriving, and the redirect
test fails with the DNS error instead of the refusal, while the refusal
test still passes — it guards unchanged behavior; with the fix restored
byte-exact all three pass. Drill (same lane): with the redirect branch
removed the 302 resolves and the redirect test fails (`expected
undefined to be an instance of TypeError`) while the other two pass;
with the fix restored all three pass. `test/unit/helpers/loopbackServer.ts` is deleted:
`test/unit/providerLoopbackFetch.test.ts` replays no captured wire
traffic, so its inline server stands back as it was (verified by an
empty diff against the pre-fix file; 12/12 green).

## Follow-up (2026-10-19, lane AUDITSEC2FIX3): the last provider stand-ins out

1. `test/unit/providerRetryWait.test.ts` no longer injects a fetch
   answering canned 429 `Response`s. It drives the real decision functions
   with the header values as plain input (`providerWaitMs`: `retry-after-ms`
   first, then `Retry-After` seconds, then an HTTP date), the whole-wait
   sleep rule (`backoffMs`: a named wait whole per try, trillions-scale
   included; only our own fallback keeps the `MODEL_API_RETRY_MAX_MS`
   ceiling), the retry telling (`providerRetryReason`, the new pure function
   the request loop calls per retry — named, trillions-scale and unnamed
   cases, the absolute end time in `modelApiProviderRetryWait`), the real
   `pause` over real timers (a 250 ms wait really slept whole; a derived
   120 s wait ending on a real Stop in milliseconds), and the real
   `ModelApiPacing` holding background dispatch for the derived wait while
   the foreground passes. No committed capture holds a real provider 429
   with `Retry-After` (no 429 frame and no `retry-after` header in
   `docs/certification/m95-captures`), so the function level is the proof.
   Drills: the silent cap back, the plain reason back, and the pause ignored
   in pacing fail 4/5 (the pure-sleep test needs the `pause`-not-sleeping
   break, which fails it with the Stop test); restored 5/5 with the
   repository's own timeout.
2. `test/unit/providerPinDial.test.ts` no longer runs a socket answering
   HTTP 302. The refusal decision is the new pure `isRedirectRefusal`, which
   `sendPinned` calls on every answer's status; the test drives it with
   statuses as plain input (301/302/303/307/308 refuse; 200/201/204/300/
   304/400/404/500 and a missing status do not). The dial-target proof keeps
   the silent acceptor (it answers nothing) and the rebinding refusals keep
   proving zero connections. Drill: the helper returning false fails only
   the redirect test; restored 3/3. The end-to-end behaviour — a 302 over
   the wire refused with the `redirect: 'error'` parity failure, the
   Location answer never followed — is proven by the real-life run through
   the packed product (CONTRIBUTING.md, "Before you open a pull request"),
   not by any socket in this suite.
3. `test/unit/providerLoopbackFetch.test.ts` replays the committed
   captured bytes, per case: the 200 case serves the llama.cpp b11541
   models-list sample with its captured 200 status
   (`m95-captures/llamacpp/01-models-list.json`); the non-2xx case the
   captured 400 overflow body with its status
   (`15-overflow-long-prompt.json`); the proxy case the LM Studio llmster 0.0.25-1 models-list sample
   at the target (`m95-captures/lmstudio/01-models-list.json`, captured
   bytes at the unreached proxy too); the closed, aborted and oversized
   cases captured bytes (the oversized body repeats the models-list content
   past the cap — repetition is size mechanics, every byte captured). No
   capture backs a 204/304 from these servers, so the 204/304 pair is proven
   at the function level: the server sends zero content bytes and the
   statuses are plain input exercising the real null-body branch (C-M95-4
   R2) over a real socket. The refusal and bracketed-`::1` cases serve
   nothing (pure pre-connect checks). Drills: 127.0.0.1 out of the allowlist
   fails the five 127.0.0.1 cases (GET, non-2xx, proxy, oversized, and the
   POST sub-case via the wrong refusal); the null-body branch removed fails
   exactly the 204/304 pair; restored 12/12 with the repository's own
   timeout. The refused-connection and abort cases assert settlement bare
   (`rejects.toThrow()` with no reason), so they pass on any refusal — they
   prove the probe settles, not why.
