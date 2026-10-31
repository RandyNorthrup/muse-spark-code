# RVSAST — independent check of the six SAST suppressions (2026-10-30)

Review lane `RVSAST`, worktree `/Users/randy/lanes/RVSAST`, branch `rv/sast`,
on the test rig `macmini` (`Macmini.ivettnet`, macOS, Node v24.21.0). The
branch starts at `rec/rlf-sast` `75eff541afb7` (RLF-SAST's record is
`docs/certification/rlf-sast.md`; commits `6a61a4530` and `75eff541a`), which
is over int/recovery `b781451b94`. Model attempts: **0**. Provider calls:
**0**. No Muse request. Nothing was pushed, rebased, stashed or tagged.
Hooks stayed at `core.hooksPath=.husky/_`.

This lane re-traced each of the six findings RLF-SAST suppressed. Five
suppressions stay. One (`gcm-no-tag-length`) was a real weakness in the
sink; the suppression is gone and decrypt now requires a 16-byte tag.

## 1. The scanner

`npm run security:sast` (`scripts/sast.mjs`) runs
`semgrep scan --jobs 1 --config auto --error`. There is no baseline: an
accepted finding is one `nosemgrep` line naming the full rule id and the
reason, plus a PLAN.md §8 row.

The `semgrep` already on PATH is 1.177.0. The pin in
`.github/semgrep/requirements.txt` is `semgrep==1.180.0`. This machine's
only Python is 3.14.7 (`/usr/local/bin/python3.14`); the pin installed into
the worktree venv `temp/sast-venv` with
`SSL_CERT_FILE=/etc/ssl/cert.pem pip install --only-binary=:all:` (a
cryptography wheel, no Rust). Every scan put that venv's `bin` first on
PATH, with `SSL_CERT_FILE=/etc/ssl/cert.pem` and
`SEMGREP_ENABLE_VERSION_CHECK=0`. `semgrep --version` then reports
`1.180.0`. Both binaries print "Failed to register segfault signal
handler" and still exit 0. `temp/` is gitignored, so the venv is not a
scan target.

## 2. Verdicts

### 1. `os/build.py:80` `dynamic-urllib-use-detected` — agree, reason corrected

`urlopen(url)` is a false positive for a product attacker. Production
callers pass repo-pinned URLs: `stage()` builds
`https://nodejs.org/dist/v{version}/{archive}` from `os/pins.json` after
`check()` requires `pins["node"]["version"] == "24.18.0"` and 64-hex
digests, and `prepare()` in `os/pi/compose.py` passes manifest URLs.
`check()` calls `pi_manifest` with `require_https=True`. `prepare()` calls
it with `require_https=False` so the image-build fixtures' `file://` URLs
work; those fetches are still digest- or signature-checked. The InRelease
fetch is signature-verified against the manifest fingerprint. It is not
digest-pinned. The index URL is built from the local manifest
(`index_url.rsplit("/", 1)[0] + "/" + index_path`), not from the network
body, and `index_path` rejects `\`, a leading `/`, and empty, `.` or `..`
parts. The index and package fetches are digest-pinned. The CLI takes
target, runtime, hashes, mkosi, keyring, extra search path and installer.
It takes no URL. No environment variable supplies the URL. A network body
does not become the next URL. `stage()` re-reads `pins.json` after
`check()`; a local edit of that file is a repository change, and the host
stays the literal `nodejs.org` because the version is interpolated into
the path.

The suppression stays, one line, the full rule id. The comment and the
PLAN.md §8 row now say the InRelease fetch is signature-checked, and that
the composer allows `file://` for fixtures. The earlier sentence that
every fetch is digest-bound was wrong.

### 2–3. `os/pi/compose.py:608` and `:611` `insecure-file-permissions` — agree

Both `os.chmod(..., 0o755)` calls sit inside `stat.S_ISDIR` in
`_copy_open`. A directory needs the execute bit to traverse. `0o755` is
owner read/write/execute and group/other read/execute. The rule's
suggested `0o644` would make the directory untraversable. File modes use
`0o755 if mode & 0o111 else 0o644`, which the literal rule does not flag.
The bytes are a verified Raspberry Pi package extract into an image
overlay. The two suppressions and their PLAN row are unchanged.

### 4. `scripts/build-packs.mjs:2433` `detect-non-literal-regexp` — agree

