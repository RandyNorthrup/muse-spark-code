# RLF-SAST — the six blocking SAST findings on int (2026-10-30)

Recovery lane `RLF-SAST`, worktree `/Users/user/lanes/RLF-SAST`, branch
`rec/rlf-sast`, on the test rig `macbook` (macOS, Node from the worktree).
Base: int/recovery `b781451b94` (CC-INT2's round,
`docs/certification/cc-int2.md`). Model attempts: **0**. Provider calls:
**0**. No Muse request of any kind. Nothing was pushed, rebased, stashed
or tagged. The vault and real credential-store suites (`keyringParts`,
`keystoreOwner`, `credentialLease`, `providerHeadersStore`,
`test/unit/vault/**`, the device owner vault suites) were never run on
this MacBook. No browser or GUI app was started. Scratch files lived in
the worktree's ignored `temp/` (the semgrep venv, drill backups, scan
logs).

## 1. The gate and the setup

`npm run security:sast` (`scripts/sast.mjs`) runs
`semgrep scan --jobs 1 --config auto --error` with the registry's `auto`
rules and fails on any finding. There is no baseline or exceptions file:
an accepted finding is an inline `nosemgrep` carrying the rule id and the
reason, plus a row in PLAN.md §8 (the escape-hatch register, whose header
requires every scanner suppression to be listed there).

`semgrep` was not on PATH, and this rig's `/usr/bin/git` is Apple's shim,
which fails without Xcode (`couldn't spawn …/xcodebuild`); every git
command here ran with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.
That mattered for the full scan: semgrep enumerates via git, and the
first full run without that variable scanned the ignored `temp/` too
(10,737 files, 180 findings, every one inside `temp/sast-venv`'s own
site-packages, none outside `temp/`). Re-run with a working git it
scanned 5,209 files with 0 findings. The pinned `semgrep==1.180.0`
(`.github/semgrep/requirements.txt`) went into a venv under the
worktree's `temp/` (`/usr/local/bin/python3.12 -m venv temp/sast-venv`;
the default 3.13 venv failed because pip fell back to a `cryptography`
sdist whose build needs a Rust toolchain, and 3.12 installed cleanly
from wheels with `--only-binary=:all:`). Every scan ran with
`SSL_CERT_FILE=/etc/ssl/cert.pem` (without it the binary dies with
`ca-certs: empty trust anchors` on macOS) and
`SEMGREP_ENABLE_VERSION_CHECK=0`, first on PATH for that run.

## 2. The six findings: verdicts

Targeted scan of the five files on the untouched base: exit **1**, the
same 6 blocking findings CC-INT1/CC-INT2 recorded. All six are false
positives: each sink's input is traced below to repo-pinned data, with
the check that binds it named. No code behaviour changed (the diff is 14
inserted comment and register lines, 0 removed), so no behaviour test
can fail before and pass after; the proof per finding is the input trace
plus the red/green drill (§3). After the six suppressions the targeted
scan exits **0** and the full `npm run security:sast` exits **0** (§4).

| #   | Finding                                                                                         | Verdict and reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `os/build.py:79` `dynamic-urllib-use-detected` (`urlopen(url, …)`)                              | False positive. The only callers pass repo-pinned URLs: `os/build.py:277` builds the Node dist URL from `os/pins.json` (`pins["node"]`, digest-pinned per arch), and `os/pi/compose.py` passes manifest URLs `pi_manifest` (`os/check.py:38`) validates (https under `check()`; `file://` only for fixtures in the composer path, still digest-bound). Every fetch is digest-verified (`expected` sha256, `download` re-checks before reuse) or signature-verified (the InRelease against the manifest-pinned fingerprint). No outside input reaches `urlopen`. |
| 2–3 | `os/pi/compose.py:607,609` `insecure-file-permissions` (`0o755`)                                | False positive. Both chmods set the mode of a staged **directory**, which needs the execute bit to traverse; `0o755` grants no write outside the owner, and the rule's suggested `0o644` would break every directory. The mode is correct as written. (Lines 598/600 set `0o755` on executable files through a ternary, which the literal-matching rule does not flag.)                                                                                                                                                                                         |
| 4   | `scripts/build-packs.mjs:2432` `detect-non-literal-regexp`                                      | False positive. The tag is the pack definition's pinned uvPython version (`deploy/packs/*.json`, e.g. `"3.15.1"` giving `cp315`, via `pythonFor` → `sources.pythonVersion`): the pattern is a fixed linear `cp<digits>[.-]` with no quantifier or alternation, so it cannot backtrack. Filenames only select among downloads whose sha256 is verified (`measured.sha256 !== wheel.sha256` refuses).                                                                                                                                                             |
| 5   | `src/core/backends/modelapi/mcp/headers.ts:172` `prototype-pollution-loop` (`node = node[key]`) | False positive. A read-only walk: the loop never assigns, every step is `Object.hasOwn`-guarded (`valueAt`), and header names are `Mcp-Param-` plus an `x-mcp-header` name `scanHeaderMirrors` validated as an HTTP token, so no `__proto__` write exists to pollute.                                                                                                                                                                                                                                                                                           |
| 6   | `src/runtime/node/keyStore.ts:86` `gcm-no-tag-length` (`createDecipheriv` without a tag length) | False positive. Both `decrypt` call sites receive items from `recordSchema.parse` (`keyStore.ts:178`), whose `itemSchema` pins the tag to exactly `NODE_VAULT_TAG_BYTES` (16, `src/shared/constants.ts:382`); `setAuthTag` then verifies the full tag under Node's default 16-byte expectation. A shorter tag is refused before this call, and any future drift fails closed (`setAuthTag` throws on a length mismatch).                                                                                                                                        |

