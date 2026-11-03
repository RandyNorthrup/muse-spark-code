# RLF-EMPTYCAT: a signed-in host that serves zero models is said, not obeyed (RSCH-MUSE-F)

Branch `rec/rlf-emptycat`, worktree `/Users/randy/lanes/RLF-EMPTYCAT`
(rig `macmini`), base `rv/int9` 72d8d5003. Built 2026-11-02 against
Muse Code CLI 1.4.14 (`1.4.14-R7309.1`) and `@muse-code/sdk` 1.4.12
(the tree's pin). Every capture below is recorded live with zero model
calls; every suite runs real code only, and `model/list` is never
mocked: the replay script answers with recorded bytes, and the live
suite drives the real CLI.

## The reproduction: the #115 shape is served for real

`muse serve` under a throwaway HOME+XDG (throwaway `HOME`,
`XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME`;
`MUSE_AUTH_PATH`, `META_API_KEY` and `TBH_CREDENTIAL_BACKEND` removed;
every proxy spelling at dead `127.0.0.1:9` — the RLF-MACCRED isolation)
answers `account/read` with `{"state":"loggedOut"}` and `model/list`
with `{"providerId":"meta","profileId":"tbh","source":"bundledCatalog","models":[]}`:
the meta-models/muse-code-sdk#115 shape, byte for byte. Frames:
`test/fixtures/muse-empty-catalogue/` (empty plus the healthy
four-model `providerCatalog` from the same binary, provenance in
`provenance.json`; captured 2026-11-02 via `node
temp/emptycat-capture.mjs`: initialize, account/read, model/list only).
The same skeleton was captured independently on CLI 1.4.11
(`test/fixtures/acphonest/model-list-1.4.11.json`, byte-identical), so
two CLIs and two lanes agree on the served shape.

States probed that do NOT serve it (all real `muse serve` 1.4.14 over
the SDK): `--provider echo` serves the full catalogue (echo changes
turns, not the list); a throwaway HOME alone still serves the signed-in
catalogue (the real config home answers through the Keychain — the
research note's Keychain correction); dead-proxy variables alone are
ignored (no fetch is attempted with a live sign-in); `--provider local`
refuses (`Local models are disabled`); `sandbox-exec` network denial is
blocked by the lane sandbox (`sandbox_apply: Operation not permitted`)
and was not pursued. The signed-in empty fault itself is Meta's
server-side failure and cannot be induced locally; the account state
differs (logged out here, signed in there) but the wire shape our
catalogue path must survive is identical, and the brief names the
logged-out throwaway-HOME state a real state.

Our behaviour on it, before the fix (code-read, then suite-proven):
`MuseCodeHost.listModels` returned `[]` and the controller replaced the
picker state unconditionally (`this.models = []`, `modelList` posted),
with no retention, no sentence, and no re-list — an empty picker as
truth and dead sessions with no remedy. The suite's red baseline shows
it: 4/5 fail pre-fix (`modelLists` is `[[]]`, one `model/list` call and
no more). Also measured on the empty serve: `session/start`,
`session/setModel` and `turn/start` all succeed over MSP against the
empty catalogue — the refusal reporters see arrives later, not in these
answers — and our tree carries no "lack access" sentence (grep-verified),
so nothing of ours infers lost access from the empty list.

## The fix

- `src/core/backends/musecode/emptyCatalogue.ts` (new): the pure
  decision (`isEmptyCatalogueEpisode`: zero served rows, Muse Code
  backend, signed in — a logged-out empty is the expected logged-out
  state and stays with the sign-in screen) and the waits
  (`emptyCatalogueRetryDelayMs` through the shared `retryDelayMs` on
  `META_DOCUMENTED_RETRY_LIMITS`: 500 ms doubling with jitter;
  `emptyCatalogueMaxRetries` is 4, inside Meta's documented 3–5
  attempts).
- `src/core/backends/musecode/MuseCodeHost.ts`: `modelListResultSchema`
  reads the served `source` (loose, older hosts omit it), and an empty
  serve is logged with its wire-word source for every consumer.
- `src/host/conversation/conversationController.ts`: on an episode the
  last good rows stay on display (re-posted through the same
  confidential filter; nothing posts when none exist yet), one sentence
  says Meta's list came back empty and is asked again
  (`metaCatalogueEmptyRetrying`, English plus all 14 tables), and one
  bounded burst asks again (five listings, then it stops with the
  sentence staying). Any later listing that finds the list back ends
  the episode and posts it — recovery without a restart, including
  after the burst is spent. The episode belongs to its backend
  generation (`forgetModels` ends it); only an account boundary
  (sign-out, an ending conversation) clears the last good rows.
- No new setting: the burst's bounds are Meta's documented ones (the
  standing Limits rule prefers the provider's own), and `Retry-After`
  has no MSP carrier, so the shared policy's `suggestedMs` stays
  empty by construction.

## Suites

`test/unit/museEmptyCatalogue.test.ts` (7 tests): the live suite
re-drives the isolated serve wherever the CLI is installed (skipped
with its reason elsewhere); four panel suites run the real controller
and a real host over the SDK's real Connection fed with the recorded
frames (sentence once and only, no empty post, burst waits exactly
`[500, 1000, 2000, 4000]`, last-good re-post, recovery on the first
retry, recovery after the burst); two suites pin the decision matrix
and the delay bounds including the 8 s ceiling. Red/green drills, each
broken on purpose, shown red, restored, green:

- Drill 1 (decision): `signedIn` negated in `isEmptyCatalogueEpisode` —
  5 failed, 2 passed (vitest exit non-zero); restored.
- Drill 2 (sentence): the notice pointed at `UI_TEXT.surfaceClosed` —
  exit 1, 2 failed, 5 passed; the drill showed the recovery tests
  pinned only the notice count, so all four now pin the sentence text;
  restored.
- Drill 3 (retention): the episode path returns instead of falling
  through to the last good rows — exit 1, exactly `keeps the last good
catalogue for display when the list empties` fails; restored.
- Final: 7/7 green, vitest exit 0.

Related suites: `vitest related` for the helper (20 files, 131 passed,
1 unrelated GitHub-lease timeout under parallel load — green alone on
this tree and on base 72d8d5003, measured), for `MuseCodeHost.ts` (43
files, 326 passed, 1 unrelated ACP-update poll starvation under load —
green alone on both trees), for the controller (20 files, 130 passed, 2
unrelated git-panel timeouts under load — green alone on both trees),
for the panel rig (17 files, 117 passed, exit 0). Focused re-runs of
the behaviourally adjacent suites (autoResend, contributorModels,
lifecycle, efforts, dispose, sessionDelete, latest, nativeReaders,
resumedModel) are all green. `related` on `en.ts` was not run locally:
its blast radius is the whole unit battery (common.md), the change is
one additive key validated by `check:l10n`, and hosted CI runs the
battery.

## Gates

`check:catches` exit 0 (the two new sites classify NARROW and REPORTED
as designed); `duplication` exit 0 after sharing the real-CLI
resolution between the shutdown and empty-catalogue suites, typing the
rig's catalogue options off the controller deps, and unifying the test
openings and sentence assertions; `cycles` exit 0; `deadcode` exit 0;
`check:l10n` exit 0 (desktop tables regenerated); `check:reference`
exit 0; `check:host-api` exit 0; `build` exit 0, every budget holds;
`typecheck` exit 0; prettier and eslint clean on every touched file.
`check:plan` / `check:roadmap` exit 0 after the records below.

## Open follow-ups (for the lead, not this lane)

- ACP and headless session opens refuse honestly already
  (`acpNoModels` is true of the served evidence, not access language)
  and recover on the next open, but run no burst; a burst inside a
  synchronous editor RPC is a latency decision this lane did not take.
- A durable (restart-spanning) last-good catalogue would need stored
  rows and a staleness policy — a PLAN design item, not taken here.
