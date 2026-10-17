// The real usage stylesheet: button text plus SVG non-text boundaries/cues.
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'

const stylesheet = await readFile('src/webview/usage/usage.css', 'utf8')
const engine = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
const executablePath = findChrome()
if (executablePath === undefined) throw new Error('Chrome is required for usage contrast')
const browser = await chromium.launch({ executablePath, headless: true })
const failedThemes = []
const colours = ['blue', 'purple', 'orange', 'green', 'yellow', 'red', 'other']
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    const capture = JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8'))
    const page = await browser.newPage()
    try {
      await page.setContent(
        `<main class="usage-page"><h1>Usage controls</h1><button type="button">Refresh</button><button type="button">Export</button>
        <figure class="usage-chart"><svg viewBox="0 0 100 100">${colours
          .map(
            (
              colour,
              index,
            ) => `<rect class="usage-series-${colour}" fill="var(--ms-${colour})" x="${String(index * 10)}" y="10" width="5" height="20" />
            <circle class="usage-series-${colour}" fill="var(--ms-${colour})" cx="${String(index * 10)}" cy="40" r="2" />
            <polyline class="usage-line usage-series-${colour}" points="${String(index * 10)},50 ${String(index * 10 + 5)},60" />
            <line class="usage-line usage-series-${colour}" x1="${String(index * 10)}" x2="${String(index * 10 + 5)}" y1="70" y2="70" />`,
          )
          .join('')}</svg><ul class="usage-legend">${colours
          .map(
            (colour) =>
              `<li><span class="usage-swatch usage-series-${colour}"></span>${colour}</li>`,
          )
          .join('')}</ul></figure></main>`,
      )
      await page.addStyleTag({ content: stylesheet })
      await page.evaluate(({ variables, unset }) => {
        const style = globalThis.document.documentElement.style
        for (const [name, value] of Object.entries(variables)) style.setProperty(name, value)
        for (const name of unset) style.setProperty(name, 'initial')
      }, capture)
      await page.addScriptTag({ content: engine })
      const findings = await page.evaluate(async () => {
        const result = await globalThis.axe.run(globalThis.document.querySelectorAll('button'), {
          runOnly: { type: 'rule', values: ['color-contrast'] },
          resultTypes: ['violations', 'incomplete'],
        })
        return [...result.violations, ...result.incomplete]
      })
      if (findings.length > 0) {
        failedThemes.push(theme)
        console.error(`${theme}: usage button contrast failed: ${JSON.stringify(findings)}`)
      }
      const chart = await page.evaluate(() => {
        const errors = []
        const parse = (colour) => {
          const numbers = colour.match(/[\d.]+/g)?.map(Number)
          return numbers === undefined ? undefined : [...numbers.slice(0, 3), numbers[3] ?? 1]
        }
        const background = parse(
          globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
        )
        if (background === undefined) throw new Error('Cannot measure chart background')
        const weights = [0.2126, 0.7152, 0.0722]
        const luminance = (rgb) => {
          let sum = 0
          for (const [index, value] of rgb.slice(0, 3).entries()) {
            const channel = value / 255
            sum +=
              (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) *
              weights[index]
          }
          return sum
        }
        const bg = luminance(background)
        const contrast = (colour) => {
          const rgba = parse(colour)
          if (rgba === undefined) return 0
          const foreground = luminance(
            rgba
              .slice(0, 3)
              .map((value, index) => value * rgba[3] + background[index] * (1 - rgba[3])),
          )
          return (Math.max(bg, foreground) + 0.05) / (Math.min(bg, foreground) + 0.05)
        }
        const dashes = new Set()
        const patterns = new Set()
        let minimum = Infinity
        for (const mark of globalThis.document.querySelectorAll('svg [class*="usage-series-"]')) {
          const style = globalThis.getComputedStyle(mark)
          const ratio = contrast(style.stroke)
          minimum = Math.min(minimum, ratio)
          if (ratio < 3 || Number(style.strokeWidth.replace('px', '')) < 1)
            errors.push(
              `${mark.tagName}.${mark.getAttribute('class')}: chart boundary contrast ${String(ratio)}`,
            )
          if (mark.tagName === 'polyline') dashes.add(style.strokeDasharray)
        }
        for (const swatch of globalThis.document.querySelectorAll('.usage-swatch')) {
          const style = globalThis.getComputedStyle(swatch)
          if (contrast(style.borderTopColor) < 3)
            errors.push(`${swatch.getAttribute('class')}: legend boundary contrast`)
          if (style.backgroundImage === 'none') errors.push('Missing legend pattern')
          patterns.add(style.backgroundImage)
        }
        if (dashes.size !== 7) errors.push('Every line series needs a distinct non-color dash cue')
        if (patterns.size !== 7)
          errors.push('Every legend series needs a distinct non-color pattern')
        return {
          errors,
          minimum,
          marks: globalThis.document.querySelectorAll('svg [class*="usage-series-"]').length,
        }
      })
      if (chart.errors.length > 0) {
        failedThemes.push(theme)
        console.error(`${theme}: usage chart contrast/cues failed: ${JSON.stringify(chart)}`)
      } else
        console.log(
          `${theme}: ${String(chart.marks)} chart boundaries pass 3:1; minimum ${String(chart.minimum)}; seven non-color cues`,
        )
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
if (failedThemes.length > 0) throw new Error(`Usage contrast failed for ${failedThemes.join(', ')}`)
console.log('Usage button/chart contrast: all four captured themes pass, no unresolved checks')
