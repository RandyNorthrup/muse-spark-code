import { build } from 'esbuild'
import vm from 'node:vm'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { compressedModelText } from '../../scripts/lib/compressedModelText.mjs'
import { MODEL_TEXT, MODEL_API_MODEL_TEXT, CODE_INTEL_MODEL_TEXT } from '../../src/shared/constants'

const require = createRequire(import.meta.url)
function evaluate(text) {
  const module = { exports: {} }
  vm.runInNewContext(text, { module, exports: module.exports, require, Buffer })
  return module.exports
}

async function encoded(isProduction, contents) {
  const result = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    platform: 'node',
    format: 'cjs',
    bundle: true,
    write: false,
    minify: true,
    plugins: [compressedModelText(isProduction)],
  })
  return result.outputFiles[0].text
}

describe('production model text encoding', () => {
  it('retains every key and exact English byte while reducing the Node bundle', async () => {
    const source =
      "export {MODEL_TEXT,MODEL_API_MODEL_TEXT,CODE_INTEL_MODEL_TEXT} from './src/shared/constants'"
    const packed = await encoded(true, source)
    const plain = await encoded(false, source)
    const tables = { MODEL_TEXT, MODEL_API_MODEL_TEXT, CODE_INTEL_MODEL_TEXT }
    expect(evaluate(packed)).toEqual(tables)
    expect(JSON.stringify(evaluate(packed))).toBe(JSON.stringify(evaluate(plain)))
    expect(Buffer.byteLength(packed)).toBeLessThan(Buffer.byteLength(plain))
    for (const key of ['compactionPrompt', 'goalUnfinishedExists', 'verifyUncheckedCodeLoading'])
      expect(packed).toMatch(new RegExp(`[{,]${key}:`))
  })
  it('removes the entire unreferenced model block and decoder', async () => {
    const output = await encoded(true, "export {DEFAULT_MODEL_ID} from './src/shared/constants'")
    expect(output).not.toContain('brotliDecompressSync')
    expect(output).not.toContain('compactionPrompt:')
  })
})
