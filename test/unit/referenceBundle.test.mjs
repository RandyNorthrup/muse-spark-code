import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import { beforeAll, describe, expect, it } from 'vitest'
import { compactNodeReference } from '../../scripts/lib/referenceBundle.mjs'
import { compressedReference } from '../../scripts/lib/uiTextRegions.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const model = JSON.parse(
  readFileSync(path.join(root, 'src/shared/reference/reference.generated.json'), 'utf8'),
)

describe('the compact Node reference (M107)', () => {
  const fixture = { reference: undefined, source: '' }
  beforeAll(async () => {
    const built = await build({
      entryPoints: ['src/shared/reference/reference.generated.ts'],
      bundle: true,
      write: false,
      minify: true,
      platform: 'node',
      format: 'cjs',
      plugins: [compactNodeReference],
    })
    fixture.source = built.outputFiles[0].text
    const module = { exports: {} }
    vm.compileFunction(fixture.source, ['require', 'module', 'exports'])(
      createRequire(import.meta.url),
      module,
      module.exports,
    )
    fixture.reference = module.exports
  })

  it('decodes every reference fact through the original generated boundary', () => {
    expect(fixture.reference.referenceModel()).toEqual(model)
    expect(fixture.source).toContain('node:zlib')
    expect(() => fixture.reference.parseReferenceModel({ ...model, settings: [{}] })).toThrow()
  })

  it('selects the generated model on POSIX and Windows paths', () => {
    let filter
    compactNodeReference.setup({
      onLoad(options) {
        filter = options.filter
      },
    })
    expect(filter.test('/project/src/shared/reference/reference.generated.ts')).toBe(true)
    expect(
      filter.test(
        path.win32.join('C:', 'project', 'src', 'shared', 'reference', 'reference.generated.ts'),
      ),
    ).toBe(true)
    expect(filter.test('/project/src/shared/reference/referenceEntry.ts')).toBe(false)
  })

  it('refuses an input missing the generated reference boundary', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'muse-reference-boundary-'))
    let load
    compactNodeReference.setup({
      onLoad(_options, callback) {
        load = callback
      },
    })
    const file = path.join(folder, 'reference.generated.ts')
    try {
      writeFileSync(file, 'export const missing = true')
      writeFileSync(file.replace(/\.ts$/, '.json'), JSON.stringify(model))
      expect(() => load({ path: file })).toThrow('Missing generated reference boundary')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('the compressed production Node reference', () => {
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
    vm.runInNewContext(result.outputFiles[0].text, {
      module,
      exports: module.exports,
      require: createRequire(import.meta.url),
      Buffer: globalThis.Buffer,
    })
    built.exports = module.exports
  })

  it('ships every generated help row exactly and retains its model validation boundary', () => {
    const expected = JSON.parse(
      readFileSync('src/shared/reference/reference.generated.json', 'utf8'),
    )
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
})
