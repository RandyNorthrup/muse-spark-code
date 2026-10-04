import type { Buffer } from 'node:buffer'

export function assertArchiveChecksum(bytes: Uint8Array, sums: string, archiveName: string): string
export function assertArchivePath(name: string, type: string): void
export function isSelected(name: string): boolean
export function archiveFiles(
  bytes: Uint8Array,
  topFolder: string,
): Map<string, { body: Buffer; mode: number }>
