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
//   node scripts/a11y.mjs --lang=de          in l10n/ui.de.json (PLAN.md D33)
//   node scripts/a11y.mjs --lang=pseudo      in the pseudo-locale table
//   CHROME_PATH=/path/to/chrome node scripts/a11y.mjs
//
// Each page runs in a Playwright page with focus emulation on: headless
// Chrome does not keep a window's focus, and on a loaded machine a window
// that lost it mid-scan closed the composer's menus under axe (the
// slash-commands race, docs/certification/a11y-focus.md).

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { chromium } from 'playwright-core'
import { findChrome } from './lib/chrome.mjs'
import { harnessArgs, langQuery, prepareLang } from './lib/harnessLang.mjs'
import {
  HARNESS_PATH,
  LOOPBACK,
  PAGE_TIMEOUT_MS,
  SCENARIOS,
  bundleFor,
  SIZED_SCENARIOS,
  serveRepo,
  withSizedPage,
} from './lib/harnessServer.mjs'

const THEMES = ['light', 'dark', 'hc-dark', 'hc-light']
const BUNDLE_PATH = 'dist/webview/main.js'
const MODELS_BUNDLE_PATH = 'dist/webview/models.js'
// The page the gate has always measured: what Chrome's 690x760 window left
// for the page. A sized scenario (SIZED_SCENARIOS: a real 320 px panel, the
// 1400 px column) is this tall at its own width.
const VIEWPORT = { width: 690, height: 673 }
const SIZED_VIEWPORT_HEIGHT = 760
const MAX_WORKERS = 6
// Bound concurrent axe work on Windows as before; every page still runs.
const WINDOWS_MAX_WORKERS = 2
// Each worker's browser holds this many pages at once; scenario events and
// readiness still run in real time before each scan.
const PAGES_PER_WORKER = 2
const WINDOWS_PAGES_PER_WORKER = 1
// axe's reasons (messageKey) for a contrast it could not decide: the text is
// covered, or it could not see the background behind it; or the content is
// glyphs, not text.
const CONTRAST_RULE = 'color-contrast'
const UNSEEN_REASONS = new Set(['elmPartiallyObscured', 'elmPartiallyObscuring', 'bgOverlap'])
const GLYPH_ONLY_REASON = 'nonBmp'
// The harness takes these findings out, each only where its own test holds,
// and they are printed under their own heading with the reason (PLAN.md §8).
const EXEMPT_REASONS = new Map([
  [
    'target-size',
    'target-size under a menu or dialog the user opened (WCAG 2.5.8 does not apply while a target is obscured by content the user displayed)',
  ],
  [
    'scrollable-region-focusable',
    'scrollable-region-focusable on a listbox its focused control drives with aria-activedescendant (WCAG 2.1.1 is met: the arrows move through the options and the active one is scrolled into view, so the region needs no Tab stop of its own)',
  ],
])
const repoRoot = process.cwd()

/** One worker's browser: a persistent context on its own profile. */
async function launchWorker(chrome, profileDir) {
  return await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    viewport: VIEWPORT,
    timeout: PAGE_TIMEOUT_MS,
  })
}

/** The page keeps its focus whatever the machine does with the window. */
async function keepFocus(tab) {
  // As a webview the user is typing in does. Playwright turns this on for
  // every page by default; it is asked for here too, so the gate does not
  // rest on that default.
  const session = await tab.context().newCDPSession(tab)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
}

async function axeResultOf(tab, remaining) {
  const result = tab.locator('#axe-result')
  await result.waitFor({ state: 'attached', timeout: remaining() })
  return JSON.parse(await result.textContent({ timeout: remaining() }))
}

/**
 * A scenario that needs scrollbars (the 1400 px column's check), which the
 * workers' browsers hide: a browser of its own at its size.
 */