`loadDefinitions` reads only `deploy/packs/*.json`. `--pack` filters by
name; it does not load an outside file. `pythonFor` uses
`managed.uvPythons[0].version` or an inherited pin. The two pins are
`deploy/packs/python.json` `3.15.1` (`cp315`) and
`deploy/packs/typescript.json` `3.14.9` (`cp314`). The pattern is
`` `cp${version.split('.').slice(0, 2).join('')}` `` then
`replaceAll('.', '[.]')` then `[.-]`, so those pins compile to the linear
patterns `/cp315[.-]/` and `/cp314[.-]/`. The subject is a PyPI filename.
The pattern is the pin. A wheel is kept only when its sha256 matches.
`refresh --apply` bumps `checkedAt`; it does not write the version into
the regex. A non-digit version in that same JSON could inject a
quantifier, and the code does not enforce `^\d+\.\d+`. That edit is a
repository change in a file the build already trusts to name the
downloads it executes. The suppression and its PLAN row are unchanged.

### 5. `headers.ts:173` `prototype-pollution-loop` — agree, reason corrected

`node = node[key]` is a false positive. The rule (confidence LOW) matches
any `$SMTH = $SMTH[$A]` inside a loop, including a read, and it does not
understand `Object.hasOwn`. The loop never assigns through the key.
`Object.hasOwn` refuses inherited keys. The keys are JSON-schema property
names from `scanHeaderMirrors` (`Object.entries(properties)`). An MCP
server chooses those names. They are not the `x-mcp-header` token.
`__proto__`, `constructor` and `prototype` can appear as property names.
`HEADER_TOKEN` allows `_`, so `__proto__` is a valid token, but
`mirrorHeaders` always writes the header name `Mcp-Param-` plus that
token, never the bare key. The only production caller is
`connection.ts` `callTool`, which calls `mirrorHeaders(mirrors, args)`
after `scanHeaderMirrors` on a modern HTTP listing (`connection.ts:1117`).
`headerText` emits only a string, a boolean or a finite safe integer.
A read cannot pollute `Object.prototype`.

The suppression stays. The comment and the PLAN.md §8 row no longer say
those keys are the token-checked header name.

### 6. `keyStore.ts:86` `gcm-no-tag-length` — disagree, fixed

The rule is ERROR. On Node v24.21.0, `createDecipheriv('aes-256-gcm', …)`
without `authTagLength` accepts `setAuthTag` of a 4, 8, 12 or 15-byte
prefix of a real 16-byte tag and returns the plaintext (`hello`). Lengths
0 and 1 throw `ERR_CRYPTO_INVALID_AUTH_TAG`. The same call with
`{ authTagLength: 16 }` rejects 4, 8 and 12 and accepts 16. Node prints
`DEP0182` for the short tag when the option is omitted. The suppression's
two claims — "Node's default 16-byte expectation" and "`setAuthTag` throws
on a length mismatch" — are both false.

`itemSchema` does pin `tag.byteLength === NODE_VAULT_TAG_BYTES` (16,
`src/shared/constants.ts:382`). Both `decrypt` callers (`unlock` after
`recordSchema.parse`, `get` from `this.record` set only after that parse)
are behind that check, so a short on-disk tag does not reach the sink on
the public path today: unlock throws `$ZodError` on `items/0/tag`, the
store stays sealed, and one report is recorded. The sink itself still
decrypts a truncated tag if that refine is absent. `src/runtime/node/seal.ts`
and `src/core/vault/crypto.ts` already pass the tag length.

Decrypt now passes `{ authTagLength: NODE_VAULT_TAG_BYTES }`. The
`nosemgrep` line is gone. The PLAN.md §8 keyStore row is gone. The schema
refine stays.

`test/unit/helpers/nodeVaultCodec.ts` is a test-only disk codec. Its
`createDecipheriv` has no `authTagLength`. Semgrep did not flag it, and
this lane did not change it.

## 3. Red/green drills (finding 6)

The product test stores a real item, rewrites its on-disk tag to the first
4 bytes, and expects `unlock` to reject, the store to stay sealed, `get`
to reject, and one report. It uses the fixture codec in a temp directory.
It does not touch the login keychain.

The committed assertion is `rejects.toThrow()`. Either the schema or
`authTagLength` satisfies it. It fails only when both are absent. On the
pre-fix tree the schema alone already refuses the public path, so this
test is green there too. The red proof is the drill that removed both
controls.

