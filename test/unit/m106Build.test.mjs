import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { compressedReference } from '../../scripts/lib/compressedReference.mjs'

const require = createRequire(import.meta.url)
const source = readFileSync('src/shared/reference/reference.generated.ts', 'utf8')
const document = readFileSync('src/shared/reference/reference.generated.json', 'utf8')
const fixture = { folder: undefined }
beforeAll(() => {
  mkdirSync('temp', { recursive: true })
  fixture.folder = mkdtempSync(path.resolve('temp/m106-reference-'))
  writeFileSync(path.join(fixture.folder, 'reference.generated.json'), document)
})
afterAll(() => rmSync(fixture.folder, { recursive: true, force: true }))

it('round trips the exact generated reference and retains its runtime schema in the real Node artifact', async () => {
  writeFileSync(path.join(fixture.folder, 'reference.generated.ts'), source)
  const file = path.join(fixture.folder, 'reference.cjs')
  await build({
    entryPoints: [path.join(fixture.folder, 'reference.generated.ts')],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [compressedReference],
    logLevel: 'silent',
  })
  const actual = require(file)
  expect(actual.referenceModel()).toEqual(JSON.parse(document))
  expect(() => actual.parseReferenceModel({})).toThrow()
})

it('refuses a generated reference whose validation schema marker disappeared', async () => {
  writeFileSync(
    path.join(fixture.folder, 'reference.generated.ts'),
    source.replace('const plainTextSchema =', 'const renamedTextSchema ='),
  )
  await expect(
    build({
      entryPoints: [path.join(fixture.folder, 'reference.generated.ts')],
      outfile: path.join(fixture.folder, 'bad.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      plugins: [compressedReference],
      logLevel: 'silent',
    }),
  ).rejects.toThrow('Reference schema disappeared')
})
