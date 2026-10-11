// Every current publication is checked; globbed files automatically join the matrix.
import * as acp from '@agentclientprotocol/sdk'
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import manifest from '../../package.json'
import { renderPackageReadme } from '../../scripts/check-badges.mjs'
import {
  contributedIds,
  parseChangelog,
  repositoryUrl,
} from '../../scripts/lib/whatsNewContent.mjs'
import {
  encodeWhatsNewContent,
  parseWhatsNewContent,
} from '../../src/core/whatsNew/whatsNewContent'
import { referenceModel as browserReference } from '../../src/shared/reference/reference.generated'
import { referenceModel as nodeReference } from '../../src/runtime/reference.node.generated'
import { featureCatalog, REFERENCE_IN_PROGRESS_FEATURES } from '../../src/shared/featureCatalog'
import { OPTIONAL_RUNTIME_AVAILABILITY, UI_TEXT } from '../../src/shared/constants'
import { buildPalette, slashCommandsOf } from '../../src/shared/paletteRegistry'
import type { PaletteContext } from '../../src/shared/palette'
import { EN } from '../../src/shared/l10n/en'
import { formatAcpUsage } from '../../src/runtime/cliOptions'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { FakeAgentHost } from './helpers/fakeAgent'
import { openHandshakeSession } from './helpers/acpWaits'
import { memoryPaidGrants } from './helpers/paidGrants'

const root = path.resolve(import.meta.dirname, '../..')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')
const glob = (pattern: string): string[] =>
  globSync(pattern, { cwd: root })
    .map((file) => file.replaceAll('\\', '/'))
    .toSorted((a, b) => a.localeCompare(b))
const strings = z.record(z.string(), z.string())
const packageTables = glob('package.nls*.json')
const uiTables = glob('l10n/ui.*.json')
const guides = glob('docs/*.md')
const walkthroughs = glob('resources/walkthrough/*.md')

