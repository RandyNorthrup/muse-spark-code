import { readFileSync, writeFileSync } from 'node:fs'
import { FEATURE_CATALOG } from '../src/shared/featureCatalog.ts'

const file = new URL('../docs/reference.md', import.meta.url)
const text = `# Shared policy help reference\n\n${FEATURE_CATALOG.map(
  (feature) =>
    `## ${feature.title}\n\n${feature.status}\n\n${feature.description}\n\n${feature.lifecycle}\n\n${feature.reviews}\n`,
).join('\n')}`
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== text) throw new Error('Help reference is stale.')
} else writeFileSync(file, text)
