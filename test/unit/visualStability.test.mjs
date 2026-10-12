import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import {
  CAPTURE_CONTEXT,
  captureMatrix,
  openCapturePage,
  prepareScene,
} from '../harness/goldens/capture.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
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

async function addScrollRoom(page) {
  await page.evaluate(() => {
    const scroller = globalThis.document.querySelector('.body-transcript')
    const tail = globalThis.document.createElement('div')
    tail.style.minHeight = '1600px'
    tail.style.flexShrink = '0'
    scroller.append(tail)
    scroller.scrollTop += 1
    scroller.dispatchEvent(new globalThis.Event('scroll'))
  })
  await page.clock.runFor(100)
}

async function expectSelectionFan(page) {
  const measured = await page.evaluate(() => {
    const button = globalThis.document
      .querySelector('.message-assistant .row-actions-button')
      .getBoundingClientRect()
    return {
      x: button.left + button.width / 2,
      y: button.top + button.height / 2,
      pills: [...globalThis.document.querySelectorAll('.quote-menu .gooey-menu-pill')].map(
        (pill) => {
          const box = pill.getBoundingClientRect()
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
        },
      ),
    }
  })
  expect(measured.pills).toHaveLength(3)
  for (const [index, pill] of measured.pills.entries()) {
    const near = measured.x - pill.right
    expect(near, 'selection pills stay beside the row opener').toBeGreaterThanOrEqual(16)
    expect(near, 'selection pills stay close to the row opener').toBeLessThanOrEqual(32.02)
    const next = measured.pills[index + 1]
    if (next !== undefined) expect(next.top - pill.bottom).toBeCloseTo(6, 1)
  }
  expect((measured.pills[0].top + measured.pills.at(-1).bottom) / 2).toBeCloseTo(measured.y, 1)
}

