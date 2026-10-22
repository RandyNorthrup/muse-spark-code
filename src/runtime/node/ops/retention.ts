// Retention, quotas and the disk floor (M110f lane O, D90.19): what the
// node keeps is the person's own setting, and the disk floor below which
// no new work starts is theirs too. Without either, nothing is removed
// and nothing is refused.
import * as z from 'zod/mini'

export const retainedFileSchema = z.strictObject({
  path: z.string().check(z.minLength(1)),
  bytes: z.int().check(z.gte(0)),
  mtimeMs: z.int().check(z.gte(0)),
})
export type RetainedFile = z.infer<typeof retainedFileSchema>

export interface NodeRetention {
  readonly keepNewest?: number
  readonly maxTotalBytes?: number
}

export interface RetentionVerdict {
  readonly kept: readonly RetainedFile[]
  readonly removed: readonly RetainedFile[]
}

/* Newest first, then within the person's count and byte budget. */
export function applyNodeRetention(
  files: readonly RetainedFile[],
  retention: NodeRetention,
): RetentionVerdict {
  if (
    (retention.keepNewest !== undefined &&
      (!Number.isSafeInteger(retention.keepNewest) || retention.keepNewest < 0)) ||
    (retention.maxTotalBytes !== undefined &&
      (!Number.isSafeInteger(retention.maxTotalBytes) || retention.maxTotalBytes < 0))
  )
    throw new Error('retention keeps whole counts and bytes')
  const parsed = z.array(retainedFileSchema).parse(files)
  const ordered = parsed.toSorted((left, right) => right.mtimeMs - left.mtimeMs)
  const kept: RetainedFile[] = []
  const removed: RetainedFile[] = []
  let bytes = 0
  for (const file of ordered) {
    const isOverCount = retention.keepNewest !== undefined && kept.length >= retention.keepNewest
    const isOverBytes =
      retention.maxTotalBytes !== undefined && bytes + file.bytes > retention.maxTotalBytes
    if (isOverCount || isOverBytes) {
      removed.push(file)
    } else {
      kept.push(file)
      bytes += file.bytes
    }
  }
  return { kept, removed }
}

export type DiskFloorVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** Below the person's floor, no new work starts. Without one, work starts. */
export function checkDiskFloor(options: {
  readonly freeBytes: number
  readonly floorBytes: number | undefined
}): DiskFloorVerdict {
  if (options.floorBytes === undefined) return { ok: true }
  if (!Number.isSafeInteger(options.floorBytes) || options.floorBytes < 0)
    throw new Error('the disk floor is whole bytes')
  return options.freeBytes >= options.floorBytes
    ? { ok: true }
    : { ok: false, reason: 'the disk is below its floor, no new work starts' }
}
