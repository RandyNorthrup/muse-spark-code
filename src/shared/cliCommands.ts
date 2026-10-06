// Public runtime command table. The localized usage table owns descriptions.
import { ACP_AGENT_NAME, REFERENCE_DOCS_URL, UI_TEXT, SLASH_COMMAND_NAMES } from './constants'

import { fill } from './l10n/text'

export function cliCommands() {
  const lines = fill(UI_TEXT.acpUsage, { command: ACP_AGENT_NAME }).split('\n')
  const description = (syntax: string): string =>
    lines.find((line) => line.includes(syntax))?.trim() ?? ''
  return [
    { route: 'serve', name: '[options]', description: description('[options]              ') },
    { route: 'login', name: 'login', description: UI_TEXT.acpAuthMuseCodeDetail },
    { route: 'authSet', name: 'auth set', description: UI_TEXT.acpAuthKeyDetail },
    { route: 'authStatus', name: 'auth status', description: description('auth set|status|clear') },
    { route: 'authClear', name: 'auth clear', description: description('auth set|status|clear') },
    { route: 'setup', name: 'setup', description: description(' setup ') },
    { route: 'exec', name: 'exec', description: description(' exec ') },
    { route: 'scan-secrets', name: 'scan-secrets', description: description(' scan-secrets ') },
    { route: 'report', name: 'report', description: description(' report ') },
    { route: 'help', name: 'help --all', description: UI_TEXT.referenceIntro },
    { route: 'help', name: '--help', description: UI_TEXT.referenceIntro },
    { route: 'version', name: '--version', description: UI_TEXT.referenceVersion },
  ]
}

/** ACP supports /help and installed skills; the full panel list lives in the page. */
export function compactReference(skills: readonly string[]): string {
  return [
    UI_TEXT.helpReferenceTitle,
    UI_TEXT.referenceIntro,
    `${UI_TEXT.groupSlashCommands}: ${[`/${SLASH_COMMAND_NAMES.help}`, ...skills.map((name) => `/${name}`)].join(', ')}`,
    `${UI_TEXT.referenceCommands}: ${cliCommands()
      .map((entry) => entry.name)
      .join(', ')}`,
    `${UI_TEXT.referenceDocs}: ${REFERENCE_DOCS_URL}`,
    `${ACP_AGENT_NAME} help --all`,
  ].join('\n')
}
