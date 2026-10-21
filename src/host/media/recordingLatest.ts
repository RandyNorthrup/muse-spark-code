// M105 lane W + PARITYREC: the VS Code host's recording temp roots and
// latest-file discovery on Linux, Windows and macOS. Activation-safe: only
// node builtins, the guarded process layer (dist/execGuard.js) and lazy M1
// sniffing; the portal capture itself stays unbound (no D-Bus transport in
// this round).
import { execFile } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { LatestRecordingPort } from '../../core/media/record/linux'
import type { MediaSource } from '../../core/media/limits'
import { windowsRecordingPlaces, type ScreenRecordingPreview } from '../../core/media/record/driver'
import {
  UI_TEXT,
  VIDEOS_FOLDER_NAME,
  WINDOWS_CAPTURES_FOLDER,
  WINDOWS_SCREEN_RECORDINGS_FOLDER,
} from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { powerShellQuoted } from '../../core/shellQuote'
import { windowsPowerShell } from '../../core/execGuard'

const OWNER_DIRECTORY_MODE = 0o700
const OWNER_FILE_MODE = 0o600

/** Forward slashes everywhere, so prefix checks hold on Windows too. */
export function normalPath(fsPath: string): string {
  return fsPath.replaceAll('\\', '/')
}

function withoutTrailingSlash(normal: string): string {
  return normal.endsWith('/') && normal.length > 1 ? normal.slice(0, -1) : normal
}

/**
Whether a recorder-produced file may bypass workspace confinement in the
media open hook. Only the host's own recording temp root qualifies; a
workspace file never takes this path.
*/
export function isRecordingTempPath(recordingTempRoot: string, fsPath: string): boolean {
  const root = withoutTrailingSlash(normalPath(recordingTempRoot))
  const normal = normalPath(fsPath)
  return normal === root || normal.startsWith(`${root}/`)
}

export interface LatestRecordingHost {
  readonly homeDir?: string
  /** Owner-only directory for private latest-copy previews. */
  readonly tempRoot: string
  /**
  Redirect-aware Videos folder (Windows known folder). Absent means
  `homeDir/Videos`; the caller resolves it on win32 with
  `resolveWindowsRecordingFolders`.
  */
  readonly videosDir?: string
  /**
  Redirect-aware Captures folder (Windows known folder, Xbox Game Bar's
  save location; moving Captures moves it). Absent means its default place,
  `Captures` under the Videos folder.
  */
  readonly capturesDir?: string
  /**
  Fresh owner-only directory for one preview copy. Required on Windows:
  `chmod` cannot set its ACL (mirrors `convert.ts`). Absent means
  `mkdtemp` under `tempRoot` plus `chmod`, which is owner-only on POSIX.
  */
  readonly createPrivateDirectory?: () => Promise<string>
}

export interface LatestRecordingPlatformHost extends LatestRecordingHost {
  readonly platform: NodeJS.Platform
}

/**
Best-effort disposal after a failed preview copy: a disposal that fails
too is moot, since the copy's own error is the news that crosses.
*/
async function settleCopyDispose(dispose: () => Promise<void>): Promise<void> {
  try {
    await dispose()
  } catch {
    // The copy already failed; its error below is the news.
  }
}

/**
Real fs-backed latest-recording discovery (the core `findLatestRecording`
port): nonrecursive scans of the OS recordings locations, symlinks and
special files rejected, private owner-only copies under the host's
recording temp root, sniffed with M1 before return. Failures carry fixed
words only; the caller's reasons name no path.
*/
function createLatestPort(
  locations: Pick<LatestRecordingPort, 'roots' | 'places'>,
  host: Pick<LatestRecordingHost, 'tempRoot' | 'createPrivateDirectory'>,
  isRecordingFileName?: (fileName: string) => boolean,
): LatestRecordingPort {
  const tempRoot = host.tempRoot
  return {
    roots: locations.roots,
    places: locations.places,
    ...(isRecordingFileName !== undefined && { isRecordingFileName }),
    list: async (root) => {
      const entries = await readdir(root, { withFileTypes: true })
      const files: { readonly path: string; readonly modifiedAt: number }[] = []
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue
        const full = path.join(root, entry.name)
        const meta = await lstat(full)
        if (!meta.isFile() || meta.isSymbolicLink()) continue
        files.push({ path: full, modifiedAt: meta.mtimeMs })
      }
      return files
    },
    copyForPreview: async (source, maxBytes) => {
      const meta = await lstat(source)
      if (!meta.isFile() || meta.isSymbolicLink() || meta.size === 0 || meta.size > maxBytes) {
        throw new Error('Latest recording is not a readable file')
      }
      const dir =
        host.createPrivateDirectory === undefined
          ? await (async () => {
              await mkdir(tempRoot, { recursive: true })
              await chmod(tempRoot, OWNER_DIRECTORY_MODE)
              const fresh = await mkdtemp(path.join(tempRoot, 'latest-'))
              await chmod(fresh, OWNER_DIRECTORY_MODE)
              return fresh
            })()
          : await host.createPrivateDirectory()
      const target = path.join(dir, path.basename(source))
      const dispose = async (): Promise<void> => {
        await rm(dir, { force: true, recursive: true })
      }
      try {
        await copyFile(source, target)
        await chmod(target, OWNER_FILE_MODE)
        const targetStat = await stat(target)
        if (targetStat.size === 0 || targetStat.size > maxBytes) {
          throw new Error('Latest recording copy exceeds the preview cap')
        }
        const { createMediaInspector } = await import('../../core/media/inspectEntry')
        const { sniffMedia } = createMediaInspector(UI_TEXT, uiLocale())
        const mediaSource: MediaSource = {
          sizeBytes: targetStat.size,
          read: async (offset, length) => {
            const handle = await open(target, 'r')
            try {
              const chunk = Buffer.alloc(length)
              const { bytesRead } = await handle.read(chunk, 0, length, offset)
              return chunk.subarray(0, bytesRead)
            } finally {
              await handle.close()
            }
          },
        }
        const sniffed = await sniffMedia(mediaSource)
        if (!sniffed.ok || sniffed.info.kind !== 'video') {
          throw new Error('Latest recording is not a video file')
        }
        const preview: ScreenRecordingPreview = { path: target, info: sniffed.info, dispose }
        return preview
      } catch (error: unknown) {
        await settleCopyDispose(dispose)
        throw error
      }
    },
  }
}

