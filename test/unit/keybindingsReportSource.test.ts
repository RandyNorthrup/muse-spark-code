// The keybindings report kind end to end (M113 C-M113-5, D93.4): the
// installed manifest's editor bindings plus the panel's gestures and ACP's
// static local commands, with conflicts flagged. The real-manifest cases pin
// the shipped defaults; a new default binding or clash fails here on purpose.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as acp from '@agentclientprotocol/sdk'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_SECTION_ROWS } from '../../src/shared/constants'
import {
  reportSectionSchema,
  type ReportRow,
  type ReportSection,
} from '../../src/shared/reportSchema'
import { LocalSourceError } from '../../src/core/reporting/sources/local'
import {
  ACP_COMMAND_FACTS,
  keybindingsFacts,
  keybindingsSource,
} from '../../src/core/reporting/sources/keybindings'
import { acpSharingCommands } from '../../src/acp/sharing'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { AcpVault } from '../../src/acp/vault'
import type { RuntimeResources } from '../../src/runtime/resources/port'
import { FakeAgentHost, museCodeTestBackend } from './helpers/kindFakeAgent'
import { memoryPaidGrants } from './helpers/kindPaidGrants'
import { sessionAccountsRig } from './helpers/kindRuntimeAccounts'
import { FakeAcpQuestionRegistry } from './helpers/questions/kindAcpRegistry'
import { fakeUsageAccess } from './helpers/kindUsageAdapters'
import { compare } from '../../src/core/reporting/collect/common'
import { collectKeybindingSections } from '../../src/core/reporting/collect/keybindings'
import { keybindingsManifestReader } from '../../src/runtime/reporting/reportInputs'
import { createReportingEngine } from '../../src/runtime/reporting/engine'
import { reportWorkspaceKey } from '../../src/core/reporting/sources/local'
import { REPORT_AS_OF } from './helpers/reporting/kindRuntime'
import {
  availableSource,
  buildSourceSnapshot,
  reportOptions,
} from './helpers/reporting/kindFixtures'
import { REPORT_FIXTURE_AS_OF } from './helpers/reporting/kindFixtures'
import { fixtureCollector } from './helpers/reporting/kindFixtures'
import { referenceKeyboardActions } from '../../src/shared/keybindings'
import manifest from '../../package.json'

// Bounded probe exec stands in for governed admission here (see spawnGovernance).
vi.mock('../../src/core/resources/launcher', async (original) => {
  const { withFixtureCommand } = await import('./helpers/resources/kindLaunch')
  return withFixtureCommand(await original())
})

