// The Model API request errors as shapes, without the transport (D6): the
// ACP agent, the providers and the report read these without requiring the
// backend bundle, so a `--version`, `--help` or Muse Code-backend serve
// never pays for the engine. Each bundle carries its own copy; the guards
// duck-type across that boundary on purpose.

export class ModelApiError extends Error {
  /** The provider's request id, when its answer carried one (lane PROVERR). */
  public requestId: string | undefined
  /** The answer's parsed `Retry-After`, when it carried one (lane PROVERR). */
  public retryAfterMs: number | undefined
  public constructor(
    message: string,
    /** HTTP status, or 0 when the request never got a response. */
    public readonly status: number,
    /** The envelope's `error.type` (`rate_limit_error`, …), when any. */
    public readonly kind: string | undefined,
    /** The envelope's `error.code` (`invalid_api_key`, …), when any. */
    public readonly code: string | undefined,
  ) {
    super(message)
    this.name = 'ModelApiError'
  }
}

/** The providers and Model API bundles have separate constructors (D6). */
export function isModelApiError(value: unknown): value is ModelApiError {
  return (
    value instanceof ModelApiError ||
    (typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      (value.name === 'ModelApiError' || value.name === 'CredentialOriginError') &&
      'message' in value &&
      typeof value.message === 'string' &&
      'status' in value &&
      typeof value.status === 'number' &&
      Number.isFinite(value.status) &&
      (!('kind' in value) || value.kind === undefined || typeof value.kind === 'string') &&
      (!('code' in value) || value.code === undefined || typeof value.code === 'string'))
  )
}

/** Thrown when the key is absent: the caller decides how to prompt. */
export class MissingApiKeyError extends Error {
  public constructor() {
    super('No Model API key is stored')
    this.name = 'MissingApiKeyError'
  }
}

/** Lazy Node bundles have distinct constructors; use the shared error shape. */
export function isMissingApiKeyError(error: unknown): error is MissingApiKeyError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'MissingApiKeyError' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}
