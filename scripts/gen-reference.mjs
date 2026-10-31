#!/usr/bin/env node
// Generates the code-derived reference or checks its coverage and freshness,
// plus the Devices documentation inventory from real English keys and availability.
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'
import { renderDeviceReference } from './lib/deviceReference.mjs'
import { generateReference } from './lib/reference.mjs'
import { isEntryPoint } from './lib/entryPoint.mjs'

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

// M118's inventory is shared with /help; drift is a release failure.
async function checkSharingReference() {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-sharing-reference-'))
  const modulePath = path.join(folder, 'reference.cjs')
  try {
    await build({
      entryPoints: ['src/shared/featureCatalog.ts'],
      outfile: modulePath,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    const { sharingFeatures } = createRequire(import.meta.url)(modulePath)
    const features = sharingFeatures()
    const escape = (value) => value.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')
    const content = await format(
      `# Sharing command reference\n\nGenerated from \`src/shared/featureCatalog.ts\`; see README and docs/acp.md for privacy, confirmation and current editor availability.\n\n| Surface | Command or setting | Description |\n| --- | --- | --- |\n${features.map((feature) => `| ${feature.surface} | \`${escape(feature.syntax)}\` | ${escape(feature.label)}. ${escape(feature.detail)} |`).join('\n')}\n`,
      { parser: 'markdown' },
    )
    const destination = 'docs/sharing-reference.md'
    if (process.argv.includes('--check')) {
      if (readFileSync(destination, 'utf8') !== content)
        throw new Error('Sharing reference is stale: node scripts/gen-reference.mjs')
      console.log('Sharing reference matches the feature catalog.')
    } else writeFileSync(destination, content)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

async function main() {
  const isCheck = process.argv.includes('--check')
  const model = await generateReference(process.cwd(), isCheck)
  console.log(
    `Reference: ${model.features.length} features, ${model.commands.length} commands, ${model.settings.length} settings, ${model.slash.length} slash, ${model.cli.length} CLI; ${isCheck ? 'current' : 'generated'}`,
  )
  await checkDevicesReference(isCheck)
  await checkSharingReference()
}
if (isEntryPoint(import.meta.url)) await main()
