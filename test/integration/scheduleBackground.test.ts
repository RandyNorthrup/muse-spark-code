// Close-time background reconciliation outcomes against the real native OS
// entry, inside the real Extension Development Host: the extension is
// activated (which binds the real resource governor, so the entry's real
// process runner can speak to the OS), and the coordinator, the consent
// store on the real disk filesystem, and the production entry
// (NativeScheduleBackground over real temp home/data directories) are all
// the real modules. Only observation is added: a decorator that forwards
// every call and records it.
//
// These tests need a machine user bus (launchd on macOS, systemd --user on
// Linux, the Task Scheduler on Windows): entry.remove() really asks the OS
// whether our entry exists. The register row never creates a genuine OS
// entry anywhere: on darwin/linux the real entry refuses the unverified
// launcher before any OS write (no POSIX verifier is wired in engine.ts),
// and on Windows the same call would create a real scheduled task, so that
// row is gated out there.
import * as assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { EXTENSION_QUALIFIED_ID } from '../../src/shared/constants'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import type { BackgroundConsentStore } from '../../src/runtime/schedules/background'
import { NativeScheduleBackground } from '../../src/runtime/schedules/nativeBackground'
import {
  backgroundProcessRunner,
  nodeBackgroundFiles,
} from '../../src/runtime/schedules/nodeBackgroundIo'
import { createBackgroundConsentStore } from '../../src/runtime/schedules/consent'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
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
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-background-host-'))
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
  return { background, consent, entry, folder }
}

async function saveConsent(consent: BackgroundConsentStore, value: Consent): Promise<void> {
  await consent.exclusive(async (_current, save) => {
    await save(value)
  })
}

suite('schedule background entry in the real host', () => {
  suiteSetup(async function () {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension)
    await extension.activate()
  })

  test('reconcile retires a stale entry while consent says yes and nothing is due', async () => {
    const { background, consent, entry, folder } = await coordinator(undefined)
    try {
      await saveConsent(consent, { choice: 'yes', decidedAtMs: NOW })
      await background.reconcile()
      assert.equal(entry.removed, 1)
      assert.deepEqual(entry.registered, [])
      assert.deepEqual(await entry.status(), { registered: false })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  const registerTest = process.platform === 'win32' ? test.skip : test
  registerTest(
    'a due wake reaches entry.register, which really refuses the unverified launcher',
    async () => {
      const { background, consent, entry, folder } = await coordinator(WAKE)
      try {
        await saveConsent(consent, { choice: 'yes', decidedAtMs: NOW })
        let failure: unknown
        try {
          await background.reconcile()
        } catch (error: unknown) {
          failure = error
        }
        assert.deepEqual(entry.registered, [{ nextWakeAtMs: WAKE }])
        assert.equal(entry.removed, 0)
        assert.ok(failure instanceof Error)
        assert.equal(failure.name, 'UnsafeScheduleLauncherError')
        assert.deepEqual(await entry.status(), { registered: false })
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    },
  )

  test('an explicit removal retires the entry with no consent record', async () => {
    const { background, entry, folder } = await coordinator(undefined)
    try {
      await background.remove()
      assert.equal(entry.removed, 1)
      assert.deepEqual(await entry.status(), { registered: false })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
