// Generate the Devices documentation inventory from real English keys and availability.
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'

const OUTPUT = 'docs/devices-reference.md'
const cell = (text) => text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')

export function renderDeviceReference(catalog, table) {
  const ids = new Set()
  const entries = catalog.map((feature) => {
    const title = table.devices[feature.titleKey]
    const detail = table.devices[feature.detailKey]
    if (
      typeof title !== 'string' ||
      typeof detail !== 'string' ||
      feature.availability !== 'unshipped' ||
      ids.has(feature.id)
    )
      throw new Error(`Invalid Devices catalog entry: ${feature.id}`)
    ids.add(feature.id)
    return `| ${cell(feature.id)} | ${cell(title)} | Unshipped | ${cell(detail)} |`
  })
  return [
    '# Devices feature reference',
    '',
    'Generated from `src/shared/featureCatalog.ts` and the English table.',
    '',
    'This is an implementation inventory, not an installed command list. Devices',
    'has no registered product command or setting on this integration base.',
    'QR and mDNS have no qualified runtime binding. No board, Git-result or',
    'physical-device support is claimed. All editors share the method port;',
    'remote and headless receivers remain unqualified.',
    '',
    '| Id | Feature | Availability | Contract |',
    '| --- | --- | --- | --- |',
    ...entries,
    '',
  ].join('\n')
}

async function main() {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { FEATURE_CATALOG } from './src/shared/featureCatalog'; export { EN } from './src/shared/l10n/en'",
      loader: 'ts',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const { FEATURE_CATALOG, EN } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
  const generated = await format(renderDeviceReference(FEATURE_CATALOG, EN), {
    ...(await resolveConfig(OUTPUT)),
    filepath: OUTPUT,
  })
  if (process.argv.includes('--check')) {
    if (readFileSync(OUTPUT, 'utf8') !== generated)
      throw new Error(`Stale ${OUTPUT}: run node scripts/gen-reference.mjs`)
    console.log(`ok   Devices reference: ${FEATURE_CATALOG.length} entries`)
  } else {
    writeFileSync(OUTPUT, generated)
    console.log(`wrote ${OUTPUT}: ${FEATURE_CATALOG.length} entries`)
  }
}
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
