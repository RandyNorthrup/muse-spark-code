// Six-theme, true-width observations of every audited surface. The existing
// test:a11y gate remains authoritative for its full scenarios and exemptions.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { captureMatrix } from './capture.mjs'

const root = process.cwd()
const audit = JSON.parse(
  await readFile(path.join(root, 'docs/certification/m114-audit.json'), 'utf8'),
)
const matrix = JSON.parse(
  await readFile(path.join(root, 'test/harness/visual-matrix.json'), 'utf8'),
)
const axe = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8')
const results = []
await captureMatrix(
  root,
  audit,
  { ...matrix, states: ['default'] },
  async (capture, _bytes, page) => {
    await page.evaluate((source) => {
      const script = globalThis.document.createElement('script')
      script.nonce = 'audit-fixture'
      script.textContent = source
      globalThis.document.head.append(script)
    }, axe)
    // Axe schedules browser timers; let them run after the frozen PNG is taken.
    await page.clock.resume()
    const rows = audit.components.filter((row) => row.scene === capture.scene)
    const findings = await page.evaluate(async (rows) => {
      const include = rows
        .flatMap((row) => row.captureSelector.split(',').map((selector) => selector.trim()))
        .filter((selector) => globalThis.document.querySelector(selector) !== null)
      const result = await globalThis.axe.run(
        include.length > 0 ? { include } : globalThis.document,
        {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
          resultTypes: ['violations', 'incomplete'],
        },
      )
      return Object.fromEntries(
        ['violations', 'incomplete'].map((kind) => [
          kind,
          result[kind].map((finding) => ({
            id: finding.id,
            nodes: finding.nodes.map((node) => ({
              target: node.target,
              summary: node.failureSummary,
              reasons: [...node.any, ...node.all, ...node.none]
                .filter((check) => typeof check.data?.messageKey === 'string')
                .map((check) => check.data.messageKey),
            })),
          })),
        ]),
      )
    }, rows)
    results.push({
      scene: capture.scene,
      theme: capture.theme,
      width: capture.width,
      components: capture.components,
      ...findings,
    })
    if (findings.violations.length > 0)
      console.log(
        `axe observation: ${capture.scene}/${capture.theme}/${capture.width}: ${findings.violations.map((finding) => finding.id).join(', ')}`,
      )
  },
)
const receipt = { kind: 'integrated-six-theme-true-width-scoped-axe-observation', results }
await writeFile(
  path.join(root, 'temp/m114-s-accessibility.json'),
  JSON.stringify(receipt, null, 2) + '\n',
)
const violated = results.filter((result) => result.violations.length > 0)
console.log(
  `axe observations: ${results.length} pages; ${violated.length} pages with violations; all incomplete findings retained`,
)
if (violated.length > 0) process.exitCode = 1
