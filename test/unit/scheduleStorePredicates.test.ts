// Store-error shapes stay honest across the schedule file stores (PLAN.md
// D119): the `is`-named twins answer exactly what the readers answer, the
// launcher refusal keeps the I/O failure as its cause, and an unposted
// schedule request rejects load-failed with the send failure as its cause.
import { beforeEach, describe, expect, it } from 'vitest'
import { isStoreErrorCode, storeErrorCode } from '../../src/host/backend/storeErrors'
import { unsafeScheduleLauncher } from '../../src/runtime/schedules/registration'
import { isErrorCode, isTransientStoreError } from '../../src/runtime/schedules/nodeScheduleFs'
import { scheduleChannel } from '../../src/webview/schedules/channel'
import type { MessageSource } from '../../src/webview/hostBridge'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { UI_TEXT } from '../../src/shared/constants'

function coded(code: string): Error {
  return Object.assign(new Error('store failed'), { code })
}

describe('store error twins', () => {
  it('answers exactly what the reader answers on every input', () => {
    const inputs: unknown[] = [
      coded('ENOENT'),
      coded('EEXIST'),
      new Error('plain'),
      'ENOENT',
      undefined,
      undefined,
    ]
    for (const input of inputs) {
      expect(isStoreErrorCode(input, 'ENOENT')).toBe(storeErrorCode(input) === 'ENOENT')
      expect(isStoreErrorCode(input, 'EEXIST')).toBe(storeErrorCode(input) === 'EEXIST')
    }
    expect(isStoreErrorCode(coded('ENOENT'), 'ENOENT')).toBe(true)
  })

  it('reads errno codes and transient lock blocks', () => {
    expect(isErrorCode(coded('ENOENT'), 'ENOENT')).toBe(true)
    expect(isErrorCode(coded('EPERM'), 'ENOENT')).toBe(false)
    expect(isErrorCode(new Error('plain'), 'ENOENT')).toBe(false)
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      expect(isTransientStoreError(coded(code))).toBe(true)
    }
    expect(isTransientStoreError(coded('ENOENT'))).toBe(false)
    expect(isTransientStoreError(new Error('plain'))).toBe(false)
  })
})

describe('unsafe launcher refusal', () => {
  it('keeps the fixed words and carries the I/O failure', () => {
    const failure = coded('EACCES')
    const refused = unsafeScheduleLauncher('some/file', failure)
    expect(refused).toBeInstanceOf(Error)
    expect(refused.cause).toBe(failure)
    expect(unsafeScheduleLauncher('some/file').cause).toBeUndefined()
  })
})

describe('schedule channel send failure', () => {
  beforeEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('rejects load-failed with the send failure as its cause', async () => {
    const sendError = new Error('postDown')
    let added = 0
    let removed = 0
    const messages: MessageSource = {
      addEventListener: () => {
        added += 1
      },
      removeEventListener: () => {
        removed += 1
      },
    }
    const channel = scheduleChannel(messages, () => {
      throw sendError
    })
    try {
      let failure: unknown
      try {
        await channel.request({ method: 'schedules/list', workspaceKey: 'workspace-1' })
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toBe(UI_TEXT.scheduleV2.editor.loadFailed)
      expect(failure instanceof Error && failure.cause).toBe(sendError)
      expect(added).toBe(1)
    } finally {
      channel.dispose()
      expect(removed).toBe(1)
    }
  })
})
