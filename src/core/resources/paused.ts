import { UI_TEXT } from '../../shared/constants'

/** The governor's own status words ("Resources: Paused"), as the status command prints them. */
export function resourcePausedText(): string {
  return `${UI_TEXT.resourceTitle}: ${UI_TEXT.resourcePause}`
}

/** A policy refusal, never a missing containment helper or cancelled admission. */
export class ResourcePausedError extends Error {
  readonly code = 'paused'

  constructor() {
    super(resourcePausedText())
    this.name = 'ResourcePausedError'
  }
}

/** Structural, not instanceof: the queue that refuses lives in another bundle than its callers. */
export function isResourcePaused(error: unknown): error is ResourcePausedError {
  return (
    error instanceof Error &&
    error.name === 'ResourcePausedError' &&
    'code' in error &&
    error.code === 'paused'
  )
}
