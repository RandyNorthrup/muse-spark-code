# PR #32 joined with main after M57 and M58

Recorded 2026-09-27 on branch `integrate/pr32` (PR #32's head, its earlier
merge of main `faace73` and the Open VSX namespace step, `2559a9b`), merging
main `72fa907`: the 0.9.0 release fixes, 0.9.1, M57 (the Model API backend
as its own bundle) and M58 (a popup before every paid use). PLAN.md D6 and
D62 amendments, M63.

## The merge

Six files conflicted, all prose or lists: `AGENTS.md`, `CHANGELOG.md`,
`PLAN.md`, `README.md`, `docs/certification/README.md`, `package.json`
(the `cycles` entries). Both sides were kept:

- **`package.json`**: `npm run cycles` follows four entries, the extension,
  the Model API bundle (M57), the webview and the ACP agent.
- **`CHANGELOG.md`**: main released 0.9.0 and 0.9.1 after PR #32 branched,
  so git placed PR #32's four "Added" entries (the host API gate, the ACP
  agent, Open VSX and npm publishing, the host checks) and its "VS Code
  1.99 or newer" entry inside `[0.9.0]`. They are moved to `[Unreleased]`,
  where they belong: none of them shipped in 0.9.0.
- **`PLAN.md`**: D48 before D60–D62; the open questions with main's Q6 and
  PR #32's Q60–Q65; M57 before M60–M66; the gates table with main's bundle
  split and PR #32's host API and hosts rows, the cycles row with four
  entries and the aggregates with `check:host-api`.
- **`README.md`**, **`AGENTS.md`**, the certification index: main's rows
  and wording, with PR #32's `check:host-api`, `package:acp`, `test/hosts/`
  and ACP entries added.

What merged without a textual conflict but no longer fitted:

| Where                                 | What broke                                                                                                                                              | Fix                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/build.mjs`                   | M57's `modelApiOptions` used `NODE_TARGET`, which PR #32 had split into `HOST_NODE_TARGET` (node20.18, the 1.99 floor) and `AGENT_NODE_TARGET`          | `dist/modelApi.js` targets `HOST_NODE_TARGET`, as the activation bundle it is loaded beside                                                                                                          |
| `src/runtime/backends.ts`             | `confirmSubagentTask` (gone with M58); no `bundlePath` (required since M57)                                                                             | `allowsPaidUse` and `isPaidUseRemembered` through the agent's paid-use questions; `bundlePath` is `dist/modelApi.js` beside `acp.js` (below)                                                         |
| `src/acp/translate.ts`                | the approval subject's `paidFeature` (removed by M58, a paid call no longer gets an approval)                                                           | the approval title no longer names a price; a paid row still does                                                                                                                                    |
| `src/acp/agent.ts`                    | `error instanceof PromptSettledError`, which M57's lint rule refuses (the class may be the Model API bundle's copy)                                     | `isPromptSettledError`                                                                                                                                                                               |
| `test/unit/helpers/fakeModelApi.ts`   | M57's integration test loads it in VS Code; it used `Promise.withResolvers`, which the integration project (ES2023, PR #32's floor) and Node 20.18 lack | a plain promise, as M62 did in the host                                                                                                                                                              |
| `test/unit/helpers/modelApiBundle.ts` | built the bundle for `node22`                                                                                                                           | `node20.18`, the build's target since PR #32                                                                                                                                                         |
| `docs/ide-compatibility/host-api.md`  | stale: M58's popup (`MessageItem.title`, `isCloseAffordance`) and M57's `node:module`                                                                   | regenerated: 200 VS Code APIs, 13 files importing `vscode`, 17 Node built-ins; `modelApiEntry.ts` added to the portable list                                                                         |
| `l10n/`                               | the three strings of the agent's first-prompt price question                                                                                            | removed from `en.ts` and the 14 tables with the question (below); no new string: the agent's questions reuse the popup's own words (`paidUseQuestion`), already in all 15 languages. `check:l10n`: 0 |

## The agent and M57: `dist/modelApi.js` (PLAN.md D6 amendment)

The runtime's `ModelApiBackendManager` gets `bundlePath:
<dist>/modelApi.js`, the file the `.vsix` ships, and the agent's package now
ships it too (`scripts/package-acp.mjs`), with its packages in the agent's
third-party notices. The alternative, the entry bundled into `acp.js` and
handed over with `loadBundle`, was a second build of the same backend in a
second file. `check-bundle-split.mjs` now reads `dist/meta-acp/acp.json`
and fails when `acp.js` carries a lazy file or the entry;
`check-host-api.mjs` lists `modelApiEntry.ts` as portable. `acp.js` went
from 874.1 KiB (the joined tree before M57) to 713.2 KiB.

## The agent and M58: each paid use asks in the editor (PLAN.md D62 amendment)

- **One consent, the panel's.** `AcpPaidUse` (`src/acp/paid.ts`) builds the
  core's `PaidUseConsent` for the folder and session of each use. A feature
  is on only with its flag; subagents, scheduled prompts and Muse Voice have
  none, so they are denied without a question.
- **The question.** `session/request_permission` in the conversation the use
  is for: a `tool_call` row `paid-use-<n>` titled and described by
  `paidUseQuestion` (the popup's words, moved from `paidHost.ts` into
  `paidConsent.ts` so both say the same), options `allow_once`,
  `allow_always` (only with `--trust-workspace`) and `reject_once`. A
  cancel, an option not offered or a failed request is Deny; the row ends
  `completed` or `failed`.
- **Which conversation.** `ModelApiHostDeps.allowsPaidUse` gained a third
  argument, `sessionId`: the Model API host serves every conversation of a
  folder, and the agent must ask in the right ACP session. A child task's
  use carries its parent's id (`askingSessionId`). The extension ignores
  it. The agent denies when it holds no such session or no client attached.
- **"Always".** `src/runtime/paidGrants.ts`: `acp/paid-uses.json` in the
  agent's data folder, the folder's hash (`workspaceKey`, shared with the
  sessions folder) to feature names, validated with zod, read at every
  question, replaced atomically and one change at a time. At start
  (`serve`), a feature without its flag loses its grants in every folder.
- **Removed.** The first prompt's "Turn on" question (`AcpPaidFeatures.settle`,
  `confirmPaid`, the `preparing` state and the three `acpPaid*` strings):
  with the price named at every use, it would have asked twice before one
  prompt.

## Tests

| File                             | What it proves                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/acpAgent.test.ts`     | no flag or subagents: denied, nothing asked; each use asks in its session with the price and the untrusted options; "always" in a trusted folder stops the asking and is kept; Deny, a cancel, an option not offered and an unknown option deny; a failed request and an unknown session deny; a paid row names its price |
| `test/unit/acpPaid.test.ts`      | no asker, or one that throws: deny; "always" per folder, asked again where a hook demands it and not without trust; flags forget grants, a write failure is logged; the options and answers; the grants file: per folder, across processes, serialised writes, forget, damaged content                                    |
| `test/unit/acpModelApi.test.ts`  | through the runtime and a built `dist/modelApi.js`: each prompt that may search asks and the search is tallied; Deny sends the prompt without `web_search`; "always" kept in the data folder, honoured by the next agent, dropped by one started without the flag, asked again after                                      |
| `test/unit/acpRuntime.test.ts`   | a missing `dist/modelApi.js` fails in the user's words with the path logged; the grants file's place per platform                                                                                                                                                                                                         |
| `test/unit/modelApiHost.test.ts` | the host names the conversation of each paid use: two conversations' web search, the spawn, the owner's follow-up and a child's image, the child's asked in its parent's                                                                                                                                                  |
| `test/e2e/acpStdio.e2e.test.ts`  | a Model API turn through the package's own `dist/modelApi.js` (the laid-out package, and with `MUSE_ACP_PACKAGE_DIR` the installed one)                                                                                                                                                                                   |

