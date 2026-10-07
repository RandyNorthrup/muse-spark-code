import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { fakeModelApi } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memorySessionStore } from './helpers/fakeSessionStore'
import {
  buildReference,
  generateReference,
  referenceSources,
  referenceMarkdown,
  lintReferenceDescription,
  lintReferenceFacts,
} from '../../scripts/lib/reference.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nls = JSON.parse(readFileSync(path.join(root, 'package.nls.json'), 'utf8'))
const runtime = readFileSync(path.join(root, 'src/runtime/cliArgs.ts'), 'utf8')
const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
const source = await referenceSources(root)
const baseline = { model: undefined }
beforeAll(async () => {
  baseline.model = await generateReference(root, true)
})
const build = (pkg = manifest, overrides = {}) =>
  pkg === manifest && Object.keys(overrides).length === 0
    ? baseline.model
    : buildReference(pkg, nls, { ...source, ...overrides }, runtime, readme)

describe('the code-derived reference gate', () => {
  it('shares the unchanged reference between lookups', () => {
    expect(build()).toBe(baseline.model)
    expect(build()).toBe(build())
  })
  it('rechecks registry membership after caching unchanged keyboard source', () => {
    const bindings = { ...source.WEBVIEW_KEYBINDINGS }
    delete bindings['composer.dictation']
    expect(() => build(manifest, { WEBVIEW_KEYBINDINGS: bindings })).toThrow(
      'Unknown keyboard context: src/webview/components/Composer.tsx',
    )
  })
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
  it('checks all generated outputs byte-for-byte in the shared setup', () => {
    expect(build()).toHaveProperty('features')
  })
  it('accepts Windows evidence paths and still rejects a keyboard registry bypass', () => {
    const evidence = Object.fromEntries(
      Object.entries(source.evidence).map(([file, text]) => [
        path.win32.join(...file.split('/')),
        text,
      ]),
    )
    expect(build(manifest, { evidence })).toEqual(build())
    const composer = path.win32.join('src', 'webview', 'components', 'Composer.tsx')
    evidence[composer] = evidence[composer].replace(
      "webviewKey('composer.dictation', event)",
      'event.key',
    )
    expect(() => build(manifest, { evidence })).toThrow(
      'Keyboard dispatch bypasses registry: src/webview/components/Composer.tsx',
    )
  })
  it('accepts Windows recursive directory entries for the Composer IME check', () => {
    const evidence = Object.fromEntries(
      Object.entries(source.evidence).map(([file, text]) => [
        file.startsWith('src/webview/')
          ? `src/webview/${path.win32.join(...file.slice('src/webview/'.length).split('/'))}`
          : file,
        text,
      ]),
    )
    expect(build(manifest, { evidence })).toEqual(build())
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
const commandText = (key) => {
  const model = build()
  return source.referenceText(
    model.commands.find((entry) => entry.id === `museSpark.${key}`).text,
    model,
    nls,
    source.EN,
  )
}

describe('RVHELPREF truth regressions', () => {
  it('RVHELPREF4 P1 derives the Best-of-N budget prerequisite from production admission', async () => {
    const manager = new ModelApiBackendManager(
      fakeManagerDeps(fakeModelApi(), new FakeLogOutputChannel(), {
        workspaceRoot: '/reference-budget',
        bundlePath: 'src/host/backend/modelApiEntry.ts',
        loadBundle: () => modelApiEntry,
        store: memorySessionStore(),
        sessionBudgetUsd: () => 0.1,
      }),
    )
    const admit = vi.fn()
    let attempt
    try {
      await expect(manager.bestOfNBudgetScope()).rejects.toMatchObject({
        refusal: 'budgetUnavailable',
      })
      await expect(manager.buildAttemptHost('/reference-budget/candidate', admit)).rejects.toThrow(
        source.EN.bestOfNBudgetUnavailable,
      )
      const host = await manager.ensureHost()
      const parent = await host.startSession({
        workspaceRoot: '/reference-budget',
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      const scope = await manager.bestOfNBudgetScope(parent.sessionId)
      expect(scope).toMatchObject({ sessionId: parent.sessionId })
      attempt = await manager.buildAttemptHost(
        '/reference-budget/candidate',
        admit,
        undefined,
        scope,
      )
      const model = build()
      const row = model.features.find((entry) => entry.id === 'best-of-n')
      const requirements = row.details.find((ref) =>
        ref.conditions?.some(({ when }) => when === 'bestOfNAdmission'),
      )
      const actual = source.referenceText(requirements, model, nls, source.EN)
      // The same finite cap refuses without a scope and admits with it above.
      const prerequisite =
        'A finite session budget requires an owned parent budget scope shared by candidates.'
      expect(actual).toContain(prerequisite)
      expect(referenceMarkdown(model, source, nls, manifest)).toContain(prerequisite)
    } finally {
      await attempt?.close()
      await manager.dispose()
    }
  })
  it('C01 describes every Auto reviewer and its no-card approval path', () => {
    const auto = setting('initialPermissionMode').enumDescriptions[3]
    const limits = source.EN.referencePermissionLimits
    for (const backend of ['museCode', 'modelApi']) {
      expect(
        manifest.contributes.configuration.properties[`museSpark.${backend}AutoReviewer`].default,
      ).toBe(true)
      for (const isOn of [false, true]) {
        const detail = source.permissionModeDetail('auto', backend, { [backend]: isOn })
        expect(auto).toContain(detail)
        expect(limits).toContain(detail)
      }
      expect(auto).toContain(`museSpark.${backend}AutoReviewer`)
    }
    expect(auto).toContain('paid consent')
    // ModelApiHost approval(), autoReview(): admission/consent precede ALLOW;
    // ALLOW returns before constructing the user's approvalRequested card.
    const host = readFileSync(path.join(root, 'src/core/backends/modelapi/ModelApiHost.ts'), 'utf8')
    const allow = host.indexOf("if (review?.decision === 'allow' && judgement.isReviewable)")
    const card = host.indexOf(
      "const request: Extract<AgentEvent, { type: 'approvalRequested' }>",
      allow,
    )
    expect(allow).toBeGreaterThan(0)
    expect(card).toBeGreaterThan(allow)
    expect(host.slice(allow, card)).toContain('return { isApproved: true, feedback: undefined }')
    expect(host).toContain("this.deps.isPaidFeatureOn('autoReviewer')")
    expect(host).toMatch(/feature: 'autoReviewer',\s+modelId,\s+tool: call.name,\s+action,/)
    // Muse Code: controller isReviewerApproval() gates the reviewer;
    // ReviewedApprovals.judge()/allow() answers the captured allow-once choice.
    expect(
      source.evidence['src/host/conversation/conversationController.ts'] ??
        readFileSync(path.join(root, 'src/host/conversation/conversationController.ts'), 'utf8'),
    ).toContain('port.isOn()')
    const reviewed = readFileSync(path.join(root, 'src/host/review/reviewedApprovals.ts'), 'utf8')
    expect(reviewed).toContain('await this.allow(hold.session, held.event, outcome.reason)')
    expect(reviewed).toContain('await session.decideApproval(')
    expect(reviewed).toContain('const choice = allowOnceChoice(event)')
  })
  it('C02 separates model questions from server-only MCP form answers', () => {
    const questions = feature('questions')
    const elicitation = feature('mcp-elicitation')
    expect(source.EN[questions.summary.ui]).toContain('Muse receives')
    expect(source.EN[questions.summary.ui]).not.toContain('not to Muse')
    expect(source.EN[elicitation.summary.ui]).toContain('requesting MCP server')
    expect(source.EN[elicitation.summary.ui]).toContain('later tool output')
    expect(questions.facts).not.toHaveProperty('elicitation')
    expect(elicitation.surfaces).toEqual(['vscode:modelApi'])
    // ModelApiHost.questionResultText()/runAskUser()/completeTool(): ordinary
    // answers and clarifications are returned as replayed function_call_output.
    const host = readFileSync(path.join(root, 'src/core/backends/modelapi/ModelApiHost.ts'), 'utf8')
    expect(host).toContain('JSON.stringify(reply.answers)')
    expect(host).toContain('text = questionResultText(reply)')
    expect(host).toContain('return { output: text, visibleOutput: text }')
    expect(host).toContain("type: 'function_call_output'")
    expect(host).toContain('output: outcome.outputParts ?? outcome.output')
    // runElicitation(): the server result owns the form values. Settled events
    // and hooks carry field names/action only, as the transport suite verifies.
    expect(host).toContain(
      "Values are validated against the\n   * server's schema and reach only the server's own result",
    )
    expect(host).toContain('fieldNames: [...fieldNames]')
  })
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
    expect(source.EN.referencePaidContexts).toContain('runtime daily budget')
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
      facts: { workspace: 'trusted', attempts: 'separateWorktrees' },
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
      source.EN.referenceExecContract,
    )
    expect(
      rows
        .filter((row) => row.name.includes('--maintenance') && row.contract.refused !== true)
        .map((row) => row.route),
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
      context: 'completedTurns',
      goal: 'cleared',
    })
    expect(feature('conversation-actions').facts.rewind.restoreBoth).toBe(
      'checkpointFilesAndHistory',
    )
    expect(source.EN.referenceConversationActions).toContain('fork or rewind')
    expect(source.EN.referenceConversationActions).toContain('Select transcript text to reply')
    expect(source.EN.referenceQuestions).toContain(source.EN.questionCancel)
    for (const detail of feature('questions').details)
      expect(source.EN[detail.ui]).not.toContain('{server}')
    expect(feature('mcp-elicitation').facts.answers).toBe('requestingServer')
    expect(feature('plans').details).toContainEqual({ ui: 'referencePlanModes' })
    expect(feature('exports').facts.sessionLog).toBe('museCode')
    expect(feature('imports').details).toContainEqual({ ui: 'referenceResumeAgents' })
    expect(feature('skills').facts.resumeSelectors).toEqual({
      claude: 'resume-claude',
      codex: 'resume-codex',
    })
    expect(feature('account').details).toContainEqual(
      source.referenceDescription({ ui: 'referenceSecretPrompt' }),
    )
    expect(source.EN.referencePaidContexts).toContain('forget workspace paid-use grants')

    expect(feature('code-intelligence').facts.modelApi.hover).toBe('hover')
    expect(feature('code-intelligence').facts.museCode.repoMap).toBe('repoMap')
    expect(feature('skills').facts.bundled.modelApi).toContain('muse_gadgets')
    expect(feature('skills').facts.bundled.museCode).not.toContain('muse_gadgets')
    expect(source.EN.referenceResumeAgents).toContain('unfinished Claude Code')
    expect(source.EN.agentImportDetailEvery).toContain('Gemini CLI')
    expect(source.EN.referenceCodeOutput).toContain('selection')
    expect(feature('conversation-actions').facts.withdrawal.museCode).toContain('queuedOnly')
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
      build(manifest, {
        CLI_OPTION_REGISTRY: {
          ...source.CLI_OPTION_REGISTRY,
          serve: {
            options: {
              ...source.CLI_OPTION_REGISTRY.serve.options,
              undocumented: { type: 'boolean' },
            },
          },
        },
      }),
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
    ].replace("webviewKey('header.rename', event) === 'accept'", "event.key === 'F9'")
    expect(() => build(manifest, { evidence })).toThrow('Keyboard dispatch bypasses registry')
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

describe('RVHELPREF2 runtime truth regressions', () => {
  const stateClaims = (() => {
    const predicates = ['is', 'are', 'was', 'becomes']
    const states = [
      'available',
      'unavailable',
      'enabled',
      'disabled',
      'on',
      'off',
      'active',
      'inactive',
      'running',
      'connected',
      'disconnected',
      'signed in',
      'installed',
      'configured',
    ]
    return [
      'Delegation is available in this conversation.',
      'A future feature is on.',
      'It works right now.',
      ...predicates.flatMap((predicate) =>
        states.map((state) => `A future feature ${predicate} ${state}.`),
      ),
    ]
  })()
  it.each(stateClaims)(
    'RVHELPREF4 P2-1 rejects the closed state vocabulary at the generator boundary: %s',
    (claim) => {
      const changed = { ...source, EN: { ...source.EN, referenceNativeAgents: claim } }
      expect(
        () => referenceMarkdown(build(manifest, changed), changed, nls, manifest),
        claim,
      ).toThrow('Catalogue asserts conditional state: native-agents')
    },
  )
  it('RVHELPREF4 P2-1 renders a neutral description', () => {
    const neutral = {
      ...source,
      EN: { ...source.EN, referenceNativeAgents: 'Use agent controls to delegate work.' },
    }
    expect(referenceMarkdown(build(manifest, neutral), neutral, nls, manifest)).toContain(
      neutral.EN.referenceNativeAgents,
    )
  })
  it('RVHELPREF4 P2-2 walks emitted shortcut descriptions and future nested rows', () => {
    for (const claim of ['Modal navigation is on.', 'Currently the modal is disabled.']) {
      const changed = { ...source, EN: { ...source.EN, referenceModalKeys: claim } }
      expect(
        () => referenceMarkdown(build(manifest, changed), changed, nls, manifest),
        claim,
      ).toThrow('Catalogue asserts conditional state: modal.focus')
    }
    const claim = 'A future feature is on.'
    expect(() =>
      referenceMarkdown(
        build(manifest, {
          referenceKeyboardActions: () =>
            source.referenceKeyboardActions().map((row) => ({
              ...row,
              futureKind: { description: claim },
            })),
        }),
        source,
        nls,
        manifest,
      ),
    ).toThrow('Catalogue asserts conditional state')
    const neutral = {
      ...source,
      EN: { ...source.EN, referenceModalKeys: 'Move focus within the dialog.' },
    }
    expect(referenceMarkdown(build(manifest, neutral), neutral, nls, manifest)).toContain(
      neutral.EN.referenceModalKeys,
    )
  })
  it('C06 rejects new conditional sentences in plain descriptions and renders typed conditions', () => {
    const claims = [
      'Delegation is enabled in this conversation.',
      'Delegation is "enabled" in this conversation.',
      'Delegation is `enabled` in this conversation.',
      'The new feature is disabled.',
      'A future feature is on.',
      'A future feature is off.',
      'Currently the tool runs freely.',
      'When delegation is available, it runs freely.',
    ]
    for (const claim of claims) {
      expect(lintReferenceDescription(claim, 'new-condition'), claim).toHaveLength(1)
      expect(() =>
        build(manifest, {
          EN: {
            ...source.EN,
            referenceNativeAgents: `${source.EN.referenceNativeAgents} ${claim}`,
          },
        }),
      ).toThrow('Catalogue asserts conditional state: native-agents')
    }
    const native = feature('native-agents')
    const condition = native.details.find((ref) => 'conditions' in ref)
    expect(condition.conditions).toEqual([
      { when: 'run.subagent_delegation_mode', text: { ui: 'referenceNativeAgentsConditions' } },
    ])
    const model = build()
    const rendered = source.referenceText(condition, model, nls, source.EN)
    expect(rendered).toContain('run.subagent_delegation_mode: When')
    expect(referenceMarkdown(model, source, nls, manifest)).toContain(rendered)
    const invalid = source
      .featureCatalog()
      .map((row) => (row.id === 'native-agents' ? { ...row, details: [{ conditions: [] }] } : row))
    expect(() => build(manifest, { featureCatalog: () => invalid })).toThrow(
      'Empty catalogue conditions',
    )
  })
  it('C07 describes hook sources on both backends and the scanner operation', () => {
    expect(source.EN.hooksItemDetail).toContain('selected backend')
    expect(source.EN.paletteTips.hooks).toBe(source.EN.hooksItemDetail)
    const hooks = readFileSync(path.join(root, 'src/host/commands/museConfigCommands.ts'), 'utf8')
    expect(hooks).toContain(
      'deps.modelApiHooks === undefined ? UI_TEXT.hooksTitle : UI_TEXT.hooksTitleModelApi',
    )
    expect(hooks).toContain('const sparkProject = sparkItem')
    const scanner = build().cli.find(
      (row) => row.route === 'scan-secrets' && row.name === 'scan-secrets',
    )
    expect(scanner.text).toEqual({ ui: 'referenceScanSecrets' })
    expect(scanner.description).toContain('UTF-8 patch file')
    expect(scanner.description).toContain('fail on detection')
    const scan = readFileSync(path.join(root, 'src/runtime/exec/scanSecrets.ts'), 'utf8')
    expect(scan).toContain("new TextDecoder('utf-8', { fatal: true })")
    expect(scan).toContain('countSecretMatches(text, held.key === undefined ? [] : [held.key])')
    expect(scan).toContain('return count === 0 ? EXEC_EXIT.ok : EXEC_SCAN_EXIT_FOUND')
    expect(scan).toContain('held.key = undefined')
  })
  it('C04 preserves every argument slot when Markdown prose is parsed', () => {
    const model = globalThis.structuredClone(build())
    const prose = { ui: 'referenceCodeOutput' }
    const entry = model.features[0]
    entry.name = entry.summary = entry.description = prose
    entry.details = [prose]
    model.commands[0].name =
      model.commands[0].category =
      model.commands[0].description =
        '<command-slot>'
    model.settings[0].description = '<setting-slot>'
    delete model.settings[0].text
    model.settings[0].enumDescriptions = ['<enum-slot>']
    model.shortcuts[0].text = prose
    model.cli[0].description = '<cli-slot>'
    const markdown = referenceMarkdown(
      model,
      { ...source, EN: { ...source.EN, referenceCodeOutput: '<feature-slot>' } },
      nls,
      manifest,
    )
    const nodes = []
    const visit = (node) => {
      nodes.push(node)
      const children = node.children ?? []
      for (const child of children) visit(child)
    }
    visit(fromMarkdown(markdown))
    expect(nodes.filter((node) => node.type === 'html' && /<[^!]/.test(node.value))).toEqual([])
    const rendered = nodes
      .filter((node) => ['text', 'inlineCode'].includes(node.type))
      .map((node) => node.value)
      .join(' ')
    const slots = [
      '<objective>',
      '<feature-slot>',
      '<command-slot>',
      '<setting-slot>',
      '<enum-slot>',
      '<cli-slot>',
    ]
    for (const slot of slots) expect(rendered).toContain(slot)
  })
  it('command visibility retains each contributed condition and combines alternate menu paths', () => {
    const model = build()
    for (const menu of manifest.contributes.menus.commandPalette) {
      if (menu.when !== undefined)
        expect(model.commands.find((command) => command.id === menu.command).enablement).toContain(
          menu.when,
        )
    }
    expect(
      source.resolveCommandCondition({ command: 'probe', enablement: 'trusted' }, [
        { command: 'probe', when: 'editor' },
        { command: 'probe', when: 'panel' },
      ]),
    ).toBe('trusted && ((editor) || (panel))')
    expect(
      source.resolveCommandCondition({ command: 'probe' }, [
        { command: 'probe', when: 'editor' },
        { command: 'probe' },
      ]),
    ).toBeUndefined()
  })
  it('B01 preserves typed defaults and enum meanings, including enabled Judge auto', () => {
    for (const [id, schema] of Object.entries(manifest.contributes.configuration.properties)) {
      const actual = source.resolveSettingDefault(schema, nls)
      expect(actual.value, id).toEqual(schema.default)
      expect(actual.type, id).toEqual(schema.enum === undefined ? schema.type : 'enum')
      if (schema.enum !== undefined)
        expect(actual.meaning, id).toBe(
          nls[
            (schema.markdownEnumDescriptions ?? schema.enumDescriptions)?.[
              schema.enum.indexOf(schema.default)
            ]?.slice(1, -1)
          ],
        )
    }
    expect(source.isPaidSettingOn('judge', source.SETTING_DEFAULTS)).toBe(true)
    expect(
      source.isPaidSettingOn('judge', { ...source.SETTING_DEFAULTS, 'judge.engine': 'off' }),
    ).toBe(false)
    expect(feature('judge').facts.defaultState).toMatchObject({ type: 'enum', value: 'auto' })
    expect(JSON.stringify(feature('judge').facts)).not.toContain('enabledByDefault')
  })
  it('B02 gives headless images their flag/mode/budget admission without a price question', () => {
    const image = build().cli.find((row) => row.name === 'exec: --image-generation')
    expect(image.text).toEqual({ ui: 'referenceExecImages' })
    expect(image.description).toContain('No price question')
    expect(image.description).not.toContain('its price is asked first')
    expect(
      source.parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--permission-mode',
        'acceptEdits',
        '--image-generation',
        'prompt',
      ]),
    ).toMatchObject({ command: 'exec', options: { paidFeatures: ['imageGeneration'] } })
    expect(
      source.parseCommandLine([
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '1',
        '--image-generation',
        'prompt',
      ]).command,
    ).toBe('invalid')
  })
  it('B04/B05 rejects catalogue claims about current delegation, sandbox and message state', () => {
    const model = build()
    const descriptions = [
      ...model.features.flatMap((row) => [row.summary, row.description, ...row.details]),
      ...model.commands.map((row) => row.text),
    ]
    for (const ref of descriptions) {
      if ('conditions' in ref) continue
      expect(
        lintReferenceDescription(
          source.referenceText(ref, model, nls, source.EN),
          JSON.stringify(ref),
        ),
      ).toEqual([])
    }
    for (const text of [
      'Delegation is off (its default), so the model has no agent tools in this conversation.',
      'Muse Code cannot run shell commands until its Windows sandbox is set up.',
      'This message already reached the model.',
    ])
      expect(lintReferenceDescription(text, 'audit')).toHaveLength(1)
    expect(source.EN.referenceNativeAgentsConditions).toContain(
      'When run.subagent_delegation_mode="auto"',
    )
    expect(source.EN.referenceSandbox).toContain('when this window uses')
    expect(source.EN.referenceSandbox).toContain('shellSandbox="off"')
    const catalogue = source
      .featureCatalog()
      .map((f) =>
        f.id === 'native-agents' ? { ...f, summary: { ui: 'referenceNativeAgents' } } : f,
      )
    expect(() =>
      build(manifest, {
        featureCatalog: () => catalogue,
        EN: { ...source.EN, referenceNativeAgents: 'Delegation is off (its default)' },
      }),
    ).toThrow('Catalogue asserts conditional state')
  })
  it('B06 rejects free Judge even after its relationship is removed', () => {
    expect(() =>
      build(manifest, {
        featureCatalog: () =>
          source
            .featureCatalog()
            .map((f) => (f.id === 'judge' ? { ...f, paid: false, settings: [] } : f)),
      }),
    ).toThrow('Paid claim mismatch: judge')
    for (const id of source.PAID_FEATURES) {
      const paid = feature(source.PAID_USE_REGISTRY[id].featureId)
      expect(paid.paid, id).toBe(true)
      expect(paid.facts.paidFeature, id).toBe(id)
      expect(paid.facts.paidSettings, id).toEqual([`museSpark.${source.PAID_FEATURE_SETTINGS[id]}`])
    }
    const evidence = {
      ...source.evidence,
      'src/webview/components/Modal.tsx': source.evidence[
        'src/webview/components/Modal.tsx'
      ].replace("webviewKey('modal.focus', event) !== 'close'", "event.key !== 'Delete'"),
    }
    expect(() => build(manifest, { evidence })).toThrow('Keyboard dispatch bypasses registry')
  })
  it('B07 renders slash grammar and description slots literally in Markdown', () => {
    const markdown = referenceMarkdown(build(), source, nls, manifest)
    for (const row of build().slash)
      for (const syntax of row.syntax) expect(markdown).toContain(`\`${syntax}\``)
    expect(markdown).not.toMatch(/\*\*\/goal <objective>/)
    expect(markdown).not.toMatch(/:.*<instructions>/)
  })
  it('B08 inventories every runtime keyboard context, including previously omitted handlers', () => {
    const rows = build().shortcuts
    for (const context of Object.keys(source.WEBVIEW_KEYBINDINGS))
      expect(
        rows.find((row) => row.command === context),
        context,
      ).toBeDefined()
    for (const context of [
      'popover',
      'dialog',
      'agent.message',
      'output.open',
      'composer.mic',
      'goal.edit',
      'elicitation',
      'palette',
    ]) {
      const row = rows.find((entry) => entry.command === context)
      expect(row.text).toHaveProperty('ui')
    }
    expect(rows.find((row) => row.command === 'palette').key).toContain('Enter')
    expect(rows.find((row) => row.command === 'composer.send').key).toContain('Ctrl+Enter')
    expect(rows.find((row) => row.command === 'radial.menu').key).toContain('ArrowRight')
    const evidence = {
      ...source.evidence,
      'src/webview/components/NewDialog.tsx':
        "export const handle = (event) => event.key === 'Enter'",
    }
    expect(() => build(manifest, { evidence })).toThrow(
      'Keyboard dispatch bypasses registry: src/webview/components/NewDialog.tsx',
    )
    const renamedEvent = {
      ...source.evidence,
      'src/webview/nested/NewDialog.tsx':
        "export const handle = (evt: KeyboardEvent) => evt['key'] === 'Enter'",
    }
    expect(() => build(manifest, { evidence: renamedEvent })).toThrow(
      'Keyboard dispatch bypasses registry: src/webview/nested/NewDialog.tsx',
    )
  })
  it('B09 explanatory facts use catalogue/NLS fields in every locale, never raw English sentences', () => {
    expect(lintReferenceFacts({ withdrawal: 'queued messages only' })).toEqual([
      'Unlocalized reference fact: facts.withdrawal',
    ])
    const json = JSON.stringify(build().features.map((f) => f.facts))
    for (const prose of [
      'completed turns',
      'file tools may edit',
      'queued messages only; steer delivered immediately',
      'summary replaces older context',
    ])
      expect(json).not.toContain(prose)
    for (const language of [
      'cs',
      'de',
      'es',
      'fr',
      'hu',
      'it',
      'ja',
      'ko',
      'pl',
      'pt-br',
      'ru',
      'tr',
      'zh-cn',
      'zh-tw',
    ]) {
      const table = JSON.parse(readFileSync(path.join(root, `l10n/ui.${language}.json`), 'utf8'))
      for (const key of [
        'referenceConversationActions',
        'referenceAttachments',
        'referenceNativeAgents',
        'referenceSandbox',
        'referenceExecImages',
      ]) {
        expect(table[key], `${language}:${key}`).toBeTruthy()
        expect(table[key], `${language}:${key}`).not.toBe(source.EN[key])
      }
      expect(
        Object.keys(table.referenceCliOptions).toSorted((a, b) => a.localeCompare(b, 'en')),
      ).toEqual(
        Object.keys(source.EN.referenceCliOptions).toSorted((a, b) => a.localeCompare(b, 'en')),
      )
    }
  })
  it('B12 accepts or explicitly refuses every parser option on its documented route', () => {
    const samples = {
      provider: 'custom',
      preset: 'custom',
      as: 'custom',
      address: 'https://example.test',
      format: 'text',
      privacy: 'zdr',
      'usage-history': 'on',
      range: 'today',
      by: 'provider',
      from: '2026-10-01',
      to: '2026-10-06',
      backend: 'modelApi',
      'muse-binary': '/tmp/muse',
      'shell-sandbox': 'off',
      cwd: '/tmp',
      'prompt-file': '/tmp/prompt',
      'untrusted-file': '/tmp/data',
      'permission-mode': 'acceptEdits',
      model: 'muse-spark-1.3',
      effort: 'high',
      output: 'json',
      'max-budget-usd': '1',
      'max-requests': '2',
      timeout: '10',
      'questions-defer-after': '60',
      out: '/tmp/report',
      description: 'description',
    }
    const rows = build().cli
    for (const [route, definition] of Object.entries(source.CLI_OPTION_REGISTRY)) {
      for (const [name, option] of Object.entries(definition.options)) {
        const row = rows.find(
          (entry) => entry.route === route && entry.name.startsWith(`${route}: --${name}`),
        )
        expect(row, `${route}: --${name}`).toBeDefined()
        const flag = [`--${name}`, ...(option.type === 'string' ? [samples[name]] : [])]
        let command = [route]
        if (route === 'serve') command = []
        else if (route === 'providersAdd')
          command = ['providers', 'add', '--preset', name === 'privacy' ? 'openrouter' : 'custom']
        else if (route.startsWith('auth'))
          command = ['auth', { authSet: 'set', authStatus: 'status', authClear: 'clear' }[route]]
        else if (route === 'fontsInstall') command = ['fonts', 'install']
        let args = [...command]
        if (route === 'usage' && name === 'stdio') args.push('serve')
        if (route === 'usage' && name === 'from') args.push('--to', samples.to)
        if (route === 'usage' && name === 'to') args.push('--from', samples.from)
        if (route === 'providersAdd' && name === 'format') flag[1] = 'chat'
        if (['serve', 'login', 'setup', 'authSet', 'authStatus', 'authClear'].includes(route)) {
          args.push('--backend', 'modelApi', ...(route === 'setup' ? ['--trust-workspace'] : []))
        } else if (route === 'exec') {
          args.push(
            '--backend',
            ['muse-binary', 'shell-sandbox'].includes(name) ? 'museCode' : 'modelApi',
          )
          if (!['muse-binary', 'shell-sandbox'].includes(name)) args.push('--max-budget-usd', '1')
          if (name === 'image-generation') args.push('--permission-mode', 'acceptEdits')
        }
        args.push(...flag)
        if (route === 'exec' && name !== 'prompt-file') args.push('prompt')
        if (route === 'scan-secrets') args.push('/tmp/patch')
        const parsed = source.parseCommandLine(args)
        let expected = route
        if (row.contract.refused === true) expected = 'invalid'
        else if (name === 'help') expected = 'help'
        else if (name === 'version') expected = 'version'
        expect(parsed.command, `${route}: --${name}: ${parsed.reason ?? ''}`).toBe(expected)
        if (option.short === undefined) continue
        const aliasArgs = args.map((arg) => (arg === `--${name}` ? `-${option.short}` : arg))
        expect(source.parseCommandLine(aliasArgs).command, `${route}: -${option.short}`).toBe(
          parsed.command,
        )
      }
    }
  })
  it('B14/B15 describe Tab menu choices and the session board actions', () => {
    expect(commandText('tabSnooze')).toContain(source.EN.tabMenuSnoozeLong)
    expect(commandText('tabSnooze')).toContain(source.EN.tabMenuSnoozeRestart)
    expect(commandText('tabMenu')).toContain('When Copilot')
    expect(source.EN.referenceBoardDetail).toContain('title or branch')
    expect(source.EN.referenceBoardDetail).toContain('state, changes and approvals')
    expect(source.EN.referenceBoardDetail).toContain('activate a conversation')
  })
  it('B16 CLI options describe operations rather than failures', () => {
    const rows = build().cli
    for (const name of ['untrusted-file', 'model', 'fail-on-denial']) {
      const row = rows.find((entry) => entry.name.startsWith(`exec: --${name}`))
      expect(row.text).toEqual(source.referenceDescription({ cli: name }))
      expect(row.description).not.toBe(
        source.EN[
          {
            'untrusted-file': 'execFileUnreadable',
            model: 'execUnknownModel',
            'fail-on-denial': 'execDeniedStop',
          }[name]
        ],
      )
    }
    for (const ui of ['execFileUnreadable', 'execUnknownModel', 'execDeniedStop']) {
      const catalogue = source
        .featureCatalog()
        .map((entry) => (entry.id === 'judge' ? { ...entry, description: { ui } } : entry))
      expect(() => build(manifest, { featureCatalog: () => catalogue })).toThrow(
        `Failure message used as catalogue description: ${ui}`,
      )
    }
  })
})
