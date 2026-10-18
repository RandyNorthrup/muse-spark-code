// The one credential lease for the terminal provider commands (M95,
// PLAN.md D74, RVCM952D R1/R5): `auth set/clear/status --provider` and
// plain `auth status` run crashed-Connect recovery inside the same lease
// Connect itself holds, then read or write. Loaded lazily so the headless
// entry's static bundle is untouched.
import { openRouterDiscardedKeyNotice } from '../host/backend/providersEntry'
import { UI_TEXT } from '../shared/constants'
import type { ProvidersFileRead } from '../core/providers/providersFile'
import {
  authClearProvider,
  authSetProvider,
  authStatus,
  authStatusProvider,
  type AuthCommandDeps,
} from './authCommands'
import { providerSecretAccount } from './keyStore'

type CredentialLock = (operation: () => Promise<number>) => Promise<number>

/**
 * A held credential lease: the lease's own busy error, or the shared
 * directory lock's EEXIST while another writer (possibly crashed) holds it.
 */
export function isCredentialLockBusy(error: unknown): boolean {
  // The lease's class loads with its bundle, so this synchronous predicate
  // matches the busy error by name instead of holding a static import of
  // it; only the lease produces an error of this name.
  return (
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      String(error.name) === 'CredentialLockBusyError') ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      String(error.code) === 'EEXIST')
  )
}

export interface OpenRouterJournalReport {
  /** Lines already composed from the record read, before any refusing cleanup. */
  readonly notices: readonly string[]
  /** The journal held a committed attempt: the primary is the key in use. */
  readonly committed: boolean
  readonly failed: boolean
}

/**
 * Recovers the OpenRouter Connect journal. Call with the credential lease
 * held. Compares staged with primary: committed deletes the journal (say
 * nothing about removing the key in use); discarded means the created key
 * was not kept (label and removal page); a refused delete keeps the
 * journal and fails, with the notice already composed.
 */
export async function recoverOpenRouterJournalReport(
  secrets: Pick<AuthCommandDeps, 'secrets'>['secrets'],
): Promise<OpenRouterJournalReport> {
  const account = providerSecretAccount('openrouter')
  return account === undefined
    ? { notices: [], committed: false, failed: false }
    : await recoverAccountJournal(secrets, account)
}

async function recoverAccountJournal(
  secrets: Pick<AuthCommandDeps, 'secrets'>['secrets'],
  account: string,
): Promise<OpenRouterJournalReport> {
  const store = {
    get: (key: string): Promise<string | undefined> => Promise.resolve(secrets.get(key)),
    delete: (key: string): Promise<void> => Promise.resolve(secrets.delete(key)),
  }
  let recovery
  try {
    // The lease's bundle loads on a recovery, never with the command's own bundle.
    const { recoverCredentialJournal } = await import('../core/credentialLeaseEntry')
    recovery = await recoverCredentialJournal(store, account, `${account}.connect`)
  } catch {
    return { notices: [], committed: false, failed: true }
  }
  if (recovery.decision.kind === 'discarded' || recovery.decision.kind === 'legacy') {
    return {
      notices: [openRouterDiscardedKeyNotice()],
      committed: false,
      failed: recovery.journalKept,
    }
  }
  return recovery.decision.kind === 'committed'
    ? { notices: [], committed: true, failed: false }
    : { notices: [], committed: false, failed: false }
}

/** Recovers the journal inside the lease and reports it; the caller honors `failed`. */
async function recoverAndReportJournal(
  deps: Pick<AuthCommandDeps, 'print' | 'printError' | 'secrets'>,
): Promise<OpenRouterJournalReport> {
  const report = await recoverOpenRouterJournalReport(deps.secrets)
  for (const notice of report.notices) deps.printError(notice)
  if (report.committed) {
    // The key in use; say nothing about removing it.
    deps.print(UI_TEXT.providerConnectRecoveredStored)
  }
  return report
}

/** `auth set --provider <id>` inside the one credential lease. */
export async function runAuthSetProvider(
  deps: AuthCommandDeps,
  providerId: string,
  readUserFile: () => Promise<ProvidersFileRead>,
  withLock: CredentialLock,
): Promise<number> {
  try {
    return await withLock(async () => {
      const report = await recoverAndReportJournal(deps)
      return report.failed ? 1 : await authSetProvider(deps, providerId, readUserFile)
    })
  } catch (error: unknown) {
    if (!isCredentialLockBusy(error)) throw error
    deps.printError(UI_TEXT.providerConnectBusy)
    return 1
  }
}

/** `auth clear --provider <id>` inside the one credential lease. */
export async function runAuthClearProvider(
  deps: AuthCommandDeps,
  providerId: string,
  withLock: CredentialLock,
): Promise<number> {
  try {
    return await withLock(async () => {
      const report = await recoverAndReportJournal(deps)
      return report.failed ? 1 : await authClearProvider(deps, providerId)
    })
  } catch (error: unknown) {
    if (!isCredentialLockBusy(error)) throw error
    deps.printError(UI_TEXT.providerConnectBusy)
    return 1
  }
}

/**
 * `auth status --provider <id>` inside the one credential lease. A reader
 * never fails on a live writer's lease: without the lock it reports from
 * the primary and leaves another attempt's journal alone.
 */
export async function runAuthStatusProvider(
  deps: AuthCommandDeps,
  providerId: string,
  withLock: CredentialLock,
): Promise<number> {
  try {
    return await withLock(async () => {
      const report = await recoverAndReportJournal(deps)
      return report.failed ? 1 : await authStatusProvider(deps, providerId)
    })
  } catch (error: unknown) {
    if (!isCredentialLockBusy(error)) throw error
    return await authStatusProvider(deps, providerId)
  }
}

/**
 * Plain `auth status` also surfaces a crashed Connect journal (R5) before
 * reporting the Model API key. A live Connect's lease is left alone: the
 * status reports without touching another attempt's journal.
 */
export async function runAuthStatusWithRecovery(
  deps: AuthCommandDeps,
  withLock: CredentialLock,
): Promise<number> {
  try {
    const recovered = await withLock(async () => {
      const report = await recoverAndReportJournal(deps)
      return report.failed ? 1 : 0
    })
    if (recovered !== 0) return 1
  } catch (error: unknown) {
    if (!isCredentialLockBusy(error)) throw error
  }
  return await authStatus(deps)
}