Also run on this tree: the packed agent (`node scripts/package-acp.mjs`,
23 files, `dist/modelApi.js` among them) installed into a scratch prefix,
the stdio suite against it: 5 of 5. `npm run test:integration`: 10 passing
on VS Code 1.139.1 and 10 on 1.99.0, M57's bundle test among them.

## Drills

Each broke one thing, the named check failed, and the file was restored
(content hash compared).

| Drill | Break                                                                                             | Result                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| P1    | `AcpPaidUse.isOn` true for every feature                                                          | exit 1: "denies without asking a feature it has no flag for, and subagents always"                                   |
| P2    | the agent answers "once" for a session it does not hold                                           | exit 1: "denies when the client cannot answer, or the session is not one the agent holds"                            |
| P3    | "Allow always" offered without `--trust-workspace`                                                | exit 1: "asks before each use in its session, naming the price; Allow once allows that use only"                     |
| P4    | "Allow always" taken although it was not offered                                                  | exit 1: "denies on an option it was not offered, and keeps nothing"                                                  |
| P5    | `forgetUnflagged` forgets nothing                                                                 | exit 1: "keeps "Allow always" for a trusted folder until the agent starts without the flag (M58)"                    |
| P6    | `askingSessionId` is the child's own id                                                           | exit 1: "asks each paid use in its conversation, a child's in its parent's (M58, PLAN.md D62)"                       |
| P7    | no asker attached answers "once"                                                                  | exit 1: "denies every use until the agent attaches its way to ask"                                                   |
| P8    | the grants file keeps names that are not paid features                                            | exit 1: "counts a damaged file, or names that are not paid features, as no grants"                                   |
| P9    | a hook's demand to ask dropped (`requiresAsking` false)                                           | exit 1: "keeps "always" per folder, asks again where a hook demands it, and not without trust"                       |
| B1    | the runtime hands the manager the entry module (`loadBundle`), bundling the backend into `acp.js` | `check-bundle-split.mjs` exit 1: 21 problems, "dist/acp.js carries src/core/backends/modelapi/ModelApiHost.ts, …"    |
| B2    | `modelApiEntry.ts` imports a `vscode` type                                                        | `check-host-api.mjs` exit 1: "src/host/backend/modelApiEntry.ts reaches `vscode`", "Uri is a VS Code type"           |
| B3    | `scripts/package-acp.mjs` without `modelApi.js`, packed and installed                             | the installed-package suite: 1 failed, 4 passed, "ships the Model API backend beside the agent" (`MODULE_NOT_FOUND`) |

## The agent's budget (PLAN.md D6 amendment)

After the merge, from the production build's metafile:

| Bundle                 | Size      | Budget                |
| ---------------------- | --------- | --------------------- |
| `dist/extension.js`    | 432.5 KiB | 600 KiB, unchanged    |
| `dist/modelApi.js`     | 299.5 KiB | 400 KiB, unchanged    |
| `dist/searchWorker.js` | 15.2 KiB  | 50 KiB, unchanged     |
| `dist/webview/main.js` | 751.7 KiB | 900 KiB, unchanged    |
| `dist/acp.js`          | 713.2 KiB | **850 KiB** (was 800) |

`acp.js`: zod 445.2 KiB (257.6 of it the 64 locale files of the classic API
the ACP SDK imports, 185.0 its core and classic API, 2.5 the panel's
`zod/mini`), the English table 58.6, the ACP SDK 53.7, the Muse Code SDK
14.7, and the engine, `src/acp` and `src/runtime` about 155. 713.2 × 1.15 =
820.2, rounded up to 850. Gzipped, `acp.js` is 175.1 KiB; the packed agent
(`muse-spark-code-acp-0.9.1.tgz`) is 611,034 bytes.

Drill: the agent's budget set to 700 KiB, `check-bundle-size.mjs` exit 1,
"OVER dist/acp.js: 713.2 KiB (budget 700 KiB)"; restored, "ok … (budget 850
KiB)".

## Networks and proxies (`docs/acp.md`, PLAN.md Q66)

What reaches the agent's two network paths, read from the code and then
measured on this machine (Windows 11) with a throwaway script:

- **The code.** The agent hands the Model API backend
  `globalThis.fetch` (`src/runtime/main.ts`), Node's own `fetch`, with no
  dispatcher of its own. Muse Code's manager gets no editor proxy
  (`NO_EDITOR_PROXY` in `src/runtime/backends.ts`) and no extra variables,
  so `muse serve` inherits the agent's environment, with loopback added to
  `NO_PROXY` whenever a proxy is set (`withLoopbackBypass`, M56).