/** GNOME Screencasts and the Videos folder. */
export function createLinuxLatestPort(host: LatestRecordingHost): LatestRecordingPort {
  const home = host.homeDir ?? homedir()
  return createLatestPort(
    {
      roots: [
        path.join(home, VIDEOS_FOLDER_NAME, 'Screencasts'),
        path.join(home, VIDEOS_FOLDER_NAME),
      ],
      places: [path.posix.join(VIDEOS_FOLDER_NAME, 'Screencasts'), VIDEOS_FOLDER_NAME],
    },
    host,
  )
}

/**
Windows' own recorders' locations, newest file across both wins: Snipping
Tool's `Screen Recordings` under the Videos known folder, and Xbox Game
Bar's Captures known folder (`Videos\Captures` by default). `host.videosDir`
and `host.capturesDir` carry the redirected folders (OneDrive, Group
Policy, the Location setting) resolved with `resolveWindowsRecordingFolders`;
absent means the profile's Videos folder and its Captures.
*/
export function createWindowsLatestPort(host: LatestRecordingHost): LatestRecordingPort {
  const videos = host.videosDir ?? path.join(host.homeDir ?? homedir(), VIDEOS_FOLDER_NAME)
  return createLatestPort(
    {
      roots: [
        path.join(videos, WINDOWS_SCREEN_RECORDINGS_FOLDER),
        host.capturesDir ?? path.join(videos, WINDOWS_CAPTURES_FOLDER),
      ],
      places: windowsRecordingPlaces(),
    },
    host,
  )
}

/**
Whether a Desktop file name is a Screenshot recording: the app saves
`Screen Recording <date> at <time>.mov` (a bare `Screen Recording.mov`
also qualifies); exports and downloads never match.
*/
export function isScreenshotRecordingName(fileName: string): boolean {
  return /^Screen Recording(?: \d{4}-\d{2}-\d{2} at .+)?\.mov$/u.test(fileName)
}

/** The Screenshot app's default save location, gated to its own names. */
export function createMacosLatestPort(host: LatestRecordingHost): LatestRecordingPort {
  const home = host.homeDir ?? homedir()
  return createLatestPort(
    { roots: [path.join(home, 'Desktop')], places: ['Desktop'] },
    host,
    isScreenshotRecordingName,
  )
}

/**
The Videos and Captures known folders (FOLDERID_Videos and Xbox Game
Bar's Captures, the same folders the native helper's `--latest` reads)
through the operating system, so OneDrive, Group Policy and
Location-setting redirects resolve: .NET's `GetFolderPath('MyVideos')`
calls `SHGetKnownFolderPath` underneath, and the shell's `shell:Captures`
namespace resolves the Captures known folder by its canonical name.
Absolute system PowerShell, no shell; anything the system will not say
(other platforms included) is left out and the caller keeps its homedir
layout.
*/
export interface WindowsVideosDeps {
  readonly systemRoot?: string
}

export type WindowsRecordingFolders = Pick<LatestRecordingHost, 'videosDir' | 'capturesDir'>

function absoluteFolder(line: string | undefined): string | undefined {
  const dir = line?.trim() ?? ''
  return dir !== '' && path.win32.isAbsolute(dir) ? dir : undefined
}

/** The query's two answer lines: the Videos folder, then Captures (empty when the shell has none). */
export function parseWindowsRecordingFolders(output: string): WindowsRecordingFolders {
  const [videos, captures] = output.split(/\r?\n/u, 2)
  const videosDir = absoluteFolder(videos)
  const capturesDir = absoluteFolder(captures)
  return {
    ...(videosDir !== undefined && { videosDir }),
    ...(capturesDir !== undefined && { capturesDir }),
  }
}

