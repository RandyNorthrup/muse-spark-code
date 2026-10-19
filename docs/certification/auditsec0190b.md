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
`test/unit/providerRetryWait.test.ts` driving the real
`RequestTransport.request` against a real loopback socket with real
timers and a real `AbortSignal`: a hostile `retry-after-ms:
99999999999999` yields four uncapped-wait notices carrying the
absolute-time sentence (5 socket hits: 1 + 4 retries), and a
`Retry-After: 120` wait ends at once on Stop (1 notice, 1 hit,
`cancelled`, milliseconds not minutes). Both suites fail on the capped
code (the notice suite hits the repo's own 5 s timeout on the 60 s
capped sleep — the silent stall, observed).

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
function returning a fixed address list and a real loopback server
under the unresolvable name `probe.invalid` (RFC 2606: no machine
resolves it, so an answer proves the dial used the checked address):
the request reaches `127.0.0.1` with `Host: probe.invalid:<port>`
after exactly one resolution; answers moved to `169.254.169.254`, or
mixed with it, send nothing (`rebinding`, zero socket hits).
