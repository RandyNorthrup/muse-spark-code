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

// M57 (PLAN.md D6): the Model API host runs from a bundle of its own with its
// own copies of the errors a host throws to the conversation controller, so
// `instanceof` misses one it threw. The `is…` guards in
// src/core/agent/agentBackend.ts read the name and the field instead.
const BUNDLE_SAFE_ERRORS = {
  selector:
    "BinaryExpression[operator='instanceof'][right.name=/^(SessionNotLoadedError|PromptSettledError|GoalRefusedError|MuseCodeFaultError|DecisionNotAppliedError|SteerRefusedError)$/]",
  message:
    'A host error may come from the Model API bundle, whose classes are its own copies: use isSessionNotLoadedError, isPromptSettledError, isGoalRefusedError, isMuseCodeFaultError, isDecisionNotAppliedError or isSteerRefusedError (src/core/agent/agentBackend.ts).',
}

// D94: all surface colours come from the token source, including SVG paint.
// Keep this in both syntax-rule blocks: later rule arrays replace earlier ones.
const COLOUR_PATTERN = String.raw`(?:^|[\s:,('"])(?:#[\da-f]{3,8}(?=[^\da-f]|$)|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\s*\()`
const COLOUR_LITERALS = [
  {
    selector: `Literal[value=/${COLOUR_PATTERN}/i]`,
    message: 'Raw colours belong in design/tokens/muse.tokens.json; read a --ms-* token.',
  },
  {
    selector: `TemplateElement:matches([value.raw=/${COLOUR_PATTERN}/i], [value.cooked=/${COLOUR_PATTERN}/i])`,
    message: 'Raw colours belong in design/tokens/muse.tokens.json; read a --ms-* token.',
  },
]
// Dynamic imports and CommonJS must obey the same boundary as static imports.
const recordingBoundary = {
  rules: {
    boundary: {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          port: 'Context builders must read through the recording reader; native I/O, Git and skill stores belong to adapters.',
        },
      },
      create(context) {
        const check = (node, source) => {
          const specifier =
            typeof source?.value === 'string' ? source.value.replaceAll('\\', '/') : undefined
          if (
            specifier === undefined ||
            /^(?:node:)?(?:fs(?:\/|$)|child_process$)|(?:^|\/)(?:host\/(?:backend\/)?(?:git|contextIo|toolIo)(?:\.js)?$|(?:skillStore|skillsStore)(?:\.js)?$|host\/skills\/)/.test(
              specifier,
            )
          )
            context.report({ node, messageId: 'port' })
        }
        return {
          ImportExpression(node) {
            check(node, node.source)
          },
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'require')
              check(node, node.arguments[0])
          },
        }
      },
    },
  },
}

// No stand-ins: assigning the module loader's `_load` or `_resolveFilename`
// intercepts resolution. The binding's local spelling is whatever the test
// chose (`Module`, `Loader`, ...), so this rule tracks the binding imported
// from `node:module` instead of matching one name.
const isModuleSource = (value) => value === 'node:module' || value === 'module'
const loaderTrapName = (member) => {
  if (member.computed) {
    return member.property.type === 'Literal' ? member.property.value : undefined
  }
  return member.property.type === 'Identifier' ? member.property.name : undefined
}
const loaderRequireSource = (node) =>
  node.callee.type === 'Identifier' &&
  node.callee.name === 'require' &&
  node.arguments.length > 0 &&
  node.arguments[0].type === 'Literal' &&
  isModuleSource(node.arguments[0].value)
    ? node
    : undefined
