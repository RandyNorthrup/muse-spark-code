// A started broker's first answer, for the fixtures that drive the real one.
// The cold start belongs in the hook, never in a case, and a broker may take
// longer than one launch budget to answer. But a broker that never answers
// must fail its suite with words, not hold its shard to the job's limit: runs
// 41214393586 and 41516831678 lost three and four Windows shards that way, with
// no line in the log to say why, while the real answer was a refusal the
// old loop swallowed on every attempt (docs/certification/cc-winfix3.md).

import { setTimeout as delay } from 'node:timers/promises'
import { UI_TEXT, VAULT_BROKER_NATIVE_TIMEOUT_MS } from '../../../../src/shared/constants'

/**
How long a started broker has for its first answer. This is the test harness,
never a limit on a person's vault: under the 180 s of the one suite that starts
its broker inside a case, so that case says why too, and far past the 3.9 s this
start took on a loaded workstation (helper builds included).
*/
const BROKER_FIRST_ANSWER_MS = 120_000
/** The product's own pause between looks at a starting broker (clientLaunch.ts). */
const BROKER_RETRY_MS = VAULT_BROKER_NATIVE_TIMEOUT_MS / 100

/**
What a client says while its broker is still starting: the launch budget ran
out, or a claim was read before it was whole. Anything else (an answer of
the wrong shape, a programming error) will not change by asking again.
*/
function isStillStarting(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message === UI_TEXT.vault.brokerBlocked || error.message === UI_TEXT.vault.noAccess)
  )
}

/**
Ask until the broker answers. Fails at once on an error no start explains,
and at the bound naming what it waited for, how many attempts ended and what
the last one said. The bound also covers an attempt that never returns.
*/
export async function awaitFirstBrokerAnswer(
  ask: () => Promise<unknown>,
  boundMs: number = BROKER_FIRST_ANSWER_MS,
): Promise<void> {
  let ended = 0
  let said = 'nothing yet'
  const wait = { isOver: false }
  const asking = (async () => {
    while (!wait.isOver) {
      try {
        await ask()
        return
      } catch (error: unknown) {
        ended += 1
        if (!isStillStarting(error))
          throw new Error(
            `the vault broker's first answer failed on attempt ${String(ended)}: ${String(error)}`,
            { cause: error },
          )
        said = error.message
      }
      await delay(BROKER_RETRY_MS)
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `the vault broker gave no first answer in ${String(boundMs)} ms: ${String(ended)} attempts ended, the last said: ${said}`,
        ),
      )
    }, boundMs)
  })
  try {
    await Promise.race([asking, bound])
  } finally {
    wait.isOver = true
    clearTimeout(timer)
  }
}
