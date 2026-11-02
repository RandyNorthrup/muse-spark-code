# RLF-WONDER — the wonder-id refusal (2026-11-02)

Fix lane on Muse Wonder Full, rig `macbook`, worktree
`/Users/user/lanes/RLF-WONDER`, branch `rec/rlf-wonder`. Base: `rv/int9`
at `72d8d5003` (RVINT9). The brief is RVINT9's open P3
(`docs/certification/rvint9.md`): a wonder id can be offered as a
standard Muse Code model. No Muse session was started, no paid or
live model call was made, and the vault and OS credential-store suites
were not run on this Mac (the recovery rules forbid them here; the
related run below excludes them by name).

## The fault, as read

`modelApiPaidTier` (`src/shared/paidBoundary.ts`) returns `'wonder'`
for exactly one id, `muse-wonder-1.0` (`MODEL_API_PRICED_MODELS.wonder`
in `src/shared/constants.ts`) — its verified Model API tariff ($4/$20
per million, `MODEL_API_PRICES_VERIFIED_ON` 2026-10-22). The team
registry (`src/core/team/teamModelRegistry.ts`) dropped a Muse Code
model only when that tier was `undefined`, so the one id whose tariff
is known to be Wonder slipped through and was offered on the
subscription; on the engine side every non-contributor tier was
labelled `'standard'`, so a Wonder offer also carried the standard
rates ($1.25/$4.25). No refusal existed when a pool named the id.
The recorded Muse Code 1.4.10 model list
(`test/fixtures/muse-contributor/model-list-1.4.10.json`) serves
`muse-wonder-1.0` as its default row, so the offer was reachable, not
theoretical.

## Where the refusal sits, and why

The tier rule (a request whose billed tier is not the one named is
never sent) gives three places, all in `1cf381971`:

- **The offer.** `buildTeamModelOffers` records a Wonder-tier Muse
  Code model absent with the new reason `'wonderTier'`
  (`TeamDiscoveryAbsence`), before the `capture` check, so it is
  never offered as a standard subscription model. The check is the
  exact whitelist (`isWonderTierModel` in the new leaf
  `src/shared/wonderTier.ts`, the same ids `modelApiPaidTier` calls
  `'wonder'`): `muse-wonder-full-1.0` and
  `muse-wonder-1.0-contributor` are different ids with their own
  standing and are untouched.
- **The two worker starts a pool can reach.** A saved pool can still
  name the id after the offer is gone, so both starts refuse in
  words before anything spawns or opens: `buildWorkerSessionConfig`
  (`src/core/team/workers/museCodeWorker.ts`, the Muse Code worker)
  and `acpSpawnArgs` (`src/core/team/workers/workerFence.ts`, every
  external ACP worker, whose billed tier for a Meta id is likewise
  not the standard Muse Code tier the entry implies). The sentence
  is `teamWonderTierRefused` in English and all 14 tables, read from
  `UI_TEXT` when the refusal is made: "{model} cannot run as a
  standard Muse Code model in a team: it is a Wonder model, priced
  at the Wonder tariff, not a standard Muse Code tier, so no request
  was sent for it."
- **The engine offer keeps the model, at its own tariff.** On the
  Model API backend the id is priced and stays offered; a Meta offer
  now carries `MODEL_API_PRICES_PER_MILLION[paidTier]` — Wonder at
  the Wonder rates — and a Meta model with no verified tariff
  carries no guessed rates. The ceiling deliberately keeps the
  standard row: Wonder's documented per-team limit is 3,000 RPM /
  4,000,000 TPM (dev.meta.ai, read by RLSDKMUSE 2026-10-22,
  `docs/certification/rlsdkmuse.md`), which is exactly
  `TEAM_META_STANDARD_RPM`/`TEAM_META_STANDARD_TPM`; the code comment
  says so.

Out of this lane's scope, on purpose: the person's own conversation
model on the Muse Code backend (the CLI serves `muse-wonder-1.0` as
its default and bills its own subscription), and headless teams,
where Muse Code and external workers never start at all. A stored
team document naming the id as its Muse Code lead is no longer
offered a fresh pick of it; the lead session itself is the
conversation-model case above.

## Proof

