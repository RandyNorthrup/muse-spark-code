// RLWINFIX item 2: an unknown reading never pauses work. The real governor
// and the real queue run here against this machine's live sampler; a
// person-set disk floor past the live free space holds the level at
// throttle, while the registry's background count stays unknown (null),
// as it is for every runtime host and whenever the launch host cannot
// prove an entry. Throttle must still admit background work, one per kind.
import { statfs } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ResourceDiskSampler } from '../../src/core/resources/disk'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { ResourceQueue } from '../../src/core/resources/queue'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'
import { RESOURCE_GIB_BYTES } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

setUiText(EN, 'en')

const PROBE_LIMITS = { timeoutMs: 1000, maxOutputBytes: 64 * 1024 }

function liveClock(): ResourceClock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      return () => {
        clearTimeout(timer)
      }
    },
  }
}

/** True when the permit lands before the wait ends; false when it is held. */
async function wasGrantedBefore(ready: Promise<unknown>, waitMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const granted = (async (): Promise<boolean> => {
    await ready
    return true
  })()
  try {
    return await Promise.race([
      granted,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false)
        }, waitMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('resource queue with unknown occupancy', () => {
  it('admits background work in throttle, one per kind', async () => {
    const stats = await statfs(process.cwd(), { bigint: true })
    const freeGiB = Number(stats.bsize * stats.bavail) / RESOURCE_GIB_BYTES
    const settings: ResourceSettings = resourceSettingsSchema.parse({
      diskMinFreeGiB: Math.ceil(freeGiB) + 10,
    })
    const errors: unknown[] = []
    const events = new ResourceEvents((error) => {
      errors.push(error)
    })
    const clock = liveClock()
    const disks = new ResourceDiskSampler(
      [{ role: 'workspace', path: path.resolve(process.cwd()) }],
      () => settings,
    )
    const sampler = createMachineResourceSampler(() => settings, PROBE_LIMITS, disks)
    const governor = new ResourceGovernor({
      clock,
      sampler,
      settings,
      events,
      hasRelocationTarget: null,
      onError: (error) => {
        errors.push(error)
      },
    })
    const queue = new ResourceQueue({
      clock,
      events,
      capacity: (kind) => governor.capacity(kind),
      running: { backgroundCount: () => null },
    })
    try {
      await governor.refresh()
      expect(governor.level()).toBe('throttle')
      expect(governor.capacity('check')).toBe(1)
      const first = queue.request({ kind: 'check', class: 'background', priority: 0 })
      expect(await wasGrantedBefore(first.ready, 2000)).toBe(true)
      const second = queue.request({ kind: 'check', class: 'background', priority: 0 })
      expect(await wasGrantedBefore(second.ready, 1000)).toBe(false)
      const firstPermit = await first.ready
      firstPermit.release()
      expect(await wasGrantedBefore(second.ready, 2000)).toBe(true)
      const secondPermit = await second.ready
      secondPermit.release()
      expect(errors).toEqual([])
    } finally {
      queue.dispose()
      governor.dispose()
    }
  })
})
