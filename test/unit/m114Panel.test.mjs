import { readFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { contrastRatio } from '../../scripts/check-tokens.mjs'

const themes = ['light', 'dark', 'hc-dark', 'hc-light', 'one-dark-pro', 'dracula']
const cssFiles = ['src/webview/styles.css', 'src/webview/whatsNew/whatsNew.css']
const runtime = {}
const fixture = [
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {SecretPromptDialog} from './src/webview/components/SecretPromptDialog';",
  "import {ApprovalCard} from './src/webview/components/ApprovalCard';",
  "const labels = ['Allow once', 'Always allow this very long command in this workspace', 'Reject with feedback'];",
  "const approval = {approvalId:'test',requirementId:{approvalId:'test',sourceIndex:0},",
  " subject:{kind:'shell',command:'npm run build'},rawArgs:'{}',isProtectedWrite:false,isJudgeEscalated:false,",
  " availableChoices:labels.map((label,i)=>({choiceId:String(i),label,decision:i===2?'abort':'approved',scope:'once',acceptsFeedback:i===2}))};",
  'createRoot(globalThis.document.getElementById(\'actual\')).render(<><ApprovalCard approval={approval} toolName="shell" onDecide={()=>{}}/><SecretPromptDialog redactedText="[redacted]" onEdit={()=>{}} onSendAnyway={()=>{}}/></>);',
].join('\n')
const markup = `<main>
<div id="actual"></div>
<div class="modal"><header class="modal-header"><button class="icon-button">Close</button></header><div class="modal-body">
<button class="button-primary">Primary</button><button class="button-secondary">Secondary</button>
<button class="usage-link">Account action</button><button class="agent-node agent-node-clickable">Agent</button>
<div class="usage-toggle"><button class="usage-toggle-on">Tokens</button></div>
<input class="palette-filter" placeholder="Filter"><textarea class="report-description question-input" placeholder="Describe"></textarea>
<input class="bestofn-number"><select class="bestofn-selects"><option>Model</option></select>
</div></div>
<div class="palette"><ul class="palette-body"><li class="palette-item palette-item-active"><span class="palette-item-detail">Selected</span></li></ul></div>
<div class="popover"><ul class="popover-list" tabindex="0"><li class="menu-item" tabindex="0"><span class="menu-item-detail">Option</span></li></ul></div>
<div class="mention-menu"><ul><li class="menu-item menu-item-active">Mention</li></ul></div>
<div class="question"><button class="question-tab" aria-selected="true">Question</button><input class="question-input"></div>
<div class="todo-surface"><header class="todo-tab-header"><h1>Tasks</h1><button class="todo-window">Move</button></header></div>
<button class="gooey-menu-pill"><span class="gooey-menu-pill-icon">C</span><span class="gooey-menu-pill-label">Copy</span></button>
<span class="toggle-knob"></span><span class="agent-dot agent-dot-running"></span>
</main>`

beforeAll(async () => {
  runtime.css = []
  for (const entry of cssFiles) {
    const result = await build({ entryPoints: [entry], bundle: true, write: false })
    runtime.css.push(result.outputFiles[0].text)
  }
  const js = await build({
    stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true,
    write: false,
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  runtime.js = js.outputFiles[0].text
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome is required for panel polish verification')
  runtime.browser = await chromium.launch(
    path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' },
  )
})
afterAll(async () => {
  await runtime.browser?.close()
})

async function open(theme, width = 320, isWhatsNew = false, motion = 'reduce') {
  const page = await runtime.browser.newPage({
    viewport: { width, height: 760 },
    reducedMotion: motion,
  })
  await page.route('**/*', (route) => route.abort())
  await page.setContent(
    `<style>${runtime.css[isWhatsNew ? 1 : 0]}</style>${isWhatsNew ? '<main><h1>What’s New</h1><h2>Release</h2><pre tabindex="0"><code>const x = 1;</code></pre><button>Try it</button><a href="#">Reference</a><label><input type="checkbox">Show on update</label></main>' : markup}`,
  )
  const host = JSON.parse(readFileSync(`test/harness/themes/${theme}.json`, 'utf8'))
  await page.evaluate((host) => {
    const root = globalThis.document.documentElement
    for (const [key, value] of Object.entries(host.variables)) root.style.setProperty(key, value)
    for (const key of host.unset) if (!key.includes('font')) root.style.setProperty(key, 'initial')
    root.style.setProperty('--vscode-font-family', 'sans-serif')
    root.style.setProperty('--vscode-editor-font-family', 'monospace')
    root.style.setProperty('--vscode-font-size', '13px')
    root.style.setProperty('--vscode-editor-font-size', '13px')
    globalThis.document.body.className = host.bodyClass
  }, host)
  if (!isWhatsNew) {
    await page.addScriptTag({ content: runtime.js })
    await page.waitForSelector('.approval', { state: 'attached' })
  }
  return page
}
const style = (page, selector, pseudo) =>
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
          'borderRadius',
          'boxShadow',
          'filter',
          'backdropFilter',
          'outlineWidth',
          'outlineColor',
          'outlineOffset',
          'opacity',
          'fontFamily',
          'fontSize',
          'animationName',
          'animationDuration',
          'transitionDuration',
          'padding',
          'scrollPadding',
          'minHeight',
        ].map((key) => [key, s[key]]),
      )
    }, pseudo)
