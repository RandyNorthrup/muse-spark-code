// Where the person was and whether anything can connect (lane REPORTFLOW,
// PLAN.md M93): the small pure helpers the report dialog, its host and the
// terminal command share. No `node` import, so the webview bundle reads this
// too; every value out is a fixed word, never screen text.

import type { ReportPanelState } from '../../shared/constants'
import type { AuthStatus } from '../../shared/protocol'

/** What the panel shows, as the report states it. */
export interface ReportPanelView {
  readonly status: AuthStatus
  /** A turn is answering now. */
  readonly isRunning: boolean
  /** A question card waits for the person. */
  readonly hasWaitingQuestion: boolean
  /** The transcript ends in an error notice. */
  readonly lastIsErrorNotice: boolean
}

/**
The panel state for a view: the gate the person stands at, or the
conversation state past it. Derived from the states the panel really has
(the auth snapshot, the active turn, the open questions, the last row).
*/
export function reportPanelStateOf(view: ReportPanelView): ReportPanelState {
  switch (view.status) {
    case 'checking': {
      return 'starting'
    }
    case 'noCli': {
      return 'landingNoCli'
    }
    case 'installing': {
      return 'landingInstalling'
    }
    case 'signedOut': {
      return 'landingSignedOut'
    }
    case 'signingIn': {
      return 'landingSigningIn'
    }
    case 'error': {
      return 'landingError'
    }
    case 'signedIn': {
      if (view.isRunning) {
        return 'turnRunning'
      }
      if (view.hasWaitingQuestion) {
        return 'questionWaiting'
      }
      return view.lastIsErrorNotice ? 'turnFailed' : 'ready'
    }
  }
}

/** The support facts the connect hint reads, as the builder takes them. */
interface ReportConnectFacts {
  readonly cliSignIn: boolean
  readonly hasStoredApiKey: boolean
  readonly hasEnvironmentApiKey: boolean
}

function isReportConnectFacts(value: unknown): value is ReportConnectFacts {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const facts = value as Record<string, unknown>
  return (
    typeof facts['cliSignIn'] === 'boolean' &&
    typeof facts['hasStoredApiKey'] === 'boolean' &&
    typeof facts['hasEnvironmentApiKey'] === 'boolean'
  )
}

/**
Whether nothing can connect (the CLI not signed in and no key anywhere):
the dialog then offers the landing screen's own two actions above the
form. False for anything but matching facts, never a guess.
*/
export function shouldShowConnectHint(facts: unknown): boolean {
  return (
    isReportConnectFacts(facts) &&
    !facts.cliSignIn &&
    !facts.hasStoredApiKey &&
    !facts.hasEnvironmentApiKey
  )
}
