// Types for scripts/lib/whatsNewContent.mjs, which the unit tests import
// (M99, PLAN.md D79). The content's own types are the extension's schema.
import type { ReleaseNotes } from '../../src/core/whatsNew/whatsNewContent'

export const HIGHLIGHTS_HEADING: string
export const MAX_HIGHLIGHTS: number
export const CONTENT_FILE: string

export interface AllowedTries {
  readonly commands: ReadonlySet<string>
  readonly settings: ReadonlySet<string>
}

export function contributedIds(manifest: unknown): AllowedTries
export function repositoryUrl(manifest: unknown): string
export function parseChangelog(
  markdown: string,
  allowed: AllowedTries,
  repository: string,
): ReleaseNotes[]
export function highlightsProblem(
  releases: readonly ReleaseNotes[],
  version: string,
): string | undefined
export interface ShippedPlanEntry {
  readonly version: string
  readonly full: boolean
  readonly omitted?: boolean | undefined
}

export interface WhatsNewSelection {
  readonly releases: ReleaseNotes[]
  readonly shortened: boolean
  /** The full-notes window newest first: `full` false ships Highlights only, `omitted` ships nothing. */
  readonly plan: ShippedPlanEntry[]
}

export function selectWhatsNewReleases(
  allReleases: readonly ReleaseNotes[],
  repository: string,
  maxDecodeBytes?: number,
): WhatsNewSelection
export function writeWhatsNewContent(root?: string): { releases: number; bytes: number }
