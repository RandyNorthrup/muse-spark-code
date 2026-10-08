import { describe, expect, it, vi } from 'vitest'
import { acpFsRead, acpFsWrite } from '../../src/core/team/workers/acpWorker'
import { confineWorkerPath } from '../../src/core/team/workers/workerFence'
import { fakeWorkerFiles, fakeWorkerIdentity } from './helpers/workerIdentity'

const ROOT = String.raw`C:\workers\copy`
const role = {
  roleId: 'engineering',
  workspaceMode: 'own-branch',
  toolGroups: ['read', 'write', 'shell', 'report'],
  reportShape: 'summary',
} as const
const NAMES = ['COM¹', 'COM².txt', 'COM³', 'LPT¹', 'LPT².txt', 'LPT³', 'aux .md', 'NUL .txt']

describe('SECWINPATH worker/ACP spelling fence', () => {
  it.each(NAMES)('refuses %s before ACP read/write or worker file admission', async (name) => {
    const read = vi.fn(() => Promise.resolve('device'))
    const write = vi.fn(() => Promise.resolve())
    const io = fakeWorkerFiles(
      { realPath: (given) => Promise.resolve(given), pathIdentity: fakeWorkerIdentity },
      read,
      write,
    )
    const input = {
      folder: ROOT,
      workspaceRoot: String.raw`D:\checkout`,
      platform: 'win32' as const,
      io,
      role,
    }
    expect(await confineWorkerPath(input, name)).toEqual({ ok: false })
    expect(await acpFsRead(input, name)).toHaveProperty('error')
    expect(await acpFsWrite(input, name, 'no write')).toHaveProperty('error')
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
