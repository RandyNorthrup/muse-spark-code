// Close-time background reconciliation must not touch the OS entry when the
// person never answered the background question: every schedule CLI command
// closes the runtime, and a read-only command must not fail (exit 3) because
// the machine has no user bus or background runner. The coordinator, the
// consent store and the file system below are the real modules against real
// temp dirs; only the native OS entry (launchd/systemd/Task Scheduler) is
// recorded, the same boundary the engine leaves substitutable for tests.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import { createBackgroundConsentStore } from '../../src/runtime/schedules/consent'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import type { ScheduleBackgroundPort } from '../../src/shared/scheduleV2'

class RecordingEntry implements ScheduleBackgroundPort {
  removed = 0
  registered: { nextWakeAtMs: number }[] = []
  status() {
    return Promise.resolve({ registered: false as const })
  }
  register(nextWakeAtMs: number) {
    this.registered.push({ nextWakeAtMs })
    return Promise.resolve()
  }
  remove() {
    this.removed += 1
    return Promise.resolve()
  }
}

async function coordinator(nextWake: number | undefined, entry: RecordingEntry) {
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-background-reconcile-'))
  onTestFinished(() => rm(folder, { recursive: true, force: true }))
  return new ScheduleBackgroundCoordinator({
    entry,
    consent: createBackgroundConsentStore(
      createNodeScheduleFs(path.join(folder, 'store')),
      'runtime/background-consent.json',
    ),
    now: () => 1_700_000_000_000,
    nextWakeAtMs: () => Promise.resolve(nextWake),
  })
}

it('leaves the OS entry alone when no consent was ever recorded', async () => {
  const entry = new RecordingEntry()
  const background = await coordinator(undefined, entry)
  await background.reconcile()
  expect(entry.removed).toBe(0)
  expect(entry.registered).toEqual([])
})

it('removes a stale entry while consent says yes and nothing is due', async () => {
  const entry = new RecordingEntry()
  const background = await coordinator(undefined, entry)
  await background.register(1_700_000_100_000, { choice: 'yes', decidedAtMs: 1_700_000_000_000 })
  entry.removed = 0
  entry.registered = []
  await background.reconcile()
  expect(entry.removed).toBe(1)
  expect(entry.registered).toEqual([])
})

it('registers the next wake while consent says yes', async () => {
  const entry = new RecordingEntry()
  const background = await coordinator(1_700_000_100_000, entry)
  await background.register(1_700_000_100_000, { choice: 'yes', decidedAtMs: 1_700_000_000_000 })
  entry.removed = 0
  entry.registered = []
  await background.reconcile()
  expect(entry.removed).toBe(0)
  expect(entry.registered).toEqual([{ nextWakeAtMs: 1_700_000_100_000 }])
})

it('an explicit removal still retires the entry with no consent record', async () => {
  const entry = new RecordingEntry()
  const background = await coordinator(undefined, entry)
  await background.remove()
  expect(entry.removed).toBe(1)
})
