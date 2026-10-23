// The session/turn start words the ACP agent answers with: a failed
// session/new or turn start says what failed in words, never a bare
// "Internal error" with the cause buried in its data (RLWINFIX2 item 2).
import { causeForLog, isOwnSentence } from '../core/backends/musecode/logText'
import {
  isCreatedRegistrySaveError,
  type CreatedRegistrySaveReason,
} from '../shared/createdRegistrySaveError'
import { UI_TEXT } from '../shared/constants'
import { fill } from '../shared/l10n/text'

/** Which start failed: the session's, or a turn's once the session runs. */
export type StartSite = 'session' | 'turn'

function registryReasonText(reason: CreatedRegistrySaveReason): string {
  switch (reason) {
    case 'refused': {
      return UI_TEXT.createdRegistrySave.refused
    }
    case 'unsafe': {
      return UI_TEXT.createdRegistrySave.unsafe
    }
    case 'invalid': {
      return UI_TEXT.createdRegistrySave.invalid
    }
    case 'io': {
      return UI_TEXT.createdRegistrySave.io
    }
    case 'contended': {
      return UI_TEXT.createdRegistrySave.contended
    }
  }
}

function registryText(reason: CreatedRegistrySaveReason): string {
  return fill(UI_TEXT.createdRegistrySave.failed, { reason: registryReasonText(reason) })
}

/**
What a failed start says: the session or turn could not start, with the
failure's fixed-vocabulary cause. A refused registry save names itself and
why; sentences our own layers threw when they knew what happened pass
through untouched (they span layers, so any installed sentence passes
rather than a fixed allowlist); wrappers are walked past to their cause.
*/
export function startFailureText(error: unknown, site: StartSite): string {
  const template = site === 'session' ? UI_TEXT.acpSessionStartFailed : UI_TEXT.acpTurnStartFailed
  let current: unknown = error
  while (current instanceof Error) {
    if (isCreatedRegistrySaveError(current)) return registryText(current.reason)
    if (isOwnSentence(current.message)) return current.message
    if (current.cause === undefined) return fill(template, { detail: causeForLog(current) })
    current = current.cause
  }
  return fill(template, { detail: causeForLog(error) })
}
