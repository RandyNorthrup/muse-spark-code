import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { makeFixtures } from '../harness/goldens/fixtures.mjs'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { captureMatrix } from '../harness/goldens/capture.mjs'
import { decodePng } from '../../scripts/lib/visualImages.mjs'
import { VISUAL_BUILD_KEY } from './helpers/productionPackage'
import { REVIEW_BROWSER_KEY, REVIEW_RASTERIZATION_KEY } from './helpers/reviewBrowser.mjs'

// Global setup builds and stages the capture root, starts the shared browser
// and measures its rasterization before workers, as for visualStability: on
// hosted macOS a per-scene hook's own Chrome launch and fingerprint (about half
// of each capture on the Mac mini) ran out its ten seconds (CIFIX017R3).
const root = inject(VISUAL_BUILD_KEY)
const browserEndpoint = inject(REVIEW_BROWSER_KEY)
const rasterization = inject(REVIEW_RASTERIZATION_KEY)

const captured = {
  result: undefined,
  busyRows: [],
  rootWidths: [],
  bounds: [],
  layouts: [],
  outlines: [],
  bodyWidths: [],
}
// Each real scene has its own bounded setup hook; retain every state without
// combining six browser captures under one default ten-second deadline.
for (const scene of [
  'board',
  'deferred-modal',
  'whats-new',
  'whats-new-highlights',
  'approval-several',
  'approval-narrow',
  'questions-open',
  'questions-chip',
  'help-narrow',
  'accounts-dialog',
  'accounts-swap',
  'accounts-thresholds',
  'models-configure',
  'models-providers',
  'media-controls',
  'reporting-page',
  'resource-controls',
  'schedule-report-action',
  'playbook-status',
  'estimator-result',
  'usage-tokens',
  'vault-approval',
  'muse-tools',
  'resource-history',
])
  beforeAll(async () => {
    const audit = JSON.parse(await readFile('docs/certification/m114-audit.json', 'utf8'))
    const matrix = JSON.parse(await readFile('test/harness/visual-matrix.json', 'utf8'))
    const result = await captureMatrix(
      root,
      {
        ...audit,
        scenes: [scene],
      },
      { ...matrix, themes: ['light'], widths: [320] },
      async (capture, bytes, page) => {
        decodePng(bytes, capture.width, capture.height)
        if (capture.scene === 'playbook-status')
          expect(await page.locator('.playbook-record').count()).toBe(1)
        const selectors =
          {
            'accounts-thresholds': ['.account-thresholds'],
            'models-configure': ['.models-wizard-step'],
          }[capture.scene] ?? []
        for (const selector of selectors) {
          const box = await page.locator(selector).first().boundingBox()
          captured.bounds.push({
            scene: capture.scene,
            top: box.y,
            bottom: box.y + box.height,
            height: capture.height,
          })
        }
        if (capture.scene === 'models-providers') {
          const layout = await page
            .locator('.models-row-actions')
            .first()
            .evaluate((element) => ({
              direction: globalThis.getComputedStyle(element).flexDirection,
              wrap: globalThis.getComputedStyle(element).flexWrap,
            }))
          captured.layouts.push(layout)
        }
        if (
          capture.state === 'focus-visible' &&
          ['models-configure', 'accounts-thresholds'].includes(capture.scene)
        ) {
          const outline =
            capture.target === null
              ? 'missing'
              : await page.locator('[data-visual-target]').evaluate((element) => {
                  element.focus()
                  const width = globalThis.getComputedStyle(element).outlineWidth
                  element.blur()
                  return width
                })
          captured.outlines.push(outline)
        }
        if (capture.scene === 'board')
          expect(
            await page.locator('[role="dialog"]').count(),
            `${capture.state}: dialog remains open`,
          ).toBe(1)
        else if (capture.scene.startsWith('approval-'))
          captured.busyRows.push(
            await page.locator('.composer-input').evaluate((element) => element.rows),
          )
        captured.rootWidths.push(
          await page.evaluate(
            () => globalThis.document.documentElement.getBoundingClientRect().width,
          ),
        )
        captured.bodyWidths.push(
          await page.locator('body').evaluate((element) => element.getBoundingClientRect().width),
        )
        expect(
          await page.evaluate(
            () => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
          ),
        ).toBe(true)
      },
      undefined,
      browserEndpoint,
      rasterization,
    )
    if (captured.result === undefined) captured.result = result
    else {
      expect(result.rasterization).toBe(captured.result.rasterization)
      captured.result.captures.push(...result.captures)
    }
  })

