// The provider-catalogue sync keeps the provider's own status word and
// re-checks the cited Gemini reroutes on every run (PROV-HONEST). These
// tests run the script's real readers over the sealed vendor snapshot:
// a row the sync keeps must survive the parse, the 512 KiB cap must hold,
// the reroute table must verify, and a snapshot that drops a serving
// model must fail naming the stale row and its provider page.
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_SNAPSHOT_BYTES,
  assertReroutesCurrent,
  filterCatalog,
  parseCatalogSnapshot,
  readRerouteTable,
  snapshotDocument,
  snapshotText,
  verifyVendorFiles,
} from '../../scripts/sync-provider-catalog.mjs'

const repo = process.cwd()
const snapshotFile = path.join(repo, 'vendor', 'models-dev', 'snapshot.json')

describe('provider catalogue sync', () => {
  it('keeps the status word through the seal and the parse', () => {
    const text = readFileSync(snapshotFile, 'utf8')
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(MAX_SNAPSHOT_BYTES)
    const document = parseCatalogSnapshot(text)
    // The sealed snapshot (2026-11-02): o3-mini deprecated, mistral-large-4
    // beta. A re-sync that moves either word fails here first, by design.
    expect(document.providers['openai'].models['o3-mini'].status).toBe('deprecated')
    expect(document.providers['mistral'].models['mistral-large-4'].status).toBe('beta')
    const kept = Object.values(document.providers).flatMap((provider) =>
      Object.values(provider.models).filter((model) => model.status !== undefined),
    )
    expect(kept.length).toBeGreaterThan(0)
  })

  it('keeps the status word when the sync filters a recorded download', () => {
    const sealedText = readFileSync(snapshotFile, 'utf8')
    const sealed = parseCatalogSnapshot(sealedText)
    // The sealed rows are the 2026-11-02 download's own rows, trimmed by
    // this same filter: fed back as a download, the real filter must
    // return them byte for byte, status words included, under the cap.
    const download = Object.fromEntries(
      Object.values(sealed.providers).map(({ catalog, name, api, models }) => [
        catalog,
        { name, ...(api !== undefined && { api }), models },
      ]),
    )
    const providers = filterCatalog(download)
    expect(providers['openai'].models['o3-mini'].status).toBe('deprecated')
    expect(providers['mistral'].models['mistral-large-4'].status).toBe('beta')
    expect(snapshotText(snapshotDocument(providers, sealed.fetchedAt))).toBe(sealedText)
  })

  it('verifies the cited reroutes against the sealed snapshot', () => {
    const document = parseCatalogSnapshot(readFileSync(snapshotFile, 'utf8'))
    const table = readRerouteTable(repo)
    expect(assertReroutesCurrent(document.providers['gemini'].models, table, 'the snapshot')).toBe(
      table.length,
    )
    expect(table.length).toBeGreaterThan(0)
  })

  it('refuses a snapshot that drops a serving model, naming the page', () => {
    const document = parseCatalogSnapshot(readFileSync(snapshotFile, 'utf8'))
    const models = { ...document.providers['gemini'].models }
    delete models['gemini-3.6-flash']
    expect(() => assertReroutesCurrent(models, readRerouteTable(repo), 'the snapshot')).toThrow(
      /Gemini reroute 'gemini-3.5-flash' → 'gemini-3.6-flash' is stale.*aistudio\.google\.com\/docs\/changelog/,
    )
  })

  it('leaves the vendor seal green', () => {
    expect(verifyVendorFiles()).toMatchObject({ files: 2 })
  })
})