// Capture the wide selection menu too, with the same shared setup and default timeout.
beforeAll(async () => {
  const audit = JSON.parse(await readFile('docs/certification/m114-audit.json', 'utf8'))
  const matrix = JSON.parse(await readFile('test/harness/visual-matrix.json', 'utf8'))
  await captureMatrix(
    root,
    { ...audit, scenes: ['quote-menu'] },
    { ...matrix, themes: ['light'], widths: [690] },
    async (capture, _bytes, page) => {
      if (capture.state === 'default') await expectSelectionFan(page)
    },
    undefined,
    browserEndpoint,
    rasterization,
  )
})
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
          await expectSelectionFan(page)
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
  beforeAll(async () => {
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

// The menu cases below share one server, browser connection and context,
// opened once and warmed by a first scene. Each case still gets a fresh
// capture page (pointer, focus, clock and forced states start clean, and a
// case that overran its deadline cannot touch the next one), but no longer
// pays a server, connection, context and screenshot of its own.
const menu = { root }
beforeAll(async () => {
  const { server, port } = await serveRepo(root)
  menu.server = server
  menu.port = port
  menu.connection = await chromium.connect(browserEndpoint)
  menu.context = await menu.connection.newContext(CAPTURE_CONTEXT)
  await openMenuScene('rewind', 320)
})
afterAll(async () => {
  await menu.connection?.close()
  menu.server?.close()
})

async function openMenuScene(scene, width, theme = 'light') {
  await menu.page?.close()
  Object.assign(menu, await openCapturePage(menu.context))
  await prepareScene(menu, inputs.audit, { scene, theme, width, height: inputs.matrix.height })
  return menu.page
}

it('repeats the mounted scene prefix and focus raster within the lead tolerance', () => {
  expect(frames.size).toBe(24)
  expect(repeated.size).toBe(24)
  for (const [key, before] of frames)
    expect(
      () => comparePixels(before, repeated.get(key), 320, 760),
      `${key}: repeat capture`,
    ).not.toThrow()
})

// Each menu case below opens its own fresh scene in a hook and measures it in
// the case: the scene (its bundle and the harness's frozen-clock run) is the
// setup, the measurement is the test.
describe('the 320 px checkpoint Rewind submenu', () => {
  beforeAll(async () => {
    await openMenuScene('checkpoint-restore', 320)
  })
  it('stays clear of its opener with tooltip ellipses', async () => {
    const { page } = menu
    await page.getByRole('menuitem', { name: 'Rewind', exact: true }).click()
    await page.clock.runFor(100)
    const measured = await page.evaluate(() => {
      const button = globalThis.document
        .querySelector('.message-user .row-actions-button')
        .getBoundingClientRect()
      return {
        button: {
          left: button.left,
          right: button.right,
          top: button.top,
          bottom: button.bottom,
        },
        pills: [...globalThis.document.querySelectorAll('.gooey-menu-pill')].map((pill) => {
          const box = pill.getBoundingClientRect()
          const label = pill.querySelector('.gooey-menu-pill-label')
          const style = globalThis.getComputedStyle(label)
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            label: label.textContent,
            title: pill.title,
            clipped: label.scrollWidth > label.clientWidth,
            whiteSpace: style.whiteSpace,
            textOverflow: style.textOverflow,
          }
        }),
      }
    })
    expect(measured.pills).toHaveLength(4)
    for (const [index, pill] of measured.pills.entries()) {
      expect(pill.right, `${pill.label}: clears opener`).toBeLessThanOrEqual(measured.button.left)
      expect(pill.left).toBeGreaterThanOrEqual(8)
      expect(pill.bottom - pill.top).toBe(40)
      expect(pill.right - pill.left).toBeCloseTo(measured.pills[0].right - measured.pills[0].left)
      const next = measured.pills[index + 1]
      if (next !== undefined) expect(next.top - pill.bottom).toBeCloseTo(6, 1)
      if (!pill.clipped) continue
      expect(pill.title).toContain(pill.label)
      expect(pill.whiteSpace).toBe('nowrap')
      expect(pill.textOverflow).toBe('ellipsis')
    }
    expect(measured.pills.some((pill) => pill.clipped)).toBe(true)
  })
})

describe('an open selection fan', () => {
  beforeAll(async () => {
    await openMenuScene('quote-menu', 320)
  })
  it('moves with its button when the panel widens and narrows', async () => {
    const { page } = menu
    await expectSelectionFan(page)
    await addScrollRoom(page)
    // Real panels flow with the viewport. Fixed capture widths would briefly
    // put the opener outside a shrinking viewport before the next script ran.
    await page.evaluate(() => {
      globalThis.document.documentElement.style.width = '100%'
      globalThis.document.body.style.width = '100%'
    })
    for (const width of [690, 320]) {
      await page.setViewportSize({ width, height: 760 })
      await page.clock.runFor(100)
      await expectSelectionFan(page)
    }
  })
})

// Each case measures one real scene opened fresh for it, on its own page of
// the shared context, at the repository's five-second deadline.
const menuScenes = [
  'rewind',
  'assistant-menu',
  'chat-tool-menu',
  'checkpoint-restore',
  'chat-menu',
  'quote-menu',
  'queued-menu',
  'queued-menu-edit',
]
const menuCases = menuScenes.flatMap((scene) =>
  [320, 480, 900].flatMap((width) =>
    ['light', 'dark', 'hc-light', 'hc-dark'].map((theme) => [scene, width, theme]),
  ),
)

// Runs in the page: give each neighbour the state's selection attributes and
// take them from every other pill, then return every pill's box grown by its
// outline.
function pillExtents({ neighbours, state }) {
  return [...globalThis.document.querySelectorAll('.gooey-menu-pill')].map((pill, index) => {
    if (state !== undefined && neighbours.includes(index)) {
      pill.setAttribute('aria-selected', String(state.endsWith('selected')))
      pill.setAttribute('aria-pressed', String(state.endsWith('pressed')))
    } else {
      pill.removeAttribute('aria-selected')
      pill.removeAttribute('aria-pressed')
    }
    const rect = pill.getBoundingClientRect()
    const style = globalThis.getComputedStyle(pill)
    const reach =
      style.outlineStyle === 'none'
        ? 0
        : Math.max(
            0,
            Number(style.outlineWidth.replace('px', '')) +
              Number(style.outlineOffset.replace('px', '')),
          )
    return {
      top: rect.top - reach,
      bottom: rect.bottom + reach,
      left: rect.left - reach,
      right: rect.right + reach,
    }
  })
}

// The forced pseudo-classes and the measurement go out together on one CDP
// session, which the page runs in order: the measurement sees every forced
// class and attribute settled, at the cost of one round trip per state.
async function forceAndMeasure(cdp, forced, view) {
  const replies = await Promise.all([
    ...forced.map(([nodeId, forcedPseudoClasses]) =>
      cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses }),
    ),
    cdp.send('Runtime.evaluate', {
      expression: `(${pillExtents.toString()})(${JSON.stringify(view)})`,
      returnByValue: true,
    }),
  ])
  const { result, exceptionDetails } = replies.at(-1)
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text)
  return result.value
}

