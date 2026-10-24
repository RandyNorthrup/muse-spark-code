// The supervised runs' records (M104 lane H): one owner-only file per run in
// the agent's private `supervised` folder (`openPrivateRoot`: the user's,
// SYSTEM's and Administrators' on Windows, 0700 on POSIX), named by the
// folder the run started in, so `stop` finds every run of that folder. A
// record names the run's stop endpoint and the token a stop request carries;
// a record that does not parse is no record.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { open, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { isErrno } from '../../core/fs/errno'
import { SUPERVISE_RECORD_MAX_BYTES, SUPERVISE_TOKEN_BYTES } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'

const RECORD_SUFFIX = '.json'
const OWNER_FILE_MODE = 0o600

export const supervisedRecordSchema = z.strictObject({
  ownerId: z.uuid(),
  endpoint: z.string().check(z.minLength(1)),
  token: z.string().check(z.regex(/^[0-9a-f]+$/u), z.length(SUPERVISE_TOKEN_BYTES * 2)),
})
export type SupervisedRecord = z.infer<typeof supervisedRecordSchema>

/** A record's file: the folder's key, then the owner. */
export function recordFile(root: string, cwd: string, ownerId: string): string {
  return path.join(root, `${workspaceKey(cwd)}.${ownerId}${RECORD_SUFFIX}`)
}

export function newToken(): string {
  return randomBytes(SUPERVISE_TOKEN_BYTES).toString('hex')
}

/** Whether a stop request carries this run's token, compared in constant time. */
export function isTokenMatching(record: SupervisedRecord, presented: string): boolean {
  const expected = Buffer.from(record.token, 'utf8')
  const actual = Buffer.from(presented, 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Writes a new record, owner-only, never over an existing file. */
export async function writeRecord(file: string, record: SupervisedRecord): Promise<void> {
  const handle = await open(file, 'wx', OWNER_FILE_MODE)
  try {
    await handle.writeFile(JSON.stringify(record), 'utf8')
  } finally {
    await handle.close()
  }
}

export async function removeRecord(file: string): Promise<void> {
  await rm(file, { force: true })
}

/** A record's text, bounded: a file past the bound or not UTF-8 JSON is no record. */
async function readRecord(file: string): Promise<SupervisedRecord | undefined> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(SUPERVISE_RECORD_MAX_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > SUPERVISE_RECORD_MAX_BYTES) return undefined
    const parsed = supervisedRecordSchema.safeParse(
      JSON.parse(buffer.toString('utf8', 0, bytesRead)),
    )
    return parsed.success ? parsed.data : undefined
  } catch (error: unknown) {
    // Malformed JSON is an unusable record; anything else keeps its kind.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  } finally {
    await handle.close()
  }
}

/** One folder's runs: each record's file and what it says (undefined when unusable). */
export async function folderRecords(
  root: string,
  cwd: string,
): Promise<readonly { readonly file: string; readonly record: SupervisedRecord | undefined }[]> {
  const prefix = `${workspaceKey(cwd)}.`
  const entries = await readdir(root)
  const names = entries.filter((name) => name.startsWith(prefix) && name.endsWith(RECORD_SUFFIX))
  const found: { file: string; record: SupervisedRecord | undefined }[] = []
  for (const name of names) {
    const file = path.join(root, name)
    try {
      found.push({ file, record: await readRecord(file) })
    } catch (error: unknown) {
      // The run removed its record while the folder was read: it ended.
      if (!(isErrno(error) && error.code === 'ENOENT')) throw error
    }
  }
  return found
}
