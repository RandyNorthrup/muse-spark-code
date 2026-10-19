import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { isPosixVaultHost } from '../../../src/runtime/vault/posixHost'

// Host authentication over real files: a missing or corrupt record refuses,
// and only a record matching every identity field admits the host.
describe('POSIX vault host check', () => {
  it('refuses missing and corrupt records and admits an exact match', async () => {
    if (process.platform === 'win32') return
    const runDirectory = await mkdtemp(path.join(tmpdir(), 'vs-posix-host-'))
    try {
      const hostId = randomBytes(16).toString('hex')
      const hostSession = randomBytes(16).toString('hex')
      const record = {
        hostId,
        hostSession,
        processId: 4242,
        userId: '1000',
        startedAt: 1_700_000_000_000,
        executable: '/usr/bin/code',
      }
      const identity = {
        processId: 4242,
        userId: '1000',
        startedAt: 1_700_000_000_000,
        executable: '/usr/bin/code',
      }
      // No hosts directory at all: not a host.
      expect(await isPosixVaultHost(runDirectory, identity, hostId, hostSession)).toBe(false)
      const directory = path.join(runDirectory, 'hosts')
      await mkdir(directory, { recursive: true })
      // A corrupt record refuses instead of throwing.
      await writeFile(path.join(directory, hostId), '{corrupt', { mode: 0o600 })
      expect(await isPosixVaultHost(runDirectory, identity, hostId, hostSession)).toBe(false)
      // The exact record admits; any drift refuses.
      await writeFile(path.join(directory, hostId), JSON.stringify(record), { mode: 0o600 })
      expect(await isPosixVaultHost(runDirectory, identity, hostId, hostSession)).toBe(true)
      expect(
        await isPosixVaultHost(runDirectory, { ...identity, startedAt: 1 }, hostId, hostSession),
      ).toBe(false)
      expect(await isPosixVaultHost(runDirectory, identity, hostId, 'f'.repeat(32))).toBe(false)
    } finally {
      await rm(runDirectory, { recursive: true, force: true })
    }
  })
})
