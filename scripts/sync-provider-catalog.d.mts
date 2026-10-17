import type { Buffer } from 'node:buffer'

export const CATALOG_SOURCE: string
export const CATALOG_UPSTREAM: string
export const CATALOG_PRESETS: readonly { catalog: string; preset: string }[]
export const MAX_DOWNLOAD_BYTES: number
export const MAX_SNAPSHOT_BYTES: number
export const FETCH_TIMEOUT_MS: number
export const SNAPSHOT_VERSION: number

export interface CatalogModel {
  id: string
  name: string
  tool_call: true
  reasoning?: boolean
  attachment?: boolean
  modalities?: unknown
  release_date?: string
  cost?: Record<string, unknown>
  limit?: Record<string, number>
}

export interface CatalogProvider {
  catalog: string
  name: string
  api?: string
  models: Record<string, CatalogModel>
}

export interface CatalogSnapshot {
  version: number
  source: string
  fetchedAt: string
  providers: Record<string, CatalogProvider>
}

export interface VendorManifest {
  source: string
  upstream: string
  fetchedAt: string
  downloadSha256: string
  providers: string[]
  files: { path: string; sha256: string }[]
}

export function assertDownloadChecksum(bytes: Uint8Array, expectedSha256: unknown): string
export function assertSnapshotSize(byteLength: number): number
export function parseCatalogApi(text: string): Record<string, unknown>
export function filterCatalog(api: unknown): Record<string, CatalogProvider>
export function snapshotDocument(
  providers: Record<string, CatalogProvider>,
  fetchedAt: string,
): CatalogSnapshot
export function snapshotText(document: CatalogSnapshot): string
export function parseCatalogSnapshot(text: string): CatalogSnapshot
export function verifyVendorFiles(vendorDir?: string): {
  files: number
  bytes: number
  snapshotBytes: Buffer
}
export function copyCatalogToDist(vendorDir?: string, outFile?: string): number
export function syncCatalog(
  bytes: Uint8Array,
  expectedSha256: string,
  date: string,
  vendorDir?: string,
): { files: number; bytes: number }
export function writeVendorManifest(
  vendorDir: string,
  metadata: {
    downloadSha256: string
    fetchedAt: string
    providers: string[]
  },
): VendorManifest
export function download(fetcher?: typeof fetch): Promise<Buffer>
export function run(argv: string[], vendorDir?: string): Promise<void>
