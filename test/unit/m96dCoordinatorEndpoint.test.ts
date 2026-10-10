import { once } from 'node:events'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { createConnection, createServer, type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import * as z from 'zod/mini'
import { expect, it } from 'vitest'
import { CoordinatorSpecification } from './helpers/m96dCoordinatorSpecification'

it('F1: an unavailable native endpoint leaves its existing owner and admitted work alive', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm96d-'))
  const endpoint =
    process.platform === 'win32'
      ? String.raw`\\.\pipe\m96d-${randomUUID()}`
      : path.join(directory, 'owner.sock')
  const connections = new Set<Socket>()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.on('error', () => {
      // Cleanup may destroy the peer while an echo is in flight.
    })
    socket.pipe(socket)
  })
  const spec = new CoordinatorSpecification('epoch-A')
  expect(spec.reserve('grant-A', 'owner-A', ['landing', 'worker'])).toBe(true)
  let original: Socket | undefined
  let probe: Socket | undefined
  try {
    server.listen(endpoint)
    await once(server, 'listening')
    const accepted = once(server, 'connection')
    original = createConnection(endpoint)
    await once(original, 'connect')
    await accepted
    if (process.platform === 'win32') server.close()
    else await unlink(endpoint)

    probe = createConnection(endpoint)
    const [failure] = await once(probe, 'error')
    const { code } = z.object({ code: z.string() }).parse(failure)
    expect(['ENOENT', 'ECONNREFUSED']).toContain(code)
    spec.endpointFailed(code)
    expect(spec.electSuccessor(false)).toBe(false)
    expect(spec.reserve('grant-B', 'owner-B', ['landing', 'worker'])).toBe(false)
    expect(spec.held('grant-A')).toEqual(['landing', 'worker'])

    // The very same listener process still services an admitted connection.
    const received = once(original, 'data')
    original.write('owner-still-alive')
    const [echo] = await received
    if (!Buffer.isBuffer(echo)) throw new Error('Expected an echo buffer')
    expect(echo.toString('utf8')).toBe('owner-still-alive')
    expect(server.listening).toBe(process.platform !== 'win32')
  } finally {
    original?.destroy()
    probe?.destroy()
    for (const socket of connections) socket.destroy()
    if (server.listening)
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    await rm(directory, { recursive: true, force: true })
  }
})
