import { readFileSync, writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { loadL10n } from './lib/l10nSource.mjs'

const result = await build({
  entryPoints: ['src/shared/featureCatalog.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
})
const { FEATURE_CATALOG } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
)
const { EN } = await loadL10n(process.cwd())
const reference = FEATURE_CATALOG.map(
  (feature) => `# ${EN[feature.titleKey]}\n\n${readFileSync(feature.helpPath, 'utf8').trim()}\n`,
).join('\n')
const file = 'docs/reference.md'
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== reference)
    throw new Error('Help reference differs from the feature catalogue')
} else writeFileSync(file, reference)
console.log('Help reference matches the feature catalogue')