function keybindingsContext() {
  return {
    reportText: EN,
    locale: 'en',
    asOf: REPORT_FIXTURE_AS_OF,
    workspaceKey: 'keybindings-fixture',
    options: reportOptions('keybindings'),
    signal: new AbortController().signal,
  }
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function readManifestError(reader: () => unknown): unknown {
  try {
    reader()
  } catch (error) {
    return error
  }
  throw new Error('Expected the manifest read to fail')
}

function cells(section: ReportSection, command: string, scope: string) {
  return section.rows
    .filter(
      (entry) =>
        entry.cells['command']?.type === 'text' &&
        entry.cells['command'].value === command &&
        entry.cells['scope']?.type === 'text' &&
        entry.cells['scope'].value === scope,
    )
    .map((entry) => entry.cells['shortcut'])
}

/** A conflict row's scope cell as text; every conflict scope is a text cell. */
function scopeText(entry: ReportRow): string {
  const scope = entry.cells['scope']
  if (scope?.type !== 'text') throw new Error('Expected a text scope cell')
  return scope.value
}

/** A test-only chord normalizer: the contract `conflictRows` implements. */
function normalizeTestChord(chord: string): string {
  return chord.toLowerCase().replaceAll(/\s+/gu, ' ').trim()
}

interface ConflictExpectation {
  readonly shortcut: string
  readonly commands: readonly string[]
  readonly scope: string
}

function compareConflict(left: ConflictExpectation, right: ConflictExpectation): number {
  return compare(JSON.stringify(left), JSON.stringify(right))
}

/** A conflict section's rows as plain expectations, in row order. */
function readConflicts(rows: ReportRow[]): ConflictExpectation[] {
  return rows.map((entry) => {
    const shortcut = entry.cells['shortcut']
    const command = entry.cells['command']
    if (shortcut?.type !== 'text' || command?.type !== 'textList')
      throw new Error('Expected conflict cells')
    return { shortcut: shortcut.value, commands: command.value, scope: scopeText(entry) }
  })
}

/**
 * One registrar gate: the port whose presence announces the command. The
 * harness binds one port at a time against the real agent, so a command
 * registered in any syntax is seen — and a command no single gate explains
 * fails below as unclassifiable instead of passing silently.
 */
type AcpGate =
  | 'sharing'
  | 'vault'
  | 'accounts'
  | 'legalScan'
  | 'usage'
  | 'resources'
  | 'playbook'
  | 'schedules'
  | 'media'
  | 'estimate'
  | 'questions'

/** A port method the announce path never calls: it rejects if it ever runs. */
function unusedPort(): Promise<never> {
  return Promise.reject(new Error('port unused in announce test'))
}

/** An `unsubscribe` that never runs: returned, never called, in announce tests. */
function unusedUnsubscribe(): void {
  return undefined
}

/** The unused ports' half of a `RuntimeResources` double: only `subscribe` runs. */
function unusedResources(): RuntimeResources {
  return {
    command: unusedPort,
    status: unusedPort,
    history: unusedPort,
    resume: unusedPort,
    admit: unusedPort,
    workChanged: () => undefined,
    subscribe: () => unusedUnsubscribe,
    subscribeEvents: () => unusedUnsubscribe,
    dispose: () => undefined,
  }
}

/** One gate bound, everything else absent: the commands that gate announces. */
function gateDeps(gate: AcpGate): Partial<AcpAgentDeps> {
  switch (gate) {
    case 'sharing': {
      return {
        sharing: { commands: acpSharingCommands, execute: () => Promise.resolve('') },
      }
    }
    case 'vault': {
      return { vault: new AcpVault(() => Promise.reject(new Error('port unused'))) }
    }
    case 'accounts': {
      return { accounts: sessionAccountsRig().port }
    }
    case 'legalScan': {
      return { legalScan: () => Promise.resolve('ok') }
    }
    case 'usage': {
      return {
        usage: { access: () => fakeUsageAccess().usage, openPage: () => Promise.resolve('') },
      }
    }
    case 'resources': {
      return { resources: unusedResources() }
    }
    case 'playbook': {
      return {
        playbookFor: () => ({
          read: () => Promise.resolve({}),
          change: () => Promise.resolve({}),
        }),
      }
    }
    case 'schedules': {
      return { schedules: { run: () => Promise.resolve('') } }
    }
    case 'media': {
      return { media: () => Promise.reject(new Error('port unused')) }
    }
    case 'estimate': {
      return { estimate: { run: () => Promise.resolve('') } }
    }
    case 'questions': {
      return { questions: (input) => new FakeAcpQuestionRegistry(input) }
    }
  }
}

/**
 * The names the real registrar announces with these deps: a full agent over
 * the ACP client, one `session/new`, then read-only `/agents` (which
 * announces the commands before answering from history). Results are cached
 * per configuration so the gate suite pays for each registrar run once.
 */
const announcedCache = new Map<string, Promise<string[]>>()

function announcedNames(
  gate: AcpGate | 'baseline' | 'all',
  isHeadless: boolean,
): Promise<string[]> {
  const cacheKey = JSON.stringify([gate, isHeadless])
  const cached = announcedCache.get(cacheKey)
  if (cached !== undefined) return cached
  const run = (async (): Promise<string[]> => {
    const host = new FakeAgentHost()
    host.readSession = () =>
      Promise.resolve({ mode: 'none', items: [], name: undefined, todos: [] })
    const updates: acp.SessionUpdate[] = []
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const gates: AcpGate[] = []
    if (gate === 'all') {
      gates.push(
        'sharing',
        'vault',
        'accounts',
        'legalScan',
        'usage',
        'resources',
        'playbook',
        'schedules',
        'media',
        'estimate',
        'questions',
      )
    } else if (gate !== 'baseline') {
      gates.push(gate)
    }
    const deps: AcpAgentDeps = {
      questions: 'decline',
      backend: museCodeTestBackend(host),
      version: 'keybindings-parity-test',
      options: {
        canBypass: false,
        allowsContributorModels: false,
        initialMode: 'manual',
        ...(isHeadless && { isHeadless: true }),
      },
      signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
      defaultCwd: process.cwd(),
      log,
      paid: new AcpPaidUse({
        flagged: [],
        canRemember: () => false,
        grants: memoryPaidGrants(),
        log,
      }),
      ...Object.assign({}, ...gates.map((bound) => gateDeps(bound))),
    }
    const agent = createAcpAgent(deps)
    const client = acp
      .client({ name: 'keybindings-parity' })
      .onNotification('session/update', (context) => {
        updates.push(context.params.update)
      })
    await client.connectWith(agent, async (connection) => {
      await connection.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      const { sessionId } = await connection.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      await connection.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/agents' }],
      })
    })
    const announced = updates.find(
      (
        update,
      ): update is Extract<acp.SessionUpdate, { sessionUpdate: 'available_commands_update' }> =>
        update.sessionUpdate === 'available_commands_update',
    )
    if (announced === undefined) throw new Error('The registrar announced no commands')
    return announced.availableCommands.map((command) => command.name)
  })()
  announcedCache.set(cacheKey, run)
  return run
}

