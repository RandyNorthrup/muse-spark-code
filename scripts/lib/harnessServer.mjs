// A loopback HTTP server over the repository, for the scripts that open
// test/harness/index.html in headless Chrome (the screenshots, the
// accessibility gate). Only files under the repository are served.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { chromium } from 'playwright-core'
import { buildTrafficHarness } from '../../test/harness/buildTraffic.mjs'
import { build } from 'esbuild'

export const LOOPBACK = '127.0.0.1'
export const HARNESS_PATH = 'test/harness/index.html'
// The bundle a scenario plays in: the Models & Agents panel's own
// (`?bundle=models`, M95 lane M) for its scenarios, the chat's otherwise.
export function bundleFor(scenario) {
  if (scenario.startsWith('usage-page-')) return 'usage'
  return scenario !== 'models-byo' && scenario.startsWith('models-') ? 'models' : 'main'
}
// Real time for one page; a hung browser fails rather than producing an empty result.
export const PAGE_TIMEOUT_MS = 120_000
// Every `?scenario=` test/harness/index.html plays.
export const TRAFFIC_SCENARIOS = [
  'team-traffic',
  'team-traffic-320',
  'team-traffic-hints',
  'team-traffic-recovery',
  'runners',
]
export const SCENARIOS = [
  ...[
    'empty',
    'history-off',
    'one-provider',
    'nine-providers',
    'plan-only',
    'local-only',
    'stale',
    'over-limit',
    'newer-version',
    'long-german',
    'long-russian',
    'narrow',
  ].map((name) => `usage-page-${name}`),
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
  'help',
  'help-narrow',
  'context-meter',
  'context-meter-warning',
  'context-meter-full',
  'palette-tips',
  'slash-tips',
  'stop-running',
  'models',
  // M95: the picker grouped by provider, pinned first, with its rows.
  'models-byo',
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
  ...TRAFFIC_SCENARIOS,
  'agents',
  'agents-off',
  // M96 lane U2: the team tree (and at 320 px), and the transcript cards.
  'team-tree',
  'team-tree-320',
  'team-cards',
  'usage-api',
  // M95: Account & usage with per-provider rows and key usage.
  'usage-providers',
  // M95b shared plan surfaces and their 320 px layouts.
  'plan-chatgpt',
  'plan-notice',
  'plan-notice-narrow',
  'plan-limit',
  'plan-limit-narrow',
  'plan-usage',
  'plan-usage-narrow',
  'plan-key',
  'copilot-plan',
  'copilot-plan-narrow',
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
  'models-edit',
  'models-scanning',
  'models-scan-failed',
  'models-scan-diff',
  'models-table',
  'models-table-filtered',
  'models-undo',
  'models-import',
  'models-narrow',
  'report',
  'report-narrow',
  'legal',
  'legal-narrow',
  'legal-preview',
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
export async function serveRepo(repoRoot) {
  await buildTrafficHarness()
  const fixture = await build({
    entryPoints: [path.join(repoRoot, 'test/unit/helpers/usageFixtures.ts')],
    outfile: path.join(repoRoot, 'temp/harness-usage.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'museUsageHarness',
    write: false,
  })
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${LOOPBACK}`)
    if (url.pathname === '/usage-harness.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' })
      response.end(fixture.outputFiles[0].contents)
      return
    }
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
  return await new Promise((resolve) => {
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
  ...Object.fromEntries(
    TRAFFIC_SCENARIOS.map((scenario) => [
      scenario,
      { width: scenario === 'team-traffic-320' ? 320 : 690, ready: 'body[data-traffic-ready]' },
    ]),
  ),
  'share-narrow': { width: 320, ready: '[role="dialog"]' },
  'team-tree-320': { width: 320, ready: '[role="dialog"]' },
  'usage-page-narrow': { width: 320, ready: '.usage-page[aria-busy="false"]' },
  help: { width: 1000, ready: '#reference-search' },
  'help-narrow': { width: 320, ready: '#reference-search' },
  'judge-narrow': { width: 320, ready: '.judge-status' },
  judge: { width: 690, ready: '.judge-status' },
  'judge-slow': { width: 690, ready: '.judge-status' },
  'judge-usage': { width: 690, ready: '[role="dialog"]' },
  'plan-notice-narrow': { width: 320, ready: '#chatgpt-plan-title' },
  'plan-limit-narrow': { width: 320, ready: '#chatgpt-plan-title' },
  'plan-usage-narrow': { width: 320, ready: '#usage-title' },
  'copilot-plan-narrow': { width: 320, ready: '.copilot-note' },
  // M91 lane M: the MCP elicitation form at the panel's narrowest width.
  'elicitation-narrow': { width: 320, ready: 'form' },
  'legal-narrow': { width: 320, ready: '[role="dialog"]' },
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
  const deadline = performance.now() + PAGE_TIMEOUT_MS
  const remaining = () => Math.max(1, deadline - performance.now())
  const browser = await chromium.launchPersistentContext(profileDir, {
    ...(path.isAbsolute(chrome) ? { executablePath: chrome } : { channel: 'chrome' }),
    ...(sized.hasScrollbars === true && { ignoreDefaultArgs: ['--hide-scrollbars'] }),
    viewport: { width: sized.width, height: VIEWPORT_HEIGHT },
    timeout: remaining(),
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
