// Strict flat ESLint config (ESLint 10, typescript-eslint 8, type-checked).
//
// TypeScript is pinned to 6.0.3 because every published typescript-eslint
// declares peerDependencies.typescript ">=4.8.4 <6.1.0". TypeScript 7 installs
// fine and then silently disables every type-aware rule below. Verify before
// bumping:  npm info typescript-eslint peerDependencies
//
// Type-aware rules need a tsconfig. `projectService` picks the nearest
// tsconfig.json for each file: the root one for host/core/shared code,
// src/webview/tsconfig.json for the webview, test/unit and test/integration
// for tests. Files outside every project (this file, scripts/*.mjs,
// .vscode-test.mjs) get the syntactic rules only.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import unicorn from 'eslint-plugin-unicorn'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  js.configs.recommended,

  // strictTypeChecked > strict > recommended. Includes the no-unsafe-* rules
  // that stop `any` from silently propagating.
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { unicorn },
    rules: {
      ...unicorn.configs.recommended.rules,

      // --- dead code ---
      'no-unused-private-class-members': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // Underscore prefix is the documented opt-out, e.g. (_req, res).
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'all' },
      ],

      // --- async correctness: the most common real bug class in TS ---
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],

      // --- escape hatches must be justified in writing (and in PLAN.md §8) ---
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // --- consistency ---
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Warnings are errors under --max-warnings=0; the allow list is for the
      // extension host, which has no console anyway (it uses LogOutputChannel).
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // --- magic numbers ---
      // Every tunable is a named constant in src/shared/constants.ts. The ignore
      // list is the set of literals whose meaning is not improved by naming.
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2, 100],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],

      // unicorn defaults that fight normal code more than they help
      'unicorn/prevent-abbreviations': 'off',
      // Same family as prevent-abbreviations: it rejects `ctx`, `props`,
      // `AppProps` and other names that are conventions in VS Code and React.
      'unicorn/name-replacements': 'off',
      'unicorn/no-null': 'off',
      // Rejects single-line `/** ... */` TSDoc on members and `/** @type */`
      // JSDoc in .mjs files, which are documentation, not style.
      'unicorn/single-line-block-comment-style': 'off',
      // zod schemas are declarative trees: z.object({ a: z.optional(z.array(z.string())) })
      // is four nested calls by design, not a readability problem.
      'unicorn/max-nested-calls': 'off',
      // React components and VS Code provider classes are PascalCase files;
      // everything else is camelCase or kebab-case.
      'unicorn/filename-case': [
        'error',
        { cases: { camelCase: true, pascalCase: true, kebabCase: true } },
      ],

      // --- rules that conflict with Prettier; the formatter owns formatting ---
      // unicorn/number-literal-case wants uppercase hex digits and Prettier
      // rewrites them to lowercase; with both on, format and lint can never
      // both pass.
      'unicorn/number-literal-case': 'off',
    },
  },

  {
    // Webview: browser-only TypeScript + React.
    // unicorn/prefer-global-this produces a hard type error in browser-only
    // code (TS2345 `typeof globalThis` is not assignable to `Window`), so it is
    // off here and stays on for the Node-side host code.
    files: ['src/webview/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'unicorn/prefer-global-this': 'off',
    },
  },

  {
    // The constants module is the one place literals belong; the rule would be
    // unsatisfiable here.
    files: ['src/shared/constants.ts'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },

  {
    // Test files: assertions and non-null access are idiomatic there, and the
    // expected values in an assertion *are* the meaning.
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      'unicorn/prefer-global-this': 'off',
      // The vscode mock reproduces VS Code's own `EventEmitter` API shape;
      // EventTarget would not satisfy `vscode.Event<T>`.
      'unicorn/prefer-event-target': 'off',
      // `expect(deps.method)` on a vi.fn() is the assertion idiom; the mocks
      // never depend on `this`.
      '@typescript-eslint/unbound-method': 'off',
      // `() => undefined` in a fake spells out "no surface / no editor" and
      // satisfies the `T | undefined` return type explicitly.
      'unicorn/no-useless-undefined': 'off',
    },
  },

  {
    // Plain-JS tooling files are not in any TypeScript project, so type-aware
    // rules cannot run on them. They are Node CLIs: console output and
    // process.exit are their job.
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      // fetch and WebSocket are Node 22 globals (scripts/capture-themes.mjs).
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      'no-console': 'off',
      'unicorn/no-process-exit': 'off',
    },
  },

  // harness-shots/ holds screenshots and a headless-Chrome profile (which
  // Chrome fills with its own extension scripts); nothing there is ours.
  // `.claude/` holds Claude Code's session settings and the git worktrees its
  // agents work in (whole copies of this repository); none of it is ours to lint.
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.vscode-test/**',
      'harness-shots/**',
      '.claude/**',
    ],
  },
)
