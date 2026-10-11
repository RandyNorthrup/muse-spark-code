import { open } from 'node:fs/promises'
import * as z from 'zod/mini'
import { writeFileAtomically } from '../../host/fsAtomic'
import { storeErrorCode } from '../../host/backend/storeErrors'
import { BOUNDED_FILE_READ_CHUNK_BYTES, UI_TEXT } from '../../shared/constants'
import { readResourceSettings } from '../../shared/resources'
import type { ResourceMachineStore } from './port'

const machineTable = z.record(z.string(), z.unknown())
const resumeMarker = z.strictObject({ untilMs: z.number().check(z.int(), z.gte(0)) })

/** Only ENOENT uses defaults. Malformed, oversized and inaccessible files fail. */
async function readJson(file: string): Promise<unknown> {
  try {
    const handle = await open(file, 'r')
    try {
      const bytes = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES + 1)
      let offset = 0
      while (offset < bytes.length) {
        const part = await handle.read(bytes, offset, bytes.length - offset, null)
        if (part.bytesRead === 0) break
        offset += part.bytesRead
      }
      if (offset > BOUNDED_FILE_READ_CHUNK_BYTES) throw new Error(UI_TEXT.execFileTooLarge)
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)))
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (storeErrorCode(error) === 'ENOENT') return undefined
    throw new Error(UI_TEXT.resourceUnavailable, { cause: error })
  }
}

/** M104 B may replace this with its settings store through ResourceMachineStore. */
export function resourceMachineStore(input: {
  settingsFile: string
  resumeFile: string
  sleep: (ms: number) => Promise<void>
}): ResourceMachineStore {
  return {
    async readSettings() {
      const raw = await readJson(input.settingsFile)
      const table = machineTable.parse(raw === undefined ? {} : raw)
      return readResourceSettings((key) => ({ globalValue: table[`museSpark.${key}`] }))
    },
    async readResumeUntil() {
      const raw = await readJson(input.resumeFile)
      return raw === undefined ? null : resumeMarker.parse(raw).untilMs
    },
    async writeResumeUntil(untilMs) {
      const marker = resumeMarker.parse({ untilMs })
      await writeFileAtomically(input.resumeFile, `${JSON.stringify(marker)}\n`, {
        sleep: input.sleep,
      })
    },
  }
}
