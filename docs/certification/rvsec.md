# RVSEC — security review with fix rights (2026-10-22, rig `linuxlt`)

Base: `int/recovery` at `397aca3ddb` (0.19.0). Landed by `--no-ff` merge:
`src/RVSEC/02-rec-rlm109` (RLM109 vault migration, `4ce361c2f3`), then
`src/RVSEC/01-rec-rlgrokauth` (RLGROKAUTH Grok sign-in, `843d28794a`;
conflicts resolved by meaning: ChatGPT core keeps RLM109's
`chatgptRecord` leaf under RLGROKAUTH's shared OIDC helpers, the shared
command runner keeps HEAD's grant-status read, migration takes the
ChatGPT subscription codec and still excludes Grok). Fixes:
`78904a25a2`, `98c39228e6`. No real sign-in and no provider calls (xAI
has issued no client id); every test below runs real code with the
recorded discovery capture as its only outside input.

## Findings fixed (each: red before, green after)

### RVSEC-1 (medium) — device verification address accepted any https host

`src/core/providers/subscriptions/grok.ts:359` (`verificationAddress`).
Attack: the RFC 8628 reply's `verification_uri` is printed for the
person to open and type the user code into. Any secure host was
accepted, so a compromised or spoofed device reply could send the
person (and the code) to an attacker's page. Fix: only xAI's own
domain (the issuer's registrable domain `x.ai` or a subdomain) is
showable; a foreign or lookalike host (`evil.example`,
`auth.x.ai.evil.example`, `notx.ai`) refuses as
`verification-refused`, and a foreign `verification_uri_complete`
falls back to the plain address like any other unshowable one. The
exact host is still pinned from the first live sign-in, which may
widen this from its capture. Drill: the new cases in
`test/unit/grokSignIn.test.ts` ("refuses a malformed reply…") failed
before the fix (foreign hosts parsed), pass after.

### RVSEC-2 (low) — a refresh ID token could change the grant's nonce

`src/core/providers/subscriptions/grok.ts:462`, `:868`
(`verifyGrokIdToken`, refresh path in `accessToken`). Attack: a
browser grant's refresh verified its ID token with
`expectedNonce: undefined`, so a token minted for a different flow of
the same client (any nonce at all) was accepted as this grant's
identity on refresh; only the account-hash comparison stood behind
it. Fix: the refresh binds the stored nonce exactly as
`verifyChatGptIdToken` does — a refresh token may omit the original
nonce (OIDC) but never change it (`isRefresh`). Drill: "binds a
refresh token to the grant nonce it may omit but never change" in
`test/unit/grokSignIn.test.ts` (real ephemeral ES256 keys) failed
before (omitted nonce rejected once an expectation was passed, and
the refresh path passed none), passes after.

### RVSEC-3 (low) — any local request could abort a loopback sign-in

`src/runtime/subscriptionCallback.ts:125`,
`src/host/providers/subscriptionCallback.ts:104`. Attack: both
loopback servers settled the whole flow with the parser's failure on
the first `/auth/callback` request, so any same-machine process (or a
drive-by page that finds the ephemeral port) could kill an
in-progress ChatGPT or Grok sign-in with one stateless GET — no code
theft (the 128-bit state still gates success), but a reliable abort.
The editor-side server also lacked the runtime server's Host-header
check. Fix: a callback whose `state` is not this attempt's gets the
fixed 400 page (and, in the editor, the fixed log line) and settles
nothing; the attempt's own callback still completes it. The editor
server now checks the Host header too. The parsers keep throwing
`invalid-state` when called directly. Contract change, recorded
here: the suites that asserted settle-on-mismatch now assert
ignore-and-complete ("ignores a mismatched state and still takes its
own callback" in `chatGptCallback.test.ts`,
`grokRuntimeHost.test.ts`, `grokHostPorts.test.ts`); they failed
(3 tests) before the fix and pass after.

## Reviewed, no change (evidence in the code named)

- PKCE: `createPkcePair`/`pkceRandom` use `node:crypto` `randomBytes`
  (32-byte verifier, 16-byte state/nonce), S256 only, and discovery
  must advertise S256 (`grok.ts` discovery schema). Issuer and every
  endpoint are string literals in the schema; `jwks_uri` must be
  same-origin with no identity, query or fragment. Requests use
  `redirect: 'error'`. ID tokens: pinned `alg` (ES256/P-256 for Grok,
  RS256 for ChatGPT), single matching `kid`, audience/`azp`/expiry,
  signature verified before any identity leaves as a hash.
- Tokens live only in the OS credential store / SecretStorage under
  `museSpark.provider.grok` (`grokSignIn.ts`, `grokHost.ts`); the
  record never crosses a UI bridge (surfaces read presence and the
  account hash only), never reaches a log (failures are fixed codes;
  provider error words pass an opaque-token pattern first), and
  `accessToken` refuses any request URL not on `https://api.x.ai`
  before a token can be attached.
- `museSpark.grokClientId` is `"scope": "machine"` in `package.json`
  (line 1545), so a workspace cannot set it; the CLI takes it only
  from `--client-id` typed by the person, and a session never signs
  in (refresh uses the stored grant's client id). No scopes setting
  exists for a workspace to widen; the editor always asks the default
  set. A stored grant is never overwritten: the terminal refuses
  `already-added` and the editor reuses the grant.
- Refresh races within one surface are serialized (file lock in the
  editor, named lock in the runtime; both fail closed as
  `lock-busy`). Residual, recorded not fixed: the two surfaces hold
  _different_ locks (the shipped ChatGPT split), so an editor window
  and a CLI process refreshing in the same seconds are not mutually
  excluded; with rotating refresh tokens the loser can read
  `sign-in-required` (availability only — both re-read the record
  under their lock, and no token leaves its origin). Unifying the
  locks changes certified ChatGPT lock behavior across bundles and
  is left to the lead as its own lane.
- M124 connector: grants are made only by the owner's interactive
  terminal command with a typed confirmation, live outside every
  repository, and no MCP tool can create or widen one (no
  grant/approval-answer tool exists; client hints, elicitation and
  annotations reach no decision path — `policy.ts`, `approval.ts`).
  Admission re-reads the grant and kill switch at every gate,
  workspaces resolve only by grant-owned ids to owner-recorded
  `realpath` roots, content needs the workspace's content flag, an
  unreadable confidential policy refuses, paid authority is
  hard-zero, every effect is preceded by a durable audit receipt
  (Stop excepted by design), results are allow-listed projections,
  scrubbed leaf-wise and whole (a final-pass hit withholds, never
  trims). Storage is owner-only with the tree verified before
  serving (links, foreign owners and writable ancestors refuse).
- Vault anchors (RLVAULTANCHOR): every OS-store record is keyed to
  the canonical broker root's SHA-256; the pre-scoping records are
  adopted only by a root whose files name the same vault id, writes
  stay on the account read, anchor advance is monotonic with a
  prior-state check, and slot unwrap binds the stored reference to
  this vault's own ids. A test or foreign root therefore cannot name
  the person's records; a _copied_ vault aliases by construction,
  which is D89.15's documented same-user residual. Migration
  (RLM109): codecs refuse unknown fields rather than dropping them,
  copies verify by digest through the authenticated private channel
  before the journal records them, the legacy entry is retained and
  mirrored until retire (retire needs a verified live copy past the
  retain window), an interrupted delete never removes a newer
  record (digest mismatch re-seeds instead), journal rows are hidden
  first-party `never` items, and logs carry key names and fault
  codes only — no secret material in logs, errors, usage or panel
  state was found.

## Suites run here (repository timeouts, `--maxWorkers=3`)

- Grok/ChatGPT: `grokSignIn` (22), `grokRuntimeHost`,
  `grokProviderCommands`, `grokPlan`, `grokClientIdSetting`,
  `grokHostPorts`, `chatGptCallback`, `chatGptHostId` — green;
  `vitest related` over the four changed sign-in sources: 24 files,
  310 passed, 2 skipped.
- Vault: `migrationCodecRoundTrip`, `credentialMigration` (17 passed,
  4 skipped), `vaultMigrationList` — green.
  `chatgptSubscriptionMigration`, `credentialMigrationStore` and
  `posixVaultPanelFlow` skip their store cases here: this sandbox
  has no D-Bus Secret Service (the same skip RLVAULTANCHOR recorded);
  their real-store proofs stand in `docs/certification/rlm109.md`
  and hosted CI.
- Connector: `connectorLogic`, `connectorRuntime`,
  `connectorApprovalButtons` — green. `connectorServe` (5) and
  `connectorStorageGuard` (3) fail in this sandbox because the
  storage guard correctly refuses this lane's temp tree: ancestors
  of `$TMPDIR` are group-writable (mode 775) and `/home` is owned by
  neither this user nor root, so `verify()` refuses `access` /
  `owner` by design. Measured identical on the untouched base
  `397aca3ddb` in a scratch worktree (same 5 failures, same
  assertion), so this is the environment, not the merges; hosted CI
  is their proof.

## Gates (this tree; exit codes measured, not piped)

prettier --check (touched files) 0; eslint --max-warnings 0 (touched
files) 0; `npm run typecheck` 0; `node scripts/check-l10n.mjs` 0;
`npm run check:reference` 0; `npm run check:host-api` 0;
`npm run check:roadmap` 0; `npm run check:catches` 0;
`npm run duplication` 0 (one clone from the Grok source against an
int suite, de-cloned in `98c39228e6`); `npm run cycles` 0;
`npm run deadcode` 0; `SEMGREP_ENABLE_VERSION_CHECK=0 npm run
security:sast` 0 (533 rules, 0 findings); `npm run security:audit` 0.
`npm run build` 1 and `npm run check:plan` 1 — both measured
identically on the untouched base, next paragraph. Known measured
base states:
`npm run build` exceeds three budgets identically on the untouched
base (`dist/modelApi.js` 540355 B base vs 540371 B here,
`dist/resourceAdmission.js` 25639 B, `dist/vaultActions.js` 25606 B
— the same three OVER lines before and after these merges; never
raised), and `npm run check:plan` already fails on the base
(PLAN.md 3668951 B on `397aca3ddb` vs the 3565158 B budget) — the
archiving it asks for is the lead's, and this lane adds only its
short status sections.
