import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { createReference, type ReferenceHost } from '../../src/shared/reference/referenceEntry'
import { parseReferenceModel, referenceModel } from '../../src/shared/reference/reference.generated'
import { parseHostToWebviewMessage, parseWebviewToHostMessage } from '../../src/shared/protocol'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { compactReference } from '../../src/shared/cliCommands'

function isMessageWiring(value: unknown): value is {
  onConversationMessage(surface: { post(message: unknown): void }, message: { type: string }): void
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'onConversationMessage' in value &&
    typeof value.onConversationMessage === 'function'
  )
}

function host(): ReferenceHost {
  return {
    readNls: vi.fn().mockResolvedValue({ 'command.openHelp.title': 'Open Help & Reference' }),
    currentValue: vi.fn().mockReturnValue(false),
    openSetting: vi.fn().mockResolvedValue(undefined),
    runCommand: vi.fn().mockResolvedValue(undefined),
    post: vi.fn(),
  }
}
describe('reference host actions and command line', () => {
  it('RVHELPREF4 renders localized enum and fact conditions in terminal help', () => {
    const meaning = 'Un autre juge participe après sa configuration.'
    const text = createReference(EN, 'fr').all({
      'config.judge.engine.enumDescriptions.auto': meaning,
    })
    expect(text).toContain(`judgeEngine: ${meaning}`)
    expect(text).toContain('"when":"judgeEngine"')
    expect(text).toContain(`"fallback":"${meaning}"`)
  })
  it('C06 prints typed conditions and rejects malformed condition data at the model boundary', () => {
    const shown = createReference(EN, 'en').all()
    expect(shown).toContain(`run.subagent_delegation_mode: ${EN.referenceNativeAgentsConditions}`)
    for (const conditions of [
      [],
      [{ when: 'a new sentence', text: { ui: 'referenceNativeAgentsConditions' } }],
    ]) {
      const model = structuredClone(referenceModel())
      const native = model.features.find((feature) => feature.id === 'native-agents')
      if (native === undefined) throw new Error('missing native agent reference')
      const bad = { ...native, details: [{ conditions }] }
      expect(() => parseReferenceModel({ ...model, features: [bad] })).toThrow()
    }
  })
  it('reads every current value, keeps sensitive variables off the bridge and sends a valid model', async () => {
    const bridge = host()
    await createReference(EN, 'en').handle({ type: 'readReference' }, bridge)
    expect(bridge.currentValue).not.toHaveBeenCalledWith('museSpark.environmentVariables')
    expect(bridge.post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'referenceValues',
        values: expect.objectContaining({
          'museSpark.environmentVariables': EN.referenceHidden,
          'museSpark.modelApiTab': 'false',
        }),
      }),
    )
    expect(parseReferenceModel(referenceModel()).settings.length).toBeGreaterThan(0)
  })
  it('opens an exact known setting key, including native-host dotted anchors', async () => {
    const bridge = host()
    await createReference(EN, 'en').handle(
      { type: 'openReferenceSetting', key: 'museSpark.judge.engine' },
      bridge,
    )
    expect(bridge.openSetting).toHaveBeenCalledWith('museSpark.judge.engine')
    await expect(
      createReference(EN, 'en').handle(
        { type: 'openReferenceSetting', key: 'editor.password' },
        bridge,
      ),
    ).rejects.toThrow()
    expect(bridge.openSetting).toHaveBeenCalledTimes(1)
  })
  it('allows only reviewed context-free commands and rejects destructive or foreign commands', async () => {
    const bridge = host()
    const reference = createReference(EN, 'en')
    await reference.handle({ type: 'runReferenceCommand', command: 'museSpark.showLogs' }, bridge)
    expect(bridge.runCommand).toHaveBeenCalledWith('museSpark.showLogs')
    for (const command of [
      'museSpark.signOut',
      'museSpark.removeWorktree',
      'workbench.action.closeWindow',
      'museSpark.memory',
      'museSpark.mcpServers',
      'museSpark.hooks',
      'museSpark.openShareFile',
      'museSpark.tabMenu',
    ])
      await expect(
        reference.handle({ type: 'runReferenceCommand', command }, bridge),
      ).rejects.toThrow()
    expect(bridge.runCommand).toHaveBeenCalledTimes(1)
  })
  it('validates messages, translated dictionaries and the nested reference model', () => {
    expect(parseWebviewToHostMessage({ type: 'openReferenceSetting', key: 1 }).ok).toBe(false)
    expect(
      parseHostToWebviewMessage({
        type: 'referenceValues',
        model: '{}',
        values: {},
        nls: { key: 1 },
      }).ok,
    ).toBe(false)
    expect(() => parseReferenceModel({ commands: [] })).toThrow()
  })
  it('lists reserved ACP help once alongside the installed skills', () => {
    const text = compactReference(['help', 'demo'])
    expect(text.match(/\/help/g)).toHaveLength(1)
    expect(text).toContain('/demo')
  })
  it('prints every category without starting a backend and parses full help strictly', () => {
    const text = createReference(EN, 'en').all()
    for (const marker of [
      'museSpark.openHelp',
      'museSpark.judge.engine',
      '/help',
      'scan-secrets',
      EN.referenceShortcuts,
    ])
      expect(text).toContain(marker)
    expect(parseCommandLine(['help', '--all'])).toEqual({ command: 'help', all: true })
    expect(parseCommandLine(['help'])).toEqual({ command: 'help', all: false })
    expect(parseCommandLine(['help', '--unknown'])).toMatchObject({ command: 'invalid' })
    expect(parseCommandLine(['exec', '--help'])).toEqual({ command: 'help', all: true })
  })
})

