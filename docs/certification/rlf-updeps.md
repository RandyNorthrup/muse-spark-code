# RLF-UPDEPS — every dependency current with its upstream fixes (2026-10-30)

Base `int/recovery` `b781451b9`, branch `rec/rlf-updeps`, rig `linuxlt`
(Node 24.21.0, npm 11.19.0). Scope: everything in `package.json` and the
lockfile except the provider and agent SDKs (RLF-UPPROV / RLF-UPAGENT own
`@muse-code/sdk` and `@agentclientprotocol/sdk`; untouched here), the Node
engine, and the pinned GitHub Actions. Every version below was checked
against the npm registry on 2026-10-30; nothing inside `.npmrc`'s 7-day
`min-release-age` window was taken. No paid or live model call was made.

## Advisories at the start (`npm run security:audit`: 7 advisories, 0 exceptions)

| Advisory                                                                                                             | Package (locked)             | Path                                                                                         | Ships?        | Outcome                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------- |
| GHSA-w74x-v6f9-j3xg (moderate), GHSA-xhq7-xmqj-769h (low), GHSA-wjr9-j795-jxcr (moderate), GHSA-333x-w4r6-6crp (low) | `fast-uri` 3.1.8             | `stylelint > table > ajv > fast-uri`; `ovsx > @vscode/vsce > @secretlint/* > ajv > fast-uri` | No (dev-only) | Fixed: lockfile to 3.1.9 (`e58b79bb9`); the secretlint path disappeared with the ovsx bump     |
| GHSA-gfhx-hw2g-v5hg (low), GHSA-m5mm-p8h7-m29v (low)                                                                 | `serialize-javascript` 7.1.1 | `@vscode/test-cli > mocha > serialize-javascript` (override-pinned)                          | No (dev-only) | Fixed: override to 7.1.3 (`337fdcec9`)                                                         |
| GHSA-6pq8-jhm2-2vcw (moderate)                                                                                       | `qs` 6.16.0                  | `@vscode/vsce > typed-rest-client > qs`                                                      | No (dev-only) | **Open — brief B1**: fix 6.17.0 published 2026-10-27, inside the 7-day window until 2026-11-03 |

Final state: `audit: 1 advisories, 0 exceptions`, exit 0. No advisory is in
a shipped path: every one is reachable only through devDependencies
(`dev: true` in the lockfile; 191 production packages carry none of them).

## Bumps landed (each its own commit, exact pins)

