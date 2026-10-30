// Types for scripts/lib/osSbom.mjs, which os-sbom and its unit test import.
export interface SbomManifestPackage {
  readonly type: 'deb'
  readonly name: string
  readonly version: string
  readonly architecture: string
  readonly size: number
}
export interface SbomManifestConfig {
  readonly name: string
  readonly distribution: string
  readonly architecture: string
  readonly version: string
  readonly release: string
}
export interface SbomManifest {
  readonly manifest_version: 1
  readonly config: SbomManifestConfig
  readonly packages: readonly SbomManifestPackage[]
}
export type ParseManifestResult =
  | { readonly ok: true; readonly manifest: SbomManifest }
  | { readonly ok: false; readonly error: string }
export declare function parseManifest(text: string): ParseManifestResult
export declare function sha256File(file: string): Promise<string>
export declare function spdxDocument(
  manifest: SbomManifest,
  imageSha256: string,
  created: string,
): Record<string, unknown>
