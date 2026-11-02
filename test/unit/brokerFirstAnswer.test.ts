// The Windows broker fixtures' failure path. A broker that never answers held
// four hosted shards to the job's limit with no word in the log; these cases
// hold what replaced that loop: it fails, and says what it waited for. The
// answers are the client's own fixed refusals and a real parse failure of the
// helper's server answer. No broker runs here: this is the harness's own wait.

import { describe, expect, it } from 'vitest'
import { windowsVaultPipeServerResultSchema } from '../../src/core/vault/broker/windowsPipe'
import { UI_TEXT } from '../../src/shared/constants'
import { awaitFirstBrokerAnswer } from './helpers/vault/brokerFirstAnswer'

const SHORT_BOUND_MS = 300

describe('a Windows broker fixture waiting for its first answer', () => {
  it('asks again while the broker is still starting, then returns', async () => {
    let asked = 0
    await awaitFirstBrokerAnswer(() => {
      asked += 1
      if (asked === 1) return Promise.reject(new Error(UI_TEXT.vault.brokerBlocked))
      return asked === 2 ? Promise.reject(new Error(UI_TEXT.vault.noAccess)) : Promise.resolve()
    })
    expect(asked).toBe(3)
  })

  it('fails at the bound when an attempt never returns, and says what it waited for', async () => {
    await expect(
      awaitFirstBrokerAnswer(() => new Promise(() => undefined), SHORT_BOUND_MS),
    ).rejects.toThrow(
      `the vault broker gave no first answer in ${String(SHORT_BOUND_MS)} ms: 0 attempts ended, the last said: nothing yet`,
    )
  })

  it('fails at the bound on a refusal that never clears, and names the refusal', async () => {
    await expect(
      awaitFirstBrokerAnswer(
        () => Promise.reject(new Error(UI_TEXT.vault.brokerBlocked)),
        SHORT_BOUND_MS,
      ),
    ).rejects.toThrow(`the last said: ${UI_TEXT.vault.brokerBlocked}`)
  })

  it('stops asking once it has failed', async () => {
    let asked = 0
    await expect(
      awaitFirstBrokerAnswer(() => {
        asked += 1
        return Promise.reject(new Error(UI_TEXT.vault.noAccess))
      }, SHORT_BOUND_MS),
    ).rejects.toThrow('no first answer')
    const atFailure = asked
    await new Promise((resolve) => setTimeout(resolve, SHORT_BOUND_MS))
    expect(asked - atFailure).toBeLessThanOrEqual(1)
  })

  it('fails at once on an answer no start explains, naming it', async () => {
    let asked = 0
    const started = Date.now()
    await expect(
      awaitFirstBrokerAnswer(() => {
        asked += 1
        // As in run 41516831678: the real schema refuses a field the contract
        // does not name, which no number of attempts will change.
        const parsed = windowsVaultPipeServerResultSchema.safeParse({ parentProcessId: 7 })
        return parsed.success ? Promise.resolve() : Promise.reject(parsed.error)
      }),
    ).rejects.toThrow(/first answer failed on attempt 1: [\s\S]*parentProcessId/u)
    expect(asked).toBe(1)
    expect(Date.now() - started).toBeLessThan(SHORT_BOUND_MS * 10)
  })
})
