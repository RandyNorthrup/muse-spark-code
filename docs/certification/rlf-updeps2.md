# RLF-UPDEPS2 — every other dependency at its newest, with the release wait gone (2026-11-02)

Base `rv/int9` `72d8d5003`, branch `rec/rlf-updeps2`, rig `linuxlt`
(Node 24.21.0, npm 11.19.0). Scope: everything `npm outdated` lists
except the agent SDKs (RLF-UPSDK's: `@muse-code/sdk`,
`@agentclientprotocol/sdk`) and `eslint-plugin-unicorn` (done on
`rlf-unicorn79`: left alone here), plus Electron, the desktop's Rust
crates, the pinned Hyprland, GitHub Actions pins and Node's CI
version. The owner removed the 7-day release wait until the planned
features are in (D260, owned by RLF-UPSDK, not landed on this base):
every npm command below ran with `--min-release-age=0` and `.npmrc`
is untouched. No paid or live model call was made.

## Bumps landed (each its own commit, exact pins)

| Package                                 | From            | To              | Changelog read                                                                                                                                                                                                           | What changed for us                                                                                                                                                                                                                       |
| --------------------------------------- | --------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qs` (lockfile)                         | 6.16.1          | 6.17.1          | Upstream CHANGELOG: 6.16.2, 6.17.0 (WHATWG `stringify` format, filter/`__proto__`/dot/`allowEmptyArrays` fixes), 6.17.1 (astral-entity, `plainObjects`, sparse-limit, depth-0 prototype-guard fixes)                     | Closes RLF-UPDEPS brief B1. Single deduped copy under express 5.3.0's `^6.16.0` and typed-rest-client's `^6.9.1`. No behaviour we depend on changed.                                                                                      |
| `knip`                                  | 6.42.1          | 6.44.1          | Releases 6.43.0 (2026-10-24), 6.44.0 (2026-10-29), 6.44.1 (2026-10-31): tsconfig-reference, ambient-module and Vitest-project following; script/manifest resolution; warm-cache and plugin fixes                         | Dev-only gate. `npm run deadcode` exits 0 with hints only, as on the base.                                                                                                                                                                |
| `eslint`                                | 10.13.0         | 10.14.0         | v10.14.0 (2026-10-30): `func-name-matching` descriptor handling; `no-restricted-globals` / `no-invalid-this` / `yoda` crash and autofix fixes; minimatch floor                                                           | The touched rule is not enabled in this repo's config. Full `npm run lint:js` (main, unit, tests) exits 0 with zero warnings.                                                                                                             |
| `typescript-eslint`                     | 8.72.0          | 8.72.1          | v8.72.1 (2026-10-26): rule crash fixes only                                                                                                                                                                              | Peer still `typescript >=4.8.4 <6.1.0`, so the TypeScript 7 hold stands. Slice lint over `src/shared` + `src/core/agent` exits 0.                                                                                                         |
| `vitest`, `@vitest/coverage-v8`         | 5.0.5           | 5.1.0           | v5.1.0 (2026-11-02): additive (`--last-failed`, `--since-last-run`, Temporal fake timers, per-attempt results, snapshot review, browser trace work)                                                                      | Peers accept vite 8.3.4 and `@types/node` 22.20.5. Every later lane suite runs on 5.1.0.                                                                                                                                                  |
| `@modelcontextprotocol/sdk`             | 1.32.1          | 1.32.2          | 1.32.2 (2026-10-23): explicit `\| undefined` on Transport optionals; register-after-connect when declared                                                                                                                | Type-only change is compatible with `exactOptionalPropertyTypes`: full typecheck exits 0; mcpParse/mcpVerdicts/mcpEra pass (42 tests).                                                                                                    |
| `@vscode/vsce`                          | 4.0.0           | 4.1.0           | v4.1.0 (2026-10-28): OIDC publishing help, `X-Market-CI-Provider` header, OIDC token-exchange alignment, audit fixes                                                                                                     | None of the changed paths is one this repo uses (`listFiles`/`pack`/ReadmeProcessor). `check-badges` exits 0; both package builds re-prove `pack`.                                                                                        |
| `oidc-provider`, `@types/oidc-provider` | 9.12.2 / 9.12.1 | 9.13.3 / 9.13.1 | 9.13.0–9.13.3 (2026-10-22/27/28/29): attestation draft-12, key attestations without issuer, contacts fix, resource scopes at issuance, extensible claim validation                                                       | Surfaces used here (`Provider`, `errors`, `interactionPolicy`, `Configuration`, `Adapter`) unchanged: host typecheck exits 0, module loads. Connector runtime suites stay with hosted CI (drill D2).                                      |
| `parse5`                                | 8.0.1           | 8.1.0           | v8.1.0 (2026-11-01): additive APIs (adapter context, `InsertionMode`, token flushing), tokenizer perf, three spec fixes, entities 9.0.0                                                                                  | Converter suites pass unchanged (html, htmlCharset, webFetchBomb: 54 tests); `check-badges` exits 0. entities 9 nests under parse5 while unicorn holds top-level 8, so `check-bundle-split.mjs` now names the nested path (drill D1).     |
| `mdast-util-to-markdown`                | 2.2.0           | 2.2.1           | 2.2.1 (2026-10-27): serialization edge fixes (definition-forming links, tight lists, ampersands, attention) + text perf                                                                                                  | Plan reader suites pass unchanged (planDocument, planStore: 21 tests).                                                                                                                                                                    |
| `tuf-js`, `@tufjs/models` (lockfile)    | 6.0.0 / 5.0.0   | 6.0.1 / 5.0.1   | 2026-10-29: delegated-metadata re-verification, unparseable-`expires` rejection, RSA-PSS/ECDSA verification fixes                                                                                                        | Security patches in the pack-verification chain, within `@sigstore/tuf`'s `^6.0.0`. nodePacksVerify + manifest pass (44 tests).                                                                                                           |
| `electron`                              | 45.0.0          | 45.2.1          | v45.1.0 (2026-10-27: preload filtering, Linux D-Bus crash fix, asar fixes, Chromium .49, Node 24.22.1), v45.2.0 (2026-10-30: menu colours, storage.sync, `net.fetch` perf), v45.2.1 (2026-10-31: Chromium .75 backports) | No breaking API change. Lane WB's proof re-ran: desktop suites green (15 tests), real-Electron smoke PASS under Xvfb, `package:desktop` assembles with WB's fuses reading back, IME flags re-captured (45.2.1 / 156.0.8078.75 / 24.22.1). |

Commits, oldest first: `ad2e52414` (qs), `1a377f4bd` (knip),
`0eaacc65c` (eslint), `3e772a8b5` (typescript-eslint), `7bd46c46b`
(vitest pair), `f7a79f129` (MCP SDK), `76392bb23` (vsce),
`b8cc0a670` (oidc pair), `1ff8b53cb` (parse5), `a2834b98b` (mdast),
`c9add01a1` (tuf-js), `64301042c` (electron + WB proof + PLAN
status), `4d20f18e2` (Actions).

Notices and legal records: `THIRD_PARTY_NOTICES.txt` regenerates
byte-identical (134 notices); `check-legal-build-records` reports
184 bundles, 0 problems (151 findings, informational, build exits
0). No budget moved: every bundle holds, including the pageWorker
bundle carrying parse5/entities 9.

## GitHub Actions (SHA-pinned; every pin verified against its release tag)

Already latest everywhere RLF-UPDEPS left them; three workflows
landed after it still carried older pins and are aligned in
`4d20f18e2`: `hosts.yml` (setup-node v7.0.0 → v7.1.0 ×2,
upload-artifact v7.0.1 → v7.0.2 ×2), `publish-thonny.yml`
(setup-python v7.0.0 → v7.1.0 ×2, upload-artifact v7.0.1 →
v7.0.2, download-artifact v8.0.1 → v8.0.2), `thonny.yml`
(setup-python v7.0.0 → v7.1.0 ×2, upload-artifact v7.0.1 →
v7.0.2). All thirteen pinned actions resolve to their newest
release and every pinned SHA equals the tag's commit (trivy's
annotated tag peeled to its commit). YAML parses;
`check:workflow-scripts` exits 0; hosted CI proves the runs.

## Node

Engine stays `>=22`; every workflow's `node-version: 22` resolves
the newest 22.x. Raising the floor is still not a dependency-lane
call (RLF-UPDEPS B5): it drops Node 22 users of the ACP agent.
`node-image.yml`'s exact 24.18.0 pin and `os/pins.json`'s node
24.18.0 stay with the node lane.

## Hyprland

Held by the plan's pin rule: Debian 13 backports 0.55.2, frozen
by OS1's snapshot pinning (`Snapshot=20261005T000000Z` in
`os/mkosi.conf`; PLAN M111: one version per image). Moving the
snapshot rebuilds the whole image package set — an OS lane
decision, not a dependency bump. No version pin for Hyprland
exists anywhere else in the repo (only the generated Lua table).

## Desktop Rust (`desktop/crates`)

Direct dependencies are already newest (verified against
crates.io 2026-11-02): ICU4X `icu_calendar/datetime/decimal/locale`
2.4.0 and `fixed_decimal` 0.7.3 are each their `max_stable_version`;
the tokens crate has no dependencies. With a fresh index,
`cargo update --dry-run` locks 0 packages; `cargo audit` scans 50
crate dependencies with 0 vulnerabilities; `cargo deny check
advisories bans` (deny 0.19, lane-local temp config — no
`deny.toml` ships in the repo, so license/ban policy stays a docs
decision) reports advisories ok, bans ok; `cargo test --locked`
passes (l10n 5, tokens 4). `cargo-outdated` is not installed on
this rig and compiling it would only re-confirm the two signals
already measured (registry-newest direct deps, zero-move fresh
update); it was not installed. No lockfile changed, so Rust is
record-only in this lane. (`hosts/zed/Cargo.toml` is a host
adapter, not the desktop's, and is out of scope.)

## Advisories (`npm run security:audit`: 2 notes at start, 2 notes at end, exit 0)

`GHSA-mrwp-f3q8-3g9p` (follow-redirects, seen by RVHOSTS2 on an
older base) is not in this tree at all. The `qs` advisory from
RLF-UPDEPS brief B1 is not flagged on the base's 6.16.1 either;
6.17.1 lands B1's fix plus the later parse fixes. What remains:

- `GHSA-g3hv-75wg-m249` (moderate, minimatch globparts DoS):
  minimatch 10.2.6 is bundled into `dist/packsVerify.js` through
  `@sigstore/tuf` → tuf-js → `@tufjs/models` (measured in the
  built bundle; the VSIX does not carry packsVerify, the ACP
  package does). The matched patterns come from our own signed
  TUF metadata, not from untrusted input, so there is no
  owner-reachable trigger. No newer release allows a fix:
  `@tufjs/models` 5.0.1 (taken above) still requires minimatch
  `^10.2.6`; clearing it needs a models major on minimatch 11
  plus tuf-js and `@sigstore/tuf` majors, none of which exist.
  A major-range override would be unverified surgery on the
  trust chain and was not done. Held — brief H1.
- `GHSA-3g3m-2fjr-6pw4` (moderate, glob AbortSignal bypass):
  every glob copy is dev-only (`dev: true`: mocha 10.5.0 and
  c8/test-exclude 13.0.6 under `@vscode/test-cli`, dpdm). Fixed
  in glob 14.0.2+, which needs parent majors: mocha 12 still
  takes glob 13, and `@vscode/test-cli` (already latest,
  0.0.15) pins the whole chain. No newer release of any direct
  dependency clears it. Held — brief H2.

## Holds and deferred briefs

- **H1 — minimatch 10.x → 11 (GHSA-g3hv-75wg-m249).** Trigger: a
  `@tufjs/models` release on minimatch 11 (then tuf-js and
  `@sigstore/tuf` majors). Next step: take the chain, re-run
  nodePacksVerify + manifest, confirm the built packsVerify
  bundle carries minimatch ≥11.0.1.
- **H2 — glob → 14.0.2+ (GHSA-3g3m-2fjr-6pw4).** Trigger: parent
  majors that admit glob 14 (mocha, c8/test-exclude via a newer
  `@vscode/test-cli`, dpdm). Next step: take them, re-run
  `npm run security:audit` (expect 1 note, then 0 with H1).
- **H3 — `typescript` 6.0.3 → 7.0.2.** Still blocked:
  typescript-eslint 8.72.1 declares `typescript >=4.8.4
