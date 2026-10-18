// PR236W1: the latest-file branch settles discovery against the
// conversation's liveness. A cleared or closed conversation never gets a
// stale preview: its copied file is disposed. Real previews from real temp
// directories back every case; liveness itself is the only input.
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findLatestRecording } from '../../src/core/media/record/linux'
import type { ScreenRecordingPreview } from '../../src/core/media/record/driver'
import {
  resolveLatestRecording,
  type RecordingCommandDeps,
} from '../../src/host/media/screenRecordBundle'
import { createLinuxLatestPort } from '../../src/host/media/recordingLatest'
import { UI_TEXT } from '../../src/shared/constants'
import { videoFixture } from './helpers/media/fixtures'

const owned: string[] = []
async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pr236w1-live-'))
  owned.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of owned) await rm(dir, { force: true, recursive: true })
  owned.length = 0
})

async function freshPreview(): Promise<ScreenRecordingPreview> {
  const home = await temp()
  const tempRoot = await temp()
  const full = path.join(home, 'Videos', 'Screencasts', 'new.mp4')
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, videoFixture())
  const at = Date.now() - 1000
  await utimes(full, at / 1000, at / 1000)
  const latest = await findLatestRecording(createLinuxLatestPort({ homeDir: home, tempRoot }))
  if (!latest.ok) throw new Error('expected the recent capture')
  return latest.preview
}

function depsFor(
  preview: ScreenRecordingPreview | undefined,
  liveness: RecordingCommandDeps['isLive'],
  warnings: string[],
): RecordingCommandDeps {
  return {
    l10n: { table: UI_TEXT, locale: 'en' },
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message)
      },
      error: () => undefined,
    },
    attach: () => Promise.resolve(false),
    isRemote: false,
    maxSeconds: 60,
    latest: () => Promise.resolve(preview),
    ...(liveness !== undefined && { isLive: liveness }),
  }
}

describe('PR236W1 latest-recording liveness', () => {
  it('previews while its conversation is live and keeps the copy', async () => {
    const preview = await freshPreview()
    try {
      const settled = await resolveLatestRecording(depsFor(preview, () => true, []))
      expect(settled).toMatchObject({ status: 'ready' })
      if (settled.status !== 'ready') throw new Error('expected the ready preview')
      expect(settled.preview).toBe(preview)
      const kept = await stat(preview.path)
      expect(kept.isFile()).toBe(true)
    } finally {
      await preview.dispose()
    }
  })

  it('treats a missing liveness check as a live conversation', async () => {
    const preview = await freshPreview()
    try {
      const settled = await resolveLatestRecording(depsFor(preview, undefined, []))
      expect(settled.status).toBe('ready')
      const kept = await stat(preview.path)
      expect(kept.isFile()).toBe(true)
    } finally {
      await preview.dispose()
    }
  })

  it('disposes the copy instead of previewing a cleared conversation', async () => {
    const preview = await freshPreview()
    const settled = await resolveLatestRecording(depsFor(preview, () => false, []))
    expect(settled).toMatchObject({ status: 'stale' })
    await expect(stat(preview.path)).rejects.toThrow()
  })

  it('stays stale when the stale cleanup itself fails', async () => {
    const preview = await freshPreview()
    const warnings: string[] = []
    const broken: ScreenRecordingPreview = {
      path: preview.path,
      info: preview.info,
      dispose: async () => {
        await preview.dispose()
        throw new Error('cleanup failed')
      },
    }
    const settled = await resolveLatestRecording(depsFor(broken, () => false, warnings))
    expect(settled).toMatchObject({ status: 'stale' })
    expect(warnings).toEqual(['Recording preview cleanup failed'])
  })

  it('reports absence when discovery found nothing', async () => {
    const settled = await resolveLatestRecording(depsFor(undefined, () => false, []))
    expect(settled).toMatchObject({ status: 'absent' })
  })
})
