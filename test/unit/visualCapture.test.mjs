import { readFile } from 'node:fs/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { captureMatrix } from '../harness/goldens/capture.mjs'
import { decodePng } from '../../scripts/lib/visualImages.mjs'

const captured = { result: undefined }
// Share fixture compilation/browser setup; each assertion stays under the
// repository's default timeout. This is the actual formerly closing palette.
beforeAll(async () => {
  const audit = JSON.parse(await readFile('docs/certification/m114-audit.json', 'utf8'))
  const matrix = JSON.parse(await readFile('test/harness/visual-matrix.json', 'utf8'))
  captured.result = await captureMatrix(
    process.cwd(),
    { ...audit, scenes: ['board'] },
    { ...matrix, themes: ['light'], widths: [320] },
    async (capture, bytes, page) => {
      decodePng(bytes, capture.width, capture.height)
      expect(
        await page.locator('[role="dialog"]').count(),
        `${capture.state}: dialog remains open`,
      ).toBe(1)
      expect(
        await page.evaluate(
          () => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
        ),
      ).toBe(true)
    },
  )
})

describe('M114 real visual capture driver', () => {
  it('keeps the autofocus palette open through every representative control state', () => {
    expect(captured.result.captures.map((capture) => capture.state)).toEqual([
      'default',
      'hover',
      'focus-visible',
      'pressed',
      'disabled',
      'selected',
    ])
    expect(captured.result.captures.find((capture) => capture.state === 'disabled')).toMatchObject({
      applied: true,
      target: expect.stringContaining('button'),
    })
    expect(captured.result.captures.find((capture) => capture.state === 'selected').applied).toBe(
      true,
    )
  })
  it('records actual font rasterization and exact narrow viewport dimensions', () => {
    expect(captured.result.rasterization).toMatch(/^[\da-f]{64}$/)
    for (const capture of captured.result.captures)
      expect(capture).toMatchObject({ width: 320, height: 760 })
  })
})
