import { mkdtemp, readFile, mkdir, writeFile, rm, chmod, symlink } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectWorkspaceBroker, startWorkspaceBroker } from '../../src/runtime/lsp/broker'
import { lspTransport } from '../../src/runtime/lsp/transport'
import { LSP_LIMITS } from '../../src/shared/constants'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { initialize } from './helpers/lspClient'
import { removeFolder } from './helpers/temporaryFolders'

vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
})
async function fixture() {
  const registry = await mkdtemp(path.join(tmpdir(), 'muse-lsp-broker-'))
  folders.push(registry)
  return registry
}
const services = {
  trusted: false,
  supportsReview: false,
  complete: () => Promise.resolve(undefined),
  command: () => Promise.resolve(null),
}
const deadOwner = { pid: 2_147_483_647, token: 'a'.repeat(64), configuration: 'same' }

describe('M104L workspace broker', () => {
  it
    .runIf(process.platform !== 'win32')
    .each([
      'registryMode',
      'folderMode',
      'recordMode',
      'registrySymlink',
      'recordSymlink',
      'foreignOwner',
    ])('refuses forged broker authority with %s before dialing or launching', async (fault) => {
    const root = await fixture()
    const actual = path.join(root, 'private')
    await mkdir(actual, { mode: 0o700 })
    const registry = fault === 'registrySymlink' ? path.join(root, 'alias') : actual
    if (fault === 'registrySymlink') await symlink(actual, registry)
    const workspace = process.cwd()
    const folder = path.join(actual, `lsp-${workspaceKey(workspace)}`)
    await mkdir(folder, { mode: 0o700 })
    const pipe = path.join(root, 'forged.sock')
    const connections = vi.fn((socket: ReturnType<typeof createConnection>) => socket.destroy())
    const server = createServer(connections)
    await new Promise<void>((resolve) => {
      server.listen(pipe, resolve)
    })
    const record = path.join(folder, fault === 'recordSymlink' ? 'real.json' : 'owner.json')
    await writeFile(
      record,
      JSON.stringify({ pid: process.pid, token: 'a'.repeat(64), pipe, configuration: 'same' }),
      { mode: 0o600 },
    )
    switch (fault) {
      case 'recordSymlink': {
        await symlink(record, path.join(folder, 'owner.json'))
        break
      }
      case 'registryMode': {
        await chmod(actual, 0o755)
        break
      }
      case 'folderMode': {
        await chmod(folder, 0o755)
        break
      }
      case 'recordMode': {
        {
          await chmod(record, 0o644)
          // No default
        }
        break
      }
    }
    const metadata = vi.spyOn(fs, 'lstat')
    if (fault === 'foreignOwner') {
      const info = await fs.stat(actual, { bigint: true })
      info.uid += 1n
      metadata.mockResolvedValueOnce(info)
    }
    const launch = vi.fn()
    try {
      const connecting = (async () => {
        const socket = await connectWorkspaceBroker({
          registry,
          workspace,
          configuration: 'same',
          launch,
        })
        socket.destroy()
        return socket
      })()
      await expect(connecting).rejects.toThrow('ELSP_PRIVATE')
      expect(connections).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    } finally {
      metadata.mockRestore()
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    }
  })
  it('three simultaneous frontends share exactly one workspace owner and keep independent initialization', async () => {
    const registry = await fixture()
    const workspace = process.cwd()
    let worker: Awaited<ReturnType<typeof startWorkspaceBroker>> | undefined
    let failure: unknown
    const launched = Promise.withResolvers<undefined>()
    const launch = vi.fn(() => {
      void startWorkspaceBroker(registry, workspace, 'same', services)
        .then((value) => {
          worker = value
          launched.resolve(undefined)
        })
        .catch((error: unknown) => {
          failure = error
          launched.resolve(undefined)
        })
    })
    const sockets = await Promise.all(
      Array.from({ length: 3 }, () =>
        connectWorkspaceBroker({ registry, workspace, configuration: 'same', launch }),
      ),
    )
    await launched.promise
    const clients = sockets.map((socket) => lspTransport(socket, socket, vi.fn()))
    try {
      expect(failure).toBeUndefined()
      expect(launch).toHaveBeenCalledTimes(1)
      await expect(startWorkspaceBroker(registry, workspace, 'same', services)).rejects.toThrow(
        'ELSP_OWNED',
      )
      for (const client of clients)
        expect(await initialize(client)).toMatchObject({
          capabilities: { codeActionProvider: false },
        })
      sockets[0]?.destroy()
      expect(
        await clients[1]?.request('workspace/executeCommand', { command: 'muse.help' }),
      ).toBeNull()
      await expect(
        connectWorkspaceBroker({ registry, workspace, configuration: 'other', launch }),
      ).rejects.toThrow('ELSP_CONFIGURATION')
      expect(launch).toHaveBeenCalledTimes(1)
    } finally {
      for (const socket of sockets) socket.destroy()
      for (const client of clients) client.close()
      await worker?.close()
    }
  })
  it('refuses an incorrect token and never initializes an unauthenticated client', async () => {
    const registry = await fixture()
    const workspace = process.cwd()
    let worker: Awaited<ReturnType<typeof startWorkspaceBroker>> | undefined
    const authenticated = await connectWorkspaceBroker({
      registry,
      workspace,
      configuration: 'private',
      launch: () => {
        void startWorkspaceBroker(registry, workspace, 'private', services).then((value) => {
          worker = value
        })
      },
    })
    const raw: unknown = JSON.parse(
      await readFile(path.join(registry, `lsp-${workspaceKey(workspace)}`, 'owner.json'), 'utf8'),
    )
    if (typeof raw !== 'object' || raw === null || !('pipe' in raw) || typeof raw.pipe !== 'string')
      throw new Error('bad fixture')
    const socket = createConnection(raw.pipe)
    const bytes: Buffer[] = []
    try {
      await new Promise<void>((resolve) => {
        socket.once('connect', resolve)
      })
      socket.on('data', (chunk: Buffer) => {
        bytes.push(chunk)
      })
      const body = Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { capabilities: {} },
        }),
      )
      socket.write(
        Buffer.concat([
          Buffer.from(`invalid\nContent-Length: ${String(body.length)}\r\n\r\n`),
          body,
        ]),
      )
      await new Promise<void>((resolve) => {
        socket.once('close', resolve)
      })
      expect(bytes).toEqual([])
    } finally {
      socket.destroy()
      authenticated.destroy()
      await worker?.close()
    }
  })
  it('serializes dead-owner recovery without deleting the replacement owner', async () => {
    const registry = await fixture()
    const workspace = process.cwd()
    const folder = path.join(registry, `lsp-${workspaceKey(workspace)}`)
    await mkdir(folder, { mode: 0o700 })
    await writeFile(
      path.join(folder, 'owner.json'),
      JSON.stringify({ ...deadOwner, pipe: path.join(folder, 'socket') }),
      { mode: 0o600 },
    )
    const worker = Promise.withResolvers<Awaited<ReturnType<typeof startWorkspaceBroker>>>()
    const launch = vi.fn(() => {
      void startWorkspaceBroker(registry, workspace, 'same', services)
        .then(worker.resolve)
        .catch(worker.reject)
    })
    const sockets = await Promise.all(
      Array.from({ length: 3 }, () =>
        connectWorkspaceBroker({ registry, workspace, configuration: 'same', launch }),
      ),
    )
    const owned = await worker.promise
    try {
      expect(launch).toHaveBeenCalledTimes(1)
      expect(sockets.every((socket) => !socket.destroyed)).toBe(true)
    } finally {
      for (const socket of sockets) socket.destroy()
      await owned.close()
    }
  })
  it('exits after bounded idle time even with an authenticated frontend connected', async () => {
    const registry = await fixture()
    const workspace = process.cwd()
    const worker = Promise.withResolvers<Awaited<ReturnType<typeof startWorkspaceBroker>>>()
    const socket = await connectWorkspaceBroker({
      registry,
      workspace,
      configuration: 'idle',
      launch: () => {
        void startWorkspaceBroker(registry, workspace, 'idle', services)
          .then(worker.resolve)
          .catch(worker.reject)
      },
    })
    const owned = await worker.promise
    const client = lspTransport(socket, socket, vi.fn())
    try {
      await initialize(client)
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await client.request('workspace/executeCommand', { command: 'muse.help' })
      await vi.advanceTimersByTimeAsync(LSP_LIMITS.idleMs + 1)
      await owned.closed
      await new Promise<void>((resolve) => {
        if (socket.destroyed) resolve()
        else socket.once('close', resolve)
      })
      expect(socket.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
      socket.destroy()
      client.close()
      await owned.close()
    }
  })
  it('bounds startup when a dead owner has an abandoned recovery lock', async () => {
    const registry = await fixture()
    const workspace = process.cwd()
    const folder = path.join(registry, `lsp-${workspaceKey(workspace)}`)
    await mkdir(folder, { mode: 0o700 })
    await mkdir(`${folder}.recover`, { mode: 0o700 })
    await writeFile(
      path.join(folder, 'owner.json'),
      JSON.stringify({ ...deadOwner, pipe: path.join(folder, 'socket') }),
      { mode: 0o600 },
    )
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(LSP_LIMITS.startupMs + 1)
    const launch = vi.fn()
    async function outcome() {
      try {
        await connectWorkspaceBroker({ registry, workspace, configuration: 'same', launch })
        return 'connected'
      } catch (error: unknown) {
        return error instanceof Error ? error.message : 'unknown'
      }
    }
    const pending = outcome()
    try {
      const result = await Promise.race([
        pending,
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve('unbounded')
          }, 100)
        }),
      ])
      expect(result).toBe('ELSP_STARTUP')
      expect(launch).not.toHaveBeenCalled()
    } finally {
      await rm(`${folder}.recover`, { recursive: true, force: true })
      await pending
      clock.mockRestore()
    }
  })
})
