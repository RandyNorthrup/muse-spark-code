#!/usr/bin/env node
// The accessibility gate (M37, PLAN.md D32). Every harness scenario is
// opened in headless Chrome in each of VS Code's four default themes
// (captured by scripts/capture-themes.mjs), and axe-core checks the result
// against WCAG 2.0, 2.1 and 2.2, levels A and AA, colour contrast included.
// Any violation fails the gate. It needs a Chrome install and a built
// bundle (`npm run build` or `build:dev`).
//
//   node scripts/a11y.mjs                    every scenario, every theme
//   node scripts/a11y.mjs palette approval   those scenarios, every theme
//   CHROME_PATH=/path/to/chrome node scripts/a11y.mjs

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { findChrome } from './lib/chrome.mjs'
import { HARNESS_PATH, LOOPBACK, SCENARIOS, serveRepo } from './lib/harnessServer.mjs'

const THEMES = ['light', 'dark', 'hc-dark', 'hc-light']
const BUNDLE_PATH = 'dist/webview/main.js'
const WINDOW_SIZE = '690,760'
// Virtual time: the scenario plays, the harness waits 5 s, axe runs.
const VIRTUAL_TIME_BUDGET_MS = 30_000
// Real time for one page, far above what a page takes; a hung Chrome fails.
const PAGE_TIMEOUT_MS = 120_000
const MAX_WORKERS = 6
const OUTPUT_MAX_BYTES = 64 * 1024 * 1024
const RESULT = /<pre id="axe-result" hidden="">([\s\S]*?)<\/pre>/
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()

function decodeEntities(text) {
  return text.replaceAll(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}

/** One page: `{ violations }` from axe, or `{ error }` saying why there is none. */
async function scan(chrome, port, page, profileDir) {
  const url = `http://${LOOPBACK}:${String(port)}/${HARNESS_PATH}?scenario=${page.scenario}&theme=${page.theme}&axe=1`
  try {
    const { stdout } = await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${profileDir}`,
        `--window-size=${WINDOW_SIZE}`,
        `--virtual-time-budget=${String(VIRTUAL_TIME_BUDGET_MS)}`,
        '--dump-dom',
        url,
      ],
      { timeout: PAGE_TIMEOUT_MS, maxBuffer: OUTPUT_MAX_BYTES, windowsHide: true },
    )
    const match = RESULT.exec(stdout)
    return match === null
      ? { error: 'the page wrote no axe result (did the scenario throw?)' }
      : JSON.parse(decodeEntities(match[1]))
  } catch (error) {
    return { error: String(error.message ?? error) }
  }
}

async function main() {
  if (!existsSync(path.join(repoRoot, BUNDLE_PATH))) {
    throw new Error(`${BUNDLE_PATH} is missing; run \`npm run build\` first`)
  }
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  const requested = process.argv.slice(2)
  const unknown = requested.filter((name) => !SCENARIOS.includes(name))
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(', ')}`)
  }
  const scenarios = requested.length > 0 ? requested : SCENARIOS
  const pages = THEMES.flatMap((theme) => scenarios.map((scenario) => ({ scenario, theme })))
  const workers = Math.max(1, Math.min(MAX_WORKERS, availableParallelism() - 1, pages.length))
  const { server, port } = await serveRepo(repoRoot)
  const profiles = await Promise.all(
    Array.from({ length: workers }, () => mkdtemp(path.join(tmpdir(), 'muse-a11y-'))),
  )
  const results = []
  let next = 0
  try {
    // Each worker has a Chrome profile of its own and takes the next page.
    await Promise.all(
      profiles.map(async (profileDir) => {
        while (next < pages.length) {
          const page = pages[next]
          next += 1
          results.push({ ...page, ...(await scan(chrome, port, page, profileDir)) })
        }
      }),
    )
  } finally {
    server.close()
    await Promise.all(
      profiles.map((profileDir) =>
        rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }),
      ),
    )
  }
  const failed = results.filter((result) => result.error !== undefined)
  const findings = results.flatMap((result) =>
    (result.violations ?? []).map((violation) => ({ ...violation, at: result })),
  )
  const byRule = Map.groupBy(findings, (finding) => finding.id)
  for (const [rule, found] of byRule) {
    const [first] = found
    console.log(`\n${rule} (${first.impact}): ${first.help}`)
    for (const finding of found) {
      for (const node of finding.nodes) {
        console.log(`  ${finding.at.theme}/${finding.at.scenario}: ${node.target}`)
        console.log(`    ${node.summary.replaceAll('\n', '\n    ')}`)
      }
    }
  }
  for (const result of failed) {
    console.log(`\n${result.theme}/${result.scenario}: no result: ${result.error}`)
  }
  // Out of scope by WCAG's own reading, and said out loud (see the harness).
  const exempt = results.flatMap((result) =>
    (result.exempt ?? []).map((entry) => ({ ...entry, at: result })),
  )
  if (exempt.length > 0) {
    console.log(
      '\nExempt: target-size under a menu or dialog the user opened (WCAG 2.5.8 does not apply while a target is obscured by content the user displayed):',
    )
    for (const entry of exempt) {
      console.log(`  ${entry.at.theme}/${entry.at.scenario}: ${entry.target}`)
    }
  }
  const nodes = findings.reduce((sum, finding) => sum + finding.nodes.length, 0)
  console.log(
    `\na11y: ${String(results.length)} pages (${String(scenarios.length)} scenarios × ${String(THEMES.length)} themes), ${String(byRule.size)} rules violated on ${String(nodes)} elements, ${String(exempt.length)} exempt, ${String(failed.length)} pages without a result`,
  )
  if (byRule.size > 0 || failed.length > 0) {
    process.exitCode = 1
  }
}

await main()