/**
 * Every qualifier of the report's full gate, as a set: each `|` alternative
 * contributes each of its comma-separated qualifiers (`media, not headless`
 * contributes both `media` and `not headless`). Comparing only the first
 * word lets a dropped qualifier stay green, so the parity test compares
 * this whole set against what the registrar does in each mode.
 */
function observedQualifiers(when: string | undefined): Set<string> {
  return when === undefined
    ? new Set<string>()
    : new Set(
        when
          .split('|')
          .flatMap((alternative) => alternative.split(','))
          .map((qualifier) => qualifier.trim().replaceAll(/\s+/gu, ' '))
          .filter((qualifier) => qualifier !== ''),
      )
}

/**
 * The commands each registrar gate adds beyond the always-announced
 * baseline, as the registrar behaves today: sharing drops its own `help`
 * (announced unconditionally), and the resource table carries `usage` beside
 * `resources` while the usage port is absent. A new command in any gate
 * fails the attribution test until this table learns it.
 */
const GATE_COMMANDS: Record<AcpGate, Set<string>> = {
  sharing: new Set(['share', 'prompt']),
  vault: new Set(['vault']),
  accounts: new Set(['accounts']),
  legalScan: new Set(['legal']),
  usage: new Set(['usage']),
  resources: new Set(['resources', 'usage']),
  playbook: new Set(['playbook']),
  schedules: new Set(['schedule']),
  media: new Set(['attach', 'record']),
  estimate: new Set(['estimate']),
  questions: new Set(['answer', 'questions']),
}

/**
 * Every registrar gate, in binding order: the typed key list, so the tests
 * iterate gates without narrowing `Object.keys` through a type assertion.
 */
const ACP_GATES: readonly AcpGate[] = [
  'sharing',
  'vault',
  'accounts',
  'legalScan',
  'usage',
  'resources',
  'playbook',
  'schedules',
  'media',
  'estimate',
  'questions',
]

/**
 * The full gate the registrar honours for one command, as a set: the gates
 * that announce it, plus `not headless` exactly when the all-ports run
 * announces it normally but withholds it headless. A reported `when` whose
 * qualifiers differ — a dropped `not headless`, a removed gate, an added
 * word — mismatches, so the parity test fails it.
 */
function expectedQualifiers(
  name: string,
  announcedNormal: ReadonlySet<string>,
  announcedHeadless: ReadonlySet<string>,
): Set<string> {
  const expected = new Set<string>(ACP_GATES.filter((gate) => GATE_COMMANDS[gate].has(name)))
  if (announcedNormal.has(name) && !announcedHeadless.has(name)) expected.add('not headless')
  return expected
}

/** Exact set equality: size plus every member present on both sides. */
function hasSameQualifiers(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const qualifier of left) {
    if (!right.has(qualifier)) return false
  }
  return true
}

/** The reported commands whose full gate differs from the registrar's. */
function fullGateMismatches(
  reported: ReadonlyMap<string, string | undefined>,
  baseline: ReadonlySet<string>,
  announcedNormal: ReadonlySet<string>,
  announcedHeadless: ReadonlySet<string>,
): string[] {
  const mismatches: string[] = []
  for (const [name, when] of reported) {
    if (baseline.has(name)) {
      if (when !== undefined) mismatches.push(name)
      continue
    }
    const expected = expectedQualifiers(name, announcedNormal, announcedHeadless)
    const observed = observedQualifiers(when)
    if (!hasSameQualifiers(observed, expected)) mismatches.push(name)
  }
  return mismatches
}

/** Editor scopes carry the platform plus the binding's `when`, when it has one. */
function editorCells(section: ReportSection, command: string, platform: string) {
  return section.rows
    .filter(
      (entry) =>
        entry.cells['command']?.type === 'text' &&
        entry.cells['command'].value === command &&
        entry.cells['scope']?.type === 'text' &&
        (entry.cells['scope'].value === `editor/${platform}` ||
          entry.cells['scope'].value.startsWith(`editor/${platform} (`)),
    )
    .map((entry) => entry.cells['shortcut'])
}

