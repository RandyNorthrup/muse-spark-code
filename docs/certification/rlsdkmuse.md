# Certification — RLSDKMUSE provider survey (2026-10-22)

Lane RLSDKMUSE, 2026-10-22, worktree branch `rec/rlsdkmuse`.
Rig `macmini`, worktree `/Users/randy/lanes/RLSDKMUSE`. Base main at
0.19.0 (`f3941b854`). The brief's survey is
`sdk-survey-2026-10-22.md` (sources re-read and verified below, not
trusted).

## Sources (date, source, result)

All read 2026-10-22 on this rig:

- Official Muse Code changelog
  (`https://dev.meta.ai/docs/muse-code/changelog`): 1.4.11 adds
  `session/leave` (+ `session/leaveCompleted`, `session/closed` reason
  `leave`) and the SDK `feedbackNotAccepted` approval failure; hosts
  refuse `approval/decide` feedback on a choice that does not accept it.
- The published SDKs (`npm pack @muse-code/sdk@1.4.11`,
  `@agentclientprotocol/sdk@2.0.1`, unpacked under scratch): 1.4.11's
  `EXPECTED_SCHEMA_FINGERPRINT` is
  `sha256:f282ad16e21520d0cda68cb190149b86e2b062eef1dd282749360c05aa3d1082`;
  every SDK module this tree imports is byte-identical between 1.4.10
  and 1.4.11 except the fingerprint pin. ACP 2.0 splits the v1
  entrypoint into stable and `/unstable`
  (`MIGRATION_STABLE_UNSTABLE.md`, read from the repository) and
  removes the legacy connection classes; the stable `session/new`
  schema no longer accepts the ACP-transport MCP server 1.8.0 parsed
  (proven by parsing one entry against both shipped zod schemas:
  stable rejects, unstable accepts).
- This rig's installed CLI 1.4.11 (1.4.11-R6667.1):
  `muse schema generate-json-schema` serves fingerprint
  `sha256:f282ad16…1082` with `session/leave` and
  `session/leaveCompleted` in the method index — the third agreement
  with the SDK pin and the
  `test/fixtures/session-titles/msp-1.4.11-echo-titles.json` capture
  (initialize frame, served 2026-10-21 by 1.4.11-R6667.1).
- Model API docs (`https://dev.meta.ai/docs/models`,
  `pricing-rate-limits.md`, `reasoning.md`): `muse-wonder-1.0` is a
  Standard-only preview reasoning model, context 1,048,576, effort
  minimal–max, priced $4.00 in / $0.20 cached / $20.00 out per million
  tokens, 3,000 RPM / 4,000,000 TPM; the Spark tariffs are unchanged.
  `max` is served only by `muse-wonder-1.0` and `muse-spark-1.3`
  (not the contributor model); `none` returns 400 on Wonder/Spark.
- CLI configuration docs
  (`https://dev.meta.ai/docs/muse-code/configuration`,
  reasoning-effort section): Muse Code offers `max` in both modes,
  `ultra` is a client-side setting mapping to each provider's highest
  level, and the Meta provider does not accept `none`.

## What changed (one commit a piece)

- `b6ab484c8` Pin `@muse-code/sdk` to 1.4.11 (published 2026-10-19,
  one-shot `--min-release-age=0` per the 1.4.10 precedent, `.npmrc`
  untouched). The 1.4.11 schema joins
  `MSP_KNOWN_SCHEMA_FINGERPRINTS`; the known-build log line no longer
  claims a direction, since older supported CLIs serve older schemas.
  `approval/decide` feedback rides only on a choice that accepts it
  (central gate in `decideApproval`); the leave handshake needs no
  mapping and a `closed`/`leave` broadcast parses with its reason as
  served.
- `24cad7b8a` Pin `@agentclientprotocol/sdk` to 2.0.1 (published
  2026-10-22, same one-shot override). The agent side, headless exec
  (its in-process peer: mixing entrypoints in `connectWith` is
  unsupported) and the engine entry take `/unstable` so an editor
  sending an ACP-transport server keeps working; the team workers keep
  stable, as transport peers choose independently.
- `2185181e9` List `muse-wonder-1.0` on the Model API backend at its
  own tariff: a both-prefixes Meta detector at every gate, a `wonder`
  tier in the priced whitelist, the documented context window, and
  facts with tool calling, vision, reasoning and parallel calls but
  no strict tools (unmeasured on Wonder).
- `a985d6534` Offer reasoning effort per exact model and backend:
  `max` only where served, `ultra` only on the Muse Code backend.
- Resumed run: the last `effortLevelsFor` call site without a
  backend takes the session's backend, and the catch baseline is
  regenerated for the one re-fingerprinted `runExec.ts` site
  (committed below).

## Proof

