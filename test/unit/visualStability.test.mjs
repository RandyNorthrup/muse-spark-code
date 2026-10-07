import { readFile } from 'node:fs/promises'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { captureMatrix } from '../harness/goldens/capture.mjs'
import { comparePixels, decodePng } from '../../scripts/lib/visualImages.mjs'

const frames = new Map()
const repeated = new Map()
const inputs = { audit: undefined, matrix: undefined }
for (const index of [0, 1, 2])
  beforeAll(async () => {
    const audit = JSON.parse(await readFile('docs/certification/m114-audit.json', 'utf8'))
    const matrix = JSON.parse(await readFile('test/harness/visual-matrix.json', 'utf8'))
    const prefix = { ...audit, scenes: [audit.scenes[index]] }
    const narrow = { ...matrix, themes: ['light'], widths: [320] }
    inputs.audit = audit
    inputs.matrix = narrow
    await captureMatrix(process.cwd(), prefix, narrow, (capture, bytes) => {
      frames.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
    })
  })
// Bound each fresh scene separately at the unchanged default hook deadline.
for (const index of [0, 1, 2])
  beforeEach(async () => {
    if (index === 0) repeated.clear()
    await captureMatrix(
      process.cwd(),
      { ...inputs.audit, scenes: [inputs.audit.scenes[index]] },
      inputs.matrix,
      (capture, bytes) => {
        repeated.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
      },
    )
  })

it('repeats the mounted scene prefix and focus raster within the lead tolerance', () => {
  expect(frames.size).toBe(18)
  expect(repeated.size).toBe(18)
  for (const [key, before] of frames)
    expect(
      () => comparePixels(before, repeated.get(key), 320, 760),
      `${key}: repeat capture`,
    ).not.toThrow()
})
