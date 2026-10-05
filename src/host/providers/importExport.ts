// Import and export (M95 lane K, PLAN.md D74): the non-secret
// configuration exports and imports as JSON for a team; credentials are
// never in it, and an imported file is untrusted (validated, previewed as
// a diff, each address shown and confirmed, every provider marked
// "needs a key").

import * as z from 'zod/mini'
import type { AddressCheck, AddressPolicy, ProviderEntry, ProvidersStore } from './providerPorts'

/**
 * One provider entry as the file and the panel's wizard draft both hold it
 * (the draft's provider is validated against this same shape).
 */
export const providerEntrySchema = z.object({
  id: z.string(),
  presetId: z.string(),
  address: z.string(),
  auth: z.enum(['apiKey', 'none', 'oauth', 'subscription']),
  models: z.array(z.string()),
  isPrivate: z.optional(z.boolean()),
})

const providersDocumentSchema = z.object({
  version: z.literal(1),
  providers: z.array(providerEntrySchema),
})

export type ProvidersDocument = z.infer<typeof providersDocumentSchema>

/** Whether a parsed value is a providers document. */
export function parseProvidersDocument(raw: unknown): ProvidersDocument {
  const parsed = providersDocumentSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`The providers file is not valid: ${z.prettifyError(parsed.error)}`)
  }
  for (const entry of parsed.data.providers) {
    if (entry.id.trim() === '' || entry.presetId.trim() === '' || entry.address.trim() === '') {
      throw new Error(`The providers file names a provider with an empty id, preset or address`)
    }
  }
  return parsed.data
}

function parseDocumentText(text: string): ProvidersDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The providers file is not valid JSON')
  }
  return parseProvidersDocument(raw)
}

/**
 * The non-secret configuration as JSON for a team. Credentials are never
 * in it: only what `ProvidersStore.list` holds (lane P's file holds no
 * secret either, D74).
 */
export async function exportProviders(store: ProvidersStore): Promise<string> {
  const entries = await store.list()
  const document: ProvidersDocument = {
    version: 1,
    providers: entries.map((entry) => ({ ...entry, models: [...entry.models] })),
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
    left.presetId === right.presetId &&
    left.address === right.address &&
    left.auth === right.auth &&
    (left.isPrivate ?? false) === (right.isPrivate ?? false) &&
    left.models.length === right.models.length &&
    left.models.every((model, index) => model === right.models[index])
  )
}

/**
 * Previews an import as a diff against the current file. Throws on an
 * unreadable file, an unknown shape, or a refused address: an import never
 * skips the address check (M95 acceptance 6, Tests).
 */
export function previewProvidersImport(
  current: readonly ProviderEntry[],
  text: string,
  policy: AddressPolicy,
): ImportPreview {
  const incoming = parseDocumentText(text).providers
  const present = new Map(current.map((entry) => [entry.id, entry]))
  const rows: ImportPreviewRow[] = []
  for (const entry of incoming) {
    const old = present.get(entry.id)
    if (old === undefined) {
      const address = policy.check(entry.address)
      if (address.kind === 'refused') {
        throw new Error(`Provider ${entry.id} cannot be imported: ${address.detail}`)
      }
      rows.push({ change: 'added', entry, needsKey: entry.auth !== 'none', address })
    } else if (!isSameEntry(old, entry)) {
      const address = policy.check(entry.address)
      if (address.kind === 'refused') {
        throw new Error(`Provider ${entry.id} cannot be imported: ${address.detail}`)
      }
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
  readonly policy: AddressPolicy
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
  const current = await deps.store.list()
  const preview = previewProvidersImport(current, text, deps.policy)
  if (!(await deps.confirm(preview))) {
    return 0
  }
  const incoming = parseDocumentText(text).providers
  await deps.store.replaceAll(incoming)
  return incoming.length
}
