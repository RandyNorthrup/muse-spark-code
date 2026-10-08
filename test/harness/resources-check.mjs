// Direct Mac-mini fake-only browser/axe run; all artifacts stay under temp/m107-u.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { findChrome } from '../../scripts/lib/chrome.mjs'
import { serveRepo } from '../../scripts/lib/harnessServer.mjs'

const root = process.cwd()
const scenes = [
  'normal',
  'throttle',
  'relocate',
  'pause',
  'companion',
  'traffic',
  // M107 U–C1/W: real host status messages through the production chat loader.
  'window-throttle',
  'window-pause',
  'window-off',
  'window-refused',
]
// A switched-off governor shows no chip; a refused status shows it as unavailable.
const chipless = new Set(['window-off'])
const requested = process.argv.slice(2)
if (requested.some((scene) => !scenes.includes(scene))) throw new Error('Unknown resource scene')
const selected = requested.length === 0 ? scenes : requested
const html = await readFile(path.join(root, 'test/harness/resources.html'), 'utf8')
const output = path.join(root, 'temp/m107-u/harness')
await mkdir(output, { recursive: true })
const built = await build({
  entryPoints: ['test/harness/resources-entry.mjs'],
  outdir: output,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  metafile: true,
})
await writeFile(path.join(output, 'meta.json'), JSON.stringify(built.metafile, null, 2))
/**
 * The owner's panel rules, read from the open popover in the page: actions on
 * one row (never stacked) with equal width and styling, a visible focus ring
 * on the focused control, and a crisp chip (no blur or shadow).
 */
function uiRules(needsRing) {
  const problems = []
  const buttons = [...globalThis.document.querySelectorAll('.resource-popover footer button')]
  if (buttons.length !== 3) problems.push(`expected 3 actions, saw ${String(buttons.length)}`)
  const boxes = buttons.map((button) => button.getBoundingClientRect())
  if (boxes.some((box) => Math.abs(box.top - boxes[0].top) > 1)) problems.push('stacked actions')
  if (boxes.some((box) => Math.abs(box.width - boxes[0].width) > 1))
    problems.push('unequal action widths')
  const look = (element) => {
    const style = globalThis.getComputedStyle(element)
    return [style.backgroundColor, style.color, style.fontWeight, style.borderStyle].join('|')
  }
  if (buttons.some((button) => look(button) !== look(buttons[0])))
    problems.push('unequal action styles')
  const focused = globalThis.document.activeElement
  const ring = focused === null ? null : globalThis.getComputedStyle(focused)
  if (needsRing && (ring === null || ring.outlineStyle === 'none' || ring.outlineWidth === '0px'))
    problems.push('no visible focus ring')
  // axe cannot see the refusal sentence over the fixed popover, so measure it:
  // its own colour against the popover's (composited over the page if translucent).
  const refusal = globalThis.document.querySelector('.resource-popover p[role="alert"]')
  let refusalContrast = null
  if (refusal !== null) {
    const rgba = (value) => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 }
    }
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    })
    const page = rgba(globalThis.getComputedStyle(globalThis.document.body).backgroundColor)
    const back = over(
      rgba(globalThis.getComputedStyle(refusal.closest('.resource-popover')).backgroundColor),
      page.a === 1 ? page : over(page, { r: 255, g: 255, b: 255, a: 1 }),
    )
    const fore = over(rgba(globalThis.getComputedStyle(refusal).color), back)
    const luminance = ({ r, g, b }) =>
      [r, g, b]
        .map((channel) => channel / 255)
        .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
        .reduce((sum, value, index) => sum + [0.2126, 0.7152, 0.0722][index] * value, 0)
    const [light, dark] = [luminance(fore), luminance(back)].toSorted((left, right) => right - left)
    refusalContrast = Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
    if (refusalContrast < 4.5)
      problems.push(`refusal text contrast ${String(refusalContrast)} below 4.5:1`)
  }
  const chip = globalThis.document.querySelector('.resource-chip')
  const chipStyle = chip === null ? null : globalThis.getComputedStyle(chip)
  if (chipStyle === null || chipStyle.filter !== 'none' || chipStyle.boxShadow !== 'none')
    problems.push('chip is not crisp')
  return { problems, refusalContrast, actionTops: boxes.map((box) => Math.round(box.top)) }
}

