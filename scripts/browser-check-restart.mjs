// The browser check's forced network-service restart capture (M81 A1, design
// spec v4 §10), run through the shipped bundles: dist/browserCheck.js and
// dist/browserRuntime.js. CI runs it on each hosted OS
// (.github/workflows/browser-check.yml); the rigs ran the same capture
// (docs/certification/m81.md). No model is called: the page is a local
// fixture.
//
//   node scripts/browser-check-restart.mjs <dist> <storageDir> [restartObserved|closed]
//
// The runtime is installed through the store itself (consent answered
// "download"), so the first run downloads the pinned archive.
//
// restartObserved (the default): the page, on http://localhost (implicit
// loopback, so through the owned proxy), keeps making same-origin credentialed
// fetches and frame navigations to paths the fixture answers 401 with
// Negotiate, NTLM and Basic, plus unapproved http, ws, wss and https attempts.
// Its load is held open, so the check is mid-page when this harness kills the
// network service of the browser this check spawned (its own child with
// --remote-debugging-pipe, and that browser's child with the network-service
// utility type; nothing else is touched). Resumed requests must arrive through
// the proxy (its `Connection: close` reserialization), with every challenge
// removed before the page and no Authorization at the fixture. The check must
// end restartObserved, with no browser and no check folder left.
//
// closed: the OS keeps the browser from starting (a Linux kernel that refuses
// unprivileged user namespaces to an unconfined program). The check must end
// in a closed failure within its bounds, with no browser and no check folder
// left, and nothing reaching the fixture without the proxy.
//
// Prints one JSON report (fixture counts and booleans only) and exits 1 when
// an expectation fails.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

const [distArgument, storage, expectation = 'restartObserved'] = process.argv.slice(2)
if (
  distArgument === undefined ||
  storage === undefined ||
  !['restartObserved', 'closed'].includes(expectation)
) {
  console.error('usage: browser-check-restart.mjs <dist> <storageDir> [restartObserved|closed]')
  process.exit(2)
}
const dist = path.resolve(distArgument)
const require = createRequire(import.meta.url)
const runtime = require(path.join(dist, 'browserRuntime.js'))
const check = require(path.join(dist, 'browserCheck.js'))
const NETWORK_SERVICE = '--utility-sub-type=network.mojom.NetworkService'
const RESOLVER_RULES = '--host-resolver-rules=MAP * ^NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE ::1'
const POLL_MS = 100
const FETCHES_BEFORE_KILL = 4
const FIND_SERVICE_POLLS = 400
const NEW_SERVICE_POLLS = 100
const RESUMED_WANTED = 6
const RESUMED_POLLS = 60
const SETTLE_MS = 1500
const PAGE_EVERY_MS = 150

const state = { killedAt: 0, released: false }
/** Challenged requests at the fixture: { kind, viaProxy, authorization, after }. */
const challenged = []
/** What the page saw of each challenge answer. */
const seen = []
let held = []

const PAGE = `<!doctype html><title>restart</title><p>restart capture</p>
<iframe id="f"></iframe>
<img src="/slow.png" alt="">
<script>
let i = 0
setInterval(() => {
  i += 1
  const n = i
  fetch('/auth-fetch-' + n, { credentials: 'include' }).then(
    (r) => fetch('/seen?n=' + n + '&s=' + r.status + '&wa=' + encodeURIComponent(r.headers.get('www-authenticate') ?? 'none')),
    () => fetch('/seen?n=' + n + '&s=failed&wa=none').catch(() => {}),
  )
  if (n % 3 === 0) document.getElementById('f').src = '/auth-frame-' + n
  fetch('http://c1-' + n + '.invalid/x', { mode: 'no-cors' }).catch(() => {})
  fetch('https://c3-' + n + '.invalid/x', { mode: 'no-cors' }).catch(() => {})
  // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- canary C2's attempt in the restart capture: a plain ws:// to a reserved .invalid name that must arrive refused at the check's own proxy; nothing is ever sent over it (PLAN.md §8).
  try { new WebSocket('ws://c2-' + n + '.invalid/w') } catch {}
  try { new WebSocket('wss://c2s-' + n + '.invalid/w') } catch {}
}, ${String(PAGE_EVERY_MS)})
</script>`