- ACP agent over real stdio, driven by the real SDK 2.0.1 stable
  client (scratch driver, empty workspaces): before the upgrade
  (1.8.0-built agent: initialize, session/new, session/list,
  session/close, DRIVE OK). The earlier run's post-upgrade
  prompts rode the `muse-wonder-1.0` id and are not proof; the
  resumed run re-drove the whole post-upgrade sequence on the
  packed 0.19.0 agent (see the next bullet): initialize,
  `session/new`, `session/list`, a `session/new` carrying an
  ACP-transport server (accepted, that server skipped by name),
  one prompt (`end_turn`), `session/close`, DRIVE OK.
- Real Muse Code CLI session through the packed agent on this rig
  (resumed run, 14:13–14:14 PDT): packed tarball
  `dist/muse-spark-code-acp-0.19.0-darwin-x64.tgz`, exact packed
  bits extracted under scratch, driven over stdio by the real SDK
  2.0.1 stable client in a fresh empty workspace. Expected
  beforehand: one `session/prompt` on `muse-spark-1.3-contributor`
  (selected by that explicit name through
  `session/set_config_option`), plus up to two CLI-internal calls
  the earlier run had seen — every call on the named tier, no
  other id selected anywhere. Actual, from the CLI's own session
  records (`sessions/.msp-view-g6/01a16576-9bb8-…`, counted
  afterwards): exactly one turn (`turn/started` × 1,
  `turn/completed` × 1, one `tokenUsage`), `stopReason:
end_turn`, the model answering `ready`; every model id in the
  records is `muse-spark-1.3-contributor` and the cost ledger
  carries only it (28,928 in / 18 out / 8 reasoning). Real model
  calls: 1, all on `muse-spark-1.3-contributor`. The companion
  session (the ACP-transport `session/new`) made no call: its
  ledger is empty. No Model API calls: the rigs hold no Meta key.
  The earlier run's two sessions on a `muse-wonder-1.0` id are not
  used as proof (unknown tier; the lead stopped that run for it).
- Red/green drills, each broken on purpose (exit 1) then restored
  green: the feedback gate, the fingerprint map entry, the
  `closed`/`leave` schema, the loosened-client seam (strict router
  kept), the wonder whitelist, the exact-match effort table. Done
  on this code in the earlier run; the resumed run changed none of
  those files (only `src/acp/agent.ts` line 2203, a backend
  argument on a length guard, and the regenerated catch baseline
  below), so they stand.
- Resumed-run additions: the last `effortLevelsFor` call site
  without a backend (`AcpSession.applyEffort`) takes the
  session's backend; `scripts/catch-baseline.json` regenerated
  (one GENERIC identity hash in `runExec.ts`, whose enclosing
  function the effort threading touched — handler text unchanged,
  all counts identical); the Model API price, reasoning and
  models pages re-read 2026-10-22 (Wonder $4.00/$0.20/$20.00
  Standard-only, 1,048,576 context; `max` on Wonder, Spark 1.3
  and Wonder Full, not on the contributor model; `none` 400);
  the stable/unstable `session/new` split re-proven against the
  shipped zod schemas (stable rejects the ACP-transport entry,
  unstable accepts).
- `vitest related` over every changed source file (718 files,
  22,138 tests, repo timeouts): the lane's 12 touched suites and
  every related protocol/pricing/effort suite green; 16 unrelated
  files fail (connector, crash marker, estimator, legal cancel,
  mac RSS, native git, playbook schedules, schedule fire/pause,
  tree sync, trees lifecycle, vault socket/migration/writer
  crash). Each of the 16 was re-run isolated on the lane tree
  and on a clean base worktree (`f3941b854`, same
  `node_modules`, none of the 16 imports either bumped SDK):
  every failure fails identically on base (crashMarker 1,
  macRss 6, schedule/treeSync 11, trees/vault 4+17), and base
  fails 9 more the lane passes in isolation (estimator,
  legalCancel, nativeGit, playbookSchedules). All pre-existing
  on this rig; none is this lane's. Full log:
  `temp/rlsdkmuse-related.log` (gitignored).
- Gates on the final tree, true exit codes: prettier 0, eslint
  `--max-warnings 0` 0, typecheck 0, `check:l10n` 0,
  `check:reference` 0, `check:host-api` 0, `check:plan` 0,
  `check:roadmap` 0, `check:catches` 0 (after the baseline
  regeneration), duplication 0, cycles 0, deadcode 0,
  production build 0 (every budget holds).
- Older CLIs: the map admits 1.4.4, 1.4.9 and 1.4.11 schemas; a
  1.4.7 CLI (the other rigs' pin) serves an unmapped schema and
  gets the mismatch warning only — the connection proceeds by
  design. No 1.4.7 capture exists on this rig (it runs 1.4.11),
  so no fingerprint was added for it.
