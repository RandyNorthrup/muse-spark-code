// M105 W + PARITYREC: the host recording-temp gate and latest-file discovery
// run against real temp directories on every platform: no fake filesystem
// stands in for them. Windows proves the Screen Recordings layout, macOS the
// Desktop default plus its Screenshot-name gate, Linux its Videos roots. The
// video bytes below are runtime-built sniff fixtures (the header comment on
// ./helpers/media/fixtures says they are not playable clips): they prove
// layout, recency and selection, never an OS application's encoding.
// Recorded Snipping Tool and Screenshot bytes stay pending capture on GUI
// hosts (lane PR236W1).
import { mkdtemp, mkdir, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findLatestRecording, isWithinRecordingRoot } from '../../src/core/media/record/linux'
import { UI_TEXT } from '../../src/shared/constants'
import { ebmlFixture, videoFixture, wavFixture } from './helpers/media/fixtures'
import { withPowerShell7ModulePath } from './helpers/powerShell7'
import { createMediaSourceOpen } from '../../src/host/media/mediaProviders'
import {
  createLatestRecordingPort,
  createLinuxLatestPort,
  createMacosLatestPort,
  createWindowsLatestPort,
  createWindowsPrivateDirectory,
  isRecordingTempPath,
  isScreenshotRecordingName,
  parseWindowsVideosDir,
  resolveWindowsVideosDir,
} from '../../src/host/media/recordingLatest'

const runFile = promisify(execFile)
/** The system folder the environment names, as the product reads it. */
function windowsRoot(): string {
  const root = process.env['SystemRoot'] ?? process.env['windir']
  if (root === undefined) throw new Error('SystemRoot names the Windows system root')
  return root
}
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
/** PowerShell answers end in CRLF; the spoken dir plus its line ending. */
function spoken(dir: string): string {
  return dir + '\r\n'
}
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

  it('a failed copy crosses with the copy failure and leaves no preview behind', async () => {
    const tempRoot = await temp()
    const port = createLinuxLatestPort({ homeDir: await temp(), tempRoot })
    const missing = path.join(tempRoot, 'gone.mp4')
    let failure: unknown
    try {
      await port.copyForPreview(missing, 1000)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure instanceof Error && 'code' in failure ? String(failure.code) : undefined).toBe(
      'ENOENT',
    )
    expect(await readdir(tempRoot)).toHaveLength(0)
  })
})

