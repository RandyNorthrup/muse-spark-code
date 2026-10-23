// M108/W: the runtime's own providers file, beside the ACP session folders.
// It holds account metadata only, never a credential. M95 owns the VS
// Code-side envelope; this mirrors its accounts field, preserving every
// other key byte-for-byte in field order. Writes are atomic (temporary file
// plus rename); a corrupt file throws instead of being clobbered.
// CM108ACC: Meta's Model API is the one provider the runtime natively knows
// (its key names, its fixed origin, its policy row), so its entry is
// built in: the CLI, ACP and headless serve the default account with no
// pre-existing file, and the first metadata write persists the row. Once
// the user has a file the built-in entry no longer applies: an absent row
// is unconfigured, and a malformed row refuses without touching the file.
// Any other provider needs its stored row (a later owner supplies it);
// nothing here invents its origin or policy mapping.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  accountIdSchema,
  accountPoolSchema,
  accountSchema,
  type Account,
} from '../../shared/accounts'
import type { AccountProvider, AccountsMetadataPort } from '../../core/providers/accounts'
import { AccountStoreError } from '../../core/providers/accountCredentialRecord'
import { MODEL_API_BASE_URL } from '../../shared/constants'

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

/** A stored row counts only when it is whole: the entry id matches its map
key and the complete pool (not just each row) validates, so duplicate ids
refuse here instead of throwing a raw schema error from the store later. */
function storedProviderOf(key: string, value: unknown): AccountProvider | undefined {
  const entry = providerOf(value)
  if (entry?.id !== key) return undefined
  if (
    key === 'meta' &&
    (entry.policyProvider !== 'meta' ||
      entry.product !== 'model-api' ||
      entry.auth !== 'apiKey' ||
      entry.origin !== new URL(MODEL_API_BASE_URL).origin)
  )
    return undefined
  return entry.accounts !== undefined && !accountPoolSchema.safeParse(entry.accounts).success
    ? undefined
    : entry
}

/** The built-in entry: every field is already pinned in-repo (the key names
in accountCredentialRecord.ts, the origin in MODEL_API_BASE_URL, the
meta/model-api policy row). An absent accounts field migrates the default
account in the store, so the pre-existing key keeps working. */
function builtInProvider(id: string): AccountProvider | undefined {
  if (id !== 'meta') return undefined
  return {
    id: 'meta',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey',
    origin: new URL(MODEL_API_BASE_URL).origin,
  }
}

export function runtimeProvidersFile(dataDir: string): string {
  return path.join(dataDir, 'providers.json')
}

/** File-backed metadata for one runtime process. Shares nothing with M109. */
export class FileAccountsMetadata implements AccountsMetadataPort {
  public constructor(private readonly file: string) {}

  private load(): { exists: boolean; envelope: object; providers: Record<string, unknown> } {
    if (!existsSync(this.file)) return { exists: false, envelope: {}, providers: {} }
    let text: string
    try {
      text = readFileSync(this.file, 'utf8')
    } catch (error: unknown) {
      // Vanished or unreadable between the check and the read: report
      // unavailable rather than a partial read, keeping the disk failure as
      // the cause so the person hears it instead of a generic sentence.
      throw new AccountStoreError('unavailable', 'unavailable', { cause: error })
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(text)
    } catch (error) {
      // A file no JSON value denotes is not a providers file. Anything else
      // keeps its kind.
      if (error instanceof SyntaxError) throw new AccountStoreError('invalidProvidersFile')
      throw error
    }
    if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope))
      throw new AccountStoreError('invalidProvidersFile')
    const raw: unknown = 'providers' in envelope ? envelope.providers : undefined
    if (raw === undefined) return { exists: true, envelope, providers: {} }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new AccountStoreError('invalidProvidersFile')
    const providers: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw)) providers[key] = value
    return { exists: true, envelope, providers }
  }

  public read(provider: string): Promise<AccountProvider | undefined> {
    return Promise.resolve(this.readNow(provider))
  }

  public readNow(provider: string): AccountProvider | undefined {
    if (!accountIdSchema.safeParse(provider).success) return undefined
    const loaded = this.load()
    const value = loaded.providers[provider]
    // The built-in Meta entry serves a missing file only: once the user has
    // a file, an absent row is unconfigured and a malformed row refuses.
    if (value === undefined) return loaded.exists ? undefined : builtInProvider(provider)
    const entry = storedProviderOf(provider, value)
    if (entry === undefined) throw new AccountStoreError('invalidProvidersFile')
    return entry
  }

  public writeAccounts(provider: string, accounts: readonly Account[]): Promise<void> {
    const { envelope, providers } = this.load()
    const raw = providers[provider]
    // Absence takes the built-in base; a present-but-malformed user row
    // refuses and leaves the file untouched instead of being overwritten.
    if (raw !== undefined && storedProviderOf(provider, raw) === undefined)
      throw new AccountStoreError('invalidProvidersFile')
    const entry = storedProviderOf(provider, raw) ?? builtInProvider(provider)
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
