# cc/sigstore — the pack verifier on Sigstore's verification packages

Claude Code lane. Base: int/recovery `acb48b7f35`. Branch `cc/sigstore`,
worktree `C:\Users\Randy\Coding\mx-cc-sigstore`. Environment: Windows 11
workstation, Node 24.20.0, npm 11.19.0, `npm ci` exit 0. No push, no
publication, no model or provider call; the vault and credential-store
suites were not run. Temporary files lived in `temp/` and were deleted.

## The blocker and the decision

`npm run package:acp` refused at its third-party notices
(`node scripts/package-acp.mjs --target win32-x64` on the unchanged tree,
exit 1, reproduced here):

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

cc-licence (`docs/certification/cc-licence.md`) found that `@npmcli/agent`
and `proxy-agent-negotiate` publish no licence text anywhere and reach the
bundle only through `sigstore`'s signer, which the pack verifier never runs.
The lead chose its proposal (Q-CC-LICENCE): compose the verifier from
`@sigstore/tuf`, `@sigstore/verify` and `@sigstore/bundle` as
`sigstore.verify` does.

## The change

`src/runtime/node/packs/verify.ts` makes the same calls, in the same order
and with the same arguments, as `sigstore@5.0.0`'s `verify` →
`createVerifier` (`node_modules/sigstore/dist/sigstore.js`, `config.js`):

| Step                 | `sigstore.verify(bundle, data, { certificateIssuer, certificateIdentityURI })`                                                                         | New `verify.ts`                                                 | Same because                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trust root (TUF)     | `tuf.getTrustedRoot({ mirrorURL: undefined, rootPath: undefined, cachePath: undefined, forceCache: undefined, retry: { retries: 2 }, timeout: 5000 })` | `getTrustedRoot()`                                              | `@sigstore/tuf`'s `createClient` fills each absent option with the same value (`DEFAULT_MIRROR_URL`, `appDataPath('sigstore-js')`, `{ retries: 2 }`, `5000`, `false`) |
| Trust material       | `toTrustMaterial(trustedRoot, undefined)` (no `keySelector`)                                                                                           | `toTrustMaterial(trustedRoot)`                                  | same function, same arguments                                                                                                                                         |
| Verifier             | `new Verifier(trustMaterial, { ctlogThreshold: undefined, tlogThreshold: undefined })`                                                                 | `new Verifier(trustMaterial)`                                   | the constructor reads each option with `?? 1`                                                                                                                         |
| Policy               | `createVerificationPolicy`: `{ subjectAlternativeName: certificateIdentityURI, extensions: { issuer: certificateIssuer } }`                            | the same object from `PACKS_SIGN_IDENTITY`, `PACKS_SIGN_ISSUER` | no email identity and no OIDs were passed, so those branches never ran                                                                                                |
| Bundle and signature | `verifier.verify(toSignedEntity(bundleFromJSON(bundle), data), policy)`                                                                                | the same expression, `data` = `Buffer.from(bytes)`              | same functions; the umbrella re-exported the same `PolicyError` and `VerificationError` classes from `@sigstore/verify`                                               |
| Refusals             | `VerificationError`/`PolicyError` → their `code`; `TypeError` → `network`; anything else rethrown                                                      | unchanged                                                       | the catch is the same code                                                                                                                                            |

The `mediaType` pre-check that answers `malformed-bundle` is unchanged; it
is a boolean now, because `bundleFromJSON` takes `unknown` and no
serialized-bundle type is needed.

### Dependencies (AGENTS.md rule 9)

| Package            | Pin   | Released   | Latest | Peer dependencies |
| ------------------ | ----- | ---------- | ------ | ----------------- |
| `@sigstore/bundle` | 5.0.0 | 2026-06-01 | 5.0.0  | none              |
| `@sigstore/tuf`    | 5.0.0 | 2026-06-01 | 5.0.0  | none              |
| `@sigstore/verify` | 4.1.2 | 2026-08-04 | 4.1.2  | none              |

All three were already locked at these versions under `sigstore@5.0.0`, so
the lockfile only drops packages: `npm install` removed 34 packages and
added none, and changed no version. `sigstore` had no other user and left
`dependencies`. `npm audit` (2026-10-24): nothing in the verifier's tree;
its 3 findings (fast-uri, serialize-javascript through mocha) are the
existing development-tool ones. PLAN.md §2 D3 carries the new row.

### dist/packsVerify.js, measured from the production build's metafile

