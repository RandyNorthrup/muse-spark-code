// GH borrows the already-loaded judge factory's real ask runner; no backend starts here.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { runJudgeCommand, JudgeCliIo } from './commands'
import type { JudgeCliOptions } from './args'
import {
  runJudgeHookCommand,
  judgeHookEvents,
  type JudgeHookCliSettings,
  type JudgeHookCliDeps,
} from './hook'

export function createJudgeHookFeatures(deps: {
  readonly uiText: UiText
  readonly uiLocale: string
  readonly runAsk: typeof runJudgeCommand
}) {
  setUiText(deps.uiText, deps.uiLocale)
  return {
    judgeHookEvents,
    runJudgeHookCommand(
      options: JudgeCliOptions,
      settings: JudgeHookCliSettings,
      io: JudgeCliIo,
      hookDeps: Omit<JudgeHookCliDeps, 'runAsk'>,
      signal?: AbortSignal,
    ) {
      return runJudgeHookCommand(
        options,
        settings,
        io,
        { ...hookDeps, runAsk: deps.runAsk },
        signal,
      )
    },
  }
}
