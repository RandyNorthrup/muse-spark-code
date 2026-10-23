// M110os OS3/OS7: owner-only JSON stores for the node runtime. Every
// read is schema-validated; a missing file reads as null and a damaged
// one throws a typed failure. Labels stay fixed words: paths and file
// text never reach an error sentence.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type MiniParse<T> = { success: true; data: T } | { success: false; error: unknown }

export interface MiniSchema<T> {
  safeParse(value: unknown): MiniParse<T>
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Read an owner-only JSON file, or null before the first save. */
export function loadOwnerJson<T>(
  dir: string,
  file: string,
  label: string,
  schema: MiniSchema<T>,
): T | null {
  let text: string
  try {
    text = readFileSync(path.join(dir, file), 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return null
    throw new Error(`${label} is not readable`, { cause: error })
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`${label} is not valid`, { cause: error })
  }
  const checked = schema.safeParse(raw)
  if (!checked.success) throw new Error(`${label} is not valid`, { cause: checked.error })
  return checked.data
}

/** Save an owner-only JSON file. */
export function saveOwnerJson(dir: string, file: string, label: string, value: unknown): void {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path.join(dir, file), JSON.stringify(value), { mode: 0o600 })
  } catch (error: unknown) {
    throw new Error(`${label} is not writable`, { cause: error })
  }
}
