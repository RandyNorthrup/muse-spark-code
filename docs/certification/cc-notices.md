# cc-notices: every shipped dependency in the notices, and the release workflow's read grants

Branch `rec/rlf-notices` (lane RLF-NOTICES), base int/recovery `9b090e87c`.
Mac mini, 2026-10-30. The manifest suite's two left-failing cases from
`docs/certification/cc-tests.md` ("Left failing"): the notices case and
RELFAST. Both green, 41 of 41, with the repository's own timeouts.

## 1. The notices case: what ships the missing dependencies

The case requires every `dependencies` entry (except `@napi-rs/keyring`)
to be named in the extension's `THIRD_PARTY_NOTICES.txt`, which
`scripts/third-party-notices.mjs` generates from the production build's
`dist/meta/*.json` metafiles. It failed first at `@codemirror/merge`;
behind it stood ten more names. Each was traced to the bundles that
carry it, from a fresh production build (`npm run notices`, exit 0)
plus the committed shipping lists (`.vscodeignore`, `ACP_BUNDLES`,
the node-image staging).

### Nothing ships them: the node workspace's five, plus ink and string-width

`codemirror`, `@codemirror/merge`, `@xterm/xterm`, `@xterm/addon-fit`
and `@xterm/headless` appear in no metafile under `dist/meta/` or
`dist/meta-acp/`. Their only production imports are under
`src/webview/node/` (the editor and terminal pages), which ships only
through the standalone workspace build (`test/harness/build-node.mjs`,
`dist/meta-node/workspace.json`). That build runs only in tests and the
accessibility script: `scripts/build.mjs` never calls it, no workflow
runs it, neither package stages its output, and `window.museNode`
(the binding that would load it) has no supplier in `src/`. The packed
VSIX was measured without it on cc-vsixsize
(`docs/certification/cc-vsixsize.md`: "the node workspace (CodeMirror,
xterm) ... is in neither package"). Its licences are still recorded:
the workspace build writes its own `THIRD_PARTY_NOTICES.txt` beside its
chunks, pinned by `nodeWorkspaceBuild.test.ts`.

`ink` and `string-width` are the same story one layer down. Nothing in
`src/` imports `ink` at all (only `test/harness/tui/renderer.ts` does);
`string-width` is imported only by `src/runtime/tui/design/*`, which
only the suites and the harness import, and no build entry reaches.
Neither appears in any production metafile, so the TUI that PLAN.md
says ships does not: a product gap for the TUI lane (below,
"Follow-ups"), not a licence gap — nothing unrecorded ships.

Per the brief, what nothing ships does not belong in `dependencies`:
all seven moved to `devDependencies` (pins unchanged), and
`package-lock.json` was regenerated with `npm install
--package-lock-only` (moves plus `dev: true` flags only; no version,
resolved or integrity line changed). No workflow installs the root
with `--omit=dev`, and the SBOM reads the lockfile whole, so the move
changes no shipped bytes. The generated notices file was not touched
by hand; a fresh `npm run notices` regenerates it byte-identical (93
packages).

### The ACP agent ships them: the three @sigstore/* packages

