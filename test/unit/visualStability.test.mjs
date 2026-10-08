import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { captureMatrix } from '../harness/goldens/capture.mjs'
import { comparePixels, decodePng } from '../../scripts/lib/visualImages.mjs'

// Build the real browser graph before captures; clean CI provides no dist artifacts.
beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--production', '--webview-only'], {
    stdio: 'pipe',
  })
})
const frames = new Map()
const repeated = new Map()
const inputs = { audit: undefined, matrix: undefined }
const scenes = ['quote-menu']
for (const index of [0, 1, 2, 3])
  beforeAll(async () => {
    const audit = JSON.parse(await readFile('docs/certification/m114-audit.json', 'utf8'))
    const matrix = JSON.parse(await readFile('test/harness/visual-matrix.json', 'utf8'))
    if (index === 0) scenes.push(...audit.scenes.slice(0, 3))
    const prefix = { ...audit, scenes: [scenes[index]] }
    const narrow = { ...matrix, themes: ['light'], widths: [320] }
    inputs.audit = audit
    inputs.matrix = narrow
    await captureMatrix(process.cwd(), prefix, narrow, async (capture, bytes, page) => {
      if (capture.scene === 'quote-menu' && capture.state === 'default') {
        const anchor = await page.evaluate(() => {
          const passage = globalThis.document
            .querySelector('.message-assistant .message-body p')
            .getBoundingClientRect()
          const pill = globalThis.document.querySelector('.gooey-menu-pill')
          return {
            passageY: passage.top + passage.height / 2,
            menuY:
              Number(pill.style.top.replace('px', '')) +
              Number(pill.style.transformOrigin.split(' ', 2)[1].replace('px', '')),
          }
        })
        expect(anchor.menuY, 'quote menu uses the settled passage').toBeCloseTo(anchor.passageY, 1)
      }
      frames.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
    })
  })
// Bound each fresh scene separately at the unchanged default hook deadline.
for (const index of [0, 1, 2, 3])
  beforeEach(async () => {
    if (index === 0) repeated.clear()
    await captureMatrix(
      process.cwd(),
      { ...inputs.audit, scenes: [scenes[index]] },
      inputs.matrix,
      (capture, bytes) => {
        repeated.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
      },
    )
  })

it('repeats the mounted scene prefix and focus raster within the lead tolerance', () => {
  expect(frames.size).toBe(24)
  expect(repeated.size).toBe(24)
  for (const [key, before] of frames)
    expect(
      () => comparePixels(before, repeated.get(key), 320, 760),
      `${key}: repeat capture`,
    ).not.toThrow()
})
