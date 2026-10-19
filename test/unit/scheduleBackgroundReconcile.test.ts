// Close-time background reconciliation routing against the real native OS
// entry: the real coordinator, the real consent store and the production
// entry (test/unit/helpers/schedules/realBackgroundEntry.ts) are all the
// real modules; the recorder forwards every call and only observes it.
//
// A bare unit process never binds the resource governor, so the entry's
// real runner refuses here ("Schedules are unavailable in this host"); these
// tests prove the routing — which entry call reconcile makes, with which
// arguments — on the real entry, and pin that refusal rather than scripting
// around it. The real outcomes (an entry actually retired, a due wake really
// refused by the launcher check) are proved in
// test/integration/scheduleBackground.test.ts, where the extension host
// binds the real governor.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import {
  realBackgroundHarness,
  saveBackgroundConsent,
} from './helpers/schedules/realBackgroundEntry'

const NOW = 1_700_000_000_000
const WAKE = 1_700_000_100_000

async function coordinator(nextWake: number | undefined) {
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-background-reconcile-'))
  onTestFinished(() => rm(folder, { recursive: true, force: true }))
  return realBackgroundHarness(folder, nextWake)
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
  await saveBackgroundConsent(consent, { choice: 'yes', decidedAtMs: NOW })
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

it('routes an explicit never-consent to entry.remove on reconcile', async () => {
  // A stored 'never' still owns an entry from before: reconcile must retire
  // it. No bound governor here, so the real runner refuses after the call
  // reached the entry; the routing below holds governed or not.
  const { background, consent, entry } = await coordinator(undefined)
  await saveBackgroundConsent(consent, { choice: 'never', decidedAtMs: NOW })
  await expect(background.reconcile()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  expect(entry.removed).toBe(1)
  expect(entry.registered).toEqual([])
})

it('an explicit removal still reaches the entry with no consent record', async () => {
  const { background, entry } = await coordinator(undefined)
  await expect(background.remove()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  expect(entry.removed).toBe(1)
})
