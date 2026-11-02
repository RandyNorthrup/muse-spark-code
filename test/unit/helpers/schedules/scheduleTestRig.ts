// The schedule engine's test rig, shared instead of repeated: a bridge
// with quiet test deps, and the shared engine box's teardown (close the
// engine, then remove its folder), so the duplication gate stays silent
// and every engine still cleans up the same way.
import { createSchedulesBridge } from '../../../../src/host/schedules/schedulesBridge'
import { removeFolder } from '../temporaryFolders'

/** A schedules bridge over `distDir`, enabled, delivering when idle. */
export function testScheduleBridge(distDir: string): ReturnType<typeof createSchedulesBridge> {
  return createSchedulesBridge({
    distDir,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    isEnabled: () => true,
    defaultDelivery: () => 'whenIdle',
    pauseAfterFailures: () => 3,
  })
}

/** Closes a shared schedule engine and removes its folder, if it ran. */
export async function closeSharedScheduleEngine(box: {
  current?:
    | { readonly engine: { readonly runtime: { close(): Promise<void> } }; readonly root: string }
    | undefined
}): Promise<void> {
  const current = box.current
  box.current = undefined
  if (current === undefined) return
  try {
    await current.engine.runtime.close()
  } finally {
    await removeFolder(current.root)
  }
}