`@sigstore/bundle`, `@sigstore/tuf` and `@sigstore/verify` appear only
in `dist/meta-acp/packsVerify.json`. `dist/packsVerify.js` ships only
in the ACP agent (`ACP_BUNDLES`, `scripts/lib/acpBundles.mjs`), whose
own `THIRD_PARTY_NOTICES.txt` is generated from the same metafiles at
package time (`scripts/third-party-notices.mjs --acp`, which refuses a
staged bundle's unlicensed package as cc-sigstore proved). Listing them
in the extension's notices would misattribute code the VSIX does not
carry, so the case exempts them the way it already exempts
`@napi-rs/keyring` — with the reason beside it, and guarded: the case
fails unless `packsVerify.js` still ships in the ACP package, so the
exemption cannot outlive the shipping fact it rests on.

### Drills

- **A, the loop fires.** `"zz-drill": "1.0.0"` added to `dependencies`
  → `AssertionError: zz-drill: expected 'THIRD-PARTY SOFTWARE
NOTICES\nMuse Sp…' to contain '\nzz-drill ('`; removed → green.
- **B, the exemption's guard fires.** `'packsVerify.js'` renamed in
  `scripts/lib/acpBundles.mjs` → `expected '…acpBundles…' to contain
''packsVerify.js''`; restored → green.

## 2. RELFAST: the eighth `actions: read` grant is the node-image caller's

The pin counted 7 grants; the file holds 8. History (`git log -S`):
`d547656de` (M110-C image gating) added the `node-image` job with its
grant (5 → 6), and `48cd68f70` (rule 2) added the verify job's and the
build caller's grants on a branch without it (5 → 7); the int/recovery
merge holds both, hence 8. The pin was set on the rule-2 branch before
the merge.

Least-privilege review: the grant stays. `node-image` is a reusable
workflow caller, and a called workflow can hold no more than its caller
grants (the same rule the `build` job's comment states).
`node-image.yml`'s `build` job downloads the ACP tarball artifact, which
needs `actions: read` — every other artifact-downloading job in both
files declares exactly that — so removing the caller's grant would
break the release's image build. The pin moves 7 → 8 with that reason
in the test comment.

### Drill

- **C, the pin fires.** The `node-image` job's `actions: read` removed
  → `expected 7 to be 8 // Object.is equality`; restored → green.

## Proof

| Check                                                                                                                                         | Exit          | Result                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run notices` (production build + regen)                                                                                                  | 0             | `THIRD_PARTY_NOTICES.txt: 93 packages written`, file byte-identical to committed                                                                                                                                                                                              |
| `npm run build` (budgets, splits, registry, notices check)                                                                                    | 0             | `ok THIRD_PARTY_NOTICES.txt: 93 third-party notices`; `legal build records: 160 bundles, 2833 files, 0 problems`                                                                                                                                                              |
| `npx vitest run test/unit/manifest.test.ts --maxWorkers=3`                                                                                    | 0             | 41 passed                                                                                                                                                                                                                                                                     |
| `npx vitest run test/unit/nodeWorkspaceBuild.test.ts test/unit/nodeTerminalSession.test.ts test/unit/nodeWorkspaceUi.test.tsx --maxWorkers=3` | 0             | 33 passed (moved-dep consumers)                                                                                                                                                                                                                                               |
| `npx vitest run test/unit/tuiDesign.test.ts test/unit/noticesInput.test.mjs --maxWorkers=3`                                                   | 0             | 160 passed (string-width consumer, notices lib)                                                                                                                                                                                                                               |
| `npx vitest related test/unit/manifest.test.ts --run --maxWorkers=3`                                                                          | 0             | 41 passed (self)                                                                                                                                                                                                                                                              |
| `npx vitest related package.json` (full graph)                                                                                                | —             | NOT RUN whole: 40+ files incl. production-build suites and base-red `packagedBundles` (cc-tests, another lane); every suite that reads the dependency classification or the moved packages is green above                                                                     |
| prettier / eslint on touched files                                                                                                            | 0 / 0         | `prettier --check` all touched files; `eslint --max-warnings 0` the test file                                                                                                                                                                                                 |
| `npm run typecheck`                                                                                                                           | 0             | all six projects; unit project re-verified with captured exit 0                                                                                                                                                                                                               |
| `node scripts/check-l10n.mjs`                                                                                                                 | 0             | 0 problems                                                                                                                                                                                                                                                                    |
| `npm run check:reference`                                                                                                                     | 0             | catalog current                                                                                                                                                                                                                                                               |
| `npm run check:host-api`                                                                                                                      | 0             | 0 problems                                                                                                                                                                                                                                                                    |
| `npm run check:plan`                                                                                                                          | 0             | 241 milestones; 0 drift (first run flagged the new `RLF-NOTICES` heading — the grammar takes no hyphen; renamed `RLFNOTICES`)                                                                                                                                                 |
| `npm run check:roadmap` (after `roadmap:generate`)                                                                                            | 0             | 241 entries; ROADMAP.md current                                                                                                                                                                                                                                               |
| `npm run check:catches` / `duplication` / `cycles` / `deadcode`                                                                               | 0 / 0 / 0 / 0 | baseline match / 0 clones / no cycles / clean                                                                                                                                                                                                                                 |
| `npm run security:audit`                                                                                                                      | 0             | 7 advisories, 0 exceptions                                                                                                                                                                                                                                                    |
| `npm run security:sast` (macmini recipe)                                                                                                      | 1             | RED, the base's: the same 6 blocking findings in the same 5 files `docs/certification/cc-int1.md` §7 records on int/recovery (`os/build.py`, `os/pi/compose.py` ×2, `scripts/build-packs.mjs`, `mcp/headers.ts`, `keyStore.ts`); none is in this lane's diff. Not fixed here. |

## Follow-ups for the lead

1. **The TUI ships nowhere.** `src/runtime/tui/design/*` is real
   product code reachable only from tests and the harness; `ink` has no
   production importer at all. Either a build entry should carry the
   TUI into a shipped bundle (and the notices build cover it), or the
   modules should go. Left untouched: a product decision, not a
   licence fix.
2. **The node workspace ships nowhere yet either.** When M110-U1/U2
   lands its shipping (the `window.museNode` supplier, the VSIX or
   image staging), the five workspace packages return to
   `dependencies` and the notices build must read
   `dist/meta-node/workspace.json` the way it reads `dist/meta/`.
3. **cc-sigstore remainder §2 stands**: the extension notices' header
   is hand-kept and misses bundles that carry third-party code. It
   rewrites the committed file and the VSIX, so it stays the lead's
   call; this lane changed no generated line.
