# Provider key shapes: no key is refused for its looks (lane PROVKEYS)

## RED (2026-10-12, packed 0.18.1 product on the kubuntu rig)

Built with `npm run build`, then ran the production bundles directly
(`node dist/acp.js`, the same files `scripts/package-acp.mjs` ships;
the tar step itself needs the macOS-only `native/darwin/muse-dictate`
binary, which does not exist on a Linux rig) under a fresh empty `HOME`.

Each row: `printf '%s' 'RED-MADEUP-KEY-0001-NO-PREFIX' | providers add
--preset <id> --model redmodel --key-stdin`. The made-up key matches no
frozen prefix on purpose (it contains no `sk-`, `xai-`, `AIza`,
`sk-or-`, `gsk_`, `fw_`, `hf_` or hex-dot shape). Exit code 1 everywhere.

| Preset      | Person is told (before fix)                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| openai      | That key is not shaped like OpenAI keys (Key beginning with sk-… (platform.openai.com)).                                |
| xai         | That key is not shaped like xAI keys (Key beginning with xai-… (console.x.ai)).                                         |
| anthropic   | That key is not shaped like Anthropic keys (Key beginning with sk-ant-… (console.anthropic.com)).                       |
| gemini      | That key is not shaped like Google Gemini keys (Key beginning with AIza… (AI Studio)).                                  |
| openrouter  | That key is not shaped like OpenRouter keys (Key beginning with sk-or-… (openrouter.ai) or Connect OpenRouter account). |
| groq        | That key is not shaped like Groq keys (Key beginning with gsk_… (console.groq.com)).                                    |
| deepseek    | That key is not shaped like DeepSeek keys (Key beginning with sk-… (platform.deepseek.com)).                            |
| fireworks   | That key is not shaped like Fireworks keys (Key beginning with fw_… (fireworks.ai)).                                    |
| huggingface | That key is not shaped like Hugging Face keys (Key beginning with hf_… (huggingface.co)).                               |
| zai         | That key is not shaped like Z.ai keys (The key from Z.ai).                                                              |
| mistral     | Test failed: HTTP 401 (shape `any`: the key goes to the provider, which refuses it)                                     |
| together    | Test failed: HTTP 401 (shape `any`: the key goes to the provider, which refuses it)                                     |

The Gemini row is the released defect: a working key beginning `AQ.`
is refused before anything is sent, so the route cannot be set up at all.

## GREEN (2026-10-12, packed branch build on the macmini rig)

Built with `npm run build` (green, including the bundle-size pins) from
this branch, then ran `node dist/acp.js` under a fresh empty `HOME`
(`$TMPDIR/provkeys-green-home`), the same bundles the red run used.
Re-verified on the final tree after the `keyInspection` split
(continuation session, fresh `HOME` `$TMPDIR/provkeys-green2`, fresh
build 19:30, `dist/extension.js` 550.8 KiB of a 600 KiB budget): the
custom closed-port run below exited 1 with the connection truth, and
the URL run exited 1 with the question plus the connection truth —
byte-identical wording to the first green run.

### The class, end to end: a key with no frozen prefix is sent

`printf '%s' 'GREEN-MADEUP-KEY-0001-NO-PREFIX' | providers add --preset
custom --as green --address http://127.0.0.1:9/v1 --private-ok --format
chat --model greenmodel --key-stdin` (the made-up key matches no frozen
prefix on purpose). Exit code 1 with:

> Test failed: The provider could not be reached.

No shape complaint: the key was accepted for sending and the person is
told the truth — the closed port refused the connection. A second run
with a wrong-thing value (`https://example.com/not-a-key`) asks the
question instead of dead-ending, then tells the same truth:

> This looks like a web address, not a key. Use it anyway?
> Test failed: The provider could not be reached.

(stdin cannot answer, so the run continues to the test.)

### Fixed presets on this rig: blocked before the key, never by its shape

Each red-table row rerun with the green key
(`providers add --preset <id> --model greenmodel --key-stdin`) answers,
for all of openai, xai, anthropic, gemini, openrouter, groq, deepseek,
fireworks, huggingface, zai, mistral and together:

> That address cannot be used (unresolved-address).

