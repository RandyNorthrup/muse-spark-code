#!/usr/bin/env node
// Generates the code-derived reference or checks its coverage and freshness.
import process from 'node:process'
import { generateReference } from './lib/reference.mjs'
const isCheck = process.argv.includes('--check')
const model = await generateReference(process.cwd(), isCheck)
console.log(
  `Reference: ${model.features.length} features, ${model.commands.length} commands, ${model.settings.length} settings, ${model.slash.length} slash, ${model.cli.length} CLI; ${isCheck ? 'current' : 'generated'}`,
)

// M118's inventory is shared with /help; drift is a release failure.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { format } from 'prettier'

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
