# MSM95 certification — finish M95 Bring-your-own model providers (D74)

Lane MSM95, macmini rig, worktree `/Users/randy/lanes/MSM95`, branch
`ms/msm95`. Due Monday Oct 19. No model call was made in this lane; every
proof below runs against real modules or the packed product without one.

## What was merged from where

- `cand/MSM95/4` (C-M95-4: llama.cpp/LM Studio wire captures, local
  context windows, read-at-use-time resolver) merged with
  `git merge --no-ff` as `88e877c1f`. 26 conflicts, resolved file by
  file; CHANGELOG rebuilt under Added/Changed/Fixed; PLAN.md and
  `docs/roadmap/entries.json` kept append-only (both sides); decision
  numbers added by this branch start at D140.
- CM953 exec commits (`7a950ed0b`, `8ba1ad0a9`) evaluated and NOT
  cherry-picked: HEAD's release-train runtime (`src/runtime/backends.ts`,
  `runExec.ts`, `execArgs.ts`) already covers acceptance-14 (`--provider`,
  `auth --provider`, stdin key, accounting). Cherry-pick aborted.
- `main-now` through `3d30a7321` (includes brief SHA `821566c0f`)
  merged with `git merge --no-ff` as `19233b58e`. ~1560 staged paths;
  927 staged deletions audited individually as genuine main-side
  deletions (test-overhaul removals stay deleted). Generated files
  (`src/shared/reference/*`, `src/runtime/reference.node.generated.ts`)
  resolved by regeneration.
- Follow-up commits on this branch: `c8d2e5d70` (test repairs),
  `50eb839bb` (unwired helper removal), `aedcb6a23` (panel parity,
  D140), `2340d2706` (dead helper exports), `a2087c901` (duplication),
  `597be5c6e` (l10n order, host-api counts), `8b42e4eec` (bundle
  export, models row), `72dcc727f` (lazy registry), `63f7cf19c`
  (roadmap summary).

## What was finished

Every PLAN §M95 behaviour is connected on every named surface:

| Behaviour                                                | Connection (file:line)                                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Panel lists exactly what the transport admits (D140)     | `src/core/providers/panelSeam.ts:129` (`listedPresets()` + `custom`), `src/core/providers/presets.ts:870`                                                                                                                      |
| Uncaptured presets refused with no dispatch (R2/rule 13) | `src/core/providers/configured.ts:259` (`transportFor`), envelope `src/core/providers/configured.ts:1207`                                                                                                                      |
| Key-test refusal envelope, zero sends                    | `test/unit/configuredProviders.test.ts` rule-13 test (failed envelope + `send` spy never called)                                                                                                                               |
| Local scan probes listed presets only                    | `src/host/models/modelsPanel.ts:1145` (`providers/scanLocal` over `presetIds()`)                                                                                                                                               |
| Custom card keeps its category                           | `src/host/models/modelsPanel.ts:428`                                                                                                                                                                                           |
| Wizard save keeps limits for listed models only          | `src/host/providers/wizardSave.ts:207` (`pruneModelLimits`), loads prune at `src/core/providers/providersFile.ts:262`                                                                                                          |
| Scanned local windows carried at save                    | `src/host/providers/wizardSave.ts:177` (`scannedLocalModelLimits`)                                                                                                                                                             |
| Quick-pick local-window prompt                           | `src/host/models/modelsQuickPick.ts:125` (`runAddProviderQuickPick`)                                                                                                                                                           |
| Terminal `providers add --context-window`, probe/pin     | `src/runtime/providersCommands.ts:351` (`probeProvider`), `:373` (`pinProviderFetch`), context-window validation `:556`                                                                                                        |
| One providers-file path (terminal = panel)               | `src/runtime/providersCommands.ts:62` delegates to `src/core/credentialLease.ts:81`                                                                                                                                            |
| Headless `exec --provider`                               | `src/runtime/exec/execArgs.ts:52` (option), `:108` (flag), resolve at `src/runtime/exec/providerExec.ts:185`, pin at `:320`                                                                                                    |
| Headless account pinning (one run, one account)          | `src/runtime/exec/runExec.ts:550`, `:763` (`ExecAccountsPort.create`), port at `src/runtime/providers/runtimeServices.ts:357`, refusal of `--account-pool` (D88.5)                                                             |
| `readBoundedText` in the built product                   | `src/host/backend/modelApiEntry.ts:39` (HOTFIX0181 class: configuredProviders.js reads it from modelApi.js)                                                                                                                    |
| ACP/CLI providers surface                                | `docs/acp.md:171` (`providers add/remove/status`, `auth set --provider`, `exec --provider`); implementation through the runtime providers commands                                                                             |
| Help reference + README                                  | `docs/reference.md:3387` (connect/usage), `:3446` (`--context-window`); `README.md:69` (BYO providers), `:791` (accounts/usage), `:837` (ChatGPT), `:879` (shared codecs), `:909` (connect/usage), `:918` (`--context-window`) |

