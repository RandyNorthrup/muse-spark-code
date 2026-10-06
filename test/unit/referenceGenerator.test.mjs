import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildReference,
  generateReference,
  referenceSources,
  referenceMarkdown,
} from '../../scripts/lib/reference.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
const runtime = readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
const source = await referenceSources(root)
const build = (pkg = manifest, overrides = {}) =>
  buildReference(pkg, nls, { ...source, ...overrides }, runtime, readme)

describe('the code-derived reference gate', () => {
  it('covers both backend palettes, manifest metadata and all CLI routes', () => {
    const model = build()
    expect(model.commands).toHaveLength(manifest.contributes.commands.length)
    expect(model.settings).toHaveLength(
      Object.keys(manifest.contributes.configuration.properties).length,
    )
    expect(model.slash).toContainEqual(
      expect.objectContaining({ name: 'help', backends: ['museCode', 'modelApi'] }),
    )
    expect(model.shortcuts.slice(0, manifest.contributes.keybindings.length)).toEqual(
      manifest.contributes.keybindings,
    )
    expect(model.cli.map((c) => c.route)).toContain('authClear')
    expect(model.commands.find((c) => c.id === 'museSpark.signOut').canRun).toBe(false)
  })
  it('rejects a newly contributed command without a catalogue entry', () => {
    const pkg = globalThis.structuredClone(manifest)
    pkg.contributes.commands.push({ command: 'museSpark.undocumented', title: 'Undocumented' })
    expect(() => build(pkg)).toThrow('Command lacks catalogue entry: museSpark.undocumented')
  })
  it('rejects a setting without coverage or a description', () => {
    const pkg = globalThis.structuredClone(manifest)
    pkg.contributes.configuration.properties['museSpark.undocumented'] = {
      type: 'boolean',
      default: false,
    }
    expect(() => build(pkg)).toThrow('Missing description: museSpark.undocumented')
    pkg.contributes.configuration.properties['museSpark.undocumented'].description = 'Description'
    expect(() => build(pkg)).toThrow('No feature covers museSpark.undocumented')
  })
  it('rejects unknown feature links and empty descriptions', () => {
    const features = globalThis.structuredClone(source.featureCatalog())
    features[0].settings.push('museSpark.missing')
    expect(() => build(manifest, { featureCatalog: () => features })).toThrow(
      'Unknown feature setting',
    )
    features[0].commands.push('museSpark.missing')
    expect(() => build(manifest, { featureCatalog: () => features })).toThrow(
      'Unknown feature command',
    )
    expect(() =>
      build(manifest, {
        COMMAND_REFERENCE: {
          ...source.COMMAND_REFERENCE,
          openHelp: { description: { ui: 'missing' }, canRun: true },
        },
      }),
    ).toThrow('Missing description: museSpark.openHelp')
  })
  it('rejects a documentation anchor that does not exist', () => {
    const features = globalThis.structuredClone(source.featureCatalog())
    features[0].docs += '-missing'
    expect(() => build(manifest, { featureCatalog: () => features })).toThrow('Invalid docs link')
  })
  it('rejects a slash row without a description', () => {
    const slash = source.slashCommandsOf(
      source.buildPalette({
        models: [],
        effort: 'medium',
        permissionMode: 'manual',
        skills: [],
        backend: 'modelApi',
        paidFeatures: [],
        isKeyStored: true,
      }),
    )
    expect(() =>
      build(manifest, { slashCommandsOf: () => [...slash, { name: 'missing' }] }),
    ).toThrow('Missing description: missing')
  })
  it('rejects an undocumented CLI route', () => {
    expect(() =>
      buildReference(
        manifest,
        nls,
        source,
        runtime.replace(
          'export type RuntimeCommand =',
          "export type RuntimeCommand =\n | { readonly command:\n 'newRoute' }\n",
        ),
        readme,
      ),
    ).toThrow('CLI command lacks entry: newRoute')
  })
  it('checks all generated outputs byte-for-byte', async () => {
    await expect(generateReference(root, true)).resolves.toHaveProperty('features')
  })
})

const invalidTabLanguageSettings = (config, log) => {
  const value = config.get('tabLanguages')
  const actual = source.readSettings(config, log)
  return typeof value === 'object' && value !== null && value.typescript === 'invalid'
    ? { ...actual, tabLanguages: value }
    : actual
}

const feature = (id) => build().features.find((entry) => entry.id === id)
const setting = (suffix) => build().settings.find((entry) => entry.id === `museSpark.${suffix}`)
const commandText = (key) =>
  source.EN[build().commands.find((entry) => entry.id === `museSpark.${key}`).text.ui]

