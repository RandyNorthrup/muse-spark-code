# RLGROKAUTH: Continue With Grok (xAI subscription sign-in)

Worktree `/home/randy/lanes/RLGROKAUTH`, branch `rec/rlgrokauth`,
base `f3941b8548` (release 0.19.0). Recovery lane; no live sign-in was
attempted (no owner-present session), no paid call was made ($0), and no
credential was read, printed or stored (`~/.grok/auth.json` key names
only, per the brief).

## What shipped

A Grok account sign-in like Continue With ChatGPT: a SuperGrok or X
Premium subscription signs in with xAI and Grok models run on that
subscription, no API key. Browser flow (PKCE S256, loopback redirect)
in Models & Agents, the command palette and the terminal; RFC 8628
device-code flow for SSH and remote hosts (`providers add grok
--device`); OIDC against the published discovery at
`https://auth.x.ai/.well-known/openid-configuration` with this app's
own client id from configuration; tokens in the credential store under
their own lane, refreshed in the background; every refusal in English
plus the 14 tables; usage spends the subscription allowance and the UI
says so.

Until xAI issues this app a client id, every sign-in refuses before
any request with the registration notice, in the panel, the terminal
and the ACP verify path alike. The route never reuses another app's
OAuth client id or scope: no Grok CLI, OpenCode or other id appears
anywhere in the tree, and the default scopes are pure OpenID
(`openid offline_access`, both in the discovery's `scopes_supported`).

## What xAI must issue before sign-in works

1. An OAuth client id for Muse Spark Code (a public client doing PKCE;
   no client secret).
2. Allowed redirect URIs: loopback
   `http://127.0.0.1:<port>/auth/callback` (OS-chosen port, as the
   ChatGPT route uses).
3. The scope that grants subscription inference (until named, the route
   asks `openid offline_access`).
4. Enablement of the device-authorization grant for that client (the
   discovery advertises `urn:ietf:params:oauth:grant-type:device_code`,
   but per-client enablement is xAI's to confirm).

## Decisions recorded here

- The vault migration refuses the `grok` slot exactly like `chatgpt`
  (`src/core/vault/migrate/providerCredentials.ts`,
  `src/host/vault/migrateCredentials.ts`): subscription grants are
  installed shapes with their own owner lanes, not 4-key apiKey
  records, so they stay in SecretStorage and never migrate to the
  vault.
- The VS Code client id lives in one machine-scoped setting,
  `museSpark.grokClientId` (a repository must not choose the OAuth
  client); the subscription features re-read it for every sign-in and
  rebuild the port when it changes. No scopes setting: the default
  stands until xAI names an app-specific scope. The terminal takes
  `--client-id` / `--scopes` per command, since the ACP agent has no
  settings surface.
- The panel offers the browser flow only; a remote window refuses with
  the terminal device command (`signInRemoteWindowGrok`). The ACP
  agent lists the same four terminal commands ChatGPT lists (add,
  add-device, remove, status).
- ChatGPT's terminal commands were generalized, not cloned: one
  runner, one auth-method builder and one session client in
  `src/runtime/subscriptionProviderCommands.ts`, with one binding per
  subscription. ChatGPT's suites pass unchanged (33 + 69 + help/truth
  suites below); its observable behavior is preserved bit for bit,
  including the silent rollback drop and the `signed-out` exit code.

## Proof: unit tests (repo timeout, direct vitest)

- `test/unit/grokProviderCommands.test.ts` 27/27: exact grammar,
  refusal before any request (fetch-call log empty), refused device
  answer naming our request shapes (recorded discovery GET, advertised
  device POST), status states, remove semantics (local grant and entry
  always cleaned), ACP method args and verifiers. Red-proven twice
  (broken flag parse, broken status exit code), reverts verified
  byte-identical.
- `test/unit/grokSignIn.test.ts` 21/21, `grokHostPorts` 16/16 +
  `grokRuntimeHost` 13/13, `grokPlan` 56/56 (earlier commits;
  red-proven at the time).
- ChatGPT guards unchanged and green: `runtimeChatGptLock` +
  `chatGptAddNewAccount` + `chatGptLocalFailures` (33 passed,
  2 pre-existing skips); `chatGptLocalFailures` + `accountsCommand` +
  `chatGptHostId` (69 passed); `commandHelp` + `cx1r4Truth` +
  `cx1r2Truth` (88 passed, including the new grok help routes).
- `modelsPanelSchemas` + vault `credentialMigration` +
  `migrationCodecRoundTrip` 26/26 (grok protocol message, vault
  exclusion both layers). `grokClientIdSetting` 2/2.
- No fake xAI server anywhere: outside-world input is the recorded
  discovery capture (`test/fixtures/grok/discovery.json`, captured
  2026-10-22) plus real crypto; every other fetch refuses.

## Proof: production drills (dist from `node scripts/build.mjs --production`)

`muse-spark-code-acp` 0.19.0 from this lane, empty config and no
Secret Service on the rig, so the store reads as unavailable — the
honest production answer on a headless host:

- `providers status grok` → the store-unavailable guidance, exit 1.
- `providers add grok` → the subscription notice, then the
  store-unavailable guidance, exit 1. `--device` prints the device
  notice instead.
- `providers add grok --bogus` → the grok usage line, exit 2.
- `providers remove grok` → the store-unavailable guidance, exit 1;
  the providers file is still written cleaned (`{"v":1,"providers":[]}`).
- `--help` lists the grok usage; `providers add grok --help` routes to
  the command's own three-line help.
- ACP `initialize` over real stdio advertises `grok-add`,
  `grok-add-device`, `grok-remove`, `grok-status`; `authenticate`
  `grok-status` answers `authRequired` with the store sentence.

`npm run package:acp` itself stops at its universal-package check:
`native/darwin/muse-vault-peer-arm64` cannot be built on this Linux
rig (release step, not lane code).

## Proof: panel look

`models-empty` harness scene, one small local look, no new styling
(existing button, row and paragraph classes only):

- `rlgrokauth-models-empty.light.png`
- `rlgrokauth-models-empty.dark.png`

The Continue With Grok button and subscription notice sit beside the
ChatGPT ones and read correctly in both themes. Chrome's profile ran
under the worktree (`temp/chrome-tmp`, removed after): the session
TMPDIR's length exceeds Chrome's socket limit and `/var/tmp` is
read-only in this sandbox.

## Bundle split (found in final gates)

The lane's code pushed `dist/subscriptions.js` to 68.5 KiB against its
50 KiB budget (base: 44.5 KiB). Rather than raise it, dispatch and
terminal commands split out beside the registry into
`dist/subscriptionCommands.js` (new barrel
`src/host/backend/subscriptionCommandsEntry.ts`), measured at
47,827 B for a 75 KiB budget per D6/D74 (measured + 15%, next 25 KiB
multiple). `dist/subscriptions.js` now carries only the sign-in cores
at 29.2 KiB. Every bundle reads the cores through subscriptionsEntry
(one `instanceof` across the boundary, no bundle cycles); the ACP
agent resolves the same dynamic imports to the new file, and the
post-split drills above were re-run identically against it.

## Pre-existing environmental failures (not this lane)

`test/unit/mediaConvert.test.ts` (1 test) and
`test/unit/privateRootLease.test.ts` (2 tests) fail in this sandbox with
`EPRIVATE_ROOT`: POSIX ancestor verification requires `/` to be owned by
root or the user, but the sandbox maps `/` and `/home` to uid 65534.
Verified identical at base `f3941b8548` (same 3 failures, 14 passed in
those two files). Unrelated files (media conversion, private roots);
nothing in the lane touches them.

## Gate record (this lane's final runs)

`tsc` (host, webview), `eslint --max-warnings=0`, `prettier --check`,
`jscpd` (0 clones), `check:catches` (baseline regenerated for the
three moved runner sites; counts unchanged), `check:l10n` (0
problems), `check:reference` (66 commands, 103 settings, 306 CLI),
`check:roadmap` (current). Full `npm run quality` in the final lane
message. Live sign-in, live catalogue and live refresh remain open
until xAI registers the app and the owner signs in.