/** The system folder the environment names (never an assumed drive). */
function windowsSystemRoot(override?: string): string | undefined {
  return override ?? process.env['SystemRoot'] ?? process.env['windir']
}

/** A system query that did not answer: its tool is missing, or it failed. */
class SystemCommandFailure extends Error {
  public constructor(cause: unknown) {
    super('The system command failed', { cause })
    this.name = 'SystemCommandFailure'
  }
}

/**
A system query through `%SystemRoot%`'s Windows PowerShell: absolute path,
its own module path and no credentials (`windowsPowerShell`), no shell,
hidden window.
*/
function runSystemCommand(
  powershell: ReturnType<typeof windowsPowerShell>,
  args: readonly string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      powershell.file,
      [...args],
      // No deadline of ours: the system's answer ends the query.
      { windowsHide: true, env: powershell.env },
      (error, stdout) => {
        if (error === null) resolve(stdout)
        else reject(new SystemCommandFailure(error))
      },
    )
  })
}

export async function resolveWindowsRecordingFolders(
  deps: WindowsVideosDeps = {},
  platform: NodeJS.Platform = process.platform,
): Promise<WindowsRecordingFolders> {
  if (platform !== 'win32') return {}
  try {
    const systemRoot = windowsSystemRoot(deps.systemRoot)
    if (systemRoot === undefined) return {}
    const powershell = windowsPowerShell(systemRoot)
    return parseWindowsRecordingFolders(
      await runSystemCommand(powershell, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          `[Environment]::GetFolderPath('MyVideos')`,
          `$captures = (New-Object -ComObject Shell.Application).NameSpace('shell:${WINDOWS_CAPTURES_FOLDER}')`,
          // Always a second line: empty when the shell has no Captures folder.
          "if ($null -eq $captures) { '' } else { $captures.Self.Path }",
        ].join('; '),
      ]),
    )
  } catch (error: unknown) {
    // The system would not answer (no PowerShell, a failed query): the
    // homedir layout stands. Anything else is a fault and surfaces.
    if (error instanceof SystemCommandFailure) return {}
    throw error
  }
}

export interface WindowsPrivateDirectoryDeps {
  readonly systemRoot?: string
}

/**
A fresh owner-only directory for one preview copy on Windows: `mkdtemp`
under `tempRoot`, then its whole DACL is replaced with a single grant
to the object's owner (OWNER RIGHTS, `*S-1-3-4`), verified through the
operating system before the copy starts. Absolute system tools, no shell,
bounded; anything the system will not confirm throws and the caller keeps
its fixed-word refusal. Never returns an unprotected directory.
*/
export async function createWindowsPrivateDirectory(
  tempRoot: string,
  deps: WindowsPrivateDirectoryDeps = {},
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform !== 'win32') throw new Error('Windows private directories need Windows')
  const systemRoot = windowsSystemRoot(deps.systemRoot)
  if (systemRoot === undefined) throw new Error('Windows private directories need a system root')
  await mkdir(tempRoot, { recursive: true })
  const dir = await mkdtemp(path.join(tempRoot, 'latest-'))
  try {
    const powershell = windowsPowerShell(systemRoot)
    // The exact DACL, protected, with one grant to the object's owner
    // (OWNER RIGHTS): replacing only the inherited grants would keep the
    // explicit ones a new folder can carry (an elevated administrator's,
    // under Windows Server's defaults), then read back through the system.
    const verdict = await runSystemCommand(powershell, [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        `$dir = ${powerShellQuoted(dir)}`,
        '$acl = New-Object System.Security.AccessControl.DirectorySecurity',
        '$acl.SetAccessRuleProtection($true, $false)',
        "$owner = New-Object System.Security.Principal.SecurityIdentifier('S-1-3-4')",
        "$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')))",
        'Set-Acl -LiteralPath $dir -AclObject $acl',
        '$check = Get-Acl -LiteralPath $dir',
        '$check.AreAccessRulesProtected -and ($check.Access.Count -eq 1)',
      ].join('; '),
    ])
    if (verdict.trim() !== 'True') throw new Error('Unprotected preview directory')
    return dir
  } catch (error: unknown) {
    try {
      await rm(dir, { force: true, recursive: true })
    } catch {
      // The failed lockdown's error below is the news.
    }
    throw error
  }
}

/** The running platform's OS recordings locations; anything else keeps Linux's. */
export function createLatestRecordingPort(host: LatestRecordingPlatformHost): LatestRecordingPort {
  const factories: Partial<
    Record<NodeJS.Platform, (host: LatestRecordingHost) => LatestRecordingPort>
  > = {
    win32: createWindowsLatestPort,
    darwin: createMacosLatestPort,
  }
  return (factories[host.platform] ?? createLinuxLatestPort)(host)
}