describe('RVHELPREF truth regressions', () => {
  it('R01 preserves backend-specific Plan and Auto safety limits', () => {
    const modes = setting('initialPermissionMode')
    expect(modes.enumDescriptions[2]).toContain(source.EN.permissionModeDetails.plan)
    expect(modes.enumDescriptions[2]).not.toContain('research only until')
    expect(modes.enumDescriptions[3]).toContain(source.EN.permissionModeDetails.auto)
  })
  it('R02 explains that Thinking changes requested reasoning effort', () => {
    expect(commandText('toggleThinking')).toContain('effort')
    expect(commandText('toggleThinking')).toContain('none')
    expect(commandText('toggleThinking')).toContain('minimal')
    expect(commandText('toggleThinking')).not.toContain('Show or hide')
  })
  it('R03 describes Setup init rather than Manual hooks', () => {
    expect(commandText('runSetupHooks')).toContain('Setup hooks for init')
    expect(commandText('runSetupHooks')).not.toContain('Manual')
  })
  it('R04 separates subscription review and controls from paid extras', () => {
    for (const id of ['cache', 'budget', 'auto-subscription']) expect(feature(id).paid).toBe(false)
    expect(feature('auto').paid).toBe(true)
    expect(feature('auto').surfaces).toEqual(['vscode:modelApi'])
  })
  it('R05 uses explicit paid host/backend pairs and distinct ledgers', () => {
    expect(feature('images').surfaces).toEqual([
      'vscode:museCode',
      'vscode:modelApi',
      'acp:modelApi',
    ])
    expect(feature('budget').surfaces).toEqual(['vscode:modelApi'])
    expect(source.EN.referencePaidContexts).toContain('ordinary ACP has no mandatory hard budget')
    expect(source.EN.referencePaidContexts).toContain('explicit opt-in')
    expect(feature('images').facts.configuredDefaults).toEqual({
      'museSpark.modelApiImageGeneration': true,
    })
  })
  it('R06 restricts panel workflows and settings to implementing hosts', () => {
    for (const id of [
      'shell',
      'imports',
      'git',
      'exports',
      'review',
      'plans',
      'goals',
      'handoff',
      'verify',
      'repo-map',
      'checkpoints',
      'rules',
      'tasks',
      'support',
      'account',
      'history',
      'context',
      'skills',
      'memory',
      'hooks',
      'permissions',
    ])
      expect(feature(id).surfaces.every((surface) => surface.startsWith('vscode:'))).toBe(true)
    expect(feature('acp').surfaces).toEqual(['acp:museCode', 'acp:modelApi'])
    expect(feature('acp').facts.operations).toEqual(
      expect.arrayContaining([
        'session/list',
        'session/load',
        'session/resume',
        'session/close',
        'session/set_mode',
        'session/set_config_option',
        'session/prompt',
        'session/cancel',
      ]),
    )
    expect(feature('acp').facts.configOptions).toEqual(source.ACP_CONFIG_IDS)
    expect(feature('acp').facts.clientRequests).toEqual([
      'session/request_permission',
      'elicitation/create',
    ])
    expect(feature('acp').facts.projectContext.modelApi.memory).toEqual(source.MEMORY_DIR_SEGMENTS)
  })
  it('R07 distinguishes CLI-owned MCP and skill management from Model API loading', () => {
    expect(commandText('mcpServers')).toContain('Muse Code runs its own servers')
    expect(commandText('mcpServers')).toContain('ACP Model API has no editor MCP servers')
    expect(source.EN.referenceSkills).toContain('museCode:')
    expect(source.EN.referenceSkills).toContain('modelApi: SKILL.md')
  })
  it('R08 documents paid candidates independently of the free session board', () => {
    expect(feature('session-board').paid).toBe(false)
    expect(source.EN.referenceBoardDetail).not.toContain('candidate')
    expect(feature('best-of-n')).toMatchObject({
      paid: true,
      surfaces: ['vscode:modelApi'],
      facts: { workspace: 'trusted', attempts: 'separate worktrees' },
    })
    expect(feature('best-of-n').settings).toEqual(['museSpark.modelApiBestOfN'])
    expect(feature('subagents').settings).not.toContain('museSpark.modelApiBestOfN')
  })
  it('R09 states Invoke by default and either chat backend for Tab', () => {
    expect(feature('tab').surfaces).toEqual(['vscode:museCode', 'vscode:modelApi'])
    expect(feature('tab').facts.trigger).toBe('onInvoke')
    expect(nls['config.modelApiTab.description']).toContain('default trigger is Invoke')
    expect(nls['config.modelApiTab.description']).toContain('either chat backend')
  })
  it('R10 records actual local voice availability, including zero-cap Model API refusal', () => {
    expect(feature('free-dictation').facts).toEqual({
      platforms: ['win32', 'darwin'],
      remote: false,
    })
    expect(feature('voice').facts.modelApi).toBe('unavailable')
    expect(feature('voice').facts.platforms).toEqual(['win32', 'darwin', 'linux'])
    expect(feature('voice').facts.remote).toBe(false)
    expect(feature('voice').facts.linuxRecorders).toEqual(['arecord', 'parec'])
    expect(source.EN.referenceVoice).toContain('Linux also needs arecord or parec')
    expect(feature('voice').surfaces).toEqual(['vscode:museCode'])
  })
  it('R11 inventories CLI flags, aliases, ranges and mutually exclusive sources', () => {
    const rows = build().cli
    for (const name of [
      '--max-budget-usd',
      '--out',
      '--untrusted-file',
      '--key-stdin',
      '--max-requests',
      '--timeout',
      '--maintenance',
      '-h',
      '-v',
    ])
      expect(rows.some((row) => row.name.includes(name))).toBe(true)
    expect(rows.find((row) => row.name.startsWith('exec: --web-search')).description).toBe(
      source.EN.execWebSearchUnbounded,
    )
    expect(
      rows.filter((row) => row.name.includes('--maintenance')).map((row) => row.route),
    ).toEqual(['setup'])
    expect(rows.find((row) => row.name.startsWith('exec: --max-requests')).contract).toMatchObject({
      default: 30,
      minimum: 1,
      maximum: 500,
    })
    expect(rows.find((row) => row.name.startsWith('exec: --timeout')).contract).toMatchObject({
      default: 1800,
      minimum: 10,
      maximum: 21_600,
    })
    expect(
      rows.find((row) => row.name.startsWith('exec: --max-budget-usd')).contract,
    ).toMatchObject({ exclusiveMinimum: 0, maximum: 20, required: 'modelApi' })
    expect(source.EN.referenceExecContract).toContain(source.EN.execStdinTwice)
    expect(rows.find((row) => row.name.startsWith('exec: --key-stdin')).description).toBe(
      source.EN.referenceKeyStdin,
    )
    expect(referenceMarkdown(build(), source, nls, manifest)).not.toContain('{command}')
    expect(rows.find((row) => row.name === 'serve: --trust-workspace').description).toContain(
      'Load the folder',
    )
    expect(rows.find((row) => row.name === 'serve: --trust-workspace').description).not.toContain(
      'Setup hooks',
    )
    expect(rows.find((row) => row.name === 'login: --trust-workspace').contract.purpose).toBe(
      'acceptedUnused',
    )
    expect(rows.find((row) => row.name === 'setup: --web-search').contract.purpose).toBe(
      'acceptedUnused',
    )
    expect(rows.find((row) => row.name === 'setup: --maintenance').contract.event).toBe(
      'maintenance',
    )
    expect(source.parseCommandLine(['exec', '--backend', 'modelApi', 'hello'])).toMatchObject({
      command: 'invalid',
      reason: source.EN.execBudgetRequired,
    })
  })
  it('R12 retains slash grammar and states the installed-skill limitation', () => {
    const slash = build().slash
    expect(slash.find((row) => row.name === 'goal').syntax).toContain('/goal pause')
    expect(slash.find((row) => row.name === 'review').syntax).toContain('/review branch [base]')
    expect(slash.find((row) => row.name === 'handoff').syntax).toContain('/handoff [goal]')
    expect(slash.find((row) => row.name === 'loop').syntax).toContain('/loop cancel <id>')
    expect(slash.find((row) => row.name === 'loop').syntax.join(' ')).not.toContain('10s')
    expect(source.parseLoopPrompt('/loop 5m prompt')?.command?.verb).toBe('create')
    expect(slash.find((row) => row.name === 'hook run').syntax).toContain('/hook run <name>')
    expect(source.EN.referenceAcp).toContain('static reference does not list them')
  })
  it('R13 explains attachments, agent workflows and conversation actions', () => {
    for (const id of [
      'attachments',
      'effort',
      'custom-agents',
      'native-agents',
      'native-search-cron',
      'conversation-actions',
      'code-output',
      'questions',
    ])
      expect(feature(id)).toBeDefined()
    expect(feature('attachments').facts.textBytes).toBe(1_048_576)
    expect(feature('effort').facts.default).toBe('high')
    expect(feature('effort').facts.tiers['muse-spark-1.3']).toContain('max')
    expect(feature('context').facts.meter).toEqual(['tokensUsed', 'contextWindow', 'pressure'])
    expect(feature('custom-agents').facts).toMatchObject({
      file: 'AGENT.md',
      project: ['.agents', 'agents'],
      builtIns: ['explore', 'second-opinion'],
    })
    expect(source.EN.referenceCustomAgents).toContain('tool allowlists narrow')
    expect(source.EN.referenceNativeAgents).toContain('workflow_trigger_mode')
    expect(source.EN.referenceNativeSearch).toContain('no MSP schedule controls')
    expect(feature('conversation-actions').facts.sideChat).toMatchObject({
      mode: 'plan',
      context: 'completed turns',
      goal: 'cleared',
    })
    expect(feature('conversation-actions').facts.rewind.restoreBoth).toBe(
      'checkpointFilesAndHistory',
    )
    expect(source.EN.referenceConversationActions).toContain(source.EN.forkFromHere)
    expect(source.EN.referenceConversationActions).toContain(source.EN.replyToOutput)
    expect(source.EN.referenceQuestions).toContain(source.EN.questionCancel)
    for (const detail of feature('questions').details)
      expect(source.EN[detail.ui]).not.toContain('{server}')
    expect(feature('questions').facts.elicitation).toBe('modelApi only')
    expect(feature('plans').details).toContainEqual({ ui: 'referencePlanModes' })
    expect(feature('exports').facts.sessionLog).toBe('museCode')
    expect(feature('imports').details).toContainEqual({ ui: 'referenceResumeAgents' })
    expect(feature('skills').facts.resumeSelectors).toEqual({
      claude: 'resume-claude',
      codex: 'resume-codex',
    })
    expect(feature('account').details).toContainEqual({ ui: 'referenceSecretPrompt' })
    expect(source.EN.referencePaidContexts).toContain('forget workspace paid-use grants')

    expect(feature('code-intelligence').facts.modelApi.hover).toBe('hover')
    expect(feature('code-intelligence').facts.museCode.repoMap).toBe('repoMap')
    expect(feature('skills').facts.bundled.modelApi).toContain('muse_gadgets')
    expect(feature('skills').facts.bundled.museCode).not.toContain('muse_gadgets')
    expect(source.EN.referenceResumeAgents).toContain('unfinished Claude Code')
    expect(source.EN.agentImportDetailEvery).toContain('Gemini CLI')
    expect(source.EN.referenceCodeOutput).toContain('selection')
    expect(feature('conversation-actions').facts.withdrawal.museCode).toContain(
      'queued messages only',
    )
    expect(feature('browser').facts.screenshot).toEqual({ modelApi: 'PNG', museCode: false })
  })
  it('R14 retains nested setting structures and runtime refinements', () => {
    expect(setting('modelApiCommandRules').schema.items.required).toEqual([
      'pattern',
      'decision',
      'match',
    ])
    expect(setting('checkCommands').schema.items.properties.timeoutSeconds).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 600,
      default: 300,
    })
    expect(setting('checkCommands').schema.maxItems).toBe(8)
    expect(setting('checkCommands').refinements).toContain('unique:name')
    expect(setting('tabLanguages').refinements).toContain('values:boolean')
    expect(setting('tabDailyBudgetUsd').schema).toMatchObject({ minimum: 0.05, maximum: 50 })
    expect(setting('environmentVariables').schema.items.required).toEqual(['name', 'value'])
  })
  it('R15 retains command menu conditions and component keyboard actions', () => {
    expect(
      build().commands.find((row) => row.id === 'museSpark.setUpSandbox').enablement,
    ).toContain('isWindows')
    for (const key of ['Ctrl+D', 'Shift+Tab', 'Delete', 'Shift+F10', 'Home', 'Shift+Enter'])
      expect(build().shortcuts.some((row) => row.key.includes(key))).toBe(true)
  })
  it('R18 rejects missing features, fabricated billing/hosts and new parser options', () => {
    const original = source.featureCatalog()
    expect(() =>
      build(manifest, { featureCatalog: () => original.filter((row) => row.id !== 'web-fetch') }),
    ).toThrow('Missing feature: web-fetch')
    expect(() =>
      build(manifest, {
        featureCatalog: () =>
          original.map((row) => (row.id === 'code-intelligence' ? { ...row, paid: true } : row)),
      }),
    ).toThrow('Paid claim mismatch: code-intelligence')
    expect(() =>
      build(manifest, {
        featureCatalog: () =>
          original.map((row) =>
            row.id === 'code-intelligence' ? { ...row, surfaces: ['acp:modelApi'] } : row,
          ),
      }),
    ).toThrow('Host capability mismatch: code-intelligence')
    expect(() =>
      buildReference(
        manifest,
        nls,
        source,
        runtime.replace(
          "backend: { type: 'string' },",
          "undocumented: { type: 'boolean' }, backend: { type: 'string' },",
        ),
        readme,
      ),
    ).toThrow('CLI option lacks contract: --undocumented')
  })
  it('R18 rejects source drift in defaults, scalar enums, actions, keyboards and adapters', () => {
    const pkg = globalThis.structuredClone(manifest)
    pkg.contributes.configuration.properties['museSpark.tabTrigger'].default = 'automatic'
    expect(() => build(pkg)).toThrow('Runtime default mismatch: museSpark.tabTrigger')
    pkg.contributes.configuration.properties['museSpark.tabTrigger'].default = 'onInvoke'
    pkg.contributes.configuration.properties['museSpark.tabTrigger'].enum.push('madeUp')
    expect(() => build(pkg)).toThrow('Runtime value mismatch: museSpark.tabTrigger')
    const evidence = { ...source.evidence }
    evidence['src/shared/protocol.ts'] = evidence['src/shared/protocol.ts'].replace(
      "type: z.literal('readReference')",
      "type: z.literal('undocumentedAction')",
    )
    expect(() => build(manifest, { evidence })).toThrow('Uncovered host action: undocumentedAction')
    evidence['src/shared/protocol.ts'] = source.evidence['src/shared/protocol.ts']
    evidence['src/webview/components/Header.tsx'] = evidence[
      'src/webview/components/Header.tsx'
    ].replace("event.key === 'Enter'", "event.key === 'F9'")
    expect(() => build(manifest, { evidence })).toThrow('Undocumented keyboard action')
    evidence['src/webview/components/Header.tsx'] =
      source.evidence['src/webview/components/Header.tsx']
    evidence['src/runtime/backends.ts'] = evidence['src/runtime/backends.ts'].replace(
      'webFetch: createWebFetcher',
      'webFetchRemoved: createWebFetcher',
    )
    expect(() => build(manifest, { evidence })).toThrow('Host capability witness changed')
  })
  it('R18 rejects numeric bounds that the runtime refuses', () => {
    const pkg = globalThis.structuredClone(manifest)
    pkg.contributes.configuration.properties['museSpark.tabDailyBudgetUsd'].minimum = 0.01
    expect(() => build(pkg)).toThrow('Runtime bound mismatch: museSpark.tabDailyBudgetUsd')
  })
  it('R18 rejects lost runtime refinements', () => {
    expect(() => build(manifest, { readSettings: invalidTabLanguageSettings })).toThrow(
      'Runtime refinement mismatch: values:boolean',
    )
  })
  it('R18 rejects an implemented tool without feature coverage', () => {
    expect(() =>
      build(manifest, {
        MODEL_API_TOOLS: { ...source.MODEL_API_TOOLS, undocumented: 'undocumented_tool' },
      }),
    ).toThrow('Uncovered model tool: undocumented_tool')
  })
  it('R18 rejects an undocumented direct CLI flag', () => {
    expect(() =>
      buildReference(
        manifest,
        nls,
        source,
        runtime.replace("argv[1] === '--all'", "argv[1] === '--undocumented'"),
        readme,
      ),
    ).toThrow('CLI direct flag lacks entry: --undocumented')
  })
  it('R19 records Help under Unreleased rather than a shipped release', () => {
    const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    expect(changelog.split('## [0.14.0]', 1)[0]).toContain('**Help & Reference.**')
    expect(changelog.split('## [0.14.0]', 2)[1]).not.toContain('**Help & Reference.**')
  })
  it('R23 describes specific setup, skill, browser and Tab command effects', () => {
    expect(commandText('setUpSandbox')).toContain('administrator approval')
    expect(commandText('installBundledSkills')).toContain('Copy project_setup')
    expect(commandText('removeBundledSkills')).toContain('links')
    expect(commandText('downloadBrowserCheckRuntime')).toContain('Chrome for Testing')
    expect(commandText('tabTurnOff')).toContain('modelApiTab=false')
    expect(commandText('tabTurnOn')).toContain('modelApiTab=true')
    expect(commandText('tabMenu')).toContain(source.EN.tabMenuMultiline)
    expect(commandText('tabLanguages')).toContain('switch Tab suggestions on or off')
  })
})
