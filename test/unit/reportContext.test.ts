// Where the person was and whether anything can connect (lane REPORTFLOW,
// PLAN.md M93): the pure helpers in src/core/support/reportContext.ts. Fixed
// words out, never screen text.

import { describe, expect, it } from 'vitest'
import { reportPanelStateOf, shouldShowConnectHint } from '../../src/core/support/reportContext'

describe('reportPanelStateOf', () => {
  it('names the gate the person stands at', () => {
    const still = { isRunning: false, hasWaitingQuestion: false, lastIsErrorNotice: false }
    expect(reportPanelStateOf({ status: 'checking', ...still })).toBe('starting')
    expect(reportPanelStateOf({ status: 'noCli', ...still })).toBe('landingNoCli')
    expect(reportPanelStateOf({ status: 'installing', ...still })).toBe('landingInstalling')
    expect(reportPanelStateOf({ status: 'signedOut', ...still })).toBe('landingSignedOut')
    expect(reportPanelStateOf({ status: 'signingIn', ...still })).toBe('landingSigningIn')
    expect(reportPanelStateOf({ status: 'error', ...still })).toBe('landingError')
  })

  it('names the conversation state past the gate', () => {
    expect(
      reportPanelStateOf({
        status: 'signedIn',
        isRunning: true,
        hasWaitingQuestion: true,
        lastIsErrorNotice: true,
      }),
    ).toBe('turnRunning')
    expect(
      reportPanelStateOf({
        status: 'signedIn',
        isRunning: false,
        hasWaitingQuestion: true,
        lastIsErrorNotice: false,
      }),
    ).toBe('questionWaiting')
    expect(
      reportPanelStateOf({
        status: 'signedIn',
        isRunning: false,
        hasWaitingQuestion: false,
        lastIsErrorNotice: true,
      }),
    ).toBe('turnFailed')
    expect(
      reportPanelStateOf({
        status: 'signedIn',
        isRunning: false,
        hasWaitingQuestion: false,
        lastIsErrorNotice: false,
      }),
    ).toBe('ready')
  })
})

describe('shouldShowConnectHint', () => {
  it('asks for help only when the CLI is not signed in and no key is anywhere', () => {
    expect(
      shouldShowConnectHint({
        cliSignIn: false,
        hasStoredApiKey: false,
        hasEnvironmentApiKey: false,
      }),
    ).toBe(true)
    expect(
      shouldShowConnectHint({
        cliSignIn: true,
        hasStoredApiKey: false,
        hasEnvironmentApiKey: false,
      }),
    ).toBe(false)
    expect(
      shouldShowConnectHint({
        cliSignIn: false,
        hasStoredApiKey: true,
        hasEnvironmentApiKey: false,
      }),
    ).toBe(false)
    expect(
      shouldShowConnectHint({
        cliSignIn: false,
        hasStoredApiKey: false,
        hasEnvironmentApiKey: true,
      }),
    ).toBe(false)
  })

  it('never guesses from anything but matching facts', () => {
    expect(shouldShowConnectHint(undefined)).toBe(false)
    expect(shouldShowConnectHint('landingSignedOut')).toBe(false)
    expect(shouldShowConnectHint({ cliSignIn: false })).toBe(false)
  })
})
