#!/usr/bin/env node
// M104L adds the catalog on a base that predates the owner's reference feature.
import { readFile, writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'
import { format, resolveConfig } from 'prettier'

const { code } = await transform(await readFile('src/shared/featureCatalog.ts', 'utf8'), {
  loader: 'ts',
  format: 'esm',
  target: 'node22',
})
const { FEATURE_CATALOG } = await import(`data:text/javascript,${encodeURIComponent(code)}`)
const escape = (value) => value.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')
const draft = [
  '# Runtime and shim reference',
  '',
  'Generated from `src/shared/featureCatalog.ts` by `node scripts/gen-reference.mjs`.',
  'This catalog covers the M104L additions. Existing extension settings and commands remain in README.md.',
  '',
  '| Command or editor route | Behavior and qualification |',
  '| --- | --- |',
  ...FEATURE_CATALOG.map(({ command, behavior }) => `| ${escape(command)} | ${escape(behavior)} |`),
  '',
].join('\n')
const file = 'docs/runtime-reference.md'
const content = await format(draft, { ...(await resolveConfig(file)), parser: 'markdown' })
if (process.argv.includes('--check')) {
  if ((await readFile(file, 'utf8')) !== content)
    throw new Error('Runtime reference is stale: node scripts/gen-reference.mjs')
  process.stdout.write('Runtime reference: current\n')
} else await writeFile(file, content)