describe('M114 real visual capture driver', () => {
  it('opens lazy tool bodies after the folded steps chunk paints', () => {
    const frames = captured.result.captures.filter((capture) => capture.scene === 'muse-tools')
    expect(frames).toHaveLength(6)
    expect(
      frames.every((capture) =>
        capture.components.includes('src/webview/components/ToolBodies.tsx'),
      ),
    ).toBe(true)
  })
  it('keeps canonical account and wizard descendants inside the captured viewport', () => {
    expect(captured.bounds.length).toBe(12)
    for (const box of captured.bounds) {
      expect(box.top, box.scene).toBeLessThan(box.height)
      expect(box.bottom, box.scene).toBeGreaterThan(0)
    }
  })
  it('uses actual two-pixel focus rings in accounts and the independent Models page', () => {
    expect(captured.outlines).toEqual(['2px', '2px'])
  })
  it('wraps narrow Models actions in rows', () => {
    expect(captured.layouts).toEqual(
      Array.from({ length: 6 }, () => ({ direction: 'row', wrap: 'wrap' })),
    )
  })

  it('renders optional integrated surfaces through their real entries and all six states', () => {
    for (const scene of [
      'accounts-dialog',
      'accounts-swap',
      'accounts-thresholds',
      'models-configure',
      'media-controls',
      'reporting-page',
      'resource-controls',
      'schedule-report-action',
      'playbook-status',
      'estimator-result',
      'usage-tokens',
      'vault-approval',
    ]) {
      const rows = captured.result.captures.filter((capture) => capture.scene === scene)
      expect(rows.map((capture) => capture.state)).toEqual([
        'default',
        'hover',
        'focus-visible',
        'pressed',
        'disabled',
        'selected',
      ])
      expect(rows.every((capture) => capture.components.length > 0)).toBe(true)
    }
  })
  it('captures the integrated question store, lazy dock, Open Questions controls and Help renderer', () => {
    const components = captured.result.captures.flatMap((capture) => capture.components)
    for (const name of [
      'QuestionSurface',
      'QuestionUi',
      'DeferredQuestionUi',
      'OpenQuestionsChip',
      'ReferencePage',
    ])
      expect(components).toContain(`src/webview/components/${name}.tsx`)
  })
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
  it('captures real controls on extra scenes without canonical component rows', () => {
    for (const state of ['hover', 'focus-visible', 'pressed', 'disabled'])
      expect(
        captured.result.captures.find(
          (capture) => capture.scene === 'whats-new-highlights' && capture.state === state,
        ),
      ).toMatchObject({ applied: true, target: expect.stringContaining('button') })
  })
  it('isolates fixture CSP origins for concurrent capture runs', async () => {
    const first = await makeFixtures(root, 11_401)
    const second = await makeFixtures(root, 11_402)
    try {
      expect(first).not.toBe(second)
      expect(await readFile(path.join(root, first, 'whats-new.html'), 'utf8')).toContain(
        'http://127.0.0.1:11401',
      )
      expect(await readFile(path.join(root, second, 'whats-new.html'), 'utf8')).toContain(
        'http://127.0.0.1:11402',
      )
    } finally {
      const directories = new Set([first, second])
      for (const directory of directories)
        await rm(path.join(root, directory), { recursive: true, force: true })
    }
  })
  it('settles the empty busy composer with its own resize handler at the final width', () => {
    expect(captured.busyRows).toEqual(Array.from({ length: 12 }, () => 1))
  })
  it('records actual font rasterization and exact narrow viewport dimensions', () => {
    expect(captured.bodyWidths).toEqual(
      Array.from({ length: captured.result.captures.length }, () => 320),
    )
    expect(captured.rootWidths).toEqual(
      Array.from({ length: captured.result.captures.length }, () => 320),
    )
    expect(captured.result.rasterization).toMatch(/^[\da-f]{64}$/)
    for (const capture of captured.result.captures)
      expect(capture).toMatchObject({ width: 320, height: 760 })
  })
})
