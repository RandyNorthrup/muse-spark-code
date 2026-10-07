import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createConnection, type Socket } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { darwinProcessLease } from '../../src/core/judge/local/darwinPeer'
import { posixPeer } from '../../src/core/judge/local/posixPeer'

const helper = path.resolve('native/darwin/muse-local-judge-peer')
async function listener(address: string, port = 0, target = 0) {
  const child = spawn(
    process.execPath,
    ['test/unit/helpers/localJudgeRelay.mjs', address, String(port), String(target)],
    { env: {}, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const [data]: unknown[] = await once(child.stdout, 'data')
  if (!Buffer.isBuffer(data)) throw new Error('missing fixture listener')
  const decoded: unknown = JSON.parse(data.toString())
  return { child, port: z.object({ port: z.number().int().positive() }).parse(decoded).port }
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
}
async function connect(address: string, port: number): Promise<Socket> {
  const socket = createConnection({ host: address, port, autoSelectFamily: false })
  await once(socket, 'connect')
  return socket
}
async function refusal(socket: Socket, expected: number | undefined) {
  const getUid = process.getuid
  const uid = getUid?.()
  if (uid === undefined || expected === undefined) throw new Error('missing native owner')
  const acquireProcess = vi.fn(async (pid: number, signal: AbortSignal) => {
    expect(pid).toBe(expected)
    return await darwinProcessLease(helper, pid, signal)
  })
  const verifyLocalVolume = vi.fn(() =>
    Promise.reject(new Error('Node owner must never open model files')),
  )
  await expect(
    posixPeer(
      socket,
      {
        platform: 'darwin',
        // Even declaring this Node binary cannot make it an Ollama runtime.
        executable: process.execPath,
        executableDigest: 'invalid',
        uid,
        modelDirectory: '/unused',
      },
      { acquireProcess, verifyLocalVolume },
      new AbortController().signal,
    ),
  ).rejects.toThrow('unverified-runtime')
  expect(acquireProcess).toHaveBeenCalledTimes(1)
  expect(verifyLocalVolume).not.toHaveBeenCalled()
  expect(socket.bytesWritten).toBe(0)
}

describe.skipIf(process.platform !== 'darwin')(
  'M98 macOS native reconnect/replacement/forward refusal',
  () => {
    it.each(['127.0.0.1', '::1'])(
      'identifies simultaneous sockets, clean reconnect and replacement at %s',
      async (address) => {
        const original = await listener(address)
        const sockets: Socket[] = []
        let replacement: Awaited<ReturnType<typeof listener>> | undefined
        try {
          for (let attempt = 0; attempt < 2; attempt++)
            sockets.push(await connect(address, original.port))
          expect(sockets[0]?.localPort).not.toBe(sockets[1]?.localPort)
          for (const socket of sockets) await refusal(socket, original.child.pid)
          sockets.push(await connect(address, original.port))
          await refusal(sockets[2]!, original.child.pid)
          for (const socket of sockets) socket.destroy()
          await stop(original.child)
          replacement = await listener(address, original.port)
          expect(replacement.child.pid).not.toBe(original.child.pid)
          sockets.push(await connect(address, replacement.port))
          await refusal(sockets[3]!, replacement.child.pid)
        } finally {
          for (const socket of sockets) socket.destroy()
          await stop(original.child)
          if (replacement) await stop(replacement.child)
        }
      },
    )
    it('identifies the same-user forwarding process and refuses before HTTP bytes', async () => {
      const upstream = await listener('127.0.0.1')
      const relay = await listener('127.0.0.1', 0, upstream.port)
      const socket = await connect('127.0.0.1', relay.port)
      try {
        await refusal(socket, relay.child.pid)
      } finally {
        socket.destroy()
        await stop(relay.child)
        await stop(upstream.child)
      }
    })
  },
)
