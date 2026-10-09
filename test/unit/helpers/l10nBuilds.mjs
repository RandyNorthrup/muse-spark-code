// The English/regional UI text bundles that browserEnglish and uiTextRegions
// inspect. Built once per run by test/unit/globalSetup.mjs, before any worker
// starts, so a loaded run no longer spends a suite's hook budget on esbuild;
// a suite run without that setup (no injected folder) builds its own copy.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import {
  UI_TEXT_REGIONS,
  regionalUiText,
  compactBrowserEnglish,
  compactBrowserUiText,
} from '../../../scripts/lib/uiTextRegions.mjs'

export const L10N_BUILDS_KEY = 'l10nBuilds'
export const BROWSER_ENGLISH = 'browser-english'
export const REGIONAL_ENGLISH = 'regional-english'

const source = (file) => path.resolve(file).replaceAll('\\', '/')

/** browserEnglish: the webview entries plus a probe, with their metafile as meta.json. */
export async function buildBrowserEnglish(folder) {
  mkdirSync(folder, { recursive: true })
  const probe = path.join(folder, 'probe.ts')
  writeFileSync(
    probe,
    `export { EN } from '${source('src/shared/l10n/en.ts')}';
export { UI_TEXT, setUiText } from '${source('src/shared/l10n/text.ts')}';
export { loadDeferredEnglish } from '${source('src/shared/l10n/deferredEnglish.ts')}';
export { installEmbeddedTable } from '${source('src/webview/installTable.ts')}';
export { installVaultEnglish } from '${source('src/shared/l10n/vaultEnglish.ts')}';
export const loadResourceEnglish = () => import('browser-resource-english');`,
  )
  const result = await build({
    entryPoints: {
      main: 'src/webview/main.tsx',
      models: 'src/webview/models/models.tsx',
      usage: 'src/webview/usage/usage.tsx',
      probe,
    },
    outdir: folder,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    minify: true,
    metafile: true,
    splitting: true,
    platform: 'browser',
    format: 'esm',
    plugins: [compactBrowserUiText],
    loader: { '.css': 'empty' },
    jsx: 'automatic',
  })
  writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(result.metafile))
}

/**
 * uiTextRegions: the Node regional outputs, the shared text module (as
 * text-source.js), the compact browser English (browser-english.js) and the
 * browser entries under browser/.
 */
export async function buildRegionalEnglish(folder) {
  mkdirSync(folder, { recursive: true })
  // One parallel batch: these builds are independent.
  const regions = [{ name: undefined, output: 'dist/uiText.js' }, ...UI_TEXT_REGIONS]
  const [browser] = await Promise.all([
    build({
      entryPoints: ['src/shared/l10n/en.ts'],
      bundle: true,
      write: false,
      minify: true,
      platform: 'browser',
      format: 'esm',
      plugins: [compactBrowserEnglish],
    }),
    ...regions.map((region) =>
      build({
        entryPoints: ['src/shared/l10n/en.ts'],
        bundle: true,
        minify: true,
        outfile: path.join(folder, path.basename(region.output)),
        platform: 'node',
        format: 'cjs',
        target: 'node20.18',
        plugins: [regionalUiText(region.name)],
      }),
    ),
  ])
  writeFileSync(path.join(folder, 'browser-english.js'), browser.outputFiles[0].text)
  const result = await build({
    entryPoints: ['src/shared/l10n/text.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node20.18',
    plugins: [
      {
        name: 'test-shared-english',
        setup(builder) {
          builder.onResolve({ filter: /^\.\/en$/ }, () => ({ path: './uiText.js', external: true }))
        },
      },
    ],
  })
  writeFileSync(path.join(folder, 'text-source.js'), result.outputFiles[0].text)
  const vaultProbe = path.join(folder, 'vault-probe.ts')
  writeFileSync(
    vaultProbe,
    `export { installVaultEnglish } from '${path.relative(folder, path.resolve('src/shared/l10n/vaultEnglish.ts')).replaceAll('\\', '/')}';`,
  )
  await build({
    entryPoints: {
      english: 'src/shared/l10n/en.ts',
      text: 'src/shared/l10n/text.ts',
      vault: vaultProbe,
      main: 'src/webview/main.tsx',
      models: 'src/webview/models/models.tsx',
      usage: 'src/webview/usage/usage.tsx',
      install: 'src/webview/installTable.ts',
    },
    outdir: path.join(folder, 'browser'),
    outExtension: { '.js': '.mjs' },
    bundle: true,
    splitting: true,
    minify: true,
    platform: 'browser',
    format: 'esm',
    plugins: [compactBrowserUiText],
    loader: { '.css': 'empty' },
    jsx: 'automatic',
  })
}
