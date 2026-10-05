// A loopback HTTP server over the repository, for the scripts that open
// test/harness/index.html in headless Chrome (the screenshots, the
// accessibility gate). Only files under the repository are served.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

export const LOOPBACK = '127.0.0.1'
export const HARNESS_PATH = 'test/harness/index.html'
// Real time for one page; a hung browser fails rather than producing an empty result.
export const PAGE_TIMEOUT_MS = 120_000
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
  'usage-install',
  'usage-install-narrow',
  'palette',
  'models',
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
  'tab-usage',
  'tab-usage-off',
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

/** Chrome's CLI clamps windows to 500 px: the narrow share check needs a real 320 px viewport. */
export async function withNarrowPage(chrome, profileDir, url, run) {
  const browser = await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    viewport: { width: 320, height: 760 },
    timeout: PAGE_TIMEOUT_MS,
  })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(PAGE_TIMEOUT_MS)
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS)
    await page.goto(url)
    return await run(page)
  } finally {
    await browser.close()
  }
}
