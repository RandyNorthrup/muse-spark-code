# GRVFIXC — Grok review findings on the 0.19.0 join (GRV0190)

Linux rig `linuxlt`, branch `fix/0190-grvfixc`, base `d13baec652`
(the final release tree). No paid or live model calls. No pushes,
rebases, merges or tags. Temporary files only in gitignored `temp/`.

Trailer note: the first four commits below carry
`Co-Authored-By: GPT Sol 6.1 (Codex CLI) <noreply@openai.com>`; the
engine on this lane is Muse, whose trailer per `~/lanes/_ctx/codex/common.md`
is `Co-Authored-By: Muse Spark (contributor) via Muse Code` (used from the
fifth commit on). The lead may want the first four messages amended on
integration.

## 1. Vault Windows claims contradicted the code (`d3953af7e4`)

Finding: `CHANGELOG.md` `[0.19.0]` said both `Windows still waits on the
pipe helper` (line 230) and `Windows gets a working vault client and
broker: pipe and slot helpers built at first use` (line 614). The code is
the second (`src/runtime/vault/windowsClientPlatform.ts:37-63`: both
helpers compile on the person's own machine at first vault use).
`docs/release-notes/0.19.0.md:218` said it `stays switched off until the
integration lands`.

Cause: the Added bullet was written before the Windows client landed;
the Fixed bullet recorded the landing without updating it.

Fix: the Added bullet now ends `On Windows the pipe and slot helpers
build at first use.` The release notes say the integration landed on
Linux and macOS (panel section, Vault command, Lock) with the same
Windows first-use sentence. Proof: full `npm run build` green (its
`check-bundle-size` gate included); `dist/whatsNew.json` regenerates
from CHANGELOG at 21,011 encoded bytes of the 40 KiB budget, inside the
writer's 76,800 decoded-bytes bound with no refusal.

## 2. Stale decision numbers after the join renumbering (`839f4f9315`)

Finding: README cited D123 for per-platform packages (packaging is now
D209/D210; D123 is `the provider judges a key`); two scripts called D207
`D119`; the reference script called the CLI help table `D119` (it is
D120). PLAN.md §2 is the truth: D119 is three-valued reads, D120 the
terminal agent's per-command docs, D121 limits only on models, D123 the
provider judging a key, D207 worded failures (keeps kind with cause),
D208 spending checks, D209 one .vsix per platform, D210 one package per
platform target.

Cause: D207/D208/D209/D210 were numbered D119/D121/D123 until the
0.19.0 join; comments written under the old numbers were only partly
re-pointed (the join shifted a few sites' identity windows).

Fix, after reading every `D119`/`D121`/`D123` reference in `src`,
`scripts`, `docs`, `README.md`, `test` and `l10n` against the decision
each describes:

- D123 → D209 (README `package` row, VSIX budget line), D123 → D210
  (README `package:acp` row). Remaining D123 cites (pasted-key shape
  checks, key confirm/question tests, provider-key-shapes record) mean
  key judgment: kept.
- D119 → D207 (13 sites): the estimator's worded refusal
  (`scripts/lib/webviewBundles.mjs`), the Copilot adapter failure
  (`scripts/lib/deferredBundles.mjs`, `copilotFailure.ts`,
  `subscriptionsEntry.ts`), `keeps its kind` / `cause stays on the
error` catches (`registry.ts` ×2, `copilotClient.ts`,
  `accountSecrets.ts` ×3, `accountStoreError.ts`, vault `crypto.ts`,
  `migrate.ts`, `backup.ts`, `estimator/prices.ts`) and the ACP
  estimate boundary test.
- D119 → D120 (13 sites): the terminal help table
  (`scripts/lib/reference.mjs`, `cliHelp.ts` ×2, `en.ts` help block,
  `sharingFlags.ts`), usage refusals and the secret-echo rule
  (`cliArgs.ts` ×4: parser refusals, `providers models` ×2), the
  `providers models` command, forced-add reasons (`providersFile.ts`,
  `providersModelsCommand.ts`) and the two CLI-help tests.
- Kept as D119: three-valued reads (`credentialRead.ts`, provider JSON
  and model-list reads, lock-race/journal reads) and the D119-named
  catch burn-down family (burn-down docs, catch-money history,
  `D119 catch burn-down` tests). Kept as D121: every no-limit-of-ours
  cite (output/round/repeat/trim/deadline/size/count/budget ceilings,
  person-set budgets). No D121-meant-D208 or D123-meant-otherwise
  found; `l10n/` carries no D-cites.

Suites: `cliHelp` + `providersModels` + `acpEstimate` (59 tests) green;
`npm run check:reference` green (below).

## 3. Dead capabilityRecord split exemption (`02b3a563d0`)

Finding: `scripts/check-bundle-split.mjs:1242-1250` and
`scripts/lib/deferredBundles.mjs:1177-1184` exempted the capability
record from the extension/modelApi bundles for the image path.

Cause: BUNDLE525 made the exemption unnecessary:
`src/core/backends/modelapi/imageGeneration.ts:36` imports only the
record _type_ (erased at build) and line 88 loads providers through a
lazy `await import('../../../host/backend/providersEntry')`.

Fix: both exemption blocks removed (16 lines). Proof: full
`npm run build` green on the final tree — its `check-bundle-size` and
`check-bundle-split` gates pass with no exemption, so a static record
import would now fail the gate instead of hiding behind it.

## 4. SECURITY redirect deadline that no longer exists (`5fd77f171b`)

Finding: `SECURITY.md:494` said same-host redirects re-check `until the
fetch's deadline (30 seconds)`.

Cause: webFetch carries no deadline of ours
(`src/core/web/webFetch.ts:930`: `D121: no deadline of ours — the page
answers, or Stop ends the wait`, with a still-waiting notice).

Fix: the sentence now says the hops re-check with no deadline of ours —
the fetch waits until the page answers or Stop ends the wait, saying how
long it has waited. The 5 MiB buffer-window sentence is unchanged.

## 5. Stand-in casts drive the real product objects (`4a57a67a3f`, `8253a5aada`)

Finding: `checkpointStorageGuard.test.ts:29-31` cast a partial object
`as unknown as ToolIo`; `reviewedApprovals.test.ts` and
`hookModelTurns.test.ts` cast partials `as unknown as AgentHost` /
`AgentSession`.

Cause: hand-written fakes where the product's own headless
constructions exist: `test/unit/helpers/headlessToolIo.ts` (the
runtime's own `createToolIo` wiring), `createCheckpointPort` (the
product's port factory, whose unknown-namespace failure is real), the
real `MuseCodeHost`/`MuseSession` over the SDK's real `Connection`
(the `approvalModesFailurePaths` precedent: replay transport serving
the recorded 1.4.7 `serve --provider echo` capture,
`test/fixtures/m106/msp-1.4.7-approval-modes.json`, zero model calls).

Fix:

- `checkpointStorageGuard.test.ts`: `headlessToolIo(root)` in a real
  temp dir; the port is the real `createCheckpointPort` with
  `store: undefined`, wrapped only by a recording forwarder for the
  marks. Unknown namespace fails the open mark with the product's own
  native-unsafe error (tests 1–2: refusal carries it as the cause, the
  close mark is attempted either way — test 2 forces the close to fail
  too through the port's own availability callback, proving the open
  failure is never masked); known namespace lets the open mark succeed
  so the thrown run guard returns the refused entry (test 3).
- New `test/unit/helpers/museReplay.ts`: capture load, minimal replay
  transport (scripted answers serve recorded frames; anything else is
  refused loudly, never invented), `startLiveHost`/`startLiveSession`
  building the real host and session. Refusal messages may carry a
  `/secret/path` marker so the tests prove kind-only logging.
- `reviewedApprovals.test.ts`: real reviewer, real hosts, real
  sessions. A refused `session/start` leaves the card with
  `autoReviewerFailed` by kind only; a refused `turn/start` does the
  same through the ask path; an `approval/decide` refused with the
  settled kind (`approvalAlreadyResolved`, the product's own settled
  vocabulary) maps to a real `PromptSettledError` and is logged as the
  host's news, never the message.
- `hookModelTurns.test.ts`: a pre-aborted turn ends silently with the
  wire itself proving `session/start` was never sent; a refused start
  warns once by kind; a refused send plus refused cancel warns twice by
  kind and the session is let go (host `sessionCount` returns to 0); a
  hung send lets the queue drop the aborted turn with no `in its
queue` line.
- `wizardSave.test.ts` (sweep): the credentials fake is now the real
  `ProviderCredentialStore` over the product's headless
  `memorySecretStoreFor` map — reads find nothing, writes fail with
  the product's real `execTrustRefused` refusal, which the step report
  carries.
- `reviewBundle.test.ts` (sweep): both tests load through the
  product's own `requireFile` default — a missing file fails with the
  real `MODULE_NOT_FOUND` (stronger path-leak proof), a real temp
  `.cjs` file fails the shape check. The hand-thrown loader error and
  the fake `{}` module are gone.

Break proofs (each shown failing, then reverted; no product diff
remains): guard close skipped the close mark (1 fail); approvals
settled branch dropped `isPromptSettledError` (1 fail); hook `drop`
skipped `session.dispose()` (1 fail — an earlier break of the outer
aborted-turn guard passed anyway through the inner guards, so the
dispose break is the recorded one); wizard notice dropped the detail
(1 fail); review-bundle load catch rethrew raw (1 fail). All suites
green after each revert.

Sweep accounting — every remaining `as unknown as` in `test/` was
read; retained only where no real construction exists headless:

- `reviewedApprovals.test.ts` `approvalEvent()`: outside-world input
  stimulus (the approval request event), not a system; cases only read
  identifying fields.
- `reviewBundle.test.ts` `editReview: {}`: slot the refused load
  never reaches; the editor surface is unbuildable headless.
- `memoryCommands.test.ts` store: failure injection beneath a real
  store that never rejects there (`MemoryStore.availableScopes`
  absorbs failures into `Located` and filters); the exercised unit is
  `showMemory`'s catch mapping, and the other deps members are window
  UI unreachable headless.
- `conversationGitBundle.test.ts` window features: the file itself
  notes no harness builds the whole window; single pass-through
  assertion.
- `vaultCatchCauses.test.ts` `null` port: the port is never reached
  (the parse fails first); explicit absence, not an answer.
- `cdpPipeSend.test.ts`: a real `EventEmitter` plus a genuinely
  broken fd; the failure is the OS's `EBADF`.
- `hookUncappedEstimates.test.ts`, `acpResources.test.ts`,
  `vaultHeadlessDeny.test.ts`: plain input-data casts (wire body,
  status value, kind literal) for pure functions, never systems.

Suites (repo timeout, `--maxWorkers=3`): checkpointStorageGuard 3/3,
reviewedApprovals 3/3, hookModelTurns 4/4, wizardSave 2/2,
reviewBundle 2/2, cliHelp+providersModels+acpEstimate 59/59,
approvalModesFailurePaths untouched-behavior 5/5 after its refactor
below (12/12 with the review and hook-model suites).

Duplication gate (threshold 0, tree was at zero): the first version of
the helper cloned `approvalModesFailurePaths`' ReplayWire (4 clones)
and the twin refused-review tests cloned each other (2). Fixed at the
cause in `9c82d808c8`: one shared `ReplayWire` in `museReplay.ts`
(with the nonce echo and broadcast release the approval-modes tests
need); that suite's `liveSession` delegates to `startLiveSession` and
its teardown to `closeLiveHosts` (no behavior change — its 5 tests
green unmodified); the twin review tests share one runner.
`npm run duplication` exit 0, 0 clones.

## Gates on the final tree

- `npm run build` (production + size + split + globals + notices +
  legal): exit 0.
- `npm run typecheck` (all five projects): exit 0, no errors anywhere.
- `eslint --max-warnings=0` on every touched lintable file: exit 0
  (markdown files are not linted; the hook also runs it per commit).
- `prettier --check` on every touched file: clean.
- `npm run check:reference`: exit 0 (83 features, 65 commands, 101
  settings, 32 slash, 307 CLI).
- `npm run check:l10n`: exit 0 (14 UI + 14 usage tables, 0 problems).
- `npm run deadcode`: exit 0. `npm run cycles`: exit 0, no circular
  dependencies. `npm run duplication`: exit 0, 0 clones (threshold 0).
- `npm run check:host-api`: exit 0, 0 problems.
  `npm run check:plan`: exit 0, 0 drift.
- `security:sast` (533 rules, 3960 files): exit 0, 0 findings.
- `security:audit`: exit 0 (2 advisories under the standing exception).