describe('keybindings report facts', () => {
  it('lists every installed editor binding on every platform with its scope', async () => {
    const result = await keybindingsSource(() => manifest).read(keybindingsContext())
    expect(result.record.status).toBe('ok')
    const sections = result.data ?? []
    expect(sections.map((section) => section.id)).toEqual([
      'keybindings/keybindings',
      'keybindings/conflicts',
    ])
    for (const section of sections) expect(() => reportSectionSchema.parse(section)).not.toThrow()
    const bindings = sections[0]!
    const declared = manifest.contributes.keybindings.length
    expect(declared).toBeGreaterThan(0)
    for (const entry of manifest.contributes.keybindings) {
      expect(editorCells(bindings, entry.command, 'linux')).toHaveLength(1)
      expect(editorCells(bindings, entry.command, 'macos')).toHaveLength(1)
      expect(editorCells(bindings, entry.command, 'windows')).toHaveLength(1)
    }
    // Spot checks against the manifest's own chords, per platform.
    expect(cells(bindings, 'museSpark.focusInput', 'editor/linux')).toEqual([
      { type: 'text', value: 'ctrl+escape' },
    ])
    expect(cells(bindings, 'museSpark.focusInput', 'editor/macos')).toEqual([
      { type: 'text', value: 'cmd+escape' },
    ])
    expect(cells(bindings, 'museSpark.focusInput', 'editor/windows')).toEqual([
      { type: 'text', value: 'ctrl+alt+escape' },
    ])
    // The Linux override is its own chord, not a copy of the default.
    expect(editorCells(bindings, 'museSpark.toggleThinking', 'linux')).toEqual([
      { type: 'text', value: 'ctrl+alt+o' },
    ])
    expect(editorCells(bindings, 'museSpark.toggleThinking', 'macos')).toEqual([
      { type: 'text', value: 'alt+t' },
    ])
    expect(editorCells(bindings, 'museSpark.toggleThinking', 'windows')).toEqual([
      { type: 'text', value: 'ctrl+alt+t' },
    ])
    // The panel's gestures and ACP's static locals ride the same section.
    // `composer.send` carries its setting gate: Enter sends only while
    // useCtrlEnterToSend is off, so the row never reads as always active.
    const sendRows = bindings.rows.filter(
      (entry) =>
        entry.cells['command']?.type === 'text' &&
        entry.cells['command'].value === 'composer.send' &&
        entry.cells['scope']?.type === 'text' &&
        entry.cells['scope'].value.startsWith('panel'),
    )
    expect(sendRows).toHaveLength(1)
    const sendScope = sendRows[0]!.cells['scope']
    expect(sendScope?.type === 'text' && sendScope.value).toContain('useCtrlEnterToSend=false')
    expect(sendScope?.type === 'text' && sendScope.value).toContain('useCtrlEnterToSend=true')
    // A gesture with no gate keeps the bare panel scope.
    expect(cells(bindings, 'team.tree', 'panel')).not.toEqual([])
    expect(
      bindings.rows.filter(
        (entry) =>
          entry.cells['scope']?.type === 'text' &&
          (entry.cells['scope'].value === 'acp' || entry.cells['scope'].value.startsWith('acp (')),
      ),
    ).toHaveLength(ACP_COMMAND_FACTS.length)
    expect(cells(bindings, 'report', 'acp')).toEqual([{ type: 'text', value: '/report' }])
    // Always-announced commands keep the bare scope; gated ones name it.
    expect(cells(bindings, 'help', 'acp')).toEqual([{ type: 'text', value: '/help' }])
    expect(cells(bindings, 'vault', 'acp (vault)')).toEqual([{ type: 'text', value: '/vault' }])
    expect(cells(bindings, 'schedule', 'acp (schedules)')).toEqual([
      { type: 'text', value: '/schedule' },
    ])
    // The shipped defaults are conflict-free; a new default clash fails here
    // on purpose so its section and reason are reviewed.
    expect(sections[1]!.rows).toEqual([])
  })

  it('lists built-in targets, refuses empty manifests, and keeps panel targets beside misshapen bindings', async () => {
    const base = {
      contributes: {
        commands: [{ command: 'museSpark.focusInput' }],
        keybindings: [
          { command: 'museSpark.focusInput', key: 'ctrl+escape' },
          { command: 'editor.action.inlineSuggest.trigger', key: 'alt+\\' },
        ],
      },
    }
    const valid = await keybindingsSource(() => base).read(keybindingsContext())
    expect(valid.record.status).toBe('ok')
    // Two bindings on three platforms, every panel gesture, every ACP local.
    expect(valid.data?.[0]?.rows).toHaveLength(
      2 * 3 + referenceKeyboardActions().length + ACP_COMMAND_FACTS.length,
    )
    expect(valid.data?.[1]?.rows).toEqual([])
    expect(cells(valid.data![0]!, 'editor.action.inlineSuggest.trigger', 'editor/linux')).toEqual([
      { type: 'text', value: 'alt+\\' },
    ])
    for (const broken of [{}, { contributes: {} }]) {
      const result = await keybindingsSource(() => broken).read(keybindingsContext())
      expect(result.record.status).toBe('unavailable')
      expect(result.data).toBeNull()
    }
    // RVREPORTJOIN P2-1: one damaged declaration is a named problem beside
    // the good rows, never a lost source: the static panel gestures and ACP
    // commands still report.
    for (const broken of [
      { contributes: { commands: [], keybindings: [{ command: 'x', key: 42 }] } },
      { contributes: { commands: [], keybindings: 'nope' } },
      {
        contributes: {
          commands: [{ command: 'museSpark.focusInput' }],
          keybindings: [{ command: 'museSpark.focusInput', key: '' }],
        },
      },
      {
        contributes: {
          commands: [{ command: 'museSpark.focusInput' }],
          keybindings: [{ key: 'ctrl+escape' }],
        },
      },
    ]) {
      const result = await keybindingsSource(() => broken).read(keybindingsContext())
      expect(result.record.status).toBe('partial')
      expect(result.record.reason).toContain(EN.reportSourceReasons.invalid)
      const bindings = result.data?.find((section) => section.id === 'keybindings/keybindings')
      expect(bindings?.rows).toHaveLength(
        referenceKeyboardActions().length + ACP_COMMAND_FACTS.length,
      )
    }
  })

  it('flags same-chord same-when editor bindings and nothing else', () => {
    // Two clashes share one chord but fire under different clauses: each is
    // its own conflict, and each row names the clause it fires under.
    const editor = [
      { command: 'a.first', key: 'Ctrl+K', when: 'editorTextFocus' },
      { command: 'b.second', key: 'ctrl+k', when: 'editorTextFocus' },
      { command: 'c.third', key: 'ctrl+k', when: 'terminalFocus' },
      { command: 'd.fourth', key: 'ctrl+k', when: 'terminalFocus' },
    ]
    // Each clash on all three platforms is one row per platform per clause.
    const [conflicts] = collectKeybindingSections({ editor, panel: [], acp: [] }).slice(1)
    expect(conflicts!.rows).toHaveLength(6)
    for (const entry of conflicts!.rows) {
      // The cell keeps the normalized chord, not the first fact's casing.
      expect(entry.cells['shortcut']).toEqual({ type: 'text', value: 'ctrl+k' })
    }
    const rowsUnder = (when: string) =>
      conflicts!.rows.filter((entry) => scopeText(entry).endsWith(`(${when})`))
    const textClash = rowsUnder('editorTextFocus')
    expect(textClash).toHaveLength(3)
    for (const entry of textClash) {
      expect(entry.cells['command']).toEqual({
        type: 'textList',
        value: ['a.first', 'b.second'],
      })
    }
    const terminalClash = rowsUnder('terminalFocus')
    expect(terminalClash).toHaveLength(3)
    for (const entry of terminalClash) {
      expect(entry.cells['command']).toEqual({
        type: 'textList',
        value: ['c.third', 'd.fourth'],
      })
    }
    expect(
      conflicts!.rows
        .map((entry) => entry.cells['scope'])
        .filter((scope, index, all) => all.indexOf(scope) === index),
    ).toHaveLength(6)
    // Different `when` clauses shadow by design; other platforms never collide.
    const scoped = collectKeybindingSections({
      editor: [
        { command: 'a.first', key: 'ctrl+k', when: 'editorTextFocus' },
        { command: 'd.other', key: 'ctrl+k', when: 'terminalFocus' },
      ],
      panel: [],
      acp: [],
    })
    expect(scoped[1]!.rows).toEqual([])
  })

  it('is order-independent and deduplicates repeated facts', () => {
    const facts = keybindingsFacts(EN, manifest).facts
    const forward = collectKeybindingSections(facts)
    const reversed = collectKeybindingSections({
      editor: facts.editor.toReversed(),
      panel: facts.panel.toReversed(),
      acp: facts.acp.toReversed(),
    })
    expect(reversed).toEqual(forward)
    const doubled = collectKeybindingSections({
      editor: [...facts.editor, ...facts.editor],
      panel: [...facts.panel, ...facts.panel],
      acp: [...facts.acp, ...facts.acp],
    })
    expect(doubled).toEqual(forward)
  })

  it('renders the same conflict bytes regardless of fact order', () => {
    const editor = [
      { command: 'a.first', key: 'Ctrl+K' },
      { command: 'b.second', key: 'ctrl+k' },
    ]
    const forward = collectKeybindingSections({ editor, panel: [], acp: [] })
    const reversed = collectKeybindingSections({
      editor: editor.toReversed(),
      panel: [],
      acp: [],
    })
    expect(reversed).toEqual(forward)
    // No clause to share: the clash reads editor-wide on every platform.
    const scopes = forward[1]!.rows.map((entry) => {
      const scope = entry.cells['scope']
      if (scope?.type !== 'text') throw new Error('Expected a text scope cell')
      return scope.value
    })
    expect(new Set(scopes)).toEqual(new Set(['editor/linux', 'editor/macos', 'editor/windows']))
  })

  it('groups generated bindings by platform, chord and when in any input order', () => {
    // A fixed seed, so the same bindings every run: the chords and clauses
    // include the review's aliasing pairs (`ctrl+k` under `when: 'ab'`
    // beside ungated `ctrl+kab`; `ctrl+k` under `when: ' ctrl+s'` beside
    // `ctrl+k ctrl+s`), which a concatenated group key reports as clashes.
    let state = 2_654_435_769
    const next = (mod: number): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state % mod
    }
    const chords = [
      'ctrl+k',
      'Ctrl+K',
      'ctrl+kab',
      'ctrl+k  ctrl+s',
      'ctrl+k ctrl+s',
      'alt+\\',
      ' '.repeat(3),
    ]
    const clauses: (string | undefined)[] = [
      undefined,
      'editorTextFocus',
      'terminalFocus',
      'ab',
      ' ctrl+s',
    ]
    const editor: { command: string; key: string; linux?: string; when?: string }[] = [
      { command: 'a.first', key: 'ctrl+k', when: 'ab' },
      { command: 'b.second', key: 'ctrl+kab' },
      { command: 'c.third', key: 'ctrl+k', when: ' ctrl+s' },
      { command: 'd.fourth', key: 'ctrl+k ctrl+s' },
    ]
    for (let i = 0; i < 36; i++) {
      const clause: string | undefined = clauses[next(clauses.length)]
      const fact: { command: string; key: string; linux?: string; when?: string } = {
        command: `gen.cmd${String(next(9))}`,
        key: chords[next(chords.length)]!,
      }
      if (next(4) === 0) fact.linux = 'ctrl+alt+o'
      if (clause !== undefined) fact.when = clause
      editor.push(fact)
    }
    // The test's own statement of a conflict: same platform, same chord
    // (case-insensitive, whitespace-collapsed), same clause — worked out by
    // nested comparison, never by building a group key.
    const expected: ConflictExpectation[] = []
    for (const platform of ['linux', 'macos', 'windows']) {
      const gestures = editor.flatMap((fact) => {
        const gesture = (platform === 'linux' ? (fact.linux ?? fact.key) : fact.key).trim()
        return gesture === ''
          ? []
          : [{ chord: normalizeTestChord(gesture), when: fact.when, command: fact.command }]
      })
      const chordsSeen = new Set(gestures.map((gesture) => gesture.chord))
      const whensSeen = new Set(gestures.map((gesture) => gesture.when ?? ''))
      for (const chord of chordsSeen) {
        for (const when of whensSeen) {
          const commands = [
            ...new Set(
              gestures
                .filter((gesture) => gesture.chord === chord && (gesture.when ?? '') === when)
                .map((gesture) => gesture.command),
            ),
          ].toSorted(compare)
          if (commands.length < 2) continue
          expected.push({
            shortcut: chord,
            commands,
            scope: when === '' ? `editor/${platform}` : `editor/${platform} (${when})`,
          })
        }
      }
    }
    // The aliasing pairs stay apart: neither is a clash on its own.
    expect(
      collectKeybindingSections({ editor: editor.slice(0, 4), panel: [], acp: [] })[1]!.rows,
    ).toEqual([])
    const forward = collectKeybindingSections({ editor, panel: [], acp: [] })
    expect(readConflicts(forward[1]!.rows).toSorted(compareConflict)).toEqual(
      expected.toSorted(compareConflict),
    )
    // Any input order collects byte-equal sections.
    expect(
      collectKeybindingSections({
        editor: [...editor.slice(13), ...editor.slice(0, 13)],
        panel: [],
        acp: [],
      }),
    ).toEqual(forward)
    expect(collectKeybindingSections({ editor: editor.toReversed(), panel: [], acp: [] })).toEqual(
      forward,
    )
  })

  it('marks the source partial with its reason when a blank chord is skipped', async () => {
    const base = {
      contributes: {
        commands: [{ command: 'museSpark.focusInput' }],
        keybindings: [
          { command: 'museSpark.focusInput', key: 'ctrl+escape' },
          { command: 'museSpark.toggleThinking', key: ' '.repeat(3) },
        ],
      },
    }
    const result = await keybindingsSource(() => base).read(keybindingsContext())
    expect(result.record.status).toBe('partial')
    expect(result.record.reason).toBe(EN.reportSourceReasons.invalid)
    // One skipped platform row per platform on the bindings section; the
    // kept binding still reports all three of its own rows. A blank chord
    // names no gesture, so it cannot clash: the conflicts section counts
    // nothing for it and stays an empty table, not "N more".
    expect(result.data?.[0]?.omittedRows).toBe(3)
    expect(result.data?.[1]?.rows).toEqual([])
    expect(result.data?.[1]?.omittedRows).toBe(0)
    expect(editorCells(result.data![0]!, 'museSpark.focusInput', 'linux')).toEqual([
      { type: 'text', value: 'ctrl+escape' },
    ])
    expect(editorCells(result.data![0]!, 'museSpark.toggleThinking', 'linux')).toEqual([])
  })

  it('pins the ACP table to the registrar announced commands', async () => {
    // The report lists exactly what the real registrar announces with every
    // port bound — no source scan, so a command registered in any syntax is
    // seen. Dynamic skills announce per session and stay out of both.
    const reported = new Map<string, string | undefined>(
      ACP_COMMAND_FACTS.map((entry) => [entry.name, entry.when]),
    )
    const baseline = new Set(await announcedNames('baseline', false))
    expect(baseline).toEqual(new Set(['help', 'compact', 'report', 'agents']))
    const announced = new Set(await announcedNames('all', false))
    expect(announced).toEqual(new Set(reported.keys()))
    // The typed gate list covers every registrar gate: a new gate fails
    // here until the list learns it, so no test narrows `Object.keys`.
    expect(new Set<string>(ACP_GATES)).toEqual(new Set(Object.keys(GATE_COMMANDS)))
    // Every announced command answers to at least one bound gate: a command
    // no single gate explains fails here as unclassifiable.
    for (const name of announced) {
      if (baseline.has(name)) continue
      const explaining = ACP_GATES.filter((gate) => GATE_COMMANDS[gate].has(name))
      expect(explaining, name).not.toEqual([])
    }
  })

  it('attributes each announced command to its registrar gate', async () => {
    // One gate bound at a time: the commands beyond the always-announced
    // baseline are that gate's, and the report must carry the FULL gate —
    // every qualifier, as a set — that the registrar honours in each mode
    // (normal and headless), so dropping `not headless` fails here.
    const baseline = new Set(await announcedNames('baseline', false))
    const reported = new Map<string, string | undefined>(
      ACP_COMMAND_FACTS.map((entry) => [entry.name, entry.when]),
    )
    for (const gate of ACP_GATES) {
      const announced = await announcedNames(gate, false)
      const added = new Set<string>()
      for (const name of announced) {
        if (!baseline.has(name)) added.add(name)
      }
      expect(added, gate).toEqual(GATE_COMMANDS[gate])
    }
    const announcedNormal = new Set(await announcedNames('all', false))
    const announcedHeadless = new Set(await announcedNames('all', true))
    expect(fullGateMismatches(reported, baseline, announcedNormal, announcedHeadless)).toEqual([])
  })

  it('flags a reported gate that drops `not headless`', () => {
    // RVCM1135D P3(1): reporting attach and record as `media` while the
    // registrar withholds them headless passed the old first-word
    // comparison; the full-gate comparison must flag both.
    const baseline = new Set(['help'])
    const announcedNormal = new Set(['help', 'attach', 'record'])
    const announcedHeadless = new Set(['help'])
    const honest = new Map<string, string | undefined>([
      ['help', undefined],
      ['attach', 'media, not headless'],
      ['record', 'media, not headless'],
    ])
    expect(fullGateMismatches(honest, baseline, announcedNormal, announcedHeadless)).toEqual([])
    const mutated = new Map(honest).set('attach', 'media').set('record', 'media')
    expect(
      fullGateMismatches(mutated, baseline, announcedNormal, announcedHeadless).toSorted(compare),
    ).toEqual(['attach', 'record'])
  })

  it('withholds the media commands when headless', async () => {
    // `media, not headless` is behaviour, not a second gate: with every
    // port bound but headless on, attach and record stay silent while every
    // other reported command still announces. The report carries the same
    // condition as its full gate, so dropping `not headless` fails here too.
    const announced = new Set(await announcedNames('all', true))
    expect(announced.has('attach')).toBe(false)
    expect(announced.has('record')).toBe(false)
    const reported = new Map(ACP_COMMAND_FACTS.map((entry) => [entry.name, entry.when]))
    for (const name of ['attach', 'record']) {
      expect(observedQualifiers(reported.get(name)), name).toEqual(
        new Set(['media', 'not headless']),
      )
    }
    for (const entry of ACP_COMMAND_FACTS) {
      if (entry.name === 'attach' || entry.name === 'record') continue
      expect(announced.has(entry.name), entry.name).toBe(true)
    }
  })

  it('documents the keybindings adapter where it runs', () => {
    const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
    const hosts = readFileSync(
      path.join(root, '..', 'docs', 'ide-compatibility', 'hosts.md'),
      'utf8',
    )
    const reports = hosts.split('## Deterministic reports (M113)', 2)[1]!
    expect(reports).toContain('keybindings adapter is available')
    const unavailable = /remain named unavailable sources[^.]*\./u.exec(reports)?.[0] ?? ''
    expect(unavailable).not.toContain('keybindings')
    const acp = readFileSync(path.join(root, '..', 'docs', 'acp.md'), 'utf8')
    expect(acp).toContain('report keybindings')
  })

  it('collects real sections through the shared forward with row caps', async () => {
    const result = await keybindingsSource(() => manifest).read(keybindingsContext())
    const report = fixtureCollector(
      buildSourceSnapshot({ keybindings: availableSource('keybindings', result.data!) }),
      reportOptions('keybindings'),
    )
    const bindings = report.sections.find((section) => section.id === 'keybindings/keybindings')!
    expect(bindings.rows).toHaveLength(REPORT_SECTION_ROWS)
    expect(bindings.omittedRows).toBeGreaterThan(0)
    const full = fixtureCollector(
      buildSourceSnapshot({ keybindings: availableSource('keybindings', result.data!) }),
      reportOptions('keybindings', { full: true }),
    )
    const fullBindings = full.sections.find((section) => section.id === 'keybindings/keybindings')!
    expect(fullBindings.omittedRows).toBe(0)
    expect(fullBindings.rows.length).toBe(bindings.rows.length + bindings.omittedRows)
    expect(full.sections.find((section) => section.id === 'keybindings/conflicts')).toBeDefined()
  })
})