`test/unit/teamWonderTier.test.ts` (6 tests) runs the real registry
and both real worker starts: the recorded 1.4.10 list through
`modelListResultSchema`/`toModelSummary` (now shared as
`test/unit/helpers/recordedMuseCodeModels.ts`, `15ba6bd20`, after the
duplication gate found the loader cloned from
`museContributorModels.test.ts` — 1 clone, exit 1; 0 clones after),
the real `metaCapabilityRecord`, the real `ACP_PRESETS`, and the
published `MODEL_API_PRICES_PER_MILLION` rows. Nothing is stood in.

Red/green drills (each break on purpose, `npx vitest run
test/unit/teamWonderTier.test.ts --maxWorkers=3`, restored after):

- Registry `'wonderTier'` check disabled (`false &&`): exit 1, the
  "not offered as a standard Muse Code model" test fails.
- `buildWorkerSessionConfig` refusal disabled: exit 1, the "refused
  in words before a Muse Code worker session is built" test fails.
- `acpSpawnArgs` refusal disabled: exit 1, the "refused in words
  before an ACP worker spawns" test fails.
- Engine rates put back to the old non-contributor-means-standard
  labelling: exit 1, the "Wonder rates, never the standard ones"
  test fails.
- Restored: exit 0, 6 passed. With the neighbouring suites
  (`teamModelRegistry`, `acpPresetSwitches`): exit 0, 33 passed;
  after the shared-loader refactor (`teamWonderTier`,
  `museContributorModels`, `museCodeEfforts`): exit 0, 15 passed.
  Repository timeouts throughout; no `--testTimeout`.

Gates on this rig, each exit 0 unless named (dependencies first:
`npm install --ignore-scripts` restored the missing
`qrcode-generator` to `node_modules`; the lockfile is unchanged):
`prettier --check` and
`eslint --max-warnings 0` on every touched file; `npm run typecheck`
(all seven projects; `typecheck:unit` again after the refactor);
`node scripts/check-l10n.mjs` (exit 1 first — the desktop tables
were stale for the new key; `npm run desktop:l10n` regenerated
`desktop/crates/l10n/src/tables.rs` and `qml/UiText.qml`, then 0
problems); `npm run check:reference`; `npm run check:host-api`;
`npm run check:plan`; `npm run check:roadmap` (after
`npm run roadmap:generate`; the M96 entry text is unchanged and
`ROADMAP.md` regenerated byte-identical); `npm run check:catches`
(baseline unchanged); `npm run duplication` (0 clones after the
refactor above); `npm run cycles`; `npm run deadcode`.
`npm run build` exit 0: 184 bundles, every budget held, none raised,
legal scan 0 incomplete (the first attempt's exit 1 was this lane's
own colon-named scratch logs in the repository root failing the scan's
admission; removed, and the clean rerun is the record).
`npx vitest related` on the four changed logic sources — vault and
credential-store suites excluded by name under the Mac rule, and
`DEVELOPER_DIR` pointed at the Command Line Tools because this rig's
`xcode-select` names an `Xcode.app` without `xcodebuild` — selected
32 files: 369 passed, 59 skipped, 26 failed in 7 files
(`teamProcessWorkers`, `teamEnginePorts`, `teamWorkerChecks`,
`teamHostRealParts`, `teamLandingPause`, `teamLandingKilled`,
`execTeamSweep`). Every failure bottoms out in the rig's git fault
inside the product's scrubbed child environment, which does not
carry `DEVELOPER_DIR` (`git … exited with code 71: couldn't spawn
'/Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild'`),
plus the phase and timeout assertions downstream of it on a loaded
rig. The same file on the untouched base `72d8d5003`, in a clean
worktree under `$TMPDIR`, fails identically (`teamEnginePorts`: 5
failed, 10 passed, the same exit-71 git errors), so none of the
seven is this lane's regression; they need a rig whose
`xcode-select` resolves, or hosted CI. The suites this change
touches directly — `teamWonderTier`, `teamModelRegistry`,
`acpPresetSwitches`, `museContributorModels` — are green inside
that same related run.

## Still open

Nothing from the brief. Two boundaries were read and deliberately
left: the conversation/lead model on the Muse Code backend (the
CLI's own default and billing, above), and a future Wonder id not in
the verified whitelist, which the registry already refuses as
`capture` (unknown tier) on the Muse Code side and which carries no
guessed rates on the engine side. When Meta publishes such an id,
adding it to `MODEL_API_PRICED_MODELS.wonder` extends this refusal
to it with no further code.
