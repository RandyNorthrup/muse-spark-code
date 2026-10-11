// Shared dot classes must not import the lazy tool-row renderer.
import { TOOL_STATUS_INTERRUPTED } from '../shared/constants'

export function statusDotClass(status: string): string {
  if (status === 'inProgress') {
    return 'tool-dot tool-dot-running'
  }
  if (status === TOOL_STATUS_INTERRUPTED) {
    return 'tool-dot tool-dot-muted'
  }
  return status === 'completed' ? 'tool-dot tool-dot-ok' : 'tool-dot tool-dot-failed'
}
