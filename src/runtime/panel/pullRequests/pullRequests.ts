// The pull request service error: a refusal in words for the user.
// The log gets the kind, never a secret.

/** A refusal in words for the user; the log gets the kind, never a secret. */
export class PullRequestServiceError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PullRequestServiceError'
  }
}
