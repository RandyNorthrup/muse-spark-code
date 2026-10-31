import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../../../scripts/lib/chrome.mjs'
import { DESKTOP_SIZED_SCENARIOS } from '../../../scripts/lib/harnessServer.mjs'
import { parseArgs } from '../../../scripts/readme-shots.mjs'
import { COMPACT_PANES, DESKTOP_FRAME } from '../../../src/shared/desktopContracts'
import {
  DESKTOP_SCENES,
  SCENE_READY,
  desktopSceneHtml,
} from '../../../test/desktop/harness/lib/scenes.mjs'
import {
  desktopSceneUrl,
  serveDesktopScenes,
} from '../../../test/desktop/harness/lib/sceneServer.mjs'
import {
  expandReviewPlan,
  parseReviewShots,
} from '../../../test/desktop/harness/lib/reviewShots.mjs'
import {
  desktopLanguages,
  desktopStrings,
  desktopText,
} from '../../../test/desktop/harness/lib/strings.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('desktop scene registry (lane 0 sheets)', () => {
  it('names every scene once with its sheet and capture size', () => {
    const ids = DESKTOP_SCENES.map((scene) => scene.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'workbench-1920',
      'workbench-1280',
      'bar-popovers',
      'launcher',
      'greeter',
      'lock',
      'prompts',
      'tiled',
      'onboarding',
      'preview-grid',
      'rtl',
    ])
    expect(DESKTOP_SCENES.find((scene) => scene.id === 'workbench-1920')).toMatchObject({
      width: 1920,
      height: 1080,
    })
    expect(DESKTOP_SCENES.find((scene) => scene.id === 'workbench-1280')).toMatchObject({
      width: 1280,
      height: 800,
    })
    for (const scene of DESKTOP_SCENES) {
      expect(DESKTOP_SIZED_SCENARIOS[scene.id]).toEqual({
        width: scene.width,
        ready: SCENE_READY,
      })
    }
  })

  it('renders the real German desktop strings for the greeter', async () => {
    const html = await desktopSceneHtml(root, { scene: 'greeter', theme: 'light', lang: 'de' })
    const table = JSON.parse(readFileSync(path.join(root, 'l10n/ui.de.json'), 'utf8')).desktop
    expect(html).toContain(table.password)
    expect(html).toContain(table.securityKey)
    expect(html).toContain(table.secureAttentionGreeter)
    expect(html).toContain('data-ms-theme="light"')
    expect(html).toContain('data-desktop-scene-ready')
    expect(html).toContain('not product UI')
  })

  it('refuses an unknown scene, theme and language by name', async () => {
    await expect(desktopSceneHtml(root, { scene: 'nope' })).rejects.toThrow('unknown desktop scene')
    await expect(desktopSceneHtml(root, { scene: 'lock', theme: 'sepia' })).rejects.toThrow(
      'unknown desktop theme',
    )
    await expect(desktopSceneHtml(root, { scene: 'lock', lang: 'xx' })).rejects.toThrow(
      'no language table',
    )
  })
})

describe('desktop strings across the 15 tables', () => {
  it('lists English and the 14 translated tables', async () => {
    const langs = await desktopLanguages(root)
    expect(langs).toHaveLength(15)
    expect(langs[0]).toBe('en')
    expect(langs).toContain('pt-br')
    expect(langs).toContain('zh-tw')
  })

  it('fills slots and picks the plural form the language uses', async () => {
    const german = await desktopStrings(root, 'de')
    expect(desktopText(german, 'de', 'notificationsCount', { count: 1 })).toBe('1 Benachrichtigung')
    expect(desktopText(german, 'de', 'notificationsCount', { count: 3 })).toBe(
      '3 Benachrichtigungen',
    )
    const english = await desktopStrings(root, 'en')
    expect(desktopText(english, 'en', 'onboardingStep', { step: 2, total: 4 })).toBe('Step 2 of 4')
  })
})

