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
  'prompt-library',
  'prompt-library-narrow',
  'chat-sharing',
  'chat-sharing-narrow',
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
  'help',
  'help-narrow',
  'context-meter',
  'context-meter-warning',
  'context-meter-full',
  'palette-tips',
  'slash-tips',
  'stop-running',
  'models',
  'pill-toggle',
  'mention',
  'chips',
  'transcript',
  'chat-menu',
  'chat-menu-narrow',
  'chat-tool-menu',
  'chat-tool-menu-narrow',
  'shifttab',
  'filter',
  'modes',
  'modes-bypass',
  'attach',
  'add-context',
  'markdown',
  'tools',
  'tools-open',
  'approval',
  'approval-several',
  'approval-narrow',
  'approval-moved',
  'judge',
  'judge-narrow',
  'judge-slow',
  'judge-usage',
  'question',
  'questions-waiting',
  'questions-waiting-narrow',
  'questions-open',
  'questions-open-narrow',
  'questions-chip',
  'questions-chip-narrow',
  'questions-approval',
  'questions-approval-narrow',
  'questions-answered',
  'questions-answered-narrow',
  'questions-answered-later',
  'questions-answered-later-narrow',
  'questions-reasked',
  'questions-reasked-narrow',
  'questions-explained',
  'questions-explained-narrow',
  'questions-declined',
  'questions-declined-narrow',
  'questions-dismissed',
  'questions-dismissed-narrow',
  'questions-expired',
  'questions-expired-narrow',

  'elicitation',
  'elicitation-narrow',
  'todo',
  'todo-collapsed',
  'tasks-tab',
  'tasks-tab-ended',
  'tasks-tab-plain',
  'focus',
  'steps-summary',
  'steps-summary-open',
  'message-time',
  'queued-menu',
  'queued-menu-edit',
  'column',
  'column-narrow',
  'column-wide',
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
  'tool-io',
  'tool-io-expanded',
  'status-heartbeat',
  'status-heartbeat-narrow',
  'question-filled',
  'reply-menu',
  'reply-chip',
  'quote-menu',
  'quote-chip',
  'approval-tool',
  'agents-details',
  'agents-result',
  'agents-closed',
  ...[
    'active',
    'approval',
    'input',
    'queued',
    'interrupted',
    'complete',
    'incomplete',
    'failed',
    'cancelled',
    'unverified',
  ].map((state) => `agent-${state}`),
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
  'diff-tally',
  'goal-edit',
  'muse-shell',
  'background-map',
  'question-explain',
  'muse-workflow',
  'muse-workflow-map',
  'schedules',
  'schedules-narrow',
  'git-held',
  'git-commit',
  'git-pr',
  'git-pr-narrow',
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
  'status-heartbeat',
  'review-findings',
  'review-pane',
  'review-pane-narrow',
  'review-comment',
  'report',
  'report-narrow',
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

/**
 * The scenarios that need a viewport of their own width, and the element a
 * screenshot waits for: the 320 px share and report (M93) dialogs, whose
 * backdrops are fixed to the viewport, and chat menus, and the chat
 * column at 320 and 1400 px (M87), which marks the page once its geometry
 * checks pass or reports why they did not. The wide column keeps the
 * scrollbars headless Chrome otherwise hides, as its check measures one.
 */
export const SIZED_SCENARIOS = {
  'prompt-library-narrow': { width: 320, ready: '.prompt-library' },
  'chat-sharing-narrow': { width: 320, ready: '.chat-share-preview' },
  'questions-waiting-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-open-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-chip-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-approval-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-answered-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-answered-later-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-reasked-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-explained-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-declined-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-dismissed-narrow': { width: 320, ready: '.attention-dock, .question' },
  'questions-expired-narrow': { width: 320, ready: '.attention-dock, .question' },
  help: { width: 1000, ready: '#reference-search' },
  'help-narrow': { width: 320, ready: '#reference-search' },
  'judge-narrow': { width: 320, ready: '.judge-status' },
  judge: { width: 690, ready: '.judge-status' },
  'judge-slow': { width: 690, ready: '.judge-status' },
  'judge-usage': { width: 690, ready: '[role="dialog"]' },
  'share-narrow': { width: 320, ready: '[role="dialog"]' },
  // M91 lane M: the MCP elicitation form at the panel's narrowest width.
  'elicitation-narrow': { width: 320, ready: 'form' },
  'report-narrow': { width: 320, ready: '[role="dialog"]' },
  'chat-menu-narrow': { width: 320, ready: '[role="menu"]' },
  'chat-tool-menu-narrow': { width: 320, ready: '[role="menu"]' },
  'column-narrow': { width: 320, ready: '[data-column-checked], .harness-report' },
  'column-wide': {
    width: 1400,
    ready: '[data-column-checked], .harness-report',
    hasScrollbars: true,
  },
}
const VIEWPORT_HEIGHT = 760

/** Chrome's CLI clamps windows to 500 px: a sized scenario gets a real viewport of its width. */
export async function withSizedPage(chrome, profileDir, url, sized, run) {
  const browser = await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    ...(sized.hasScrollbars === true && { ignoreDefaultArgs: ['--hide-scrollbars'] }),
    viewport: { width: sized.width, height: VIEWPORT_HEIGHT },
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