const parseColour = (value) => {
  const [r, g, b, alpha = 1] = value.match(/[\d.]+/g).map(Number)
  return { colorSpace: 'srgb', components: [r / 255, g / 255, b / 255], alpha }
}
function contrast(fg, bg, canvas) {
  return contrastRatio(parseColour(fg), parseColour(bg), canvas && parseColour(canvas))
}
async function property(page, selector, key) {
  const values = await style(page, selector)
  return values[key]
}
async function force(page, selector, states) {
  const session = await page.context().newCDPSession(page)
  await session.send('DOM.enable')
  await session.send('CSS.enable')
  const tree = await session.send('DOM.getDocument')
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: tree.root.nodeId,
    selector,
  })
  await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
  return session
}

describe('M114 P2 panel contract', () => {
  it.each(themes.flatMap((theme) => [320, 690].map((width) => ({ theme, width }))))(
    '$theme/$width: equal approval decisions stay on one row with complete labels',
    async ({ theme, width }) => {
      const page = await open(theme, width)
      try {
        const buttons = page.locator('.approval-choices > button')
        expect(await buttons.count()).toBe(3)
        const boxes = await buttons.evaluateAll((buttons) =>
          buttons.map((button) => {
            const box = button.getBoundingClientRect()
            const s = globalThis.getComputedStyle(button)
            return {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              color: s.color,
              background: s.backgroundColor,
              radius: s.borderRadius,
            }
          }),
        )
        for (const box of boxes) {
          expect(box.y).toBe(boxes[0].y)
          expect(box.width).toBeCloseTo(boxes[0].width, 1)
          expect(box.height).toBe(28)
          expect(box.x + box.width).toBeLessThanOrEqual(width)
          expect(box.color).toBe(boxes[0].color)
          expect(box.background).toBe(boxes[0].background)
          expect(contrast(box.color, box.background)).toBeGreaterThanOrEqual(4.5)
        }
        expect(await buttons.nth(1).textContent()).toContain('Always allow this very long command')
        expect(await buttons.nth(1).getAttribute('title')).toContain(
          'Always allow this very long command',
        )
      } finally {
        await page.close()
      }
    },
  )

  it.each(themes)(
    '%s: secret-prompt decisions keep equal size and emphasis at 320 px',
    async (theme) => {
      const page = await open(theme)
      try {
        const decisions = await page
          .locator('#actual .modal .question-actions > button')
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const box = button.getBoundingClientRect()
              const s = globalThis.getComputedStyle(button)
              return {
                y: box.y,
                width: box.width,
                height: box.height,
                color: s.color,
                background: s.backgroundColor,
              }
            }),
          )
        expect(decisions.length).toBe(2)
        expect(decisions[0]).toEqual(decisions[1])
        expect(decisions[0].height).toBe(28)
      } finally {
        await page.close()
      }
    },
  )

  it.each(themes)(
    '%s: panel controls have readable hover, pressed, disabled and keyboard states',
    async (theme) => {
      const page = await open(theme)
      try {
        const canvas = await property(page, '.modal', 'backgroundColor')
        // One protocol session avoids repeated domain/document setup per state.
        const session = await page.context().newCDPSession(page)
        await session.send('DOM.enable')
        await session.send('CSS.enable')
        const tree = await session.send('DOM.getDocument')
        for (const selector of [
          '.modal .icon-button',
          '.modal .button-primary',
          '.modal .button-secondary',
          '.usage-link',
          '.agent-node',
          '.todo-window',
          '.question-tab',
          '.gooey-menu-pill',
        ]) {
          await page.locator(selector).first().focus()
          const focused = await style(page, selector)
          expect(focused.outlineWidth, selector).toBe('2px')
          expect(focused.outlineOffset, selector).toBe('2px')
          expect(contrast(focused.outlineColor, canvas), selector).toBeGreaterThanOrEqual(3)
          const { nodeId } = await session.send('DOM.querySelector', {
            nodeId: tree.root.nodeId,
            selector,
          })
          await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] })
          const hover = await style(page, selector)
          expect(
            contrast(hover.color, hover.backgroundColor, canvas),
            selector,
          ).toBeGreaterThanOrEqual(4.5)
          await session.send('CSS.forcePseudoState', {
            nodeId,
            forcedPseudoClasses: ['hover', 'active'],
          })
          const pressed = await style(page, selector)
          expect(pressed.backgroundColor, selector).not.toBe('rgba(0, 0, 0, 0)')
          expect(contrast(pressed.color, pressed.backgroundColor), selector).toBeGreaterThanOrEqual(
            4.5,
          )
          if (selector !== '.gooey-menu-pill') {
            await page
              .locator(selector)
              .first()
              .evaluate((el) => {
                el.disabled = true
              })
            const disabled = await style(page, selector)
            expect(disabled.color, selector).not.toBe(pressed.color)
            expect(disabled.opacity, selector).toBe('1')
          }
          await session.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] })
        }
        await session.detach()
        for (const selector of ['.palette-filter', '.report-description']) {
          await page.locator(selector).first().focus()
          const input = await style(page, selector)
          const placeholder = await style(page, selector, '::placeholder')
          expect(input.outlineWidth).toBe('2px')
          expect(
            contrast(input.borderColor, input.backgroundColor),
            selector,
          ).toBeGreaterThanOrEqual(3)
          expect(contrast(placeholder.color, input.backgroundColor)).toBeGreaterThanOrEqual(4.5)
          expect(placeholder.opacity).toBe('1')
        }
        for (const selector of ['.palette-item-active', '.menu-item-active', '.usage-toggle-on']) {
          const s = await style(page, selector)
          expect(contrast(s.color, s.backgroundColor)).toBeGreaterThanOrEqual(4.5)
        }
      } finally {
        await page.close()
      }
    },
  )

  it.each(themes)(
    '%s: overlays and menus use token elevation while every pill stays crisp',
    async (theme) => {
      const page = await open(theme)
      try {
        for (const selector of ['.modal', '.popover', '.palette', '.mention-menu']) {
          const s = await style(page, selector)
          expect(s.borderRadius, selector).toBe(selector === '.modal' ? '12px' : '6px')
          expect(s.boxShadow === 'none', selector).toBe(theme.startsWith('hc-'))
        }
        const pill = await style(page, '.gooey-menu-pill')
        expect(pill).toMatchObject({
          filter: 'none',
          backdropFilter: 'none',
          boxShadow: 'none',
          opacity: '1',
          borderRadius: '999px',
        })
        const agent = await style(page, '.agent-dot-running')
        expect(agent.animationName).toBe('none')
      } finally {
        await page.close()
      }
    },
  )

  it('declares meaningful motion only within the preference guard and leaves host chrome alone', () => {
    const declarations = []
    for (const file of cssFiles) {
      const source = readFileSync(file, 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '')
      expect(source).not.toMatch(/\.(?:monaco-|quick-input-|notifications-|workbench)/)
      const tokens = source.match(/[{}]|[^{}]+/g) ?? []
      const blocks = []
      for (const [index, token] of tokens.entries()) {
        if (token === '{') blocks.push(tokens[index - 1]?.trim())
        else if (token === '}') blocks.pop()
        else {
          for (const match of token.matchAll(
            /\b(?:animation|transition)(?:-[a-z]+)?:\s*([^;]+);/g,
          )) {
            if (match[1].trim() === 'none') continue
            declarations.push(match[0])
            expect(blocks, `${file}: ${match[0]}`).toContain(
              '@media (prefers-reduced-motion: no-preference)',
            )
          }
        }
      }
      expect(blocks).toEqual([])
    }
    expect(declarations.length).toBeGreaterThan(0)
  })

  it('guards opening and toggle motion and stops all frames under reduced motion', async () => {
    const page = await open('dark', 320, false, 'no-preference')
    try {
      expect(await property(page, '.gooey-menu-pill', 'animationDuration')).toBe('0.18s')
      expect(await property(page, '.modal', 'animationDuration')).toBe('0.18s')
      expect(await property(page, '.toggle-knob', 'transitionDuration')).toBe('0.12s')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      expect(await property(page, '.gooey-menu-pill', 'animationName')).toBe('none')
      expect(await property(page, '.modal', 'animationName')).toBe('none')
      expect(await property(page, '.toggle-knob', 'transitionDuration')).toBe('0s')
      const before = await page.screenshot()
      await page.waitForTimeout(240)
      expect(await page.screenshot()).toEqual(before)
    } finally {
      await page.close()
    }
  })

  it.each(themes)(
    '%s: What’s New follows editor fonts and exposes complete button/link states',
    async (theme) => {
      const page = await open(theme, 320, true)
      try {
        expect(await property(page, 'body', 'fontFamily')).toBe('sans-serif')
        expect(await property(page, 'code', 'fontFamily')).toBe('monospace')
        const canvas = await property(page, 'body', 'backgroundColor')
        for (const selector of ['button', 'a', 'input', 'pre']) {
          await page.locator(selector).first().focus()
          const s = await style(page, selector)
          expect(s.outlineWidth).toBe('2px')
          expect(contrast(s.outlineColor, canvas)).toBeGreaterThanOrEqual(3)
        }
        const session = await force(page, 'button', ['hover', 'active'])
        const pressed = await style(page, 'button')
        expect(contrast(pressed.color, pressed.backgroundColor)).toBeGreaterThanOrEqual(4.5)
        await page.locator('button').evaluate((el) => {
          el.disabled = true
        })
        expect(await property(page, 'button', 'color')).not.toBe(pressed.color)
        await session.detach()
      } finally {
        await page.close()
      }
    },
  )
})