This sandbox has no DNS, so `resolveHost` returns no answers and the
endpoint policy (`src/core/providers/endpointPolicy.ts`, `checkEndpointUrl`)
refuses the address in `checkAddAddress` — before the key is read. It is
an environment block, not product behaviour, and it names no key shape:
nothing on these rows refuses the key. Per-preset acceptance is proven
through the real module instead (`test/unit/providerKeyInspect.test.ts`,
`test/unit/providersPresets.test.ts`: every keyed preset sends the
`AQ.`-shaped and the wrong-for-all keys), and the real-life run replays
these rows with real keys on a networked machine afterwards (Gemini
first). On a networked rig the key test reaches the provider, so a
made-up key there ends in the provider's own 401, as mistral/together
already showed in red.

### The field (read 2026-10-12; nobody refuses a key by its looks)

- aider `aider/args.py:104-113`: `--api-key PROVIDER=KEY` is a plain
  string argument stored as the environment variable verbatim, and
  `aider/models.py` never inspects a key's shape — keys ride the
  environment into litellm and failures are provider HTTP errors.
- Continue `core/llm/index.ts:260` (`this.apiKey = options.apiKey`,
  no validation) into `core/llm/llms/OpenAI.ts:376-377,680-681,726-728`,
  straight into the `Authorization`/`x-api-key` headers; a wrong key
  fails at the provider's response.
- Codex CLI `codex-rs/core/src/client.rs:522-526`
  (`api_auth.add_auth_headers(&mut headers)`): the stored key material
  is attached per request with no shape gate in the request path
  (comment at :520: "API-key sessions send that API bearer").

### KEYTEXT: a piped key that is not text is told so (2026-10-14, wslpc rig)

PR 159's review found one sentence false for its cause: `providerExec`
mapped a failed `--key-stdin` read with reason `invalid` (bytes that are
not UTF-8 text) to `providerKeyNotStored`, "No key was entered, so
nothing was stored." — but the person did enter something. The audit of
every stdin key reader showed, before the fix:

| Surface                                   | tty                                         | empty                                        | invalid                                                            | tooLong                           |
| ----------------------------------------- | ------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| `exec` provider run (`providerExec.ts`)   | "Read the key from a pipe, not a terminal." | "No key was entered, so nothing was stored." | "No key was entered, so nothing was stored." (false)               | "The key exceeds the byte limit." |
| `providers add` (`providersCommands.ts`)  | n/a (typed text is the normal path)         | "No key was entered, so nothing was stored." | accepted as U+FFFD replacement characters and sent to the key test | n/a (reader unbounded)            |
| `auth set --provider` (`authCommands.ts`) | n/a                                         | "No key was entered, so nothing was stored." | accepted as U+FFFD, same as above                                  | n/a                               |

After the fix, `invalid` reads the one new string `providerKeyNotText`
("That input is not text (it is not valid UTF-8), so it was not used.",
translated in all 14 `l10n/ui.*.json` tables) on every surface; the
other three reasons keep their sentences. The mapping lives once, as
`providerKeyFailureText` beside `readProviderKeyLine`
(`src/runtime/exec/keyInput.ts`), called from all four readers (the
third plus the account key flow in `accountsCommand.ts`); the piped
secret reader (`src/runtime/hiddenInput.ts`) now refuses non-UTF-8
pipes instead of decoding them with replacement. The Meta key keeps its
existing sentence for the same bytes (`apiKeyInvalid`, unchanged).

Packed-product drill (`npm run build` green, `node dist/acp.js` under a
fresh empty HOME): `printf '\xff\xfe' | providers add --preset custom
--as keytext --address http://127.0.0.1:9/v1 --private-ok --format chat
--model m --key-stdin` answered before with "Test failed: The provider
could not be reached." (exit 1; the bytes rode the key test as
replacement characters) and answers now with "That input is not text
(it is not valid UTF-8), so it was not used." (exit 1, no network).
A text control (`AFTER-MADEUP-KEY-0001`) still reaches the key test and
its connection truth. The brief's `--preset groq` form stops at "That
address cannot be used (unresolved-address)." before and after on this
rig (no DNS here; the key is never read), as in the PROVKEYS green run.

### Prefix-guessing: nowhere to keep