|        | Bytes     | Package directories | Distinct packages |
| ------ | --------- | ------------------- | ----------------- |
| Before | 1,126,983 | 53                  | 49                |
| After  | 212,784   | 15                  | 15                |

After: `@sigstore/protobuf-specs`, `@tufjs/models`, `@sigstore/core`,
`@sigstore/verify`, `@sigstore/tuf`, `minimatch`, `tuf-js`,
`@sigstore/bundle`, `debug`, `brace-expansion`, `supports-color`,
`@gar/promise-retry`, `ms`, `balanced-match`, `@tufjs/canonical-json`.
`@npmcli/agent` and `proxy-agent-negotiate` are in neither the metafile nor
the bundle's text (`grep -c` 0), and neither are `@sigstore/sign`,
make-fetch-happen, cacache, glob, iconv-lite (492,948 bytes alone) or the
proxy agents. The size budget moves down with the measurement (207.8 KiB
plus 15%, rounded up to 25 KiB: 1675 → 250 KiB; `check-bundle-size`
`ok dist/packsVerify.js: 207.8 KiB (budget 250 KiB)`).

### cc/licence's records: cherry-picked

With the new verifier alone the notices still refused two packages
(`node scripts/package-acp.mjs --target win32-x64`, exit 1):

```
third-party notices: 2 package(s) need a review:
  minimatch: licence "BlueOak-1.0.0" is not on the allow-list
  @sigstore/verify: ships no licence file
```

Both are still bundled, so cc/licence's commit `2f00ef68dd` was brought over
whole with `git cherry-pick -n 2f00ef68dd`, then committed with
`git commit -C 2f00ef68dd` and the pre-commit hook running (lint-staged,
gitleaks): `06ec0f5a7f`, whose diff is byte-identical to `2f00ef68dd`'s.
It records BlueOak-1.0.0 on the allow-list (minimatch is now its only
user here, reached through `@tufjs/models`) and vendors `@sigstore/verify`'s
upstream LICENSE. This lane then marked Q-CC-LICENCE resolved and rewrote
the dependency row for the three packages.

### The ACP notices' header

The header named 39 bundles by hand. Of those, only the 4 that carry
third-party code were accurate (approvalModes, validation, validationSchema,
pageWorker); `dist/acp.js`, `wire.js`, `modelApi.js` and most others carry
none, and `dist/packsVerify.js`, `runtimeEngine.js`, `sharingRuntime.js`,
`structuredSchema.js`, `museCode.js`, `imageResizeWorker.js`,
`voiceCompanion.js` and the shared browser chunks were missing. The header
now comes from the same metafile contributions as the package list
(`contributingOutputs` beside `contributedPackageDirs` in
`scripts/lib/noticesInput.mjs`, one walk shared by both), so it names
exactly the staged files that carry a listed package's code. The packaged
`THIRD_PARTY_NOTICES.txt` from the final run:

```
The agent's bundles (dist/approvalModes.js, dist/imageResizeWorker.js, dist/museCode.js, dist/packsVerify.js, dist/pageWorker.js, dist/runtimeEngine.js, dist/sharingRuntime.js, dist/structuredSchema.js, dist/validation.js, dist/validationSchema.js, dist/webview/chunks/FNI5YF2R.js, dist/webview/chunks/GYOXBQDD.js, dist/webview/chunks/HLK2X6MJ.js, dist/webview/chunks/HUYMMBGS.js, dist/webview/chunks/IKLU5OTY.js, dist/webview/chunks/L4QLKO7W.js, dist/webview/chunks/SJZ3DI6I.js, and dist/webview/voiceCompanion.js) include code from the packages below, each under its
```

The extension's own `THIRD_PARTY_NOTICES.txt` keeps its hand-kept header
(it is committed and checked byte for byte), so this lane leaves it as it
is (see the remainder).

## Real verification and the drills

