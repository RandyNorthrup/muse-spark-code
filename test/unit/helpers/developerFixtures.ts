import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { AccountStore } from '../../../src/core/providers/accounts'
import { fileAccountsMetadata } from '../../../src/runtime/providers/providersFileStore'
import { DEVELOPER_FILES } from '../../../src/shared/constants'

/** A fresh folder under temp/, remembered in `folders` for the suite's cleanup. */
export function developerScratch(prefix: string, folders: string[]): string {
  mkdirSync('temp', { recursive: true })
  const folder = mkdtempSync(path.join('temp', prefix))
  folders.push(folder)
  return folder
}

/** The slot registry on disk (name to id), empty when none was written. */
export function developerSlotsOf(folder: string): Record<string, string> {
  const file = path.join(folder, 'developer', DEVELOPER_FILES.slots)
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as { slots: Record<string, string> }).slots
    : {}
}

const shut = (): Promise<never> => Promise.reject(new Error('vault must stay shut'))

/** The providers file store over `folder`, with a vault that must stay shut: any use fails the case. */
export function shutVaultAccounts(folder: string) {
  const metadata = fileAccountsMetadata(folder)
  const store = new AccountStore(metadata, {
    read: shut,
    readForRemoval: shut,
    write: shut,
    remove: shut,
  })
  return { metadata, store }
}