- **The agent's `fetch`, measured.** A local proxy on 127.0.0.1 logged each
  request line and answered `CONNECT` with 502, so nothing left the
  machine; the target, `https://muse-probe.invalid/`, cannot resolve, so a
  direct attempt fails with `ENOTFOUND`. Each case ran in a fresh Node
  process with only its own variables:

  | Environment                                      | 22.0.0  | 22.20.0 | 22.21.0 | 22.23.3            | 24.0.0  | 24.5.0 | 24.20.0            |
  | ------------------------------------------------ | ------- | ------- | ------- | ------------------ | ------- | ------ | ------------------ |
  | `HTTPS_PROXY` only                               | direct  |         |         | direct             |         |        | direct             |
  | `https_proxy` only                               | direct  |         |         | direct             |         |        | direct             |
  | `HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`           | direct  | direct  | proxy   | proxy              | proxy   | proxy  | proxy              |
  | `https_proxy` + `NODE_USE_ENV_PROXY=1`           | direct  |         |         | proxy              |         |        | proxy              |
  | `HTTP_PROXY` + `NODE_USE_ENV_PROXY=1`            | direct  |         |         | proxy              |         |        | proxy              |
  | `HTTPS_PROXY` + `NO_PROXY=.invalid` + the switch | direct  |         |         | direct             |         |        | direct             |
  | `ALL_PROXY` + the switch                         | direct  |         |         | direct             |         |        | direct             |
  | `HTTPS_PROXY=http://user:pass@…` + the switch    | direct  |         |         | proxy, credentials |         |        | proxy, credentials |
  | `HTTPS_PROXY` + `NODE_OPTIONS=--use-env-proxy`   | refused | refused | proxy   | proxy              | refused | proxy  | proxy              |

  "proxy": the proxy logged `CONNECT muse-probe.invalid:443` and `fetch`
  failed with "Proxy response (502) !== 200 when HTTP Tunneling";
  "credentials": a `Proxy-Authorization` header came with it; "direct":
  the proxy saw nothing and `fetch` failed with `ENOTFOUND`; "refused":
  Node would not start ("--use-env-proxy is not allowed in NODE_OPTIONS");
  an empty cell was not run.

- **Certificates, measured.** A local HTTPS server with a throwaway
  self-signed certificate: without a variable every Node refuses it
  (`DEPTH_ZERO_SELF_SIGNED_CERT`); with `NODE_EXTRA_CA_CERTS` naming it,
  `fetch` answers 200 on 22.0.0, 22.14.0, 22.15.0, 22.23.3 and 24.20.0.
  `NODE_OPTIONS=--use-system-ca` is refused by 22.0.0 and 22.14.0 and
  accepted from 22.15.0; whether it then trusts a root in the operating
  system's store was not exercised (that needs a root installed there).
- **Muse Code** reads `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and
  `NO_PROXY`, trusts the operating system's store, and takes
  `SSL_CERT_FILE` or `SSL_CERT_DIR` in its place, as recorded for the
  extension in M56 (`docs/certification/m56.md`); the agent changes
  nothing of that, and hands it no VS Code setting.

The owner's ruling on Q66 (2026-09-27): loud, not re-routed. Recorded
below, "Q66: the limit made loud".

## The key store on the owner's rigs

`test/hosts/keystore.sh` with its made-up key, on the agent packed from this
branch: Windows 11 VM (Credential Manager, in the owner's console session)
and Mac mini (a keychain of the run's own): both `ok`, nothing left behind.
Over SSH with a key, Windows refuses Credential Manager
(`ERROR_NO_SUCH_LOGON_SESSION`) and the agent stores nothing; now in
`docs/acp.md`. Details in `m63.md`, "The key store on the owner's rigs".

## The gate

`npm run quality` on this branch at `13ee7d4` (Windows 11, Node 24.20.0),
the tree with main's plan (PR #50), PR #49 at its merged head `5184f26`,
rule 8 and the review's fixes: exit 0. Main's `c42c4d5` (PR #49's merge)
has the same tree as `5184f26`, so merging it changed no file. Earlier
runs passed at `83a4530` (Q66) and `87383c7`. The first full run, on
`e231349`, failed at SAST on the spawn behind the agent's `login`, PR #32's
own code, never through semgrep before (its container could not fetch the
rules, `m63.md`); annotated with its reason and registered in PLAN.md §8
(`87383c7`), and that run is the suppression's drill. A run on `f8063b8`
failed at `check:host-api` (PR #49's code added one API); the record was
regenerated.

| Step                                | Result                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `format:check`, `lint`, `typecheck` | exit 0 (PSScriptAnalyzer findings: 0; five projects, the host at ES2023)                                                                     |
| `check:l10n`                        | 14 tables, 93 manifest strings, 255 source files; 0 problems                                                                                 |
| `check:host-api`                    | 201 VS Code APIs, 13 files importing `vscode`, 17 Node built-ins, 57 theme variables; 0 problems                                             |
| `deadcode`, `cycles`, `duplication` | exit 0; no circular dependency; 0 clones                                                                                                     |
| `test:unit`                         | 188 files passed, 2 skipped; 2,873 tests passed, 23 skipped; coverage 94.75 % statements, 90.07 % branches, 96.38 % functions, 94.72 % lines |
| `build`                             | `extension.js` 448.6 of 600, `modelApi.js` 301.2 of 400, `acp.js` 724.8 of 850 KiB; the split holds for both loaders; notices: 75 packages   |
| `security:audit`                    | 0 advisories, 0 exceptions                                                                                                                   |
| `test:a11y`                         | 336 pages (84 scenarios × 4 themes), 0 violations, 0 undecided                                                                               |
| `security:secrets`                  | 337 commits scanned, no leaks                                                                                                                |
| `security:sast`                     | 287 rules on 450 files: 0 findings                                                                                                           |
| `test:integration`                  | 10 passing on VS Code 1.139.1 and 10 on 1.99.0                                                                                               |

The tail:

```text
> muse-spark-code@0.9.1 security:secrets
> gitleaks git --redact --no-banner .

INF 337 commits scanned.
INF no leaks found

> muse-spark-code@0.9.1 security:sast
> node scripts/sast.mjs

