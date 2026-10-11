import path from 'node:path'
import { build } from 'esbuild'
import { compactBrowserEnglish } from '../../../scripts/lib/uiTextRegions.mjs'
import { sharedUiText, sharedValidation } from '../../../scripts/lib/deferredBundles.mjs'

/** W uses these same entries/options in the joined build; existing entry budgets are unchanged. */
export async function buildVaultSurfaces(outdir, hasHarness = false) {
  const browser = await build({
    entryPoints: {
      main: 'src/webview/main.tsx',
      models: 'src/webview/models/sections/vault/VaultSurface.tsx',
      ...(hasHarness && { vaultHarness: 'test/harness/vault/main.tsx' }),
    },
    outdir,
    bundle: true,
    minify: true,
    metafile: true,
    platform: 'browser',
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    target: 'chrome128',
    jsx: 'automatic',
    charset: 'utf8',
    plugins: [compactBrowserEnglish],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  })
  const host = await build({
    entryPoints: ['src/host/vault/vaultPanelEntry.ts'],
    outfile: path.join(outdir, 'vault.js'),
    bundle: true,
    minify: true,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    external: ['vscode'],
    plugins: [sharedUiText, sharedValidation],
    logLevel: 'silent',
  })
  return { browser: browser.metafile, host: host.metafile }
}
