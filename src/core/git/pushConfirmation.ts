// The push confirmation's words (M71, M123, PLAN.md D104): every part of what
// goes out, in the one place every editor reads them from, so the VS Code
// modal and the runtime panel's question say the same thing. A force is never
// offered, and the line that hooks and credential helpers run is always there.

import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { RuntimePushConfirmation } from './runtimeGit'

/** The question's title and body for a push; the action's name is `UI_TEXT.gitPushAction`. */
export function pushConfirmationText(confirmation: RuntimePushConfirmation): {
  readonly message: string
  readonly detail: string
} {
  const detail = [
    fill(UI_TEXT.gitPushRemoteLine, {
      remote: confirmation.remote,
      url: confirmation.remoteUrl ?? UI_TEXT.gitPushNoUrl,
    }),
    fill(UI_TEXT.gitPushBranchLine, { branch: confirmation.branch, target: confirmation.target }),
    confirmation.commits === undefined
      ? UI_TEXT.gitPushFirstPush
      : plural(UI_TEXT.gitPushCommits, confirmation.commits),
    UI_TEXT.gitPushNeverForce,
    UI_TEXT.gitCommandConsequences,
  ].join('\n')
  return {
    message: fill(UI_TEXT.gitPushConfirm, {
      branch: confirmation.branch,
      remote: confirmation.remote,
    }),
    detail,
  }
}
