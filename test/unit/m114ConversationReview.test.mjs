import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contrastRatio } from '../../scripts/check-tokens.mjs'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
import { compactBrowserEnglish } from '../../scripts/lib/uiTextRegions.mjs'
import { webviewStartupOutputs } from '../../scripts/lib/webviewBundles.mjs'

const themes = ['light', 'dark', 'hc-dark', 'hc-light', 'one-dark-pro', 'dracula']
const auditThemes = themes.slice(0, 4)
const runtime = {}
const fixtureSource = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {TodoPanel} from './src/webview/components/TodoPanel';
import {ContextMeter} from './src/webview/components/ContextMeter';
import {Transcript} from './src/webview/components/Transcript';
import {SendIcon, ExpandChevron, PlusIcon} from './src/webview/components/icons';
const noop = () => {};
createRoot(document.getElementById('root')).render(<>
  <button className="send-button chat-control" aria-label="Send"><SendIcon/></button>
  <button className="jump-latest chat-control"><ExpandChevron isOpen/>Jump to latest</button>
  <button className="icon-button chat-control" aria-label="Add"><PlusIcon/></button>
  <TodoPanel items={[{text:'Check contrast\n',status:'inProgress'},{text:'Checked',status:'completed'}]}/>
  <ContextMeter context={{usedTokens:25,windowTokens:100,pressure:'normal'}} onCompact={noop}/>
  <Transcript entries={[{kind:'assistant',id:'hook',text:'Original reply',displayText:'Edited reply',isStreaming:false}]}
    isRunning={false} isFocusView={false} outputPages={{}} toolImages={{}} showReplyUsage={false}
    onReadImage={noop} onOpenLink={noop} onCopy={noop} onReadOutput={noop} onOpenOutput={noop}
    onAnswer={noop} onCancelQuestion={noop} onMoveToBackground={noop} onStopTask={noop}
    canStopUserShell={false} onOpenEditDiff={noop} onOpenFile={noop}/>
</>);`
const buildOptions = {
  entryPoints: ['src/webview/main.tsx'],
  outdir: 'dist/webview',
  bundle: true,
  minify: true,
  metafile: true,
  write: false,
  charset: 'utf8',
  platform: 'browser',
  format: 'esm',
  splitting: true,
  chunkNames: 'chunks/[hash]',
  target: 'chrome128',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
}

beforeAll(async () => {
  const bundle = await build({ ...buildOptions, plugins: [compactBrowserEnglish] })
  runtime.outputs = new Map(
    bundle.outputFiles.map((file) => [
      `/${path.relative(process.cwd(), file.path).replaceAll('\\', '/')}`,
      file.text,
    ]),
  )
  runtime.css = runtime.outputs.get('/dist/webview/main.css')
  const fixture = await build({
    stdin: { contents: fixtureSource, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true,
    platform: 'browser',
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  runtime.fixture = fixture.outputFiles[0].text
  runtime.axe = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
  runtime.themes = new Map(
    await Promise.all(
      themes.map(async (theme) => [
        theme,
        JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8')),
      ]),
    ),
  )
  const chrome = findChrome()
  if (chrome === undefined) throw new Error('Chrome is required for the review regressions')
  runtime.browser = await chromium.launch({
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
  })
  Object.assign(runtime, await serveRepo(process.cwd()))
})

afterAll(async () => {
  await runtime.browser?.close()
  if (runtime.server !== undefined)
    await new Promise((resolve, reject) =>
      runtime.server.close((error) => (error ? reject(error) : resolve())),
    )
})

async function pageFor(theme, scene) {
  const page = await runtime.browser.newPage({
    viewport: { width: 320, height: 760 },
    reducedMotion: 'reduce',
  })
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    const output = runtime.outputs.get(url.pathname)
    if (output !== undefined)
      return route.fulfill({
        body: output,
        contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
      })
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  await page.clock.install({ time: new Date('2026-10-06T12:00:00Z') })
  if (scene === undefined)
    await page.setContent(
      `<!doctype html><html lang="en"><title>Review fixture</title><style>${runtime.css}</style><main id="root"></main></html>`,
    )
  else
    await page.goto(
      `http://127.0.0.1:${runtime.port}/test/harness/index.html?scenario=${scene}&theme=${theme}`,
    )
  await page.evaluate((fixture) => {
    for (const [name, value] of Object.entries(fixture.variables))
      globalThis.document.documentElement.style.setProperty(name, value)
    for (const name of fixture.unset)
      if (!name.includes('font'))
        globalThis.document.documentElement.style.setProperty(name, 'initial')
    globalThis.document.documentElement.style.setProperty('--vscode-font-family', 'sans-serif')
    globalThis.document.documentElement.style.setProperty('--vscode-font-size', '13px')
    globalThis.document.body.className = fixture.bodyClass
  }, runtime.themes.get(theme))
  if (scene === undefined) await page.addScriptTag({ content: runtime.fixture })
  await page.clock.runFor(6500)
  return page
}

async function styles(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const style = globalThis.getComputedStyle(el)
      return Object.fromEntries(
        [
          'color',
          'backgroundColor',
          'stroke',
          'boxShadow',
          'outlineWidth',
          'outlineStyle',
          'outlineColor',
          'outlineOffset',
          'borderColor',
          'textDecorationLine',
        ].map((key) => [key, style[key]]),
      )
    })
}

