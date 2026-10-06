import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { makeFixtures } from '../harness/goldens/fixtures.mjs'
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
    { ...audit, scenes: ['board', 'deferred-modal', 'whats-new'] },
    { ...matrix, themes: ['light'], widths: [320] },
    async (capture, bytes, page) => {
      decodePng(bytes, capture.width, capture.height)
      if (capture.scene === 'board')
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
    expect(
      captured.result.captures
        .filter((capture) => capture.scene === 'board')
        .map((capture) => capture.state),
    ).toEqual(['default', 'hover', 'focus-visible', 'pressed', 'disabled', 'selected'])
    expect(
      captured.result.captures.find(
        (capture) => capture.scene === 'board' && capture.state === 'disabled',
      ),
    ).toMatchObject({
      applied: true,
      target: expect.stringContaining('button'),
    })
    expect(
      captured.result.captures.find(
        (capture) => capture.scene === 'board' && capture.state === 'selected',
      ).applied,
    ).toBe(true)
  })
  it('isolates fixture CSP origins for concurrent capture runs', async () => {
    const first = await makeFixtures(process.cwd(), 11_401)
    const second = await makeFixtures(process.cwd(), 11_402)
    try {
      expect(first).not.toBe(second)
      expect(await readFile(path.join(first, 'whats-new.html'), 'utf8')).toContain(
        'http://127.0.0.1:11401',
      )
      expect(await readFile(path.join(second, 'whats-new.html'), 'utf8')).toContain(
        'http://127.0.0.1:11402',
      )
    } finally {
      const directories = new Set([first, second])
      for (const directory of directories) await rm(directory, { recursive: true, force: true })
    }
  })
  it('records actual font rasterization and exact narrow viewport dimensions', () => {
    expect(captured.result.rasterization).toMatch(/^[\da-f]{64}$/)
    for (const capture of captured.result.captures)
      expect(capture).toMatchObject({ width: 320, height: 760 })
  })
})
