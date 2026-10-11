// RVM107W2 P2: Delete history's shared reset boundary for every resource
// collector, in every process. It lives beside the usage folder, so the delete
// that removes the folder keeps it. Collectors drop anything they hold from at
// or before it, and the journal never writes a record stamped at or before it.
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as z from 'zod/mini'
import { CHECKPOINT_STORAGE_MODE, RESOURCE_JOURNAL_RESET_FILE } from '../../shared/constants'
import { writeFileAtomically } from '../../host/fsAtomic'

const resetSchema = z.strictObject({ v: z.literal(1), resetAtMs: z.int().check(z.gte(0)) })

/** No delete yet is -1. An unreadable boundary is Infinity: nothing is written (fail closed). */
export function readResourceReset(dataFolder: string): number {
  try {
    return resetSchema.parse(
      JSON.parse(readFileSync(path.join(dataFolder, RESOURCE_JOURNAL_RESET_FILE), 'utf8')),
    ).resetAtMs
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? -1 : Infinity
  }
}

/** Written before the usage folder is removed, so no collector can outlive the delete. */
export async function writeResourceReset(dataFolder: string, resetAtMs: number): Promise<void> {
  await mkdir(dataFolder, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
  await writeFileAtomically(
    path.join(dataFolder, RESOURCE_JOURNAL_RESET_FILE),
    JSON.stringify(resetSchema.parse({ v: 1, resetAtMs })),
    { sleep: delay },
  )
}
