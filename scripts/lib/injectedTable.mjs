// The English table left out of a bundle that is handed the display
// language's table (PLAN.md D6, the amendment of the M82/M77/M78 joint
// branch). `dist/modelApi.js` is required by the activation bundle (or by the
// ACP agent), whose `ModelApiBackendManager` passes its installed table and
// locale to `createModelApiHost`; the factory calls `setUiText` before it
// builds anything (src/host/backend/modelApiEntry.ts). The English table the
// bundle would otherwise carry as `UI_TEXT`'s starting value was 74 KiB of a
// 400 KiB budget, and every new sentence cost its bytes twice.
//
// This esbuild plugin replaces that one import, `EN` in
// src/shared/l10n/text.ts, with an empty table. It refuses any other value
// import of the English table, so code that reads `EN` itself (the host's
// table loader, the webview's installer) can never reach the bundle and find
// it empty: the build fails instead. A type import leaves no runtime import.

import path from 'node:path'

const NAMESPACE = 'injected-table'
const TABLE_FILE = path.resolve('src', 'shared', 'l10n', 'en.ts')
const TEXT_FILE = path.resolve('src', 'shared', 'l10n', 'text.ts')
const SKIP = 'injected-table-skip'

/** @returns {import('esbuild').Plugin} */
export function injectedTable() {
  return {
    name: 'injected-table',
    setup(build) {
      build.onResolve({ filter: /(^|\/)en$/ }, async (args) => {
        if (args.pluginData === SKIP) {
          return
        }
        const resolved = await build.resolve(args.path, {
          importer: args.importer,
          kind: args.kind,
          resolveDir: args.resolveDir,
          pluginData: SKIP,
        })
        if (resolved.errors.length > 0 || path.resolve(resolved.path) !== TABLE_FILE) {
          return
        }
        if (path.resolve(args.importer) !== TEXT_FILE) {
          return {
            errors: [
              {
                text: `${args.importer} imports the English table, which this bundle is handed at run time (scripts/lib/injectedTable.mjs)`,
              },
            ],
          }
        }
        return { path: 'english-table', namespace: NAMESPACE }
      })
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, () => ({
        contents: 'export const EN = {}',
        loader: 'js',
      }))
    },
  }
}
