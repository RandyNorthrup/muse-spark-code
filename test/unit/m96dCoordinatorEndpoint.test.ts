// M96d F1 native discovery drills against the production endpoint:
// a real Unix socket (a named pipe on Windows), a real beacon, and the
// removal semantics the design's recovery chapter rests on.
import { mkdtemp, open, rm, unlink } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COORDINATOR_SOCKET_PATH_MAX_BYTES } from '../../src/shared/constants'
import {
  discoveryEndpointAddress,
  isCoordinatorEndpointError,
  probeDiscoveryEndpoint,
  startDiscoveryEndpoint,
} from '../../src/core/team/coordinator/endpoint'
import { canReadProcessBirth } from './helpers/processBirth'

const execFileAsync = promisify(execFile)

const stores: string[] = []
afterEach(async () => {
  for (const directory of stores.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/** A short socket directory: Unix paths must fit `sun_path` even under a long TMPDIR. */
async function socketDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join('temp', 'm96d-endpoint-'))
  stores.push(directory)
  return directory
}

async function readLine(socket: {
  on(event: string, listener: (...args: never[]) => void): void
}): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    let text = ''
    socket.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
      const end = text.indexOf('\n')
      if (end !== -1) resolve(text.slice(0, end))
    })
    socket.on('error', reject)
  })
}

