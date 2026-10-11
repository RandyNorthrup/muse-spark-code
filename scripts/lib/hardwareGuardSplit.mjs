import path from 'node:path'
import { readFileSync } from 'node:fs'

// Source imports stay testable. Shipped Node callers keep only synchronous
// first-use proxies; the same-build guard and its parser are never activated
// by importing a backend, an approval rule or the conversation controller.
const EXPORTS = new Map(
  [
    ['src/core/agent/approvalHardware.ts', ['approvalHardwareAction', 'scrubHardwareApproval']],
    [
      'src/core/agent/approvalSecrets.ts',
      [
        'shellSecretText',
        'hasApprovalSecret',
        'scrubSecretSubject',
        'scrubSecretChoices',
        'scrubSecretApproval',
      ],
    ],
    [
      'src/core/agent/approvalRules.ts',
      ['childPermissionMode', 'allowOnceChoice', 'isReviewableApproval', 'editAutomaticallyChoice'],
    ],
    [
      'src/core/maker/guard/hardwareCommands.ts',
      ['hardwareAction', 'hardwareArgvAction', 'hardwareTargets', 'isHardwareStop', 'hardwareStop'],
    ],
    [
      'src/core/maker/guard/shellPolicy.ts',
      ['isHardwareWorkspace', 'hardwareShellNote', 'hardwareApprovalMode', 'prepareHardwareTurn'],
    ],
    ['src/core/maker/guard/shellParse.ts', ['parseShell']],
    ['src/core/maker/ports.ts', ['HardwareApproval']],
    ['src/core/maker/sessionGuard.ts', ['SessionHardwareGuard']],
    ['src/core/maker/hardwareContext.ts', ['createHardwareContexts', 'hasHardwareEvidence']],
    ['src/core/maker/guard/actionClass.ts', ['isDeviceAction', 'isPhysicalTool']],
  ].map(([source, names]) => [path.resolve(source), names]),
)

function guardSplit(name, exportsBySource, bundle, hasSecrets) {
  return {
    name,
    setup(build) {
      build.onResolve({ filter: /^\.\/hardware(?:Guard|Shell)\.js$/ }, (args) => ({
        path: args.path,
        external: true,
      }))
      build.onResolve(
        {
          filter:
            /\/(?:approvalHardware|approvalRules|approvalSecrets|hardwareCommands|shellParse|shellPolicy|ports|sessionGuard|hardwareContext|actionClass)(?:\.[jt]s)?$/,
        },
        (args) => {
          const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
          return exportsBySource.has(source)
            ? { path: 'guard-proxy', namespace: 'hardware-guard-proxy' }
            : undefined
        },
      )
      build.onLoad({ filter: /.*/, namespace: 'hardware-guard-proxy' }, (args) => {
        if (args.path !== 'guard-proxy')
          throw new Error(`Unknown hardware guard proxy: ${args.path}`)
        const names = exportsBySource.values().toArray().flat()
        // Signatures belong to this exact packaged tree, as the existing lazy factories do.
        const exports = names
          .map((name) => {
            if (name === 'createHardwareContexts')
              return 'export const createHardwareContexts = (...args) => { let contexts; return (...roots) => (contexts ??= load().createHardwareContexts(...args))(...roots); };'
            return /^(?:HardwareApproval|SessionHardwareGuard)$/.test(name)
              ? `export class ${name} { constructor(...args) { return new (load().${name})(...args) } }`
              : `export const ${name} = (...args) => load().${name}(...args);`
          })
          .join('\n')
        return {
          loader: 'js',
          resolveDir: process.cwd(),
          contents: `import { UI_TEXT, uiLocale } from './src/shared/l10n/text.ts';
          ${hasSecrets ? "import { countSecretMatches, redactSecrets } from './src/core/redact.ts';" : ''}
          function load() { const guard = require('./${bundle}'); guard.setHardwareText(UI_TEXT, uiLocale()${hasSecrets ? ', { countSecretMatches, redactSecrets }' : ''}); return guard; }
          ${exports}`,
        }
      })
    },
  }
}