Each suppression is the narrowest the config allows: one `nosemgrep`
line naming the full rule id, the reason, and `(PLAN.md §8)`; no rule
disabled, no path excluded. PLAN.md §8 carries the matching five-row
`RLF-SAST` table.

## 3. Red/green drills

Base red (targeted scan, unmodified tree): exit **1**, 6 blocking
findings (§2, first table). Then, per suppression: the `nosemgrep`
line(s) removed → single-file scan shows the finding again (red) →
restored from backup → `cmp` byte-identical (green by §2's targeted
scan, exit **0**).

| Drill                        | Removal             | Red                                                           | Restore         |
| ---------------------------- | ------------------- | ------------------------------------------------------------- | --------------- |
| D1 `os/build.py`             | the 1 comment line  | `dynamic-urllib-use-detected` at `:79` (`urlopen`)            | `cmp` identical |
| D2 `os/pi/compose.py`        | the 2 comment lines | `insecure-file-permissions` at `:607` and `:609` (`os.chmod`) | `cmp` identical |
| D3 `scripts/build-packs.mjs` | the 1 comment line  | `detect-non-literal-regexp` at `:2432` (`tagMatcher`)         | `cmp` identical |
| D4 `headers.ts`              | the 1 comment line  | `prototype-pollution-loop` at `:172` (`node = node[key]`)     | `cmp` identical |
| D5 `keyStore.ts`             | the 1 comment line  | `gcm-no-tag-length` at `:86` (`createDecipheriv`)             | `cmp` identical |

## 4. Gates on the final tree

Every exit code is the command's own.

| Command                                                                                 | Exit | Result                                                                                                      |
| --------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| `prettier --check` on the touched JS/TS/MD files                                        | 0    | clean (`.py` files are not prettier-managed: no parser; the repo has no Python-format gate)                 |
| `eslint --max-warnings 0` on the touched JS/TS files                                    | 0    | clean                                                                                                       |
| `npm run typecheck`                                                                     | 0    | all six projects                                                                                            |
| `node scripts/check-l10n.mjs`                                                           | 0    | 0 problems                                                                                                  |
| `npm run check:reference`                                                               | 0    | current                                                                                                     |
| `npm run check:host-api`                                                                | 0    | 0 problems                                                                                                  |
| `npm run check:plan`                                                                    | 0    | 0 drift                                                                                                     |
| `npm run check:roadmap`                                                                 | 0    | current                                                                                                     |
| `npm run check:catches`                                                                 | 0    | counts match the baseline                                                                                   |
| `npm run duplication`                                                                   | 0    | 0 clones                                                                                                    |
| `npm run cycles`                                                                        | 0    | no circular dependency                                                                                      |
| `npm run deadcode`                                                                      | 0    | knip clean                                                                                                  |
| `npm run build`                                                                         | 0    | every budget holds                                                                                          |
| `npm run security:audit`                                                                | 0    | 7 advisories, 0 exceptions needed (CC-INT2 saw 6)                                                           |
| `npm run security:sast` (semgrep 1.180.0, venv under `temp/`)                           | 0    | 688 rules on 5209 files: 0 findings                                                                         |
| `npx vitest run test/unit/mcpEra.test.ts test/unit/nodeKeyStore.test.ts --maxWorkers=3` | 0    | 39 passed (repository's own timeouts)                                                                       |
| `npx vitest related --run` over the changed TS sources                                  | 0    | 42 files, 390 passed, 2 skipped; 0 forbidden-suite hits (8 `--exclude` patterns for the store/vault suites) |

`nodeKeyStore.test.ts` runs here: it uses temp dirs (`nodeTempRoot`)
with a fixture codec, never the real store. The suites that write the
real store (`keystoreOwner`, `keyringParts`, `credentialLease`,
`providerHeadersStore`, `test/unit/vault/**`) were not run on this
MacBook; hosted CI runs them. No new tests were added: the change is
comments and register rows only, and the existing suites above cover
both changed runtime modules (header mirroring; key-store encrypt,
decrypt, tamper refusal and seal behaviour).

## 5. Commits

- `6a61a4530` `fix(sast): accept the six blocking findings as false positives with reasoned suppressions` (the six `nosemgrep` lines plus the PLAN.md §8 table; 14 insertions, 0 deletions across 6 files).
- `docs(rlf-sast): the six findings' verdicts, drills and gates` (this record).
