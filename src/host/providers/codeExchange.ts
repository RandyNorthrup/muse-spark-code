// One OAuth code exchange's shared tail (OpenRouter, Hugging Face): the
// single exchange, the discarded-key notice when cancellation lands
// after a mint, and the stored record bound to the provider's origin.
import type { CredentialRecord } from './credentialRecords'
import type { CodeExchanger } from './providerPorts'

export interface CodeExchangeRequest {
  readonly exchange: CodeExchanger
  readonly code: string
  readonly verifier: string
  /** Repeats the callback the code was authorized with. */
  readonly redirectUri: string
  /** The origin the minted key is bound to. */
  readonly origin: string
  /** The fixed sentence when the exchange yields no key. */
  readonly connectFailed: string
  readonly signal?: AbortSignal
  readonly onDiscardedKey?: () => void
}

export interface ExchangedKey {
  /** The key, for the caller to store bound to the origin. */
  readonly key: string
  readonly record: CredentialRecord
}

/**
Exchanges one code once and binds the minted key to its origin. A
complete exchange that meets cancellation still reports disposal; an
empty answer refuses with the connect sentence.
*/
export async function exchangeCodeForStoredKey(
  request: CodeExchangeRequest,
): Promise<ExchangedKey> {
  request.signal?.throwIfAborted()
  const key = await request.exchange.exchange({
    code: request.code,
    verifier: request.verifier,
    redirectUri: request.redirectUri,
    ...(request.signal !== undefined && { signal: request.signal }),
  })
  if (request.signal?.aborted && key.trim() !== '') request.onDiscardedKey?.()
  request.signal?.throwIfAborted()
  if (key.trim() === '') throw new Error(request.connectFailed)
  const secret = key.trim()
  return { key: secret, record: { v: 1, auth: 'apiKey', origin: request.origin, secret } }
}
