// The production confirmation-store binding: one JSON file per
// provider/product beside the journal, shared by the pool and consent
// suites so neither invents its own.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AccountConfirmationStore } from '../../../src/core/accounts/confirmations'
import { ACCOUNT_REQUEST_STORE } from '../../../src/shared/constants'

export interface ScriptedPolicyAnswers {
  count: number
  answers: unknown[]
}

/** A policy questioner fed from a script, counting every question. */
export function scriptedAsker(script: ScriptedPolicyAnswers) {
  return () => {
    script.count += 1
    const answer = script.answers.shift()
    return answer === undefined
      ? Promise.reject(new Error('unexpected policy question'))
      : Promise.resolve(answer)
  }
}

export function fileConfirmationStore(directory: string): AccountConfirmationStore {
  const file = (provider: string, product: string) =>
    path.join(directory, `confirmation-${provider}-${product}.json`)
  return {
    read: async (provider, product) => {
      try {
        return JSON.parse(await readFile(file(provider, product), 'utf8')) as unknown
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return undefined
        throw error
      }
    },
    write: async (provider, product, value) => {
      await mkdir(directory, { recursive: true, mode: ACCOUNT_REQUEST_STORE.directoryMode })
      await writeFile(file(provider, product), JSON.stringify(value), {
        mode: ACCOUNT_REQUEST_STORE.fileMode,
      })
    },
    remove: async (provider, product) => {
      await rm(file(provider, product), { force: true })
    },
  }
}
