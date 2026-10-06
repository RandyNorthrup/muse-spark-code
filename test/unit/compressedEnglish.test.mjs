import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { compressedEnglish, englishTableData } from '../../scripts/lib/compressedEnglish.mjs'

const require = createRequire(import.meta.url)

describe('lossless compiled English fallback', () => {
  it('reads exactly the actual English strings, groups and plural forms', async () => {
    expect(englishTableData(await readFile('src/shared/l10n/en.ts', 'utf8'))).toEqual(EN)
  })

  it.each(['node', 'browser'])('exports the complete unchanged table in %s', async (platform) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm96-english-'))
    try {
      const output = path.join(folder, platform === 'node' ? 'en.cjs' : 'en.mjs')
      await build({
        entryPoints: ['src/shared/l10n/en.ts'],
        outfile: output,
        bundle: true,
        platform,
        format: platform === 'node' ? 'cjs' : 'esm',
        target: platform === 'node' ? 'node20.18' : 'chrome128',
        minify: true,
        plugins: [compressedEnglish(platform)],
        logLevel: 'silent',
      })
      const result =
        platform === 'node' ? require(output) : await import(pathToFileURL(output).href)
      expect(await readFile(output, 'utf8')).toContain(
        platform === 'node' ? 'inflateSync' : 'DecompressionStream',
      )
      expect(result.EN).toEqual(EN)
      expect(Object.keys(result.EN)).toEqual(Object.keys(EN))
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it.each([
    'export const EN = { bad: new Date() }',
    'export const EN = { bad: process.env.SECRET }',
    'export const EN = { same: "a", same: "b" }',
    'export const OTHER = {}',
  ])('refuses unsupported source without executing it: %s', (source) => {
    expect(() => englishTableData(source)).toThrow()
  })
})
