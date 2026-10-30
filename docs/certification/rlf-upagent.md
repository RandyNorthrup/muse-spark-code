# Certification — RLF-UPAGENT (agent backends, protocols, editor SDKs)

Lane RLF-UPAGENT, 2026-10-30, rig `linuxlt`, worktree
`/home/randy/lanes/RLF-UPAGENT`, branch `rec/rlf-upagent`, base
`int/recovery` `b781451b94`. The cited survey is
`docs/research/agents-sdks-2026-10-30.md`; every upstream claim below
is sourced there with its URL and read date. No model call, paid or
contributor, was made: the one live CLI run used the CLI's own `echo`
provider.

## What landed

- `7c4a9e987` — the research survey and gap table
  (`docs/research/agents-sdks-2026-10-30.md`).
- `4d0794fa8` — `@muse-code/sdk` 1.4.11 → **1.4.12** (`package.json`,
  `package-lock.json`), the newest Muse release past the 7-day
  `min-release-age` window on 2026-10-30 (published 2026-10-22;
  changelog reviewed; the only differing shipped modules are the
  fingerprint pin, additive `msp.d.ts` types and an approval-facade
  retention we do not import — tarball diff in the survey §1). A
  person reaches it by doing nothing: with Muse Code 1.4.12
  installed, session starts no longer log "MSP schema fingerprint
  mismatch" (`src/host/backend/museCodeBackendManager.ts`
  `logFingerprint`), and 1.4.12's protocol fixes (multi-root
  `workspaceRoots` writes, `muse serve -c hooks.…` honoured in served
  sessions, `session/leave` races) apply to every served session.
  Test: `test/unit/museCodeLatest.test.ts`, "schema fingerprint at
  SDK 1.4.12 (RLF-UPAGENT)" (3 tests, real SDK exports + real
  constants; the 1.4.12 fingerprint literal is the published
  tarball's own pin, read 2026-10-30).

Everything else the survey found is either already current (MCP
2026-07-28 client including the TS SDK 2.4.0 `x-mcp-header` walk,
`iss` validation, connector protocol set; xAI API-key facts through
grok-4.7 with no retired slug named; TypeScript 6.0.3 still the
typescript-eslint ceiling; no VS Code proposed API in use) or briefed
below because it is bigger than a few safe files, is inside the 7-day
window, needs a served capture, or needs the owner's Marketplace
account.

## Red/green drills

- **Fingerprint tests, red on the old pin.** With the test written and
  `@muse-code/sdk` still 1.4.11:
  `npx vitest run test/unit/museCodeLatest.test.ts --maxWorkers=3 -t "schema fingerprint at SDK 1.4.12"`
  → 3 failed (the pin assertion, the not-in-the-map assertion, and
  the 1.4.11-warning assertion, which is silent while 1.4.11 is the
  pin). After `npm install --save-exact @muse-code/sdk@1.4.12` the
  same command exits **0**, 3 passed; re-run after the lint fix also
  exits **0**. The full file plus `museCodeDecisions.test.ts` and
  `mapNotification.test.ts`: 108 passed, exit **0** (repository's own
  timeouts, no `--testTimeout`).
- **Live echo-serve probe (real CLI, no model call).** A probe under
  the lane `$TMPDIR` (not committed) spawned this rig's real
  `muse serve --provider echo --no-session-log` (CLI 1.4.11) with
  HOME/XDG in a scratch dir, sent the captured `initialize` frame
  shape, and fed the served fingerprint to the installed SDK 1.4.12:
  served `sha256:f282ad16…1082`, pin `sha256:cfdb6d25…b4e0`, verdict
  `schemaFingerprintMismatch` — whose `served` value
  `MSP_KNOWN_SCHEMA_FINGERPRINTS` names `1.4.11-R6667.1`, which is
  exactly the branch where `logFingerprint` prints the info line
  instead of the warning. Exit **0**. Provenance pattern follows
  `test/fixtures/m127/provenance.json` (echo provider; 0 model
  attempts).

## Gates (final tree, exit codes)

- `npm run typecheck` (all six projects): **0**. (One earlier combined
  run exited 2 with its output truncated mid-sequence and zero
  `error TS` lines; every project then passed individually and the
  full re-run on the final tree exits 0. Recorded as observed; cause
  UNMEASURED beyond those two facts.)
- `npx eslint --max-warnings 0 test/unit/museCodeLatest.test.ts`:
  **0** (one lint error on an `as` cast was found and removed by
  restructuring, not by assertion).
- `npx prettier --check` on every touched file: **0**.
- `node scripts/check-l10n.mjs`: **0** (0 problems; no string changed).
- `npm run check:reference`: **0**.
- `npm run check:host-api`: **0** (392 VS Code APIs; 0 problems).
- `npm run check:plan`: **0** (241 milestones; 0 drift).
- `npm run check:roadmap`: **1** before regeneration (the M127 status
  changed the source fingerprint), **0** after
  `npm run roadmap:generate`; the regenerated `ROADMAP.md` differs
  only in its fingerprint line.
- `npm run check:catches`: **0** (counts match the baseline; none
  moved).
- `npm run duplication`: **0** (0 clones).
- `npm run cycles`: **0**.
- `npm run deadcode`: **0**.
- `npm run build`: **0** (every budget holds; 162 bundles).
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: **0**
  (5209 files, 1074 rules; re-run in the foreground and its output
  read back after the first background run's capture proved
  unreliable).
- `npm run security:audit`: **0** (7 advisories noted, 0 exceptions;
  none in `@muse-code/sdk`).