describe('PARITYREC Windows latest-file discovery', () => {
  it('selects the newest recent .mp4 under Screen Recordings', async () => {
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
    if (!latest.ok) throw new Error('expected the recent recording')
    expect(latest.preview.path.startsWith(tempRoot)).toBe(true)
    expect(latest.preview.info).toMatchObject({ kind: 'video', mediaType: 'video/mp4' })
    await latest.preview.dispose()
    await expect(stat(latest.preview.path)).rejects.toThrow()
  })

  it('follows a redirected Videos folder instead of the profile one', async () => {
    const { home, tempRoot } = await homeWith({
      'OD/Videos/Screen Recordings/moved.mp4': { ageMs: 1000, bytes: videoFixture() },
    })
    const videosDir = path.join(home, 'OD', 'Videos')
    const port = createWindowsLatestPort({ homeDir: home, tempRoot, videosDir })
    expect(port.roots).toEqual([path.join(videosDir, 'Screen Recordings')])
    const latest = await findLatestRecording(port)
    if (!latest.ok) throw new Error('expected the redirected recording')
    expect(path.basename(latest.preview.path)).toBe('moved.mp4')
    await latest.preview.dispose()
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
  it('selects the newest Screenshot-named .mov on the Desktop', async () => {
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
    if (!latest.ok) throw new Error('expected the recent Screenshot-named recording')
    expect(latest.preview.path.startsWith(tempRoot)).toBe(true)
    expect(latest.preview.info).toMatchObject({ kind: 'video', mediaType: 'video/quicktime' })
    await latest.preview.dispose()
    await expect(stat(latest.preview.path)).rejects.toThrow()
  })

  it('prefers an older Screenshot recording over a newer Desktop export', async () => {
    const screenshot = 'Screen Recording 2026-10-18 at 09.00.00.mov'
    const { home, tempRoot } = await homeWith({
      'Desktop/export.mov': { ageMs: 1000, bytes: videoFixture({ brand: 'qt  ' }) },
      [`Desktop/${screenshot}`]: { ageMs: 60 * 1000, bytes: videoFixture({ brand: 'qt  ' }) },
    })
    const latest = await findLatestRecording(createMacosLatestPort({ homeDir: home, tempRoot }))
    if (!latest.ok) throw new Error('expected the Screenshot-named recording, not the export')
    expect(path.basename(latest.preview.path)).toBe(screenshot)
    await latest.preview.dispose()
  })

  it('reports no recent recording when only non-Screenshot videos are fresh', async () => {
    const { home, tempRoot } = await homeWith({
      'Desktop/export.mov': { ageMs: 1000, bytes: videoFixture({ brand: 'qt  ' }) },
      'Desktop/clip.mp4': { ageMs: 1000, bytes: videoFixture() },
    })
    const port = createMacosLatestPort({ homeDir: home, tempRoot })
    await expect(findLatestRecording(port)).resolves.toMatchObject({
      ok: false,
      reason: UI_TEXT.media.recordingNoRecent,
    })
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

describe('PR236W1 Screenshot-name gate', () => {
  it.each([
    ['Screen Recording 2026-10-18 at 09.00.00.mov', true],
    ['Screen Recording 2026-10-18 at 9.00.00 PM.mov', true],
    ['Screen Recording.mov', true],
    ['Screen Recording 2026-10-18 at 09.00.00.mp4', false],
    ['export.mov', false],
    ['Screen Recording 2026-10-18 at 09.00.00.mov ', false],
    ['screen recording 2026-10-18 at 09.00.00.mov', false],
    ['My Screen Recording.mov', false],
  ])('names %s as Screenshot output: %s', (name, expected) => {
    expect(isScreenshotRecordingName(name)).toBe(expected)
  })
})

describe('PR236W1 Windows Videos known folder', () => {
  const systemRoot = String.raw`C:\Windows`
  it.each([
    [spoken(String.raw`C:\Users\u\Videos`), String.raw`C:\Users\u\Videos`],
    [String.raw`D:\Media\Videos`, String.raw`D:\Media\Videos`],
    ['', undefined],
    [String.raw`relative\Videos`, undefined],
    ['/posix/Videos', '/posix/Videos'],
  ])('parses the known-folder answer %s as %s', (output, expected) => {
    expect(parseWindowsVideosDir(output)).toBe(expected)
  })

  it('stays on the homedir layout off Windows', async () => {
    await expect(resolveWindowsVideosDir({ systemRoot }, 'linux')).resolves.toBeUndefined()
  })

  // The system's own answer, read independently: the registry's resolved
  // Videos folder, which a redirection (OneDrive, another drive) updates.
  it.runIf(process.platform === 'win32')(
    'resolves the Videos folder through system PowerShell',
    async () => {
      const { stdout } = await runFile(path.join(windowsRoot(), 'System32', 'reg.exe'), [
        'query',
        String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders`,
        '/v',
        'My Video',
      ])
      const registry = /My Video\s+REG_SZ\s+(.+)/u.exec(stdout)?.[1]?.trim()
      expect(registry).toEqual(expect.any(String))
      await expect(resolveWindowsVideosDir()).resolves.toBe(registry)
    },
  )

  it('falls back when the system will not answer', async () => {
    // A system root without PowerShell: the query fails for real.
    await expect(
      resolveWindowsVideosDir({ systemRoot: await temp() }, 'win32'),
    ).resolves.toBeUndefined()
  })
})

// The lockdown read back independently through icacls: one grant, to the
// object's owner (OWNER RIGHTS), nothing inherited.
async function expectOwnerOnly(tempRoot: string, dir: string): Promise<void> {
  try {
    expect(dir.startsWith(tempRoot)).toBe(true)
    const made = await stat(dir)
    expect(made.isDirectory()).toBe(true)
    const { stdout } = await runFile(path.join(windowsRoot(), 'System32', 'icacls.exe'), [dir])
    const grants = stdout
      .split(/\r?\n/u)
      .map((line) => line.replace(dir, '').trim())
      .filter((line) => line.includes(':('))
    expect(grants).toEqual(['OWNER RIGHTS:(OI)(CI)(F)'])
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('PR236W1 Windows private preview directory', () => {
  it('refuses off Windows instead of claiming a DACL', async () => {
    await expect(createWindowsPrivateDirectory(await temp(), {}, 'darwin')).rejects.toThrow(
      /Windows/,
    )
  })

  it.runIf(process.platform === 'win32')(
    'creates a real owner-only directory, locked down by icacls',
    async () => {
      const tempRoot = await temp()
      await expectOwnerOnly(tempRoot, await createWindowsPrivateDirectory(tempRoot))
    },
  )

  // WINPSMOD: VS Code started from a PowerShell 7 terminal hands every child
  // pwsh 7's module path, and Windows PowerShell 5.1 could not load Set-Acl
  // and Get-Acl from it ("Unprotected preview directory"). This process takes
  // the real pwsh 7 value, as such a window has it.
  it.runIf(process.platform === 'win32')(
    'locks the directory down when VS Code came from a PowerShell 7 terminal',
    async () => {
      const tempRoot = await temp()
      const dir = await withPowerShell7ModulePath(() => createWindowsPrivateDirectory(tempRoot))
      await expectOwnerOnly(tempRoot, dir)
    },
  )

  it('throws and removes the directory when the system cannot lock it down', async () => {
    // A system root without icacls: the lockdown fails for real.
    const tempRoot = await temp()
    await expect(
      createWindowsPrivateDirectory(tempRoot, { systemRoot: await temp() }, 'win32'),
    ).rejects.toThrow()
    expect(await readdir(tempRoot)).toEqual([])
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

  it('refuses when the path check itself fails, without a word', async () => {
    const ws = await temp()
    const tempRoot = await temp()
    let refusal = new Error('the refusal did not refuse')
    try {
      await stat(path.join(ws, 'no-such-check'))
    } catch (error: unknown) {
      if (error instanceof Error) refusal = error
    }
    expect(refusal).toBeInstanceOf(Error)
    const open = createMediaSourceOpen({
      canonicalRelativePath: () => Promise.reject(refusal),
      recordingTempRoot: tempRoot,
    })
    expect(
      await open({ name: 'clip.mp4', fsPath: path.join(ws, 'clip.mp4'), relativePath: 'clip.mp4' }),
    ).toBeUndefined()
  })
})