<6.1.0`, and TS 7 would silently disable type-aware lint
  (PLAN.md D3). Trigger: a typescript-eslint release whose peer
  admits 7.x.
- **H4 — `@types/node` 22.20.5, `@types/vscode` 1.99.0.** Types
  must describe the engine floor (`>=22`) and `engines.vscode
^1.99.0`. Trigger: an engine-floor or editor-floor move.
- **H5 — other lanes'.** `@muse-code/sdk` 1.4.12 → 1.4.14 and
  `@agentclientprotocol/sdk` 2.0.1 → 2.4.0 are RLF-UPSDK's;
  `eslint-plugin-unicorn` 77.0.0 → 79.0.0 is `rlf-unicorn79`'s.
  Untouched here. (`vscode-jsonrpc` 10.0.0, RLF-UPDEPS brief B3,
  already landed on this base via RLF-LSPBUS with its own proof;
  its `runtimeLsp` suite stalls in this sandbox on both jsonrpc
  versions — RLF-UPDEPS drill D2 — so it stays with hosted CI.
  `ovsx` 1.3.1/1.3.2, queued by RLF-UPDEPS, no longer exist on
  the registry; 1.3.0 is latest.)
- **H6 — Node engine floor and Hyprland snapshot.** As above:
  not dependency-lane calls.
- **PLAN.md D3's table** ("verified 2026-09-21") still pre-dates
  the base for several rows (RLF-UPDEPS §B5). Left untouched;
  refreshing it stays a docs decision for the lead. The M111
  status line for this lane's Electron move is added in
  `64301042c`; the roadmap regenerates identical.

## Drills (red → green, observed in this lane)

- **D1 (entities nesting, genuine then deliberate).** After the
  parse5 8.1.0 bump, `node scripts/check-bundle-split.mjs`
  exited 1: `dist/pageWorker.js no longer carries