Step 3 allowed keeping a prefix only as an overridable suggestion where
the product guesses a provider from a pasted key. There is no such
place: keys are always entered against an already-chosen preset (panel
password box, `providers add --preset`, `auth set --provider`), and no
code maps a key prefix to a provider (searched `startsWith('sk`,
`'AIza`, `'gsk`, `'xai`, `guessProvider`, `providerForKey`,
`keyToProvider`: no hits). Nothing to keep.

### The removed frozen shapes (for the lead's inventory)

`src/core/providers/presets.ts` before the fix (commit `71bd40fce~1`):
openai prefix `sk-`/20 (line 315), xai `xai-`/20 (366), anthropic
`sk-ant-`/20 (394), gemini `AIza`/30 (420), openrouter `sk-or-`/20
(443), groq `gsk_`/20 (473), deepseek `sk-`/20 (498), fireworks `fw_`/20
(619), huggingface `hf_`/10 (649), zai 32-hex `.` 16-hex (675); plus
length-only gates azure/mistral/together any/16 (341, 527, 594). Every
preset now carries `{ kind: 'any' }`, and every `keyHint` names where
the key comes from (`The key from {site}`), never a shape.

### Step 5: the rest of the frozen-shape audit

Checked and left alone, with the reason:

- `src/core/providers/modelRef.ts:11` (`PROVIDER_ID_PATTERN`,
  `^[a-z][a-z0-9-]{0,31}$`): our own local entry namespace (`--as`,
  `<provider>/` refs), not a provider-minted value; model ids
  themselves are `^\S+$` (line 16), so OpenRouter `author/slug` ids
  pass. No provider value refused.
- `checkEndpointUrl` (`src/core/providers/endpointPolicy.ts`): the
  endpoint policy that keeps keys from being sent to other hosts —
  explicitly out of scope, untouched.
- `src/shared/redact.ts:216-217` (`AIza…` etc.): log scrubbing must
  keep matching real-world shapes to keep keys out of logs; untouched.
- `isValidModelApiKey` (`LLM_`): our own Meta credential, defined by
  the product — outside the provider-key class; untouched.
- No provider-key environment-variable or key-file intake exists
  (keys enter via stdin/password box into the credential store), so
  there is no shape check to remove on those surfaces.
- Observed adjacent quirk, pre-existing and unchanged: `auth set
--provider <id>` without `--account` takes the Meta-key path
  (`src/runtime/main.ts` `authSet` case reads `command.target`, which
  only `--account` sets); the advertised provider form is
  `auth set --provider <id> --account <id>`
  (`test/unit/cx1r4Truth.test.ts:87`). Not shape-based, out of scope.

### Panel look: the new modal and password-box behaviour (pending)

The interface change on this branch is two native VS Code surfaces, not
webview: `promptForProviderKey` (`src/host/providers/keyPrompt.ts`)
opens the password box, which now accepts any non-blank key, and
`confirmKeyUse` (`src/host/models/modelsPanelEntry.ts:302`) asks the
wrong-thing question (`This looks like a web address, not a key. Use it
anyway?` and its three siblings) as a modal warning; answering "no"
re-opens the box. No pictures were taken on the wslpc rig: it has no
Chrome (`scripts/lib/chrome.mjs` `findChrome()` returns undefined, and
the Playwright cache holds only Firefox/ffmpeg), and the webview
harness cannot render native dialogs anyway. The lead's one small local
look, on the packed product in one light and one dark theme: open the
Models panel, start a keyed provider's setup, type a URL (for example
`https://not-a-key.example/v1`) into the password box, and observe the
modal question with Continue/Cancel; answer Cancel and observe the box
re-open; answer Continue and observe the run continue to the free key
test, which refuses with the provider's reason.

### Continuation verification (2026-10-12 evening, macmini, rig load ~8)

Final tree (after the `keyInspection` split): `tsc` host and unit
clean; ESLint on the three changed sources clean; Prettier clean
(one fix: the re-export block in `presets.ts`); `check:l10n`
0 problems; `check:reference` current; `deadcode` (knip) clean;
`cycles` none; `jscpd` 0 clones; `security:audit` 2 advisories
with 1 exception (unchanged); `npm run build` green with
`check-bundle-size` all ok; l10n pack diag `equal=true` all 14.