describe('review shot plan', () => {
  it('expands scenes × themes × languages, and * to all 15', async () => {
    const plan = parseReviewShots(
      readFileSync(path.join(root, 'test/desktop/harness/review-shots.json'), 'utf8'),
    )
    const captures = await expandReviewPlan(root, plan)
    expect(captures).toHaveLength(plan.scenes.length * plan.themes.length * plan.languages.length)
    expect(captures[0].file).toBe('workbench-1920.dark.en.png')
    const all = await expandReviewPlan(root, { ...plan, scenes: ['lock'], languages: ['*'] })
    expect(all).toHaveLength(plan.themes.length * 15)
  })

  it('rejects an unknown scene or theme in the plan', () => {
    expect(() =>
      parseReviewShots('{"scenes":["nope"],"themes":["dark"],"languages":["en"]}'),
    ).toThrow('unknown entry')
    expect(() =>
      parseReviewShots('{"scenes":["lock"],"themes":["sepia"],"languages":["en"]}'),
    ).toThrow('unknown entry')
  })

  it('readme-shots routes --desktop away from the README list', () => {
    expect(parseArgs(['--desktop'])).toMatchObject({ desktop: true, out: 'temp/desktop-review' })
    expect(parseArgs(['--desktop', '--languages', '*']).languages).toEqual(['*'])
    expect(parseArgs([])).toMatchObject({ desktop: false, out: 'media/readme' })
  })
})

describe('desktop scenes in a real browser', () => {
  const runtime = {}

  beforeAll(async () => {
    // Warm the contract and string bundles outside the per-test deadline.
    await desktopSceneHtml(root, { scene: 'workbench-1280' })
    const chrome = findChrome()
    if (chrome === undefined) throw new Error('Chrome is required for the desktop scene suite')
    runtime.browser = await chromium.launch({ executablePath: chrome })
    const served = await serveDesktopScenes(root)
    runtime.server = served.server
    runtime.port = served.port
  })

  afterAll(async () => {
    await runtime.browser?.close()
    await new Promise((resolve) => runtime.server?.close(resolve) ?? resolve())
  })

  it('frames the compact workbench at the contract sizes', async () => {
    const page = await runtime.browser.newPage({ viewport: { width: 1280, height: 800 } })
    try {
      await page.goto(desktopSceneUrl(runtime.port, { scene: 'workbench-1280' }))
      await page.locator(SCENE_READY).waitFor()
      const size = async (selector) =>
        page.locator(selector).evaluate((node) => {
          const rect = node.getBoundingClientRect()
          return { width: rect.width, height: rect.height }
        })
      const bar = await size('[data-region="top-bar"]')
      expect(bar.height).toBe(DESKTOP_FRAME.topBarHeightPx)
      const status = await size('[data-region="status-bar"]')
      expect(status.height).toBe(DESKTOP_FRAME.statusBarHeightPx)
      const rail = await size('[data-region="rail"]')
      expect(rail.width).toBe(DESKTOP_FRAME.railWidthPx)
      const chat = await size('[data-region="chat"]')
      expect(chat.width).toBe(COMPACT_PANES.chatWidthPx)
      const sidebar = await size('[data-region="sidebar"]')
      expect(sidebar.width).toBe(COMPACT_PANES.sidebarWidthPx)
      const panel = await size('[data-region="bottom-panel"]')
      expect(panel.height).toBe(COMPACT_PANES.terminalHeightPx)
    } finally {
      await page.close()
    }
  })

  it('mirrors the rtl scene but keeps code classes left-to-right', async () => {
    const page = await runtime.browser.newPage({ viewport: { width: 1440, height: 900 } })
    try {
      await page.goto(desktopSceneUrl(runtime.port, { scene: 'rtl' }))
      await page.locator(SCENE_READY).waitFor()
      expect(await page.evaluate(() => globalThis.document.dir)).toBe('rtl')
      expect(await page.locator('[data-ltr-kind="code"]').evaluate((node) => node.dir)).toBe('ltr')
      expect(await page.locator('[data-ltr-kind="code"]').getAttribute('data-mirrored')).toBe(
        'false',
      )
    } finally {
      await page.close()
    }
  })
})