Ran 287 rules on 450 files: 0 findings.
exit=0
```

Not run here: hosts.yml and forks.yml (CI only; they run on the pull
request), and no live model call was needed.

## Q66: the limit made loud

The owner (2026-09-27): the agent does not re-route or add undici; make the
limit loud and the advice correct.

- **The warning** (`src/runtime/proxyWarning.ts`, logged by `serve` in
  `src/runtime/main.ts`): on the Model API backend, when `HTTPS_PROXY`,
  `https_proxy`, `HTTP_PROXY` or `http_proxy` is set (each named once; on
  Windows the two spellings are one variable) and Node's switch is off,
  one line says the requests go to Meta directly and to set
  `NODE_USE_ENV_PROXY=1`. The switch counts as on for `NODE_USE_ENV_PROXY`
  exactly `1` (measured: `true` and `0` do nothing), or `--use-env-proxy`
  in `process.execArgv` or `NODE_OPTIONS`. On a Node without the switch
  (below 22.21 on the 22 line, 23, anything older; measured 23.11.1: none),
  the line names the running version and what would work, even with the
  switch set. Nothing is said without a proxy variable, on the Muse Code
  backend (Muse Code reads the variables itself), or once the switch is on.
  Only the variables' names are logged, never an address.
- **The advice** (`src/core/networkFailure.ts`): `networkFailureMessage`
  takes `NetworkAdvice`, `'vscode'` by default. The runtime's manager passes
  `networkAdvice: 'agent'` down to the bundle's `ModelApiClient`, and the
  same classifier then returns `acpNetworkUntrustedCertificate`,
  `acpNetworkProxyCredentials` or `acpNetworkUnreachable`, which name the
  agent's environment (`NODE_EXTRA_CA_CERTS`, `--use-system-ca`,
  `HTTPS_PROXY`, `NODE_USE_ENV_PROXY=1`). A proxy's refusal names no setting,
  so both hosts share it; the extension's advice is unchanged. The three
  strings are in `en.ts` and the 14 tables, translated; `check:l10n`: 0
  problems.
- **Also**: the runtime takes `sleep` from `main.ts`, so a test can run the
  client's network retries without waiting; the fake Model API can put a
  socket code under a failed fetch, as Node's does.

Tests: `acpProxyWarning.test.ts` (18: no variable, ALL_PROXY only, the
Muse Code backend; each of the four variables, the value never logged;
the switch by variable, flag and `NODE_OPTIONS`; `true`, `0`, `yes` and a
look-alike flag still warn; Node 22.0.0, 22.20.0, 23.11.1, 20.18.3 and an
unreadable version are too old even with the switch; 22.21.0, 22.23.3,
24.0.0, 24.20.0 and 25.1.0 have it; one spelling per variable on Windows);
`networkFailure.test.ts` (the agent's advice for a certificate, a proxy
wanting credentials and a real refused connection, never naming VS Code;
the refusal shared; the extension's advice as before);
`acpModelApi.test.ts` (a refused connection through the runtime, the
built bundle and the ACP client: the prompt fails with the agent's advice
and not `http.proxy`); `acpStdio.e2e.test.ts` (the built agent's stderr:
the warning with `HTTPS_PROXY` on the Model API backend, none with
`NODE_USE_ENV_PROXY=1`, none on the Muse Code backend).

| Drill | Break                                                      | Result                                                                                              |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Q1    | `--use-env-proxy` in `NODE_OPTIONS` not read               | exit 1: "says nothing once the switch is on: the variable, the flag, or the flag in NODE_OPTIONS"   |
| Q2    | every Node taken as one with the switch                    | exit 1: 4 of "warns that Node … is too old for any proxy, even with the switch on"                  |
| Q3    | any non-empty `NODE_USE_ENV_PROXY` taken as on             | exit 1: "still warns for a switch Node does not take: only "1" turns it on"                         |
| Q4    | `serve` does not log the warning                           | the stdio suite, exit 1: "says at start that a proxy will not be used by the Model API backend, …"  |
| Q5    | Windows spellings not merged                               | exit 1: "names each variable set once: both spellings on Linux, one on Windows, where they are one" |
| Q6    | the runtime passes `networkAdvice: 'vscode'`               | exit 1: "says what to set in the agent's environment when Meta cannot be reached (Q66)"             |
| Q7    | the client drops its `networkAdvice`                       | exit 1: the same test                                                                               |
| Q8    | the agent's unreachable advice replaced by the extension's | exit 1: "names the agent's environment, never VS Code's settings, for the same failures"            |
| Q9    | the default advice made the agent's                        | exit 1: 5 of M56's tests (the extension's advice), in `networkFailure` and `modelApiClient`         |
| Q10   | one table without `acpNetworkUnreachable`                  | `check:l10n` exit 1: "l10n/ui.de.json: acpNetworkUnreachable: missing"                              |

## Main's plan (PR #50) and the sign-in fix (PR #49) joined, 2026-09-28

Main `ba82f43` (PR #50: D49, D50, M67–M85) merged first: PLAN.md keeps D49
and D50 before PR #32's D60–D62, and AGENTS.md rule 12 keeps both the ACP
agent's paid-use sentence and D50's planned TypeSafe exception. Then PR
#49's branch, `fix/cli-sign-in-detection` at `2a324d4`, not yet merged to
main: three conflicts (the certification index, `report.ts`'s imports,
`deviceSignIn.ts`), both sides kept.

- **Node 20, again.** PR #49's `deviceSignIn.ts` and `accountHost.ts` used
  `Promise.withResolvers`, which VS Code 1.99 and 1.100 (Node 20.18) lack;
  the host typecheck at ES2023 (M62) refused it. `accountHost.ts` now
  races the handshake with the core's `unlessAborted`; the device sign-in
  stops through a controller of its own and M62's `settleOnAbort`. PR #49's
  220 sign-in tests pass unchanged.
- **The agent's Muse Code readiness** (`src/runtime/backends.ts`) no longer
  asks whether the credential file exists, which `muse logout` leaves
  behind, emptied. It counts as the panel's gate does: `META_API_KEY` in the
  CLI's environment, or PR #49's `CliAccount` over the file's structure
  (`empty` signed out, `inline` signed in), with `account/read` on a
  short-lived host where only the CLI can say (a Keychain pointer, any
  macOS file but the empty one, an unrecognized one). The agent's user
  action is `authenticate`: on macOS a session or a list takes the panel's
  passive estimate rather than start `muse serve` each time (after PR #49's
  `328efb5`, which asks again on every macOS user action). PR #49's
  `5184f26` (a forced Model API backend asks the CLI nothing; a
  same-account Keychain re-sign-in counts) merged without a conflict and
  changes nothing the agent uses.
  `unsupportedHere` (a macOS file on Windows or Linux) is "cannot run" with
  the panel's `cliCredentialUnsupported` sentence. `authenticate`, after a
  sign-in in the terminal, forgets what the CLI said before (the panel's
  Check again). No new wire shape: the verdicts and `account/read` are PR
  #49's, from its captures.

Tests: over stdio, the agent asks for sign-in after `muse logout` (the file
there, emptied; the old check said ready); in process, against the fake
CLI, the readiness for no file, the logout shell, a browser sign-in (asked
of the CLI on macOS), an unplaceable file (asked once, remembered, asked
again on `authenticate`), a macOS pointer off macOS, and `META_API_KEY`;
the agent passes the recheck only from `authenticate`.

## The review before pushing (2026-09-28)

Three read-only reviews of the whole diff since `2559a9b`, one per class
(concurrency and lifecycle; wire evidence and security, the keyring and
the paid-use flow among them; failure paths and docs), then one round of
fixes:

- **Grants** (`paidGrants.ts`, `paid.ts`): "always" adds only the feature
  it allows, merged into the file inside this process's write queue, so a
  set read before another change is never written back (two sessions'
  answers both kept; a feature another agent forgot not brought back). A
  change fails, rather than writing over it, when the file is there but
  cannot be read; a question still reads such a file as no grants.
- **An "always" that cannot be kept** (`paidConsent.ts`, both hosts): the
  use goes ahead as allowed once, logged as such, instead of failing.
- **Grants lapse only on the Model API agent**: a Muse Code agent has no
  paid flags, so starting one beside it no longer clears them
  (`RuntimeBackend.forgetUnflaggedGrants`).
- **Rule 7**: the client's answer to `session/request_permission` is parsed
  with zod (`permissionResponse`), for approvals and paid uses alike;
  anything else is a cancel.
- **Rows**: a paid-use question's row id is a UUID, so a session loaded
  again never reuses one still on screen.
- **The busy window**: a prompt is busy, and a cancel ends it without a
  turn, while the session's skills are first announced; a failed form
  request is declined so the turn goes on.
- **Words**: a missing `dist/modelApi.js` says to reinstall the agent
  (`acpModelApiBundleUnavailable`, 15 languages); an unreadable key store
  is named as the OS store in the agent's log.
- **Docs**: D62's sign-in bullet (one method, the launched backend's), M63's
  status, the command's name in the M60–M66 table, the conflict count
  above, `docs/acp.md`'s absolute links (it is the npm README) and its
  `authenticate` sentence, the host API counts in CHANGELOG, PRIVACY on the
  agent's sign-in read, and a pointer in `m63.md` to the superseded price
  question.

| Drill | Break                                                         | Result                                                                                                                           |
| ----- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| R1    | an add replaces the folder's set                              | exit 1: "adds to the file as it is when written, never a set read before another change"                                         |
| R2    | a change reads an unreadable file as empty                    | exit 1: "fails a change on a file it cannot read, rather than writing over it, …"                                                |
| R3    | grants lapse whatever the backend                             | exit 1: "lets "always" lapse at start only for the Model API agent, which has the flags"                                         |
| R4    | a malformed permission answer passed through                  | exit 1: "reads a permission answer only in its schema, and anything else as a cancel"                                            |
| R5    | no busy check while the skills are announced                  | exit 1: "is busy while the skills are first announced, and a cancel then ends the prompt …"                                      |
| R6    | a failed form request not declined                            | exit 1: "declines a question the form was cancelled on, …"                                                                       |
| R7    | an "always" write failure thrown                              | exit 1: "lets an "always" it cannot keep go ahead once, and says so"                                                             |
| R8    | the agent's bundle sentence not passed                        | exit 1: "loads the Model API backend from dist/modelApi.js beside the agent, …"                                                  |
| R9    | the store's name not used in the warning                      | exit 1: "reads an unreadable secret store as no key and says so once (D25)"                                                      |
| K1    | a failed grant write rethrown (before R7 moved it)            | exit 1: "lets an "always" it cannot keep go ahead once, and asks again next time"                                                |
| R10   | every readiness call a user action (after PR #49's `328efb5`) | the stdio suite, exit 1: "reads Muse Code's readiness from the credential file, and asks the CLI where only it can say (PR #49)" |

Left as they are, with their reasons:

- A paid-use question still on screen when its turn is stopped is not
  withdrawn: ACP gives an agent no way to cancel its own request, and a
  client that sends `session/cancel` answers it cancelled (the spec). A late
  answer to it bills nothing; a late "always" is kept.
- Two agent processes adding a grant in the same instant can keep only one
  (no file lock); the lost one asks again. A grant that cannot be forgotten
  at start (an unreadable or unwritable file) is logged and, while the flag
  is off, never honoured.
- The account host's own failure reasons reach the log as their error's
  name, as PR #49 logs them everywhere (its rule: a CLI's text may name a
  path or an account).

## Codex on `a209130`: four P1s, closed by class (2026-09-28)

- **Credential variables.** The extension's `muse serve` inherits the
  user's own `META_API_KEY` on purpose (PLAN.md D1's amendment,
  `launch.ts`), and counts it as the CLI's credential; its hooks already
  get no `*_API_KEY`. The agent now matches that for Muse Code and goes
  further for everything else: `takeCredentials` (in `main.ts`, before any
  process starts) takes every credential variable (`isCredentialVariable`:
  `*_API_KEY` and the names hooks never get) out of the agent's own
  environment and hands them to Muse Code's processes only (`muse serve`,
  its account hosts, `muse login`, through `getEnvironmentVariables`, as
  the extension's `museSpark.environmentVariables` are). The sweep of every
  spawn the agent can reach: the shell tool and hooks (`toolIo`, also given
  `withoutCredentials`), git (`processGitRunner`, `process.env`), the
  Windows job helpers and tree kills (`windowsPowerShell`, `process.env`)
  all inherit the stripped environment; the Model API backend runs no MCP
  servers; the editor's MCP servers are started by Muse Code with its own
  allowlist. AGENTS.md rule 8, D61 and `docs/acp.md` say so.
- **Logs.** Every backend, CLI or client failure in `src/acp` goes through
  PR #49's `failureForLog` (its kind and code, never its message). What
  stays as it was: the agent's own grants store (our data folder's path
  and its code), the keyring's reason in a sign-in message to the user,
  and the host's exit description (our own table sentence).
- **Client answers.** The elicitation answer is parsed whole with zod, and
  each answer against its question: a single choice one of its options,
  free text (non-blank) only where it has none, a multiple choice distinct
  options within its bounds (1 when unset, as the panel's card). Anything
  else declines the questions. With the permission answers, those are all
  the requests the agent makes of the client.
- **Load and resume.** A loaded or resumed session is set to the mode it
  is shown in, a model the agent lists (a contributor model it hides is
  replaced by the default) and the effort shown; if the backend refuses,
  the load fails and nothing is held. The agent advertises no goal; the
  plan it sends is the history's own.

| Drill | Break                                                  | Result                                                                                                            |
| ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| C1    | the shell tool given the agent's environment as it is  | exit 1: "runs a shell command with no credential variable in its environment" (a real run)                        |
| C3    | credentials copied but left in the agent's environment | exit 1: "takes every credential variable out of the agent's own environment, and leaves the rest"                 |
| C4    | `main.ts` hands the runtime none                       | the stdio suite, exit 1: "hands META_API_KEY in its own environment to Muse Code only, …"                         |
| L1    | a backend failure logged as its message                | exit 1: "logs a backend failure by its kind, never its message"                                                   |
| E1    | a label that is not an option taken                    | exit 1: "answers nothing on a label that is not an option (rule 7)", "declines a form whose answers do not fit …" |
| E2    | a multiple choice's lower bound dropped                | exit 1: "answers nothing for a multiple choice with fewer than it needs", "declines a form whose answers …"       |
| E3    | a malformed response read as an empty accept           | exit 1: 3 tests, "answers nothing on a response that is not one (rule 7)" first                                   |
| M1    | a loaded session left as the backend restored it       | exit 1: "runs a loaded session as it is shown: the mode, a model it lists, the effort"                            |
| M2    | an unlisted model kept                                 | exit 1: the same test                                                                                             |
| M3    | a refused mode logged and the load let through         | exit 1: "fails a load whose mode the backend refuses, and lets that session go"                                   |

Another session answered the same review on the branch meanwhile
(`7c0ff0c8`, the fake CLI's credential in the captured shape; `83833fe1`,
recorded in `m63.md`). This commit sits on top and keeps its tests, its
decline log line and its mode on load. It goes further where the two
differ: credential variables reach Muse Code only, the editor's failures
are logged by kind too, and a load sets a listed model and the effort as
well. It also differs twice from the other session's form rules. A
single choice takes only an offered option, where the other session
also took text: the form sends it as `oneOf`, so text is not an answer
the form allows. And a multiple choice without bounds needs at least
one pick, where the other session allowed none: this is the panel's
card rule.

## Codex on `4eb0156c`: two findings, closed by class (2026-09-28)

- **State the agent shows comes from the backend (P1).** Muse Code's
  `resumeSession` puts the model the agent asked for on the handle, since
  `session/resume` takes none; the CLI keeps the model the session last
  ran on. `matchAdvertised` now asks the backend (`listModels(sessionId)`,
  its `isActive`, as the panel's `adopt` does) and keeps that model only
  where the agent lists it; otherwise it sets the default. The sweep of
  everything the agent shows: the mode is set explicitly on load and
  resume (and sent with `session/start`); the effort is set explicitly on
  every path; the model on a new session is the one `session/start`
  asked for; the commands are `listSkills`' answer; the replayed history
  and plan are the backend's. The Model API host's handle and
  `listModels` both hold the session's real model, so it answers the same
  way. The agent forks nothing.
- **A session that fails setup is let go (P2).** `adopt` replaces
  `register`. A new, loaded or resumed backend session is set up (the
  effort; the mode, model and effort, then the replay) before the agent
  holds it, so no request finds it and no id reaches the client until
  then. Any failure there disposes it, including a handle whose events
  cannot be followed.
- **Reviewed before the push (Grok, `78a74430`): 1 P1, 2 P2, all
  held.** Both hosts hand back a session they already hold, retained
  (`MuseCodeHost.track`, `ModelApiHost.revive`). A first cut kept the
  held wrapper until the reload was set up. So a failed reload had
  already set the shared session to the starting mode while the kept
  wrapper still showed its own, both wrappers followed the session
  during setup, and a let-go wrapper could still decide an approval it
  was waiting on. Now:

  - `adopt` lets the held wrapper go before anything runs on the session
    they share, and a failed reload leaves nothing held for that id; the
    editor loads it again.
  - A wrapper let go (closed, loaded again, never set up) decides
    nothing more. A late permission answer, form answer or form failure
    is dropped; a late paid-use answer is a denial.
  - A prompt it was running ends `cancelled`, where it never answered
    before.
  - The fake host could not show this, as it made a new session on each
    resume. The reload tests now hand the held one back (`retainOnResume`, `onNextResume`).

- **Grok's second look (`5e2b85c3`): 2 P1, both held.**

  - The agent told the editor a prompt had stopped without stopping its
    turn. Muse Code's `dispose` sends only `task/stopAll`, and a reload
    shares the session, so the turn went on unwatched. `release` (which
    replaces `dispose`) now stops following the session at once, waits
    for a turn still being started, and cancels it on the backend; a
    turn that failed to start has nothing to stop.
  - A load still being set up was not let go by a newer load of the same
    session, so both followed it. `adopt` now keeps the loads being set up
    by id. A newer load or a close lets them go too, and a load let go
    during its setup fails rather than being held.
  - A session let go changes nothing more on the backend (`ensureHeld`
    before each mode, model and effort write and before a replay), so a
    late setup cannot undo what the newer load set.
  - `session/close` of an id neither held nor being set up is refused,
    as before.

- **Grok's third look (`ca263c53`, pushed first as the gate had
  passed): 1 P1 and 6 P2s; the P1 and 3 P2s held, and the test double
  was taken up.**

  - The P1: a reload built its replacement, which follows the session at
    once, before the held one's release had sent `turn/cancel`, so Muse
    Code's open prompts reached the replacement for the turn being
    stopped. `adopt` now waits until nothing holds or sets up that id,
    each turn stopped, before the replacement follows the session. It
    looks again after each wait, as another load may have started.
  - A start that failed may still become a turn: past its 60 s deadline,
    Muse Code's `turn/start` is still running. `release` now cancels
    after any start is answered, failed or not.
  - A released wrapper delivers nothing more to the editor (`deliver`),
    so neither a queued history nor a late tool update goes out.
  - The backend stopping lets go of loads being set up too, and those
    loads fail.
  - The fake session now hands a new listener the prompts still open,
    as `MuseSession.onEvent` does (`openPrompts`). The reload test holds
    the old turn's start, shows the replacement does not follow meanwhile,
    and checks `turn/cancel` goes out before it subscribes.
  - Not changed, with reasons. A failed `turn/cancel` is logged and the
    session still let go: MSP gives the agent no stronger stop through
    `AgentSession`, and a wrapper kept only to listen shows the editor
    nothing. `cancelQuestions` after a released check: no await comes
    between the check (or the event's arrival) and the call, so no
    release can fall in between.

| Drill | Break                                                             | Result                                                                                                      |
| ----- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| N1    | the handle's model trusted again                                  | exit 1: 3 tests, "runs a loaded session on the model the backend reports, never the one its handle …"       |
| N2    | no explicit set where the backend reports no model                | exit 1: 2 tests, "keeps a listed model the backend reports active, and sets the default …"                  |
| R1    | a failed setup keeps the backend session                          | exit 1: 3 tests, "lets a new session go when its effort is refused, and holds nothing"                      |
| R2    | the session held before it is set up                              | exit 1: 3 tests, "lets the held session go before a reload runs on it, and holds nothing …"                 |
| R3    | a handle whose events cannot be followed kept                     | exit 1: "lets a session go whose events cannot be followed"                                                 |
| R4    | the held session let go only once the reload is set up            | exit 1: "lets the held session go before a reload runs on it …", "follows a session loaded again once …"    |
| D1    | a let-go session's late approval decided                          | exit 1: "ends a closed session's prompt cancelled, stops its turn, and its late approval …"                 |
| D2    | a let-go session's late form answered                             | exit 1: "neither answers nor declines a question whose form is answered after its session closed"           |
| D3    | a let-go session's failed form declined                           | exit 1: "… whose form is failed after its session closed"                                                   |
| D4    | a let-go session's late paid-use answer allowed                   | exit 1: "denies a paid use answered after its session closed"                                               |
| D5    | a let-go session's prompt left unanswered                         | exit 1: "ends a closed session's prompt cancelled, …"                                                       |
| D6    | a let-go session's prompt goes on to its turn                     | exit 1: "ends a prompt cancelled when its session is closed while the skills are announced"                 |
| R5    | a load being set up not let go by a newer load or a close         | exit 1: "lets a load still being set up go for a newer load of the same session", "… closes that session …" |
| R6    | a load let go during its last setup step held anyway              | exit 1: "lets a resume go when the editor closes that session while its effort is being set"                |
| H1    | a session let go keeps writing to the backend                     | exit 1: "lets a load still being set up go for a newer load of the same session"                            |
| C1    | a let-go session's turn left running                              | exit 1: 3 tests, "ends a closed session's prompt cancelled, stops its turn, …"                              |
| C2    | the turn cancelled before it started, or when it never did        | exit 1: both "closed while its turn is being started, it …"                                                 |
| C3    | a prompt whose turn fails to start after a close answers an error | exit 1: "… it has nothing to stop when the turn fails to start"                                             |
| X1    | a close of a session not held answered as done                    | exit 1: both "lets a resume go when the editor closes that session while its … is being set"                |
| G1    | the replacement follows before the held turn is stopped           | exit 1: "follows a session loaded again only once its running turn is stopped"                              |
| G2    | a turn whose start failed not stopped                             | exit 1: "closed while its turn is being started, … failed to start"                                         |
| G3    | updates still delivered after a session is let go                 | exit 1: "denies a paid use answered after its session closed"                                               |
| G4    | the backend stopping leaves a load being set up held              | exit 1: "lets a load being set up go when its backend stops, and the load fails"                            |

## Muse Code's review of `4eb0156c..496fdeed`: two findings (2026-09-28)

Codex and Grok Build were both at their usage limits, so the last two fix
rounds were reviewed read-only by Muse Code (`muse-spark-1.3-contributor`,
three classes). Both findings were real and are fixed:

- **P1, a cancel while the turn is starting.** `cancel()` sent the backend's
  stop while `sendTurn` was still waiting for its answer, before the turn
  existed; the turn then ran to its end, editing and billing, while the
  editor was told `cancelled`. `cancel()` now waits for the start to be
  answered (a failed start included) and only then stops the turn, as
  `release()` already did.
- **P2, a cancel for a session not held.** The `session/cancel`
  notification looked the session up with `session()`, which throws for an
  id that is closed, still being set up, or unknown; a notification has no
  answer, so the SDK only printed "Error handling notification". It now uses
  `held()` and stops nothing.

| Drill | Broken                                                 | Result                                                                                        |
| ----- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| C1    | `cancel()` no longer waits for the start               | exit 1: "passes a cancel sent while the turn is starting to the backend once the turn exists" |
| C2    | the notification looks the session up with `session()` | exit 1: "ignores a cancel for a session it does not hold"                                     |

Both restored byte for byte (SHA-256 checked); `acpAgent.test.ts` 61 of 61.

## Final independent review and repair of `46ba5406` (2026-09-29)

The owner authorized completing and merging the existing branches, beginning
with this PR, and parallel independent reviews in separate worktrees. Three
reviewers examined concurrency/lifecycle, boundary/security, and failure/docs/
packaging. The integrator independently reviewed the resulting session and
paid-store repairs; the packaging reviewer separately accepted the integrator's
fixed invocation. Prior green CI and resolved threads did not close these newly
reproduced defects.

| Finding                                                                                                                                       | Repair and observable evidence                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: maps lost the old session while its release awaited turn start/cancel, letting a second reload start and then be cancelled by the old one | A per-session release barrier stays visible; request identity is assigned before resume I/O. Older replies fail instead of replacing the newest owner. Real ACP SDK/MSP regressions hold starts, cancels and out-of-order resumes, including close and backend exit.                                                                                                                           |
| P1: backend exit rejected a completion promise before the prompt awaited it, causing Node's unhandled rejection                               | Completion outcomes are values until observed by the prompt. Host exit during start/preparation fails the request while the process remains alive; the test observes the separate-turn unhandled-rejection event.                                                                                                                                                                              |
| P2: cancelled/completed prompt's late paid answer persisted Allow always; ordinary late forms/approval stages had analogous ownership gaps    | Answers are bound to their captured prompt and current approval stage. Cancellation, completion, replacement and preparation invalidate stale answers before any grant or backend decision.                                                                                                                                                                                                    |
| P2: independent whole-file paid-grant writes restored revoked grants or lost independent additions                                            | `paid-uses.json.d/<feature>/generation.json` contains a validated UUID generation; `<workspaceHash>.<generationUUID>.json` holds that generation's grant. Atomic generation publication/revocation and synchronous before/after reads fail closed. Stale writers cannot replace current-generation records; legacy maps ask again. No lock takeover or unsafe live-record sweep is introduced. |
| P2: Windows npm packaging split an unquoted absolute stage path                                                                               | npm runs with staging `cwd` and fixed `pack --pack-destination ..` arguments. A real checkout fixture with spaces packages successfully; restoring the original invocation fails with npm looking for the split `package/package.json`; restoring bytes packages successfully again.                                                                                                           |
| P2: VSCodium evidence said integration tested an installed VSIX                                                                               | `hosts.md` now identifies development-extension integration and the fork runners' separate VSIX install/list proof. Packaged code-server/Theia evidence retains its recorded scope.                                                                                                                                                                                                            |

The new MSP test helper uses the existing M6 captured resume envelope, trimmed
to required fields, and the real `MuseCodeHost`, `MuseSession` and SDK transport.
No new wire shape, live model attempt or bill was introduced.

Focused lifecycle tests: `vitest run test/unit/acpAgent.test.ts
test/unit/acpModelApi.test.ts`, 89 tests passed. The lifecycle suite has 81 tests,
20 new regressions. Nine disposable production mutations each failed on intended
assertions, then source bytes restored and all 81 tests passed again. They break
release barriers, request ownership, completion observation, late prompt answers,
paid preparation, approval-stage identity, preparing/pre-adopt host exits and
failed-resume claim cleanup. No startup failure, timeout or zero discovery counts
as red proof. Receipt and logs: `temp/pr32-lifecycle-drills/receipt.json` and
its named logs; receipt SHA-256
`e3843a037898f99bd8961cf938f19ab195c9d3d56d026dd26cde4313ec51811d`.
Production session source SHA-256:
`1d2d962cd0ef75b4cf67df203754a6c9c464973acb898db76da8977860e8d5d4`.

Focused paid-store/runtime/model tests: three files, 60 tests passed. Deliberate
production failures prove independent revocation, generation reread, safe first
initialization, generation-specific names and no-overwrite publication. All
mutations were restored byte-for-byte. One initial publication drill first timed
out and was not counted; its rerun failed the actual lost-grant assertion.
Production paid-store SHA-256:
`e1275911f8ae6d5d2fb0cc8d1a087181b6f5312f675a6ef9b5d7fe6c053ee29a`.
The integrator repeated four guards in a disposable copy with retained logs:
`temp/pr32-paid-grant-drills/receipt.json`, baseline/restored and named mutation
logs. All four exited 1 on their intended assertions, all 22 paid tests passed
before and after, and copied/source SHA-256 remained the value above. A targeted
single-case run exposed filesystem mocks relying on earlier cases' teardown;
the suite now installs actual filesystem defaults before every test as well as
restoring them afterward. The earlier load-related timeout and the pre-fix
single-case failure are retained separately and are not red proof.

The integrator's final six-suite run (ACP session, paid, runtime, Model API,
translation and shared consent) passed 184 tests in six files, exit 0. Log:
`temp/pr32-final-review/focused-final.log`. The test-setup correction subsequently
passed the disposable paid suite and all four selected red proofs. New Node
imports made the host API record stale (three occurrence-count rows); the
unchanged gate failed, then `check:host-api -- --write` regenerated only those
rows and the record check passed. Its totals remain 201 VS Code APIs, 13 host
files, 17 Node built-ins and 57 theme variables.

Packaging proof: `temp/pr32-final-review/pack-space-proof.json` and its green,
red and restored logs; exits 0, 1, 0, source bytes restored by SHA-256. This
isolated probe used the existing bundles to verify invocation/path behavior;
fresh final production packaging remains required after the full build.

All scoped host/unit typechecks, zero-warning lint and diff checks passed.
The final staged-tree full quality gate, staged secret scan, production package
and exact-head hosted checks are pending; no merge readiness is claimed yet.

### Candidate gate setup and fixture deduplication

The first full candidate gate stopped at lint because disposable source copies
and runner scripts were still inside the checkout's scan scope. They were moved
with verified absolute paths to the system temporary evidence directory
`muse-goal-evidence-20260929/pr32`; their logs and JSON receipts remain at the
paths above. No ignore, threshold or rule changed. The clean-scratch rerun passed
format, lint, five typechecks, localization, host inventory, dead-code and cycles,
then stopped on eleven duplicated test-setup blocks. Those setups now use shared
fixtures; every assertion and all twenty lifecycle regressions remain. Global
duplication now reports zero clones.

After this refactor, lifecycle 81/81 and paid 22/22 passed. All nine lifecycle
mutations and four retained-log paid mutations were repeated against the final
fixtures: intended assertion failures, exit 1, exact source restoration, then
81/81 and 22/22 restored green. Updated lifecycle receipt:
`temp/pr32-lifecycle-drills/refactored-receipt.json`, SHA-256
`8b6e9f6cf9c58a4d5d163d412264d4c56ae9300d52d1354a0421f1faf38d767d`.
Production source hashes above are unchanged. Final test hashes:
`acpAgent.test.ts` —
`4eae474a6f5e84cdf8f34fc2e18c45dc650117e9797badae172031d27e2282e7`;
`acpPaid.test.ts` —
`4ba4dbcd71838fdaebf6dc76559ea4498723b4352bba4cbeccec7630a9982254`.
The final candidate is restaged and the full gate rerun; earlier failed runs
remain historical evidence, not passing gate receipts.

### Local platform correction (2026-09-29)

Candidate commit `22f62ed17b28c8ee7ae02e160d05c763592e395c`, tree
`4068b25e20d465395e1a50b4ed7d26f23566dbc0`, passed the final Windows-host
`npm run quality` (exit 0: 2,942 tests passed, 23 skipped; 336 accessibility
pages; security gates clear), staged secret scan and fresh production ACP pack.
Hosted Hosts run `36637040694` and Forks run `36637040482` passed that SHA.
CI run `36637041038` passed Linux but failed macOS and Windows: the test
"preserves a newer explicit grant when an old-generation writer finishes last"
timed out at the existing 5,000 ms limit on both platforms.

The integrator reproduced that exact timeout on the Windows host by pointing
only the test child process's `TEMP` and `TMP` at an owned directory junction.
The existing grant was written at its canonical path by `fsAtomic`, while the
test held a rename only at its lexical temporary path. The fixture now resolves
its created directory with `realpathSync`; no production code or timeout changed.
The original selected case exited 1 at 5,000 ms; all 22 paid tests then passed,
exit 0, under the same alias. Logs: the system temporary evidence directory
`muse-goal-evidence-20260929/pr32-temp-alias-958733ff22494f9288a4c7e718be1b0a`,
`original.log` and `fixed.log`, with their process exits. This is a reproduced
test-harness failure, separate from the intended production-mutation red proofs.

The owner's available Mac mini, Kubuntu VM and Windows 11 VM must run the final
candidate before its next push. Independent fixture review, refreshed mutation
proofs, exact-tree full local gates and the next hosted SHA are pending here.

### Windows 8.3 follow-up (2026-09-29)

Commit `74f3c2cf8966f016af849d31b29e23467d8abda0`, tree
`00979a65ffccf001401fc721aab789ad4bdbfbd9`, passed full quality on the Windows
host and VM, Mac mini and Kubuntu, plus nine installed ACP stdio tests on each
rig. Fresh CI `36645658244` passed Linux and macOS but Windows again timed out
in the same paid-grant race. The junction tests had missed real 8.3 aliases.

The native Windows `GetShortPathNameW` read-only probe produced an actual short
path to the owned temporary fixture. JavaScript `realpathSync` retained
`MUSE-G~1/PR32-T~1`; `realpathSync.native` expanded those components. Under that
short `TEMP`/`TMP`, the unchanged committed test reproduced the 5,000 ms timeout
(exit 1). The fixture's native method then passed all 22 paid tests, exit 0.
The atomic writer already uses native resolution through `fs.promises.realpath`;
production code, assertions and timeouts are unchanged.

Retained logs in the same system temporary evidence directory named above:
`short-original.log`, `short-original.exit`, `short-fixed.log`, `short-fixed.exit`.
All four final full gates must rebind to the new candidate. Windows host and VM
use actual short-name temporary paths; the VM also retains its junction case.
The earlier platform and hosted receipts are historical and do not certify the
new fixture. Independent review and final hosted proof remain pending.