node_modules/entities/`. Cause: entities 9 nests at
  `node_modules/parse5/node_modules/entities/` (unicorn 77
  holds top-level entities 8; the converter still bundles the
  nested copy — verified in `dist/meta/pageWorker.json`).
  Fixed at the cause in `64301042c` (the check names the nested
  path with its reason): exit 0. Deliberate re-drill: restored
  the old prefix → exit 1 with the same problem; restored the
  fix byte-identical → exit 0.
- **D2 (connector suites, measured identical).** `vitest
related` over the oidc and desktop consumers: 6 files, 24
  failed / 22 passed. The 4 failing files are the connector
  suites (remote 12, serve 5, issuer 3, guard 4), refused here
  because this rig's lane directories are group-writable and the
  storage guard walks ancestors (`namei` measured). Re-ran all
  four on the untouched base (`72d8d5003` + `npm ci` in a
  detached worktree): identical per-file counts (12/5/3/4) with
  the same `not private to your account` signature. No
  regression; hosted CI owns those suites.

## Final gates on the finished tree (2026-11-02, this rig)

| Gate                                                                                                                               | Exit                |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| prettier `--check` on touched files                                                                                                | 0                   |
| eslint `--max-warnings 0` on touched files; full `lint:js` on eslint 10.14.0                                                       | 0; 0                |
| `npm run typecheck` (all seven projects)                                                                                           | 0                   |
| `node scripts/check-l10n.mjs` (0 problems)                                                                                         | 0                   |
| `npm run check:reference`                                                                                                          | 0                   |
| `npm run check:host-api` (0 problems)                                                                                              | 0                   |
| `npm run check:plan` (0 drift)                                                                                                     | 0                   |
| `npm run check:roadmap` (current)                                                                                                  | 0                   |
| `npm run check:catches` (baseline matched)                                                                                         | 0                   |
| `npm run duplication` (0 clones)                                                                                                   | 0                   |
| `npm run cycles` (none)                                                                                                            | 0                   |
| `npm run deadcode` (knip 6.44.1, hints only)                                                                                       | 0                   |
| `npm run build` (every budget holds; split, registry, globals, notices, legal records green)                                       | 0                   |
| `npm run security:audit` (2 notes, 0 exceptions; H1/H2 held)                                                                       | 0                   |
| SAST (`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: 699 rules, 6020 files, 0 findings)                                   | 0                   |
| `node scripts/package-vsix.mjs --target linux-x64` (4,625,592 bytes, budget 4,915,200)                                             | 0                   |
| `node scripts/package-acp.mjs --target linux-x64` (0 failures)                                                                     | 0                   |
| `npm run package:desktop` + fuses read back as WB set them                                                                         | 0                   |
| Real-Electron smoke under Xvfb (`test/desktop/electron-smoke.mjs`: snapshot published, single-instance handoff)                    | 0, PASS             |
| IME flags re-capture (`test/desktop/l10n/ime-flags.mjs` on 45.2.1)                                                                 | 0                   |
| `check:workflow-scripts` + YAML parse of the three edited workflows                                                                | 0                   |
| cargo: fresh-index `update --dry-run` (0 moves), `audit` (0 vulns), `deny` (ok/ok), `cargo test` (l10n 5, tokens 4)                | 0                   |
| `vitest related` (split edit: no affected files; htmlToMarkdown+planMarkdown: 83 passed; oauth server+workbench: classified in D2) | 0; 0; 1-as-reported |
| Per-bump suites (MCP, HTML, plan, packs, desktop, badges)                                                                          | all pass            |

Two things stay with hosted CI by design: the universal (untargeted)
ACP package, which needs the macOS-built `muse-local-judge-peer`
binary this Linux rig cannot produce (`package-acp.mjs` refuses
without it — pre-existing, unrelated to any bump), and the four
connector suites of drill D2.

No `vitest` run in this lane raised the timeout: every suite ran
under the repository's own 5 s default.
