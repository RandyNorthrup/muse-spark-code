import type { BigIntStats } from 'node:fs'
import { sameFile } from '../../fs/fileIdentity'

/** Same native file and unchanged size/mtime; callers check bytes and ctime too. */
export function isSameLocalFileMetadata(before: BigIntStats, sample: BigIntStats): boolean {
  return (
    sameFile(before, sample) && before.size === sample.size && before.mtimeNs === sample.mtimeNs
  )
}