| Drill                                                        | What was true                   | Result                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema intact, before `authTagLength`                        | probe expected a chosen message | exit 1. Received `$ZodError` code `custom`, path `items/0/tag`, message `Invalid input`. `sealed` true, reports 1. Decrypt was not reached. |
| Schema intact, `authTagLength` added                         | the H15 test alone              | exit 0. 1 passed, 6 skipped.                                                                                                                |
| Schema weakened to `byteLength > 0`, `authTagLength` removed | the H15 test alone              | exit 1. `unlock` resolved `"undefined"`. Node printed `DEP0182`. The 4-byte prefix decrypted.                                               |
| `authTagLength` restored, schema still `byteLength > 0`      | the H15 test alone              | exit 0. 1 passed, 6 skipped. `setAuthTag` refused the short tag.                                                                            |
| Schema restored to `=== NODE_VAULT_TAG_BYTES`                | the committed tree, read back   | the refine is the equality check. Related run below includes this test.                                                                     |

Node measurement (not a product test), v24.21.0: default 16/15/12/8/4
accepted `"hello"`; default 1 and 0 rejected; `authTagLength: 16` accepted
16 and rejected 12, 8 and 4.

## 4. Gates on the committed tree

Every exit code is the command's own. No `--testTimeout`. No budget was
raised. `os/build.py` is not prettier- or eslint-managed.

| Command                                                                              | Exit | Result                                                                                                      |
| ------------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------------------------- |
| `prettier --check` on `keyStore.ts`, `headers.ts`, `nodeKeyStore.test.ts`, `PLAN.md` | 0    | clean                                                                                                       |
| `eslint --max-warnings 0` on those three TS files                                    | 0    | clean                                                                                                       |
| `npm run typecheck`                                                                  | 0    | host, webview, unit, e2e, integration, faults                                                               |
| `node scripts/check-l10n.mjs`                                                        | 0    | 14 UI tables, 14 usage tables, 283 manifest strings, 2457 source files; 0 problems                          |
| `npm run check:reference`                                                            | 0    | current                                                                                                     |
| `npm run check:host-api`                                                             | 0    | 0 problems                                                                                                  |
| `npm run check:plan`                                                                 | 0    | 241 milestones, 0 drift                                                                                     |
| `npm run check:roadmap`                                                              | 0    | 241 entries, current                                                                                        |
| `npm run check:catches`                                                              | 0    | counts match the baseline                                                                                   |
| `npm run duplication`                                                                | 0    | 0 clones                                                                                                    |
| `npm run cycles`                                                                     | 0    | no circular dependency (4166 files)                                                                         |
| `npm run deadcode`                                                                   | 0    | knip exit 0. It also printed configuration hints and unused `@unwired` tags; those did not fail the command |
| `npm run build`                                                                      | 0    | tokens 0 problems; every bundle budget held; lazy registry current; legal build records 0 problems          |
| `npm run security:audit`                                                             | 0    | 7 advisories, 0 exceptions (fast-uri, qs, serialize-javascript notes)                                       |
| `npm run security:sast` (semgrep 1.180.0)                                            | 0    | 688 rules on 5209 files: 0 findings                                                                         |
| targeted semgrep of the five reviewed files                                          | 0    | 452 rules on 5 files: 0 findings. `keyStore.ts` is no longer flagged                                        |
| `npx vitest related --run` on `keyStore.ts` and `headers.ts`, `--maxWorkers=2`       | 0    | 42 files, 391 passed, 2 skipped. Includes `nodeKeyStore.test.ts` (7) and `mcpEra.test.ts` (33)              |

The related run excluded `test/unit/vault/**`, `keyringParts`,
`keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`deviceOwnerVault`, `deviceOwnerBind` and `devicePairKeyDpapi`. None of
those names appeared in the 42 files. The Mac mini rule allows those
suites; this change does not need them, and they write the product
keychain. They were not run.

The full SAST scan printed timeout warnings and still exited 0. Semgrep
stopped `src/core/backends/modelapi/ModelApiHost.ts` after 3 timeouts
(`tainted-eval`, `tainted-html-string`, `express-ssrf`) and timed out once
in `src/host/conversation/conversationController.ts` (`express-ssrf`).
This lane did not change those files. The warnings are not findings.

No CHANGELOG entry: a successful unlock is unchanged, and the public path
already refused a truncated tag at the schema. No new sentence a person
sees. No new l10n key. No PLAN.md §6 line: there is no RVSAST milestone.
No roadmap entry.

Real use of the truncated-tag refusal is the unit test plus the Node
v24.21.0 measurement. No packed-product session was started. The image
builder change is a comment.

## 5. Commits

- `c6929ca7827d9f5623040b492c7062a88f0e7652` `fix(sast): require the full GCM tag length at decrypt` (decrypt option, H15 test, urllib and header reasons, keyStore row removed from PLAN.md §8).
- This record.

## 6. Still open

Nothing in the six findings is left undecided. Hosted CI still runs the
vault and credential-store suites this lane did not run, and it runs SAST
with the pinned semgrep.