No suite exercises `verify.ts` itself (`test/unit/nodePacks.test.ts`
passes `verifySignature` in), and no bundle signed with the pinned identity
exists yet: `node-packs.yml` is not on `main`, so no `packs-*` release has
been published. The drills therefore use a real cosign keyless
`sign-blob` bundle of the same shape as the pack index's: goreleaser
v2.19.0's `checksums.txt` and `checksums.txt.sigstore.json` (bundle v0.3,
`messageSignature`, one `hashedrekord` 0.0.1 tlog entry, an RFC 3161
timestamp; SAN
`https://github.com/goreleaser/goreleaser/.github/workflows/release.yml@refs/tags/v2.19.0`,
issuer `https://token.actions.githubusercontent.com`, the issuer the node
pins). Captured 2026-10-24T17:01:26Z with
`gh release download v2.19.0 -R goreleaser/goreleaser -p checksums.txt -p checksums.txt.sigstore.json`;
SHA-256 `f326ec8e…0923e` and `c9064566…268df`. The unknown root is Sigstore
staging's real root, `15.root.json` from `https://tuf-repo-cdn.sigstage.dev`
(captured 2026-10-24T17:10:42Z with `curl -sSf`, SHA-256 `3cfd6860…795b9`,
validly signed, expires 2027-03-13).

**The identity edit.** For the green state, `PACKS_SIGN_IDENTITY` in
`src/shared/constants.ts` was pointed at goreleaser's workflow on purpose,
the production build (`node scripts/build.mjs --production`, exit 0) made
the new `dist/packsVerify.js`, and the file was restored byte for byte
(`sha256sum -c`: OK). The wrong-identity case runs the real-identity
production build from the final `npm run package:acp` run.

**Old against new.** Every case ran through both the new production
bundle (in `dist/`, beside the shared chunks it loads) and the base
commit's verifier (`git show acb48b7f35:src/runtime/node/packs/verify.ts`,
only its constants import path changed, bundled with esbuild against a
fresh `sigstore@5.0.0` install in `temp/`, which resolved the same
`@sigstore/*` 5.0.0/4.1.2/4.0.1/0.5.2 and `tuf-js` 6.0.0). Each run had its
own empty TUF cache (`LOCALAPPDATA` under `temp/`, so the machine's
`sigstore-js` cache was never touched).

