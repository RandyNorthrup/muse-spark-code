// A loopback HTTP server over the repository, for the scripts that open
// test/harness/index.html in headless Chrome (the screenshots, the
// accessibility gate). Only files under the repository are served.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright-core'

export const LOOPBACK = '127.0.0.1'
export const HARNESS_PATH = 'test/harness/index.html'
// The bundle a scenario plays in: the Models & Agents panel's own
// (`?bundle=models`, M95 lane M) for its scenarios, the chat's otherwise.
export function bundleFor(scenario) {
  return scenario !== 'models-byo' && scenario.startsWith('models-') ? 'models' : 'main'
}
// Real time for one page; a hung browser fails rather than producing an empty result.
export const PAGE_TIMEOUT_MS = 120_000
const NARROW_VIEWPORT = { width: 320, height: 760 }
// Every `?scenario=` test/harness/index.html plays.
export const SCENARIOS = [
  'empty',
  'signin',
  'signin-nocli',
  'signin-install',
  'signin-waiting',
  'signin-error',
  'signin-history',
  'signin-history-narrow',
  // M95: the first-run screen with its own-model choice, in both states.
  'signin-byo',
  'signin-nocli-byo',
  'usage-install',
  'usage-install-narrow',
  'palette',
  'models',
  // M95: the picker grouped by provider, pinned first, with its rows.
  'models-byo',
  'pill-toggle',
  'mention',
  'chips',
  'transcript',
  'shifttab',
  'filter',
  'modes',
  'modes-bypass',
  'attach',
  'add-context',
  'markdown',
  'tools',
  'approval',
  'approval-several',
  'approval-narrow',
  'approval-moved',
  'question',
  'todo',
  'focus',
  'long',
  'editor',
  'history',
  'resume',
  'narrow',
  'usage',
  'dictation',
  'rewind',
  'checkpoint-restore',
  'checkpoint-restricted',
  'checkpoint-read-only',
  'checkpoint-read-only-narrow',
  'checkpoint-legacy',
  'agents',
  'agents-off',
  'usage-api',
  // M95: Account & usage with per-provider rows and key usage.
  'usage-providers',
  'reply-usage',
  'banner',
  'jump',
  'thinking',
  'question-filled',
  'reply-menu',
  'reply-chip',
  'quote-menu',
  'quote-chip',
  'approval-tool',
  'agents-details',
  'agents-result',
  'agents-closed',
  'composer-grow',
  'composer-max',
  'cancelled',
  'restored',
  'rtl',
  'history-archived',
  'long-patch',
  'size-refused',
  'notice-repeat',
  'slash-palette',
  'slash-commands',
  'paid',
  'paid-usage',
  'paid-always',
  'paid-subagent-approval',
  'paid-subagent-usage',
  'paid-subagent-map',
  'paid-subagent-narrow',
  'paid-palette',
  'paid-image',
  'paid-voice',
  'muse-tools',
  'muse-web',
  'web-fetch',
  'paid-edit',
  'paid-image-cli',
  'goal',
  'goal-edit',
  'muse-shell',
  'background-map',
  'question-explain',
  'muse-workflow',
  'muse-workflow-map',
  'schedules',
  'schedules-narrow',
  'auto-review',
  'auto-review-rule',
  'auto-review-usage',
  'share',
  'share-narrow',
  'verify',
  'board',
  'bestofn',
  'plan',
  'plan-brief',
  'plan-narrow',
  'handoff',
  'code-intel',
  'review-findings',
  'review-pane',
  'review-pane-narrow',
  'review-comment',
  // M95 lane M: the Models & Agents panel (`?bundle=models`), one per state.
  'models-empty',
  'models-pick',
  'models-configure',
  'models-errors',
  'models-credential',
  'models-test',
  'models-test-cost',
  'models-test-failed',
  'models-models',
  'models-privacy',
  'models-suggestions',
  'models-confirm',
  'models-providers',
  'models-scanning',
  'models-scan-failed',
  'models-scan-diff',
  'models-table',
  'models-table-filtered',
  'models-undo',
  'models-import',
  'models-narrow',
]
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
}

/** Serves `repoRoot` on an unused loopback port: `{ server, port }`. */
export function serveRepo(repoRoot) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK}`)
    const target = path.resolve(repoRoot, `.${decodeURIComponent(url.pathname)}`)
    if (!target.startsWith(repoRoot)) {
      response.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(target)
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
      })
      response.end(body)
    } catch {
      response.writeHead(404).end()
    }
  })
  return new Promise((resolve) => {
    server.listen(0, LOOPBACK, () => {
      resolve({ server, port: server.address().port })
    })
  })
}

/** Real Chrome viewport; narrow by default, with an explicit size for the accessibility gate. */
export async function withNarrowPage(chrome, profileDir, url, run, viewport = NARROW_VIEWPORT) {
  const deadline = performance.now() + PAGE_TIMEOUT_MS
  const remaining = () => Math.max(1, deadline - performance.now())
  const browser = await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    viewport,
    timeout: PAGE_TIMEOUT_MS,
  })
  try {
    browser.setDefaultTimeout(remaining())
    browser.setDefaultNavigationTimeout(remaining())
    const page = await browser.newPage()
    page.setDefaultTimeout(remaining())
    page.setDefaultNavigationTimeout(remaining())
    await page.goto(url)
    page.setDefaultTimeout(remaining())
    page.setDefaultNavigationTimeout(remaining())
    return await run(page, remaining)
  } finally {
    await browser.close()
  }
}
