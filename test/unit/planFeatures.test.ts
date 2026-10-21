// The plan files over real folders: a missing folder lists nothing, a
// taken hidden-stage name does not replace, and a stage that cannot be
// removed is noticed and kept instead of failing the sweep.

import { mkdtempSync, realpathSync, utimesSync } from 'node:fs'
import { chmod, mkdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { collectingLogger as logger } from './helpers/collectingLogger'
import { createPlanIo } from '../../src/host/planFeatures'
import { PLAN_STAGE_STALE_MS } from '../../src/shared/constants'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-plan-features-')))
afterAll(async () => {
  try {
    await chmod(base, 0o755)
  } catch {
    // The sweep test restores the mode itself; nothing left to loosen.
  }
  await removeFolder(base)
})

describe('listEntries', () => {
  it('lists nothing where the folder does not exist', async () => {
    const messages: string[] = []
    const io = createPlanIo({ log: logger(messages), now: () => Date.now() })
    await expect(io.listEntries(path.join(base, 'no-such-folder'))).resolves.toEqual([])
  })
})

describe('removeStaleStages', () => {
  // POSIX permissions refuse the removal; Windows ACLs do not refuse the same way.
  it.runIf(process.platform !== 'win32')(
    'notices a stage it cannot remove and keeps it',
    async () => {
      const directory = path.join(base, 'plans')
      await mkdir(directory, { recursive: true })
      const stage = '.plan.12345678-1234-1234-1234-123456789abc.tmp'
      await writeFile(path.join(directory, stage), 'staged')
      const old = new Date(Date.now() - PLAN_STAGE_STALE_MS - 1000)
      utimesSync(path.join(directory, stage), old, old)
      await chmod(directory, 0o555)
      const messages: string[] = []
      const io = createPlanIo({ log: logger(messages), now: () => Date.now() })
      try {
        await io.removeStaleStages(directory)
      } finally {
        await chmod(directory, 0o755)
      }
      // The sweep resolved instead of failing, said so once, and kept the stage.
      expect(messages).toHaveLength(1)
      const info = await stat(path.join(directory, stage))
      expect(info.isFile()).toBe(true)
    },
  )
})
