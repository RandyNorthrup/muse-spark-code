import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { beforeAll, expect, it } from 'vitest'
import { compactReferenceData } from '../../scripts/lib/reference.mjs'
import { L10N_COMPRESSION_QUALITY } from '../../src/shared/constants'

const built = { exports: undefined }
beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/shared/reference/reference.generated.ts'],
    bundle: true,
    write: false,
    minify: true,
    platform: 'node',
    format: 'cjs',
    plugins: [compactReferenceData(L10N_COMPRESSION_QUALITY)],
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
it('refuses a changed generator boundary instead of omitting the reference data', () => {
  let load
  compactReferenceData(L10N_COMPRESSION_QUALITY).setup({
    onLoad(options, callback) {
      load = callback
    },
  })
  expect(() => load({ path: 'src/shared/reference/types.ts' })).toThrow('boundary changed')
})
