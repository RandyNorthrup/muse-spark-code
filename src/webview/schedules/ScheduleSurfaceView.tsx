import { useMemo } from 'react'
import type { ScheduleRequest } from '../../shared/scheduleV2'
import { createScheduleSurfacePort } from './hostPort'
import { ScheduleSurface } from './ScheduleSurface'
import type { ScheduleSurfaceProps } from './ports'

export interface DeferredScheduleSurfaceProps {
  /** Everything the host posted, minus what the panel supplies. */
  readonly surface: Omit<ScheduleSurfaceProps, 'port' | 'onClose' | 'reportAction'>
  readonly request: (request: ScheduleRequest) => Promise<unknown>
  readonly subscribeChanges: (listener: (message: unknown) => void) => () => void
  readonly nowMs: () => number
  readonly onClose: () => void
}

/**
 * W's deferred surface mount (M115): the port over the panel channel plus
 * the close that drops the panel state. The time math stays in this chunk,
 * out of the activation bundle.
 */
export function ScheduleSurfaceView({
  surface,
  request,
  subscribeChanges,
  nowMs,
  onClose,
}: DeferredScheduleSurfaceProps) {
  const port = useMemo(
    () => createScheduleSurfacePort({ request, subscribeChanges }, nowMs),
    [request, subscribeChanges, nowMs],
  )
  return <ScheduleSurface {...surface} port={port} onClose={onClose} />
}
