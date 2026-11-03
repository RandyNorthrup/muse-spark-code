// The Models first-paint bundle that teamModelsFirstPaint serves. Built once
// per run by test/unit/globalSetup.mjs, before any worker starts, so a
// loaded run no longer spends the suite's hook budget on esbuild; the suite
// reads the files from the injected folder, unchanged assertions and
// deadlines. The build is the suite's own production-plugin entry, written
// to disk instead of memory — same options, same bytes.

import path from 'node:path'
import { build } from 'esbuild'
import { compactBrowserUiText } from '../../../scripts/lib/uiTextRegions.mjs'
import { teamPanelBrowserValidation } from '../../../scripts/lib/webviewBundles.mjs'

export const MODELS_FIRST_PAINT_KEY = 'modelsFirstPaint'

/** Bundle the production-plugin Models entry into folder. */
export async function buildModelsFirstPaint(folder) {
  await build({
    entryPoints: [path.resolve('src/webview/models/models.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'chrome128',
    splitting: true,
    outdir: folder,
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [compactBrowserUiText, teamPanelBrowserValidation],
  })
}