Removed, not connected: `execAccountRequest` (the only `@unwired M95`
tag left on the tree) had no caller and no possible consumer — headless
pins one account per run and refuses `--account-pool` loudly, so no
per-attempt pool adapter exists. Deleted per the no-dead-code rule;
`execAccountSelection` (`runExec.ts:550`, `main.ts:1123`) is the
connected behaviour. `testcut.md:674` still inventories the old tag as
history.

## Decided contract changes (all on this branch)

- **D140 (PLAN.md §2): the panel lists exactly what the transport
  admits.** Main listed local + custom presets without captures while
  the transport refuses uncaptured presets; the candidate excluded all
  uncaptured presets including `custom`, closing the Goal's
  "a compatible server of their own" path (the transport admits
  `custom` at `configured.ts:268`). Catalogue is now `listedPresets()`
  - `custom`; Ollama/vLLM stay out until their captures land.
- **Refusal envelope, not a throw.** `services.test()` returns
  `{kind:'failed', detail}` (main's `03fad9e41` envelope); the rule-13
  test asserts the envelope plus zero dispatches instead of the old
  `modelsPanelUnavailable` rejection. Rotation vs rest expectations
  split accordingly (rotated credentials throw
  `scheduleConfirmationExpired` through the identity re-check).
- **One providers-file path.** The terminal's `providersFilePath` was a
  second copy of core's `providerConfigFilePath`; it delegates now.
- **Models-section budget 13 → 14 KiB** (PLAN.md §7). CM954 R4's
  required saved-model editor field grew the chunk to 13,448 bytes, 136
  over. Recorded as a justified re-measurement, not a relaxed gate.
- **M95 roadmap summary** shortened to 249 characters (260-char rule).

## Gates (final tree, exit codes)

| Gate                                                             | Result                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `format:check` (prettier)                                        | 0                                                                 |
| `lint` (eslint zero-warnings, stylelint, lint:ps skipped darwin) | 0                                                                 |
| `typecheck` (all five projects)                                  | 0                                                                 |
| `knip` (deadcode)                                                | 0, no unused exports                                              |
| `cycles` (dpdm)                                                  | 0, no cycles                                                      |
| `duplication` (jscpd, threshold 0)                               | 0, 0 clones (was 15; baseline main is 0)                          |
| `check:l10n`                                                     | 0, 0 problems (reordered all 14 tables to English key order)      |
| `check:reference`                                                | 0 (73 features, 65 commands, 89 settings, 29 slash, 253 CLI)      |
| `check:host-api`                                                 | 0 after `-- --write` regeneration (branch import counts)          |
| `check:plan`                                                     | 0                                                                 |
| `check:roadmap`                                                  | 0 after `roadmap:generate` (218 entries)                          |
| `npm run build` (production + size + split + lazy registry)      | 0                                                                 |
| `security:sast`                                                  | BLOCKED (see gaps: semgrep binary crashes on this rig)            |
| `test:unit` full suite                                           | BLOCKED (see gaps: review-browser server won't start on this rig) |

## Tests (repo default 5 s timeout, `--maxWorkers=3`, no raised timeout)

| Files                                                                                     | Result     |
| ----------------------------------------------------------------------------------------- | ---------- |
| `providerOutputCap.test.ts`, `providerWizardSave.test.ts`, `modelsQuickPick.test.ts`      | 37 passed  |
| `providersPolicy.test.ts`, `providerPanelSeam.test.ts`, `providersX.test.ts`              | 74 passed  |
| `usageService.test.ts`, `usageRecording.test.ts`, `UsageDialog.test.tsx`                  | 104 passed |
| `modelApiEntry.test.ts`, `providerProvidersHost.test.ts`, `openRouterComposition.test.ts` | 76 passed  |
| `configuredProviders.test.ts`                                                             | 46 passed  |
| `modelsPanel.test.ts`                                                                     | 32 passed  |
| `providersX` + `modelApiEntryExports` re-run after late source edits                      | 39 passed  |
| `bundleExports` + `lazyBundleFiles` + `modelsPanelBundle`                                 | 72 passed  |
| `providersL10n` + `providersPolicy` after table reorder                                   | 46 passed  |
| `providerOutputCap` + `usageRecording` + `providerWizardSave` after dedupe                | 54 passed  |
| `modelApiEntry` + `providerCredentialTransaction` + `openRouterComposition` after dedupe  | 90 passed  |
| `configuredProviders` + `modelsPanel` after dedupe                                        | 78 passed  |

Fire drill (AGENTS.md rule 3): the new `providerOutputCap.test.ts`
was seen to fail — with the minimum check disabled in `modelPolicy.ts`
the two refusal tests fail and the clamp test passes; reverted
byte-exact and all 3 pass again.

## Real-life steps for the lead (no model call made here)

1. Open Models & Agents → Providers: captured presets plus Custom are
   listed; Ollama/vLLM are absent until their captures land.
2. Scan this computer with an LM Studio or llama.cpp server running:
   only the answering listed server is offered with its port filled.
3. Add a local server with `--context-window` (terminal) or the
   wizard/quick-pick/Models-table field; the window persists in
   `providers.json` `modelLimits` and sizes the next compact and send.
4. `providers connect openrouter` / `providers usage <id>` (terminal)
   and Models & Agents show the key's usage, limit and remainder.
5. `muse-spark-code-acp auth set --provider <id>`, `providers ...`,
   `exec --provider <id>` behave as `docs/acp.md` says.
6. Live proofs still owed (could not run without keys/servers):
   provider-file edit between turns changing the next cap
   (session-level refresh rig lives with the lead); a real Ollama/vLLM
   capture; a real OpenRouter exchange and browser callback.

## Open gaps (why, exactly)

- **vLLM + Ollama captures.** Blocked as the PLAN table says: vLLM's
  engine needs `AF_UNIX`, denied by the rig sandbox (retry off-sandbox);
  Ollama capture is step 1 on the rigs. Code refuses both with no
  dispatch until then.
- **Session-level refresh rig.** `providerOutputCap.test.ts` carries
  the pure-boundary regression; the turn-level proof needs main's
  removed M106 session rig (`modelApiLoopGuarantees.test.ts` stays
  deleted per the test overhaul).
- **`conversationController.test.ts` BYO block** (`remembers backend
model and effort updates`) is uncovered after accepting main's
  deletion of that mega-harness; needs a lead-owned harness or a new
  focused test.
- **SAST.** `security:sast` exits 2: the semgrep binary crashes at
  startup on this rig (`ca-certs: empty trust anchors`, OCaml conduit
  init) before scanning anything. No finding, no evasion — the tool
  never ran. Needs a working semgrep install.
- **Full `test:unit`.** The run aborts in `globalSetup`:
  `Review browser server exited before it started`
  (`test/unit/helpers/reviewBrowser.mjs:33`). Targeted suites all
  pass; the browser-dependent remainder needs the lead's environment.
- **Per-attempt pool admission (H-M95-EXEC).** M108's companion doc
  expects `execAccountRequest` before each send; this tree pins one
  account per headless run by design (D88.5), so multi-account dispatch
  stays unavailable until the profile broker lands.

## PROVM95 — provider records, rate limits, media, Azure (lane commits on ms/msm95)

Source of truth used: PR #202 (`research/claude-a`) is not fetchable
from this rig (no remote, no branch), so every value below comes from
the repo's own 2026-10-04 research (`docs/certification/m95-research.md`,
§1 with [O/AZ/X/D/G/M/T/F/H/Z] keys) and the recorded 2026-10-04
captures (`docs/certification/m95-captures.md` plus the frames). Where
that research is silent, no value was invented: the code reads the
provider's live answer and the capture that would settle it is listed
under Open below.

### Fixed rows (file and evidence)

- Catalogue freshness: `vendor/models-dev/snapshot.json` +
  `VENDOR.json` re-sealed from the live `models.dev/api.json` with the
  repo's own `scripts/sync-provider-catalog.mjs --sync --date 2026-10-17
--sha256 dae7c0c7…` (reviewed digest from `--fetch`, which writes
  nothing). Every record now resolves against 2026-10-17 lists, not the
  2026-10-05 snapshot. Fallout: one stale expectation
  (`ministral-3b-latest` 128000 → 131072), corroborated by Mistral's own
  captured list (`m95-captures/mistral`, `max_context_length: 131072`).
- Live-list fields the record reader ignored
  (`src/core/providers/modelMetadata.ts`, frames cited inline):
  Fireworks `supports_tools` → tools.calling and
  `supports_image_input` → image yes/no; DeepSeek `max_output_tokens`
  and `effort.supported_levels` → output cap and effort levels. Listed
  Fireworks/DeepSeek models no longer sit unknown where the live list
  answers.
- Rate-limit headers with their real meaning
  (`src/core/backends/modelapi/pacing.ts`, `transport.ts`,
  `src/core/providers/configured.ts`, `src/shared/usageJournal.ts`):
  OpenAI/Groq `x-ratelimit-{limit,remaining}-{requests,tokens}` with
  Go-duration resets (`120ms`…`1m26.4s`, captured values) as the
  window; xAI limits with no reset (default window); Anthropic
  `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}`
  with RFC 3339 resets as the window (token bucket is the all-tokens
  total); Azure `retry-after-ms` honored wherever `retry-after` is read
  (research §1.2 [AZ5]), standard header keeping precedence. The entry
  now supplies its own reader through the `pacingProvider` port
  (previously only Meta's reader existed and only Meta paths observed
  anything); presets with no captured limit headers keep live 429-pause
  behavior, and the journal stores `retry-after-ms`.
- Meta default off other providers' media
  (`src/core/backends/modelapi/mediaBudget.ts`): `assertMessageFits`
  threw Meta's 50-slot `documentsOverBudget` for every request; the slot
  throw now runs only for Meta (or with no record). A listed provider's
  fresh media rides to the provider, which answers for its own counts;
  replay elision still honors the recorded `maxCount`, and the
  pipeline's aggregate byte bound still applies to all.
- Azure requests (`src/core/providers/*`, `src/runtime/exec/*`,
  `src/host/models/modelsPanel.ts`): the wizard's deployment now
  persists on the entry (schema requires it for `azure`); records
  resolve by the ticked model family against the live catalogue;
  `wireModelFor` sends `model: <deployment>`; the list
  (`/openai/v1/models`) and Responses (`/openai/v1/responses`) paths sit
  below the entry's `/openai/v1` root on both the editor and exec sides
  (research §1.2 [AZ1, AZ3, AZ6]); the exec pin allows exactly those
  paths; terminal adds keep the `/openai/v1` address. Dispatch still
  refuses before send until Azure's own capture lands (rule 13,
  `wireCapture` stays false), proven by test.

### Tests (repo default 5 s timeout, `--maxWorkers=3`, no raised timeout)

- `providerPacing.test.ts` (new, 10 tests): captured header values
  through the real readers, duration/timestamp parsing, fail-closed
  cases, Azure ms precedence. Seen to fail (broken `s` unit fails the
  duration and Groq-window tests); reverted, 10 pass.
- `capabilityRecord.test.ts` +1 captured-rows test (Fireworks/DeepSeek
  frames through the real chat parser into evidence). Seen to fail twice
  (pre-fix missing `max_output_tokens`; reads-disabled drill); 37 pass.
- `mediaBudget.test.ts` +1 (51 fresh images with a BYO record ride
  through; without a record they throw). Seen to fail (gate forced on);
  reverted, 12 pass.
- `providersPresets.test.ts` +1 (`wireModelFor` deployment/family/
  missing). Seen to fail (broken passthrough); reverted, all pass.
- `providersX.test.ts` +1 Azure resolve (research path, pin allows the
  two `/openai/v1/*` paths and refuses `/v1/responses`). Failed first on
  a real bug (list allow-path missed the address prefix; fixed in
  `providerModelsPath`); 37 pass.
- `configuredProviders.test.ts` +1 (Azure row by family from the live
  catalogue; resolve refuses before send, send uncalled); 47 pass.
- Full `test:unit` stays BLOCKED on this rig (review-browser server in
  `globalSetup`, as recorded above); targeted suites above are green.

### Gates on the PROVM95 tree (exit codes)

`format:check` 0 · `lint` 0 (full repo, zero warnings) ·
`typecheck` 0 · `knip` 0 ·
`cycles` 0 · `duplication` 0 after removing 3 test clones of the new
code · `check:l10n` 0 · `check:reference` 0 · `check:plan` 0 ·
`check:roadmap` 0 · `check:host-api` 0 · `check:tokens` 0 ·
`check:badges` 0 · `npm run build` 0 (production + size + split
checks) · `security:audit` 0 (2 advisories, 1 exceptioned).
`security:sast` was not runnable here (see Open).

### Open (why, exactly)

- **PR #202 research rows.** The lane brief's (b)/(c)/(d) rows live in
  `docs/research/providers/*.md`, which exists on neither this rig nor
  any local branch. Everything above is grounded in the in-repo
  2026-10-04 research and captures instead; a lead with the PR branch
  should diff its rows against this record.
- **Groq per-day scope, xAI per-second scope, DeepSeek concurrency,
  Azure 1/10 s windows.** Named in the brief but neither the in-repo
  research nor the captures name them; the code reads the live headers
  and a capture naming them (a 429 sequence per provider) would settle
  each.
- **Azure live send.** Built and shape-proven against the documented
  API, but never sent: no Azure resource/key on this rig, and no paid
  calls allowed. Needs the owner's resource, which also produces the
  capture that lists Azure.
- **Anthropic per-request image count.** Research says "100 or 600 per
  request" without saying which; no `maxCount` was encoded. Needs the
  provider doc or a limit-reaching capture.
- **Non-image media caps and the 48 M-char pipeline bound.** The byte
  bound is the pipeline's own safety (constants say so), kept for all
  requests; per-provider byte totals are not in the research and were
  not encoded.
- **`security:sast`.** Not run on the final tree here (semgrep
  crashes on this rig, recorded above); the lead runs it off-sandbox.

## APP PROBLEMS

1. `npm run lint` fails on `temp/l10n-builds-*` scratch that the l10n
   gate leaves behind when a full `npm run quality` runs in-tree: the
   JS linter tries to parse the generated scratch as project sources.
   Workaround used: delete `temp/l10n-builds-*` before linting. The
   gate should ignore its own scratch or clean it up.
2. Full `test:unit` cannot start on this rig (review-browser server,
   above); targeted runs work because `globalSetup` only starts the
   browser for browser suites.
3. `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` crashes on
   this rig (above); unrelated to the tree.
4. `git worktree add main-now` refuses when another worktree already
   holds that branch; `--detach` works.
5. `$TMPDIR` resolved identically across calls here, but an early
   `node_modules` symlink attempt failed confusingly until the real
   path was pinned via `git worktree list`; prefer absolute pinned
   paths in multi-step shell work.
