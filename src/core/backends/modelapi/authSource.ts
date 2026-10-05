// M95-T: only this boundary knows how a provider's authorization is obtained.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { AuthHeader } from '../../providers/presets'
import { credentialRecordSchema, isCredentialBound } from '../../providers/credentialRecord'
import { redactSecrets } from '../../redact'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { ModelApiError } from './transport'

export interface AuthHeaders {
  readonly values: Readonly<Record<string, string>>
  readonly keyDigest: string
  readonly redact: (text: string) => string
}

export interface AuthSource {
  /** Read and bind again for every attempt, including retries. */
  headers(requestUrl: string): Promise<AuthHeaders>
}

const storedKeySchema = z.object({ record: credentialRecordSchema, key: z.string() })

/** Both origins are safe structured fields; callers can offer credential entry again. */
export class CredentialOriginError extends ModelApiError {
  public constructor(
    public readonly storedOrigin: string,
    public readonly requestOrigin: string,
  ) {
    super(
      fill(UI_TEXT.webFetchNetwork, {
        detail: `origin_mismatch (${storedOrigin} → ${requestOrigin})`,
      }),
      0,
      'origin_mismatch',
      undefined,
    )
    this.name = 'CredentialOriginError'
  }
}

function origin(url: string): string {
  const parsed = new URL(url)
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ModelApiError(UI_TEXT.webFetchCredentials, 0, 'invalid_origin', undefined)
  }
  return parsed.origin
}

/** A pasted/OAuth-obtained key read from the owner's secret store, never configuration. */
export class ApiKeyAuthSource implements AuthSource {
  public constructor(
    private readonly read: () => Promise<unknown>,
    private readonly header: AuthHeader,
  ) {}

  public async headers(requestUrl: string): Promise<AuthHeaders> {
    const stored = z.safeParse(storedKeySchema, await this.read())
    if (
      !stored.success ||
      stored.data.record.auth !== 'apiKey' ||
      stored.data.key.trim() === '' ||
      /[\r\n]/u.test(stored.data.key)
    ) {
      throw new ModelApiError(
        fill(UI_TEXT.webFetchNetwork, { detail: 'credential_required' }),
        0,
        'credential_required',
        undefined,
      )
    }
    const { record, key } = stored.data
    // The endpoint has already had its query/path checked by the codec's pin.
    const requestOrigin = origin(requestUrl)
    if (!isCredentialBound(record, requestOrigin)) {
      throw new CredentialOriginError(origin(record.origin), requestOrigin)
    }
    const values: Record<string, string> = {}
    switch (this.header) {
      case 'bearer': {
        values['Authorization'] = `Bearer ${key}`
        break
      }
      case 'x-api-key': {
        values['x-api-key'] = key
        break
      }
      case 'x-goog-api-key': {
        values['x-goog-api-key'] = key
        break
      }
      case 'api-key': {
        values['api-key'] = key
        break
      }
    }
    return {
      values,
      keyDigest: createHash('sha256').update(key).digest('hex'),
      redact: (text) => redactSecrets(text, [key]),
    }
  }
}

/** A saved local endpoint still binds its address, even when it sends no credential. */
export class NoAuthSource implements AuthSource {
  private readonly boundOrigin: string
  public constructor(boundOrigin: string) {
    this.boundOrigin = origin(boundOrigin)
  }
  public headers(requestUrl: string): Promise<AuthHeaders> {
    const requestOrigin = origin(requestUrl)
    if (requestOrigin !== this.boundOrigin) {
      throw new CredentialOriginError(this.boundOrigin, requestOrigin)
    }
    return Promise.resolve({
      values: {},
      keyDigest: createHash('sha256').update(this.boundOrigin).digest('hex'),
      redact: redactSecrets,
    })
  }
}
