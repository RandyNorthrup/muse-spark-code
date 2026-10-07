import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { handleIdentity, lstatIdentity, sameFile } from '../fs/fileIdentity'
import {
  CHECKPOINT_STORAGE_MODE,
  CHECKPOINT_JOURNAL_FILE_MODE,
  RUNTIME_MAKER_COMPANION_REGISTRY,
  RUNTIME_MAKER_MAX_BYTES,
  RUNTIME_MAKER_MAX_ITEMS,
  RUNTIME_MAKER_MAX_PORT,
  REPORT_STORAGE_LINK_COUNT,
} from '../../shared/constants'

const recordSchema = z.strictObject({
  ports: z.array(z.int().check(z.positive(), z.maximum(RUNTIME_MAKER_MAX_PORT))),
})
// Public ports only, never capabilities. One record per live server avoids lost updates across processes.
async function directory(): Promise<string> {
  const user = createHash('sha256').update(homedir()).digest('hex')
  const temporary = await realpath(tmpdir())
  return path.join(temporary, `${RUNTIME_MAKER_COMPANION_REGISTRY}-${user}`)
}
async function checkDirectory(root: string): Promise<void> {
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('maker-companion-registry-unavailable')
}
export async function registerMakerCompanion(
  ports: readonly number[],
): Promise<() => Promise<void>> {
  const root = await directory()
  await mkdir(root, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
  await checkDirectory(root)
  const file = path.join(root, `${randomUUID()}.json`)
  await writeFile(file, JSON.stringify(recordSchema.parse({ ports })), {
    flag: 'wx',
    mode: CHECKPOINT_JOURNAL_FILE_MODE,
  })
  return async () => {
    await rm(file, { force: true })
  }
}
/** A broken registry refuses the check; stale crash records conservatively keep their ports blocked. */
export async function makerCompanionPorts(): Promise<ReadonlySet<number>> {
  const root = await directory()
  let files: string[]
  try {
    await checkDirectory(root)
    files = await readdir(root)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Set()
    throw error
  }
  if (files.length > RUNTIME_MAKER_MAX_ITEMS)
    throw new Error('maker-companion-registry-unavailable')
  const ports = new Set<number>()
  for (const name of files) {
    if (!/^[\da-f-]+\.json$/.test(name)) throw new Error('maker-companion-registry-unavailable')
    const file = path.join(root, name)
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await handleIdentity(handle)
        const entry = await lstatIdentity(file)
        if (
          !info.isFile() ||
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          info.nlink !== BigInt(REPORT_STORAGE_LINK_COUNT) ||
          info.size > RUNTIME_MAKER_MAX_BYTES ||
          !sameFile(info, entry) ||
          (await realpath(file)) !== file
        )
          throw new Error('maker-companion-registry-unavailable')
        const bytes = Buffer.alloc(RUNTIME_MAKER_MAX_BYTES + 1)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > RUNTIME_MAKER_MAX_BYTES || BigInt(bytesRead) !== info.size)
          throw new Error('maker-companion-registry-unavailable')
        const raw: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
        for (const port of recordSchema.parse(raw).ports) ports.add(port)
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return ports
}