Unit suites at the repo default timeout: the pure-logic
`providerKeyInspect` (9), `providersPresets`/`providersFlow`/`m95Strings`
(52), `providersL10n`/`providerKeyPrompt` (22), `modelsQuickPick` (8),
`execKeyInput`/`providerWiring`/`planKeyPresets` (41), `providerRetry`,
`modelApiPrefix`/`modelCapabilitiesBinding` (48),
`modelApiGoldenRequests`/`m106CaptureFixtures`/`responsesCodec` (202),
`evalRunner`/`reasoningResolver` (53) — all green. Slow suites
(`execProvider`, `providersXFix`, `execRun`, `modelApiHost`) time out
at 5 s on this loaded rig because transforming the host-backend
import graph takes 19–52 s (measured); all pass with an exploratory
raised timeout except the two cases below (exploratory only — the
final run uses the repo default).

Left for the lead per the owner's 2026-10-12 testing rules (stand-in
tests are never repaired by a lane):

- `test/unit/providersX.test.ts` "refuses an unknown preset, a repeat
  and a missing key": the old bad-shape sub-case (exit 1 for key
  `'wrong-shape'` on groq, the pre-PROVKEYS contract) was deleted in
  `a4125641c`, not repaired through the stand-in, per the owner's
  2026-10-12 testing rules; the real-module coverage is
  `test/unit/providerKeyInspect.test.ts`. The renamed test passes on
  the final tree: 34 passed at the repo default timeout (lane PRFIX159,
  wslpc rig, load ~3.5).
- `test/unit/execProvider.test.ts`, `providerKeyPrompt.test.ts`,
  `modelsQuickPick.test.ts` contain stand-ins and were repaired by the
  earlier session before the owner's rules arrived; kept, disclosed.
- `test/unit/modelApiHost.test.ts` "sends no reviewer while host close
  awaits SessionEnd after a held consent" (M78, Meta-model path, no
  provider-key code in it): fails here (`vi.waitFor` never sees
  `approvalRequested`) and fails IDENTICALLY on the untouched base
  `e763f4938` in the same conditions (base worktree
  `$TMPDIR/provkeys-main`, same AssertionError). Pre-existing,
  unrelated to this lane.
- `npm run security:sast` cannot run in this sandbox: semgrep dies
  with `PermissionError: [Errno 1] Operation not permitted:
'/Users/randy/.semgrep/semgrep.log'`. No workaround attempted.
- `test/e2e/execStdio.e2e.test.ts` on the final tree: 14 passed,
  32 skipped; the `M80 D package guards` block never runs here — its
  `beforeAll` (tarball staging via `package-acp.mjs`) exceeds the 60 s
  hook timeout on this loaded rig. Measured on the untouched base
  `e763f4938` in the same conditions (base worktree
  `$TMPDIR/provkeys-main`): identical — same 60 s hook timeout, same
  14 passed / 32 skipped. Fails on base too; pre-existing and
  unrelated (this lane adds no packaged file or bundle entry).

### RVPR159RED review: merged with main, red checks fixed at their causes (2026-10-17, macmini rig)

PR #159 stood red: the build on all three systems and the checks behind
it. Merged main `81dacaf5a` first (`f8b4c8856`), keeping both sides:
main's test-overhaul deletions stand (this lane's edits to
`execProvider`, `providerKeyPrompt`, `modelsQuickPick`, `providersX`
and `helpers/m95kFixtures` were edits to stand-in suites main deleted;
the disclosure at "Left for the lead" above is superseded — those files
are gone, not kept), the shape-free keys stand, and this lane's
decision is renumbered **D123** (main's D108 is the test overhaul; the
hashed archive body is unchanged, `plan:archive status`: 54 blocks, all
intact).

Measured red causes on the merged tree, each fixed and committed
separately:

1. `npm run build` failed at `check-bundle-split` (4 problems):
   `providersHost` imported `inspectProviderKey` through `presets`,
   dragging the whole presets module into `dist/modelsPanel.js`. The
   same import and the same split rule exist at the branch's base, so
   the unqualified "`npm run build` green" claims above could not have
   held for the full build; only the bundle-size step they name was
   green. Fixed in `c50b2061d`: the panel reads the small
   `keyInspection` module directly (the split this lane made for
   exactly that reader), declared for `dist/modelsPanel.js` in both
   split checks beside the existing narrow declarations. Gate-fire
   evidence: the same check reported the 4 problems before the fix and
   0 after; the modelsPanel metafile no longer lists `presets.ts`.
