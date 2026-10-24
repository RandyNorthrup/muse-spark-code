// The production fold of src/shared/constants.ts (scripts/lib/foldedConstants.mjs)
// changes no value: the real file built as written and built folded export
// the same values, key for key, and only the folded build lets esbuild drop
// the constants a bundle does not read.
import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { foldConstantSource, foldedConstants } from '../../scripts/lib/foldedConstants.mjs'

const require = createRequire(import.meta.url)
const CONSTANTS = path.resolve('src/shared/constants.ts')
const BUILD_MS = 120_000
const byName = (left, right) => left.localeCompare(right)

/** The real constants module built with `plugins`, loaded as a CommonJS module. */
async function constantsModule(plugins) {
  const result = await build({
    entryPoints: [CONSTANTS],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'error',
    plugins,
  })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(
    module,
    module.exports,
    require,
  )
  return module.exports
}

/** A value as comparable text: functions by source, collections by entries. */
function comparable(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function') return `function ${item.toString()}`
    if (typeof item === 'bigint') return `bigint ${item.toString()}`
    if (item instanceof RegExp) return `regexp ${item.toString()}`
    if (item instanceof Map) return { map: item.entries().toArray() }
    if (item instanceof Set) return { set: item.values().toArray() }
    return typeof item === 'number' && !Number.isFinite(item) ? `number ${String(item)}` : item
  })
}

/** One entry reading one constant; what constants.ts leaves in its bundle. */
async function residueBytes(plugins) {
  const result = await build({
    stdin: {
      contents: `import { RESOURCE_SAMPLE_MS } from ${JSON.stringify(CONSTANTS.replaceAll('\\', '/'))}\nconsole.log(RESOURCE_SAMPLE_MS)`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    minify: true,
    metafile: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'error',
    plugins,
  })
  const [output] = Object.values(result.metafile.outputs)
  const input = Object.entries(output.inputs).find(([file]) => file.endsWith('shared/constants.ts'))
  return input?.[1].bytesInOutput ?? 0
}

describe('folded constants.ts', () => {
  it(
    'exports every constant with the value the source gives it',
    async () => {
      const written = await constantsModule([])
      const folded = await constantsModule([foldedConstants])
      expect(Object.keys(folded).toSorted(byName)).toEqual(Object.keys(written).toSorted(byName))
      const differing = Object.keys(written).filter(
        (key) => comparable(folded[key]) !== comparable(written[key]),
      )
      expect(differing).toEqual([])
    },
    BUILD_MS,
  )

  it(
    'lets a bundle carry only the constants it reads',
    async () => {
      const written = await residueBytes([])
      const folded = await residueBytes([foldedConstants])
      expect(folded).toBeLessThan(written)
    },
    BUILD_MS,
  )

  it('writes each fold as the exact value JavaScript computes', () => {
    expect(foldConstantSource('export const A = 0.1 + 0.2', 'a.ts')).toBe(
      `export const A = ${String(0.1 + 0.2)}`,
    )
    expect(foldConstantSource('const A = 4 * 1024 * 1024\nconst B = A / 3', 'a.ts')).toBe(
      `const A = 4194304\nconst B = ${String(4_194_304 / 3)}`,
    )
    expect(
      foldConstantSource(
        'const N = 4 * Math.ceil(1048576 / 3)\nconst M = Number.MAX_SAFE_INTEGER',
        'a.ts',
      ),
    ).toBe(
      `const N = ${String(4 * Math.ceil(1_048_576 / 3))}\nconst M = ${String(Number.MAX_SAFE_INTEGER)}`,
    )
    expect(
      foldConstantSource(
        "const P = 'muse'\nconst Q = `${P}.spark`\nconst T = { read: 'read_file' }\nconst L = [T.read, Q + '!']",
        'a.ts',
      ),
    ).toBe(
      'const P = \'muse\'\nconst Q = "muse.spark"\nconst T = { read: \'read_file\' }\nconst L = ["read_file", "muse.spark!"]',
    )
  })

  it('leaves what it cannot prove as written', () => {
    const kept = [
      "import { X } from './x'\nexport const A = X * 2",
      'export const A = 1 / 0',
      'export const A = -0 * 1',
      'export const A = Date.now() * 2',
      'let A = 2 * 3',
      'export const A = `${process.platform}-x`',
      'export const A = Math.random() * 2',
    ]
    for (const source of kept) expect(foldConstantSource(source, 'a.ts')).toBe(source)
  })
})
