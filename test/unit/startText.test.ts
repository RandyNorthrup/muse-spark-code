// A failed session/new or turn start says what failed in words, never a
// bare "Internal error" with the cause buried in its data (RLWINFIX2
// item 2). The mapper below is pure: these cases feed it the real errors
// each path throws (typed registry failures, our own sentences, MSP and
// errno failures, real disk faults) and assert the exact words.
import { MspError } from '@muse-code/sdk'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { startFailureText } from '../../src/acp/startText'
import {
  CreatedRegistrySaveError,
  type CreatedRegistrySaveReason,
} from '../../src/shared/createdRegistrySaveError'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

function session(detail: string): string {
  return fill(UI_TEXT.acpSessionStartFailed, { detail })
}

function turn(detail: string): string {
  return fill(UI_TEXT.acpTurnStartFailed, { detail })
}

describe('startFailureText', () => {
  it('names a refused registry save and why, on either site', () => {
    const reasons: readonly CreatedRegistrySaveReason[] = [
      'refused',
      'unsafe',
      'invalid',
      'io',
      'contended',
    ]
    for (const reason of reasons) {
      const expected = fill(UI_TEXT.createdRegistrySave.failed, {
        reason: UI_TEXT.createdRegistrySave[reason],
      })
      expect(
        startFailureText(
          new CreatedRegistrySaveError(reason, { cause: new Error('the helper said no') }),
          'session',
        ),
      ).toBe(expected)
      expect(startFailureText(new CreatedRegistrySaveError(reason), 'turn')).toBe(expected)
    }
  })

  it('passes through sentences our own layers threw', () => {
    for (const sentence of [
      UI_TEXT.scheduleBusy,
      UI_TEXT.surfaceClosed,
      UI_TEXT.permissionReviewerMissing,
      UI_TEXT.museCodeNotAnswering,
      UI_TEXT.accounts.invalidAccount,
    ])
      expect(startFailureText(new Error(sentence), 'session')).toBe(sentence)
  })

  it('names an MSP failure by its kind and code, never its message', () => {
    const refused = new MspError({
      code: -32_042,
      message: String.raw`failed at C:\Users\someone\.config\muse\auth.json`,
      data: { kind: 'sessionNotLoaded' },
    })
    const text = startFailureText(refused, 'turn')
    expect(text).toBe(turn('sessionNotLoaded (MSP error -32042)'))
    expect(text).not.toContain('someone')
  })

  it('names an errno failure by its name and code', () => {
    expect(
      startFailureText(Object.assign(new Error('write failed'), { code: 'EPIPE' }), 'session'),
    ).toBe(session('Error EPIPE'))
  })

  it('keeps a real disk failure behind the site sentence', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'startfailure-'))
    try {
      await mkdir(path.join(folder, 'providers.json'))
      let failure: unknown
      try {
        await readFile(path.join(folder, 'providers.json', 'x'), 'utf8')
      } catch (error: unknown) {
        failure = error
      }
      const text = startFailureText(failure, 'session')
      expect(text.startsWith('The session could not be started (')).toBe(true)
      expect(text).not.toContain(folder)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('walks wrappers past to their cause', () => {
    const registry = new CreatedRegistrySaveError('invalid', { cause: new Error('garbage') })
    expect(startFailureText(new Error('start failed', { cause: registry }), 'session')).toBe(
      startFailureText(registry, 'session'),
    )
    expect(startFailureText(new Error('start failed'), 'turn')).toBe(turn('Error'))
    expect(startFailureText('not an error', 'turn')).toBe(turn('an unknown failure'))
  })
})
