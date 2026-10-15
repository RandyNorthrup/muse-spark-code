import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { buildReference, referenceSources } from '../../scripts/lib/reference.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const source = await referenceSources(root)
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
const runtime = readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')

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
