// The estimator's lazy bundle (src/host/estimator/estimatorBundle.ts): a
// bundle file Node itself cannot load fails the estimate with the fixed
// unavailable words, keeping the loader's real failure as the cause while
// the log names only its kind.
import path from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { estimateRequestSchema } from '../../src/shared/estimate'
import type { Logger } from '../../src/host/logger'
import { lazyEstimator } from '../../src/host/estimator/estimatorBundle'

const quiet = (): void => undefined

function memoryLog(): { log: Logger; errors: string[] } {
  const errors: string[] = []
  return {
    errors,
    log: { trace: quiet, info: quiet, warn: quiet, error: (message) => void errors.push(message) },
  }
}

it('refuses with the fixed words and keeps the real load failure as the cause', async () => {
  const { log, errors } = memoryLog()
  const run = lazyEstimator({
    bundlePath: path.join(tmpdir(), `no-estimator-bundle-${String(process.pid)}.js`),
    log,
    ports: () => {
      throw new Error('the bundle never loaded, so no ports are built')
    },
  })
  const request = estimateRequestSchema.parse({
    goal: { kind: 'pullRequest', number: 1 },
    asOf: '2026-10-18T00:00:00.000Z',
    fleet: 'current',
    optimize: 'cost',
  })
  let failure: unknown
  try {
    await run.estimate(request, new AbortController().signal)
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  const thrown = failure as Error
  expect(thrown.message).toBe(UI_TEXT.estimateUnavailable)
  const cause = thrown.cause
  expect(cause instanceof Error && 'code' in cause ? String(cause.code) : undefined).toBe(
    'MODULE_NOT_FOUND',
  )
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('could not be loaded')
  expect(errors[0]).not.toContain('Cannot find module')
})
