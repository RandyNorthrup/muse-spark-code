// A writing transaction commits on any real machine: with a process table
// the owner carries the OS birth, without one it carries the birthless mark
// and the signal still governs liveness and recovery. Both branches run
// real storage against the real probe outcome.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReportStorage } from '../../src/core/reporting/history'
import {
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../src/shared/constants'
import { temporaryDir, removeFolder } from './helpers/temporaryFolders'

function canRunProbe(file: string, args: readonly string[]): boolean {
  try {
    execFileSync(file, [...args], { timeout: 5000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function canReadOwnBirth(): boolean {
  if (process.platform === 'linux') {
    try {
      readFileSync(`/proc/${String(process.pid)}/stat`, 'utf8')
      return true
    } catch {
      return false
    }
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot']
    if (systemRoot === undefined) return false
    return canRunProbe(path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH), [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      `try { [Diagnostics.Process]::GetProcessById(${String(process.pid)}).StartTime.ToFileTimeUtc() } catch [ArgumentException] { }`,
    ])
  }
  return canRunProbe('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)])
}

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
      if (canReadOwnBirth()) {
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
          startedAt: canReadOwnBirth() ? '1' : 'birth-unavailable',
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
