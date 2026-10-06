import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { captureMatrix } from '../harness/goldens/capture.mjs'
import { comparePixels, decodePng } from '../../scripts/lib/visualImages.mjs'

const frames = new Map()
const repeated = new Map()
beforeAll(async () => {
  const audit = JSON.parse(await readFile('docs/certification/m114-audit.json', 'utf8'))
  const matrix = JSON.parse(await readFile('test/harness/visual-matrix.json', 'utf8'))
  const prefix = { ...audit, scenes: audit.scenes.slice(0, 3) }
  const narrow = { ...matrix, themes: ['light'], widths: [320] }
  await captureMatrix(process.cwd(), prefix, narrow, (capture, bytes) => {
    frames.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
  })
  await captureMatrix(process.cwd(), prefix, narrow, (capture, bytes) => {
    repeated.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
  })
})

it('repeats the exact scene prefix and focus raster with zero changed pixels', () => {
  expect(frames.size).toBe(18)
  expect(repeated.size).toBe(18)
  for (const [key, before] of frames)
    expect(
      () => comparePixels(before, repeated.get(key), 320, 760),
      `${key}: repeat capture`,
    ).not.toThrow()
})
