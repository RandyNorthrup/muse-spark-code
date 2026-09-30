// An esbuild plugin for the lazily loaded host bundles (PLAN.md D6): the
// bundle that is handed the display table at its entry does not carry its own
// copy of the English one. The only value import of the English table inside
// such a bundle is `UI_TEXT`'s starting value in src/shared/l10n/text.ts;
// this resolves it to the empty stand-in (src/shared/l10n/enLazy.ts), so the
// table's 78 KB is not counted again in every bundle. `check-bundle-split`
// fails a lazy bundle that still carries the real table, or one that lacks
// the stand-in.

import path from 'node:path'

/** Source files, forward slashes, relative to the repository root. */
export const LAZY_TABLE_IMPORTER = 'src/shared/l10n/text.ts'
export const LAZY_TABLE_REAL = 'src/shared/l10n/en.ts'
export const LAZY_TABLE_STAND_IN = 'src/shared/l10n/enLazy.ts'

const SAME_FOLDER_TABLE = /^\.\/en$/

function forward(file) {
  return file.split(path.sep).join('/')
}

/** @type {import('esbuild').Plugin} */
export const lazyBundleTable = {
  name: 'lazy-bundle-table',
  setup(build) {
    build.onResolve({ filter: SAME_FOLDER_TABLE }, (args) =>
      forward(path.relative(process.cwd(), args.importer)) === LAZY_TABLE_IMPORTER
        ? { path: path.resolve(LAZY_TABLE_STAND_IN) }
        : undefined,
    )
  },
}
