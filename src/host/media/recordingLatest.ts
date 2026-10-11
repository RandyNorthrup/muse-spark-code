// M105 lane W: the VS Code host's recording temp roots and Linux latest-file
// discovery. Activation-safe: only node builtins and lazy M1 sniffing; the
// portal capture itself stays unbound (no D-Bus transport in this round).
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { LinuxLatestRecordingPort } from '../../core/media/record/linux'
import type { MediaSource } from '../../core/media/limits'
import type { ScreenRecordingPreview } from '../../core/media/record/driver'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'

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
 * Whether a recorder-produced file may bypass workspace confinement in the
 * media open hook. Only the host's own recording temp root qualifies; a
 * workspace file never takes this path.
 */
export function isRecordingTempPath(recordingTempRoot: string, fsPath: string): boolean {
  const root = withoutTrailingSlash(normalPath(recordingTempRoot))
  const normal = normalPath(fsPath)
  return normal === root || normal.startsWith(`${root}/`)
}

export interface LinuxLatestHost {
  readonly homeDir?: string
  /** Owner-only directory for private latest-copy previews. */
  readonly tempRoot: string
}

/**
 * Real fs-backed latest-recording discovery (R3's `latestLinuxRecording`
 * port): GNOME Screencasts and the Videos folder, nonrecursive, symlinks
 * and special files rejected, private owner-only copies under the host's
 * recording temp root, sniffed with M1 before return. Failures carry fixed
 * words only; the caller's reasons name no path.
 */
export function createLinuxLatestPort(host: LinuxLatestHost): LinuxLatestRecordingPort {
  const home = host.homeDir ?? homedir()
  const roots = [path.join(home, 'Videos', 'Screencasts'), path.join(home, 'Videos')]
  return {
    roots,
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
      await mkdir(host.tempRoot, { recursive: true })
      await chmod(host.tempRoot, OWNER_DIRECTORY_MODE)
      const dir = await mkdtemp(path.join(host.tempRoot, 'latest-'))
      await chmod(dir, OWNER_DIRECTORY_MODE)
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
        try {
          await dispose()
        } catch {
          // The copy already failed; its error below is the news.
        }
        throw error
      }
    },
  }
}
