// A test-owned fake of the installed agent's `exec --key-stdin` and
// `scan-secrets <file> --key-stdin` commands for the Action's tests (M80
// lane C). It makes no network or model call. Its scenario is
// fake-scenario.json in its working directory (the invocation's private
// work folder), and it appends what it received (argv, environment, the key
// line it read, any signal) to fake-report.jsonl there for the assertions.
// The exec contract it imitates is lane A's frozen JSONL/result protocol.

import { Buffer } from 'node:buffer'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { setInterval } from 'node:timers'

const [command, ...args] = process.argv.slice(2)
const scenario = JSON.parse(readFileSync('fake-scenario.json', 'utf8'))
const part = (command === 'exec' ? scenario.exec : scenario.scan) ?? {}
const SIGNAL_CODES = { SIGINT: 130, SIGTERM: 143 }
const SECRET = /ghp_[A-Za-z0-9]{36}/g

function report(extra) {
  appendFileSync(
    'fake-report.jsonl',
    `${JSON.stringify({ command, args, env: process.env, pid: process.pid, ...extra })}\n`,
  )
}

function readKeyLine() {
  return new Promise((resolve) => {
    let text = ''
    const done = () => {
      process.stdin.removeAllListeners()
      process.stdin.destroy()
      resolve(text.split('\n', 1)[0])
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      text += chunk
      if (text.includes('\n')) done()
    })
    process.stdin.on('end', done)
  })
}

function hang() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      report({ signal })
      if (!part.ignoreSignals) process.exit(SIGNAL_CODES[signal])
    })
  }
  // Only now do the handlers above own SIGINT and SIGTERM: a test sends its
  // first signal after this line, never on the earlier key-line report.
  report({ ready: true })
  setInterval(() => {
    // Keeps the process alive until a signal or a kill.
  }, 1000)
}

function envelope(seq, body) {
  return JSON.stringify({ v: 1, seq, time: new Date(0).toISOString(), ...body })
}

function execOutput() {
  if (Array.isArray(part.lines)) return part.lines.map((line) => `${line}\n`).join('')
  const lines = [
    envelope(1, { type: 'tool', name: 'read_file', status: 'completed', durationMs: 1 }),
  ]
  if (part.result !== undefined) lines.push(envelope(2, { type: 'result', result: part.result }))
  return lines.map((line) => `${line}\n`).join('')
}

function applyEdits(cwd) {
  const writes = part.writes ?? []
  for (const edit of writes) {
    const target = path.join(cwd, edit.path)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      edit.base64 === undefined ? edit.text : Buffer.from(edit.base64, 'base64'),
    )
  }
  const removes = part.removes ?? []
  for (const removed of removes) rmSync(path.join(cwd, removed), { force: true })
}

async function runExec() {
  const key = await readKeyLine()
  report({ keyLine: key })
  if (part.stderr !== undefined) process.stderr.write(part.stderr.replaceAll('{key}', () => key))
  if (part.flood !== undefined) process.stdout.write('x'.repeat(part.flood))
  if (part.hang) {
    hang()
    return
  }
  applyEdits(args[args.indexOf('--cwd') + 1])
  process.stdout.write(execOutput(), () => {
    process.exit(part.exitCode ?? part.result?.exitCode ?? 0)
  })
}

function scanAndExit(key, mode) {
  const text = readFileSync(args[0], 'utf8')
  const count = text.split(key).length - 1 + (text.match(SECRET) ?? []).length
  const shown = mode === 'lie' ? 0 : count
  process.stdout.write(`${String(shown)} secret matches\n`, () => {
    process.exit(count === 0 ? 0 : 10)
  })
}

async function runScan() {
  const key = await readKeyLine()
  report({ keyLine: key, file: args[0] })
  const mode = part.mode ?? 'real'
  switch (mode) {
    case 'hang': {
      hang()
      break
    }
    case 'exit2': {
      process.exit(2)
      break
    }
    case 'malformed': {
      process.stdout.write('clean\n', () => process.exit(0))
      break
    }
    case 'flood': {
      process.stdout.write('9'.repeat(70_000))
      scanAndExit(key, mode)
      break
    }
    default: {
      scanAndExit(key, mode)
    }
  }
}

if (command === 'exec') await runExec()
else await runScan()
