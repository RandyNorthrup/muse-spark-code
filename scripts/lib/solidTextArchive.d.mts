// Types for scripts/lib/solidTextArchive.mjs.
export const SOLID_TEXT_ARCHIVE_VERSION: number
export const SOLID_TEXT_ARCHIVE_QUALITY: number
export interface SolidTextArchiveStats {
  readonly members: number
  readonly looseBytes: number
  readonly archiveBytes: number
}
export function listTextMembers(source: string): string[]
export function readTextMembers(
  source: string,
  files: readonly string[],
): {
  members: Record<string, { sha256: string; text: string }>
  looseBytes: number
}
export function encodeSolidTextArchive(
  members: Record<string, { sha256: string; text: string }>,
): string
export function packSolidTextArchive(
  stage: string,
  sourceRel: string,
  archiveRel: string,
  keep?: ReadonlySet<string>,
  quality?: number,
  exclude?: ReadonlySet<string>,
): SolidTextArchiveStats
export function parseSolidTextArchive(
  packed: Uint8Array,
  maxOutputBytes: number,
  expectedVersion: number,
): Record<string, { sha256: string; text: string }>
export function assertArchiveMembers(
  packed: Uint8Array,
  required: readonly string[],
  maxOutputBytes: number,
  expectedVersion: number,
  hasChunks?: boolean,
): number
export function solidMemberBytes(
  entry: { sha256: string; text: string },
  relative: string,
): Buffer
