// The real usage stylesheet against all four captured editor button palettes.
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'

const stylesheet = await readFile('src/webview/usage/usage.css', 'utf8')
const engine = await readFile('node_modules/axe-core/axe.min.js', 'utf8')
const executablePath = findChrome()
if (executablePath === undefined) throw new Error('Chrome is required for usage contrast')
const browser = await chromium.launch({ executablePath, headless: true })
const failedThemes = []
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    const capture = JSON.parse(await readFile(`test/harness/themes/${theme}.json`, 'utf8'))
    const page = await browser.newPage()
    try {
      await page.setContent(
        '<main class="usage-page"><h1>Usage controls</h1><button type="button">Refresh</button><button type="button">Export</button></main>',
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
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}
if (failedThemes.length > 0)
  throw new Error(`Usage button contrast failed for ${failedThemes.join(', ')}`)
console.log('Usage button contrast: all four captured themes pass, no unresolved checks')
