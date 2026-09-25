// A loopback HTTP server over the repository, for the scripts that open
// test/harness/index.html in headless Chrome (the screenshots, the
// accessibility gate). Only files under the repository are served.

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

export const LOOPBACK = '127.0.0.1'
export const HARNESS_PATH = 'test/harness/index.html'
// Every `?scenario=` test/harness/index.html plays.
export const SCENARIOS = [
  'empty',
  'signin',
  'signin-nocli',
  'signin-waiting',
  'signin-error',
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
  'agents',
  'agents-off',
  'usage-api',
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
  'composer-grow',
  'composer-max',
  'cancelled',
  'restored',
  'rtl',
  'history-archived',
  'long-patch',
  'size-refused',
  'slash-palette',
  'slash-commands',
  'paid',
  'paid-usage',
  'paid-palette',
  'paid-image',
  'paid-voice',
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
