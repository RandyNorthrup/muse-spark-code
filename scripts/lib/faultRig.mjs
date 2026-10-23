// The M110r Y4 fault-injection rig's shared library: recorded streams
// re-encoded as SSE bytes, a loopback cutter that destroys the socket at
// a chosen byte, real-socket readers, heartbeat frames, and the
// namespace probe. No answers are synthesized: the cutter forwards bytes
// of a recorded exchange (test/fixtures/m106/u9-raw-strict-stream.json,
// captured 2026-10-10) and cuts the transport under them. Run through
// scripts/fault-rig.mjs, never directly.

import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Rig exits: pass, failed assertion, environment refused. */
export const FAULT_EXIT = { pass: 0, fail: 1, refused: 2 }

/** A failed scenario assertion. */
export class FaultAssertion extends Error {
  constructor(message) {
    super(message)
    this.name = 'FaultAssertion'
  }
}

/** A requirement the environment cannot meet (namespaces, binaries). */
export class FaultRefused extends Error {
  constructor(message) {
    super(message)
    this.name = 'FaultRefused'
  }
}

/** Assert, naming the scenario fact that failed. */
export function checkFact(condition, message) {
  if (!condition) throw new FaultAssertion(message)
}

/**
One recorded frame re-encoded as SSE bytes (`event:` / `data:` / blank
line), the mechanical encoding of the recorded exchange.
*/
export function frameToSse(frame) {
  return `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`
}

/** Load the recorded stream fixture as SSE bytes plus its parsed frames. */
export async function loadRecordedStream(repoRoot) {
  const raw = await readFile(
    path.join(repoRoot, 'test', 'fixtures', 'm106', 'u9-raw-strict-stream.json'),
    'utf8',
  )
  const fixture = JSON.parse(raw)
  const frames = fixture.frames
  const bytes = Buffer.from(frames.map((frame) => frameToSse(frame)).join(''), 'utf8')
  return { bytes, frames }
}

/**
Serve `bytes` on loopback, then destroy the socket after `cutAt` bytes:
the client reads a real stream that ends mid-event. Resolves with the
port and a close function; rejects when nothing connects in time.
*/
export async function serveAndCut(bytes, cutAt) {
  const server = createServer()
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    throw new FaultAssertion('cutter has no loopback port')
  }
  const port = address.port
  let hasServed = false
  server.on('connection', (socket) => {
    hasServed = true
    socket.write(bytes.subarray(0, cutAt))
    socket.destroy()
  })
  const close = async () => {
    await new Promise((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    checkFact(hasServed, 'cutter served no connection')
  }
  return { port, close }
}

/**
Read everything a loopback port sends as socket chunks: a real
AsyncIterable<Uint8Array> for the real SSE parser. A destroyed socket
ends the read; the bytes before it are complete.
*/
export async function* readSocketChunks(port) {
  const socket = connect(port, '127.0.0.1')
  try {
    for await (const chunk of socket) {
      yield chunk
    }
  } finally {
    socket.destroy()
  }
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr })
    })
  })
}

/**
Whether this machine can run the namespace scenarios: Linux, the `ip`
binary, and root or passwordless sudo for `ip netns`. Refuses loudly
otherwise, naming exactly what is missing.
*/
export async function probeNamespaces() {
  if (process.platform !== 'linux') {
    return { ok: false, reason: `namespaces need Linux, this is ${process.platform}` }
  }
  const ip = await runCommand('ip', ['-Version'])
  if (ip.error) {
    return { ok: false, reason: '`ip` is not installed' }
  }
  if (process.getuid?.() === 0) return { ok: true, sudo: [] }
  const sudo = await runCommand('sudo', ['-n', 'true'])
  return sudo.error
    ? { ok: false, reason: 'namespaces need root or passwordless sudo' }
    : { ok: true, sudo: ['sudo', '-n'] }
}

/** Run `ip` (through sudo when needed) for namespace setup; failures throw. */
export async function namespaceIp(sudo, args) {
  const command = sudo.length > 0 ? sudo[0] : 'ip'
  const commandArgs = sudo.length > 0 ? [...sudo.slice(1), 'ip', ...args] : args
  const result = await runCommand(command, commandArgs)
  if (result.error) {
    throw new FaultAssertion(`ip ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

/**
Bundle one scenario (TypeScript, importing the real sources) with the
repository's own esbuild and load it. Bundles land in the worktree's
gitignored temp/, one file per scenario.
*/
export async function loadScenario(repoRoot, name) {
  const { build } = await import('esbuild')
  const { mkdir, writeFile } = await import('node:fs/promises')
  const outDir = path.join(repoRoot, 'temp', 'fault-rig')
  await mkdir(outDir, { recursive: true })
  const entry = path.join(repoRoot, 'test', 'faults', 'scenarios', `${name}.ts`)
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const bundled = result.outputFiles?.[0]?.text
  if (bundled === undefined) throw new FaultAssertion(`scenario did not bundle: ${name}`)
  const outFile = path.join(outDir, `${name}.mjs`)
  await writeFile(outFile, bundled)
  const module = await import(`${pathToFileURL(outFile).href}?bundle=${String(Date.now())}`)
  return module.scenario
}
