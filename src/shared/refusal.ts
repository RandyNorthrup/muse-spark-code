/** A local, intentional refusal; its message is already safe for the user. */
export class UserRefusalError extends Error {
  public constructor(
    message: string,
    public readonly code?: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'UserRefusalError'
  }
}