const fixture = createServer((request, response) => {
  const url = request.url ?? ''
  if (url === '/page') {
    response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
    return
  }
  if (url === '/slow.png') {
    // Held until the harness releases it: the page stays mid-load.
    if (state.released) {
      response.writeHead(204).end()
    } else {
      held.push(response)
    }
    return
  }
  const isAfter = state.killedAt !== 0
  if (url.startsWith('/auth-')) {
    challenged.push({
      kind: url.startsWith('/auth-frame') ? 'frame' : 'fetch',
      isViaProxy: (request.headers.connection ?? '').toLowerCase() === 'close',
      hasAuthorization: request.headers.authorization !== undefined,
      isAfter,
    })
    response
      .writeHead(401, [
        'WWW-Authenticate',
        'Negotiate',
        'WWW-Authenticate',
        'NTLM',
        'www-authenticate',
        'Basic realm="m81"',
        'Content-Type',
        'text/plain',
      ])
      .end('challenge')
    return
  }
  if (url.startsWith('/seen?')) {
    const query = new URL(url, 'https://fixture.invalid').searchParams
    seen.push({ status: query.get('s'), hasChallenge: query.get('wa') !== 'none', isAfter })
    response.writeHead(204).end()
    return
  }
  response.writeHead(404).end()
})

/** Every process on this machine: { pid, ppid, cmd }. */
function processes() {
  if (process.platform === 'linux') {
    const found = []
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) {
        continue
      }
      try {
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8')
        const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ', 2)[1])
        const cmd = readFileSync(`/proc/${entry}/cmdline`, 'utf8').replaceAll('\0', ' ')
        found.push({ pid: Number(entry), ppid, cmd })
      } catch {
        // The process ended while it was being read.
      }
    }
    return found
  }
  const text =
    process.platform === 'darwin'
      ? execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], {
          encoding: 'utf8',
          maxBuffer: 64e6,
        })
      : execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-InputFormat',
            'None',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }',
          ],
          { encoding: 'utf8', maxBuffer: 64e6, stdio: ['ignore', 'pipe', 'ignore'] },
        )
  return text
    .split(/\r?\n/)
    .map((line) => /^(\d+)\s+(\d+)\s*(.*)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), cmd: match[3] }))
}

/** This harness's own browser (its child with the pipe) and that browser's network service. */
function owned() {
  const all = processes()
  const browser = all.find(
    (entry) => entry.ppid === process.pid && entry.cmd.includes('--remote-debugging-pipe'),
  )
  const service =
    browser === undefined
      ? undefined
      : all.find((entry) => entry.ppid === browser.pid && entry.cmd.includes(NETWORK_SERVICE))
  return { browser, service }
}

/** Windows quotes a switch value with spaces: compared without the quotes. */
function hasRules(entry) {
  return entry?.cmd.replaceAll('"', '').includes(RESOLVER_RULES) ?? false
}

function counts(isAfter) {
  const part = challenged.filter((entry) => entry.isAfter === isAfter)
  return {
    challenged: part.length,
    viaProxy: part.filter((entry) => entry.isViaProxy).length,
    notViaProxy: part.filter((entry) => !entry.isViaProxy).length,
    authorization: part.filter((entry) => entry.hasAuthorization).length,
  }
}

await new Promise((resolve) => {
  fixture.listen(0, '127.0.0.1', resolve)
})
const address = fixture.address()
const port = typeof address === 'object' && address !== null ? address.port : 0
const startedAt = Date.now()
const report = {
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  expectation,
  modelAttempts: 0,
}
const facts = []
const running = check.runBrowserCheck(
  {
    url: `http://localhost:${String(port)}/page`,
    actions: [],
    allowedHosts: [],
    approvalKey: 'restart',
    includeScreenshot: false,
    signal: new globalThis.AbortController().signal,
  },
  {
    storageDir: storage,
    prepareRuntime: async (request) =>
      await runtime.prepareRuntime({ ...request, consent: () => Promise.resolve('download') }),
    admissionSignal: new globalThis.AbortController().signal,
    admissionStillValid: () => true,
    warn: (fact) => {
      facts.push(fact)
    },
  },
)
const progress = { isFinished: false }
void running.then(() => {
  progress.isFinished = true
})

