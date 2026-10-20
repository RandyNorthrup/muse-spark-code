// Close-time background reconciliation outcomes against the real native OS
// entry, inside the real Extension Development Host: the extension is
// activated (which binds the real resource governor, so the entry's real
// process runner can speak to the OS), and the coordinator, the consent
// store and the production entry
// (test/unit/helpers/schedules/realBackgroundEntry.ts) are all the real
// modules; the recorder forwards every call and only observes it.
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
import {
  realBackgroundHarness,
  saveBackgroundConsent,
} from '../unit/helpers/schedules/realBackgroundEntry'

const NOW = 1_700_000_000_000
const WAKE = 1_700_000_100_000

async function coordinator(nextWake: number | undefined) {
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-background-host-'))
  return { ...realBackgroundHarness(folder, nextWake), folder }
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
      await saveBackgroundConsent(consent, { choice: 'yes', decidedAtMs: NOW })
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
        await saveBackgroundConsent(consent, { choice: 'yes', decidedAtMs: NOW })
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
