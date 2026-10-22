// Wipe with crypto-erase (M110f lane O, D90.19): the data key dies first
// (overwritten, then unlinked), so a saved copy of the old volume can
// never be decrypted again, and then the data tree goes. The wipe refuses
// a path that is not under the node's own root.
import { randomBytes } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const KEY_OVERWRITE_PASSES = 2
const KEY_OVERWRITE_BYTES = 1024

/** Destroy the key, then the data. Both must live under the node's root. */
export async function wipeNodeData(options: {
  readonly root: string
  readonly dataDir: string
  readonly keyFile: string
}): Promise<void> {
  const root = path.normalize(options.root)
  const dataDir = path.normalize(options.dataDir)
  const keyFile = path.normalize(options.keyFile)
  if (!dataDir.startsWith(root + path.sep) || !keyFile.startsWith(root + path.sep))
    throw new Error('a wipe stays inside the node root')
  for (let pass = 0; pass < KEY_OVERWRITE_PASSES; pass += 1) {
    await writeFile(keyFile, randomBytes(KEY_OVERWRITE_BYTES))
  }
  await rm(keyFile, { force: true })
  await rm(dataDir, { recursive: true, force: true })
}
