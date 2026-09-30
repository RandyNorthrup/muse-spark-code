# PR #61 — compatible grouped development dependencies

## Scope and readiness

The grouped Dependabot update moved four development dependencies; three of
them are taken here and TypeScript is held. Original Dependabot head
`6155ada003931c8e06b79b95fec4ee47edbb6b19` is preserved locally as
`origin/pr61-preserved`. The isolated integration starts at main
`327094412dac315b1f8dcf971b014c6c69b27104`. The checks run on the Windows
host are recorded below; the exact-commit full gate on a rig, the other
platforms and hosted CI are the pull request's own proof.

| Dependency                 | Change          | Registry compatibility checked 2026-09-30                                                       |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/sdk` | 1.4.0 → 1.5.0   | zod peer `^3.25.0 \|\| ^4.0.0`; current 4.6.5 fits. No `engines` field.                         |
| `jsdom`                    | 30.1.0 → 30.1.1 | Same Node floor: `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`. Optional canvas peer remains `^3.2.3`. |
| `prettier`                 | 3.9.8 → 3.9.9   | Node >=14; no peers.                                                                            |
| `typescript`               | Keep 6.0.3      | Grouped 7.0.2 rejected: `typescript-eslint@8.70.1` accepts `>=4.8.4 <6.1.0`. No peer override.  |

Dependabot is told to stop proposing it: `.github/dependabot.yml` ignores
TypeScript major updates, with the reason beside the entry, and
`test/unit/manifest.test.ts` fails when the entry disappears while the pin is
6.0.x. 6.0.3 is the last 6.x release, so a major is the only update there is.
The two ignores already in that file are still right: `@types/vscode` (the
manifest test holds its minor equal to `engines.vscode`, 1.99) and the
`@types/node` major (22, the Node the workflows and `engines` use).

Primary release sources:

- [ACP SDK 1.5.0](https://github.com/agentclientprotocol/typescript-sdk/releases/tag/v1.5.0):
  updates schemas to 1.23.0 and 2.0.0-alpha.5. Published classic ACP
  implementation, connection and stream modules were compared with 1.4.0;
  existing application imports stay on v1. New optional notices are neither
  emitted nor advertised here. No new external shape or v2 support is claimed.
- [jsdom 30.1.1](https://github.com/jsdom/jsdom/releases/tag/v30.1.1):
  focus, CSS, parsing and selector fixes, including a focus regression in
  30.1.0. Webview tests and accessibility gates must exercise the resulting
  development environment; this package is not a product runtime dependency.
- [Prettier 3.9.9](https://github.com/prettier/prettier/releases/tag/3.9.9):
  fixes Markdown dollar-sign parsing. Keep existing formatting gate unchanged.

## Lock and source inspection (2026-09-30)

The compatible lock was rebuilt from main's existing lock with only the
three approved exact pins. This removes TypeScript 7's optional platform
packages and avoids its unrelated ESLint dependency relocation. Main's
TypeScript 6.0.3 and ESLint 8.70.1 dependency records remain unchanged.
Besides the three direct upgrades, jsdom changes its own encoding sniffer
to 7.0.0 and XML serializer to 6.0.0. The application's direct encoding
sniffer 6.0.0 used by the bundled page worker stays intact; no host, worker
or ACP application source changed. At preparation `npm audit --json` reported
zero vulnerabilities, and the locked-only install ran with scripts disabled.

Detailed original archive, registry JSON, SDK tarballs and byte comparison,
first lock attempt and resulting minimal lock inspection are retained under
the external `pr61-compatible-source-20260930` evidence directory.

## What ships, and on which Node

- **Nothing in the `.vsix` changes.** The SDK, jsdom and Prettier are
  development dependencies, and `vsce ls` lists only `dist/extension.js`,
  `modelApi.js`, `pageWorker.js`, `planMarkdown.js` and `searchWorker.js`: none
  holds the SDK. The extension keeps its VS Code 1.99 floor (Node 20.18.3,
  esbuild target `node20.18`).
- **The SDK is bundled into the ACP agent alone**, `dist/acp.js` (esbuild
  target `node22`, package `engines.node` `>=22`). The metafile shows the
  classic modules only (`acp.js`, `jsonrpc.js`, `stream.js`, `schema/*`,
  `schema-deserialize.js`, `line-buffer.js`: 54,932 of 800,229 bytes); the
  v2 entry and the examples are not reachable. The 1.5.0 differences that land
  in the bundle are the optional `notice` update and `notices` capability in
  `schema/zod.gen.js`. `dist/acp.js` is 781.5 KiB against its 850 KiB budget.
  The ACP package's one runtime dependency, `@napi-rs/keyring`, is unchanged.
- **Development Node floors are unchanged.** jsdom 30.1.1 keeps 30.1.0's
  `^22.22.2 || ^24.15.0 || >=26.0.0`; its new `w3c-xmlserializer` 6.0.0 asks
  the same (5.0.0 asked `>=18`) and its nested `html-encoding-sniffer` 7.0.0
  asks `^22.13.0 || >=24.0.0`, looser than jsdom's own. Every workflow runs
  Node 22 and dev machines run 24, so `.npmrc`'s `engine-strict` admits the
  lock as before.

## Verification on this branch (2026-09-30)

Windows 11 host, Node 24.20.0, npm 11.19.0, branch
`integrate/pr61-compatible-on-main327` on main `32709441` with the tree
`d648546e240dd33309dd60f56d5183eb3edf27f6` for the dependency commit.

| Check                                                                                                              | Result                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                           | exit 0, 901 packages; resolves TypeScript 6.0.3, typescript-eslint 8.70.1, SDK 1.5.0, jsdom 30.1.1, Prettier 3.9.9  |
| `npm run typecheck` (host, webview, unit, e2e, integration)                                                        | exit 0                                                                                                              |
| `npm run lint` (ESLint zero warnings, stylelint, PSScriptAnalyzer)                                                 | exit 0, PSScriptAnalyzer findings 0                                                                                 |
| `npm run format:check`                                                                                             | exit 0 under Prettier 3.9.9: no file needed reformatting, so there is no sweep                                      |
| `vitest run`, the whole suite once, no coverage                                                                    | exit 0: 221 files passed, 2 skipped; 3,436 tests passed, 27 skipped                                                 |
| ACP suites (`acpAgent`, `acpModelApi`, `acpPaid`, `acpProxyWarning`, `acpRuntime`, `acpTranslate`, `acpStdio.e2e`) | exit 0: 7 files, 211 tests, the e2e over the agent's real stdio included                                            |
| webview tests under jsdom 30.1.1                                                                                   | in the whole-suite run above, no failure                                                                            |
| `npm run security:audit`                                                                                           | exit 0: one advisory, none high or critical, no exception (see below)                                               |
| `npm run build`                                                                                                    | exit 0: every budget, the bundle split, host globals and `THIRD_PARTY_NOTICES.txt` (81 bundled packages, unchanged) |
| `npm run package:acp`                                                                                              | exit 0: `muse-spark-code-acp-0.9.1.tgz`, 778.3 kB, 24 files                                                         |

The audit reports one low advisory, GHSA-gfhx-hw2g-v5hg in
`serialize-javascript` 7.1.1 (mocha through `@vscode/test-cli`). It is not in
this lock delta, which touches only the SDK, jsdom, Prettier,
`w3c-xmlserializer` and jsdom's nested `html-encoding-sniffer`; the canonical
policy (high and critical) passes. Raw `npm audit` counts two low, the package
and the path to it.

### Drills (AGENTS.md rule 3)

The new guard is `toolchain pins (AGENTS.md)` in `test/unit/manifest.test.ts`.

| Break                                                                                                                                              | Result                                                                                                     | Restore (SHA-256 before the break and after the restore, equal)    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `.github/dependabot.yml` without the `typescript` ignore, main's file (SHA-256 `e3bca7ffef07be3d4bc557d7c5c52bba1ce2c1c523b82e3d5fd4f4ac817ab339`) | `vitest run test/unit/manifest.test.ts` exit 1, `1 failed \| 20 passed`: the ignore pattern does not match | `25d2312be80b6b4698332be604f157ecdc4e5be194a25ca6e97560e6464fb993` |
| `package.json` `"typescript": "7.0.2"` in place of `6.0.3` (SHA-256 `f06208f714bdd66bb85b434bb06884cf018390256ec242d79bd1ac5d31bca7b6`)            | exit 1, `1 failed \| 20 passed`: `expected '7.0.2' to match /^6\.0\.\d+$/`                                 | `917d0e9c5a5bd9acd0606c4871473cb18c702f004ba3a6442e9c5726569006ca` |

## Left for the pull request

Independent review of the staged diff, the exact-commit full `npm run quality`
on the rigs (Kubuntu for this branch; Mac mini and Windows 11 VM as the
release plan asks), and hosted CI on the exact head. Existing captures remain
evidence of their captured shapes only; any newly implemented wire capability
would need its own genuine capture. No models, real credentials or paid calls
ran. Primary 0.10 release has scheduling priority.
