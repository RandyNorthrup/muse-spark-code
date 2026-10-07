#!/usr/bin/env node
// Generates the code-derived reference or checks its coverage and freshness,
// plus the Devices documentation inventory from real English keys and availability.
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'
import { renderDeviceReference } from './lib/deviceReference.mjs'
import { generateReference } from './lib/reference.mjs'

const OUTPUT = 'docs/devices-reference.md'

async function checkDevicesReference(isCheck) {
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
  if (isCheck) {
    if (readFileSync(OUTPUT, 'utf8') !== generated)
      throw new Error(`Stale ${OUTPUT}: run node scripts/gen-reference.mjs`)
    console.log(`ok   Devices reference: ${FEATURE_CATALOG.length} entries`)
  } else {
    writeFileSync(OUTPUT, generated)
    console.log(`wrote ${OUTPUT}: ${FEATURE_CATALOG.length} entries`)
  }
}

async function main() {
  const isCheck = process.argv.includes('--check')
  const model = await generateReference(process.cwd(), isCheck)
  console.log(
    `Reference: ${model.features.length} features, ${model.commands.length} commands, ${model.settings.length} settings, ${model.slash.length} slash, ${model.cli.length} CLI; ${isCheck ? 'current' : 'generated'}`,
  )
  await checkDevicesReference(isCheck)
}
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
