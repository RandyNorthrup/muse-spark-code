// The crashed-Connect recovery wrapper must name an unreachable credential
// store instead of failing silent: `providers usage`, `auth status` and their
// siblings return 1 with no notices when the store itself cannot be read,
// and the person gets the cause with the documented failure code.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keyringSecretStore, StoreUnavailableError } from '../../src/runtime/keyStore'
import {
  recoverOpenRouterJournalReport,
  reportJournalRecovery,
} from '../../src/runtime/providerAuth'
import { EN } from '../../src/shared/l10n/en'
import { fill } from '../../src/shared/l10n/text'

function sinks() {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    deps: {
      print: (line: string) => {
        printed.push(line)
      },
      printError: (line: string) => {
        errors.push(line)
      },
    },
  }
}

describe('journal recovery reporting', () => {
  it('names an unreachable store when the recovery reads nothing', () => {
    const { deps, printed, errors } = sinks()
    reportJournalRecovery(deps, {
      notices: [],
      committed: false,
      failed: true,
      storeError: new Error('operation failed: no entry'),
    })
    expect(printed).toEqual([])
    expect(errors).toEqual([fill(EN.acpStoreUnavailable, { reason: 'operation failed: no entry' })])
  })

  it('keeps a refused cleanup to its composed notice', () => {
    const { deps, printed, errors } = sinks()
    reportJournalRecovery(deps, {
      notices: ['the journal stays; remove the key first'],
      committed: false,
      failed: true,
    })
    expect(printed).toEqual([])
    expect(errors).toEqual(['the journal stays; remove the key first'])
  })

  it('announces a committed attempt with the stored-key note', () => {
    const { deps, printed, errors } = sinks()
    reportJournalRecovery(deps, { notices: [], committed: true, failed: false })
    expect(printed).toEqual([EN.providerConnectRecoveredStored])
    expect(errors).toEqual([])
  })

  it('reports a dead credential store as failed with the store cause instead of throwing', async () => {
    const store = keyringSecretStore(
      () => ({
        getPassword: (): Promise<never> =>
          Promise.reject(new Error('the keychain cannot be reached')),
        setPassword: () => Promise.resolve(),
        deletePassword: () => Promise.resolve(false),
      }),
      { lockScope: randomUUID() },
    )
    const report = await recoverOpenRouterJournalReport(store)
    expect(report.failed).toBe(true)
    expect(report.storeError).toBeInstanceOf(StoreUnavailableError)
    const { deps, printed, errors } = sinks()
    reportJournalRecovery(deps, report)
    expect(printed).toEqual([])
    expect(errors).toEqual([fill(EN.acpStoreUnavailable, { reason: 'store-unavailable' })])
  })
})
