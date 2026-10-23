/** Why a created-resources registry save failed, in fixed vocabulary. */
export type CreatedRegistrySaveReason = 'refused' | 'unsafe' | 'invalid' | 'io' | 'contended'

const CREATED_REGISTRY_SAVE_REASONS: readonly unknown[] = [
  'refused',
  'unsafe',
  'invalid',
  'io',
  'contended',
] satisfies readonly CreatedRegistrySaveReason[]

const CREATED_REGISTRY_SAVE_ERROR = 'CreatedRegistrySaveError'

/**
A save the registry could not land: the native helper refused it for its own
reasons (refused), a safety check on the base, the parent or the live
manifest failed (unsafe), the live or merged manifest failed validation
(invalid), the stage could not be written (io), or another process kept
publishing first past the republish bound (contended).
*/
export class CreatedRegistrySaveError extends Error {
  public constructor(
    public readonly reason: CreatedRegistrySaveReason,
    options?: ErrorOptions,
  ) {
    super('The created-resources registry could not be saved', options)
    this.name = CREATED_REGISTRY_SAVE_ERROR
  }
}

/** Whether a save failed genuinely (cross-bundle: the name and reason, never instanceof). */
export function isCreatedRegistrySaveError(error: unknown): error is CreatedRegistrySaveError {
  return (
    error instanceof Error &&
    error.name === CREATED_REGISTRY_SAVE_ERROR &&
    'reason' in error &&
    CREATED_REGISTRY_SAVE_REASONS.includes(error.reason)
  )
}
