// Close-time background reconciliation against the real native OS entry:
// the coordinator, the consent store on the real disk filesystem, and the
// production entry (NativeScheduleBackground over real temp home/data
// directories with the real process runner) are all the real modules. Only
// observation is added: a decorator that forwards every call and records
// it, so the test sees routing without changing behaviour.
//
// A bare unit process never binds the resource governor, so the entry's
// process runner really refuses here ("Schedules are unavailable in this
// host"); these tests prove the routing — which entry call reconcile
// makes, with which arguments — on the real entry, and pin that refusal
// rather than scripting around it. The real outcomes (an entry actually
// retired, a due wake really refused by the launcher check) are proved in
// test/integration/scheduleBackground.test.ts, where the extension host
// binds the real governor.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import type { BackgroundConsentStore } from '../../src/runtime/schedules/background'
import { NativeScheduleBackground } from '../../src/runtime/schedules/nativeBackground'
import {
  backgroundProcessRunner,
  nodeBackgroundFiles,
} from '../../src/runtime/schedules/nodeBackgroundIo'
import { createBackgroundConsentStore } from '../../src/runtime/schedules/consent'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { UI_TEXT } from '../../src/shared/constants'
import type { ScheduleBackgroundPort } from '../../src/shared/scheduleV2'

type Consent = Parameters<ScheduleBackgroundPort['register']>[1]

const NOW = 1_700_000_000_000
const WAKE = 1_700_000_100_000

/** Forwards every call to the real entry and records it: observation only. */
class RecordingEntry implements ScheduleBackgroundPort {
  removed = 0
  registered: { nextWakeAtMs: number }[] = []
  public constructor(private readonly inner: ScheduleBackgroundPort) {}
  status() {
    return this.inner.status()
  }
  async register(nextWakeAtMs: number, consent: Consent): Promise<void> {
    this.registered.push({ nextWakeAtMs })
    await this.inner.register(nextWakeAtMs, consent)
  }
  async remove(): Promise<void> {
    this.removed += 1
    await this.inner.remove()
  }
}

async function coordinator(nextWake: number | undefined) {
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-background-reconcile-'))
  onTestFinished(() => rm(folder, { recursive: true, force: true }))
  const entry = new RecordingEntry(
    new NativeScheduleBackground({
      platform: process.platform,
      homeDir: path.join(folder, 'home'),
      dataDir: path.join(folder, 'data'),
      executable: process.execPath,
      agentFile: process.execPath,
      uid: process.getuid === undefined ? 0 : process.getuid(),
      now: () => Date.now(),
      isWakeProcess: false,
      authorization: () => Promise.resolve({ scheduledPrompts: false }),
      files: nodeBackgroundFiles(),
      run: backgroundProcessRunner(process.env),
    }),
  )
  const consent = createBackgroundConsentStore(
    createNodeScheduleFs(path.join(folder, 'store')),
    'runtime/background-consent.json',
  )
  const background = new ScheduleBackgroundCoordinator({
    entry,
    consent,
    now: () => NOW,
    nextWakeAtMs: () => Promise.resolve(nextWake),
  })
  return { background, consent, entry }
}

async function saveConsent(consent: BackgroundConsentStore, value: Consent): Promise<void> {
  await consent.exclusive(async (_current, save) => {
    await save(value)
  })
}

it('leaves the OS entry alone when no consent was ever recorded', async () => {
  const { background, entry } = await coordinator(undefined)
  await background.reconcile()
  expect(entry.removed).toBe(0)
  expect(entry.registered).toEqual([])
})

it('routes a stale entry to entry.remove while consent says yes and nothing is due', async () => {
  const { background, consent, entry } = await coordinator(undefined)
  // Consent is stored first through the real store; the entry below is only
  // ever contacted by reconcile, never by this setup.
  await saveConsent(consent, { choice: 'yes', decidedAtMs: NOW })
  entry.removed = 0
  entry.registered = []
  // No bound governor here, so the real runner refuses after the call
  // reached the entry; the routing below holds governed or not.
  await expect(background.reconcile()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  expect(entry.removed).toBe(1)
  expect(entry.registered).toEqual([])
})

it('routes the due wake to entry.register with the stored consent', async () => {
  // The coordinator saves consent before touching the entry, then routes
  // the due wake to entry.register: the recorded call proves the routing
  // on the real entry. Registering for real would create a genuine OS
  // background entry, which never happens here: with no bound governor
  // the real runner refuses first, on every platform, before any OS
  // contact (on Windows the same call would otherwise reach schtasks).
  const { background, consent, entry } = await coordinator(WAKE)
  await expect(background.register(WAKE, { choice: 'yes', decidedAtMs: NOW })).rejects.toThrow(
    UI_TEXT.scheduleV2.runtime.unavailable,
  )
  expect(entry.registered).toEqual([{ nextWakeAtMs: WAKE }])
  // The refused registration still stored its consent first.
  const stored = await consent.exclusive((current) => Promise.resolve(current))
  expect(stored).toEqual({ choice: 'yes', decidedAtMs: NOW })
  entry.removed = 0
  entry.registered = []
  await expect(background.reconcile()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  expect(entry.registered).toEqual([{ nextWakeAtMs: WAKE }])
  expect(entry.removed).toBe(0)
})

it('an explicit removal still reaches the entry with no consent record', async () => {
  const { background, entry } = await coordinator(undefined)
  await expect(background.remove()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  expect(entry.removed).toBe(1)
})
