// Import and export (M95 lane K, PLAN.md D74): the non-secret
// configuration exports and imports as JSON for a team; credentials are
// never in it, and an imported file is untrusted (validated, previewed as
// a diff, each address shown and confirmed, every provider marked
// "needs a key").

import * as z from 'zod/mini'
import { modelRef, providersFile } from '../backend/providersEntry'
import { UI_TEXT } from '../../shared/constants'
import type { ProviderCredentialStore } from './credentialRecords'
import type { AddressCheck, AddressPolicy, ProviderEntry, ProvidersStore } from './providerPorts'

/** Export only canonical non-secret fields, including subscription configuration. */
export const providerEntrySchema = providersFile.providerEntrySchema
const providersDocumentSchema = providersFile.providersFileSchema

export interface ProvidersDocument {
  readonly v: 1
  readonly defaultModel?: string | undefined
  readonly providers: ProviderEntry[]
}

/** Whether a parsed value is a providers document. */
export function parseProvidersDocument(
  raw: unknown,
  presetAddress?: (preset: string) => string | undefined,
): ProvidersDocument {
  const parsed = providersDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`The providers file is not valid: ${z.prettifyError(parsed.error)}`)
  }
  const providers = parsed.data.providers.map((entry) => {
    const address = entry.address ?? presetAddress?.(entry.preset) ?? ''
    if (entry.id.trim() === '' || entry.preset.trim() === '' || address.trim() === '') {
      throw new Error(`The providers file names a provider with an empty id, preset or address`)
    }
    return { ...entry, address }
  })
  const ids = new Set(providers.map((entry) => entry.id))
  if (ids.size !== providers.length) throw new Error(UI_TEXT.actionFailed)
  if (parsed.data.defaultModel !== undefined) {
    const ref = modelRef.parseModelRef(parsed.data.defaultModel)
    if (
      ref === undefined ||
      (ref.providerId !== 'meta' &&
        providers.every(
          (entry) => entry.id !== ref.providerId || !entry.models.includes(ref.modelId),
        ))
    ) {
      throw new Error(UI_TEXT.providerText.schema.modelRef)
    }
  }
  return { ...parsed.data, providers }
}

function parseDocumentText(
  text: string,
  presetAddress?: (preset: string) => string | undefined,
): ProvidersDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The providers file is not valid JSON')
  }
  return parseProvidersDocument(raw, presetAddress)
}

/**
 * The non-secret configuration as JSON for a team. Credentials are never
 * in it: only what `ProvidersStore.list` holds (lane P's file holds no
 * secret either, D74).
 */
export async function exportProviders(store: ProvidersStore): Promise<string> {
  const entries = await store.list()
  const document: ProvidersDocument = {
    v: 1,
    defaultModel: await store.defaultModel(),
    providers: entries.map((entry) => ({
      ...providerEntrySchema.parse(entry),
      address: entry.address,
    })),
  }
  return `${JSON.stringify(document, undefined, 2)}\n`
}

export interface ImportPreviewRow {
  readonly change: 'added' | 'changed' | 'removed'
  readonly entry: ProviderEntry
  /** Every imported provider needs its key entered again. */
  readonly needsKey: boolean
  /** The address check for an added or changed entry; undefined for removals. */
  readonly address: AddressCheck | undefined
}

export interface ImportPreview {
  readonly rows: readonly ImportPreviewRow[]
}

function isSameEntry(left: ProviderEntry, right: ProviderEntry): boolean {
  return (
    JSON.stringify(providerEntrySchema.parse(left)) ===
    JSON.stringify(providerEntrySchema.parse(right))
  )
}

/**
 * Previews an import as a diff against the current file. Throws on an
 * unreadable file, an unknown shape, or a refused address: an import never
 * skips the address check (M95 acceptance 6, Tests).
 */
export async function previewProvidersImport(
  current: readonly ProviderEntry[],
  text: string,
  policy: AddressPolicy,
  presetAddress?: (preset: string) => string | undefined,
): Promise<ImportPreview> {
  return await previewDocument(current, parseDocumentText(text, presetAddress), policy)
}

async function previewDocument(
  current: readonly ProviderEntry[],
  document: ProvidersDocument,
  policy: AddressPolicy,
): Promise<ImportPreview> {
  const incoming = document.providers
  const present = new Map(current.map((entry) => [entry.id, entry]))
  const rows: ImportPreviewRow[] = []
  for (const entry of incoming) {
    const old = present.get(entry.id)
    const address = await policy.check(entry.address)
    if (address.kind === 'refused') {
      throw new Error(`Provider ${entry.id} cannot be imported: ${address.detail}`)
    }
    if (old === undefined) {
      rows.push({ change: 'added', entry, needsKey: entry.auth !== 'none', address })
    } else if (!isSameEntry(old, entry) || entry.auth !== 'none' || address.kind === 'private') {
      rows.push({ change: 'changed', entry, needsKey: entry.auth !== 'none', address })
    }
    present.delete(entry.id)
  }
  for (const entry of present.values()) {
    rows.push({ change: 'removed', entry, needsKey: false, address: undefined })
  }
  return { rows }
}

export interface ProvidersImportDeps {
  readonly store: ProvidersStore
  readonly credentials: Pick<ProviderCredentialStore, 'clearProviderCredential'>
  readonly policy: AddressPolicy
  readonly presetAddress?: (preset: string) => string | undefined
  /**
   * Shows the preview (every address, every "needs a key") and asks to go
   * on. False, or a dismissal, imports nothing.
   */
  readonly confirm: (preview: ImportPreview) => Promise<boolean>
}

/**
 * Imports a confirmed file, replacing the whole configuration. Returns the
 * imported providers' count; an unconfirmed, unreadable or refused import
 * writes nothing.
 */
export async function importProviders(deps: ProvidersImportDeps, text: string): Promise<number> {
  const document = parseDocumentText(text, deps.presetAddress)
  const current = await deps.store.list()
  const preview = await previewDocument(current, document, deps.policy)
  if (!(await deps.confirm(preview))) {
    return 0
  }
  // Clear even unchanged imported ids: the preview promises credential re-entry.
  // Fail closed before publishing configuration if SecretStorage cleanup fails.
  const ids = new Set([...current, ...document.providers].map((entry) => entry.id))
  for (const id of ids) {
    await deps.credentials.clearProviderCredential(id)
  }
  const incoming = document.providers.map((entry) => {
    const checked = preview.rows.find((row) => row.entry.id === entry.id)?.address
    const { privateNetwork: _old, ...rest } = entry
    return checked?.kind === 'private' ? { ...rest, privateNetwork: true } : rest
  })
  await deps.store.replaceAll(incoming, { defaultModel: document.defaultModel })
  return incoming.length
}