// These settings preserve persisted values/defaults without an installed behavioral owner.
const compatibilitySettings = [
  'scheduleAgentCreation',
  'accountSwap',
  'accountParallel',
  'accounts.severalOnThisDevice',
  'vault.enabled',
  'vault.protection',
  'vault.lockAfterIdleMinutes',
  'vault.lockOnScreenLock',
  'estimator.optimize',
  'estimator.priceLookup',
  'modelApiTeamWorkers',
]
const compatibilityWording: Readonly<Record<string, RegExp>> = {
  en: /compatibility; no runtime effect/,
  cs: /kompatibilitě.*žádný účinek/,
  de: /Kompatibilität.*keine Wirkung/,
  es: /compatibilidad.*no tiene efecto/,
  fr: /compatibilité.*sans effet/,
  hu: /Kompatibilitási.*nincs hatással/,
  it: /compatibilità.*non ha effetto/,
  ja: /互換性.*効果がありません/,
  ko: /호환성.*효과가 없습니다/,
  pl: /zgodności.*nie ma wpływu/,
  'pt-br': /compatibilidade.*não tem efeito/,
  ru: /совместимости.*не действует/,
  tr: /Uyumluluk.*etkili değildir/,
  'zh-cn': /兼容性.*不起作用/,
  'zh-tw': /相容性.*不起作用/,
}
const activeWording: Readonly<Record<string, RegExp>> = {
  en: /management|drafts|note|notice|fence/,
  cs: /správě|návrhů|oznámení|příkazy/,
  de: /Zeitplanverwaltung|Zeitplanentwürfe|Hinweis|Shellbefehle/,
  es: /gestión|borradores|aviso|comandos/,
  fr: /gestion|brouillons|avis|commandes/,
  hu: /kezeléséhez|vázlatokba|értesítés|jelzi|shellparancsok/,
  it: /gestione|bozze|avviso|comandi/,
  ja: /管理|下書き|通知|コマンド/,
  ko: /관리|초안|알림|명령/,
  pl: /zarządzania|szkicach|komunikat|poleceń/,
  'pt-br': /gerenciamento|rascunhos|aviso|comandos/,
  ru: /управлению|черновики|уведомлени|команд/,
  tr: /yönetimine|taslaklarına|bildirim|bildirir|komutlarının/,
  'zh-cn': /管理|草稿|提示|通知|命令/,
  'zh-tw': /管理|草稿|提示|通知|命令/,
}
const claims: Readonly<Record<string, RegExp>> = {
  accounts:
    /List provider accounts|Manage the accounts of one provider|a vendor limit blocks only the affected account|several accounts on this device.*terms confirmation/i,
  previews: /streamed\s+argument previews|while arguments arrive|previews load on first use/i,
  estimator:
    /Capacity estimates \(preview\)|Real forecasts need the plan reader|the plan reader that\s+comes later/i,
  teams:
    /Configure role pools, task limits and worker|team tasks run on models billed|teams of workers in isolated worktrees/i,
  relocation: /relocation (?:is in progress|.*not available yet)|once relocation is available/i,
  compaction:
    /Automatically compact long Model API conversations|Automatic compaction\s+is implemented|production remains inactive\s+pending the paired evaluation/i,
  vault:
    /One encrypted vault per user|shared credential vault|broker-backed vault.*(?:opens|stores)/i,
  playbook:
    /the VS Code panel follows|shared editor unlocks use seven clicks|Muse Spark: Developer options/i,
}
const usage =
  /providers accounts|exec --account|--account-pool|--scheduled-prompts|--no-auto-compaction|exec --vault|\/schedule(?:\s|`)|\/estimate(?:\s|`)|\/vault(?:\s|`)/

function refuseUnavailable(): never {
  throw new Error('optional runtime owner unavailable')
}

async function discoveredCommands(
  isAvailable = false,
  shouldVerify = true,
): Promise<{ discovery: string; invocation: string; check: () => void }> {
  const host = new FakeAgentHost()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const refused = refuseUnavailable
  const scheduleRun = vi.fn().mockResolvedValue('schedule result')
  const estimateRun = vi.fn().mockResolvedValue('estimate result')
  const holdWorkspace = vi.fn().mockResolvedValue(() => Promise.resolve())
  const answers: string[] = []
  const agent = createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    questions: 'decline',
    version: 'truth-test',
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: 'manual',
      scheduleAuthorization: { scheduledPrompts: false },
    },
    signIn: { id: 'test', name: 'Test', description: 'Test', command: 'test', args: [] },
    defaultCwd: root,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    schedules: { isAvailable, run: scheduleRun, holdWorkspace },
    estimate: { isAvailable, run: estimateRun },
    playbookFor: refused,
    log,
  })
  const commands: acp.AvailableCommand[] = []
  const client = acp
    .client({ name: 'truth-editor' })
    .onNotification('session/update', ({ params }) => {
      if (params.update.sessionUpdate === 'available_commands_update')
        commands.push(...params.update.availableCommands)
      if (
        params.update.sessionUpdate === 'agent_message_chunk' &&
        params.update.content.type === 'text'
      )
        answers.push(params.update.content.text)
    })
  await client.connectWith(agent, async (connection) => {
    const { sessionId } = await openHandshakeSession(connection, root)
    const session = host.sessions[0]
    if (session === undefined) throw new Error('missing session')
    session.skills = [
      {
        selector: 'schedule',
        displayName: 'Workspace schedule',
        description: 'workspace skill',
        argumentHint: undefined,
      },
      {
        selector: 'estimate',
        displayName: 'Workspace estimate',
        description: 'workspace skill',
        argumentHint: undefined,
      },
      {
        selector: 'loop',
        displayName: 'Loop',
        description: 'Run the saved prompt manually',
        argumentHint: 'prompt',
      },
    ]
    await connection.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: '/help' }],
    })
    for (const text of ['/schedule', '/schedule add {}', '/estimate goal'])
      await connection.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
    expect(session.sendTurn).not.toHaveBeenCalled()
  })
  const check = (): void => {
    expect(commands.map((command) => command.name)).toEqual(
      expect.arrayContaining(['compact', 'report', 'playbook', 'loop']),
    )
    const names = new Set(commands.map((command) => command.name))
    expect(names.has('schedule')).toBe(isAvailable)
    expect(names.has('estimate')).toBe(isAvailable)
    expect(commands.filter((command) => command.description === 'workspace skill')).toEqual([])
    if (isAvailable) {
      expect(scheduleRun).toHaveBeenCalledTimes(2)
      expect(estimateRun).toHaveBeenCalledOnce()
    } else {
      expect(scheduleRun).not.toHaveBeenCalled()
      expect(estimateRun).not.toHaveBeenCalled()
      expect(holdWorkspace).not.toHaveBeenCalled()
      expect(
        answers.filter((answer) => answer === UI_TEXT.scheduleV2.runtime.unavailable),
      ).toHaveLength(2)
      expect(
        answers.filter((answer) => answer === UI_TEXT.estimateRuntimeUnavailable),
      ).toHaveLength(1)
    }
  }
  if (shouldVerify) check()
  return { discovery: JSON.stringify(commands), invocation: JSON.stringify(answers), check }
}

const releases = parseChangelog(
  read('CHANGELOG.md'),
  contributedIds(manifest),
  repositoryUrl(manifest),
)
const encoded = encodeWhatsNewContent(JSON.stringify({ schema: 1, releases: releases.slice(0, 2) }))
const surfaces = [
  { name: 'README.md', text: read('README.md'), instructions: true },
  ...guides.map((file) => ({ name: file, text: read(file), instructions: true })),
  {
    name: 'rendered VSIX README',
    text: renderPackageReadme(read('docs/marketplace-readme.md'), manifest.version),
    instructions: true,
  },
  {
    name: 'encoded current What’s New',
    text: JSON.stringify(parseWhatsNewContent(encoded)),
    instructions: true,
  },
  { name: 'generated browser Help', text: JSON.stringify(browserReference()), instructions: true },
  { name: 'generated Node Help', text: JSON.stringify(nodeReference()), instructions: true },
  { name: 'compact CLI help', text: formatAcpUsage(EN, 'muse-spark-code-acp'), instructions: true },
  { name: 'ACP available_commands_update', text: '', instructions: true },
  { name: 'ACP dormant invocation', text: '', instructions: true },
  {
    name: 'first-turn inactive-compaction notice',
    text: EN.autoCompactionAwaitingEvaluation,
    instructions: true,
  },
  { name: 'chat palette and completions', text: '', instructions: true },
  { name: 'package.json', text: JSON.stringify(manifest), instructions: false },
  ...packageTables.map((file) => ({ name: file, text: read(file), instructions: false })),
  ...walkthroughs.map((file) => ({ name: file, text: read(file), instructions: true })),
  { name: 'English UI table', text: JSON.stringify(EN), instructions: false },
  ...uiTables.map((file) => ({ name: file, text: read(file), instructions: false })),
]

const runtimeObservation: { checkUnavailable?: () => void } = {}

beforeAll(async () => {
  const discovery = surfaces.find((surface) => surface.name === 'ACP available_commands_update')
  if (discovery === undefined) throw new Error('discovery surface omitted')
  const result = await discoveredCommands(false, false)
  runtimeObservation.checkUnavailable = result.check
  discovery.text = result.discovery
  const invocation = surfaces.find((surface) => surface.name === 'ACP dormant invocation')
  const palette = surfaces.find((surface) => surface.name === 'chat palette and completions')
  if (invocation === undefined || palette === undefined) throw new Error('runtime surface omitted')
  invocation.text = result.invocation
  const context: PaletteContext = {
    arePromptCommandsBound: true,
    currentModel: undefined,
    models: [],
    effort: 'medium',
    isThinkingEnabled: false,
    permissionMode: 'manual',
    isFocusView: false,
    useCtrlEnterToSend: false,
    usage: undefined,
    backend: 'modelApi',
    paidFeatures: [],
    isKeyStored: false,
    estimateAvailable: OPTIONAL_RUNTIME_AVAILABILITY.estimator,
    ...(OPTIONAL_RUNTIME_AVAILABILITY.schedules && {
      schedules: {
        create: { type: 'openScheduleEditor' },
        list: { type: 'openScheduleList' },
        timeline: { type: 'openScheduleTimeline' },
      },
    }),
    skills: ['schedule', 'estimate', 'loop'].map((selector) => ({
      selector,
      displayName: selector,
      description: selector,
    })),
  }
  const groups = buildPalette(context)
  const commands = slashCommandsOf(groups)
  expect(commands.map((command) => command.name)).toContain('loop')
  for (const name of ['schedule', 'estimate'])
    expect(commands.map((command) => command.name)).not.toContain(name)
  palette.text = JSON.stringify({ groups, commands })
})

describe('CX1R5: exhaustive current-publication truth matrix', () => {
  it('enumerates every guide, manifest translation, walkthrough and UI table by glob', () => {
    const discovered = [
      ...glob('docs/*.md'),
      ...glob('package.nls*.json'),
      ...glob('resources/**/*.md'),
      ...glob('l10n/ui.*.json'),
    ].toSorted((a, b) => a.localeCompare(b))
    expect(
      surfaces
        .filter((surface) => discovered.includes(surface.name))
        .map((surface) => surface.name)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(discovered)
    expect(packageTables).toHaveLength(15)
    expect(uiTables).toHaveLength(14)
  })

  it.each(surfaces)('$name publishes no dormant claim or offering', (surface) => {
    for (const [feature, marker] of Object.entries(claims))
      expect(surface.text, feature).not.toMatch(marker)
    if (surface.instructions) expect(surface.text).not.toMatch(usage)
    if (!packageTables.includes(surface.name)) return
    const table = strings.parse(JSON.parse(surface.text))
    const locale = /^package\.nls\.(.+)\.json$/.exec(surface.name)?.[1] ?? 'en'
    const marker = compatibilityWording[locale]
    expect(marker, `missing locale coverage: ${locale}`).toBeDefined()
    if (marker === undefined) throw new Error('missing compatibility translation')
    for (const key of [
      'config.schedules.description',
      'config.schedules.defaultDelivery.description',
      'config.resourceRelocate.description',
      'config.resourceRelocate.enumDescriptions.paired',
      'config.resourceRelocate.enumDescriptions.ask',
      'config.resourceRelocate.enumDescriptions.off',
      'config.modelApiAutoCompaction.description',
      'config.vault.agentFence.description',
    ]) {
      expect(table[key], key).not.toMatch(marker)
      if (key === 'config.schedules.description') {
        expect(table[key], key).toContain('/loop')
        expect(table[key], key).toMatch(/Muse[- ]Code/)
      } else expect(table[key], key).toMatch(activeWording[locale] ?? /missing locale/)
    }
    if (locale === 'en') {
      expect(table['config.schedules.description']).toContain('Controls the legacy /loop shortcut')
      expect(table['config.schedules.defaultDelivery.description']).toContain('new schedule drafts')
      expect(table['config.resourceRelocate.description']).toContain('missing-route note')
      expect(table['config.modelApiAutoCompaction.description']).toContain('first-turn notice')
      expect(table['config.vault.agentFence.description']).toContain(
        'interactive Model API shell commands',
      )
    }
    for (const name of compatibilitySettings) {
      const entry = manifest.contributes.configuration.properties
      const property = z
        .looseObject({
          description: z.string(),
          deprecationMessage: z.string(),
          enumDescriptions: z.optional(z.array(z.string())),
        })
        .parse(Reflect.get(entry, `museSpark.${name}`))
      expect(property.deprecationMessage).toBe(property.description)
      for (const key of [property.description, ...(property.enumDescriptions ?? [])])
        expect(table[key.replaceAll('%', '')], name).toMatch(marker)
    }
  })

  it('refuses unavailable owners and excludes reserved workspace schedule skills from discovery and Help', () => {
    if (runtimeObservation.checkUnavailable === undefined)
      throw new Error('missing runtime observation')
    runtimeObservation.checkUnavailable()
  })

  it('publishes built-in schedule discovery only for a bound runtime, with no workspace collision', async () => {
    await discoveredCommands(true)
  })

  it('retains the configured-default policy and working enhancement controls', () => {
    for (const model of [browserReference(), nodeReference()])
      for (const id of [
        'museSpark.schedules',
        'museSpark.scheduleDefaultDelivery',
        'museSpark.resourceRelocate',
        'museSpark.modelApiAutoCompaction',
        'museSpark.vault.agentFence',
      ])
        expect(
          model.settings.some((setting) => setting.id === id),
          id,
        ).toBe(true)
    for (const name of [
      'modelApiStrictTools',
      'modelApiParallelReads',
      'modelApiTeamWorkers',
      'modelApiAutoCompaction',
      'accountSwap',
      'accountParallel',
      'schedules',
    ]) {
      expect(
        Reflect.get(manifest.contributes.configuration.properties, `museSpark.${name}`),
      ).toMatchObject({ default: true, scope: 'machine' })
    }
    for (const command of [
      'schedulePrompt',
      'showSchedules',
      'showScheduleTimeline',
      'vault',
      'lockVault',
      'estimate',
    ])
      expect(manifest.contributes.menus.commandPalette).toContainEqual({
        command: `museSpark.${command}`,
        when: 'false',
      })
    expect(read('src/runtime/main.ts')).toMatch(/schedules: \{\s+isAvailable: false/)
    expect(read('src/runtime/main.ts')).not.toContain('vault: acpVault')
    for (const id of REFERENCE_IN_PROGRESS_FEATURES)
      expect(featureCatalog().find((feature) => feature.id === id)?.surfaces).toEqual([])
  })

  it('keeps working facts and terminal developer instructions while removing product stubs', () => {
    for (const file of ['README.md', 'docs/marketplace-readme.md']) {
      const text = read(file)
      expect(text).toMatch(/Strict tool contracts|strict tool/i)
      expect(text).toMatch(/cache-stable/)
      expect(text).toMatch(/\/report/)
    }
    const readme = read('README.md')
    expect(readme).toContain('muse-spark-code-acp developer')
    for (const heading of [
      'Several accounts per provider',
      'Streamed argument previews',
      'Estimates',
      'The vault',
    ])
      expect(readme).not.toContain(`## ${heading}`)
    expect(readme).toContain('## In progress')
    expect(
      JSON.stringify(releases.find((release) => release.version === '0.17.0')?.sections),
    ).not.toMatch(/providers accounts|--account|accountSwap/)
    expect(JSON.stringify(parseWhatsNewContent(encoded))).not.toMatch(/several-account storage/)
    expect(read('CHANGELOG.md')).toMatch(/Several accounts per provider, credential vault/)
  })
})
