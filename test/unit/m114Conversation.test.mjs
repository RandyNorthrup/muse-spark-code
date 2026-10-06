import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { contrastRatio } from '../../scripts/check-tokens.mjs'

const themes = ['light', 'dark', 'hc-dark', 'hc-light', 'one-dark-pro', 'dracula']
const controls = [
  'jump-latest',
  'chip-remove',
  'tool-toggle',
  'tool-chevron',
  'tool-path',
  'tool-expand',
  'tool-more',
  'tool-image',
  'steps-toggle',
  'paid-badge',
  'context-meter',
  'todo-title',
  'todo-open',
  'todo-window',
  'diff-tally-review',
  'icon-button',
  'mode-button',
  'send-button',
  'pill',
]
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {StatusLine} from './src/webview/components/StatusLine';
import {CodeBlock} from './src/webview/components/CodeBlock';
createRoot(document.getElementById('actual')).render(<>
  <ul className="transcript"><StatusLine/></ul>
  <CodeBlock code={'const answer = "yes"; // comment'} language="typescript" onOpen={()=>{}}/>
</>);`
const markup = `<main>
  <div class="composer"><textarea class="composer-input" placeholder="Ask for a change"></textarea></div>
  <div class="composer-toolbar">${controls.map((c) => `<button class="${c}">${c}</button>`).join('')}</div>
  <div class="tool-output"><div class="tool-open" role="button" tabindex="0">Output</div></div>
  <div class="goal"><input class="question-input goal-edit-input" aria-label="Objective"><progress class="usage-bar" max="100" value="25"></progress></div>
  <div class="approval-dock"><p class="approval-dock-count">Two waiting</p><button class="tool-more">Last action</button></div>
  <p class="markdown"><a href="https://example.com">Source</a><span class="cursor"></span></p>
  <span class="tool-dot-running"></span><button class="mic-button mic-listening">Microphone</button>
  <div id="actual"></div>
