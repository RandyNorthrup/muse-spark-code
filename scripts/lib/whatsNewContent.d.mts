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
export function fullNotesHref(repository: string): string
/** A parsed release's source range in the CHANGELOG text it was parsed from. */
export interface ChangelogSourceRange {
  /** Start offset of the release's whole `## ` section. */
  readonly start: number
  /** End offset of the whole section: the next `## `/`# ` heading, or the text end. */
  readonly end: number
  /** Heading span starts at `##` (Markdown's one to three leading spaces are excluded). */
  readonly headingStart: number
  /** Heading span includes its LF or CRLF terminator. */
  readonly headingEnd: number
  /** Body span starts immediately after the heading terminator. */
  readonly bodyStart: number
  /** Body span ends with the whole section. */
  readonly bodyEnd: number
  /**
   * Start offset of the `### Highlights` subsection (heading line
   * included); undefined when the release has no Highlights section.
   */
  readonly highlightsStart: number | undefined
  /** End offset of the `### Highlights` subsection; undefined without one. */
  readonly highlightsEnd: number | undefined
}

export interface ParsedRelease extends ReleaseNotes {
  /**
   * The release's source range: non-enumerable metadata, never serialized
   * into an envelope, an artifact or any JSON.
   */
  readonly range: ChangelogSourceRange
}

export interface ParsedChangelog extends Array<ParsedRelease> {
  /**
   * The `[Unreleased]` section's Highlights content span (bullets only,
   * untrimmed); undefined when there is no such section, both offsets
   * undefined when it carries no Highlights. Non-enumerable metadata, like
   * the release ranges.
   */
  readonly unreleased:
    | {
        readonly highlightsStart: number | undefined
        readonly highlightsEnd: number | undefined
      }
    | undefined
}

export function parseChangelog(
  markdown: string,
  allowed: AllowedTries,
  repository: string,
): ParsedChangelog
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
  /** Window and needed fallback, newest first: `full` false ships Highlights + link, `omitted` ships nothing. */
  readonly plan: ShippedPlanEntry[]
}

export function selectWhatsNewReleases(
  allReleases: readonly ReleaseNotes[],
  repository: string,
  maxDecodeBytes?: number,
): WhatsNewSelection
export function writeWhatsNewContent(root?: string): { releases: number; bytes: number }
