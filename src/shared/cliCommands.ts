// Public runtime command table. The localized usage table owns descriptions.
import {
  ACP_AGENT_NAME,
  REFERENCE_DOCS_URL,
  UI_TEXT,
  SLASH_COMMAND_NAMES,
  REPORT_KINDS,
  SCHEDULE_EDITOR_DELIVERY_CERTIFICATION,
} from './constants'
import { COMPANION_VOICE_RELEASE } from './companionVoice'

export function cliCommands(shouldIncludeHeld = false) {
  // Executable examples enumerate deep help routes; the help regression walks
  // this same public table, including future commands, rather than a test list.
  const invocations: Readonly<Record<string, readonly (readonly string[])[]>> = {
    usage: ['summary', 'daily', 'models', 'limits', 'export', 'open', 'serve'].map((action) => [
      'usage',
      action,
    ]),
    legal: [['legal'], ['exec', 'legal-scan']],
    providersList: [['providers', 'list']],
    providersAdd: [['providers', 'add']],
    providersTest: [['providers', 'test']],
    providersRefresh: [['providers', 'refresh']],
    providersRemove: [['providers', 'remove']],
    providersHeaders: [['providers', 'headers']],
    // The bare form's own row (RLTESTDRIVE2 14): its invocation is the
    // command a person types, never the route's name.
    providersUsageTargets: [['providers', 'usage']],
    chatGptProvider: ['add', 'remove', 'status'].map((action) => ['providers', action, 'chatgpt']),
    grokProvider: ['add', 'remove', 'status'].map((action) => ['providers', action, 'grok']),
    serve: [[]],
    login: [['login']],
    setup: [['setup']],
    authSet: [['auth', 'set']],
    authClear: [['auth', 'clear']],
    authStatus: [['auth', 'status']],
    exec: [['exec']],
    'scan-secrets': [['scan-secrets']],
    schedule: [
      ...[
        'add',
        'list',
        'remove',
        'run-now',
        'pause',
        'resume',
        'fire',
        'timeline',
        'run-due',
        'background-maintain',
      ].map((action) => ['schedule', action]),
      ['schedule', 'background', 'off'],
      ['schedule', 'background', 'status'],
    ],
    accounts: ['list', 'add', 'remove', 'order', 'thresholds'].map((action) => [
      'providers',
      'accounts',
      action,
    ]),
    developer: ['status', 'enable', 'disable', 'reset', 'add', 'remove'].map((action) => [
      'developer',
      action,
    ]),
    playbook: ['status', 'record', 'settings', 'run'].map((action) => ['playbook', action]),
    estimate: [['estimate']],
    judgeSetup: [
      ['judge', 'scan'],
      ['judge', 'setup'],
      ['judge', 'remove'],
    ],
    report: [['report'], ['report', 'problem']],
    reports: [
      ...REPORT_KINDS.map((kind) => ['report', kind]),
      ['report', 'history'],
      ...REPORT_KINDS.map((kind) => ['report', 'history', kind]),
    ],
    fontsInstall: [['fonts', 'install']],
    help: [['help'], ['help', 'reference']],
    share: [['share', 'chat']],
    prompts: ['save', 'list', 'use', 'share'].map((action) => ['prompts', action]),
    resources: [
      ...['status', 'history', 'resume'].map((action) => ['resources', action]),
      ['usage', 'resources'],
    ],
    vault: [
      'status',
      'unlock',
      'lock',
      'list',
      'add',
      'remove',
      'grant',
      'revoke',
      'audit',
      'import',
      'public-key',
      'watch',
    ].map((action) => ['vault', action]),
    vaultHelp: [['vault']],
    node: [
      ['node'],
      ...['init', 'serve', 'status', 'stop', 'lock', 'unlock', 'wipe'].map((action) => [
        'node',
        action,
      ]),
    ],
    acp: [],
    version: [],
  }
  return [
    ...(shouldIncludeHeld || COMPANION_VOICE_RELEASE.isReady
      ? [
          {
            route: 'dictate',
            name: 'dictate [--muse-voice] [--trust-workspace]',
            description: UI_TEXT.companionVoiceReference,
            text: { ui: 'companionVoiceReference' },
          },
          {
            route: 'acp',
            name: '/dictate',
            description: UI_TEXT.companionVoiceReference,
            text: { ui: 'companionVoiceReference' },
          },
        ]
      : []),
    {
      route: 'judge',
      name: 'judge ask|calibrate|report|mcp|serve|lint',
      description: UI_TEXT.judgeCliDescription,
      text: { ui: 'judgeCliDescription' },
    },
    {
      route: 'judgeSetup',
      name: 'judge scan|setup|remove',
      description: UI_TEXT.referenceJudgeSetup,
      text: { ui: 'referenceJudgeSetup' },
    },
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
      route: 'openRouterConnect',
      name: 'providers connect openrouter',
      description: UI_TEXT.providerOpenRouterServices,
      text: { ui: 'providerOpenRouterServices' },
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
      route: 'providersRefresh',
      name: 'providers refresh <id>',
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
      route: 'providersHeaders',
      name: 'providers headers <id> [set|unset <name>]',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'providersModels',
      name: 'providers models <entry> [--add <model>] [--remove <model>] [--force <reason>]',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'providersUsage',
      name: 'providers usage <id> [--days <n>] [--output json]',
      description: UI_TEXT.referenceProvidersUsage,
      text: { ui: 'referenceProvidersUsage' },
    },
    {
      // Bare `providers usage` names the missing id and lists the configured
      // ids (RLTESTDRIVE2 14).
      route: 'providersUsageTargets',
      name: 'providers usage',
      description: UI_TEXT.referenceProvidersUsage,
      text: { ui: 'referenceProvidersUsage' },
    },
    {
      route: 'helpTopic',
      name: 'help <command>',
      description: UI_TEXT.referenceBriefHelp,
      text: { ui: 'referenceBriefHelp' },
    },
    {
      route: 'chatGptProvider',
      name: 'providers add|remove|status chatgpt [--new-account]',
      description: UI_TEXT.referenceProviders,
      text: { ui: 'referenceProviders' },
    },
    {
      route: 'grokProvider',
      name: 'providers add|remove|status grok [--device] [--client-id <id>] [--scopes <scopes>]',
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
      route: 'authGitHub',
      name: 'auth github login|logout|status',
      description: UI_TEXT.referenceAuthGitHub,
      text: { ui: 'referenceAuthGitHub' },
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
      route: 'schedule',
      name: 'schedule',
      description: UI_TEXT.scheduleV2.runtime.usage,
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
      route: 'estimate',
      name: 'estimate <goal> [--by <date>] [--fleet current|minimum|optimum] [--format md|html|json|text] [--seed <seed>]',
      description: UI_TEXT.estimateCliHelp,
      text: { ui: 'estimateCliHelp' },
    },
    {
      route: 'estimate',
      name: 'estimate --check-plan',
      description: UI_TEXT.referenceCliOptions['estimate-check-plan'],
      text: { cli: 'estimate-check-plan' },
    },
    {
      route: 'report',
      name: 'report',
      description: UI_TEXT.reportUsage,
      text: { ui: 'reportUsage' },
    },
    {
      route: 'report',
      name: 'report problem',
      description: UI_TEXT.reportUsage,
      text: { ui: 'reportUsage' },
    },
    {
      route: 'reports',
      name: 'report <kind> / report history',
      description: UI_TEXT.reportCliUsage,
      text: { ui: 'reportCliUsage' },
    },
    {
      route: 'playbook',
      name: 'playbook [status|record|settings|run <name>]',
      description: UI_TEXT.playbookCommandUsage,
      text: { ui: 'playbookCommandUsage' },
    },
    {
      route: 'fontsInstall',
      name: 'fonts install [--from <directory>]',
      description: UI_TEXT.acpFontsUsage,
      text: { ui: 'acpFontsUsage' },
    },
    {
      route: 'help',
      name: 'help reference / help --all',
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
      name: '/agents [receipt|continue|retry] [ID]',
      description: UI_TEXT.referenceAgentOutcomes,
      text: { ui: 'referenceAgentOutcomes' },
    },
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
      route: 'acp',
      name: '/whatsnew',
      description: UI_TEXT.paletteTips.whatsNew,
      text: { ui: 'whatsNewOpen' },
    },
    {
      route: 'resources',
      name: 'resources [status|history|resume] [--json]; usage resources [--json]',
      description: UI_TEXT.resourceGovernorDescription,
      text: { ui: 'resourceGovernorDescription' },
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
    {
      route: 'node',
      name: 'node <init|serve|status|stop|lock|unlock|wipe>',
      description: UI_TEXT.referenceNode,
      text: { ui: 'referenceNode' },
    },
  ].map((entry) => ({ ...entry, invocations: invocations[entry.route] ?? [[entry.route]] }))
}

/** ACP's available local commands and installed skills; panel commands live in the page. */
export function compactReference(skills: readonly string[]): string {
  return [
    UI_TEXT.helpReferenceTitle,
    UI_TEXT.referenceAcp.replaceAll(`/${SLASH_COMMAND_NAMES.help}`, () => SLASH_COMMAND_NAMES.help),
    `${UI_TEXT.groupSlashCommands}: ${[...new Set([SLASH_COMMAND_NAMES.help, ...skills])].map((name) => `/${name}`).join(', ')}`,
    `${UI_TEXT.referenceCommands}: ${cliCommands()
      .filter(
        (entry) =>
          (entry.route !== 'schedule' || SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady) &&
          !['estimate', 'vault', 'vaultHelp'].includes(entry.route),
      )
      .map((entry) => entry.name)
      .join(', ')}`,
    `${UI_TEXT.referenceDocs}: ${REFERENCE_DOCS_URL}`,
    `${ACP_AGENT_NAME} help --all`,
  ].join('\n')
}
