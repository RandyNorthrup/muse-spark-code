// Owner-only JSON state files are read through one guarded open: the held
// handle must still be the sampled file, the bytes must parse, and the
// parsed state must round-trip byte for byte. Callers supply their schema,
// their validator and their typed refusal.
import { open } from 'node:fs/promises'
import { handleIdentity, sameFile, type FileIdentity } from './fileIdentity'

export interface ProtectedJsonRead<T> {
  readonly file: string
  readonly sample: FileIdentity
  parse(raw: unknown): T
  validate(state: T): void
  refuse(): Error
}

export async function readProtectedJson<T>(read: ProtectedJsonRead<T>): Promise<T> {
  const handle = await open(read.file, 'r')
  try {
    if (!sameFile(read.sample, await handleIdentity(handle))) throw read.refuse()
    const bytes = await handle.readFile()
    const text = bytes.toString('utf8')
    const raw: unknown = JSON.parse(text)
    const state = read.parse(raw)
    if (JSON.stringify(state) !== text) throw read.refuse()
    read.validate(state)
    return state
  } finally {
    await handle.close()
  }
}
