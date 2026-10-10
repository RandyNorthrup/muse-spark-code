import { readFile } from 'node:fs/promises'
import { beforeAll, beforeEach, expect, inject, it } from 'vitest'
import { captureMatrix } from '../harness/goldens/capture.mjs'
import { comparePixels, decodePng } from '../../scripts/lib/visualImages.mjs'
import { VISUAL_BUILD_KEY } from './helpers/productionPackage'
import { REVIEW_BROWSER_KEY, REVIEW_RASTERIZATION_KEY } from './helpers/reviewBrowser.mjs'

// The global setup builds and stages this suite's complete source/output
// copy before workers begin. Capture writes never mutate the shared build.
const root = inject(VISUAL_BUILD_KEY)
const browserEndpoint = inject(REVIEW_BROWSER_KEY)
// Measured once in global setup on the same browser: no hook loads its fonts.
const rasterization = inject(REVIEW_RASTERIZATION_KEY)
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
    await captureMatrix(
      root,
      prefix,
      narrow,
      async (capture, bytes, page) => {
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
          expect(anchor.menuY, 'quote menu uses the settled passage').toBeCloseTo(
            anchor.passageY,
            1,
          )
        }
        frames.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
      },
      undefined,
      browserEndpoint,
      rasterization,
    )
  })
// Bound each fresh scene separately at the unchanged default hook deadline.
for (const index of [0, 1, 2, 3])
  beforeEach(async () => {
    if (index === 0) repeated.clear()
    await captureMatrix(
      root,
      { ...inputs.audit, scenes: [scenes[index]] },
      inputs.matrix,
      (capture, bytes) => {
        repeated.set(`${capture.scene}/${capture.state}`, decodePng(bytes, 320, 760))
      },
      undefined,
      browserEndpoint,
      rasterization,
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
