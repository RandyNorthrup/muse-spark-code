import { existsSync, lstatSync, watch } from 'node:fs'
import path from 'node:path'
import type { ScheduleSourceCapability } from '../../shared/scheduleEvents'
import { unavailableSource } from '../../core/schedules/events/ports'
import type { ScheduleWorkspaceWatchPort } from '../../core/schedules/events/files'

export interface NodeFileWatcherDeps {
  readonly root: string
  readonly now: () => number
  readonly report: (error: unknown) => void
}

interface WatchNotification {
  readonly relativePath: string
  readonly identity: string
  readonly observedAt: number
}

/**
C-M115-4's workspace file watcher for every node host (the extension
host, ACP, the CLI): one recursive watch of the workspace root (Node 22
offers it on Windows, macOS and Linux). Every notification carries a
stat-derived identity, so two processes observing the same change claim the
same event and the schedule fires once.
*/
export function createNodeFileWatcher(deps: NodeFileWatcherDeps): ScheduleWorkspaceWatchPort {
  const root = path.resolve(deps.root)
  return {
    capability(): ScheduleSourceCapability {
      return existsSync(root) ? { available: true } : unavailableSource('workspaceDirectory')
    },
    watch(_globs: readonly string[], listener: (input: unknown) => void): { dispose(): void } {
      // The files source filters by its globs; the port delivers every change.
      let isDisposed = false
      const notify = (file: string): void => {
        if (isDisposed) return
        const absolute = path.resolve(root, file)
        if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) return
        const relativePath = path.relative(root, absolute).split(path.sep).join(path.posix.sep)
        let identity: string
        try {
          const info = lstatSync(absolute, { bigint: true })
          identity = `${String(info.mtimeNs)}:${String(info.size)}`
        } catch (error: unknown) {
          // A deleted file is a change with nothing left to stat; any other
          // failure to stat is reported.
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
            deps.report(error)
          identity = 'missing'
        }
        listener({
          relativePath: relativePath === '' ? '.' : relativePath,
          identity,
          observedAt: deps.now(),
        } satisfies WatchNotification)
      }
      const watcher = watch(
        root,
        { persistent: false, recursive: true },
        (_kind, filename: string | Buffer | null) => {
          if (typeof filename !== 'string') {
            // The kernel coalesced the change beyond recognition; the root's
            // own notification keeps the loss visible to the source filter.
            notify('.')
            return
          }
          // macOS also reports the watched folder itself under its own
          // name (its creation, replayed when the watch starts). That names
          // no file in the workspace, so there is nothing to deliver.
          if (filename === path.basename(root) && !existsSync(path.join(root, filename))) return
          notify(filename)
        },
      )
      // A dead watcher is reported; its silence afterwards reads as missing
      // fires on the schedule's timeline, never as an error elsewhere.
      watcher.on('error', (error: unknown) => {
        deps.report(error)
      })
      return {
        dispose: () => {
          isDisposed = true
          watcher.close()
        },
      }
    },
  }
}
