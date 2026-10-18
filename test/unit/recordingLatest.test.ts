// M105 W + PARITYREC: the host recording-temp gate and latest-file discovery
// run against real temp directories on every platform: no fake filesystem
// stands in for them. Windows proves Videos/Screen Recordings, macOS proves
// the Desktop Screenshot-app default, Linux its Videos roots.
import { mkdtemp, mkdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findLatestRecording, isWithinRecordingRoot } from '../../src/core/media/record/linux'
import { UI_TEXT } from '../../src/shared/constants'
import { ebmlFixture, videoFixture, wavFixture } from './helpers/media/fixtures'
import { createMediaSourceOpen } from '../../src/host/media/mediaProviders'
import {
  createLatestRecordingPort,
  createLinuxLatestPort,
  createMacosLatestPort,
  createWindowsLatestPort,
  isRecordingTempPath,
} from '../../src/host/media/recordingLatest'

const owned: string[] = []
async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'm105-rec-'))
  owned.push(dir)
  return dir
}
async function homeWith(files: Record<string, { ageMs: number; bytes: Uint8Array }>) {
  const home = await temp()
  const tempRoot = await temp()
  for (const [name, file] of Object.entries(files)) {
    const full = path.join(home, name)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, file.bytes)
    const at = Date.now() - file.ageMs
    await utimes(full, at / 1000, at / 1000)
  }
  return { home, tempRoot }
}
// path.win32.sep is the single Windows separator without a literal backslash.
const WINDOWS_SEPARATOR = path.win32.sep
function confine(workspaceRoot: string) {
  return (fsPath: string) => {
    const normal = fsPath.replaceAll(WINDOWS_SEPARATOR, '/')
    const root = workspaceRoot.replaceAll(WINDOWS_SEPARATOR, '/')
    if (normal !== root && !normal.startsWith(`${root}/`)) return Promise.resolve(undefined)
    const canonical = normal.slice(root.length + 1)
    return Promise.resolve({ canonical, checkedAbsolute: fsPath })
  }
}
beforeEach(() => {
  owned.length = 0
})
afterEach(async () => {
  for (const dir of owned) await rm(dir, { force: true, recursive: true })
  owned.length = 0
})

describe('M105 W recording temp gate', () => {
  it.each([
    ['/tmp/muse-screen/clip.mp4', '/tmp/muse-screen', true],
    ['/tmp/muse-screen', '/tmp/muse-screen', true],
    ['/tmp/muse-screen-cast/clip.mp4', '/tmp/muse-screen', false],
    ['/ws/clip.mp4', '/tmp/muse-screen', false],
    [String.raw`C:\rec\muse-screen\clip.mp4`, String.raw`C:\rec\muse-screen`, true],
    [String.raw`C:\rec\muse-screen-evil\clip.mp4`, String.raw`C:\rec\muse-screen`, false],
  ])('admits %s under %s only on the directory boundary', (given, root, expected) => {
    expect(isRecordingTempPath(root, given)).toBe(expected)
  })
})

describe('PARITYREC recording-root confinement', () => {
  it.each([
    ['/home/u/Videos/Screencasts', '/home/u/Videos/Screencasts/new.mp4', true],
    ['/home/u/Videos', '/home/u/Videos/Screencasts/new.mp4', false],
    [
      String.raw`C:\Users\u\Videos\Screen Recordings`,
      String.raw`C:\Users\u\Videos\Screen Recordings\clip.mp4`,
      true,
    ],
    [
      String.raw`C:\Users\u\Videos\Screen Recordings`,
      String.raw`C:\Users\u\Videos\clip.mp4`,
      false,
    ],
    [
      String.raw`C:\Users\u\Videos\Screen Recordings`,
      String.raw`C:\Users\u\Videos\Screen Recordings-evil\clip.mp4`,
      false,
    ],
    ['relative/roots', 'relative/roots/clip.mp4', false],
  ])('admits %s under %s only inside the root', (root, given, expected) => {
    expect(isWithinRecordingRoot(root, given)).toBe(expected)
  })
})

