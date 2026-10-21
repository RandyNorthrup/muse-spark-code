// Types for scripts/lib/legalArchive.mjs.
export const LEGAL_DATA_DIR: string
export const LEGAL_DATA_ARCHIVE_FILE: string
export const LEGAL_DATA_ARCHIVE_VERSION: number
export const LEGAL_DATA_ARCHIVE_QUALITY: number
export interface LegalDataArchiveStats {
  readonly members: number
  readonly looseBytes: number
  readonly archiveBytes: number
}
export function packLegalDataArchive(stage: string, quality?: number): LegalDataArchiveStats
