import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { requestLocal } from '../../src/core/judge/local/transport'
import { requireInstalledPeer, windowsPeer } from '../../src/core/judge/local/windowsPeer'
import { compilePeer, endListener, nodeListener } from './helpers/localJudgeWindows'

const installed = {
  executable: String.raw`C:\Users\test\AppData\Local\Programs\Ollama\ollama.exe`,
  ownerSid: 'S-1-5-21-test',
  executableDigest: 'a'.repeat(64),
}
const original = {
  ...installed,
  callerSid: installed.ownerSid,
  pid: 1234,
  creationTime: '134356345988239984',
}

describe('M98-2j process identity', () => {
  it('links the spike helper evidence to the promoted native source', async () => {
    const receipt = path.resolve('docs/certification/m98-2j-spike.md')
    const text = await readFile(receipt, 'utf8')
    const link = /\[reviewed[^\]]*C# helper\]\(([^)]+)\)/.exec(text)
    expect(link).not.toBeNull()
    const target = path.resolve(path.dirname(receipt), link![1]!)
    expect(target).toBe(path.resolve('native/windows/MuseSparkLocalJudgePeer.cs'))
    await expect(readFile(target, 'utf8')).resolves.toContain('GetExtendedTcpTable')
  })
  it('accepts the same installed executable, SID and process generation', () => {
    expect(() => {
      requireInstalledPeer(original, installed, original)
    }).not.toThrow()
  })
  it('checks the binary digest even without a previous connection', () => {
    expect(() => {
      requireInstalledPeer({ ...original, executableDigest: 'b'.repeat(64) }, installed)
    }).toThrow('unverified-runtime')
  })
  it.each([
    { ...original, creationTime: '134356345988239985' },
    { ...original, pid: 1235 },
    { ...original, ownerSid: 'S-1-5-21-other' },
    { ...original, callerSid: 'S-1-5-21-other' },
    { ...original, executableDigest: 'b'.repeat(64) },
    { ...original, executable: String.raw`C:\Windows\System32\OpenSSH\ssh.exe` },
    { ...original, executable: String.raw`C:\relay\ollama.exe` },
    { ...original, executable: String.raw`C:\Windows\System32\wslrelay.exe` },
  ])('refuses PID reuse, replacement and forwarding: $executable, $creationTime', (identity) => {
    expect(() => {
      requireInstalledPeer(identity, installed, original)
    }).toThrow('unverified-runtime')
  })
})

describe.skipIf(process.platform !== 'win32')('M98-2j real Windows TCP-table helper', () => {
  let helper = ''
  beforeAll(async () => {
    helper = await compilePeer()
  })

  it('distinguishes simultaneous connections to the same listener by client port', async () => {
    const peer = await nodeListener('127.0.0.1')
    const sockets = [
      createConnection({ host: '127.0.0.1', port: peer.port }),
      createConnection({ host: '127.0.0.1', port: peer.port }),
    ]
    try {
      await Promise.all(
        sockets.map(async (socket) => {
          await once(socket, 'connect')
        }),
      )
      for (const socket of sockets) {
        const actual = await windowsPeer(helper, socket)
        expect(actual.pid).toBe(peer.child.pid)
      }
      expect(sockets[0]!.localPort).not.toBe(sockets[1]!.localPort)
    } finally {
      for (const socket of sockets) socket.destroy()
      await endListener(peer.child)
    }
  })

  it('finds distinct IPv4 and IPv6 server owners from their exact reversed tuples', async () => {
    const peers = await Promise.all([nodeListener('127.0.0.1'), nodeListener('::1')])
    try {
      for (const [index, peer] of peers.entries()) {
        const address = index === 0 ? '127.0.0.1' : '::1'
        const socket = createConnection({ host: address, port: peer.port })
        try {
          await once(socket, 'connect')
          const identity = await windowsPeer(helper, socket)
          expect(identity.pid).toBe(peer.child.pid)
          expect(path.win32.basename(identity.executable)).toBe('node.exe')
          expect(() => {
            requireInstalledPeer(identity, installed)
          }).toThrow('unverified-runtime')
          expect(socket.bytesWritten).toBe(0)
        } finally {
          socket.destroy()
        }
      }
    } finally {
      for (const peer of peers) await endListener(peer.child)
    }
  })

  it('refuses a same-user relay even when its upstream answers valid HTTP', async () => {
    const upstream = await nodeListener('127.0.0.1')
    const relay = await nodeListener('127.0.0.1', 0, upstream.port)
    try {
      await expect(
        requestLocal(
          { address: '127.0.0.1', port: relay.port },
          '/api/chat',
          async (socket) => {
            const identity = await windowsPeer(helper, socket)
            expect(identity.pid).toBe(relay.child.pid)
            requireInstalledPeer(identity, installed)
          },
          'private-state',
        ),
      ).rejects.toThrow('unverified-runtime')
    } finally {
      await endListener(relay.child)
      await endListener(upstream.child)
    }
  })

  it('does not retain a verdict across clean close and immediate port replacement', async () => {
    const old = await nodeListener('127.0.0.1')
    let oldIdentity: Awaited<ReturnType<typeof windowsPeer>> | undefined
    await requestLocal({ address: '127.0.0.1', port: old.port }, '/api/tags', async (socket) => {
      oldIdentity = await windowsPeer(helper, socket)
    })
    await endListener(old.child)
    const replacement = await nodeListener('127.0.0.1', old.port)
    try {
      await expect(
        requestLocal(
          { address: '127.0.0.1', port: old.port },
          '/api/chat',
          async (socket) => {
            const actual = await windowsPeer(helper, socket)
            expect(actual.pid).toBe(replacement.child.pid)
            requireInstalledPeer(
              actual,
              {
                executable: actual.executable,
                ownerSid: actual.ownerSid,
                executableDigest: actual.executableDigest,
              },
              oldIdentity,
            )
          },
          'private-state',
        ),
      ).rejects.toThrow('unverified-runtime')
    } finally {
      await endListener(replacement.child)
    }
  })

  it('refuses a vanished row, bad helper output and a closed socket', async () => {
    const peer = await nodeListener('127.0.0.1')
    const socket = createConnection({ host: '127.0.0.1', port: peer.port })
    socket.on('error', () => {
      /* The killed fixture resets its socket. */
    })
    try {
      await once(socket, 'connect')
      await expect(windowsPeer(process.execPath, socket)).rejects.toThrow()
      await endListener(peer.child)
      await expect(windowsPeer(helper, socket)).rejects.toThrow()
      socket.destroy()
      await expect(windowsPeer(helper, socket)).rejects.toThrow('unverified-peer')
    } finally {
      socket.destroy()
    }
  })
})
