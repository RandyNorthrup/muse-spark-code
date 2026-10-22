// RLWINFIX item 2: one-shot `resources status` shows CPU use, never Unknown
// for a missing baseline. The real runtime host runs here against this
// machine's live sampler in a temporary machine folder: a fresh sampler's
// first CPU read has no baseline, so the status command takes its second
// reading one sample interval later instead of reporting Unknown.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createResources } from '../../src/runtime/resources/entry'
import { EN } from '../../src/shared/l10n/en'
import { removeFolder } from './helpers/temporaryFolders'

describe('one-shot resources status', () => {
  it('reports a CPU reading on a fresh sampler', async () => {
    const machineDir = await mkdtemp(path.join(tmpdir(), 'muse-status-cpu-'))
    try {
      const errors: unknown[] = []
      const host = await createResources(
        {
          machineDir,
          sleep: async (ms) => {
            await sleep(ms)
          },
          onError: (error) => {
            errors.push(error)
          },
        },
        EN,
        'en',
      )
      try {
        const text = await host.command('status', false)
        const cpuLine = text.split('\n').find((line) => line.startsWith('CPU Use:'))
        expect(cpuLine).toMatch(/\d/)
        expect(errors).toEqual([])
      } finally {
        host.dispose()
      }
    } finally {
      await removeFolder(machineDir)
    }
  })
})
