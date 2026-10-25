import type { ScheduleEventKind } from '../../../shared/scheduleEvents'
import { UI_TEXT } from '../../../shared/constants'
import { ScheduleHostEvents } from './signals'

const hubs = new Map<string, ScheduleHostEvents>()

/**
The process-wide host event hubs, one per workspace and source id. Any
in-process publisher (the schedule engine's own settlements, M112's
answers) publishes here; the workspace's intake subscribes. A second
registration with different kinds is a caller bug and throws.
*/
export function hostEventHub(
  workspaceKey: string,
  id: string,
  kinds: readonly ScheduleEventKind[],
): ScheduleHostEvents {
  const key = `${workspaceKey} ${id}`
  const existing = hubs.get(key)
  if (existing !== undefined) {
    if (existing.id !== id || JSON.stringify([...existing.kinds]) !== JSON.stringify([...kinds]))
      throw new Error(UI_TEXT.scheduleV2.runtime.invalidRequest)
    return existing
  }
  const hub = new ScheduleHostEvents(id, kinds)
  hubs.set(key, hub)
  return hub
}
