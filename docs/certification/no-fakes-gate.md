# No-stand-ins lint gate (2026-10-17)

The owner, 2026-10-17: "there can be no more fakes at all everything needs to be tested meaningfully or in actual use cases". PR #183 deleted the stand-in tests, but nothing stopped new ones. This gate makes ESLint refuse them in every test file, so a stand-in fails the commit hook and hosted CI.

## What it refuses (eslint.config.mjs, the `test/**/*.{ts,tsx,mjs}` block)

- `vi.mock`, `vi.doMock`, `vi.hoisted`, `vi.mocked`, `vi.stubGlobal`, `vi.useFakeTimers`, `vi.spyOn` and `vi.fn` (`no-restricted-properties`);
- any mock function method: `mockReturnValue`, `mockReturnThis`, `mockResolvedValue`, `mockRejectedValue`, `mockImplementation`, `mockClear`, `mockReset` and `mockRestore`, each with or without `Once` (`no-restricted-syntax`);
- `mock` from `node:test`, and the stand-in libraries `sinon`, `nock`, `msw`, `testdouble`, `jest-mock`, `mock-fs` and `memfs`;
- imports from `mocks/`, `__mocks__/`, and `fake*`, `*Fake*` or `stub*` modules (`no-restricted-imports`).
- (lane STANDINS) `new Proxy(...)` — a Proxy answering property reads is a module-surface stand-in (`no-restricted-syntax`);
- (lane PR223FIX2) assignment to the module loader's `_load` / `_resolveFilename` — loader interception is a stand-in (`loader/no-loader-interception`, a local rule in `eslint.config.mjs`). It tracks the binding imported from `node:module` (default, named, namespace and `require` spellings, dotted and computed) instead of matching one local name, and keeps flagging the bare `Module` spelling.

The block covers `test/**/*.mjs` since lane STANDINS: the marketplace-hook KV double lived in a `.mjs` test the old `ts,tsx` glob never saw. The packaging loader's `vscode` trap (`test/packaging/moduleExports.test.mjs`) was the one deliberate exception, with two scoped `eslint-disable-next-line no-restricted-syntax` lines logged in PLAN.md §8. Lane PR223FIX (2026-10-17, Codex thread) deleted the trap, the Proxy and both suppressions, and withdrew the §8 row: VS Code-bound bundles now compare as identical bare-Node refusals and worker entries boot as real threads, so the gate has no exception left.

`vi.stubEnv` stays allowed: it sets a real environment variable that a real child process must not inherit (`test/unit/eval/evalTasks.test.ts`).

## What it found on main 03ae95171 (after PR #183)

There were 19 findings in 6 files that the deleted-files sweep missed, because they were written across lines. Under the owner's rule, the stand-in tests were removed and their behaviours added to `docs/real-life/unproven.md`:

- `test/unit/GoalPanel.test.tsx`, `test/unit/hostL10n.test.ts`, `test/unit/openInTerminal.test.ts`, `test/unit/planCommands.test.ts` and `test/unit/whatsNewPage.test.ts`: whole files, because every test used a stand-in;
- `test/unit/legalFixProduction.test.ts`: the four tests built on stand-in write, approval and hash functions. Its seven tests on real code stay, and pass (7/7).

## Red drill (2026-10-17, Windows)

A planted file `test/unit/zzDrill.test.ts` holding `vi.mock(...)`, `vi.fn()` and `.mockReturnValue(1)`:

```
npx eslint test/unit/zzDrill.test.ts
test/unit/zzDrill.test.ts:2 no-restricted-properties 'vi.mock' is restricted from being used. vi.mock is a stand-in.
test/unit/zzDrill.test.ts:3 no-restricted-properties 'vi.fn' is restricted from being used. vi.fn is a stand-in.
test/unit/zzDrill.test.ts:3 no-restricted-syntax A mock function is a stand-in. Test the real code (AGENTS.md: no fakes in tests).
exit 1
```

After the planted file was removed, `npx eslint --max-warnings=0 test/` exited 0 again.

## Red drill for the STANDINS rules (2026-10-17, macmini rig)

Planted `test/unit/zzDrill.test.ts` (`new Proxy` plus a `Module._load` assignment) and `test/unit/zzDrill.test.mjs` (`new Proxy`):

```
test/unit/zzDrill.test.mjs
  5:20  error  A Proxy that answers property reads is a module-surface stand-in. Test the real code (AGENTS.md: no fakes in tests)  no-restricted-syntax
test/unit/zzDrill.test.ts
   6:20  error  A Proxy that answers property reads is a module-surface stand-in. Test the real code (AGENTS.md: no fakes in tests)     no-restricted-syntax
  13:5   error  Intercepting the module loader is a stand-in. Test the real code (AGENTS.md: no fakes in tests)                         no-restricted-syntax
```

Both rules fire in `.ts` and `.mjs`. `test/packaging/moduleExports.test.mjs` reports no errors: it carries no suppression (lane PR223FIX deleted the trap and both disables). After the planted files were removed, `npx eslint --max-warnings=0` on every touched file exited 0.

Correction (review lane RVSTANDINS, 2026-10-17): the loader selector
matched only the dotted spelling; `Module['_load'] = ...` passed lint
(planted and measured). A computed-property selector now covers it:
the same planted file reports both the computed `_load` and the dotted
`_resolveFilename` assignments. (Lane PR223FIX deleted the packaging
file's scoped disables with the trap itself, so no disable remains.)

Correction (lane PR223FIX2, 2026-10-18, macmini rig): the selectors still
matched only an identifier literally named `Module`, so
`import Loader from 'node:module'; Loader._load = ...` passed lint
(planted and measured). The local `loader/no-loader-interception` rule
replaces both selectors and follows the imported binding instead.
Red drill, `test/unit/zzLoaderDrill.test.mjs` (removed after):

```
5:1   error  Intercepting the module loader is a stand-in. Test the real code (AGENTS.md: no fakes in tests)  loader/no-loader-interception
8:1   error  ...  loader/no-loader-interception   (Loader['_resolveFilename'])
11:1  error  ...  loader/no-loader-interception   (Renamed._load, named import)
12:1  error  ...  loader/no-loader-interception   (mod.Module._load, namespace)
14:1  error  ...  loader/no-loader-interception   (Module._load, literal)
16:1  error  ...  loader/no-loader-interception   (Needed._resolveFilename, require)
```

Six planted assignments, six findings. After the planted file was
removed, `npx eslint --max-warnings=0` on every touched file exited 0.

## Gates on the final tree

- `npx eslint --max-warnings=0 test/ eslint.config.mjs`: exit 0
- `npx prettier --check` on the changed files: exit 0
- `npx tsc -p test/unit/tsconfig.json --noEmit`: exit 0
- `npm run deadcode`: exit 0
- `npx vitest run test/unit/legalFixProduction.test.ts`: 7 passed