describe('M105 W Linux latest-file discovery', () => {
  it('lists regular files only while latest picks the recent capture', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screencasts/new.mp4': { ageMs: 1000, bytes: videoFixture() },
      'Videos/Screencasts/old.webm': { ageMs: 60 * 60 * 1000, bytes: ebmlFixture() },
      'Videos/notes.txt': { ageMs: 1000, bytes: new Uint8Array([1, 2, 3]) },
      'Videos/Screencasts/nested/deep.mp4': { ageMs: 1000, bytes: videoFixture() },
    })
    // Windows CI cannot always create links: skip the link where it cannot.
    try {
      await symlink(
        path.join(home, 'Videos', 'Screencasts', 'new.mp4'),
        path.join(home, 'Videos', 'Screencasts', 'link.mp4'),
      )
    } catch {
      // No link, no link coverage on this host; the lstat check still runs.
    }
    const port = createLinuxLatestPort({ homeDir: home, tempRoot })
    expect(port.roots).toEqual([
      path.join(home, 'Videos', 'Screencasts'),
      path.join(home, 'Videos'),
    ])
    const listed = await port.list(path.join(home, 'Videos', 'Screencasts'))
    // list() admits every regular file; recency is findLatestRecording's filter.
    const names = listed
      .map((file) => path.basename(file.path))
      .toSorted((first, second) => {
        if (first === second) return 0
        return first < second ? -1 : 1
      })
    expect(names).toEqual(['new.mp4', 'old.webm'])
    const latest = await findLatestRecording(port)
    if (!latest.ok) throw new Error('expected the recent capture')
    expect(latest.preview.path.startsWith(tempRoot)).toBe(true)
    expect(latest.preview.info).toMatchObject({ kind: 'video', mediaType: 'video/mp4' })
    // Owner-only copies (Windows has no POSIX modes; readability is the gate).
    const previewStat = await stat(latest.preview.path)
    const mode = previewStat.mode & (process.platform === 'win32' ? 0o444 : 0o777)
    expect(mode).toBe(process.platform === 'win32' ? 0o444 : 0o600)
    await latest.preview.dispose()
    await expect(stat(latest.preview.path)).rejects.toThrow()
  })

  it('reports no recent recording when only old, missing or non-video files exist', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screencasts/old.mp4': { ageMs: 60 * 60 * 1000, bytes: videoFixture() },
      'Videos/sound.mp4': { ageMs: 1000, bytes: wavFixture() },
    })
    const port = createLinuxLatestPort({ homeDir: home, tempRoot })
    // The .mp4 holding wav bytes fails the video sniff after its private copy.
    await expect(findLatestRecording(port)).resolves.toMatchObject({ ok: false })
    const empty = createLinuxLatestPort({ homeDir: await temp(), tempRoot })
    expect(await findLatestRecording(empty)).toMatchObject({
      ok: false,
      reason: UI_TEXT.media.recordingNoRecent,
    })
  })

  it('refuses oversized, missing and non-video copies before sniffing', async () => {
    const tempRoot = await temp()
    const port = createLinuxLatestPort({ homeDir: await temp(), tempRoot })
    const missing = path.join(tempRoot, 'gone.mp4')
    await expect(port.copyForPreview(missing, 1000)).rejects.toThrow()
    const big = path.join(tempRoot, 'big.mp4')
    await writeFile(big, videoFixture())
    await expect(port.copyForPreview(big, 10)).rejects.toThrow()
    const wav = path.join(tempRoot, 'sound.mp4')
    await writeFile(wav, wavFixture())
    await expect(port.copyForPreview(wav, 1_000_000)).rejects.toThrow('not a video')
  })
})

describe('PARITYREC Windows latest-file discovery', () => {
  it('attaches the newest Snipping Tool recording from Screen Recordings', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screen Recordings/Screen Recording 2026-10-18.mp4': {
        ageMs: 1000,
        bytes: videoFixture(),
      },
      'Videos/Screen Recordings/older.mp4': {
        ageMs: 60 * 60 * 1000,
        bytes: videoFixture(),
      },
    })
    const port = createWindowsLatestPort({ homeDir: home, tempRoot })
    expect(port.roots).toEqual([path.join(home, 'Videos', 'Screen Recordings')])
    const latest = await findLatestRecording(port)
    if (!latest.ok) throw new Error('expected the recent Snipping Tool recording')
    expect(latest.preview.path.startsWith(tempRoot)).toBe(true)
    expect(latest.preview.info).toMatchObject({ kind: 'video', mediaType: 'video/mp4' })
    await latest.preview.dispose()
    await expect(stat(latest.preview.path)).rejects.toThrow()
  })

  it('reports no recent recording when the folder holds only stale captures', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screen Recordings/old.mp4': { ageMs: 60 * 60 * 1000, bytes: videoFixture() },
    })
    const port = createWindowsLatestPort({ homeDir: home, tempRoot })
    await expect(findLatestRecording(port)).resolves.toMatchObject({
      ok: false,
      reason: UI_TEXT.media.recordingNoRecent,
    })
  })
})

