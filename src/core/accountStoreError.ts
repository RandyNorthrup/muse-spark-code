// The account store's refusal, in a leaf of its own: the configured providers
// and the ChatGPT session client raise the providers-file refusal without
// carrying the account record schemas. Surfaces recognize it by its brand
// (name and code, src/acp/accountText.ts): each bundle carries its own copy.
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'

export class AccountStoreError extends Error {
  public readonly placement: { provider: string; device: string } | undefined
  public constructor(
    public readonly code:
      | 'invalidAccount'
      | 'notOffered'
      | 'unavailable'
      | 'invalidCredential'
      | 'originMismatch'
      | 'invalidProvidersFile'
      | 'placementConflict',
    message: string = code,
    options?: { cause?: unknown; placement?: { provider: string; device: string } },
  ) {
    // A fixed code, or a fixed sentence filled with a fixed word: store and
    // revocation errors can contain the secret itself. A cause stays off the
    // message (D207: the handler keeps it, never shows it). A placement
    // conflict carries its opaque ids for structured surfaces; the message
    // already fills them into the two-ways-forward sentence.
    super(message, options)
    this.name = 'AccountStoreError'
    this.placement = options?.placement
  }
}

/**
The providers file could not be read: the providers-file refusal every
surface checks for, carrying the sentence a person reads, so no surface
reports it as the credential store or a generic failure (PR #180).
*/
export function providersFileUnreadable(reason: 'unparseable' | 'invalid'): AccountStoreError {
  return new AccountStoreError(
    'invalidProvidersFile',
    fill(UI_TEXT.acpChatGpt.providersFileUnreadable, { reason }),
  )
}