describe('keybindings manifest reader', () => {
  it('reads the installed file and reports a missing or broken one', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'keybindings-manifest-'))
    roots.push(root)
    const file = path.join(root, 'package.json')
    await writeFile(file, JSON.stringify({ contributes: { commands: [], keybindings: [] } }))
    expect(keybindingsManifestReader(file)()).toEqual({
      contributes: { commands: [], keybindings: [] },
    })
    // The reader throws synchronously; the source port maps the codes.
    expect(
      readManifestError(keybindingsManifestReader(path.join(root, 'absent.json'))),
    ).toMatchObject({
      isLocalSourceError: true,
      code: 'missing',
    })
    await writeFile(file, '{ not json')
    expect(readManifestError(keybindingsManifestReader(file))).toMatchObject({
      isLocalSourceError: true,
      code: 'invalid',
    })
    const missing = await keybindingsSource(() => {
      throw new LocalSourceError('missing')
    }).read(keybindingsContext())
    expect(missing).toMatchObject({
      record: { status: 'unavailable', reason: EN.reportSourceReasons.missing },
      data: null,
    })
  })
})

async function keybindingsRun(keybindings: (() => unknown) | undefined, isFull = false) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'keybindings-host-'))
  roots.push(home)
  await writeFile(
    path.join(home, 'package.json'),
    JSON.stringify({ scripts: { quality: 'npm test' } }),
  )
  await writeFile(
    path.join(home, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A local change.\n',
  )
  const workspaceKey = reportWorkspaceKey(home, process.platform)
  const engine = createReportingEngine({
    workspaceRoot: home,
    workspaceKey,
    storageRoot: path.join(home, 'data'),
    l10n: { table: EN, locale: 'en' },
    generatorVersion: '0.0.0-test',
    keepHistory: false,
    enabledAgents: [],
    ...(keybindings !== undefined && { keybindings }),
  })
  const result = await engine.reports.run({
    workspaceKey,
    options: {
      kind: 'keybindings',
      asOf: REPORT_AS_OF,
      scope: '',
      full: isFull,
      network: false,
      failOn: [],
    },
  })
  if (result.status !== 'generated') throw new Error(JSON.stringify(result))
  return result.document
}
describe('keybindings engine binding', () => {
  it('generates the kind from the passed install manifest in every host', async () => {
    // Full rows: the capped view keeps digest-hash order, so membership in
    // it is luck, not a contract the manifest content can pin.
    const document = await keybindingsRun(() => manifest, true)
    expect(document.sources.find(({ id }) => id === 'keybindings')?.status).toBe('ok')
    const bindings = document.sections.find((section) => section.id === 'keybindings/keybindings')!
    expect(
      bindings.rows.some(
        (entry) =>
          entry.cells['command']?.type === 'text' &&
          entry.cells['command'].value === 'museSpark.focusInput',
      ),
    ).toBe(true)
  })
  it('leaves the kind unbound without the install manifest', async () => {
    const document = await keybindingsRun(undefined)
    expect(document.sources.find(({ id }) => id === 'keybindings')?.status).toBe('unavailable')
  })
})
