import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { contrastRatio } from '../../scripts/check-tokens.mjs'
import { PRODUCTION_BUILD_KEY } from './helpers/productionPackage'
import { REVIEW_BROWSER_KEY } from './helpers/reviewBrowser.mjs'
import { waitForDeferredPaint } from '../harness/goldens/capture.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'
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
  <button className="send-button send-button-stop chat-control" aria-label="Stop"><SendIcon/></button>
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
beforeAll(async () => {
  const shared = inject(PRODUCTION_BUILD_KEY)
  const browserFiles = await readdir(path.join(shared, 'dist/webview'), { recursive: true })
  runtime.outputs = new Map(
    await Promise.all(
      browserFiles
        .filter((file) => /\.(?:js|css)$/.test(file))
        .map(async (file) => [
          `/dist/webview/${file.replaceAll('\\', '/')}`,
          await readFile(path.join(shared, 'dist/webview', file), 'utf8'),
        ]),
    ),
  )
  runtime.css = runtime.outputs.get('/dist/webview/main.css')
  const fixture = await build({
    stdin: { contents: fixtureSource, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true,
    platform: 'browser',
    write: false,
    jsx: 'automatic',
    // Every fixture page parses this script: unminified (2.4 MB) it took
    // ~650 ms a page here, most of each fixture case.
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  runtime.fixture = fixture.outputFiles[0].text
  runtime.axe = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
  runtime.harness = await readFile('test/harness/index.html', 'utf8')
  runtime.themes = new Map(
    await Promise.all(
      themes.map(async (theme) => [
        theme,
        JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8')),
      ]),
    ),
  )
  runtime.browser = await chromium.connect(inject(REVIEW_BROWSER_KEY))
  Object.assign(runtime, await serveRepo(process.cwd()))
})

afterAll(async () => {
  await runtime.browser?.close()
  if (runtime.server !== undefined)
    await new Promise((resolve, reject) =>
      runtime.server.close((error) => (error ? reject(error) : resolve())),
    )
})

async function pageFor(theme, scene, forcedColors = 'none') {
  const page = await runtime.browser.newPage({
    viewport: { width: 320, height: 760 },
    reducedMotion: 'reduce',
  })
  try {
    await page.emulateMedia({
      forcedColors,
      ...(forcedColors === 'active' && {
        colorScheme: theme.includes('light') ? 'light' : 'dark',
      }),
    })
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (scene === 'jump' && url.pathname === '/test/harness/index.html')
        return route.fulfill({
          // Bound the fake host's markdown volume; retain its real scroll and
          // captured events so Jump settles inside the repository's test deadline.
          body: runtime.harness.replace('.repeat(120)', '.repeat(4)'),
          contentType: 'text/html',
        })
      const output = runtime.outputs.get(url.pathname)
      if (output !== undefined)
        return route.fulfill({
          body: output,
          contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        })
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
    })
    if (scene !== 'jump') {
      const time = new Date('2026-10-06T12:00:00Z')
      await page.clock.install({ time })
      // Async chunk I/O continues, but scenario timers cannot replace a
      // measured control between CDP pseudo-state changes and screenshots.
      if (scene !== undefined) await page.clock.pauseAt(new Date(time.getTime() + 60_000))
    }
    if (scene === undefined)
      await page.setContent(
        `<!doctype html><html lang="en"><title>Review fixture</title><style>${runtime.css}</style><main id="root"></main></html>`,
      )
    else
      await page.goto(
        `http://127.0.0.1:${runtime.port}/test/harness/index.html?scenario=${scene}&theme=${theme}`,
      )
    await page.evaluate((fixture) => {
      globalThis.document.documentElement.style.width = '320px'
      globalThis.document.body.style.width = '320px'
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
    if (scene === 'jump') {
      await page
        .getByText('One more thing: the folder also holds a hidden .git directory.', {
          exact: true,
        })
        .waitFor({ state: 'attached' })
      await page.locator('main').evaluate((el) => {
        el.scrollTop = 0
        el.dispatchEvent(new globalThis.Event('scroll'))
      })
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
          ),
      )
      await page.evaluate(() =>
        globalThis.postMessage(
          {
            type: 'agentEvent',
            event: { type: 'textDelta', itemId: 'more', field: 'text', delta: ' More details.' },
          },
          '*',
        ),
      )
    } else {
      if (scene !== undefined)
        await page
          .locator('textarea, .gate, .todo-surface, .schedule-v2-surface, [role="alert"]')
          .first()
          .waitFor({ state: 'attached' })
      if (scene === undefined) {
        // The direct component fixture has no fake-host scenario timers.
        await page.locator('.hook-edited button').waitFor({ state: 'attached' })
        await page.clock.runFor(100)
      } else {
        await page.clock.runFor(6500)
        await waitForDeferredPaint(page, scene)
      }
    }
    return page
  } catch (error) {
    await page.close()
    throw error
  }
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

async function forcedColorStates(page, selector) {
  const target = page.locator(selector).first()
  if (selector !== '.jump-latest') await target.scrollIntoViewIfNeeded()
  await target.evaluate((el) => el.blur())
  const idle = await styles(page, selector)
  const forced = await forceState(page, selector, ['hover'])
  try {
    const highlight = await page.evaluate(() => {
      const probe = globalThis.document.createElement('span')
      probe.style.color = 'Highlight'
      globalThis.document.body.append(probe)
      const color = globalThis.getComputedStyle(probe).color
      probe.remove()
      return color
    })
    const hovered = await styles(page, selector)
    expect(hovered, selector).not.toEqual(idle)
    expect(hovered.outlineWidth, selector).toBe('1px')
    expect(hovered.outlineStyle, selector).toBe('solid')
    expect(hovered.outlineColor, selector).toBe(highlight)
    expect(hovered.outlineOffset, selector).toBe('2px')
    const box = await target.boundingBox()
    const clip = {
      x: Math.max(0, box.x - 6),
      y: Math.max(0, box.y - 6),
      width: Math.min(320, box.x + box.width + 6) - Math.max(0, box.x - 6),
      height: Math.min(760, box.y + box.height + 6) - Math.max(0, box.y - 6),
    }
    // Flush the frozen clock's paint callbacks before asking the compositor
    // for pixels. Computed style alone does not prove a frame has painted.
    await page.clock.runFor(100)
    const hoverImage = await page.screenshot({ clip, animations: 'disabled' })
    await forced.session.send('CSS.forcePseudoState', {
      nodeId: forced.nodeId,
      forcedPseudoClasses: ['hover', 'active'],
    })
    const pressed = await styles(page, selector)
    expect(pressed.boxShadow, selector).toBe('none')
    expect(pressed.outlineWidth, selector).toBe('2px')
    expect(pressed.outlineStyle, selector).toBe('solid')
    expect(pressed.outlineColor, selector).toBe(highlight)
    expect(pressed.outlineOffset, selector).toBe('0px')
    await page.clock.runFor(100)
    const pressedImage = await page.screenshot({ clip, animations: 'disabled' })
    expect(pressedImage.equals(hoverImage), selector).toBe(false)
    for (const states of [
      ['hover', 'focus-visible'],
      ['hover', 'focus-visible', 'active'],
    ]) {
      await forced.session.send('CSS.forcePseudoState', {
        nodeId: forced.nodeId,
        forcedPseudoClasses: states,
      })
      const focused = await styles(page, selector)
      expect(focused.outlineWidth, selector).toBe('2px')
      expect(focused.outlineColor, selector).toBe(highlight)
      expect(focused.outlineOffset, selector).toBe(states.includes('active') ? '0px' : '2px')
    }
    for (const disabled of ['native', 'aria']) {
      await target.evaluate((el, disabled) => {
        el.disabled = disabled === 'native'
        if (disabled === 'aria') el.setAttribute('aria-disabled', 'true')
      }, disabled)
      await forced.session.send('CSS.forcePseudoState', {
        nodeId: forced.nodeId,
        forcedPseudoClasses: [],
      })
      const disabledIdle = await styles(page, selector)
      await forced.session.send('CSS.forcePseudoState', {
        nodeId: forced.nodeId,
        forcedPseudoClasses: ['hover', 'active'],
      })
      const disabledPressed = await styles(page, selector)
      for (const key of ['outlineWidth', 'outlineStyle', 'outlineColor', 'outlineOffset'])
        expect(disabledPressed[key], `${selector} ${disabled} ${key}`).toBe(disabledIdle[key])
    }
  } finally {
    await target.evaluate((el) => {
      el.disabled = false
      el.removeAttribute('aria-disabled')
    })
    await forced.session.send('CSS.forcePseudoState', {
      nodeId: forced.nodeId,
      forcedPseudoClasses: [],
    })
    await forced.session.detach()
  }
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

  // One control per case, like the scene cases below: seven controls' states
  // and screenshots in one case took 2.8-4.7 s of its 5 s on hosted runners
  // (CIFIX017R3). Every theme, control and assertion remains.
  it.each(
    themes.flatMap((theme) =>
      [
        '.send-button:not(.send-button-stop)',
        '.send-button-stop',
        '.jump-latest',
        '.icon-button',
        '.todo-title',
        '.context-meter',
        '.hook-edited button',
      ].map((selector) => ({ theme, selector })),
    ),
  )(
    '$theme $selector: forced colors keep fixture hover and pressed visibly distinct',
    async ({ theme, selector }) => {
      const page = await pageFor(theme, undefined, 'active')
      try {
        expect(
          await page.evaluate(() => globalThis.matchMedia('(forced-colors: active)').matches),
        ).toBe(true)
        await forcedColorStates(page, selector)
      } finally {
        await page.close()
      }
    },
  )

  it.each(
    themes.flatMap((theme) =>
      [
        ['todo', '.todo-title'],
        ['context-meter', '.context-meter'],
        ['context-meter-warning', '.context-meter'],
        ['context-meter-full', '.context-meter'],
        ['jump', '.jump-latest'],
        ['stop-running', '.send-button-stop'],
        ['transcript', '.send-button'],
        ['chips', '.chip-remove'],
        ['tools-open', '.tool-toggle'],
        ['approval-several', '.steps-toggle'],
      ].map(([scene, selector]) => ({ theme, scene, selector })),
    ),
  )(
    '$theme $scene: actual control retains forced-color pressed feedback at 320 px',
    async ({ theme, scene, selector }) => {
      const page = await pageFor(theme, scene, 'active')
      try {
        if (scene === 'transcript') await page.locator('.composer-input').fill('Ready to send')
        const controls =
          scene === 'transcript' ? [selector, '.composer-toolbar .icon-button'] : [selector]
        for (const control of controls) await forcedColorStates(page, control)
      } finally {
        await page.close()
      }
    },
  )

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
            // Folded tool rows render from a lazy chunk once the steps open
            // (2ae80ffb9); wait for the first, never count a half-loaded scene.
            await targets.first().waitFor({ state: 'visible' })
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
