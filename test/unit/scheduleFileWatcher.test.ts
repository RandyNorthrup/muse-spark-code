// C-M115-4's workspace file watcher over the real fs watcher: root and
// nested changes arrive with posix relative paths and stat-derived
// identities, a deleted file arrives as a change with nothing to stat, and
// the files source turns them into filesChanged.
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { ScheduleEvent } from '../../src/shared/scheduleEvents'
import { ScheduleFilesSource } from '../../src/core/schedules/events/files'
import { createNodeFileWatcher } from '../../src/runtime/schedules/fileWatcher'
import { usingTempDir } from './helpers/temporaryFolders'

interface Notification {
  readonly relativePath: string
  readonly identity: string
  readonly observedAt: number
}

function isNotification(value: unknown): value is Notification {
  return (
    typeof value === 'object' &&
    value !== null &&
    'relativePath' in value &&
    'identity' in value &&
    'observedAt' in value
  )
}

// Events arrive in any order and a folder's own creation arrives too, so a
// test waits for the paths it needs, never for a count of events.
const WAIT_ATTEMPTS = 60

async function collectUntil(
  collected: Notification[],
  wanted: readonly string[],
): Promise<Notification[]> {
  const hasAll = () => wanted.every((file) => collected.some((item) => item.relativePath === file))
  for (let attempt = 0; attempt < WAIT_ATTEMPTS && !hasAll(); attempt += 1) {
    await delay(50)
  }
  return collected.splice(0)
}

function watchAll(watcher: ReturnType<typeof createNodeFileWatcher>) {
  const collected: Notification[] = []
  const subscription = watcher.watch(['**'], (input: unknown) => {
    if (isNotification(input)) collected.push(input)
  })
  return { collected, subscription }
}

describe('workspace file watcher', () => {
  it('observes root and nested writes with stable identities', async () => {
    await usingTempDir('schedule-file-watch-', async (folder) => {
      const reported: unknown[] = []
      const watcher = createNodeFileWatcher({
        root: folder,
        now: Date.now,
        report: (error) => {
          reported.push(error)
        },
      })
      expect(watcher.capability()).toEqual({ available: true })
      const { collected, subscription } = watchAll(watcher)
      try {
        await writeFile(path.join(folder, 'note.md'), 'hello')
        await mkdir(path.join(folder, 'docs'), { recursive: true })
        await writeFile(path.join(folder, 'docs', 'plan.md'), 'nested')
        const seen = await collectUntil(collected, ['note.md', 'docs/plan.md'])
        const paths = seen.map((item) => item.relativePath)
        expect(paths).toContain('note.md')
        expect(paths).toContain('docs/plan.md')
        // macOS also reports the watched folder under its own name when the
        // watch starts; that names no file and is never delivered.
        expect(paths).not.toContain(path.basename(folder))
        for (const item of seen) {
          expect(item.identity.length).toBeGreaterThan(0)
          expect(item.observedAt).toBeGreaterThan(0)
        }
        // The identity is the file's own stat, so two processes
        // observing the same change claim the same event.
        const { lstatSync } = await import('node:fs')
        const info = lstatSync(path.join(folder, 'docs', 'plan.md'), { bigint: true })
        const settled = `${String(info.mtimeNs)}:${String(info.size)}`
        expect(seen.some((item) => item.identity === settled)).toBe(true)
        expect(reported).toEqual([])
      } finally {
        subscription.dispose()
      }
    })
  })

  it('drives filesChanged events for root and nested changes', async () => {
    await usingTempDir('schedule-files-source-', async (folder) => {
      const reported: unknown[] = []
      const events: ScheduleEvent[] = []
      const source = new ScheduleFilesSource(
        ['**'],
        createNodeFileWatcher({
          root: folder,
          now: Date.now,
          report: (error) => {
            reported.push(error)
          },
        }),
        (id) => {
          reported.push(id)
        },
      )
      const subscription = source.subscribe((event) => {
        events.push(event)
      })
      try {
        await writeFile(path.join(folder, 'root.txt'), 'root')
        await mkdir(path.join(folder, 'sub'), { recursive: true })
        await writeFile(path.join(folder, 'sub', 'nested.txt'), 'nested')
        const hasBoth = () => {
          const found = new Set(events.map((event) => event.fields['path']))
          return found.has('root.txt') && found.has('sub/nested.txt')
        }
        for (let attempt = 0; attempt < WAIT_ATTEMPTS && !hasBoth(); attempt += 1) {
          await delay(50)
        }
        const paths = events.map((event) => event.fields['path'])
        expect(paths).toContain('root.txt')
        expect(paths).toContain('sub/nested.txt')
        for (const event of events) {
          expect(event.source).toBe('files')
          expect(event.kind).toBe('filesChanged')
        }
        expect(reported).toEqual([])
      } finally {
        subscription.dispose()
      }
    })
  })

  it('delivers a deleted file as a change, and reports nothing', async () => {
    await usingTempDir('schedule-watch-delete-', async (folder) => {
      const reported: unknown[] = []
      await writeFile(path.join(folder, 'gone.txt'), 'soon')
      const watcher = createNodeFileWatcher({
        root: folder,
        now: Date.now,
        report: (error) => {
          reported.push(error)
        },
      })
      const { collected, subscription } = watchAll(watcher)
      try {
        await unlink(path.join(folder, 'gone.txt'))
        const seen = await collectUntil(collected, ['gone.txt'])
        expect(seen.map((item) => item.relativePath)).toContain('gone.txt')
        expect(seen.find((item) => item.relativePath === 'gone.txt')?.identity).toBe('missing')
        expect(reported).toEqual([])
      } finally {
        subscription.dispose()
      }
    })
  })

  it('stops delivering after dispose', async () => {
    await usingTempDir('schedule-watch-dispose-', async (folder) => {
      const reported: unknown[] = []
      const watcher = createNodeFileWatcher({
        root: folder,
        now: Date.now,
        report: (error: unknown) => {
          reported.push(error)
        },
      })
      let count = 0
      const subscription = watcher.watch(['**'], () => {
        count += 1
      })
      await writeFile(path.join(folder, 'first.txt'), 'first')
      for (let attempt = 0; attempt < 100 && count < 1; attempt += 1) {
        await delay(50)
      }
      expect(count).toBeGreaterThanOrEqual(1)
      subscription.dispose()
      const before = count
      await writeFile(path.join(folder, 'second.txt'), 'second')
      await delay(500)
      expect(count).toBe(before)
      expect(reported).toEqual([])
    })
  })
})
