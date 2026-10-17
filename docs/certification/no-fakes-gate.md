# No-stand-ins lint gate (2026-10-17)

The owner, 2026-10-17: "there can be no more fakes at all everything needs to be tested meaningfully or in actual use cases". PR #183 deleted the stand-in tests, but nothing stopped new ones. This gate makes ESLint refuse them in every test file, so a stand-in fails the commit hook and hosted CI.

## What it refuses (eslint.config.mjs, the `test/**/*.{ts,tsx,mjs}` block)

- `vi.mock`, `vi.doMock`, `vi.hoisted`, `vi.mocked`, `vi.stubGlobal`, `vi.useFakeTimers`, `vi.spyOn` and `vi.fn` (`no-restricted-properties`);
- any mock function method: `mockReturnValue`, `mockReturnThis`, `mockResolvedValue`, `mockRejectedValue`, `mockImplementation`, `mockClear`, `mockReset` and `mockRestore`, each with or without `Once` (`no-restricted-syntax`);
- `mock` from `node:test`, and the stand-in libraries `sinon`, `nock`, `msw`, `testdouble`, `jest-mock`, `mock-fs` and `memfs`;
- imports from `mocks/`, `__mocks__/`, and `fake*`, `*Fake*` or `stub*` modules (`no-restricted-imports`).
- (lane STANDINS) `new Proxy(...)` — a Proxy answering property reads is a module-surface stand-in (`no-restricted-syntax`);
- (lane STANDINS) assignment to `Module._load` / `Module._resolveFilename` — loader interception is a stand-in (`no-restricted-syntax`).

The block covers `test/**/*.mjs` since lane STANDINS: the marketplace-hook KV double lived in a `.mjs` test the old `ts,tsx` glob never saw. The packaging loader's `vscode` trap (`test/packaging/moduleExports.test.mjs`) is the one deliberate exception: two scoped `eslint-disable-next-line no-restricted-syntax` lines with inline reasons, logged in PLAN.md §8. It is load isolation only — VS Code-bound bundles must import in bare Node — and no exercised call reaches it.

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

Both rules fire in `.ts` and `.mjs`. `test/packaging/moduleExports.test.mjs` reports no errors: its two scoped disables hold. After the planted files were removed, `npx eslint --max-warnings=0` on every touched file exited 0.

## Gates on the final tree

- `npx eslint --max-warnings=0 test/ eslint.config.mjs`: exit 0
- `npx prettier --check` on the changed files: exit 0
- `npx tsc -p test/unit/tsconfig.json --noEmit`: exit 0
- `npm run deadcode`: exit 0
- `npx vitest run test/unit/legalFixProduction.test.ts`: 7 passed
