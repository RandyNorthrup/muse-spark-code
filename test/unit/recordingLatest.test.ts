// M105 W + PARITYREC: the host recording-temp gate and latest-file discovery
// run against real temp directories on every platform: no fake filesystem
// stands in for them. Windows proves the Screen Recordings and Captures
// layout, macOS the Desktop default plus its Screenshot-name gate, Linux its
// Videos roots. D121: no age cutoff; the newest recording wins at any age. The
// video bytes below are runtime-built sniff fixtures (the header comment on
// ./helpers/media/fixtures says they are not playable clips): they prove
// layout, recency and selection, never an OS application's encoding.
// Recorded Snipping Tool and Screenshot bytes stay pending capture on GUI
// hosts (lane PR236W1).
import { mkdtemp, mkdir, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findLatestRecording, isWithinRecordingRoot } from '../../src/core/media/record/linux'
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
  parseWindowsRecordingFolders,
  resolveWindowsRecordingFolders,
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
const HOUR_MS = 60 * 60 * 1000
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
  it('lists regular files only while latest picks the newest capture', async () => {
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
    // list() admits every regular file; the kind filter is findLatestRecording's.
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

  it('takes a recording made two hours ago: no age cutoff', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screencasts/old.mp4': { ageMs: 2 * HOUR_MS, bytes: videoFixture() },
    })
    const latest = await findLatestRecording(createLinuxLatestPort({ homeDir: home, tempRoot }))
    if (!latest.ok) throw new Error('expected the two-hour-old capture')
    expect(path.basename(latest.preview.path)).toBe('old.mp4')
    await latest.preview.dispose()
  })

  it('refuses a newest file that is not a video, and names the folders when none exist', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screencasts/old.mp4': { ageMs: HOUR_MS, bytes: videoFixture() },
      'Videos/sound.mp4': { ageMs: 1000, bytes: wavFixture() },
    })
    const port = createLinuxLatestPort({ homeDir: home, tempRoot })
    // The .mp4 holding wav bytes fails the video sniff after its private copy.
    await expect(findLatestRecording(port)).resolves.toMatchObject({ ok: false })
    const empty = createLinuxLatestPort({ homeDir: await temp(), tempRoot })
    expect(await findLatestRecording(empty)).toEqual({
      ok: false,
      reason: 'No screen recording was found in Videos/Screencasts or Videos.',
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
  it('selects the newest .mp4 under Screen Recordings', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screen Recordings/Screen Recording 2026-10-18.mp4': {
        ageMs: 1000,
        bytes: videoFixture(),
      },
      'Videos/Screen Recordings/older.mp4': {
        ageMs: HOUR_MS,
        bytes: videoFixture(),
      },
    })
    const port = createWindowsLatestPort({ homeDir: home, tempRoot })
    expect(port.roots).toEqual([
      path.join(home, 'Videos', 'Screen Recordings'),
      path.join(home, 'Videos', 'Captures'),
    ])
    const latest = await findLatestRecording(port)
    if (!latest.ok) throw new Error('expected the newest recording')
    expect(path.basename(latest.preview.path)).toBe('Screen Recording 2026-10-18.mp4')
    expect(latest.preview.path.startsWith(tempRoot)).toBe(true)
    expect(latest.preview.info).toMatchObject({ kind: 'video', mediaType: 'video/mp4' })
    await latest.preview.dispose()
    await expect(stat(latest.preview.path)).rejects.toThrow()
  })

  // D121: a person who recorded hours ago still gets that recording.
  it('takes a recording made two hours ago: no age cutoff', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screen Recordings/two hours ago.mp4': { ageMs: 2 * HOUR_MS, bytes: videoFixture() },
    })
    const latest = await findLatestRecording(createWindowsLatestPort({ homeDir: home, tempRoot }))
    if (!latest.ok) throw new Error('expected the two-hour-old recording')
    expect(path.basename(latest.preview.path)).toBe('two hours ago.mp4')
    await latest.preview.dispose()
  })

  // Snipping Tool saves to Screen Recordings, Xbox Game Bar (Win+Alt+R) to
  // Captures: the newest video across both wins, and Game Bar's screenshots
  // (.png) beside its clips are never taken, however new.
  it('picks the newest recording across Screen Recordings and Captures, never a newer screenshot', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Screen Recordings/snip.mp4': { ageMs: 3 * HOUR_MS, bytes: videoFixture() },
      'Videos/Captures/game clip.mp4': { ageMs: 2 * HOUR_MS, bytes: videoFixture() },
      'Videos/Captures/screenshot.png': { ageMs: 1000, bytes: new Uint8Array([137, 80, 78, 71]) },
    })
    const port = createWindowsLatestPort({ homeDir: home, tempRoot })
    const fromCaptures = await findLatestRecording(port)
    if (!fromCaptures.ok) throw new Error('expected the Game Bar clip')
    expect(path.basename(fromCaptures.preview.path)).toBe('game clip.mp4')
    await fromCaptures.preview.dispose()
    const newer = path.join(home, 'Videos', 'Screen Recordings', 'newer snip.mp4')
    await writeFile(newer, videoFixture())
    const at = (Date.now() - HOUR_MS) / 1000
    await utimes(newer, at, at)
    const fromSnipping = await findLatestRecording(port)
    if (!fromSnipping.ok) throw new Error('expected the newer Snipping Tool recording')
    expect(path.basename(fromSnipping.preview.path)).toBe('newer snip.mp4')
    await fromSnipping.preview.dispose()
  })

  it('follows redirected Videos and moved Captures folders instead of the profile ones', async () => {
    const { home, tempRoot } = await homeWith({
      'OD/Videos/Screen Recordings/moved.mp4': { ageMs: HOUR_MS, bytes: videoFixture() },
      'D/Game Captures/clip.mp4': { ageMs: 1000, bytes: videoFixture() },
    })
    const videosDir = path.join(home, 'OD', 'Videos')
    const capturesDir = path.join(home, 'D', 'Game Captures')
    const port = createWindowsLatestPort({ homeDir: home, tempRoot, videosDir, capturesDir })
    expect(port.roots).toEqual([path.join(videosDir, 'Screen Recordings'), capturesDir])
    const latest = await findLatestRecording(port)
    if (!latest.ok) throw new Error('expected the moved Captures recording')
    expect(path.basename(latest.preview.path)).toBe('clip.mp4')
    await latest.preview.dispose()
    const redirected = createWindowsLatestPort({ homeDir: home, tempRoot, videosDir })
    expect(redirected.roots).toEqual([
      path.join(videosDir, 'Screen Recordings'),
      path.join(videosDir, 'Captures'),
    ])
    const fromVideos = await findLatestRecording(redirected)
    if (!fromVideos.ok) throw new Error('expected the redirected recording')
    expect(path.basename(fromVideos.preview.path)).toBe('moved.mp4')
    await fromVideos.preview.dispose()
  })

  it('names both folders when neither holds a recording', async () => {
    const { home, tempRoot } = await homeWith({
      'Videos/Captures/screenshot.png': { ageMs: 1000, bytes: new Uint8Array([137, 80, 78, 71]) },
    })
    const port = createWindowsLatestPort({ homeDir: home, tempRoot })
    expect(await findLatestRecording(port)).toEqual({
      ok: false,
      reason: String.raw`No screen recording was found in Videos\Screen Recordings or Videos\Captures.`,
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

  it('names the Desktop when only non-Screenshot videos are there', async () => {
    const { home, tempRoot } = await homeWith({
      'Desktop/export.mov': { ageMs: 1000, bytes: videoFixture({ brand: 'qt  ' }) },
      'Desktop/clip.mp4': { ageMs: 1000, bytes: videoFixture() },
    })
    const port = createMacosLatestPort({ homeDir: home, tempRoot })
    await expect(findLatestRecording(port)).resolves.toEqual({
      ok: false,
      reason: 'No screen recording was found in Desktop.',
    })
  })

  it('names the Desktop when it holds no video', async () => {
    const { home, tempRoot } = await homeWith({
      'Desktop/notes.txt': { ageMs: 1000, bytes: new Uint8Array([1, 2, 3]) },
    })
    const port = createMacosLatestPort({ homeDir: home, tempRoot })
    await expect(findLatestRecording(port)).resolves.toEqual({
      ok: false,
      reason: 'No screen recording was found in Desktop.',
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

describe('PR236W1 Windows Videos and Captures known folders', () => {
  const systemRoot = String.raw`C:\Windows`
  it.each([
    [
      spoken(String.raw`C:\Users\u\Videos`) + spoken(String.raw`C:\Users\u\Videos\Captures`),
      {
        videosDir: String.raw`C:\Users\u\Videos`,
        capturesDir: String.raw`C:\Users\u\Videos\Captures`,
      },
    ],
    [spoken(String.raw`D:\Media\Videos`) + spoken(''), { videosDir: String.raw`D:\Media\Videos` }],
    [spoken('') + spoken(String.raw`E:\Clips`), { capturesDir: String.raw`E:\Clips` }],
    ['', {}],
    [spoken(String.raw`relative\Videos`) + spoken(String.raw`relative\Captures`), {}],
    ['/posix/Videos', { videosDir: '/posix/Videos' }],
  ])('parses the known-folder answer %j as %j', (output, expected) => {
    expect(parseWindowsRecordingFolders(output)).toEqual(expected)
  })

  it('stays on the homedir layout off Windows', async () => {
    await expect(resolveWindowsRecordingFolders({ systemRoot }, 'linux')).resolves.toEqual({})
  })

  // The system's own answer, read independently: the registry's resolved
  // Videos folder, which a redirection (OneDrive, another drive) updates,
  // and Captures where the registry names it (a moved Captures folder) or
  // else beside it in Videos, when that folder exists.
  it.runIf(process.platform === 'win32')(
    'resolves the Videos and Captures folders through system PowerShell',
    async () => {
      const reg = path.join(windowsRoot(), 'System32', 'reg.exe')
      const explorer = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer`
      const { stdout } = await runFile(reg, [
        'query',
        `${explorer}${WINDOWS_SEPARATOR}Shell Folders`,
      ])
      const registry = /My Video\s+REG_SZ\s+(.+)/u.exec(stdout)?.[1]?.trim()
      if (registry === undefined) throw new Error('the registry names no Videos folder')
      // A moved Captures folder is recorded under its known-folder id.
      const user = await runFile(reg, [
        'query',
        `${explorer}${WINDOWS_SEPARATOR}User Shell Folders`,
      ])
      const moved = /\{EDC0FE71-98D8-4F4A-B920-C8DC133CB165\}\s+REG_(?:EXPAND_)?SZ\s+(.+)/iu
        .exec(user.stdout)?.[1]
        ?.trim()
        .replaceAll(/%([^%]+)%/gu, (_whole, name: string) => process.env[name] ?? `%${name}%`)
      const captures = moved ?? path.join(registry, 'Captures')
      // The shell names Captures only where that folder exists.
      const hasCaptures = existsSync(captures)
      await expect(resolveWindowsRecordingFolders()).resolves.toEqual({
        videosDir: registry,
        ...(hasCaptures && { capturesDir: captures }),
      })
    },
  )

  it('keeps the homedir layout when the system will not answer', async () => {
    // A system root without PowerShell: the query fails for real.
    await expect(
      resolveWindowsRecordingFolders({ systemRoot: await temp() }, 'win32'),
    ).resolves.toEqual({})
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
      [path.join(home, 'Videos', 'Screen Recordings'), path.join(home, 'Videos', 'Captures')],
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
