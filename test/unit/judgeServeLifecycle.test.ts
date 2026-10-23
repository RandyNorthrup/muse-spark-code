import { Buffer } from 'node:buffer'
import { fork, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { request } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { withoutCredentials, withoutKeyringRoutes } from '../../src/runtime/credentialVariables'

const readySchema = z.strictObject({
  url: z.string(),
  tokenPath: z.string(),
  phase: z.enum(['ready', 'sync', 'close']),
})
const children: {
  child: ChildProcess
  ended: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}[] = []
const folders: string[] = []
afterEach(async () => {
  for (const running of children.splice(0)) {
    if (running.child.exitCode === null && running.child.signalCode === null)
      running.child.kill('SIGKILL')
    await running.ended
  }
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
// A fake request-only source under test/**. Actual server, filesystem, OS
// process, sockets and signal handling run in the rig's installed Node.
const CHILD_SOURCE = `
import * as z from 'zod/mini'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { startJudgeServer } from './src/runtime/judge/serve'
const parent = z.string().parse(process.argv[2])
const port = Number(process.argv[3])
const phase = z.enum(['ready', 'sync', 'close']).parse(process.argv[4])
const disconnect = () => { if (process.connected) process.disconnect() }
process.once('SIGINT', disconnect)
process.once('SIGTERM', disconnect)
process.on('message', (value) => {
  const command = z.enum(['fatal', 'disconnect', 'SIGINT', 'SIGTERM']).parse(value)
  if (command === 'SIGINT' || command === 'SIGTERM') {
    process.emit(command)
    return
  }
  disconnect()
  if (command === 'fatal') throw new Error('synthetic fatal exit')
})
if (phase !== 'ready') {
  const open = fs.open
  fs.open = async (...args) => {
    const handle = await open(...args)
    if (path.basename(String(args[0])) === 'bearer') {
      handle[phase] = async () => {
        process.send?.({ url: '', tokenPath: String(args[0]), phase })
        await new Promise(() => {})
      }
    }
    return handle
  }
  syncBuiltinESMExports()
}
const service = await startJudgeServer({ tokenDirectory: parent, port, runtime: { judge: () => Promise.resolve({ outcome: 'no-answer', reason: 'source-unavailable' }) } })
process.send?.({ url: service.url, tokenPath: service.tokenPath, phase })
`
async function launch(port = 0, phase: 'ready' | 'sync' | 'close' = 'ready') {
  const folder = await mkdtemp(path.join(process.cwd(), '.judge-lifecycle-test-'))
  folders.push(folder)
  const bundle = path.join(folder, 'fake-source.mjs')
  await build({
    stdin: { contents: CHILD_SOURCE, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: bundle,
    logLevel: 'silent',
  })
  const child = fork(bundle, [folder, String(port), phase], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: withoutKeyringRoutes(withoutCredentials(process.env)),
  })
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })
  children.push({ child, ended })
  const frame = await new Promise<unknown>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => {
      reject(new Error('fake source exited before ready'))
    })
    child.once('message', resolve)
  })
  return { ...readySchema.parse(frame), child, ended }
}
function gracefulSignal(service: Awaited<ReturnType<typeof launch>>, signal: 'SIGINT' | 'SIGTERM') {
  // Windows child.kill force-terminates; IPC exercises the registered Node handler.
  // POSIX continues to deliver the actual OS signal. Hard-kill rotation is real on both.
  if (process.platform === 'win32') service.child.send(signal)
  else service.child.kill(signal)
}
async function endedWithin(service: Awaited<ReturnType<typeof launch>>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('process lifecycle did not exit'))
    }, 5000)
  })
  try {
    return await Promise.race([service.ended, deadline])
  } finally {
    clearTimeout(timer)
  }
}
async function status(url: string, token: string) {
  const address = new URL(url)
  const body = JSON.stringify({
    state: 'synthetic',
    questions: { risk: { type: 'noul', instructions: 'Synthetic?' } },
  })
  return await new Promise<number>((resolve, reject) => {
    const call = request(
      {
        hostname: address.hostname,
        port: address.port,
        path: address.pathname,
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        response.resume()
        response.once('end', () => {
          resolve(response.statusCode ?? 0)
        })
      },
    )
    call.once('error', reject)
    call.end(body)
  })
}
describe('judge serve installed Node lifecycle', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'deletes its bearer and closes the listener on %s',
    async (signal) => {
      const service = await launch()
      const token = await readFile(service.tokenPath, 'utf8')
      expect(await status(service.url, token)).toBe(403)
      gracefulSignal(service, signal)
      expect(await endedWithin(service)).toEqual({ code: 0, signal: null })
      await expect(stat(service.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(status(service.url, token)).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    },
  )
  it('runs synchronous bearer cleanup on a fatal Node exit', async () => {
    const service = await launch()
    service.child.send('fatal')
    expect(await endedWithin(service)).toEqual({ code: 1, signal: null })
    await expect(stat(service.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['sync', 'close'] as const)(
    'removes a written startup bearer on fatal exit while %s is pending',
    async (phase) => {
      const service = await launch(0, phase)
      expect(service.phase).toBe(phase)
      const written = await stat(service.tokenPath)
      expect(written.size).toBeGreaterThan(0)
      service.child.send('fatal')
      expect(await endedWithin(service)).toEqual({ code: 1, signal: null })
      await expect(stat(service.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(path.dirname(service.tokenPath))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )
  it('never authenticates a crash token when the same port restarts', async () => {
    const crashed = await launch()
    const old = await readFile(crashed.tokenPath, 'utf8')
    crashed.child.kill('SIGKILL')
    expect(await endedWithin(crashed)).toEqual({ code: null, signal: 'SIGKILL' })
    // A hard kill has no exit handler. The stale private file is evidence,
    // not a reusable service credential or a refunded admission claim.
    const stale = await stat(crashed.tokenPath)
    expect(stale.isFile()).toBe(true)
    const restarted = await launch(Number(new URL(crashed.url).port))
    const current = await readFile(restarted.tokenPath, 'utf8')
    expect(old === current).toBe(false)
    expect(await status(restarted.url, old)).toBe(401)
    expect(await status(restarted.url, current)).toBe(403)
    gracefulSignal(restarted, 'SIGTERM')
    await endedWithin(restarted)
    await expect(stat(restarted.tokenPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