2. Behind it, the build failed at the lazy registry:
   `readProviderKeyLine` no longer loads `providersEntry` (it needed
   it only for the removed shape check), so the generated registry was
   stale by that one importer row. Regenerated in `efe078de7`;
   `npm run build` is then green end to end.
3. `check:host-api` failed: `keyPrompt.ts` no longer reads
   `InputBoxOptions.validateInput`. Regenerated and reviewed in
   `f3e8d9d7a` (only that row and the file's count, 6 to 5).

Re-run on the merged tree, repo default timeouts: typecheck (all five
projects), lint, format, `check:l10n`, `check:reference`,
`check:host-api`, `check:plan`, `check:roadmap`, `check:badges`,
`check:tokens`, deadcode, cycles, duplication and `security:audit`
green; unit suites covering the changed modules green
(`providerKeyInspect`, `execProviderNotice`, `execKeyInput`,
`providersPresets`, `providersFlow`, `providersL10n`, `m95Strings`,
`accountsCommand`, `planKeyPresets`, `cx1r4Truth`, `planCitation`,
`planReader`, the two codec suites: 316 tests). Packed-product drills
re-run against the merged `dist/acp.js` under a fresh `HOME`: the
no-prefix key reaches the key test ("Test failed: The provider could
not be reached.", closed port), the URL value asks its question first,
and non-UTF-8 bytes get the not-text sentence — the green wording
above, byte for byte.

Not run here, with the measured reason (no workaround attempted):
`npm run package` and `package:acp` stop on the CI-built native
helpers (`native/darwin/muse-dictate`, the Linux created-path helper),
which are ignored build artifacts absent from this checkout — this
lane touches no native code. `security:sast` dies in semgrep before
scanning ("ca-certs: empty trust anchors" in this sandbox).
`security:secrets` over this shared clone's every ref reports two
findings in an unrelated lane's commit (`3e8ea2c25`, branch
`rv/cm1134i`); over this branch's own history (`--log-opts=HEAD`,
3,204 commits) it is clean. The panel look above stays pending for
the lead (native dialogs; no Chrome on this rig). `test:a11y`
measured 0 rules violated, but 108 of 1,072 pages never became ready
within 10 s (spread over all four themes and unrelated scenarios on
this loaded rig; this branch changes no webview or harness file, and
the gate does not run on pull requests).

### PR159FIX Codex threads: triage against `1fe57ea8c` (2026-10-18, macmini rig, lane PR159FIX)

Codex's first review (findings 4273569xxx). Each thread re-checked at
this branch head: five were already fixed by later commits, two are
open and worked below.

- T1 (P2, exec stdin notice, `providerExec.ts:493`): FIXED by
  `a64aebd4a` — the assembly inspects the piped key
  (`providerExec.ts:501-505`), `runExec.ts:503` prints the notice, the
  key still reaches the in-memory store; proven by
  `test/unit/execProviderNotice.test.ts` (survives at this head).
- T2 (P3, malformed UTF-8, `providerExec.ts`): FIXED by `39c295ec4` —
  `providerKeyFailureText('invalid')` reads `providerKeyNotText`
  (`keyInput.ts:190-192`), distinct from `providerKeyNotStored`; every
  stdin reader (exec, `providers add`, `auth set`, per-account) shares
  the mapping.
- T3 (P1, D108 archive, `PLAN.md`): FIXED by `2f94472ea` plus the RED
  renumber — the provider-keys decision is **D123** (main's D108 is the
  test overhaul); the record lives under `## D123` in
  `docs/plan-archive/decisions.md`, `PLAN.md` keeps the rule-in-force
  summary; `check:plan` re-run in this lane's final gates.
- T4 (P1, light+dark pictures, `modelsPanelEntry.ts:305`): OPEN —
  record says "Panel look (pending)": the modal warning and password
  box are native VS Code surfaces. Attempted on this rig below.
- T5 (P2, stale providersX result, cert): FIXED by `d0eb81272` — the
  record now names the deleted sub-case (`a4125641c`) and the renamed
  test's measured result (34 passed, repo default timeout).
