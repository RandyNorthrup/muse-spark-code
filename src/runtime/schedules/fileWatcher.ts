import { existsSync, lstatSync, readdirSync, watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import type { ScheduleSourceCapability } from '../../shared/scheduleEvents'
import { unavailableSource } from '../../core/schedules/events/ports'
import type { ScheduleWorkspaceWatchPort } from '../../core/schedules/events/files'

/** The one node:fs watch shape the port uses; production passes watch itself. */
export type NodeWatchPrimitive = (
  directory: string,
  options: { readonly persistent: boolean; readonly recursive: boolean },
  listener: (kind: unknown, filename: string | Buffer | null | undefined) => void,
) => FSWatcher

export interface NodeFileWatcherDeps {
  readonly root: string
  readonly now: () => number
  readonly report: (error: unknown) => void
  /** Production always uses node:fs watch; tests substitute it. */
  readonly watch?: NodeWatchPrimitive
}

interface WatchNotification {
  readonly relativePath: string
  readonly identity: string
  readonly observedAt: number
}

function isRecursiveUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'
  )
}

function isSkippedDirectory(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['ENOENT', 'EACCES', 'EPERM'].includes(error.code)
  )
}

/** Links never broaden the watched scope: symlinked directories are not descended. */
function childDirectories(root: string): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch (error: unknown) {
      if (!isSkippedDirectory(error)) throw error
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry)
      let info: { isDirectory: boolean; isLink: boolean }
      try {
        const stat = lstatSync(full)
        info = { isDirectory: stat.isDirectory(), isLink: stat.isSymbolicLink() }
      } catch (error: unknown) {
        if (!isSkippedDirectory(error)) throw error
        continue
      }
      if (!info.isDirectory || info.isLink) continue
      found.push(full)
      stack.push(full)
    }
  }
  return found
}

/**
C-M115-4's workspace file watcher for every node host (the extension
host, ACP, the CLI): one recursive watch where the platform offers it,
one watcher per directory where it does not. Every notification carries
a stat-derived identity, so two processes observing the same change
claim the same event and the schedule fires once.
*/
export function createNodeFileWatcher(deps: NodeFileWatcherDeps): ScheduleWorkspaceWatchPort {
  const root = path.resolve(deps.root)
  const watchPrimitive = deps.watch ?? watch
  return {
    capability(): ScheduleSourceCapability {
      return existsSync(root) ? { available: true } : unavailableSource('workspaceDirectory')
    },
    watch(_globs: readonly string[], listener: (input: unknown) => void): { dispose(): void } {
      // The files source filters by its globs; the port delivers every change.
      const watchers = new Set<FSWatcher>()
      const watched = new Set<string>()
      let isDisposed = false
      let isRecursive = false
      // Filenames arrive relative to the watched directory: the root for
      // a recursive watch, the directory itself for a fallback watch.
      const notify = (watchedDirectory: string, file: string): void => {
        if (isDisposed) return
        const absolute = path.resolve(watchedDirectory, file)
        if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return
        const relativePath = path.relative(root, absolute).split(path.sep).join(path.posix.sep)
        let identity: string
        try {
          const info = lstatSync(absolute, { bigint: true })
          identity = `${String(info.mtimeNs)}:${String(info.size)}`
        } catch (error: unknown) {
          deps.report(error)
          identity = 'missing'
        }
        listener({
          relativePath: relativePath === '' ? '.' : relativePath,
          identity,
          observedAt: deps.now(),
        } satisfies WatchNotification)
      }
      const addWatcher = (directory: string, isRecursiveWatch: boolean): void => {
        if (watched.has(directory)) return
        const watcher = watchPrimitive(
          directory,
          { persistent: false, recursive: isRecursiveWatch },
          (kind, filename) => {
            onEvent(directory, kind, filename)
          },
        )
        watched.add(directory)
        watchers.add(watcher)
        watcher.on('error', (error: unknown) => {
          // The watcher for one directory died; the rest stay held. The
          // failure is reported; its silence afterwards reads as missing
          // fires on the schedule's timeline, never as an error elsewhere.
          deps.report(error)
          watchers.delete(watcher)
          watched.delete(directory)
        })
      }
      const refresh = (): void => {
        if (isDisposed || isRecursive) return
        // Fully synchronous: disposal cannot interleave, so no in-loop check.
        for (const directory of childDirectories(root)) {
          try {
            addWatcher(directory, false)
          } catch (error: unknown) {
            if (!isSkippedDirectory(error)) throw error
            deps.report(error)
          }
        }
      }
      const onEvent = (
        watchedDirectory: string,
        _kind: unknown,
        filename: string | Buffer | null | undefined,
      ): void => {
        if (typeof filename !== 'string') {
          // The kernel coalesced the change beyond recognition; the root's
          // own notification keeps the loss visible to the source filter.
          notify(root, '.')
          return
        }
        notify(watchedDirectory, filename)
        try {
          refresh()
        } catch (error: unknown) {
          deps.report(error)
        }
      }
      try {
        addWatcher(root, true)
        isRecursive = true
      } catch (error: unknown) {
        if (!isRecursiveUnavailable(error)) throw error
        for (const watcher of watchers) watcher.close()
        watchers.clear()
        watched.clear()
        addWatcher(root, false)
        // Every directory holds its watcher before watch() returns, so a
        // change in a nested directory is never missed after subscribing.
        refresh()
      }
      return {
        dispose: () => {
          isDisposed = true
          for (const watcher of watchers) watcher.close()
          watchers.clear()
          watched.clear()
        },
      }
    },
  }
}