describe.each(menuCases)('%s / %s px / %s', (scene, width, theme) => {
  beforeAll(async () => {
    await openMenuScene(scene, width, theme)
  })
  it('keeps adjacent outlines clear', async () => {
    const { page, cdp } = menu
    expect(await page.locator('.gooey-menu-pill').count()).toBeGreaterThan(0)
    await page.evaluate(() => globalThis.document.activeElement.blur())
    const { root: document } = await cdp.send('DOM.getDocument')
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
      nodeId: document.nodeId,
      selector: '.gooey-menu-pill',
    })
    const opener = await page.evaluate(() => {
      const button =
        globalThis.document.querySelector('.row-actions-button[aria-expanded="true"]') ??
        globalThis.document
          .querySelector('.quote-menu')
          ?.closest('li')
          ?.querySelector('.row-actions-button')
      if (button === undefined || button === null) throw new Error('Missing menu opener')
      const rect = button.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })
    // Every pill's styles depend on its own state alone (no sibling or :has
    // selector reaches a pill), so alternate roles down the stack: with focus
    // on the even pills, each pair below an even pill is measured focused
    // above its neighbour and each pair above one the reverse; the odd pass
    // swaps them. Two passes cover every adjacent pair in both orders.
    for (const state of [
      'focus+hover',
      'focus',
      'hover',
      'focus+active',
      'focus+selected',
      'focus+pressed',
    ]) {
      const pointerState = state.endsWith('active') ? ['active'] : []
      const focusedClasses = state === 'hover' ? [] : ['focus', 'focus-visible']
      const neighbourClasses = state.includes('hover') ? ['hover'] : pointerState
      for (const parity of [0, 1]) {
        const isFocused = (index) => index % 2 === parity
        const clearance = await forceAndMeasure(
          cdp,
          nodeIds.map((nodeId, index) => [
            nodeId,
            isFocused(index) ? focusedClasses : neighbourClasses,
          ]),
          { neighbours: nodeIds.flatMap((_, index) => (isFocused(index) ? [] : [index])), state },
        )
        for (let index = 0; index < nodeIds.length - 1; index += 1)
          expect(
            clearance[index + 1].top - clearance[index].bottom,
            `${scene}/${width}/${theme}/${index}/${state}/${!isFocused(index)}`,
          ).toBeGreaterThanOrEqual(2)
        for (const pill of clearance) {
          expect(
            Math.max(
              opener.left - pill.right,
              pill.left - opener.right,
              opener.top - pill.bottom,
              pill.top - opener.bottom,
            ),
            'outlines also clear the opener',
          ).toBeGreaterThanOrEqual(2)
        }
      }
    }
    // No state: every forced class and selection attribute goes again.
    await forceAndMeasure(
      cdp,
      nodeIds.map((nodeId) => [nodeId, []]),
      { neighbours: [] },
    )
  })
})

async function expectFanAtAnchor(fan, point) {
  const position = await point()
  const pills = await fan()
  expect(pills.length).toBeGreaterThan(0)
  for (const pill of pills) {
    expect(pill.x).toBeCloseTo(position.x)
    expect(pill.y).toBeCloseTo(position.y)
  }
}

describe.each(
  [
    ['quote-menu', '.message-assistant'],
    ['chat-tool-menu', '[data-entry-id="ed1"]'],
    ['checkpoint-restore', '.message-user'],
  ].flatMap(([scene, selector]) => [320, 480, 900].map((width) => [scene, selector, width])),
)('%s at %s / %s px', (scene, selector, width) => {
  beforeAll(async () => {
    await openMenuScene(scene, width)
  })
  it('follows real ancestor scrolling/reflow and dismisses offscreen', async () => {
    const { page } = menu
    // Add genuine scroll room beneath the real row without altering its menu.
    await addScrollRoom(page)
    const anchor = page.locator(`${selector} .row-actions-button`).first()
    const point = async () =>
      anchor.evaluate((button) => {
        const box = button.getBoundingClientRect()
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
      })
    const fan = async () =>
      page.locator('.gooey-menu-pill').evaluateAll((nodes) =>
        nodes.map((pill) => ({
          x:
            Number(pill.style.left.replace('px', '')) +
            Number(pill.style.transformOrigin.split(' ', 1)[0].replace('px', '')),
          y:
            Number(pill.style.top.replace('px', '')) +
            Number(pill.style.transformOrigin.split(' ', 2)[1].replace('px', '')),
        })),
      )
    // Move the row down before scrolling, keeping its opener inside the viewport.
    await anchor.evaluate((button) => {
      button.closest('li').style.marginTop = '180px'
    })
    await page.clock.runFor(100)
    await expectFanAtAnchor(fan, point)
    const before = await point()
    await page.locator('.body-transcript').evaluate((transcript) => {
      transcript.scrollTop += 60
    })
    await page.clock.runFor(100)
    const after = await point()
    expect(after.y).toBeCloseTo(before.y - 60)
    await expectFanAtAnchor(fan, point)
    if (scene === 'checkpoint-restore') {
      await page.getByRole('menuitem', { name: 'Rewind', exact: true }).click()
      await page.clock.runFor(100)
      expect(await page.locator('.gooey-menu-pill').count()).toBe(4)
      const childrenBefore = await fan()
      await page.locator('.body-transcript').evaluate((transcript) => {
        transcript.scrollTop += 20
      })
      await page.clock.runFor(100)
      const childrenAfter = await fan()
      for (const [index, child] of childrenAfter.entries()) {
        expect(child.y).toBeCloseTo(childrenBefore[index].y - 20)
      }
    }
    await page.locator('.body-transcript').evaluate((transcript) => {
      transcript.scrollTop += 900
    })
    await page.clock.runFor(100)
    expect(await page.locator('.gooey-menu').count()).toBe(0)
  })
})