- T6 (P2, locale install, `authCommands.ts:149`): FIXED by `a64aebd4a`
  — `authSetProvider` (`authCommands.ts:141-150`), `providers add`
  (`providersCommands.ts:650-656`) and the exec assembly all install
  the caller's table through the providers bundle's own `setUiText`
  before formatting; `providerKeyNoticeText` reads `UI_TEXT` at call
  time (`keyInspection.ts:57-69`), and every call site imports both the
  notice functions and `setUiText` from `providersEntry`
  (`dist/providers.js`), one consistent bundle state.
- T7 (P2, per-account notice, `accountsCommand.ts:104`): OPEN —
  `runAccountAuthSet` reports non-text stdin but stores any trimmed
  non-blank non-Meta key without `inspectProviderKey`. Fixed below.

### PR159FIX outcomes (2026-10-18, macmini rig, lane PR159FIX)

- T7 fixed in `67325eb4f` (`src/runtime/providers/accountsCommand.ts`:
  non-Meta per-account keys are inspected through `keyInspection`
  directly and the notice prints before the store; the key still
  reaches the store). Split-gate declarations for `keyInspection` in
  `dist/runtimeAccounts.js` added beside the modelsPanel one in both
  `scripts/check-bundle-split.mjs` and `scripts/lib/deferredBundles.mjs`
  (the panel precedent `c50b2061d` touched both files; the second fires
  from the lib, which is why the first build still reported one
  problem). No new unit test: wiring coverage would need a
  hand-written credential vault (a fake store), which the owner's
  no-fakes rule forbids; the shared functions are proven by
  `providerKeyInspect`/`execProviderNotice`, and the wiring mirrors the
  proven siblings line for line. Packed-product proof (`npm run build`
  green, `node dist/acp.js`, fresh empty `HOME` under `temp/`): `auth
set --provider groq --account work` piped a URL answers `This
product cannot be added.` (exit 1, `HOME` untouched) — the genuine
  not-offered gate, since no provider row exists without a real key,
  which this rig never holds; the notice is unreachable without one.
  Sibling intact in the same packaged runtime: `providers add --preset
custom --as keytext --address http://127.0.0.1:9/v1 --private-ok
--format chat --model m --key-stdin` piped the same URL prints `This
looks like a web address, not a key. Use it anyway?` first, then the
  key test's connection truth (exit 1).
- T4 answered with a measured reason, pictures still pending for the
  lead. Attempted the sanctioned look on this rig (Chrome present):
  `npm run ui:look -- models-byo` exit 0, light and dark pictures
  rendered to `temp/ui-look/` and inspected — they show only the model
  picker; the modal warning (`modelsPanelEntry.ts:302 confirmKeyUse`)
  and the password box (`keyPrompt.ts`) are native VS Code surfaces the
  webview harness cannot render by construction. No
  integration/e2e test names `confirmKeyUse` or `promptForProviderKey`,
  so there is no automated run to extend; a packed-vsix GUI run is
  blocked here (the CI-built native helpers are ignored build
  artifacts absent from this checkout, so `npm run package` stops).
  The lead's prescribed manual look above ("Panel look (pending)")
  stands unchanged.

### PR159FIX2 triage (2026-10-18, linuxlt rig, lane PR159FIX2)

One line per new Codex thread; fixes follow in this lane.

- cert T7 (`notOffered` gate): ACCEPTED — the recorded run never reaches `readSecret`, so the per-account inspection/notice/store path stays unproven; this lane will drive it in the packed product before merge.
- `providerKeyInspect.test.ts:28` (invented fixtures): ACCEPTED — the provider-prefixed strings are synthetic; this lane replaces them with shape-neutral inputs since the classifier under test is provider-agnostic.
- `hiddenInput.ts:64` (whole-stream decode): ACCEPTED — the reader's contract is the first line, so it will locate the first LF in bytes and validate only that prefix.
- `presets.ts:48` (dead `isKeyShape`): ACCEPTED — no production reader remains, so the API and the now-uniform `keyShape` field go, with their tests.
- `CHANGELOG.md:60` (`auth set --provider` routing): ACCEPTED — dispatch reads only `command.target`, so the documented form falls into the Meta path; this lane routes `command.provider` before claiming the notice.
