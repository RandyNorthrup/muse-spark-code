// The wizard's spending-limit write (src/host/models/sessionBudget.ts): an
// invalid value fails with the panel's fixed words, while the store's own
// failure still rejects with the original error for the saver to report.
import { expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { canonicalUsd } from '../../src/shared/usdSchema'
import type { Logger } from '../../src/host/logger'
import {
  applyWizardSessionBudget,
  createSessionBudgetConfig,
  SessionBudgetInvalidError,
  type SessionBudgetConfig,
  type SessionBudgetConfigSource,
} from '../../src/host/models/sessionBudget'

const quietLogger: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function memorySource(
  values: Map<string, unknown> = new Map<string, unknown>(),
): SessionBudgetConfigSource {
  return {
    get: (section) => values.get(section),
    inspect: () => undefined,
    update: (section, value) => {
      values.set(section, value)
      return Promise.resolve()
    },
  }
}

it('writes a changed budget at its effective scope through the real chain', async () => {
  const config = createSessionBudgetConfig(
    memorySource(new Map([['modelApiSessionBudgetUsd', 10]])),
    quietLogger,
  )
  const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
  expect(outcome).toEqual({ status: 'written', scope: 'global' })
  expect(config.read().effectiveUsd).toBe(canonicalUsd(5))
})

it('fails an invalid value with the fixed words, never the store', async () => {
  const written: unknown[] = []
  const config: SessionBudgetConfig = {
    read: () => ({ effectiveUsd: canonicalUsd(10), scope: 'global' }),
    write: (value) => {
      written.push(value)
      return Promise.reject(new SessionBudgetInvalidError())
    },
  }
  const outcome = await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
  expect(outcome).toEqual({ status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid })
  expect(written).toEqual([canonicalUsd(5)])
})

it('lets the store failure reject with the original error', async () => {
  const storeFailure = new Error('store unavailable')
  const config: SessionBudgetConfig = {
    read: () => ({ effectiveUsd: canonicalUsd(10), scope: 'global' }),
    write: () => Promise.reject(storeFailure),
  }
  let failure: unknown
  try {
    await applyWizardSessionBudget(canonicalUsd(5), config, canonicalUsd(10))
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBe(storeFailure)
})
