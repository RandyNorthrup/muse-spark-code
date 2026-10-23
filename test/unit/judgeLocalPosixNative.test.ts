// Native rigs execute this file. Refusal only: this does not certify Ollama.
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { posixPeer } from '../../src/core/judge/local/posixPeer'

describe.skipIf(process.platform !== 'linux' && process.platform !== 'darwin')(
  'M98 J2 native POSIX tuple lookup',
  () => {
    it.each(['127.0.0.1', '::1'])(
      'finds the exact owner at %s and refuses a Node relay before bytes',
      async (address) => {
        if (process.platform !== 'linux' && process.platform !== 'darwin')
          throw new Error('unsupported native rig')
        const getUid = process.getuid
        const uid = getUid?.()
        if (uid === undefined) throw new Error('missing native uid')
        let bytes = 0
        const server = createServer((socket) =>
          socket.on('data', (chunk: Buffer) => {
            bytes += chunk.length
          }),
        )
        server.listen(0, address)
        await once(server, 'listening')
        const bound = server.address()
        if (!bound || typeof bound === 'string') throw new Error('missing native socket')
        const socket = createConnection({
          host: address,
          port: bound.port,
          autoSelectFamily: false,
        })
        const closes: unknown[] = []
        const acquires: number[] = []
        const close = () => {
          closes.push(true)
          return Promise.resolve()
        }
        const acquireProcess = (pid: number) => {
          acquires.push(pid)
          expect(pid).toBe(process.pid)
          // This fixture supplies no lifetime attestation; executable refusal
          // precedes all fingerprint/volume checks. Native leases remain required.
          return Promise.resolve({
            identity: () =>
              Promise.resolve({
                pid,
                uid,
                creationTime: '1',
                executable: process.execPath,
              }),
            isAlive: () => Promise.resolve(false),
            close,
          })
        }
        try {
          await once(socket, 'connect')
          let refusal: unknown
          try {
            await posixPeer(
              socket,
              {
                platform: process.platform,
                executable: '/unrecognized/ollama',
                executableDigest: 'invalid',
                uid,
                modelDirectory: '/unused',
              },
              { acquireProcess, verifyLocalVolume: () => Promise.reject(new Error('unused')) },
              new AbortController().signal,
            )
          } catch (error: unknown) {
            refusal = error
          }
          // A desktop rig can hide another same-UID task's descriptors. That
          // is a real visibility refusal, not positive tuple certification.
          // Isolated-UID IPv4/IPv6 positive receipts live in m98p2-j.md.
          expect(refusal).toBeInstanceOf(Error)
          if (refusal instanceof Error && refusal.message.startsWith('unverified-hidden-')) {
            expect(acquires).toHaveLength(0)
            expect(closes).toHaveLength(0)
          } else {
            expect(refusal).toMatchObject({ message: 'unverified-runtime' })
            expect(acquires).toHaveLength(1)
            expect(closes).toHaveLength(1)
          }
          expect(bytes).toBe(0)
          expect(socket.bytesWritten).toBe(0)
        } finally {
          socket.destroy()
          await new Promise<void>((resolve) =>
            server.close(() => {
              resolve()
            }),
          )
        }
      },
    )
  },
)
