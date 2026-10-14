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

- `test/unit/providersX.test.ts` "refuses an unknown preset, a repeat,
  a bad shape and a missing key": asserts the OLD contract (exit 1 for
  key `'wrong-shape'` on groq). With the fix the key goes to the key
  test and the fake list accepts it (exit 0). Fails on assertion;
  named, not repaired.
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
