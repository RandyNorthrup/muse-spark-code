import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, expect, it } from 'vitest'
import { buildReference, referenceSources } from '../../scripts/lib/reference.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const source = await referenceSources(root)
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
const runtime = readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')

// One cold build takes seconds (JIT); warm builds take ~0.1 s. Warm up in
// beforeAll so no case pays the cold build under shard load.
beforeAll(() => {
  buildReference(manifest, nls, source, runtime, readme)
})

it('connects provider model edits and per-command help to their catalogue features', () => {
  const model = buildReference(manifest, nls, source, runtime, readme)
  expect(model.features.find((feature) => feature.id === 'providers')).toMatchObject({
    cliRoutes: ['providersModels'],
    details: expect.arrayContaining([{ cli: 'add' }, { cli: 'remove' }, { cli: 'force' }]),
  })
  expect(model.features.find((feature) => feature.id === 'acp')).toMatchObject({
    cliRoutes: ['helpTopic'],
    details: expect.arrayContaining([{ ui: 'referenceBriefHelp' }]),
  })
})

it('rejects missing terminal topics even when the README mentions them elsewhere', () => {
  expect(() => buildReference(manifest, nls, source, runtime, readme)).not.toThrow()
  const start = readme.indexOf('In a terminal,')
  const end = readme.indexOf('\nMaintainers run', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  for (const name of ['serve', 'login', 'auth', 'providers']) {
    const missing =
      readme.slice(0, start) +
      readme.slice(start, end).replace(`\`${name}\``, '') +
      readme.slice(end)
    expect(() => buildReference(manifest, nls, source, runtime, missing)).toThrow(
      `README terminal section lacks ${name}`,
    )
  }
})
