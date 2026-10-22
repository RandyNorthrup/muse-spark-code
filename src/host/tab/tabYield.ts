// Tab's language switch and Copilot yield (M94, PLAN.md D73): pure and
// dependency free, so the activation status bar and the lazy provider
// share them. `github.copilot.enable` and `museSpark.tabLanguages` share
// one shape (V12): a per-language switch over a `'*'` default. Pure: no
// `vscode` import.

export const TAB_LANGUAGE_WILDCARD = '*'

/** Whether Tab suggests in the language: the exact switch, else the wildcard, else on. */
export function isTabLanguageOn(
  languages: Readonly<Record<string, boolean>>,
  languageId: string,
): boolean {
  return languages[languageId] ?? languages[TAB_LANGUAGE_WILDCARD] ?? true
}

export interface CopilotPosture {
  readonly extensionPresent: boolean
  readonly enabledForLanguage: boolean
  readonly aiFeaturesDisabled: boolean
  readonly tabWithCopilot: 'yield' | 'both'
}

/**
Whether automatic Tab requests wait while Copilot is on for the language
(D73): yielded by default, while a Copilot extension is present,
`github.copilot.enable` is on for the language and AI features are not
turned off. Whether Copilot actually holds a token cannot be seen (V13).
*/
export function shouldYieldToCopilot(posture: CopilotPosture): boolean {
  return (
    posture.tabWithCopilot === 'yield' &&
    posture.extensionPresent &&
    posture.enabledForLanguage &&
    !posture.aiFeaturesDisabled
  )
}

/** Reads the posture around one language: installed and active, enabled, not disabled. */
export function readCopilotPosture(deps: {
  readonly isCopilotExtensionPresent: () => boolean
  readonly foreignSetting: (section: string, key: string) => unknown
  readonly tabWithCopilot: 'yield' | 'both'
  readonly languageId: string
}): CopilotPosture {
  const table = stringTableOf(deps.foreignSetting('github.copilot', 'enable'))
  const configured = table?.[deps.languageId] ?? table?.[TAB_LANGUAGE_WILDCARD]
  return {
    extensionPresent: deps.isCopilotExtensionPresent(),
    enabledForLanguage: configured !== false,
    aiFeaturesDisabled: deps.foreignSetting('chat', 'disableAIFeatures') === true,
    tabWithCopilot: deps.tabWithCopilot,
  }
}

/** A foreign setting's string-keyed table, if it parses as one. */
function stringTableOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const table: Record<string, unknown> = Object.fromEntries(Object.entries(value))
  return table
}
