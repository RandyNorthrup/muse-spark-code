// D107 (M125 lane W): the setup wizard's driver, loaded only when the
// wizard opens. One controller over the production ports; the panel
// owns the surface and posts each validated command.
import { JudgeSetupController, type JudgeSetupDirective } from '../../core/judge/setup/controller'
import { productionSetupPorts, type JudgeSetupPaths } from '../../core/judge/setup/ports'
import type { JudgeSetupCommandMessage, JudgeSetupSnapshot } from '../../shared/judgeSetupSchema'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export interface JudgeSetupDriver {
  readonly command: (
    message: JudgeSetupCommandMessage,
    onSnapshot: (snapshot: JudgeSetupSnapshot) => void,
  ) => Promise<JudgeSetupDirective>
  readonly current: () => JudgeSetupSnapshot
  readonly abort: () => void
}

export function createJudgeSetupDriver(language: {
  readonly uiText: UiText
  readonly uiLocale: string
  readonly paths: JudgeSetupPaths
}): JudgeSetupDriver {
  setUiText(language.uiText, language.uiLocale)
  const controller = new JudgeSetupController(language.paths, productionSetupPorts())
  return {
    command: (message, onSnapshot) => controller.command(message, onSnapshot),
    current: () => controller.current(),
    abort: () => {
      controller.abort()
    },
  }
}
