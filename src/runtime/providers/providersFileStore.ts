// M108/W: the runtime's own providers file, beside the ACP session folders.
// It holds account metadata only, never a credential. M95 owns the VS
// Code-side envelope; this mirrors its accounts field, preserving every
// other key byte-for-byte in field order. Writes are atomic (temporary file
// plus rename); a corrupt file throws instead of being clobbered.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { accountIdSchema, accountSchema, type Account } from '../../shared/accounts'
import type { AccountProvider, AccountsMetadataPort } from '../../core/providers/accounts'
import { AccountStoreError } from '../../core/providers/accountCredentialRecord'

const providerEntrySchema = z.strictObject({
  id: accountIdSchema,
  policyProvider: accountIdSchema,
  product: accountIdSchema,
  auth: z.enum(['apiKey', 'oauth', 'subscription', 'none']),
  origin: z.string(),
  accounts: z.optional(z.array(accountSchema)),
})

function providerOf(value: unknown): AccountProvider | undefined {
  const parsed = providerEntrySchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function runtimeProvidersFile(dataDir: string): string {
  return path.join(dataDir, 'providers.json')
}

/** File-backed metadata for one runtime process. Shares nothing with M109. */
export class FileAccountsMetadata implements AccountsMetadataPort {
  public constructor(private readonly file: string) {}

  private load(): { envelope: object; providers: Record<string, unknown> } {
    if (!existsSync(this.file)) return { envelope: {}, providers: {} }
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      // Vanished or unreadable between the check and the read: report
      // unavailable rather than a partial read.
      throw new AccountStoreError('unavailable')
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(text)
    } catch {
      throw new AccountStoreError('unavailable')
    }
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope))
      throw new AccountStoreError('unavailable')
    const raw: unknown = 'providers' in envelope ? envelope.providers : undefined
    if (raw === undefined) return { envelope, providers: {} }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new AccountStoreError('unavailable')
    const providers: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) providers[key] = value
    return { envelope, providers }
  }

  public read(provider: string): Promise<AccountProvider | undefined> {
    if (!accountIdSchema.safeParse(provider).success) return Promise.resolve(undefined)
    const value = this.load().providers[provider]
    if (value === undefined) return Promise.resolve(undefined)
    const entry = providerOf(value)
    if (entry === undefined) throw new AccountStoreError('unavailable')
    return Promise.resolve(entry)
  }

  public writeAccounts(provider: string, accounts: readonly Account[]): Promise<void> {
    const { envelope, providers } = this.load()
    const entry = providerOf(providers[provider])
    if (entry === undefined) throw new AccountStoreError('invalidAccount')
    mkdirSync(path.dirname(this.file), { recursive: true })
    const next = {
      ...envelope,
      providers: { ...providers, [provider]: { ...entry, accounts: [...accounts] } },
    }
    const temporary = `${this.file}.${process.pid.toString()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(next, undefined, 2)}\n`, 'utf8')
    renameSync(temporary, this.file)
    return Promise.resolve()
  }
}

export function fileAccountsMetadata(dataDir: string): FileAccountsMetadata {
  return new FileAccountsMetadata(runtimeProvidersFile(dataDir))
}
