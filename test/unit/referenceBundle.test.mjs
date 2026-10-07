import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'
import { compressedReference } from '../../scripts/lib/uiTextRegions.mjs'

const built = { exports: undefined }
beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/shared/reference/reference.generated.ts'],
    bundle: true,
    write: false,
    minify: true,
    platform: 'node',
    format: 'cjs',
    plugins: [compressedReference(true)],
  })
  const module = { exports: {} }
  runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: createRequire(import.meta.url),
    Buffer: globalThis.Buffer,
  })
  built.exports = module.exports
})
it('ships every generated help row exactly and retains its model validation boundary', () => {
  const expected = JSON.parse(readFileSync('src/shared/reference/reference.generated.json', 'utf8'))
  expect(built.exports.referenceModel()).toEqual(expected)
  expect(() => built.exports.parseReferenceModel({ ...expected, settings: 'damaged' })).toThrow()
})
it('refuses a changed generator boundary instead of omitting the reference data', async () => {
  let load
  compressedReference(true).setup({
    onLoad(options, callback) {
      load = callback
    },
  })
  await expect(load({ path: 'src/shared/reference/types.ts' })).rejects.toThrow(
    'Missing generated reference factory',
  )
})
