// The browser check's runtime pin (M81 A1, design spec v4 §4.2), in the
// runtime bundle only: each extension release ships browserRuntime.json,
// validated here before use. It names one exact Chrome-for-Testing version
// and revision, and for each of the four supported platforms the pinned
// HTTPS archive, its exact length and SHA-256, the executable's relative
// path, length and SHA-256, the entries that may be executable, and the
// archive's entry count and extracted total, all taken from the archives
// themselves. Its publication record is ChromiumDash's exact-version Stable
// records (field `time`, epoch ms): the earliest desktop one is the pin's
// date, kept unchanged whenever the same version is shipped again.
//
// Freshness is exact integer UTC milliseconds: a check refuses at
// publishedAtMs + 45 days or later, and on an unknown, malformed or future
// date (a local clock earlier than the publication). Release and weekly CI
// fail when the newest Stable is more than 14 days newer than the pin.
// Pure.

import * as z from 'zod/mini'
import {
  BROWSER_RUNTIME_DAY_MS,
  BROWSER_RUNTIME_EXPIRY_DAYS,
  BROWSER_RUNTIME_LAG_DAYS,
  BROWSER_RUNTIME_MAX_NAME_BYTES,
} from '../../../shared/browserCheckConstants'
import type { RuntimePlatform } from '../runtimeTypes'

const SHA256 = /^[\da-f]{64}$/
const VERSION = /^\d+\.\d+\.\d+\.\d+$/
// A relative path inside the archive: plain segments joined by `/`.
const RELATIVE = /^(?:[\w.+-]+\/)*[\w.+-]+$/

const sha256Schema = z.string().check(z.regex(SHA256))
const relativeSchema = z
  .string()
  .check(z.regex(RELATIVE), z.maxLength(BROWSER_RUNTIME_MAX_NAME_BYTES))
const positiveSchema = z.int().check(z.positive())
const timeSchema = z.int().check(z.positive())

const platformSchema = z.strictObject({
  url: z.string().check(z.startsWith('https://')),
  archiveBytes: positiveSchema,
  archiveSha256: sha256Schema,
  entryCount: positiveSchema,
  extractedBytes: positiveSchema,
  executable: relativeSchema,
  executableBytes: positiveSchema,
  executableSha256: sha256Schema,
  executableEntries: z.array(relativeSchema).check(z.minLength(1)),
})

const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().check(z.regex(VERSION)),
  revision: z.string().check(z.regex(/^\d+$/)),
  publication: z.strictObject({
    version: z.string().check(z.regex(VERSION)),
    channel: z.literal('Stable'),
    sources: z.array(z.string().check(z.startsWith('https://chromiumdash.appspot.com/'))),
    platformTimes: z.strictObject({ Windows: timeSchema, Linux: timeSchema, Mac: timeSchema }),
    publishedAtMs: timeSchema,
    publishedAt: z.string(),
  }),
  storage: z.strictObject({
    origin: z.literal('https://storage.googleapis.com'),
    pathPrefix: z.string().check(z.startsWith('/')),
  }),
  platforms: z.strictObject({
    win64: platformSchema,
    linux64: platformSchema,
    'mac-x64': platformSchema,
    'mac-arm64': platformSchema,
  }),
})

export type RuntimeManifest = z.infer<typeof manifestSchema>
export type PlatformRecord = z.infer<typeof platformSchema>

/**
 * The manifest, or undefined when it is not one: the schema, and the
 * records agreeing with each other (the version everywhere, the earliest
 * desktop date as the pin's, its ISO rendering, the executable among the
 * executable entries, every URL under the pinned storage path).
 */
export function parseRuntimeManifest(raw: unknown): RuntimeManifest | undefined {
  const parsed = manifestSchema.safeParse(raw)
  if (!parsed.success) {
    return undefined
  }
  const manifest = parsed.data
  const { publication, storage, version } = manifest
  const earliest = Math.min(...Object.values(publication.platformTimes))
  const isDated =
    publication.version === version &&
    publication.publishedAtMs === earliest &&
    new Date(earliest).toISOString() === publication.publishedAt
  const isStored = Object.values(manifest.platforms).every((record) => {
    const url = new URL(record.url)
    return (
      url.origin === storage.origin &&
      url.pathname.startsWith(`${storage.pathPrefix}${version}/`) &&
      url.search === '' &&
      record.executableEntries.includes(record.executable) &&
      record.executableBytes <= record.extractedBytes
    )
  })
  return isDated && isStored ? manifest : undefined
}

/** The pinned platform for this OS and processor; undefined for any other. */
export function runtimePlatform(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): RuntimePlatform | undefined {
  if (arch === 'x64') {
    if (platform === 'win32') {
      return 'win64'
    }
    if (platform === 'linux') {
      return 'linux64'
    }
    if (platform === 'darwin') {
      return 'mac-x64'
    }
  }
  return platform === 'darwin' && arch === 'arm64' ? 'mac-arm64' : undefined
}

/**
 * Whether a check may use the pin at `nowMs`: from its publication until
 * just before publication + 45 days. A date in the future (the local clock
 * earlier than the publication) or a value that is not a whole number of
 * milliseconds refuses rather than extends freshness.
 */
export function isPinFresh(publishedAtMs: number, nowMs: number): boolean {
  return (
    Number.isSafeInteger(publishedAtMs) &&
    Number.isSafeInteger(nowMs) &&
    nowMs >= publishedAtMs &&
    nowMs < publishedAtMs + BROWSER_RUNTIME_EXPIRY_DAYS * BROWSER_RUNTIME_DAY_MS
  )
}

/**
 * Release and weekly CI: whether the pin still lags the newest Stable by at
 * most 14 days (exactly 14 passes; one millisecond more fails). An older or
 * equal newest version never fails; an unknown date always does.
 */
export function isPinCurrent(pinPublishedAtMs: number, newestPublishedAtMs: number): boolean {
  return (
    Number.isSafeInteger(pinPublishedAtMs) &&
    Number.isSafeInteger(newestPublishedAtMs) &&
    newestPublishedAtMs - pinPublishedAtMs <= BROWSER_RUNTIME_LAG_DAYS * BROWSER_RUNTIME_DAY_MS
  )
}
