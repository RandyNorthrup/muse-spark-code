import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { compressedReference } from '../../scripts/lib/uiTextRegions.mjs'

// The production Node build packs the reference with uiTextRegions.mjs's
// plugin. The generator keeps the validation schema in
// referenceSchema.generated.ts, which the packed factory reads.
const require = createRequire(import.meta.url)
const entry = 'src/shared/reference/reference.generated.ts'
const source = readFileSync(entry, 'utf8')
const document = readFileSync('src/shared/reference/reference.generated.json', 'utf8')
const fixture = { folder: undefined }
beforeAll(() => {
  mkdirSync('temp', { recursive: true })
  fixture.folder = mkdtempSync(path.resolve('temp/m106-reference-'))
  writeFileSync(path.join(fixture.folder, 'reference.generated.json'), document)
})
afterAll(() => rmSync(fixture.folder, { recursive: true, force: true }))

it('round trips the exact generated reference and retains its runtime schema in the real Node artifact', async () => {
  const file = path.join(fixture.folder, 'reference.cjs')
  await build({
    entryPoints: [entry],
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    plugins: [compressedReference(true)],
    logLevel: 'silent',
  })
  expect(readFileSync(file, 'utf8')).toContain('brotliDecompressSync')
  const actual = require(file)
  expect(actual.referenceModel()).toEqual(JSON.parse(document))
  expect(() => actual.parseReferenceModel({})).toThrow()
})

it('refuses a generated reference whose factory disappeared', async () => {
  writeFileSync(
    path.join(fixture.folder, 'reference.generated.ts'),
    source.replace('export function referenceModel()', 'export function renamedModel()'),
  )
  await expect(
    build({
      entryPoints: [path.join(fixture.folder, 'reference.generated.ts')],
      outfile: path.join(fixture.folder, 'bad.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      plugins: [compressedReference(true)],
      logLevel: 'silent',
    }),
  ).rejects.toThrow('Missing generated reference factory')
})
