// A writing transaction commits on any real machine: with a process table
// the owner carries the OS birth, without one it carries the birthless mark
// and the signal still governs liveness and recovery. Both branches run
// real storage against the real probe outcome.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReportStorage } from '../../src/core/reporting/history'
import { canReadProcessBirth } from './helpers/processBirth'
import { temporaryDir, removeFolder } from './helpers/temporaryFolders'

describe('report storage writer lock without a process table', () => {
  it('commits a write and reads it back, with or without an OS birth', async () => {
    const root = await temporaryDir('report-storage-birthless-')
    try {
      const storage = new ReportStorage(root)
      let ownerText: string | undefined
      await storage.transaction(['probes'], true, async (files) => {
        await files.write('probe.json', JSON.stringify({ probe: true }))
        ownerText = await files.read('writer.lock')
      })
      if (ownerText === undefined) throw new Error('the writer lock record is missing')
      const owner: { pid: number; startedAt: string } = JSON.parse(ownerText)
      expect(owner.pid).toBe(process.pid)
      if (canReadProcessBirth()) {
        expect(owner.startedAt).toMatch(/^\d+$/)
      } else {
        expect(owner.startedAt).toBe('birth-unavailable')
      }
      const roundTrip = await storage.transaction(
        ['probes'],
        false,
        async (files) => await files.read('probe.json'),
      )
      expect(roundTrip).toBe(JSON.stringify({ probe: true }))
    } finally {
      await removeFolder(root)
    }
  })

  it('recovers a lock whose holder died, with or without an OS birth', async () => {
    const root = await temporaryDir('report-storage-recover-')
    try {
      // Above every platform's pid ceiling, so no live process can hold it.
      const deadPid = 2 ** 30
      try {
        process.kill(deadPid, 0)
        expect.unreachable('reserved dead pid is signallable')
      } catch (error: unknown) {
        const code =
          error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
        expect(code).toBe('ESRCH')
      }
      const directory = path.join(root, 'reports', 'v1', 'probes')
      await mkdir(directory, { recursive: true })
      await writeFile(
        path.join(directory, 'writer.lock'),
        JSON.stringify({
          pid: deadPid,
          startedAt: canReadProcessBirth() ? '1' : 'birth-unavailable',
          token: '11111111-1111-4111-8111-111111111111',
        }),
      )
      const storage = new ReportStorage(root)
      await storage.transaction(['probes'], true, async (files) => {
        await files.write('recovered.json', '{}')
      })
      const roundTrip = await storage.transaction(
        ['probes'],
        false,
        async (files) => await files.read('recovered.json'),
      )
      expect(roundTrip).toBe('{}')
    } finally {
      await removeFolder(root)
    }
  })
})
