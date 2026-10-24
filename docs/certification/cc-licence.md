# cc/licence — the ACP notices' licence review of sigstore's tree

Claude Code lane. Base: int/recovery `acb48b7f35`. Branch `cc/licence`,
worktree `C:\Users\Randy\Coding\mx-cc-licence`. Environment: Windows 11
workstation, Node 24.20.0, `npm ci` (1,030 packages, exit 0). No push, no
publication, no model or provider call; the vault and credential-store
suites were not run. Upstream evidence was read through the GitHub API
(`gh api`, public repositories) and the npm registry (`npm view`) on
2026-10-24.

## The failure

`npm run package:acp` on this PC stops before the notices at the
universal package's macOS helper (`native\darwin\muse-local-judge-peer`
is built only by macOS CI), so the review ran the Windows target, as
cc-m104h did: `node scripts/package-acp.mjs --target win32-x64` after the
same production build. `scripts/third-party-notices.mjs --acp` refused:

```
third-party notices: 9 package(s) need a review:
  minipass: licence "BlueOak-1.0.0" is not on the allow-list
  minipass-flush: licence "BlueOak-1.0.0" is not on the allow-list
  lru-cache: licence "BlueOak-1.0.0" is not on the allow-list
  glob: licence "BlueOak-1.0.0" is not on the allow-list
  lru-cache: licence "BlueOak-1.0.0" is not on the allow-list
  @npmcli/agent: ships no licence file
  proxy-agent-negotiate: ships no licence file
  minimatch: licence "BlueOak-1.0.0" is not on the allow-list
  @sigstore/verify: ships no licence file
```

All nine contribute bytes only to `dist/packsVerify.js` (D90.27's pack
index verifier, `src/runtime/node/packs/verify.ts`, which imports
`verify` from the umbrella `sigstore@5.0.0`), read from
`dist/meta-acp/packsVerify.json`.

## The nine packages

| #   | Package (installed path)                                        | Version | Declared      | Licence text read                                                                                                                                                                                                                                                                                                                                                                          | Bytes in packsVerify.js | Reached through                                                                                           | Verdict          |
| --- | --------------------------------------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | minipass (`node_modules/minipass`)                              | 7.1.3   | BlueOak-1.0.0 | `LICENSE.md`, SHA-256 `8a1af140…e004`, git blob `c5402b95` = isaacs/minipass `v7.1.3`                                                                                                                                                                                                                                                                                                      | 10,409                  | make-fetch-happen, cacache, minipass-fetch, ssri, fs-minipass, minizlib, minipass-collect, minipass-sized | recorded         |
| 2   | minipass-flush (`node_modules/minipass-flush`)                  | 1.0.7   | BlueOak-1.0.0 | `LICENSE.md`, same bytes as #1; git blob `c5402b95` = isaacs/minipass-flush `v1.0.7`                                                                                                                                                                                                                                                                                                       | 570                     | make-fetch-happen, cacache                                                                                | recorded         |
| 3   | lru-cache (`node_modules/@npmcli/agent/node_modules/lru-cache`) | 11.5.3  | BlueOak-1.0.0 | `LICENSE.md`, same bytes as #1; git blob `c5402b95` = isaacs/node-lru-cache `v11.5.3`                                                                                                                                                                                                                                                                                                      | 19,387                  | @npmcli/agent                                                                                             | recorded         |
| 4   | glob (`node_modules/glob`)                                      | 13.0.6  | BlueOak-1.0.0 | `LICENSE.md`, SHA-256 `a49c9ba4…ae09`, git blob `881248b6` = isaacs/node-glob `v13.0.6`: a one-paragraph preamble (packages under the repository's `src/` keep their own licences; at `v13.0.6` `src/` holds only glob's own seven `.ts` files and no licence file), then the BlueOak text                                                                                                 | 88,163                  | cacache                                                                                                   | recorded         |
| 5   | lru-cache (`node_modules/cacache/node_modules/lru-cache`)       | 11.5.3  | BlueOak-1.0.0 | as #3 (same version, second copy)                                                                                                                                                                                                                                                                                                                                                          | 19,387                  | cacache                                                                                                   | recorded         |
| 6   | @npmcli/agent (`node_modules/@npmcli/agent`)                    | 5.0.2   | ISC           | **none**: no licence, copying or notice file in the tarball, nor anywhere in npm/agent at the release's gitHead `3fadae4d` (63 entries; the only match is `test/fixtures/socksv5/LICENSE`, a test fixture's) nor at the root of `main`; GitHub reports no licence for the repository                                                                                                       | 7,124                   | make-fetch-happen ← @sigstore/sign ← sigstore                                                             | **not recorded** |
| 7   | proxy-agent-negotiate (`node_modules/proxy-agent-negotiate`)    | 1.1.0   | MIT           | **none**: the tarball holds `dist/` and `package.json` only; TooTallNate/proxy-agents at the provenance commit `b7e5f7cc` has no root licence and none in `packages/negotiate` (its eleven siblings each carry their own LICENSE); `packages/negotiate` is unchanged on `main`                                                                                                             | 695                     | http-proxy-agent@9.1.0 and https-proxy-agent@9.1.0 ← @npmcli/agent                                        | **not recorded** |
| 8   | minimatch (`node_modules/minimatch`)                            | 10.2.6  | BlueOak-1.0.0 | `LICENSE.md`, SHA-256 `2c7c5d22…a901`, git blob `8cb5cc6e` = isaacs/minimatch `v10.2.6` (the BlueOak text with Markdown emphasis and single spaces)                                                                                                                                                                                                                                        | 23,186                  | @tufjs/models (glob inlines its own copy)                                                                 | recorded         |
| 9   | @sigstore/verify (`node_modules/@sigstore/verify`)              | 4.1.2   | Apache-2.0    | none in the tarball (`files: ["dist"]`) nor in sigstore/sigstore-js `packages/verify`; the repository's root `LICENSE` at the release's gitHead `769a53d8` (tag `@sigstore/verify@4.1.2`), git blob `e9e7c167`, SHA-256 `364a130d…1cdd0`, is byte-identical to the LICENSE that sigstore, @sigstore/bundle, core, protobuf-specs, sign and tuf ship here; no NOTICE file in the repository | 24,669                  | sigstore                                                                                                  | recorded         |

