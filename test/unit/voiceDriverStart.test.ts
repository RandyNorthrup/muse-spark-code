// The deferred voice driver (src/host/voice/voiceBundle.ts): a driver
// that cannot start reports the fixed dictation words with the failure's
// kind, the log keeps the same kind, and the next start tries again.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { DictationListener } from '../../src/core/voice/dictation'
import type { Logger } from '../../src/host/logger'
import { UI_TEXT } from '../../src/shared/constants'
import { deferredDriver } from '../../src/host/voice/voiceBundle'

const quiet = (): void => undefined

function listener(errors: string[]): DictationListener {
  return {
    onStatus: quiet,
    onText: quiet,
    onError: (reason) => void errors.push(reason),
  }
}

function memoryLog(warned: string[]): Logger {
  return { trace: quiet, info: quiet, warn: (message) => void warned.push(message), error: quiet }
}

function startRefusal(): unknown {
  try {
    readFileSync(path.join(tmpdir(), `no-voice-driver-${String(process.pid)}`), 'utf8')
  } catch (error: unknown) {
    return error
  }
  throw new Error('the refusal did not refuse')
}

it('reports kind words and retries the next start', () => {
  const errors: string[] = []
  const warned: string[] = []
  const refusal = startRefusal()
  let calls = 0
  const driver = deferredDriver(
    listener(errors),
    () => {
      calls += 1
      if (calls === 1) throw refusal
      return { start: quiet, stop: quiet, dispose: quiet }
    },
    memoryLog(warned),
  )
  driver.start()
  expect(errors).toEqual([`${UI_TEXT.dictationFailed}: Error`])
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('failed to start')
  expect(warned[0]).not.toContain('no-voice-driver')
  driver.start()
  expect(calls).toBe(2)
  expect(errors).toHaveLength(1)
})

it('keeps the bundle loader remedy when the code did not load', () => {
  const errors: string[] = []
  const warned: string[] = []
  const driver = deferredDriver(
    listener(errors),
    () => {
      throw new Error(UI_TEXT.dictationNotLoaded)
    },
    memoryLog(warned),
  )
  driver.start()
  expect(errors).toEqual([`${UI_TEXT.dictationFailed}: ${UI_TEXT.dictationNotLoaded}`])
  expect(warned).toHaveLength(1)
  expect(warned[0]).toContain('failed to start')
})