describe('RVHELPREF host and terminal regressions', () => {
  it('R16 prints applicability, billing, setting type, CLI contracts and unavailable values', () => {
    const text = createReference(EN, 'en').all()
    expect(text).not.toMatch(/\{(?:command|server)\}/)
    for (const marker of [
      'vscode:modelApi',
      'acp:modelApi',
      EN.referencePaid,
      EN.referenceUnavailable,
      EN.referenceAcp,
      '--max-budget-usd',
      '--out',
      '"boolean"',
      'unique:name',
      '/goal pause',
    ])
      expect(text).toContain(marker)
    for (const route of ['exec', 'report', 'scan-secrets'])
      expect(parseCommandLine([route, '--help'])).toEqual({ command: 'help', all: true })
  })
  it('R20 leaves an unsupported host value set empty without reading sensitive values', async () => {
    const bridge = host()
    bridge.currentValue = vi.fn().mockReturnValue(undefined)
    await createReference(EN, 'en').handle({ type: 'readReference' }, bridge)
    expect(bridge.post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'referenceValues', values: {} }),
    )
    expect(bridge.currentValue).not.toHaveBeenCalledWith('museSpark.environmentVariables')
  })
  it('R21 answers malformed or unreadable NLS with an explicit retryable error', async () => {
    for (const readNls of [
      vi.fn().mockRejectedValue(new Error('missing')),
      vi.fn().mockResolvedValue({ bad: 1 }),
    ]) {
      const bridge = { ...host(), readNls }
      await createReference(EN, 'en').handle({ type: 'readReference' }, bridge)
      expect(bridge.post).toHaveBeenCalledWith({
        type: 'referenceValues',
        model: '',
        values: {},
        nls: {},
        error: true,
      })
    }
  })
  it('R22 uses installed manifest titles, setting prose and enum translations in full help', () => {
    const nls = {
      'command.openInSidebar.title': 'Ouvrir dans la barre latérale',
      'config.backend.description': 'Choisir le moteur',
      'config.tabTrigger.enumDescriptions.onInvoke': 'Sur invocation',
    }
    const text = createReference(EN, 'fr').all(nls)
    expect(text).toContain(nls['command.openInSidebar.title'])
    expect(text).toContain(nls['config.backend.description'])
    expect(text).toContain(nls['config.tabTrigger.enumDescriptions.onInvoke'])
    expect(text).not.toContain('Muse Spark: Open in Sidebar (museSpark.openInSidebar)')
  })
})

// Exercise the activation closure itself; extension.ts is excluded from unit imports.
it('R21 reports a synchronous lazy bundle failure through the real activation wiring', async () => {
  const source = readFileSync(new URL('../../src/extension.ts', import.meta.url), 'utf8')
  const start = source.indexOf('onConversationMessage: (surface, message) => {')
  const end = source.indexOf('\n  }\n\n  registry.onRemoved', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const post = vi.fn()
  const log = vi.fn()
  const code = ts.transpileModule(`({${source.slice(start, end)}})`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext },
  }).outputText
  const wiring: unknown = runInNewContext(code, {
    isReferenceRequest: () => true,
    referenceBundle: () => {
      throw new Error('bundle missing')
    },
    l10n: { table: EN, locale: 'en' },
    logRejection: () => log,
    log: {},
  })
  if (!isMessageWiring(wiring)) throw new Error('missing reference wiring')
  const onMessage = wiring.onConversationMessage
  expect(() => {
    onMessage({ post }, { type: 'readReference' })
  }).not.toThrow()
  await vi.waitFor(() => {
    expect(post).toHaveBeenCalledWith({
      type: 'referenceValues',
      model: '',
      values: {},
      nls: {},
      error: true,
    })
  })
  expect(log).toHaveBeenCalledOnce()
})

it('round-trips the entire compressed reference without losing any fact', () => {
  const json = JSON.parse(
    readFileSync(
      new URL('../../src/shared/reference/reference.generated.json', import.meta.url),
      'utf8',
    ),
  )
  expect(referenceModel()).toEqual(json)
  expect(createReference(EN, 'en').all()).not.toContain('{command}')
})

it('RVHELPREF4 rejects a corrupt packed technical-prefix index', () => {
  const generated = readFileSync(
    new URL('../../src/shared/reference/reference.generated.ts', import.meta.url),
    'utf8',
  )
  const body = generated.slice(
    generated.indexOf('const textKeys ='),
    generated.indexOf('const plainTextSchema ='),
  )
  const code = ts.transpileModule(`${body.replace('~s0:', '~sz:')}\nreferenceModel()`, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS },
  }).outputText
  expect(() => {
    runInNewContext(code, { exports: {}, parseReferenceModel })
  }).toThrow('~sz:')
})
