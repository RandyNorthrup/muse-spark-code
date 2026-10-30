// The Linux screen driver's latest-recording discovery (D119 catch burn-down): a
// missing capture directory never hides the others and an unverifiable
// latest file reports unavailable. Directory listing runs over the real file
// system. The driver itself is proved against the real portal helper in
// portalRecord.test.ts, and its words by recordingDriver.test.ts.
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { findLatestRecording } from '../../src/core/media/record/latest'

const HOUR_MS = 60 * 60 * 1000
/** The person's name for a test root, as the not-found sentence shows it. */
const PLACE = 'Screencasts'

/** The port's listing over the real file system, with real modification times. */
async function listRecordingFiles(
  root: string,
): Promise<readonly { readonly path: string; readonly modifiedAt: number }[]> {
  const names = await readdir(root)
  const entries: { readonly path: string; readonly modifiedAt: number }[] = []
  for (const name of names) {
    const file = path.join(root, name)
    const fileStat = await stat(file)
    entries.push({ path: file, modifiedAt: fileStat.mtimeMs })
  }
  return entries
}

/** A fresh recording file with its real size, removed when the test finishes. */
async function freshMp4(
  prefix: string,
): Promise<{ readonly root: string; readonly file: string; readonly sizeBytes: number }> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'fresh.mp4')
  await writeFile(file, Buffer.alloc(1024))
  // Pinned a second in the past: a write landing in the same millisecond as
  // the find call reads back a sub-millisecond mtime past truncated now, and
  // the future guard would refuse it.
  const secondAgo = (Date.now() - 1000) / 1000
  await utimes(file, secondAgo, secondAgo)
  const fileStat = await stat(file)
  return { root, file, sizeBytes: fileStat.size }
}

describe('findLatestRecording', () => {
  it('names the folder it searched when the directory is missing', async () => {
    const outcome = await findLatestRecording({
      roots: [path.join(tmpdir(), 'muse-linux-record-missing')],
      places: [PLACE],
      list: async (listed: string) => {
        const names = await readdir(listed)
        return names.map((name) => ({ path: path.join(listed, name), modifiedAt: Date.now() }))
      },
      copyForPreview: () => Promise.reject(new Error('unreachable without candidates')),
    })
    expect(outcome).toEqual({
      ok: false,
      reason: `No screen recording was found in ${PLACE}.`,
    })
  })

  // D121: no age cutoff of ours; the preview shows what is attached.
  it('takes a recording made two hours ago', async () => {
    const { root, file } = await freshMp4('muse-linux-record-old-')
    const old = Date.now() - 2 * HOUR_MS
    await utimes(file, old / 1000, old / 1000)
    const copied: string[] = []
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: (source) => {
        copied.push(source)
        return Promise.reject(new Error('the copy is not under test'))
      },
    })
    expect(copied).toEqual([file])
    expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  })

  it('refuses a recording dated in the future', async () => {
    const { root, file } = await freshMp4('muse-linux-record-future-')
    const future = Date.now() + HOUR_MS
    await utimes(file, future / 1000, future / 1000)
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: () => Promise.reject(new Error('unreachable without candidates')),
    })
    expect(outcome).toEqual({ ok: false, reason: `No screen recording was found in ${PLACE}.` })
  })

  it('reports unavailable when the preview copy fails', async () => {
    const { root } = await freshMp4('muse-linux-record-copy-')
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: () => Promise.reject(new Error('copy failed')),
    })
    expect(outcome).toEqual({ ok: false, reason: expect.any(String) })
  })

  it('previews a recent recording the copy verifies', async () => {
    const { root, file, sizeBytes } = await freshMp4('muse-linux-record-fresh-')
    const outcome = await findLatestRecording({
      roots: [root],
      places: [PLACE],
      list: listRecordingFiles,
      copyForPreview: () =>
        Promise.resolve({
          path: file,
          info: {
            kind: 'video',
            mediaType: 'video/mp4',
            sizeBytes,
            durationSeconds: 5,
            hasSoundtrack: false,
          },
          dispose: () => Promise.resolve(),
        }),
    })
    expect(outcome.ok).toBe(true)
  })
})