async function scanWithScrollbars(chrome, url, sized) {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'muse-a11y-sized-'))
  try {
    return await withSizedPage(chrome, profileDir, url, sized, async (tab, remaining) => {
      await keepFocus(tab)
      return await axeResultOf(tab, remaining)
    })
  } finally {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** One page: `{ violations }` from axe, or `{ error }` saying why there is none. */
async function scan(chrome, context, port, page, lang) {
  const url = `http://${LOOPBACK}:${String(port)}/${HARNESS_PATH}?scenario=${page.scenario}&bundle=${bundleFor(page.scenario)}&theme=${page.theme}&axe=1${langQuery(lang)}`
  const sized = SIZED_SCENARIOS[page.scenario]
  if (sized?.hasScrollbars === true) {
    try {
      return await scanWithScrollbars(chrome, url, sized)
    } catch (error) {
      return { error: String(error.message ?? error) }
    }
  }
  const deadline = performance.now() + PAGE_TIMEOUT_MS
  const remaining = () => Math.max(1, deadline - performance.now())
  const tab = await context.newPage()
  try {
    tab.setDefaultTimeout(PAGE_TIMEOUT_MS)
    tab.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS)
    await keepFocus(tab)
    if (sized !== undefined) {
      await tab.setViewportSize({ width: sized.width, height: SIZED_VIEWPORT_HEIGHT })
    }
    await tab.goto(url, { timeout: remaining() })
    return await axeResultOf(tab, remaining)
  } catch (error) {
    return { error: String(error.message ?? error) }
  } finally {
    await tab.close()
  }
}

function elementCount(findings) {
  return findings.reduce((sum, finding) => sum + finding.nodes.length, 0)
}

/**
 * axe's undecided ("incomplete") results, sorted (the review of PR #18).
 * Two kinds of contrast result are counted, not failed, because no tool
 * decides them here: text axe could not see where it looked (covered by a
 * menu or dialog the user opened, or scrolled out of the transcript's
 * view; the same rows are checked where a scenario shows them), and
 * glyph-only content. Everything else axe could not decide fails, as a
 * violation does.
 */
function sortIncomplete(findings) {
  const undecided = []
  let unseen = 0
  let glyphOnly = 0
  for (const finding of findings) {
    const nodes = finding.nodes.filter((node) => {
      const isContrast = finding.id === CONTRAST_RULE && node.reasons.length > 0
      if (isContrast && node.reasons.every((reason) => UNSEEN_REASONS.has(reason))) {
        unseen += 1
        return false
      }
      if (isContrast && node.reasons.every((reason) => reason === GLYPH_ONLY_REASON)) {
        glyphOnly += 1
        return false
      }
      return true
    })
    if (nodes.length > 0) {
      undecided.push({ ...finding, nodes })
    }
  }
  return { undecided, unseen, glyphOnly }
}

/** One of axe's result lists over every page, each finding with its page. */
function findingsIn(results, list) {
  return results.flatMap((result) =>
    (result[list] ?? []).map((finding) => ({ ...finding, at: result })),
  )
}

/** Prints findings grouped by rule, each element with its page; returns the groups. */
function printByRule(prefix, findings) {
  const byRule = Map.groupBy(findings, (finding) => finding.id)
  for (const [rule, found] of byRule) {
    const [first] = found
    console.log(`\n${prefix}${rule} (${first.impact}): ${first.help}`)
    for (const finding of found) {
      for (const node of finding.nodes) {
        console.log(`  ${finding.at.theme}/${finding.at.scenario}: ${node.target}`)
        console.log(`    ${node.summary.replaceAll('\n', '\n    ')}`)
      }
    }
  }
  return byRule
}

