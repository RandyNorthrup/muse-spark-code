#!/usr/bin/env node
// Renders the webview bundle in headless Chrome behind the scripted fake host
// in test/harness/index.html and writes one screenshot per scenario. This is
// the visual check behind the certification records, not a gate: it needs a
// Chrome install and a dev bundle (`npm run build:dev`).
//
//   node scripts/harness-shots.mjs            all scenarios → harness-shots/
//   node scripts/harness-shots.mjs palette    one scenario
//   CHROME_PATH=/path/to/chrome node scripts/harness-shots.mjs

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { findChrome } from './lib/chrome.mjs'

const SCENARIOS = [
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
]
const OUT_DIR = 'harness-shots'
const HARNESS_PATH = 'test/harness/index.html'
const BUNDLE_PATH = 'dist/webview/main.js'
const WINDOW_SIZE = '690,760'
const VIRTUAL_TIME_BUDGET_MS = 6000
const LOOPBACK = '127.0.0.1'
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.png': 'image/png',
}
const execFileAsync = promisify(execFile)
const repoRoot = process.cwd()

function serveRepo() {
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

async function shoot(chrome, port, scenario, outDir, profileDir) {
  const file = path.join(outDir, `${scenario}.png`)
  const url = `http://${LOOPBACK}:${String(port)}/${HARNESS_PATH}?scenario=${scenario}`
  await execFileAsync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${profileDir}`,
    `--window-size=${WINDOW_SIZE}`,
    `--virtual-time-budget=${String(VIRTUAL_TIME_BUDGET_MS)}`,
    `--screenshot=${file}`,
    url,
  ])
  return file
}

async function main() {
  if (!existsSync(path.join(repoRoot, BUNDLE_PATH))) {
    throw new Error(`${BUNDLE_PATH} is missing; run \`npm run build:dev\` first`)
  }
  const chrome = findChrome()
  if (chrome === undefined) {
    throw new Error('No Chrome install found; set CHROME_PATH to the browser executable')
  }
  const requested = process.argv.slice(2)
  const unknown = requested.filter((name) => !SCENARIOS.includes(name))
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.join(', ')}`)
  }
  const scenarios = requested.length > 0 ? requested : SCENARIOS
  const outDir = path.join(repoRoot, OUT_DIR)
  await mkdir(outDir, { recursive: true })
  // Chrome's profile lives in a temporary directory for the run, not beside
  // the screenshots, and goes when the run ends.
  const profileDir = await mkdtemp(path.join(tmpdir(), 'muse-harness-'))
  const { server, port } = await serveRepo()
  try {
    for (const scenario of scenarios) {
      const file = await shoot(chrome, port, scenario, outDir, profileDir)
      console.log(`${scenario}: ${path.relative(repoRoot, file)}`)
    }
  } finally {
    server.close()
    await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

await main()