</main>`
const runtime = { browser: undefined, css: undefined, js: undefined }

beforeAll(async () => {
  const [styles, fixture] = await Promise.all([
    build({ entryPoints: ['src/webview/styles.css'], bundle: true, write: false }),
    build({
      stdin: { contents: source, resolveDir: process.cwd(), loader: 'jsx' },
      bundle: true,
      platform: 'browser',
      write: false,
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    }),
  ])
  runtime.css = styles.outputFiles[0].text
  runtime.js = fixture.outputFiles[0].text
  const chrome = findChrome()
  if (chrome === undefined)
    throw new Error('Chrome is required for conversation state verification')
  runtime.browser = await chromium.launch({
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
  })
})
afterAll(async () => {
  await runtime.browser?.close()
})

async function pageFor(theme, width = 320, motion = 'reduce', progress) {
  const fixture = JSON.parse(
    await readFile(new URL(`../harness/themes/${theme}.json`, import.meta.url), 'utf8'),
  )
  const page = await runtime.browser.newPage({
    viewport: { width, height: 760 },
    reducedMotion: motion,
  })
  await page.route('**/*', (route) => route.abort())
  await page.clock.install({ time: new Date('2026-10-06T12:00:00Z') })
  await page.setContent(`<style>${runtime.css}</style>${markup}`)
  await page.evaluate(
    ({ fixture, progress }) => {
      const root = globalThis.document.documentElement
      for (const [key, value] of Object.entries(fixture.variables))
        root.style.setProperty(key, value)
      for (const key of fixture.unset)
        if (!key.includes('font')) root.style.setProperty(key, 'initial')
      root.style.setProperty('--vscode-font-family', 'sans-serif')
      root.style.setProperty('--vscode-editor-font-family', 'monospace')
      root.style.setProperty('--vscode-font-size', '13px')
      root.style.setProperty('--vscode-editor-font-size', '13px')
      if (progress !== undefined) root.style.setProperty('--ms-progress', progress)
      globalThis.document.body.className = fixture.bodyClass
    },
    { fixture, progress },
  )
  await page.addScriptTag({ content: runtime.js })
  await page.waitForSelector('canvas.heartbeat-trace', { state: 'attached' })
  return page
}

const colour = (value) => {
  const channels = value.match(/[\d.]+/g).map(Number)
  return {
    colorSpace: 'srgb',
    components: channels.slice(0, 3).map((n) => n / 255),
    alpha: channels[3] ?? 1,
  }
}
const ratio = (fg, bg) => contrastRatio(colour(fg), colour(bg))
const stylesOf = (page, selector, pseudo) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, pseudo) => {
      const s = globalThis.getComputedStyle(el, pseudo)
      return Object.fromEntries(
        [
          'color',
          'backgroundColor',
          'borderColor',
          'outlineWidth',
          'outlineOffset',
          'outlineColor',
          'boxShadow',
          'borderRadius',
          'fontFamily',
          'fontSize',
          'animationName',
          'transitionDuration',
          'opacity',
          'display',
          'filter',
          'backdropFilter',
          'textDecorationLine',
        ].map((k) => [k, s[k]]),
      )
    }, pseudo)

async function styleValue(page, selector, key) {
  const styles = await stylesOf(page, selector)
  return styles[key]
}

async function forceState(page, selector, state) {
  const cdp = await page.context().newCDPSession(page)
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  await cdp.send('CSS.enable')
  await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: state })
  return cdp
}

describe('M114 P1 conversation contract', () => {
  it.each(themes.flatMap((theme) => [320, 690].map((width) => ({ theme, width }))))(
    '$theme at $width: readable prompt, exterior keyboard rings and host fonts',
    async ({ theme, width }) => {
      const page = await pageFor(theme, width)
      try {
        const composer = await stylesOf(page, '.composer')
        expect(composer.borderRadius).toBe('12px')
        const placeholder = await stylesOf(page, '.composer-input', '::placeholder')
        expect(ratio(placeholder.color, composer.backgroundColor)).toBeGreaterThanOrEqual(4.5)
        expect(placeholder.opacity).toBe('1')
        expect(ratio(composer.borderColor, composer.backgroundColor)).toBeGreaterThanOrEqual(3)
        await page.keyboard.press('Tab')
        const focused = await stylesOf(page, '.composer')
        expect(focused.outlineWidth).toBe('2px')
        expect(focused.outlineOffset).toBe('2px')
        const body = await stylesOf(page, 'body')
        expect(ratio(focused.outlineColor, body.backgroundColor)).toBeGreaterThanOrEqual(3)
        for (const c of [...controls, 'code-block-button', 'goal-edit-input']) {
          await page.locator(`.${c}`).first().focus()
          const s = await stylesOf(page, `.${c}`)
          expect(s.outlineWidth, c).toBe('2px')
          expect(s.outlineOffset, c).toBe('2px')
          expect(ratio(s.outlineColor, body.backgroundColor), c).toBeGreaterThanOrEqual(3)
          expect(s.filter, c).toBe('none')
          expect(s.backdropFilter, c).toBe('none')
        }
        expect(await styleValue(page, 'body', 'fontFamily')).toBe('sans-serif')
        const code = await stylesOf(page, '.code-block-body')
        expect(code.fontFamily).toBe('monospace')
        expect(code.fontSize).toBe('13px')
      } finally {
        await page.close()
      }
    },
  )

  it.each(themes)(
    '%s: pressed, selected and disabled controls preserve readable state pairs',
    async (theme) => {
      const page = await pageFor(theme)
      try {
        for (const c of [
          'chip-remove',
          'tool-toggle',
          'code-block-button',
          'todo-open',
          'icon-button',
        ]) {
          const cdp = await forceState(page, `.${c}`, ['hover', 'active'])
          const pressed = await stylesOf(page, `.${c}`)
          expect(pressed.backgroundColor, c).not.toBe('rgba(0, 0, 0, 0)')
          expect(ratio(pressed.color, pressed.backgroundColor), c).toBeGreaterThanOrEqual(4.5)
          await page
            .locator(`.${c}`)
            .first()
            .evaluate((el) => {
              el.disabled = true
            })
          const disabled = await stylesOf(page, `.${c}`)
          expect(disabled.color, c).not.toBe(pressed.color)
          expect(disabled.backgroundColor, c).not.toBe(pressed.backgroundColor)
          await cdp.detach()
        }
        await page.locator('.mode-button').evaluate((el) => el.setAttribute('aria-pressed', 'true'))
        const selected = await stylesOf(page, '.mode-button')
        expect(ratio(selected.color, selected.backgroundColor)).toBeGreaterThanOrEqual(4.5)
        await page.locator('.markdown a').focus()
        const link = await stylesOf(page, '.markdown a')
        expect(link.outlineWidth).toBe('2px')
        expect(link.textDecorationLine).toContain('underline')
      } finally {
        await page.close()
      }
    },
  )

  it.each(['hc-dark', 'hc-light'])(
    '%s replaces card elevation with a contrast border',
    async (theme) => {
      const page = await pageFor(theme)
      try {
        const body = await stylesOf(page, 'body')
        for (const selector of ['.composer', '.jump-latest', '.tool-expand', '.code-block']) {
          const s = await stylesOf(page, selector)
          expect(s.boxShadow, selector).toBe('none')
          expect(ratio(s.borderColor, body.backgroundColor), selector).toBeGreaterThanOrEqual(3)
        }
      } finally {
        await page.close()
      }
    },
  )

  it('keeps the heartbeat pinned across verbs at 320 px and reads the semantic progress role', async () => {
    const page = await pageFor('dark', 320, 'reduce', 'rgb(255, 0, 0)')
    try {
      const before = await page.locator('.heartbeat-trace').boundingBox()
      expect(before?.width).toBeGreaterThan(0)
      expect(before?.x + before?.width).toBeLessThanOrEqual(320)
      const original = await page.locator('.heartbeat-trace').screenshot()
      await page.clock.runFor(6000)
      expect(await page.locator('.heartbeat-trace').boundingBox()).toEqual(before)
      expect(await page.locator('.heartbeat-trace').screenshot()).toEqual(original)
      const beam = await stylesOf(page, '.heartbeat-trace')
      const progress = await page
        .locator('.heartbeat-trace')
        .evaluate((el) => globalThis.getComputedStyle(el).getPropertyValue('--ms-progress').trim())
      expect(progress).not.toBe('')
      expect(beam.color).not.toBe(await styleValue(page, 'body', 'color'))
      const painted = await page.locator('.heartbeat-trace').evaluate((el) => {
        const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i + 3] > 0) return [pixels[i], pixels[i + 1], pixels[i + 2]]
        return []
      })
      expect(painted).toEqual([255, 0, 0])
    } finally {
      await page.close()
    }
  })

  it('guards meaningful motion and never animates streamed text or decorative status dots', async () => {
    const page = await pageFor('dark', 320, 'no-preference')
    try {
      const source = await readFile(
        new URL('../../src/webview/styles.css', import.meta.url),
        'utf8',
      )
      expect(source).toMatch(
        /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.chevron\s*\{\s*transition: transform var\(--ms-motion-fast\)/,
      )
      await page
        .locator('.tool-chevron')
        .evaluate((el) => (el.innerHTML = '<span class="chevron">›</span>'))
      expect(await styleValue(page, '.chevron', 'transitionDuration')).toBe('0.12s')
      for (const c of ['cursor', 'tool-dot-running', 'mic-listening', 'status-mark-circle']) {
        expect(await styleValue(page, `.${c}`, 'animationName'), c).toBe('none')
      }
      await page.emulateMedia({ reducedMotion: 'reduce' })
      for (const c of ['chevron', 'jump-latest', 'chip-remove', 'code-block-button', 'todo-open']) {
        expect(await styleValue(page, `.${c}`, 'transitionDuration'), c).toBe('0s')
      }
    } finally {
      await page.close()
    }
  })

  it('leaves ring space inside the dock and clipped code output and rounds the diff wrapper', async () => {
    const page = await pageFor('dark')
    try {
      const dock = await page.locator('.approval-dock').evaluate((el) => {
        const s = globalThis.getComputedStyle(el)
        return { padding: s.paddingBottom, scrollPadding: s.scrollPaddingBottom }
      })
      expect(dock).toEqual({ padding: '4px', scrollPadding: '4px' })
      await page.locator('.code-block-body').focus()
      expect(await styleValue(page, '.code-block-body', 'outlineOffset')).toBe('-2px')
      const source = await readFile(
        new URL('../../src/webview/styles.css', import.meta.url),
        'utf8',
      )
      expect(source).toMatch(/\.diff-clip\s*\{[^}]*border-radius: var\(--ms-radius-md\)/)
      expect(source).not.toMatch(/\.(?:monaco-|quick-input-|notifications-|workbench)/)
    } finally {
      await page.close()
    }
  })
})