async function main() {
  if (!existsSync(path.join(repoRoot, BUNDLE_PATH))) {
    throw new Error(`${BUNDLE_PATH} is missing; run \`npm run build\` first`)
  }
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  const { lang, scenarios: requested } = harnessArgs(process.argv.slice(2))
  if (
    (requested.length === 0 || requested.some((name) => bundleFor(name) === 'models')) &&
    !existsSync(path.join(repoRoot, MODELS_BUNDLE_PATH))
  ) {
    throw new Error(`${MODELS_BUNDLE_PATH} is missing; run \`npm run build\` first`)
  }
  const unknown = requested.filter((name) => !SCENARIOS.includes(name))
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(', ')}`)
  }
  await prepareLang(repoRoot, lang)
  const scenarios = requested.length > 0 ? requested : SCENARIOS
  const pages = THEMES.flatMap((theme) => scenarios.map((scenario) => ({ scenario, theme })))
  const isWindows = process.platform === 'win32'
  const maxWorkers = isWindows ? WINDOWS_MAX_WORKERS : MAX_WORKERS
  const pagesPerWorker = isWindows ? WINDOWS_PAGES_PER_WORKER : PAGES_PER_WORKER
  const workers = Math.max(1, Math.min(maxWorkers, availableParallelism() - 1, pages.length))
  const { server, port } = await serveRepo(repoRoot)
  const profiles = await Promise.all(
    Array.from({ length: workers }, () => mkdtemp(path.join(tmpdir(), 'muse-a11y-'))),
  )
  const results = []
  let next = 0
  try {
    // Each worker has a browser on a Chrome profile of its own; each of its
    // lanes takes the next page.
    await Promise.all(
      profiles.map(async (profileDir) => {
        const context = await launchWorker(chrome, profileDir)
        try {
          await Promise.all(
            Array.from({ length: pagesPerWorker }, async () => {
              while (next < pages.length) {
                const page = pages[next]
                next += 1
                results.push({ ...page, ...(await scan(chrome, context, port, page, lang)) })
              }
            }),
          )
        } finally {
          await context.close()
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
  // A page with no result, or whose scenario threw before axe looked.
  const failed = results.filter(
    (result) => result.error !== undefined || (result.harnessErrors ?? []).length > 0,
  )
  const findings = findingsIn(results, 'violations')
  const byRule = printByRule('', findings)
  // What axe could not decide by itself fails too, except the contrast of
  // text it could not see where it looked and of glyph-only content.
  const { undecided, unseen, glyphOnly } = sortIncomplete(findingsIn(results, 'incomplete'))
  const undecidedByRule = printByRule('undecided: ', undecided)
  for (const result of failed) {
    const why = result.error ?? `the scenario threw: ${result.harnessErrors.join('; ')}`
    console.log(`\n${result.theme}/${result.scenario}: no result: ${why}`)
  }
  // Out of scope by WCAG's own reading, and said out loud (see the harness).
  const exempt = results.flatMap((result) =>
    (result.exempt ?? []).map((entry) => ({ ...entry, at: result })),
  )
  const exemptByRule = Map.groupBy(exempt, (entry) => entry.rule)
  for (const [rule, entries] of exemptByRule) {
    console.log(`\nExempt: ${EXEMPT_REASONS.get(rule) ?? rule}:`)
    for (const entry of entries) {
      console.log(`  ${entry.at.theme}/${entry.at.scenario}: ${entry.target}`)
    }
  }
  console.log(
    `\nNot measured, as axe cannot: the contrast of ${String(unseen)} elements it could not see (under a menu or dialog the user opened, or scrolled out of the view) and of ${String(glyphOnly)} glyph-only elements (non-text contrast, WCAG 1.4.11, is not axe's).`,
  )
  const nodes = elementCount(findings)
  console.log(
    `\na11y: ${String(results.length)} pages (${String(scenarios.length)} scenarios × ${String(THEMES.length)} themes${lang === undefined ? '' : `, in ${lang}`}), ${String(byRule.size)} rules violated on ${String(nodes)} elements, ${String(undecidedByRule.size)} rules undecided on ${String(elementCount(undecided))} elements, ${String(exempt.length)} exempt, ${String(failed.length)} pages without a result`,
  )
  if (byRule.size > 0 || undecidedByRule.size > 0 || failed.length > 0) {
    process.exitCode = 1
  }
}

await main()
