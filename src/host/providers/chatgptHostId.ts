// The VS Code host's ChatGPT host id: one stable documented value per
// machine, kept in a file in global storage beside the refresh lock. A
// previous bare-random id migrates in place to the documented `urn:uuid:`
// form before the next sign-in. An issued client id spans the migration:
// it is bound to the user and workspace, so no re-authorization is needed.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isPkceState } from '../backend/providersEntry'
import {
  ChatGptSignInError,
  createChatGptHostId,
  isChatGptHostId,
} from '../backend/subscriptionsEntry'

const HOST_ID_FILE = 'chatgpt.host-id'

/** Load the host id, creating it on first use and migrating an old one in place. */
export async function loadChatGptHostId(directory: string): Promise<string> {
  const file = path.join(directory, HOST_ID_FILE)
  try {
    const stored = await readFile(file, 'utf8')
    if (isChatGptHostId(stored)) return stored
    if (!isPkceState(stored)) throw new ChatGptSignInError('invalid-token')
    const migrated = createChatGptHostId()
    await writeFile(file, migrated)
    return migrated
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
  }
  const created = createChatGptHostId()
  await writeFile(file, created, { flag: 'wx' })
  return created
}
