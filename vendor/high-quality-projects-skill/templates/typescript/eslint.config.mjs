// Strict flat ESLint config (ESLint 9+). Copy to project root as
// eslint.config.mjs, then:
//   npm i -D eslint @eslint/js typescript-eslint eslint-plugin-unicorn
//
// @eslint/js is imported below and is a separate package from eslint itself —
// omitting it fails at config load, not at lint time.
//
// COMPATIBILITY SNAPSHOT (2026-09-07): typescript-eslint 8.69.0 declares
// peerDependencies.typescript ">=4.8.4 <6.1.0". Use TypeScript 6.0.3 unless a
// newer typescript-eslint release expands that range; normal npm resolution
// should reject TypeScript 7 beside this version. Verify before pinning:
//   npm info typescript-eslint peerDependencies
//
// Keep the .mjs extension. This file uses ESM `import`, and naming it
// eslint.config.js only works when package.json declares "type": "module" —
// otherwise Node parses it as CommonJS and ESLint dies with
// "SyntaxError: Cannot use import statement outside a module". .mjs is
// unambiguous and works in both kinds of project.
//
// Uses the *TypeChecked* variants, which require a real tsconfig and are
// substantially stricter than the syntactic-only presets — they can see types,
// so they catch floating promises, unsafe `any` flow, and bad awaits.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import unicorn from 'eslint-plugin-unicorn'

export default tseslint.config(
  js.configs.recommended,

  // strictTypeChecked > strict > recommended. Includes no-unsafe-* rules that
  // stop `any` from silently propagating through the codebase.
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
      // Not enabled by the recommended preset. Use Number.isNaN for NaN checks
      // rather than self-comparison, which commonly masks a wrong operand.
      'no-self-compare': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        // Only required-but-unused parameters may opt out, e.g. (_req, res).
        // Renaming a dead local to _value must not hide it.
        { argsIgnorePattern: '^_', caughtErrors: 'all', reportUsedIgnorePattern: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // --- async correctness: the most common real bug class in TS ---
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],

      // --- escape hatches must be justified in writing ---
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // --- consistency ---
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // --- magic numbers ---
      // Enforces the "every tunable is a named constant" rule. The ignore list
      // is the set of literals whose meaning is not improved by naming:
      // identity and zero elements, -1 for "not found", 2 for a midpoint or
      // halving, 100 for percentage conversion. A magic-number rule that
      // rejects `xs.length === 0` is misconfigured, not strict.
      //
      // Keep named constants beside the domain that owns their meaning. A const
      // initializer is allowed; no global constants bucket or file-wide escape
      // hatch is needed. Tests retain independent literal expected values.
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
      'unicorn/no-null': 'off',

      // --- rules that conflict with Prettier; the formatter owns formatting ---
      // unicorn/number-literal-case wants uppercase hex digits (0x6D_2B_79_F5)
      // and Prettier rewrites them to lowercase (0x6d_2b_79_f5). With both
      // enabled, `format` and `lint` can never both pass — verified by hand.
      'unicorn/number-literal-case': 'off',

      // --- rules that break browser-only TypeScript ---
      // prefer-global-this exists to help isomorphic code. In a browser-only
      // project it produces a hard type error, because TypeScript types
      // `window` as `Window & typeof globalThis` while bare `globalThis` lacks
      // the Window members:
      //   TS2345: Argument of type 'typeof globalThis' is not assignable to
      //   parameter of type 'Window'. Property 'name' is missing.
      // Re-enable it for Node or isomorphic projects.
      'unicorn/prefer-global-this': 'off',
    },
  },

  {
    // Test files: assertions and non-null access are idiomatic there, and the
    // expected values in an assertion *are* the meaning — naming them would
    // move the assertion into a constant and make the test a tautology.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },

  {
    // This tooling config is outside the application TypeScript program.
    // Do not exempt all .mjs files: production JavaScript modules need their
    // own allowJs/checkJs project or an explicitly scoped syntactic config.
    files: ['eslint.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },

  { ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**'] },
)
