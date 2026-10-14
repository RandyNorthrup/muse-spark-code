import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { contrastRatio } from '../../scripts/check-tokens.mjs'
import { decodePng } from '../../scripts/lib/visualImages.mjs'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const matrix = readJson('test/harness/visual-matrix.json')
const runtime = {}
const fixture = [
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {EmptyState} from './src/webview/components/EmptyState';",
  "import {ProductMark} from './src/webview/components/icons';",
  "createRoot(globalThis.document.getElementById('root')).render(<>",
  '<EmptyState hint="Say hello." isOnboardingShown={false} onHideOnboarding={()=>{}}/>',
  '<ProductMark title="Gallery mark"/>',
  '</>);',
].join('\n')

beforeAll(async () => {
  const css = await build({ entryPoints: ['src/webview/styles.css'], bundle: true, write: false })
  runtime.css = css.outputFiles[0].text
  const js = await build({
    stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  runtime.js = js.outputFiles[0].text
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for product mark verification')
  runtime.browser = await chromium.launch(
    path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
  )
})

afterAll(async () => {
  await runtime.browser?.close()
})

async function open(theme, width, forcedColors = 'none') {
  const capture = readJson(`test/harness/themes/${theme}.json`)
  const page = await runtime.browser.newPage({
    viewport: { width, height: matrix.height },
    reducedMotion: 'reduce',
    forcedColors,
  })
  await page.setContent(`<style>${runtime.css}</style><main id="root"></main>`)
  await page.evaluate(({ bodyClass, variables }) => {
    globalThis.document.body.className = bodyClass
    for (const [name, value] of Object.entries(variables))
      globalThis.document.documentElement.style.setProperty(name, value)
  }, capture)
  await page.addScriptTag({ content: runtime.js })
  await page.locator('.brand .product-mark').waitFor()
  await page.evaluate(() => globalThis.document.fonts.ready)
  return { page, capture }
}

function colour(rgb) {
  return {
    colorSpace: 'srgb',
    components: rgb
      .match(/\d+/g)
      .map(Number)
      .map((n) => n / 255),
    alpha: 1,
  }
}

function blueHue([red, green, blue]) {
  const range = Math.max(red, green, blue) - Math.min(red, green, blue)
  // The brand is saturated blue: a grey or another hue must fail too.
  expect(blue).toBeGreaterThan(red)
  expect(blue).toBeGreaterThan(green)
  return 60 * ((red - green) / range + 4)
}

describe('PANELMARKR2 rendered product mark', () => {
  it.each(matrix.themes.flatMap((theme) => matrix.widths.map((width) => [theme, width])))(
    '%s at %i: blue/foreground contrast, full ink box and unchanged surrounding pixels',
    async (theme, width) => {
      const { page, capture } = await open(theme, width)
      try {
        const measured = await page.evaluate(() => {
          const mark = globalThis.document.querySelector('.brand .product-mark')
          const path = mark.querySelector('path')
          const bounds = path.getBBox()
          const transform = path.getScreenCTM()
          const stroke = Number(globalThis.getComputedStyle(path).strokeWidth.replace('px', ''))
          const ink = {
            width: (bounds.width + stroke) * transform.a,
            height: (bounds.height + stroke) * transform.d,
          }
          const galleryMark = globalThis.document.querySelector('#root > .product-mark')
          const galleryPath = galleryMark.querySelector('path')
          const galleryBounds = galleryPath.getBBox()
          const galleryTransform = galleryPath.getScreenCTM()
          const galleryStroke = Number(
            globalThis.getComputedStyle(galleryPath).strokeWidth.replace('px', ''),
          )
          return {
            mark: mark.getBoundingClientRect().toJSON(),
            name: globalThis.document.querySelector('.brand span').getBoundingClientRect().toJSON(),
            hint: globalThis.document.querySelector('.hint').getBoundingClientRect().toJSON(),
            foreground: globalThis.getComputedStyle(mark).color,
            gallery: globalThis.getComputedStyle(galleryMark).color,
            background: globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
            text: globalThis.getComputedStyle(globalThis.document.body).color,
            ink,
            inkTop: transform.f + bounds.y * transform.d - (stroke / 2) * transform.d,
            inkLeft: transform.e + bounds.x * transform.a - (stroke / 2) * transform.a,
            galleryInk: {
              width: (galleryBounds.width + galleryStroke) * galleryTransform.a,
              height: (galleryBounds.height + galleryStroke) * galleryTransform.d,
            },
          }
        })
        const foreground = colour(measured.foreground)
        expect(contrastRatio(foreground, colour(measured.background))).toBeGreaterThanOrEqual(3)
        expect(measured.background).toBe(
          `rgb(${colourFromHex(capture.variables['--vscode-sideBar-background']).join(', ')})`,
        )
        expect(measured.gallery).toBe(measured.foreground)
        if (capture.kind.startsWith('hc-')) expect(measured.foreground).toBe(measured.text)
        else {
          const hue = blueHue(foreground.components)
          expect(hue).toBeGreaterThanOrEqual(210)
          expect(hue).toBeLessThanOrEqual(240)
          const endpoint = capture.kind === 'light' ? '#0a5cff' : '#3d8bff'
          expect(measured.foreground).toBe(`rgb(${colourFromHex(endpoint).join(', ')})`)
        }
        expect(measured.mark.width).toBeCloseTo(28.8, 1)
        expect(measured.mark.height).toBeCloseTo(19.2, 1)
        // The width is the limiting dimension: the ink fills it and sits
        // centred in the height, keeping the 20:11.14 view-box proportions
        // (the Marketplace mark's, within 1%) instead of stretching to both.
        expect(measured.ink.width).toBeCloseTo(measured.mark.width, 1)
        expect(measured.ink.width / measured.ink.height).toBeCloseTo(20 / 11.14, 2)
        expect(measured.ink.height).toBeCloseTo(measured.mark.width / (20 / 11.14), 1)
        expect(measured.inkLeft).toBeCloseTo(measured.mark.left, 0)
        expect(measured.inkTop - measured.mark.top).toBeCloseTo(
          (measured.mark.height - measured.ink.height) / 2,
          0,
        )
        // The icon-gallery use keeps the same proportions in its own box.
        expect(measured.galleryInk.width / measured.galleryInk.height).toBeCloseTo(20 / 11.14, 2)
        const after = decodePng(await page.screenshot(), width, matrix.height)
        // Recreate the reviewed parent mark without touching layout or other paint.
        await page.locator('.brand .product-mark').evaluate((mark, isHighContrast) => {
          mark.setAttribute('viewBox', '0 0 24 24')
          mark.removeAttribute('preserveAspectRatio')
          mark.setAttribute('stroke-width', '1.9')
          mark.style.color = isHighContrast ? 'var(--ms-text)' : 'var(--ms-accent)'
        }, capture.kind.startsWith('hc-'))
        const before = decodePng(await page.screenshot(), width, matrix.height)
        const positions = await page.evaluate(() => ({
          mark: globalThis.document
            .querySelector('.brand .product-mark')
            .getBoundingClientRect()
            .toJSON(),
          name: globalThis.document.querySelector('.brand span').getBoundingClientRect().toJSON(),
          hint: globalThis.document.querySelector('.hint').getBoundingClientRect().toJSON(),
        }))
        expect(positions).toEqual({ mark: measured.mark, name: measured.name, hint: measured.hint })
        let changed = 0
        let outside = 0
        for (let y = 0; y < matrix.height; y += 1)
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 4
            if (before.subarray(offset, offset + 4).equals(after.subarray(offset, offset + 4)))
              continue
            changed += 1
            if (
              x < Math.floor(measured.mark.left) ||
              x >= Math.ceil(measured.mark.right) ||
              y < Math.floor(measured.mark.top) ||
              y >= Math.ceil(measured.mark.bottom)
            )
              outside += 1
          }
        expect(changed).toBeGreaterThan(0)
        expect(outside).toBe(0)
      } finally {
        await page.close()
      }
    },
  )

  it.each(['light', 'dark'])(
    'uses CanvasText for every mark under forced colours (%s)',
    async (theme) => {
      const { page } = await open(theme, 320, 'active')
      try {
        const colours = await page.evaluate(() => {
          const probe = globalThis.document.createElement('span')
          probe.style.color = 'CanvasText'
          globalThis.document.body.append(probe)
          return {
            expected: globalThis.getComputedStyle(probe).color,
            marks: [...globalThis.document.querySelectorAll('.product-mark')].map(
              (mark) => globalThis.getComputedStyle(mark).color,
            ),
          }
        })
        expect(colours.marks).toEqual([colours.expected, colours.expected])
      } finally {
        await page.close()
      }
    },
  )
})

function colourFromHex(hex) {
  return hex
    .slice(1)
    .match(/.{2}/g)
    .map((n) => Number.parseInt(n, 16))
}

/** Rows of [scene, frames] in scene order. */
const byScene = (left, right) => left[0].localeCompare(right[0], 'en')

it('certifies every moved scene with the frame count the reviewed render measured', () => {
  // The lane listed fourteen scenes at 72 frames, 1,008. The reviewed render
  // on 111afdfa1d measured sixteen scenes and 984 frames; the record of that
  // render is the source, and the certification's table must say the same.
  const review = readJson('docs/certification/panelmark-baseline-review.json').comparison
  const measured = Object.entries(review.movedByScene).map(([scene, moved]) => [
    `panel/${scene}`,
    moved.frames,
  ])
  const captures = readJson('test/harness/goldens/manifest.json').captures
  const whole = matrix.themes.length * matrix.widths.length * matrix.states.length
  for (const [key, moved] of measured) {
    const scene = key.slice('panel/'.length)
    const frames = captures.filter(
      (capture) => capture.surface === 'panel' && capture.scene === scene,
    ).length
    expect(frames, key).toBeGreaterThan(0)
    expect(frames, key).toBeLessThanOrEqual(whole)
    expect(moved, key).toBeLessThanOrEqual(frames)
  }
  const certification = readFileSync('docs/certification/panelmark.md', 'utf8')
  const rows = Array.from(
    certification.matchAll(/^\| `(panel\/[\w-]+)`\s*\|\s*(\d+)\s*\|/gm),
    ([, scene, count]) => [scene, Number(count)],
  )
  expect(rows.toSorted(byScene)).toEqual(measured.toSorted(byScene))
  expect(rows).toHaveLength(16)
  expect(rows.reduce((sum, [, count]) => sum + count, 0)).toBe(review.counts.over)
  expect(review.counts.over).toBe(984)
})
