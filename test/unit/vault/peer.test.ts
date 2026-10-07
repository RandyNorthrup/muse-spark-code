import { socketDescriptors } from './brokerFixture'
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, chmod, rm } from 'node:fs/promises'
import { execFile, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import os from 'node:os'
import { UnixVaultPeerVerifier } from '../../../src/core/vault/broker/peer'
import { VAULT_APPROVAL_TTL_MS } from '../../../src/shared/constants'

describe('native Unix foreign-user rejection', () => {
  it('owner-only socket denies another user and OS uid still refuses on a deliberately relaxed test socket', async () => {
    const directory = await mkdtemp(
      path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'm109-b-peer-uid-'),
    )
    const helper = path.join(directory, 'peer'),
      client = path.join(directory, 'client'),
      socketPath = path.join(directory, 'broker.sock')
    const foreignUid = execFileSync('/usr/bin/id', ['-u', 'nobody'], {
      env: {},
      encoding: 'utf8',
    }).trim()
    const identify = vi.fn((pid: number) =>
      Promise.resolve({ processId: pid, userId: foreignUid, startedAt: 100, executable: client }),
    )
    const verifier = new UnixVaultPeerVerifier(helper, identify, socketDescriptors)
    const verified = Promise.withResolvers<boolean>()
    const server = createServer((socket) => {
      void (async () => {
        try {
          await verifier.verify(socket)
          verified.resolve(true)
        } catch {
          verified.resolve(false)
        } finally {
          socket.destroy()
        }
      })()
    })
    const run = async (): Promise<unknown> =>
      await new Promise((resolve, reject) => {
        execFile(
          '/usr/bin/sudo',
          ['-n', '-u', 'nobody', '--', client, socketPath],
          { env: {}, timeout: VAULT_APPROVAL_TTL_MS },
          (error, stdout) => {
            if (error)
              reject(error instanceof Error ? error : new Error('test foreign client failed'))
            else resolve(JSON.parse(stdout))
          },
        )
      })
    try {
      execFileSync(
        '/usr/bin/cc',
        ['-Wall', '-Wextra', '-Werror', path.resolve('src/core/vault/broker/peer.c'), '-o', helper],
        { env: { PATH: process.env['PATH'] } },
      )
      execFileSync(
        '/usr/bin/cc',
        [
          '-Wall',
          '-Wextra',
          '-Werror',
          path.resolve('test/unit/vault/foreignPeer.c'),
          '-o',
          client,
        ],
        { env: { PATH: process.env['PATH'] } },
      )
      await chmod(directory, 0o755)
      await new Promise<undefined>((resolve, reject) => {
        server.once('error', reject)
        server.listen(socketPath, () => {
          resolve(undefined)
        })
      })
      await chmod(socketPath, 0o600)
      expect(await run()).toMatchObject({ connected: false })
      expect(identify).not.toHaveBeenCalled()
      await chmod(socketPath, 0o666)
      expect(await run()).toEqual({ connected: true })
      expect(await verified.promise).toBe(false)
      expect(identify).not.toHaveBeenCalled()
    } finally {
      if (server.listening)
        await new Promise<undefined>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error)
            else resolve(undefined)
          }),
        )
      await rm(directory, { recursive: true, force: true })
    }
  })
})