Lockfile integrities: minipass `sha512-tEBHqDnI…`, minipass-flush
`sha512-TbqTz9cU…`, lru-cache `sha512-U4N8Fgzm…`, glob
`sha512-Wjlyrolm…`, @npmcli/agent `sha512-EkzGmEsg…`,
proxy-agent-negotiate `sha512-N8IBcM3U…`, minimatch `sha512-vpLQEs+V…`,
@sigstore/verify `sha512-BfD9eLrz…`; all three of #6, #7 and #9 carry npm
SLSA provenance.

## Compatibility review

**BlueOak-1.0.0 (#1–#5, #8).** Every shipped text is the unmodified Blue
Oak Model License 1.0.0: word-for-word equal to SPDX's `licenseText`
(SPDX licence list 3.29.0, 2026-09-16, `isOsiApproved: true`), differing
only in Markdown emphasis and double spaces. Its terms: a copyright and a
patent licence from each contributor, irrevocable; one condition,
"everyone who gets a copy of any part of this software from you … also
gets the text of this license or a link to
<https://blueoakcouncil.org/license/1.0.0>", with a 30-day cure; no
copyleft, no attribution of authors, no restriction on the licence of the
larger work; no warranty or liability. The notices file reproduces the
text, which meets the condition, so it is a permissive licence "whose terms
are met by reproducing the notice", the allow-list's own criterion, and
compatible with distributing the MIT-licensed agent package. The product's
own legal scanner (`src/core/legal/compat.ts`) puts it in no copyleft or
restricted family. Recorded: `'BlueOak-1.0.0'` added to `ALLOWED_LICENCES`
in `scripts/third-party-notices.mjs` with the review's reason.

**Apache-2.0 (#9).** Already on the allow-list; §4 asks for a copy of the
licence (and a NOTICE file's attributions when one exists; sigstore-js has
none). Recorded through the existing vendored-licence route (M100 lane W's
`qrcode-generator` precedent): upstream's LICENSE verbatim at
`vendor/@sigstore/verify/LICENSE` (git blob `e9e7c167`, identical to the
upstream blob) and a `VENDORED_LICENCES` row whose declared licence the
gate still checks against the manifest.

**ISC (#6) and MIT (#7): not recordable under the policy.** Both licences
are on the allow-list, but each requires "the above copyright notice and
this permission notice" to travel, and neither publisher has written one:
no text exists in the package, at its source revision or on the default
branch. The repository's rule for a licence-less tarball is upstream's own
text, verbatim; "any other licence-less package still fails" (PLAN.md
M100 W amendment, D29's notices gate). Writing a holder or year from the
manifest's `author` field, or copying a sibling package's notice, would
invent the notice; the open upstream requests ask the same question and
say so (npm/agent#123 since 2025-04-21, npm/agent#176 and its comments up
to 2026-10-24, the unmerged MIT proposal npm/agent#173;
TooTallNate/proxy-agents#479 since 2026-09-11). Neither is recorded, and
the ACP notices keep refusing them.

## What depends on #6 and #7, and the proposed replacement

Both enter only through signing: `sigstore`'s index and `config.js`
require `@sigstore/sign`, whose `external/fetch.js` and `identity/ci.js`
require `make-fetch-happen@16.0.1` → `@npmcli/agent@5.0.2` →
`http-proxy-agent@9.1.0` / `https-proxy-agent@9.1.0` →
`proxy-agent-negotiate@1.1.0`. The pack verifier never signs: `tuf-js@6`
fetches with Node's own `fetch`, not make-fetch-happen.

**Proposal (lead's call, RLF-M110OS's file).** `verify.ts` composes the
verifier from sigstore's own parts, exactly as `sigstore.verify` does
(`sigstore/dist/sigstore.js` `createVerifier`): `getTrustedRoot` from
`@sigstore/tuf@5.0.0`, `toTrustMaterial`, `Verifier`, `toSignedEntity`,
`PolicyError` and `VerificationError` from `@sigstore/verify@4.1.2`,
`bundleFromJSON` from `@sigstore/bundle@5.0.0`, and the policy
`{ subjectAlternativeName: identity, extensions: { issuer } }`
(`config.createVerificationPolicy`). No cryptography is written by hand.
The three become exact-pinned direct dependencies (already locked;
AGENTS.md rule 9's PLAN record), `sigstore` leaves.

Measured on this tree (esbuild, node, cjs, minified, one entry each;
`temp/probe`, deleted): the umbrella import bundles 1,121,069 bytes from
53 packages; the direct import 207,082 bytes from 15
(`@gar/promise-retry`, `@sigstore/{bundle,core,protobuf-specs,tuf,verify}`,
`@tufjs/{canonical-json,models}`, balanced-match, brace-expansion, debug,
minimatch, ms, supports-color, tuf-js). #6 and #7 leave, with
@sigstore/sign, make-fetch-happen, cacache, glob, the proxy agents,
iconv-lite (492,948 bytes alone) and four of the five BlueOak packages;
minimatch stays (through `@tufjs/models`) and is covered by this review.

**The alternative needs the owner (legal terms are his):** accept a
declared-licence notice for #6 and #7, the standard ISC and MIT texts from
the pinned SPDX templates (`src/core/legal/legal-data/templates`) with no
invented holder or year, marked as declared in `package.json` without a
publisher's notice. That would widen `VENDORED_LICENCES` beyond upstream
text, which this lane does not do on its own.

## A finding beside the nine

`glob@13.0.6` resolves to its prebuilt `dist/commonjs/index.min.js`, which
inlines minimatch, path-scurry, lru-cache, minipass, brace-expansion and
balanced-match. The notices name glob only for that file, so `path-scurry`
(2.0.2, BlueOak-1.0.0) ships inside glob's bytes without its name in the
notices. Its one condition is still met (the BlueOak text is reproduced),
and the MIT texts of brace-expansion and balanced-match are reproduced
through their direct contributions; naming packages a prebuilt file
inlines is a gap of the notices input, not of this review. The proposal
above removes glob from the bundle.

## Red drills (the gate still fires)

Both on `scripts/third-party-notices.mjs` through the real packaging step
(`node scripts/package-acp.mjs --target win32-x64`), restored byte-exact
(`sha256sum -c` OK on the edited script):

1. The vendored row's licence set to `MIT`: exit 1,
   `@sigstore/verify: vendored MIT notice does not match the declared "Apache-2.0" licence`
   beside the two unrecorded packages.
2. `'BlueOak-1.0.0'` removed from the allow-list: exit 1, the six BlueOak
   refusals of the original failure return (8 problems with #6 and #7).

## Results

| Command                                                                                                                 | Exit  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                | 0     | 1,030 packages                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run package:acp` (before)                                                                                          | 1     | production build and `exec-schema --check` pass; the universal stage stops at `Required native helper is missing for the universal package: native\darwin\muse-local-judge-peer` (macOS CI builds it; unchanged by this lane)                                                                                                                                                                                                                                                 |
| `node scripts/package-acp.mjs --target win32-x64` (before)                                                              | 1     | the nine refusals above                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| same (after)                                                                                                            | 1     | `third-party notices: 2 package(s) need a review:` `@npmcli/agent: ships no licence file`, `proxy-agent-negotiate: ships no licence file`; seven of nine recorded                                                                                                                                                                                                                                                                                                             |
| `npm run package:acp -- --target win32-x64` (after, the whole script: production build, `exec-schema --check`, staging) | 1     | `Exec schemas match.`, l10n 0 problems, then the same two refusals; the stage removed itself, no `.tgz` written                                                                                                                                                                                                                                                                                                                                                               |
| `npm run package`                                                                                                       | 1     | `npm run build` passes inside it, gates included: `ok THIRD_PARTY_NOTICES.txt: 93 third-party notices (4 optional fonts)` (unchanged file), `legal build records: 160 bundles, 2833 files, 0 problems`, `legal repository scan: 0 incomplete, 0 blockers, 0 should-fix, 150 findings` (150 before the change too); then the universal stage stops at `Required native helper excluded from VSIX: native/linux/x64/muse-created` (Linux CI builds it)                          |
| `node scripts/package-vsix.mjs --target win32-x64`                                                                      | 1     | every packaged-bundle check passes; `check-vsix-size` refuses 4,278,764 bytes against 3,788,800 (3700 KiB, +489,964). Not this lane: the VSIX holds no file this change touches (`THIRD_PARTY_NOTICES.txt` is byte-unchanged, `vendor/@sigstore/` is not packaged, `dist/packsVerify.js` is ACP-only); the largest members are `dist/runtime.bundles.json.br` 1,634,094, `l10n/ui.tables.json.br` 1,196,837 and `dist/webview.json.br` 528,335 bytes. The package was deleted |
| `node scripts/third-party-notices.mjs`                                                                                  | 0     | extension notices current                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `node scripts/check-legal-build-records.mjs`                                                                            | 0     | as above                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `npx prettier --check` (script, PLAN.md, this record)                                                                   | 0     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npx eslint --max-warnings=0 scripts/third-party-notices.mjs`                                                           | 0     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run check:plan` / `npm run check:roadmap`                                                                          | 0 / 0 | 240 milestones, 0 drift / ROADMAP.md current                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `npx vitest run test/unit/noticesInput.test.mjs`                                                                        | 0     | 3 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run typecheck`                                                                                                     | 0     | host, webview, unit, e2e, integration, faults                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Files

- `scripts/third-party-notices.mjs`: `BlueOak-1.0.0` on the allow-list;
  the `@sigstore/verify` vendored-licence row.
- `vendor/@sigstore/verify/LICENSE`: sigstore-js's root LICENSE, upstream
  bytes (git blob `e9e7c167`).
- `PLAN.md`: the review on the `sigstore` dependency's row (§2 D3) and
  Q-CC-LICENCE (§3).

## Remainder

1. **Q-CC-LICENCE.** `npm run package:acp` stays refused until the lead
   adopts the composed verifier (RLF-M110OS's `verify.ts`, three direct
   pins, a real verification run) or the owner accepts declared-licence
   notices for #6 and #7.
2. **The VSIX size budget** on int/recovery (above), for its owner.
3. **The ACP notices' header** names only some of the agent's bundles
   (not `dist/packsVerify.js` among others), and glob's inlined
   path-scurry is unnamed (above): notices-tooling follow-ups.
