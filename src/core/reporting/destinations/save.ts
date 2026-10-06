import { createHash } from 'node:crypto'
import { lstat, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { canonicalPath, isMissingPath } from '../../../host/canonicalPath'
import { deleteFileIfUnchanged, writeFileIfUnchanged } from '../../../host/fsAtomic'
import { isSamePath, isWithinFolder } from '../../paths'
import {
  REPORT_FILENAME_MAX_CHARS,
  REPORT_HASH_PATTERN,
  REPORT_HASH_PREFIX_CHARS,
  REPORT_MAX_TEXT_CHARS,
  REPORT_SAVE_RETENTION_MAX,
  REPORT_STORAGE_KEY_PATTERN,
  REPORT_STORAGE_LINK_COUNT,
  UI_TEXT,
} from '../../../shared/constants'
import type { ReportDeliveryPayload, ReportDestination } from './types'

type SaveDestination = Extract<ReportDestination, { type: 'save' }>
const fileName = z.string().check(
  z.minLength(1),
  z.maxLength(REPORT_FILENAME_MAX_CHARS),
  z.refine((name) => isValidName(name)),
)
const manifestSchema = z.strictObject({
  scheduleId: z.string().check(z.regex(REPORT_STORAGE_KEY_PATTERN)),
  entries: z
    .array(
      z.strictObject({
        name: fileName,
        occurrence: z.iso.datetime({ offset: true }),
        fingerprint: z.string().check(z.regex(REPORT_HASH_PATTERN)),
      }),
    )
    .check(
      z.maxLength(REPORT_SAVE_RETENTION_MAX + 1),
      z.refine((entries) => new Set(entries.map((entry) => entry.name)).size === entries.length),
    ),
})

function isValidName(name: string): boolean {
  return (
    !/[\\/<>:"|?*\p{Cc}]/u.test(name) &&
    name !== '.' &&
    name !== '..' &&
    !/[. ]$/.test(name) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  )
}
function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function reportSaveName(
  destination: SaveDestination,
  payload: ReportDeliveryPayload,
): string {
  const stamp = new Date(payload.document.header.asOf).toISOString()
  const [date, clock] = stamp.split('T', 2)
  const values: Readonly<Record<string, string>> = {
    kind: payload.document.header.kind,
    scope: payload.document.header.scope.replaceAll(/[^\p{L}\p{N}._-]+/gu, '-'),
    date: date ?? '',
    time: (clock ?? '').replaceAll(':', '-').replace(/\.\d+Z$/, 'Z'),
    hash8: payload.document.header.contentHash.slice(0, REPORT_HASH_PREFIX_CHARS),
    ext: payload.format === 'text' ? 'txt' : payload.format,
  }
  const name = destination.template.replaceAll(/\{(\w+)\}/g, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(UI_TEXT.reportUi.saveFailed)
    return value
  })
  if (/[{}]/.test(name) || !isValidName(name) || name.length > REPORT_FILENAME_MAX_CHARS)
    throw new Error(UI_TEXT.reportUi.saveFailed)
  return name
}

async function confined(target: string, root: string, roots: readonly string[]): Promise<string> {
  const actual = await canonicalPath(target, { followsBrokenLinks: true })
  if (
    !isWithinFolder(actual, root, process.platform) ||
    roots.every((allowed) => !isWithinFolder(actual, allowed, process.platform))
  )
    throw new Error(UI_TEXT.reportUi.saveFailed)
  return actual
}
async function existingContent(target: string): Promise<string | null> {
  try {
    const info = await lstat(target)
    if (
      !info.isFile() ||
      info.nlink !== REPORT_STORAGE_LINK_COUNT ||
      info.size > REPORT_MAX_TEXT_CHARS * REPORT_SAVE_RETENTION_MAX
    )
      throw new Error(UI_TEXT.reportUi.saveFailed)
    return await readFile(target, 'utf8')
  } catch (error: unknown) {
    if (isMissingPath(error)) return null
    throw error
  }
}

/** Runs under M115's destination/root lease; node hosts call this on their own volume. */
export async function saveReport(
  scheduleId: string,
  destination: SaveDestination,
  payload: ReportDeliveryPayload,
  allowedRoots: readonly string[],
): Promise<string> {
  if (!REPORT_STORAGE_KEY_PATTERN.test(scheduleId) || !path.isAbsolute(destination.root))
    throw new Error(UI_TEXT.reportUi.saveFailed)
  const root = await canonicalPath(destination.root, { followsBrokenLinks: true })
  // The grant holds canonical roots captured on consent, not freshly resolved aliases.
  if (allowedRoots.every((allowed) => !isWithinFolder(root, allowed, process.platform)))
    throw new Error(UI_TEXT.reportUi.saveFailed)
  const manifestPath = path.join(root, `.${scheduleId}.report-manifest.json`)
  const boundManifest = await confined(manifestPath, root, allowedRoots)
  if (!isSamePath(boundManifest, manifestPath, process.platform))
    throw new Error(UI_TEXT.reportUi.saveFailed)
  const oldManifest = await existingContent(manifestPath)
  const manifest =
    oldManifest === null
      ? { scheduleId, entries: [] }
      : manifestSchema.parse(JSON.parse(oldManifest))
  if (manifest.scheduleId !== scheduleId) throw new Error(UI_TEXT.reportUi.saveFailed)
  const name = reportSaveName(destination, payload)
  const target = path.join(root, name)
  const boundTarget = await confined(target, root, allowedRoots)
  if (!isSamePath(boundTarget, target, process.platform))
    throw new Error(UI_TEXT.reportUi.saveFailed)
  const owned = manifest.entries.find((entry) => entry.name === name)
  const canReplace = async () => {
    if (owned === undefined) {
      // Refuse a foreign file without reading its bytes: it may be a credential.
      try {
        await lstat(target)
        return false
      } catch (error: unknown) {
        if (isMissingPath(error)) return true
        throw error
      }
    }
    const current = await existingContent(target)
    return current === null || fingerprint(current) === owned.fingerprint
  }
  const written = await writeFileIfUnchanged(target, canReplace, payload.attachment, {
    sleep: delay,
    expectedCanonicalPath: boundTarget,
  })
  if (written !== 'written') throw new Error(UI_TEXT.reportUi.saveFailed)
  const entries = [
    ...manifest.entries.filter((entry) => entry.name !== name),
    {
      name,
      occurrence: payload.document.header.asOf,
      fingerprint: fingerprint(payload.attachment),
    },
  ].toSorted(
    (a, b) =>
      Date.parse(a.occurrence) - Date.parse(b.occurrence) ||
      Number(a.name > b.name) - Number(a.name < b.name),
  )
  // Persist ownership before pruning. An interrupted prune is safely retried.
  const recorded = await writeFileIfUnchanged(
    manifestPath,
    async () => (await existingContent(manifestPath)) === oldManifest,
    `${JSON.stringify({ scheduleId, entries })}\n`,
    {
      sleep: delay,
      expectedCanonicalPath: boundManifest,
    },
  )
  if (recorded !== 'written') throw new Error(UI_TEXT.reportUi.saveFailed)
  const expired = entries.slice(0, Math.max(0, entries.length - destination.retention))
  for (const entry of expired) {
    const expiredPath = path.join(root, entry.name)
    const bound = await confined(expiredPath, root, allowedRoots)
    if (!isSamePath(bound, expiredPath, process.platform))
      throw new Error(UI_TEXT.reportUi.saveFailed)
    await deleteFileIfUnchanged(expiredPath, entry.fingerprint, {
      expectedCanonicalPath: bound,
      remove: (file) => rm(file),
    })
  }
  if (expired.length > 0) {
    const expected = `${JSON.stringify({ scheduleId, entries })}\n`
    const retained = entries.slice(expired.length)
    const pruned = await writeFileIfUnchanged(
      manifestPath,
      fingerprint(expected),
      `${JSON.stringify({ scheduleId, entries: retained })}\n`,
      { sleep: delay, expectedCanonicalPath: boundManifest },
    )
    if (pruned !== 'written') throw new Error(UI_TEXT.reportUi.saveFailed)
  }
  return target
}
