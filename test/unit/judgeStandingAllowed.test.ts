// The judge's standing allow-rules reader (src/host/judge/judgeEntry.ts):
// a settings text the reader cannot hand over fails closed — approval is
// unchanged and the log names only the failure's kind. Malformed text never
// reaches the reader's failure path: the parser itself denies it quietly.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import { isStandingAllowed } from '../../src/host/judge/judgeEntry'

const quiet = (): void => undefined

function memoryLog(): { log: Logger; warned: string[] } {
  const warned: string[] = []
  return {
    warned,
    log: { trace: quiet, info: quiet, warn: (message) => void warned.push(message), error: quiet },
  }
}

it('fails closed with kind words when the settings file cannot be handed over', () => {
  const { log, warned } = memoryLog()
  const isAllowed = isStandingAllowed(
    () =>
      readFileSync(path.join(tmpdir(), `no-judge-settings-${String(process.pid)}.json`), 'utf8'),
    log,
  )
  expect(isAllowed).toBe(false)
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('approval unchanged')
  expect(warned[0]).toContain('Error')
  expect(warned[0]).not.toContain('no such file')
})

it('denies malformed settings quietly, and admits a text without permissions', () => {
  const { log, warned } = memoryLog()
  expect(isStandingAllowed(() => '{oops', log)).toBe(false)
  expect(isStandingAllowed(() => JSON.stringify({ schema_version: 1 }), log)).toBe(true)
  expect(warned).toHaveLength(0)
})