async function forceState(page, selector, states) {
  const session = await page.context().newCDPSession(page)
  const { root } = await session.send('DOM.getDocument')
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  await session.send('CSS.enable')
  await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
  return { session, nodeId }
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

describe('RVM114P1 review regressions', () => {
  it.each(auditThemes)(
    '%s: pressed task and context retain nested roles with axe contrast',
    async (theme) => {
      const page = await pageFor(theme)
      try {
        const progress = await styles(page, '.todo-progress')
        const arc = await styles(page, '.context-meter-arc')
        for (const selector of ['.todo-title', '.context-meter'])
          await forceState(page, selector, ['hover', 'active'])
        const pressedTitle = await styles(page, '.todo-title')
        const pressedProgress = await styles(page, '.todo-progress')
        const pressedArc = await styles(page, '.context-meter-arc')
        const todo = await styles(page, '.todo')
        const ring = await styles(page, '.context-meter-ring')
        expect(pressedTitle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(pressedProgress.color).toBe(progress.color)
        expect(pressedArc.stroke).toBe(arc.stroke)
        expect(ratio(progress.color, todo.backgroundColor)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(arc.stroke, ring.backgroundColor)).toBeGreaterThanOrEqual(3)
        await page.addScriptTag({ content: runtime.axe })
        const violations = await page.evaluate(async () => {
          const result = await globalThis.axe.run(
            { include: ['.todo', '.context-meter'] },
            { runOnly: ['color-contrast'], resultTypes: ['violations'] },
          )
          return result.violations
        })
        expect(violations).toEqual([])
      } finally {
        await page.close()
      }
    },
  )

  it.each(themes)('%s: Send, Jump and icons distinguish idle, hover and pressed', async (theme) => {
    const page = await pageFor(theme)
    try {
      for (const selector of ['.send-button', '.jump-latest', '.icon-button']) {
        const idle = await styles(page, selector)
        const forced = await forceState(page, selector, ['hover'])
        const hovered = await styles(page, selector)
        expect(hovered, selector).not.toEqual(idle)
        await forced.session.send('CSS.forcePseudoState', {
          nodeId: forced.nodeId,
          forcedPseudoClasses: ['hover', 'active'],
        })
        const pressed = await styles(page, selector)
        expect(pressed, selector).not.toEqual(hovered)
        expect(pressed.boxShadow, selector).not.toBe(hovered.boxShadow)
        if (theme.startsWith('hc-')) {
          expect(hovered.outlineWidth, selector).toBe('1px')
          expect(hovered.outlineStyle, selector).toBe('solid')
        }
        await forced.session.detach()
      }
    } finally {
      await page.close()
    }
  })

  it.each(themes)('%s: real hook rewrite toggle uses the shared keyboard ring', async (theme) => {
    const page = await pageFor(theme)
    try {
      const button = page.locator('.hook-edited button')
      await button.focus()
      expect(await button.getAttribute('class')).toContain('chat-control')
      const original = await styles(page, '.hook-edited button')
      expect(original.outlineWidth).toBe('2px')
      expect(original.outlineOffset).toBe('2px')
      const body = await styles(page, 'body')
      expect(ratio(original.outlineColor, body.backgroundColor)).toBeGreaterThanOrEqual(3)
      await button.click()
      await page.keyboard.press('Tab')
      await button.focus()
      const edited = await styles(page, '.hook-edited button')
      for (const key of ['outlineWidth', 'outlineOffset', 'outlineColor'])
        expect(edited[key], key).toBe(original[key])
    } finally {
      await page.close()
    }
  })

  it.each(themes)(
    '%s: actual attachment, tool and steps targets are at least 24 by 24 at 320 px',
    async (theme) => {
      for (const [scene, selectors] of [
        ['chips', ['.chip-remove']],
        ['tools-open', ['.tool-toggle', '.tool-path', '.tool-chevron']],
        ['approval-several', ['.steps-toggle']],
      ]) {
        const page = await pageFor(theme, scene)
        try {
          for (const selector of selectors) {
            const targets = page.locator(`${selector}:visible`)
            expect(await targets.count(), selector).toBeGreaterThan(0)
            const visibleTargets = await targets.all()
            for (const target of visibleTargets) {
              const box = await target.boundingBox()
              expect(box.width, `${scene} ${selector}`).toBeGreaterThanOrEqual(24)
              expect(box.height, `${scene} ${selector}`).toBeGreaterThanOrEqual(24)
            }
          }
        } finally {
          await page.close()
        }
      }
    },
  )

  it('certifies reviewed growth using every eager JavaScript chunk and CSS', async () => {
    const receipt = JSON.parse(
      await readFile('docs/certification/m114-p1-after/startup.json', 'utf8'),
    )
    expect(receipt.kind).toBe('measured-production-startup-graphs')
    const measurements = [receipt.base, receipt.reviewed].map((meta) => {
      const eager = webviewStartupOutputs(meta).filter((file) => file.endsWith('.js'))
      expect(eager.length).toBeGreaterThan(1)
      return {
        javascript: eager.reduce((bytes, file) => bytes + meta.outputs[file].bytes, 0),
        css: meta.outputs['dist/webview/main.css'].bytes,
        main: meta.outputs['dist/webview/main.js'].bytes,
      }
    })
    const [base, reviewed] = measurements
    expect(base.javascript).toBe(811_285)
    expect(reviewed.javascript).toBe(811_839)
    const growth = reviewed.javascript - base.javascript + reviewed.css - base.css
    expect(growth).toBe(7185)
    expect(growth).toBeGreaterThan(reviewed.main - base.main + reviewed.css - base.css)
    const record = await readFile('docs/certification/m114-p1.md', 'utf8')
    expect(record).toContain('**811,285 → 811,839 bytes (+554)**')
    expect(record).toContain('**7,185-byte (7.02 KiB) combined growth')
  })
})
