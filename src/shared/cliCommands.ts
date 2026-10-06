// Public runtime command table. The localized usage table owns descriptions.
import { ACP_AGENT_NAME, REFERENCE_DOCS_URL, UI_TEXT, SLASH_COMMAND_NAMES } from './constants'

import { fill } from './l10n/text'

export function cliCommands() {
  const lines = fill(UI_TEXT.acpUsage, { command: ACP_AGENT_NAME }).split('\n')
  const description = (syntax: string): string =>
    lines.find((line) => line.includes(syntax))?.trim() ?? ''
  return [
    {
      route: 'serve',
      name: '[options]',
      description: description('[options]              '),
      text: { ui: 'acpUsage' },
      usageKey: 'acpUsage',
      usageLine: 1,
    },
    {
      route: 'login',
      name: 'login',
      description: UI_TEXT.acpAuthMuseCodeDetail,
      text: { ui: 'acpAuthMuseCodeDetail' },
    },
    {
      route: 'authSet',
      name: 'auth set',
      description: UI_TEXT.acpAuthKeyDetail,
      text: { ui: 'acpAuthKeyDetail' },
    },
    {
      route: 'authStatus',
      name: 'auth status',
      description: UI_TEXT.referenceAuthStatus,
      text: { ui: 'referenceAuthStatus' },
    },
    {
      route: 'authClear',
      name: 'auth clear',
      description: UI_TEXT.referenceAuthClear,
      text: { ui: 'referenceAuthClear' },
    },
    {
      route: 'setup',
      name: 'setup',
      description: description(' setup '),
      text: { ui: 'referenceSetup' },
      usageKey: 'acpUsage',
      usageLine: lines.findIndex((line) => line.includes(' setup ')),
    },
    {
      route: 'exec',
      name: 'exec',
      description: description(' exec '),
      text: { ui: 'referenceExecContract' },
    },
    {
      route: 'scan-secrets',
      name: 'scan-secrets',
      description: description(' scan-secrets '),
      text: { ui: 'referenceKeyStdin' },
    },
    {
      route: 'report',
      name: 'report',
      description: description(' report '),
      text: { ui: 'reportUsage' },
    },
    {
      route: 'help',
      name: 'help --all',
      description: UI_TEXT.referenceIntro,
      text: { ui: 'referenceIntro' },
    },
    {
      route: 'help',
      name: 'help / --help / -h',
      description: UI_TEXT.referenceBriefHelp,
      text: { ui: 'referenceBriefHelp' },
    },
    {
      route: 'version',
      name: '--version / -v',
      description: UI_TEXT.referenceVersion,
      text: { ui: 'referenceVersion' },
    },
  ]
}

/** ACP supports /help and installed skills; the full panel list lives in the page. */
export function compactReference(skills: readonly string[]): string {
  return [
    UI_TEXT.helpReferenceTitle,
    UI_TEXT.referenceAcp.replaceAll(`/${SLASH_COMMAND_NAMES.help}`, () => SLASH_COMMAND_NAMES.help),
    `${UI_TEXT.groupSlashCommands}: ${[`/${SLASH_COMMAND_NAMES.help}`, ...skills.filter((name) => name !== SLASH_COMMAND_NAMES.help).map((name) => `/${name}`)].join(', ')}`,
    `${UI_TEXT.referenceCommands}: ${cliCommands()
      .map((entry) => entry.name)
      .join(', ')}`,
    `${UI_TEXT.referenceDocs}: ${REFERENCE_DOCS_URL}`,
    `${ACP_AGENT_NAME} help --all`,
  ].join('\n')
}