| Case                                                                                            | New                                                                                                                 | Old        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------- |
| Green: real bundle, real bytes, fresh cache                                                     | `{"verified":true}`                                                                                                 | same       |
| Tampered artifact (first byte flipped)                                                          | `{"verified":false,"failure":"SIGNATURE_ERROR"}`                                                                    | same       |
| Tampered bundle: signature's last byte flipped                                                  | `{"verified":false,"failure":"TIMESTAMP_ERROR"}` (the RFC 3161 imprint covers the signature)                        | same       |
| Tampered bundle: certificate's last byte flipped                                                | `{"verified":false,"failure":"CERTIFICATE_ERROR"}`                                                                  | same       |
| Malformed bundle (`{}`)                                                                         | `{"verified":false,"failure":"malformed-bundle"}`                                                                   | same       |
| Wrong signer identity (the pinned node-packs identity)                                          | `{"verified":false,"failure":"UNTRUSTED_SIGNER_ERROR"}`                                                             | same       |
| Unknown trust root (staging's root 15 as the cached `root.json`)                                | rejects: TUFError `TUF_REFRESH_METADATA_ERROR` "error refreshing TUF metadata", cause "root was signed by 0/2 keys" | same words |
| Tampered trust root (the seeded production root with `expires` edited)                          | rejects: "root was signed by 0/3 keys"                                                                              | same words |
| Restore: fresh cache; again on the green case's warm cache; again after the wrong-identity case | `{"verified":true}` each time                                                                                       | same       |

The two trust-root refusals reject the promise, as the old verifier did
(neither error is a `VerificationError`, `PolicyError` or `TypeError`), so
the pack fetch's caller sees the same loud failure. The minified class
names (`Tn` against `UE`) are the same `TUFError` in two builds.

**Expired trust root: not drilled.** An expired root needs either a clock
moved forward or a mirror that serves no newer root; the first is a fake
clock and the second a hand-answering server, both forbidden. Expiry is
tuf-js's check inside the same `getTrustedRoot` call with the same options,
so it is unchanged.

**The header assertion's drill.** `test/unit/noticesInput.test.mjs` now
also asserts that the header names the staged shared chunk and only it.
Red: the stage filter removed from `contributingOutputs` (it then names the
extension-only output too), `npx vitest run test/unit/noticesInput.test.mjs`
exit 1, `expected 'THIRD-PARTY SOFTWARE NOTICES\nmuse-sp…' to contain 'The agent\'s bundles (dist/webview/sh…'`;
restored byte for byte (`sha256sum -c`: OK); green below.

## Results

| Command                                                                                                                                           | Exit   | Result                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                                          | 0      |                                                                                                                                                                                                                             |
| `node scripts/package-acp.mjs --target win32-x64` (before)                                                                                        | 1      | the nine refusals above                                                                                                                                                                                                     |
| same (new verifier, before the cherry-pick)                                                                                                       | 1      | the two refusals above                                                                                                                                                                                                      |
| `npm run package:acp -- --target win32-x64` (final: production build, `exec-schema --check`, staging, notices, packaged-bundle tests, `npm pack`) | 0      | `Exec schemas match.`; `l10n: … 0 problems`; `dist\acp-package\THIRD_PARTY_NOTICES.txt: 54 packages written`; `ℹ tests 123 ℹ pass 123 ℹ fail 0`; `dist/muse-spark-code-acp-0.19.0-win32-x64.tgz` (3,777,458 bytes, deleted) |
| `node scripts/third-party-notices.mjs`                                                                                                            | 0      | `ok THIRD_PARTY_NOTICES.txt: 93 third-party notices (4 optional fonts)` (file unchanged)                                                                                                                                    |
| `node scripts/check-legal-build-records.mjs`                                                                                                      | 0      | `legal build records: 160 bundles, 2833 files, 0 problems`                                                                                                                                                                  |
| `check-tokens`, `check-bundle-size`, `check-bundle-split`, `gen-lazy-registry --check`, `check-host-globals` (on the final build)                 | 0 each | the rest of `npm run build`'s chain                                                                                                                                                                                         |
| `npm run check:plan` / `check:roadmap` / `check:catches`                                                                                          | 0/0/0  | 240 milestones, 0 drift / ROADMAP.md current / catch sites match the baseline                                                                                                                                               |
| `npm run typecheck`                                                                                                                               | 0      | host, webview, unit, e2e, integration, faults                                                                                                                                                                               |
| `npx knip`                                                                                                                                        | 0      |                                                                                                                                                                                                                             |
| `npx prettier --check` and `npx eslint --max-warnings=0` (changed files)                                                                          | 0/0    |                                                                                                                                                                                                                             |
| `npx vitest run` nodePacks, nodePackDefinitions, noticesInput, whatsNewContent, packagedBundles                                                   | 0      | 5 files, 105 tests: nodePacks 29 (verifyIndex 6), nodePackDefinitions 10, noticesInput 3, packagedBundles 8, whatsNewContent 55                                                                                             |
| `npx vitest run test/unit/manifest.test.ts`                                                                                                       | 1      | 38 of 41 pass; the 3 failures read inputs this lane does not change (remainder)                                                                                                                                             |

## Commits

- `06ec0f5a7f` chore(notices): cc/licence's `2f00ef68dd`, cherry-picked.
- `599fc185ab` fix(packs): the verifier on the three packages, the
  dependencies, the size budget, PLAN.md.
- `274e32ce10` fix(notices): the generated ACP header, its assertion,
  CHANGELOG.md.
- This record.

## Remainder

1. **`test/unit/manifest.test.ts` fails 3 tests**, none caused here: the
   walkthrough's step list (a `judgeSetup` step in `contributes`, which
   this lane does not touch), the release workflow's `actions: read` count
   (8, expected 7; `release.yml` untouched), and the assertion that every
   runtime dependency appears in the extension's notices. That last one
   already fails on the base's dependency list, at
   `@codemirror/merge`, `@xterm/*`, `codemirror`, `ink`, `string-width`
   and `sigstore`, none of them in an extension bundle; the three
   `@sigstore/*` packages take `sigstore`'s place in that list. They ship
   only in the ACP agent, as `@napi-rs/keyring` does, which the test
   already exempts.
2. **The extension's notices header is hand-kept too** and misses 8
   bundles that carry third-party code (`approvalModes.js`,
   `imageResizeWorker.js`, `prompts.js`, `runtimeEngine.js`,
   `sharingRuntime.js`, `structuredSchema.js`, `webview/referencePage.js`,
   `webview/voiceCompanion.js`). `contributingOutputs` can generate it the
   same way; that rewrites the committed `THIRD_PARTY_NOTICES.txt` and the
   VSIX, so it is left for the lead.
3. **A recorded suite for `verify.ts`** waits for the pack CI's first
   signed index (the pinned identity), and would need the live TUF
   repository.
4. The universal `npm run package:acp` (no `--target`) still stops at the
   macOS helper that only macOS CI builds, before the notices, as
   cc-licence recorded.
