# cc-pkgreg: the lazy bundle registry matches what the build ships

Recovery lane, rig `macmini`, worktree `/Users/randy/lanes/RLF-PKGREG`,
branch `rec/rlf-pkgreg`, base int/recovery `9b090e87c` (cc/tests merged,
plus cc-fixes, cc-sigstore, cc-vsixsize, cc-int1). No credential read, no
paid or live model call.

## Ground truth on this base

The brief's five failing packagedBundles cases (recorded in
docs/certification/cc-tests.md, "Left failing", measured at the cc/tests
merge) no longer fail here: int already carries `1f632c6fb` ("fix(int):
the lazy registry reads the production build only (7 problems to 0)",
2026-10-23, the cc-gates item-4 fix), which renamed the constant to
`NODE_WORKSPACE_STYLESHEET = './node/files/main.css'` (a stylesheet the
scan never reads) and regenerated the registry from a clean production
build. Before any change by this lane:

- `npm run build`: exit 0, `gen-lazy-registry --check` green.
- `npx vitest run test/unit/packagedBundles.test.mjs --maxWorkers=3`:
  9/9 green (622 s, repository's own timeouts).

What was still wrong was the generator itself: `resolveRequest`
(`scripts/lib/lazyRegistry.mjs`) reduced a relative name with no source
and no redirect to its basename, so `./node/files/main.js` resolved to
the chat bundle `webview/main.js` — the basename confusion the estimator
walk had (`isWebviewResource`, cc-tests). The cc-gates drill proves the
bug still fires when the constant is reverted. This lane fixes the
generator to compare full relative paths, as briefed.

## What RLM110A0's merge decided ships

- Merge `e5dcb67a2` (RLM110A0 into int/recovery): "The lazy registry
  cannot regenerate on the joined build: NODE_WORKSPACE_ASSET resolves by
  basename to webview/main.js for the agent, which the lane's own tip
  build shows too." The merge decided nothing ships by basename
  confusion; the registry is written from the production build only.
- `nodeAuth.js` / `nodeAuthPage.js` come from the separate command
  `npm run build:node-auth` (`node scripts/build-node-auth.mjs`), and
  `webview/node/files/main.js` only from the harness build
  (`test/harness/build-node.mjs`). The production build
  (`node scripts/build.mjs --production`) emits none of the three, so
  the registry carries no row for any of them (RLF-HYGIENE: rows come
  from metafile outputs on disk plus the named non-esbuild files;
  nothing is discovered by walking dist/).
- RLM110A0's own certification (`docs/certification/rlm110a0.md`) ships
  the packaged CLI lifecycle, installer, TUF client, goldens and gates;
  it names no production-build row for node auth or the node files page.

## The fix

`scripts/lib/lazyRegistry.mjs`, `resolveRequest`: a relative name with
no source and no redirect keeps its full subpath instead of its basename
(`./node/files/main.js` → `node/files/main.js`; `./team.js` unchanged;
a name that climbs with `..` matches nothing, failing closed). The
candidate rule in `scripts/gen-lazy-registry.mjs` already compares full
paths, so the subpath matches only the file it spells where a build
emits it, and the check reports "which the build does not emit"
otherwise. Doc comment updated; no signature change
(`scripts/lib/lazyRegistry.d.mts` untouched).

Inventory before the change (throwaway probe over the real tree, 447
requests, 175 known bundles): 332 relative-value requests, of which 331
resolve through the redirect map or as bundled imports; exactly one
(`src/host/teamViewBundle.ts:26`, `./team.js` → `dist/team.js`) reaches
the fallback, and it resolves identically after the fix.

Regeneration proof: `node scripts/gen-lazy-registry.mjs` after the fix
writes `src/shared/lazyBundles.generated.ts` byte-identical (no git
diff): 175 rows, 278 loads resolved, 0 rows for `nodeAuth.js`,
`nodeAuthPage.js` or `webview/node/files/main.js`, and a row for every
stable bundle the production build emits (`--check` green is that
equality).

## Drills

1. **New regression test red/green**
   (`test/unit/lazyBundleFiles.test.ts`, "matches a relative name by
   its full path, never its basename"): added first, it failed with
   `{ file: 'main.js' }` where `node/files/main.js` was expected (16/17
   green); after the fix, 17/17 green. It also pins the generator's
   candidate rule: no match on `webview/main.js` alone, exact match on
   `webview/node/files/main.js` where emitted.
2. **Constant-revert drill, now fail-closed**: `NODE_WORKSPACE_STYLESHEET`
   back to `'./node/files/main.js'` → `gen-lazy-registry --check`
   exit 1 with one problem,
   "src/shared/constants.ts:367 (NODE_WORKSPACE_STYLESHEET) loads
   ./node/files/main.js, which the build does not emit" — the full path
   named, no wrong attribution to `webview/main.js` (the old message and
   its three side rows are in docs/certification/cc-gates.md's drill).
   Restored → exit 0, "175 bundles … is current".

## Suites and gates (final tree, repository's own timeouts)

- `npx vitest run test/unit/packagedBundles.test.mjs --maxWorkers=3`:
  9/9 green (462 s). One earlier post-change run failed in a hook (9
  skipped, 288 s); its error text was lost to a truncated tail, so its
  cause is UNMEASURED, and the immediate diagnostic re-run with the full
  log saved (`temp/packaged-final.log`) is green. Not reproduced since.
- `npx vitest related scripts/lib/lazyRegistry.mjs --run`: 1 file,
  17/17 green (lazyBundleFiles).
- prettier --check (touched): 0. eslint --max-warnings=0 (touched): 0.
- `npm run typecheck`: 0. `node scripts/check-l10n.mjs`: 0 (0 problems).
- `npm run check:reference`: 0. `npm run check:host-api`: 0.
- `npm run check:plan`: 0 (0 drift). `npm run check:roadmap`: 0.
- `npm run check:catches`: 0 (matches baseline). `npm run duplication`:
  0 (0 clones). `npm run cycles`: 0. `npm run deadcode`: 0.
- `npm run build`: 0 (lazy registry step: 175 bundles, current).

No CHANGELOG entry: a person notices nothing (tooling-only fix, no
product behaviour change, registry output byte-identical).
