// The one durable writer for small JSON stores: an exclusive
// temporary file beside the target, full bytes, sync, atomic rename,
// and the directory sync where the platform honours it. A failure
// removes its temporary and keeps its kind; the previous target stands.
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const OWNER_FILE_MODE = 0o600

async function syncDirectory(directory: string): Promise<void> {
  // Node cannot fsync a Windows directory; the file sync plus the atomic
  // rename is the whole contract there.
  if (process.platform === 'win32') return
  const handle = await open(directory, fsConstants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Publish text atomically: exclusive temporary, sync, rename, directory sync. */
export async function writeFileAtomic(
  directory: string,
  filename: string,
  text: string,
): Promise<void> {
  const target = path.join(directory, filename)
  const temporary = path.join(directory, `.${filename}.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', OWNER_FILE_MODE)
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } catch (error: unknown) {
    await handle.close()
    await rm(temporary, { force: true })
    throw error
  }
  await handle.close()
  try {
    await rename(temporary, target)
    await syncDirectory(directory)
  } catch (error: unknown) {
    await rm(temporary, { force: true })
    throw error
  }
}