const loaderInterception = {
  rules: {
    'no-loader-interception': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          intercept:
            'Intercepting the module loader is a stand-in. Test the real code (AGENTS.md: no fakes in tests).',
        },
      },
      create(context) {
        // The bare `Module` spelling stays flagged even without an import,
        // so the earlier gate loses nothing; every spelling imported from
        // `node:module` joins it.
        const moduleObjects = new Set(['Module'])
        const namespaces = new Set()
        const report = (node) => context.report({ node, messageId: 'intercept' })
        return {
          ImportDeclaration(node) {
            if (typeof node.source.value !== 'string' || !isModuleSource(node.source.value)) {
              return
            }
            for (const specifier of node.specifiers) {
              if (specifier.type === 'ImportNamespaceSpecifier') {
                namespaces.add(specifier.local.name)
              } else if (
                specifier.type === 'ImportDefaultSpecifier' ||
                (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'Module')
              ) {
                moduleObjects.add(specifier.local.name)
              }
            }
          },
          TSImportEqualsDeclaration(node) {
            if (
              node.moduleReference.type === 'TSExternalModuleReference' &&
              node.moduleReference.expression.type === 'Literal' &&
              isModuleSource(node.moduleReference.expression.value)
            ) {
              moduleObjects.add(node.id.name)
            }
          },
          VariableDeclarator(node) {
            const matched =
              node.init?.type === 'CallExpression' ? loaderRequireSource(node.init) : undefined
            if (matched === undefined) {
              return
            }
            if (node.id.type === 'Identifier') {
              moduleObjects.add(node.id.name)
            } else if (node.id.type === 'ObjectPattern') {
              for (const property of node.id.properties) {
                if (
                  property.type === 'Property' &&
                  property.key.type === 'Identifier' &&
                  property.key.name === 'Module' &&
                  property.value.type === 'Identifier'
                ) {
                  moduleObjects.add(property.value.name)
                }
              }
            }
          },
          AssignmentExpression(node) {
            if (node.left.type !== 'MemberExpression') {
              return
            }
            const name = loaderTrapName(node.left)
            if (name !== '_load' && name !== '_resolveFilename') {
              return
            }
            const object = node.left.object
            const isTracked = object.type === 'Identifier' && moduleObjects.has(object.name)
            const isNamespaced =
              object.type === 'MemberExpression' &&
              !object.computed &&
              object.property.type === 'Identifier' &&
              object.property.name === 'Module' &&
              object.object.type === 'Identifier' &&
              namespaces.has(object.object.name)
            if (isTracked || isNamespaced) {
              report(node)
            }
          },
        }
      },
    },
  },
}