- Suites: `museCodeLatest` + `museCodeDecisions` + `mapNotification`
  (108 tests): **0**. No `src/` file changed in this lane, so there is
  no `vitest related` source set; the SDK is a devDependency bundled
  into the host, and the three suites above are the ones that import
  it. The OS credential-store and vault suites were not run: this
  lane touched neither area.

## Lane briefs for the larger gaps

Each brief: title, platform, base `int/recovery` (or newer main when
taken), what to build, proof. Sources: survey §§1–6.

- **B1 — ACP SDK 2.0.2+ (CRLF stdio framing).** Any rig. Bump
  `@agentclientprotocol/sdk` to the newest release past the 7-day
  window (2.0.2 clears it 2026-10-31; take 2.1.x/2.2.x when they
  clear, after re-reading their diffs). Our agent frames on the SDK's
  `ndJsonStream`, so a CRLF-framing client can stall today. Proof:
  the ACP stdio suites, a CRLF-framed real-client run of the packed
  agent, typecheck/build.
- **B2 — Muse 1.4.13/1.4.14 currency (M127).** Rig with the CLI at
  the target release. Pin past the window; capture served frames
  (echo provider) for `cuaCardFacts`, `backgroundTerminalCompletion`,
  `blockedPrompt`, `executionMode`, and 1.4.14's `held`/`heldFor`,
  `earlierHistory`, `queuedInputs`, `reviewerReason`; render the CUA
  card facts on the approval card in the host's words (quoted plain
  text per the SDK contract); add the served fingerprint(s) to
  `MSP_KNOWN_SCHEMA_FINGERPRINTS` from the capture; assess offering
  `muse usage` (subscription allowance without a model turn) and
  `muse serve --preset`. Proof: capture tests in
  `museCodeLatest.test.ts`, provenance in `test/fixtures/m127/`,
  packed-product run on the named contributor model per the lane
  rules.
- **B3 — Serve ACP-transport MCP servers.** Any rig. Using ACP SDK
  2.1+'s MCP-over-ACP binding (MCP 2026-07-28 over `mcp/message`),
  run the ACP-transport servers `mcpServersFrom` currently reports
  skipped, through the same admission, consent and tool-offering
  path as stdio/HTTP servers, on the Model API backend. Proof: a real
  editor (Zed) handing the agent an ACP-transport server whose tool
  answers in a turn; suites for the translation.
- **B4 — ACP Agent Registry listing.** Lead/owner-visible. Submit
  `muse-spark-code-acp` to the Zed+JetBrains registry (our
  `authMethods` terminal shape already meets its gate); keep the
  listing's install command on the published npm package. Proof:
  one-click install in Zed and in a JetBrains IDE, first turn each,
  recorded in `docs/ide-compatibility/hosts.md`.
- **B5 — MCP client registration (CIMD first, DCR fallback).** Any
  rig. When a server's authorization server supports Client ID
  Metadata Documents, present our hosted metadata document URL as
  `client_id`; where only DCR exists, register with the
  `application_type` the 2026-07-28 spec requires, keying the issued
  credentials by issuer (SEP-2352). Hosting the metadata document is
  a lead decision (domain); the client work fails closed without it.
  Proof: onboarding a registration-requiring public MCP server end to
  end with no hand-supplied client id.
- **B6 — MCP extensions, per named host.** Tasks
  (`io.modelcontextprotocol/tasks`), Skills (SEP-2640) and MCP Apps
  (`io.modelcontextprotocol/ui`): implement only against a named
  host/server that requires or offers one, client side or connector
  side as that host needs; record the refusal with evidence if none
  does. Proof: the named host's own flow working through the packed
  product.
- **B7 — Marketplace publishing off the PAT (P1, by 2026-12-01).**
  Owner + any rig. Owner creates the Trusted Publishing policy in
  the Marketplace publisher account; lane bumps `@vscode/vsce` past
  the window (4.1.0 carries `--oidc`), switches `release.yml` to
  `vsce publish --oidc` with `id-token: write`, and removes the
  `VSCE_PAT` path. Open VSX (`OVSX_PAT`) is unaffected and stays.
  Proof: a tagged release run publishing with no PAT secret present.
- **B8 — VS Code Agent Host Protocol: decide, then maybe build.**
  Lead design first: does Muse Spark Code appear as an AHP host (its
  sessions drivable from VS Code's Agents window, the Copilot app and
  GitHub.com), an AHP client, or neither — against PLAN D60/D84 and
  the ACP investment. Only a "host" answer becomes code. Proof (if
  built): a VS Code 1.144 Agents window driving our session.
- **B9 — M104 native-host SDK notes.** For the M104 lanes when built:
  JetBrains targets IntelliJ Platform 2026.3 rules (explicit module
  dependencies for extracted modules; no core-classloader JNA — FFM;
  client-named LSP APIs); Visual Studio targets the VS 2026
  `VisualStudio.Extensibility` SDK before VSSDK. No standalone work;
  these notes ride the M104 lane briefs.
- **B10 — Qualify Xcode 27, Sublime and Qt Creator over ACP.** Mac
  mini (Xcode) + any rig. Run the packed ACP agent in Xcode 27's ACP
  plug-in support, Sublime's `ACP` package and the Qt Creator ACP
  client; record each first turn and move the `hosts.md` rows only on
  that evidence.

## Open items that are not ours to close

- Grok subscription sign-in still waits on xAI publishing a
  third-party OAuth client registration; there is none as read
  2026-10-30 (survey §6). RLGROKAUTH unchanged.
- A served Muse 1.4.12+ fingerprint capture needs a rig whose
  CLI is at that release; this rig runs 1.4.11 and was not
  self-updated. Until B2 captures one, a 1.4.12 host is exact-match
  silent (no map entry needed) and 1.4.13/1.4.14 hosts warn once per
  start through the existing mismatch path — visible, never silent.
