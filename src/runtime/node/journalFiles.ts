// The journal half of the node's owner-only files (M111 lane OB's ring
// store): crash-safe JSONL appends, the owned names, and single-file
// deletes, over NodePrivateFiles' owner and substitution checks. Split
// from privateFiles.ts at the CC-INT10 join so dist/node.js, which never
// journals, stays inside its budget (D6); the store's bundles carry it.
import { constants } from 'node:fs'
import { open, readdir, unlink } from 'node:fs/promises'
import { NODE_FILE_MODE, NODE_SINGLE_LINK, UI_TEXT } from '../../shared/constants'
import { isMissingFile, NodePrivateFiles } from './privateFiles'

export class NodeJournalFiles extends NodePrivateFiles {
  /**
  Crash-safe append for JSONL journals: the held file is owner-checked
  like a read, the bytes fsync before the call returns, and a link never
  redirects the append.
  */
  async append(name: string, text: string): Promise<void> {
    await this.prepare()
    const file = this.file(name)
    const handle = await open(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      NODE_FILE_MODE,
    )
    try {
      const held = await this.identity.handleIdentity(handle)
      if (!held.isFile() || held.nlink !== NODE_SINGLE_LINK) {
        throw new Error(UI_TEXT.nodeErrors.forbidden)
      }
      this.checkOwner(held.uid, held.mode)
      await handle.appendFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  }

  /** The owned names under the root, sorted; the caller filters its own. */
  async list(): Promise<string[]> {
    await this.prepare()
    const names = await readdir(this.root)
    return names.toSorted((left, right) => {
      if (left === right) return 0
      return left < right ? -1 : 1
    })
  }

  /** Delete one owned file; a missing file is already gone, never an error. */
  async remove(name: string): Promise<void> {
    await this.prepare()
    const file = this.file(name)
    try {
      await unlink(file)
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error
    }
  }
}