export const hardwareGuardSplit = guardSplit(
  'hardware-guard-split',
  EXPORTS,
  'hardwareGuard.js',
  true,
)
export const hardwareShellSplit = guardSplit(
  'hardware-shell-split',
  new Map(
    [...EXPORTS]
      .filter(([source]) =>
        /[\\/]guard[\\/](?:hardwareCommands|shellParse|shellPolicy)\.ts$/.test(source),
      )
      .map(([source, names]) => [
        source,
        names.filter((name) => name !== 'hardwareApprovalMode' && name !== 'prepareHardwareTurn'),
      ]),
  ),
  'hardwareShell.js',
  false,
)

// The shared declaration files: only `export` declarations, no statement with
// an effect. FIXM103DIET: esbuild keeps unused `64 * 1024` declarations, so
// hasHardwareEvidence's import put all of constants.ts into the shell bundle.
const DECLARATION_FILES = new Set(
  [
    'src/shared/constants.ts',
    'src/shared/browserCheckConstants.ts',
    'src/shared/makerPreviewConstants.ts',
  ].map((file) => path.resolve(file)),
)

// Constant-table Set constructors have no effects beyond building their own
// table. Mark only this immutable declarations file in the lazy guard build;
// used tables remain, unused tables do not consume the new bundle's budget.
// Integer-literal products are folded to the same number for the same reason.
export const hardwareConstantTables = {
  name: 'hardware-constant-tables',
  setup(build) {
    build.onResolve({ filter: /\/redact(?:\.[jt]s)?$/ }, (args) => {
      const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
      return source === path.resolve('src/core/redact.ts')
        ? { path: path.resolve('src/core/maker/guardSecrets.ts') }
        : undefined
    })
    build.onResolve(
      { filter: /\/(?:constants|browserCheckConstants|makerPreviewConstants)(?:\.[jt]s)?$/ },
      (args) => {
        const source = path.resolve(args.resolveDir, args.path.replace(/(?:\.[jt]s)?$/, '.ts'))
        return DECLARATION_FILES.has(source) ? { path: source, sideEffects: false } : undefined
      },
    )
    build.onLoad({ filter: /[\\/]shared[\\/]constants\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, 'utf8')
        .replaceAll(/\bnew Set\(/g, '/* @__PURE__ */ new Set(')
        .replaceAll(
          /^(export const \w+ = )(\d[\d_]*(?: \* \d[\d_]*)+)(?=\r?$)/gm,
          (_, declaration, product) =>
            declaration +
            product
              .split(' * ')
              .reduce((value, factor) => value * Number(factor.replaceAll('_', '')), 1),
        ),
      loader: 'ts',
      resolveDir: path.dirname(args.path),
    }))
  },
}

// Browser readers keep the same constant values. Fold integer-literal products
// so unused declarations need not occupy first paint; this changes no imports.
export const browserConstantTables = {
  name: 'browser-constant-tables',
  setup(build) {
    build.onLoad({ filter: /[\\/]shared[\\/]constants\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, 'utf8').replaceAll(
        /^(export const \w+ = )(\d[\d_]*(?: \* \d[\d_]*)+)(?=\r?$)/gm,
        (_, declaration, product) =>
          declaration +
          product
            .split(' * ')
            .reduce((value, factor) => value * Number(factor.replaceAll('_', '')), 1),
      ),
      loader: 'ts',
      resolveDir: path.dirname(args.path),
    }))
  },
}

// These messages are sent as localized host notes, never read by a browser.
// Keep them in Node's full fallback and all translated tables, outside the
// browser startup fallback. The split gate rejects a future browser reader.
export const browserHardwareText = {
  name: 'browser-hardware-text',
  setup(build) {
    build.onLoad({ filter: /[\\/]shared[\\/]l10n[\\/]en\.ts$/ }, (args) => {
      const text = readFileSync(args.path, 'utf8')
      const start = text.indexOf('  // M103-G: the always-on physical-action guard.')
      const end = text.indexOf('  exportThenRunLabel:', start)
      if (start === -1 || end === -1)
        throw new Error('Missing host-only hardware display-text block')
      return {
        contents: text.slice(0, start) + text.slice(end),
        loader: 'ts',
        resolveDir: path.dirname(args.path),
      }
    })
  },
}
