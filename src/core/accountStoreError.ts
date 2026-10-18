// The account store's refusal, in a leaf of its own: the configured providers
// and the ChatGPT session client raise the providers-file refusal without
// carrying the account record schemas. Surfaces recognize it by its brand
// (name and code, src/acp/accountText.ts): each bundle carries its own copy.
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'

export class AccountStoreError extends Error {
  public constructor(
    public readonly code:
      | 'invalidAccount'
      | 'notOffered'
      | 'unavailable'
      | 'invalidCredential'
      | 'originMismatch'
      | 'invalidProvidersFile',
    message: string = code,
  ) {
    // A fixed code, or a fixed sentence filled with a fixed word: store and
    // revocation errors can contain the secret itself.
    super(message)
    this.name = 'AccountStoreError'
  }
}

/**
 * The providers file could not be read: the providers-file refusal every
 * surface checks for, carrying the sentence a person reads, so no surface
 * reports it as the credential store or a generic failure (PR #180).
 */
export function providersFileUnreadable(reason: 'unparseable' | 'invalid'): AccountStoreError {
  return new AccountStoreError(
    'invalidProvidersFile',
    fill(UI_TEXT.acpChatGpt.providersFileUnreadable, { reason }),
  )
}