const config = tseslint.config(
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
    // M115: context builders receive the recording workspace/Git/skill ports.
    // Native adapters own filesystem/process imports; a builder cannot bypass
    // recording by importing them or the host's raw Git runner.
    files: [
      'src/core/context/**/*.ts',
      'src/core/codeIntel/repoMap.ts',
      'src/core/memory/memoryStore.ts',
      'src/core/memory/memoryIndex.ts',
      'src/core/backends/modelapi/ModelApiHost.ts',
      'src/core/backends/modelapi/instructions.ts',
      'src/core/backends/modelapi/mediaBudget.ts',
      'src/core/backends/modelapi/verifyLoop.ts',
      'src/core/backends/modelapi/schedulesEntry.ts',
    ],
    plugins: { recording: recordingBoundary },
    rules: {
      'recording/boundary': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:fs',
                'node:fs/**',
                'fs',
                'fs/**',
                'node:child_process',
                'child_process',
                '**/skillStore',
                '**/skillStore.js',
                '**/skillsStore',
                '**/skillsStore.js',
                '**/host/skills/**',
                '**/host/git',
                '**/host/git.js',
                '**/host/backend/git',
                '**/host/backend/git.js',
                '**/host/backend/contextIo',
                '**/host/backend/contextIo.js',
                '**/host/backend/toolIo',
                '**/host/backend/toolIo.js',
              ],
              message:
                'Context builders must use their scoped recording reader; native I/O and Git belong to adapters.',
            },
          ],
        },
      ],
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
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', BUNDLE_SAFE_ERRORS, ...COLOUR_LITERALS] },
  },

  {
    // R1: native identity reads belong only to the exact BigInt sampler. A
    // later block's rule value replaces an earlier one's, so the M57 entry is
    // repeated here or every file but fileIdentity.ts would lose it.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/fs/fileIdentity.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[computed=false][property.name=/^(ino|dev)$/], MemberExpression[computed=true][property.value=/^(ino|dev)$/], ObjectPattern > Property[key.name=/^(ino|dev)$/], ObjectPattern > Property[key.value=/^(ino|dev)$/]',
          message:
            'Native file identity belongs to src/core/fs/fileIdentity.ts; use its exact BigInt samples and sameFile.',
        },
        BUNDLE_SAFE_ERRORS,
        ...COLOUR_LITERALS,
      ],
    },
  },

  {
    // The constants module is the one place literals belong; the rule would be
    // unsatisfiable here. The browser check's tunables are its part, kept in a
    // module of their own that constants.ts re-exports (M81 A1: the check's
    // 50 KiB bundle reads them without the rest), as are Linux dictation's
    // (D140: the dictation and voiceLinux bundles read them without the rest).
    files: [
      'src/shared/constants.ts',
      'src/shared/browserCheckConstants.ts',
      'src/shared/linuxDictationConstants.ts',
    ],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },

  {
    // Test files: assertions and non-null access are idiomatic there, and the
    // expected values in an assertion *are* the meaning. Plain-JS tests
    // (.mjs) are covered too: the marketplace-hook KV double lived in one.
    files: ['test/**/*.{ts,tsx,mjs}'],
    plugins: { loader: loaderInterception },
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
      // No stand-ins, ever (owner, 2026-10-12 and 2026-10-17: "there can be no
      // more fakes at all everything needs to be tested meaningfully or in
      // actual use cases"). Tests drive real code; outside-world input is only
      // a recorded real exchange with its capture date.
      'loader/no-loader-interception': 'error',
      'no-restricted-properties': [
        'error',
        ...[
          'mock',
          'doMock',
          'hoisted',
          'mocked',
          'stubGlobal',
          'useFakeTimers',
          'spyOn',
          'fn',
        ].map((property) => ({
          object: 'vi',
          property,
          message: `vi.${property} is a stand-in. Test the real code (AGENTS.md: no fakes in tests).`,
        })),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[property.name=/^mock(Return(Value|This)|ResolvedValue|RejectedValue|Implementation|Clear|Reset|Restore)(Once)?$/]',
          message:
            'A mock function is a stand-in. Test the real code (AGENTS.md: no fakes in tests).',
        },
        {
          // No exemption: a Proxy that answers property reads is a
          // module-surface stand-in everywhere it appears.
          selector: "NewExpression[callee.name='Proxy']",
          message:
            'A Proxy that answers property reads is a module-surface stand-in. Test the real code (AGENTS.md: no fakes in tests).',
        },
        // Loader interception is tracked by name, not spelling:
        // loader/no-loader-interception follows the binding imported from
        // `node:module` (an alias included), in both property spellings.
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:test',
              importNames: ['mock'],
              message:
                'node:test mock is a stand-in. Test the real code (AGENTS.md: no fakes in tests).',
            },
            ...['sinon', 'nock', 'msw', 'testdouble', 'jest-mock', 'mock-fs', 'memfs'].map(
              (name) => ({
                name,
                message: `${name} builds stand-ins. Test the real code (AGENTS.md: no fakes in tests).`,
              }),
            ),
          ],
          patterns: [
            {
              group: ['**/mocks/**', '**/__mocks__/**', '**/fake*', '**/*Fake*', '**/stub*'],
              message:
                'Stand-in modules are not allowed. Test the real code (AGENTS.md: no fakes in tests).',
            },
          ],
        },
      ],
    },
  },

  {
    // Plain-JS tooling files are not in any TypeScript project, so type-aware
    // rules cannot run on them. They are Node CLIs: console output and
    // process.exit are their job. The declaration a tooling module hands the
    // unit tests (scripts/lib/lazyBundleTable.d.mts, M83) is one of them.
    files: ['**/*.mjs', '**/*.d.mts'],
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

  {
    // The badge Worker (infra/marketplace-hook) is plain ESM for the Cloudflare
    // Workers runtime, outside every TypeScript project; these are its globals.
    files: ['infra/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        crypto: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },

  // harness-shots/ holds screenshots and a headless-Chrome profile (which
  // Chrome fills with its own extension scripts); nothing there is ours.
  // `.claude/` holds Claude Code's session settings and the git worktrees its
  // agents work in (whole copies of this repository); none of it is ours to lint.
  {
    ignores: [
      'dist/**',
      'out/**',
      'coverage/**',
      'node_modules/**',
      '.vscode-test/**',
      'harness-shots/**',
      '.claude/**',
      'vendor/**',
      'temp/**',
    ],
  },
  {
    // M113 D93: collectors consume only the injected normalized snapshot.
    files: ['src/core/reporting/collect/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ['vscode'], patterns: ['**/backends/**', '**/host/**'] },
      ],
      'no-restricted-syntax': [
        'error',
        BUNDLE_SAFE_ERRORS,
        {
          selector:
            'NewExpression[callee.name=Date], MemberExpression[object.name=Date][property.name=now], MemberExpression[object.name=Math][property.name=random], MemberExpression[object.name=performance][property.name=now], Identifier[name=process], ImportSpecifier[imported.name=UI_TEXT]',
          message: 'Deterministic collectors read only injected facts and options.',
        },
        {
          selector:
            'MemberExpression[computed=false][property.name=/^(ino|dev)$/], MemberExpression[computed=true][property.value=/^(ino|dev)$/], ObjectPattern > Property[key.name=/^(ino|dev)$/], ObjectPattern > Property[key.value=/^(ino|dev)$/]',
          message: 'Native identity belongs to fileIdentity.ts.',
        },
      ],
    },
  },
)

export default config