// Mid-page: a few challenged requests seen, the page's load still held.
let before = { browser: undefined, service: undefined }
for (let poll = 0; !progress.isFinished && poll < FIND_SERVICE_POLLS; poll += 1) {
  await wait(POLL_MS)
  if (challenged.filter((entry) => entry.kind === 'fetch').length < FETCHES_BEFORE_KILL) {
    continue
  }
  before = owned()
  if (before.service !== undefined) {
    break
  }
}
report.browserFound = before.browser !== undefined
report.serviceFound = before.service !== undefined
report.serviceIsChildOfBrowser =
  before.service !== undefined && before.service.ppid === before.browser?.pid
report.serviceRulesBefore = hasRules(before.service)
if (before.service !== undefined && before.browser !== undefined) {
  process.kill(before.service.pid, 'SIGKILL')
  state.killedAt = Date.now()
  let after = { browser: undefined, service: undefined }
  for (let poll = 0; poll < NEW_SERVICE_POLLS; poll += 1) {
    await wait(POLL_MS)
    after = owned()
    if (after.service !== undefined && after.service.pid !== before.service.pid) {
      break
    }
  }
  report.newServicePid = after.service !== undefined && after.service.pid !== before.service.pid
  report.sameBrowserPid = after.browser?.pid === before.browser.pid
  report.serviceRulesAfter = hasRules(after.service)
  // Let the page run on the new service, then let its load finish.
  for (
    let poll = 0;
    poll < RESUMED_POLLS && challenged.filter((entry) => entry.isAfter).length < RESUMED_WANTED;
    poll += 1
  ) {
    await wait(POLL_MS)
  }
}
state.released = true
for (const response of held) {
  response.writeHead(204).end()
}
held = []
const result = await running
report.result = result.ok ? 'ok' : result.failure.kind
report.before = counts(false)
report.after = counts(true)
report.pageSawChallenge = seen.filter((entry) => entry.hasChallenge).length
report.answersSeen = seen.length
report.facts = facts
report.elapsedMs = Date.now() - startedAt
await wait(SETTLE_MS)
report.browserLeft = owned().browser !== undefined
const checkFolders = path.join(storage, 'bc')
report.checkFoldersLeft = existsSync(checkFolders) ? readdirSync(checkFolders).length : 0
fixture.close()

const failed = []
const expectThat = (isTrue, what) => {
  if (!isTrue) {
    failed.push(what)
  }
}
expectThat(!report.browserLeft, 'no browser left')
expectThat(report.checkFoldersLeft === 0, 'no check folder left')
expectThat(
  report.before.notViaProxy + report.after.notViaProxy === 0,
  'every request via the proxy',
)
expectThat(
  report.before.authorization + report.after.authorization === 0,
  'no Authorization at the fixture',
)
expectThat(report.pageSawChallenge === 0, 'the page saw no challenge')
if (expectation === 'restartObserved') {
  expectThat(report.result === 'restartObserved', 'the check ended restartObserved')
  expectThat(report.serviceIsChildOfBrowser, "the network service is the check's browser's child")
  expectThat(report.serviceRulesBefore === true, 'the resolver rule on the service before')
  expectThat(report.newServicePid === true, 'a new network service after the kill')
  expectThat(report.sameBrowserPid === true, 'the same browser after the kill')
  expectThat(report.serviceRulesAfter === true, 'the resolver rule on the new service')
  expectThat(report.after.challenged > 0, 'challenged requests resumed after the restart')
} else {
  expectThat(
    !['ok', 'leaked', 'restartObserved'].includes(report.result),
    'the check refused before its page ran',
  )
}
report.failedExpectations = failed
console.log(JSON.stringify(report, null, 1))
process.exit(failed.length === 0 ? 0 : 1)
