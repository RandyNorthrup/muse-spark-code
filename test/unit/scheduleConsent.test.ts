// The background schedule consent store: a missing file is no consent,
// an unreadable one refuses with its errno kind (never the raw failure),
// and the person hears the closed kind word.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createBackgroundConsentStore,
  scheduleStoredUnreadableReason,
} from '../../src/runtime/schedules/consent'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

async function removeFolder(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

describe('background schedule consent', () => {
  it('reads a missing file as no consent and keeps a saved choice', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-schedule-consent-'))
    try {
      const store = createBackgroundConsentStore(createNodeScheduleFs(directory), 'consent.json')
      const seen = await store.exclusive((current) => Promise.resolve(current))
      expect(seen).toBeUndefined()
      await store.exclusive(async (current, save) => {
        expect(current).toBeUndefined()
        await save({ choice: 'yes', decidedAtMs: 1 })
        return current
      })
      const kept = await store.exclusive((current) => Promise.resolve(current))
      expect(kept).toEqual({ choice: 'yes', decidedAtMs: 1 })
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses an unreadable file with its errno kind and tells the person the word', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-schedule-consent-'))
    try {
      const store = createBackgroundConsentStore(createNodeScheduleFs(directory), 'consent.json')
      await mkdir(path.join(directory, 'consent.json'))
      let failure: unknown
      try {
        await store.exclusive(() => Promise.resolve('ran'))
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(
        failure instanceof Error && failure.message.startsWith('scheduleStoredUnreadable:'),
      ).toBe(true)
      // The cause keeps the store failure for the caller; the person hears
      // only the closed kind word, never the raw failure (it can name the path).
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
      const word = scheduleStoredUnreadableReason(failure)
      expect(typeof word).toBe('string')
      expect(word).toContain(UI_TEXT.scheduleStoreReasonUnknown)
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses malformed consent text as invalid', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-schedule-consent-'))
    try {
      const store = createBackgroundConsentStore(createNodeScheduleFs(directory), 'consent.json')
      await writeFile(path.join(directory, 'consent.json'), 'not json', 'utf8')
      await expect(store.exclusive(() => Promise.resolve('ran'))).rejects.toThrow(
        'scheduleStoredJsonInvalid',
      )
    } finally {
      await removeFolder(directory)
    }
  })
})

describe('scheduleStoredUnreadableReason', () => {
  it('names the closed kind word for each errno class and nothing else', () => {
    setUiText(EN, BASE_LOCALE)
    expect(
      scheduleStoredUnreadableReason(
        new Error('scheduleStoredUnreadable:EACCES', { cause: 'EACCES' }),
      ),
    ).toContain(UI_TEXT.scheduleStoreReasonDenied)
    expect(
      scheduleStoredUnreadableReason(
        new Error('scheduleStoredUnreadable:ENOSPC', { cause: 'ENOSPC' }),
      ),
    ).toContain(UI_TEXT.scheduleStoreReasonDiskFull)
    expect(
      scheduleStoredUnreadableReason(new Error('scheduleStoredUnreadable:EIO', { cause: 'EIO' })),
    ).toContain(UI_TEXT.scheduleStoreReasonUnknown)
    expect(scheduleStoredUnreadableReason(new Error('something else'))).toBeUndefined()
    expect(scheduleStoredUnreadableReason('scheduleStoredUnreadable:EACCES')).toBeUndefined()
  })
})