/** Serve one speech on a socket: the probe must read it as a foreign speaker. */
async function expectForeignSpeaker(
  directory: string,
  name: string,
  speak: (socket: Socket) => void,
): Promise<void> {
  const address = discoveryEndpointAddress(directory, name)
  const server = createServer((socket) => {
    socket.on('error', () => {
      socket.destroy()
    })
    speak(socket)
  })
  await new Promise<void>((resolve) => {
    server.listen(address.path, () => {
      resolve()
    })
  })
  try {
    expect(await probeDiscoveryEndpoint(address)).toEqual({
      reachable: false,
      code: 'badBeacon',
    })
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
}

describe('M96d discovery endpoint', () => {
  it('publishes a beacon the probe validates', async () => {
    const directory = await socketDirectory()
    const address = discoveryEndpointAddress(directory, 'm96d-owner')
    const endpoint = await startDiscoveryEndpoint(address, { storeId: 'store-A', epoch: 'epoch-A' })
    try {
      const probe = await probeDiscoveryEndpoint(address)
      expect(probe).toEqual({
        reachable: true,
        beacon: { storeId: 'store-A', epoch: 'epoch-A' },
      })
    } finally {
      await endpoint.close()
    }
  })

  it.runIf(process.platform !== 'win32')('refuses an address beyond sun_path', async () => {
    const directory = await socketDirectory()
    const long = `d-${'x'.repeat(COORDINATOR_SOCKET_PATH_MAX_BYTES)}`
    try {
      discoveryEndpointAddress(path.join(directory, long), 'm96d-owner')
    } catch (error: unknown) {
      if (!isCoordinatorEndpointError(error)) throw error
      expect(error.code).toBe('pathTooLong')
      expect(error.message).toBeTruthy()
      return
    }
    throw new Error('Expected the over-long address to refuse')
  })

  it('a missing endpoint reads unreachable, never dead', async () => {
    const directory = await socketDirectory()
    const address = discoveryEndpointAddress(directory, 'm96d-missing')
    const probe = await probeDiscoveryEndpoint(address)
    expect(probe.reachable).toBe(false)
    if (probe.reachable) throw new Error('unreachable')
    expect(probe.code).toBeTruthy()
  })

  it('a foreign speaker reads unreachable, never validated', async () => {
    const directory = await socketDirectory()
    for (const speech of ['not-json\n', `${JSON.stringify({ storeId: 'x' })}\n`]) {
      await expectForeignSpeaker(directory, `m96d-foreign-${String(speech.length)}`, (socket) => {
        socket.end(speech)
      })
    }
    // A beacon line beyond the bound is a foreign speaker, never our broker.
    await expectForeignSpeaker(directory, 'm96d-flood', (socket) => {
      socket.write('x'.repeat(8192))
    })
  })

  it('a second broker on the same address fails to listen', async () => {
    const directory = await socketDirectory()
    const address = discoveryEndpointAddress(directory, 'm96d-owner')
    const endpoint = await startDiscoveryEndpoint(address, { storeId: 'store-A', epoch: 'epoch-A' })
    try {
      await expect(
        startDiscoveryEndpoint(address, { storeId: 'store-B', epoch: 'epoch-B' }),
      ).rejects.toThrow(expect.objectContaining({ code: 'EADDRINUSE' }))
    } finally {
      await endpoint.close()
    }
  })

  it.runIf(process.platform !== 'win32')(
    'unlinked path reads unreachable while the live owner still echoes (F1)',
    async () => {
      const directory = await socketDirectory()
      const address = discoveryEndpointAddress(directory, 'm96d-owner')
      if (address.kind !== 'unix') throw new Error('Expected a Unix socket')
      const endpoint = await startDiscoveryEndpoint(address, {
        storeId: 'store-A',
        epoch: 'epoch-A',
      })
      try {
        const held = connect(address.path)
        try {
          expect(await readLine(held)).toBe(
            JSON.stringify({ storeId: 'store-A', epoch: 'epoch-A' }),
          )
          // The design's F1 removal case: the published path is gone, so a
          // new probe reads unreachable — while the live owner still works.
          await unlink(address.path)
          const probe = await probeDiscoveryEndpoint(address)
          expect(probe.reachable).toBe(false)
          if (probe.reachable) throw new Error('unreachable')
          expect(probe.code).toBe('ENOENT')
          held.write('still-executing\n')
          expect(await readLine(held)).toBe('still-executing')
        } finally {
          held.destroy()
        }
      } finally {
        await endpoint.close()
      }
    },
  )

  it.runIf(process.platform === 'win32')(
    'closed Windows listener refuses new opens while the live owner still echoes (F1)',
    async () => {
      const address = discoveryEndpointAddress(tmpdir(), `m96d-owner-${String(process.pid)}`)
      const endpoint = await startDiscoveryEndpoint(address, {
        storeId: 'store-A',
        epoch: 'epoch-A',
      })
      const held = connect(address.path)
      try {
        expect(await readLine(held)).toBe(JSON.stringify({ storeId: 'store-A', epoch: 'epoch-A' }))
        // The design's F1 removal case on Windows: closing the listener
        // refuses new opens (ERROR_PIPE_BUSY through a direct open, since
        // net.connect would retry while the peer stays open) while the
        // live owner's connection still echoes.
        await endpoint.close()
        await expect(open(address.path, 'r+')).rejects.toThrow(
          expect.objectContaining({ code: 'EBUSY' }),
        )
        held.write('still-executing\n')
        expect(await readLine(held)).toBe('still-executing')
      } finally {
        held.destroy()
      }
    },
  )

  it.runIf(process.platform === 'win32' && canReadProcessBirth())(
    'Windows service-mediated launch keeps the landing held (F1 native)',
    async () => {
      const { openCoordinatorLedger } = await import('../../src/core/team/coordinator/ledger')
      const { randomUUID } = await import('node:crypto')
      const directory = await mkdtemp(path.join(tmpdir(), 'm96d-wmi-'))
      stores.push(directory)
      const ledger = await openCoordinatorLedger(directory, randomUUID())
      try {
        await ledger.reserve('grant-A', 'window-A', ['landing'])
        const script = [
          'Get-CimInstance Win32_Process |',
          '  Where-Object { $_.ParentProcessId -eq $PID } |',
          '  Select-Object -ExpandProperty ProcessId',
        ].join(' ')
        const { stdout: children } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          script,
        ])
        const external = children
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line !== '')
        expect(external).toEqual([])
        ledger.endpointFailed('ERROR_PIPE_BUSY')
        expect(ledger.reachable).toBe(false)
        expect(ledger.electSuccessor(false)).toBe(false)
        expect(ledger.held('grant-A')).toEqual(['landing'])
      } finally {
        await ledger.close()
      }
    },
  )
})