describe('PARITYREC macOS latest-file discovery', () => {
  it('attaches the newest Screenshot-app recording from the Desktop', async () => {
    const { home, tempRoot } = await homeWith({
      'Desktop/Screen Recording 2026-10-18 at 21.00.00.mov': {
        ageMs: 1000,
        bytes: videoFixture({ brand: 'qt  ' }),
      },
      'Desktop/Screen Recording 2026-10-17 at 21.00.00.mov': {
        ageMs: 60 * 60 * 1000,
        bytes: videoFixture({ brand: 'qt  ' }),
      },
    })
    const port = createMacosLatestPort({ homeDir: home, tempRoot })
    expect(port.roots).toEqual([path.join(home, 'Desktop')])
    const latest = await findLatestRecording(port)
    if (!latest.ok) throw new Error('expected the recent Screenshot-app recording')
    expect(latest.preview.path.startsWith(tempRoot)).toBe(true)
    expect(latest.preview.info).toMatchObject({ kind: 'video', mediaType: 'video/quicktime' })
    await latest.preview.dispose()
    await expect(stat(latest.preview.path)).rejects.toThrow()
  })

  it('reports no recent recording when the Desktop holds no fresh video', async () => {
    const { home, tempRoot } = await homeWith({
      'Desktop/notes.txt': { ageMs: 1000, bytes: new Uint8Array([1, 2, 3]) },
    })
    const port = createMacosLatestPort({ homeDir: home, tempRoot })
    await expect(findLatestRecording(port)).resolves.toMatchObject({
      ok: false,
      reason: UI_TEXT.media.recordingNoRecent,
    })
  })
})

describe('PARITYREC per-platform latest port', () => {
  it('points at the OS recordings location for each platform', async () => {
    const home = await temp()
    const tempRoot = await temp()
    expect(createLatestRecordingPort({ platform: 'win32', homeDir: home, tempRoot }).roots).toEqual(
      [path.join(home, 'Videos', 'Screen Recordings')],
    )
    expect(
      createLatestRecordingPort({ platform: 'darwin', homeDir: home, tempRoot }).roots,
    ).toEqual([path.join(home, 'Desktop')])
    expect(createLatestRecordingPort({ platform: 'linux', homeDir: home, tempRoot }).roots).toEqual(
      [path.join(home, 'Videos', 'Screencasts'), path.join(home, 'Videos')],
    )
  })
})

describe('M105 W media source opener', () => {
  it('opens confined files, refuses the rest, and bypasses confinement only under the temp root', async () => {
    const ws = await temp()
    const tempRoot = await temp()
    const open = createMediaSourceOpen({
      canonicalRelativePath: confine(ws),
      recordingTempRoot: tempRoot,
    })
    const inside = path.join(ws, 'clip.mp4')
    await writeFile(inside, videoFixture())
    const good = await open({ name: 'clip.mp4', fsPath: inside, relativePath: 'clip.mp4' })
    expect(good?.source.sizeBytes).toBe(videoFixture().length)
    const head = await good?.source.read(0, 4)
    expect(head?.length).toBe(4)
    await good?.close()
    const outside = path.join(await temp(), 'clip.mp4')
    await writeFile(outside, videoFixture())
    expect(
      await open({ name: 'clip.mp4', fsPath: outside, relativePath: undefined }),
    ).toBeUndefined()
    const git = path.join(ws, '.git', 'clip.mp4')
    await mkdir(path.dirname(git), { recursive: true })
    await writeFile(git, videoFixture())
    expect(
      await open({ name: 'clip.mp4', fsPath: git, relativePath: '.git/clip.mp4' }),
    ).toBeUndefined()
    const recording = path.join(tempRoot, 'preview', 'clip.mp4')
    await mkdir(path.dirname(recording), { recursive: true })
    await writeFile(recording, videoFixture())
    const admitted = await open({ name: 'clip.mp4', fsPath: recording, relativePath: undefined })
    expect(admitted?.source.sizeBytes).toBe(videoFixture().length)
    await admitted?.close()
    expect(await open({ name: 'dir', fsPath: ws, relativePath: '' })).toBeUndefined()
    // Gone before any handle exists refuses; only a held handle reads unreadable.
    expect(
      await open({ name: 'gone.mp4', fsPath: path.join(ws, 'gone.mp4'), relativePath: 'gone.mp4' }),
    ).toBeUndefined()
  })
})
