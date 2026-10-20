import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as z from 'zod/mini'
import { setTimeout as delay } from 'node:timers/promises'
import { vaultBrokerLockSchema } from '../../../src/shared/vaultProtocol'
import { buildBrokerChildren } from '../helpers/vault/sessionBrokerBuild'
import { stopFixtureChild } from '../helpers/vault/fixtureChildren'
import { hasBrokerSocketFit } from '../helpers/vault/socketFit'

const fixture = { root: '' }
const children = new Set<ChildProcess>()
const brokers = new Set<number>()
const hasSocketFit = hasBrokerSocketFit()
beforeAll(async () => {
  if (!hasSocketFit || process.platform === 'win32') return
  fixture.root = await mkdtemp(path.join(os.tmpdir(), 'vs-'))
  await buildBrokerChildren(fixture.root, [
    ['sessionClientChild', 'client.cjs'],
    ['sessionBrokerChild', 'vaultBroker.js'],
  ])
})
afterAll(async () => {
  for (const child of children) {
    child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }
  for (const pid of brokers) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* Exited. */
    }
  }
  if (!fixture.root) {
    return
  }

  await delay(200)
  await rm(fixture.root, { recursive: true, force: true })
})
function client(data: string, id: string) {
  const runtimeDir = process.env['XDG_RUNTIME_DIR']
  const child = fork(
    path.join(fixture.root, 'dist', 'client.cjs'),
    [data, fixture.root, id.repeat(32)],
    {
      // The product forwards the session runtime directory to the broker
      // (posixClientPlatform); the fixture passes the worker's own through,
      // so the broker resolves its socket base the way an installed session
      // does instead of falling back to the fixture root.
      env: {
        HOME: fixture.root,
        ...(runtimeDir !== undefined && { XDG_RUNTIME_DIR: runtimeDir }),
      },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    },
  )
  children.add(child)
  return Promise.resolve(child)
}
async function ready(child: ChildProcess): Promise<{ pid: number; directory: string }> {
  const messages: unknown = await once(child, 'message')
  const [message] = z
    .tuple([z.strictObject({ pid: z.number(), directory: z.string() }), z.unknown()])
    .parse(messages)
  brokers.add(message.pid)
  return message
}
async function close(child: ChildProcess) {
  const exited = once(child, 'exit')
  child.send('close')
  await exited
  children.delete(child)
}
async function status(child: ChildProcess) {
  const reply = once(child, 'message')
  child.send('status')
  const messages = await reply
  expect(messages[0]).toMatchObject({ kind: 'status' })
}
async function cleaned(directory: string) {
  const lock = vaultBrokerLockSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'broker.lock'), 'utf8')),
  )
  process.kill(lock.processId, 'SIGTERM')
  for (let count = 0; count < 100; count++) {
    const files = await readdir(directory)
    if (files.toSorted((a, b) => a.localeCompare(b)).join(',') === 'launch.lock,startup.lock') break
    await delay(10)
  }
  const files = await readdir(directory)
  expect(files.toSorted((a, b) => a.localeCompare(b))).toEqual(['launch.lock', 'startup.lock'])
  expect(await readdir(path.join(path.dirname(directory), 'hosts'))).toEqual([])
  for (const file of ['launch.lock', 'startup.lock']) {
    const sample = await stat(path.join(directory, file))
    expect(sample.mode & 0o777).toBe(0o600)
  }
}
describe.skipIf(!hasSocketFit || process.platform === 'win32')('session-owned POSIX broker', () => {
  it('survives orderly launcher resource shutdown and locks only after its last client leaves', async () => {
    const data = path.join(fixture.root, 'lifetime')
    const a = await client(data, 'a')
    const location = await ready(a)
    const b = await client(data, 'b')
    const other = await ready(b)
    expect(other.pid).toBe(location.pid)
    await close(a)
    await delay(300)
    await status(b)
    await close(b)
    await cleaned(location.directory)
  })
  it('connects simultaneous real clients to one broker through the kernel launch lock', async () => {
    const data = path.join(fixture.root, 'race')
    const clients = await Promise.all(['a', 'b', 'c', 'd'].map((id) => client(data, id)))
    const locations = await Promise.all(clients.map((child) => ready(child)))
    expect(new Set(locations.map((location) => location.pid)).size).toBe(1)
    for (const child of clients) await status(child)
    await Promise.all(clients.map((child) => close(child)))
    const location = locations[0]
    if (!location) throw new Error('missing generated location')
    await cleaned(location.directory)
  })
  it('survives its launcher dying between spawn and readiness', async () => {
    await writeFile(path.join(fixture.root, 'gate'), 'wait')
    const data = path.join(fixture.root, 'early-death')
    const a = await client(data, 'a')
    for (let count = 0; count < 100; count++) {
      try {
        brokers.add(Number(await readFile(path.join(fixture.root, 'spawned'), 'utf8')))
        break
      } catch {
        await delay(10)
      }
    }
    const exited = once(a, 'exit')
    a.kill('SIGKILL')
    await exited
    children.delete(a)
    await writeFile(path.join(fixture.root, 'gate'), 'go')
    const b = await client(data, 'b')
    const location = await ready(b)
    expect(location.pid).toBe(Number(await readFile(path.join(fixture.root, 'spawned'), 'utf8')))
    await status(b)
    expect(await readdir(path.join(path.dirname(location.directory), 'hosts'))).toEqual([
      'b'.repeat(32),
    ])
    await close(b)
    await cleaned(location.directory)
    await rm(path.join(fixture.root, 'gate'))
  })
  it('keeps readiness and diagnostics harmless when actual reading pipes close', async () => {
    const dataDir = path.join(fixture.root, 'closed-pipes', 'vault')
    const child = spawn(
      process.execPath,
      [
        path.join(fixture.root, 'dist', 'vaultBroker.js'),
        JSON.stringify({
          dataDir,
          runDirectory: path.join(dataDir, 'run'),
          installRoot: fixture.root,
          userSession: 'test',
        }),
      ],
      // The broker names its machine identity from the environment, like the
      // crash children: without one it cannot start and is refused fail-closed.
      { env: globalThis.process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    )
    children.add(child)
    if (child.pid !== undefined) brokers.add(child.pid)
    if (child.stdout === null || child.stderr === null)
      throw new Error('missing fixture diagnostic pipes')
    child.stdout.destroy()
    child.stderr.destroy()
    const ready = await once(child, 'message')
    expect(ready[0]).toEqual({ ready: true })
    await stopFixtureChild(children, child)
    const directories = await readdir(path.join(dataDir, 'run'))
    const broker = directories.find((name) => name.startsWith('broker-'))
    if (!broker) throw new Error('missing generated broker directory')
    expect(await readdir(path.join(dataDir, 'run', broker))).toEqual(['startup.lock'])
  })
})
