// The one credential lease for the terminal provider commands (M95,
// PLAN.md D74, RVCM952D R1/R5): `auth set/clear/status --provider` and
// plain `auth status` run crashed-Connect recovery inside the same lease
// Connect itself holds, then read or write. Loaded lazily so the headless
// entry's static bundle is untouched.
import { openRouterDiscardedKeyNotice } from '../host/backend/providersEntry'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'
import type { recoverCredentialJournal as recoverJournal } from '../core/credentialLeaseEntry'
import type { ProvidersFileRead } from '../core/providers/providersFile'
import {
  authClearProvider,
  authSetProvider,
  authStatusAll,
  authStatusProvider,
  type AuthCommandDeps,
} from './authCommands'
import { isStoreUnavailable, providerSecretAccount } from './keyStore'

type CredentialLock = (operation: () => Promise<number>) => Promise<number>

/**
A held credential lease: the lease's own busy error, or the shared
directory lock's EEXIST while another writer (possibly crashed) holds it.
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
  /**
  The recovery itself could not read the credential store (an unreachable
  store, never a refused cleanup: that composes its notice above). The
  caller names it instead of failing silent.
  */
  readonly storeError?: unknown
}

/**
Recovers the OpenRouter Connect journal. Call with the credential lease
held. Compares staged with primary: committed deletes the journal (say
nothing about removing the key in use); discarded means the created key
was not kept (label and removal page); a refused delete keeps the
journal and fails, with the notice already composed.
*/
export async function recoverOpenRouterJournalReport(
  secrets: Pick<AuthCommandDeps, 'secrets'>['secrets'],
): Promise<OpenRouterJournalReport> {
  const account = providerSecretAccount('openrouter')
  return account === undefined
    ? { notices: [], committed: false, failed: false }
    : await recoverAccountJournal(secrets, account)
}

/**
A lazy-bundle load failure (missing or unparsable file): the one failure a
journal recovery reports as failed instead of propagating.
*/
function isBundleLoadFailure(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND')
  )
}

async function recoverAccountJournal(
  secrets: Pick<AuthCommandDeps, 'secrets'>['secrets'],
  account: string,
): Promise<OpenRouterJournalReport> {
  const store = {
    get: (key: string): Promise<string | undefined> => Promise.resolve(secrets.get(key)),
    delete: (key: string): Promise<void> => Promise.resolve(secrets.delete(key)),
  }
  // The lease's bundle loads on a recovery, never with the command's own bundle.
  let recoverCredentialJournal: typeof recoverJournal
  try {
    ;({ recoverCredentialJournal } = await import('../core/credentialLeaseEntry'))
  } catch (error: unknown) {
    // A bundle that cannot load is not an unreachable store: no cause to
    // name. Anything else (a foreign throw, never a load failure)
    // propagates.
    if (!isBundleLoadFailure(error)) throw error
    return { notices: [], committed: false, failed: true }
  }
  let recovery
  try {
    recovery = await recoverCredentialJournal(store, account, `${account}.connect`)
  } catch (error: unknown) {
    // A recovery that cannot even read names its cause through the report;
    // anything that is not a store failure propagates.
    if (!isStoreUnavailable(error)) throw error
    return { notices: [], committed: false, failed: true, storeError: error }
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

/**
Prints a recovery report: its composed notices, the stored-key note, and —
when the recovery itself could not read the credential store — the cause.
Without the last, the command fails silent with exit 1 and no notices.
*/
export function reportJournalRecovery(
  deps: Pick<AuthCommandDeps, 'print' | 'printError'>,
  report: OpenRouterJournalReport,
): void {
  for (const notice of report.notices) deps.printError(notice)
  if (report.committed) {
    // The key in use; say nothing about removing it.
    deps.print(UI_TEXT.providerConnectRecoveredStored)
  }
  if (report.failed && report.notices.length === 0 && report.storeError !== undefined)
    deps.printError(fill(UI_TEXT.acpStoreUnavailable, { reason: describe(report.storeError) }))
}

/** The operating system's own error, as `auth status` names it. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Recovers the journal inside the lease and reports it; the caller honors `failed`. */
async function recoverAndReportJournal(
  deps: Pick<AuthCommandDeps, 'print' | 'printError' | 'secrets'>,
): Promise<OpenRouterJournalReport> {
  const report = await recoverOpenRouterJournalReport(deps.secrets)
  reportJournalRecovery(deps, report)
  return report
}

/**
One `auth --provider` command inside the one credential lease: journal
recovery first, then the command; a live writer's lease resolves
through `busy` instead of failing.
*/
async function runAuthCommand(
  deps: AuthCommandDeps,
  withLock: CredentialLock,
  run: () => Promise<number>,
  busy: () => Promise<number>,
): Promise<number> {
  try {
    return await withLock(async () => {
      const report = await recoverAndReportJournal(deps)
      return report.failed ? 1 : await run()
    })
  } catch (error: unknown) {
    if (!isCredentialLockBusy(error)) throw error
    return await busy()
  }
}

/** A live writer's lease refuses a write with the one busy sentence. */
function busyWrite(deps: AuthCommandDeps): Promise<number> {
  deps.printError(UI_TEXT.providerConnectBusy)
  return Promise.resolve(1)
}

/** `auth set --provider <id>` inside the one credential lease. */
export async function runAuthSetProvider(
  deps: AuthCommandDeps,
  providerId: string,
  readUserFile: () => Promise<ProvidersFileRead>,
  withLock: CredentialLock,
  options?: { readonly admin?: boolean | undefined },
): Promise<number> {
  return await runAuthCommand(
    deps,
    withLock,
    () => authSetProvider(deps, providerId, readUserFile, options),
    () => busyWrite(deps),
  )
}

/** `auth clear --provider <id>` inside the one credential lease. */
export async function runAuthClearProvider(
  deps: AuthCommandDeps,
  providerId: string,
  withLock: CredentialLock,
  options: { readonly admin?: boolean | undefined } = {},
): Promise<number> {
  return await runAuthCommand(
    deps,
    withLock,
    () => authClearProvider(deps, providerId, options),
    () => busyWrite(deps),
  )
}

/**
`auth status --provider <id>` inside the one credential lease. A reader
never fails on a live writer's lease: without the lock it reports from
the primary and leaves another attempt's journal alone.
*/
export async function runAuthStatusProvider(
  deps: AuthCommandDeps,
  providerId: string,
  withLock: CredentialLock,
  options?: { readonly admin?: boolean | undefined },
): Promise<number> {
  return await runAuthCommand(
    deps,
    withLock,
    () => authStatusProvider(deps, providerId, options),
    () => authStatusProvider(deps, providerId),
  )
}

/**
Plain `auth status` also surfaces a crashed Connect journal (R5) before
reporting the Model API key. A live Connect's lease is left alone: the
status reports without touching another attempt's journal.
*/
export async function runAuthStatusWithRecovery(
  deps: AuthCommandDeps,
  withLock: CredentialLock,
  readUserFile: () => Promise<ProvidersFileRead>,
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
  return await authStatusAll(deps, readUserFile)
}