| Package                           | From    | To      | Class                  | Why (upstream)                                                                                                                                                                                                                   | Evidence in this lane                                                                                 | Commit      |
| --------------------------------- | ------- | ------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| `@codemirror/merge`               | 6.12.2  | 6.12.3  | Bug fix                | Side-by-side merge alignment could fail with mis-estimated content height at the viewport start ([CHANGELOG](https://code.haverbeke.berlin/codemirror/merge/raw/branch/main/CHANGELOG.md), 2026-10-19)                           | `npm run build` 0; `vitest related src/webview/node/editor/codemirror.mjs` 4 files / 32 tests pass    | `5ee870c3c` |
| `@napi-rs/keyring`                | 2.1.1   | 2.1.2   | Bug fix (packaging)    | Signed/notarized macOS prebuilds, cargo-auditable embedding; no API change ([v2.1.2](https://github.com/Brooooooklyn/keyring-node/releases/tag/v2.1.2), 2026-10-19)                                                              | Build 0; `vitest related src/runtime/keyStore.ts` 39 files / 367 tests pass (21 skipped pre-existing) | `c8595747d` |
| `react`, `react-dom`              | 19.3.0  | 19.3.1  | Bug fix                | Server Components transport protocol improvement ([v19.3.1](https://github.com/facebook/react/releases/tag/v19.3.1), 2026-10-14); pair moves together (peer `^19.3.1`)                                                           | Build 0, budgets hold                                                                                 | `339f7974a` |
| `vitest`, `@vitest/coverage-v8`   | 5.0.3   | 5.0.5   | Bug fix                | Hook cleanups on later-hook failure, mock release, cancel aborts, snapshot line endings ([v5.0.4](https://github.com/vitest-dev/vitest/releases/tag/v5.0.4), [v5.0.5](https://github.com/vitest-dev/vitest/releases/tag/v5.0.5)) | Suites run under 5.0.5 throughout this lane                                                           | `f4830dfc8` |
| `eslint`                          | 10.12.0 | 10.13.0 | Feature + fix          | IIFE references in `no-use-before-define`, `globalThis` in `no-obj-calls`, `yield*` checks; `no-var`/`one-var` autofix fix ([v10.13.0](https://github.com/eslint/eslint/releases/tag/v10.13.0), 2026-10-16)                      | ESLint slice (`src/shared`, `src/core/agent`) exit 0                                                  | `2da6c51ad` |
| `typescript-eslint`               | 8.71.1  | 8.72.0  | Feature + fix          | Lazy rule loading, `allowMixedPromiseArrays`, rule fixes ([v8.72.0](https://github.com/typescript-eslint/typescript-eslint/releases/tag/v8.72.0), 2026-10-19); peer still `typescript <6.1.0`                                    | ESLint slice exit 0                                                                                   | `1353a9740` |
| `jsdom`                           | 30.1.2  | 30.1.3  | Security-adjacent fix  | XHR no longer reuses credentials/cookies across cross-origin redirects; v30.1.2 focus slowdown fixed ([v30.1.3](https://github.com/jsdom/jsdom/releases/tag/v30.1.3), 2026-10-15)                                                | `Palette.test.tsx` 21 tests pass                                                                      | `b4ef9a241` |
| `knip`                            | 6.41.0  | 6.42.1  | Bug fix                | Plugin fixes incl. vitest default entries ([6.42.0](https://github.com/webpro-nl/knip/releases/tag/knip%406.42.0), [6.42.1](https://github.com/webpro-nl/knip/releases/tag/knip%406.42.1))                                       | `npm run deadcode` exit 0                                                                             | `674caa49f` |
| `npm-run-all2`                    | 9.0.3   | 9.0.4   | Bug fix                | Explicit `nodeRun` options honored; placeholder regex state dropped; shell-quote bump ([v9.0.4](https://github.com/bcomnes/npm-run-all2/releases/tag/v9.0.4), 2026-10-21)                                                        | `run-s typecheck:e2e typecheck:integration` exit 0                                                    | `aec2a353d` |
| `ovsx`                            | 1.2.0   | 1.3.0   | Security fix + feature | Token no longer leaks via URL query strings into errors/logs; request timeouts; atomic downloads; new commands ([cli-1.3.0](https://github.com/eclipse-openvsx/openvsx/releases/tag/cli-1.3.0), 2026-10-16)                      | `ovsx --version` 1.3.0; lockfile shed the bundled vsce 3.9.2 tree                                     | `f3d04c519` |
| `playwright-core`                 | 1.64.0  | 1.64.1  | Bug fix                | Electron first-window loss; Chromium 155+ preflight redirect abort ([v1.64.1](https://github.com/microsoft/playwright/releases/tag/v1.64.1), 2026-10-14)                                                                         | Module loads; harness-only consumer                                                                   | `1c3434efa` |
| `jscpd`                           | 5.4.1   | 5.4.2   | Bug fix + feature      | Consistent renaming, boundary rules, Markdown front-matter crash (exit 134) fix ([v5.4.2](https://github.com/kucherenko/jscpd/releases/tag/v5.4.2), 2026-10-20); our gate uses neither affected flag and pins its pattern        | `npm run duplication`: 0 clones, exit 0                                                               | `f183f3d6c` |
| `serialize-javascript` (override) | 7.1.1   | 7.1.3   | Security fix           | GHSA pair above (7.1.3, 2026-10-22)                                                                                                                                                                                              | Serialized `</script>` escapes; audit drops both                                                      | `337fdcec9` |
| `fast-uri` (transitive)           | 3.1.8   | 3.1.9   | Security fix           | GHSA set above (3.1.9, 2026-10-19), inside ajv's `^3.0.1`                                                                                                                                                                        | `npm ls fast-uri` single 3.1.9                                                                        | `e58b79bb9` |
| `ink`                             | 6.3.1   | 8.0.0   | Breaking (small here)  | See brief B4 — landed ([v7.0.0](https://github.com/vadimdemedes/ink/releases/tag/v7.0.0), [v8.0.0](https://github.com/vadimdemedes/ink/releases/tag/v8.0.0))                                                                     | 201 TUI tests incl. real-Ink goldens pass; typecheck:host 0; build 0                                  | `92b175c16` |

Notices and legal records: `npm run notices` regenerated
`THIRD_PARTY_NOTICES.txt` with no content change (93 packages; licenses
unchanged by these version moves), and every production build re-ran
`check-legal-build-records` (162 bundles, 0 problems; findings 149 → 148
as ink 8 dropped its `ws` dependency).

## GitHub Actions (`.github/workflows/*.yml`, SHA-pinned)

Current already (latest release = pin): `actions/checkout` v7.0.1,
`actions/setup-node` v7.1.0, `actions/upload-artifact` v7.0.2,
`actions/download-artifact` v8.0.2, `actions/cache` v6.1.0,
`actions/attest-build-provenance` v4.2.2,
`actions/create-github-app-token` v3.3.0, `sigstore/cosign-installer`
v4.1.2, `gitleaks/gitleaks-action` v3.0.0, `aquasecurity/trivy-action`
v0.36.0.

Landed in `1f23e3ca6`:

- `actions/setup-python` v7.0.0 → v7.1.0 (2026-10-22; additive mirror
  inputs) in build/forks/hosts.
- `node-image.yml` aligned to the SHAs every other workflow already runs:
  setup-node v7.0.0 → v7.1.0, download-artifact v8.0.1 → v8.0.2,
  upload-artifact v7.0.1 → v7.0.2 (429 `Retry-After` handling).
- `docker/login-action` Jan-2026 commit → v4.7.0 and
  `docker/setup-buildx-action` v3 → v4.4.1. The v4 majors are the Node 24
  runner-runtime move; the inputs used here
  (`registry`/`username`/`password`; `version`/`driver-opts`) are
  unchanged in the v4 `action.yml` files (read 2026-10-30). These run
  only in `node-image.yml`; **hosted CI is their proof** — this lane
  validated YAML syntax and `check:workflow-scripts` (exit 0) only.

Runner images: all jobs use `-latest` aliases or `ubuntu-24.04` /
`ubuntu-24.04-arm`. `ubuntu-latest` rolls to Ubuntu 26.04 between
2026-10-19 and 2026-11-19 (actions/runner-images#14747) with no workflow
change needed; `ubuntu-24.04` stays a supported GA image. The macOS 14
image retirement (2026-11-02) does not touch `macos-latest`. All pinned
actions now run on the Node 24 action runtime (the two docker v3 pins
were the last Node 20 ones).

## Node

Engine stays `>=22`; CI `node-version: 22` resolves the newest 22.x
(22.23.4, 2026-10-20). Node 26 entered LTS on 2026-10-28 ("Lithium",
26.13.0); Node 24 LTS ("Krypton") is in maintenance until 2028-04-30;
Node 22 reaches end-of-life 2027-04-30
([release schedule](https://github.com/nodejs/release/blob/main/schedule.json)).
Raising the engine floor drops Node 22 users of the ACP agent, so it is
not a dependency-lane call: brief B5 recommends a scheduled move (CI to
24 first, engine floor before 2027-04-30). Nothing we rely on changes
between 22 and 24 for the shipped bundles; dev tools increasingly
require `^22.22.2 || ^24.15.0` (jsdom 30, npm-run-all2 9), which the
floating CI `22` already satisfies. `node-image.yml` pins setup-node
24.18.0 exactly (newest 24.x is 24.22.2); that pin feeds the home-node
image build and is left to the node lane (brief B5).

## Briefs (not landed, with the exact next step)

### B1 — `qs` 6.16.0 → 6.17.0 (GHSA-6pq8-jhm2-2vcw, moderate, dev-only)

`qs.stringify` with `arrayFormat: 'comma'` throws on elements with a
non-callable own `toString`. Reached only via `@vscode/vsce >
typed-rest-client` at package time; nothing ships and no code path here
feeds it untrusted objects. The fix, 6.17.0, was published 2026-10-27
and clears the 7-day window on **2026-11-03**. Next step on or after
that date: `npm update qs` (typed-rest-client allows `^6.9.1`), re-run
`npm run security:audit` (expect 0 advisories), commit the lockfile.

### B2 — `eslint-plugin-unicorn` 77.0.0 → 79.0.0 (two majors; needs its own lane)

Trialled 2026-10-30 and reverted (drill D1). v78 makes rules report code
containing comments and adds rules; v79 re-scopes
`no-top-level-side-effects` (breaking) and widens several rules
([v78.0.0](https://github.com/sindresorhus/eslint-plugin-unicorn/releases/tag/v78.0.0),
[v79.0.0](https://github.com/sindresorhus/eslint-plugin-unicorn/releases/tag/v79.0.0)).
This repo spreads `unicorn.configs.recommended.rules`, so the majors
surface new errors repo-wide: 10 errors + 8 warnings in a three-folder
slice alone (`prefer-includes-over-repeated-comparisons`,
`no-negated-condition`, `prefer-combined-guards`, stale
`prefer-string-raw` disables). Landing it means fixing real reports file
by file (some need judgement, e.g. guard combining changes evaluation
order reading), never by switching rules off. Recommendation: a
dedicated lint lane that bumps to 79, fixes every report, and re-proves
the full lint gate; until then 77.0.0 stays.

### B3 — `vscode-jsonrpc` 9.0.3 → 10.0.0 (major; test-only, unproven here)

Only consumer: `test/unit/runtimeLsp.test.ts` (five imports from
`vscode-jsonrpc/node`). 10.0.0 (2026-10-22) keeps every one of those
exports — `typecheck:unit` passes on it — and its monorepo changes are
connection-close/onClose and `RAL().crypto.randomUUID()` work
([release](https://github.com/microsoft/vscode-languageserver-node/releases/tag/release/jsonrpc/10.0.0)).
The proof suite cannot run in this lane's sandbox on either version
(drill D2), so the bump is held rather than landed unproven. Next step:
bump on a branch whose hosted CI runs `runtimeLsp` and land it with that
green run as the record. No security fix waits on this.

### B4 — `ink` 6.3.1 → 8.0.0 (landed; migration notes)

v7 (2026-04-08): Node 22 + React 19.2 minimums (met); Backspace now
reports `key.backspace`, plain Escape no longer sets `key.meta`.
v8 (2026-10-03): React 19.3 minimum (met by 19.3.1); stdio typed as
generic streams; unknown control sequences dropped from `useInput`;
`ws` dependency dropped. Production never imports ink directly — it
renders through the `InkBinding` port (`src/runtime/tui/view.ts`:
Text/Box/render) and decodes raw input itself, and the controller
already accepts `key.backspace || key.delete`
(`src/runtime/tui/controller.ts`). The real-Ink harness
(`test/harness/tui/renderer.ts`) and all 201 TUI tests pass unchanged,
goldens included, so no code change was needed.

### B5 — Holds that are correct as-is (no action until the named trigger)

- `typescript` 7.0.2: blocked while `typescript-eslint` (8.72.0
  verified 2026-10-30) declares `typescript: ">=4.8.4 <6.1.0"` — TS 7
  silently disables type-aware lint (PLAN.md D3). Trigger: a
  typescript-eslint release whose peer admits 7.x.
- `@types/node` 26.6.5: types must describe the engine floor. 22.20.5
  is the newest 22 line and matches `>=22`. Trigger: the engine-floor
  move above, then take the matching types major (24.19.2 today).
- `@types/vscode` 1.140.0: types must match `engines.vscode ^1.99.0`;
  newer types would bless APIs the minimum editor lacks. Trigger: an
  `engines.vscode` raise.
- Inside the 7-day window today, queued for the next sweep: `knip`
  6.43.0 (2026-10-24) / 6.44.0 (2026-10-29), `ovsx` 1.3.1 / 1.3.2
  (2026-10-24/27), `@types/node` 26.6.6 (2026-10-28, also B5-held).
- Finding: PLAN.md D3's table ("verified 2026-09-21") no longer matches
  `package.json` for several rows (it pre-dates this lane's base, e.g.
  eslint 10.11.0 vs 10.12.0 pinned). Left untouched here; refreshing it
  is a docs decision for the lead.

## Drills (red → green, observed in this lane)

- **D1 (unicorn trial):** with `eslint-plugin-unicorn@79.0.0` installed,
  eslint over `src/shared src/core/agent src/runtime/tui` reported
  **18 problems (10 errors, 8 warnings)** — red. Reinstalled 77.0.0,
  restored the committed lockfile (`git restore package.json
package-lock.json`), `npm ci` exit 0, same slice **exit 0** — green.
- **D2 (jsonrpc base vs bump):** `test/unit/runtimeLsp.test.ts` under
  10.0.0 produced no test output in 14 minutes (worker at ~1 s CPU) and
  was terminated; the identical run under the base 9.0.3 stalled the
  same way (8m15s, 1 s CPU, no child `dist/acp.js` in `ps`). The stall
  is this sandbox (no session bus: `DBUS_SESSION_BUS_ADDRESS` points at
  `/nonexistent/...`), **not** the bump — measured on both versions.
  The suite's proof belongs to hosted CI; no workaround was built.
- **D3 (audit):** start of lane `7 advisories, 0 exceptions`; after
  `337fdcec9` + `e58b79bb9`, `1 advisories, 0 exceptions` (qs, B1).

## Final gates on the finished tree (2026-10-30, this rig)

Recorded in the lane's final message with exit codes: `npm ci`,
prettier on touched files, eslint slice, full `typecheck`,
`check-l10n`, `check:reference`, `check:host-api`, `check:plan`,
`check:roadmap`, `check:catches`, `cycles`, `deadcode`, `duplication`,
`build`, `security:audit`, SAST, per-bump related suites above, and
`node scripts/package-vsix.mjs --target linux-x64`. Whole-repo lint and
the full unit battery stay with hosted CI, per the shared rules.