// scripts/a11y.mjs's policy, per node: a contrast node is unseen only when
// axe gave reasons and every one is that it could not see the text. Anything
// else it could not decide stays undecided and fails the page.
const UNSEEN_REASONS = new Set(['elmPartiallyObscured', 'elmPartiallyObscuring', 'bgOverlap'])
const reasonsOf = (node) =>
  [...node.any, ...node.all, ...node.none].flatMap((check) =>
    check.data?.messageKey === undefined ? [] : [check.data.messageKey],
  )
function sortIncomplete(findings) {
  const undecided = []
  let unseen = 0
  for (const finding of findings) {
    const nodes = finding.nodes.filter((node) => {
      const reasons = reasonsOf(node)
      const isUnseen =
        finding.id === 'color-contrast' &&
        reasons.length > 0 &&
        reasons.every((reason) => UNSEEN_REASONS.has(reason))
      if (isUnseen) unseen += 1
      return !isUnseen
    })
    if (nodes.length > 0) undecided.push({ ...finding, nodes })
  }
  return { undecided, unseen }
}

const chrome = findChrome()
if (chrome === undefined) throw new Error('Chrome is required for the resource surfaces acceptance')
const browser = await chromium.launch({ executablePath: chrome, headless: true })
const { server, port } = await serveRepo(root)
const results = []
try {
  for (const theme of ['light', 'dark', 'hc-dark', 'hc-light']) {
    const captured = JSON.parse(
      await readFile(path.join(root, 'test/harness/themes', `${theme}.json`), 'utf8'),
    )
    for (const width of [690, 320]) {
      for (const scene of selected) {
        const page = await browser.newPage({
          viewport: { width, height: 760 },
          reducedMotion: 'reduce',
        })
        const errors = []
        page.on('pageerror', (error) => {
          errors.push(error.message)
        })
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning')
            errors.push(message.text())
        })
        const query = scene.startsWith('window-')
          ? `level=${scene.slice('window-'.length)}&surface=window`
          : `level=${scene === 'companion' || scene === 'traffic' ? 'pause' : scene}&surface=${scene === 'companion' || scene === 'traffic' ? scene : 'panel'}`
        const url = `http://127.0.0.1:${String(port)}/test/harness/resources.html?${query}`
        try {
          const themed = html
            .replace(
              '<head>',
              () =>
                `<head><style>:root { ${Object.entries(captured.variables)
                  .map(([key, value]) => `${key}: ${value};`)
                  .join('\n')} }</style>`,
            )
            .replace('<body>', () => `<body class="${captured.bodyClass}">`)
          await page.route('**/resources.html*', async (route) => {
            await route.fulfill({ contentType: 'text/html', body: themed })
          })
          await page.goto(url)
          let ui = null
          if (chipless.has(scene)) {
            // The deferred chip loaded and decided: it shows nothing for this status.
            await page.locator('.status-line').waitFor()
            await page.waitForFunction(() =>
              globalThis.performance
                .getEntriesByType('resource')
                .some((entry) => /ResourceSurface/.test(entry.name)),
            )
            await page.evaluate(
              () =>
                new Promise((resolve) => {
                  globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))
                }),
            )
            if ((await page.locator('.resource-chip, .resource-popover').count()) !== 0)
              throw new Error(`${scene} must render no chip`)
          } else {
            await page
              .locator(scene === 'traffic' ? '.resource-task-row' : '.resource-chip')
              .waitFor()
            if (scene.startsWith('window-')) {
              // Show resources: the host's resourceOpen opens the popover and focuses it.
              await page.evaluate(() => globalThis.window.resourceHarness.open())
              await page.locator('[role="dialog"]').waitFor()
              await page.waitForFunction(() =>
                globalThis.document
                  .querySelector('.resource-popover')
                  ?.contains(globalThis.document.activeElement),
              )
            } else if (scene !== 'traffic') await page.locator('.resource-chip').click()
            // A pointer click opens without a ring (focus-visible); Show's keyboard-free open shows it.
            if (scene !== 'traffic') ui = await page.evaluate(uiRules, scene.startsWith('window-'))
          }
          await page.addScriptTag({ path: path.join(root, 'node_modules/axe-core/axe.min.js') })
          const axe = await page.evaluate(
            async () =>
              await globalThis.window.axe.run(globalThis.document, {
                runOnly: {
                  type: 'tag',
                  values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
                },
                resultTypes: ['violations', 'incomplete'],
              }),
          )
          const overflow = await page.evaluate(() => {
            const viewport = globalThis.window.innerWidth
            return (
              globalThis.document.documentElement.scrollWidth > viewport ||
              [
                ...globalThis.document.querySelectorAll(
                  '.resource-chip, .resource-popover, .resource-task-row',
                ),
              ].some((element) => {
                const bounds = element.getBoundingClientRect()
                return bounds.left < -1 || bounds.right > viewport + 1
              })
            )
          })
          const result = {
            theme,
            width,
            scene,
            errors,
            overflow,
            ui,
            violations: axe.violations,
            incomplete: axe.incomplete,
          }
          // As scripts/a11y.mjs: contrast axe could not see (text over a fixed
          // overlay, under a user-opened dialog) is reported, not decided.
          const sorted = sortIncomplete(result.incomplete)
          result.unseen = sorted.unseen
          result.incomplete = sorted.undecided
          results.push(result)
          await page.screenshot({
            path: path.join(output, `${theme}-${String(width)}-${scene}.png`),
            animations: 'disabled',
          })
          if (chipless.has(scene)) {
            // Nothing to operate: the refused or disabled status shows no controls.
          } else if (scene === 'traffic') {
            for (const index of [0, 1, 2])
              await page.locator('.resource-task-row button').nth(index).click()
            const actions = await page.evaluate(() => globalThis.window.resourceHarness.actions)
            if (['runNow', 'move', 'keepHere'].some((action) => !actions.includes(action)))
              throw new Error('Task control failed to reach admission port')
          } else {
            if (
              scene !== 'companion' &&
              (await page.locator('.status-line .resource-chip').count()) !== 1
            )
              throw new Error('Chip is missing beside heartbeat')
            await page.keyboard.press('Escape')
            if ((await page.locator('[role="dialog"]').count()) !== 0)
              throw new Error('Escape did not close the popover')
            if (
              !(await page
                .locator('.resource-chip')
                .evaluate((chip) => chip === globalThis.document.activeElement))
            )
              throw new Error('Escape did not restore chip focus')
            for (const index of [0, 1, 2]) {
              await page.locator('.resource-chip').click()
              await page.locator('.resource-popover footer button').nth(index).click()
            }
            const actions = await page.evaluate(() => globalThis.window.resourceHarness.actions)
            if (['resume', 'settings', 'show'].some((action) => !actions.includes(action)))
              throw new Error('Resource control failed to reach host port')
          }
          console.log(
            `${theme} ${String(width)} ${scene}: ${String(errors.length)} errors, ${String(axe.violations.length)} violations, ${String(result.incomplete.length)} incomplete, ${String(result.unseen)} unseen nodes, refusal=${String(ui?.refusalContrast ?? 'n/a')}, overflow=${String(overflow)}, ui=${ui === null ? 'n/a' : JSON.stringify(ui.problems)}`,
          )
        } finally {
          await page.close()
        }
      }
    }
  }
} finally {
  server.close()
  await browser.close()
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
}
if (
  results.some(
    (result) =>
      result.errors.length > 0 ||
      result.overflow ||
      (result.ui !== null && result.ui.problems.length > 0) ||
      result.violations.length > 0 ||
      result.incomplete.length > 0,
  )
) {
  throw new Error(
    'Resource surface browser acceptance failed; see temp/m107-u/harness/results.json',
  )
}
