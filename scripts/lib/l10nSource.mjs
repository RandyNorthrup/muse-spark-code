// The localization modules (src/shared/l10n, TypeScript) for the Node scripts
// that check or transform the tables (PLAN.md D33): esbuild bundles them in
// memory and the bundle is imported from a data: URL, so the scripts use
// the very English table and checks the extension ships, and write nothing.

import { Buffer } from 'node:buffer'
import path from 'node:path'
import * as esbuild from 'esbuild'

const L10N_DIR = 'src/shared/l10n'
const ENTRY = [
  "export { EN } from './en'",
  "export { tableProblems } from './check'",
  "export { isPluralForms } from './forms'",
  "export { TABLE_DIRECTORY, TABLE_LOCALES, tableFileName } from './locales'",
].join('\n')

/** `{ EN, tableProblems, isPluralForms, TABLE_DIRECTORY, TABLE_LOCALES, tableFileName }`. */
export async function loadL10n(repoRoot) {
  const { outputFiles } = await esbuild.build({
    stdin: {
      contents: ENTRY,
      resolveDir: path.join(repoRoot, L10N_DIR),
      sourcefile: 'l10n-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const code = Buffer.from(outputFiles[0].contents).toString('base64')
  return import(`data:text/javascript;base64,${code}`)
}
