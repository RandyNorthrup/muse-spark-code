// Public runtime command table. The localized usage table owns descriptions.
import { ACP_AGENT_NAME, REFERENCE_DOCS_URL, UI_TEXT, SLASH_COMMAND_NAMES } from './constants'

export function cliCommands() {
  return [
    {
      route: 'usage',
      name: 'usage [summary|daily|models|limits|export|open|serve] [options] / --usage --json',
      description: UI_TEXT.acpUsageDescription,
      text: { ui: 'acpUsageDescription' },
    },
    {
      route: 'legal',
      name: 'exec legal-scan --json / legal [--format text|json] [--out <file>] [--registry]',
      description: UI_TEXT.legalScanItemDetail,
      text: { ui: 'legalScanItemDetail' },
    },
    {
      route: 'providersList',
      name: 'providers list',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'providersAdd',
      name: 'providers add --preset <preset> [--as <id>] [--address <url>] [--model <model>] [--privacy <policy>] [--private-ok] [--key-stdin]',
      description: UI_TEXT.startWithOwnModelDetail,
      text: { ui: 'startWithOwnModelDetail' },
    },
    {
      route: 'providersTest',
      name: 'providers test <id>',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'providersRemove',
      name: 'providers remove <id>',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'chatGptProvider',
      name: 'providers add|remove|status chatgpt',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'serve',
      name: '[options]',
      description: UI_TEXT.referenceServe,
      text: { ui: 'referenceServe' },
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
      description: UI_TEXT.referenceSetup,
      text: { ui: 'referenceSetup' },
    },
    {
      route: 'exec',
      name: 'exec',
      description: UI_TEXT.referenceExecContract,
      text: { ui: 'referenceExecContract' },
    },
    {
      route: 'scan-secrets',
      name: 'scan-secrets',
      description: UI_TEXT.referenceScanSecrets,
      text: { ui: 'referenceScanSecrets' },
    },
    {
      route: 'accounts',
      name: 'providers accounts',
      description: UI_TEXT.referenceAccounts,
      text: { ui: 'referenceAccounts' },
    },
    {
      route: 'developer',
      name: 'developer',
      description: UI_TEXT.referenceDeveloper,
      text: { ui: 'referenceDeveloper' },
    },
    {
      route: 'report',
      name: 'report',
      description: UI_TEXT.reportUsage,
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
    ...(
      [
        [
          'share',
          'share chat SESSION_ID [--mode full|conversation] [--format md|html|json]',
          'shareReviewPrivacy',
        ],
        [
          'prompts',
          'prompts save --title TITLE [--scope user|workspace] [--cwd FOLDER] < prompt.txt',
          'promptSecretsNote',
        ],
        ['prompts', 'prompts list [--search TEXT] [--tag TAG] [--cwd FOLDER]', 'promptLibrary'],
        [
          'prompts',
          'prompts use ID [--scope user|workspace] [--chat active|new] [--cwd FOLDER]',
          'promptRun',
        ],
        [
          'prompts',
          'prompts share ID [--scope user|workspace] [--format md|html|json] [--destination copy|file|browser] [--out FILE]',
          'shareReviewPrivacy',
        ],
      ] as const
    ).map(([route, name, key]) => ({ route, name, description: UI_TEXT[key], text: { ui: key } })),
    {
      route: 'acp',
      name: '/prompt save|list|use|share',
      description: UI_TEXT.promptRun,
      text: { ui: 'promptRun' },
    },
    {
      route: 'acp',
      name: '/share chat [--mode full|conversation] [--format md|html|json]',
      description: UI_TEXT.shareReviewPrivacy,
      text: { ui: 'shareReviewPrivacy' },
    },
    {
      route: 'version',
      name: '--version / -v',
      description: UI_TEXT.referenceVersion,
      text: { ui: 'referenceVersion' },
    },
    {
      route: 'vault',
      name: 'vault',
      description: UI_TEXT.referenceVault,
      text: { ui: 'referenceVault' },
    },
    {
      route: 'vaultHelp',
      name: 'vault --help',
      description: UI_TEXT.referenceVaultHelp,
      text: { ui: 'referenceVaultHelp' },
    },
  ]
}

/** ACP's available local commands and installed skills; panel commands live in the page. */
export function compactReference(skills: readonly string[]): string {
  return [
    UI_TEXT.helpReferenceTitle,
    UI_TEXT.referenceAcp.replaceAll(`/${SLASH_COMMAND_NAMES.help}`, () => SLASH_COMMAND_NAMES.help),
    `${UI_TEXT.groupSlashCommands}: ${[...new Set([SLASH_COMMAND_NAMES.help, ...skills])].map((name) => `/${name}`).join(', ')}`,
    `${UI_TEXT.referenceCommands}: ${cliCommands()
      .map((entry) => entry.name)
      .join(', ')}`,
    `${UI_TEXT.referenceDocs}: ${REFERENCE_DOCS_URL}`,
    `${ACP_AGENT_NAME} help --all`,
  ].join('\n')
}
